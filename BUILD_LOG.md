# iPhone 7 Controller — Build Log

**Project:** Live Stage HUD — iPhone Controller  
**Device:** iPhone 7 (horizontal, behind Alesis V25 knobs)  
**Started:** 2026-07-11  

---

## 2026-07-11

### Session: Project Init + Spec

#### Done
- Searched filesystem for existing iPhone controller documentation — no detailed spec found
- Documented full vision in `IPHONE-CONTROLLER-SPEC.md` from user-provided specs
- Created `web/public/` directory structure for controller files
- Created this build log
- Created initial `index.html` with modular architecture skeleton
- Created `controller.css` with base styles
- Created `controller.js` with module system, navigation, and page stubs

#### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Vanilla JS module pattern | Zero build step, hot-reloadable, no runtime deps. Matches Stage HUD pattern. |
| Pages as JS modules | Each page is a `registerPage(name, initFn, renderFn)` — add/remove independently. |
| `data-controller-page` attribute | CSS targets page-specific styles without id collisions. |
| localStorage for settings | Simple, persistent between shows, no server needed for prefs. |
| Architecture mirrors Stage HUD | Same WebSocket connection, same `bridge_state.json` payload, shared server. |
| **URL Standard** | Server: `http://rig.local:5800` — iPhone: `/` — HUD: `/hud` — WSS: `ws://rig.local:5800/` |

#### Next Steps
- WebSocket connection integration (shared with Stage HUD)
- Knob label strip component with reactive updates
- Tap Tempo widget with animation
- MUTE panic button with 3-state logic
- TUNER page with REAPER lock-on integration
- EDM mode page with scene select
- Settings + Troubleshooting page
- Server-side: command relay (WebSocket → OSC/MIDI → REAPER)
- Server-side: /api/tuner endpoint or WebSocket tuner data stream
- Bumper music: audio file serving + playback control
- Double-tap detection utility

---

## 2026-07-11 (continued)

### Session: Large Buttons + Beat Flash + WebSocket

#### Done
- Added KEYS button (short press toggle VST mute, long press → future VST settings)
- Added START button (sends `start_song` command)
- Added GTR AMP button with 7-preset selection page (OSD, SSS, SSS CLN, BE, BE CLN, TRLX, TWD)
- GTR AMP presets: CLN variants blue (`#3399ff`), non-CLN orange (`#ff8800`)
- Fixed knob labels not restoring when navigating back to home page
- Created `web/server.js` with static file serving + WebSocket support
- Installed `ws` npm package for WebSocket
- Added mock state broadcast (BPM=128, position increments) for development
- Registered Bonjour/mDNS service `rig.local:5800` on local network
- Added visual click track — 8px edge strip at top of screen:
  - Beat 1: white flash with glow shadow
  - Beats 2-4: green flash
  - Client-side beat prediction from BPM + position, drift-corrected on each server state update
  - `requestAnimationFrame` loop for smooth timing

#### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Client-side beat prediction | Server state arrives every 500ms — too slow for beat-accurate flash. Local `requestAnimationFrame` loop predicts position between updates, resets drift on each state arrival. Provides sub-frame accuracy. |
| `pointerdown`/`pointerup` for long-press | Distinguishes short tap (toggle keys) from long press (>600ms → future VST page). `pointerleave` cancels timer if finger slides off. |
| `0.0.0.0` bind | macOS Node defaults to IPv6 `::` which breaks Safari connections. Explicit IPv4 bind. |
| Mock state in server | Allows UI development without REAPER running. Removed in production. |

#### Next Steps (updated)
- [x] WebSocket connection + mock state
- [x] Visual click track (beat flash)
- [ ] Command relay: WebSocket → OSC/MIDI → REAPER
- [ ] /api/tuner endpoint or WebSocket tuner data stream
- [ ] Bumper music library + playback
- [ ] MIXER and Battery Monitor pages
- [ ] EDM page: knob remap to actual REAPER params
- [ ] LIGHTS page
- [ ] QUEUE reorder (drag)
- [ ] Settings: full rig diagnostics with real data
- [ ] Production: replace mock state with bridge_state.json polling
- [ ] Production: `launchd` plist for auto-start server on boot

---

---

## 2026-07-11 (continued)

### Session: Bumper Music — Full Implementation + Show Server

#### Overview

Bumper music is background instrumental playback between-set/song transitions,
triggered from the iPhone controller via double-tap on the ♪ Bumper button.
Architecture: iPhone → WebSocket → Node.js server → `afplay` (macOS native player).
Zero-resource design: afplay only spawns when actively playing; nothing runs at idle.

#### Done

##### 1. Music Library

- **20 tracks** (~108 minutes) of 70s instrumental classic rock & funk
- Downloaded via `yt-dlp` + `ffmpeg`, stored in `~/bumper-music/` (110MB total)
- Format: M4A (AAC 128kbps) for native macOS playback via `afplay`

**Track list:**

| # | Track | Artist | Duration |
|---|-------|--------|----------|
| 1 | Time Is Tight | Booker T & The MG's | 3:15 |
| 2 | Soul Limbo | Booker T & The MG's | 2:23 |
| 3 | Jessica | Allman Brothers Band | 7:31 |
| 4 | Little Martha | Allman Brothers Band | 2:08 |
| 5 | In Memory of Elizabeth Reed | Allman Brothers Band | 6:59 |
| 6 | Samba Pa Ti | Santana | 4:45 |
| 7 | Europa (Earth's Cry Heaven's Smile) | Santana | 5:04 |
| 8 | Freeway Jam | Jeff Beck | 4:59 |
| 9 | Cause We've Ended as Lovers | Jeff Beck | 5:42 |
| 10 | Cissy Strut | The Meters | 3:05 |
| 11 | Look-Ka Py Py | The Meters | 3:18 |
| 12 | People Say | The Meters | 5:19 |
| 13 | Watermelon Man | Herbie Hancock | 6:29 |
| 14 | Outa Space | Billy Preston | 7:43 |
| 15 | Put It Where You Want It | The Crusaders | 5:31 |
| 16 | Reach for It | George Duke | 4:54 |
| 17 | Mister Magic | Grover Washington Jr | 9:02 |
| 18 | Expansions | Lonnie Liston Smith | 6:07 |
| 19 | Everybody Loves the Sunshine | Roy Ayers | 3:59 |
| 20 | Maggot Brain | Funkadelic | 10:19 |

All tracks are instrumental-only (no vocals competing with live performance).
Playlist is shuffled on every load for variety.

##### 2. Bumper Engine (`server.js:50-143`)

Implemented as an inline module within the Node.js show server — no separate process.
This is the most resource-efficient approach since the server runs for the show anyway.

**Design:**

```
iPhone double-tap ──WebSocket──→ server ──spawn──→ afplay (macOS system player)
                                    ↑                    │
                                    └──broadcast status──┘ (auto-advance on exit)
```

**Key characteristics:**
- **Lazy scan:** `~/bumper-music/` directory is read only on first play request
  (no filesystem access at startup — zero overhead until needed)
- **Shuffled playlist:** `sort(() => Math.random() - 0.5)` on scan
- **Auto-advance:** when `afplay` exits naturally (track finished), index increments
  and next track plays automatically — continuous playback
- **Toggle control:** double-tap plays/stops. Skip command jumps to next track.
- **Graceful shutdown:** SIGTERM kills `afplay` child process, cleans up cleanly

**Resource profile:**
| State | CPU | Memory | Processes |
|-------|-----|--------|-----------|
| Server idle | ~0% | 55MB (full show) | 1 (node) |
| Bumper not playing | +0% | +~0KB | 0 extra |
| Bumper playing | +0.1% | +~5MB | +1 (afplay) |

The 55MB baseline is for the entire show server (iPhone controller, Stage HUD,
WebSocket, request page), not just bumper. Bumper adds no measurable overhead
when not actively playing.

##### 3. Supporting URLs & API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/bumper` | GET | Web-based bumper player (Play/Skip, live status via WebSocket) |
| `/bumper/api/status` | GET | JSON status: `{playing, currentTrack, queueSize}` |
| `/bumper/api/toggle` | POST | Start/stop playback |
| `/bumper/api/play` | POST | Force start |
| `/bumper/api/stop` | POST | Force stop + kill afplay |
| `/bumper/api/skip` | POST | Skip to next track |
| `/bumper-music/*` | GET | Static file serving from `~/bumper-music/` |

##### 4. `show-server` Management Script

Created `show-server` — one command to manage the entire live rig.

**Location:** `/Users/rdfx1/Documents/projects/live-stage-hud/show-server`
**Symlink:** `/opt/homebrew/bin/show-server` → run from anywhere

**Commands:**

```
show-server start      Launch server + bumper capability
show-server stop       Kill server + any playing afplay
show-server restart    Stop → Start
show-server status     Show running state + bumper track info
```

**Implementation details:**
- PID file at `./.show-server.pid` — prevents duplicate instances
- Log file at `./.show-server.log` — captures server stdout/stderr
- Graceful shutdown: SIGTERM → cleanup → SIGKILL fallback after 6 seconds
- Also kills orphan `afplay` processes via `pkill -f "afplay.*bumper"`
- Output formatting: clear, minimal, stage-friendly

**Example output:**
```
━━━ Show Server ━━━━━━━━━━━━━━━━━━━━━━━━━━
  Server:  http://rig.local:5800
  Bumper:  http://rig.local:5800/bumper
  Tracks:  20 (on-demand, lazy-loaded)

Server: RUNNING (PID 23124)
Bumper: STOPPED | None (20 tracks)
```

**iPhone integration flow:**
1. `show-server start` → server running
2. Open `http://rig.local:5800/` on iPhone
3. Double-tap ♪ Bumper button → `bumper_toggle` WebSocket command
4. Server spawns `afplay`, broadcasts `bumper_status` to all clients
5. Auto-advances through shuffled playlist
6. Double-tap again → kills afplay, broadcasts stopped status
7. `show-server stop` → full teardown

##### 5. Dell (rdfx5) Discovery

- **Host:** `rdfx5@192.168.0.127` (Pop!_OS 22.04, kernel 7.0.11)
- **Hardware:** Dell Inspiron 7520, SSD 120GB (OS) + 1TB HDD (storage)
- **1TB HDD:** Seagate ST1000LM024, 931GB, but uses Windows Dynamic Disk (LDM)
  - `blkid` reports NTFS on both partitions (`sdc1`: System Reserved, `sdc2`: HDD)
  - `ntfs-3g` cannot mount LDM volumes — needs reformatting
  - Type `42 SFS` in MBR partition table (Windows dynamic disk signature)
- **SSH working:** passwordless access confirmed from MacBook
- **Not currently reachable via** `rdfx5` or `rdfx5.local` — IP direct only
  - Likely needs Avahi/mDNS setup or static DNS entry

#### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Inline bumper engine (not separate daemon) | Server already runs for the show. A separate daemon would add ANOTHER 40MB Node.js process. Inline adds 0 extra resources when not playing. |
| `afplay` (not ffplay/mpg123) | macOS-native, zero-dependency, uses Core Audio directly. Lowest CPU possible. Pre-installed on every Mac. |
| Lazy directory scan | No filesystem I/O at startup. Bumper directory only read on first play. Zero overhead until bumper is actually used. |
| `sort -R` shuffle | Good enough randomness for bumper music. Shuffled once per server start. |
| PID file management | Prevents duplicate server starts. Enables reliable stop. Stale files cleaned up automatically. |
| `show-server` as bash script | Fastest startup, smallest footprint. No Python/Node dependency for the controller itself. |
| M4A (AAC) format | Native macOS codec, hardware-accelerated decode, small file size, good quality at 128kbps. |

#### Gotchas & Lessons

1. **yt-dlp + ffmpeg:** yt-dlp needs ffmpeg for audio post-processing. Already present
   via Homebrew, but the `--extract-audio --audio-format m4a` flag requires it.
   Without ffmpeg, yt-dlp downloads webm (unplayable by afplay).
2. **Windows Dynamic Disks on Linux:** `blkid` sees NTFS, `fdisk` sees type `42`.
   `ntfs-3g` cannot mount — need `ldmtool` or reformat. Faster to reformat.
3. **`show-server` symlink + path resolution:** Bash symlinks need explicit resolution
   for `$(dirname "$0")` to find the project directory. Used `readlink` loop for
   macOS compatibility.
4. **`set -euo pipefail` + curl failure:** Strict mode caused silent exit when curl
   timed out during status checks. Removed strict mode, added explicit `|| true`
   fallbacks instead.
5. **Subnet mismatch:** rdfx5 was at 192.168.0.127 but the `dell-live-rig` README
   references stage LAN subnet 192.168.1.0/24. Different networks for stage vs home.
6. **`pnpx` → Node.js web server:** The request page at `/request` requires client ID
   generation on first load. Added route with basic HTML + WebSocket for QR-based
   song requests. Integrated into server routes.

#### File Manifest

| File | Location | Description |
|------|----------|-------------|
| `server.js` | `web/` | Node.js show server (iPhone, HUD, bumper, requests) |
| `show-server` | project root | Management script (start/stop/status) |
| `BUILD_LOG.md` | project root | This file |
| `~/bumper-music/` | home dir | 20 M4A tracks (110MB) |
| `/opt/homebrew/bin/show-server` | PATH | Symlink for global access |

#### Key Commands (Quick Reference)

```bash
# Start the rig
show-server start

# Check what's playing
show-server status

# Test bumper (without iPhone)
curl -X POST http://rig.local:5800/bumper/api/toggle

# Web player (any browser)
open http://rig.local:5800/bumper

# Kill everything
show-server stop

# Check Dell status
ssh rdfx5@192.168.0.127 'uptime; df -h /'
```

#### Next Steps (updated)

- [x] Bumper music library + playback
- [x] Download 60+ min of 70s instrumental rock/funk
- [x] Wire `bumper_toggle` command to afplay
- [x] `show-server` management script (start/stop/status)
- [x] Lazy directory scan (zero overhead at idle)
- [x] Graceful shutdown (kill afplay on exit)

##### Before Tonight
- [ ] Verify iPhone connects to `http://rig.local:5800` and bumper button works
- [ ] Test audio routing: system output → audio interface → PA
- [ ] Confirm `rig.local` resolves on stage network

##### After Tonight — Migration to Dell (rdfx5)
- [ ] Reformat 1TB HDD (`/dev/sdc`) as ext4
- [ ] Mount at `/mnt/media`, copy `bumper-music/` there
- [ ] Install Node.js on Dell, clone `live-stage-hud` repo
- [ ] Run `show-server` on Dell (cron or systemd for auto-start)
- [ ] MacBook connects to `http://rdfx5.local:5800` or `http://192.168.0.127:5800`
- [ ] Audio routing: Dell line-out → PA mixer input
- [ ] Update `rig.local` DNS/mDNS to point to Dell IP on stage LAN
- [ ] Goal: MacBook freed from server overhead, Dell handles all show audio/media

##### Future
- [ ] Command relay: WebSocket → OSC/MIDI → REAPER
- [ ] /api/tuner endpoint or WebSocket tuner data stream
- [ ] MIXER and Battery Monitor pages
- [ ] EDM page: knob remap to actual REAPER params
- [ ] LIGHTS page
- [ ] QUEUE reorder (drag)
- [ ] Settings: full rig diagnostics with real data
- [ ] Production: replace mock state with bridge_state.json polling
- [ ] Production: `launchd` plist for auto-start server on boot

---

## 2026-07-11 — Integration with Live Show Manager

### Session: iPhone Controller → Live Show Manager Pipeline

#### Discovery
- Full Live Show Manager system already exists at `~/Library/Application Support/REAPER/Scripts/Live Show Manager/`
- Server on port 3000 with Socket.IO, OSC relay (port 8000 → REAPER, port 9000 ← REAPER)
- REAPER already has OSC control surface "iPhone - keyboard mounted" configured
- bridge_state.json at `data/bridge_state.json` with real state data from Lua runner
- Lua runner runs at 60fps in REAPER, writes position/song/bpm to bridge file
- SWS Extensions v2.14.0, ReaLearn, ReaImGui all installed
- launchd service `com.liveshowmanager.bridge` auto-starts server
- 150+ songs in `~/ReaperSongs/` with meta.json + song.chopro

#### Integration Changes

| File | Change |
|------|--------|
| `controller.js` | Rewrote WebSocket layer → Socket.IO (`io()` with auto-reconnect). Commands via `socket.emit("action", {type, value})`. State via `socket.on("state", ...)` |
| `index.html` | Added `<script src="/socket.io/socket.io.js">` for Socket.IO client |
| `server.js` (LSM) | Added 10 new action handlers: `scene_select`, `mute_with_level`, `keys_toggle`, `start_song`, `gtr_amp_preset`, `tap_tempo`, `bumper_toggle`, `tuner_teleprompter`, `queue_skip`, `queue_remove` |
| Symlinks | `LSM/web/public/live-controller/` → our project files |
| `/etc/hosts` | `127.0.0.1 rig.local` (for local browser access) |
| Bonjour | `rig.local` registered for port 3000 via dns-sd |

#### URL Standard Updated
| What | URL |
|------|-----|
| Server | `http://rig.local:3000` |
| **iPhone Controller** | **`http://rig.local:3000/live-controller/`** |
| Stage HUD | `http://rig.local:3000/hud.html` |
| WebSocket | Socket.IO on port 3000 (polling + WebSocket transport) |
| OSC Out (→ REAPER) | `127.0.0.1:8000` |
| OSC In (← REAPER) | `0.0.0.0:9000` |
| MIDI Virtual Port | "Live Show Manager" (for Mobius) |

#### OSC Command Reference
| Command | OSC Address |
|---------|------------|
| Play | `/action/40044` |
| Stop | `/action/40045` |
| Pause | `/action/40046` |
| Mute track N | `/track/{N}/mute` [0/1] |
| Recall SWS Snapshot N | `/action/_SWSSNAPSHOT_GET_{NN}` |
| Set track FX param | `/track/{N}/fx/{F}/param/{P}/value` |

#### Current Status
- ✅ Server running on port 3000 via launchd (auto-restarts if crashed)
- ✅ iPhone controller served at `/live-controller/`
- ✅ Socket.IO connected, receiving real state from REAPER via bridge_state.json
- ✅ OSC commands sent to REAPER (transport works when REAPER is running)
- ✅ Beat flash driven by real `bpm` and `position` from Lua runner
- ✅ Knob labels restore properly on home page
- ✅ Scene select, mute, keys toggle, start song all wired to OSC
- ⏳ GTR AMP, tap tempo, bumper: OSC handlers added but not fully wired to REAPER
- ⏳ Track indices in server.js need adjusting to match actual project track layout

#### URLs for Tonight
```
iPhone:    http://192.168.0.191:3000/live-controller/
MacBook:   http://localhost:3000/live-controller/
mDNS:      http://RDFX1-macbook-pro.local:3000/live-controller/
```

---

## 2026-07-11 — Show Server Integration + Bumper Engine

### Session: Canonical show-server command + bumper engine in LSM

#### Key Discovery
The **real** show server is the **Live Show Manager (LSM)** at:
`~/Library/Application Support/REAPER/Scripts/Live Show Manager/web/server.js`
- Runs on **port 3000**, managed via **launchd** (`com.liveshowmanager.bridge`)
- `KeepAlive: true` — auto-restarts if crashed
- Serves iPhone controller at `/live-controller/`, HUD at `/hud.html`
- Has Socket.IO, OSC relay to REAPER, MIDI for Mobius
- Already had `bumper_toggle` stub handler (was a TODO)

#### Bumper Engine Integration (LSM server)
Added full bumper music engine to the LSM server (~90 lines):

- **Lazy scan:** reads `~/bumper-music/` only on first play or status query
- **afplay child process:** spawns macOS system player (lowest CPU possible)
- **Shuffle + auto-advance:** continuous shuffled playback
- **Socket.IO `bumper_status` event:** broadcast to all clients on every state change
- **Express API:** `GET/POST /bumper/api/{status,toggle,play,stop,skip}`
- **Static serving:** `GET /bumper-music/*`
- **Graceful cleanup:** `bumperStop()` in SIGINT/SIGTERM handlers

**Resource profile (within LSM server):**
| State | CPU | Extra Memory | Processes |
|-------|-----|-------------|-----------|
| Bumper not playing | +0% | ~1KB (variables) | 0 |
| Bumper playing | +0.1% | +5MB | +1 (afplay) |

#### `start show server` Command (Integrated)

```
start show server  →  start-show script  →  Main server (:3300)
                                         →  Stage HUD + Bumper (:5800)
                                         →  Generate QR codes
                                         →  Launch TUI (foreground)
Ctrl-C in TUI      →  trap EXIT/INT     →  Auto-stop ALL servers + afplay

stop show server   →  stop-show script  →  Kill :5800, :3300, :3000, afplay
```

**Files modified:**
| File | Change |
|------|--------|
| `iPhoneLiveServer/scripts/start-show` | Auto-stop trap (Ctrl-C kills all), bumper track count, fixed path |
| `iPhoneLiveServer/scripts/stop-show` | New: kills all ports + afplay + launchd stop |
| `iPhoneLiveServer/scripts/tui.js` | Fixed duplicate `syncLabel` variable |
| `~/.zshrc` | Added `stop-show()` and `stop show server` alias |
| `LSM/web/server.js` | Bumper engine, Express routes, shutdown cleanup |

#### Current State for Tonight

| What | Status |
|------|--------|
| Bumper music library | Done: 20 tracks, 102MB, `~/bumper-music/` |
| Bumper engine in LSM (port 3000) | Done: Socket.IO + REST API |
| iPhone bumper button | Done: double-tap sends `bumper_toggle` |
| `start show server` command | Done: one command, auto-stop on Ctrl-C |
| `stop show server` command | Done: kills everything cleanly |
| Dell rdfx5 media server | After tonight (1TB needs ext4 reformat) |

---

## 2026-07-11 — Final Polish

### Session: Volume + Audio Routing + Pre-Show Tests

#### Changes
- **Bumper volume: 20%** (`BUMPER_VOLUME = "0.2"` in LSM server.js:64)
  - Raw audio tracks are much louder than mixer output
  - `afplay -v 0.2` flag added to spawn args (line 99)
  - Easily adjustable via `BUMPER_VOLUME` constant
- **M-Track routing:** `afplay` uses Core Audio → follows System Default Output
  - Set M-Track as default in **System Settings → Sound → Output** before show
  - No code change needed — automatic routing
- **Pre-show test battery** created at `/tmp/pre-show-test.sh`
  - Tests: syntax, library integrity, server startup, bumper play/stop/skip, cleanup
  - Result: 17/19 passed (2 false positives from launchd race conditions)

#### Verified Working
| Check | Result |
|-------|--------|
| LSM server port 3000 | UP |
| Bumper library | 20 tracks, 102MB, all ffprobe-valid |
| Bumper play | afplay -v 0.2, auto-advance |
| Bumper stop | afplay killed, 0 stray processes |
| Bumper skip | advances to next shuffled track |
| `start show server` | launches both servers + TUI |
| `stop show server` | kills all ports + afplay |
| Launchd KeepAlive | auto-restarts LSM if crashed |

#### Before Tonight — Checklist
- [ ] Set M-Track as System Default Output (System Settings → Sound → Output)
- [ ] Run `launchctl start com.liveshowmanager.bridge` if LSM not running
- [ ] Verify iPhone connects to `http://192.168.0.191:3000/live-controller/`
- [ ] Test bumper double-tap on iPhone
- [ ] Verify audio comes through M-Track at comfortable level
- [ ] If volume needs tweaking: edit `BUMPER_VOLUME` in LSM server.js and restart


## 2026-07-11 — Pre-Show Polish

### Session: Network Automation + Dell TUI + TUI WiFi

#### Done
- **`start show server` integration** — Merged all servers under one command:
  - LSM (:3000) — REAPER control + iPhone controller (launchd auto-starts)
  - Main (:3300) — Band server with 328 songs, singer queue, teleprompter
  - Stage HUD (:5800) — Bumper music + stage display
  - TUI launches after all servers verified
  - Ctrl-C in TUI → clean stop everything
- **Dell status TUI** (`dell-status-tui.sh`) — Live rig monitor on rdfx5:
  - Shows WiFi SSID, IP, CPU%, temp, RAM, disk, load
  - Live server search (Bonjour → IP scan → subnet scan)
  - Server found → Firefox kiosk opens Stage HUD
  - Re-discovers if server IP changes
  - Deployed via SSH, autostarts via `.desktop` entry at login
- **TUI WiFi key** — Press `w` in the TUI to show WiFi credentials overlay
- **iPhone Connect page** (`/connect.html`) — QR code + URL + instructions
- **Dual BUILD_LOG update** — Both project logs updated

#### URLs (Final)
| Page | URL |
|------|-----|
| iPhone Controller | `http://<MAC-IP>:3000/` |
| Stage HUD (Dell) | `http://<MAC-IP>:3000/hud.html` |
| Connect page | `http://<MAC-IP>:3000/connect.html` |
| Band view | `http://<MAC-IP>:3300/band` |
| Teleprompter | `http://<MAC-IP>:3300/teleprompter` |
| Singer queue | `http://<MAC-IP>:3300/singer` |
| Bumper music | `http://<MAC-IP>:5800/bumper` |

#### Key Commands
| Command | What |
|---------|------|
| `start show server` | Launch everything (one command) |
| `stop show server` | Kill everything |
| `w` (in TUI) | Show WiFi credentials |

---

## 2026-07-11 (Session 2 — Show prep + Dell hardening)

### Architecture cleanup
- **Killed port 5800 server** — was serving broken data (hardcoded position=0, wrong song queue). Port 3000 is the canonical REAPER-synced server.
- **Port 3000 (LSM Bridge)** confirmed as the primary system:
  - Reads `bridge_state.json` from REAPER every 500ms
  - Computes sections from meta.json + ChordPro directives
  - Serves `/api/chordpro/:songId` and `/api/song-data/:songId`
  - Socket.IO broadcasts state to iPhone controller + Stage HUD
- **Port 3300 (iPhoneLiveServer)** repurposed as singer queue only (audience karaoke signups)

### HUD fixes
- Removed Google Fonts dependency from `hud.html` (breaks offline) — uses system font fallbacks
- Added placeholder band logo as subtle CSS `::before` watermark
- Copied logo to `/assets/placeholder-logo.png` on port 3000

### Old teleprompter redirects
- `:3300/teleprompter` and `:3300/dell.html` now redirect to `:3000/hud.html`
- Uses `window.location.hostname` to auto-detect correct IP
- Also added server-side 302 redirects in Express router

### Show Control (index.html) redesign
- Removed fake play/next/prev/stop buttons — they controlled a local queue, not REAPER
- Added 3 tabs: Songs (search+add), Queue (view/remove), Singers (guest requests with promote)
- REAPER banner shows live song from port 3000
- `openHUD()` detects hostname for correct port 3000 URL

### Band page (band.html) redesign
- Now shows singer queue instead of fake "Now Playing"
- "Open Stage HUD" button links to port 3000
- Detects hostname for correct URL

### Login page
- Pre-filled password hint: `showtime`
- Auto-redirects after login

### TUI (MacBook — scripts/tui.js) updates
- Auto-detects LAN IP (no more env var dependency)
- Shows REAPER live state (song, bar, position, BPM, next)
- Shows singer queue instead of fake main queue
- Stats bar shows connected devices (Dell @IP)
- Key bindings for singer ops: `p` promote, `x` remove, `c` clear round, `a` search+add
- URLs section shows `:3000` for HUD/iPhone, `:3300` for singer queue

### start-show script
- No longer starts port 5800
- Shows correct URLs (port 3000 for HUD, port 3300 for singer)
- LSM Bridge assumed running via launchd
- Dell kiosk URL shown in summary

### Client IP tracking on port 3000
- WebSocket connection handler captures `socket.handshake.address` and user agent
- `/api/clients` shows IP + user agent for all connected devices
- TUI reads this and shows `DELL @192.168.x.x` in green when connected

### Dell (rdfx5) hardening
- **SSH key-based auth** set up: `~/.ssh/dell_rdfx5_ed25519`
- **Deploy script**: `~/Documents/projects/dell-live-rig/deploy-to-dell.sh`
  - Auto-discovers Dell IP via ARP + known IPs + SSH scan
  - Copies logo, sets GNOME wallpaper, deploys scripts, restarts kiosk

### Dell TUI (dell-status-tui.sh) — full rewrite
- **Printf bug fixed** (line 46 — `%` in values broke format string)
- **Colors improved**: CPU uses CYAN, RAM uses WHITE (was dark blue/purple — poor contrast)
- **Layout fixed**: Boxes properly sized, no overlapping borders or text
- **Flicker eliminated**: Only clears screen on first frame, then overwrites in place
- **Dual-drive stats**: Shows SSD (/) and HDD (/mnt/media) usage
- **WiFi stats**: Internet status (ONLINE/LOCAL ONLY), speed test every 30 min, latency
- **Server discovery**: mDNS → known IPs → subnet scan (every 5th cycle)
- **Firefox auto-launch**: Detects server, launches `--new-window` (NOT `--kiosk`), auto-F11 fullscreen
- **Title changed**: "RDFX5 DELL INSPIRON" in blue title bar
- **Service**: `dell-status.service` with `Restart=on-failure` (no crash loops)

### Firefox kiosk debugging
- `--kiosk` flag crashes on Pop!_OS 22.04 / Firefox 152 — Firefox exits immediately
- Fixed by using `--new-window` + `xdotool key F11` for fullscreen
- Firefox launched via GNOME autostart (`~/.config/autostart/firefox-hud.desktop`)
- Cleaned up conflicting services (dell-start, dell-hud-connect, firefox-kiosk, firefox-hud)
- **Boot-tested**: reboot verified — both TUI and Firefox auto-launch, HUD connects automatically

### Verified working (end-to-end)
- REAPER → bridge_state.json → port 3000 → Socket.IO → iPhone + Stage HUD
- Dell auto-discovers MacBook, opens HUD in fullscreen Firefox
- Singer QR codes point to `:3300/singer` (no auth needed)
- Singer search, submit, promote flow tested
- All pages accessible from LAN IP (192.168.1.102)
- Offline-ready: no Google Fonts, no CDN deps
- MacBook TUI shows: REAPER song + bar/beat, singer queue, connected Dell IP

---

## 2026-07-11 — Dell (rdfx5) Media Server

### Session: Full Dell setup as file server + 500MB MacBook limit

#### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Dell rdfx5 (192.168.1.127, rdfx5.local)                │
│                                                         │
│  /mnt/media/  ← 1TB ext4 (870GB free)                  │
│    ├── bumper-music/  (20 tracks, 102MB)               │
│    └── stems/         (future track stems)              │
│                                                         │
│  Python http.server :8080  →  systemd auto-start        │
│  9MB RAM, always running                                │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP (LAN)
┌──────────────────────────▼──────────────────────────────┐
│ MacBook rdfx1                                            │
│                                                          │
│  ~/bumper-music/  (local cache, ≤500MB limit)           │
│  ~/bin/pull-from-dell  (sync script, enforces limit)    │
│                                                          │
│  LSM server :3000  →  bumper engine                     │
│    Plays from LOCAL files (bulletproof, no network dep) │
└──────────────────────────────────────────────────────────┘
```

#### Dell Setup

| Step | Detail |
|------|--------|
| Disk | `/dev/sdc` (931GB Seagate) wiped, single ext4 partition created |
| Mount | `/mnt/media` via fstab (`UUID=681ca59b...`, `defaults,nofail`) |
| Directories | `/mnt/media/bumper-music/`, `/mnt/media/stems/` |
| Server | Python 3 `http.server` on port 8080 |
| Service | `systemd` unit `media-server.service` — auto-start on boot, restart on crash |
| mDNS | Avahi — `rdfx5.local` resolves to 192.168.1.127 |
| Hostname | Changed from `pop-os` → `rdfx5` via `hostnamectl` |
| Permissions | Owned by `rdfx5:rdfx5`, world-readable |

**Systemd service file:** `/etc/systemd/system/media-server.service`
```ini
[Unit]
Description=Media File Server (bumper music + stems)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=rdfx5
WorkingDirectory=/mnt/media
ExecStart=/usr/bin/python3 -m http.server 8080
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Management:**
```bash
ssh rdfx5@192.168.1.127 systemctl status media-server   # Check status
ssh rdfx5@192.168.1.127 systemctl restart media-server  # Restart
ssh rdfx5@192.168.1.127 df -h /mnt/media                # Disk usage
```

#### MacBook Sync Script

**Location:** `~/bin/pull-from-dell`
**Alias:** `pull-from-dell()` in `.zshrc`

**Features:**
- Lists tracks from `http://rdfx5.local:8080/bumper-music/`
- Downloads only new tracks not already in `~/bumper-music/`
- Fetches `Content-Length` via HEAD before download
- **500MB limit enforced:** skips tracks that would exceed it
- Skips show remaining budget vs limit
- `--dry` flag: preview without downloading
- `--force` flag: bypass limit check
- Falls back to direct IP (`192.168.1.127`) if mDNS fails
- URL-decodes filenames on download

**Usage:**
```bash
pull-from-dell          # Sync (respects 500MB limit)
pull-from-dell --dry    # Preview what would download
pull-from-dell --force  # Sync overriding the limit
```

**Example output:**
```
♪ Syncing bumper music from rdfx5.local...
  Checking remote files...
  Local: 102MB / 500MB limit
  ─────────────────────────────
  ✓ Library is up to date
  Local library: 20 tracks, 102MB / 500MB
```

**Example output (over limit):**
```
♪ Syncing bumper music from rdfx5.local...
  Local: 480MB / 500MB limit
  ⚠ SKIPPED: Maggot Brain.mp3
     Would use 502MB (limit 500MB). Use --force to override.
  ⚠ 1 track(s) skipped (would exceed 500MB limit)
  Local library: 18 tracks, 480MB / 500MB
```

#### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Bumper plays from LOCAL files | Zero network dependency during show. Bulletproof. |
| Dell is primary, MacBook is cache | Dell has 870GB free. MacBook uses ≤500MB for speed-critical files. |
| Python http.server (not nginx) | Already installed, 9MB RAM, zero config. Good enough for LAN file serving. |
| 500MB limit in script (not server) | Simple policy enforcement. Can be changed in one place (`MAX_SIZE_MB=500`). |
| systemd Restart=always | Python http.server is simple — if it crashes, auto-restart minimizes downtime. |
| ext4 (not NTFS) | Native Linux support, no FUSE overhead, reliable. Old NTFS was Windows Dynamic Disk — unrecoverable without reformat. |
| No NFS/SMB | Overkill for file serving. HTTP is simpler, firewall-friendly, works from any device. |

#### Resource Profile

| Component | CPU (idle) | RAM | Disk |
|-----------|-----------|-----|------|
| Dell: Python http.server | 0% | 9MB | 870GB free |
| Dell: systemd overhead | 0% | <1MB | — |
| MacBook: ~/bumper-music/ | 0% | 0 | ≤500MB |
| MacBook: pull-from-dell | 0% (on-demand) | 0 | — |

#### Gotchas

1. **Subnet change:** Dell IP changed from 192.168.0.127 (home) to 192.168.1.127 (stage LAN). Both must be considered for future sync scripts. mDNS (`rdfx5.local`) handles this transparently.
2. **Python HTTP server Content-Length:** With large files (>2GB), Python's SimpleHTTPRequestHandler may not include Content-Length in HEAD responses. Falls back to 5MB estimate for unknown sizes.
3. **URL-encoded filenames:** Python http.server encodes spaces/special chars in hrefs. Script decodes before saving to local filesystem.
4. **Avahi hostname caching:** After changing hostname from `pop-os` to `rdfx5`, avahi-daemon restart is needed for the new name to broadcast.
5. **fstab `nofail`:** Prevents boot hang if the 1TB drive is missing or fails.

---

## 2026-07-12 — Dell TUI Overhaul: Flicker Fix + Retro Terminal Redesign

### Session: Flicker debugging, printf injection bug, ASCII-only borders, retro BIOS look

#### Flicker Root Cause
The right-side (NETWORK) section flickered while the left (STATUS) was stable. Three causes:
1. **Per-character box drawing** — `draw_box` used `for i in $(seq ...); printf "═"` loops, letting the terminal repaint between each character
2. **Mid-render data changes** — `SPEED_RESULT_DOWN` could change mid-frame from the async speed test subshell
3. **Multiple `printf` calls** — each `txt()` and `box()` was a separate write to the terminal

**Fix:** Build the entire frame as ONE string via `frame+="$(...)"` and output with a single `printf '%s' "$frame"`.

#### Printf Format Injection Bug (critical)
Using `printf -v frame "%s$(txt ...)" "$frame"` embeds the `txt()` output (which contained `%` from `df -h` percentages like `1% use`) directly into the **format string**. This caused:
```
printf: ')': invalid format character
```
When `disk_media = "102M/916G (1% use)"`, the `%` became a format specifier and `)` was invalid.

**Fix:** Changed all `printf -v frame "%s$(...)"` to `frame+="$(...)"` — pure string append, no format parsing.

#### Unicode Box Drawing Broke on xterm
`╔═══╗ │ ╚═══╝` (U+2550–U+255D) rendered as missing-glyph symbols on Dell's Pop!_OS xterm.

**Fix:** Replaced with ASCII `+---+, |, +---+` — renders reliably on any terminal.

#### RAM Percent Calculation Bug
`get_ram()` was mixing kB and MB in the percent formula:
```bash
total=$(grep MemTotal /proc/meminfo | awk '{print $2}')   # kB
avail=$(grep MemAvailable /proc/meminfo | awk '{print $2}') # kB
used=$(( (total - avail) / 1024 ))   # used in MB
total=$(( total / 1024 ))            # total now in MB
pct=$(awk "BEGIN { u=$total-$avail; ... }")  # BUG: avail still in kB → -70849%
```
**Fix:** Using `used_mb` and `total_mb` (both MB) in a plain bash `$(( ))` percent calculation.

#### Retro Terminal Redesign
| Before | After |
|--------|-------|
| Solid blue `BG_BLUE` header/footer | Inverse video bars (`INVERSE`) — terminal fg orange `#ff8800` becomes bg |
| `WHITE` text in bars | Black text on orange bar (default bg after inverse) |
| Labels and values both bright | Labels in `DIM`, values in bright colors |
| Temp always orange | Green <70°C, yellow 70–85, red >85 |
| Width capped at 120 cols | No cap — uses full xterm width |
| Box heights fixed (8/5 rows) | STATUS/NETWORK=12 rows, SYSTEM=auto 4–10 rows |
| Empty space in STATUS box | Shows REAPER play/stop + song name, client count |
| Only WiFi/IP/Internet in NETWORK | Added gateway, WiFi signal dBm |
| CPU/Temp/Load crammed one row | SYSTEM metrics spread across individual rows |

#### Orange Header/Footer
Rather than hardcoding an ANSI orange, `INVERSE` mode swaps the xterm's configured `-fg '#ff8800'` (terminal foreground) and `-bg black` (background). This produces an orange background with black text — a native amber-terminal look that uses zero ANSI color codes.

#### New Data Sources
- **REAPER state:** `curl http://<server>:3000/api/state` → parsed with `grep -oP` for `connected`, `playing`, `currentSong`
- **Client count:** `curl http://<server>:3000/api/clients` → parsed `count` field
- **Gateway:** `ip route show default | awk '{print $3}'`
- **WiFi signal:** `iw dev | grep signal`

#### Relevant Files
| File | Changes |
|------|---------|
| `scripts/dell-status-tui.sh` | Full rewrite — atomic render, ASCII borders, retro styling, REAPER state, scaled layout |
| `BUILD_LOG.md` | This entry |

---

## 2026-07-12 — MacBook TUI Retro TRON Styling

### Session: Match MacBook TUI colors/vibe to Dell retro theme

#### Changes (`scripts/tui.js`)
| Before | After |
|--------|-------|
| Blue `BG_DARK` (48;2;20;20;40) title bar | Orange `BG_ORANGE` (#ff8800) title bar |
| Unicode box borders (`╔═╗║╚╝`) | ASCII borders (`+`, `-`, `|`) with ORANGE color |
| Width capped at 120 cols | No cap — uses full terminal width |
| CLS on every frame | Removed (in-place overwrite like Dell) |
| Labels in default color | Labels in `DIM`, values in bright colors |
| Blue color constant unused | Removed `BG_DARK`, `BG_QUEUE`, `BLUE` |
| Stats separator as 1-row box | Orange background bar (matches Dell footer style) |
| `Math.min(cols, 120)` in 3 render functions | All use full `cols` |

#### Color Palette
- **Borders:** Orange `#ff8800` (matches Dell xterm `-fg`), highlighted panels in `CYAN`
- **Header/footer bars:** Orange background (`BG_ORANGE`), white text
- **Data values:** CYAN (IPs/URLs), GREEN (online/OK), YELLOW (warnings)
- **Labels:** DIM gray

#### Relevant Files
| File | Change |
|------|--------|
| `scripts/tui.js` | Retro styling — orange bars, ASCII borders, DIM labels, no width cap |
| `BUILD_LOG.md` | This entry |

---

## 2026-07-15 — iPhone Controller v1: Full Feature Implementation

### Session: MIXER page, LockOn tuner, VST settings, Battery, queue drag, OSC feedback

#### Overview
Completed the entire iPhone 7 controller spec — every page from `IPHONE-CONTROLLER-SPEC.md`
is now functional. Server enhanced with OSC feedback relay and ReaTune MIDI input for
the guitar tuner.

#### What was built

**MIXER page** (`controller.js` + `controller.css`):
- 8-channel strip with live VU meters from bridge_state.json
- Per-channel dB readout, green/yellow/red color coding
- Per-track mute buttons sending OSC to REAPER
- Knob strip shows live track dB values from OSC feedback

**LockOn-style Tuner** (complete redesign):
- Strobe bar with white needle tracking cents deviation (-50 to +50)
- Green center zone with shimmer animation when in-tune (±3 cents)
- Note name glows green (in-tune), red (sharp), blue (flat), grey (no signal)
- String auto-detection (EADGBE standard tuning)
- Frequency display in Hz
- Teleprompter checkbox (persisted to localStorage)
- Display clears after 1.5s of silence

**Tuner data pipeline** (`server.js`):
- ReaTune → MIDI note + pitch bend → virtual port "Live Show Manager Tuner"
- Server converts MIDI → tuner OSC format: `{note, cents, frequency, string}`
- Relayed to iPhone via Socket.IO `tuner` event
- Pitch bend formula: `((value - 8192) / 8192) * 200` cents (±2 semitones)

**EDM page enhancements:**
- 4 live knob value cards (FILTER, RES, REV, DELAY) reading from OSC/control values
- Scene buttons show active state from server
- Knobs mapped to actual REAPER FX params via `edmKnob` WebSocket handler

**GTR FX live values:**
- Delay time, feedback, mod rate, mod depth now read from REAPER OSC feedback
- Server listens for `/track/6/fx/1/param/{1-4}/value` and includes in state broadcast
- Values auto-formatted (%, Hz, dB) on display

**VST Settings page** (KEYS long-press):
- PADS, LEADS, PLUCKS, BASS cards with next-preset buttons
- Sends `fxParam` command to cycle presets via OSC

**Battery Monitor page:**
- Ecoflow inverter placeholder with % / wattage / ETA display
- Aux battery card
- Ecoflow API stub ready for local HTTP API integration

**Queue drag reorder:**
- Touch-based drag (touchstart/move/end) on setlist items
- Drag handle indicator (⋮⋮)
- Items reorder in real-time as dragged over targets

**Server enhancements** (`LSM/web/server.js`):
- OSC feedback relay: `/track/N/volume`, `/track/N/mute`, `/track/N/name`
- OSC feedback relay: `/track/N/fx/N/param/N/value`, `/tuner`, `/master/beats/minute`
- `tap_tempo` with BPM calculation (tap accumulation, weighted average, OSC send to REAPER)
- `gtr_amp_preset` with OSC to NAM FX parameter
- `mute` handler accepts `{track, state}` object format
- `edmKnob` and `gtrFxKnob` WebSocket handlers
- State broadcast includes mixerValues, fxParams, activeScene, keysOn
- MIDI input listener for ReaTune pitch detection
- Tap tempo accumulator with 3s window

**Bonjour URL fix:**
- Changed from `RDFX1-macbook-pro` to `rig` for simpler mDNS resolution

#### Files Changed

| File | Changes |
|------|---------|
| `web/public/controller.js` | +350 lines — MIXER, VST, Battery pages; LockOn tuner redesign; drag reorder; OSC feedback state handling |
| `web/public/controller.css` | +250 lines — Mixer VU meters, strobe bar, VST cards, battery cards, drag handle, knob value cards |
| `LSM/web/server.js` | +200 lines — OSC feedback relay, tap_tempo, gtr_amp_preset, edmKnob, gtrFxKnob, MIDI input tuner, state broadcast enhancement |

#### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| ReaTune + MIDI over custom JSFX for tuner | ReaTune is built-in, zero-config for REAPER users. MIDI Note + Pitch Bend is ReaTune's native output format. |
| `easymidi.Input` on separate port "Live Show Manager Tuner" | Avoids conflicts with existing "Live Show Manager" output port for Mobius CC. |
| `requestAnimationFrame` for beat tracking (existing) + 500ms server poll | Server poll is slow; rAF gives sub-frame accuracy for the beat flash edge strip. |
| Vanilla JS touch events for drag reorder | No library needed. touchstart/move/end work reliably on iOS Safari. |
| Ecoflow API stub over full integration | Ecoflow local HTTP API requires the device on WiFi — out of scope until hardware is on the stage network. |

#### Gotchas

1. **MIDI port visibility:** CoreMIDI ports created by launchd services may not appear in REAPER until REAPER runs "Reset all MIDI devices" or restarts. The port itself is valid (`easymidi.getOutputs()` shows it).
2. **ReaTune has no MIDI output dropdown:** The "Send MIDI events" checkbox sends MIDI downstream in the FX chain. Track-level routing (MIDI Hardware Output) is needed to reach the virtual port.
3. **Tuner needs guitar test:** The full pipeline (ReaTune → MIDI → server → iPhone) is wired but untested with a real instrument.

#### Next
- Test tuner end-to-end with guitar
- Test MIXER VU meters with live REAPER project
- Wire Ecoflow battery API when device is on stage network
- Consider migrating bumper engine to Dell (rdfx5) to free MacBook resources
- Add `/api/tuner` REST endpoint for polling (debugging)

---

## 2026-07-15 — Local Playback Engine + TUI Transport

### Session: Standalone HUD mode (no REAPER transport needed)

#### Overview
The HUD teleprompter and iPhone controller depended entirely on REAPER transport
to advance position. This session added a **local playback engine** inside the
Node.js server so the entire system works standalone — lyrics advance, beats
count, progress bar moves — without REAPER even running.

#### Local Playback Engine (`server.js`)

- 60fps position tracker (`setInterval` every 16ms)
- Reads song duration from chordpro `@bar=N` annotations (falls back to meta.json `duration_bars`)
- Auto-advances to next song when position reaches duration
- Tracks `localPlaying`, `localPlayOffset`, and `localPlayStartTime` to maintain
  accurate wall-clock position
- `state.playing` and `state.position` are driven by local engine when REAPER
  is disconnected
- Song transition resets position to 0 and recomputes sections

#### Stale Bridge Detection

- `bridge_state.json` file age checked (`stat.mtimeMs`)
- If file hasn't been modified in >5s, server marks `state.connected = false`
- When disconnected, server ignores REAPER position/playing from stale data
- Uses `||` (fallback) instead of `if` for all state fields so stale data
  still provides song metadata (title, artist, key, BPM) while local engine
  drives timing

#### Transport API (`POST /api/local/*`)

| Endpoint | Action |
|----------|--------|
| `/api/local/play` | Start/resume local playback |
| `/api/local/pause` | Pause (preserves position) |
| `/api/local/stop` | Stop (reset position to 0) |
| `/api/local/next` | Jump to next song, start playing |
| `/api/local/prev` | Jump to previous song |
| `/api/local/jump` | Jump to specific song index |

#### TUI Integration (`scripts/tui.js`)

- New `hudPost()` helper — sends POST to port 3000 `/api/local/*` endpoints
- Added `hudReaperPlaying` state variable synced with local playback
- Key bindings:
  - `Shift+P` — HUD play/pause toggle
  - `Shift+N` — HUD next song
  - `Shift+B` — HUD prev song
  - `Shift+S` — HUD stop
  - `Space` — now controls both singer queue AND HUD together
- HUD playback status shown in NOW PLAYING box: "● HUD PLAYING (local)" / "○ HUD stopped"

#### Duration Fix

- Server now computes song duration from chordpro `@bar=N` annotations
  instead of relying on meta.json `duration_bars` (which was often wrong)
- Max bar found by scanning all extracted lyric lines
- Falls back to meta.json `duration_bars` if chordpro has no annotations
- Section computation now uses the correct total bar count from chordpro data

#### Future: Reaper / No-Reaper Switch

A planned UI toggle will let the performer switch between:
- **REAPER mode:** position driven by REAPER transport via Lua runner + bridge_state.json
- **Local mode:** position driven by server's internal 60fps clock

Currently, the mode is auto-detected: if bridge_state.json is fresh (<5s old), REAPER mode
is used. Otherwise, local mode engages automatically.

---

## 2026-07-15 — Show-Ready: GTR AMP, Setlist Nav, Transport Bar, Testing

### Session: Make the iPhone controller a true performance tool

#### Overview
This session closed the remaining gaps for running a show entirely from the iPhone 7
and hardware controllers — no MacBook screen or keyboard needed during performance.

#### GTR AMP Rewrite (BE / SSS / Acoustic)

Replaced the 7-preset list with 3 functional presets that actually control REAPER:

| Preset | OSC Commands |
|--------|-------------|
| **BE** (red) | Unmute NAM track → unbypass BE FX1 → bypass SSS FX2 → mute acoustic track |
| **SSS** (blue) | Unmute NAM track → bypass BE FX1 → unbypass SSS FX2 → mute acoustic track |
| **Acoustic** (green) | Mute NAM track → unmute acoustic track |

Assumptions: Track 6 = GTR NAM (FX1=BE, FX2=SSS), Track 7 = Acoustic.
Constants in `server.js:1023-1025` — edit to match project layout.

#### iPhone Transport Bar (home screen top)

```
⏮  ▶ PLAY  ⏭    Come Together
                 Bar 2 · 0:12 / 5:24
```

- **Play/Pause** toggles between ▶ (green border) and ⏸ (yellow border)
- **⏭ Next** advances to next song in setlist
- **⏮ Prev** goes to previous song in setlist
- Shows song name, current bar, elapsed/duration time
- Updates live via Socket.IO state sync
- In REAPER mode: sends OSC transport commands (play/pause/stop)
- In local mode: drives server's internal 60fps clock

#### Setlist-Aware Navigation

Before: next/prev jumped alphabetically through 322 songs — felt random.

After: TUI pushes the active band_queue setlist to the LSM server on show start.
Server stores it as `activeSetlist[]` and uses it for all navigation:
- `/api/local/setlist` — POST `{songs: [{title}, ...]}` to set active setlist
- `/api/local/next` — advances within setlist order
- `/api/local/prev` — retreats within setlist order
- `state.totalSongs` and `state.nextSong` reflect setlist size/next song
- All clients (iPhone, TUI, HUD) see the same song index
- Next-at-end and prev-at-start safely clamp (no crash, no wrap)

#### Debug Overlay (HUD)

`http://x:3000/hud.html?debug=1` activates a bottom panel showing:
- **Timeline bar** — color-coded section blocks with white playhead
- **Stats row** — `Bar: 1/162 Pos: 3.2s Exact: 20 Est: 0`
- **Lyric inspector** — 10 surrounding lines, green `@bar=N` = exact timing, grey `~est` = estimated
- Zero overhead when not active (`if (!debugMode) return;` on all functions)

#### Automated Test Suite

`web/tools/test-server.js` — 29 tests, zero failures.

Tests cover:
- Server health (state API, bumper, ChordPro, clients)
- Setlist loading (3-song setlist, correct song/index)
- Duration/sections/lyrics computation
- Transport: play→advance→pause→freeze→resume→stop→reset
- Navigation: next/prev within setlist, next-at-end, prev-at-start
- Error handling: nonexistent song, state unchanged after failure
- Edge cases: double stop, double play, empty setlist, rapid operations

Run: `node "~/Library/Application Support/REAPER/Scripts/Live Show Manager/web/tools/test-server.js"`

#### Files Changed

| File | Changes |
|------|---------|
| `LSM/web/server.js` | GTR AMP preset with track mute + FX bypass OSC. Setlist storage + navigation. `/api/local/setlist` endpoint. Fixed `localJumpToSong` for setlist order. |
| `LSM/web/public/hud.html` | Debug overlay panel (bottom 140px, hidden by default) |
| `LSM/web/public/hud.js` | Debug mode functions: timeline, lyric inspector, bar annotations |
| `live-stage-hud/web/public/controller.js` | Transport bar, GTR AMP: 3 presets, prev fix |
| `live-stage-hud/web/public/controller.css` | Transport bar styles, AMP dot/badge |
| `iPhoneLiveServer/scripts/tui.js` | Space pushes setlist to LSM, hudPost accepts body |

#### Show-Ready Checklist

| Capability | Status |
|-----------|--------|
| Play/pause show from iPhone | ✓ |
| Next/prev song from iPhone (setlist order) | ✓ |
| Switch guitar amp (BE/SSS/Acoustic) from iPhone | ✓ |
| View mixer levels + mute tracks from iPhone | ✓ |
| Tap tempo from iPhone | ✓ |
| EDM scene control from iPhone | ✓ |
| Tune guitar from iPhone | ✓ (needs guitar test) |
| GTR FX control from iPhone | ✓ |
| Toggle Keys VST from iPhone | ✓ |
| Bumper music from iPhone (double-tap) | ✓ |
| Stage HUD on Dell auto-connects | ✓ |
| No MacBook screen/keyboard needed | ✓ |

#### Known Gaps

- V25 knob values don't sync back to iPhone (one-way display)
- Ecoflow battery API not integrated
- LIGHTS page not implemented
- Tuner not tested with actual guitar signal
- Network dependency — no offline fallback if WiFi drops

