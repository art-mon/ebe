// Light feedback for controllers with LEDs (the APC Key 25). The same "look"
// drives the on-screen grid, so the screen and the hardware always agree.
import { state } from './state.js';
import { VIBES, INSTRUMENTS, DRUM_VOICES, NOTE_NAMES, SCALES } from './config.js';
import { APC, APC_GRID, APC_SCENES, APC_TRACKS, apcNote } from './devices.js';

// Ableton's standard 128-colour palette: on the APC Key 25 mk2 the note
// velocity picks one of these. Copied from Live 12's ableton.v3 framework.
export const PALETTE = [
  '#000000', '#1e1e1e', '#7f7f7f', '#ffffff', '#ff4c4c', '#ff0000', '#590000', '#190000',
  '#ffbd6c', '#ff5400', '#591d00', '#271b00', '#ffff4c', '#ffff00', '#595900', '#191900',
  '#88ff4c', '#54ff00', '#1d5900', '#142b00', '#4cff4c', '#00ff00', '#005900', '#001900',
  '#4cff5e', '#00ff19', '#00590d', '#001902', '#4cff88', '#00ff55', '#00591d', '#001f12',
  '#4cffb7', '#00ff99', '#005935', '#001912', '#4cc3ff', '#00a9ff', '#004152', '#001019',
  '#4c88ff', '#0055ff', '#001d59', '#000819', '#4c4cff', '#0000ff', '#000059', '#000019',
  '#874cff', '#5400ff', '#190064', '#0f0030', '#ff4cff', '#ff00ff', '#590059', '#190019',
  '#ff4c87', '#ff0054', '#59001d', '#220013', '#ff1500', '#993500', '#795100', '#436400',
  '#033900', '#005735', '#00547f', '#0000ff', '#00454f', '#2500cc', '#7f7f7f', '#202020',
  '#ff0000', '#bdff2d', '#afed06', '#64ff09', '#108b00', '#00ff87', '#00a9ff', '#002aff',
  '#3f00ff', '#7a00ff', '#b21a7d', '#402100', '#ff4a00', '#88e106', '#72ff15', '#00ff00',
  '#3bff26', '#59ff71', '#38ffcc', '#5b8aff', '#3151c6', '#877fe9', '#d31dff', '#ff005d',
  '#ff7f00', '#b9b000', '#90ff00', '#835d07', '#392b00', '#144c10', '#0d5038', '#15152a',
  '#16205a', '#693c1c', '#a8000a', '#de513d', '#d86a1c', '#ffe126', '#9ee12f', '#67b50f',
  '#1e1e30', '#dcff6b', '#80ffbd', '#9a99ff', '#8e66ff', '#404040', '#757575', '#e0ffff',
  '#a00000', '#350000', '#1ad000', '#074200', '#b9b000', '#3f3100', '#b35f00', '#4b1502',
];

// mk2 pads: the MIDI channel picks brightness/animation (from Live's APC_Key_25_mk2 script).
const MK2_CHANNEL = { dim: 1, full: 6, pulse: 10, blink: 14 };
// mk1 pads only do green / red / amber; +1 = blinking.
export const MK1 = { green: 1, red: 3, amber: 5 };

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const nearest = new Map();
/** Closest palette entry to a colour (bright entries only, so LEDs stay vivid). */
export function paletteIndex(hex) {
  if (nearest.has(hex)) return nearest.get(hex);
  const [r, g, b] = rgb(hex);
  let best = 3;
  let bestD = Infinity;
  PALETTE.forEach((p, i) => {
    const [pr, pg, pb] = rgb(p);
    if (Math.max(pr, pg, pb) < 120) return; // skip the dark shades
    const d = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  nearest.set(hex, best);
  return best;
}

/** mk1: map a colour to the nearest of its three LED colours. */
function triColor(hex) {
  const [r, g, b] = rgb(hex);
  if (r > 200 && g > 150 && b < 150) return MK1.amber;
  if (r >= g && r >= b) return r - g > 60 ? MK1.red : MK1.amber;
  return MK1.green;
}

const LOOP_LOOK = {
  empty: { color: '#ffffff', level: 'dim', mk1: 0 },
  armed: { color: '#ff0000', level: 'blink', mk1: MK1.red + 1 },
  recording: { color: '#ff0000', level: 'full', mk1: MK1.red },
  overdub: { color: '#ff0000', level: 'pulse', mk1: MK1.red + 1 },
  playing: { color: '#00ff00', level: 'full', mk1: MK1.green },
  stopped: { color: '#ffbd6c', level: 'dim', mk1: MK1.amber },
};
const BAR_COLORS = { 1: '#4cff4c', 2: '#ffff4c', 4: '#ff7f00', 8: '#ff4c4c' };
const KEY_COLORS = { off: '#7f7f7f', snap: '#4cc3ff', white: '#4cff88' };

export const targetKey = (t) => `${t.kind}:${t.name ?? ''}:${t.index ?? ''}:${t.arg ?? ''}`;

/**
 * How a grid pad should look: { color, level } with level off | dim | full | pulse | blink.
 * `mk1` forces a value on the 3-colour mk1; `keep` keeps it lit (amber) there when dim.
 */
export function gridLook(t, ctx) {
  if (t.kind === 'pad') {
    return { color: VIBES[state.vibe].palette[t.index % 3], level: ctx.hits.has(t.index) ? 'full' : 'dim', keep: true };
  }
  const a = t.arg;
  switch (t.name) {
    case 'vibe': return { color: VIBES[a].palette[0], level: state.vibe === a ? 'full' : 'dim' };
    case 'inst': {
      const main = state.instrument === a;
      const layered = state.layerOn && state.layer === a && !main;
      return { color: INSTRUMENTS[a].color, level: main ? 'full' : layered ? 'pulse' : 'dim' };
    }
    case 'visual': return { color: '#4cc3ff', level: state.visual === a ? 'full' : 'dim' };
    case 'stage': return { color: '#ff4cff', level: ctx.stage ? 'pulse' : 'dim' };
    case 'loop': return LOOP_LOOK[ctx.looper.status(a)];
    case 'stopLoops': return { color: '#ff4c4c', level: ctx.looper.loops.some((l) => l.playing && l.events.length) ? 'full' : 'dim' };
    case 'quantize': return { color: '#4cffb7', level: state.quantize ? 'full' : 'dim' };
    case 'loopBars': return { color: BAR_COLORS[ctx.looper.bars] ?? '#ffffff', level: ctx.looper.hasContent ? 'dim' : 'full', mk1: MK1.amber };
    case 'metronome': return { color: '#ffffff', level: state.metronome ? (ctx.beat ? 'full' : 'pulse') : 'dim' };
    case 'keyMode': return { color: KEY_COLORS[a], level: state.keyMode === a ? 'full' : 'dim' };
    case 'chord': return { color: a === 'off' ? '#7f7f7f' : '#ffbd6c', level: state.chord === a ? 'full' : 'dim' };
    default: return { color: '#ffffff', level: ctx.held.has(targetKey(t)) ? 'full' : 'dim' };
  }
}

/** Single-colour buttons (scene + track rows): 0 off, 1 on, 2 blink. */
export function buttonLook(t, ctx) {
  const held = ctx.held.has(targetKey(t)) ? 1 : 0;
  switch (t.name) {
    case 'layer': return state.layerOn ? 1 : 0;
    case 'record': return ctx.looper.loops.some((_, i) => ['armed', 'recording', 'overdub'].includes(ctx.looper.status(i))) ? 2 : held;
    case 'tap': return ctx.beat || held ? 1 : 0;
    case 'mute': return state.mutes[t.arg] ? 1 : 0;
    case 'octDown': return state.octave < 0 ? 1 : 0;
    case 'octUp': return state.octave > 0 ? 1 : 0;
    default: return held;
  }
}

/** Label + short tag for the on-screen grid. */
export function describeTarget(t) {
  if (t.kind === 'pad') return [DRUM_VOICES[t.index].name, ['K', 'S', 'C', 'H', 'OH', 'T', 'R', 'Cr'][t.index]];
  const a = t.arg;
  switch (t.name) {
    case 'vibe': return [`Vibe · ${VIBES[a].name}`, VIBES[a].name.slice(0, 3)];
    case 'inst': return [`${INSTRUMENTS[a].name} (Shift: layer)`, INSTRUMENTS[a].name.slice(0, 3)];
    case 'visual': return [`Visuals · ${a}`, a.slice(0, 3)];
    case 'stage': return ['Stage mode', '⛶'];
    case 'loop': return [`Loop ${a + 1} (tap: rec/play/stop · hold or Shift: clear)`, `L${a + 1}`];
    case 'stopLoops': return ['Stop all loops (Shift: clear all)', '■'];
    case 'quantize': return ['Snap loops to 16ths', 'Snp'];
    case 'loopBars': return ['Loop length (1 / 2 / 4 / 8 bars)', 'Len'];
    case 'metronome': return ['Metronome', '♩'];
    case 'keyMode': return [{ off: 'Notes · Free', snap: 'Notes · Snap to scale', white: 'Notes · Easy (white keys)' }[a], { off: 'Fr', snap: 'Sn', white: 'Ez' }[a]];
    case 'chord': return [`Chords · ${a}`, { off: 'Off', triad: '3', seventh: '7', power: '5', octave: '8' }[a]];
    case 'randomVibe': return ['Random vibe', '?'];
    case 'layer': return ['Layer on/off', 'L'];
    case 'record': return ['Record next loop', '●'];
    case 'nextScale': return [`Next scale (Shift: next key) · ${NOTE_NAMES[state.root]} ${SCALES[state.scale].name}`, '♯'];
    case 'tap': return ['Tap tempo', 'Tap'];
    case 'mute': return [`Mute ${INSTRUMENTS[a].name}`, INSTRUMENTS[a].name[0]];
    case 'octDown': return ['Octave down', '−'];
    case 'octUp': return ['Octave up', '+'];
    case 'panic': return ['All notes off', '!'];
    default: return [t.name, t.name.slice(0, 3)];
  }
}

const GRID_NOTES = APC_GRID.flatMap((cells, row) => cells.map((_, col) => apcNote(row, col)));
const BUTTON_NOTES = [...APC_SCENES.map((_, i) => 82 + i), ...APC_TRACKS.map((_, i) => 64 + i)];

export class Lights {
  constructor({ midi, looper, bus }) {
    this.midi = midi;
    this.looper = looper;
    this.bus = bus;
    this.sent = new Map(); // port id → Map(note → last bytes)
    this.held = new Set();
    this.hits = new Set();
    this.beat = false;
    this.stage = false;
    this.timer = 0;
    const later = () => this.schedule();
    for (const ev of ['state', 'looper', 'transport', 'shift']) bus.on(ev, later);
    bus.on('midiPorts', () => {
      // A (re)connected controller starts dark: forget what we sent to ports that vanished.
      const ids = new Set(midi.lightOutputs.map((p) => p.id));
      for (const id of this.sent.keys()) if (!ids.has(id)) this.sent.delete(id);
      this.schedule();
    });
    bus.on('pad', ({ index, on }) => {
      if (on) this.hits.add(index);
      else {
        setTimeout(() => {
          this.hits.delete(index);
          this.schedule();
        }, 60);
      }
      this.schedule();
    });
    bus.on('button', ({ target, on }) => {
      if (on) this.held.add(targetKey(target));
      else this.held.delete(targetKey(target));
      this.schedule();
    });
    bus.on('beat', () => {
      this.beat = true;
      this.schedule(); // also catches loops going from "armed" to "recording" on the bar
      setTimeout(() => {
        this.beat = false;
        this.schedule();
      }, 110);
    });
    bus.on('stageMode', (on) => {
      this.stage = on;
      this.schedule();
    });
    addEventListener('pagehide', () => this.allOff());
  }

  get ctx() {
    return { looper: this.looper, held: this.held, hits: this.hits, beat: this.beat, stage: this.stage };
  }

  /** Coalesce bursts of changes into one update (timers keep running in background tabs). */
  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.render();
    }, 12);
  }

  render() {
    const ctx = this.ctx;
    for (const port of this.midi.lightOutputs) {
      const mk2 = APC.variant(port.name) === 'mk2';
      if (!this.sent.has(port.id)) this.sent.set(port.id, new Map());
      const sent = this.sent.get(port.id);
      const put = (note, bytes) => {
        const key = bytes.join(',');
        if (sent.get(note) === key) return;
        sent.set(note, key);
        this.midi.sendTo(port, bytes);
      };
      APC_GRID.forEach((cells, row) => cells.forEach((t, col) => {
        const note = apcNote(row, col);
        put(note, mk2 ? mk2Bytes(note, gridLook(t, ctx)) : [0x90, note, mk1Value(gridLook(t, ctx))]);
      }));
      APC_SCENES.forEach((t, i) => put(82 + i, [0x90, 82 + i, buttonLook(t, ctx)]));
      APC_TRACKS.forEach((t, i) => put(64 + i, [0x90, 64 + i, buttonLook(t, ctx)]));
    }
    this.bus.emit('lights', ctx);
  }

  allOff() {
    for (const port of this.midi.lightOutputs) {
      for (const note of [...GRID_NOTES, ...BUTTON_NOTES]) this.midi.sendTo(port, [0x90, note, 0]);
    }
    this.sent.clear();
  }
}

export function mk2Bytes(note, look) {
  if (look.level === 'off') return [0x90, note, 0];
  return [0x90 | MK2_CHANNEL[look.level], note, paletteIndex(look.color)];
}

export function mk1Value(look) {
  if (look.mk1 !== undefined) return look.mk1;
  if (look.level === 'off') return 0;
  if (look.level === 'dim') return look.keep ? MK1.amber : 0;
  const base = triColor(look.color);
  return look.level === 'full' ? base : base + 1;
}
