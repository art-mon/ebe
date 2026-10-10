import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, decode } from './osc.js';

test('round-trips ints, floats and strings', () => {
  const buf = encodeMessage('/live/track/set/volume', [2, 0.75, 'hi'], 'ifs');
  assert.equal(buf.length % 4, 0);
  const [msg] = decode(buf);
  assert.equal(msg.address, '/live/track/set/volume');
  assert.equal(msg.args[0], 2);
  assert.ok(Math.abs(msg.args[1] - 0.75) < 1e-6);
  assert.equal(msg.args[2], 'hi');
});

test('infers types when none are given', () => {
  const [msg] = decode(encodeMessage('/x', [3, 1.5, 'a', true]));
  assert.deepEqual(msg.args, [3, 1.5, 'a', true]);
});

test('encodes a message with no arguments', () => {
  const [msg] = decode(encodeMessage('/live/test'));
  assert.equal(msg.address, '/live/test');
  assert.deepEqual(msg.args, []);
});

test('unpacks bundles', () => {
  const a = encodeMessage('/a', [1]);
  const b = encodeMessage('/b', ['two']);
  const size = (n) => { const s = Buffer.alloc(4); s.writeInt32BE(n); return s; };
  const bundle = Buffer.concat([
    Buffer.from('#bundle\0', 'ascii'), Buffer.alloc(8),
    size(a.length), a, size(b.length), b,
  ]);
  const msgs = decode(bundle);
  assert.deepEqual(msgs.map((m) => m.address), ['/a', '/b']);
  assert.deepEqual(msgs[1].args, ['two']);
});
