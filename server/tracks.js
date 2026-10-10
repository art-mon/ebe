// Track storage: each saved track is one JSON file in ~/Music/Lumen/Tracks
// (override with LUMEN_TRACKS_DIR). The browser talks to it through a tiny API:
//
//   GET    /api/tracks        → every track, newest first
//   GET    /api/tracks/:id    → one track
//   PUT    /api/tracks/:id    → create / replace
//   DELETE /api/tracks/:id    → moved to .trash/ (recoverable), never erased
//   GET    /api/draft         → the autosaved session (null if none yet)
//   GET    /api/info          → { dir }: where the tracks are kept
//   PUT    /api/draft         → autosave the session
import os from 'node:os';
import path from 'node:path';
import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';

export const TRACKS_DIR = process.env.LUMEN_TRACKS_DIR ?? path.join(os.homedir(), 'Music', 'Lumen', 'Tracks');
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DRAFT = '_draft';
const MAX_BYTES = 2 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createTrackStore(dir = TRACKS_DIR) {
  const file = (id) => path.join(dir, `${id}.json`);
  const check = (id) => {
    if (id !== DRAFT && !ID.test(id)) throw new HttpError(400, 'bad track id');
  };
  return {
    dir,
    async list() {
      await mkdir(dir, { recursive: true });
      const names = (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('_'));
      const tracks = [];
      for (const n of names) {
        try {
          tracks.push(JSON.parse(await readFile(path.join(dir, n), 'utf8')));
        } catch {
          /* a damaged file shouldn't hide the others */
        }
      }
      return tracks.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
    },
    async get(id) {
      check(id);
      try {
        return JSON.parse(await readFile(file(id), 'utf8'));
      } catch (err) {
        throw new HttpError(err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'not found' : err.message);
      }
    },
    async put(id, track) {
      check(id);
      if (!track || typeof track !== 'object' || Array.isArray(track)) throw new HttpError(400, 'expected a track object');
      if (id !== DRAFT && (track.id !== id || typeof track.name !== 'string')) throw new HttpError(400, 'track needs a matching id and a name');
      await mkdir(dir, { recursive: true });
      // Write then rename, so a crash mid-save never leaves a half-written track.
      const tmp = `${file(id)}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(track));
      await rename(tmp, file(id));
      return track;
    },
    async remove(id) {
      check(id);
      const trash = path.join(dir, '.trash');
      await mkdir(trash, { recursive: true });
      try {
        await rename(file(id), path.join(trash, `${id}-${Date.now()}.json`));
      } catch (err) {
        throw new HttpError(err.code === 'ENOENT' ? 404 : 500, err.message);
      }
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        reject(new HttpError(413, 'track too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const localOrigin = (origin) => {
  if (!origin) return true;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/** Handles /api/* requests. Returns false for anything else (static files). */
export async function handleApi(req, res, store) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  try {
    // Only pages served from this machine may read or change your tracks.
    if (!localOrigin(req.headers.origin)) throw new HttpError(403, 'forbidden');
    if (url.pathname === '/api/info') {
      send(200, { dir: store.dir });
      return true;
    }
    const m = /^\/api\/(tracks|draft)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) throw new HttpError(404, 'not found');
    const id = m[1] === 'draft' ? DRAFT : m[2] && decodeURIComponent(m[2]);
    if (m[1] === 'tracks' && !id) {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      send(200, await store.list());
    } else if (req.method === 'GET' && id === DRAFT) {
      send(200, await store.get(id).catch((err) => (err.status === 404 ? null : Promise.reject(err))));
    } else if (req.method === 'GET') send(200, await store.get(id));
    else if (req.method === 'PUT') send(200, await store.put(id, await readBody(req)));
    else if (req.method === 'DELETE' && id !== DRAFT) {
      await store.remove(id);
      send(204);
    } else throw new HttpError(405, 'method not allowed');
  } catch (err) {
    send(err.status ?? 500, { error: err.message });
  }
  return true;
}
