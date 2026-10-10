// Two slow, ambient scenes for the stage:
//
//   Oil       a painted night sky: thick brush strokes drift along a swirling flow
//             field (impasto ridges and all), a glowing moon, a dark shoreline with
//             a few lights, and the whole sky reflected in rippling water.
//             Notes splash bright strokes; the music stirs the swirl.
//
//   Stardust  a cosmic iris: thousands of glittering particles form an eye-like
//             ring that slowly turns between "eye" and "galaxy", inside drifting
//             nebula clouds. The pupil breathes with the music; notes send
//             coloured ripples through the ring.
//
// Both draw onto the Visuals canvas and read its palette, audio feed and clock.

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const WHITE = [255, 255, 255];

// Smooth 3D value noise (0..1): cheap, good enough for flow fields and drifting clouds.
const PERM = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const fade = (t) => t * t * (3 - 2 * t);
const hash = (x, y, z) => PERM[PERM[PERM[x & 255] + (y & 255)] + (z & 255)] / 255;
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export class OilScene {
  constructor(v) {
    this.v = v;
    this.paint = document.createElement('canvas');
    this.pg = this.paint.getContext('2d');
    this.brushes = [];
    this.swirl = 0;
    this.resize();
  }

  resize() {
    const { w, h } = this.v;
    this.scale = Math.min(window.devicePixelRatio || 1, 1.5);
    this.horizon = Math.round(h * 0.64);
    this.paint.width = Math.max(1, Math.round(w * this.scale));
    this.paint.height = Math.max(1, Math.round(this.horizon * this.scale));
    this.pg.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.#ground();
    this.#underpaint();
    this.brushes = Array.from({ length: Math.round(Math.min(700, w * 0.8)) }, () => this.#brush());
  }

  setPalette() {
    // New strokes pick up the new colours and gradually paint over the old ones.
    this.#colors();
  }

  #colors() {
    const { palette: p, bg } = this.v;
    this.cols = {
      deep: mix(bg, p[0], 0.22),
      cool: p[0],
      accent: p[1],
      warm: p[2],
      light: mix(p[2], WHITE, 0.55),
    };
  }

  #underpaint() {
    this.#colors();
    const { w } = this.v;
    const g = this.pg;
    const grad = g.createLinearGradient(0, 0, 0, this.horizon);
    grad.addColorStop(0, rgba(this.v.bg, 1));
    grad.addColorStop(0.65, rgba(this.cols.deep, 1));
    grad.addColorStop(1, rgba(mix(this.cols.deep, this.cols.warm, 0.35), 1));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, this.horizon);
  }

  /** A low shoreline with a few house lights, generated once per size. */
  #ground() {
    const { w } = this.v;
    this.shore = [];
    for (let x = 0; x <= w; x += 6) {
      const n = noise3(x * 0.006, 3.7, 0.5);
      this.shore.push([x, 4 + n * n * 26 + (noise3(x * 0.03, 9.1, 0.2) - 0.5) * 6]);
    }
    this.lights = Array.from({ length: Math.round(w / 90) }, () => ({ x: Math.random() * w, phase: Math.random() * TAU }));
  }

  #moon() {
    const { w } = this.v;
    const t = this.v.time;
    return [w * (0.68 + Math.sin(t * 0.013) * 0.08), this.horizon * (0.3 + Math.sin(t * 0.017) * 0.05)];
  }

  #brush(x, y, burst = null) {
    const { w } = this.v;
    const hy = this.horizon;
    x ??= Math.random() * w;
    y ??= Math.random() * hy * 0.98;
    // Darker, cooler strokes up high; warmer, lighter ones near the horizon glow.
    const k = y / hy + (Math.random() - 0.5) * 0.3;
    const c = this.cols;
    const r = Math.random();
    const color = burst ?? (
      k < 0.45 ? mix(c.deep, c.cool, r * 0.65) // the night sky: mostly deep tones
        : k < 0.8 ? mix(c.deep, c.accent, 0.25 + r * 0.5)
          : mix(c.cool, c.warm, r * 0.8)); // a warmer band just above the horizon
    const life = burst ? 0.8 + Math.random() * 1.2 : 2 + Math.random() * 5;
    return {
      x, y, px: x, py: y, color, light: mix(color, WHITE, 0.45),
      width: (burst ? 4 : 2) + Math.random() * (burst ? 8 : 6),
      speed: (burst ? 60 : 16) + Math.random() * (burst ? 90 : 30),
      life, max: life, burst: !!burst,
    };
  }

  #angle(x, y, t) {
    const [mx, my] = this.#moon();
    let a = noise3(x * 0.0032, y * 0.0045, t * 0.035) * TAU * 1.7;
    // Van Gogh-style vortex around the moon, stronger when the music swells.
    const dx = x - mx, dy = y - my;
    const d = Math.hypot(dx, dy);
    const pull = Math.exp(-d / (this.v.w * 0.22)) * (0.75 + this.swirl * 0.25);
    const around = Math.atan2(dy, dx) + Math.PI / 2 + 0.25;
    // Blend angles along the short way round.
    let diff = ((around - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    a += diff * clamp01(pull);
    return a;
  }

  onVoice({ note, vel }) {
    const x = this.v.noteX(note);
    const y = this.horizon * (0.38 + Math.random() * 0.3);
    const color = this.v.swatches[this.v.swatch(note)];
    const n = Math.round(10 + vel * 22);
    for (let i = 0; i < n; i++) {
      const b = this.#brush(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 30, Math.random() < 0.7 ? color : this.cols.light);
      this.brushes.push(b);
    }
    if (this.brushes.length > 1100) this.brushes.splice(0, this.brushes.length - 1100);
  }

  onDrum(note, vel) {
    if (note === 36) this.swirl = Math.min(2, this.swirl + vel);
  }

  frame(dt) {
    const v = this.v;
    const { w, h } = v;
    const t = v.time;
    const hy = this.horizon;
    const level = v.feed.level;
    this.swirl = Math.max(0, this.swirl - dt * 0.8) + level * dt * 0.6;
    const pg = this.pg;

    // ── paint the sky ──
    pg.globalCompositeOperation = 'source-over';
    pg.fillStyle = rgba(this.cols.deep, 0.008); // the oldest strokes slowly sink back
    pg.fillRect(0, 0, w, hy);
    pg.lineCap = 'round';
    const speedUp = 1 + level * 1.6 + this.swirl * 0.6;
    let alive = 0;
    for (const b of this.brushes) {
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > w + 20 || b.y < -20 || b.y > hy + 4) {
        if (b.burst) continue;
        Object.assign(b, this.#brush());
      }
      const a = this.#angle(b.x, b.y, t);
      b.px = b.x;
      b.py = b.y;
      b.x += Math.cos(a) * b.speed * speedUp * dt;
      b.y += Math.sin(a) * b.speed * speedUp * dt * 0.8;
      const fadeIn = Math.min(1, (b.max - b.life) * 3) * Math.min(1, b.life * 2);
      // Body of the stroke, then a thin lighter ridge on top — the impasto look.
      pg.strokeStyle = rgba(b.color, 0.24 * fadeIn);
      pg.lineWidth = b.width;
      pg.beginPath();
      pg.moveTo(b.px, b.py);
      pg.lineTo(b.x, b.y);
      pg.stroke();
      pg.strokeStyle = rgba(b.light, (b.burst ? 0.22 : 0.09) * fadeIn);
      pg.lineWidth = b.width * 0.32;
      pg.beginPath();
      pg.moveTo(b.px - 0.8, b.py - 0.8);
      pg.lineTo(b.x - 0.8, b.y - 0.8);
      pg.stroke();
      this.brushes[alive++] = b;
    }
    this.brushes.length = alive;

    // ── compose: sky, moon, shore, water ──
    const g = v.g;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(this.paint, 0, 0, w, hy);

    const [mx, my] = this.#moon();
    const mr = Math.min(w, h) * 0.05;
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(mx, my, 0, mx, my, mr * (6 + level * 4 + v.pulse));
    halo.addColorStop(0, rgba(this.cols.light, 0.35 + level * 0.25));
    halo.addColorStop(0.15, rgba(this.cols.warm, 0.18));
    halo.addColorStop(1, rgba(this.cols.warm, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, w, hy);
    g.fillStyle = rgba(mix(this.cols.light, WHITE, 0.5), 0.9);
    g.beginPath();
    g.arc(mx, my, mr * 0.55, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'source-over';

    // Water: the sky mirrored in thin strips that sway like ripples.
    const waterH = h - hy;
    const src = this.paint;
    const sScale = this.scale;
    for (let y = 0; y < waterH; y += 3) {
      const k = y / waterH;
      const srcY = Math.max(0, hy - 2 - y * 0.95);
      const sway = Math.sin(y * 0.18 + t * 1.3) * (1.5 + k * 9) + (noise3(y * 0.05, t * 0.4, 1.3) - 0.5) * 10 * k;
      g.globalAlpha = 0.72 - k * 0.38;
      g.drawImage(src, 0, srcY * sScale, src.width, 3 * sScale, sway, hy + y, w, 3);
    }
    g.globalAlpha = 1;
    const tint = g.createLinearGradient(0, hy, 0, h);
    tint.addColorStop(0, rgba(v.bg, 0.15));
    tint.addColorStop(1, rgba(v.bg, 0.7));
    g.fillStyle = tint;
    g.fillRect(0, hy, w, waterH);

    // The moon's path on the water: flickering horizontal glints.
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const y = hy + 4 + (i / 26) ** 1.4 * waterH * 0.9;
      const flick = noise3(i * 0.7, t * 1.6, 4.2);
      if (flick < 0.45) continue;
      const len = (8 + (i / 26) * 50) * flick;
      g.fillStyle = rgba(this.cols.light, (flick - 0.45) * 0.9);
      g.fillRect(mx - len / 2 + Math.sin(t * 2 + i) * 4, y, len, 1.6);
    }
    g.globalCompositeOperation = 'source-over';

    // Shoreline silhouette with a few warm lights.
    g.fillStyle = rgba(mix(v.bg, [0, 0, 0], 0.4), 1);
    g.beginPath();
    g.moveTo(0, hy + 2);
    for (const [x, hh] of this.shore) g.lineTo(x, hy + 2 - hh);
    g.lineTo(w, hy + 2);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'lighter';
    for (const L of this.lights) {
      const a = 0.45 + 0.4 * Math.sin(t * 1.1 + L.phase);
      g.fillStyle = rgba(this.cols.light, a);
      g.fillRect(L.x, hy - 3, 2.2, 2.2);
    }
    g.globalCompositeOperation = 'source-over';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
const FIBERS = 220;

export class StardustScene {
  constructor(v) {
    this.v = v;
    this.ripples = [];
    this.#build();
    this.resize();
  }

  #build() {
    // Iris: particles along radial fibres between the pupil (r = 0.32) and the rim (r = 1).
    const pts = [];
    for (let i = 0; i < 3200; i++) {
      const fiber = Math.floor(Math.random() * FIBERS);
      const r = 0.32 + 0.68 * Math.random() ** 0.85;
      const a = ((fiber + (Math.random() - 0.5) * 0.6) / FIBERS) * TAU + Math.sin(r * 9 + fiber) * 0.03;
      pts.push({ r, a, z: (Math.random() - 0.5) * 0.08 * (1.2 - r), shell: false, size: 1 + Math.random() * 1.6, phase: Math.random() * TAU, tw: 2 + Math.random() * 5, ct: (r - 0.32) / 0.68 });
    }
    // Halo: a loose shell of glitter dust around it.
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * TAU;
      const rr = 1.15 + Math.random() ** 2 * 0.9;
      const s = Math.sqrt(1 - u * u);
      pts.push({ x: Math.cos(th) * s * rr, y: u * rr * 0.75, z: Math.sin(th) * s * rr, shell: true, size: 0.6 + Math.random(), phase: Math.random() * TAU, tw: 1 + Math.random() * 3, ct: 0.6 + Math.random() * 0.4 });
    }
    this.points = pts;
    this.stars = Array.from({ length: 240 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.4 + 0.3, ph: Math.random() * TAU }));
    this.clouds = Array.from({ length: 7 }, (_, i) => ({ seed: i * 13.7, r: 0.35 + Math.random() * 0.45, c: i % 3 }));
  }

  resize() {}

  setPalette() {}

  onVoice({ note, vel }) {
    this.ripples.push({ r: 0.3, speed: 0.35 + vel * 0.5, life: 1, s: this.v.swatch(note), strength: 0.5 + vel });
    if (this.ripples.length > 12) this.ripples.shift();
  }

  onDrum(note, vel) {
    if (note === 36) this.ripples.push({ r: 0.25, speed: 0.9, life: 0.7, s: this.v.swatches.length - 1, strength: 0.6 * vel });
  }

  frame(dt) {
    const v = this.v;
    const { g, w, h } = v;
    const t = v.time;
    const level = v.feed.level;
    const p = v.palette;

    // Deep space.
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = rgba(mix(v.bg, [0, 0, 0], 0.35), 1);
    g.fillRect(-10, -10, w + 20, h + 20);

    // Nebula clouds drifting on noise.
    g.globalCompositeOperation = 'lighter';
    const m = Math.max(w, h);
    for (const c of this.clouds) {
      const x = w * noise3(c.seed, t * 0.012, 0.3) * 1.2 - w * 0.1;
      const y = h * noise3(c.seed + 5, t * 0.01, 7.1) * 1.2 - h * 0.1;
      const r = m * c.r * (0.9 + 0.2 * noise3(c.seed, t * 0.03, 2));
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(p[c.c], 0.16 + level * 0.08));
      grad.addColorStop(0.5, rgba(p[c.c], 0.05));
      grad.addColorStop(1, rgba(p[c.c], 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    // Stars.
    for (const s of this.stars) {
      g.fillStyle = `rgba(255,255,255,${0.25 + 0.55 * Math.abs(Math.sin(t * 0.6 + s.ph))})`;
      g.fillRect(s.x * w, s.y * h, s.s, s.s);
    }

    // The iris turns slowly between face-on (an eye) and tilted (a galaxy).
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w * 0.3, h * 0.44) * (1 + level * 0.1 + v.kick * 0.06);
    const tilt = Math.sin(t * 0.05) * 1.05;
    const spin = t * 0.06;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const pupil = 0.32 * (1 + 0.18 * Math.sin(t * 0.35) + level * 0.35);

    // Warm glow at the centre (behind the particles).
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.9);
    core.addColorStop(0, rgba(mix(p[2], WHITE, 0.3), 0.32 + level * 0.25));
    core.addColorStop(0.35, rgba(p[2], 0.12));
    core.addColorStop(1, rgba(p[0], 0));
    g.fillStyle = core;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);

    for (const r of this.ripples) {
      r.r += r.speed * dt;
      r.life -= dt * 0.45;
    }
    this.ripples = this.ripples.filter((r) => r.life > 0 && r.r < 2.2);

    const swatches = v.swatches;
    const last = swatches.length - 1;
    const focal = 3.2;
    for (const pt of this.points) {
      let x, y, z;
      let boost = 0;
      let rippleS = -1;
      if (!pt.shell) {
        // Remap radius so the pupil can dilate and contract.
        const r = pupil + (pt.r - 0.32) * ((1 - pupil) / 0.68);
        for (const rp of this.ripples) {
          const d = Math.abs(r - rp.r);
          if (d < 0.06) {
            const k = (1 - d / 0.06) * rp.life * rp.strength;
            if (k > boost) {
              boost = k;
              rippleS = rp.s;
            }
          }
        }
        const a = pt.a + spin;
        const rr = r * (1 + boost * 0.05);
        x = Math.cos(a) * rr;
        y = Math.sin(a) * rr;
        z = pt.z;
      } else {
        const a = spin * 0.6;
        x = pt.x * Math.cos(a) - pt.z * Math.sin(a);
        z = pt.x * Math.sin(a) + pt.z * Math.cos(a);
        y = pt.y;
      }
      // Tilt around the horizontal axis, then a gentle perspective.
      const y2 = y * ct - z * st;
      const z2 = y * st + z * ct;
      const persp = focal / (focal + z2);
      const sx = cx + x * R * persp;
      const sy = cy + y2 * R * persp;
      // Glitter: most points glow softly, now and then one flares.
      const tw = Math.sin(t * pt.tw + pt.phase);
      const sparkle = tw > 0.96 ? (tw - 0.96) * 25 : 0;
      const alpha = clamp01((pt.shell ? 0.2 : 0.34) * persp + sparkle * 0.55 + boost * 0.8);
      if (alpha < 0.02) continue;
      const sw = rippleS >= 0 ? rippleS : Math.round((1 - pt.ct) * last);
      g.fillStyle = rgba(boost > 0.3 ? mix(swatches[sw], WHITE, 0.3) : swatches[sw], alpha);
      const size = pt.size * persp * (1 + sparkle * 1.5 + boost);
      g.fillRect(sx - size / 2, sy - size / 2, size, size);
    }

    // A soft catch-light, like a reflection on an eye.
    const gx = cx - R * 0.16, gy = cy - R * 0.18;
    const glint = g.createRadialGradient(gx, gy, 0, gx, gy, R * 0.09);
    glint.addColorStop(0, `rgba(255,255,255,${0.35 + level * 0.3})`);
    glint.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glint;
    g.fillRect(gx - R * 0.1, gy - R * 0.1, R * 0.2, R * 0.2);
    g.globalCompositeOperation = 'source-over';
  }
}
