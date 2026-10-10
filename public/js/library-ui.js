// The track name + Save in the top bar, and "Your tracks": one card per saved
// track with a mini piano roll of its loops, so you can find a song by eye.
import { state } from './state.js';
import { INSTRUMENTS, DRUMS_INDEX, DRUM_VOICES, VIBES, SCALES, NOTE_NAMES } from './config.js';
import { emptySong } from './song.js';
import { $, h } from './dom.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", "3 Oct" */
export function ago(t, now = Date.now()) {
  const s = Math.round((t - now) / 1000);
  if (s > -45) return 'just now';
  if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
  if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (s > -7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/**
 * A small piano roll of a track's loops as SVG markup: every loop laid over the
 * longest one (shorter loops repeat, a little fainter), notes by pitch in their
 * instrument colour, drum hits in a strip at the bottom.
 */
export function previewSvg(track, W = 300, H = 84) {
  const loops = (track.loops ?? []).filter((l) => l.events?.length);
  const bg = `<rect width="${W}" height="${H}" rx="8" fill="rgba(0,0,0,.28)"/>`;
  if (!loops.length) {
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${bg}<text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" fill="rgba(255,255,255,.35)" font-size="12">no loops yet</text></svg>`;
  }
  const span = Math.max(...loops.map((l) => l.bars)) * 4;
  const notes = loops.flatMap((l) => l.events).filter((e) => e.inst !== DRUMS_INDEX).map((e) => e.note);
  let lo = Math.min(...notes, Infinity);
  let hi = Math.max(...notes, -Infinity);
  if (!notes.length) [lo, hi] = [60, 72];
  if (hi - lo < 12) [lo, hi] = [lo - Math.floor((12 - (hi - lo)) / 2), lo - Math.floor((12 - (hi - lo)) / 2) + 12];
  const hasDrums = loops.some((l) => l.events.some((e) => e.inst === DRUMS_INDEX));
  const top = 7;
  const bottom = hasDrums ? H - 22 : H - 7;
  const parts = [bg];
  for (let b = 4; b < span; b += 4) parts.push(`<rect x="${((b / span) * W).toFixed(1)}" y="4" width="1" height="${H - 8}" fill="rgba(255,255,255,.06)"/>`);
  for (const loop of loops) {
    const L = loop.bars * 4;
    for (let rep = 0; rep * L < span; rep++) {
      for (const e of loop.events) {
        const x = (((rep * L + e.pos) / span) * W).toFixed(1);
        const color = INSTRUMENTS[e.inst]?.color ?? '#fff';
        const alpha = ((rep ? 0.45 : 0.95) * (0.45 + (e.vel ?? 100) / 230)).toFixed(2);
        if (e.inst === DRUMS_INDEX) {
          const v = Math.max(0, DRUM_VOICES.findIndex((d) => d.note === e.note));
          parts.push(`<rect x="${x}" y="${H - 18 + (v % 8) * 1.6}" width="2" height="3" rx="1" fill="${color}" opacity="${alpha}"/>`);
        } else {
          const y = (bottom - ((e.note - lo) / (hi - lo)) * (bottom - top)).toFixed(1);
          const w = Math.max(2, (e.dur / span) * W).toFixed(1);
          parts.push(`<rect x="${x}" y="${y - 1.5}" width="${w}" height="3" rx="1.5" fill="${color}" opacity="${alpha}"/>`);
        }
      }
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${parts.join('')}</svg>`;
}

function describeTrack(t) {
  const s = t.settings ?? {};
  const loops = (t.loops ?? []).filter((l) => l.events?.length).length;
  const key = s.keyMode === 'off' ? 'free play' : `${NOTE_NAMES[s.root] ?? ''} ${SCALES[s.scale]?.name ?? ''}`.trim();
  const song = t.song?.sections?.some((sec) => sec.on.some(Boolean));
  return [s.tempo ? `${Math.round(s.tempo)} BPM` : null, key, `${loops} loop${loops === 1 ? '' : 's'}`, song ? 'song' : null].filter(Boolean).join(' · ');
}

export class LibraryView {
  constructor({ library, looper, bus, toast }) {
    this.library = library;
    this.looper = looper;
    this.toast = toast;
    this.tracks = [];
    this.modal = $('#library');

    $('#btn-library').addEventListener('click', () => this.open());
    $('#btn-save').addEventListener('click', () => this.save());
    $('#lib-new').addEventListener('click', () => this.newTrack());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-close]')) this.close();
    });
    window.addEventListener('keydown', (e) => {
      const mod = mac ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) this.saveAs();
        else this.save();
      } else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.open();
      } else if (e.key === 'Escape' && this.isOpen && !$('#ask').classList.contains('open')) {
        this.close();
      }
    });
    bus.on('library', () => this.render());
    this.render();
  }

  get isOpen() {
    return this.modal.classList.contains('open');
  }

  // ── top bar ──
  render() {
    const { current, dirty, available } = this.library;
    $('#track-name').textContent = current.name;
    const btn = $('#btn-library');
    btn.classList.toggle('unsaved', dirty && (!!current.id || this.library.hasContent()));
    btn.title = `Your tracks (${mac ? '⌘' : 'Ctrl+'}O)`;
    const save = $('#btn-save');
    const saved = !!current.id && !dirty;
    save.textContent = saved ? 'Saved' : 'Save';
    save.classList.toggle('saved', saved);
    save.classList.toggle('attn', !saved && this.library.hasContent());
    save.title = available ? `Save (${mac ? '⌘' : 'Ctrl+'}S)` : 'Restart Lumen’s server to turn on saving';
    document.title = `${dirty && current.id ? '● ' : ''}${current.id ? current.name : 'Lumen'}${current.id ? ' · Lumen' : ''}`;
  }

  #needsServer() {
    if (this.library.available) return false;
    this.toast('Saving needs the new Lumen server: stop it (Ctrl+C) and run npm start again, then reload.', 6000);
    return true;
  }

  async save() {
    if (this.#needsServer()) return;
    if (!this.library.current.id) return this.saveAs();
    if (!this.library.dirty) {
      this.toast(`“${this.library.current.name}” is saved`, 1600);
      return;
    }
    try {
      await this.library.save();
      this.toast(`Saved “${this.library.current.name}” ✓`, 1800);
    } catch (err) {
      this.toast(`Couldn’t save (${err.message})`, 5000);
    }
  }

  async saveAs() {
    if (this.#needsServer()) return;
    const first = !this.library.current.id;
    const name = await this.ask({
      title: first ? 'Name this track' : 'Save as a new track',
      text: first ? 'You’ll find it under this name in Your tracks.' : 'The current track stays as it was; this makes a new one.',
      input: first ? this.#suggestName() : `${this.library.current.name} 2`,
      ok: 'Save',
    });
    if (!name) return;
    try {
      await this.library.save(name, true);
      this.toast(`Saved “${name}” ✓`, 1800);
      if (this.isOpen) this.refresh();
    } catch (err) {
      this.toast(`Couldn’t save (${err.message})`, 5000);
    }
  }

  /** "Dreamy · 10 Oct" — selected in the name field, so typing replaces it. */
  #suggestName() {
    return `${VIBES[state.vibe].name} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  }

  /** Before replacing the session: offer to save unsaved work. Resolves false to cancel. */
  async #keepWork(action) {
    const { current, dirty } = this.library;
    if (!dirty || (!current.id && !this.library.hasContent())) return true;
    const choice = await this.ask({
      title: current.id ? `Save changes to “${current.name}”?` : 'Save your loops first?',
      text: current.id ? `They’ll be lost when you ${action}.` : `This session isn’t saved as a track yet. It’ll be replaced when you ${action}.`,
      buttons: [['discard', 'Don’t save', 'ghost'], ['cancel', 'Cancel', 'ghost'], ['save', 'Save', 'primary']],
    });
    if (choice === 'cancel' || !choice) return false;
    if (choice === 'save') {
      try {
        if (current.id) await this.library.save();
        else {
          const name = await this.ask({ title: 'Name this track', input: this.#suggestName(), ok: 'Save' });
          if (!name) return false;
          await this.library.save(name);
        }
      } catch (err) {
        this.toast(`Couldn’t save (${err.message})`, 5000);
        return false;
      }
    }
    return true;
  }

  async newTrack() {
    if (!(await this.#keepWork('start a new track'))) return;
    this.library.newTrack(emptySong(this.looper.loops.length));
    this.close();
    this.toast('New track — loops and song are empty, your sound stays', 2400);
  }

  // ── library ──
  async open() {
    if (this.#needsServer()) return;
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
    $('#lib-where').textContent = `Saved as files in ${this.library.dir.replace(/^\/Users\/[^/]+/, '~')}`;
    await this.refresh();
  }

  close() {
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
  }

  async refresh() {
    const grid = $('#lib-grid');
    try {
      this.tracks = await this.library.list();
    } catch (err) {
      grid.replaceChildren(h('p', { class: 'muted' }, `Couldn’t read your tracks (${err.message}).`));
      return;
    }
    if (!this.tracks.length) {
      grid.replaceChildren(h('div', { class: 'lib-empty' },
        h('p', {}, 'No saved tracks yet.'),
        h('p', { class: 'muted small' }, `Record a few loops, then press Save (${mac ? '⌘' : 'Ctrl+'}S). Each track keeps its loops, song grid, tempo, key, vibe, styles and FX.`)));
      return;
    }
    grid.replaceChildren(...this.tracks.map((t) => this.#card(t)));
  }

  #card(t) {
    const vibe = VIBES[t.settings?.vibe] ?? VIBES[0];
    const isCurrent = t.id === this.library.current.id;
    const preview = h('div', { class: 'lib-preview' });
    preview.innerHTML = previewSvg(t);
    const act = (label, fn, cls = '') => h('button', { type: 'button', class: `lib-act ${cls}`, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    const card = h('div', {
      class: `lib-track${isCurrent ? ' current' : ''}`, role: 'button', tabindex: '0',
      style: `--v1:${vibe.palette[0]};--v2:${vibe.palette[1]}`,
      title: isCurrent ? 'This is the track you have open' : `Open “${t.name}”`,
      onclick: () => this.#openTrack(t),
      onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && e.target === card && (e.preventDefault(), this.#openTrack(t)),
    },
    preview,
    h('div', { class: 'lib-name' }, h('span', {}, t.name), isCurrent ? h('em', {}, this.library.dirty ? 'open · unsaved' : 'open') : null),
    h('div', { class: 'lib-meta' }, describeTrack(t)),
    h('div', { class: 'lib-foot' },
      h('span', { class: 'lib-when' }, `${vibe.name} · ${ago(t.updated ?? t.created ?? 0)}`),
      h('span', { class: 'lib-acts' },
        act('Rename', () => this.#rename(t)),
        act('Duplicate', () => this.#duplicate(t)),
        act('Delete', () => this.#remove(t), 'danger'))));
    return card;
  }

  async #openTrack(t) {
    if (t.id === this.library.current.id && !this.library.dirty) {
      this.close();
      return;
    }
    if (t.id !== this.library.current.id && !(await this.#keepWork(`open “${t.name}”`))) return;
    if (t.id === this.library.current.id) {
      const back = await this.ask({ title: `Go back to the saved “${t.name}”?`, text: 'Your changes since the last save will be lost.', buttons: [['cancel', 'Cancel', 'ghost'], ['ok', 'Revert', 'danger']] });
      if (back !== 'ok') return;
    }
    try {
      await this.library.open(t.id);
      this.close();
      this.toast(`Opened “${t.name}” — press Play or a loop to hear it`, 2600);
    } catch (err) {
      this.toast(`Couldn’t open it (${err.message})`, 5000);
    }
  }

  async #rename(t) {
    const name = await this.ask({ title: 'Rename track', input: t.name, ok: 'Rename' });
    if (!name || name === t.name) return;
    try {
      await this.library.rename(t.id, name);
      await this.refresh();
    } catch (err) {
      this.toast(`Couldn’t rename it (${err.message})`, 5000);
    }
  }

  async #duplicate(t) {
    try {
      const copy = await this.library.duplicate(t.id);
      await this.refresh();
      this.toast(`Made “${copy.name}”`, 1800);
    } catch (err) {
      this.toast(`Couldn’t duplicate it (${err.message})`, 5000);
    }
  }

  async #remove(t) {
    const ok = await this.ask({
      title: `Delete “${t.name}”?`,
      text: 'It moves to the .trash folder inside your Tracks folder, so it can still be recovered from there.',
      buttons: [['cancel', 'Cancel', 'ghost'], ['ok', 'Delete', 'danger']],
    });
    if (ok !== 'ok') return;
    try {
      await this.library.remove(t.id);
      await this.refresh();
      this.toast(`Deleted “${t.name}”`, 1800);
    } catch (err) {
      this.toast(`Couldn’t delete it (${err.message})`, 5000);
    }
  }

  /**
   * A small dialog. With `input` it asks for a name and resolves to the text (or
   * null); with `buttons` ([value, label, style], the last one is the main one)
   * it resolves to the chosen value. Escape or a click outside cancels.
   */
  ask({ title, text = '', input, ok = 'OK', buttons }) {
    const modal = $('#ask');
    const field = $('#ask-input');
    $('#ask-title').textContent = title;
    $('#ask-text').textContent = text;
    $('#ask-text').hidden = !text;
    field.hidden = input === undefined;
    field.value = input ?? '';
    const list = buttons ?? [['cancel', 'Cancel', 'ghost'], ['ok', ok, 'primary']];
    return new Promise((resolve) => {
      const done = (value) => {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        modal.onkeydown = null;
        modal.onclick = null;
        resolve(value);
      };
      const answer = (v) => {
        if (input === undefined) return done(v);
        const name = field.value.trim().slice(0, 60);
        return done(v === 'ok' && name ? name : null);
      };
      const btns = list.map(([v, label, style]) => h('button', { type: 'button', class: `btn ${style}`, onclick: () => answer(v) }, label));
      $('#ask-btns').replaceChildren(...btns);
      modal.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          answer('cancel');
        } else if (e.key === 'Enter' && e.target === field) {
          e.preventDefault();
          answer(list.at(-1)[0]); // Enter = the main (last) button
        }
      };
      modal.onclick = (e) => e.target === modal && answer('cancel');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      if (input !== undefined) {
        field.focus();
        field.select();
      } else btns.at(-1).focus();
    });
  }
}
