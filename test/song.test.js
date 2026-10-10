import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Looper } from '../public/js/looper.js';
import { Song } from '../public/js/song.js';
import { Bus, set, state } from '../public/js/state.js';

function rig() {
  const clock = {
    running: false, beat: 0, early: [], late: [], ctx: { currentTime: 0 },
    onTick(fn, early) { (early ? this.early : this.late).push(fn); },
    start() { this.running = true; },
    stop() { this.running = false; bus.emit('transport', { running: false }); },
    timeAt(b) { return b; },
    tick(from, to) { this.beat = from; this.early.forEach((f) => f(from, to)); this.late.forEach((f) => f(from, to)); },
  };
  const bus = new Bus();
  const played = [];
  const engine = { playNote: (inst, note, vel, start) => { played.push([note, start]); return { cancel() {} }; } };
  const looper = new Looper({ clock, engine, bus });
  const song = new Song({ clock, looper, bus });
  // Two recorded 1-bar loops: loop 1 plays note 60 on beat 0, loop 2 plays note 50 on beat 0.
  [[0, 60], [1, 50]].forEach(([i, note]) => {
    const l = looper.loops[i];
    l.bars = 1;
    l.events = [{ pos: 0, dur: 0.5, inst: 1, note, vel: 1, recordedAt: -Infinity }];
  });
  return { clock, bus, looper, song, played };
}

test('loops play again after Stop → Play (they used to stay silent)', () => {
  const { clock, looper, played } = rig();
  const loop = looper.loops[0];
  clock.running = true;
  loop.playing = true;
  loop.playFrom = 40; // started at beat 40 in the previous run
  loop.events[0].recordedAt = 37;
  clock.stop();
  clock.running = true; // Play again: the beat counter is back at 0
  clock.tick(0, 0.5);
  assert.deepEqual(played, [[60, 0]]);
});

test('the song switches loops on the bar, section by section, then ends', () => {
  const { clock, song, looper, played } = rig();
  const sections = Array.from({ length: 8 }, () => ({ bars: 1, on: Array(8).fill(false) }));
  sections[0].on[0] = true; // section 1: loop 1
  sections[1].on[1] = true; // section 2: loop 2
  set({ song: { repeat: false, sections } });
  song.play();
  assert.ok(clock.running);
  clock.tick(0, 0.5); // bar 1
  clock.tick(3.9, 4.2); // bar 2 starts at beat 4
  clock.tick(7.9, 8.2); // the song ends at beat 8
  assert.deepEqual(played, [[60, 0], [50, 4]]);
  assert.equal(song.playing, false);
  clock.beat = 8.3;
  clock.tick(8.3, 8.4);
  assert.ok(!looper.loops[0].playing && !looper.loops[1].playing);
});

test('with repeat on, the song loops back to the first section', () => {
  const { clock, song, played } = rig();
  const sections = Array.from({ length: 8 }, () => ({ bars: 1, on: Array(8).fill(false) }));
  sections[0].on[0] = true;
  sections[2].on[1] = true; // section 2 is an empty break
  set({ song: { repeat: true, sections } });
  assert.equal(song.length, 3);
  song.play();
  for (let b = 0; b < 16; b += 4) clock.tick(b - 0.1 < 0 ? 0 : b - 0.1, b + 0.2);
  // loop 1 on beat 0, break on 4, loop 2 on 8, loop 1 again on 12
  assert.deepEqual(played, [[60, 0], [50, 8], [60, 12]]);
  assert.equal(state.song.repeat, true);
});
