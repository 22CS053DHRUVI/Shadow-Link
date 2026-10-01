# Shadow Link

A mobile-first, two-player browser co-op adventure where each player occupies a different dimension of the same temple. The Light and Shadow explorers must change each other's world to escape.

## Current vertical slice

- Two players join the same room from separate devices.
- First player becomes **Light**, second becomes **Shadow**.
- Mobile touch joystick, dash, and context-sensitive **LINK** action.
- Local movement prediction: your character moves immediately without waiting for the network.
- Position updates at **20 Hz** with interpolation for the remote player.
- Live RTT/ping display.
- Reconnecting WebSocket client for Vercel Function lifetime restarts.
- Cross-instance room relay using Redis pub/sub.
- Cooperative puzzle loop:
  1. Shadow activates the Moon Switch.
  2. Light's gate opens.
  3. Light crosses and activates the Sun Altar.
  4. Shadow's gate opens.
  5. Both players reach the Nexus and link it.

## Why this architecture is low latency

1. **Local prediction** — movement renders immediately on the player's device.
2. **20 Hz state sync** — movement packets are sent every 50 ms instead of every render frame.
3. **Same-instance fast path** — WebSocket messages are relayed directly to local peers.
4. **Cross-instance relay** — Redis pub/sub forwards transient events when players land on different Vercel instances.
5. **Remote interpolation** — incoming positions are smoothed instead of snapping.
6. **Throttled persistence** — reconnect snapshots are persisted less often than movement packets.

For production, keep Vercel compute and Redis in geographically close regions.

## Project structure

```text
Shadow-Link/
├── api/
│   └── ws.js
├── server/
│   └── gameHub.js
├── src/
│   ├── game.js
│   └── styles.css
├── index.html
├── package.json
└── vercel.json
```

## Run locally

```bash
npm install
npm run dev
```

> Without `REDIS_URL`, multiplayer is only guaranteed when both sockets land on the same process.

## Vercel deployment

1. Import this repository into Vercel.
2. Deploy the branch you want to test.
3. Configure a Redis provider and expose its connection string as `REDIS_URL`.
4. Keep Redis geographically close to the game compute region.
5. Open the deployment on two different phones.
6. Player 1 creates a room and shares the room code with Player 2.

## Networking protocol

Client events:

- `join`
- `move`
- `action`
- `ping`

Server events:

- `joined`
- `peer-joined`
- `peer-left`
- `player-state`
- `world-state`
- `pong`
- `error`

## Next milestones

- Server-side collision and interaction validation.
- Dimension-specific combat.
- Shared health and revive system.
- More rooms and puzzle modules.
- Invite links and matchmaking.
- Binary movement packets if profiling proves JSON is a bottleneck.
- Regional matchmaking and latency-aware routing.
- Reconnect hardening and anti-cheat safeguards.
