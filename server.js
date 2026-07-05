const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'Turbo Rift Racers' }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const MAX_LOBBIES = 200;
const lobbies = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const maps = ['neon','jungle','desert','arctic','sky'];
const vehicles = ['rift','fang','beetle','vanquish','jetback','mammoth','solar','phantom','panther','wagon','hornet','crusher'];
function code(){ let c=''; do{ c=''; for(let i=0;i<5;i++) c+=alphabet[Math.floor(Math.random()*alphabet.length)]; }while(lobbies.has(c)); return c; }
function cleanName(n){ return String(n||'Racer').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,14)||('Racer'+Math.floor(Math.random()*900+100)); }
function cleanVehicle(v){ return vehicles.includes(v) ? v : 'rift'; }
function packLobby(l){ return { code:l.code, hostId:l.hostId, maxRacers:l.maxRacers, aiFill:l.aiFill, phase:l.phase, track:l.track, players:[...l.players.values()].map(p=>({id:p.id,name:p.name,vehicle:p.vehicle,ready:p.ready,mapVote:p.mapVote||'neon'})), votes:l.votes||{}, spin:l.spin||null }; }
function broadcastLobby(l){ io.to(l.code).emit('lobbyState', packLobby(l)); }
function prune(){ const now=Date.now(); for(const [c,l] of lobbies){ if(l.players.size===0 || now-l.touched>1000*60*45) lobbies.delete(c); } }
setInterval(prune, 30000);

io.on('connection', socket => {
  socket.data.lobbyCode = null;
  socket.on('createLobby', data => {
    if(lobbies.size >= MAX_LOBBIES) return socket.emit('toast','Server is busy. Try again soon.');
    const l = { code: code(), hostId: socket.id, maxRacers: Math.min(7, Math.max(2, Number(data?.maxRacers)||7)), aiFill: data?.aiFill !== false, phase:'lobby', track:'neon', players:new Map(), states:new Map(), votes:{}, touched:Date.now() };
    const p = { id:socket.id, name:cleanName(data?.name), vehicle:cleanVehicle(data?.vehicle), ready:false, mapVote:'neon', lastSeen:Date.now() };
    l.players.set(socket.id,p); lobbies.set(l.code,l); socket.join(l.code); socket.data.lobbyCode=l.code; socket.emit('joinedLobby', { code:l.code, id:socket.id }); broadcastLobby(l);
  });
  socket.on('joinLobby', data => {
    const c = String(data?.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); const l = lobbies.get(c);
    if(!l) return socket.emit('toast','Lobby not found.');
    if(l.players.size >= l.maxRacers) return socket.emit('toast','Lobby is full.');
    const used = new Set([...l.players.values()].map(p=>p.name.toLowerCase())); let name=cleanName(data?.name), base=name, i=2; while(used.has(name.toLowerCase())) name=(base+i++).slice(0,14);
    l.players.set(socket.id,{ id:socket.id, name, vehicle:cleanVehicle(data?.vehicle), ready:false, mapVote:'neon', lastSeen:Date.now() });
    l.touched=Date.now(); socket.join(c); socket.data.lobbyCode=c; socket.emit('joinedLobby', { code:c, id:socket.id }); broadcastLobby(l);
  });
  socket.on('leaveLobby', ()=>{ const l=lobbies.get(socket.data.lobbyCode); if(!l) return; l.players.delete(socket.id); socket.leave(l.code); if(l.hostId===socket.id) l.hostId=l.players.keys().next().value || null; if(!l.hostId) lobbies.delete(l.code); else broadcastLobby(l); socket.data.lobbyCode=null; });
  socket.on('lobbySettings', data=>{ const l=lobbies.get(socket.data.lobbyCode); if(!l || l.hostId!==socket.id) return; l.maxRacers=Math.min(7,Math.max(2,Number(data?.maxRacers)||l.maxRacers)); l.aiFill=!!data?.aiFill; l.touched=Date.now(); broadcastLobby(l); });
  socket.on('playerUpdate', data=>{ const l=lobbies.get(socket.data.lobbyCode); if(!l) return; const p=l.players.get(socket.id); if(!p) return; if('ready' in data) p.ready=!!data.ready; if(data.vehicle) p.vehicle=cleanVehicle(data.vehicle); if(data.mapVote && maps.includes(data.mapVote)) p.mapVote=data.mapVote; p.lastSeen=Date.now(); l.touched=Date.now(); broadcastLobby(l); tryStartVote(l); });
  function tryStartVote(l){ if(l.phase!=='lobby') return; const humans=[...l.players.values()]; const canRace = humans.length>=2 || (humans.length>=1 && l.aiFill); if(!canRace) return; if(!humans.every(p=>p.ready)) return; l.phase='mapVote'; const choices=humans.map(p=>p.mapVote||'neon'); while(l.aiFill && choices.length<l.maxRacers) choices.push(maps[Math.floor(Math.random()*maps.length)]); const picked=choices[Math.floor(Math.random()*choices.length)] || 'neon'; l.track=picked; l.spin={ choices, picked, seed: Math.floor(Math.random()*999999), startedAt:Date.now()+500 }; broadcastLobby(l); setTimeout(()=>{ if(lobbies.get(l.code)===l){ l.phase='race'; l.startedAt=Date.now()+3600; l.states.clear(); io.to(l.code).emit('raceStart', { track:l.track, startAt:l.startedAt, racers:[...l.players.values()].map(p=>({id:p.id,name:p.name,vehicle:p.vehicle})), maxRacers:l.maxRacers, aiFill:l.aiFill }); broadcastLobby(l); } }, 4700); }
  socket.on('raceState', data=>{ const l=lobbies.get(socket.data.lobbyCode); if(!l || l.phase!=='race') return; const p=l.players.get(socket.id); if(!p) return; l.states.set(socket.id,{ id:socket.id,x:+data.x||0,y:+data.y||0,a:+data.a||0,s:+data.s||0,lap:+data.lap||1,cp:+data.cp||0,boost:!!data.boost,finished:!!data.finished,t:Date.now() }); });
  socket.on('raceFinish', data=>{ const l=lobbies.get(socket.data.lobbyCode); if(!l) return; io.to(l.code).emit('playerFinished',{ id:socket.id, time:+data?.time||0 }); });
  socket.on('resultVote', data=>{ const l=lobbies.get(socket.data.lobbyCode); if(!l) return; const v=['retry','next','garage','lobby'].includes(data?.vote)?data.vote:'lobby'; l.votes[socket.id]=v; const counts={}; Object.values(l.votes).forEach(x=>counts[x]=(counts[x]||0)+1); io.to(l.code).emit('resultVotes',counts); const need=Math.floor(l.players.size/2)+1; const winner=Object.keys(counts).find(k=>counts[k]>=need); if(winner){ l.votes={}; if(winner==='garage'){ l.phase='lobby'; [...l.players.values()].forEach(p=>p.ready=false); broadcastLobby(l); io.to(l.code).emit('goGarageKeepLobby'); } else if(winner==='lobby'){ l.phase='lobby'; [...l.players.values()].forEach(p=>p.ready=false); broadcastLobby(l); } else { l.phase='race'; if(winner==='next') l.track=maps[(maps.indexOf(l.track)+1)%maps.length]; l.startedAt=Date.now()+3200; io.to(l.code).emit('raceStart',{ track:l.track, startAt:l.startedAt, racers:[...l.players.values()].map(p=>({id:p.id,name:p.name,vehicle:p.vehicle})), maxRacers:l.maxRacers, aiFill:l.aiFill }); broadcastLobby(l); } } });
  socket.on('disconnect', ()=>{ const l=lobbies.get(socket.data.lobbyCode); if(!l) return; const p=l.players.get(socket.id); if(p) p.disconnectedAt=Date.now(); setTimeout(()=>{ const cur=lobbies.get(l.code); if(!cur || cur.players.has(socket.id)===false) return; cur.players.delete(socket.id); if(cur.hostId===socket.id) cur.hostId=cur.players.keys().next().value||null; if(!cur.hostId) lobbies.delete(cur.code); else broadcastLobby(cur); }, 12000); });
});
setInterval(()=>{ for(const l of lobbies.values()){ if(l.phase==='race'){ const states=[...l.states.values()]; if(states.length) io.to(l.code).volatile.emit('raceStates',states); } } }, 50);
server.listen(PORT, '0.0.0.0', () => console.log(`Turbo Rift Racers running on ${PORT}`));
