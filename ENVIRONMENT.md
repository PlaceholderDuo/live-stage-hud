# Stage Environment — Design Constraints

## Physical Setup

| Factor | Reality |
|--------|---------|
| Monitor | 22" LCD, 1920×1080 (likely), **in a fake wedge monitor box** at front of stage |
| Distance | 3-6 feet from performer (wedge is at feet-level, angled up) |
| Lighting | RGB stage wash, moving heads, lasers, strobes — screen competes with colored light |
| Sound | Loud — no audio cues from the display itself |
| Movement | Performer dances, plays guitar, moves around — not stationary reading |
| Attention | Split between: playing, singing, watching band members, engaging crowd, AND glancing at screen |

## How Stage Lighting Affects Readability

Stage lights wash over the screen surface. Common scenarios that kill readability:

| Lighting | Effect on Screen | Mitigation |
|----------|-----------------|------------|
| **Red wash** | Red light makes red text invisible. Lowers contrast of ALL colors. | White text survives. Avoid color-only info. Use bold/heavy fonts. |
| **White spot (follow spot)** | Completely washes out the screen | White text still visible on black if bright enough. Black text on any background = dead. |
| **Blue wash** | Blue text vanishes. Makes screen look dim. | Orange/yellow chords survive blue wash (complementary). |
| **Green wash** | Green text vanishes | Magenta/purple chords survive green wash. |
| **Lasers** | Occasional bright lines crossing screen | Transient — ignore. Don't put critical info in one spot. |
| **Strobes** | Full white flashes | Text needs to be readable in < 100ms. Huge contrast only. |

## Key Rule: Color is Enhancement, Not Primary

Chords are colored by root note for quick identification in good lighting. **But the chord letter itself must be readable even without color.** This means:
- Bold/heavy font weight on chords
- If color contrast is lost to stage wash, the letter shape still communicates
- Never rely on "the red one" — always show the text

## The "Glance vs Study" Problem

A musician glances at the screen for <500ms to confirm position, then looks away to perform. They study it for 2-3 seconds only when:
- A song they haven't played in months comes up
- A complex section change approaches
- They need to confirm a chord they're unsure about

**Design must support both modes seamlessly.**

## Visual Hierarchy for Glance (0-500ms)

In a glance, the brain registers:

1. **Motion** (peripheral vision triggers → "look now!")
2. **Big shapes** (the ring, the section bar)
3. **Bright colors** (chords popping against black)
4. **Large text** (song title, remaining time)

## Font Strategy

| Element | Weight | Size at 22" | Rationale |
|---------|--------|-------------|-----------|
| Song title | Extra Bold (800) | 64-72px | Must be readable in ANY lighting |
| Artist | Medium (500) | 28-32px | Secondary info |
| Chords | Bold (700) | 48-56px | Must pop against lyrics |
| Lyrics | Regular (400) | 40-48px | Readable at distance, lighter weight distinguishes from chords |
| Remaining time | Bold (700) monospace | 48px | Critical numeric data |
| Section name | Bold (700) | 20-24px | Supplementary orientation |
| Performance notes | Regular (400) | 18-22px | Fine print |

**The general rule: if you can't read it from across the room, it's too small.**

## Color Strategy for Stage Lighting

### Chords — root note colors (high saturation)

| Root | Color | Survives red wash? | Survives blue wash? | Survives green wash? |
|------|-------|-------------------|-------------------|---------------------|
| C | `#ff3333` Red | ✗ | ✓ | ✓ |
| D | `#ff8800` Orange | ✓ (different shade) | ✓ | ✓ |
| E | `#ffcc00` Yellow | ✓ | ✓ | ✓ |
| F | `#33cc66` Green | ✓ | ✓ | ✗ |
| G | `#3399ff` Blue | ✓ | ✗ | ✓ |
| A | `#9933ff` Purple | ✓ (contrasts red) | ✓ (contrasts blue) | ✓ |
| B | `#ff3399` Pink | ✓ | ✓ | ✓ |

No single chord color is readable under all washes, but **at least 5 of 7 are always readable** in any given wash. The chord letter itself (bold white or near-white) provides fallback.

### Status colors

| Element | Normal | Warning | Critical |
|---------|--------|---------|----------|
| Ring fill | `#2ecc71` green | `#f1c40f` yellow | `#e74c3c` red |
| Ring glow | none | 4px yellow box-shadow | 8px red box-shadow (pulsing) |
| Section transition | — | yellow flash on edge | — |

## Screen Brightness Guidelines

- **Max brightness** on the monitor itself (stage lighting is the enemy of contrast)
- Monitor in fake wedge box: the box provides some shade from overhead lights
- Angle the screen slightly downward to avoid catching follow spots
- Consider a matte screen (not glossy) — reduces reflections

## Layout Zones for Stage Use

```
┌──────────┬──────────────────────────────────┬──────────┐
│  EDGE    │         CENTER ZONE              │   EDGE   │  ← Edges for cues
│  (cue)   │   (primary reading area)          │  (cue)   │     Flash here for transitions
│          │                                   │          │
│          │   ↕ Content scrolls vertically    │          │
│          │                                   │          │
│          │   Song title fixed at top         │          │
│          │   Lyrics+chords in center         │          │
│          │   Section bar fixed middle        │          │
│          │   Countdown ring fixed bottom-left│          │
│          │                                   │          │
└──────────┴──────────────────────────────────┴──────────┘
```

- **Center zone**: where eyes go naturally — lyrics, chords, section
- **Bottom-left**: countdown ring — consistent position for peripheral awareness
- **Top**: song title — always there, always readable
- **Edges**: reserved for attention-grabbing cues (transitions, alerts)

## Peripheral Vision Cues

The human eye has ~100° of peripheral vision that detects motion and brightness change but not detail. Use this for:

| Event | Peripheral Cue |
|-------|---------------|
| Section change in 2 bars | Brief (200ms) flash on top edge of screen |
| Section change NOW | Stronger flash + section pill fills |
| Song about to end (last 10%) | Ring starts pulsing (size oscillation) |
| Song ended / transition | Brief "→ NEXT: [song]" with soft white flash |
| Error / disconnected | Persistent red dot in bottom-right corner |

## The "22" Wedge" Specifics

A 22" 16:9 monitor in a wedge box at your feet, angled up:
- **Actual usable screen**: ~19" wide × 10.5" tall (488 × 274mm)
- **Typical reading distance**: 2-4 feet (performer standing over it, angled down)
- **Primary content**: lower half of screen is closer to you (wedge angle)
- **Shadow benefit**: wedge box shields screen from overhead wash
- **Glare risk**: front spotlights can still catch the screen surface

**Implication**: Put the most important glanceable info (countdown ring, section bar) in the lower half. Put detailed info (lyrics+chords) in the upper half where there's more horizontal space.

## Touchscreen Consideration

If the display is touch-enabled (many 22" monitors are):
- **DO NOT** put touch controls on the stage display
- The display is for reading only — all controls stay on iPhone
- Touching the screen during performance risks: smudges, accidental triggers, distraction
- Exception: a "panic" zone in a corner (tap to show emergency controls) could be useful but is out of scope

## Takeaway Design Principles

1. **MAXIMUM CONTRAST** — pure white on pure black, nothing less
2. **BOLD EVERYTHING** — chords at minimum 700 weight, title at 800
3. **BIG TEXT** — 48px minimum for reading content, 64px+ for glance content
4. **COLOR IS BONUS** — design works in monochrome, color adds 20% more info
5. **CONSISTENT LAYOUT** — ring always bottom-left, title always top, so peripherals can find them
6. **MOTION ATTRACTORS** — flashes on section changes, pulsing ring at song end
7. **EDGES FOR ALERTS** — periphery detects edge changes, triggers a look
8. **LOWER HALF IS PRIME** — closer to performer, better shadow protection in wedge
