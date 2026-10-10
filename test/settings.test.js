import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate } from '../public/js/state.js';
import { STYLES, DEFAULT_STYLES, styleFor } from '../public/js/styles.js';
import { DEFAULT_MAPPINGS, OXYGEN } from '../public/js/devices.js';

test('old settings migrate: one loop length becomes eight, learned Oxygen FX swap roles', () => {
  const s = migrate({ loopBars: 4, mappings: { 'main|cc:1:70': { kind: 'fx', index: 0 }, 'main|cc:1:80': { kind: 'fx', index: 5 }, 'apc2|note:1:0': { kind: 'pad', index: 0 } } });
  assert.deepEqual(s.loopBars, [4, 4, 4, 4, 4, 4, 4, 4]);
  assert.equal(s.mappings['main|cc:1:70'].index, 4); // was knob → FX 1, knobs now drive FX 5-8
  assert.equal(s.mappings['main|cc:1:80'].index, 1);
  assert.deepEqual(s.mappings['apc2|note:1:0'], { kind: 'pad', index: 0 }); // other gear untouched
  assert.deepEqual(s.styles, DEFAULT_STYLES);
  assert.equal(migrate(s).mappings['main|cc:1:70'].index, 4); // only once
});

test('Oxygen: faders drive FX 1-4, knobs FX 5-8', () => {
  assert.deepEqual(DEFAULT_MAPPINGS['daw|cc:1:12'], { kind: 'fx', index: 0 }); // fader 1 → Filter
  assert.deepEqual(DEFAULT_MAPPINGS['daw|cc:1:22'], { kind: 'fx', index: 4 }); // knob 1 → Echo
  assert.deepEqual(OXYGEN.fxHw.slice(0, 2), ['Fader 1', 'Fader 2']);
});

test('APC rows 3-4: loops 1-8, styles, visuals, stage', () => {
  assert.deepEqual(DEFAULT_MAPPINGS['apc2|note:1:23'], { kind: 'action', name: 'loop', arg: 7 });
  assert.equal(DEFAULT_MAPPINGS['apc2|note:1:28'].name, 'stylePrev');
  assert.equal(DEFAULT_MAPPINGS['apc2|note:1:29'].name, 'styleNext');
  assert.equal(DEFAULT_MAPPINGS['apc2|note:1:30'].name, 'visualNext');
  assert.equal(DEFAULT_MAPPINGS['apc2|note:1:31'].name, 'stage');
});

const samples = JSON.parse(readFileSync(new URL('../public/samples/index.json', import.meta.url)));

test('every instrument has five real and five synth styles, all well-formed', () => {
  for (const inst of ['keys', 'pad', 'bass', 'lead']) {
    const list = STYLES[inst];
    assert.equal(new Set(list.map((s) => s.id)).size, list.length, `${inst} ids unique`);
    const real = list.filter((s) => s.sample);
    const synth = list.filter((s) => !s.sample);
    assert.equal(real.length, 5, `${inst} real`);
    assert.equal(synth.length, 5, `${inst} synth`);
    assert.ok(list.indexOf(real[4]) < list.indexOf(synth[0]), `${inst}: real instruments come first`);
    for (const st of synth) {
      assert.ok(st.osc.length > 0, `${inst}/${st.id} has oscillators`);
      for (const k of ['a', 'd', 's', 'r', 'peak']) assert.equal(typeof st.amp[k], 'number', `${inst}/${st.id} amp.${k}`);
    }
    for (const st of real) {
      assert.ok(samples[st.sample]?.notes, `${inst}/${st.id}: sample set "${st.sample}" exists`);
      assert.ok(synth.some((x) => x.id === st.fallback), `${inst}/${st.id}: fallback is one of its synth styles`);
      for (const k of ['a', 'r']) assert.equal(typeof st.amp[k], 'number', `${inst}/${st.id} amp.${k}`);
    }
  }
  for (const kit of STYLES.drums.filter((s) => s.sample)) {
    assert.deepEqual(Object.keys(samples[kit.sample].voices).sort(), ['clap', 'crash', 'hat', 'kick', 'openhat', 'rim', 'snare', 'tom']);
  }
  assert.equal(styleFor('bass', 'nope').id, 'finger'); // falls back to the first
  assert.equal(DEFAULT_STYLES.keys, 'grand');
});

test('settings from before real instruments switch to them once', () => {
  const s = migrate({ version: 2, styles: { keys: 'epiano', pad: 'warm', bass: 'acid', lead: 'saw' } });
  assert.deepEqual(s.styles, DEFAULT_STYLES);
  s.styles.keys = 'felt';
  assert.equal(migrate(s).styles.keys, 'felt'); // a later choice is kept
});

test('vibes only pick styles and kits that exist', async () => {
  const { VIBES } = await import('../public/js/config.js');
  for (const v of VIBES) {
    for (const [inst, id] of Object.entries(v.styles ?? {})) assert.equal(styleFor(inst, id).id, id, `${v.name}: ${inst}/${id}`);
  }
});

test('drum kits: real or electronic, every hit on disk, labels name real pads', async () => {
  const { existsSync } = await import('node:fs');
  const { DRUM_KINDS, drumName } = await import('../public/js/styles.js');
  const { DRUM_VOICES } = await import('../public/js/config.js');
  const ids = DRUM_VOICES.map((v) => v.id);
  for (const kit of STYLES.drums) {
    assert.ok(kit.kind in DRUM_KINDS, `${kit.id} kind`);
    for (const v of Object.keys({ ...kit.labels, ...kit.tune, ...kit.levels })) assert.ok(ids.includes(v), `${kit.id}: ${v} is a drum pad`);
    if (!kit.sample) continue;
    for (const files of Object.values(samples[kit.sample].voices)) {
      for (const f of files) assert.ok(existsSync(new URL(`../public/samples/${kit.sample}/${f}`, import.meta.url)), `${kit.id}: ${f}`);
    }
  }
  assert.ok(STYLES.drums.filter((k) => k.kind === 'real').length >= 2);
  assert.ok(STYLES.drums.filter((k) => k.kind === 'electronic').length >= 6);
  const triphop = STYLES.drums.find((k) => k.id === 'triphop');
  assert.equal(drumName(triphop, 2), 'Snap'); // the Clap pad plays a finger snap
  assert.equal(drumName(triphop, 0), 'Kick');
});
