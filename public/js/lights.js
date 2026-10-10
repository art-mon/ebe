// Light feedback for controllers with LEDs (the APC Key 25). The same "look"
// drives the on-screen grid, so the screen and the hardware always agree.
import { state } from './state.js';
import { VIBES, INSTRUMENTS, DRUM_VOICES, NOTE_NAMES, SCALES, VISUALS } from './config.js';
import { STYLES } from './styles.js';
import { APC, APC_SCENES, APC_TRACKS, apcNote, apcGrid } from './devices.js';
import { every } from './ticker.js';

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

// mk2 pads: the MIDI channel picks brightness/animation (Live's APC_Key_25_mk2 script
// + Akai's protocol: channels 0-6 = 10/25/50/65/75/90/100 %, 10 = pulse, 14 = blink).
const MK2_CHANNEL = { dim: 1, full: 6, pulse: 10, blink: 14 };
const MK2_BRIGHTNESS = [0.1, 0.25, 0.5, 0.65, 0.75, 0.9, 1];
// Drums mode: one colour per drum column.
export const DRUM_COLORS = ['#ff4c4c', '#ff7f00', '#ffe126', '#4cc3ff', '#4c88ff', '#874cff', '#4cff88', '#ff4cff'];
const LOUDNESS = { 1: 'loud', 0.85: 'strong', 0.66: 'medium', 0.48: 'soft', 0.3: 'softest' };
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
// Empty loop pads show their length: green 1 bar, yellow 2, orange 4, purple 8.
export const BAR_COLORS = { 1: '#4cff4c', 2: '#ffff4c', 4: '#ff7f00', 8: '#874cff' };
const VISUAL_COLORS = { nebula: '#4cc3ff', rings: '#ff4cff', horizon: '#ff7f00', oil: '#4c88ff', stardust: '#e0ffff' };
const KEY_COLORS = { off: '#7f7f7f', snap: '#4cc3ff', white: '#4cff88' };

export const targetKey = (t) => `${t.kind}:${t.name ?? ''}:${t.index ?? ''}:${t.arg ?? ''}`;

/**
 * How a grid pad should look: { color, level } with level off | dim | full | pulse | blink.
 * `mk1` forces a value on the 3-colour mk1; `keep` keeps it lit (amber) there when dim.
 */
export function gridLook(t, ctx) {
  if (t.kind === 'pad' && t.note !== undefined) {
    // Drums mode: colour = drum, brightness = loudness row; the pad you hit flashes white.
    if (ctx.cellHits.has(t.note)) return { color: '#ffffff', level: 'full', mk1: MK1.green };
    return { color: DRUM_COLORS[t.index], level: 'solid', bright: t.vel, mk1: t.vel >= 0.85 ? MK1.red : MK1.amber };
  }
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
    case 'loop': {
      const st = ctx.looper.status(a);
      if (st === 'empty') return { color: BAR_COLORS[ctx.looper.loops[a].bars] ?? '#ffffff', level: 'dim', mk1: 0 };
      return LOOP_LOOK[st];
    }
    case 'stylePrev':
    case 'styleNext': return { color: INSTRUMENTS[state.instrument].color, level: ctx.held.has(targetKey(t)) ? 'full' : 'dim', mk1: MK1.amber };
    case 'visualNext': return { color: VISUAL_COLORS[state.visual] ?? '#ffffff', level: 'full' };
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
    case 'gridMode': return state.gridMode === 'drums' ? 1 : 0;
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
  const tag = ['K', 'S', 'C', 'H', 'OH', 'T', 'R', 'Cr'][t.index];
  if (t.kind === 'pad' && t.vel !== undefined) return [`${DRUM_VOICES[t.index].name} · ${LOUDNESS[t.vel] ?? ''}`, tag];
  if (t.kind === 'pad') return [DRUM_VOICES[t.index].name, tag];
  const a = t.arg;
  switch (t.name) {
    case 'vibe': return [`Vibe · ${VIBES[a].name}`, VIBES[a].name.slice(0, 3)];
    case 'inst': return [`${INSTRUMENTS[a].name} (Shift: layer)`, INSTRUMENTS[a].name.slice(0, 3)];
    case 'visual': return [`Visuals · ${a}`, a.slice(0, 3)];
    case 'stage': return ['Stage mode', '⛶'];
    case 'loop': return [`Loop ${a + 1} (tap: rec/play/stop · hold: clear · Shift: length)`, `${a + 1}`];
    case 'stylePrev':
    case 'styleNext': {
      const id = INSTRUMENTS[state.instrument].id;
      const name = STYLES[id]?.find((st) => st.id === state.styles[id])?.name ?? '';
      return [`${t.name === 'styleNext' ? 'Next' : 'Previous'} ${INSTRUMENTS[state.instrument].name} style · now ${name}`, t.name === 'styleNext' ? 'St▶' : '◀St'];
    }
    case 'visualNext': return [`Next visuals (Shift: previous) · now ${VISUALS[state.visual]}`, 'Vis'];
    case 'stopLoops': return ['Stop all loops (Shift: clear all)', '■'];
    case 'quantize': return ['Snap loops to 16ths', 'Snp'];
    case 'loopBars': return ['Loop length (1 / 2 / 4 / 8 bars)', 'Len'];
    case 'metronome': return ['Metronome', '♩'];
    case 'keyMode': return [{ off: 'Notes · Free', snap: 'Notes · Snap to scale', white: 'Notes · Easy (white keys)' }[a], { off: 'Fr', snap: 'Sn', white: 'Ez' }[a]];
    case 'chord': return [`Chords · ${a}`, { off: 'Off', triad: '3', seventh: '7', power: '5', octave: '8' }[a]];
    case 'randomVibe': return ['Random vibe', '?'];
    case 'layer': return ['Layer on/off', 'L'];
    case 'record': return ['Record next loop (Shift: snap on/off)', '●'];
    case 'nextScale': return [`Next scale (Shift: next key) · ${NOTE_NAMES[state.root]} ${SCALES[state.scale].name}`, '♯'];
    case 'tap': return ['Tap tempo (Shift: metronome on/off)', 'Tap'];
    case 'mute': return [`Mute ${INSTRUMENTS[a].name}`, INSTRUMENTS[a].name[0]];
    case 'octDown': return ['Octave down', '−'];
    case 'octUp': return ['Octave up', '+'];
    case 'panic': return ['All notes off', '!'];
    case 'gridMode': return ['Grid: controls ⇄ drums (Shift: all notes off)', 'Drm'];
    default: return [t.name, t.name.slice(0, 3)];
  }
}

const GRID_NOTES = Array.from({ length: 40 }, (_, n) => n);
const BUTTON_NOTES = [...APC_SCENES.map((_, i) => 82 + i), ...APC_TRACKS.map((_, i) => 64 + i)];

export class Lights {
  constructor({ midi, looper, bus }) {
    this.midi = midi;
    this.looper = looper;
    this.bus = bus;
    this.sent = new Map(); // port id → Map(note → last bytes)
    this.held = new Set();
    this.hits = new Set(); // drum voices currently hit (controls-mode drum row)
    this.cellHits = new Set(); // grid notes currently hit (drums mode)
    this.beat = false;
    this.stage = false;
    this.pending = false;
    const later = () => this.schedule();
    for (const ev of ['state', 'looper', 'transport', 'shift']) bus.on(ev, later);
    bus.on('midiPorts', () => {
      // A (re)connected controller starts dark: forget what we sent to ports that vanished.
      const ids = new Set(midi.lightOutputs.map((p) => p.id));
      for (const id of this.sent.keys()) if (!ids.has(id)) this.sent.delete(id);
      this.schedule();
    });
    bus.on('pad', ({ index, on, cell }) => {
      if (on) {
        this.hits.add(index);
        if (cell !== undefined) this.cellHits.add(cell);
      } else {
        setTimeout(() => {
          this.hits.delete(index);
          this.cellHits.delete(cell);
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
    // The mk2 syncs pulsing/blinking pads to an incoming MIDI clock (Live normally
    // sends one), so Lumen sends its own — which also makes the blinks land on the beat.
    this.nextTick = 0;
    every(50, () => this.#clock());
  }

  #clock() {
    const ports = this.midi.lightOutputs;
    const now = performance.now();
    if (!ports.length) {
      this.nextTick = 0;
      return;
    }
    const interval = 60000 / (state.tempo * 24); // 24 clocks per beat
    if (this.nextTick < now) this.nextTick = now;
    // Schedule ~150 ms ahead with timestamps, so timer jitter never reaches the clock.
    while (this.nextTick < now + 150) {
      for (const port of ports) this.midi.sendTo(port, [0xf8], this.nextTick);
      this.nextTick += interval;
    }
  }

  get ctx() {
    return { looper: this.looper, held: this.held, hits: this.hits, cellHits: this.cellHits, beat: this.beat, stage: this.stage };
  }

  /** Coalesce a burst of changes into one update (a microtask isn't throttled in background tabs). */
  schedule() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.render();
    });
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
      apcGrid(state.gridMode).forEach((cells, row) => cells.forEach((t, col) => {
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
  if (look.level === 'solid') {
    // Pick the closest of the seven brightness channels.
    let ch = 0;
    MK2_BRIGHTNESS.forEach((b, i) => {
      if (Math.abs(b - look.bright) < Math.abs(MK2_BRIGHTNESS[ch] - look.bright)) ch = i;
    });
    return [0x90 | ch, note, paletteIndex(look.color)];
  }
  return [0x90 | MK2_CHANNEL[look.level], note, paletteIndex(look.color)];
}

export function mk1Value(look) {
  if (look.mk1 !== undefined) return look.mk1;
  if (look.level === 'off') return 0;
  if (look.level === 'dim') return look.keep ? MK1.amber : 0;
  const base = triColor(look.color);
  return look.level === 'full' ? base : base + 1;
}
