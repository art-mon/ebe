// Lumen server: serves the web app and bridges the browser to Ableton Live.
//
//   browser ──WebSocket /bridge (JSON)──▶ this server ──UDP OSC──▶ AbletonOSC (Live, port 11000)
//   browser ◀──────────────────────────── this server ◀──UDP OSC── AbletonOSC replies (port 11001)
//
// Browsers can't speak UDP, so this tiny relay is the only reason a server exists.
// MIDI notes never pass through here — the browser sends them straight to the
// IAC Driver with Web MIDI.

import http from 'node:http';
import dgram from 'node:dgram';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { encodeMessage, decode } from './osc.js';

const PORT = Number(process.env.PORT ?? 5173);
const LIVE_HOST = process.env.LIVE_HOST ?? '127.0.0.1';
const LIVE_PORT = Number(process.env.LIVE_PORT ?? 11000); // AbletonOSC listens here
const REPLY_PORT = Number(process.env.REPLY_PORT ?? 11001); // AbletonOSC answers here

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ── Static files ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// ── OSC <-> WebSocket relay ─────────────────────────────────────────────────
const wss = new WebSocketServer({
  server,
  path: '/bridge',
  // Only pages served from this machine may drive Ableton.
  verifyClient: ({ origin }) => {
    if (!origin) return true;
    try {
      return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
    } catch {
      return false;
    }
  },
});

const udp = dgram.createSocket('udp4');
let liveAlive = false;
let lastReplyAt = 0;

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

function sendOsc(address, args = [], types) {
  try {
    udp.send(encodeMessage(address, args, types), LIVE_PORT, LIVE_HOST);
  } catch (err) {
    console.warn(`[osc] could not send ${address}: ${err.message}`);
  }
}

udp.on('message', (packet) => {
  lastReplyAt = Date.now();
  let messages;
  try {
    messages = decode(packet);
  } catch {
    return;
  }
  for (const m of messages) broadcast({ type: 'osc', address: m.address, args: m.args });
});

udp.on('error', (err) => {
  console.error(`[osc] UDP error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`[osc] Port ${REPLY_PORT} is taken — is another OSC app running? Set REPLY_PORT to change it.`);
  }
});

// Binding the reply port and sending *from* it means replies land here whether
// AbletonOSC answers on 11001 or back to the sender's port.
udp.bind(REPLY_PORT, '127.0.0.1');

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', ableton: liveAlive }));
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg?.type === 'osc' && typeof msg.address === 'string' && msg.address.startsWith('/')) {
      sendOsc(msg.address, Array.isArray(msg.args) ? msg.args : [], msg.types);
    }
  });
});

// Heartbeat: any reply means Live is reachable. (Not /live/test — that flashes Live's status bar.)
setInterval(() => {
  sendOsc('/live/song/get/num_tracks');
  const alive = Date.now() - lastReplyAt < 4000;
  if (alive !== liveAlive) {
    liveAlive = alive;
    console.log(alive ? '[osc] Ableton Live connected (AbletonOSC)' : '[osc] Ableton Live not reachable');
    broadcast({ type: 'status', ableton: alive });
  }
}, 1500);

// `ws` re-emits the HTTP server's errors, so this one handler covers both.
wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — Lumen is probably running already (check your other terminals).`);
    console.error(`  Stop it first, or use another port:  PORT=5174 npm start\n`);
  } else {
    console.error(`[server] ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ✦ Lumen is running → http://localhost:${PORT}`);
  console.log('    Open it in Chrome or Edge (Safari has no Web MIDI).\n');
});
