# ✦ Lumen

A playful performance screen for the **M-Audio Oxygen Pro Mini** or the **Akai APC Key 25** (mk1 and mk2), with **Ableton Live 12 Lite**.

- **Vibes:** one tap changes the instrument (or a layered pair), all eight effects, the colours and the visuals.
- **Eight FX macros:** on the Oxygen, the 4 faders control Filter, Reso, Drive and Crush and the 4 knobs control Echo, Repeats, Reverb and Space. On the APC, the 8 knobs control all eight. Switching vibes glides the effects smoothly instead of jumping.
- **Effects that follow the tempo.** The echo is a dotted 1/8. **Space** picks how long the reverb lasts as a note length (1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars), so the tail dies away on the beat. The reverb's pre-delay is a 1/64 note. All of it re-times when you change the BPM, including on Live's Reverb when AbletonOSC is installed.
- **Play helpers** so wrong notes are hard to hit:
  - *Snap to scale*.
  - *Easy mode*: the white keys play the scale, and middle C is the key's root.
  - One-finger *chords* (triads, 7ths, power chords, octaves).
  - Octave shift.
- **5 sound styles per instrument:**
  - *Keys*: E-Piano, Felt Piano, Organ, Glass Bells, Clav.
  - *Pad*: Warm, Strings, Choir, Shimmer, Dark Drone.
  - *Bass*: Sub, Acid, Reese, Pluck, Wobble.
  - *Lead*: Saw, Square, Supersaw, Soft Flute, Chiptune.
  - Pick one from the menu on each instrument card. Some vibes pick styles for you.
- **8-track looper:** each loop has its own length (1, 2, 4 or 8 bars), and they all stay in sync. One bar of count-in, records on the bar, snaps to 16ths if you want, overdubs. You can drive it from the pads.
- **Song grid:** turn your loops into an arrangement.
  - Every loop row has 8 cells to its right, one per song section.
  - The button above each column sets how many bars that section lasts.
  - Tick which loops play in each section, then press **▶ Song**. Sections change on the bar, and the song can repeat.
- **Metronome sounds:** Soft knock (the default), Woodblock, Shaker, Cowbell or Beep, chosen next to the **Click** button.
- **Visuals:**
  - *Nebula*: particles.
  - *Rings*: a radial spectrum.
  - *Horizon*: a synthwave grid that rolls on the beat.
  - *Oil*: a slow painted night sky that swirls around the moon, reflected in rippling water.
  - *Stardust*: a glittering cosmic iris in drifting nebula clouds. It slowly turns between "eye" and "galaxy", and notes send ripples through it.
  - The **Chords** button on the stage turns the big chord names on or off.
  - Pitch sets where a note appears and its colour. Velocity sets its size. Drums kick and sparkle.
- **Track view:** a live, scrolling level trace and note marks for every instrument.
- **The APC Key 25's grid lights up as Lumen's control surface:** vibes, instruments, loops, play helpers and drums, each in its own colour, with the same layout mirrored on screen.
- Works **with or without Ableton**. A built-in synth lets you play right away. Flip one switch to drive Live instead.

```
Oxygen Pro Mini ──USB MIDI──▶  Lumen (Chrome)  ──IAC Driver (MIDI)──▶  Ableton Live tracks
                               │  scale/chords, looper, FX CCs, visuals
                               └──WebSocket──▶ node server ──OSC──▶ AbletonOSC (optional: meters, tempo)
```

Lumen sits *between* the keyboard and Live, so it can reshape what you play: scale lock, chords, layers and loops.

---

## 1. Run it

You need Node 18 or newer. Install the dependencies:

```bash
npm install
```

Then start the server:

```bash
npm start
```

Open **http://localhost:5173** in **Chrome or Edge**. Safari has no Web MIDI. Allow MIDI access when the browser asks, then click **Start playing**.

No controller? Play the computer keyboard. `A W S E D F T G Y H U J K O L P ;` are piano keys and `1`–`8` are the drum pads. The full list of shortcuts is in Settings.

> If `npm install` complains that files under `~/.npm` belong to root, run `sudo chown -R $(id -u):$(id -g) ~/.npm` once. You can also use `npm install --cache /tmp/npm-cache`.

## 2. Set up the controller

Lumen recognises both controllers by their USB name. Both can be plugged in at once.

### Akai APC Key 25 (mk1 or mk2): no setup needed

Plug it in. Lumen maps every control and lights up the grid. The **Pads** panel switches to a copy of the grid, which you can also click with the mouse. The numbers come from Live 12's own APC Key 25 scripts.

| Grid row | The 8 pads |
|---|---|
| **5** (top) | The 8 **vibes**, in each vibe's colour. The active one is bright. |
| **4** | **Keys, Pad, Bass, Lead** (*Shift + pad* layers it) · **Style ◀ / ▶** (changes the current instrument's style) · **Visuals ▶** (*Shift*: ◀) · **Stage** mode |
| **3** | **Loops 1–8**: tap to record, play or stop; *hold* to clear; *Shift + tap* to change the length of an empty loop |
| **2** | Notes: **Free, Snap, Easy** · Chords: **Off, Triad, 7th, Power, Octave** |
| **1** (bottom) | **Drums**: Kick, Snare, Clap, Hat, Open Hat, Tom, Rim, Crash |

Loop pads change colour with their state:
- dim, showing the length when empty: green = 1 bar, yellow = 2, orange = 4, purple = 8
- blinking red: waiting for the bar
- red: recording
- pulsing red: overdubbing
- green: playing
- amber: stopped

| Other controls | Do |
|---|---|
| **8 knobs** | FX 1–8 (Filter … Space). On the mk2 the knobs are endless; hold **Shift** for fine steps. |
| **Scene buttons** (right, top→bottom) | Random vibe · Layer on/off · Record next loop (*Shift*: Snap on/off) · Next scale (*Shift*: next key) · Tap tempo, flashing on the beat (*Shift*: metronome on/off) |
| **Buttons under the grid** | Mute Keys / Pad / Bass / Lead / Drums (lit = muted) · Octave − · Octave + · **Grid: controls ⇄ drums** (*Shift*: all notes off) |
| **Play/Pause** · **Record** · **Stop All Clips** | Play/stop · record next loop · stop all loops (*Shift*: clear all loops) |
| **Sustain** | Sustain pedal |

**Drums mode.** Press the last button under the grid (it lights up) and all 40 pads become drum pads:

| | Kick | Snare | Clap | Hat | Open Hat | Tom | Rim | Crash |
|---|---|---|---|---|---|---|---|---|
| **Row 5** (top) | loud | loud | loud | loud | loud | loud | loud | loud |
| **Rows 4–2** | ⋮ | ⋮ | ⋮ | ⋮ | ⋮ | ⋮ | ⋮ | ⋮ |
| **Row 1** (bottom) | soft | soft | soft | soft | soft | soft | soft | soft |

- Each column is one drum, in its own colour.
- Each row is a loudness level, from soft at the bottom to loud at the top. The APC's pads always hit at full force, so the rows give it dynamics.
- On the mk2, the pads get brighter toward the top, and the pad you hit flashes white.
- In Ableton it plays the same notes as any 16-pad Drum Rack kit, just at different velocities, so no new kit is needed.
- The scene buttons, Record, Play and Stop All keep working, so you can record drum loops.
- Press the button again to get the controls back. Shift + that button is all notes off.

The mk2 shows Lumen's exact colours using its 128-colour palette. The mk1 does green, red and amber.

In **Live's MIDI settings**, turn *Track* and *Remote* **off** for the APC's ports, and set its Control Surface slot to **None**. Otherwise Live and Lumen fight over the grid lights and you hear notes twice. Live **switches the APC Key 25 surface back on by itself** when you plug the APC in, so check again after reconnecting.

Good to know:
- The mk2 has two ports, *Keys* and *Control*. Lumen uses both. The mk1 has one port, with the keys on MIDI channel 2.
- The APC's own Octave buttons transpose the keyboard inside the APC. Lumen's Octave buttons (under the grid) stack on top of that.
- The mk1 knobs are ordinary knobs, so after a vibe changes the FX, a knob jumps to its own position the moment you touch it. The mk2's endless knobs don't jump.
- Lumen sends a MIDI clock to the APC at its own tempo. Pulsing and blinking pads need one, and with Lumen's clock they blink in time with your music.

### M-Audio Oxygen Pro Mini (2 minutes, once)

Click **Controller setup** in the top bar, then touch each control when asked: the 4 faders, the 4 knobs, the pads in both banks, Play, Stop and Record. At the end it asks for two buttons to use as Lumen's **Octave − / +**. Press **Skip** for anything you don't want mapped.

On screen, the faders sit on the left (Filter, Reso, Drive, Crush) and the knobs on the right (Echo, Repeats, Reverb, Space), like on the keyboard.

> **About the Oxygen's own Octave buttons:** they transpose inside the keyboard and send nothing over MIDI, so Lumen can't follow them, and Lumen can't move them either. For one shared octave, give Lumen's Octave − / + to two Oxygen buttons, either in the wizard or with Settings → Controller mapping → *Learn*, and leave the keyboard's own octave at 0.

M-Audio doesn't publish the factory MIDI numbers for Preset mode, so the wizard is the reliable route. Lumen also ships defaults for:

- **DAW mode with the Ableton map:** faders CC 12–15, knobs CC 22–25, pads notes 40–43 and 48–51, transport CC 114–119. These numbers come from Live's own Oxygen Pro script.
- **Preset mode:** pads are notes on channel 10 starting at note 36, and factory preset 12's knobs are CC 120–127.

Lumen listens to **all** of the Oxygen's ports at once, so either mode works. **Settings → MIDI monitor** shows exactly what the controller sends. Any single control can be re-learned in **Settings → Controller mapping**.

> Turn off the Oxygen's own *Smart Chord / Smart Scale / Arp* while you use Lumen's helpers, otherwise both will reshape your notes.

**Pad layout**

| Bank A: drums | Bank B: controls |
|---|---|
| Kick, Snare, Clap, Hat (bottom row) | Loop 1–4 (tap = record/play/stop, hold = clear) |
| Open Hat, Tom, Rim, Crash (top row) | ◀ Vibe, Vibe ▶, Next instrument, Stop loops |

The transport buttons default to: Play = play/stop, Stop = stop, Record = record the next loop, << / >> = previous/next vibe, Loop = stop all loops.

## 3. Play through Ableton Live (one-time setup)

Built-in sound is the default. To use Live's instruments instead:

### a) Turn on the IAC Driver (macOS's virtual MIDI cable)
1. Open **Audio MIDI Setup**, then **Window → Show MIDI Studio**.
2. Double-click **IAC Driver** and tick **Device is online**.
3. Leave "Bus 1" as it is.

### b) Live's MIDI preferences
Open **Settings → Link, Tempo & MIDI**:

| Port | Track | Remote |
|---|---|---|
| **IAC Driver (Bus 1)**, input | ✅ on | ✅ on (needed for FX mapping) |
| **Oxygen Pro Mini** / **APC Key 25** (all their inputs) | ❌ off | ❌ off |

Also set the Control Surface slot for *Oxygen Pro Mini* or *APC Key 25* to **None**. Otherwise Live grabs the controller and you hear every note twice.

### c) Tracks
Live 12 Lite allows 8 tracks, which is plenty. Create these MIDI tracks. Lumen finds them **by name**, so the names matter for meters and mute.

| Track name | MIDI From | Channel | Monitor | Suggested instrument (included in Lite) |
|---|---|---|---|---|
| **Keys** | IAC Driver (Bus 1) | Ch. 1 | **In** | a Simpler piano or e-piano preset |
| **Pad** | IAC Driver (Bus 1) | Ch. 2 | **In** | a Drift pad preset |
| **Bass** | IAC Driver (Bus 1) | Ch. 3 | **In** | a Drift bass preset |
| **Lead** | IAC Driver (Bus 1) | Ch. 4 | **In** | a Drift lead preset |
| **Drums** | IAC Driver (Bus 1) | Ch. 10 | **In** | any Drum Rack kit |

Setting Monitor to **In** means each track plays whenever its channel receives notes, with no arming needed. Changing instrument in Lumen just changes the channel it sends on. That's also how layering works: Lumen sends on two channels at once.

### d) FX on a group track
1. Select the five instrument tracks and press **⌘G** to group them. Rename the group **FX**. Group tracks are included in Lite.
2. Put these on the **FX** group track: **Auto Filter → Saturator → Redux → Delay → Reverb**. All of them are in Lite.

Why a group and not Master? Lumen can only reach devices on normal or group tracks through AbletonOSC, and that's what lets it time the Reverb to the tempo (step e).

On Live's **Delay**, turn on **Sync** and set both sides to **3** (sixteenths), which is a dotted 1/8. That matches Lumen's built-in echo, and Live keeps it in time by itself.

Then map Lumen's FX to them, once:

1. In Lumen, switch to **Ableton Live** in the top bar and open **Settings → Ableton Live**.
2. In Live, press **⌘M** to enter MIDI Map mode.
3. Click a parameter in Live (for example, Auto Filter Frequency), then press **Send** next to *Filter* in Lumen.
4. Repeat for the other seven, then press **⌘M** again to leave map mode.

| Lumen FX | CC (channel 16) | Map it to |
|---|---|---|
| Filter | 20 | Auto Filter → Frequency |
| Reso | 21 | Auto Filter → Resonance |
| Drive | 22 | Saturator → Drive |
| Crush | 23 | Redux → Downsample |
| Echo | 24 | Delay → Dry/Wet |
| Repeats | 25 | Delay → Feedback |
| Reverb | 26 | Reverb → Dry/Wet |
| Space | 27 | Reverb → Decay Time. Skip this one if you install AbletonOSC: Lumen then sets the decay itself, in time with the tempo. |

**Optional: instrument styles in Live.** Lumen's style menu can switch Live's sounds too:
1. On an instrument's track, put an **Instrument Rack** with **5 chains**, one sound per style, in the same order as Lumen's menu.
2. Right-click the chains and choose **Distribute Ranges Equally**.
3. Press ⌘M and click the **Chain Selector**.
4. In Lumen, open Settings → Ableton Live and press **Send** next to that instrument. Lumen sends CC 3 on the instrument's channel.

Save the set (for example, as `Lumen.als`). The mappings are stored in it.

### e) Optional: AbletonOSC for track meters and tempo sync
[AbletonOSC](https://github.com/ideoforms/AbletonOSC) is a free remote script. With it:

- The Tracks panel shows Live's real levels.
- Lumen and Live share one tempo.
- The track **M** buttons mute the Live tracks.
- **Live's Reverb follows the tempo.** Lumen finds the Reverb on your FX group track and sets its *Decay Time* to the Space note length and its *Predelay* to a 1/64 note. It re-times both whenever the BPM changes. Settings → Ableton Live shows what Live reports back, for example "1 bar (2.40 s)".

1. Download AbletonOSC into Live's Remote Scripts folder:

   ```bash
   git clone https://github.com/ideoforms/AbletonOSC.git ~/Music/Ableton/User\ Library/Remote\ Scripts/AbletonOSC
   ```

2. Restart Live.
3. In **Settings → Link, Tempo & MIDI**, choose **AbletonOSC** as a Control Surface. Input and Output can stay at None.
4. Live's status bar should say *"AbletonOSC: Listening for OSC on port 11000"*, and the **Live** chip in Lumen turns green.

The Lumen server relays between the browser and AbletonOSC on UDP ports 11000 and 11001. To change them, set `LIVE_PORT` or `REPLY_PORT`.

> Lite supports custom control surfaces, but I couldn't find anyone confirming AbletonOSC on Lite specifically. If the "Listening" message appears, it works. If it doesn't, everything else in Lumen still works without it.

## 4. Playing

| Want to… | Do this |
|---|---|
| Change the whole sound | Tap a **vibe** (or use << / >>, ← →, or the bank-B pads) |
| Stack two instruments | Press **+** on an instrument |
| Never hit a wrong note | **Notes → Snap**, or **Easy** (white keys only) |
| Play chords with one finger | **Chords → Triad / 7th** |
| Record a loop | Press **●** on a loop, tap a loop pad, or press **Record** on the controller. You get one bar of count-in, then it records for that loop's length and starts playing. |
| Set a loop's length | Use the **bars** menu on the loop (while it's empty), or *Shift + loop pad* on the APC |
| Play an arrangement | In the song grid to the right of the loops, tick which loops play in each section (column). Set each section's length with the number above it (click for more bars, right-click for fewer). Then press **▶ Song**, or *Shift + Space*, or *Shift + Play* on the APC. An empty column is a break. **Repeat** loops the song. The grid is saved; recorded loops are not saved yet, so they reset on reload. |
| Change an instrument's sound | Pick a style on its card, or **Style ◀ / ▶** on the APC |
| Add to a loop | **●** on a loop that's playing (overdubs one pass) |
| Stop / clear a loop | Tap it to stop it. Hold its pad, or press **✕**, to clear it. |
| Go full-screen visuals | **Stage** button or **`** (Esc exits) |

Loops store **notes**, not audio. They replay through whichever engine is active, on the instrument they were recorded with. You can record a bass line, switch to Lead and solo over it.

## 5. Make it yours

Everything tweakable is in [`public/js/config.js`](public/js/config.js):

- `VIBES`: name, instrument, layer, the 8 FX values, palette and visual mode.
- `INSTRUMENTS`: names, MIDI channels and colours. The names must match your Live track names.
- `DRUM_VOICES`, `CONTROL_PADS`, `SCALES`, `FX_MACROS`.
- Controller layouts are in [`public/js/devices.js`](public/js/devices.js): for example `APC_GRID`, which decides what each APC pad does.

Changing code? Run `npm test` to check the scale/chord logic and the OSC codec.

## 6. Troubleshooting

- **No sound (built-in):** click the page once, because browsers need a gesture before they play audio. Check that the system output is the right device.
- **Notes play twice in Live:** the Oxygen still has *Track* turned on in Live's MIDI settings (step 3b).
- **Nothing reaches Live:** Lumen must be in **Ableton Live** mode, the **IAC out** chip must be green, the track's MIDI From must be IAC with the right channel, and Monitor must be **In**.
- **A knob does nothing:** open the MIDI monitor, move the knob, and re-learn it in Settings → Controller mapping.
- **"Live (OSC off)":** that's fine unless you want meters and tempo sync (step 3e).
- **Pads or knobs do nothing, but the keys work:** Lumen may be listening to only part of the controller.
  - Open Settings → MIDI. Choose **Auto**, or the controller's **"all ports"** entry.
  - Check that Live hasn't grabbed the controller as a Control Surface (see step 2).
- **Still stuck?** Open **http://localhost:5173/?debug**. Lumen then reports its MIDI ports and every message it receives through its server, which helps pinpoint where input gets lost.

## Project layout

```
server/index.js      static server + WebSocket↔OSC bridge to AbletonOSC
server/osc.js        tiny OSC encoder/decoder (no dependencies)
public/index.html    the page
public/js/
  main.js            wires everything together
  config.js          instruments, vibes, FX, scales
  devices.js         controller profiles: Oxygen Pro Mini, APC Key 25 (+ default mappings)
  styles.js          the 5 sound styles per instrument (plain data the synth builds from)
  scenes.js          the Oil and Stardust visualizers
  lights.js          APC Key 25 grid lights (also colours the on-screen grid)
  ticker.js          a timer that keeps running when the tab is in the background
  controller.js      MIDI/keyboard input → notes & actions, MIDI learn, setup wizard
  transform.js       octave / scale snap / easy mode / chords
  engine.js          routes notes to the built-in synth or to Live over MIDI
  synth.js           Web Audio instruments, drums and FX chain
  clock.js           look-ahead transport + metronome
  looper.js          8-track MIDI looper (each loop has its own length)
  song.js            song mode: plays the looper as an arrangement of sections
  ableton.js         AbletonOSC client (meters, tempo, mute)
  feed.js            audio/notes → level + spectrum for the visuals
  visuals.js         Nebula / Rings / Horizon
  tracks.js          per-instrument level history
  ui.js              panels, knobs, faders, pads, keyboard, settings, wizard
```
