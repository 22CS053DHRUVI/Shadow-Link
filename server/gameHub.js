import crypto from 'node:crypto';
import Redis from 'ioredis';

const INSTANCE_ID = crypto.randomUUID();
const ROOM_RE = /^[A-Z0-9]{4,6}$/;
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 620;
const SLOT_TTL_SECONDS = 30;
const ROOM_TTL_SECONDS = 30 * 60;
const STATE_PERSIST_MS = 500;

const sockets = new Map();
const localRooms = new Map();
const localWorld = new Map();
const localSlots = new Map();
const lastPersist = new Map();

function createRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[shadow-link] REDIS_URL missing; multiplayer is single-instance only.');
    }
    return null;
  }
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 100, 2000),
  });
}

const redis = createRedis();
const subscriber = redis ? redis.duplicate() : null;
const subscribedRooms = new Set();

if (subscriber) {
  subscriber.on('message', (channel, raw) => {
    try {
      const event = JSON.parse(raw);
      if (!event || event.origin === INSTANCE_ID) return;
      const roomId = channel.split(':')[2];
      if (!roomId) return;
      broadcastLocal(roomId, event.payload);
      applyIncomingState(roomId, event.payload);
    } catch (error) {
      console.error('[shadow-link] bad redis event', error);
    }
  });
}

function clamp(n, min, max) {
  const value = Number(n);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function cleanName(value) {
  return String(value ?? 'Explorer').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 16) || 'Explorer';
}

function cleanRoom(value) {
  const room = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return ROOM_RE.test(room) ? room : '';
}

function cleanPlayerId(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomUUID();
}

function channel(roomId) {
  return `shadow:room:${roomId}:events`;
}

function slotKey(roomId, role) {
  return `shadow:room:${roomId}:slot:${role}`;
}

function worldKey(roomId) {
  return `shadow:room:${roomId}:world`;
}

function playerKey(roomId) {
  return `shadow:room:${roomId}:players`;
}

function roomSet(roomId) {
  if (!localRooms.has(roomId)) localRooms.set(roomId, new Set());
  return localRooms.get(roomId);
}

function defaultWorld() {
  return {
    lightGateOpen: false,
    shadowGateOpen: false,
    lightReady: false,
    shadowReady: false,
    victory: false,
    round: 1,
  };
}

function getLocalWorld(roomId) {
  if (!localWorld.has(roomId)) localWorld.set(roomId, defaultWorld());
  return localWorld.get(roomId);
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcastLocal(roomId, payload, except = null) {
  const peers = localRooms.get(roomId);
  if (!peers) return;
  const encoded = JSON.stringify(payload);
  for (const ws of peers) {
    if (ws === except || ws.readyState !== 1) continue;
    ws.send(encoded);
  }
}

function publish(roomId, payload) {
  if (!redis) return;
  void redis.publish(channel(roomId), JSON.stringify({ origin: INSTANCE_ID, payload })).catch((error) => {
    console.error('[shadow-link] publish failed', error);
  });
}

async function ensureSubscription(roomId) {
  if (!subscriber || subscribedRooms.has(roomId)) return;
  subscribedRooms.add(roomId);
  try {
    await subscriber.subscribe(channel(roomId));
  } catch (error) {
    subscribedRooms.delete(roomId);
    console.error('[shadow-link] subscribe failed', error);
  }
}

async function maybeUnsubscribe(roomId) {
  if (!subscriber || !subscribedRooms.has(roomId)) return;
  const peers = localRooms.get(roomId);
  if (peers?.size) return;
  subscribedRooms.delete(roomId);
  try {
    await subscriber.unsubscribe(channel(roomId));
  } catch (error) {
    console.error('[shadow-link] unsubscribe failed', error);
  }
}

async function claimRole(roomId, playerId) {
  if (!redis) {
    if (!localSlots.has(roomId)) localSlots.set(roomId, { light: null, shadow: null });
    const slots = localSlots.get(roomId);
    if (slots.light === playerId) return 'light';
    if (slots.shadow === playerId) return 'shadow';
    if (!slots.light) {
      slots.light = playerId;
      return 'light';
    }
    if (!slots.shadow) {
      slots.shadow = playerId;
      return 'shadow';
    }
    return null;
  }

  for (const role of ['light', 'shadow']) {
    const key = slotKey(roomId, role);
    const current = await redis.get(key);
    if (current === playerId) {
      await redis.expire(key, SLOT_TTL_SECONDS);
      return role;
    }
  }

  for (const role of ['light', 'shadow']) {
    const ok = await redis.set(slotKey(roomId, role), playerId, 'EX', SLOT_TTL_SECONDS, 'NX');
    if (ok === 'OK') return role;
  }
  return null;
}

async function refreshSlot(meta) {
  if (!meta?.roomId || !meta?.role) return;
  if (!redis) return;
  const key = slotKey(meta.roomId, meta.role);
  const current = await redis.get(key);
  if (current === meta.playerId) await redis.expire(key, SLOT_TTL_SECONDS);
}

async function loadWorld(roomId) {
  if (!redis) return { ...getLocalWorld(roomId) };
  const data = await redis.hgetall(worldKey(roomId));
  if (!Object.keys(data).length) return defaultWorld();
  return {
    lightGateOpen: data.lightGateOpen === '1',
    shadowGateOpen: data.shadowGateOpen === '1',
    lightReady: data.lightReady === '1',
    shadowReady: data.shadowReady === '1',
    victory: data.victory === '1',
    round: Number(data.round || 1),
  };
}

async function saveWorld(roomId, world) {
  localWorld.set(roomId, { ...world });
  if (!redis) return;
  await redis.hset(worldKey(roomId), {
    lightGateOpen: world.lightGateOpen ? '1' : '0',
    shadowGateOpen: world.shadowGateOpen ? '1' : '0',
    lightReady: world.lightReady ? '1' : '0',
    shadowReady: world.shadowReady ? '1' : '0',
    victory: world.victory ? '1' : '0',
    round: String(world.round || 1),
  });
  await redis.expire(worldKey(roomId), ROOM_TTL_SECONDS);
}

async function loadPlayers(roomId) {
  if (!redis) {
    const result = [];
    for (const [ws, meta] of sockets) {
      if (meta.roomId !== roomId || !meta.role) continue;
      result.push({
        playerId: meta.playerId,
        name: meta.name,
        role: meta.role,
        x: meta.x,
        y: meta.y,
        vx: meta.vx,
        vy: meta.vy,
        seq: meta.seq,
      });
    }
    return result;
  }
  const hash = await redis.hgetall(playerKey(roomId));
  const players = [];
  for (const value of Object.values(hash)) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && parsed.playerId && parsed.role) players.push(parsed);
    } catch {}
  }
  return players;
}

function startPosition(role) {
  return role === 'light' ? { x: 110, y: 250 } : { x: 110, y: 370 };
}

async function persistPlayer(meta, force = false) {
  if (!redis || !meta?.roomId || !meta?.role) return;
  const key = `${meta.roomId}:${meta.playerId}`;
  const now = Date.now();
  if (!force && now - (lastPersist.get(key) || 0) < STATE_PERSIST_MS) return;
  lastPersist.set(key, now);
  const snapshot = {
    playerId: meta.playerId,
    name: meta.name,
    role: meta.role,
    x: meta.x,
    y: meta.y,
    vx: meta.vx,
    vy: meta.vy,
    seq: meta.seq,
    updatedAt: now,
  };
  await redis.hset(playerKey(meta.roomId), meta.role, JSON.stringify(snapshot));
  await redis.expire(playerKey(meta.roomId), ROOM_TTL_SECONDS);
}

function applyIncomingState(roomId, payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.type === 'world-state' && payload.world) {
    localWorld.set(roomId, { ...payload.world });
  }
}

function objectiveTargetAllowed(role, target) {
  if (target === 'moon-switch') return role === 'shadow';
  if (target === 'sun-altar') return role === 'light';
  if (target === 'nexus') return role === 'light' || role === 'shadow';
  if (target === 'restart') return true;
  return false;
}

async function handleAction(ws, meta, event) {
  const target = String(event.target || '');
  if (!objectiveTargetAllowed(meta.role, target)) return;

  const world = await loadWorld(meta.roomId);
  if (target === 'moon-switch') world.lightGateOpen = true;
  if (target === 'sun-altar' && world.lightGateOpen) world.shadowGateOpen = true;
  if (target === 'nexus' && world.lightGateOpen && world.shadowGateOpen) {
    if (meta.role === 'light') world.lightReady = true;
    if (meta.role === 'shadow') world.shadowReady = true;
    world.victory = world.lightReady && world.shadowReady;
  }
  if (target === 'restart') {
    const round = (world.round || 1) + 1;
    Object.assign(world, defaultWorld(), { round });
  }

  await saveWorld(meta.roomId, world);
  const payload = { type: 'world-state', world, by: meta.playerId, target };
  broadcastLocal(meta.roomId, payload);
  publish(meta.roomId, payload);
}

async function handleJoin(ws, event) {
  const roomId = cleanRoom(event.roomId);
  if (!roomId) return send(ws, { type: 'error', code: 'BAD_ROOM', message: 'Use a 4–6 character room code.' });

  const playerId = cleanPlayerId(event.playerId);
  const name = cleanName(event.name);
  const role = await claimRole(roomId, playerId);
  if (!role) return send(ws, { type: 'error', code: 'ROOM_FULL', message: 'This room already has two linked explorers.' });

  const oldMeta = sockets.get(ws) || {};
  if (oldMeta.roomId && localRooms.get(oldMeta.roomId)) {
    localRooms.get(oldMeta.roomId).delete(ws);
  }

  const pos = startPosition(role);
  const existingPlayers = await loadPlayers(roomId);
  const existingSelf = existingPlayers.find((p) => p.playerId === playerId && p.role === role);

  const meta = {
    playerId,
    name,
    roomId,
    role,
    x: clamp(existingSelf?.x ?? pos.x, 30, WORLD_WIDTH - 30),
    y: clamp(existingSelf?.y ?? pos.y, 30, WORLD_HEIGHT - 30),
    vx: 0,
    vy: 0,
    seq: Number(existingSelf?.seq || 0),
  };
  sockets.set(ws, meta);
  roomSet(roomId).add(ws);
  await ensureSubscription(roomId);
  await persistPlayer(meta, true);
  await refreshSlot(meta);

  const world = await loadWorld(roomId);
  const players = (await loadPlayers(roomId)).filter((p) => p.playerId !== playerId);

  send(ws, { type: 'joined', roomId, playerId, role, self: meta, players, world });
  const peerEvent = { type: 'peer-joined', player: { playerId, name, role, x: meta.x, y: meta.y } };
  broadcastLocal(roomId, peerEvent, ws);
  publish(roomId, peerEvent);
}

async function handleMove(meta, event) {
  if (!meta?.roomId || !meta.role) return;
  const seq = Math.max(meta.seq || 0, Math.floor(clamp(event.seq, 0, Number.MAX_SAFE_INTEGER)));
  if (seq < (meta.seq || 0)) return;

  meta.x = clamp(event.x, 24, WORLD_WIDTH - 24);
  meta.y = clamp(event.y, 24, WORLD_HEIGHT - 24);
  meta.vx = clamp(event.vx, -500, 500);
  meta.vy = clamp(event.vy, -500, 500);
  meta.seq = seq;

  const payload = {
    type: 'player-state',
    player: {
      playerId: meta.playerId,
      name: meta.name,
      role: meta.role,
      x: meta.x,
      y: meta.y,
      vx: meta.vx,
      vy: meta.vy,
      seq: meta.seq,
      serverTs: Date.now(),
    },
  };
  broadcastLocal(meta.roomId, payload, null);
  publish(meta.roomId, payload);
  void persistPlayer(meta).catch(() => {});
}

async function unregister(ws) {
  const meta = sockets.get(ws);
  if (!meta) return;
  sockets.delete(ws);

  if (meta.roomId) {
    const set = localRooms.get(meta.roomId);
    if (set) {
      set.delete(ws);
      if (!set.size) localRooms.delete(meta.roomId);
    }
    const payload = { type: 'peer-left', playerId: meta.playerId, role: meta.role };
    broadcastLocal(meta.roomId, payload);
    publish(meta.roomId, payload);
    void persistPlayer(meta, true).catch(() => {});
    void maybeUnsubscribe(meta.roomId);
  }

  if (!redis && meta.roomId && meta.role) {
    const slots = localSlots.get(meta.roomId);
    if (slots?.[meta.role] === meta.playerId) slots[meta.role] = null;
  }
}

export function attachConnection(ws) {
  sockets.set(ws, { playerId: '', name: '', roomId: '', role: null, x: 0, y: 0, vx: 0, vy: 0, seq: 0 });

  ws.on('message', (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const meta = sockets.get(ws);
    if (event.type === 'join') {
      void handleJoin(ws, event).catch((error) => {
        console.error('[shadow-link] join failed', error);
        send(ws, { type: 'error', code: 'JOIN_FAILED', message: 'Could not join the room.' });
      });
      return;
    }

    if (!meta?.roomId) return;
    void refreshSlot(meta).catch(() => {});

    if (event.type === 'move') {
      void handleMove(meta, event);
    } else if (event.type === 'action') {
      void handleAction(ws, meta, event).catch((error) => console.error('[shadow-link] action failed', error));
    } else if (event.type === 'ping') {
      send(ws, { type: 'pong', clientTs: Number(event.clientTs || 0), serverTs: Date.now() });
    }
  });

  const close = () => void unregister(ws);
  ws.on('close', close);
  ws.on('error', close);
}
