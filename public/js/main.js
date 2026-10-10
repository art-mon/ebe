// Wires everything together.
import { bus, state, set } from './state.js';
import { Synth } from './synth.js';
import { Midi } from './midi.js';
import { Ableton } from './ableton.js';
import { Engine } from './engine.js';
import { Clock } from './clock.js';
import { Looper } from './looper.js';
import { Controller } from './controller.js';
import { AudioFeed } from './feed.js';
import { Visuals } from './visuals.js';
import { Tracks } from './tracks.js';
import { UI } from './ui.js';

const $ = (s) => document.querySelector(s);

const ctx = new AudioContext({ latencyHint: 'interactive' });
const synth = new Synth(ctx);
const midi = new Midi(bus);
const ableton = new Ableton(bus);
const engine = new Engine({ ctx, synth, midi, ableton, bus });
const clock = new Clock(ctx, bus);
const looper = new Looper({ clock, engine, bus });
const controller = new Controller({ engine, looper, clock, bus });
const feed = new AudioFeed(ctx);
// When stopped, the horizon grid keeps drifting slowly so the stage never looks frozen.
const visuals = new Visuals($('#visuals'), feed, () => (clock.running ? clock.beat : (performance.now() / 1000) * 0.4));

// ── restore state ──
clock.bpm = state.tempo;
clock.metronome = state.metronome;
clock.onClick = (time, accent) => synth.click(time, accent);
looper.bars = state.loopBars;
looper.quantize = state.quantize;
engine.setMode(state.engine);
engine.tempo(state.tempo);
engine.pushAllFx(state.fx);
feed.useAnalyser(state.engine === 'builtin' ? synth.analyser : null);

const ui = new UI({ controller, looper, clock, engine, midi, ableton, feed, visuals, bus });
const tracks = new Tracks($('#tracks'), { synth, ableton, engine, controller, bus });
ui.tracks = tracks;
tracks.updateLabels();

// ── UI callbacks ──
ui.onEngine = (mode) => set({ engine: mode });
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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking around in the console.
window.lumen = { ctx, synth, midi, ableton, engine, clock, looper, controller, feed, visuals, state };
