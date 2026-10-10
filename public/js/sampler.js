// Sampled instruments: real recordings in public/samples (credits in
// public/samples/CREDITS.md). A note plays the nearest recorded pitch, re-tuned
// with playbackRate. Sets load the first time a style needs them and are tidied
// up once: leading silence trimmed, loudness matched across instruments, a short
// fade where a recording stops abruptly, and seamless loops for sustained sounds.

const SILENCE = 0.003; // quieter than this at the start of a file counts as silence
const TARGET_RMS = 0.1; // every melodic set is levelled to this (then style.gain)
const DRUM_PEAK = 0.9; // drum hits are peak-normalised, then mixed by kit levels

// ── plain DSP on Float32Array channels (unit-tested) ──

/** Index of the first sample louder than `threshold` on any channel. */
export function leadingSilence(chs, threshold = SILENCE) {
  const len = chs[0].length;
  for (let i = 0; i < len; i++) for (const d of chs) if (Math.abs(d[i]) > threshold) return i;
  return len;
}

export function rms(chs, from = 0, to = chs[0].length) {
  let sum = 0;
  let n = 0;
  for (const d of chs) for (let i = from; i < Math.min(to, d.length); i++, n++) sum += d[i] * d[i];
  return n ? Math.sqrt(sum / n) : 0;
}

export function peak(chs) {
  let p = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  return p;
}

/**
 * Make [start, end) loop without a click: the `xf` samples before `end` fade
 * (equal power) into the ones before `start`, so jumping from end back to start
 * continues exactly where the audio would have been.
 */
export function crossfadeLoop(chs, start, end, xf) {
  const n = Math.min(xf, start, end - start);
  for (const d of chs) {
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n;
      const j = end - n + i;
      d[j] = d[j] * Math.cos((t * Math.PI) / 2) + d[start - n + i] * Math.sin((t * Math.PI) / 2);
    }
  }
}

/** Linear fade to silence over the last `n` samples. */
export function fadeOut(chs, n) {
  for (const d of chs) {
    const len = d.length;
    for (let i = 0; i < Math.min(n, len); i++) d[len - 1 - i] *= i / n;
  }
}

/** The recorded zone closest in pitch to `note` (zones sorted by note). */
export function nearestZone(zones, note) {
  let best = zones[0];
  for (const z of zones) if (Math.abs(z.note - note) < Math.abs(best.note - note)) best = z;
  return best;
}

// ── loading ──
export class SampleBank {
  #index = null;
  #sets = new Map(); // id → { promise, ready }

  constructor(ctx, base = 'samples/') {
    this.ctx = ctx;
    this.base = base;
  }

  #loadIndex() {
    this.#index ??= fetch(`${this.base}index.json`).then((r) => {
      if (!r.ok) throw new Error(`samples/index.json: ${r.status}`);
      return r.json();
    });
    return this.#index;
  }

  /** The set if it's ready, else null (it keeps loading in the background). */
  get(id) {
    return this.#sets.get(id)?.ready ?? null;
  }

  /** Load a set once. `opts` (from the style): maxSec, loop [startSec, endSec], loopFade (s). */
  load(id, opts = {}) {
    let s = this.#sets.get(id);
    if (!s) {
      s = { ready: null };
      s.promise = this.#load(id, opts).then((set) => (s.ready = set));
      s.promise.catch(() => this.#sets.delete(id)); // allow a retry later
      this.#sets.set(id, s);
    }
    return s.promise;
  }

  async #decode(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  /** Copy channels [from, from+len) into a fresh AudioBuffer we can edit. */
  #slice(buf, from, len) {
    const out = this.ctx.createBuffer(buf.numberOfChannels, Math.max(1, len), buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(from, from + len));
    return out;
  }

  #chs(buf) {
    return Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  }

  /** Drop leading silence (keeping 1 ms of run-up) and anything past maxSec. */
  #trim(buf, maxSec) {
    const sr = buf.sampleRate;
    const start = Math.max(0, leadingSilence(this.#chs(buf)) - Math.round(sr * 0.001));
    return this.#slice(buf, start, Math.min(buf.length - start, Math.round(maxSec * sr)));
  }

  async #load(id, { maxSec = 8, loop = null, loopFade = 0.3 }) {
    const entry = (await this.#loadIndex())[id];
    if (!entry) throw new Error(`no sample set "${id}"`);
    const url = (f) => `${this.base}${id}/${f}`;

    if (entry.voices) {
      // A drum kit: voice → one or more hits (round robin).
      const voices = {};
      await Promise.all(Object.entries(entry.voices).map(async ([voice, files]) => {
        voices[voice] = await Promise.all(files.map(async (f) => {
          const buf = this.#trim(await this.#decode(url(f)), 4);
          const chs = this.#chs(buf);
          const p = peak(chs) || 1;
          for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= DRUM_PEAK / p;
          fadeOut(chs, Math.round(buf.sampleRate * 0.02));
          return buf;
        }));
      }));
      return { kit: true, voices };
    }

    // Each note is one file, or [layers soft → loud][takes] for instruments recorded
    // at several loudnesses (short notes also have alternate takes).
    const asLayers = (v) => (Array.isArray(v) ? v.map((layer) => (Array.isArray(layer) ? layer : [layer])) : [[v]]);
    const keep = loop ? loop[1] + 0.05 : maxSec;
    const zones = await Promise.all(Object.entries(entry.notes).map(async ([note, v]) => ({
      note: Number(note),
      layers: await Promise.all(asLayers(v).map((takes) => Promise.all(takes.map(async (f) => ({
        buffer: this.#trim(await this.#decode(url(f)), keep),
      }))))),
    })));
    zones.sort((a, b) => a.note - b.note);

    // Level the set: each note moves halfway (in dB) from its own loudness to the
    // set's typical one, which evens out uneven recordings but keeps some of the
    // instrument's natural balance across its range. A note's loudness is its
    // loudest recording; softer layers keep their natural difference.
    const sr = zones[0].layers[0][0].buffer.sampleRate;
    const level = (z) => rms(this.#chs(z.layers.at(-1)[0].buffer), 0, Math.round(sr * 0.5)) || 1e-4;
    const sorted = zones.map(level).sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)];

    for (const z of zones) {
      const gain = TARGET_RMS / Math.sqrt(typical * level(z));
      for (const take of z.layers.flat()) {
        const chs = this.#chs(take.buffer);
        for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= gain;
        if (loop) {
          const start = Math.round(loop[0] * sr);
          const end = Math.min(take.buffer.length - 1, Math.round(loop[1] * sr));
          crossfadeLoop(chs, start, end, Math.round(sr * loopFade));
          take.loop = { start: start / sr, end: end / sr };
        } else {
          fadeOut(chs, Math.round(sr * 0.08)); // many recordings stop abruptly
        }
      }
    }
    return { zones };
  }
}
