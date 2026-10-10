// Talks to Ableton Live through the local bridge (server/index.js) and the
// AbletonOSC remote script. Optional: everything else works without it.
// It gives us: per-track meters, tempo sync, track mute, and a Reverb whose
// decay follows the tempo.
import { INSTRUMENTS, PREDELAY_BEATS } from './config.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Ableton {
  constructor(bus) {
    this.bus = bus;
    this.ws = null;
    this.bridge = false; // WebSocket to our server is up
    this.live = false; // AbletonOSC answered
    this.trackNames = [];
    this.trackOf = INSTRUMENTS.map(() => -1); // instrument → Live track index
    this.meters = INSTRUMENTS.map(() => 0);
    this.meterAt = INSTRUMENTS.map(() => 0);
    this.tempo = null;
    this.sentTempoAt = 0;
    this.pollTimer = 0;
    // Live's Reverb, found by scanning devices: { track, device, score, decay, pre, readout }
    this.reverb = null;
    this.reverbProbe = null; // parameter info being collected for a candidate
    this.lastReverbKey = '';
  }

  /** True when Lumen can set Live's Reverb decay itself. */
  get reverbSynced() {
    return !!(this.live && this.reverb?.decay);
  }

  connect() {
    let ws;
    try {
      ws = new WebSocket(`ws://${location.host}/bridge`);
    } catch {
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.bridge = true;
      this.#emit();
    };
    ws.onclose = () => {
      this.bridge = false;
      this.#setLive(false);
      setTimeout(() => this.connect(), 2000);
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'status') this.#setLive(msg.ableton);
      else if (msg.type === 'osc') this.#onOsc(msg.address, msg.args ?? []);
    };
  }

  send(address, args = [], types) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'osc', address, args, types }));
    }
  }

  #setLive(alive) {
    if (alive === this.live) return;
    this.live = alive;
    clearInterval(this.pollTimer);
    if (alive) {
      this.send('/live/song/get/tempo');
      this.send('/live/song/start_listen/tempo');
      this.refreshTracks();
      // Track names can change at any time in Live; re-read them now and then.
      this.pollTimer = setInterval(() => this.refreshTracks(), 5000);
    } else {
      this.trackNames = []; // forces meters to re-subscribe when Live comes back
      this.trackOf = INSTRUMENTS.map(() => -1);
      this.meters.fill(0);
      this.reverb = null;
      this.reverbProbe = null;
    }
    this.#emit();
  }

  refreshTracks() {
    this.send('/live/song/get/track_names');
  }

  #onOsc(address, args) {
    switch (address) {
      case '/live/song/get/track_names':
        this.#mapTracks(args.map(String));
        // Look for a Reverb on every track (devices can be added or moved at any time).
        for (let t = 0; t < args.length; t++) this.send('/live/track/get/devices/name', [t], 'i');
        break;
      case '/live/track/get/devices/name':
        this.#onDevices(args[0], args.slice(1).map(String));
        break;
      case '/live/device/get/parameters/name':
      case '/live/device/get/parameters/min':
      case '/live/device/get/parameters/max':
        this.#onParams(address.split('/').pop(), args[0], args[1], args.slice(2));
        break;
      case '/live/device/get/parameter/value_string': {
        const [t, d, p, text] = args;
        const r = this.reverb;
        if (r && t === r.track && d === r.device && p === r.decay?.i) {
          r.readout = String(text);
          this.#emit();
        }
        break;
      }
      case '/live/song/get/tempo':
        // Right after we set the tempo, Live echoes older values back — ignore them briefly.
        if (typeof args[0] === 'number' && performance.now() - this.sentTempoAt > 800) {
          this.tempo = args[0];
          this.bus.emit('abletonTempo', args[0]);
        }
        break;
      case '/live/track/get/output_meter_level': {
        const [track, value] = args;
        const inst = this.trackOf.indexOf(track);
        if (inst >= 0 && typeof value === 'number') {
          // Live's meter is a peak-hold that can stick at its last value, so remember when it changed.
          if (value !== this.meters[inst]) this.meterAt[inst] = performance.now();
          this.meters[inst] = value;
        }
        break;
      }
      case '/live/startup': // AbletonOSC (re)loaded, e.g. a new set was opened
        this.trackNames = [];
        this.trackOf = INSTRUMENTS.map(() => -1);
        this.reverb = null;
        this.reverbProbe = null;
        this.send('/live/song/start_listen/tempo');
        this.refreshTracks();
        break;
      case '/live/error':
        console.warn('[AbletonOSC]', ...args);
        break;
      default:
        break;
    }
  }

  #mapTracks(names) {
    const same = names.length === this.trackNames.length && names.every((n, i) => n === this.trackNames[i]);
    if (same) return;
    for (const t of this.trackOf) if (t >= 0) this.send('/live/track/stop_listen/output_meter_level', [t], 'i');
    this.trackNames = names;
    const used = new Set();
    this.trackOf = INSTRUMENTS.map((inst) => {
      const want = inst.name.toLowerCase();
      const idx = names.findIndex((n, i) => !used.has(i) && n.toLowerCase().includes(want));
      if (idx >= 0) used.add(idx);
      return idx;
    });
    for (const t of this.trackOf) if (t >= 0) this.send('/live/track/start_listen/output_meter_level', [t], 'i');
    this.#emit();
  }

  // ── tempo-synced reverb ──
  // AbletonOSC can't reach the Master track, so the Reverb must sit on a normal or
  // group track. A track named like "FX" wins over an instrument track.
  #onDevices(track, names) {
    const d = names.findIndex((n) => /reverb/i.test(n));
    const r = this.reverb;
    if (d < 0) {
      if (r?.track === track) {
        this.reverb = null; // it was removed
        this.#emit();
      }
      return;
    }
    if (r?.track === track && r.device === d) return; // unchanged
    const name = this.trackNames[track] ?? '';
    const score = (/fx|bus|group|master|verb/i.test(name) ? 2 : 0) + (this.trackOf.includes(track) ? 0 : 1);
    if (r && r.track !== track && r.score >= score) return;
    if (this.reverbProbe && this.reverbProbe.score > score) return;
    this.reverbProbe = { track, device: d, score };
    for (const what of ['name', 'min', 'max']) this.send(`/live/device/get/parameters/${what}`, [track, d], 'ii');
  }

  #onParams(kind, track, device, list) {
    const p = this.reverbProbe;
    if (!p || p.track !== track || p.device !== device) return;
    p[kind] = list;
    if (!p.name || !p.min || !p.max) return;
    this.reverbProbe = null;
    const find = (re) => {
      const i = p.name.findIndex((n) => re.test(String(n)));
      return i < 0 ? null : { i, min: Number(p.min[i]), max: Number(p.max[i]) };
    };
    // Only drive parameters whose native unit is milliseconds (Live's Reverb:
    // Decay Time 200–60000 ms, Predelay 0.5–250 ms). Anything else, we leave alone.
    const decay = find(/decay/i);
    const pre = find(/pre.?delay/i);
    this.reverb = {
      track, device, score: p.score, readout: '',
      decay: decay && decay.max > 1000 ? decay : null,
      pre: pre && pre.max > 10 ? pre : null,
      foundDecay: !!decay,
    };
    this.lastReverbKey = '';
    this.#emit();
    this.bus.emit('abletonReverb', this.reverb);
  }

  /** Set Live's Reverb decay to `beats` at `bpm`, and pre-delay to a 1/64 note. */
  syncReverb(beats, bpm) {
    const r = this.reverb;
    if (!this.reverbSynced) return;
    const key = `${r.track}:${r.device}:${beats}@${bpm}`;
    if (key === this.lastReverbKey) return; // fader moves within one step, or FX morphs
    this.lastReverbKey = key;
    const beatMs = 60000 / bpm;
    r.decayMs = clamp(beats * beatMs, r.decay.min, r.decay.max);
    this.send('/live/device/set/parameter/value', [r.track, r.device, r.decay.i, r.decayMs], 'iiif');
    if (r.pre) {
      r.preMs = clamp(beatMs * PREDELAY_BEATS, r.pre.min, r.pre.max);
      this.send('/live/device/set/parameter/value', [r.track, r.device, r.pre.i, r.preMs], 'iiif');
    }
    // Ask Live what it now displays, so the UI shows the real value.
    clearTimeout(this.readoutTimer);
    this.readoutTimer = setTimeout(() => {
      this.send('/live/device/get/parameter/value_string', [r.track, r.device, r.decay.i], 'iii');
    }, 200);
  }

  /** Meter value for an instrument, faded out if Live stopped updating it. */
  meter(inst) {
    const age = performance.now() - this.meterAt[inst];
    return age < 400 ? this.meters[inst] : this.meters[inst] * Math.max(0, 1 - (age - 400) / 600);
  }

  setTempo(bpm) {
    if (!this.live) return;
    if (this.tempo !== null && Math.abs(this.tempo - bpm) < 0.05) return;
    this.tempo = bpm;
    this.sentTempoAt = performance.now();
    this.send('/live/song/set/tempo', [bpm], 'f');
  }

  setMute(inst, muted) {
    const t = this.trackOf[inst];
    if (this.live && t >= 0) this.send('/live/track/set/mute', [t, muted ? 1 : 0], 'ii');
  }

  #emit() {
    this.bus.emit('ableton', { bridge: this.bridge, live: this.live });
  }
}
