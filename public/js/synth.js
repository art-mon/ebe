// Built-in sound engine (Web Audio). Used when the engine is "Built-in", and
// always for the metronome click. Signal flow:
//
//   voices ─▶ instrument bus (gain ─▶ meter) ─▶ drive ─▶ crush ─▶ filter ─┬─▶ dry ──────┐
//                                                                         ├─▶ echo ─────┤─▶ limiter ─▶ out
//                                                                         └─▶ reverb ───┘
import { INSTRUMENTS, DRUMS_INDEX, DRUM_VOICES, FX_MACROS, PREDELAY_BEATS, reverbDivision } from './config.js';
import { styleFor } from './styles.js';
import { SampleBank, nearestZone } from './sampler.js';

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

// Gentle tape-style saturation for a drum kit: rounds off peaks, adds a little grit.
function kitCurve(amount) {
  if (amount < 0.01) return null;
  const k = 1 + amount * 2.5;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / k; // unity gain for small signals, peaks squashed
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

// ── Voices from styles ──────────────────────────────────────────────────────
// Builds one note from a style description (see styles.js).
// Returns { out, oscs (pitched, follow bend/vibrato), extras (LFOs/noise: start+stop only), release }.
function buildVoice(s, style, f, vel, t) {
  const { ctx } = s;
  const input = s.gain(1);
  const amp = ctx.createGain();
  const oscs = [];
  const extras = [];

  // Tone shaping: one filter, or parallel vowel formants, or nothing.
  if (style.formants) {
    style.formants.forEach((hz, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz;
      bp.Q.value = 7;
      const g = s.gain([1, 0.6, 0.35][i] ?? 0.3);
      input.connect(bp).connect(g).connect(amp);
    });
  } else if (style.filter) {
    const { type = 'lowpass', freq, q = 0.7, env = 0, decay = 0.2, keytrack = 0 } = style.filter;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    const base = freq * (f / 261.6) ** keytrack;
    filter.frequency.setValueAtTime(Math.max(30, base + env * (env > 0 ? vel : 1)), t);
    filter.frequency.setTargetAtTime(base, t + 0.005, decay / 3);
    if (style.wobble) {
      // Tempo-locked filter sweep (dubstep wobble, slow drone movement).
      const lfo = s.osc('sine', s.bpm / 60 / style.wobble.beats);
      const depth = s.gain(style.wobble.depth);
      lfo.connect(depth).connect(filter.frequency);
      extras.push(lfo);
    }
    input.connect(filter).connect(amp);
  } else {
    input.connect(amp);
  }

  // Oscillators (+ optional FM modulator driving all of them).
  let fmGain = null;
  if (style.fm) {
    const { ratio, index, decay, floor } = style.fm;
    const mod = s.osc('sine', f * ratio);
    fmGain = s.gain(0);
    fmGain.gain.setValueAtTime(f * index * (0.45 + vel * 0.55), t);
    fmGain.gain.setTargetAtTime(f * floor, t, decay / 3);
    mod.connect(fmGain);
    oscs.push(mod);
  }
  for (const { type, ratio = 1, detune = 0, gain = 1 } of style.osc) {
    const o = s.osc(type, f * ratio, detune);
    if (fmGain) fmGain.connect(o.frequency);
    o.connect(s.gain(gain)).connect(input);
    oscs.push(o);
  }

  // Noise layer: a hammer/pluck transient, or a sustained breath.
  if (style.noise) {
    const { gain, type = 'bandpass', freq = 2000, q = 1, decay } = style.noise;
    const src = ctx.createBufferSource();
    src.buffer = s.noise;
    src.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = type;
    nf.frequency.value = freq;
    nf.Q.value = q;
    const ng = s.gain(0);
    ng.gain.setValueAtTime(gain * (0.4 + vel * 0.6), t);
    if (decay) ng.gain.setTargetAtTime(0, t, decay / 3);
    src.connect(nf).connect(ng).connect(input);
    extras.push(src);
  }

  // Vibrato that fades in after `delay`.
  if (style.vibrato) {
    const { rate, depth, delay = 0 } = style.vibrato;
    const lfo = s.osc('sine', rate);
    const dg = s.gain(0);
    dg.gain.setValueAtTime(0, t);
    dg.gain.linearRampToValueAtTime(depth, t + delay + 0.25);
    lfo.connect(dg);
    for (const o of oscs) dg.connect(o.detune);
    extras.push(lfo);
  }

  const { a, d, s: sus, r, peak } = style.amp;
  adsr(amp.gain, t, { a, d, s: sus, peak: peak * (0.25 + vel * 0.75) });
  return { out: amp, oscs, extras, release: r };
}

// A note from a sampled instrument: the nearest recording, re-tuned, through an
// attack/release envelope. Velocity sets the level and, with style.tone, the
// brightness (a real piano struck softly is darker, not just quieter).
function buildSampleVoice(s, style, set, note, vel, t) {
  const { ctx } = s;
  const zone = nearestZone(set.zones, note);
  const src = ctx.createBufferSource();
  src.buffer = zone.buffer;
  src.playbackRate.value = 2 ** ((note - zone.note) / 12);
  if (zone.loop) {
    src.loop = true;
    src.loopStart = zone.loop.start;
    src.loopEnd = zone.loop.end;
  }
  const amp = ctx.createGain();
  if (style.tone) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(20000, 700 * 2 ** (vel * 5));
    lp.Q.value = 0.5;
    src.connect(lp).connect(amp);
  } else {
    src.connect(amp);
  }
  const level = style.gain * (0.12 + 0.88 * vel ** 1.3);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + style.amp.a);
  return { out: amp, oscs: [src], extras: [], release: style.amp.r };
}

const DRUM_VOICE_BY_NOTE = new Map(DRUM_VOICES.map((v) => [v.note, v.id]));

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

    // Reverb: send → tempo-synced pre-delay → one of two convolvers. When the tempo
    // or length changes, the new tail loads into the idle convolver and crossfades
    // in, so there's no click mid-performance.
    this.bpm = 100;
    this.reverbBeats = reverbDivision(0.5).beats;
    this.reverbSend = this.gain(0);
    this.preDelay = ctx.createDelay(1);
    this.reverbReturn = this.gain(0.7);
    this.verbs = [0, 1].map(() => {
      const conv = ctx.createConvolver();
      const level = this.gain(0);
      this.preDelay.connect(conv).connect(level).connect(this.reverbReturn);
      return { conv, level };
    });
    this.activeVerb = 0;
    this.filter.connect(this.reverbSend).connect(this.preDelay);
    this.reverbReturn.connect(this.limiter);
    this.#loadReverb();

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

    // Sampled kits play through their own tone + saturation (dusty trip-hop, warm downtempo…),
    // one chain per kit so loops recorded with different kits each keep theirs.
    this.kitChains = new Map();

    // Each instrument plays one of its styles (styles.js); sampled ones load on demand.
    this.samples = new SampleBank(ctx);
    this.styles = INSTRUMENTS.map((inst) => styleFor(inst.id));
    this.drumRound = new Map(); // voice → round-robin counter

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

  /** Reverb tail length in seconds for the current tempo and Space setting. */
  get reverbSeconds() {
    return Math.min(12, Math.max(0.15, (this.reverbBeats * 60) / this.bpm));
  }

  #loadReverb() {
    const { sampleRate, currentTime: now } = this.ctx;
    const seconds = this.reverbSeconds;
    const len = Math.floor(sampleRate * seconds);
    const ir = this.ctx.createBuffer(2, len, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        // -60 dB exactly at the end, so the tail is gone right on the beat.
        d[i] = (Math.random() * 2 - 1) * Math.exp((-t * 6.9) / seconds) * Math.min(1, t * 200);
      }
    }
    const from = this.verbs[this.activeVerb];
    this.activeVerb = 1 - this.activeVerb;
    const to = this.verbs[this.activeVerb];
    to.conv.buffer = ir;
    to.level.gain.cancelScheduledValues(now);
    to.level.gain.setTargetAtTime(1, now, 0.08);
    from.level.gain.cancelScheduledValues(now);
    from.level.gain.setTargetAtTime(0, now, 0.08);
    this.preDelay.delayTime.setTargetAtTime((60 / this.bpm) * PREDELAY_BEATS, now, 0.05);
  }

  #scheduleReverb() {
    clearTimeout(this.reverbTimer);
    this.reverbTimer = setTimeout(() => this.#loadReverb(), 150);
  }

  // ── voices ──
  /** A style by id (a loop's recorded sound) or the instrument's current one; starts loading samples it needs. */
  #styleOf(inst, styleId) {
    const style = styleId ? styleFor(INSTRUMENTS[inst].id, styleId) : this.styles[inst];
    if (style.sample && !this.samples.get(style.sample)) this.samples.load(style.sample, style).catch(() => {});
    return style;
  }

  preload(inst, styleId) {
    this.#styleOf(inst, styleId);
  }

  #voice(inst, note, vel, t, styleId) {
    const style = this.#styleOf(inst, styleId);
    const set = style.sample ? this.samples.get(style.sample) : null;
    const v = set
      ? buildSampleVoice(this, style, set, note, vel, t)
      : buildVoice(this, style.sample ? styleFor(INSTRUMENTS[inst].id, style.fallback) : style, mtof(note), vel, t);
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
    for (const x of v.extras) x.start(t);
    // fast = "cut it now" (voice stealing, loop muting) and may override a normal release.
    v.release = (time, fast = false) => {
      if (v.released && !fast) return;
      const r = fast ? 0.03 : releaseTime;
      v.released = true;
      releaseParam(v.out.gain, time, r);
      for (const o of [...v.oscs, ...v.extras]) o.stop(time + r * 1.6 + 0.05);
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

  /** Schedules a complete note (used by the looper), with the sound it was recorded with. Returns a cancel handle. */
  playNote(inst, note, vel, start, end, styleId) {
    if (inst === DRUMS_INDEX) {
      this.drum(note, vel, start, styleId);
      return { cancel() {} };
    }
    const v = this.#voice(inst, note, vel, start, styleId);
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

  /** A hit from a sampled kit. Notes outside the 8 voices play the tom, re-pitched. */
  #sampleDrum(kit, style, note, vel, t) {
    const voice = DRUM_VOICE_BY_NOTE.get(note) ?? 'tom';
    const hits = kit.voices[voice];
    if (!hits?.length) return;
    const n = (this.drumRound.get(voice) ?? -1) + 1;
    this.drumRound.set(voice, n);
    const src = this.ctx.createBufferSource();
    src.buffer = hits[n % hits.length];
    const shift = (style.tune?.[voice] ?? 0) + (DRUM_VOICE_BY_NOTE.has(note) ? 0 : Math.max(-12, Math.min(12, note - 45)));
    if (shift) src.playbackRate.value = 2 ** (shift / 12);
    const g = this.gain((style.levels?.[voice] ?? 0.8) * (0.12 + vel * 0.88));
    if (voice === 'hat' || voice === 'openhat') {
      // A closed hat chokes a ringing open hat, like on a real kit.
      if (this.openHat) {
        this.openHat.gain.cancelScheduledValues(t);
        this.openHat.gain.setTargetAtTime(0, t, 0.01);
      }
      this.openHat = voice === 'openhat' ? g : null;
    }
    src.connect(g).connect(this.#kitChain(style));
    src.onended = () => g.disconnect();
    src.start(t);
  }

  /** The kit's tone + saturation, made the first time the kit plays. */
  #kitChain(style) {
    let input = this.kitChains.get(style.id);
    if (!input) {
      input = this.ctx.createBiquadFilter();
      input.type = 'lowpass';
      input.frequency.value = style.tone ?? 20000;
      input.Q.value = 0.5;
      const drive = this.ctx.createWaveShaper();
      drive.oversample = '2x';
      drive.curve = kitCurve(style.drive ?? 0);
      input.connect(drive).connect(this.buses[DRUMS_INDEX].gain);
      this.kitChains.set(style.id, input);
    }
    return input;
  }

  drum(note, vel, t = this.ctx.currentTime, kitId) {
    const kitStyle = this.#styleOf(DRUMS_INDEX, kitId);
    const kit = kitStyle.sample ? this.samples.get(kitStyle.sample) : null;
    if (kit) return this.#sampleDrum(kit, kitStyle, note, vel, t);
    const { ctx } = this;
    const out = this.buses[DRUMS_INDEX].gain;
    const v = 0.12 + vel * 0.88; // wide range, so soft hits (and the APC's soft rows) really are soft
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

  /** Metronome tick — bypasses the FX so it stays dry and clear. The downbeat is accented. */
  click(time, accent, sound = 'soft') {
    const { ctx } = this;
    const out = this.out;
    const tone = (type, freq, peak, decay, toFreq) => {
      const o = this.osc(type, freq);
      if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, time + decay * 0.6);
      o.connect(this.#env(time, peak, decay)).connect(out);
      o.start(time);
      o.stop(time + decay + 0.02);
      return o;
    };
    const noise = (type, freq, q, peak, decay, attack = 0) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = this.gain(0);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + attack + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0008, time + attack + decay);
      this.#noiseSrc(time, attack + decay + 0.02).connect(f).connect(g).connect(out);
    };
    switch (sound) {
      case 'wood': // hollow "tok": a resonant band-passed tick plus a short body
        noise('bandpass', accent ? 1500 : 1100, 12, accent ? 0.9 : 0.6, 0.05);
        tone('sine', accent ? 900 : 700, accent ? 0.18 : 0.12, 0.04);
        break;
      case 'shaker': // a soft shake that swells in, brighter on the downbeat
        noise('bandpass', accent ? 7000 : 5500, 1.2, accent ? 0.22 : 0.14, 0.07, 0.012);
        break;
      case 'cowbell': // the classic drum-machine bell: two detuned squares through a band-pass
        for (const hz of [540, 800]) {
          const o = this.osc('square', accent ? hz * 1.06 : hz);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 2400;
          bp.Q.value = 1.5;
          o.connect(bp).connect(this.#env(time, accent ? 0.16 : 0.1, 0.18)).connect(out);
          o.start(time);
          o.stop(time + 0.2);
        }
        break;
      case 'beep': // the old-school metronome
        tone('sine', accent ? 1760 : 1180, accent ? 0.35 : 0.2, 0.05);
        break;
      default: // 'soft': a muted low knock with a hint of tick — present but never piercing
        tone('sine', accent ? 190 : 150, accent ? 0.5 : 0.32, 0.09, accent ? 110 : 90);
        noise('highpass', 3000, 0.7, accent ? 0.05 : 0.03, 0.012);
    }
  }

  /** Switch an instrument's style. For a sampled one, returns the loading promise (null when ready). */
  setStyle(inst, styleId) {
    const style = styleFor(INSTRUMENTS[inst].id, styleId);
    this.styles[inst] = style;
    if (!style.sample || this.samples.get(style.sample)) return null;
    return this.samples.load(style.sample, style);
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
      case 'space': {
        const beats = reverbDivision(v).beats;
        if (beats !== this.reverbBeats) {
          this.reverbBeats = beats;
          this.#scheduleReverb();
        }
        break;
      }
      default:
        break;
    }
  }

  setTempo(bpm) {
    // Dotted eighth echoes always sit nicely in the groove.
    this.delay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), this.ctx.currentTime, 0.05);
    if (Math.abs(bpm - this.bpm) > 0.01) {
      this.bpm = bpm;
      this.#scheduleReverb(); // the reverb tail is measured in beats too
    }
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
