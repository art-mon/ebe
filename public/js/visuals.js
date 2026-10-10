// Reactive visuals on a 2D canvas. Three modes:
//   nebula  — glowing particles burst from each note and swirl in a flow field
//   rings   — a radial spectrum "speaker" with rings rippling out per note
//   horizon — synthwave sun, grid rolling to the beat, light beams per note
// Pitch picks the position (low → left) and the colour (along the vibe palette);
// velocity picks the size. Drums kick, flash and sparkle.
import { DRUMS_INDEX } from './config.js';

const TAU = Math.PI * 2;
const SWATCHES = 24;
const MAX_PARTICLES = 1800;

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class Visuals {
  constructor(canvas, feed, getBeat) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.feed = feed;
    this.getBeat = getBeat;
    this.mode = 'nebula';
    this.particles = [];
    this.rings = [];
    this.beams = [];
    this.held = new Map();
    this.pulse = 0;
    this.kick = 0;
    this.flash = 0;
    this.flashColor = [255, 255, 255];
    this.time = 0;
    this.stars = Array.from({ length: 90 }, () => [Math.random(), Math.random() * 0.55, Math.random()]);
    this.setPalette(['#8ec5ff', '#b18cff', '#ff9ad5'], '#0b0a1f');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.g.fillStyle = rgba(this.bg, 1);
    this.g.fillRect(0, 0, this.w, this.h);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.rings.length = 0;
    this.beams.length = 0;
  }

  setPalette(colors, bg) {
    this.palette = colors.map(hexToRgb);
    this.bg = hexToRgb(bg);
    // Pre-render a glow sprite per swatch: drawImage is far cheaper than gradients per particle.
    this.swatches = [];
    this.sprites = [];
    for (let i = 0; i < SWATCHES; i++) {
      const c = this.#gradient(i / (SWATCHES - 1));
      this.swatches.push(c);
      const s = document.createElement('canvas');
      s.width = s.height = 64;
      const sg = s.getContext('2d');
      const grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, rgba(mix(c, [255, 255, 255], 0.35), 0.9));
      grad.addColorStop(0.18, rgba(c, 0.55));
      grad.addColorStop(0.5, rgba(c, 0.12));
      grad.addColorStop(1, rgba(c, 0));
      sg.fillStyle = grad;
      sg.fillRect(0, 0, 64, 64);
      this.sprites.push(s);
    }
  }

  #gradient(t) {
    const p = this.palette;
    const x = clamp01(t) * (p.length - 1);
    const i = Math.min(p.length - 2, Math.floor(x));
    return mix(p[i], p[i + 1], x - i);
  }

  #swatch(note) {
    return Math.round(clamp01((note - 30) / 66) * (SWATCHES - 1));
  }

  #noteX(note) {
    return (0.06 + 0.88 * clamp01((note - 28) / 72)) * this.w;
  }

  // ── events ──
  onVoice({ inst, note, vel, on }) {
    const key = inst * 128 + note;
    if (!on) {
      this.held.delete(key);
      return;
    }
    if (inst === DRUMS_INDEX) {
      this.#drum(note, vel);
      return;
    }
    this.held.set(key, { note, vel, inst });
    const s = this.#swatch(note);
    const x = this.#noteX(note);
    if (this.mode === 'nebula') {
      const y = this.h * (0.72 - 0.25 * clamp01((note - 36) / 60));
      this.#burst(x, y, s, 18 + vel * 50, 70 + vel * 220);
    } else if (this.mode === 'rings') {
      this.rings.push({ r: this.#coreRadius(), speed: 90 + vel * 260, width: 1 + vel * 5, s, life: 1 });
    } else {
      this.beams.push({ x, s, h: 0.25 + vel * 0.6, life: 1, key });
    }
  }

  onBeat({ downbeat, countIn }) {
    this.pulse = downbeat ? 1 : 0.55;
    if (countIn && this.mode !== 'horizon') {
      this.rings.push({ r: this.#coreRadius(), speed: 340, width: downbeat ? 3 : 1.5, s: SWATCHES - 1, life: 0.6 });
    }
  }

  #drum(note, vel) {
    switch (note) {
      case 36: // kick
        this.kick = Math.min(1.3, 0.6 + vel);
        this.rings.push({ r: this.#coreRadius(), speed: 420, width: 6 * vel + 2, s: 2, life: 0.9, white: true });
        if (this.mode === 'nebula') this.#burst(this.w / 2, this.h * 0.85, 2, 30 * vel, 260);
        break;
      case 38:
      case 39: // snare / clap
        this.flash = Math.max(this.flash, 0.08 + vel * 0.07);
        this.flashColor = this.palette[1];
        if (this.mode === 'nebula') this.#burst(this.w * (0.3 + Math.random() * 0.4), this.h * 0.4, SWATCHES - 4, 24 * vel, 220);
        break;
      case 42:
      case 46:
      case 37: // hats / rim → sparkles along the top
        for (let i = 0; i < 6; i++) {
          this.#burst(Math.random() * this.w, this.h * (0.08 + Math.random() * 0.2), SWATCHES - 1, 2, 60);
        }
        break;
      case 49: // crash
        this.flash = Math.max(this.flash, 0.16);
        this.flashColor = this.palette[2];
        break;
      default: // toms
        this.rings.push({ r: this.#coreRadius() * 0.6, speed: 260, width: 3, s: 6, life: 0.8 });
    }
  }

  #burst(x, y, s, count, speed) {
    // Fractional counts are honoured on average, so slow emitters still sparkle.
    let n = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0);
    while (n-- > 0) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const a = Math.random() * TAU;
      const v = speed * (0.2 + Math.random() * 0.8);
      const life = 1 + Math.random() * 2.2;
      const cloud = Math.random() < 0.08; // a few big, faint puffs give the "nebula" haze
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.2,
        life, max: life,
        size: cloud ? 50 + Math.random() * 70 : 4 + Math.random() * 14,
        alpha: cloud ? 0.18 : 0.85,
        s: Math.max(0, Math.min(SWATCHES - 1, s + Math.round((Math.random() - 0.5) * 4))),
      });
    }
  }

  #coreRadius() {
    return Math.min(this.w, this.h) * 0.16;
  }

  // ── frame ──
  frame(dt) {
    this.time += dt;
    this.pulse *= Math.exp(-dt * 5);
    this.kick *= Math.exp(-dt * 7);
    this.flash *= Math.exp(-dt * 9);
    const g = this.g;
    g.save();
    if (this.kick > 0.05) {
      const k = this.kick * 4;
      g.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    if (this.mode === 'rings') this.#rings(dt);
    else if (this.mode === 'horizon') this.#horizon(dt);
    else this.#nebula(dt);
    g.restore();

    if (this.flash > 0.01) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba(this.flashColor, this.flash);
      g.fillRect(0, 0, this.w, this.h);
      g.globalCompositeOperation = 'source-over';
    }
  }

  #updateParticles(dt, swirl) {
    const g = this.g;
    const t = this.time;
    const drag = Math.exp(-dt * 1.6);
    const energy = 0.6 + this.feed.level * 1.4;
    g.globalCompositeOperation = 'lighter';
    let alive = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const ang = (Math.sin(p.x * 0.0042 + t * 0.35) + Math.cos(p.y * 0.0038 - t * 0.27)) * Math.PI;
      p.vx = (p.vx + Math.cos(ang) * swirl * energy * dt) * drag;
      p.vy = (p.vy + Math.sin(ang) * swirl * energy * dt - 14 * dt) * drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      const size = p.size * (0.4 + k * 0.6) * (1 + this.pulse * 0.25);
      g.globalAlpha = Math.min(1, k * 1.5) * p.alpha;
      g.drawImage(this.sprites[p.s], p.x - size / 2, p.y - size / 2, size, size);
      this.particles[alive++] = p;
    }
    this.particles.length = alive;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  #nebula(dt) {
    const { g, w, h } = this;
    g.fillStyle = rgba(this.bg, 0.2);
    g.fillRect(-10, -10, w + 20, h + 20);

    // A soft breathing glow that follows the overall level.
    const glow = g.createRadialGradient(w / 2, h * 0.75, 0, w / 2, h * 0.75, Math.max(w, h) * 0.7);
    glow.addColorStop(0, rgba(this.palette[0], 0.03 + this.feed.level * 0.1 + this.pulse * 0.03));
    glow.addColorStop(1, rgba(this.palette[0], 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);

    // Held notes keep sparkling (~20 particles/s each).
    for (const n of this.held.values()) {
      const y = h * (0.72 - 0.25 * clamp01((n.note - 36) / 60));
      this.#burst(this.#noteX(n.note), y, this.#swatch(n.note), (10 + n.vel * 20) * dt, 70);
    }
    this.#updateParticles(dt, 260);
  }

  #rings(dt) {
    const { g, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const level = this.feed.level;
    const R = this.#coreRadius() * (1 + level * 0.25 + this.pulse * 0.06 + this.kick * 0.08);
    g.fillStyle = rgba(this.bg, 0.28);
    g.fillRect(-10, -10, w + 20, h + 20);

    g.globalCompositeOperation = 'lighter';
    // Radial spectrum, mirrored left/right.
    const bands = this.feed.bands;
    const n = bands.length;
    const maxLen = Math.min(w, h) * 0.3;
    const rot = this.time * 0.05;
    g.lineCap = 'round';
    g.lineWidth = Math.max(2, (TAU * R) / (n * 2) - 2);
    for (let i = 0; i < n; i++) {
      const len = 4 + bands[i] * maxLen;
      g.strokeStyle = rgba(this.swatches[Math.round((i / n) * (SWATCHES - 1))], 0.85);
      for (const side of [1, -1]) {
        const a = -Math.PI / 2 + side * ((i + 0.5) / n) * Math.PI + rot;
        const c = Math.cos(a);
        const s = Math.sin(a);
        g.beginPath();
        g.moveTo(cx + c * (R + 6), cy + s * (R + 6));
        g.lineTo(cx + c * (R + 6 + len), cy + s * (R + 6 + len));
        g.stroke();
      }
    }

    // Core disc with the live waveform wrapped around it.
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    core.addColorStop(0, rgba(this.palette[2], 0.35 + level * 0.4));
    core.addColorStop(1, rgba(this.palette[0], 0.05));
    g.fillStyle = core;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.fill();
    const wave = this.feed.wave;
    g.strokeStyle = rgba(mix(this.palette[2], [255, 255, 255], 0.5), 0.8);
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= wave.length; i++) {
      const a = (i / wave.length) * TAU;
      const r = R * 0.72 + wave[i % wave.length] * R * 0.6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // Note rings.
    let alive = 0;
    for (const ring of this.rings) {
      ring.life -= dt * 0.55;
      ring.r += ring.speed * dt;
      if (ring.life <= 0) continue;
      g.strokeStyle = ring.white ? `rgba(255,255,255,${ring.life * 0.7})` : rgba(this.swatches[ring.s], ring.life);
      g.lineWidth = ring.width * ring.life + 0.5;
      g.beginPath();
      g.arc(cx, cy, ring.r, 0, TAU);
      g.stroke();
      this.rings[alive++] = ring;
    }
    this.rings.length = alive;

    // Held notes orbit the core: angle = pitch class, distance = octave.
    for (const nn of this.held.values()) {
      const a = ((nn.note % 12) / 12) * TAU - Math.PI / 2 + this.time * 0.6;
      const d = R * (1.35 + Math.floor(nn.note / 12 - 2) * 0.22);
      const size = 18 + nn.vel * 30;
      g.drawImage(this.sprites[this.#swatch(nn.note)], cx + Math.cos(a) * d - size / 2, cy + Math.sin(a) * d - size / 2, size, size);
    }
    g.globalCompositeOperation = 'source-over';
    this.#updateParticles(dt, 120);
  }

  #horizon(dt) {
    const { g, w, h } = this;
    const hy = h * 0.58;
    const level = this.feed.level;
    const beat = this.getBeat();

    // Sky
    const sky = g.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, rgba(this.bg, 1));
    sky.addColorStop(1, rgba(mix(this.bg, this.palette[1], 0.35), 1));
    g.fillStyle = sky;
    g.fillRect(-10, -10, w + 20, hy + 10);
    for (const [sx, sy, tw] of this.stars) {
      const a = 0.25 + 0.5 * Math.abs(Math.sin(this.time * (0.5 + tw) + tw * 10));
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(sx * w, sy * h, 1.6, 1.6);
    }

    // Sun with retro stripes
    const sr = Math.min(w, h) * 0.2 * (1 + level * 0.12 + this.pulse * 0.04);
    const sx = w / 2;
    const sy = hy - sr * 0.35;
    g.save();
    g.beginPath();
    g.rect(0, 0, w, hy);
    g.clip();
    const sun = g.createLinearGradient(0, sy - sr, 0, sy + sr);
    sun.addColorStop(0, rgba(this.palette[2], 1));
    sun.addColorStop(1, rgba(this.palette[0], 1));
    g.fillStyle = sun;
    g.beginPath();
    g.arc(sx, sy, sr, 0, TAU);
    g.fill();
    g.fillStyle = rgba(mix(this.bg, this.palette[1], 0.3), 1);
    for (let i = 0; i < 7; i++) {
      const y = sy + sr * (0.05 + i * 0.14);
      g.fillRect(sx - sr, y, sr * 2, 2 + i * 1.6);
    }
    g.restore();

    // Spectrum mountains on the horizon
    const bands = this.feed.bands;
    g.fillStyle = rgba(mix(this.bg, this.palette[0], 0.25), 0.95);
    g.beginPath();
    g.moveTo(0, hy);
    const n = bands.length;
    for (let i = 0; i <= n; i++) {
      const v = bands[Math.min(n - 1, Math.abs(Math.round(n - 1 - i * 2 + n)) % n)];
      g.lineTo((i / n) * w, hy - 6 - v * h * 0.16);
    }
    g.lineTo(w, hy);
    g.closePath();
    g.fill();

    // Floor + grid rolling toward us, one line per beat
    g.fillStyle = rgba(mix(this.bg, [0, 0, 0], 0.3), 1);
    g.fillRect(-10, hy, w + 20, h - hy + 10);
    const bright = 0.35 + this.kick * 0.5 + this.pulse * 0.15;
    g.strokeStyle = rgba(this.palette[0], bright);
    g.lineWidth = 1.2;
    const phase = ((beat % 1) + 1) % 1;
    for (let i = 0; i < 18; i++) {
      const z = i + 1 - phase;
      const y = hy + (h - hy) * (1 / (1 + z * 0.55)) ** 1.1;
      g.globalAlpha = clamp01(1 - z / 18);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.globalAlpha = 1;
    for (let i = -12; i <= 12; i++) {
      g.beginPath();
      g.moveTo(w / 2 + i * w * 0.012, hy);
      g.lineTo(w / 2 + i * w * 0.16, h);
      g.stroke();
    }

    // Note beams rising from the horizon (with a reflection on the floor)
    g.globalCompositeOperation = 'lighter';
    const heldKeys = new Set(this.held.keys());
    let alive = 0;
    for (const b of this.beams) {
      if (!heldKeys.has(b.key)) b.life -= dt * 0.9;
      if (b.life <= 0) continue;
      const c = this.swatches[b.s];
      const bh = b.h * hy * (0.6 + 0.4 * b.life);
      const bw = 6 + b.h * 10;
      const up = g.createLinearGradient(0, hy - bh, 0, hy);
      up.addColorStop(0, rgba(c, 0));
      up.addColorStop(1, rgba(c, 0.85 * b.life));
      g.fillStyle = up;
      g.fillRect(b.x - bw / 2, hy - bh, bw, bh);
      const down = g.createLinearGradient(0, hy, 0, hy + bh * 0.5);
      down.addColorStop(0, rgba(c, 0.4 * b.life));
      down.addColorStop(1, rgba(c, 0));
      g.fillStyle = down;
      g.fillRect(b.x - bw / 2, hy, bw, bh * 0.5);
      this.beams[alive++] = b;
    }
    this.beams.length = alive;
    g.globalCompositeOperation = 'source-over';
    this.#updateParticles(dt, 80);
  }
}
