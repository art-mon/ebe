// The note editor: a piano roll for one loop and one instrument, like a MIDI clip
// in Ableton. Click to add a note (drag to set its length), drag a note to move
// it, drag its right edge to resize, double-click or right-click to delete. With
// Chord on, one click places a whole chord in the key. Notes of the other
// instruments in the loop show faintly behind. New notes use the instrument's
// current sound and keep it, like recorded ones.
import { state } from './state.js';
import { INSTRUMENTS, DRUMS_INDEX, DRUM_VOICES, NOTE_NAMES, LOOP_BAR_OPTIONS } from './config.js';
import { styleFor, drumName } from './styles.js';
import { transform, isKeyInScale } from './transform.js';
import { $, h } from './dom.js';

export const SNAPS = [[0.25, '1/16'], [0.5, '1/8'], [1, '1/4'], [2, '1/2'], [4, '1 bar']];
const KEY_W = 40; // piano keys / drum names on the left
const HEAD_H = 16; // bar numbers on top
const BLACK = new Set([1, 3, 6, 8, 10]);
const CENTER = { keys: 64, pad: 60, bass: 40, lead: 69 }; // where an empty roll opens, per instrument
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const copy = (events) => events.map((e) => ({ ...e }));

/** Chord tones for a clicked pitch: the Chords setting (or triads), in the key. */
export function chordAt(note, s) {
  const keyMode = s.keyMode === 'off' ? 'off' : 'snap'; // the row clicked is a real pitch, so no "easy" remap
  return transform(note, { root: s.root, scale: s.scale, keyMode, chord: s.chord === 'off' ? 'triad' : s.chord, octave: 0 });
}

export class Editor {
  constructor({ looper, engine, controller, clock, bus }) {
    Object.assign(this, { looper, engine, controller, clock, bus });
    this.panel = $('#editor');
    this.canvas = $('#editor-canvas');
    this.g = this.canvas.getContext('2d');
    this.loop = 0;
    this.inst = state.instrument;
    this.snap = 0.5;
    this.chord = false;
    this.selected = new Set();
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.center = {}; // pitch in the middle of the roll, per instrument (survives resizing)
    this.dirty = true;
    this.#controls();
    this.#pointer();
    this.#keys();
    new ResizeObserver(() => this.#resize()).observe(this.canvas.parentElement);
    const redraw = () => this.render();
    bus.on('looper', redraw);
    bus.on('loopNote', redraw);
    bus.on('state', (patch) => {
      if ('instrument' in patch && state.instrument !== this.inst) this.setInst(state.instrument); // follows what you play
      if (['root', 'scale', 'keyMode', 'styles', 'vibe'].some((k) => k in patch)) this.render();
    });
    this.#renderControls();
  }

  get lp() {
    return this.looper.loops[this.loop];
  }

  get beats() {
    return this.lp.bars * 4;
  }

  get drums() {
    return this.inst === DRUMS_INDEX;
  }

  render() {
    this.dirty = true;
    this.#renderControls();
  }

  /** Per animation frame: redraw when something changed, or while the playhead moves. */
  frame() {
    const moving = this.clock.running && this.lp.playing;
    if (this.dirty || moving || this.wasMoving) this.#draw();
    this.wasMoving = moving;
    this.dirty = false;
  }

  setLoop(i) {
    this.loop = i;
    this.center = {}; // re-centre on the new loop's notes
    this.selected.clear();
    this.render();
  }

  setInst(i) {
    this.inst = i;
    this.selected.clear();
    this.render();
  }

  // ── controls above the roll ──
  #controls() {
    const loops = $('#ed-loops');
    this.looper.loops.forEach((_, i) => loops.append(h('button', { type: 'button', 'data-loop': i, title: `Edit loop ${i + 1}`, onclick: () => this.setLoop(i) }, String(i + 1))));
    $('#ed-play').addEventListener('click', () => {
      if (this.lp.playing) this.looper.stop(this.loop);
      else this.looper.play(this.loop);
    });
    const bars = $('#ed-bars');
    LOOP_BAR_OPTIONS.forEach((b) => bars.append(h('option', { value: b }, `${b} bar${b > 1 ? 's' : ''}`)));
    bars.addEventListener('change', () => {
      if (!this.controller.setLoopBars(this.loop, Number(bars.value))) bars.value = String(this.lp.bars);
    });
    const insts = $('#ed-insts');
    INSTRUMENTS.forEach((inst, i) => insts.append(h('button', { type: 'button', 'data-inst': i, style: `--c:${inst.color}`, onclick: () => this.setInst(i) }, h('i'), inst.name)));
    const snap = $('#ed-snap');
    SNAPS.forEach(([v, label]) => snap.append(h('option', { value: v }, label)));
    snap.value = String(this.snap);
    snap.addEventListener('change', () => {
      this.snap = Number(snap.value);
      this.render();
    });
    $('#ed-chord').addEventListener('click', () => {
      this.chord = !this.chord;
      this.render();
    });
    $('#ed-big').addEventListener('click', () => this.toggleBig());
  }

  toggleBig(force) {
    const big = force ?? !this.panel.classList.contains('big');
    this.panel.classList.toggle('big', big);
    $('#ed-big').textContent = big ? '✕' : '⤢';
    $('#ed-big').title = big ? 'Back to the small editor (Esc)' : 'Bigger editor';
    if (big) this.canvas.focus();
  }

  #renderControls() {
    for (const b of $('#ed-loops').children) {
      const i = Number(b.dataset.loop);
      const l = this.looper.loops[i];
      b.classList.toggle('on', i === this.loop);
      b.classList.toggle('has-notes', l.events.length > 0);
      b.classList.toggle('playing', l.playing && l.events.length > 0);
    }
    for (const b of $('#ed-insts').children) b.classList.toggle('on', Number(b.dataset.inst) === this.inst);
    const play = $('#ed-play');
    play.textContent = this.lp.playing ? '■' : '▶';
    play.disabled = !this.lp.events.length;
    const bars = $('#ed-bars');
    bars.value = String(this.lp.bars);
    bars.disabled = !this.looper.canResize(this.loop);
    bars.title = bars.disabled ? 'Clear the loop to change its length' : 'Loop length';
    $('#ed-chord').classList.toggle('on', this.chord);
    $('#ed-chord').disabled = this.drums;
    const sound = this.drums ? styleFor('drums', state.styles.drums).name : styleFor(INSTRUMENTS[this.inst].id, state.styles[INSTRUMENTS[this.inst].id]).name;
    $('#ed-sound').textContent = `new notes: ${sound}`;
    this.canvas.title = 'Click: add a note (drag for its length) · drag a note: move · its right edge: resize · double-click: delete · ⌥ drag: loudness · ⌘Z: undo · ⌘D: duplicate';
  }

  // ── geometry ──
  #resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(100, Math.floor(box.width));
    this.h = Math.max(80, Math.floor(box.height));
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  get rowH() {
    if (this.drums) return (this.h - HEAD_H) / DRUM_VOICES.length;
    return this.panel.classList.contains('big') ? 15 : 11;
  }

  get rows() {
    if (!this.h) return 0; // not laid out yet
    return this.drums ? DRUM_VOICES.length : Math.ceil((this.h - HEAD_H) / this.rowH);
  }

  get pxb() {
    return (this.w - KEY_W) / this.beats; // pixels per beat
  }

  /** Highest pitch on screen. The roll opens around the instrument's notes (or a comfortable range). */
  get topNote() {
    if (this.center[this.inst] === undefined) {
      const mine = this.lp.events.filter((e) => e.inst === this.inst).map((e) => e.note);
      this.center[this.inst] = mine.length ? Math.round((Math.min(...mine) + Math.max(...mine)) / 2) : CENTER[INSTRUMENTS[this.inst].id] ?? 60;
    }
    return clamp(this.center[this.inst] + Math.floor(this.rows / 2), this.rows - 1, 127);
  }

  #rowOf(note) {
    return this.drums ? DRUM_VOICES.findIndex((v) => v.note === note) : this.topNote - note;
  }

  #noteAt(row) {
    return this.drums ? DRUM_VOICES[clamp(row, 0, DRUM_VOICES.length - 1)].note : clamp(this.topNote - row, 0, 127);
  }

  #local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  #beatAt(x) {
    return (x - KEY_W) / this.pxb;
  }

  #rowAt(y) {
    return Math.floor((y - HEAD_H) / this.rowH);
  }

  #noteWidth(ev) {
    return Math.max(this.drums ? 0.25 : ev.dur, 0.06) * this.pxb;
  }

  /** The note of this instrument under the pointer (and whether it's on its right edge). */
  #hit({ x, y }) {
    const row = this.#rowAt(y);
    const mine = this.lp.events.filter((e) => e.inst === this.inst);
    for (let k = mine.length - 1; k >= 0; k--) {
      const ev = mine[k];
      if (this.#rowOf(ev.note) !== row) continue;
      const x0 = KEY_W + ev.pos * this.pxb;
      const w = this.#noteWidth(ev);
      if (x >= x0 && x <= x0 + w) return { ev, edge: !this.drums && x > x0 + w - Math.max(4, Math.min(10, w / 3)) };
    }
    return null;
  }

  // ── drawing ──
  #draw() {
    if (!this.w) return;
    const { g, w, h: H } = this;
    const rowH = this.rowH;
    const pxb = this.pxb;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8ec5ff';
    g.clearRect(0, 0, w, H);
    g.fillStyle = '#0b0b13';
    g.fillRect(0, 0, w, H);

    // Rows: black-key rows darker, notes of the key tinted, a line under each C.
    for (let r = 0; r < this.rows; r++) {
      const y = HEAD_H + r * rowH;
      const note = this.#noteAt(r);
      if (this.drums) {
        g.fillStyle = r % 2 ? '#0e0e17' : '#12121c';
      } else {
        g.fillStyle = BLACK.has(note % 12) ? '#0d0d15' : '#13131d';
      }
      g.fillRect(KEY_W, y, w - KEY_W, rowH);
      if (!this.drums && state.keyMode !== 'off' && isKeyInScale(note, state)) {
        g.fillStyle = 'rgba(255,255,255,0.035)';
        g.fillRect(KEY_W, y, w - KEY_W, rowH);
      }
      if (!this.drums && note % 12 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(KEY_W, y + rowH - 1, w - KEY_W, 1);
      }
    }

    // Beat grid.
    const step = pxb * 0.25 >= 5 ? 0.25 : pxb * 0.5 >= 5 ? 0.5 : 1;
    for (let b = 0; b <= this.beats + 1e-6; b += step) {
      const x = Math.round(KEY_W + b * pxb) + 0.5;
      g.fillStyle = b % 4 === 0 ? 'rgba(255,255,255,0.2)' : b % 1 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.035)';
      g.fillRect(x, HEAD_H, 1, H - HEAD_H);
    }
    // Snap grid, if coarser than a beat (shows where clicks land).
    if (this.snap > 1) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let b = 0; b < this.beats; b += this.snap * 2) g.fillRect(KEY_W + (b + this.snap) * pxb, HEAD_H, this.snap * pxb, H - HEAD_H);
    }

    // Bar numbers.
    g.fillStyle = '#0f0f18';
    g.fillRect(0, 0, w, HEAD_H);
    g.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let bar = 0; bar < this.lp.bars; bar++) {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillText(String(bar + 1), KEY_W + bar * 4 * pxb + 4, HEAD_H / 2);
    }

    // Other instruments' notes, faint (melodic view only).
    if (!this.drums) {
      for (const ev of this.lp.events) {
        if (ev.inst === this.inst || ev.inst === DRUMS_INDEX) continue;
        const r = this.#rowOf(ev.note);
        if (r < 0 || r >= this.rows) continue;
        g.fillStyle = INSTRUMENTS[ev.inst].color;
        g.globalAlpha = 0.16;
        g.fillRect(KEY_W + ev.pos * pxb, HEAD_H + r * rowH + 1, Math.max(2, ev.dur * pxb), rowH - 2);
        g.globalAlpha = 1;
      }
    }

    // This instrument's notes.
    const color = INSTRUMENTS[this.inst].color;
    let above = 0;
    let below = 0;
    for (const ev of this.lp.events) {
      if (ev.inst !== this.inst) continue;
      const r = this.#rowOf(ev.note);
      if (r < 0) {
        above++;
        continue;
      }
      if (r >= this.rows) {
        below++;
        continue;
      }
      const x = KEY_W + ev.pos * pxb;
      const y = HEAD_H + r * rowH + 1;
      const nw = Math.max(3, this.#noteWidth(ev) - 1);
      const nh = rowH - 2;
      g.globalAlpha = 0.45 + 0.55 * clamp(ev.vel, 0, 1);
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x, y, nw, nh, Math.min(3, nh / 2));
      g.fill();
      g.globalAlpha = 1;
      if (this.selected.has(ev)) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.5;
        g.stroke();
      }
      if (!this.drums && nw > 28 && nh >= 10) {
        g.fillStyle = 'rgba(10,8,20,0.85)';
        g.font = `700 ${Math.min(10, nh - 2)}px ui-sans-serif, system-ui, sans-serif`;
        g.fillText(noteName(ev.note), x + 3, y + nh / 2 + 0.5);
      }
    }
    // Notes scrolled out of view: a hint at the edge.
    g.fillStyle = color;
    g.font = '700 9px ui-sans-serif, system-ui, sans-serif';
    if (above) g.fillText(`▲ ${above}`, w - 30, HEAD_H + 8);
    if (below) g.fillText(`▼ ${below}`, w - 30, H - 6);

    // Keyboard / drum names.
    for (let r = 0; r < this.rows; r++) {
      const y = HEAD_H + r * rowH;
      const note = this.#noteAt(r);
      if (this.drums) {
        g.fillStyle = r % 2 ? '#191925' : '#1e1e2b';
        g.fillRect(0, y, KEY_W, rowH);
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.font = '600 9px ui-sans-serif, system-ui, sans-serif';
        g.fillText(drumName(styleFor('drums', state.styles.drums), r).slice(0, 7), 4, y + rowH / 2);
      } else {
        const black = BLACK.has(note % 12);
        g.fillStyle = black ? '#1b1a26' : '#d9d7e6';
        g.fillRect(0, y, KEY_W - 1, rowH - (black ? 0 : 1));
        if (note % 12 === 0 || rowH >= 14) {
          g.fillStyle = black ? 'rgba(255,255,255,0.6)' : '#1b1a26';
          g.font = `600 ${Math.min(9, rowH - 2)}px ui-sans-serif, system-ui, sans-serif`;
          g.fillText(noteName(note), 3, y + rowH / 2);
        }
      }
    }
    g.fillStyle = accent;
    g.globalAlpha = 0.5;
    g.fillRect(KEY_W - 1, HEAD_H, 1, H - HEAD_H);
    g.globalAlpha = 1;

    // Playhead.
    if (this.clock.running && this.lp.playing && this.lp.events.length) {
      const x = KEY_W + this.looper.phase(this.loop) * this.beats * pxb;
      g.fillStyle = '#ffffff';
      g.fillRect(Math.round(x), HEAD_H, 1.5, H - HEAD_H);
    }

    if (!this.lp.events.some((e) => e.inst === this.inst)) {
      g.fillStyle = 'rgba(255,255,255,0.32)';
      g.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(`Click to add ${INSTRUMENTS[this.inst].name.toLowerCase()} notes to loop ${this.loop + 1}`, KEY_W + (w - KEY_W) / 2, HEAD_H + (H - HEAD_H) / 2);
      g.textAlign = 'start';
    }
  }

  // ── editing ──
  #styleNow() {
    return state.styles[INSTRUMENTS[this.inst].id];
  }

  #audition(note, vel = 0.8, style = this.#styleNow()) {
    const now = this.clock.ctx.currentTime;
    this.engine.playNote(this.inst, note, vel, now, now + (this.drums ? 0.1 : 0.35), style);
  }

  #checkpoint() {
    this.undoStack.push({ loop: this.loop, events: copy(this.lp.events) });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  #commit() {
    this.looper.touch(this.loop);
    this.render();
  }

  #restore(from, to) {
    const entry = from.pop();
    if (!entry) return;
    to.push({ loop: entry.loop, events: copy(this.looper.loops[entry.loop].events) });
    this.looper.setEvents(entry.loop, entry.events);
    if (entry.loop !== this.loop) this.loop = entry.loop;
    this.selected.clear();
    this.render();
  }

  undo() {
    this.#restore(this.undoStack, this.redoStack);
  }

  redo() {
    this.#restore(this.redoStack, this.undoStack);
  }

  remove(evs) {
    if (!evs.length) return;
    this.#checkpoint();
    const gone = new Set(evs);
    this.lp.events = this.lp.events.filter((e) => !gone.has(e));
    for (const e of evs) this.selected.delete(e);
    this.#commit();
  }

  /** Add notes (they play from the loop's next pass). */
  add(notes, pos, dur, vel) {
    const evs = notes.map((note) => ({
      pos, dur: this.drums ? 0.1 : dur, inst: this.inst, note, vel, style: this.drums ? state.styles.drums : this.#styleNow(), recordedAt: -Infinity,
    }));
    this.lp.events.push(...evs);
    return evs;
  }

  #pointer() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this.#down(e));
    cv.addEventListener('pointermove', (e) => this.#move(e));
    cv.addEventListener('pointerup', () => this.#up());
    cv.addEventListener('pointercancel', () => this.#up());
    cv.addEventListener('dblclick', (e) => {
      const hit = this.#hit(this.#local(e));
      if (hit) this.remove([hit.ev]);
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hit = this.#hit(this.#local(e));
      if (hit) this.remove(this.selected.has(hit.ev) ? [...this.selected] : [hit.ev]);
    });
    cv.addEventListener('wheel', (e) => {
      if (this.drums) return;
      e.preventDefault();
      const rows = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 30));
      const half = Math.floor(this.rows / 2);
      this.center[this.inst] = clamp(this.topNote - rows - half, this.rows - 1 - half, 127 - half);
      this.dirty = true;
    }, { passive: false });
  }

  #down(e) {
    const p = this.#local(e);
    if (p.y < HEAD_H) return;
    const row = this.#rowAt(p.y);
    if (p.x < KEY_W) {
      this.#audition(this.#noteAt(row)); // the keyboard on the left just plays
      return;
    }
    this.canvas.focus();
    try {
      this.canvas.setPointerCapture(e.pointerId); // keep dragging even outside the roll
    } catch {
      /* not a real pointer (tests) */
    }
    const before = copy(this.lp.events);
    const hit = this.#hit(p);
    if (hit) {
      if (e.shiftKey) {
        if (this.selected.has(hit.ev)) this.selected.delete(hit.ev);
        else this.selected.add(hit.ev);
      } else if (!this.selected.has(hit.ev)) {
        this.selected = new Set([hit.ev]);
      }
      const evs = [...this.selected];
      const mode = e.altKey ? 'vel' : hit.edge ? 'resize' : 'move';
      this.drag = { mode, evs, before, x0: p.x, y0: p.y, b0: this.#beatAt(p.x), r0: row, orig: evs.map((ev) => ({ ...ev })), changed: false };
      if (mode === 'move') this.#audition(hit.ev.note, hit.ev.vel, hit.ev.style);
    } else {
      const pos = clamp(Math.floor(this.#beatAt(p.x) / this.snap) * this.snap, 0, this.beats - this.snap);
      const note = this.#noteAt(row);
      const notes = this.chord && !this.drums ? chordAt(note, state) : [note];
      const vel = e.shiftKey ? 1 : 0.8;
      const evs = this.add(notes, pos, Math.min(this.snap, this.beats - pos), vel);
      this.selected = new Set(evs);
      this.drag = { mode: 'create', evs, before, b0: pos, changed: true };
      for (const n of notes) this.#audition(n, vel);
    }
    this.dirty = true;
  }

  #move(e) {
    const p = this.#local(e);
    const d = this.drag;
    if (!d) {
      const hit = p.x > KEY_W && p.y > HEAD_H ? this.#hit(p) : null;
      this.canvas.style.cursor = !hit ? (p.x > KEY_W ? 'crosshair' : 'pointer') : hit.edge ? 'ew-resize' : 'grab';
      return;
    }
    const snapSteps = (beats) => Math.round(beats / this.snap) * this.snap;
    if (d.mode === 'create') {
      if (this.drums) return;
      const end = Math.ceil(this.#beatAt(p.x) / this.snap) * this.snap;
      const dur = clamp(end - d.b0, this.snap, this.beats - d.b0);
      for (const ev of d.evs) ev.dur = dur;
    } else if (d.mode === 'move') {
      const db = snapSteps(this.#beatAt(p.x) - d.b0);
      const dr = this.#rowAt(p.y) - d.r0;
      const minPos = Math.min(...d.orig.map((o) => o.pos));
      const maxEnd = Math.max(...d.orig.map((o) => o.pos + (this.drums ? 0.25 : o.dur)));
      const shift = clamp(db, -minPos, this.beats - maxEnd);
      d.evs.forEach((ev, k) => {
        const o = d.orig[k];
        ev.pos = o.pos + shift;
        if (this.drums) ev.note = DRUM_VOICES[clamp(this.#rowOf(o.note) + dr, 0, DRUM_VOICES.length - 1)].note;
        else ev.note = clamp(o.note - dr, 0, 127);
        ev.recordedAt = -Infinity;
      });
      const lead = d.evs[0];
      if (lead && lead.note !== d.lastNote) {
        if (d.lastNote !== undefined) this.#audition(lead.note, lead.vel, lead.style);
        d.lastNote = lead.note;
      }
      d.changed ||= shift !== 0 || dr !== 0;
    } else if (d.mode === 'resize') {
      const db = snapSteps(this.#beatAt(p.x) - d.b0);
      d.evs.forEach((ev, k) => {
        const o = d.orig[k];
        ev.dur = clamp(o.dur + db, Math.min(this.snap, o.dur), this.beats - o.pos);
      });
      d.changed ||= db !== 0;
    } else if (d.mode === 'vel') {
      const dv = (d.y0 - p.y) / 120;
      d.evs.forEach((ev, k) => (ev.vel = clamp(d.orig[k].vel + dv, 0.05, 1)));
      d.changed ||= Math.abs(dv) > 0.01;
    }
    this.dirty = true;
  }

  #up() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.changed) {
      this.undoStack.push({ loop: this.loop, events: d.before });
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack.length = 0;
      this.#commit();
    } else {
      this.dirty = true;
    }
  }

  #keys() {
    this.canvas.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const sel = [...this.selected];
      let handled = true;
      if (mod && key === 'z') {
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && key === 'a') {
        this.selected = new Set(this.lp.events.filter((ev) => ev.inst === this.inst));
        this.dirty = true;
      } else if (mod && key === 'd' && sel.length) {
        // Duplicate: a copy right after the selection.
        const start = Math.min(...sel.map((ev) => ev.pos));
        const end = Math.max(...sel.map((ev) => ev.pos + ev.dur));
        const span = Math.ceil((end - start) / this.snap) * this.snap;
        if (end + span <= this.beats + 1e-6) {
          this.#checkpoint();
          const copies = sel.map((ev) => ({ ...ev, pos: ev.pos + span, recordedAt: -Infinity }));
          this.lp.events.push(...copies);
          this.selected = new Set(copies);
          this.#commit();
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        this.remove(sel);
      } else if (e.key === 'Escape') {
        if (this.panel.classList.contains('big')) this.toggleBig(false);
        else this.selected.clear();
        this.dirty = true;
      } else if (e.key.startsWith('Arrow') && sel.length && !mod) {
        this.#checkpoint();
        const dx = { ArrowLeft: -this.snap, ArrowRight: this.snap }[e.key] ?? 0;
        const dy = { ArrowUp: 1, ArrowDown: -1 }[e.key] ?? 0;
        for (const ev of sel) {
          ev.pos = clamp(ev.pos + dx, 0, this.beats - Math.min(ev.dur, this.beats));
          if (this.drums) ev.note = DRUM_VOICES[clamp(this.#rowOf(ev.note) - dy, 0, DRUM_VOICES.length - 1)].note;
          else ev.note = clamp(ev.note + dy * (e.shiftKey ? 12 : 1), 0, 127);
          ev.recordedAt = -Infinity;
        }
        if (dy) this.#audition(sel[0].note, sel[0].vel, sel[0].style);
        this.#commit();
      } else {
        handled = false; // everything else still plays music
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }
}
