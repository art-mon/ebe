// Sound styles for the built-in synth — five per instrument. Each style is plain
// data that synth.js turns into Web Audio nodes:
//
//   osc      [{ type, ratio = 1, detune = 0 (cents), gain = 1 }]   oscillators, ratio × note frequency
//   fm       { ratio, index, decay, floor }    a sine modulator on every oscillator's frequency;
//                                             index × note freq at the attack, sliding to floor ×
//   noise    { gain, type, freq, q, decay }    a noise layer (hammer, breath); decay null = sustained
//   filter   { type, freq, q, env, decay, keytrack }
//            env = Hz added at note-on that glides back to freq over `decay` s (negative = opens up)
//   formants [Hz, Hz, Hz]                     parallel band-passes ("ah" vowel) instead of `filter`
//   amp      { a, d, s, r, peak }             envelope; peak is scaled by velocity
//   vibrato  { rate, depth (cents), delay }   pitch wobble that fades in
//   wobble   { beats, depth (Hz) }            filter LFO locked to the tempo

export const STYLES = {
  keys: [
    {
      id: 'epiano', name: 'E-Piano',
      osc: [{ type: 'sine' }, { type: 'sine', ratio: 4, gain: 0.05 }],
      fm: { ratio: 1, index: 2.6, decay: 1.2, floor: 0.3 },
      amp: { a: 0.004, d: 2.2, s: 0.12, r: 0.45, peak: 0.5 },
    },
    {
      id: 'felt', name: 'Felt Piano',
      osc: [{ type: 'triangle', gain: 0.6 }, { type: 'sine', ratio: 2, gain: 0.25 }, { type: 'sine', ratio: 3, detune: 3, gain: 0.08 }],
      filter: { type: 'lowpass', freq: 1500, q: 0.5, env: 2200, decay: 0.35, keytrack: 0.5 },
      noise: { gain: 0.05, type: 'bandpass', freq: 2400, q: 1, decay: 0.03 },
      amp: { a: 0.003, d: 1.7, s: 0, r: 0.35, peak: 0.5 },
    },
    {
      id: 'organ', name: 'Organ',
      osc: [0.5, 1, 2, 3, 4].map((ratio, i) => ({ type: 'sine', ratio, gain: [0.3, 0.5, 0.35, 0.15, 0.12][i] })),
      filter: { type: 'lowpass', freq: 5000 },
      vibrato: { rate: 6.2, depth: 12, delay: 0 },
      amp: { a: 0.01, d: 0.1, s: 1, r: 0.08, peak: 0.2 },
    },
    {
      id: 'glass', name: 'Glass Bells',
      osc: [{ type: 'sine' }],
      fm: { ratio: 3.5, index: 5, decay: 1.5, floor: 0.1 },
      amp: { a: 0.002, d: 2.8, s: 0, r: 1.2, peak: 0.35 },
    },
    {
      id: 'clav', name: 'Clav',
      osc: [{ type: 'square', gain: 0.5 }, { type: 'sawtooth', detune: 5, gain: 0.4 }],
      filter: { type: 'lowpass', freq: 1200, q: 4, env: 4000, decay: 0.15 },
      amp: { a: 0.002, d: 0.4, s: 0.1, r: 0.1, peak: 0.32 },
    },
  ],
  pad: [
    {
      id: 'warm', name: 'Warm Pad',
      osc: [...[-11, -3, 4, 12].map((detune) => ({ type: 'sawtooth', detune })), { type: 'sine', ratio: 0.5, gain: 0.5 }],
      filter: { type: 'lowpass', freq: 1900, q: 0.7, env: -1400, decay: 1.8 },
      amp: { a: 0.45, d: 1.5, s: 0.8, r: 1.6, peak: 0.13 },
    },
    {
      id: 'strings', name: 'Strings',
      osc: [-7, 0, 7].map((detune) => ({ type: 'sawtooth', detune, gain: 0.5 })),
      filter: { type: 'lowpass', freq: 2200, q: 0.6, env: -1200, decay: 1.2 },
      vibrato: { rate: 5.2, depth: 8, delay: 0.4 },
      amp: { a: 0.35, d: 0.8, s: 0.85, r: 0.9, peak: 0.15 },
    },
    {
      id: 'choir', name: 'Choir',
      osc: [{ type: 'sawtooth', detune: -6 }, { type: 'sawtooth', detune: 6 }],
      formants: [700, 1220, 2600],
      noise: { gain: 0.015, type: 'bandpass', freq: 3000, q: 1, decay: null },
      vibrato: { rate: 4.8, depth: 10, delay: 0.3 },
      amp: { a: 0.4, d: 1, s: 0.9, r: 1.2, peak: 0.45 },
    },
    {
      id: 'shimmer', name: 'Shimmer',
      osc: [{ type: 'sine', gain: 0.5 }, { type: 'sine', ratio: 2, detune: 4, gain: 0.3 }, { type: 'sine', ratio: 4, detune: -4, gain: 0.15 }, { type: 'triangle', ratio: 3, gain: 0.1 }],
      vibrato: { rate: 0.3, depth: 6, delay: 0 },
      amp: { a: 1.2, d: 2, s: 0.8, r: 2.5, peak: 0.18 },
    },
    {
      id: 'drone', name: 'Dark Drone',
      osc: [{ type: 'square', detune: -9, gain: 0.5 }, { type: 'square', detune: 9, gain: 0.5 }, { type: 'sine', ratio: 0.5, gain: 0.6 }],
      filter: { type: 'lowpass', freq: 600, q: 3 },
      wobble: { beats: 8, depth: 250 },
      amp: { a: 1, d: 2, s: 0.9, r: 2, peak: 0.13 },
    },
  ],
  bass: [
    {
      id: 'sub', name: 'Sub',
      osc: [{ type: 'sine' }, { type: 'square', detune: 3, gain: 0.28 }],
      filter: { type: 'lowpass', freq: 380, q: 6, env: 2600, decay: 0.36 },
      amp: { a: 0.004, d: 0.35, s: 0.7, r: 0.12, peak: 0.55 },
    },
    {
      id: 'acid', name: 'Acid',
      osc: [{ type: 'sawtooth' }],
      filter: { type: 'lowpass', freq: 300, q: 14, env: 3500, decay: 0.25 },
      amp: { a: 0.003, d: 0.3, s: 0.6, r: 0.08, peak: 0.4 },
    },
    {
      id: 'reese', name: 'Reese',
      osc: [{ type: 'sawtooth', detune: -14, gain: 0.5 }, { type: 'sawtooth', detune: 14, gain: 0.5 }, { type: 'sine', gain: 0.4 }],
      filter: { type: 'lowpass', freq: 900, q: 2 },
      wobble: { beats: 4, depth: 300 },
      amp: { a: 0.01, d: 0.4, s: 0.85, r: 0.15, peak: 0.35 },
    },
    {
      id: 'pluck', name: 'Pluck',
      osc: [{ type: 'triangle' }, { type: 'square', ratio: 2, gain: 0.15 }],
      filter: { type: 'lowpass', freq: 500, q: 3, env: 3000, decay: 0.12 },
      amp: { a: 0.002, d: 0.25, s: 0, r: 0.1, peak: 0.6 },
    },
    {
      id: 'wobble', name: 'Wobble',
      osc: [{ type: 'sawtooth' }, { type: 'square', detune: -5, gain: 0.5 }],
      filter: { type: 'lowpass', freq: 400, q: 8 },
      wobble: { beats: 0.5, depth: 1600 },
      amp: { a: 0.005, d: 0.3, s: 0.9, r: 0.12, peak: 0.4 },
    },
  ],
  lead: [
    {
      id: 'saw', name: 'Saw Lead',
      osc: [{ type: 'sawtooth', detune: -6 }, { type: 'square', detune: 6, gain: 0.45 }],
      filter: { type: 'lowpass', freq: 2400, q: 3, env: 3500, decay: 0.5 },
      amp: { a: 0.008, d: 0.25, s: 0.65, r: 0.25, peak: 0.22 },
    },
    {
      id: 'square', name: 'Square Lead',
      osc: [{ type: 'square', detune: -4, gain: 0.5 }, { type: 'square', detune: 4, gain: 0.5 }],
      filter: { type: 'lowpass', freq: 3000, q: 1 },
      vibrato: { rate: 5.5, depth: 15, delay: 0.25 },
      amp: { a: 0.01, d: 0.2, s: 0.7, r: 0.2, peak: 0.2 },
    },
    {
      id: 'super', name: 'Supersaw',
      osc: [-18, -9, -3, 3, 9, 18].map((detune) => ({ type: 'sawtooth', detune, gain: 0.3 })),
      filter: { type: 'lowpass', freq: 5000, q: 0.5, env: 2000, decay: 0.4 },
      amp: { a: 0.02, d: 0.3, s: 0.8, r: 0.35, peak: 0.13 },
    },
    {
      id: 'flute', name: 'Soft Flute',
      osc: [{ type: 'sine' }, { type: 'triangle', ratio: 2, gain: 0.08 }],
      noise: { gain: 0.05, type: 'bandpass', freq: 2000, q: 0.8, decay: null },
      vibrato: { rate: 5, depth: 12, delay: 0.35 },
      amp: { a: 0.08, d: 0.3, s: 0.85, r: 0.2, peak: 0.26 },
    },
    {
      id: 'chip', name: 'Chiptune',
      osc: [{ type: 'square' }, { type: 'square', ratio: 2, gain: 0.15 }],
      vibrato: { rate: 7, depth: 25, delay: 0.2 },
      amp: { a: 0.002, d: 0.05, s: 0.8, r: 0.05, peak: 0.13 },
    },
  ],
};

export const DEFAULT_STYLES = Object.fromEntries(Object.entries(STYLES).map(([inst, list]) => [inst, list[0].id]));

/** The style object for an instrument id + style id (falls back to the first). */
export function styleFor(instId, styleId) {
  const list = STYLES[instId] ?? [];
  return list.find((s) => s.id === styleId) ?? list[0];
}
