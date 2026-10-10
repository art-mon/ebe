import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadingSilence, crossfadeLoop, fadeOut, nearestZone, rms } from '../public/js/sampler.js';

test('leading silence is found on any channel', () => {
  const l = new Float32Array([0, 0.001, 0, 0, 0.5, 0.2]);
  const r = new Float32Array([0, 0, 0, 0.4, 0, 0]);
  assert.equal(leadingSilence([l]), 4);
  assert.equal(leadingSilence([l, r]), 3);
  assert.equal(leadingSilence([new Float32Array(5)]), 5);
});

test('a crossfaded loop wraps around without a jump', () => {
  // A ramp: without the crossfade, jumping from end back to start would be a big step.
  const d = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
  const start = 200;
  const end = 900;
  crossfadeLoop([d], start, end, 100);
  const jump = Math.abs(d[start] - d[end - 1]);
  assert.ok(jump < 0.01, `loop seam step ${jump}`);
  assert.equal(d[100], Math.fround(0.1)); // before the fade region: untouched
  assert.equal(d[end - 101], Math.fround((end - 101) / 1000));
});

test('fades end in silence; nearest recorded pitch wins', () => {
  const d = new Float32Array(10).fill(1);
  fadeOut([d], 4);
  assert.equal(d[9], 0);
  assert.equal(d[5], 1);
  const zones = [{ note: 48 }, { note: 51 }, { note: 54 }];
  assert.equal(nearestZone(zones, 50).note, 51);
  assert.equal(nearestZone(zones, 20).note, 48);
  assert.equal(nearestZone(zones, 90).note, 54);
  assert.ok(Math.abs(rms([new Float32Array([1, -1, 1, -1])]) - 1) < 1e-9);
});
