// Controller profiles. Each profile says how to recognise the device's MIDI
// ports and what its controls do by default. Mapping keys look like
// "<port class>|<cc|note>:<channel|*>:<number>", so profiles never collide.
import { FX_MACROS, DRUM_VOICES, VIBES_PER_SET, INSTRUMENTS, MELODIC } from './config.js';

const fx = (index, extra = {}) => ({ kind: 'fx', index, ...extra });
const pad = (index) => ({ kind: 'pad', index });
const action = (name, arg) => (arg === undefined ? { kind: 'action', name } : { kind: 'action', name, arg });

// ── M-Audio Oxygen Pro Mini ─────────────────────────────────────────────────
// 4 faders + 4 knobs, 8 pads × 2 banks. Faders (left on screen) play FX 1-4 —
// Filter, Reso, Drive, Crush; knobs (right) play FX 5-8 — Echo … Space.
// Factory Preset-mode CCs aren't documented, so there's also a setup wizard.
export const OXYGEN = {
  id: 'oxygen',
  name: 'Oxygen Pro Mini',
  match: /oxygen/i,
  // Keys + Preset mode arrive on the main port; DAW-mode controls on the Mackie/HUI port.
  portClass: (name) => (/mackie|hui|daw/i.test(name) ? 'daw' : 'main'),
  fxHw: ['Fader 1', 'Fader 2', 'Fader 3', 'Fader 4', 'Knob 1', 'Knob 2', 'Knob 3', 'Knob 4'],
  mappings: (() => {
    const m = {};
    // DAW mode (Ableton map) — numbers from Live's own Oxygen_Pro script
    [12, 13, 14, 15].forEach((cc, i) => (m[`daw|cc:1:${cc}`] = fx(i))); // faders → FX 1-4
    [22, 23, 24, 25].forEach((cc, i) => (m[`daw|cc:1:${cc}`] = fx(4 + i))); // knobs → FX 5-8
    [40, 41, 42, 43, 48, 49, 50, 51].forEach((n, i) => (m[`daw|note:1:${n}`] = pad(i)));
    m['daw|cc:1:114'] = action('stopLoops'); // Loop
    m['daw|cc:1:115'] = action('vibePrev'); // <<
    m['daw|cc:1:116'] = action('vibeNext'); // >>
    m['daw|cc:1:117'] = action('stop'); // Stop
    m['daw|cc:1:118'] = action('transport'); // Play
    m['daw|cc:1:119'] = action('record'); // Record
    // Preset mode, factory preset 12 knobs: bank 1 → FX 5-8, bank 2 → FX 1-4
    [120, 121, 122, 123, 124, 125, 126, 127].forEach((cc, i) => (m[`main|cc:*:${cc}`] = fx((i + 4) % 8)));
    return m;
  })(),
};

// ── Akai APC Key 25 (mk1 & mk2) ─────────────────────────────────────────────
// Numbers from Live 12's own APC_Key_25 / APC_Key_25_mk2 scripts:
// grid notes 0-39 (note 0 = bottom-left), buttons under the grid 64-71,
// scene buttons 82-86 (top→bottom), Stop All 81, Play 91, Record 93,
// Shift 98, knobs CC 48-55 — absolute on mk1, endless/relative on mk2.
// Everything is on MIDI channel 1; the keys play on another channel.
const apcVariant = (name) => (/mk ?ii|mk ?2/i.test(name) ? 'mk2' : 'mk1');

// The grid, top row first. Each cell is a target; lights.js decides its colour.
export const APC_GRID = [
  Array.from({ length: VIBES_PER_SET }, (_, i) => action('vibe', i)), // the 8 vibes of the set on show
  [...MELODIC.map((i) => action('inst', i)), action('stylePrev'), action('styleNext'), action('visualNext'), action('stage')],
  Array.from({ length: 8 }, (_, i) => action('loop', i)),
  [action('keyMode', 'off'), action('keyMode', 'snap'), action('keyMode', 'white'),
    action('chord', 'off'), action('chord', 'triad'), action('chord', 'seventh'), action('chord', 'power'), action('chord', 'octave')],
  DRUM_VOICES.map((_, i) => pad(i)),
];
export const APC_SCENES = [action('randomVibe'), action('layer'), action('record'), action('nextScale'), action('tap')];
// The last button under the grid flips the grid between controls and drums (Shift: all notes off).
export const APC_TRACKS = [...INSTRUMENTS.map((_, i) => action('mute', i)), action('octDown'), action('octUp'), action('gridMode')];
export const APC_BUTTONS = { 81: action('stopLoops'), 91: action('transport'), 93: action('record'), 98: action('shift') };

/** Grid row (0 = top) and column → note number. */
export const apcNote = (row, col) => (APC_GRID.length - 1 - row) * 8 + col;

// Drums mode: the whole grid plays drums. Each column is one drum, each row a
// loudness level (bottom = soft, top = loud) — the APC's pads always hit at full
// velocity, so the rows give it dynamics.
export const DRUM_ROW_VELOCITY = [1, 0.85, 0.66, 0.48, 0.3]; // top row → bottom row
export const APC_DRUM_GRID = APC_GRID.map((_, row) =>
  DRUM_VOICES.map((__, col) => ({ kind: 'pad', index: col, vel: DRUM_ROW_VELOCITY[row], note: apcNote(row, col) })));

/** The grid's targets for a mode: 'controls' or 'drums'. */
export const apcGrid = (mode) => (mode === 'drums' ? APC_DRUM_GRID : APC_GRID);

function apcMappings(cls, relativeKnobs) {
  const m = {};
  APC_GRID.forEach((cells, row) => cells.forEach((t, col) => (m[`${cls}|note:1:${apcNote(row, col)}`] = t)));
  APC_SCENES.forEach((t, i) => (m[`${cls}|note:1:${82 + i}`] = t));
  APC_TRACKS.forEach((t, i) => (m[`${cls}|note:1:${64 + i}`] = t));
  for (const [note, t] of Object.entries(APC_BUTTONS)) m[`${cls}|note:1:${note}`] = t;
  FX_MACROS.forEach((_, i) => (m[`${cls}|cc:1:${48 + i}`] = fx(i, relativeKnobs ? { relative: true } : {})));
  return m;
}

export const APC = {
  id: 'apc',
  name: 'APC Key 25',
  match: /apc ?key ?25/i,
  variant: apcVariant,
  // If the keys ever show up on their own port, keep them out of the button map.
  portClass: (name) => (/keys/i.test(name) && !/control/i.test(name) ? 'apckeys' : apcVariant(name) === 'mk2' ? 'apc2' : 'apc1'),
  fxHw: FX_MACROS.map((_, i) => `Knob ${i + 1}`),
  mappings: { ...apcMappings('apc1', false), ...apcMappings('apc2', true) },
  hasLights: true,
};

export const DEVICES = [APC, OXYGEN];
export const DEFAULT_MAPPINGS = Object.assign({}, ...DEVICES.map((d) => d.mappings));
export const deviceForPort = (name = '') => DEVICES.find((d) => d.match.test(name)) ?? null;
export const ANY_DEVICE = new RegExp(DEVICES.map((d) => d.match.source).join('|'), 'i');

// The Oxygen setup wizard walks through these, one touch each.
export const WIZARD_STEPS = [
  ...FX_MACROS.map((f, i) => ({ target: fx(i), prompt: `Move ${OXYGEN.fxHw[i]}`, detail: f.name })),
  ...Array.from({ length: 8 }, (_, i) => ({ target: pad(i), prompt: `Hit pad ${i + 1}`, detail: `Bank A · ${DRUM_VOICES[i].name}` })),
  ...Array.from({ length: 8 }, (_, i) => ({ target: pad(8 + i), prompt: `Pad Bank B → hit pad ${i + 1}`, detail: null })),
  { target: action('transport'), prompt: 'Press Play', detail: 'Play / Stop' },
  { target: action('stop'), prompt: 'Press Stop', detail: 'Stop' },
  { target: action('record'), prompt: 'Press Record', detail: 'Record next loop' },
  // The Oxygen's own Octave buttons transpose inside the keyboard and send no MIDI,
  // so Lumen can't follow them. Give Lumen's octave two buttons of its own instead.
  { target: action('octDown'), prompt: 'Press a button for Octave −', detail: 'e.g. a button under the faders (Skip to keep using the keyboard’s own)' },
  { target: action('octUp'), prompt: 'Press a button for Octave +', detail: 'e.g. the button next to it' },
];
