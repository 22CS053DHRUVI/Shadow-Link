const WORLD = { width: 1000, height: 620 };
const PLAYER_RADIUS = 18;
const NET_INTERVAL_MS = 50; // 20 Hz
const PING_INTERVAL_MS = 2000;
const RECONNECT_MAX_MS = 5000;

const els = {
  lobby: document.querySelector('#lobby'),
  game: document.querySelector('#game'),
  playerName: document.querySelector('#playerName'),
  roomCode: document.querySelector('#roomCode'),
  createRoom: document.querySelector('#createRoom'),
  joinRoom: document.querySelector('#joinRoom'),
  lobbyError: document.querySelector('#lobbyError'),
  roleBadge: document.querySelector('#roleBadge'),
  roomLabel: document.querySelector('#roomLabel'),
  shareCode: document.querySelector('#shareCode'),
  connectionDot: document.querySelector('#connectionDot'),
  latency: document.querySelector('#latency'),
  objectiveText: document.querySelector('#objectiveText'),
  waitingOverlay: document.querySelector('#waitingOverlay'),
  victoryOverlay: document.querySelector('#victoryOverlay'),
  toast: document.querySelector('#toast'),
  leaveGame: document.querySelector('#leaveGame'),
  restartGame: document.querySelector('#restartGame'),
  canvas: document.querySelector('#gameCanvas'),
  joystick: document.querySelector('#joystick'),
  joystickKnob: document.querySelector('#joystickKnob'),
  dashBtn: document.querySelector('#dashBtn'),
  interactBtn: document.querySelector('#interactBtn'),
};

const ctx = els.canvas.getContext('2d');

const state = {
  socket: null,
  reconnectTimer: null,
  reconnectDelay: 350,
  pingTimer: null,
  intentionalClose: false,
  roomId: '',
  playerId: getPlayerId(),
  name: sessionStorage.getItem('shadow-link:name') || '',
  role: null,
  connected: false,
  joined: false,
  peerConnected: false,
  peer: null,
  world: defaultWorld(),
  local: { x: 110, y: 250, vx: 0, vy: 0, seq: 0 },
  remote: { x: 110, y: 370, targetX: 110, targetY: 370, vx: 0, vy: 0 },
  keys: new Set(),
  stick: { x: 0, y: 0, pointerId: null },
  dashUntil: 0,
  dashCooldownUntil: 0,
  lastFrame: performance.now(),
  lastNetSend: 0,
  lastSentX: NaN,
  lastSentY: NaN,
  toastTimer: null,
  lastInteractTarget: null,
};

els.playerName.value = state.name;

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

function getPlayerId() {
  let id = sessionStorage.getItem('shadow-link:playerId');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('shadow-link:playerId', id);
  }
  return id;
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
}

function socketUrl() {
  const explicit = window.__SHADOW_LINK_WS_URL__;
  if (explicit) return explicit;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws`;
}

function showGame() {
  els.lobby.classList.add('hidden');
  els.game.classList.remove('hidden');
  els.roomLabel.textContent = `ROOM ${state.roomId}`;
  els.shareCode.textContent = state.roomId;
  updateHud();
}

function showLobby(message = '') {
  els.game.classList.add('hidden');
  els.lobby.classList.remove('hidden');
  els.lobbyError.textContent = message;
}

function connect(roomId) {
  state.roomId = roomId.toUpperCase();
  state.intentionalClose = false;
  clearTimeout(state.reconnectTimer);
  if (state.socket && state.socket.readyState < 2) state.socket.close();

  let socket;
  try {
    socket = new WebSocket(socketUrl());
  } catch {
    showLobby('Could not open the realtime connection.');
    return;
  }
  state.socket = socket;
  state.connected = false;
  state.joined = false;
  updateHud();

  socket.addEventListener('open', () => {
    if (socket !== state.socket) return;
    state.connected = true;
    state.reconnectDelay = 350;
    updateHud();
    send({
      type: 'join',
      roomId: state.roomId,
      playerId: state.playerId,
      name: state.name,
    });
    startPing();
  });

  socket.addEventListener('message', (message) => {
    if (socket !== state.socket) return;
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    handleServerEvent(event);
  });

  socket.addEventListener('close', () => {
    if (socket !== state.socket) return;
    state.connected = false;
    state.joined = false;
    stopPing();
    updateHud();
    if (state.intentionalClose || !state.roomId) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => connect(state.roomId), state.reconnectDelay);
    state.reconnectDelay = Math.min(Math.round(state.reconnectDelay * 1.7), RECONNECT_MAX_MS);
  });

  socket.addEventListener('error', () => {
    if (socket !== state.socket) return;
    state.connected = false;
    updateHud();
  });
}

function send(payload) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function handleServerEvent(event) {
  switch (event.type) {
    case 'joined': {
      state.joined = true;
      state.role = event.role;
      state.world = { ...defaultWorld(), ...(event.world || {}) };
      const self = event.self || {};
      state.local.x = Number(self.x ?? 110);
      state.local.y = Number(self.y ?? (state.role === 'light' ? 250 : 370));
      state.local.seq = Number(self.seq || 0);
      const peer = Array.isArray(event.players)
        ? event.players.find((p) => p.playerId !== state.playerId)
        : null;
      setPeer(peer);
      showGame();
      updateRoleTheme();
      updateObjective();
      toast(state.role === 'light' ? 'You entered the Light World' : 'You entered the Shadow World');
      break;
    }
    case 'peer-joined':
      if (event.player?.playerId !== state.playerId) {
        setPeer(event.player);
        toast(`${event.player.name || 'Your partner'} linked in`);
      }
      break;
    case 'peer-left':
      if (state.peer?.playerId === event.playerId) {
        state.peerConnected = false;
        els.waitingOverlay.classList.remove('hidden');
        updateObjective();
        toast('Your partner disconnected — their slot is reserved briefly');
      }
      break;
    case 'player-state': {
      const p = event.player;
      if (!p || p.playerId === state.playerId) break;
      if (!state.peer || state.peer.playerId !== p.playerId) setPeer(p);
      state.remote.targetX = Number(p.x || 0);
      state.remote.targetY = Number(p.y || 0);
      state.remote.vx = Number(p.vx || 0);
      state.remote.vy = Number(p.vy || 0);
      state.peerConnected = true;
      els.waitingOverlay.classList.add('hidden');
      updateObjective();
      break;
    }
    case 'world-state': {
      const previous = state.world;
      state.world = { ...defaultWorld(), ...(event.world || {}) };
      if (!previous.lightGateOpen && state.world.lightGateOpen) toast('The Light Gate is open');
      if (!previous.shadowGateOpen && state.world.shadowGateOpen) toast('The Shadow Seal is broken');
      if (event.target === 'restart') resetRoundPosition();
      updateObjective();
      if (state.world.victory) els.victoryOverlay.classList.remove('hidden');
      else els.victoryOverlay.classList.add('hidden');
      break;
    }
    case 'pong': {
      const rtt = Math.max(0, Date.now() - Number(event.clientTs || Date.now()));
      els.latency.textContent = `${rtt} ms`;
      break;
    }
    case 'error':
      if (event.code === 'ROOM_FULL' || event.code === 'BAD_ROOM' || event.code === 'JOIN_FAILED') {
        state.intentionalClose = true;
        state.socket?.close();
        state.roomId = '';
        showLobby(event.message || 'Could not join room.');
      } else {
        toast(event.message || 'Something went wrong');
      }
      break;
  }
}

function setPeer(peer) {
  if (!peer) {
    state.peer = null;
    state.peerConnected = false;
    els.waitingOverlay.classList.remove('hidden');
    return;
  }
  state.peer = peer;
  state.peerConnected = true;
  state.remote.x = Number(peer.x ?? 110);
  state.remote.y = Number(peer.y ?? (peer.role === 'light' ? 250 : 370));
  state.remote.targetX = state.remote.x;
  state.remote.targetY = state.remote.y;
  els.waitingOverlay.classList.add('hidden');
}

function startPing() {
  stopPing();
  const ping = () => send({ type: 'ping', clientTs: Date.now() });
  ping();
  state.pingTimer = setInterval(ping, PING_INTERVAL_MS);
}

function stopPing() {
  if (state.pingTimer) clearInterval(state.pingTimer);
  state.pingTimer = null;
}

function updateHud() {
  els.connectionDot.classList.toggle('online', state.connected);
  if (!state.connected) els.latency.textContent = 'offline';
  if (state.roomId) {
    els.roomLabel.textContent = `ROOM ${state.roomId}`;
    els.shareCode.textContent = state.roomId;
  }
}

function updateRoleTheme() {
  const light = state.role === 'light';
  els.roleBadge.textContent = light ? 'LIGHT' : 'SHADOW';
  els.roleBadge.style.color = light ? 'var(--light)' : 'var(--shadow-2)';
  els.roleBadge.style.background = light ? 'rgba(255,217,116,.13)' : 'rgba(155,131,255,.15)';
}

function updateObjective() {
  if (!state.peerConnected) {
    els.objectiveText.textContent = 'Waiting for your linked explorer…';
    return;
  }
  const w = state.world;
  if (!w.lightGateOpen) {
    els.objectiveText.textContent = state.role === 'shadow'
      ? 'Find the Moon Switch and press LINK to open your partner’s gate.'
      : 'Your gate is sealed. Your Shadow partner must activate the Moon Switch.';
  } else if (!w.shadowGateOpen) {
    els.objectiveText.textContent = state.role === 'light'
      ? 'Cross the gate and activate the Sun Altar for your Shadow partner.'
      : 'Guide your Light partner to the Sun Altar so your seal can be broken.';
  } else if (!w.victory) {
    const ready = state.role === 'light' ? w.lightReady : w.shadowReady;
    els.objectiveText.textContent = ready
      ? 'Link anchored. Your partner must reach the Nexus.'
      : 'Both gates are open. Reach the Nexus and press LINK together.';
  } else {
    els.objectiveText.textContent = 'The temple is stable. You escaped together.';
  }
}

function toast(message) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1900);
}

function resetRoundPosition() {
  const start = state.role === 'shadow' ? { x: 110, y: 370 } : { x: 110, y: 250 };
  state.local.x = start.x;
  state.local.y = start.y;
  state.local.vx = 0;
  state.local.vy = 0;
  state.lastSentX = NaN;
  state.lastSentY = NaN;
  els.victoryOverlay.classList.add('hidden');
}

function beginGame(roomId) {
  const name = els.playerName.value.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Explorer';
  state.name = name;
  sessionStorage.setItem('shadow-link:name', name);
  els.lobbyError.textContent = '';
  showGame();
  connect(roomId);
}

els.createRoom.addEventListener('click', () => beginGame(makeRoomCode()));
els.joinRoom.addEventListener('click', () => {
  const room = els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (room.length < 4) {
    els.lobbyError.textContent = 'Enter a 4–6 character room code.';
    return;
  }
  beginGame(room);
});
els.roomCode.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.joinRoom.click();
});
els.roomCode.addEventListener('input', () => {
  els.roomCode.value = els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

els.leaveGame.addEventListener('click', () => {
  state.intentionalClose = true;
  clearTimeout(state.reconnectTimer);
  stopPing();
  state.socket?.close();
  state.socket = null;
  state.roomId = '';
  state.connected = false;
  state.joined = false;
  state.peer = null;
  state.peerConnected = false;
  state.role = null;
  state.world = defaultWorld();
  els.victoryOverlay.classList.add('hidden');
  showLobby('');
});

els.restartGame.addEventListener('click', () => {
  send({ type: 'action', target: 'restart' });
});

function normalizeKey(key) {
  const k = key.toLowerCase();
  if (k === 'arrowup') return 'w';
  if (k === 'arrowdown') return 's';
  if (k === 'arrowleft') return 'a';
  if (k === 'arrowright') return 'd';
  return k;
}

window.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const key = normalizeKey(event.key);
  if (['w','a','s','d'].includes(key)) {
    event.preventDefault();
    state.keys.add(key);
  }
  if (key === 'shift') triggerDash();
  if (key === 'e' || key === ' ') {
    event.preventDefault();
    interact();
  }
});
window.addEventListener('keyup', (event) => state.keys.delete(normalizeKey(event.key)));
window.addEventListener('blur', () => state.keys.clear());

function updateStick(event) {
  const rect = els.joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = event.clientX - cx;
  let dy = event.clientY - cy;
  const max = rect.width * 0.31;
  const length = Math.hypot(dx, dy) || 1;
  if (length > max) {
    dx = (dx / length) * max;
    dy = (dy / length) * max;
  }
  state.stick.x = dx / max;
  state.stick.y = dy / max;
  els.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}

els.joystick.addEventListener('pointerdown', (event) => {
  state.stick.pointerId = event.pointerId;
  els.joystick.setPointerCapture(event.pointerId);
  updateStick(event);
});
els.joystick.addEventListener('pointermove', (event) => {
  if (state.stick.pointerId !== event.pointerId) return;
  updateStick(event);
});
function releaseStick(event) {
  if (state.stick.pointerId !== event.pointerId) return;
  state.stick.pointerId = null;
  state.stick.x = 0;
  state.stick.y = 0;
  els.joystickKnob.style.transform = 'translate(0, 0)';
}
els.joystick.addEventListener('pointerup', releaseStick);
els.joystick.addEventListener('pointercancel', releaseStick);

els.dashBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  triggerDash();
});
els.interactBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  interact();
});

function triggerDash() {
  const now = performance.now();
  if (!state.joined || now < state.dashCooldownUntil) return;
  state.dashUntil = now + 170;
  state.dashCooldownUntil = now + 760;
}

function interact() {
  if (!state.joined) return;
  const target = nearestInteractable();
  if (!target) {
    toast('Nothing here is linked to your dimension');
    return;
  }
  send({ type: 'action', target: target.id });
  if (target.id === 'moon-switch') toast('Moon Switch linked');
  if (target.id === 'sun-altar') toast('Sun Altar linked');
  if (target.id === 'nexus') toast('Nexus link anchored');
}

function nearestInteractable() {
  const list = [];
  if (state.role === 'shadow' && !state.world.lightGateOpen) list.push({ id: 'moon-switch', x: 300, y: 440 });
  if (state.role === 'light' && state.world.lightGateOpen && !state.world.shadowGateOpen) list.push({ id: 'sun-altar', x: 690, y: 180 });
  if (state.world.lightGateOpen && state.world.shadowGateOpen && !state.world.victory) list.push({ id: 'nexus', x: 860, y: 310 });
  let best = null;
  let bestDistance = 78;
  for (const item of list) {
    const distance = Math.hypot(state.local.x - item.x, state.local.y - item.y);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function inputVector() {
  let x = state.stick.x;
  let y = state.stick.y;
  if (state.keys.has('a')) x -= 1;
  if (state.keys.has('d')) x += 1;
  if (state.keys.has('w')) y -= 1;
  if (state.keys.has('s')) y += 1;
  const length = Math.hypot(x, y);
  if (length > 1) return { x: x / length, y: y / length };
  return { x, y };
}

function blockedByGate(x, y) {
  const gateOpen = state.role === 'light' ? state.world.lightGateOpen : state.world.shadowGateOpen;
  if (gateOpen) return false;
  const gate = { x: 478, y: 72, w: 34, h: 476 };
  return circleRect(x, y, PLAYER_RADIUS, gate);
}

function circleRect(cx, cy, r, rect) {
  const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < r * r;
}

function updatePlayer(dt, now) {
  if (!state.joined || state.world.victory) {
    state.local.vx = 0;
    state.local.vy = 0;
    return;
  }
  const input = inputVector();
  const dashing = now < state.dashUntil;
  const speed = dashing ? 430 : 205;
  const vx = input.x * speed;
  const vy = input.y * speed;
  state.local.vx = vx;
  state.local.vy = vy;

  let nextX = clamp(state.local.x + vx * dt, PLAYER_RADIUS + 10, WORLD.width - PLAYER_RADIUS - 10);
  let nextY = clamp(state.local.y + vy * dt, PLAYER_RADIUS + 10, WORLD.height - PLAYER_RADIUS - 10);

  if (!blockedByGate(nextX, state.local.y)) state.local.x = nextX;
  if (!blockedByGate(state.local.x, nextY)) state.local.y = nextY;

  const target = nearestInteractable();
  state.lastInteractTarget = target;
  els.interactBtn.classList.toggle('ready', Boolean(target));
}

function sendMovement(now) {
  if (!state.joined || now - state.lastNetSend < NET_INTERVAL_MS) return;
  const moved = !Number.isFinite(state.lastSentX)
    || Math.hypot(state.local.x - state.lastSentX, state.local.y - state.lastSentY) > 0.5
    || Math.abs(state.local.vx) + Math.abs(state.local.vy) > 0.1;
  if (!moved && now - state.lastNetSend < 250) return;

  state.lastNetSend = now;
  state.lastSentX = state.local.x;
  state.lastSentY = state.local.y;
  state.local.seq += 1;
  send({
    type: 'move',
    x: round1(state.local.x),
    y: round1(state.local.y),
    vx: round1(state.local.vx),
    vy: round1(state.local.vy),
    seq: state.local.seq,
  });
}

function round1(n) { return Math.round(n * 10) / 10; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function updateRemote(dt) {
  const blend = 1 - Math.pow(0.001, dt);
  state.remote.x += (state.remote.targetX - state.remote.x) * blend;
  state.remote.y += (state.remote.targetY - state.remote.y) * blend;
}

function drawWorld(time) {
  const light = state.role !== 'shadow';
  const bg = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
  if (light) {
    bg.addColorStop(0, '#1a1720');
    bg.addColorStop(.52, '#211d22');
    bg.addColorStop(1, '#10131c');
  } else {
    bg.addColorStop(0, '#0d1022');
    bg.addColorStop(.55, '#17122b');
    bg.addColorStop(1, '#080d18');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  drawFloorGrid(light);
  drawRuins(light);
  drawGate(light);
  drawInteractables(light, time);
  drawLinkLine();
  drawRemotePlayer(light);
  drawLocalPlayer(light);
  drawVignette(light);
}

function drawFloorGrid(light) {
  ctx.save();
  ctx.strokeStyle = light ? 'rgba(255,221,130,.055)' : 'rgba(156,130,255,.065)';
  ctx.lineWidth = 1;
  for (let x = 20; x < WORLD.width; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 15); ctx.lineTo(x, WORLD.height - 15); ctx.stroke();
  }
  for (let y = 20; y < WORLD.height; y += 50) {
    ctx.beginPath(); ctx.moveTo(15, y); ctx.lineTo(WORLD.width - 15, y); ctx.stroke();
  }
  ctx.strokeStyle = light ? 'rgba(255,220,130,.17)' : 'rgba(160,136,255,.18)';
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, WORLD.width - 28, WORLD.height - 28);
  ctx.restore();
}

function drawRuins(light) {
  const blocks = [
    [150, 100, 115, 34], [160, 510, 92, 28], [335, 170, 82, 30],
    [590, 420, 120, 30], [760, 90, 82, 30], [790, 505, 100, 26],
  ];
  ctx.save();
  for (const [x,y,w,h] of blocks) {
    ctx.fillStyle = light ? 'rgba(225,201,144,.085)' : 'rgba(140,123,205,.11)';
    ctx.strokeStyle = light ? 'rgba(255,229,170,.11)' : 'rgba(177,157,255,.13)';
    roundedRect(x,y,w,h,7);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawGate(light) {
  const open = light ? state.world.lightGateOpen : state.world.shadowGateOpen;
  const x = 478;
  ctx.save();
  ctx.fillStyle = light ? 'rgba(255,214,105,.14)' : 'rgba(149,120,255,.16)';
  ctx.fillRect(x - 12, 55, 58, 18);
  ctx.fillRect(x - 12, 548, 58, 18);
  if (!open) {
    const gateGradient = ctx.createLinearGradient(x, 72, x + 34, 548);
    if (light) {
      gateGradient.addColorStop(0, 'rgba(255,236,174,.9)');
      gateGradient.addColorStop(.5, 'rgba(221,164,62,.66)');
      gateGradient.addColorStop(1, 'rgba(255,236,174,.9)');
    } else {
      gateGradient.addColorStop(0, 'rgba(194,178,255,.9)');
      gateGradient.addColorStop(.5, 'rgba(106,82,207,.68)');
      gateGradient.addColorStop(1, 'rgba(194,178,255,.9)');
    }
    ctx.fillStyle = gateGradient;
    ctx.fillRect(x, 72, 34, 476);
    ctx.globalAlpha = .35;
    for (let y = 85; y < 540; y += 28) ctx.fillRect(x - 8, y, 50, 3);
  } else {
    ctx.strokeStyle = light ? 'rgba(255,222,133,.22)' : 'rgba(166,143,255,.24)';
    ctx.setLineDash([8, 12]);
    ctx.strokeRect(x, 72, 34, 476);
  }
  ctx.restore();
}

function drawInteractables(light, time) {
  if (!light) drawRune(300, 440, 28, '#aa90ff', 'MOON SWITCH', !state.world.lightGateOpen, time);
  if (light) drawRune(690, 180, 30, '#ffda73', 'SUN ALTAR', state.world.lightGateOpen && !state.world.shadowGateOpen, time);

  const nexusActive = state.world.lightGateOpen && state.world.shadowGateOpen;
  drawNexus(860, 310, nexusActive, time, light);

  if (state.lastInteractTarget) {
    const p = state.lastInteractTarget;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = .35 + Math.sin(time / 150) * .1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawRune(x, y, radius, color, label, active, time) {
  ctx.save();
  const pulse = active ? 1 + Math.sin(time / 260) * .08 : 1;
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.globalAlpha = active ? 1 : .38;
  ctx.strokeStyle = color;
  ctx.fillStyle = color + '22';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.rotate(time / 1800);
  ctx.strokeRect(-12, -12, 24, 24);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = 'rgba(235,239,250,.62)';
  ctx.font = '700 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y + 52);
  ctx.restore();
}

function drawNexus(x, y, active, time, light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = active ? 1 : .32;
  const radius = 44 + Math.sin(time / 400) * 3;
  ctx.strokeStyle = light ? '#ffd56c' : '#a88fff';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = light ? '#aa8cff' : '#ffda72';
  ctx.beginPath(); ctx.arc(0, 0, radius - 14, 0, Math.PI * 2); ctx.stroke();
  ctx.rotate(-time / 2200);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillRect(radius - 5, -2, 10, 4);
  }
  ctx.restore();
  ctx.save();
  ctx.fillStyle = 'rgba(235,239,250,.7)';
  ctx.font = '800 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('NEXUS', x, y + 67);
  ctx.restore();
}

function drawLinkLine() {
  if (!state.peerConnected) return;
  ctx.save();
  ctx.strokeStyle = state.role === 'light' ? 'rgba(171,145,255,.13)' : 'rgba(255,215,112,.13)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 10]);
  ctx.beginPath();
  ctx.moveTo(state.local.x, state.local.y);
  ctx.lineTo(state.remote.x, state.remote.y);
  ctx.stroke();
  ctx.restore();
}

function drawLocalPlayer(light) {
  ctx.save();
  const x = state.local.x, y = state.local.y;
  ctx.shadowBlur = 22;
  ctx.shadowColor = light ? 'rgba(255,214,102,.7)' : 'rgba(157,132,255,.7)';
  ctx.fillStyle = light ? '#ffdc79' : '#a58cff';
  ctx.beginPath(); ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = light ? '#fff6cb' : '#e0d9ff';
  ctx.beginPath(); ctx.arc(x - 5, y - 6, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = '800 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('YOU', x, y - 29);
  ctx.restore();
}

function drawRemotePlayer(light) {
  if (!state.peerConnected) return;
  ctx.save();
  const x = state.remote.x, y = state.remote.y;
  ctx.globalAlpha = .45;
  ctx.strokeStyle = light ? '#a98fff' : '#ffdb75';
  ctx.fillStyle = light ? 'rgba(169,143,255,.16)' : 'rgba(255,219,117,.16)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.arc(x, y, PLAYER_RADIUS + 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = .62;
  ctx.fillStyle = '#dbe1ee';
  ctx.font = '700 10px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(state.peer?.name || 'PARTNER', x, y - 29);
  ctx.restore();
}

function drawVignette(light) {
  const radial = ctx.createRadialGradient(WORLD.width/2, WORLD.height/2, 160, WORLD.width/2, WORLD.height/2, 610);
  radial.addColorStop(.55, 'rgba(0,0,0,0)');
  radial.addColorStop(1, light ? 'rgba(4,5,10,.58)' : 'rgba(2,4,12,.65)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
}

function roundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function gameLoop(now) {
  const dt = Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;
  updatePlayer(dt, now);
  updateRemote(dt);
  sendMovement(now);
  drawWorld(now);
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.keys.clear();
    state.stick.x = 0;
    state.stick.y = 0;
    els.joystickKnob.style.transform = 'translate(0, 0)';
  }
});
