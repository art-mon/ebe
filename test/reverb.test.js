import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reverbDivision, PREDELAY_BEATS } from '../public/js/config.js';

test('Space picks a note length for the reverb tail', () => {
  assert.equal(reverbDivision(0).label, '1/8');
  assert.equal(reverbDivision(0.5).label, '1 bar');
  assert.equal(reverbDivision(1).label, '4 bars');
  assert.equal(reverbDivision(-1).label, '1/8'); // clamped
});

test('tail and pre-delay scale with tempo', () => {
  const ms = (beats, bpm) => (beats * 60000) / bpm;
  assert.equal(ms(reverbDivision(0.5).beats, 100), 2400); // 1 bar at 100 BPM
  assert.equal(ms(reverbDivision(0.5).beats, 120), 2000); // 1 bar at 120 BPM
  assert.equal(ms(PREDELAY_BEATS, 100), 37.5); // 1/64 note at 100 BPM
});
