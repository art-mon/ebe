// Sound styles for the built-in sound: five real (sampled) instruments plus five
// synth patches per instrument, and a few drum kits. Synth styles are plain data
// that synth.js turns into Web Audio nodes:
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
//
// Sampled styles (real recordings, see sampler.js) list first in each menu:
//
//   sample   set id in public/samples/index.json
//   amp      { a, r }      attack and release in seconds
//   gain     level trim, measured so each sits with its instrument's synth sounds
//   maxSec   how much of each recording to keep
//   loop     [startSec, endSec] for sustained sounds (held notes keep going)
//   tone     soft notes sound darker, like the real instrument
//   fallback the synth style that plays until the samples have loaded

import { DRUM_VOICES } from './config.js';

const real = (id, name, sample, opts) => ({ id, name, sample, amp: { a: 0.003, r: 0.3 }, maxSec: 4, gain: 1, ...opts });
const LOOP = [0.8, 3.0]; // sustain loop inside the 3-second General MIDI recordings

export const STYLES = {
  keys: [
    real('grand', 'Grand Piano', 'piano', { amp: { a: 0.002, r: 0.6 }, maxSec: 6, tone: true, gain: 1.8, fallback: 'felt' }),
    real('rhodes', 'E-Piano', 'epiano', { amp: { a: 0.003, r: 0.4 }, tone: true, gain: 1.15, fallback: 'epiano' }),
    real('vibes', 'Vibraphone', 'vibraphone', { amp: { a: 0.002, r: 0.9 }, maxSec: 5, gain: 1.7, fallback: 'glass' }),
    real('clavinet', 'Clavinet', 'clavinet', { amp: { a: 0.002, r: 0.12 }, tone: true, gain: 1.2, fallback: 'clav' }),
    real('drawbar', 'Organ', 'organ', { amp: { a: 0.01, r: 0.1 }, loop: LOOP, gain: 0.95, fallback: 'organ' }),
    {
      id: 'epiano', name: 'FM Piano',
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
      id: 'organ', name: 'Synth Organ',
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
      id: 'clav', name: 'Synth Clav',
      osc: [{ type: 'square', gain: 0.5 }, { type: 'sawtooth', detune: 5, gain: 0.4 }],
      filter: { type: 'lowpass', freq: 1200, q: 4, env: 4000, decay: 0.15 },
      amp: { a: 0.002, d: 0.4, s: 0.1, r: 0.1, peak: 0.32 },
    },
  ],
  pad: [
    real('ensemble', 'Strings', 'strings', { amp: { a: 0.15, r: 0.8 }, loop: LOOP, gain: 1.05, fallback: 'strings' }),
    real('voices', 'Choir', 'choir', { amp: { a: 0.2, r: 0.9 }, loop: LOOP, gain: 0.95, fallback: 'choir' }),
    real('warmpad', 'Warm Pad', 'warmpad', { amp: { a: 0.25, r: 1.2 }, loop: LOOP, gain: 0.65, fallback: 'warm' }),
    real('harp', 'Harp', 'harp', { amp: { a: 0.002, r: 1 }, gain: 1.1, fallback: 'warm' }),
    real('pizz', 'Pizzicato', 'pizzicato', { amp: { a: 0.002, r: 0.25 }, gain: 1.15, fallback: 'strings' }),
    {
      id: 'warm', name: 'Synth Pad',
      osc: [...[-11, -3, 4, 12].map((detune) => ({ type: 'sawtooth', detune })), { type: 'sine', ratio: 0.5, gain: 0.5 }],
      filter: { type: 'lowpass', freq: 1900, q: 0.7, env: -1400, decay: 1.8 },
      amp: { a: 0.45, d: 1.5, s: 0.8, r: 1.6, peak: 0.13 },
    },
    {
      id: 'strings', name: 'Synth Strings',
      osc: [-7, 0, 7].map((detune) => ({ type: 'sawtooth', detune, gain: 0.5 })),
      filter: { type: 'lowpass', freq: 2200, q: 0.6, env: -1200, decay: 1.2 },
      vibrato: { rate: 5.2, depth: 8, delay: 0.4 },
      amp: { a: 0.35, d: 0.8, s: 0.85, r: 0.9, peak: 0.15 },
    },
    {
      id: 'choir', name: 'Synth Choir',
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
    real('finger', 'Finger Bass', 'bass-finger', { amp: { a: 0.003, r: 0.15 }, tone: true, gain: 1.95, fallback: 'pluck' }),
    real('upright', 'Upright Bass', 'bass-upright', { amp: { a: 0.003, r: 0.2 }, maxSec: 3, gain: 1.95, fallback: 'pluck' }),
    real('fretless', 'Fretless', 'bass-fretless', { amp: { a: 0.005, r: 0.2 }, gain: 1.45, fallback: 'sub' }),
    real('synthbass', 'Synth Bass', 'bass-synth', { amp: { a: 0.003, r: 0.1 }, gain: 1.7, fallback: 'acid' }),
    real('picked', 'Picked Bass', 'bass-picked', { amp: { a: 0.002, r: 0.15 }, tone: true, gain: 1.35, fallback: 'pluck' }),
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
      id: 'pluck', name: 'Synth Pluck',
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
    real('sax', 'Sax', 'sax', { amp: { a: 0.01, r: 0.2 }, maxSec: 5, gain: 1.05, fallback: 'square' }),
    real('realflute', 'Flute', 'flute', { amp: { a: 0.02, r: 0.25 }, maxSec: 5, gain: 0.95, fallback: 'flute' }),
    real('violin', 'Violin', 'violin', { amp: { a: 0.04, r: 0.35 }, maxSec: 6, gain: 0.9, fallback: 'saw' }),
    real('eguitar', 'Electric Guitar', 'guitar-electric', { amp: { a: 0.002, r: 0.25 }, maxSec: 4.2, tone: true, gain: 1.1, fallback: 'saw' }),
    real('nylon', 'Nylon Guitar', 'guitar-nylon', { amp: { a: 0.002, r: 0.3 }, maxSec: 5, gain: 1.35, fallback: 'square' }),
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
      id: 'flute', name: 'Synth Flute',
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

// Drum kits, "real" or "electronic". For sampled kits:
//   levels  balance of the 8 drum voices (measured against the synth kit)
//   tune    semitones per voice — pitched down like a slowed-down record
//   tone    low-pass on the kit in Hz (dusty / warm), drive 0-1 (tape-style saturation)
//   labels  what a pad plays when it isn't the usual drum (a snap on the Clap pad…)
// The synth kit stays the default.
STYLES.drums = [
  { id: 'synth', name: 'Synth Kit', kind: 'electronic' },
  {
    id: 'triphop', name: 'Trip-Hop', kind: 'electronic', sample: 'kit-triphop', tone: 5200, drive: 0.35,
    tune: { kick: -3, snare: -2, clap: -1, hat: -2, openhat: -2, tom: -2, rim: -2 },
    labels: { clap: 'Snap', rim: 'Wood', crash: 'Scratch' },
    levels: { kick: 1.8, snare: 0.64, clap: 0.48, hat: 0.36, openhat: 0.58, tom: 0.79, rim: 0.24, crash: 0.51 },
  },
  {
    id: 'downtempo', name: 'Downtempo', kind: 'electronic', sample: 'kit-downtempo', tone: 9000, drive: 0.12,
    labels: { clap: 'Snap', tom: 'Tabla', crash: 'Bell' },
    levels: { kick: 0.65, snare: 0.77, clap: 0.4, hat: 0.38, openhat: 0.26, tom: 0.9, rim: 0.52, crash: 0.6 },
  },
  {
    id: 'garage', name: 'UK Garage', kind: 'electronic', sample: 'kit-garage',
    labels: { tom: 'Ping', rim: 'Pop' },
    levels: { kick: 0.76, snare: 0.58, clap: 0.41, hat: 0.25, openhat: 0.35, tom: 0.6, rim: 0.24, crash: 0.39 },
  },
  {
    id: 'deephouse', name: 'Deep House', kind: 'electronic', sample: 'kit-deephouse', tone: 12000, drive: 0.08,
    labels: { tom: 'Bong', rim: 'Knock', crash: 'Chime' },
    levels: { kick: 0.53, snare: 0.6, clap: 0.65, hat: 0.3, openhat: 0.32, tom: 0.65, rim: 0.29, crash: 0.41 },
  },
  { id: 'tr808', name: '808 Kit', kind: 'electronic', sample: 'kit-808', levels: { kick: 0.82, snare: 1.1, clap: 0.45, hat: 0.45, openhat: 0.36, tom: 1.06, rim: 0.48, crash: 0.6 } },
  { id: 'electro', name: 'Electro Kit', kind: 'electronic', sample: 'kit-electro', levels: { kick: 1.05, snare: 0.81, clap: 0.68, hat: 0.67, openhat: 0.34, tom: 0.42, rim: 0.4, crash: 0.5 } },
  { id: 'acoustic', name: 'Acoustic Kit', kind: 'real', sample: 'kit-acoustic', levels: { kick: 0.7, snare: 0.84, clap: 0.54, hat: 0.3, openhat: 0.27, tom: 0.6, rim: 0.56, crash: 0.58 } },
  {
    id: 'soft', name: 'Soft Acoustic', kind: 'real', sample: 'kit-soft', tone: 11000,
    levels: { kick: 1.2, snare: 0.65, clap: 0.4, hat: 0.21, openhat: 0.35, tom: 0.54, rim: 0.44, crash: 0.44 },
  },
];
export const DRUM_KINDS = { real: 'Real', electronic: 'Electronic' };

/** What drum pad `index` plays with this kit ("Snap", "Tabla"… or the usual name). */
export function drumName(kit, index) {
  const v = DRUM_VOICES[index];
  return kit?.labels?.[v.id] ?? v.name;
}

export const DEFAULT_STYLES = Object.fromEntries(Object.entries(STYLES).map(([inst, list]) => [inst, list[0].id]));

/** The style object for an instrument id + style id (falls back to the first). */
export function styleFor(instId, styleId) {
  const list = STYLES[instId] ?? [];
  return list.find((s) => s.id === styleId) ?? list[0];
}
