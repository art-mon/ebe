// Turns the key you pressed into the note(s) that should sound:
// octave shift → scale lock (snap / easy white-keys) → chord.
import { SCALES } from './config.js';

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const mod = (n, m) => ((n % m) + m) % m;

/** MIDI note for an absolute scale-degree index (degree 0 = root in octave -1). */
export function scaleNoteAt(root, steps, index) {
  const n = steps.length;
  return root + steps[mod(index, n)] + 12 * Math.floor(index / n);
}

/** Absolute degree index of `note` if it's in the scale, else -1. */
export function degreeOf(root, steps, note) {
  const rel = note - root;
  const deg = steps.indexOf(mod(rel, 12));
  return deg < 0 ? -1 : Math.floor(rel / 12) * steps.length + deg;
}

/** Nearest in-scale note (ties go up, which tends to sound brighter). */
export function snap(root, steps, note) {
  for (let d = 0; d < 12; d++) {
    if (steps.includes(mod(note + d - root, 12))) return note + d;
    if (steps.includes(mod(note - d - root, 12))) return note - d;
  }
  return note;
}

/** Easy mode: every white key is the next scale degree; middle C = root. */
function whiteKeyNote(root, steps, note) {
  let pc = mod(note, 12);
  let n = note;
  if (!WHITE_PCS.includes(pc)) {
    n -= 1; // black keys double the white key below
    pc = mod(n, 12);
  }
  const white = Math.floor(n / 12) * 7 + WHITE_PCS.indexOf(pc);
  const MIDDLE_C_WHITE = 35; // white-key index of MIDI 60
  return scaleNoteAt(root, steps, white - MIDDLE_C_WHITE + 5 * steps.length);
}

/** Is this physical key "in key" for the current settings? (for the on-screen keyboard) */
export function isKeyInScale(note, s) {
  const steps = SCALES[s.scale]?.steps ?? SCALES.chromatic.steps;
  if (s.keyMode === 'white') return WHITE_PCS.includes(mod(note, 12));
  return steps.includes(mod(note - s.root, 12));
}

/**
 * @param {number} note incoming key
 * @param {{octave:number, root:number, scale:string, keyMode:string, chord:string}} s
 * @returns {number[]} notes to play (deduped, clamped to 0..127)
 */
export function transform(note, s) {
  const steps = SCALES[s.scale]?.steps ?? SCALES.chromatic.steps;
  const root = s.root;
  let n = note;

  if (s.keyMode === 'white') n = whiteKeyNote(root, steps, n);
  else if (s.keyMode === 'snap') n = snap(root, steps, n);
  n += 12 * s.octave;

  let notes = [n];
  const diatonic = s.keyMode !== 'off' && steps.length < 12;
  const deg = diatonic ? degreeOf(root, steps, n) : -1;

  switch (s.chord) {
    case 'triad':
      notes = deg >= 0 ? [0, 2, 4].map((k) => scaleNoteAt(root, steps, deg + k)) : [n, n + 4, n + 7];
      break;
    case 'seventh':
      notes = deg >= 0 ? [0, 2, 4, 6].map((k) => scaleNoteAt(root, steps, deg + k)) : [n, n + 4, n + 7, n + 10];
      break;
    case 'power':
      notes = [n, n + 7, n + 12];
      break;
    case 'octave':
      notes = [n, n + 12];
      break;
    default:
      break;
  }
  return [...new Set(notes)].filter((x) => x >= 0 && x <= 127);
}

const CHORD_NAMES = { 0: '', 3: 'm', 4: '', 6: '°' };
/** Short human name for a set of notes, e.g. "Dm", "F". Best effort. */
export function chordName(notes, noteNames) {
  if (!notes.length) return '';
  const sorted = [...notes].sort((a, b) => a - b);
  const rootName = noteNames[mod(sorted[0], 12)];
  if (sorted.length < 3) return rootName;
  const third = mod(sorted[1] - sorted[0], 12);
  const fifth = mod(sorted[2] - sorted[0], 12);
  let q = CHORD_NAMES[third] ?? '';
  if (third === 3 && fifth === 6) q = '°';
  if (third === 7) q = '5';
  const seventh = sorted[3] !== undefined ? mod(sorted[3] - sorted[0], 12) : null;
  if (seventh === 11) q += 'maj7';
  else if (seventh === 10) q += '7';
  return rootName + q;
}
