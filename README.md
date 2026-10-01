# Shadow Link: Rift Run

A mobile-first, real-time two-player co-op action campaign where one guardian fights in the Light World and the other fights in the Shadow World.

## V2 campaign branch

This branch replaces the original switch/gate prototype with a combat-focused campaign.

### Campaign

- 20 levels across 4 chapters.
- Level select with unlock progression and 1–3 star results.
- Difficulty scales from beginner combat to hazards, survival missions, linked enemies and bosses.
- Chapter themes:
  - Levels 1–5: **The Awakening**
  - Levels 6–10: **The Broken Realms**
  - Levels 11–15: **The Rift War**
  - Levels 16–20: **The Collapse**

### Combat

- Light and Shadow role-specific enemies.
- Basic attack and special attack.
- Dash movement.
- Player and partner health.
- Linked enemies with spirit shields that Shadow must break.
- Team Link meter.
- **Link Burst** at 100% temporarily merges the dimensions and boosts damage.
- Boss health, hazards, survival timers and timed-escape missions.

### UI / mobile redesign

- Larger battlefield using most of the viewport.
- Large mobile joystick and combat controls.
- Level, mission, health, partner, ping and Link HUD.
- Mission intro countdown.
- Mission complete / failed screens.
- Persistent browser progress for unlocked levels and stars.
- Desktop controls remain available for testing.

## Controls

### Mobile
- Left joystick — move
- Attack — basic attack
- Skill — stronger attack
- Dash — short speed burst
- Link — activate Link Burst at 100%

### Desktop
- WASD / Arrow keys — move
- J — attack
- K — skill
- Shift — dash
- L — Link Burst

## Project structure

```text
Shadow-Link/
├── api/
│   └── ws.js
├── server/
│   └── gameHub.js
├── shared/
│   └── levels.js
├── src/
│   ├── game.js
│   └── styles.css
├── index.html
├── package.json
└── vercel.json
```

## Multiplayer architecture

The client uses immediate local movement and sends movement state at 20 Hz. Remote movement is interpolated.

The WebSocket server owns shared room state such as:

- selected level
- enemy HP and spirit shields
- player health
- kills
- Link energy
- Link Burst
- mission completion/failure

Redis pub/sub relays room events across Vercel instances.

> Configure `REDIS_URL` in Vercel for reliable multiplayer across separate function instances.

## Run locally

```bash
npm install
npm run dev
```

## Vercel

`vercel.json` enables Fluid Compute for WebSocket support.

For preview testing, deploy:

```text
feature/shadow-link-v2-campaign
```

Once validated, merge/promote it into the production branch.

## Current V2 scope

The full 20-level campaign structure is implemented with reusable level configuration. The first release uses the same core combat engine across all levels while progressively introducing enemy mixes, linked shields, hazards, survival timers, darkness pulses, timed escapes and increasingly difficult bosses.

Future polish can add unique sprite art, audio, handcrafted maps, more advanced enemy movement, role-specific abilities and fully bespoke boss phases without changing the campaign/network foundation.
