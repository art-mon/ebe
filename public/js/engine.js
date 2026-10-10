// Routes notes to whichever sound engine is active:
//   'builtin' → the Web Audio synth in this page
//   'ableton' → MIDI out (IAC Driver) on each instrument's channel
// and tells the visuals about every note, at the moment it is heard.
import { INSTRUMENTS, FX_CHANNEL, FX_CC_BASE } from './config.js';

export class Engine {
  constructor({ ctx, synth, midi, ableton, bus }) {
    this.ctx = ctx;
    this.synth = synth;
    this.midi = midi;
    this.ableton = ableton;
    this.bus = bus;
    this.mode = 'builtin';
    this.sounding = new Map(); // "ch:note" → count, for clean all-notes-off in Ableton mode
    this.lastFxCc = [];
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.allNotesOff();
    this.mode = mode;
  }

  get toAbleton() {
    return this.mode === 'ableton';
  }

  /** Convert an AudioContext time to a performance.now() timestamp for Web MIDI. */
  #perf(audioTime) {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts?.contextTime) return ts.performanceTime + (audioTime - ts.contextTime) * 1000;
    return performance.now() + (audioTime - this.ctx.currentTime) * 1000;
  }

  #sendNote(inst, note, vel, on, at) {
    const ch = INSTRUMENTS[inst].channel - 1;
    const key = `${ch}:${note}`;
    if (on) this.sounding.set(key, (this.sounding.get(key) ?? 0) + 1);
    else if (this.sounding.has(key)) {
      const n = this.sounding.get(key) - 1;
      if (n <= 0) this.sounding.delete(key);
      else this.sounding.set(key, n);
    }
    const data = on ? [0x90 | ch, note, Math.max(1, Math.round(vel * 127))] : [0x80 | ch, note, 0];
    this.midi.send(data, at);
  }

  #visual(inst, note, vel, on, atAudioTime) {
    const delay = atAudioTime === undefined ? 0 : (atAudioTime - this.ctx.currentTime) * 1000;
    const fire = () => this.bus.emit('voice', { inst, note, vel, on });
    if (delay > 4) setTimeout(fire, delay);
    else fire();
  }

  // ── live playing ──
  noteOn(inst, note, vel) {
    if (this.toAbleton) this.#sendNote(inst, note, vel, true);
    else this.synth.noteOn(inst, note, vel);
    this.#visual(inst, note, vel, true);
  }

  noteOff(inst, note) {
    if (this.toAbleton) this.#sendNote(inst, note, 0, false);
    else this.synth.noteOff(inst, note);
    this.#visual(inst, note, 0, false);
  }

  // ── scheduled playing (looper) ──
  playNote(inst, note, vel, start, end) {
    this.#visual(inst, note, vel, true, start);
    this.#visual(inst, note, 0, false, end);
    if (!this.toAbleton) return this.synth.playNote(inst, note, vel, start, end);
    this.#sendNote(inst, note, vel, true, this.#perf(start));
    this.#sendNote(inst, note, 0, false, this.#perf(end));
    return {
      // MIDI that's already queued can't be recalled, so we chase it with a note-off.
      cancel: (now) => this.midi.send([0x80 | (INSTRUMENTS[inst].channel - 1), note, 0], this.#perf(Math.max(now, start) + 0.002)),
    };
  }

  // ── expression ──
  bend(inst, semis, raw14) {
    if (this.toAbleton) {
      const ch = INSTRUMENTS[inst].channel - 1;
      this.midi.send([0xe0 | ch, raw14 & 0x7f, (raw14 >> 7) & 0x7f]);
    } else this.synth.setBend(inst, semis);
  }

  mod(inst, value01) {
    if (this.toAbleton) this.#cc(INSTRUMENTS[inst].channel, 1, value01);
    else this.synth.setMod(inst, value01);
  }

  sustain(inst, on) {
    if (this.toAbleton) this.#cc(INSTRUMENTS[inst].channel, 64, on ? 1 : 0);
    else this.synth.setSustain(inst, on);
  }

  // ── FX / mix ──
  fx(index, value01) {
    this.synth.setFx(index, value01); // keep the built-in chain in sync either way
    if (!this.toAbleton) return;
    const v = Math.round(value01 * 127);
    if (this.lastFxCc[index] === v) return; // morphs call this every frame; only send real changes
    this.lastFxCc[index] = v;
    this.#cc(FX_CHANNEL, FX_CC_BASE + index, value01);
  }

  /** Sends every FX value (e.g. after switching to Ableton). */
  pushAllFx(values) {
    this.lastFxCc = [];
    values.forEach((v, i) => this.fx(i, v));
  }

  /** Helper for MIDI-mapping in Live: wiggle one FX CC so Live can learn it. */
  wiggleFx(index) {
    this.#cc(FX_CHANNEL, FX_CC_BASE + index, 0.25);
    setTimeout(() => this.#cc(FX_CHANNEL, FX_CC_BASE + index, 0.75), 80);
  }

  tempo(bpm) {
    this.synth.setTempo(bpm);
  }

  mute(inst, muted) {
    this.synth.setMute(inst, muted);
    this.ableton.setMute(inst, muted);
  }

  #cc(channel, num, value01) {
    this.midi.send([0xb0 | (channel - 1), num, Math.round(Math.min(1, Math.max(0, value01)) * 127)]);
  }

  allNotesOff() {
    this.synth.allNotesOff();
    for (const key of this.sounding.keys()) {
      const [ch, note] = key.split(':').map(Number);
      this.midi.send([0x80 | ch, note, 0]);
    }
    this.sounding.clear();
    if (this.toAbleton) {
      for (const inst of INSTRUMENTS) this.midi.send([0xb0 | (inst.channel - 1), 123, 0]);
    }
  }
}
