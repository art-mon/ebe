// Web MIDI: listens to the controller (by default every Oxygen port at once,
// because keys and DAW-mode controls arrive on different ports), sends to the
// IAC Driver, survives hot-plugging, and parses raw bytes into messages.
import { CONTROLLER } from './config.js';

export const AUTO = 'auto';

export class Midi {
  constructor(bus) {
    this.bus = bus;
    this.supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
    this.access = null;
    this.inputs = []; // attached input ports
    this.output = null;
    this.error = null;
    this.inputChoice = AUTO; // AUTO | port id | null (none)
    this.outputChoice = null; // port id | null (auto: first IAC)
  }

  async init({ inputId, outputId } = {}) {
    this.inputChoice = inputId === undefined || inputId === null ? AUTO : inputId;
    this.outputChoice = outputId ?? null;
    if (!this.supported) {
      this.error = 'This browser has no Web MIDI — open Lumen in Chrome or Edge.';
      this.bus.emit('midiPorts');
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.error = `MIDI access was blocked (${err.message}).`;
      this.bus.emit('midiPorts');
      return false;
    }
    this.access.onstatechange = () => this.#refresh();
    this.#refresh();
    return true;
  }

  get allInputs() {
    return this.access ? [...this.access.inputs.values()] : [];
  }

  get allOutputs() {
    return this.access ? [...this.access.outputs.values()] : [];
  }

  /** Ports Lumen would listen to in auto mode: the controller, never the IAC bus (feedback). */
  #autoInputs() {
    const ins = this.allInputs.filter((p) => !CONTROLLER.outputMatch.test(p.name));
    const ctrl = ins.filter((p) => CONTROLLER.inputMatch.test(p.name));
    return ctrl.length ? ctrl : ins;
  }

  #refresh() {
    let wanted;
    if (this.inputChoice === AUTO) wanted = this.#autoInputs();
    else if (this.inputChoice) wanted = this.allInputs.filter((p) => p.id === this.inputChoice);
    else wanted = [];
    for (const p of this.inputs) if (!wanted.includes(p)) p.onmidimessage = null;
    for (const p of wanted) p.onmidimessage = (e) => this.#onMessage(e, p);
    this.inputs = wanted;

    const outs = this.allOutputs;
    this.output =
      (this.outputChoice && outs.find((p) => p.id === this.outputChoice)) ||
      outs.find((p) => CONTROLLER.outputMatch.test(p.name)) ||
      null;
    this.bus.emit('midiPorts');
  }

  selectInput(choice) {
    this.inputChoice = choice;
    this.#refresh();
  }

  selectOutput(id) {
    this.outputChoice = id;
    this.#refresh();
  }

  /** True if we'd be listening to the same virtual bus we send to — an infinite loop. */
  get feedbackRisk() {
    return !!this.output && this.inputs.some((p) => p.name === this.output.name);
  }

  send(data, timestamp) {
    if (!this.output || this.feedbackRisk) return false;
    try {
      this.output.send(data, timestamp);
      return true;
    } catch {
      return false;
    }
  }

  #onMessage(e, port) {
    const msg = parse(e.data);
    if (!msg) return;
    msg.portName = port.name;
    msg.port = CONTROLLER.dawPortMatch.test(port.name) ? 'daw' : 'main';
    this.bus.emit('midi', msg);
  }
}

/** Raw bytes → { type, channel (1-16), ... } */
export function parse(data) {
  const [status, d1 = 0, d2 = 0] = data;
  if (status >= 0xf8) {
    if (status === 0xfa) return { type: 'start' };
    if (status === 0xfc) return { type: 'stop' };
    if (status === 0xfb) return { type: 'continue' };
    return null; // clock / active sensing
  }
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  switch (type) {
    case 0x90:
      return d2 > 0
        ? { type: 'noteon', channel, note: d1, velocity: d2 }
        : { type: 'noteoff', channel, note: d1, velocity: 0 };
    case 0x80:
      return { type: 'noteoff', channel, note: d1, velocity: d2 };
    case 0xb0:
      return { type: 'cc', channel, cc: d1, value: d2 };
    case 0xe0:
      return { type: 'pitchbend', channel, raw: (d2 << 7) | d1, value: (((d2 << 7) | d1) - 8192) / 8192 };
    case 0xd0:
      return { type: 'pressure', channel, value: d1 };
    case 0xc0:
      return { type: 'program', channel, program: d1 };
    default:
      return null;
  }
}

/** Human-readable one-liner for the MIDI monitor. */
export function describe(msg) {
  const where = msg.port === 'daw' ? ' · DAW port' : '';
  switch (msg.type) {
    case 'noteon': return `Note on · ch ${msg.channel} · note ${msg.note} · vel ${msg.velocity}${where}`;
    case 'noteoff': return `Note off · ch ${msg.channel} · note ${msg.note}${where}`;
    case 'cc': return `CC ${msg.cc} · ch ${msg.channel} · ${msg.value}${where}`;
    case 'pitchbend': return `Pitch bend · ch ${msg.channel} · ${msg.value.toFixed(2)}`;
    case 'pressure': return `Pressure · ch ${msg.channel} · ${msg.value}`;
    case 'program': return `Program ${msg.program} · ch ${msg.channel}`;
    default: return `MIDI ${msg.type}`;
  }
}
