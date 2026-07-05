const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 4096, pingTimeout: 15000, pingInterval: 8000 });
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname, { index: 'index.html' }));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'Turbo Rift Racers' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const TRACK_IDS = ['neon', 'jungle', 'desert', 'arctic', 'sky'];
const VEHICLE_IDS = ['rift','fang','beetle','vanquish','jetback','mammoth','solar','phantom','panther','wagon','hornet','crusher'];
const LOBBIES = new Map();
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
function lobbyFor(socket){ return socket.data.lobbyCode ? LOBBIES.get(socket.data.lobbyCode) : null; }
function makeLobby(socket, payload){
  let c = code(); while (LOBBIES.has(c)) c = code();
  const lobby = {
    code: c,
    hostId: socket.id,
    created: Date.now(),
    lastActive: Date.now(),
    settings: { maxRacers: 7, aiFill: true, laps: 3, balanced: false },
    votes: {},
    race: null,
    players: new Map()
  };
  lobby.players.set(socket.id, {
    id: socket.id,
    name: clean(payload.name) || `Racer${Math.floor(Math.random()*900+100)}`,
    ready: false,
    vehicle: VEHICLE_IDS.includes(payload.vehicle) ? payload.vehicle : 'rift',
    map: TRACK_IDS.includes(payload.map) ? payload.map : 'neon',
    online: true,
    lastSeen: Date.now(),
    state: null
  });
  LOBBIES.set(c, lobby);
  socket.join(c);
  socket.data.lobbyCode = c;
  socket.emit('lobby:created', pubLobby(lobby));
  broadcast(lobby);
}
function joinLobby(socket, payload){
  const c = clean(payload.code, 6).toUpperCase();
  const lobby = LOBBIES.get(c);
  if (!lobby) return socket.emit('lobby:error', 'Lobby not found.');
  if ([...lobby.players.values()].filter(p => p.online).length >= 7) return socket.emit('lobby:error', 'Lobby is full.');
  const base = clean(payload.name) || `Racer${Math.floor(Math.random()*900+100)}`;
  const names = [...lobby.players.values()].map(p => p.name.toLowerCase());
  let name = base, i = 2;
  while (names.includes(name.toLowerCase())) name = `${base}${i++}`;
  lobby.players.set(socket.id, {
    id: socket.id,
    name,
    ready: false,
    vehicle: VEHICLE_IDS.includes(payload.vehicle) ? payload.vehicle : 'rift',
    map: TRACK_IDS.includes(payload.map) ? payload.map : 'neon',
    online: true,
    lastSeen: Date.now(),
    state: null
  });
  socket.join(c);
  socket.data.lobbyCode = c;
  lobby.lastActive = Date.now();
  socket.emit('lobby:joined', pubLobby(lobby));
  broadcast(lobby);
}
function startRace(lobby){
  const humans = [...lobby.players.values()].filter(p => p.online).length;
  if (humans < 1) return;
  if (humans < 2 && !lobby.settings.aiFill) return io.to(lobby.code).emit('lobby:error', 'Need more players or enable AI fill.');
  const onlinePlayers = [...lobby.players.values()].filter(p => p.online);
  if (onlinePlayers.some(p => !p.ready)) return io.to(lobby.code).emit('lobby:error', 'Everyone must ready first.');
  const picks = onlinePlayers.map(p => TRACK_IDS.includes(p.map) ? p.map : 'neon');
  const target = Math.max(2, Math.min(7, lobby.settings.maxRacers));
  while (picks.length < target) picks.push(TRACK_IDS[Math.floor(Math.random()*TRACK_IDS.length)]);
  const chosen = picks[Math.floor(Math.random() * picks.length)];
  lobby.race = { track: chosen, seed: Math.floor(Math.random()*999999), laps: lobby.settings.laps, startAt: Date.now() + 6000 };
  lobby.votes = {};
  onlinePlayers.forEach(p => { p.ready = false; });
  io.to(lobby.code).emit('race:spin', { picks, chosen, seed: lobby.race.seed, startAt: lobby.race.startAt });
  broadcast(lobby);
}
io.on('connection', socket => {
  socket.on('lobby:create', p => makeLobby(socket, p || {}));
  socket.on('lobby:join', p => joinLobby(socket, p || {}));
  socket.on('lobby:leave', () => {
    const lobby = lobbyFor(socket); if (!lobby) return;
    lobby.players.delete(socket.id);
    socket.leave(lobby.code);
    socket.data.lobbyCode = null;
    if (lobby.hostId === socket.id) {
      const next = [...lobby.players.values()].find(p => p.online);
      lobby.hostId = next ? next.id : null;
    }
    if (lobby.players.size === 0) LOBBIES.delete(lobby.code); else broadcast(lobby);
  });
  socket.on('player:update', p => {
    const lobby = lobbyFor(socket); if (!lobby) return;
    const player = lobby.players.get(socket.id); if (!player) return;
    if (p.vehicle && VEHICLE_IDS.includes(p.vehicle)) player.vehicle = p.vehicle;
    if (p.map && TRACK_IDS.includes(p.map)) player.map = p.map;
    if (typeof p.ready === 'boolean') player.ready = p.ready;
    lobby.lastActive = Date.now();
    broadcast(lobby);
  });
  socket.on('lobby:settings', p => {
    const lobby = lobbyFor(socket); if (!lobby || lobby.hostId !== socket.id) return;
    lobby.settings.maxRacers = Math.max(2, Math.min(7, Number(p.maxRacers) || 7));
    lobby.settings.laps = [1,3,5].includes(Number(p.laps)) ? Number(p.laps) : 3;
    lobby.settings.aiFill = !!p.aiFill;
    lobby.settings.balanced = !!p.balanced;
    broadcast(lobby);
  });
  socket.on('race:start', () => {
    const lobby = lobbyFor(socket); if (!lobby || lobby.hostId !== socket.id) return;
    startRace(lobby);
  });
  socket.on('race:state', state => {
    const lobby = lobbyFor(socket); if (!lobby) return;
    const player = lobby.players.get(socket.id); if (!player) return;
    player.state = {
      x: +state.x || 0,
      z: +state.z || 0,
      speed: +state.speed || 0,
      lap: +state.lap || 1,
      finished: !!state.finished,
      t: Date.now()
    };
    socket.to(lobby.code).emit('race:remote', { id: socket.id, state: player.state });
  });
  socket.on('results:vote', action => {
    const lobby = lobbyFor(socket); if (!lobby) return;
    const a = clean(action, 16);
    if (!['retry','next','garage','lobby','home'].includes(a)) return;
    lobby.votes[socket.id] = a;
    const counts = {};
    Object.values(lobby.votes).forEach(v => counts[v] = (counts[v] || 0) + 1);
    io.to(lobby.code).emit('results:votes', counts);
    const human = [...lobby.players.values()].filter(p => p.online).length;
    if ((counts[a] || 0) >= Math.ceil(human / 2)) {
      if (a === 'retry' && lobby.race) {
        lobby.race.startAt = Date.now() + 3000;
        io.to(lobby.code).emit('race:restart', { track: lobby.race.track, seed: lobby.race.seed, laps: lobby.race.laps, startAt: lobby.race.startAt });
      }
      if (a === 'next') {
        [...lobby.players.values()].filter(p => p.online).forEach(p => p.ready = true);
        startRace(lobby);
      }
      if (a === 'garage') io.to(lobby.code).emit('scene:garage');
      if (a === 'lobby') io.to(lobby.code).emit('scene:lobby');
      if (a === 'home') io.to(lobby.code).emit('scene:home');
      lobby.votes = {};
      broadcast(lobby);
    }
  });
  socket.on('disconnect', () => {
    const lobby = lobbyFor(socket); if (!lobby) return;
    const player = lobby.players.get(socket.id);
    if (player) { player.online = false; player.lastSeen = Date.now(); }
    if (lobby.hostId === socket.id) {
      const next = [...lobby.players.values()].find(p => p.online);
      lobby.hostId = next ? next.id : lobby.hostId;
    }
    broadcast(lobby);
  });
});
setInterval(() => {
  const now = Date.now();
  for (const [code, lobby] of LOBBIES) {
    for (const [id, player] of lobby.players) {
      if (!player.online && now - player.lastSeen > 30000) lobby.players.delete(id);
    }
    if (lobby.players.size === 0 || now - lobby.lastActive > 1000 * 60 * 60 * 3) LOBBIES.delete(code); else broadcast(lobby);
  }
}, 15000);
server.listen(PORT, '0.0.0.0', () => console.log(`Turbo Rift Racers listening on ${PORT}`));
