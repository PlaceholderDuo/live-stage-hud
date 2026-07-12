# iPhone 7 Controller — Design Spec

## Physical Context

```
┌────────────────────── Alesis V25 ─────────────────────┐
│                                                        │
│   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                 │
│   │ KNOB │ │ KNOB │ │ KNOB │ │ KNOB │                 │
│   │  1   │ │  2   │ │  3   │ │  4   │                 │
│   └──────┘ └──────┘ └──────┘ └──────┘                 │
│   ┌─────────────────────────────────────────────┐      │
│   │  ┌──────────────────────────────────────┐   │      │
│   │  │       iPhone 7 (horizontal)          │   │      │
│   │  │        ┌──────────────────┐          │   │      │
│   │  │ ┌──────┤   KNOB LABELS   ├──────┐   │   │      │
│   │  │ │ VOX  │   GTR   BASS   │REV   │   │   │      │
│   │  │ └──────┴─────────────────┴──────┘   │   │      │
│   │  │       ▲ bottom strip                │   │      │
│   │  └──────────────────────────────────────┘   │      │
│   └─────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────┘
```

- iPhone 7 mounted **horizontally** directly behind the V25's 4 knobs
- iPhone 7 width (horizontal): 138.3mm — V25 knob section width: roughly matching (0.75" wider)
- **Screen bottom** (in horizontal orientation) displays live knob labels
- Knobs are **reusable** across menus — label + color coding changes per page

---

## Home Page

### Knob Labels (bottom strip)

| Position | Label | Control | Color |
|----------|-------|---------|-------|
| Knob 1 | VOX | Vocal track volume | White/cyan |
| Knob 2 | GTR | Guitar track volume | Orange |
| Knob 3 | BASS | Bass track volume | Blue |
| Knob 4 | REV MST | Master Reverb Send level | Purple |

The knob label strip is always visible at the bottom of the screen when on pages that support knob control. On pages that don't, the strip dims or shows placeholder labels.

### Large Buttons / Displays

These occupy the main area above the knob strip:

#### 1. Tap Tempo
- **Display:** Current BPM number (large, bold, monospace) + animated pulse ring/beat indicator
- **Action:** Tap anywhere on this widget to tap tempo (or taps recorded from the physical V25 tap button)
- **Visual:** Tempo pulse synchronizes with beat — subtle flash/scale animation at quarter-note rate
- **States:** Steady when locked, pulsing search when tapping, dim when no tempo detected

#### 2. EDM
- **Button type:** Large mode button
- **Action:** Opens EDM mode page — different knob mapping, scene controls
- **Visual:** Distinct color (neon green), icon indicating energy/synth

#### 3. Setlist
- **Button type:** Large mode button
- **Action:** Opens setlist/queue/songs page (song list, current song, navigation)
- **Visual:** List icon, distinct color

#### 4. MIXER
- **Button type:** Large mode button (dimmed/disabled — NOT needed tonight)
- **Action:** Opens full channel mixer page (future)
- **Visual:** Grayed out, with "COMING SOON" or hidden until implemented

#### 5. Battery Monitor
- **Button type:** Display card (NOT set up tonight)
- **Action:** Future — shows Ecoflow inverter battery level, wattage draw, ETA remaining (smoothed over 10 min), warnings for other monitored batteries
- **Visual:** Battery icon, placeholder gray content
- **Note:** Requires integration with Ecoflow API/Modbus — out of scope for initial build

#### 6. MUTE — Panic Mute Button
- **Behavior:** 
  - **Press 1:** Mute vocal track only (VOCAL track in REAPER)
  - **Press 2:** Also mute master PA output (MASTER)
  - **Press 3:** Restore to previous state before any muting
- **Display:** Shows current mute state clearly — "VOCAL" / "VOCAL+MASTER" / "LIVE"
- **Visual:** Red background when any mute active, green when live. Text changes to reflect state.
- **Safety:** Must be impossible to accidentally trigger. Consider hold-to-activate or confirm? Or keep as single tap but large, unmistakable button.

#### 7. TUNER — Guitar Tuner
- **Button type:** Large mode button
- **Action:** Opens full-screen chromatic tuner
- **Integration:** Uses the Gtr NAM OUT channel's "lock-on" FX in REAPER for pitch detection — receive tuner data via OSC/MIDI/WebSocket from REAPER
- **Teleprompter checkbox:** Checkbox labeled "display on teleprompter" — when checked, also renders tuner fullscreen on the teleprompter device (Stage HUD). Setting persists between shows (save to localStorage or server-side config).
- **Visual:** Large note name, cents deviation indicator, string indicator (E A D G B E)

#### 8. GTR FX — Guitar Effects Menu
- **Button type:** Large mode button
- **Action:** Opens sub-page that remaps the 4 knobs to guitar effects controls:
  - Knob 1 → Delay Time / Tempo Sync
  - Knob 2 → Delay Feedback / Repeats
  - Knob 3 → Modulation Rate
  - Knob 4 → Modulation Depth
- **Use case:** Breakdowns, ambient sections between songs, manipulating delays + modulation live
- **Visual:** Knob labels update to show current FX parameter names + values

#### 9. KEYS — Keyboard VST Mute
- **Short press:** Toggle mute/unmute the keyboard VST tracks (saves CPU when not playing keys)
- **Long press:** Opens VST settings page for preset switching (bonus — NOT needed tonight)
- **Display:** Shows current state — "KEYS ON" / "KEYS OFF" with color indicator

#### 10. START — Start Next Song
- **Action:** Starts the next song in the queue
- **Display:** Shows "▶ START" label
- **Future:** May be replaced with a physical footswitch/button later

#### 11. GTR AMP — NAM Preset Selector
- **Button type:** Large mode button
- **Action:** Opens NAM preset selection page
- **Visual:** Distinct color (orange), shows current preset name as subtitle

---

### Small Buttons (Home Page)

#### Bumper Music
- **Label:** Small button labeled "BUMPER" or "♪ Bumper"
- **Action:** Plays MP3 bumper music from a library on the iPhone device
- **Trigger:** **Double-tap required** to start/stop — prevents accidental playback during show
- **Double-tap indication:** How to visually indicate double-tap required?
  - Options: Double-tap icon (two overlapping circles/fingers), pulsing text "DOUBLE-TAP", brief flash on first tap prompting second, or hold border that fills on first tap
  - **Decision TBD**
- **Source:** Library of short MP3 files stored on-device or served from the Node.js server (`~/bumper-music/`)

---

## Other Pages

### Settings (gear icon)
- General settings page
- **Subpage: Troubleshooting**
  - Diagnostic info for the ENTIRE rig:
    - REAPER connection status (WebSocket/OSC)
    - Last bridge_state.json update timestamp
    - Lua runner heartbeat
    - Audio interface status
    - MIDI device status (V25, Launchpad Mini)
    - Network info (IP, signal strength)
    - Server uptime
    - Battery/sensor data (when Ecoflow integration is live)
  - **Goal:** High-stakes live troubleshooting — everything needed to diagnose a problem mid-show in one place

### LIGHTS
- Placeholder page for future light show control
- Not implemented initially

### QUEUE
- Shows the current song queue
- "Admin" controls:
  - Rearrange songs (drag reorder)
  - Remove songs from queue
  - Skip current song
  - Force-next song
- **Future:** Can also be the band's shared queue view with admin permissions
- **Relationship to Show Server TUI:** This is a secondary way for the performer to edit/run the show + queue list — mirrors the existing TUI functionality

### EDM Mode Page
- Triggered from "EDM" button on home
- Shows scene select buttons (Intro, Build, Drop, Breakdown, Guitar Jam, Transition, Final Drop, Outro)
- Knob remap for EDM controls
- Current scene highlighted
- Quick-return to home button

### GTR AMP Preset Page
- Triggered from "GTR AMP" button on home
- Shows NAM preset selection grid
- **Presets:** OSD, SSS, SSS CLN, BE, BE CLN, TRLX, TWD
- **Color coding:** CLN presets = blue (`#3399ff`), non-CLN = orange (`#ff8800`)
- Only one preset selected at a time — highlighted with border
- Current active preset shown with filled/green state
- Sends `gtr_amp_preset` command on selection

---


## Design Requirements

| Requirement | Detail |
|-------------|--------|
| **Robustness** | Must never crash during a show. Graceful degradation on disconnect. |
| **Modularity** | Each "page" is an independent module. Pages can be added/removed without touching others. |
| **Hot-reloadable** | Changes to JS/CSS should not require full app restart. |
| **No external runtime deps** | Vanilla HTML/CSS/JS. No React, no build step. Keep it simple and fast. |
| **Offline-capable** | Core UI works without server (show last known state, cache pages). |
| **Persistent settings** | User preferences (e.g., teleprompter checkbox) survive page reloads and between shows. |

## Communication

The iPhone controller communicates with the Node.js server via WebSocket:

```
iPhone (index.html) ←── WebSocket ──→ Node.js Server ←── bridge_state.json ←── Lua Runner ←── REAPER
```

Control messages (iPhone → Server → REAPER via OSC/MIDI):
```
{ type: "command", action: "scene_select", scene: 3 }
{ type: "command", action: "track_mute", track: "VOCAL", state: true }
{ type: "command", action: "tap_tempo" }
{ type: "command", action: "fx_param", track: "GUITAR", param: "delay_time", value: 0.5 }
{ type: "command", action: "panic_mute" }
{ type: "command", action: "keys_toggle" }
{ type: "command", action: "start_song" }
{ type: "command", action: "gtr_amp_preset", preset: "SSS" }
```

State messages (Server → iPhone):
- Same `bridge_state.json` payload as Stage HUD
- Additional state: mute status per track, active scene, tuner data, tempo
