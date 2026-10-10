// Routes notes to whichever sound engine is active:
//   'builtin' → the Web Audio synth in this page
//   'ableton' → MIDI out (IAC Driver) on each instrument's channel
// and tells the visuals about every note, at the moment it is heard.
import { INSTRUMENTS, FX_CHANNEL, FX_CC_BASE, FX_MACROS, STYLE_CC, reverbDivision } from './config.js';
import { STYLES } from './styles.js';

const SPACE = FX_MACROS.findIndex((m) => m.id === 'space');

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
    this.bpm = 100;
    this.reverbBeats = reverbDivision(FX_MACROS[SPACE].def).beats;
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
  /**
   * `style` is the sound the note was recorded with: the built-in engine plays it
   * with that sound whatever the instrument is set to now. (In Live a track plays
   * one Rack chain at a time, so there the note uses the track's current sound.)
   */
  playNote(inst, note, vel, start, end, style) {
    this.#visual(inst, note, vel, true, start);
    this.#visual(inst, note, 0, false, end);
    if (!this.toAbleton) return this.synth.playNote(inst, note, vel, start, end, style);
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
    if (index === SPACE) this.reverbBeats = reverbDivision(value01).beats;
    if (!this.toAbleton) return;
    // With AbletonOSC linked to Live's Reverb, Space sets its decay in time with the
    // tempo instead of sending a CC (which can't know the tempo).
    if (index === SPACE && this.ableton.reverbSynced) {
      this.ableton.syncReverb(this.reverbBeats, this.bpm);
      return;
    }
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
    this.bpm = bpm;
    this.synth.setTempo(bpm);
    this.resyncReverb();
  }

  /**
   * Switch an instrument's sound style. Built-in: swap the patch or sampled instrument (new notes use it).
   * Ableton: send STYLE_CC on the instrument's channel — the middle of the style's fifth
   * of 0-127, so a 5-chain Instrument Rack with evenly split zones picks the right chain.
   */
  style(inst, styleId) {
    const loading = this.synth.setStyle(inst, styleId);
    if (this.toAbleton && !INSTRUMENTS[inst].isDrums) this.sendStyle(inst, styleId);
    return loading; // a promise while a sampled instrument loads, else null
  }

  /** Load a sampled sound ahead of time (a loop that uses it is about to play). */
  preloadStyle(inst, styleId) {
    this.synth.preload(inst, styleId);
  }

  /** Send the style CC (also used by the MIDI-mapping helper in Settings). */
  sendStyle(inst, styleId) {
    const list = STYLES[INSTRUMENTS[inst].id];
    if (!list) return;
    const i = Math.max(0, list.findIndex((st) => st.id === styleId));
    this.#cc(INSTRUMENTS[inst].channel, STYLE_CC, Math.min(1, ((i + 0.5) * 128) / list.length / 127));
  }

  /** Re-time Live's Reverb (no-op unless in Ableton mode with the reverb linked). */
  resyncReverb() {
    if (this.toAbleton && this.ableton.reverbSynced) this.ableton.syncReverb(this.reverbBeats, this.bpm);
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
