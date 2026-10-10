import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('every instrument has five well-formed styles', () => {
  for (const [inst, list] of Object.entries(STYLES)) {
    assert.equal(list.length, 5, inst);
    assert.equal(new Set(list.map((s) => s.id)).size, 5, `${inst} ids unique`);
    for (const st of list) {
      assert.ok(st.osc.length > 0, `${inst}/${st.id} has oscillators`);
      for (const k of ['a', 'd', 's', 'r', 'peak']) assert.equal(typeof st.amp[k], 'number', `${inst}/${st.id} amp.${k}`);
    }
  }
  assert.equal(styleFor('bass', 'nope').id, 'sub'); // falls back to the first
});
