// Tiny event bus + app state with best-effort persistence.
import { FX_MACROS, VIBES, INSTRUMENTS, LOOP_COUNT } from './config.js';
import { DEFAULT_STYLES } from './styles.js';

export class Bus {
  #handlers = new Map();
  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.#handlers.get(type)?.delete(fn);
  }
  emit(type, payload) {
    this.#handlers.get(type)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] ${type} handler failed`, err);
      }
    });
  }
}

export const bus = new Bus();

const STORAGE_KEY = 'lumen:v1';

// Song grid: 8 sections (columns), each N bars long with one on/off cell per loop.
function defaultSong() {
  return { repeat: true, sections: Array.from({ length: 8 }, () => ({ bars: 4, on: Array(LOOP_COUNT).fill(false) })) };
}

const DEFAULTS = {
  engine: 'builtin', // 'builtin' | 'ableton'
  vibe: 0,
  vibeSet: 0, // which set of vibes the panel and the APC's top row show
  instrument: 1,
  layer: 0,
  layerOn: true,
  fx: FX_MACROS.map((m) => m.def),
  octave: 0,
  root: 2, // D
  scale: 'minor',
  keyMode: 'snap',
  chord: 'off',
  tempo: 100,
  metronome: true,
  clickSound: 'soft',
  loopBars: Array(LOOP_COUNT).fill(2), // bars per loop
  quantize: true,
  showChords: true, // big chord name on the stage
  styles: { ...DEFAULT_STYLES }, // sound style per instrument
  song: defaultSong(), // song grid: sections × loops
  visual: 'nebula',
  syncTempo: true,
  midiInputId: null,
  midiOutputId: null,
  mappings: null, // null → the device defaults in devices.js
  mutes: INSTRUMENTS.map(() => false),
  gridMode: 'controls', // APC Key 25 grid: 'controls' | 'drums'
  padBase: null,
  padChannel: null,
  version: 3,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, ...vibeDefaults(0) };
    // Mutes start fresh each session: a silent instrument after a reload is confusing.
    return migrate({ ...DEFAULTS, ...JSON.parse(raw), mutes: DEFAULTS.mutes });
  } catch {
    return { ...DEFAULTS, ...vibeDefaults(0) };
  }
}

/** Bring settings saved by older versions up to date. */
export function migrate(s) {
  // v1 had one loop length for every loop (a number) and four loops.
  if (!Array.isArray(s.loopBars)) s.loopBars = Array(LOOP_COUNT).fill(Number(s.loopBars) || 2);
  while (s.loopBars.length < LOOP_COUNT) s.loopBars.push(s.loopBars.at(-1) ?? 2);
  s.styles = { ...DEFAULT_STYLES, ...s.styles };
  if (!s.song?.sections) s.song = defaultSong();
  for (const sec of s.song.sections) while (sec.on.length < LOOP_COUNT) sec.on.push(false);
  // v2 swapped the Oxygen's roles: faders now drive FX 1-4 and knobs FX 5-8. Controls
  // learned with the wizard keep their hardware role, so move their FX by four.
  if ((s.version ?? 1) < 2 && s.mappings) {
    for (const [key, t] of Object.entries(s.mappings)) {
      if (t?.kind === 'fx' && /^(main|daw)\|/.test(key)) s.mappings[key] = { ...t, index: (t.index + 4) % 8 };
    }
  }
  // v3 added real (sampled) instruments: start everyone on them instead of the old synth defaults.
  if ((s.version ?? 1) < 3) s.styles = { ...DEFAULT_STYLES };
  s.version = 3;
  return s;
}

function vibeDefaults(i) {
  const v = VIBES[i];
  return { fx: [...v.fx], visual: v.visual };
}

export const state = load();

let saveTimer = 0;
let resetting = false;
function save() {
  clearTimeout(saveTimer);
  if (resetting) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private window or storage blocked — the app still works */
  }
}
// Don't lose a change made just before the tab closes or reloads.
globalThis.addEventListener?.('pagehide', save);

/** Update state, notify listeners, persist (debounced). */
export function set(patch) {
  Object.assign(state, patch);
  bus.emit('state', patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

export function resetSettings() {
  resetting = true; // the reload that follows must not save the old state back
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
