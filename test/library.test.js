import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Looper } from '../public/js/looper.js';
import { Library, snapshot, makeId, trackStyles } from '../public/js/library.js';
import { DEFAULT_STYLES } from '../public/js/styles.js';
import { bus, state, set } from '../public/js/state.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const clock = {
    running: false, beat: 0, bpm: 100, ctx: { currentTime: 0 },
    onTick() {}, start() { this.running = true; }, stop() { this.running = false; }, timeAt: (b) => b,
    setBpm(b) { this.bpm = b; return b; },
  };
  const looper = new Looper({ clock, engine: { playNote: () => ({ cancel() {} }) }, bus });
  const controller = { morphFx: (fx) => set({ fx: [...fx] }) };
  return { clock, looper, controller };
}

const SOUND = ['grand', 'ensemble', 'finger', 'sax', 'acoustic']; // a recorded note carries its sound
const notes = (inst, ...ns) => ns.map((note, i) => ({ pos: i, dur: 0.5, inst, note, vel: 100, style: SOUND[inst] }));

test('a track is the loops, the song and the sound — and comes back exactly', () => {
  const { clock, looper, controller } = setup();
  const lib = new Library({ bus, looper, clock, controller });
  looper.load(0, { bars: 4, events: notes(1, 62, 65, 69) });
  looper.load(3, { bars: 1, events: notes(4, 36, 38) });
  set({ tempo: 92, root: 9, scale: 'major', vibe: 2, fx: state.fx.map(() => 0.25) });
  const song = structuredClone(state.song);
  song.sections[0].on[0] = true;
  set({ song });
  const saved = snapshot(looper);
  assert.equal(saved.loops.length, 8);
  assert.deepEqual(saved.loops[0], { bars: 4, events: notes(1, 62, 65, 69) });
  assert.equal(saved.settings.tempo, 92);
  assert.equal('midiInputId' in saved.settings, false); // personal settings don't travel with a track

  // Mess everything up, then open the snapshot again.
  looper.loops.forEach((_, i) => looper.clear(i));
  set({ tempo: 140, root: 0, vibe: 0, fx: state.fx.map(() => 0.9), song: { ...state.song, sections: state.song.sections.map((s) => ({ ...s, on: s.on.map(() => false) })) } });
  clock.running = true;
  lib.apply(structuredClone(saved));
  assert.equal(clock.running, false); // opening a track stops the transport
  assert.deepEqual(snapshot(looper), saved);
  assert.equal(looper.loops[0].bars, 4);
  assert.equal(looper.loops[0].playing, false);
  assert.deepEqual(state.loopBars.slice(0, 4), [4, 2, 2, 1]);
  assert.equal(clock.bpm, 92);
});

test('saving clears the unsaved mark; changing a loop sets it again', async () => {
  const { clock, looper, controller } = setup();
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    requests.push({ url, method: opts.method ?? 'GET', body: opts.body && JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => (url === '/api/info' ? { dir: '/tmp/x' } : null) };
  };
  try {
    const lib = new Library({ bus, looper, clock, controller });
    await lib.init();
    assert.equal(lib.available, true);
    looper.load(1, { bars: 2, events: notes(2, 38, 41) });
    await wait(350);
    assert.equal(lib.dirty, true);
    const track = await lib.save('Night Drive!');
    assert.match(track.id, /^night-drive-[0-9a-f]{1,4}$/);
    const put = requests.find((r) => r.method === 'PUT' && r.url.startsWith('/api/tracks/'));
    assert.equal(put.body.name, 'Night Drive!');
    assert.equal(put.body.loops[1].events.length, 2);
    assert.equal(lib.dirty, false);
    // Saving again overwrites the same track.
    looper.load(2, { bars: 1, events: notes(0, 60) });
    await wait(350);
    assert.equal(lib.dirty, true);
    assert.equal((await lib.save()).id, track.id);
    assert.equal((await lib.save('Night Drive 2', true)).id === track.id, false); // save as → a new track
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('track ids are readable and safe for file names', () => {
  assert.match(makeId('Café del Mar — Sunset!'), /^cafe-del-mar-sunset-[0-9a-f]{1,4}$/);
  assert.match(makeId('🎹🎹'), /^track-[0-9a-f]{1,4}$/);
  assert.ok(makeId('x'.repeat(200)).length <= 45);
});

test('tracks from before real instruments open with them, keeping sounds picked on purpose', () => {
  const old = { version: 1, settings: { styles: { keys: 'epiano', pad: 'shimmer', bass: 'acid', lead: 'saw' } } };
  assert.deepEqual(trackStyles(old), { keys: 'grand', pad: 'shimmer', bass: 'acid', lead: 'sax', drums: DEFAULT_STYLES.drums });
  const now = { version: 2, settings: { styles: { keys: 'epiano', pad: 'warm', bass: 'sub', lead: 'saw', drums: 'tr808' } } };
  assert.deepEqual(trackStyles(now), now.settings.styles); // a current track is opened as saved
});

test('saved notes keep their sound; older tracks use the sound they were saved with', () => {
  const { clock, looper, controller } = setup();
  const lib = new Library({ bus, looper, clock, controller });
  const old = {
    version: 2,
    settings: { styles: { keys: 'glass', pad: 'ensemble', bass: 'finger', lead: 'sax', drums: 'tr808' } },
    loops: [{ bars: 1, events: [{ pos: 0, dur: 1, inst: 0, note: 60, vel: 0.8 }, { pos: 1, dur: 0.1, inst: 4, note: 36, vel: 1 }] }],
  };
  lib.apply(old);
  assert.deepEqual(looper.loops[0].events.map((e) => e.style), ['glass', 'tr808']);
  set({ styles: { ...state.styles, keys: 'grand' } }); // changing the sound now…
  assert.equal(snapshot(looper).loops[0].events[0].style, 'glass'); // …doesn't touch the recording
});
