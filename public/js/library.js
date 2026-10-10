// Your tracks. A track is the whole session: the 8 loops (notes + lengths), the
// song grid and the sound settings (tempo, key, vibe, styles, FX…). Tracks are
// saved by Lumen's server as files in ~/Music/Lumen/Tracks; the current session
// is also autosaved, so a reload never loses your loops.
import { state, set } from './state.js';
import { DEFAULT_STYLES } from './styles.js';
import { vibeSetOf } from './config.js';

// Settings that belong to a track (personal preferences like the MIDI ports,
// controller mappings or the metronome sound don't travel with it).
const SETTINGS = ['tempo', 'root', 'scale', 'keyMode', 'chord', 'vibe', 'instrument', 'layer', 'layerOn', 'fx', 'styles', 'visual'];
const WATCH = new Set([...SETTINGS, 'song', 'loopBars']);
export const TRACK_VERSION = 2; // 2: real (sampled) instruments and drum kits

// The default sounds before real instruments existed. In older tracks these were
// most likely never chosen on purpose, so they open with today's defaults instead.
const OLD_DEFAULT_STYLES = { keys: 'epiano', pad: 'warm', bass: 'sub', lead: 'saw' };

/** A track's styles, brought up to date (missing instruments get their default). */
export function trackStyles(track) {
  const styles = { ...DEFAULT_STYLES, ...track.settings?.styles };
  if ((track.version ?? 1) < 2) {
    for (const [inst, id] of Object.entries(OLD_DEFAULT_STYLES)) if (styles[inst] === id) styles[inst] = DEFAULT_STYLES[inst];
  }
  return styles;
}

const clone = (v) => structuredClone(v);

/** The session as plain data (no id/name). */
export function snapshot(looper) {
  return {
    version: TRACK_VERSION,
    settings: Object.fromEntries(SETTINGS.map((k) => [k, clone(state[k])])),
    song: clone(state.song),
    loops: looper.loops.map((l) => ({
      bars: l.bars,
      events: l.events.map(({ pos, dur, inst, note, vel }) => ({ pos, dur, inst, note, vel })),
    })),
  };
}

/** "Night Drive!" → "night-drive-3f9a" */
export function makeId(name) {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'track';
  return `${slug}-${Math.random().toString(16).slice(2, 6)}`;
}

export class Library {
  constructor({ bus, looper, clock, controller }) {
    this.bus = bus;
    this.looper = looper;
    this.clock = clock;
    this.controller = controller;
    this.current = { id: null, name: 'Untitled track', created: null };
    this.savedSig = JSON.stringify(snapshot(looper));
    this.dirty = false;
    this.loading = false;
    this.available = false; // set by init(): an old Lumen server still running has no track API
    this.dir = '';
    this.checkTimer = 0;
    this.draftTimer = 0;
    const check = () => this.#scheduleCheck();
    bus.on('looper', check);
    bus.on('loopNote', check);
    bus.on('state', (patch) => {
      if (Object.keys(patch).some((k) => WATCH.has(k))) check();
    });
  }

  async #api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error ?? res.statusText), { status: res.status });
    return res.status === 204 ? null : res.json();
  }

  /** Ask the server where tracks live, then bring back last session's loops. Returns true if there were any. */
  async init() {
    try {
      this.dir = (await this.#api('GET', '/api/info')).dir;
      this.available = true;
    } catch {
      this.available = false;
      this.#emit();
      return false;
    }
    return this.restoreDraft();
  }

  list() {
    return this.#api('GET', '/api/tracks');
  }

  /** Anything worth keeping in the session? */
  hasContent() {
    return this.looper.loops.some((l) => l.events.length);
  }

  /** Save the session over the open track; an untitled session (or asNew) becomes a new track. */
  async save(name, asNew = false) {
    const isNew = asNew || !this.current.id;
    const now = Date.now();
    const track = {
      id: isNew ? makeId(name ?? this.current.name) : this.current.id,
      name: name ?? this.current.name,
      created: isNew ? now : this.current.created ?? now,
      updated: now,
      ...snapshot(this.looper),
    };
    await this.#api('PUT', `/api/tracks/${track.id}`, track);
    this.current = { id: track.id, name: track.name, created: track.created };
    this.savedSig = JSON.stringify(snapshot(this.looper));
    this.dirty = false;
    this.#saveDraft();
    this.#emit();
    return track;
  }

  async open(id) {
    const track = await this.#api('GET', `/api/tracks/${id}`);
    this.apply(track);
    this.current = { id: track.id, name: track.name, created: track.created };
    this.savedSig = JSON.stringify(snapshot(this.looper));
    this.dirty = false;
    this.#saveDraft();
    this.#emit();
    return track;
  }

  /** Put a track's loops, song and settings in place (transport stops). */
  apply(track) {
    this.loading = true;
    try {
      if (this.clock.running) this.clock.stop();
      const s = track.settings ?? {};
      track.loops?.forEach((l, i) => i < this.looper.loops.length && this.looper.load(i, l));
      const patch = {};
      for (const k of SETTINGS) if (k in s && k !== 'fx' && k !== 'tempo') patch[k] = clone(s[k]);
      patch.styles = trackStyles(track);
      if (typeof s.vibe === 'number') patch.vibeSet = vibeSetOf(s.vibe);
      if (track.song) patch.song = clone(track.song);
      patch.loopBars = this.looper.loops.map((l) => l.bars);
      if (typeof s.tempo === 'number') patch.tempo = this.clock.setBpm(s.tempo);
      set(patch);
      // Straight to the saved values (no morph), so the track reads as saved right away.
      if (Array.isArray(s.fx)) this.controller.morphFx(s.fx, 0);
    } finally {
      this.loading = false;
    }
  }

  async rename(id, name) {
    const track = await this.#api('GET', `/api/tracks/${id}`);
    track.name = name;
    track.updated = Date.now();
    await this.#api('PUT', `/api/tracks/${id}`, track);
    if (this.current.id === id) {
      this.current.name = name;
      this.#saveDraft();
    }
    this.#emit();
  }

  async duplicate(id) {
    const track = await this.#api('GET', `/api/tracks/${id}`);
    const now = Date.now();
    const copy = { ...track, id: makeId(`${track.name} copy`), name: `${track.name} copy`, created: now, updated: now };
    await this.#api('PUT', `/api/tracks/${copy.id}`, copy);
    this.#emit();
    return copy;
  }

  async remove(id) {
    await this.#api('DELETE', `/api/tracks/${id}`);
    if (this.current.id === id) {
      // Keep playing what's on screen; it's just not saved anywhere now.
      this.current = { id: null, name: this.current.name, created: null };
      this.dirty = true;
      this.#saveDraft();
    }
    this.#emit();
  }

  /** Start fresh: empty loops and song; the sound settings stay. */
  newTrack(emptySong) {
    this.loading = true;
    try {
      if (this.clock.running) this.clock.stop();
      this.looper.loops.forEach((_, i) => this.looper.clear(i));
      set({ song: emptySong });
    } finally {
      this.loading = false;
    }
    this.current = { id: null, name: 'Untitled track', created: null };
    this.savedSig = JSON.stringify(snapshot(this.looper));
    this.dirty = false;
    this.#saveDraft();
    this.#emit();
  }

  /** On startup: bring back the session from last time. Returns true if it had loops. */
  async restoreDraft() {
    let draft;
    try {
      draft = await this.#api('GET', '/api/draft');
    } catch {
      return false; // no draft yet
    }
    if (!draft?.data) return false;
    this.apply(draft.data);
    this.current = { id: draft.trackId ?? null, name: draft.trackName ?? 'Untitled track', created: draft.created ?? null };
    this.savedSig = draft.savedSig ?? JSON.stringify(snapshot(this.looper));
    this.dirty = JSON.stringify(snapshot(this.looper)) !== this.savedSig;
    this.#emit();
    return draft.data.loops?.some((l) => l.events?.length) ?? false;
  }

  // ── change tracking + autosave ──
  #scheduleCheck() {
    if (this.loading) return;
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = 0;
      const sig = JSON.stringify(snapshot(this.looper));
      const dirty = sig !== this.savedSig;
      if (sig !== this.lastDraftSig) this.#saveDraft(sig);
      if (dirty !== this.dirty) {
        this.dirty = dirty;
        this.#emit();
      }
    }, 300);
  }

  #saveDraft(sig) {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.#writeDraft(sig), 1500);
  }

  #draftBody(sig) {
    const data = snapshot(this.looper);
    this.lastDraftSig = sig ?? JSON.stringify(data);
    return { trackId: this.current.id, trackName: this.current.name, created: this.current.created, savedSig: this.savedSig, data };
  }

  #writeDraft(sig) {
    if (!this.available) return;
    this.draftTimer = 0;
    this.#api('PUT', '/api/draft', this.#draftBody(sig)).catch(() => {
      /* autosave is best effort */
    });
  }

  /** The page is closing: write a pending autosave now (keepalive lets it finish after unload). */
  flushDraft() {
    if (!this.available || (!this.draftTimer && !this.checkTimer)) return;
    clearTimeout(this.draftTimer);
    clearTimeout(this.checkTimer);
    this.draftTimer = 0;
    this.checkTimer = 0;
    fetch('/api/draft', { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.#draftBody()) }).catch(() => {});
  }

  #emit() {
    this.bus.emit('library', { current: this.current, dirty: this.dirty, available: this.available });
  }
}
