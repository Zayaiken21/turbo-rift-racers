const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 4096, pingTimeout: 15000, pingInterval: 8000 });
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname; // 5-file build: index.html is served directly from project root

app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html' }));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'Turbo Rift Racers' }));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const LOBBIES = new Map();
const TRACK_IDS = ['neon','jungle','desert','arctic','sky'];
const VEHICLE_IDS = ['rift','fang','beetle','vanquish','jetback','mammoth','solar','phantom','panther','wagon','hornet','crusher'];
const clean = (v, n = 18) => String(v || '').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, n).trim();
const code = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};
const pubLobby = (lobby) => ({
  code: lobby.code,
  hostId: lobby.hostId,
  settings: lobby.settings,
  race: lobby.race,
  votes: lobby.votes,
  players: [...lobby.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready, vehicle: p.vehicle, map: p.map, online: p.online }))
});
function broadcast(lobby){ io.to(lobby.code).emit('lobby:update', pubLobby(lobby)); }
function makeLobby(socket, payload){
  let c = code(); while (LOBBIES.has(c)) c = code();
  const name = clean(payload.name) || `Racer${Math.floor(Math.random()*900+100)}`;
  const vehicle = VEHICLE_IDS.includes(payload.vehicle) ? payload.vehicle : 'rift';
  const lobby = { code:c, hostId:socket.id, created:Date.now(), lastActive:Date.now(), players:new Map(), settings:{maxRacers:7, aiFill:true, laps:3, balanced:false}, votes:{}, race:null };
  lobby.players.set(socket.id,{id:socket.id,name,vehicle,map:'neon',ready:false,online:true,lastSeen:Date.now(),state:null});
  LOBBIES.set(c,lobby); socket.join(c); socket.data.lobbyCode = c;
  socket.emit('lobby:created', pubLobby(lobby)); broadcast(lobby);
}
function joinLobby(socket, payload){
  const c = clean(payload.code, 6).toUpperCase(); const lobby = LOBBIES.get(c);
  if (!lobby) return socket.emit('lobby:error', 'Lobby not found.');
  if (lobby.players.size >= 7) return socket.emit('lobby:error', 'Lobby is full.');
  const base = clean(payload.name) || `Racer${Math.floor(Math.random()*900+100)}`;
  const names = [...lobby.players.values()].map(p=>p.name.toLowerCase());
  let name = base, k = 2; while(names.includes(name.toLowerCase())) name = `${base}${k++}`;
  const vehicle = VEHICLE_IDS.includes(payload.vehicle) ? payload.vehicle : 'rift';
  lobby.players.set(socket.id,{id:socket.id,name,vehicle,map:'neon',ready:false,online:true,lastSeen:Date.now(),state:null});
  socket.join(c); socket.data.lobbyCode = c; lobby.lastActive = Date.now();
  socket.emit('lobby:joined', pubLobby(lobby)); broadcast(lobby);
}
function lobbyFor(socket){ const c = socket.data.lobbyCode; return c ? LOBBIES.get(c) : null; }
function startRace(lobby){
  const humans = [...lobby.players.values()].filter(p=>p.online).length;
  const target = Math.max(2, Math.min(7, lobby.settings.maxRacers));
  if (humans < 2 && !lobby.settings.aiFill) { io.to(lobby.code).emit('lobby:error','Need another player or AI fill.'); return; }
  const readyPlayers = [...lobby.players.values()].filter(p=>p.online);
  if (readyPlayers.some(p=>!p.ready)) { io.to(lobby.code).emit('lobby:error','Everyone must ready up first.'); return; }
  const picks = readyPlayers.map(p=>TRACK_IDS.includes(p.map)?p.map:'neon');
  while (picks.length < target) picks.push(TRACK_IDS[Math.floor(Math.random()*TRACK_IDS.length)]);
  const chosen = picks[Math.floor(Math.random()*picks.length)];
  const seed = Math.floor(Math.random()*999999);
  lobby.race = { id:`race_${Date.now()}`, track:chosen, seed, laps:lobby.settings.laps || 3, startAt:Date.now()+3600, started:false, finished:false };
  lobby.votes = {};
  for (const p of lobby.players.values()) { p.ready = false; p.state = null; }
  io.to(lobby.code).emit('race:spin', { picks, chosen, seed, startAt:lobby.race.startAt });
  broadcast(lobby);
}
io.on('connection', socket => {
  socket.on('lobby:create', p => makeLobby(socket, p || {}));
  socket.on('lobby:join', p => joinLobby(socket, p || {}));
  socket.on('lobby:leave', () => { const lobby = lobbyFor(socket); if(!lobby)return; lobby.players.delete(socket.id); socket.leave(lobby.code); if(lobby.hostId===socket.id){ const n=[...lobby.players.keys()][0]; lobby.hostId=n||null; } if(lobby.players.size===0) LOBBIES.delete(lobby.code); else broadcast(lobby); socket.data.lobbyCode=null; });
  socket.on('player:update', p => { const l=lobbyFor(socket); if(!l||!l.players.has(socket.id))return; const pl=l.players.get(socket.id); if(p.vehicle && VEHICLE_IDS.includes(p.vehicle)) pl.vehicle=p.vehicle; if(p.map && TRACK_IDS.includes(p.map)) pl.map=p.map; if(typeof p.ready==='boolean') pl.ready=p.ready; l.lastActive=Date.now(); broadcast(l); });
  socket.on('lobby:settings', p => { const l=lobbyFor(socket); if(!l||l.hostId!==socket.id)return; l.settings.maxRacers=Math.max(2,Math.min(7,Number(p.maxRacers)||7)); l.settings.laps=[1,3,5].includes(Number(p.laps))?Number(p.laps):3; l.settings.aiFill=!!p.aiFill; l.settings.balanced=!!p.balanced; broadcast(l); });
  socket.on('race:start', () => { const l=lobbyFor(socket); if(!l||l.hostId!==socket.id)return; if(l.race && Date.now()<l.race.startAt+5000)return; startRace(l); });
  socket.on('race:state', state => { const l=lobbyFor(socket); if(!l||!l.race||!l.players.has(socket.id))return; const p=l.players.get(socket.id); p.state={x:+state.x||0,y:+state.y||0,a:+state.a||0,s:+state.s||0,lap:+state.lap||0,cp:+state.cp||0,boost:!!state.boost,t:Date.now()}; socket.to(l.code).emit('race:remote', {id:socket.id, state:p.state}); });
  socket.on('race:event', ev => { const l=lobbyFor(socket); if(!l||!l.race)return; const type=clean(ev.type,24); if(['wrench','lap','finish','boost'].includes(type)) socket.to(l.code).emit('race:event', {id:socket.id,type,data:ev.data||{}}); });
  socket.on('results:vote', action => { const l=lobbyFor(socket); if(!l)return; const a=clean(action,16); if(!['retry','next','garage','lobby','home'].includes(a))return; l.votes[socket.id]=a; const counts={}; for(const v of Object.values(l.votes)) counts[v]=(counts[v]||0)+1; io.to(l.code).emit('results:votes', counts); const human=[...l.players.values()].filter(p=>p.online).length; if((counts[a]||0)>=Math.ceil(human/2)){ if(a==='retry'&&l.race){ l.race.startAt=Date.now()+2800; io.to(l.code).emit('race:restart',{track:l.race.track,seed:l.race.seed,laps:l.race.laps,startAt:l.race.startAt}); } if(a==='next'){ for(const p of l.players.values()) p.ready=true; startRace(l); } if(a==='garage') io.to(l.code).emit('scene:garage'); if(a==='lobby') io.to(l.code).emit('scene:lobby'); l.votes={}; broadcast(l); } });
  socket.on('disconnect', () => { const l=lobbyFor(socket); if(!l)return; const p=l.players.get(socket.id); if(p){ p.online=false; p.lastSeen=Date.now(); } if(l.hostId===socket.id){ const n=[...l.players.values()].find(x=>x.online); l.hostId=n?n.id:l.hostId; } broadcast(l); });
});
setInterval(()=>{ const now=Date.now(); for(const [c,l] of LOBBIES){ for(const [id,p] of l.players){ if(!p.online && now-p.lastSeen>30000) l.players.delete(id); } if(l.players.size===0 || now-l.lastActive>1000*60*60*3) LOBBIES.delete(c); else broadcast(l); } },15000);
server.listen(PORT, '0.0.0.0', () => console.log(`Turbo Rift Racers listening on ${PORT}`));
