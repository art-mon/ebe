// A MIDI looper: records the notes you play (after scale/chord processing)
// and replays them through the current sound engine, phase-locked to the
// transport. Each loop has its own length (1, 2, 4 or 8 bars); since every
// length divides 8 bars, loops of different lengths always line up.
import { LOOP_COUNT, LOOP_BAR_OPTIONS, DRUMS_INDEX } from './config.js';

const mod = (n, m) => ((n % m) + m) % m;
const EARLY_GRACE = 0.25; // beats: notes this early still land on the downbeat

export class Looper {
  constructor({ clock, engine, bus }) {
    this.clock = clock;
    this.engine = engine;
    this.bus = bus;
    this.quantize = true;
    this.loops = Array.from({ length: LOOP_COUNT }, (_, index) => ({
      index,
      bars: 2,
      events: [], // { pos, dur, inst, note, vel, style, recordedAt } — style = the sound it was played with
      playing: false,
      playFrom: 0,
      stopAt: Infinity, // a beat where a playing loop will stop (the song schedules these)
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

  /** Loop length in beats. */
  lengthOf(loop) {
    return loop.bars * 4;
  }

  /** A loop's length can change only while it's empty (and not about to record). */
  canResize(i) {
    const l = this.loops[i];
    return !l.events.length && !l.rec;
  }

  setLoopBars(i, bars) {
    if (!this.canResize(i) || !LOOP_BAR_OPTIONS.includes(bars)) return false;
    this.loops[i].bars = bars;
    this.#changed();
    return true;
  }

  cycleLoopBars(i) {
    const next = LOOP_BAR_OPTIONS[(LOOP_BAR_OPTIONS.indexOf(this.loops[i].bars) + 1) % LOOP_BAR_OPTIONS.length];
    return this.setLoopBars(i, next) ? next : null;
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

  /** 0..1 position inside a loop's cycle, for progress rings. */
  phase(i) {
    const L = this.lengthOf(this.loops[i]);
    return this.clock.running ? mod(this.clock.beat, L) / L : 0;
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
    loop.rec = { start, end: start + this.lengthOf(loop), overdub: !first };
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
      loop.rec = { start: 0, end: this.lengthOf(loop), overdub: true };
    } else {
      const b = Math.max(0, this.clock.beat);
      loop.rec = { start: b, end: b + this.lengthOf(loop), overdub: true };
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
    loop.stopAt = Infinity;
    this.#changed();
  }

  stop(i) {
    const loop = this.loops[i];
    loop.playing = false;
    loop.stopAt = Infinity;
    this.#cancelHandles(loop);
    this.#changed();
  }

  /**
   * Turn a loop on or off exactly at a future beat (used by the song, so changes
   * land on the bar). A loop that's already in the right state is left alone.
   */
  scheduleState(i, on, at) {
    const loop = this.loops[i];
    if (on) {
      if (!loop.events.length) return;
      if (loop.playing && loop.stopAt === Infinity) return;
      if (!loop.playing) loop.playFrom = at;
      loop.playing = true;
      loop.stopAt = Infinity;
    } else if (loop.playing && loop.stopAt === Infinity) {
      loop.stopAt = at;
    } else return;
    this.#changed();
  }

  clear(i) {
    const loop = this.loops[i];
    this.#cancelHandles(loop);
    loop.events = [];
    loop.rec = null;
    loop.pending.clear();
    loop.playing = false;
    loop.stopAt = Infinity;
    loop.insts.clear();
    this.#changed();
  }

  /** Replace a loop's contents (opening a saved track). It stays stopped until played. */
  load(i, { bars, events = [] }) {
    const loop = this.loops[i];
    this.#cancelHandles(loop);
    loop.rec = null;
    loop.pending.clear();
    loop.playing = false;
    loop.stopAt = Infinity;
    loop.playFrom = 0;
    if (LOOP_BAR_OPTIONS.includes(bars)) loop.bars = bars;
    loop.events = events.map((e) => ({ pos: e.pos, dur: e.dur, inst: e.inst, note: e.note, vel: e.vel, style: e.style, recordedAt: -Infinity }));
    loop.insts = new Set(loop.events.map((e) => e.inst));
    // Get every sound this loop uses ready before it plays (sampled ones load once).
    for (const key of new Set(loop.events.map((e) => `${e.inst}|${e.style ?? ''}`))) {
      const [inst, style] = key.split('|');
      if (style) this.engine.preloadStyle?.(Number(inst), style);
    }
    this.#changed();
  }

  /** The editor changed a loop's notes in place: refresh what depends on them. */
  touch(i) {
    const loop = this.loops[i];
    loop.insts = new Set(loop.events.map((e) => e.inst));
    if (!loop.events.length && !loop.rec) loop.playing = false;
    this.#changed();
  }

  /** Replace a loop's notes (the editor's undo / redo). A playing loop picks them up on its next notes. */
  setEvents(i, events) {
    this.loops[i].events = events.map((e) => ({ ...e, recordedAt: -Infinity }));
    this.touch(i);
  }

  stopAll() {
    this.loops.forEach((l, i) => {
      if (l.rec) this.cancel(i);
      this.stop(i);
    });
  }

  /** Feed every played note here (after transform). */
  input({ inst, note, vel, on, style }) {
    if (!this.clock.running) return;
    const b = this.clock.beat;
    for (const loop of this.loops) {
      const r = loop.rec;
      if (!r || b < r.start - EARLY_GRACE || b >= r.end) continue;
      const key = inst * 128 + note;
      if (on) {
        const p = { beat: Math.max(b, r.start), inst, note, vel, style };
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
    const L = this.lengthOf(loop);
    let pos = p.beat;
    if (this.quantize) pos = Math.round(pos * 4) / 4; // to the nearest 16th
    loop.events.push({
      pos: mod(pos, L),
      dur: Math.min(Math.max(dur, 0.05), L - 0.01),
      inst: p.inst,
      note: p.note,
      vel: p.vel,
      style: p.style,
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
      // "Get ready" → "recording" happens on the bar: say so, or the loop card keeps waiting.
      if (loop.rec && !loop.rec.started && b >= loop.rec.start) {
        loop.rec.started = true;
        this.#changed();
      }
      if (loop.rec && b >= loop.rec.end) this.#finish(loop);
      if (loop.playing && b >= loop.stopAt) {
        loop.playing = false;
        loop.stopAt = Infinity;
        this.#changed();
      }
    }
  }

  #schedule(from, to) {
    const now = this.clock.ctx.currentTime;
    for (const loop of this.loops) {
      loop.handles = loop.handles.filter((h) => h.end > now);
      if (!loop.playing || !loop.events.length) continue;
      const L = this.lengthOf(loop);
      for (const ev of loop.events) {
        for (let abs = Math.ceil((from - ev.pos) / L) * L + ev.pos; abs < to; abs += L) {
          // Skip the pass where this note was just played live (avoids a double hit).
          if (abs < 0 || abs < loop.playFrom || abs >= loop.stopAt || abs < ev.recordedAt + L / 2) continue;
          const start = this.clock.timeAt(abs);
          const end = this.clock.timeAt(abs + ev.dur);
          const h = this.engine.playNote(ev.inst, ev.note, ev.vel, start, end, ev.style);
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
      // The beat counter starts again from 0 on the next Play, so forget beats from
      // this run — otherwise loops stay silent until the counter catches up again.
      loop.playFrom = 0;
      if (loop.stopAt !== Infinity) loop.playing = false;
      loop.stopAt = Infinity;
      for (const ev of loop.events) ev.recordedAt = -Infinity;
    }
    this.#changed();
  }

  #changed() {
    this.bus.emit('looper', {});
  }
}
