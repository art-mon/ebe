import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordAt } from '../public/js/editor.js';
import { Looper } from '../public/js/looper.js';
import { Bus } from '../public/js/state.js';

test('the editor\'s chord tool builds chords in the key', () => {
  const cMajor = { root: 0, scale: 'major', keyMode: 'snap', chord: 'off' };
  assert.deepEqual(chordAt(60, cMajor), [60, 64, 67]); // C: triad by default
  assert.deepEqual(chordAt(62, cMajor), [62, 65, 69]); // D minor, from the key
  assert.deepEqual(chordAt(62, { ...cMajor, chord: 'seventh' }), [62, 65, 69, 72]);
  assert.deepEqual(chordAt(61, { ...cMajor, keyMode: 'off' }), [61, 65, 68]); // free play: major triad on any note
});

test('notes written in the editor play from the next pass; clearing them stops the loop', () => {
  const clock = { running: true, beat: 0, ticks: [], ctx: { currentTime: 0 }, onTick(fn) { this.ticks.push(fn); }, start() {}, timeAt: (b) => b };
  const bus = new Bus();
  const played = [];
  const looper = new Looper({ clock, engine: { playNote: (i, n) => (played.push(n), { cancel() {} }) }, bus });
  let changes = 0;
  bus.on('looper', () => changes++);
  looper.setEvents(0, [{ pos: 0, dur: 4, inst: 1, note: 62, vel: 0.8, style: 'ensemble', recordedAt: 3 }]);
  assert.equal(looper.loops[0].events[0].recordedAt, -Infinity); // not mistaken for a note just played live
  assert.deepEqual([...looper.loops[0].insts], [1]);
  looper.play(0);
  clock.ticks[0](0, 0.2);
  assert.deepEqual(played, [62]);
  looper.loops[0].events.length = 0; // the editor deleted every note
  looper.touch(0);
  assert.equal(looper.loops[0].playing, false);
  assert.ok(changes >= 2);
});
