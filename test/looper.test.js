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

test('a loop keeps the sound it was recorded with', () => {
  const clock = fakeClock();
  const played = [];
  const preloaded = [];
  const engine = {
    playNote: (inst, note, vel, start, end, style) => (played.push({ inst, note, style }), { cancel() {} }),
    preloadStyle: (inst, style) => preloaded.push(`${inst}:${style}`),
  };
  const looper = new Looper({ clock, engine, bus: new Bus() });
  looper.setLoopBars(0, 1);
  looper.record(0);
  clock.beat = 0.5;
  looper.input({ inst: 0, note: 60, vel: 0.8, on: true, style: 'glass' });
  clock.beat = 1;
  looper.input({ inst: 0, note: 60, vel: 0, on: false });
  clock.beat = 1.5;
  looper.input({ inst: 0, note: 64, vel: 0.8, on: true, style: 'grand' }); // switched sound mid-loop
  clock.beat = 2;
  looper.input({ inst: 0, note: 64, vel: 0, on: false });
  assert.deepEqual(looper.loops[0].events.map((e) => e.style), ['glass', 'grand']);
  clock.beat = 4;
  clock.ticks[0](4, 8); // second pass: plays back
  assert.deepEqual(played.map((p) => `${p.note}:${p.style}`), ['60:glass', '64:grand']);
  // A loaded loop gets its sounds ready before it plays.
  looper.load(1, { bars: 2, events: [{ pos: 0, dur: 1, inst: 1, note: 60, vel: 0.7, style: 'ensemble' }, { pos: 1, dur: 0.1, inst: 4, note: 36, vel: 1, style: 'triphop' }] });
  assert.deepEqual(preloaded.sort(), ['1:ensemble', '4:triphop']);
});

test('the moment a waiting loop starts recording is announced (the card left "get ready")', () => {
  const clock = fakeClock();
  const bus = new Bus();
  const looper = new Looper({ clock, engine: { playNote: () => ({ cancel() {} }) }, bus });
  looper.setLoopBars(1, 4);
  clock.beat = 1.5; // mid-bar while other loops play: recording waits for the next bar
  looper.record(1);
  assert.equal(looper.status(1), 'armed');
  let changes = 0;
  bus.on('looper', () => changes++);
  clock.beat = 3.9;
  clock.ticks[0](3.9, 4);
  assert.equal(changes, 0); // still waiting
  clock.beat = 4.02;
  clock.ticks[0](4.02, 4.1);
  assert.equal(looper.status(1), 'recording');
  assert.equal(changes, 1);
  clock.ticks[0](4.1, 4.2);
  assert.equal(changes, 1); // only once
});
