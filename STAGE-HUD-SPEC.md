# Live Stage HUD — Design Spec

## Overview

A glanceable heads-up display for live performance on a secondary monitor. Shows lyrics with colored chords, song progress as a circular countdown ring (Mobius-style), section indicators, and performance cues — all at a quick glance on a black background.

Runs as a web page served by the existing Live Show Manager Node.js server, consuming the same WebSocket state pipeline:

```
REAPER → Lua Runner → bridge_state.json → Server → WebSocket → Stage HUD
                                                                       ↕ HTTP
                                                              chordpro files served statically
```

## Design Principles

1. **Glanceable** — everything parseable in < 500ms. You're dancing, singing, playing. No time to read.
2. **MAXIMUM CONTRAST** — pure white (#fff) on pure black (#000). Stage lights wash out everything else.
3. **Big text or bust** — 48px minimum for anything you need to read. 64px+ for glance content. This is a 22" monitor at 3-6 feet in a loud, bright room.
4. **Color is enhancement, not primary** — chords are colored for quick ID, but the letter shape itself must be readable without color (stage wash kills specific colors).
5. **Motion grabs attention** — peripheral vision cues (edge flashes, ring pulsing) trigger "look now" for section changes and transitions.
6. **Consistent layout** — ring always bottom-left, title always top. Peripheral vision learns where to find things.
7. **No interaction** — read-only. All controls stay on the iPhone. No touch targets. No tapping.
8. **Resilient** — if WebSocket drops, show last known state. Never go blank.
9. **Lightweight** — zero new server dependencies. Vanilla HTML/CSS/JS + chordprojs CDN.

---

## Data Model

### 1. ChordPro Storage

Each song folder in `~/ReaperSongs/<Song>/` gets a new file:

```
~/ReaperSongs/Summer of 69/
├── meta.json          (existing — metadata, bar-aligned lyrics)
├── cue.mid            (existing — MIDI cue)
└── song.chopro        (NEW — full ChordPro lyrics with chords)
```

The `.chopro` file uses standard ChordPro format:

```chordpro
{title: Summer of 69}
{artist: Bryan Adams}
{key: D}

{start_of_verse: Intro}
🎸 [D]Intro [A]riff [G]
{end_of_verse}

{start_of_verse: Verse 1}
I got my [D]first real six-[A]string
Bought it at the [G]five and [D]dime
Played it 'til my [A]fingers [G]bled
Was the [D]summer of [A]'69
{end_of_verse}

{start_of_chorus: Chorus}
Oh, [D]when I look [A]back now
That [G]summer seemed to [D]last forever
And [D]if I had the [A]choice
Yeah, I'd [G]always wanna be [A]there
{end_of_chorus}
```

### 2. Existing `meta.json` lyrics — kept for section timing

The `lyrics` array in `meta.json` already provides bar-positioned section markers. We keep both:
- `meta.json.lyrics` → bar positions for the countdown ring tick marks + section highlighting
- `song.chopro` → the full ChordPro text rendered in the lyrics area

### 3. Bridge State — needs one addition

Current bridge_state.json has: `currentSong` (title), `position`, `duration`, `bpm`, `songIndex`, `totalSongs`, etc.

**Addition needed**: include the song's slug (ID) so the HUD can fetch the right `.chopro` file:

```json
{
  "currentSong": "Summer of 69",
  "songId": "summer_of_69",       // ← NEW: slug for fetching chordpro
  "currentArtist": "Bryan Adams",
  "bpm": 139,
  "position": 45.2,
  "duration": 221.0,
  "songIndex": 3,
  "totalSongs": 12
}
```

This means the Lua runner/bridge needs to add `songId` to the published state. The song model already has `.id` — just needs to be passed through `bridge.lua` and `runner.lua`.

### 4. Section Data for Countdown Ring

The `meta.json.lyrics` array provides section boundaries at bar positions:

```json
"lyrics": [
  { "bar": 1,  "text": "🎸 Intro" },
  { "bar": 9,  "text": "I got my first real six-string..." },
  ...
]
```

These bar positions are converted to time positions using BPM:

```
time = (bar - 1) × 4 × 60 / bpm
```

Two options for making this available to the HUD:

**Option A**: Include section data in `bridge_state.json` (server adds it)
- Server reads `meta.json` on song change, converts bar→time, includes in WebSocket state
- Simplest for the display — all data in one WebSocket message

**Option B**: Serve via HTTP endpoint `/api/song-sections/:songId`
- Display fetches sections separately
- More RESTful, slightly more round-trips

**Recommendation**: Option A — sections are small data, and we already have the polling loop.

---

## Visual Layout

```
┌═══════════════════════════════════════════════════════┐
┃                                                       ┃  ← Edge cue zone (flash on transitions)
┃  ┌───────────────────────────────────────────────┐   ┃
┃  │  SUMMER OF '69             D ♩=139  ┌─────┐  │   ┃  ← 10% header
┃  │  Bryan Adams                         │3/12│  │   ┃     64px title, bold
┃  └───────────────────────────────────────────────┘   ┃
┃                                                        ┃
┃  ┌───────────────────────────────────────────────┐    ┃
┃  │    [◉ Intro]  [Verse 1]  [Chorus]  [Solo]    │    ┃  ← 5% section bar (pills)
┃  └───────────────────────────────────────────────┘    ┃
┃                                                        ┃
┃  ┌───────────────────────────────────────────────┐    ┃
┃  │                                               │    ┃
┃  │                                               │    ┃
┃  │         [D]I got my first                     │    ┃
┃  │         real six-[A]string                    │    ┃  ← 50% lyrics area
┃  │         Bought it at the                      │    ┃     Chords 52px bold
┃  │         [G]five and [D]dime                   │    ┃     Lyrics 44px regular
┃  │         Played it 'til my                     │    ┃     Centered
┃  │         [A]fingers [G]bled                    │    ┃
┃  │         Was the [D]summer                     │    ┃
┃  │         of [A]'69                             │    ┃
┃  │                                               │    ┃
┃  └───────────────────────────────────────────────┘    ┃
┃                                                        ┃
┃  ╔════════════╗  ═══════════════════════════════════  ┃
┃  ║    ╭────╮  ║  ┌────────────────────────────────┐  ┃
┃  ║   ╱ 0:58 ╲ ║  │  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  │  ┃  ← 30% footer (lower half
┃  ║   ╲      ╱ ║  │  1:23 / 3:44     ♩=139        │  ┃     is closer in wedge)
┃  ║    ╰────╯  ║  │  Next: Gravity                 │  ┃
┃  ║   -1:23    ║  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ │  ┃
┃  ╚════════════╝  │  │CH1 ██│ │CH2 ██│ │CH3 ██│ │  ┃
┃                   │  └────┘ └────┘ └────┘ └────┘ │  ┃
┃                    └────────────────────────────────┘  ┃
┃                                                        ┃
┃  🟢 Connected     Section: Verse 2                     ┃  ← 3% status bar
┃                                                        ┃
┃  Edge cue zone (flash on transitions)                  ┃
┗═════════════════════════════════════════════════════════┛
```

### Zone Details

#### Edge Cue Zone (top+bottom 3% each)
Not a visible element — reserved for brief (200ms) white/yellow flashes that trigger peripheral vision. Used for:
- Section change approaching (2 bars before)
- Song change imminent
- Error / disconnect

#### Header (top 10%)
| Element | Style |
|---------|-------|
| Song title | **64px** Extra Bold (800) white — readable even in spot wash |
| Artist | 28px Medium (500) gray — secondary, below title |
| Key + BPM pill | Right-aligned pill: `D ♩=139`, 20px monospace, green on dark card |
| Song counter | Badge: `3/12`, right of key-pill, small but readable |
| Rationale | Title is the #1 "what song is this?" glance. Must be huge. |

#### Section Bar (5%, fixed position)
Horizontal strip of pills. One per section from `meta.json.lyrics`. Compact enough to not eat lyrics space, prominent enough to see in peripheral vision:

| State | Style |
|-------|-------|
| Current | Filled pill, section type color, **bold white text**, 22px |
| Past | Hollow outline, gray, dimmed 40% opacity |
| Future | Dark outline, muted section color, 50% opacity |
| Upcoming (within 2 bars) | Glow pulse animation (box-shadow) on the pill |
| Colors | Intro=purple, Verse=blue, Chorus=green, Solo=orange, Bridge=yellow, Outro=gray |

#### Lyrics Area (center 50%)
| Element | Style |
|---------|-------|
| Section label | 26px uppercase, letter-spaced, muted section color, centered above lyrics |
| Lyric text | **44px** white (400 weight), centered block, max 85% width, leading 1.6 |
| Chords | **52px Bold (700)**, colored by root note, with 1px white text-shadow for readability under stage wash |
| Chord backdrop | Each chord gets a subtle 4px dark pill background (`rgba(0,0,0,0.3)`) to separate from lyrics |
| Auto-scroll | Active lyric line centered vertically. Past lines dimmed to 30% opacity. |
| Empty | Shows song title 72px centered + "Waiting for playback..." 28px |

**Chord color mapping** (highly saturated — survives most stage washes):

| Root | Color | Hex | Survives red wash? | Blue wash? | Green wash? |
|------|-------|-----|-------------------|------------|-------------|
| C | Red | `#ff3333` | ✗ | ✓ | ✓ |
| C#/Db | Red-Orange | `#ff6b35` | ✓ | ✓ | ✓ |
| D | Orange | `#ff8800` | ✓ | ✓ | ✓ |
| D#/Eb | Amber | `#ffaa00` | ✓ | ✓ | ✓ |
| E | Yellow | `#ffdd00` | ✓ | ✓ | ✓ |
| F | Green | `#33cc66` | ✓ | ✓ | ✗ |
| F#/Gb | Teal | `#1abc9c` | ✓ | ✓ | ✓ |
| G | Blue | `#3399ff` | ✓ | ✗ | ✓ |
| G#/Ab | Indigo | `#5b6abf` | ✓ | ✓ | ✓ |
| A | Purple | `#9933ff` | ✓ | ✓ | ✓ |
| A#/Bb | Magenta | `#cc33ff` | ✓ | ✓ | ✓ |
| B | Pink | `#ff3399` | ✓ | ✓ | ✓ |

**At least 5 of 7 chords remain readable in any single color wash.** The white text-shadow on chords ensures the letterform survives even when color contrast is lost.

These colors follow the **Circle of Fifths** — neighboring keys have related colors. Blue→Green (G→C) = IV-I resolution visible without reading.

#### Footer (bottom 30%)
The lower half of the screen is closer to the performer in the wedge box, so it gets the most glanceable elements.

| Left (35%) | Center-Right (65%) |
|------------|-------------------|
| Circular countdown ring (180px diameter) | Wide progress bar (green fill on dark) |
| Remaining time "0:58" (48px bold center) | Elapsed / Total "1:23 / 3:44" (24px mono) |
| Total remaining "-1:23" (20px gray) | Current BPM (20px mono, right-aligned) |
| | **Next song** "→ Gravity" (28px bold, green) |
| | Compact channel meters (4 strips, 8px tall, colored by level) |

### Layout Rationale for the 22" Wedge

| Factor | Decision |
|--------|----------|
| Screen is at feet level, angled up | Lower half is closer to eyes — countdown ring + progress there |
| Overhead stage lights | Wedge box provides shade — whole screen benefits, but lower half is shaded more |
| Moving around the stage | Section bar stays in a fixed middle position — always the same place |
| Need to see chords from 4 feet away | 52px minimum for chord text, bold weight |
| Stage wash kills color contrast | White text-shadow on chords, pure white on pure black elsewhere |
| Peripheral vision triggers | Edge zones reserve 3% top/bottom for transition flash cues |
| Reading lyrics while playing | 44px text, generous line height, centered, current line highlighted |

**Chord color mapping:**

| Root | Color | Hex |
|------|-------|-----|
| C | Red | `#ff4444` |
| C#/Db | Red-Orange | `#ff6b35` |
| D | Orange | `#ff8c00` |
| D#/Eb | Amber | `#ffaa00` |
| E | Yellow | `#ffd700` |
| F | Green | `#2ecc71` |
| F#/Gb | Teal | `#1abc9c` |
| G | Blue | `#3498db` |
| G#/Ab | Indigo | `#5b6abf` |
| A | Purple | `#9b59b6` |
| A#/Bb | Magenta | `#c0392b` |
| B | Pink | `#e91e90` |

These colors are the **Circle of Fifths** — neighboring keys have related colors. Makes it intuitive: if you see blue→green (G→C), you know it's a IV-I resolution without reading the note name.

#### Section Bar (middle 7%)
A horizontal strip showing song sections as pills. One pill per section parsed from `meta.json.lyrics`:

| State | Style |
|-------|-------|
| Current | Filled pill with section color, white text |
| Past | Gray outline, dimmed |
| Future | Dark outline, muted text |
| Upcoming (within 2 bars) | Glow/pulse animation |
| Section colors | Intro=purple, Verse=blue, Chorus=green, Solo=orange, Bridge=yellow, Outro=gray |

#### Footer (bottom 30%)
Left half: **Circular Countdown Ring**, right half: **Song Progress + Mini Channel Meters**

---

## Circular Countdown Ring (Mobius-style)

### Visual Design

```
         ╭─────────────────╮
        ╱                   ╲
       │                     │
      │      0:58            │  ← remaining time (48px bold white)
      │      ↓ -1:23         │  ← total remaining (22px gray)
      │       ▓▓▓▓▓░░░      │  ← progress arc sweeps clockwise
       │     ♩=139          │  ← BPM badge at bottom of ring
        ╲                   ╱
         ╰─────────────────╯
          ∷   ∷   ∷   ∷      ← tick marks at section boundaries
```

- SVG ring, **radius 90px**, stroke-width 10px
- Full ring = remaining song duration
- Progress arc sweeps **clockwise** from 12 o'clock
- Outer diameter: **200px** in footer area (large enough to see peripherally)
- When ring is empty (song over), it pulses briefly then resets

### Ring Color States

| Condition | Ring Color | Additional Effect |
|-----------|-----------|-------------------|
| > 25% remaining | Green `#2ecc71` | Steady |
| 10%–25% remaining | Yellow `#f1c40f` | Steady |
| < 10% remaining | Red `#e74c3c` | **Pulse glow** (box-shadow animation) — urgency cue |
| Song end (last 4 bars) | Red `#e74c3c` | **Pulse + grow/shrink** ring — "look at next song" |
| Paused | Dim cyan `#555599` 50% opacity | Fades to indicate time standing still |

### Inner Text

| Element | Display |
|---------|---------|
| Center (large) | Remaining time "0:58" — **48px Extra Bold**, monospace |
| Sub-center | Total remaining "-1:23" — 22px gray monospace |
| Ring bottom | BPM badge `♩=139` — 16px, subtle, for confirmation glance |

### Tick Marks (Section Boundaries)

Each section boundary from `meta.json.lyrics` is converted to a position on the ring:

```
angle = (bar_position / total_bars) × 360
```

- Section start boundaries get a **white tick mark** (6px long, 2px wide radial line) on the outer edge
- Current position shown as a **bright dot** (6px diameter, current ring color) on the progress arc
- Beat subdivisions: **optional tiny dots** (2px, gray, 50% opacity) every 4 beats around the ring
- The tick marks give a quick visual of the song structure: "ok, we've done intro and verse, coming up on chorus"

### Peripheral Behavior

The ring is in the same position (bottom-left) for every song. Peripheral vision learns to check it:
- Color change → glance to see how much time left
- Pulsing → "look now, something's changing"
- Movement (grow/shrink) → "song is ending, get ready for next"

---

## Section Indicators & Cues

### Section Detection

The current section is determined by comparing the play cursor position against `meta.json.lyrics` bar timestamps:

```
current_bar = floor(position × bpm / (4 × 60)) + 1
```

Then find which `lyrics[{bar}]` range contains `current_bar`.

### Visual Cues

| Event | Visual | Rationale |
|-------|--------|-----------|
| Section change (2 bars before) | **Edge flash**: 200ms white glow on top edge of screen. Target section pill starts pulsing. | Peripheral vision catches the flash → you look at section bar to see what's coming |
| Section change (now) | Section label in lyrics area updates to new section name. Section pill fills solid. | You're already looking (from the pre-cue), confirmed |
| Accent hit / downbeat | Brief subtle pulse overlay (50ms) across entire screen at the beat | Helps you lock in if you're slightly off — optional, may be distracting |
| Cue event from `cue_events` | Colored icon appears top-right for 2 seconds (e.g., program change, MIDI event) | You see something happened without needing to know what |
| Song end (last 8 bars) | Ring turns red. Footer shows "→ NEXT: Gravity" in **large** green text. | Prepare for transition — look to see what's next |
| Song end (last 4 bars) | Ring pulses (grow/shrink). "→ NEXT" text gets brighter. | Urgency — stick the landing, get ready |
| Song transition | Current song fades down, next song title + key+BPM appear in center briefly | Reset moment — ~2s of clean information before next song content loads |
| Disconnected | Persistent red dot bottom-right, "🔴 DISCONNECTED" text in status bar | You need to know if you're flying blind |

### Timing Sensitivity

| Advance Warning | Too Early | Too Late | Sweet Spot |
|----------------|-----------|----------|------------|
| Edge flash | Performance is in the past, you already felt it | No time to react | **2 bars before** = ~3.5s at 120 BPM. Plenty of time to glance. |
| Ring pulse at song end | You stop playing early waiting for it | You miss the transition | **Last 8 bars** (~16s) for next song display. **Last 4 bars** (~8s) for ring pulse. |

### Performance Notes Display

The `meta.json.notes` field already contains performance notes like:
> "Drive the quarter-note pulse. Guitar: crunchy chorus tone, palm-mute verses..."

**Strategy**: Show notes **only on section change**, for 8 seconds, then fade. This prevents clutter:

1. Section changes → notes appear in a subtle bar above the footer ("Guitar: palm-mute verses")
2. Notes persist for 8 seconds, then fade over 2 seconds
3. If the performer needs to see notes longer, they can glance down — the text is still readable during fade
4. Notes never scroll or animate (motion draws attention — we want motion reserved for cues, not text)

### The "First Song of Night" Safety

When the first song starts or a rarely-played song comes up:
- Show the **entire song structure** in the section bar for 5 seconds (all pills bright)
- Notes are shown for the full first 15 seconds (longer persist)
- The ring shows the full duration arc immediately
- After 15 seconds, normal behavior resumes

---

## Data Flow (Detailed)

```
1. REAPER plays → Lua runner._loop() fires every ~16ms
2. Runner reads position, looks up current region
3. Bridge.publish() writes bridge_state.json (throttled to 200ms)
4. Server polls bridge_state.json every 500ms
5. Server broadcasts state via WebSocket to all connected clients
   ── Includes new fields: songId, sections[]
6. Stage HUD receives state update:
   a. Updates circular countdown ring (position/duration → arc)
   b. Updates song title/artist/key/bpm in header
   c. Computes current section from position vs sections[]
   d. Highlights current section pill, shows pre-cue glow on next
   e. Fetches .chopro file (or uses cached) and renders ChordPro
   f. Optionally scrolls to center current lyric line
7. Section changes → flash cue, show performance notes tooltip
8. Next song approaches → show "→ NEXT: <song>" in footer
```

### ChordPro Fetch Strategy

- **On song change**: fetch `song.chopro` via HTTP GET `/api/chordpro/:songId`
- **Cache**: keep rendered HTML in memory, re-render only on song change
- **Fallback**: if no `.chopro` file exists, fall back to showing `meta.json.notes` text (current behavior)

---

## Server Changes

### New HTTP Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/chordpro/:songId` | Raw ChordPro text from `~/ReaperSongs/<songId>/song.chopro` |
| `GET /api/song-data/:songId` | Full song data (meta.json merged) — sections, notes, key, bpm |

### State Changes

`bridge_state.json` additions:
- `songId` (string) — the slug for fetching chordpro/sections
- `sections` (array) — {bar, text, time} derived from meta.json.lyrics

Server code:
1. Poll loop reads `songId` from bridge_state
2. On songId change, fetches `~/ReaperSongs/<songId>/meta.json` and computes sections
3. Includes sections in WebSocket state broadcast

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `web/public/hud.html` | New stage HUD page (upgrades display.html with full ChordPro + countdown ring) |
| `web/public/hud.css` | Stage HUD-specific styles (not shared with iPhone controller) |
| `web/public/hud.js` | Stage HUD logic (WebSocket handler, ChordPro render, ring animation) |

### Modified Files

| File | Change |
|------|--------|
| `runner/bridge.lua` | Add `songId` and `sections` to published payload |
| `runner/runner.lua` | Expose current song's ID and section data |
| `web/server.js` | New `/api/chordpro/:songId` and `/api/song-data/:songId` endpoints; compute sections in poll loop |
| `models/song.lua` | Optionally add `chordpro_path` field |

### Sample Data Files

| File | Purpose |
|------|---------|
| `~/ReaperSongs/Summer of 69/song.chopro` | Sample ChordPro for testing |
| `~/ReaperSongs/Gravity/song.chopro` | Sample ChordPro for testing |
| `~/ReaperSongs/beds_are_burning/song.chopro` | Sample ChordPro for testing |

---

## Libraries

| Library | Version | Use |
|---------|---------|-----|
| [chordprojs](https://github.com/bergbrains/ChordproJSParser) | latest | Parse and render ChordPro text to HTML in the browser |
| No new server deps | — | chordprojs is client-side only, loaded from CDN or local |

### Client Dependencies (loaded via <script>)

```html
<script src="https://cdn.jsdelivr.net/npm/chordprojs/dist/chordprojs.min.js"></script>
```

This is the only new dependency. Zero-impact on server.

---

## Implementation Order

### Phase 0 — Sample Data (first, so we have something to test with)
1. Create sample `song.chopro` files for 2-3 test songs (Summer of 69, Gravity, Beds Are Burning)
2. These go in the existing `~/ReaperSongs/<Song>/` folders alongside `meta.json`

### Phase 1 — Server Side (data + routing)
1. Add `songId` to `bridge.lua` runner state (song model already has `.id`)
2. Add `/api/chordpro/:songId` endpoint to `server.js`
3. Add section computation to server poll loop (read meta.json, convert bar→time from lyrics array)
4. Add `sections[]` to WebSocket state broadcast

### Phase 2 — HUD Skeleton (HTML/CSS layout, no real data yet)
1. Create `hud.html` — full-screen black, four-zone layout with placeholder content
2. Create `hud.css` — stage-optimized: huge fonts, pure white on black, chord colors, section pills
3. Create `hud.js` — WebSocket connection, parse state, update DOM
4. Wire song title, artist, key, BPM from WebSocket → header

### Phase 3 — Circular Countdown Ring (the glanceable core)
1. SVG ring in footer-left, hardcoded test values first
2. Wire stroke-dashoffset to `position/duration` from WebSocket
3. Color transitions (green → yellow → red) based on percent remaining
4. Inner text showing remaining time (48px bold)
5. Tick marks at section boundary positions
6. Ring pulse animation at < 10% remaining

### Phase 4 — Lyrics + Chords (the study mode)
1. Load chordprojs. On song change, fetch `/api/chordpro/:songId`
2. Render ChordPro to HTML in the center lyrics area
3. Style chords with per-root-note colors + white text-shadow for stage wash protection
4. Auto-scroll: current lyric line centered, past lines dimmed

### Phase 5 — Section Indicators + Cues (the performance GPS)
1. Section pills in the middle section bar, colored by type
2. Current section highlighted, past dimmed, future outlined
3. Pre-section edge flash (2 bars before) — peripheral attention grabber
4. Performance notes fade-in on section change, fade-out after 8s
5. Next song display in footer during last 8 bars
6. "First song" mode: show full structure for 15s

### Phase 6 — Polish (edge cases + resilience)
1. Fallback when no `.chopro` file exists (show notes instead)
2. Fallback when no sections data (show empty bar)
3. WebSocket disconnect → frozen state + "DISCONNECTED" banner, reconnect
4. Song change transition animation
5. Performance notes edge-triggered (only show on change, not every frame)
6. Test with 20 song library, rapid next/prev, play/pause/stop edge cases

---

## Appendix: Example section data in WebSocket state

```json
{
  "sections": [
    { "bar": 1,  "time": 0.0,    "text": "🎸 Intro",   "type": "intro" },
    { "bar": 9,  "time": 13.8,   "text": "Verse 1",    "type": "verse" },
    { "bar": 25, "time": 41.4,   "text": "Chorus",     "type": "chorus" },
    { "bar": 41, "time": 69.0,   "text": "Solo",       "type": "solo" },
    { "bar": 57, "time": 96.6,   "text": "Outro",      "type": "outro" }
  ]
}
```

`time` is computed as: `(bar - 1) × 4 × 60 / bpm`

Current section at any position: find the section with the highest `time` ≤ current `position`.

---

## Appendix: section type → color mapping

| Type | Color | Hex | Used for |
|------|-------|-----|----------|
| intro | Purple | `#9b59b6` | Instrumental intros |
| verse | Blue | `#3498db` | Verses |
| chorus | Green | `#2ecc71` | Choruses |
| pre-chorus | Teal | `#1abc9c` | Pre-chorus/build sections |
| bridge | Yellow | `#f1c40f` | Bridges |
| solo | Orange | `#e67e22` | Instrumental solos |
| outro | Gray | `#7f8c8d` | Outros/endings |
| interlude | Pink | `#e91e90` | Mid-song interludes |

---

## Appendix: ChordPro → HTML rendering example

Input ChordPro:
```chordpro
I got my [D]first real six-[A]string
Bought it at the [G]five and [D]dime
```

Expected HTML output (chordprojs handles this):
```html
<div class="chordpro-song">
  <div class="chordpro-line">
    <span class="chord">D</span>
    <span class="lyric">I got my </span>
    <span class="chord">A</span>
    <span class="lyric">first real six-string</span>
  </div>
  <div class="chordpro-line">
    <span class="chord">G</span>
    <span class="lyric">Bought it at the </span>
    <span class="chord">D</span>
    <span class="lyric">five and dime</span>
  </div>
</div>
```

We apply chord colors via CSS by targeting `.chord` elements:
```css
.chord { font-weight: bold; }
.chord:contains("C")  { color: #ff4444; }
.chord:contains("D")  { color: #ff8c00; }
/* etc. — use data attributes or regex-based coloring */
```

Note: CSS `:contains()` is not standard. We'll use JavaScript to set inline styles or data attributes after chordprojs renders.

---

## Appendix: Circular Countdown SVG Schema

```svg
<svg viewBox="0 0 200 200" class="countdown-ring">
  <!-- Background track (dim) -->
  <circle cx="100" cy="100" r="85"
    fill="none" stroke="#333" stroke-width="8" />

  <!-- Progress arc (colored, sweeps clockwise) -->
  <circle cx="100" cy="100" r="85"
    fill="none" stroke="#2ecc71" stroke-width="8"
    stroke-linecap="round"
    stroke-dasharray="534"            <!-- circumference = 2π × 85 -->
    stroke-dashoffset="534"           <!-- 534 = full, 0 = empty -->
    transform="rotate(-90 100 100)" /> <!-- start from 12 o'clock -->

  <!-- Inner text: remaining time -->
  <text x="100" y="95" text-anchor="middle"
    fill="#fff" font-size="28" font-family="monospace">0:58</text>

  <!-- Inner text: total remaining -->
  <text x="100" y="120" text-anchor="middle"
    fill="#666" font-size="14" font-family="monospace">-1:23</text>
</svg>
```

Stroke-dashoffset calculation:
```
fraction = position / duration
offset = circumference × (1 - fraction)
```

For section tick marks, overlay additional short line segments at calculated angles around the ring.
