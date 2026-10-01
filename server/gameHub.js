import crypto from 'node:crypto';
import Redis from 'ioredis';
import { getLevel } from '../shared/levels.js';

const INSTANCE_ID = crypto.randomUUID();
const ROOM_RE = /^[A-Z0-9]{4,6}$/;
const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 700;
const SLOT_TTL_SECONDS = 35;
const ROOM_TTL_SECONDS = 30 * 60;
const STATE_PERSIST_MS = 450;
const sockets = new Map();
const localRooms = new Map();
const localWorld = new Map();
const localSlots = new Map();
const lastPersist = new Map();
const lastHurt = new Map();

function createRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV !== 'production') console.warn('[shadow-link] REDIS_URL missing; multiplayer is single-instance only.');
    return null;
  }
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, retryStrategy: n => Math.min(n * 100, 2000) });
}
const redis = createRedis();
const subscriber = redis ? redis.duplicate() : null;
const subscribedRooms = new Set();

function channel(roomId){ return `shadow:room:${roomId}:events`; }
function slotKey(roomId, role){ return `shadow:room:${roomId}:slot:${role}`; }
function worldKey(roomId){ return `shadow:room:${roomId}:world:v2`; }
function playerKey(roomId){ return `shadow:room:${roomId}:players:v2`; }
function clamp(n,min,max){ n=Number(n); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min; }
function cleanRoom(v){ const r=String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); return ROOM_RE.test(r)?r:''; }
function cleanName(v){ return String(v??'Guardian').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,16)||'Guardian'; }
function cleanPlayerId(v){ return String(v??'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)||crypto.randomUUID(); }

if (subscriber) {
  subscriber.on('message',(ch,raw)=>{
    try{
      const event=JSON.parse(raw);
      if(!event||event.origin===INSTANCE_ID)return;
      const roomId=ch.split(':')[2];
      if(!roomId)return;
      if(event.payload?.type==='world-state'&&event.payload.world)localWorld.set(roomId,event.payload.world);
      broadcastLocal(roomId,event.payload);
    }catch(error){ console.error('[shadow-link] redis event error',error); }
  });
}

function roomSet(roomId){ if(!localRooms.has(roomId))localRooms.set(roomId,new Set()); return localRooms.get(roomId); }
function send(ws,payload){ if(ws.readyState===1)ws.send(JSON.stringify(payload)); }
function broadcastLocal(roomId,payload,except=null){
  const peers=localRooms.get(roomId); if(!peers)return;
  const encoded=JSON.stringify(payload);
  for(const ws of peers){ if(ws!==except&&ws.readyState===1)ws.send(encoded); }
}
function publish(roomId,payload){
  if(!redis)return;
  void redis.publish(channel(roomId),JSON.stringify({origin:INSTANCE_ID,payload})).catch(e=>console.error('[shadow-link] publish error',e));
}
async function emitWorld(roomId,world,extra={}){
  await saveWorld(roomId,world);
  const payload={type:'world-state',world,...extra};
  broadcastLocal(roomId,payload); publish(roomId,payload);
}
async function ensureSubscription(roomId){
  if(!subscriber||subscribedRooms.has(roomId))return;
  subscribedRooms.add(roomId);
  try{await subscriber.subscribe(channel(roomId));}catch(e){subscribedRooms.delete(roomId);console.error(e);}
}
async function maybeUnsubscribe(roomId){
  if(!subscriber||!subscribedRooms.has(roomId)||localRooms.get(roomId)?.size)return;
  subscribedRooms.delete(roomId); try{await subscriber.unsubscribe(channel(roomId));}catch{}
}

function seeded(seed){
  let x=seed|0;
  return()=>{ x=Math.imul(48271,x)%0x7fffffff; return (x&0x7fffffff)/0x7fffffff; };
}
function enemyTypeDefaults(kind){
  const map={
    soldier:{hp:80,speed:70,dimension:'light'},
    shade:{hp:70,speed:82,dimension:'shadow'},
    archer:{hp:65,speed:55,dimension:'light'},
    crawler:{hp:52,speed:125,dimension:'both'},
    brute:{hp:145,speed:48,dimension:'light'},
    hunter:{hp:105,speed:105,dimension:'shadow'},
    mirror:{hp:125,speed:88,dimension:'both'},
    'linked-warden':{hp:165,speed:62,dimension:'both',shield:90},
    'temple-guardian':{hp:520,speed:55,dimension:'both',shield:150,boss:true},
    'twin-beast':{hp:760,speed:72,dimension:'both',shield:180,boss:true},
    'rift-warden':{hp:1050,speed:76,dimension:'both',shield:240,boss:true},
    'twin-king':{hp:1600,speed:82,dimension:'both',shield:320,boss:true},
  };
  return map[kind]||map.soldier;
}
function makeEnemies(level){
  const random=seeded(level.id*7919+17);
  const count=Math.max(1,level.enemyCount||1);
  return Array.from({length:count},(_,i)=>{
    const kind=level.enemyKinds[i%level.enemyKinds.length];
    const base=enemyTypeDefaults(kind);
    const hp=base.boss?(level.bossHp||base.hp):Math.round(base.hp*(1+(level.difficulty-1)*.13));
    return{
      id:`e${level.id}-${i+1}`,kind,
      x:Math.round(360+random()*760),y:Math.round(90+random()*520),
      hp,maxHp:hp,shield:base.shield||0,maxShield:base.shield||0,
      speed:Math.round(base.speed*(1+(level.difficulty-1)*.05)),
      dimension:base.dimension,boss:Boolean(base.boss),alive:true,
    };
  });
}
function makeHazards(level){
  const random=seeded(level.id*3571+31);
  return Array.from({length:level.hazards||0},(_,i)=>({
    id:`h${level.id}-${i}`,x:Math.round(240+random()*850),y:Math.round(100+random()*500),
    radius:42+Math.round(random()*34),phase:Math.round(random()*3000)
  }));
}
function defaultWorld(levelId=1){
  const level=getLevel(levelId);
  return{
    version:2,levelId:level.id,startedAt:Date.now(),completed:false,failed:false,kills:0,
    link:0,peakLink:0,burstUntil:0,enemies:makeEnemies(level),hazards:makeHazards(level),
    surviveUntil:level.surviveSeconds?Date.now()+level.surviveSeconds*1000:null,
    timeLimitUntil:level.timeLimit?Date.now()+level.timeLimit*1000:null,
  };
}
function getLocalWorld(roomId,levelId=1){
  if(!localWorld.has(roomId))localWorld.set(roomId,defaultWorld(levelId));
  return localWorld.get(roomId);
}
async function loadWorld(roomId,levelId=1){
  if(!redis)return structuredClone(getLocalWorld(roomId,levelId));
  const raw=await redis.get(worldKey(roomId));
  if(raw){ try{const parsed=JSON.parse(raw); localWorld.set(roomId,parsed); return parsed;}catch{} }
  const world=defaultWorld(levelId); await saveWorld(roomId,world); return world;
}
async function saveWorld(roomId,world){
  localWorld.set(roomId,structuredClone(world));
  if(redis){ await redis.set(worldKey(roomId),JSON.stringify(world),'EX',ROOM_TTL_SECONDS); }
}
async function claimRole(roomId,playerId){
  if(!redis){
    if(!localSlots.has(roomId))localSlots.set(roomId,{light:null,shadow:null});
    const s=localSlots.get(roomId);
    if(s.light===playerId)return'light'; if(s.shadow===playerId)return'shadow';
    if(!s.light){s.light=playerId;return'light';} if(!s.shadow){s.shadow=playerId;return'shadow';} return null;
  }
  for(const role of ['light','shadow']){
    const key=slotKey(roomId,role),current=await redis.get(key);
    if(current===playerId){await redis.expire(key,SLOT_TTL_SECONDS);return role;}
  }
  for(const role of ['light','shadow']){
    if(await redis.set(slotKey(roomId,role),playerId,'EX',SLOT_TTL_SECONDS,'NX')==='OK')return role;
  }
  return null;
}
async function refreshSlot(meta){
  if(!redis||!meta?.roomId||!meta?.role)return;
  const key=slotKey(meta.roomId,meta.role); if(await redis.get(key)===meta.playerId)await redis.expire(key,SLOT_TTL_SECONDS);
}
function startPosition(role){return role==='light'?{x:125,y:250}:{x:125,y:450};}
async function persistPlayer(meta,force=false){
  if(!meta?.roomId||!meta?.role)return;
  const stamp=`${meta.roomId}:${meta.playerId}`,now=Date.now();
  if(!force&&now-(lastPersist.get(stamp)||0)<STATE_PERSIST_MS)return;
  lastPersist.set(stamp,now);
  if(redis){
    await redis.hset(playerKey(meta.roomId),meta.role,JSON.stringify({
      playerId:meta.playerId,name:meta.name,role:meta.role,x:meta.x,y:meta.y,vx:meta.vx,vy:meta.vy,seq:meta.seq,hp:meta.hp,maxHp:meta.maxHp,updatedAt:now
    }));
    await redis.expire(playerKey(meta.roomId),ROOM_TTL_SECONDS);
  }
}
async function loadPlayers(roomId){
  if(!redis){
    return [...sockets.values()].filter(m=>m.roomId===roomId&&m.role).map(m=>({...m}));
  }
  const h=await redis.hgetall(playerKey(roomId)); const result=[];
  for(const raw of Object.values(h)){try{const p=JSON.parse(raw);if(p?.playerId)result.push(p);}catch{}}
  return result;
}
function publicPlayer(meta){return{playerId:meta.playerId,name:meta.name,role:meta.role,x:meta.x,y:meta.y,vx:meta.vx,vy:meta.vy,seq:meta.seq,hp:meta.hp,maxHp:meta.maxHp};}

async function handleJoin(ws,event){
  const roomId=cleanRoom(event.roomId); if(!roomId)return send(ws,{type:'error',code:'BAD_ROOM',message:'Use a 4–6 character room code.'});
  const playerId=cleanPlayerId(event.playerId),name=cleanName(event.name);
  const requestedLevel=clamp(event.levelId||1,1,20);
  const role=await claimRole(roomId,playerId); if(!role)return send(ws,{type:'error',code:'ROOM_FULL',message:'This room already has two guardians.'});
  const old=sockets.get(ws)||{}; if(old.roomId)localRooms.get(old.roomId)?.delete(ws);
  const players=await loadPlayers(roomId),existing=players.find(p=>p.playerId===playerId&&p.role===role),pos=startPosition(role);
  const meta={playerId,name,roomId,role,x:clamp(existing?.x??pos.x,25,WORLD_WIDTH-25),y:clamp(existing?.y??pos.y,25,WORLD_HEIGHT-25),vx:0,vy:0,seq:Number(existing?.seq||0),hp:clamp(existing?.hp??100,0,100),maxHp:100};
  sockets.set(ws,meta);roomSet(roomId).add(ws);await ensureSubscription(roomId);await persistPlayer(meta,true);await refreshSlot(meta);
  let world=await loadWorld(roomId,requestedLevel);
  // A fresh room uses the host's chosen level. Existing rooms keep their current mission.
  if(world.completed&&Number(event.forceLevel)===1){world=defaultWorld(requestedLevel);await saveWorld(roomId,world);}
  send(ws,{type:'joined',roomId,playerId,role,self:publicPlayer(meta),players:(await loadPlayers(roomId)).filter(p=>p.playerId!==playerId),world});
  const payload={type:'peer-joined',player:publicPlayer(meta)};broadcastLocal(roomId,payload,ws);publish(roomId,payload);
}

async function handleMove(meta,event){
  if(!meta?.roomId)return;
  const seq=Math.floor(clamp(event.seq,0,Number.MAX_SAFE_INTEGER)); if(seq<meta.seq)return;
  meta.x=clamp(event.x,24,WORLD_WIDTH-24);meta.y=clamp(event.y,24,WORLD_HEIGHT-24);
  meta.vx=clamp(event.vx,-650,650);meta.vy=clamp(event.vy,-650,650);meta.seq=seq;
  const payload={type:'player-state',player:publicPlayer(meta),serverTs:Date.now()};
  broadcastLocal(meta.roomId,payload);publish(meta.roomId,payload);void persistPlayer(meta).catch(()=>{});
}

function nearestAliveEnemy(world,x,y,targetId){
  if(targetId){const e=world.enemies.find(e=>e.id===targetId&&e.alive);if(e)return e;}
  let best=null,dist=Infinity;
  for(const e of world.enemies){if(!e.alive)continue;const d=Math.hypot(e.x-x,e.y-y);if(d<dist){dist=d;best=e;}}
  return best;
}
function roleCanDamage(role,enemy){
  return enemy.dimension==='both'||enemy.dimension===role;
}
async function handleAttack(meta,event){
  const world=await loadWorld(meta.roomId); if(world.completed||world.failed||meta.hp<=0)return;
  const enemy=nearestAliveEnemy(world,meta.x,meta.y,String(event.targetId||'')); if(!enemy)return;
  const special=Boolean(event.special); const range=special?190:125;
  if(Math.hypot(enemy.x-meta.x,enemy.y-meta.y)>range)return;
  let damage=special?44:25;
  const burst=Date.now()<Number(world.burstUntil||0); if(burst)damage=Math.round(damage*1.65);
  let result='miss';
  if(enemy.shield>0){
    if(meta.role==='shadow'||burst){
      enemy.shield=Math.max(0,enemy.shield-damage);result='shield';
      world.link=Math.min(100,world.link+(special?9:6));
    }
  }else if(roleCanDamage(meta.role,enemy)||burst){
    enemy.hp=Math.max(0,enemy.hp-damage);result='hit';
    world.link=Math.min(100,world.link+(special?8:5));
    if(enemy.hp===0&&enemy.alive){enemy.alive=false;world.kills+=1;world.link=Math.min(100,world.link+12);}
  }
  world.peakLink=Math.max(world.peakLink||0,world.link);
  evaluateCompletion(world);
  await emitWorld(meta.roomId,world,{cause:'attack',by:meta.playerId,targetId:enemy.id,result});
}
function evaluateCompletion(world){
  const level=getLevel(world.levelId),now=Date.now();
  if(level.objectiveType==='survive'&&world.surviveUntil&&now>=world.surviveUntil){world.completed=true;return;}
  if(level.timeLimit&&world.timeLimitUntil&&now>=world.timeLimitUntil&&!world.completed){world.failed=true;return;}
  if(world.enemies.every(e=>!e.alive))world.completed=true;
}
async function handleAction(meta,event){
  const type=String(event.action||event.target||'');
  if(type==='attack')return handleAttack(meta,event);
  if(type==='special')return handleAttack(meta,{...event,special:true});
  const world=await loadWorld(meta.roomId);
  if(type==='link'){
    if(world.link>=100){world.link=0;world.burstUntil=Date.now()+8000;await emitWorld(meta.roomId,world,{cause:'link-burst',by:meta.playerId});}
    return;
  }
  if(type==='tick'){evaluateCompletion(world);await emitWorld(meta.roomId,world,{cause:'tick'});return;}
  if(type==='restart'){
    const reset=defaultWorld(world.levelId);
    for(const [,p] of sockets){if(p.roomId===meta.roomId){const pos=startPosition(p.role);p.x=pos.x;p.y=pos.y;p.hp=100;void persistPlayer(p,true);}}
    await emitWorld(meta.roomId,reset,{cause:'restart'});return;
  }
}
async function handleHurt(meta,event){
  const now=Date.now(),key=`${meta.roomId}:${meta.playerId}`; if(now-(lastHurt.get(key)||0)<450)return;
  lastHurt.set(key,now); const damage=clamp(event.damage||8,1,14); meta.hp=Math.max(0,meta.hp-damage);
  await persistPlayer(meta,true);
  const payload={type:'player-state',player:publicPlayer(meta),serverTs:now,cause:'hurt'};broadcastLocal(meta.roomId,payload);publish(meta.roomId,payload);
  if(meta.hp<=0){
    const roomPlayers=[...sockets.values()].filter(p=>p.roomId===meta.roomId);
    if(roomPlayers.length&&roomPlayers.every(p=>p.hp<=0)){
      const world=await loadWorld(meta.roomId);world.failed=true;await emitWorld(meta.roomId,world,{cause:'team-down'});
    }
  }
}
async function unregister(ws){
  const meta=sockets.get(ws);if(!meta)return;sockets.delete(ws);
  if(meta.roomId){
    const set=localRooms.get(meta.roomId);set?.delete(ws);if(set&&!set.size)localRooms.delete(meta.roomId);
    const payload={type:'peer-left',playerId:meta.playerId,role:meta.role};broadcastLocal(meta.roomId,payload);publish(meta.roomId,payload);
    void persistPlayer(meta,true);void maybeUnsubscribe(meta.roomId);
  }
  if(!redis&&meta.roomId&&meta.role){const s=localSlots.get(meta.roomId);if(s?.[meta.role]===meta.playerId)s[meta.role]=null;}
}

export function attachConnection(ws){
  sockets.set(ws,{playerId:'',name:'',roomId:'',role:null,x:0,y:0,vx:0,vy:0,seq:0,hp:100,maxHp:100});
  ws.on('message',raw=>{
    let event;try{event=JSON.parse(raw.toString());}catch{return;}
    const meta=sockets.get(ws);
    if(event.type==='join'){void handleJoin(ws,event).catch(error=>{console.error('[shadow-link] join failed',error);send(ws,{type:'error',code:'JOIN_FAILED',message:'Could not join room.'});});return;}
    if(!meta?.roomId)return;void refreshSlot(meta).catch(()=>{});
    if(event.type==='move')void handleMove(meta,event);
    else if(event.type==='action')void handleAction(meta,event).catch(e=>console.error('[shadow-link] action error',e));
    else if(event.type==='hurt')void handleHurt(meta,event).catch(()=>{});
    else if(event.type==='ping')send(ws,{type:'pong',clientTs:Number(event.clientTs||0),serverTs:Date.now()});
  });
  const close=()=>void unregister(ws);ws.on('close',close);ws.on('error',close);
}
