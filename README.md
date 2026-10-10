# ✦ Lumen

A playful performance screen for the **M-Audio Oxygen Pro Mini** or the **Akai APC Key 25** (mk1 and mk2), with **Ableton Live 12 Lite**.

- **Vibes:** one tap changes the instrument (or a layered pair), all eight effects, the colours and the visuals.
- **Eight FX macros** on the Oxygen's 4 knobs and 4 faders, or the APC's 8 knobs: Filter, Reso, Drive and Crush; Echo, Repeats, Reverb and Space. Switching vibes glides the effects smoothly instead of jumping.
- **Effects that follow the tempo.** The echo is a dotted 1/8. **Space** picks how long the reverb lasts as a note length (1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars), so the tail dies away on the beat. The reverb's pre-delay is a 1/64 note. All of it re-times when you change the BPM, including on Live's Reverb when AbletonOSC is installed.
- **Play helpers** so wrong notes are hard to hit:
  - *Snap to scale*.
  - *Easy mode*: the white keys play the scale, and middle C is the key's root.
  - One-finger *chords* (triads, 7ths, power chords, octaves).
  - Octave shift.
- **4-track looper:** one bar of count-in, records on the bar, snaps to 16ths if you want, overdubs, and keeps every loop in sync. You can drive it from the pads.
- **Visuals:**
  - *Nebula*: particles.
  - *Rings*: a radial spectrum.
  - *Horizon*: a synthwave grid that rolls on the beat.
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
| **4** | **Keys, Pad, Bass, Lead** (*Shift + pad* layers it) · visuals **Nebula, Rings, Horizon** · **Stage** mode |
| **3** | **Loops 1–4**: tap to record, play or stop; *hold* (or *Shift + tap*) to clear. Then **Stop loops** · **Snap** · **Loop length** (green 1, yellow 2, orange 4, red 8 bars) · **Metronome** |
| **2** | Notes: **Free, Snap, Easy** · Chords: **Off, Triad, 7th, Power, Octave** |
| **1** (bottom) | **Drums**: Kick, Snare, Clap, Hat, Open Hat, Tom, Rim, Crash |

Loop pads change colour with their state:
- dim white: empty
- blinking red: waiting for the bar
- red: recording
- pulsing red: overdubbing
- green: playing
- amber: stopped

| Other controls | Do |
|---|---|
| **8 knobs** | FX 1–8 (Filter … Space). On the mk2 the knobs are endless; hold **Shift** for fine steps. |
| **Scene buttons** (right, top→bottom) | Random vibe · Layer on/off · Record next loop · Next scale (*Shift*: next key) · Tap tempo (flashes on the beat) |
| **Buttons under the grid** | Mute Keys / Pad / Bass / Lead / Drums (lit = muted) · Octave − · Octave + · All notes off |
| **Play/Pause** · **Record** · **Stop All Clips** | Play/stop · record next loop · stop all loops (*Shift*: clear all loops) |
| **Sustain** | Sustain pedal |

The mk2 shows Lumen's exact colours using its 128-colour palette. The mk1 does green, red and amber.

In **Live's MIDI settings**, turn *Track* and *Remote* **off** for the APC's ports, and set its Control Surface slot to **None**. Otherwise Live and Lumen fight over the grid lights and you hear notes twice. Live **switches the APC Key 25 surface back on by itself** when you plug the APC in, so check again after reconnecting.

Good to know:
- The mk2 has two ports, *Keys* and *Control*. Lumen uses both. The mk1 has one port, with the keys on MIDI channel 2.
- The APC's own Octave buttons transpose the keyboard inside the APC. Lumen's Octave buttons (under the grid) stack on top of that.
- The mk1 knobs are ordinary knobs, so after a vibe changes the FX, a knob jumps to its own position the moment you touch it. The mk2's endless knobs don't jump.
- Lumen sends a MIDI clock to the APC at its own tempo. Pulsing and blinking pads need one, and with Lumen's clock they blink in time with your music.

### M-Audio Oxygen Pro Mini (2 minutes, once)

Click **Controller setup** in the top bar, then touch each control when asked: 4 knobs, 4 faders, the pads in both banks, Play, Stop and Record. Press **Skip** for anything you don't want mapped.

M-Audio doesn't publish the factory MIDI numbers for Preset mode, so the wizard is the reliable route. Lumen also ships defaults for:

- **DAW mode with the Ableton map:** knobs CC 22–25, faders CC 12–15, pads notes 40–43 and 48–51, transport CC 114–119. These numbers come from Live's own Oxygen Pro script.
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
| Record a loop | Press **●** on a loop, tap a loop pad, or press **Record** on the controller. You get one bar of count-in, then it records for the loop length and starts playing. |
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

## Project layout

```
server/index.js      static server + WebSocket↔OSC bridge to AbletonOSC
server/osc.js        tiny OSC encoder/decoder (no dependencies)
public/index.html    the page
public/js/
  main.js            wires everything together
  config.js          instruments, vibes, FX, scales
  devices.js         controller profiles: Oxygen Pro Mini, APC Key 25 (+ default mappings)
  lights.js          APC Key 25 grid lights (also colours the on-screen grid)
  ticker.js          a timer that keeps running when the tab is in the background
  controller.js      MIDI/keyboard input → notes & actions, MIDI learn, setup wizard
  transform.js       octave / scale snap / easy mode / chords
  engine.js          routes notes to the built-in synth or to Live over MIDI
  synth.js           Web Audio instruments, drums and FX chain
  clock.js           look-ahead transport + metronome
  looper.js          4-track MIDI looper
  ableton.js         AbletonOSC client (meters, tempo, mute)
  feed.js            audio/notes → level + spectrum for the visuals
  visuals.js         Nebula / Rings / Horizon
  tracks.js          per-instrument level history
  ui.js              panels, knobs, faders, pads, keyboard, settings, wizard
```
