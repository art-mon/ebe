import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createTrackStore, handleApi } from './tracks.js';

async function withServer(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lumen-tracks-'));
  const store = createTrackStore(dir);
  const server = http.createServer(async (req, res) => {
    if (!(await handleApi(req, res, store))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, dir);
  } finally {
    server.close();
  }
}

const put = (base, p, body, headers = {}) =>
  fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('saves, lists, loads and trashes tracks', async () => {
  await withServer(async (base, dir) => {
    assert.equal((await put(base, '/api/tracks/night-drive', { id: 'night-drive', name: 'Night Drive', updated: 2 })).status, 200);
    await put(base, '/api/tracks/sunrise', { id: 'sunrise', name: 'Sunrise', updated: 5 });
    const list = await (await fetch(`${base}/api/tracks`)).json();
    assert.deepEqual(list.map((t) => t.name), ['Sunrise', 'Night Drive']); // newest first
    assert.equal((await (await fetch(`${base}/api/tracks/night-drive`)).json()).name, 'Night Drive');
    assert.equal((await fetch(`${base}/api/tracks/night-drive`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/tracks/night-drive`)).status, 404);
    assert.equal((await readdir(path.join(dir, '.trash'))).length, 1); // recoverable
  });
});

test('autosave draft is kept apart from the track list', async () => {
  await withServer(async (base) => {
    assert.equal(await (await fetch(`${base}/api/draft`)).json(), null);
    await put(base, '/api/draft', { trackId: null, data: { tempo: 90 } });
    assert.equal((await (await fetch(`${base}/api/draft`)).json()).data.tempo, 90);
    assert.deepEqual(await (await fetch(`${base}/api/tracks`)).json(), []);
  });
});

test('rejects bad ids, mismatched bodies and other websites', async () => {
  await withServer(async (base) => {
    assert.equal((await put(base, '/api/tracks/..%2Fescape', { id: '../escape', name: 'x' })).status, 400);
    assert.equal((await put(base, '/api/tracks/ok', { id: 'other', name: 'x' })).status, 400);
    assert.equal((await put(base, '/api/tracks/ok', { id: 'ok', name: 'x' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(`${base}/api/tracks`, { headers: { origin: 'http://localhost:5173' } })).status, 200);
  });
});
