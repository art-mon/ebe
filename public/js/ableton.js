// Talks to Ableton Live through the local bridge (server/index.js) and the
// AbletonOSC remote script. Optional: everything else works without it.
// It gives us: per-track meters, tempo sync and track mute.
import { INSTRUMENTS } from './config.js';

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
        break;
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
