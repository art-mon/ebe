// The track view: one strip per instrument with a live, scrolling level
// "waveform" and note ticks. Levels come from the built-in synth, from Live's
// meters (via AbletonOSC), or — failing both — from note activity.
import { INSTRUMENTS, DRUMS_INDEX } from './config.js';
import { state } from './state.js';

const COLS = 320; // history columns
const RATE = 30; // columns per second (~10 s of history)

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export class Tracks {
  constructor(root, { synth, ableton, engine, controller, bus }) {
    this.synth = synth;
    this.ableton = ableton;
    this.engine = engine;
    this.controller = controller;
    this.acc = 0;
    this.head = 0;
    this.rows = INSTRUMENTS.map((inst, i) => {
      const row = el('div', 'track');
      row.style.setProperty('--c', inst.color);
      const head = el('button', 'track-head');
      head.type = 'button';
      head.title = inst.isDrums ? 'Drums play from pad bank A' : `Play ${inst.name}`;
      head.append(el('span', 'dot'), el('span', 'track-name', inst.name));
      const sub = el('span', 'track-sub', `ch ${inst.channel}`);
      head.append(sub);
      head.addEventListener('click', () => {
        if (!inst.isDrums) controller.selectInstrument(i);
      });
      const canvas = el('canvas', 'track-canvas');
      const meter = el('div', 'track-meter');
      const fill = el('div', 'track-meter-fill');
      meter.append(fill);
      const mute = el('button', 'track-mute', 'M');
      mute.type = 'button';
      mute.title = `Mute ${inst.name}`;
      mute.addEventListener('click', () => controller.action('mute', i));
      row.append(head, canvas, meter, mute);
      root.append(row);
      const r = {
        row, sub, canvas, fill, mute, g: canvas.getContext('2d'), color: inst.color,
        levels: new Float32Array(COLS), notes: new Int16Array(COLS).fill(-1),
        activity: 0, display: 0, pendingNote: -1,
      };
      return r;
    });

    // Mutes live in state, so the APC's track buttons and these M buttons stay in sync.
    bus.on('state', (patch) => {
      if ('mutes' in patch) this.rows.forEach((r, i) => r.mute.classList.toggle('on', state.mutes[i]));
    });
    bus.on('voice', ({ inst, note, vel, on }) => {
      if (!on) return;
      const r = this.rows[inst];
      r.activity = Math.min(1, r.activity + 0.35 + vel * 0.5);
      r.pendingNote = Math.max(r.pendingNote, note);
    });
    new ResizeObserver(() => this.resize()).observe(root);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const r of this.rows) {
      const { width, height } = r.canvas.getBoundingClientRect();
      r.w = Math.max(1, width);
      r.h = Math.max(1, height);
      r.canvas.width = Math.round(r.w * dpr);
      r.canvas.height = Math.round(r.h * dpr);
      r.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /** Short status line under each track name. */
  updateLabels() {
    const live = this.ableton.live;
    this.rows.forEach((r, i) => {
      const inst = INSTRUMENTS[i];
      const t = this.ableton.trackOf[i];
      let text = `ch ${inst.channel}`;
      if (live) text += t >= 0 ? ` · Live #${t + 1}` : ' · no Live track';
      r.sub.textContent = text;
      r.row.classList.toggle('missing', live && t < 0 && this.engine.mode === 'ableton');
      const active = i === state.instrument || (state.layerOn && i === state.layer);
      r.row.classList.toggle('active', active && i !== DRUMS_INDEX);
    });
  }

  #level(i) {
    const r = this.rows[i];
    if (this.engine.mode === 'builtin') {
      const rms = this.synth.level(i);
      return Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-6) + 54) / 50));
    }
    if (this.ableton.live && this.ableton.trackOf[i] >= 0) return this.ableton.meter(i);
    return r.activity * 0.85;
  }

  frame(dt) {
    for (const r of this.rows) r.activity *= Math.exp(-dt * 2.2);
    // Advance history at a fixed rate, independent of frame rate.
    this.acc += dt * RATE;
    let steps = Math.min(COLS, Math.floor(this.acc));
    this.acc -= steps;
    this.rows.forEach((r, i) => {
      const lvl = this.#level(i);
      r.display += (lvl - r.display) * (lvl > r.display ? 0.6 : 0.15);
      r.fill.style.transform = `scaleY(${r.display.toFixed(3)})`;
    });
    while (steps-- > 0) {
      this.head = (this.head + 1) % COLS;
      for (const r of this.rows) {
        r.levels[this.head] = r.display;
        r.notes[this.head] = r.pendingNote;
        r.pendingNote = -1;
      }
    }
    for (const r of this.rows) this.#draw(r);
  }

  #draw(r) {
    const { g, w, h } = r;
    g.clearRect(0, 0, w, h);
    const colW = w / COLS;
    const mid = h / 2;
    g.fillStyle = r.color;
    g.globalAlpha = 0.75;
    for (let k = 0; k < COLS; k++) {
      const idx = (this.head - k + COLS) % COLS;
      const v = r.levels[idx];
      if (v < 0.01) continue;
      const x = w - (k + 1) * colW;
      const bh = Math.max(1, v * (h - 4));
      g.fillRect(x, mid - bh / 2, Math.max(1, colW - 0.5), bh);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    for (let k = 0; k < COLS; k++) {
      const idx = (this.head - k + COLS) % COLS;
      const n = r.notes[idx];
      if (n < 0) continue;
      const x = w - (k + 1) * colW;
      const y = h - 3 - ((Math.max(24, Math.min(108, n)) - 24) / 84) * (h - 6);
      g.fillRect(x, y - 1, 2.5, 2.5);
    }
  }
}
