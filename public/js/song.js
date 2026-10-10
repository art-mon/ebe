// Song mode: plays the looper as an arrangement. The song is a row of sections
// (columns); each section lasts some bars and switches a set of loops on (one
// cell per loop). Sections change exactly on the bar, then the song repeats or
// ends. Empty columns in the middle are breaks; trailing empty columns are ignored.
import { state, set } from './state.js';

const mod = (n, m) => ((n % m) + m) % m;
export const SECTION_BARS = [1, 2, 4, 8, 16];
export const SONG_SECTIONS = 8;

export function emptySong(loopCount) {
  return {
    repeat: true,
    sections: Array.from({ length: SONG_SECTIONS }, () => ({ bars: 4, on: Array(loopCount).fill(false) })),
  };
}

export class Song {
  constructor({ clock, looper, bus }) {
    this.clock = clock;
    this.looper = looper;
    this.bus = bus;
    this.playing = false;
    this.index = -1; // current section
    this.sectionStart = 0; // beat
    this.nextAt = 0; // beat where the next section starts
    // Run before the looper in each tick, so a section's loops are switched on/off
    // before the looper schedules notes for that moment.
    clock.onTick((from, to) => this.#tick(to), true);
    bus.on('transport', ({ running }) => {
      if (!running && this.playing) {
        this.playing = false;
        this.index = -1;
        this.#changed();
      }
    });
  }

  get sections() {
    return state.song.sections;
  }

  /** Number of sections that will play: up to the last column with a ticked cell. */
  get length() {
    let n = 0;
    this.sections.forEach((s, i) => {
      if (s.on.some(Boolean)) n = i + 1;
    });
    return n;
  }

  /** 0..1 through the current section, for the progress bar. */
  progress() {
    if (!this.playing || this.index < 0) return 0;
    const len = this.sections[this.index].bars * 4;
    return Math.max(0, Math.min(1, (this.clock.beat - this.sectionStart) / len));
  }

  toggle() {
    if (this.playing) this.stop();
    else this.play();
  }

  play() {
    if (!this.length) {
      this.bus.emit('toast', 'Tick some cells in the song grid first — each column is a section, each row a loop.');
      return;
    }
    if (!this.looper.loops.some((l) => l.events.length)) {
      this.bus.emit('toast', 'Record a loop first — the song plays what’s in the looper.');
      return;
    }
    // Start on the next bar (or right away if the transport is stopped).
    let start = 0;
    if (this.clock.running) {
      const b = this.clock.beat;
      start = b < 0 ? 0 : mod(b, 4) < 0.25 ? b - mod(b, 4) : Math.ceil(b / 4) * 4;
    }
    this.playing = true;
    this.#enter(0, start);
    // Starting the clock schedules its first notes immediately, so set the song up first.
    if (!this.clock.running) this.clock.start(0);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.index = -1;
    this.looper.loops.forEach((_, i) => this.looper.stop(i));
    this.#changed();
  }

  /** Click a cell. */
  toggleCell(section, loop) {
    const sections = this.sections.map((s) => ({ ...s, on: [...s.on] }));
    sections[section].on[loop] = !sections[section].on[loop];
    set({ song: { ...state.song, sections } });
    // Editing the section that's playing right now takes effect at once (on the next note).
    if (this.playing && section === this.index) this.#apply(section, Math.max(0, this.clock.beat));
  }

  cycleBars(section, dir = 1) {
    const sections = this.sections.map((s) => ({ ...s, on: [...s.on] }));
    const cur = SECTION_BARS.indexOf(sections[section].bars);
    sections[section].bars = SECTION_BARS[mod((cur < 0 ? 1 : cur) + dir, SECTION_BARS.length)];
    set({ song: { ...state.song, sections } });
    if (this.playing && section === this.index) this.nextAt = this.sectionStart + sections[section].bars * 4;
  }

  clear() {
    this.stop();
    set({ song: { ...state.song, sections: this.sections.map((s) => ({ ...s, on: s.on.map(() => false) })) } });
  }

  #enter(index, at) {
    this.index = index;
    this.sectionStart = at;
    this.nextAt = at + this.sections[index].bars * 4;
    this.#apply(index, at);
    this.#changed();
  }

  #apply(index, at) {
    const on = this.sections[index].on;
    this.looper.loops.forEach((_, i) => this.looper.scheduleState(i, !!on[i], at));
  }

  #tick(to) {
    if (!this.playing) return;
    while (this.playing && this.nextAt < to) {
      const at = this.nextAt;
      let next = this.index + 1;
      if (next >= this.length) {
        if (!state.song.repeat || !this.length) {
          this.looper.loops.forEach((_, i) => this.looper.scheduleState(i, false, at));
          this.playing = false;
          this.index = -1;
          this.bus.emit('toast', 'Song finished');
          this.#changed();
          return;
        }
        next = 0;
      }
      this.#enter(next, at);
    }
  }

  #changed() {
    this.bus.emit('song', {});
  }
}
