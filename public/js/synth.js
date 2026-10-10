// Built-in sound engine (Web Audio). Used when the engine is "Built-in", and
// always for the metronome click. Signal flow:
//
//   voices ─▶ instrument bus (gain ─▶ meter) ─▶ drive ─▶ crush ─▶ filter ─┬─▶ dry ──────┐
//                                                                         ├─▶ echo ─────┤─▶ limiter ─▶ out
//                                                                         └─▶ reverb ───┘
import { INSTRUMENTS, DRUMS_INDEX, FX_MACROS } from './config.js';

const mtof = (n) => 440 * 2 ** ((n - 69) / 12);
const MAX_VOICES = 12;

function driveCurve(amount) {
  if (amount < 0.01) return null;
  const k = 1 + amount * 14;
  const n = 2048;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

function crushCurve(amount) {
  if (amount < 0.01) return null;
  const levels = 2 ** (10 - amount * 8) / 2;
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

function adsr(param, t, { a, d, s, peak }) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(Math.max(peak * s, 0.0001), t + a, d / 3);
}

function releaseParam(param, t, r) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  param.setTargetAtTime(0, t, r / 4);
}

// ── Patches ─────────────────────────────────────────────────────────────────
// Each returns { out, oscs, release } — `out` is the voice's amp gain node.
const PATCHES = {
  // FM electric piano: bell-like attack that mellows out.
  keys(s, f, vel, t) {
    const { ctx } = s;
    const car = s.osc('sine', f);
    const mod = s.osc('sine', f);
    const modG = s.gain(0);
    mod.connect(modG).connect(car.frequency);
    modG.gain.setValueAtTime(f * (1.2 + vel * 2.4), t);
    modG.gain.setTargetAtTime(f * 0.3, t, 0.4);
    const tine = s.osc('sine', f * 14);
    const tineG = s.gain(0);
    tine.connect(tineG).connect(car.frequency);
    tineG.gain.setValueAtTime(f * vel * 0.9, t);
    tineG.gain.setTargetAtTime(0, t, 0.03);
    const amp = ctx.createGain();
    car.connect(amp);
    adsr(amp.gain, t, { a: 0.004, d: 2.2, s: 0.12, peak: 0.12 + vel * 0.38 });
    return { out: amp, oscs: [car, mod, tine], release: 0.45 };
  },

  // Warm detuned-saw pad.
  pad(s, f, vel, t) {
    const { ctx } = s;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.setTargetAtTime(1200 + vel * 1600, t, 0.6);
    const oscs = [-11, -3, 4, 12].map((cents) => {
      const o = s.osc('sawtooth', f, cents);
      o.connect(filter);
      return o;
    });
    const sub = s.osc('sine', f / 2);
    const subG = s.gain(0.5);
    sub.connect(subG).connect(filter);
    oscs.push(sub);
    const amp = ctx.createGain();
    filter.connect(amp);
    adsr(amp.gain, t, { a: 0.45, d: 1.5, s: 0.8, peak: 0.07 + vel * 0.06 });
    return { out: amp, oscs, release: 1.6 };
  },

  // Round sub bass with a plucky filter.
  bass(s, f, vel, t) {
    const { ctx } = s;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(200 + vel * 2600, t);
    filter.frequency.setTargetAtTime(380, t + 0.01, 0.12);
    const sine = s.osc('sine', f);
    const sq = s.osc('square', f, 3);
    const sqG = s.gain(0.28);
    sine.connect(filter);
    sq.connect(sqG).connect(filter);
    const amp = ctx.createGain();
    filter.connect(amp);
    adsr(amp.gain, t, { a: 0.004, d: 0.35, s: 0.7, peak: 0.3 + vel * 0.3 });
    return { out: amp, oscs: [sine, sq], release: 0.12 };
  },

  // Bright saw/square lead.
  lead(s, f, vel, t) {
    const { ctx } = s;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(900 + vel * 5200, t);
    filter.frequency.setTargetAtTime(2400, t + 0.01, 0.18);
    const saw = s.osc('sawtooth', f, -6);
    const sq = s.osc('square', f, 6);
    const sqG = s.gain(0.45);
    saw.connect(filter);
    sq.connect(sqG).connect(filter);
    const amp = ctx.createGain();
    filter.connect(amp);
    adsr(amp.gain, t, { a: 0.008, d: 0.25, s: 0.65, peak: 0.1 + vel * 0.14 });
    return { out: amp, oscs: [saw, sq], release: 0.25 };
  },
};

export class Synth {
  constructor(ctx) {
    this.ctx = ctx;

    this.out = this.gain(0.9);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    this.limiter.connect(this.out);
    this.out.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // FX chain
    this.fxIn = this.gain(1);
    this.drive = ctx.createWaveShaper();
    this.drive.oversample = '2x';
    this.driveMakeup = this.gain(1);
    this.crush = ctx.createWaveShaper();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.fxIn.connect(this.drive).connect(this.driveMakeup).connect(this.crush).connect(this.filter);
    this.filter.connect(this.limiter);

    this.echoSend = this.gain(0);
    this.delay = ctx.createDelay(2);
    this.feedback = this.gain(0.35);
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 3200;
    this.filter.connect(this.echoSend).connect(this.delay).connect(this.echoTone);
    this.echoTone.connect(this.feedback).connect(this.delay);
    this.echoTone.connect(this.limiter);

    this.reverbSend = this.gain(0);
    this.convolver = ctx.createConvolver();
    this.reverbReturn = this.gain(0.7);
    this.filter.connect(this.reverbSend).connect(this.convolver).connect(this.reverbReturn).connect(this.limiter);
    this.#buildImpulse(0.5);

    // Per-instrument buses (+ meters for the track view)
    this.buses = INSTRUMENTS.map((inst) => {
      const level = inst.isDrums ? 0.85 : 0.7;
      const g = this.gain(level);
      const meter = ctx.createAnalyser();
      meter.fftSize = 512;
      g.connect(meter);
      g.connect(this.fxIn);
      return { gain: g, level, meter, data: new Float32Array(meter.fftSize), muted: false };
    });

    // Vibrato (mod wheel): one LFO, one depth per instrument
    this.lfo = this.osc('sine', 5.5);
    this.lfo.start();
    this.vibrato = INSTRUMENTS.map(() => {
      const depth = this.gain(0);
      this.lfo.connect(depth);
      return depth;
    });

    this.noise = this.#makeNoise();
    this.live = INSTRUMENTS.map(() => new Map()); // note → voice (played live)
    this.all = INSTRUMENTS.map(() => new Set()); // every sounding voice
    this.sustainOn = INSTRUMENTS.map(() => false);
    this.sustained = INSTRUMENTS.map(() => new Set());
    this.bendCents = INSTRUMENTS.map(() => 0);
    this.openHat = null;

    FX_MACROS.forEach((m, i) => this.setFx(i, m.def));
    this.setTempo(100);
  }

  // ── helpers ──
  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  osc(type, freq, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    return o;
  }

  #makeNoise() {
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  #buildImpulse(space) {
    const { sampleRate } = this.ctx;
    const seconds = 0.6 + space * 5.4;
    const len = Math.floor(sampleRate * seconds);
    const ir = this.ctx.createBuffer(2, len, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp((-t * 6.5) / seconds) * Math.min(1, t * 200);
      }
    }
    this.convolver.buffer = ir;
  }

  // ── voices ──
  #voice(inst, note, vel, t) {
    const patch = PATCHES[INSTRUMENTS[inst].patch];
    const f = mtof(note);
    const v = patch(this, f, vel, t);
    const releaseTime = v.release;
    v.out.connect(this.buses[inst].gain);
    v.inst = inst;
    v.note = note;
    v.released = false;
    v.detunes = v.oscs.map((o) => ({ param: o.detune, base: o.detune.value }));
    for (const { param, base } of v.detunes) param.value = base + this.bendCents[inst];
    for (const o of v.oscs) {
      this.vibrato[inst].connect(o.detune);
      o.start(t);
    }
    // fast = "cut it now" (voice stealing, loop muting) and may override a normal release.
    v.release = (time, fast = false) => {
      if (v.released && !fast) return;
      const r = fast ? 0.03 : releaseTime;
      v.released = true;
      releaseParam(v.out.gain, time, r);
      for (const o of v.oscs) o.stop(time + r * 1.6 + 0.05);
    };
    v.oscs[0].onended = () => {
      this.all[inst].delete(v);
      v.out.disconnect();
    };

    const voices = this.all[inst];
    voices.add(v);
    if (voices.size > MAX_VOICES) {
      const oldest = voices.values().next().value;
      oldest.release(t, true);
      voices.delete(oldest);
    }
    return v;
  }

  noteOn(inst, note, vel, time = this.ctx.currentTime) {
    if (inst === DRUMS_INDEX) return this.drum(note, vel, time);
    this.live[inst].get(note)?.release(time, true);
    this.live[inst].set(note, this.#voice(inst, note, vel, time));
  }

  noteOff(inst, note, time = this.ctx.currentTime) {
    if (inst === DRUMS_INDEX) return;
    const v = this.live[inst].get(note);
    if (!v) return;
    this.live[inst].delete(note);
    if (this.sustainOn[inst]) this.sustained[inst].add(v);
    else v.release(time);
  }

  /** Schedules a complete note (used by the looper). Returns a cancel handle. */
  playNote(inst, note, vel, start, end) {
    if (inst === DRUMS_INDEX) {
      this.drum(note, vel, start);
      return { cancel() {} };
    }
    const v = this.#voice(inst, note, vel, start);
    v.release(end);
    return { cancel: (now) => v.release(Math.max(now, start), true) };
  }

  setBend(inst, semis) {
    this.bendCents[inst] = semis * 100;
    const now = this.ctx.currentTime;
    for (const v of this.all[inst]) {
      for (const { param, base } of v.detunes) param.setTargetAtTime(base + semis * 100, now, 0.01);
    }
  }

  setMod(inst, amount) {
    this.vibrato[inst].gain.setTargetAtTime(amount * 40, this.ctx.currentTime, 0.05);
  }

  setSustain(inst, on) {
    this.sustainOn[inst] = on;
    if (!on) {
      const now = this.ctx.currentTime;
      for (const v of this.sustained[inst]) v.release(now);
      this.sustained[inst].clear();
    }
  }

  allNotesOff() {
    const now = this.ctx.currentTime;
    this.all.forEach((set) => set.forEach((v) => v.release(now, true)));
    this.live.forEach((m) => m.clear());
    this.sustained.forEach((s) => s.clear());
  }

  // ── drums (synthesised, one-shot) ──
  #noiseSrc(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return src;
  }

  #env(t, peak, decay) {
    const g = this.gain(0);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    return g;
  }

  drum(note, vel, t = this.ctx.currentTime) {
    const { ctx } = this;
    const out = this.buses[DRUMS_INDEX].gain;
    const v = 0.35 + vel * 0.65;
    const filt = (type, freq, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const hit = (src, chain, dur) => {
      let node = src;
      for (const c of chain) node = node.connect(c);
      node.connect(out);
      if (src instanceof OscillatorNode) {
        src.start(t);
        src.stop(t + dur);
      }
    };

    switch (note) {
      case 36: { // kick
        const o = this.osc('sine', 150);
        o.frequency.setValueAtTime(160, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        hit(o, [this.#env(t, 1.1 * v, 0.45)], 0.5);
        const click = this.osc('square', 900);
        hit(click, [this.#env(t, 0.12 * v, 0.008)], 0.02);
        break;
      }
      case 38: { // snare
        hit(this.#noiseSrc(t, 0.25), [filt('highpass', 1300), this.#env(t, 0.55 * v, 0.22)], 0.25);
        const body = this.osc('triangle', 190);
        body.frequency.exponentialRampToValueAtTime(150, t + 0.1);
        hit(body, [this.#env(t, 0.45 * v, 0.12)], 0.15);
        break;
      }
      case 39: { // clap
        const g = this.gain(0);
        [0, 0.011, 0.023].forEach((dt) => {
          g.gain.setValueAtTime(0.6 * v, t + dt);
          g.gain.exponentialRampToValueAtTime(0.05, t + dt + 0.01);
        });
        g.gain.setValueAtTime(0.5 * v, t + 0.034);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
        hit(this.#noiseSrc(t, 0.25), [filt('bandpass', 1150, 0.9), g], 0.25);
        break;
      }
      case 42: { // closed hat (chokes the open hat)
        if (this.openHat) {
          this.openHat.gain.cancelScheduledValues(t);
          this.openHat.gain.setTargetAtTime(0, t, 0.01);
          this.openHat = null;
        }
        hit(this.#noiseSrc(t, 0.08), [filt('highpass', 7500), this.#env(t, 0.32 * v, 0.055)], 0.08);
        break;
      }
      case 46: { // open hat
        const env = this.#env(t, 0.28 * v, 0.38);
        this.openHat = env;
        hit(this.#noiseSrc(t, 0.4), [filt('highpass', 6800), env], 0.4);
        break;
      }
      case 37: { // rim
        hit(this.#noiseSrc(t, 0.05), [filt('bandpass', 2100, 3), this.#env(t, 0.6 * v, 0.035)], 0.05);
        const o = this.osc('triangle', 820);
        hit(o, [this.#env(t, 0.3 * v, 0.03)], 0.04);
        break;
      }
      case 49: { // crash
        hit(this.#noiseSrc(t, 1), [filt('highpass', 4200), this.#env(t, 0.32 * v, 1.4)], 1.5);
        break;
      }
      default: { // toms (45 and anything else), pitched by note
        const f0 = 70 + (note % 12) * 9;
        const o = this.osc('sine', f0 * 1.6);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.2);
        hit(o, [this.#env(t, 0.8 * v, 0.38)], 0.4);
      }
    }
  }

  /** Metronome tick — bypasses the FX so it stays dry and clear. */
  click(time, accent) {
    const o = this.osc('sine', accent ? 1760 : 1180);
    const g = this.#env(time, accent ? 0.35 : 0.2, 0.05);
    o.connect(g).connect(this.out);
    o.start(time);
    o.stop(time + 0.06);
  }

  // ── FX + mixing ──
  setFx(index, v) {
    const now = this.ctx.currentTime;
    switch (FX_MACROS[index].id) {
      case 'filter':
        this.filter.frequency.setTargetAtTime(60 * (20000 / 60) ** v, now, 0.02);
        break;
      case 'reso':
        this.filter.Q.setTargetAtTime(0.5 + v * v * 16, now, 0.02);
        break;
      case 'drive':
        this.drive.curve = driveCurve(v);
        this.driveMakeup.gain.setTargetAtTime(1 / (1 + v * 0.9), now, 0.02);
        break;
      case 'crush':
        this.crush.curve = crushCurve(v);
        break;
      case 'echo':
        this.echoSend.gain.setTargetAtTime(v * 0.75, now, 0.03);
        break;
      case 'repeats':
        this.feedback.gain.setTargetAtTime(v * 0.82, now, 0.03);
        break;
      case 'reverb':
        this.reverbSend.gain.setTargetAtTime(v * 0.95, now, 0.03);
        break;
      case 'space':
        clearTimeout(this.spaceTimer);
        this.spaceTimer = setTimeout(() => this.#buildImpulse(v), 120);
        break;
      default:
        break;
    }
  }

  setTempo(bpm) {
    // Dotted eighth echoes always sit nicely in the groove.
    this.delay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), this.ctx.currentTime, 0.05);
  }

  setMute(inst, muted) {
    const b = this.buses[inst];
    b.muted = muted;
    b.gain.gain.setTargetAtTime(muted ? 0 : b.level, this.ctx.currentTime, 0.02);
  }

  /** RMS level (0..1-ish) of an instrument bus, for meters. */
  level(inst) {
    const b = this.buses[inst];
    b.meter.getFloatTimeDomainData(b.data);
    let sum = 0;
    for (let i = 0; i < b.data.length; i++) sum += b.data[i] * b.data[i];
    return Math.sqrt(sum / b.data.length);
  }
}
