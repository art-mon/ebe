import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Looper } from '../public/js/looper.js';
import { Bus } from '../public/js/state.js';

// A clock we can move by hand.
function fakeClock() {
  return {
    running: true, beat: 0, ticks: [], ctx: { currentTime: 0 },
    onTick(fn) { this.ticks.push(fn); },
    start() { this.running = true; },
    timeAt(b) { return b; },
  };
}

test('each loop records for its own length (the old global-length bug)', () => {
  const clock = fakeClock();
  const looper = new Looper({ clock, engine: { playNote: () => ({ cancel() {} }) }, bus: new Bus() });
  assert.equal(looper.loops.length, 8);
  assert.ok(looper.setLoopBars(0, 1));
  assert.ok(looper.setLoopBars(1, 8));
  looper.record(0);
  looper.record(1);
  const len = (i) => looper.loops[i].rec.end - looper.loops[i].rec.start;
  assert.equal(len(0), 4); // 1 bar
  assert.equal(len(1), 32); // 8 bars
});

test('a loop length can change only while the loop is empty', () => {
  const clock = fakeClock();
  const looper = new Looper({ clock, engine: { playNote: () => ({ cancel() {} }) }, bus: new Bus() });
  looper.record(2);
  assert.equal(looper.setLoopBars(2, 4), false); // armed/recording
  looper.cancel(2);
  assert.equal(looper.setLoopBars(2, 4), true);
  assert.equal(looper.cycleLoopBars(2), 8);
  assert.equal(looper.cycleLoopBars(2), 1);
  assert.equal(looper.setLoopBars(2, 3), false); // not an option
});

test('progress rings use each loop’s own length', () => {
  const clock = fakeClock();
  const looper = new Looper({ clock, engine: { playNote: () => ({ cancel() {} }) }, bus: new Bus() });
  looper.setLoopBars(0, 1);
  looper.setLoopBars(1, 2);
  clock.beat = 6;
  assert.equal(looper.phase(0), 0.5); // 6 mod 4 / 4
  assert.equal(looper.phase(1), 0.75); // 6 mod 8 / 8
});
