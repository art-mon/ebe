import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APC, OXYGEN, DEFAULT_MAPPINGS, deviceForPort, apcNote } from '../public/js/devices.js';
import { paletteIndex, mk1Value, mk2Bytes, MK1, PALETTE } from '../public/js/lights.js';

test('recognises controller ports and classifies them', () => {
  assert.equal(deviceForPort('APC Key 25'), APC);
  assert.equal(APC.portClass('APC Key 25'), 'apc1');
  assert.equal(APC.portClass('APC Key 25 mk2'), 'apc2');
  assert.equal(APC.portClass('APC Key 25 mk2 Keys'), 'apckeys');
  assert.equal(APC.portClass('APC Key 25 mk2 Control'), 'apc2');
  assert.equal(deviceForPort('Oxygen Pro Mini USB MIDI'), OXYGEN);
  assert.equal(OXYGEN.portClass('Oxygen Pro Mini Mackie/HUI'), 'daw');
  assert.equal(deviceForPort('IAC Driver Bus 1'), null);
});

test('APC grid: note 0 is bottom-left, top row is the vibes', () => {
  assert.equal(apcNote(4, 0), 0); // bottom row, first pad
  assert.equal(apcNote(0, 7), 39); // top row, last pad
  assert.deepEqual(DEFAULT_MAPPINGS['apc2|note:1:32'], { kind: 'action', name: 'vibe', arg: 0 });
  assert.deepEqual(DEFAULT_MAPPINGS['apc2|note:1:0'], { kind: 'pad', index: 0 }); // kick
  assert.deepEqual(DEFAULT_MAPPINGS['apc1|note:1:16'], { kind: 'action', name: 'loop', arg: 0 });
});

test('APC buttons, scene and track rows', () => {
  assert.equal(DEFAULT_MAPPINGS['apc2|note:1:91'].name, 'transport');
  assert.equal(DEFAULT_MAPPINGS['apc2|note:1:93'].name, 'record');
  assert.equal(DEFAULT_MAPPINGS['apc2|note:1:98'].name, 'shift');
  assert.equal(DEFAULT_MAPPINGS['apc2|note:1:82'].name, 'randomVibe');
  assert.deepEqual(DEFAULT_MAPPINGS['apc2|note:1:64'], { kind: 'action', name: 'mute', arg: 0 });
});

test('mk2 knobs are relative, mk1 knobs absolute', () => {
  assert.deepEqual(DEFAULT_MAPPINGS['apc2|cc:1:48'], { kind: 'fx', index: 0, relative: true });
  assert.deepEqual(DEFAULT_MAPPINGS['apc1|cc:1:55'], { kind: 'fx', index: 7 });
});

test('mk2 colours come from the palette, brightness from the channel', () => {
  assert.equal(PALETTE.length, 128);
  assert.equal(paletteIndex('#ff0000'), 5);
  assert.equal(paletteIndex('#00ff00'), 21);
  assert.equal(paletteIndex('#0000ff'), 45);
  assert.deepEqual(mk2Bytes(10, { color: '#ff0000', level: 'full' }), [0x96, 10, 5]);
  assert.deepEqual(mk2Bytes(10, { color: '#ff0000', level: 'dim' }), [0x91, 10, 5]);
  assert.deepEqual(mk2Bytes(10, { color: '#ff0000', level: 'blink' }), [0x9e, 10, 5]);
  assert.deepEqual(mk2Bytes(10, { color: '#ff0000', level: 'off' }), [0x90, 10, 0]);
});

test('mk1 maps looks onto green / red / amber', () => {
  assert.equal(mk1Value({ color: '#00ff00', level: 'full' }), MK1.green);
  assert.equal(mk1Value({ color: '#ff0000', level: 'blink' }), MK1.red + 1);
  assert.equal(mk1Value({ color: '#ffbd6c', level: 'full' }), MK1.amber);
  assert.equal(mk1Value({ color: '#ff0000', level: 'dim' }), 0);
  assert.equal(mk1Value({ color: '#ff0000', level: 'dim', keep: true }), MK1.amber);
  assert.equal(mk1Value({ color: '#000', level: 'full', mk1: 3 }), 3);
});

test('endless knob steps decode both ways, absolute values are rejected', async () => {
  const { relativeDelta } = await import('../public/js/controller.js');
  assert.equal(relativeDelta(1), 1);
  assert.equal(relativeDelta(3), 3); // accelerated
  assert.equal(relativeDelta(127), -1); // two's complement
  assert.equal(relativeDelta(125), -3);
  assert.equal(relativeDelta(65), -1); // sign-bit style
  assert.equal(relativeDelta(64), 0);
  assert.equal(relativeDelta(40), null); // looks like an absolute knob
  assert.equal(relativeDelta(100), null);
});

test('drums mode: columns are drums, rows are loudness (bottom soft → top loud)', async () => {
  const { APC_DRUM_GRID, apcGrid, APC_GRID } = await import('../public/js/devices.js');
  assert.deepEqual(APC_DRUM_GRID[4][0], { kind: 'pad', index: 0, vel: 0.3, note: 0 }); // bottom-left: softest kick
  assert.deepEqual(APC_DRUM_GRID[0][7], { kind: 'pad', index: 7, vel: 1, note: 39 }); // top-right: loud crash
  assert.equal(apcGrid('drums'), APC_DRUM_GRID);
  assert.equal(apcGrid('controls'), APC_GRID);
  // brightness follows loudness on the mk2
  assert.equal(mk2Bytes(0, { color: '#ff0000', level: 'solid', bright: 0.3 })[0], 0x91); // 25 %
  assert.equal(mk2Bytes(0, { color: '#ff0000', level: 'solid', bright: 0.66 })[0], 0x93); // 65 %
  assert.equal(mk2Bytes(0, { color: '#ff0000', level: 'solid', bright: 1 })[0], 0x96); // 100 %
});

test('a grid press plays a drum in drums mode and a control in controls mode', async () => {
  const { Bus, state, set } = await import('../public/js/state.js');
  const { Controller } = await import('../public/js/controller.js');
  const bus = new Bus();
  const played = [];
  const engine = { noteOn: (inst, note, vel) => played.push([inst, note, vel]), noteOff() {}, fx() {} };
  const controller = new Controller({ engine, looper: { input() {} }, clock: {}, bus });
  controller.selectVibe = (i) => played.push(['vibe', i]);
  const press = (note) => {
    bus.emit('midi', { port: 'apc2', type: 'noteon', channel: 1, note, velocity: 127 });
    bus.emit('midi', { port: 'apc2', type: 'noteoff', channel: 1, note, velocity: 0 });
  };
  set({ gridMode: 'drums' });
  press(36); // top row, 5th pad → open hat, loud
  press(8); // second row from the bottom, 1st pad → kick, soft
  set({ gridMode: 'controls' });
  press(36); // top row in controls mode → vibe 5
  assert.deepEqual(played, [[4, 46, 1], [4, 36, 0.48], ['vibe', 4]]);
  assert.equal(state.gridMode, 'controls');
});

test('choosing one port of a controller listens to all of its ports', async () => {
  const { pickInputs, AUTO } = await import('../public/js/midi.js');
  const ports = [
    { id: 'k', name: 'APC Key 25 mk2 Keys' },
    { id: 'c', name: 'APC Key 25 mk2 Control' },
    { id: 'o', name: 'Oxygen Pro Mini USB MIDI' },
    { id: 'od', name: 'Oxygen Pro Mini Mackie/HUI' },
    { id: 'iac', name: 'IAC Driver Bus 1' },
    { id: 'x', name: 'Some Synth' },
  ];
  const ids = (list) => list.map((p) => p.id);
  assert.deepEqual(ids(pickInputs(ports, 'k')), ['k', 'c']); // the bug: only 'k' was attached
  assert.deepEqual(ids(pickInputs(ports, 'od')), ['o', 'od']);
  assert.deepEqual(ids(pickInputs(ports, 'x')), ['x']);
  assert.deepEqual(ids(pickInputs(ports, AUTO)), ['k', 'c', 'o', 'od']); // never IAC, not unknown gear
  assert.deepEqual(ids(pickInputs(ports, '')), []);
  assert.deepEqual(ids(pickInputs(ports, 'gone')), []);
});
