// Wires everything together.
import { bus, state, set } from './state.js';
import { Synth } from './synth.js';
import { Midi } from './midi.js';
import { Ableton } from './ableton.js';
import { Engine } from './engine.js';
import { Clock } from './clock.js';
import { Looper } from './looper.js';
import { Song } from './song.js';
import { Controller } from './controller.js';
import { AudioFeed } from './feed.js';
import { Visuals } from './visuals.js';
import { Tracks } from './tracks.js';
import { UI } from './ui.js';
import { Lights } from './lights.js';
import { Library } from './library.js';
import { LibraryView } from './library-ui.js';
import { Editor } from './editor.js';
import { INSTRUMENTS } from './config.js';
import { styleFor } from './styles.js';
import { deviceForPort } from './devices.js';

const $ = (s) => document.querySelector(s);

const ctx = new AudioContext({ latencyHint: 'interactive' });
const synth = new Synth(ctx);
const midi = new Midi(bus);
const ableton = new Ableton(bus);
const engine = new Engine({ ctx, synth, midi, ableton, bus });
const clock = new Clock(ctx, bus);
const looper = new Looper({ clock, engine, bus });
const song = new Song({ clock, looper, bus });
const controller = new Controller({ engine, looper, clock, bus });
controller.song = song;
const feed = new AudioFeed(ctx);
// When stopped, the horizon grid keeps drifting slowly so the stage never looks frozen.
const visuals = new Visuals($('#visuals'), feed, () => (clock.running ? clock.beat : (performance.now() / 1000) * 0.4));

// ── restore state ──
clock.bpm = state.tempo;
clock.metronome = state.metronome;
clock.onClick = (time, accent) => synth.click(time, accent, state.clickSound);
looper.loops.forEach((l, i) => (l.bars = state.loopBars[i] ?? 2));
looper.quantize = state.quantize;
// Sampled instruments load the first time they're chosen; until then a similar
// synth sound plays. Say so (once, for everything a vibe loads) only if it takes a moment.
const applyStyles = (announce = false) => {
  const loads = INSTRUMENTS.map((inst, i) => {
    const loading = engine.style(i, state.styles[inst.id]);
    const name = styleFor(inst.id, state.styles[inst.id]).name;
    return loading?.catch((err) => {
      console.warn(`[samples] ${name}`, err);
      ui.toast(`Couldn’t load ${name} — playing a synth sound instead`, 4000);
    }).then(() => name);
  }).filter(Boolean);
  if (!loads.length || !announce) return;
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    ui.toast('Loading instruments…', 2000);
  }, 400);
  Promise.all(loads).then((names) => {
    clearTimeout(timer);
    if (shown) ui.toast(`${names.join(', ')} ready ✓`, 1600);
  });
};
engine.setMode(state.engine);
engine.tempo(state.tempo);
engine.pushAllFx(state.fx);
applyStyles();
feed.useAnalyser(state.engine === 'builtin' ? synth.analyser : null);

const lights = new Lights({ midi, looper, bus });
const ui = new UI({ controller, looper, song, clock, engine, midi, ableton, feed, visuals, bus, lights });
const tracks = new Tracks($('#tracks'), { synth, ableton, engine, controller, bus });
ui.tracks = tracks;
tracks.updateLabels();
const library = new Library({ bus, looper, clock, controller });
const libraryView = new LibraryView({ library, looper, bus, toast: (t, ms) => ui.toast(t, ms) });
const editor = new Editor({ looper, engine, controller, clock, bus });

// ── UI callbacks ──
ui.onEngine = (mode) => set({ engine: mode });
ui.onPreviewClick = (sound) => {
  ctx.resume();
  synth.click(ctx.currentTime + 0.02, true, sound);
  synth.click(ctx.currentTime + 0.02 + 60 / state.tempo, false, sound);
};
ui.onTempo = (bpm) => {
  if (!Number.isFinite(bpm)) return;
  set({ tempo: clock.setBpm(bpm) });
};
ui.onMidiInput = (choice) => {
  midi.selectInput(choice || null);
  set({ midiInputId: choice || '' });
};
ui.onMidiOutput = (id) => {
  midi.selectOutput(id);
  set({ midiOutputId: id });
};
ui.onListAudio = async () => {
  try {
    // Device labels are only visible after the user grants audio access once.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    ui.audioInputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  } catch (err) {
    ui.toast(`Couldn’t open audio inputs (${err.message})`);
  }
  ui.renderDrawer();
};
ui.onAudioInput = async (deviceId) => {
  try {
    if (deviceId) await feed.useInputDevice(deviceId);
    else feed.stopInput();
  } catch (err) {
    ui.toast(`Couldn’t listen to that input (${err.message})`);
  }
  ui.renderDrawer();
};

// ── reactions to state changes ──
bus.on('state', (patch) => {
  if ('engine' in patch) {
    engine.setMode(state.engine);
    feed.useAnalyser(state.engine === 'builtin' ? synth.analyser : null);
    if (state.engine === 'ableton') {
      engine.pushAllFx(state.fx);
      applyStyles();
      if (!midi.output) ui.toast('No IAC Driver found — see Settings → MIDI to enable it.', 4000);
      else ui.toast(`Sending to Ableton via ${midi.output.name}`);
    }
    tracks.updateLabels();
  }
  if ('tempo' in patch) {
    engine.tempo(state.tempo);
    if (state.syncTempo) ableton.setTempo(state.tempo);
  }
  if ('metronome' in patch) clock.metronome = state.metronome;
  if ('mutes' in patch) state.mutes.forEach((m, i) => engine.mute(i, m));
  if ('styles' in patch) applyStyles(true);
  if ('quantize' in patch) looper.quantize = state.quantize;
});

bus.on('abletonTempo', (bpm) => {
  if (state.syncTempo && Math.abs(bpm - state.tempo) > 0.05) set({ tempo: clock.setBpm(bpm) });
});
bus.on('ableton', ({ live }) => {
  if (live) {
    ui.toast('Ableton Live linked ✦');
    if (state.syncTempo) ableton.setTempo(state.tempo);
  }
});
// A Reverb just got linked in Live: time it to the current tempo straight away.
bus.on('abletonReverb', () => engine.resyncReverb());
// When you play and nothing can be heard, say why — once in a while, not on every note.
const lastHint = new Map();
function hint(key, text, every = 8000) {
  const now = performance.now();
  if (now - (lastHint.get(key) ?? -Infinity) < every) return;
  lastHint.set(key, now);
  ui.toast(text, 5000);
}
bus.on('voice', (v) => {
  if (!v.on) return;
  if (ctx.state !== 'running' && state.engine === 'builtin') {
    ctx.resume(); // works if you've clicked the page before; otherwise the browser needs a click
    gate.classList.remove('hidden');
    hint('audio', '🔈 The browser has paused sound — click “Start playing” (or anywhere) to turn it on. Pads and keys can’t do it for you.');
  } else if (state.engine === 'ableton' && (!midi.output || midi.feedbackRisk)) {
    hint('iac', 'Sound is set to “Ableton Live”, but the IAC Driver is off, so nothing is being sent. Switch to “Built-in sound” (top left) or turn on the IAC Driver.');
  } else if (state.mutes[v.inst]) {
    hint(`mute${v.inst}`, `The ${INSTRUMENTS[v.inst].name} track is muted — unmute it in Tracks (M) or with its button under the APC grid.`);
  }
});
bus.on('voice', (v) => {
  visuals.onVoice(v);
  if (v.on) feed.onNote(v.note, v.vel);
});
bus.on('beat', (b) => visuals.onBeat(b));
bus.on('stage', () => ui.toggleStage());
bus.on('transport', ({ running, countIn }) => {
  if (running && countIn) ui.toast('Count-in… recording starts on the next bar', 1800);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && controller.learnTarget) controller.stopLearning();
});

// ── start ──
controller.attachKeyboard();
ableton.connect();
midi.init({ inputId: state.midiInputId, outputId: state.midiOutputId });
// Bring back last session's loops (they're autosaved as you play).
library.init().then((hadLoops) => {
  if (hadLoops) ui.toast(library.current.id ? `Welcome back to “${library.current.name}”` : 'Welcome back — your loops are where you left them', 3000);
});
window.addEventListener('pagehide', () => library.flushDraft());

const gate = $('#gate');
async function start() {
  await ctx.resume();
  gate.classList.add('hidden');
}
$('#gate-start').addEventListener('click', start);
// Any key or click also unlocks audio (browsers require a gesture first).
window.addEventListener('pointerdown', () => ctx.state !== 'running' && ctx.resume(), { capture: true });
window.addEventListener('keydown', () => {
  if (ctx.state !== 'running') start();
}, { capture: true });

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  feed.external = ableton.live && state.engine === 'ableton' ? Math.max(...ableton.trackOf.map((t, i) => (t >= 0 ? ableton.meter(i) : 0))) : 0;
  feed.update(dt);
  visuals.frame(dt);
  tracks.frame(dt);
  ui.frame();
  editor.frame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Diagnostics: open Lumen as http://localhost:5173/?debug and it reports its MIDI
// ports and every message it receives through the local server (as OSC on the
// AbletonOSC port), so they can be watched from a terminal.
if (new URLSearchParams(location.search).has('debug')) {
  const report = (kind, data) => ableton.send('/lumen/debug', [JSON.stringify({ kind, t: Math.round(performance.now()), ...data })]);
  const snapshot = () => report('snapshot', {
    inputs: midi.allInputs.map((p) => ({
      name: p.name, state: p.state, connection: p.connection, attached: midi.inputs.includes(p),
      cls: deviceForPort(p.name)?.portClass(p.name) ?? 'main',
    })),
    outputs: midi.allOutputs.map((p) => `${p.name} (${p.connection})`),
    lightOutputs: midi.lightOutputs.map((p) => p.name),
    inputChoice: midi.inputChoice, midiError: midi.error, engine: state.engine, gridMode: state.gridMode,
    audio: ctx.state, learning: !!controller.learnTarget, mutes: state.mutes, ua: navigator.userAgent,
  });
  setTimeout(snapshot, 1500);
  setInterval(snapshot, 10000);
  bus.on('midiPorts', () => setTimeout(snapshot, 200));
  bus.on('midi', (m) => report('midi', m));
  bus.on('pad', (e) => report('pad', e));
  bus.on('keys', (e) => report('keys', { note: e.note, on: e.on }));
  ui.toast('Debug mode: reporting MIDI to the Lumen server', 3000);
}

// Handy for poking around in the console.
window.lumen = { ctx, synth, midi, ableton, engine, clock, looper, song, controller, feed, visuals, lights, library, libraryView, editor, state };
