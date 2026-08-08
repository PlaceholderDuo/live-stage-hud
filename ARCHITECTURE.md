# Live Stage HUD — Architecture

## How it fits into the Live Show Manager

```
┌──────────────────────────────────────────────────────────────────┐
│                    LIVE SHOW MANAGER SYSTEM                       │
│                                                                   │
│  ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌──────────────┐ │
│  │ REAPER   │←──│ Lua       │──→│ bridge_  │──→│ Node.js      │ │
│  │ (DAW)    │OSC│ Runner    │   │ state.json│   │ Web Server   │ │
│  │          │──→│ (runner   │   │ (file     │   │ (server.js)  │ │
│  │ + Mobius │MIDI│ .lua)    │   │  bridge)  │   │              │ │
│  └──────────┘   └───────────┘   └──────────┘   └──┬───────────┘ │
│                                                    │              │
│               ┌────────────────────────────────────┼──────────┐   │
│               │         WEBSOCKET BROADCAST        │          │   │
│               │                                    ▼          │   │
│               │  ┌─────────────────────────────────────────┐  │   │
│               │  │          CONNECTED CLIENTS              │  │   │
│               │  │                                         │  │   │
│               │  │  ┌──────────────┐  ┌─────────────────┐  │  │   │
│               │  │  │ iPhone       │  │ Stage Display    │  │  │   │
│               │  │  │ Controller   │  │ (display.html)   │  │  │   │
│               │  │  │ (index.html) │  │  ╰─→ HUD UPGRADE │  │  │   │
│               │  │  │ Control only │  │    (hud.html)    │  │  │   │
│               │  │  └──────────────┘  └─────────┬───────┘  │  │   │
│               │                                  │          │  │   │
│               │                         ┌────────▼───────┐  │  │   │
│               │                         │  HTTP (static) │  │  │   │
│               │                         │  /api/chordpro │  │  │   │
│               │                         │  /api/song-data│  │  │   │
│               │                         └────────────────┘  │  │   │
│               └──────────────────────────────────────────────┘  │   │
└──────────────────────────────────────────────────────────────────┘
```

## Data Pipeline (HUD-specific)

```
REAPER position      Every ~16ms
  └→ runner.lua reads GetPlayPosition(), matches to region
       └→ bridge.lua writes bridge_state.json (throttled 200ms)
            └→ server.js polls every 500ms
                 ├→ WebSocket 'state' event → HUD position/duration/bpm/songId/sections
                 └→ HTTP GET /api/chordpro/:songId → HUD fetches ChordPro text
                      └→ chordprojs (browser) renders to HTML
                           └→ CSS styles chords by root note color
```

## Key Interfaces

### WebSocket State (from server to HUD)

```
{
  currentSong: "Summer of 69",     // display title
  songId: "summer_of_69",          // slug for HTTP fetches ← NEW
  currentArtist: "Bryan Adams",
  currentKey: "D",
  bpm: 139,
  position: 45.2,                  // seconds
  duration: 221.0,                 // seconds
  songIndex: 3,
  totalSongs: 12,
  sections: [                      // ← NEW: bar-positioned sections
    { bar: 1,  time: 0.0,    text: "🎸 Intro",   type: "intro" },
    { bar: 9,  time: 13.8,   text: "Verse 1",    type: "verse" },
    { bar: 25, time: 41.4,   text: "Chorus",     type: "chorus" },
    ...
  ],
  notes: "Drive the quarter-note pulse..."
}
```

### HTTP Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/chordpro/:songId` | Raw ChordPro text (or 404) |
| `GET /api/song-data/:songId` | Full meta.json contents |

## File Map

| Layer | File | Purpose |
|-------|------|---------|
| **Lua** | `runner/runner.lua` | Expose song.id + section data |
| **Lua** | `runner/bridge.lua` | Add songId + sections to JSON payload |
| **Server** | `web/server.js` | `/api/chordpro` + `/api/song-data` routes; section computation |
| **HUD** | `web/public/hud.html` | Stage display page (new) |
| **HUD** | `web/public/hud.css` | Stage HUD styles (new) |
| **HUD** | `web/public/hud.js` | HUD logic (new) |
| **Data** | `~/ReaperSongs/<id>/song.chopro` | ChordPro lyrics per song |
| **Config** | `~/ReaperSongs/<id>/meta.json` | Existing metadata (lyrics bar array used for sections) |

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| `.chopro` files over embedding in meta.json | ChordPro is plain text, large per song. Keep metadata and lyrics separate. |
| HTTP fetch over WebSocket for ChordPro | Song change is rare (~every 3-4 min). No need to pollute the hot WebSocket path with large text payloads. |
| Browser-side ChordPro rendering | zero server cost, chordprojs handles all edge cases, easy to restyle |
| Sections computed on server | Keeps the HUD thin — just receives computed section array |
| SVG ring over canvas | SVG scales cleanly, CSS-animatable, accessible, trivial to add tick marks |
| Chord-only line policy | A single chord-only line before a lyric line is a chord marker → merged into that lyric line (chord above its word, like UG). A run of 2+ consecutive chord-only lines is an instrumental/no-lyric section → kept first-class with `_time` and rendered as a timed chord grid (`renderInstrumentalGrid`). Empty spacer lines are dropped. This preserves UG's exact chord placement and gives intros/solos/interludes their true length. |
| Bracket tokens must be real chords | UG wraps both chords `[D]` and section labels (`[Solo/Chorus]`, `[Fade Out]`, `[Verse 1-1]`) in brackets. `parseLinePairs` filters each token through `chordTokenRe` (validated against all 237 unique bracket tokens in the library) — only genuine chord names parse as chords, so labels render as plain text and never pollute lyric rows or instrumental chord runs. |
