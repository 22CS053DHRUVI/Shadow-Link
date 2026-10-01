import { LEVELS, CHAPTERS, getLevel, getChapter } from '../shared/levels.js';

const WORLD={width:1200,height:700};
const PLAYER_RADIUS=22, NET_MS=50, PING_MS=2000;
const $=s=>document.querySelector(s);
const els={
  home:$('#homeScreen'),levels:$('#levelsScreen'),room:$('#roomScreen'),game:$('#gameScreen'),
  continueBtn:$('#continueBtn'),levelSelectBtn:$('#levelSelectBtn'),chapterTabs:$('#chapterTabs'),levelGrid:$('#levelGrid'),
  progressLabel:$('#progressLabel'),roomChapter:$('#roomChapter'),roomLevelTitle:$('#roomLevelTitle'),
  missionNumber:$('#missionNumber'),missionTwist:$('#missionTwist'),missionName:$('#missionName'),missionIntro:$('#missionIntro'),difficultyStars:$('#difficultyStars'),
  playerName:$('#playerName'),createRoom:$('#createRoom'),joinRoom:$('#joinRoom'),roomCode:$('#roomCode'),lobbyError:$('#lobbyError'),
  hudLevel:$('#hudLevel'),hudLevelName:$('#hudLevelName'),objective:$('#objectiveText'),linkPercent:$('#linkPercent'),linkFill:$('#linkFill'),
  roleBadge:$('#roleBadge'),latency:$('#latency'),leave:$('#leaveGame'),selfHpFill:$('#selfHpFill'),selfHpText:$('#selfHpText'),
  partnerHpFill:$('#partnerHpFill'),partnerHpText:$('#partnerHpText'),roomLabel:$('#roomLabel'),shareCode:$('#shareCode'),
  stage:$('#gameStage'),canvas:$('#gameCanvas'),waiting:$('#waitingOverlay'),intro:$('#introOverlay'),
  introChapter:$('#introChapter'),introLevel:$('#introLevel'),introTitle:$('#introTitle'),introText:$('#introText'),introCountdown:$('#introCountdown'),
  result:$('#resultOverlay'),resultTitle:$('#resultTitle'),resultStars:$('#resultStars'),resultTime:$('#resultTime'),resultKills:$('#resultKills'),resultLink:$('#resultLink'),
  failed:$('#failedOverlay'),next:$('#nextLevelBtn'),replay:$('#replayBtn'),retry:$('#retryBtn'),toast:$('#toast'),
  joystick:$('#joystick'),knob:$('#joystickKnob'),attack:$('#attackBtn'),special:$('#specialBtn'),dash:$('#dashBtn'),link:$('#linkBtn')
};
const ctx=els.canvas.getContext('2d');

const state={
  selectedLevel:Number(localStorage.getItem('shadow-link:selected-level')||1),
  unlocked:Number(localStorage.getItem('shadow-link:unlocked')||1),
  stars:JSON.parse(localStorage.getItem('shadow-link:stars')||'{}'),
  chapter:1, socket:null,roomId:'',playerId:sessionStorage.getItem('shadow-link:pid')||crypto.randomUUID(),
  name:sessionStorage.getItem('shadow-link:name')||'',role:null,connected:false,joined:false,peer:null,peerConnected:false,
  world:null,local:{x:125,y:250,vx:0,vy:0,seq:0,hp:100,maxHp:100},remote:{x:125,y:450,targetX:125,targetY:450,hp:100,maxHp:100},
  keys:new Set(),stick:{x:0,y:0,pointerId:null},lastFrame:performance.now(),lastNet:0,lastSentX:NaN,lastSentY:NaN,
  dashUntil:0,dashCooldown:0,specialCooldown:0,attackCooldown:0,lastTick:0,lastHurt:0,introPlayed:false,missionStartedAt:0,toastTimer:null,reconnect:null,reconnectDelay:400,
  burstPeak:0,resultShown:false,enemyHitFx:new Map(),particles:[],shake:0
};
sessionStorage.setItem('shadow-link:pid',state.playerId);els.playerName.value=state.name;

function show(screen){
  for(const el of [els.home,els.levels,els.room,els.game])el.classList.add('hidden');
  screen.classList.remove('hidden');
}
function level(){return getLevel(state.selectedLevel)}
function pad(n){return String(n).padStart(2,'0')}
function chapterRoman(n){return['I','II','III','IV'][n-1]||n}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function fmtTime(ms){const s=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function makeRoomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=new Uint8Array(5);crypto.getRandomValues(bytes);return Array.from(bytes,b=>chars[b%chars.length]).join('')}
function wsUrl(){const protocol=location.protocol==='https:'?'wss:':'ws:';return `${protocol}//${location.host}/api/ws`}
function saveProgress(){
  localStorage.setItem('shadow-link:selected-level',String(state.selectedLevel));
  localStorage.setItem('shadow-link:unlocked',String(state.unlocked));
  localStorage.setItem('shadow-link:stars',JSON.stringify(state.stars));
}
function toast(message){
  clearTimeout(state.toastTimer);els.toast.textContent=message;els.toast.classList.add('show');
  state.toastTimer=setTimeout(()=>els.toast.classList.remove('show'),1700);
}

function renderChapters(){
  els.chapterTabs.innerHTML='';
  for(const c of CHAPTERS){
    const b=document.createElement('button');b.textContent=`CHAPTER ${chapterRoman(c.id)} · ${c.name}`;
    b.classList.toggle('active',state.chapter===c.id);b.onclick=()=>{state.chapter=c.id;renderChapters();renderLevels();};els.chapterTabs.appendChild(b);
  }
}
function renderLevels(){
  els.levelGrid.innerHTML='';
  const items=LEVELS.filter(l=>l.chapter===state.chapter);
  for(const l of items){
    const locked=l.id>state.unlocked,stars=Number(state.stars[l.id]||0);
    const b=document.createElement('button');b.className=`level-card ${locked?'locked':''}`;b.disabled=locked;
    b.innerHTML=`<span class="num">LEVEL ${pad(l.id)}</span><span class="stars">${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</span><h3>${l.name}</h3><p>${l.twist}</p>`;
    b.onclick=()=>selectLevel(l.id);els.levelGrid.appendChild(b);
  }
  els.progressLabel.textContent=`${Math.min(state.unlocked,20)} / 20`;
}
function selectLevel(id){
  state.selectedLevel=id;state.chapter=getLevel(id).chapter;saveProgress();renderRoom();show(els.room);
}
function renderRoom(){
  const l=level(),c=getChapter(l.chapter);
  els.roomChapter.textContent=`CHAPTER ${chapterRoman(c.id)} · ${c.name}`;els.roomLevelTitle.textContent=`Level ${l.id} · ${l.name}`;
  els.missionNumber.textContent=pad(l.id);els.missionTwist.textContent=l.twist.toUpperCase();els.missionName.textContent=l.name;els.missionIntro.textContent=l.intro;
  els.difficultyStars.textContent='★'.repeat(l.difficulty)+'☆'.repeat(5-l.difficulty);els.lobbyError.textContent='';
}
els.levelSelectBtn.onclick=()=>{state.chapter=getLevel(state.selectedLevel).chapter;renderChapters();renderLevels();show(els.levels)};
els.continueBtn.onclick=()=>selectLevel(Math.min(state.unlocked,20));
document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>show($('#'+b.dataset.back)));
renderChapters();renderLevels();

function beginRoom(roomId){
  state.name=els.playerName.value.trim().replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,16)||'Guardian';sessionStorage.setItem('shadow-link:name',state.name);
  state.roomId=roomId;state.resultShown=false;state.introPlayed=false;els.lobbyError.textContent='';show(els.game);connect();
}
els.createRoom.onclick=()=>beginRoom(makeRoomCode());
els.joinRoom.onclick=()=>{const r=els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);if(r.length<4){els.lobbyError.textContent='Enter a valid 4–6 character room code.';return;}beginRoom(r)};
els.roomCode.oninput=()=>els.roomCode.value=els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);

function connect(){
  clearTimeout(state.reconnect);state.connected=false;state.joined=false;
  const ws=new WebSocket(wsUrl());state.socket=ws;
  ws.onopen=()=>{if(ws!==state.socket)return;state.connected=true;state.reconnectDelay=400;send({type:'join',roomId:state.roomId,playerId:state.playerId,name:state.name,levelId:state.selectedLevel});ping();};
  ws.onmessage=e=>{if(ws!==state.socket)return;let msg;try{msg=JSON.parse(e.data)}catch{return}handle(msg)};
  ws.onclose=()=>{if(ws!==state.socket)return;state.connected=false;state.joined=false;updateHud();if(state.roomId){state.reconnect=setTimeout(connect,state.reconnectDelay);state.reconnectDelay=Math.min(5000,state.reconnectDelay*1.7)}};
  ws.onerror=()=>{state.connected=false;updateHud()};
}
function send(o){if(state.socket?.readyState===WebSocket.OPEN){state.socket.send(JSON.stringify(o));return true}return false}
function ping(){if(!state.roomId)return;send({type:'ping',clientTs:Date.now()});setTimeout(ping,PING_MS)}

function handle(msg){
  if(msg.type==='joined'){
    state.joined=true;state.role=msg.role;state.world=msg.world;state.selectedLevel=Number(msg.world?.levelId||state.selectedLevel);saveProgress();
    Object.assign(state.local,{x:msg.self.x,y:msg.self.y,seq:msg.self.seq||0,hp:msg.self.hp??100,maxHp:msg.self.maxHp??100});
    const peer=msg.players?.find(p=>p.playerId!==state.playerId);setPeer(peer);state.missionStartedAt=Number(state.world?.startedAt||Date.now());
    configureHud();updateHud();if(state.peerConnected)startIntro();return;
  }
  if(msg.type==='peer-joined'&&msg.player?.playerId!==state.playerId){setPeer(msg.player);toast(`${msg.player.name||'Partner'} linked in`);if(state.joined)startIntro();return}
  if(msg.type==='peer-left'&&state.peer?.playerId===msg.playerId){state.peerConnected=false;els.waiting.classList.remove('hidden');toast('Partner disconnected');return}
  if(msg.type==='player-state'){
    const p=msg.player;if(!p)return;
    if(p.playerId===state.playerId){state.local.hp=p.hp??state.local.hp;state.local.maxHp=p.maxHp??100}
    else{if(!state.peer||state.peer.playerId!==p.playerId)setPeer(p);state.remote.targetX=p.x;state.remote.targetY=p.y;state.remote.hp=p.hp??100;state.remote.maxHp=p.maxHp??100;state.peerConnected=true;els.waiting.classList.add('hidden')}
    updateHud();return;
  }
  if(msg.type==='world-state'){
    const old=state.world;state.world=msg.world;state.selectedLevel=Number(msg.world?.levelId||state.selectedLevel);
    if(msg.cause==='attack'&&msg.targetId)state.enemyHitFx.set(msg.targetId,performance.now());
    if(msg.cause==='link-burst')toast('LINK BURST — dimensions merged!');
    if(old&&!old.completed&&state.world.completed)completeMission();
    if(old&&!old.failed&&state.world.failed)failMission();
    updateHud();return;
  }
  if(msg.type==='pong'){els.latency.textContent=`${Math.max(0,Date.now()-Number(msg.clientTs||Date.now()))} ms`;return}
  if(msg.type==='error'){state.roomId='';state.socket?.close();show(els.room);els.lobbyError.textContent=msg.message||'Could not join room.'}
}
function setPeer(p){
  state.peer=p||null;state.peerConnected=Boolean(p);
  if(p){Object.assign(state.remote,{x:p.x,targetX:p.x,y:p.y,targetY:p.y,hp:p.hp??100,maxHp:p.maxHp??100});els.waiting.classList.add('hidden')}
  else els.waiting.classList.remove('hidden');updateHud();
}
function configureHud(){
  const l=getLevel(state.selectedLevel);els.hudLevel.textContent=pad(l.id);els.hudLevelName.textContent=l.name;els.objective.textContent=l.objectiveText;
  els.roomLabel.textContent=state.roomId;els.shareCode.textContent=state.roomId;els.roleBadge.textContent=(state.role||'light').toUpperCase();
  els.roleBadge.style.color=state.role==='light'?'#ffd66f':'#c5b7ff';
}
function updateHud(){
  const link=clamp(Number(state.world?.link||0),0,100);state.burstPeak=Math.max(state.burstPeak,Number(state.world?.peakLink||0));
  els.linkFill.style.width=`${link}%`;els.linkPercent.textContent=`${Math.round(link)}%`;els.link.classList.toggle('ready',link>=100);
  els.selfHpFill.style.width=`${clamp(state.local.hp,0,100)}%`;els.selfHpText.textContent=Math.round(state.local.hp);
  els.partnerHpFill.style.width=`${clamp(state.remote.hp||0,0,100)}%`;els.partnerHpText.textContent=state.peerConnected?Math.round(state.remote.hp):'--';
}
function startIntro(){
  if(state.introPlayed||!state.peerConnected)return;state.introPlayed=true;els.waiting.classList.add('hidden');
  const l=getLevel(state.selectedLevel),c=getChapter(l.chapter);els.introChapter.textContent=`CHAPTER ${chapterRoman(c.id)} · ${c.name}`;els.introLevel.textContent=`LEVEL ${pad(l.id)}`;els.introTitle.textContent=l.name;els.introText.textContent=l.intro;els.intro.classList.remove('hidden');
  let n=3;els.introCountdown.textContent=n;const timer=setInterval(()=>{n--;els.introCountdown.textContent=n>0?n:'LINK!';if(n<0){clearInterval(timer);els.intro.classList.add('hidden')}},700);
}

els.leave.onclick=()=>leaveToLevels();
function leaveToLevels(){
  state.roomId='';state.socket?.close();state.socket=null;state.peer=null;state.peerConnected=false;state.world=null;state.joined=false;
  state.chapter=getLevel(state.selectedLevel).chapter;renderChapters();renderLevels();show(els.levels);
}
els.replay.onclick=els.retry.onclick=()=>{els.result.classList.add('hidden');els.failed.classList.add('hidden');state.resultShown=false;send({type:'action',action:'restart'})};
els.next.onclick=()=>{const next=Math.min(20,state.selectedLevel+1);leaveToLevels();selectLevel(next)};

function completeMission(){
  if(state.resultShown)return;state.resultShown=true;
  const l=getLevel(state.selectedLevel),elapsed=Date.now()-state.missionStartedAt;
  const fast=elapsed<=l.targetTime*1000,healthy=state.local.hp>=45&&state.remote.hp>=45;const stars=1+Number(fast)+Number(healthy);
  state.stars[l.id]=Math.max(Number(state.stars[l.id]||0),stars);state.unlocked=Math.max(state.unlocked,Math.min(20,l.id+1));saveProgress();
  els.resultTitle.textContent=`${l.name} cleared`;els.resultStars.textContent='★'.repeat(stars)+'☆'.repeat(3-stars);els.resultTime.textContent=fmtTime(elapsed);
  els.resultKills.textContent=state.world?.kills||0;els.resultLink.textContent=`${Math.round(state.world?.peakLink||state.burstPeak)}%`;els.next.textContent=l.id===20?'Campaign complete':'Next mission';els.result.classList.remove('hidden');
}
function failMission(){if(state.resultShown)return;state.resultShown=true;els.failed.classList.remove('hidden')}

function inputVector(){
  let x=state.stick.x,y=state.stick.y;if(state.keys.has('a'))x--;if(state.keys.has('d'))x++;if(state.keys.has('w'))y--;if(state.keys.has('s'))y++;
  const m=Math.hypot(x,y);return m>1?{x:x/m,y:y/m}:{x,y};
}
function updatePlayer(dt,now){
  if(!state.joined||state.world?.completed||state.world?.failed||state.local.hp<=0){state.local.vx=state.local.vy=0;return}
  const v=inputVector(),speed=now<state.dashUntil?480:235;state.local.vx=v.x*speed;state.local.vy=v.y*speed;
  state.local.x=clamp(state.local.x+state.local.vx*dt,35,WORLD.width-35);state.local.y=clamp(state.local.y+state.local.vy*dt,35,WORLD.height-35);
}
function networkMove(now){
  if(!state.joined||now-state.lastNet<NET_MS)return;
  const moved=!Number.isFinite(state.lastSentX)||Math.hypot(state.local.x-state.lastSentX,state.local.y-state.lastSentY)>.4||Math.abs(state.local.vx)+Math.abs(state.local.vy)>1;
  if(!moved&&now-state.lastNet<260)return;state.lastNet=now;state.lastSentX=state.local.x;state.lastSentY=state.local.y;state.local.seq++;
  send({type:'move',x:+state.local.x.toFixed(1),y:+state.local.y.toFixed(1),vx:+state.local.vx.toFixed(1),vy:+state.local.vy.toFixed(1),seq:state.local.seq});
}
function triggerDash(){const now=performance.now();if(now<state.dashCooldown||state.local.hp<=0)return;state.dashUntil=now+180;state.dashCooldown=now+780}
function nearestEnemy(range=220){
  let best=null,d=range;for(const e of state.world?.enemies||[]){if(!e.alive)continue;const p=enemyDisplayPos(e,performance.now());const x=Math.hypot(p.x-state.local.x,p.y-state.local.y);if(x<d){d=x;best=e}}return best;
}
function attack(special=false){
  const now=performance.now(),cool=special?900:330;if(now<(special?state.specialCooldown:state.attackCooldown)||state.local.hp<=0)return;
  const target=nearestEnemy(special?250:175);if(!target){toast('Move closer to an enemy');return}
  if(special)state.specialCooldown=now+cool;else state.attackCooldown=now+cool;
  state.shake=special?7:3;burstParticles(target.x,target.y,special?12:6);send({type:'action',action:special?'special':'attack',targetId:target.id});
}
function useLink(){if(Number(state.world?.link||0)<100){toast(`Link energy ${Math.round(state.world?.link||0)}%`);return}send({type:'action',action:'link'})}
els.attack.onpointerdown=e=>{e.preventDefault();attack(false)};els.special.onpointerdown=e=>{e.preventDefault();attack(true)};els.dash.onpointerdown=e=>{e.preventDefault();triggerDash()};els.link.onpointerdown=e=>{e.preventDefault();useLink()};

function enemyDisplayPos(e,time){
  const amp=e.boss?22:12,phase=e.id.split('').reduce((a,c)=>a+c.charCodeAt(0),0);return{x:e.x+Math.sin(time/900+phase)*amp,y:e.y+Math.cos(time/1100+phase)*amp};
}
function enemyDanger(now){
  if(!state.world||state.local.hp<=0||now-state.lastHurt<520)return;
  for(const e of state.world.enemies||[]){if(!e.alive)continue;const p=enemyDisplayPos(e,now);if(Math.hypot(p.x-state.local.x,p.y-state.local.y)<(e.boss?72:48)){state.lastHurt=now;send({type:'hurt',damage:e.boss?12:7});state.shake=9;return}}
  for(const h of state.world.hazards||[]){const active=((now+h.phase)%2600)<900;if(active&&Math.hypot(h.x-state.local.x,h.y-state.local.y)<h.radius){state.lastHurt=now;send({type:'hurt',damage:9});state.shake=7;return}}
}
function worldTick(now){if(!state.joined||now-state.lastTick<1000)return;state.lastTick=now;send({type:'action',action:'tick'})}
function updateRemote(dt){const b=1-Math.pow(.001,dt);state.remote.x+=(state.remote.targetX-state.remote.x)*b;state.remote.y+=(state.remote.targetY-state.remote.y)*b}

function themeColors(theme){
  if(theme==='ruins')return['#171016','#321922','#ff875f','#865ee8'];
  if(theme==='rift')return['#0b1020','#151d38','#5ad4ff','#9a78ff'];
  if(theme==='collapse')return['#12080d','#2a0c1e','#ff5c6f','#b45cff'];
  return['#16141a','#28201c','#ffd16c','#9478ee'];
}
function draw(now){
  const l=getLevel(state.selectedLevel),colors=themeColors(l.theme),burst=now<Number(state.world?.burstUntil||0);
  ctx.save();if(state.shake>0){ctx.translate((Math.random()-.5)*state.shake,(Math.random()-.5)*state.shake);state.shake*=.82}
  const g=ctx.createLinearGradient(0,0,WORLD.width,WORLD.height);g.addColorStop(0,colors[0]);g.addColorStop(1,colors[1]);ctx.fillStyle=g;ctx.fillRect(0,0,WORLD.width,WORLD.height);
  drawArena(colors,burst,now);drawHazards(now,colors);drawEnemies(now,colors,burst);drawPartner(colors);drawPlayer(colors,burst);drawParticles();drawMissionClock(now,l);ctx.restore();
}
function drawArena(colors,burst,now){
  ctx.strokeStyle=burst?'rgba(255,240,190,.14)':'rgba(255,255,255,.045)';ctx.lineWidth=1;
  for(let x=30;x<WORLD.width;x+=60){ctx.beginPath();ctx.moveTo(x,20);ctx.lineTo(x,WORLD.height-20);ctx.stroke()}
  for(let y=30;y<WORLD.height;y+=60){ctx.beginPath();ctx.moveTo(20,y);ctx.lineTo(WORLD.width-20,y);ctx.stroke()}
  ctx.strokeStyle=colors[2]+'33';ctx.lineWidth=4;ctx.strokeRect(18,18,WORLD.width-36,WORLD.height-36);
  if(getLevel(state.selectedLevel).darknessPulse&&Math.floor(now/4000)%2===1){const grad=ctx.createRadialGradient(state.local.x,state.local.y,80,state.local.x,state.local.y,320);grad.addColorStop(0,'rgba(0,0,0,0)');grad.addColorStop(1,'rgba(0,0,0,.83)');ctx.fillStyle=grad;ctx.fillRect(0,0,WORLD.width,WORLD.height)}
  if(burst){ctx.fillStyle='rgba(170,145,255,.07)';ctx.fillRect(0,0,WORLD.width,WORLD.height)}
}
function drawHazards(now,colors){
  for(const h of state.world?.hazards||[]){const active=((now+h.phase)%2600)<900;ctx.save();ctx.strokeStyle=active?'rgba(255,90,110,.75)':colors[3]+'44';ctx.fillStyle=active?'rgba(255,75,95,.10)':'rgba(155,125,255,.035)';ctx.lineWidth=active?4:2;ctx.beginPath();ctx.arc(h.x,h.y,h.radius+(active?Math.sin(now/80)*5:0),0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore()}
}
function enemyColor(e,colors){if(e.kind.includes('shade')||e.kind==='hunter')return'#a98cff';if(e.kind==='crawler')return'#6ee3c0';if(e.boss)return'#ff6376';return colors[2]}
function drawEnemies(now,colors,burst){
  for(const e of state.world?.enemies||[]){if(!e.alive)continue;const p=enemyDisplayPos(e,now),r=e.boss?42:e.kind==='brute'?31:25,hit=now-(state.enemyHitFx.get(e.id)||0)<130;
    ctx.save();ctx.translate(p.x,p.y);ctx.shadowBlur=hit?28:12;ctx.shadowColor=enemyColor(e,colors);ctx.fillStyle=hit?'#fff':enemyColor(e,colors);ctx.globalAlpha=(e.dimension!=='both'&&e.dimension!==state.role&&!burst)?.32:1;
    ctx.beginPath();if(e.kind==='crawler'){ctx.moveTo(0,-r);ctx.lineTo(r,r);ctx.lineTo(-r,r);ctx.closePath()}else ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    if(e.shield>0){ctx.strokeStyle='#c8b9ff';ctx.lineWidth=4;ctx.setLineDash([6,5]);ctx.beginPath();ctx.arc(0,0,r+9,0,Math.PI*2);ctx.stroke();ctx.setLineDash([])}
    ctx.restore();
    const width=e.boss?150:74;ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(p.x-width/2,p.y-r-19,width,6);ctx.fillStyle=e.shield>0?'#a78cff':'#ff687b';ctx.fillRect(p.x-width/2,p.y-r-19,width*(e.hp/e.maxHp),6);
    if(e.boss){ctx.fillStyle='#fff';ctx.font='800 12px system-ui';ctx.textAlign='center';ctx.fillText(e.kind.replaceAll('-',' ').toUpperCase(),p.x,p.y-r-27)}
  }
}
function drawPlayer(colors,burst){
  const light=state.role==='light',c=light?'#ffda73':'#a58cff';ctx.save();ctx.translate(state.local.x,state.local.y);ctx.shadowBlur=burst?34:18;ctx.shadowColor=c;ctx.fillStyle=state.local.hp>0?c:'#596173';ctx.beginPath();ctx.arc(0,0,PLAYER_RADIUS,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-10,8);ctx.lineTo(13,-10);ctx.stroke();ctx.fillStyle='#fff';ctx.font='900 11px system-ui';ctx.textAlign='center';ctx.fillText('YOU',0,-34);ctx.restore();
}
function drawPartner(colors){
  if(!state.peerConnected)return;ctx.save();ctx.translate(state.remote.x,state.remote.y);ctx.globalAlpha=.65;ctx.fillStyle=state.role==='light'?'#a58cff':'#ffda73';ctx.beginPath();ctx.arc(0,0,19,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.45)';ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(0,0,27,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fff';ctx.font='800 10px system-ui';ctx.textAlign='center';ctx.fillText(state.peer?.name||'PARTNER',0,-33);ctx.restore();
}
function burstParticles(x,y,n){for(let i=0;i<n;i++)state.particles.push({x,y,vx:(Math.random()-.5)*180,vy:(Math.random()-.5)*180,life:1})}
function drawParticles(){for(const p of state.particles){p.x+=p.vx*.016;p.y+=p.vy*.016;p.life-=.035;ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle='#fff3bd';ctx.fillRect(p.x,p.y,4,4)}ctx.globalAlpha=1;state.particles=state.particles.filter(p=>p.life>0)}
function drawMissionClock(now,l){
  let text='';if(l.surviveSeconds&&state.world?.surviveUntil)text=`SURVIVE ${Math.max(0,Math.ceil((state.world.surviveUntil-Date.now())/1000))}s`;if(l.timeLimit&&state.world?.timeLimitUntil)text=`ESCAPE ${Math.max(0,Math.ceil((state.world.timeLimitUntil-Date.now())/1000))}s`;
  if(text){ctx.fillStyle='rgba(4,6,12,.7)';ctx.fillRect(WORLD.width/2-80,28,160,34);ctx.fillStyle='#fff';ctx.font='900 14px system-ui';ctx.textAlign='center';ctx.fillText(text,WORLD.width/2,50)}
}

function updateStick(e){const r=els.joystick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,max=r.width*.30;let x=e.clientX-cx,y=e.clientY-cy,m=Math.hypot(x,y)||1;if(m>max){x=x/m*max;y=y/m*max}state.stick.x=x/max;state.stick.y=y/max;els.knob.style.transform=`translate(${x}px,${y}px)`}
els.joystick.onpointerdown=e=>{state.stick.pointerId=e.pointerId;els.joystick.setPointerCapture(e.pointerId);updateStick(e)};
els.joystick.onpointermove=e=>{if(state.stick.pointerId===e.pointerId)updateStick(e)};
function releaseStick(e){if(state.stick.pointerId!==e.pointerId)return;state.stick.pointerId=null;state.stick.x=state.stick.y=0;els.knob.style.transform='translate(0,0)'}
els.joystick.onpointerup=releaseStick;els.joystick.onpointercancel=releaseStick;

function key(k){k=k.toLowerCase();return({arrowup:'w',arrowdown:'s',arrowleft:'a',arrowright:'d'})[k]||k}
addEventListener('keydown',e=>{if(document.activeElement?.tagName==='INPUT')return;const k=key(e.key);if(['w','a','s','d'].includes(k)){state.keys.add(k);e.preventDefault()}if(k==='j')attack(false);if(k==='k')attack(true);if(k==='l')useLink();if(k==='shift')triggerDash()});
addEventListener('keyup',e=>state.keys.delete(key(e.key)));addEventListener('blur',()=>state.keys.clear());

function loop(now){
  const dt=Math.min(.05,(now-state.lastFrame)/1000);state.lastFrame=now;updatePlayer(dt,now);updateRemote(dt);networkMove(now);enemyDanger(now);worldTick(now);draw(now);requestAnimationFrame(loop)
}
requestAnimationFrame(loop);
updateHud();
