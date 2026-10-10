// Turns input — the Oxygen Pro Mini, the computer keyboard, or clicks on the
// screen — into music and actions. Also owns MIDI learn + the setup wizard.
import { state, set } from './state.js';
import {
  INSTRUMENTS, MELODIC, DRUMS_INDEX, DRUM_VOICES, VIBES, CONTROL_PADS,
  CONTROLLER, DEFAULT_MAPPINGS,
} from './config.js';
import { transform } from './transform.js';

const mod = (n, m) => ((n % m) + m) % m;
const LOOP_HOLD_MS = 650; // hold a loop pad this long to clear it

// Computer keyboard (physical key codes, so Shift doesn't change them):
// A W S E D F T G Y H U J K O L P ; → semitones above C4, like a piano.
const PIANO_KEYS = new Map(
  ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon']
    .map((code, i) => [code, i]),
);
const LOOP_KEYS = ['KeyC', 'KeyV', 'KeyB', 'KeyN'];
const KEY_ACTIONS = {
  Space: 'transport', KeyZ: 'octDown', KeyX: 'octUp', KeyM: 'stopLoops', Comma: 'vibePrev', Period: 'vibeNext',
  ArrowLeft: 'vibePrev', ArrowRight: 'vibeNext', ArrowUp: 'instPrev', ArrowDown: 'instNext', Backquote: 'stage',
};
const digit = (code) => (/^Digit[1-8]$/.test(code) ? Number(code[5]) - 1 : -1);

const sameTarget = (a, b) =>
  a && b && a.kind === b.kind && a.index === b.index && a.name === b.name && a.arg === b.arg;

export function sourceKey(msg) {
  const kind = msg.type === 'cc' ? 'cc' : 'note';
  return `${msg.port}|${kind}:${msg.channel}:${kind === 'cc' ? msg.cc : msg.note}`;
}

export class Controller {
  constructor({ engine, looper, clock, bus }) {
    this.engine = engine;
    this.looper = looper;
    this.clock = clock;
    this.bus = bus;
    this.held = new Map(); // input source → { note, played: [{inst, note}] }
    this.refs = new Map(); // inst*128+note → how many keys are holding it
    this.loopPadDown = new Map(); // pad index → press time
    this.buttonDown = new Map(); // CC buttons: source key → pressed?
    this.learnTarget = null;
    this.wizard = null;
    this.tween = 0;
    bus.on('midi', (m) => this.onMidi(m));
  }

  // ── mapping ──
  #lookup(msg) {
    const kind = msg.type === 'cc' ? 'cc' : 'note';
    const num = kind === 'cc' ? msg.cc : msg.note;
    const keys = [`${msg.port}|${kind}:${msg.channel}:${num}`, `${msg.port}|${kind}:*:${num}`];
    for (const table of [state.mappings ?? {}, DEFAULT_MAPPINGS]) {
      for (const k of keys) if (k in table) return table[k]; // null = deliberately unmapped
    }
    if (kind === 'note' && msg.port === 'main') {
      const ch = state.padChannel ?? CONTROLLER.padChannel;
      const idx = msg.note - (state.padBase ?? CONTROLLER.padBase);
      if (msg.channel === ch && idx >= 0 && idx < 16) return { kind: 'pad', index: idx };
    }
    return undefined;
  }

  /** Which source (if any) is bound to a target — for the settings list. */
  bindingFor(target) {
    const user = state.mappings ?? {};
    const found = Object.entries(user).find(([, t]) => sameTarget(t, target));
    if (found) return { key: found[0], learned: true };
    const def = Object.entries(DEFAULT_MAPPINGS).find(([k, t]) => sameTarget(t, target) && user[k] !== null);
    return def ? { key: def[0], learned: false } : null;
  }

  // ── MIDI in ──
  onMidi(msg) {
    if (msg.type === 'start' || msg.type === 'continue') return this.action('play');
    if (msg.type === 'stop') return this.action('stop');

    if (this.learnTarget && (msg.type === 'noteon' || msg.type === 'cc')) {
      this.#bind(msg);
      return;
    }

    switch (msg.type) {
      case 'noteon': {
        const t = this.#lookup(msg);
        if (t?.kind === 'pad') return this.padDown(t.index, msg.velocity / 127);
        if (t?.kind === 'action') return this.action(t.name, t.arg);
        if (t?.kind === 'fx' || msg.port === 'daw') return undefined;
        return this.keyDown(`${msg.port}:${msg.channel}:${msg.note}`, msg.note, msg.velocity / 127);
      }
      case 'noteoff': {
        const t = this.#lookup(msg);
        if (t?.kind === 'pad') return this.padUp(t.index);
        if (t || msg.port === 'daw') return undefined;
        return this.keyUp(`${msg.port}:${msg.channel}:${msg.note}`);
      }
      case 'cc': {
        const t = this.#lookup(msg);
        if (t?.kind === 'fx') return this.setFx(t.index, msg.value / 127);
        if (t) {
          // A button sending CC: act on the press edge only.
          const key = sourceKey(msg);
          const down = msg.value >= 64;
          const was = this.buttonDown.get(key) ?? false;
          this.buttonDown.set(key, down);
          if (down === was) return undefined;
          if (t.kind === 'action') return down ? this.action(t.name, t.arg) : undefined;
          if (t.kind === 'pad') return down ? this.padDown(t.index, 1) : this.padUp(t.index);
          return undefined;
        }
        if (msg.port === 'daw') return undefined;
        if (msg.cc === 1) return this.activeInstruments().forEach((i) => this.engine.mod(i, msg.value / 127));
        if (msg.cc === 64) return this.activeInstruments().forEach((i) => this.engine.sustain(i, msg.value >= 64));
        return undefined;
      }
      case 'pitchbend':
        return this.activeInstruments().forEach((i) => this.engine.bend(i, msg.value * 2, msg.raw));
      default:
        return undefined;
    }
  }

  activeInstruments() {
    const list = [state.instrument];
    if (state.layerOn && state.layer !== state.instrument && state.layer !== DRUMS_INDEX) list.push(state.layer);
    return list;
  }

  // ── keys ──
  keyDown(src, note, vel) {
    if (this.held.has(src)) this.keyUp(src);
    const notes = transform(note, state);
    const played = [];
    for (const inst of this.activeInstruments()) {
      for (const n of notes) {
        const k = inst * 128 + n;
        this.refs.set(k, (this.refs.get(k) ?? 0) + 1);
        this.engine.noteOn(inst, n, vel);
        this.looper.input({ inst, note: n, vel, on: true });
        played.push({ inst, note: n });
      }
    }
    this.held.set(src, { note, played });
    this.bus.emit('keys', { note, on: true, notes });
  }

  keyUp(src) {
    const h = this.held.get(src);
    if (!h) return;
    this.held.delete(src);
    for (const { inst, note } of h.played) {
      const k = inst * 128 + note;
      const left = (this.refs.get(k) ?? 1) - 1;
      if (left > 0) {
        this.refs.set(k, left);
        continue;
      }
      this.refs.delete(k);
      this.engine.noteOff(inst, note);
      this.looper.input({ inst, note, vel: 0, on: false });
    }
    this.bus.emit('keys', { note: h.note, on: false });
  }

  releaseAll(prefix) {
    for (const src of [...this.held.keys()]) if (src.startsWith(prefix)) this.keyUp(src);
  }

  // ── pads: bank A (0-7) drums, bank B (8-15) controls ──
  padDown(index, vel) {
    this.bus.emit('pad', { index, on: true, vel });
    if (index < 8) {
      const { note } = DRUM_VOICES[index];
      this.engine.noteOn(DRUMS_INDEX, note, vel);
      this.looper.input({ inst: DRUMS_INDEX, note, vel, on: true });
      return;
    }
    const cp = CONTROL_PADS[index - 8];
    if (!cp) return;
    if (cp.action === 'loop') this.loopPadDown.set(index, performance.now());
    else this.action(cp.action, cp.arg);
  }

  padUp(index) {
    this.bus.emit('pad', { index, on: false });
    if (index < 8) {
      this.engine.noteOff(DRUMS_INDEX, DRUM_VOICES[index].note);
      return;
    }
    const cp = CONTROL_PADS[index - 8];
    if (cp?.action !== 'loop' || !this.loopPadDown.has(index)) return;
    const heldFor = performance.now() - this.loopPadDown.get(index);
    this.loopPadDown.delete(index);
    if (heldFor >= LOOP_HOLD_MS) this.looper.clear(cp.arg);
    else this.looper.tap(cp.arg);
  }

  // ── actions ──
  action(name, arg) {
    const lp = this.looper;
    switch (name) {
      case 'transport':
        if (this.clock.running) this.clock.stop();
        else this.clock.start(0);
        break;
      case 'play':
        if (!this.clock.running) this.clock.start(0);
        break;
      case 'stop':
        this.clock.stop();
        break;
      case 'record': {
        const busy = lp.loops.findIndex((_, i) => ['armed', 'recording', 'overdub'].includes(lp.status(i)));
        if (busy >= 0) lp.tap(busy);
        else {
          const empty = lp.loops.findIndex((_, i) => lp.status(i) === 'empty');
          if (empty >= 0) lp.record(empty);
          else this.bus.emit('toast', 'All four loops are full — hold a loop pad to clear one.');
        }
        break;
      }
      case 'loop':
        lp.tap(arg);
        break;
      case 'stopLoops':
        lp.stopAll();
        break;
      case 'vibePrev':
        this.selectVibe(mod(state.vibe - 1, VIBES.length));
        break;
      case 'vibeNext':
        this.selectVibe(mod(state.vibe + 1, VIBES.length));
        break;
      case 'instPrev':
      case 'instNext': {
        const pos = MELODIC.indexOf(state.instrument);
        this.selectInstrument(MELODIC[mod(pos + (name === 'instNext' ? 1 : -1), MELODIC.length)]);
        break;
      }
      case 'octDown':
      case 'octUp':
        set({ octave: Math.max(-3, Math.min(3, state.octave + (name === 'octUp' ? 1 : -1))) });
        break;
      case 'metronome':
        set({ metronome: !state.metronome });
        break;
      case 'stage':
        this.bus.emit('stage', 'toggle');
        break;
      default:
        break;
    }
  }

  selectInstrument(inst) {
    set({ instrument: inst, layerOn: state.layerOn && state.layer !== inst });
  }

  toggleLayer(inst) {
    if (inst === state.instrument) return;
    const on = !(state.layerOn && state.layer === inst);
    set({ layer: inst, layerOn: on });
  }

  selectVibe(i) {
    const v = VIBES[i];
    const inst = INSTRUMENTS.findIndex((x) => x.id === v.instrument);
    const layer = v.layer ? INSTRUMENTS.findIndex((x) => x.id === v.layer) : state.layer;
    set({ vibe: i, instrument: inst, layer, layerOn: !!v.layer, visual: v.visual });
    this.morphFx(v.fx);
    this.bus.emit('vibe', v);
  }

  setFx(index, value) {
    cancelAnimationFrame(this.tween); // a hand on a knob beats an ongoing morph
    const fx = [...state.fx];
    fx[index] = value;
    set({ fx });
    this.engine.fx(index, value);
  }

  /** Glide all FX to new values instead of jumping (sounds like a DJ transition). */
  morphFx(target, ms = 450) {
    cancelAnimationFrame(this.tween);
    const from = [...state.fx];
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = t * t * (3 - 2 * t);
      const fx = from.map((v, i) => v + (target[i] - v) * e);
      fx.forEach((v, i) => this.engine.fx(i, v));
      set({ fx });
      if (t < 1) this.tween = requestAnimationFrame(step);
    };
    step();
  }

  // ── MIDI learn ──
  learn(target) {
    this.wizard = null;
    this.learnTarget = target;
    this.bus.emit('learn', { target });
  }

  startWizard(steps) {
    this.wizard = { steps, i: 0, used: new Set() };
    this.learnTarget = steps[0].target;
    this.bus.emit('learn', { target: this.learnTarget, wizard: this.wizard });
  }

  skipStep() {
    if (!this.wizard) return;
    this.#advance();
  }

  stopLearning() {
    this.learnTarget = null;
    this.wizard = null;
    this.bus.emit('learn', null);
  }

  #bind(msg) {
    const key = sourceKey(msg);
    // In the wizard a fader sends a stream of CCs — only a *new* control may answer the next step.
    if (this.wizard?.used.has(key)) return;
    const target = this.learnTarget;
    const user = { ...(state.mappings ?? {}) };
    for (const [k, t] of Object.entries(user)) if (sameTarget(t, target)) delete user[k];
    user[key] = target;
    set({ mappings: user });
    this.bus.emit('learned', { target, msg, key });
    if (this.wizard) {
      this.wizard.used.add(key);
      this.#advance();
    } else {
      this.stopLearning();
    }
  }

  #advance() {
    const w = this.wizard;
    w.i++;
    if (w.i >= w.steps.length) {
      this.stopLearning();
      this.bus.emit('toast', 'Controller setup complete ✦');
      return;
    }
    this.learnTarget = w.steps[w.i].target;
    this.bus.emit('learn', { target: this.learnTarget, wizard: w });
  }

  unmap(key) {
    const user = { ...(state.mappings ?? {}) };
    if (key in DEFAULT_MAPPINGS) user[key] = null;
    else delete user[key];
    set({ mappings: user });
  }

  // ── computer keyboard ──
  attachKeyboard() {
    const typing = (e) => e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey;
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      const { code } = e;
      const known = PIANO_KEYS.has(code) || digit(code) >= 0 || LOOP_KEYS.includes(code) || code in KEY_ACTIONS;
      if (!known) return;
      e.preventDefault();
      if (e.repeat) return;
      if (PIANO_KEYS.has(code)) this.keyDown(`kb:${code}`, 60 + PIANO_KEYS.get(code), e.shiftKey ? 1 : 0.75);
      else if (digit(code) >= 0) this.padDown(digit(code), e.shiftKey ? 1 : 0.8);
      else if (LOOP_KEYS.includes(code)) this.padDown(8 + LOOP_KEYS.indexOf(code), 1);
      else this.action(KEY_ACTIONS[code]);
    });
    window.addEventListener('keyup', (e) => {
      const { code } = e;
      if (PIANO_KEYS.has(code)) this.keyUp(`kb:${code}`);
      else if (digit(code) >= 0) this.padUp(digit(code));
      else if (LOOP_KEYS.includes(code)) this.padUp(8 + LOOP_KEYS.indexOf(code));
    });
    window.addEventListener('blur', () => this.releaseAll('kb:'));
  }
}
