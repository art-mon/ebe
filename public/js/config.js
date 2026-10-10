// Everything you'd want to tweak lives here: instruments, vibes, FX macros,
// scales and the default controller layout.

// ── Instruments ─────────────────────────────────────────────────────────────
// Each instrument is one Ableton track. Lumen sends its notes to the IAC
// Driver on `channel`; the matching Ableton track listens to that channel.
// `patch` is the built-in synth used when the sound engine is "Built-in".
export const INSTRUMENTS = [
  { id: 'keys', name: 'Keys', channel: 1, color: '#ffb547', patch: 'keys' },
  { id: 'pad', name: 'Pad', channel: 2, color: '#9d8cff', patch: 'pad' },
  { id: 'bass', name: 'Bass', channel: 3, color: '#ff4f81', patch: 'bass' },
  { id: 'lead', name: 'Lead', channel: 4, color: '#3fe0c5', patch: 'lead' },
  { id: 'drums', name: 'Drums', channel: 10, color: '#e8ecf5', patch: 'drums', isDrums: true },
];
export const DRUMS_INDEX = INSTRUMENTS.findIndex((i) => i.isDrums);
export const MELODIC = INSTRUMENTS.map((_, i) => i).filter((i) => i !== DRUMS_INDEX);

// Drum voices, in pad order. `note` follows the General MIDI / Ableton Drum
// Rack layout (C1 = 36), so any Drum Rack kit maps sensibly.
export const DRUM_VOICES = [
  { id: 'kick', name: 'Kick', note: 36 },
  { id: 'snare', name: 'Snare', note: 38 },
  { id: 'clap', name: 'Clap', note: 39 },
  { id: 'hat', name: 'Hat', note: 42 },
  { id: 'openhat', name: 'Open Hat', note: 46 },
  { id: 'tom', name: 'Tom', note: 45 },
  { id: 'rim', name: 'Rim', note: 37 },
  { id: 'crash', name: 'Crash', note: 49 },
];

// ── FX macros ───────────────────────────────────────────────────────────────
// Eight global performance effects — the Oxygen Pro Mini's 4 knobs (tone) +
// 4 faders (space), or the APC Key 25's 8 knobs. In Built-in mode they drive Lumen's own FX chain; in
// Ableton mode each one is sent as CC (FX_CC_BASE + index) on FX_CHANNEL,
// which you MIDI-map once in Live (Settings → Ableton has a helper).
export const FX_CHANNEL = 16;
export const FX_CC_BASE = 20;
export const FX_MACROS = [
  { id: 'filter', name: 'Filter', def: 1, hint: 'Auto Filter → Frequency' },
  { id: 'reso', name: 'Reso', def: 0.15, hint: 'Auto Filter → Resonance' },
  { id: 'drive', name: 'Drive', def: 0, hint: 'Saturator → Drive' },
  { id: 'crush', name: 'Crush', def: 0, hint: 'Redux → Downsample' },
  { id: 'echo', name: 'Echo', def: 0.15, hint: 'Delay → Dry/Wet' },
  { id: 'repeats', name: 'Repeats', def: 0.35, hint: 'Delay → Feedback' },
  { id: 'reverb', name: 'Reverb', def: 0.25, hint: 'Reverb → Dry/Wet' },
  { id: 'space', name: 'Space', def: 0.5, hint: 'Reverb → Decay Time (tempo-synced via AbletonOSC)' },
];

// The reverb follows the tempo: Space picks how long the tail lasts, as a note
// length, so it dies away on the beat instead of smearing across it.
export const REVERB_DIVISIONS = [
  { beats: 0.5, label: '1/8' },
  { beats: 1, label: '1/4' },
  { beats: 2, label: '1/2' },
  { beats: 4, label: '1 bar' },
  { beats: 8, label: '2 bars' },
  { beats: 16, label: '4 bars' },
];
export const PREDELAY_BEATS = 1 / 16; // a 1/64 note: keeps the dry hit clear of the tail

export function reverbDivision(space01) {
  const i = Math.round(Math.max(0, Math.min(1, space01)) * (REVERB_DIVISIONS.length - 1));
  return REVERB_DIVISIONS[i];
}

// ── Vibes ───────────────────────────────────────────────────────────────────
// One tap = instrument (+ optional layer) + all eight FX + colours + visuals.
// fx order: filter, reso, drive, crush, echo, repeats, reverb, space
export const VIBES = [
  {
    id: 'dreamy', name: 'Dreamy', instrument: 'pad', layer: 'keys',
    fx: [0.72, 0.1, 0, 0, 0.35, 0.45, 0.7, 0.85],
    palette: ['#8ec5ff', '#b18cff', '#ff9ad5'], bg: '#0b0a1f', visual: 'nebula',
  },
  {
    id: 'lofi', name: 'Lo-Fi', instrument: 'keys',
    fx: [0.42, 0.22, 0.25, 0.4, 0.22, 0.3, 0.35, 0.4],
    palette: ['#ffcf8b', '#ff8f6b', '#6bd6c4'], bg: '#140d0a', visual: 'rings',
  },
  {
    id: 'club', name: 'Club', instrument: 'bass',
    fx: [0.85, 0.45, 0.45, 0, 0.1, 0.2, 0.12, 0.3],
    palette: ['#ff2fd0', '#2ff3ff', '#fff36b'], bg: '#07020f', visual: 'horizon',
  },
  {
    id: 'cosmic', name: 'Cosmic', instrument: 'lead',
    fx: [0.9, 0.3, 0.12, 0, 0.5, 0.65, 0.55, 0.92],
    palette: ['#4f6bff', '#b04fff', '#ffd36b'], bg: '#03041a', visual: 'nebula',
  },
  {
    id: 'sunset', name: 'Sunset', instrument: 'keys', layer: 'pad',
    fx: [0.65, 0.18, 0.1, 0, 0.3, 0.4, 0.5, 0.6],
    palette: ['#ff9a3c', '#ff4f8b', '#8a4fff'], bg: '#160716', visual: 'horizon',
  },
  {
    id: 'glitch', name: 'Glitch', instrument: 'lead',
    fx: [0.75, 0.5, 0.35, 0.72, 0.3, 0.55, 0.15, 0.25],
    palette: ['#7dff6b', '#e8ff3c', '#3cffd2'], bg: '#020a04', visual: 'rings',
  },
  {
    id: 'deep', name: 'Deep Sea', instrument: 'pad', layer: 'bass',
    fx: [0.3, 0.5, 0.05, 0, 0.25, 0.5, 0.8, 0.95],
    palette: ['#1fd1c1', '#2b7bff', '#a6fff2'], bg: '#020d14', visual: 'nebula',
  },
  {
    id: 'raw', name: 'Raw', instrument: 'bass',
    fx: [1, 0.1, 0.2, 0, 0, 0.2, 0.05, 0.2],
    palette: ['#ffffff', '#ff3b3b', '#ffb4b4'], bg: '#0d0607', visual: 'rings',
  },
];

// ── Scales & chords ─────────────────────────────────────────────────────────
export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const SCALES = {
  chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  majorPent: { name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9] },
  minorPent: { name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  harmonicMinor: { name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
};

export const KEY_MODES = {
  off: 'Free play',
  snap: 'Snap to scale',
  white: 'Easy (white keys)',
};

export const CHORD_MODES = {
  off: 'Single notes',
  triad: 'Triads',
  seventh: '7th chords',
  power: 'Power',
  octave: 'Octaves',
};

// ── Controllers ─────────────────────────────────────────────────────────────
// Device profiles (Oxygen Pro Mini, APC Key 25) and their default mappings
// live in devices.js. These are the shared bits.
export const CONTROLLER = {
  outputMatch: /iac/i, // MIDI out to Ableton
  padChannel: 10, // Oxygen Preset mode: notes on this channel are pads…
  padBase: 36, // …and pad index = note - padBase (0-15)
};

// Pads 0-7 = bank A (drums), 8-15 = bank B (controls). Pad 1 is bottom-left.
export const CONTROL_PADS = [
  { action: 'loop', arg: 0, label: 'Loop 1' },
  { action: 'loop', arg: 1, label: 'Loop 2' },
  { action: 'loop', arg: 2, label: 'Loop 3' },
  { action: 'loop', arg: 3, label: 'Loop 4' },
  { action: 'vibePrev', label: '◀ Vibe' },
  { action: 'vibeNext', label: 'Vibe ▶' },
  { action: 'instNext', label: 'Instrument' },
  { action: 'stopLoops', label: 'Stop loops' },
];

// Actions any button/pad on the controller can be MIDI-learned to.
export const ACTIONS = {
  shift: 'Shift (hold)',
  transport: 'Play / Stop',
  stop: 'Stop',
  record: 'Record next loop',
  stopLoops: 'Stop all loops',
  vibePrev: 'Previous vibe',
  vibeNext: 'Next vibe',
  instPrev: 'Previous instrument',
  instNext: 'Next instrument',
  octDown: 'Octave down',
  octUp: 'Octave up',
  metronome: 'Metronome on/off',
  stage: 'Stage mode',
  randomVibe: 'Random vibe',
  layer: 'Layer on/off',
  quantize: 'Snap loops on/off',
  loopBars: 'Cycle loop length',
  tap: 'Tap tempo',
  nextScale: 'Next scale (Shift: next key)',
  panic: 'All notes off',
};

export const LOOP_COUNT = 4;
export const LOOP_BAR_OPTIONS = [1, 2, 4, 8];
