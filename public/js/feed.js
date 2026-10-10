// One place the visuals read "how loud / what frequencies" from, whatever the
// source: the built-in synth, an audio input (e.g. BlackHole carrying Live's
// output), or — when neither is available — an estimate built from the notes
// being played and Live's track meters.

const BANDS = 48;

export class AudioFeed {
  constructor(ctx) {
    this.ctx = ctx;
    this.analyser = null;
    this.inputAnalyser = null;
    this.inputStream = null;
    this.level = 0;
    this.bands = new Float32Array(BANDS);
    this.noteBands = new Float32Array(BANDS);
    this.wave = new Float32Array(512);
    this.freq = null;
    this.time = null;
    this.external = 0; // e.g. max of Live meters, 0..1
  }

  /** Synth master analyser (Built-in mode) or null. */
  useAnalyser(analyser) {
    this.analyser = analyser;
  }

  get source() {
    return this.inputAnalyser ?? this.analyser;
  }

  async useInputDevice(deviceId) {
    this.stopInput();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const src = this.ctx.createMediaStreamSource(stream);
    const an = this.ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.78;
    src.connect(an); // analysis only — never routed to the speakers
    this.inputStream = stream;
    this.inputAnalyser = an;
  }

  stopInput() {
    this.inputStream?.getTracks().forEach((t) => t.stop());
    this.inputStream = null;
    this.inputAnalyser = null;
  }

  /** Every note adds a little energy to its frequency band (+ an overtone). */
  onNote(note, vel) {
    const b = Math.max(0, Math.min(BANDS - 1, Math.round(((note - 24) / 84) * BANDS)));
    this.noteBands[b] = Math.min(1, this.noteBands[b] + 0.6 * vel + 0.2);
    const o = Math.min(BANDS - 1, b + 7);
    this.noteBands[o] = Math.min(1, this.noteBands[o] + 0.3 * vel);
  }

  update(dt) {
    const decay = Math.exp(-dt * 3.2);
    for (let i = 0; i < BANDS; i++) this.noteBands[i] *= decay;

    const an = this.source;
    if (an) {
      if (!this.freq || this.freq.length !== an.frequencyBinCount) {
        this.freq = new Uint8Array(an.frequencyBinCount);
        this.time = new Float32Array(an.fftSize);
      }
      an.getByteFrequencyData(this.freq);
      an.getFloatTimeDomainData(this.time);
      // Log-spaced bands from ~40 Hz to ~16 kHz.
      const nyquist = this.ctx.sampleRate / 2;
      const bins = this.freq.length;
      for (let i = 0; i < BANDS; i++) {
        const f0 = 40 * (16000 / 40) ** (i / BANDS);
        const f1 = 40 * (16000 / 40) ** ((i + 1) / BANDS);
        const b0 = Math.floor((f0 / nyquist) * bins);
        const b1 = Math.max(b0 + 1, Math.floor((f1 / nyquist) * bins));
        let m = 0;
        for (let k = b0; k < b1 && k < bins; k++) m = Math.max(m, this.freq[k]);
        const v = m / 255;
        this.bands[i] = Math.max(v * v * 1.2, this.bands[i] * 0.85, this.noteBands[i] * 0.35);
      }
      let sum = 0;
      for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
      const rms = Math.sqrt(sum / this.time.length);
      const target = Math.min(1, rms * 3.2);
      this.level += (target - this.level) * (target > this.level ? 0.5 : 0.12);
      const step = Math.floor(this.time.length / this.wave.length);
      for (let i = 0; i < this.wave.length; i++) this.wave[i] = this.time[i * step];
    } else {
      // No audio to analyse: let the notes paint the spectrum.
      let e = 0;
      for (let i = 0; i < BANDS; i++) {
        this.bands[i] += (this.noteBands[i] - this.bands[i]) * 0.3;
        e = Math.max(e, this.noteBands[i]);
      }
      const target = Math.max(e * 0.8, this.external);
      this.level += (target - this.level) * (target > this.level ? 0.5 : 0.1);
      const t = performance.now() / 1000;
      for (let i = 0; i < this.wave.length; i++) {
        const x = i / this.wave.length;
        this.wave[i] = this.level * 0.6 * Math.sin(x * Math.PI * 2 * 3 + t * 6) * Math.sin(x * Math.PI);
      }
    }
  }
}
