// Builds the interface and keeps it in sync with state. No framework — just
// small render functions subscribed to bus events.
import { state, set, resetSettings } from './state.js';
import {
  INSTRUMENTS, MELODIC, DRUM_VOICES, VIBES, FX_MACROS, FX_CHANNEL, FX_CC_BASE, SCALES, NOTE_NAMES,
  KEY_MODES, CHORD_MODES, CONTROL_PADS, ACTIONS, LOOP_BAR_OPTIONS, CONTROLLER, reverbDivision,
} from './config.js';
import { WIZARD_STEPS, OXYGEN, APC, APC_GRID, APC_SCENES, APC_TRACKS } from './devices.js';
import { gridLook, buttonLook, describeTarget } from './lights.js';
import { isKeyInScale, chordName } from './transform.js';
import { describe, AUTO } from './midi.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c);
  return n;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const VISUALS = { nebula: 'Nebula', rings: 'Rings', horizon: 'Horizon' };
const PAD_ORDER = [4, 5, 6, 7, 0, 1, 2, 3]; // pad 1 is bottom-left, like the hardware
const KB_LOW = 48;
const KB_HIGH = 84;
const BLACK = [1, 3, 6, 8, 10];

function targetLabel(t) {
  if (!t) return '';
  if (t.kind === 'fx') return `${FX_MACROS[t.index].name} (FX ${t.index + 1})`;
  if (t.kind === 'pad') {
    return t.index < 8 ? `Pad ${t.index + 1} · ${DRUM_VOICES[t.index].name}` : `Pad B${t.index - 7} · ${CONTROL_PADS[t.index - 8].label}`;
  }
  if (t.arg !== undefined) return describeTarget(t)[0];
  return ACTIONS[t.name] ?? t.name;
}

function sourceLabel(key) {
  // "daw|cc:1:22" → "CC 22 · ch 1 · DAW port"
  const m = /^(\w+)\|(cc|note):([\d*]+):(\d+)$/.exec(key);
  if (!m) return key;
  const [, port, kind, ch, num] = m;
  const where = port === 'daw' ? ' · DAW' : port.startsWith('apc') ? ' · APC' : '';
  return `${kind === 'cc' ? 'CC' : 'Note'} ${num} · ${ch === '*' ? 'any ch' : `ch ${ch}`}${where}`;
}

export class UI {
  constructor(deps) {
    Object.assign(this, deps); // controller, looper, clock, engine, midi, ableton, feed, visuals, bus
    this.bank = 0;
    this.monitorLines = [];
    this.taps = [];
    this.fxEls = [];
    this.loopEls = [];
    this.padEls = new Map();
    this.keyEls = new Map();
    this.downKeys = new Map();

    this.#topbar();
    this.#vibes();
    this.#instruments();
    this.#helpers();
    this.#stage();
    this.#fx();
    this.#looper();
    this.#pads();
    this.#keyboard();
    this.#drawer();
    this.#wizard();
    this.#events();
    this.renderAll();
  }

  renderAll() {
    this.#applyTheme();
    this.#renderEngine();
    this.#renderStatus();
    this.#renderTransport();
    this.#renderVibes();
    this.#renderInstruments();
    this.#renderHelpers();
    this.#renderHud();
    this.#renderFx();
    this.#renderLoops();
    this.#renderPads();
    this.#renderKeyboard();
  }

  toast(text, ms = 2600) {
    const t = h('div', { class: 'toast' }, text);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }

  // ── theme ──
  #applyTheme() {
    const v = VIBES[state.vibe];
    const root = document.documentElement.style;
    root.setProperty('--accent', v.palette[0]);
    root.setProperty('--accent-2', v.palette[1]);
    root.setProperty('--accent-3', v.palette[2]);
    this.visuals.setPalette(v.palette, v.bg);
  }

  // ── top bar ──
  #topbar() {
    $('#engine-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-engine]');
      if (b) this.onEngine?.(b.dataset.engine);
    });
    $('#btn-play').addEventListener('click', () => this.controller.action('transport'));
    $('#tempo').addEventListener('change', (e) => this.onTempo?.(Number(e.target.value)));
    $('#tempo-down').addEventListener('click', () => this.onTempo?.(state.tempo - 1));
    $('#tempo-up').addEventListener('click', () => this.onTempo?.(state.tempo + 1));
    $('#btn-tap').addEventListener('click', () => this.controller.action('tap'));
    $('#btn-metro').addEventListener('click', () => set({ metronome: !state.metronome }));
    $('#btn-settings').addEventListener('click', () => this.openDrawer());
    $('#btn-wizard').addEventListener('click', () => this.startWizard());
  }

  startWizard() {
    const ids = this.midi.devices.map((d) => d.device.id);
    if (ids.includes('apc') && !ids.includes('oxygen')) {
      this.toast('The APC Key 25 needs no setup — every control is already mapped.');
      return;
    }
    this.closeDrawer();
    this.controller.startWizard(WIZARD_STEPS);
  }

  /** The controller whose labels we show (first one connected; Oxygen if none). */
  get device() {
    return this.midi.devices[0]?.device ?? OXYGEN;
  }

  #renderEngine() {
    for (const b of $('#engine-seg').children) {
      const on = b.dataset.engine === state.engine;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  #renderStatus() {
    const chipIn = $('#chip-in');
    const chipOut = $('#chip-out');
    const chipLive = $('#chip-live');
    const ins = this.midi.inputs;
    chipIn.className = `chip ${ins.length ? 'ok' : 'warn'}`;
    const devs = this.midi.devices.map((d) => `${d.device.name}${d.variant === 'mk2' ? ' mk2' : ''}`);
    chipIn.querySelector('b').textContent = devs.length
      ? devs.join(' + ')
      : ins.length ? ins[0].name : this.midi.error ? 'No Web MIDI' : 'No controller';
    const out = this.midi.output;
    const needOut = state.engine === 'ableton';
    chipOut.className = `chip ${out && !this.midi.feedbackRisk ? 'ok' : needOut ? 'warn' : ''}`;
    chipOut.querySelector('b').textContent = out ? out.name : 'No IAC out';
    chipLive.className = `chip ${this.ableton.live ? 'ok' : this.ableton.bridge && needOut ? 'warn' : ''}`;
    chipLive.querySelector('b').textContent = this.ableton.live ? 'Live linked' : 'Live (OSC off)';
    chipLive.title = this.ableton.live
      ? 'AbletonOSC is answering — meters & tempo sync on'
      : 'Optional: install AbletonOSC for track meters and tempo sync (see README)';
  }

  #renderTransport() {
    document.body.classList.toggle('running', this.clock.running);
    const tempo = $('#tempo');
    if (document.activeElement !== tempo) tempo.value = String(Math.round(state.tempo));
    $('#btn-metro').classList.toggle('on', state.metronome);
  }

  // ── vibes ──
  #vibes() {
    const root = $('#vibes');
    VIBES.forEach((v, i) => {
      const inst = INSTRUMENTS.find((x) => x.id === v.instrument);
      const layer = v.layer ? INSTRUMENTS.find((x) => x.id === v.layer) : null;
      const b = h('button', {
        type: 'button', class: 'vibe',
        style: `--v1:${v.palette[0]};--v2:${v.palette[1]};--v3:${v.palette[2]}`,
        onclick: () => this.controller.selectVibe(i),
      },
      h('span', { class: 'num' }, String(i + 1)),
      h('span', { class: 'name' }, v.name),
      h('span', { class: 'meta' }, layer ? `${inst.name} + ${layer.name}` : inst.name));
      root.append(b);
    });
  }

  #renderVibes() {
    [...$('#vibes').children].forEach((b, i) => b.classList.toggle('on', i === state.vibe));
  }

  // ── instruments ──
  #instruments() {
    const root = $('#insts');
    for (const i of MELODIC) {
      const inst = INSTRUMENTS[i];
      root.append(h('div', { class: 'inst', style: `--c:${inst.color}`, 'data-i': i },
        h('button', { type: 'button', class: 'pick', onclick: () => this.controller.selectInstrument(i) }, h('i'), inst.name),
        h('button', { type: 'button', class: 'layer', title: `Layer ${inst.name} on top`, onclick: () => this.controller.toggleLayer(i) }, '+')));
    }
  }

  #renderInstruments() {
    for (const el of $('#insts').children) {
      const i = Number(el.dataset.i);
      el.classList.toggle('on', i === state.instrument);
      el.classList.toggle('layered', state.layerOn && i === state.layer && i !== state.instrument);
    }
    this.tracks?.updateLabels();
  }

  // ── play helpers ──
  #helpers() {
    const root = $('#key-root');
    NOTE_NAMES.forEach((n, i) => root.append(h('option', { value: i }, n)));
    root.addEventListener('change', () => set({ root: Number(root.value) }));
    const scale = $('#key-scale');
    for (const [id, s] of Object.entries(SCALES)) if (id !== 'chromatic') scale.append(h('option', { value: id }, s.name));
    scale.addEventListener('change', () => set({ scale: scale.value }));

    const seg = (el, options, key) => {
      for (const [id, label] of Object.entries(options)) {
        el.append(h('button', { type: 'button', 'data-v': id, onclick: () => set({ [key]: id }) }, label));
      }
    };
    seg($('#keymode-seg'), { off: 'Free', snap: 'Snap', white: 'Easy' }, 'keyMode');
    seg($('#chord-seg'), { off: 'Off', triad: 'Triad', seventh: '7th', power: 'Power', octave: 'Oct' }, 'chord');
    $('#keymode-seg').title = Object.values(KEY_MODES).join(' · ');
    $('#chord-seg').title = Object.values(CHORD_MODES).join(' · ');
    $('#oct-down').addEventListener('click', () => this.controller.action('octDown'));
    $('#oct-up').addEventListener('click', () => this.controller.action('octUp'));
  }

  #renderHelpers() {
    $('#key-root').value = String(state.root);
    $('#key-scale').value = state.scale;
    for (const b of $('#keymode-seg').children) b.classList.toggle('on', b.dataset.v === state.keyMode);
    for (const b of $('#chord-seg').children) b.classList.toggle('on', b.dataset.v === state.chord);
    $('#oct').textContent = state.octave > 0 ? `+${state.octave}` : String(state.octave);
  }

  // ── stage ──
  #stage() {
    const seg = $('#visual-seg');
    for (const [id, label] of Object.entries(VISUALS)) {
      seg.append(h('button', { type: 'button', 'data-v': id, onclick: () => set({ visual: id }) }, label));
    }
    $('#btn-stage').addEventListener('click', () => this.toggleStage());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.body.classList.contains('stage-mode')) this.toggleStage(false);
        this.closeDrawer();
      }
    });
  }

  toggleStage(force) {
    const on = force ?? !document.body.classList.contains('stage-mode');
    document.body.classList.toggle('stage-mode', on);
    this.bus.emit('stageMode', on);
    if (on) this.toast('Stage mode — press ` or Esc to exit', 1800);
  }

  #renderHud() {
    const v = VIBES[state.vibe];
    $('#hud-vibe').textContent = v.name;
    const names = this.controller.activeInstruments().map((i) => INSTRUMENTS[i].name).join(' + ');
    const key = state.keyMode === 'off' ? 'free play' : `${NOTE_NAMES[state.root]} ${SCALES[state.scale].name}`;
    const extras = [state.chord !== 'off' ? CHORD_MODES[state.chord] : null, state.octave ? `oct ${state.octave > 0 ? '+' : ''}${state.octave}` : null].filter(Boolean);
    $('#hud-sub').textContent = [names, key, ...extras].join(' · ');
    for (const b of $('#visual-seg').children) b.classList.toggle('on', b.dataset.v === state.visual);
    this.visuals.setMode(state.visual);
  }

  #flashChord(notes) {
    const el = $('#hud-chord');
    el.textContent = notes.length > 1 ? chordName(notes, NOTE_NAMES) : NOTE_NAMES[notes[0] % 12];
    el.classList.add('show');
    clearTimeout(this.chordTimer);
    this.chordTimer = setTimeout(() => el.classList.remove('show'), 650);
  }

  // ── FX ──
  #fx() {
    const root = $('#fx');
    const C = 2 * Math.PI * 22;
    FX_MACROS.forEach((m, i) => {
      // Each slot has a knob and a fader; the connected controller decides which one shows.
      const fader = h('div', { class: 'fader', role: 'slider', 'aria-label': m.name, tabindex: 0 },
        h('div', { class: 'fill' }), h('div', { class: 'cap' }));
      const knob = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      knob.setAttribute('viewBox', '0 0 58 58');
      knob.setAttribute('class', 'knob');
      knob.setAttribute('role', 'slider');
      knob.setAttribute('aria-label', m.name);
      knob.setAttribute('tabindex', '0');
      knob.innerHTML = `
        <circle class="kt" cx="29" cy="29" r="22" fill="none" stroke-width="5" stroke-linecap="round"
          stroke-dasharray="${C * 0.75} ${C}" transform="rotate(135 29 29)"/>
        <circle class="arc" cx="29" cy="29" r="22" fill="none" stroke-width="5" stroke-linecap="round"
          stroke-dasharray="0 ${C}" transform="rotate(135 29 29)"/>
        <circle class="cap" cx="29" cy="29" r="14" stroke-width="1"/>
        <line class="tick" x1="29" y1="29" x2="29" y2="18" stroke-width="2.5" stroke-linecap="round"/>`;
      const val = h('span', { class: 'val' }, '0');
      const hw = h('span', { class: 'hw' });
      const wrap = h('div', { class: 'ctl' }, knob, fader, h('span', { class: 'label' }, m.name), hw, val);
      root.append(wrap);
      this.fxEls.push({ wrap, knob, fader, val, hw, C });
      for (const control of [knob, fader]) {
        this.#dragValue(control, () => state.fx[i], (v) => this.controller.setFx(i, v), () => this.controller.setFx(i, VIBES[state.vibe].fx[i]));
      }
    });
  }

  #dragValue(el, get, setValue, reset) {
    let startY = 0;
    let startV = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startV = get();
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const range = e.shiftKey ? 600 : 150;
      setValue(clamp01(startV + (startY - e.clientY) / range));
    });
    el.addEventListener('dblclick', reset);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      setValue(clamp01(get() - Math.sign(e.deltaY) * 0.03));
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
      if (d) {
        e.preventDefault();
        e.stopPropagation();
        setValue(clamp01(get() + d));
      }
    });
  }

  #renderFx(touched) {
    state.fx.forEach((v, i) => {
      const f = this.fxEls[i];
      const isFader = this.device.fxHw[i].startsWith('Fader');
      f.knob.style.display = isFader ? 'none' : '';
      f.fader.style.display = isFader ? '' : 'none';
      f.fader.querySelector('.fill').style.transform = `scaleY(${v})`;
      f.fader.querySelector('.cap').style.bottom = `calc(${v * 100}% - ${v * 6}px)`;
      f.knob.querySelector('.arc').setAttribute('stroke-dasharray', `${f.C * 0.75 * v} ${f.C}`);
      f.knob.querySelector('.tick').setAttribute('transform', `rotate(${-135 + v * 270} 29 29)`);
      for (const c of [f.knob, f.fader]) c.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      if (FX_MACROS[i].id === 'space') {
        // Space is a note length: the reverb tail follows the tempo.
        const div = reverbDivision(v);
        const secs = (div.beats * 60) / state.tempo;
        f.val.textContent = div.label;
        for (const c of [f.knob, f.fader]) c.setAttribute('aria-valuetext', `${div.label} reverb`);
        f.wrap.title = `${this.device.fxHw[i]} · reverb tail = ${div.label} → ${secs.toFixed(2)} s at ${Math.round(state.tempo)} BPM`;
      } else {
        f.val.textContent = String(Math.round(v * 100));
        f.wrap.title = `${this.device.fxHw[i]} · in Live: ${FX_MACROS[i].hint}`;
      }
      f.hw.textContent = this.device.fxHw[i];
    });
    $('#fx-hint').textContent = this.device === OXYGEN ? 'knobs = tone · faders = space' : `the ${this.device.name}'s 8 knobs`;
    if (touched !== undefined) {
      const w = this.fxEls[touched]?.wrap;
      if (w) {
        w.classList.add('touched');
        clearTimeout(w.touchTimer);
        w.touchTimer = setTimeout(() => w.classList.remove('touched'), 300);
      }
    }
  }

  // ── looper ──
  #looper() {
    const bars = $('#loop-bars');
    LOOP_BAR_OPTIONS.forEach((b) => bars.append(h('option', { value: b }, `${b} bar${b > 1 ? 's' : ''}`)));
    bars.addEventListener('change', () => {
      if (this.looper.setBars(Number(bars.value))) set({ loopBars: Number(bars.value) });
      else {
        bars.value = String(this.looper.bars);
        this.toast('Clear all loops to change the loop length.');
      }
    });
    $('#btn-quant').addEventListener('click', () => set({ quantize: !state.quantize }));
    $('#btn-stop-loops').addEventListener('click', () => this.looper.stopAll());

    const root = $('#loops');
    const C = 2 * Math.PI * 20;
    this.looper.loops.forEach((_, i) => {
      const ring = h('button', { type: 'button', class: 'ring', title: 'Tap: record / play / stop', onclick: () => this.looper.tap(i) });
      ring.innerHTML = `<svg viewBox="0 0 48 48"><circle class="bg" cx="24" cy="24" r="20" fill="none" stroke-width="4"/>
        <circle class="fg" cx="24" cy="24" r="20" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><b>${i + 1}</b>`;
      const stateEl = h('div', { class: 'state' }, 'empty');
      const dots = h('div', { class: 'dots' });
      const rec = h('button', { type: 'button', title: 'Record / overdub', onclick: () => this.#recButton(i) }, '●');
      const play = h('button', { type: 'button', title: 'Play / stop', onclick: () => this.#playButton(i) }, '▶');
      const clear = h('button', { type: 'button', title: 'Clear', onclick: () => this.looper.clear(i) }, '✕');
      const card = h('div', { class: 'loop', 'data-state': 'empty' }, ring,
        h('div', { class: 'loop-body' }, h('div', {}, stateEl, dots), h('div', { class: 'btns' }, rec, play, clear)));
      root.append(card);
      this.loopEls.push({ card, ring, fg: ring.querySelector('.fg'), stateEl, dots, rec, play, clear, C });
    });
  }

  #recButton(i) {
    const s = this.looper.status(i);
    if (s === 'empty') this.looper.record(i);
    else if (s === 'playing' || s === 'stopped') this.looper.overdub(i);
    else this.looper.tap(i); // armed → cancel, recording → finish
  }

  #playButton(i) {
    const s = this.looper.status(i);
    if (s === 'playing') this.looper.stop(i);
    else if (s === 'stopped') this.looper.play(i);
  }

  #renderLoops() {
    const labels = { empty: 'empty', armed: 'get ready', recording: 'recording', overdub: 'overdub', playing: 'playing', stopped: 'stopped' };
    this.looper.loops.forEach((loop, i) => {
      const e = this.loopEls[i];
      const s = this.looper.status(i);
      e.card.dataset.state = s;
      e.stateEl.textContent = labels[s];
      e.dots.replaceChildren(...[...loop.insts].map((inst) => h('i', { style: `background:${INSTRUMENTS[inst].color}` })));
      e.play.textContent = s === 'playing' ? '■' : '▶';
      e.play.disabled = !(s === 'playing' || s === 'stopped');
      e.clear.disabled = s === 'empty';
      e.rec.title = s === 'empty' ? 'Record (starts on the next bar)' : 'Overdub one more pass';
    });
    const bars = $('#loop-bars');
    bars.value = String(this.looper.bars);
    bars.disabled = this.looper.hasContent;
    $('#btn-quant').classList.toggle('on', state.quantize);
  }

  #frameLoops() {
    const phase = this.looper.phase();
    this.looper.loops.forEach((_, i) => {
      const e = this.loopEls[i];
      const s = e.card.dataset.state;
      const active = this.clock.running && s !== 'empty' && s !== 'stopped';
      e.fg.setAttribute('stroke-dashoffset', String(active ? e.C * (1 - phase) : s === 'stopped' ? 0 : e.C));
    });
    // HUD: bar counter / count-in / rec indicator
    const hud = $('#hud-loop');
    if (!this.clock.running) {
      hud.className = 'hud-loop';
      return;
    }
    const b = this.clock.beat;
    const recording = this.looper.loops.some((_, i) => ['recording', 'overdub'].includes(this.looper.status(i)));
    const armed = this.looper.loops.some((_, i) => this.looper.status(i) === 'armed');
    let text;
    if (b < 0) text = `count-in ${Math.ceil(-b)}`;
    else text = `${recording ? '● REC  ' : armed ? '◌ next bar  ' : ''}${Math.floor(b / 4) + 1}.${(Math.floor(b) % 4) + 1}`;
    hud.textContent = text;
    hud.className = `hud-loop show${recording || b < 0 ? ' rec' : ''}`;
  }

  // ── pads (Oxygen banks A/B) + the APC Key 25 grid ──
  #pads() {
    $('#bank-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-bank]');
      if (b) {
        this.bank = b.dataset.bank === 'grid' ? 'grid' : Number(b.dataset.bank);
        this.#renderPads();
      }
    });
    const root = $('#pads');
    for (let k = 0; k < 8; k++) {
      const pad = h('button', { type: 'button', class: 'pad' });
      pad.addEventListener('pointerdown', (e) => {
        pad.setPointerCapture(e.pointerId);
        pad.dataset.held = pad.dataset.index;
        this.controller.padDown(Number(pad.dataset.index), 0.85);
      });
      const up = () => {
        if (pad.dataset.held === undefined) return;
        this.controller.padUp(Number(pad.dataset.held));
        delete pad.dataset.held;
      };
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
      root.append(pad);
    }
    this.#grid();
  }

  /** A clickable copy of the APC Key 25: 5×8 grid, scene buttons on the right, track buttons below. */
  #grid() {
    const root = $('#apc');
    this.gridEls = [];
    const button = (t, cls, src) => {
      const [label, tag] = describeTarget(t);
      const b = h('button', { type: 'button', class: cls, title: label }, tag);
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        this.controller.press(t, 0.85, src);
      });
      const up = () => this.controller.release(t, src);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      this.gridEls.push({ el: b, t, single: cls !== 'cell' });
      return b;
    };
    const grid = h('div', { class: 'apc-grid' });
    APC_GRID.forEach((cells, row) => {
      cells.forEach((t, col) => grid.append(button(t, 'cell', `grid:${row}:${col}`)));
      grid.append(button(APC_SCENES[row], 'scene', `scene:${row}`));
    });
    APC_TRACKS.forEach((t, i) => grid.append(button(t, 'trackbtn', `track:${i}`)));
    root.append(grid, h('p', { class: 'apc-hint' },
      'Knobs = FX 1–8 · Shift + instrument = layer · hold a loop (or Shift) = clear · Shift + Stop All = clear all'));
  }

  #renderGrid(ctx) {
    if (!this.gridEls || this.bank !== 'grid') return;
    for (const { el, t, single } of this.gridEls) {
      if (single) {
        const v = buttonLook(t, ctx);
        el.classList.toggle('on', v === 1);
        el.classList.toggle('blink', v === 2);
      } else {
        const look = gridLook(t, ctx);
        el.style.setProperty('--c', look.color);
        el.dataset.level = look.level;
      }
    }
  }

  #renderPads() {
    for (const b of $('#bank-seg').children) b.classList.toggle('on', b.dataset.bank === String(this.bank));
    $('#pads').hidden = this.bank === 'grid';
    $('#apc').hidden = this.bank !== 'grid';
    this.padEls.clear();
    if (this.bank === 'grid') {
      this.#renderGrid(this.lights?.ctx ?? { looper: this.looper, held: new Set(), hits: new Set() });
      return;
    }
    const pads = [...$('#pads').children];
    PAD_ORDER.forEach((slot, k) => {
      const index = this.bank * 8 + slot;
      const pad = pads[k];
      pad.dataset.index = String(index);
      this.padEls.set(index, pad);
      if (this.bank === 0) {
        pad.style.setProperty('--pc', VIBES[state.vibe].palette[slot % 3]);
        pad.replaceChildren(h('small', {}, `${slot + 1} · key ${slot + 1}`), DRUM_VOICES[slot].name);
      } else {
        const cp = CONTROL_PADS[slot];
        const loop = cp.action === 'loop';
        pad.style.setProperty('--pc', loop ? '#ff4d6a' : '#8d8aa6');
        const hint = loop ? `tap · hold = clear` : '';
        pad.replaceChildren(h('small', {}, `${slot + 1}${hint ? ` · ${hint}` : ''}`), cp.label);
      }
    });
  }

  #padHit({ index, on }) {
    if (this.bank === 'grid') return; // the grid lights up through the lights pipeline
    const pad = this.padEls.get(index);
    if (pad) pad.classList.toggle('hit', on);
    else if (on) {
      const tab = $(`#bank-seg [data-bank="${index < 8 ? 0 : 1}"]`);
      tab.classList.add('ping');
      setTimeout(() => tab.classList.remove('ping'), 200);
    }
  }

  // ── keyboard ──
  #keyboard() {
    const root = $('#keyboard');
    const whites = [];
    for (let n = KB_LOW; n <= KB_HIGH; n++) if (!BLACK.includes(n % 12)) whites.push(n);
    const ww = 100 / whites.length;
    whites.forEach((n) => {
      const k = h('div', { class: 'wkey', 'data-note': n }, n % 12 === 0 ? `C${n / 12 - 1}` : '');
      root.append(k);
      this.keyEls.set(n, k);
    });
    for (let n = KB_LOW; n <= KB_HIGH; n++) {
      if (!BLACK.includes(n % 12)) continue;
      const left = whites.indexOf(n - 1) + 1;
      const k = h('div', { class: 'bkey', 'data-note': n, style: `left:calc(${left * ww}% - ${ww * 0.3}%);width:${ww * 0.6}%` });
      root.append(k);
      this.keyEls.set(n, k);
    }
    let pointerNote = null;
    const press = (note) => {
      if (pointerNote === note) return;
      if (pointerNote !== null) this.controller.keyUp('ui');
      pointerNote = note;
      if (note !== null) this.controller.keyDown('ui', note, 0.8);
    };
    root.addEventListener('pointerdown', (e) => {
      const key = e.target.closest('[data-note]');
      if (!key) return;
      root.setPointerCapture(e.pointerId);
      press(Number(key.dataset.note));
    });
    root.addEventListener('pointermove', (e) => {
      if (pointerNote === null) return;
      const key = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-note]');
      if (key && root.contains(key)) press(Number(key.dataset.note));
    });
    const release = () => press(null);
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
  }

  #renderKeyboard() {
    const showScale = state.keyMode !== 'off';
    for (const [n, k] of this.keyEls) {
      const inScale = showScale && isKeyInScale(n, state);
      k.classList.toggle('in', inScale);
      k.classList.toggle('dim', showScale && !inScale);
      k.classList.toggle('root', state.keyMode === 'snap' && n % 12 === state.root);
    }
  }

  #keyHit({ note, on }) {
    const k = this.keyEls.get(note);
    if (!k) return;
    const count = (this.downKeys.get(note) ?? 0) + (on ? 1 : -1);
    this.downKeys.set(note, Math.max(0, count));
    k.classList.toggle('down', count > 0);
  }

  // ── settings drawer ──
  #drawer() {
    $('#drawer').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.closeDrawer();
    });
  }

  openDrawer() {
    this.renderDrawer();
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
  }

  closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
  }

  get drawerOpen() {
    return $('#drawer').classList.contains('open');
  }

  renderDrawer() {
    const body = $('#drawer-body');
    const scroll = body.scrollTop;
    const midi = this.midi;
    const sections = [];

    // MIDI ports
    const inSel = h('select', { onchange: (e) => this.onMidiInput?.(e.target.value) });
    inSel.append(h('option', { value: AUTO }, 'Auto — every Oxygen port'));
    midi.allInputs.forEach((p) => inSel.append(h('option', { value: p.id }, p.name)));
    inSel.append(h('option', { value: '' }, 'None (computer keyboard only)'));
    inSel.value = midi.inputChoice ?? '';
    const outSel = h('select', { onchange: (e) => this.onMidiOutput?.(e.target.value || null) });
    outSel.append(h('option', { value: '' }, 'Auto — IAC Driver'));
    midi.allOutputs.forEach((p) => outSel.append(h('option', { value: p.id }, p.name)));
    outSel.value = midi.outputChoice ?? '';
    const warnings = [];
    if (midi.error) warnings.push(midi.error);
    if (!midi.output) {
      warnings.push('No IAC Driver output found. In Audio MIDI Setup → Window → Show MIDI Studio → double-click IAC Driver → tick “Device is online”. Needed only for Ableton mode.');
    }
    if (midi.feedbackRisk) warnings.push('Input and output are the same port — that would loop forever, so sending is paused.');
    sections.push(h('section', {},
      h('h3', {}, 'MIDI'),
      h('p', {}, 'Controller in:'), inSel,
      h('p', { style: 'margin-top:10px' }, 'Out to Ableton:'), outSel,
      warnings.map((w) => h('div', { class: 'warnbox' }, w)),
      h('p', { class: 'muted small', style: 'margin-top:10px' }, `Listening to: ${midi.inputs.map((p) => p.name).join(', ') || 'nothing'}`)));

    // Mappings
    const rows = [];
    const addRow = (target) => {
      const b = this.controller.bindingFor(target);
      const learning = this.controller.learnTarget && JSON.stringify(this.controller.learnTarget) === JSON.stringify(target);
      rows.push(
        h('span', {}, targetLabel(target)),
        h('span', { class: `src${b?.learned ? ' learned' : ''}` }, learning ? 'move a control…' : b ? sourceLabel(b.key) : '—'),
        h('span', { class: 'row' },
          h('button', { type: 'button', class: 'pill', onclick: () => { this.controller.learn(target); this.renderDrawer(); } }, learning ? '…' : 'Learn'),
          b ? h('button', { type: 'button', class: 'pill', title: 'Remove', onclick: () => { this.controller.unmap(b.key); this.renderDrawer(); } }, '✕') : null),
      );
    };
    FX_MACROS.forEach((_, i) => addRow({ kind: 'fx', index: i }));
    for (let i = 0; i < 16; i++) addRow({ kind: 'pad', index: i });
    Object.keys(ACTIONS).forEach((name) => addRow({ kind: 'action', name }));
    const padCh = h('input', { type: 'number', min: 1, max: 16, value: state.padChannel ?? CONTROLLER.padChannel, onchange: (e) => set({ padChannel: Number(e.target.value) }) });
    const padBase = h('input', { type: 'number', min: 0, max: 127, value: state.padBase ?? CONTROLLER.padBase, onchange: (e) => set({ padBase: Number(e.target.value) }) });
    sections.push(h('section', {},
      h('h3', {}, 'Controller mapping'),
      h('p', {}, 'Fastest: run the setup wizard and touch each control once. Or press Learn next to anything below, then move the control.'),
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => this.startWizard() }, 'Run setup wizard'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { set({ mappings: null }); this.renderDrawer(); } }, 'Reset to defaults')),
      h('div', { class: 'kv' }, rows),
      h('p', { class: 'muted small', style: 'margin-top:12px' }, 'Unlearned pads: notes on channel ', padCh, ' starting at note ', padBase, ' (bank A = first 8).')));

    // Monitor
    this.monitorEl = h('div', { class: 'monitor' }, this.monitorLines.join('\n') || 'Play something on the controller…');
    sections.push(h('section', {}, h('h3', {}, 'MIDI monitor'), this.monitorEl));

    // Ableton
    const ab = this.ableton;
    const trackRows = INSTRUMENTS.flatMap((inst, i) => [
      h('span', {}, `${inst.name} · ch ${inst.channel}`),
      h('span', { class: 'src' }, ab.live ? (ab.trackOf[i] >= 0 ? `Live track ${ab.trackOf[i] + 1} “${ab.trackNames[ab.trackOf[i]]}”` : 'no track with this name') : '—'),
      h('span'),
    ]);
    const synced = (m) => m.id === 'space' && ab.reverbSynced;
    const fxRows = FX_MACROS.flatMap((m, i) => [
      h('span', {}, m.name),
      h('span', { class: 'src' }, synced(m) ? 'set by Lumen in time with the tempo — no mapping needed' : `CC ${FX_CC_BASE + i} → ${m.hint}`),
      synced(m) ? h('span') : h('button', { type: 'button', class: 'pill', onclick: () => this.engine.wiggleFx(i) }, 'Send'),
    ]);
    let verb = null;
    if (ab.live) {
      const r = ab.reverb;
      const div = reverbDivision(state.fx[FX_MACROS.findIndex((m) => m.id === 'space')]);
      if (r?.decay) {
        const where = `track ${r.track + 1} “${ab.trackNames[r.track] ?? ''}”`;
        const now = r.readout || (r.decayMs ? `${(r.decayMs / 1000).toFixed(2)} s` : '');
        verb = h('p', {}, `✓ Reverb sync: Lumen times the Reverb on ${where} to the tempo — tail ${div.label}${now ? ` (${now})` : ''}, pre-delay 1/64.`);
      } else if (r?.foundDecay) {
        verb = h('div', { class: 'warnbox' }, 'Found a Reverb but couldn’t read its Decay Time in milliseconds, so it isn’t tempo-synced. Space falls back to its CC mapping.');
      } else {
        verb = h('p', { class: 'muted' }, 'Reverb sync: put Live’s Reverb on a group track (select your instrument tracks, ⌘G, name it “FX”) — AbletonOSC can’t reach the Master track. Lumen then sets its decay to match the tempo.');
      }
    }
    sections.push(h('section', {},
      h('h3', {}, 'Ableton Live'),
      h('p', {}, ab.live
        ? 'AbletonOSC is connected: track meters and tempo sync are on.'
        : ab.bridge
          ? 'AbletonOSC isn’t answering. Optional — notes, FX and loops work without it. Install it for meters & tempo sync (see README).'
          : 'The Lumen server isn’t reachable — start it with “npm start”.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.syncTempo, onchange: (e) => set({ syncTempo: e.target.checked }) }), 'Keep Live’s tempo in sync with Lumen'),
      h('div', { class: 'kv', style: 'margin:10px 0' }, trackRows),
      ab.live ? h('button', { type: 'button', class: 'pill', onclick: () => ab.refreshTracks() }, 'Re-scan tracks') : null,
      verb,
      h('p', { style: 'margin-top:14px' }, `FX mapping (one time): in Live press ⌘M, click a parameter, then press Send here. Lumen sends these on MIDI channel ${FX_CHANNEL}.`),
      h('div', { class: 'kv' }, fxRows)));

    // Visual input
    const audioSel = h('select', { onchange: (e) => this.onAudioInput?.(e.target.value) });
    audioSel.append(h('option', { value: '' }, this.feed.inputAnalyser ? 'Stop listening' : 'Off — visuals follow the notes'));
    (this.audioInputs ?? []).forEach((d) => audioSel.append(h('option', { value: d.deviceId }, d.label || 'Audio input')));
    sections.push(h('section', {},
      h('h3', {}, 'Visuals'),
      h('p', {}, 'In Ableton mode the visuals follow your notes (and Live’s meters). For a true spectrum, route Live’s output into an input such as BlackHole and pick it here.'),
      this.audioInputs ? audioSel : h('button', { type: 'button', class: 'pill', onclick: () => this.onListAudio?.() }, 'Choose an audio input…')));

    // Shortcuts
    const sc = [
      ['A W S E D F T G Y H U J K O L P ;', 'piano keys (Shift = loud)'],
      ['1 – 8', 'drum pads'], ['C V B N', 'loops 1–4 (hold to clear)'], ['M', 'stop all loops'],
      ['Space', 'play / stop'], ['Z / X', 'octave down / up'], ['← → or , .', 'previous / next vibe'],
      ['↑ ↓', 'previous / next instrument'], ['`', 'stage mode'],
    ];
    sections.push(h('section', {}, h('h3', {}, 'Computer keyboard'),
      h('div', { class: 'shortcuts' }, sc.flatMap(([k, d]) => [h('kbd', {}, k), h('span', {}, d)]))));

    sections.push(h('section', {},
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { resetSettings(); location.reload(); } }, 'Reset all settings')));

    body.replaceChildren(...sections);
    body.scrollTop = scroll;
  }

  #monitor(msg) {
    const line = describe(msg);
    this.monitorLines.unshift(line);
    this.monitorLines.length = Math.min(this.monitorLines.length, 9);
    if (this.monitorEl?.isConnected) this.monitorEl.textContent = this.monitorLines.join('\n');
  }

  // ── wizard ──
  #wizard() {
    $('#wiz-skip').addEventListener('click', () => this.controller.skipStep());
    $('#wiz-done').addEventListener('click', () => this.controller.stopLearning());
  }

  #renderWizard(learn) {
    const modal = $('#wizard');
    const w = learn?.wizard;
    modal.classList.toggle('open', !!w);
    modal.setAttribute('aria-hidden', String(!w));
    if (!w) return;
    const step = w.steps[w.i];
    $('#wiz-count').textContent = `Controller setup · step ${w.i + 1} of ${w.steps.length}`;
    $('#wiz-prompt').textContent = step.prompt;
    $('#wiz-detail').textContent = step.detail ?? targetLabel(step.target);
    $('#wiz-bar').style.width = `${(w.i / w.steps.length) * 100}%`;
  }

  // ── events ──
  #events() {
    const b = this.bus;
    b.on('state', (patch) => {
      if ('vibe' in patch) {
        this.#applyTheme();
        this.#renderVibes();
        this.#renderPads();
      }
      if ('engine' in patch) {
        this.#renderEngine();
        this.#renderStatus();
      }
      if ('instrument' in patch || 'layer' in patch || 'layerOn' in patch) this.#renderInstruments();
      if (['root', 'scale', 'keyMode', 'chord', 'octave'].some((k) => k in patch)) {
        this.#renderHelpers();
        this.#renderKeyboard();
      }
      if (['vibe', 'instrument', 'layer', 'layerOn', 'root', 'scale', 'keyMode', 'chord', 'octave', 'visual'].some((k) => k in patch)) this.#renderHud();
      if ('fx' in patch) this.#renderFx();
      if ('tempo' in patch || 'metronome' in patch) this.#renderTransport();
      if ('tempo' in patch) this.#renderFx(); // Space shows seconds at the current tempo
      if ('quantize' in patch) this.#renderLoops();
      if ('mappings' in patch && this.drawerOpen) this.renderDrawer();
    });
    b.on('transport', () => this.#renderTransport());
    b.on('looper', () => this.#renderLoops());
    b.on('loopNote', () => this.#renderLoops());
    b.on('midiPorts', () => {
      this.#renderStatus();
      this.#renderFx(); // knob labels follow the connected controller
      // An APC Key 25 just showed up: show its grid on screen too.
      const hasApc = this.midi.devices.some((d) => d.device === APC);
      if (hasApc && !this.hadApc) {
        this.bank = 'grid';
        this.#renderPads();
        this.toast(`${this.midi.devices.find((d) => d.device === APC).name} connected — the grid is live ✦`);
      }
      this.hadApc = hasApc;
      if (this.drawerOpen) this.renderDrawer();
    });
    b.on('lights', (ctx) => this.#renderGrid(ctx));
    b.on('ableton', () => {
      this.#renderStatus();
      this.tracks?.updateLabels();
      if (this.drawerOpen) this.renderDrawer();
    });
    b.on('midi', (msg) => {
      this.#monitor(msg);
      const chip = $('#chip-in');
      chip.classList.add('flash');
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => chip.classList.remove('flash'), 90);
    });
    b.on('pad', (e) => this.#padHit(e));
    b.on('keys', (e) => {
      this.#keyHit(e);
      if (e.on) this.#flashChord(e.notes);
    });
    b.on('beat', ({ beat, countIn }) => {
      const dots = $('#beat-dots').children;
      const idx = ((beat % 4) + 4) % 4;
      [...dots].forEach((d, i) => {
        d.classList.toggle('on', i === idx);
        d.classList.toggle('count', countIn);
      });
    });
    b.on('vibe', (v) => this.toast(`Vibe · ${v.name}`, 1400));
    b.on('toast', (t) => this.toast(t));
    b.on('learn', (learn) => {
      this.#renderWizard(learn);
      if (this.drawerOpen) this.renderDrawer();
    });
    b.on('learned', ({ target, key }) => {
      $('#wiz-got').textContent = `✓ ${targetLabel(target)} ← ${sourceLabel(key)}`;
      if (!this.controller.wizard) this.toast(`Mapped ${targetLabel(target)} ← ${sourceLabel(key)}`);
    });
  }

  /** Per-frame UI work (cheap). */
  frame() {
    this.#frameLoops();
  }
}
