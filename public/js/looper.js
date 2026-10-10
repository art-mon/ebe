// A MIDI looper: records the notes you play (after scale/chord processing)
// and replays them through the current sound engine, phase-locked to the
// transport. All loops share one length so they always line up.
import { LOOP_COUNT, DRUMS_INDEX } from './config.js';

const mod = (n, m) => ((n % m) + m) % m;
const EARLY_GRACE = 0.25; // beats: notes this early still land on the downbeat

export class Looper {
  constructor({ clock, engine, bus }) {
    this.clock = clock;
    this.engine = engine;
    this.bus = bus;
    this.bars = 2;
    this.quantize = true;
    this.loops = Array.from({ length: LOOP_COUNT }, (_, index) => ({
      index,
      events: [], // { pos, dur, inst, note, vel, recordedAt }
      playing: false,
      playFrom: 0,
      rec: null, // { start, end }
      pending: new Map(),
      handles: [],
      insts: new Set(),
    }));
    clock.onTick((from, to) => {
      this.#updateRecording();
      this.#schedule(from, to);
    });
    bus.on('transport', ({ running }) => {
      if (!running) this.#onTransportStop();
    });
  }

  get length() {
    return this.bars * 4;
  }

  get hasContent() {
    return this.loops.some((l) => l.events.length || l.rec);
  }

  setBars(bars) {
    if (this.hasContent) return false;
    this.bars = bars;
    this.#changed();
    return true;
  }

  /** 'empty' | 'armed' | 'recording' | 'overdub' | 'playing' | 'stopped' */
  status(i) {
    const l = this.loops[i];
    if (l.rec) {
      if (this.clock.beat < l.rec.start) return 'armed';
      return l.rec.overdub ? 'overdub' : 'recording';
    }
    if (!l.events.length) return 'empty';
    return l.playing ? 'playing' : 'stopped';
  }

  /** 0..1 position inside the loop cycle, for progress rings. */
  phase() {
    return this.clock.running ? mod(this.clock.beat, this.length) / this.length : 0;
  }

  /** The one-button looper gesture used by pads. */
  tap(i) {
    switch (this.status(i)) {
      case 'empty': return this.record(i);
      case 'armed': return this.cancel(i);
      case 'recording':
      case 'overdub': return this.#finish(this.loops[i]);
      case 'playing': return this.stop(i);
      case 'stopped': return this.play(i);
      default: return undefined;
    }
  }

  record(i) {
    const loop = this.loops[i];
    if (loop.rec) return;
    let start;
    if (!this.clock.running) {
      this.clock.start(4); // one bar count-in
      start = 0;
    } else {
      const b = this.clock.beat;
      if (b < 0) start = 0;
      else if (mod(b, 4) < EARLY_GRACE) start = b - mod(b, 4); // just missed the bar: forgive
      else start = Math.ceil(b / 4) * 4;
    }
    const first = !loop.events.length;
    loop.rec = { start, end: start + this.length, overdub: !first };
    if (first) {
      loop.playing = true;
      loop.playFrom = loop.rec.end;
    }
    this.#changed();
  }

  overdub(i) {
    const loop = this.loops[i];
    if (!loop.events.length || loop.rec) return;
    if (!this.clock.running) {
      this.clock.start(4);
      loop.rec = { start: 0, end: this.length, overdub: true };
    } else {
      const b = Math.max(0, this.clock.beat);
      loop.rec = { start: b, end: b + this.length, overdub: true };
    }
    if (!loop.playing) {
      loop.playing = true;
      loop.playFrom = this.clock.beat;
    }
    this.#changed();
  }

  cancel(i) {
    const loop = this.loops[i];
    if (!loop.rec) return;
    loop.rec = null;
    loop.pending.clear();
    if (!loop.events.length) loop.playing = false;
    this.#changed();
  }

  play(i) {
    const loop = this.loops[i];
    if (!loop.events.length) return;
    if (!this.clock.running) this.clock.start(0);
    loop.playing = true;
    loop.playFrom = Math.max(0, this.clock.beat);
    this.#changed();
  }

  stop(i) {
    const loop = this.loops[i];
    loop.playing = false;
    this.#cancelHandles(loop);
    this.#changed();
  }

  clear(i) {
    const loop = this.loops[i];
    this.#cancelHandles(loop);
    loop.events = [];
    loop.rec = null;
    loop.pending.clear();
    loop.playing = false;
    loop.insts.clear();
    this.#changed();
  }

  stopAll() {
    this.loops.forEach((l, i) => {
      if (l.rec) this.cancel(i);
      this.stop(i);
    });
  }

  /** Feed every played note here (after transform). */
  input({ inst, note, vel, on }) {
    if (!this.clock.running) return;
    const b = this.clock.beat;
    for (const loop of this.loops) {
      const r = loop.rec;
      if (!r || b < r.start - EARLY_GRACE || b >= r.end) continue;
      const key = inst * 128 + note;
      if (on) {
        const p = { beat: Math.max(b, r.start), inst, note, vel };
        if (inst === DRUMS_INDEX) this.#commit(loop, p, 0.1);
        else loop.pending.set(key, p);
      } else {
        const p = loop.pending.get(key);
        if (p) {
          loop.pending.delete(key);
          this.#commit(loop, p, b - p.beat);
        }
      }
    }
  }

  #commit(loop, p, dur) {
    const L = this.length;
    let pos = p.beat;
    if (this.quantize) pos = Math.round(pos * 4) / 4; // to the nearest 16th
    loop.events.push({
      pos: mod(pos, L),
      dur: Math.min(Math.max(dur, 0.05), L - 0.01),
      inst: p.inst,
      note: p.note,
      vel: p.vel,
      recordedAt: p.beat,
    });
    loop.insts.add(p.inst);
    this.bus.emit('loopNote', { loop: loop.index });
  }

  #finish(loop) {
    if (!loop.rec) return;
    const end = Math.min(loop.rec.end, Math.max(loop.rec.start, this.clock.beat));
    for (const p of loop.pending.values()) this.#commit(loop, p, end - p.beat);
    loop.pending.clear();
    const wasFirst = !loop.rec.overdub;
    loop.rec = null;
    if (!loop.events.length) loop.playing = false;
    else if (wasFirst) loop.playFrom = Math.min(loop.playFrom, Math.max(0, this.clock.beat));
    this.#changed();
  }

  #updateRecording() {
    const b = this.clock.beat;
    for (const loop of this.loops) {
      if (loop.rec && b >= loop.rec.end) this.#finish(loop);
    }
  }

  #schedule(from, to) {
    const L = this.length;
    const now = this.clock.ctx.currentTime;
    for (const loop of this.loops) {
      loop.handles = loop.handles.filter((h) => h.end > now);
      if (!loop.playing || !loop.events.length) continue;
      for (const ev of loop.events) {
        for (let abs = Math.ceil((from - ev.pos) / L) * L + ev.pos; abs < to; abs += L) {
          // Skip the pass where this note was just played live (avoids a double hit).
          if (abs < 0 || abs < loop.playFrom || abs < ev.recordedAt + L / 2) continue;
          const start = this.clock.timeAt(abs);
          const end = this.clock.timeAt(abs + ev.dur);
          const h = this.engine.playNote(ev.inst, ev.note, ev.vel, start, end);
          loop.handles.push({ ...h, end });
        }
      }
    }
  }

  #cancelHandles(loop) {
    const now = this.clock.ctx.currentTime;
    for (const h of loop.handles) h.cancel(now);
    loop.handles = [];
  }

  #onTransportStop() {
    for (const loop of this.loops) {
      if (loop.rec) this.#finish(loop);
      this.#cancelHandles(loop);
    }
    this.#changed();
  }

  #changed() {
    this.bus.emit('looper', {});
  }
}
