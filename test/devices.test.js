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
