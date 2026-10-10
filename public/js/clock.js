// Sample-accurate transport using the classic look-ahead scheduler: a timer
// wakes up every 25 ms and schedules anything due in the next ~120 ms on the
// AudioContext clock. Beat 0 is the first downbeat; a count-in runs at
// negative beats.

import { every } from './ticker.js';

const mod = (n, m) => ((n % m) + m) % m;

export class Clock {
  constructor(ctx, bus) {
    this.ctx = ctx;
    this.bus = bus;
    this.bpm = 100;
    this.running = false;
    this.startTime = 0;
    this.lookahead = 0.12;
    this.scheduledUntil = 0;
    this.metronome = true;
    this.onClick = null; // (time, accent) => void
    this.tickers = new Set();
    this.earlyTickers = new Set(); // run first in each tick (the song decides what plays before the looper schedules)
    this.stopTimer = null;
  }

  get spb() {
    return 60 / this.bpm;
  }

  beatAt(time) {
    return (time - this.startTime) / this.spb;
  }

  timeAt(beat) {
    return this.startTime + beat * this.spb;
  }

  /** Current beat (fractional). 0 when stopped. */
  get beat() {
    return this.running ? this.beatAt(this.ctx.currentTime) : 0;
  }

  /** Called every tick with the beat window [from, to) that needs scheduling. */
  onTick(fn, early = false) {
    (early ? this.earlyTickers : this.tickers).add(fn);
  }

  start(countInBeats = 0) {
    if (this.running) return;
    this.startTime = this.ctx.currentTime + 0.06 + countInBeats * this.spb;
    this.scheduledUntil = -countInBeats;
    this.running = true;
    this.stopTimer = every(25, () => this.#tick());
    this.#tick();
    this.bus.emit('transport', { running: true, countIn: countInBeats });
  }

  stop() {
    if (!this.running) return;
    this.stopTimer?.();
    this.stopTimer = null;
    this.running = false;
    this.bus.emit('transport', { running: false });
  }

  setBpm(bpm) {
    bpm = Math.max(40, Math.min(220, Math.round(bpm * 10) / 10));
    if (this.running) {
      const b = this.beat;
      this.bpm = bpm;
      this.startTime = this.ctx.currentTime - b * this.spb;
    } else {
      this.bpm = bpm;
    }
    return bpm;
  }

  #tick() {
    const now = this.ctx.currentTime;
    const until = this.beatAt(now + this.lookahead);
    if (until <= this.scheduledUntil) return;
    const from = this.scheduledUntil;
    this.scheduledUntil = until;

    for (let b = Math.ceil(from); b < until; b++) {
      const time = this.timeAt(b);
      const downbeat = mod(b, 4) === 0;
      const countIn = b < 0;
      if ((countIn || this.metronome) && this.onClick) this.onClick(time, downbeat);
      setTimeout(
        () => this.running && this.bus.emit('beat', { beat: b, downbeat, countIn }),
        Math.max(0, (time - now) * 1000),
      );
    }
    for (const fn of this.earlyTickers) fn(from, until);
    for (const fn of this.tickers) fn(from, until);
  }
}
