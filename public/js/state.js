// Tiny event bus + app state with best-effort persistence.
import { FX_MACROS, VIBES } from './config.js';

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

const DEFAULTS = {
  engine: 'builtin', // 'builtin' | 'ableton'
  vibe: 0,
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
  loopBars: 2,
  quantize: true,
  visual: 'nebula',
  syncTempo: true,
  midiInputId: null,
  midiOutputId: null,
  mappings: null, // null → defaults from CONTROLLER
  padBase: null,
  padChannel: null,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS, ...vibeDefaults(0) };
  } catch {
    return { ...DEFAULTS, ...vibeDefaults(0) };
  }
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
addEventListener('pagehide', save);

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
