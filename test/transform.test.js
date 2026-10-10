import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform, snap, chordName } from '../public/js/transform.js';
import { SCALES, NOTE_NAMES } from '../public/js/config.js';

const dMinor = { root: 2, scale: 'minor', octave: 0, keyMode: 'snap', chord: 'off' };

test('snap mode moves out-of-key notes to the nearest scale note (ties go up)', () => {
  assert.equal(snap(2, SCALES.minor.steps, 61), 62); // C# → D
  assert.deepEqual(transform(63, dMinor), [64]); // D# → E
  assert.deepEqual(transform(60, dMinor), [60]); // C is in D minor
});

test('easy mode maps white keys onto the scale, middle C = root', () => {
  const easy = { ...dMinor, keyMode: 'white' };
  assert.deepEqual(transform(60, easy), [62]); // C4 → D4
  assert.deepEqual(transform(62, easy), [64]); // D4 → E4
  assert.deepEqual(transform(64, easy), [65]); // E4 → F4
  assert.deepEqual(transform(61, easy), [62]); // black key doubles the white key below
  assert.deepEqual(transform(72, easy), [74]); // an octave up stays an octave up for 7-note scales
});

test('triads are built from the scale', () => {
  const triads = { ...dMinor, chord: 'triad' };
  assert.deepEqual(transform(62, triads), [62, 65, 69]); // Dm
  assert.deepEqual(transform(65, triads), [65, 69, 72]); // F
  assert.deepEqual(transform(60, { ...triads, keyMode: 'off' }), [60, 64, 67]); // free play → major
});

test('octave shift applies after scale mapping', () => {
  assert.deepEqual(transform(61, { ...dMinor, octave: 1 }), [74]);
  assert.deepEqual(transform(60, { ...dMinor, octave: -6 }), []); // below MIDI range is dropped
});

test('chord names', () => {
  assert.equal(chordName([62, 65, 69], NOTE_NAMES), 'Dm');
  assert.equal(chordName([65, 69, 72], NOTE_NAMES), 'F');
  assert.equal(chordName([62, 65, 69, 72], NOTE_NAMES), 'Dm7');
  assert.equal(chordName([64, 67, 70], NOTE_NAMES), 'E°');
});
