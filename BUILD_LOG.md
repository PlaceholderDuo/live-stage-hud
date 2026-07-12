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

## Future Sessions

*Log entries from future work sessions will be appended below with date headers.*
