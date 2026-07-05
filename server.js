'use strict';

/*
  Turbo Rift Racers multiplayer server
  -----------------------------------
  Render deployment notes:
  - Render runs `npm install` then `npm start`.
  - Express serves the /public folder and Socket.IO attaches to the same HTTP server.
  - Lobbies live in memory by design for the first production-ready build. Render restarts clear active lobbies.

  Multiplayer flow:
  - Server owns lobby identity, membership, host migration, ready state, map votes, race starts, AI racers, and collectible wins.
  - Clients send compact local car state; server validates shape/limits then rebroadcasts.
  - AI racers are simulated server-side during online races for consistent shared opponents.
*/

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
  maxHttpBufferSize: 32 * 1024,
  pingInterval: 15000,
  pingTimeout: 15000
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const MAX_LOBBIES = 200;
const MAX_RACERS = 7;
const LOBBY_TTL_MS = 1000 * 60 * 60 * 2;
const EMPTY_LOBBY_TTL_MS = 1000 * 60 * 3;
const TICK_MS = 40;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, name: 'Turbo Rift Racers', time: Date.now() }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const TRACK_IDS = ['neon','jungle','desert','arctic','sky'];
const TRACK_NAMES = {
  neon: 'Neon City Speedway',
  jungle: 'Jungle Drift Run',
  desert: 'Desert Turbo Canyon',
  arctic: 'Arctic Loop Circuit',
  sky: 'Sky Bridge Rally'
};

function sanitizeName(raw) {
  const cleaned = String(raw || '')
    .replace(/[<>"'`{}\\]/g, '')
    .replace(/[^a-zA-Z0-9 _.-]/g, '')
    .trim()
    .slice(0, 16);
  return cleaned || `Racer${Math.floor(100 + Math.random() * 900)}`;
}
function safeVehicle(id) {
  const known = new Set(['rift','fang','beetle','vanquish','jetback','mammoth','solar','phantom','panther','wagon','hornet','crusher']);
  return known.has(String(id)) ? String(id) : 'rift';
}
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function uniqueCode() {
  let code = makeCode();
  for (let i = 0; i < 20 && lobbies.has(code); i += 1) code = makeCode();
  return code;
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, Number(n) || 0)); }
function dist(a, b) { return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)); }
function now() { return Date.now(); }

function serverWaypoints(trackId) {
  const presets = {
    neon: { cx: 0, cy: 0, rx: 1550, ry: 920, wob: 0.18 },
    jungle: { cx: 0, cy: 0, rx: 1420, ry: 1040, wob: 0.28 },
    desert: { cx: 0, cy: 0, rx: 1680, ry: 760, wob: 0.22 },
    arctic: { cx: 0, cy: 0, rx: 1360, ry: 980, wob: 0.20 },
    sky: { cx: 0, cy: 0, rx: 1500, ry: 900, wob: 0.32 }
  };
  const p = presets[trackId] || presets.neon;
  const pts = [];
  for (let i = 0; i < 24; i += 1) {
    const t = (Math.PI * 2 * i) / 24 - Math.PI / 2;
    const wave = 1 + Math.sin(i * 1.7) * p.wob;
    pts.push({ x: p.cx + Math.cos(t) * p.rx * wave, y: p.cy + Math.sin(t) * p.ry * (2 - wave) });
  }
  return pts;
}
function spawnFor(trackId, index) {
  const pts = serverWaypoints(trackId);
  const p = pts[0], n = pts[1];
  const angle = Math.atan2(n.y - p.y, n.x - p.x);
  const side = index - 3;
  return {
    x: p.x - Math.cos(angle) * 110 - Math.sin(angle) * side * 72,
    y: p.y - Math.sin(angle) * 110 + Math.cos(angle) * side * 72,
    angle
  };
}

const lobbies = new Map();
const socketLobby = new Map();

function publicLobby(lobby) {
  const players = [...lobby.players.values()].map(p => ({
    id: p.id, name: p.name, vehicle: p.vehicle, ready: !!p.ready, host: p.id === lobby.hostId,
    connected: !!p.connected, mapVote: p.mapVote || 'neon'
  }));
  const humanCount = players.filter(p => p.connected).length;
  const aiCount = Math.max(0, Math.min(lobby.maxRacers, MAX_RACERS) - humanCount);
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    maxRacers: lobby.maxRacers,
    aiFill: lobby.aiFill,
    balanced: lobby.balanced,
    lapCount: lobby.lapCount,
    status: lobby.status,
    players,
    humanCount,
    aiCount: lobby.aiFill ? aiCount : 0,
    totalRaceSize: lobby.aiFill ? Math.max(humanCount, Math.min(lobby.maxRacers, MAX_RACERS)) : humanCount,
    selectedTrack: lobby.selectedTrack || null,
    resultVotes: lobby.resultVotes || {}
  };
}
function emitLobby(lobby) {
  io.to(lobby.code).emit('lobby:update', publicLobby(lobby));
}
function assignNewHost(lobby) {
  if (lobby.hostId && lobby.players.get(lobby.hostId)?.connected) return;
  const nextHost = [...lobby.players.values()].find(p => p.connected);
  lobby.hostId = nextHost ? nextHost.id : null;
}
function leaveCurrentLobby(socket, hard = false) {
  const code = socketLobby.get(socket.id);
  if (!code) return;
  const lobby = lobbies.get(code);
  socketLobby.delete(socket.id);
  socket.leave(code);
  if (!lobby) return;
  const player = lobby.players.get(socket.id);
  if (player) {
    if (hard || lobby.status === 'lobby' || lobby.status === 'vote') {
      lobby.players.delete(socket.id);
    } else {
      player.connected = false;
      player.disconnectedAt = now();
      if (lobby.race) lobby.race.aiTakeoverAfter[player.id] = now() + 8000;
    }
  }
  assignNewHost(lobby);
  lobby.updatedAt = now();
  emitLobby(lobby);
}
function cleanupLobbies() {
  const t = now();
  for (const [code, lobby] of lobbies) {
    const connected = [...lobby.players.values()].some(p => p.connected);
    if ((!connected && t - lobby.updatedAt > EMPTY_LOBBY_TTL_MS) || t - lobby.createdAt > LOBBY_TTL_MS) {
      lobbies.delete(code);
    }
  }
  while (lobbies.size > MAX_LOBBIES) {
    const oldest = [...lobbies.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!oldest) break;
    lobbies.delete(oldest.code);
  }
}
setInterval(cleanupLobbies, 30000).unref();

function startMapVote(lobby) {
  if (!lobby || lobby.status === 'vote' || lobby.status === 'race') return;
  lobby.status = 'vote';
  const humans = [...lobby.players.values()].filter(p => p.connected);
  const slices = humans.map(p => ({ label: (TRACK_NAMES[p.mapVote] || TRACK_NAMES.neon).replace(/ (Speedway|Circuit|Run|Rally|Canyon)/, ''), trackId: p.mapVote || 'neon', by: p.name, human: true }));
  const aiCount = lobby.aiFill ? Math.max(0, lobby.maxRacers - humans.length) : 0;
  for (let i = 0; i < aiCount; i += 1) {
    const trackId = TRACK_IDS[Math.floor(Math.random() * TRACK_IDS.length)];
    slices.push({ label: (TRACK_NAMES[trackId] || TRACK_NAMES.neon).split(' ')[0], trackId, by: `AI ${i + 1}`, human: false });
  }
  if (!slices.length) slices.push({ label: 'Neon', trackId: 'neon', by: 'System', human: false });
  const chosenIndex = Math.floor(Math.random() * slices.length);
  const chosen = slices[chosenIndex];
  const spin = { slices, chosenIndex, trackId: chosen.trackId, trackName: TRACK_NAMES[chosen.trackId], seed: Math.random(), duration: 4500, startAt: now() + 750 };
  lobby.spin = spin;
  lobby.selectedTrack = chosen.trackId;
  lobby.updatedAt = now();
  io.to(lobby.code).emit('vote:start', spin);
  emitLobby(lobby);
  setTimeout(() => beginRace(lobby.code), spin.duration + 1400).unref();
}

function beginRace(code, trackOverride) {
  const lobby = lobbies.get(code);
  if (!lobby || lobby.status === 'race') return;
  const trackId = trackOverride || lobby.selectedTrack || 'neon';
  const humans = [...lobby.players.values()].filter(p => p.connected);
  const minRaceSize = lobby.aiFill ? Math.max(2, humans.length + Math.max(0, lobby.maxRacers - humans.length)) : humans.length;
  if (humans.length < 1 || minRaceSize < 2) {
    lobby.status = 'lobby';
    io.to(code).emit('toast', { kind: 'warn', message: lobby.aiFill ? 'Need at least one player.' : 'Need at least two players or AI fill.' });
    emitLobby(lobby);
    return;
  }
  const total = lobby.aiFill ? Math.min(MAX_RACERS, Math.max(2, lobby.maxRacers)) : Math.min(MAX_RACERS, humans.length);
  const aiCount = Math.max(0, total - humans.length);
  const raceId = `${code}-${now()}`;
  const ai = [];
  const pts = serverWaypoints(trackId);
  for (let i = 0; i < aiCount; i += 1) {
    const spawn = spawnFor(trackId, humans.length + i);
    ai.push({
      id: `ai-${i + 1}`, name: `AI ${i + 1}`, vehicle: ['fang','beetle','mammoth','solar','hornet'][i % 5],
      x: spawn.x, y: spawn.y, angle: spawn.angle, speed: 0, lap: 1, checkpoint: 0, wp: 1,
      difficulty: 0.84 + Math.random() * 0.22, finished: false, progress: 0
    });
  }
  lobby.status = 'race';
  lobby.race = {
    raceId, trackId, trackName: TRACK_NAMES[trackId], lapCount: lobby.lapCount || 3,
    startAt: now() + 4200, startedAt: now(), states: {}, ai, waypoints: pts,
    aiTakeoverAfter: {}, collected: new Set(), finishes: [], resultVotes: {}, lastTick: now()
  };
  lobby.resultVotes = {};
  lobby.updatedAt = now();
  io.to(code).emit('race:launch', {
    raceId,
    trackId,
    trackName: TRACK_NAMES[trackId],
    lapCount: lobby.race.lapCount,
    startAt: lobby.race.startAt,
    lobby: publicLobby(lobby),
    serverNow: now()
  });
  emitLobby(lobby);
}

function finishRaceForLobby(lobby) {
  if (!lobby || !lobby.race) return;
  lobby.status = 'results';
  lobby.updatedAt = now();
  io.to(lobby.code).emit('race:results-ready', { finishes: lobby.race.finishes, raceId: lobby.race.raceId });
  emitLobby(lobby);
}
function checkResultsAction(lobby) {
  if (!lobby || lobby.status !== 'results') return;
  const votes = lobby.resultVotes || {};
  const connected = [...lobby.players.values()].filter(p => p.connected);
  const threshold = Math.max(1, Math.floor(connected.length / 2) + 1);
  const counts = { retry: 0, next: 0, garage: 0, lobby: 0, home: 0 };
  for (const action of Object.values(votes)) if (counts[action] !== undefined) counts[action] += 1;
  let action = null;
  for (const [k, v] of Object.entries(counts)) if (v >= threshold) action = k;
  if (!action && connected.length && lobby.hostId && votes[lobby.hostId]) {
    const top = Math.max(...Object.values(counts));
    const tied = Object.entries(counts).filter(([,v]) => v === top && v > 0);
    if (tied.length > 1) action = votes[lobby.hostId];
  }
  io.to(lobby.code).emit('results:votes', { counts, threshold, votes });
  if (!action) return;
  lobby.resultVotes = {};
  if (action === 'retry') {
    beginRace(lobby.code, lobby.race?.trackId || lobby.selectedTrack || 'neon');
  } else if (action === 'next') {
    const current = lobby.race?.trackId || lobby.selectedTrack || 'neon';
    const idx = TRACK_IDS.indexOf(current);
    beginRace(lobby.code, TRACK_IDS[(idx + 1 + TRACK_IDS.length) % TRACK_IDS.length]);
  } else if (action === 'garage') {
    lobby.status = 'lobby';
    io.to(lobby.code).emit('results:action', { action: 'garage' });
    emitLobby(lobby);
  } else if (action === 'lobby' || action === 'home') {
    lobby.status = 'lobby';
    io.to(lobby.code).emit('results:action', { action });
    emitLobby(lobby);
  }
}

function updateAiCar(ai, race, dt) {
  const pts = race.waypoints;
  if (!pts.length || ai.finished) return;
  const target = pts[ai.wp % pts.length];
  const angleTo = Math.atan2(target.y - ai.y, target.x - ai.x);
  let diff = ((angleTo - ai.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const close = Math.hypot(target.x - ai.x, target.y - ai.y);
  const turnSharpness = Math.abs(diff);
  const targetSpeed = (520 + ai.difficulty * 330) * (turnSharpness > 0.8 ? 0.58 : 1);
  ai.speed += clamp(targetSpeed - ai.speed, -460 * dt, 380 * dt);
  ai.angle += clamp(diff, -2.5 * dt, 2.5 * dt);
  ai.x += Math.cos(ai.angle) * ai.speed * dt;
  ai.y += Math.sin(ai.angle) * ai.speed * dt;
  ai.progress += Math.max(0, ai.speed) * dt;
  if (close < 150) {
    ai.wp = (ai.wp + 1) % pts.length;
    ai.checkpoint = ai.wp;
    if (ai.wp === 0) {
      ai.lap += 1;
      if (ai.lap > race.lapCount) {
        ai.finished = true;
        const finish = { id: ai.id, name: ai.name, ai: true, time: now() - race.startAt, lap: race.lapCount, wrenches: 12 };
        race.finishes.push(finish);
      }
    }
  }
}

setInterval(() => {
  const t = now();
  for (const lobby of lobbies.values()) {
    if (lobby.status !== 'race' || !lobby.race) continue;
    const race = lobby.race;
    const dt = Math.min(0.08, Math.max(0.001, (t - race.lastTick) / 1000));
    race.lastTick = t;
    for (const ai of race.ai) updateAiCar(ai, race, dt);
    for (const [playerId, until] of Object.entries(race.aiTakeoverAfter)) {
      const p = lobby.players.get(playerId);
      if (p && !p.connected && t > until && !race.ai.find(a => a.id === `takeover-${playerId}`)) {
        const oldState = race.states[playerId] || spawnFor(race.trackId, race.ai.length + 1);
        race.ai.push({ id: `takeover-${playerId}`, name: `${p.name} AI`, vehicle: p.vehicle, x: oldState.x || 0, y: oldState.y || 0, angle: oldState.angle || 0, speed: oldState.speed || 0, lap: oldState.lap || 1, checkpoint: oldState.checkpoint || 0, wp: Math.max(1, oldState.checkpoint || 1), difficulty: 0.78, finished: false, progress: 0 });
      }
    }
    io.to(lobby.code).emit('race:state', {
      raceId: race.raceId,
      serverNow: t,
      players: race.states,
      ai: race.ai.map(a => ({ id: a.id, name: a.name, vehicle: a.vehicle, x: Math.round(a.x), y: Math.round(a.y), angle: +a.angle.toFixed(3), speed: Math.round(a.speed), lap: a.lap, checkpoint: a.checkpoint, finished: a.finished }))
    });
    const humans = [...lobby.players.values()].filter(p => p.connected);
    const humanFinished = humans.length > 0 && humans.every(p => race.finishes.some(f => f.id === p.id));
    if (humanFinished || race.finishes.length >= Math.max(1, humans.length + race.ai.length)) finishRaceForLobby(lobby);
  }
}, TICK_MS).unref();

io.on('connection', socket => {
  socket.emit('hello', { serverNow: now(), tracks: TRACK_NAMES });

  socket.on('lobby:create', data => {
    cleanupLobbies();
    if (lobbies.size >= MAX_LOBBIES) return socket.emit('error:message', 'Server is busy. Try again soon.');
    const code = uniqueCode();
    const player = {
      id: socket.id,
      name: sanitizeName(data?.name),
      vehicle: safeVehicle(data?.vehicle),
      ready: false,
      connected: true,
      mapVote: 'neon',
      joinedAt: now()
    };
    const lobby = {
      code, players: new Map([[socket.id, player]]), hostId: socket.id,
      maxRacers: clamp(data?.maxRacers || 7, 2, MAX_RACERS), aiFill: data?.aiFill !== false,
      balanced: !!data?.balanced, lapCount: clamp(data?.lapCount || 3, 1, 5),
      status: 'lobby', createdAt: now(), updatedAt: now(), resultVotes: {}
    };
    lobbies.set(code, lobby);
    socket.join(code);
    socketLobby.set(socket.id, code);
    socket.emit('lobby:joined', publicLobby(lobby));
    emitLobby(lobby);
  });

  socket.on('lobby:join', data => {
    const code = String(data?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const lobby = lobbies.get(code);
    if (!lobby) return socket.emit('error:message', 'Lobby not found. Check the code.');
    const connectedCount = [...lobby.players.values()].filter(p => p.connected).length;
    if (connectedCount >= MAX_RACERS || connectedCount >= lobby.maxRacers) return socket.emit('error:message', 'Lobby is full.');
    leaveCurrentLobby(socket, true);
    let baseName = sanitizeName(data?.name);
    const names = new Set([...lobby.players.values()].map(p => p.name.toLowerCase()));
    if (names.has(baseName.toLowerCase())) baseName = `${baseName.slice(0, 12)} ${Math.floor(Math.random()*9)+2}`;
    const player = { id: socket.id, name: baseName, vehicle: safeVehicle(data?.vehicle), ready: false, connected: true, mapVote: 'neon', joinedAt: now() };
    lobby.players.set(socket.id, player);
    socket.join(code);
    socketLobby.set(socket.id, code);
    lobby.updatedAt = now();
    socket.emit('lobby:joined', publicLobby(lobby));
    emitLobby(lobby);
  });

  socket.on('lobby:leave', () => leaveCurrentLobby(socket, true));

  socket.on('lobby:update', data => {
    const code = socketLobby.get(socket.id);
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    if (data?.name !== undefined) player.name = sanitizeName(data.name);
    if (data?.vehicle !== undefined) player.vehicle = safeVehicle(data.vehicle);
    if (data?.ready !== undefined) player.ready = !!data.ready;
    if (data?.mapVote !== undefined && TRACK_IDS.includes(data.mapVote)) player.mapVote = data.mapVote;
    if (socket.id === lobby.hostId) {
      if (data?.maxRacers !== undefined) lobby.maxRacers = clamp(data.maxRacers, 2, MAX_RACERS);
      if (data?.aiFill !== undefined) lobby.aiFill = !!data.aiFill;
      if (data?.balanced !== undefined) lobby.balanced = !!data.balanced;
      if (data?.lapCount !== undefined) lobby.lapCount = clamp(data.lapCount, 1, 5);
    }
    lobby.updatedAt = now();
    const connected = [...lobby.players.values()].filter(p => p.connected);
    const readyHumans = connected.length > 0 && connected.every(p => p.ready);
    const possibleRaceSize = lobby.aiFill ? Math.max(2, lobby.maxRacers) : connected.length;
    emitLobby(lobby);
    if (lobby.status === 'lobby' && readyHumans && possibleRaceSize >= 2) startMapVote(lobby);
  });

  socket.on('race:state', data => {
    const code = socketLobby.get(socket.id);
    const lobby = lobbies.get(code);
    if (!lobby || lobby.status !== 'race' || !lobby.race || data?.raceId !== lobby.race.raceId) return;
    const p = lobby.players.get(socket.id);
    if (!p) return;
    const s = {
      id: socket.id, name: p.name, vehicle: p.vehicle,
      x: clamp(data.x, -5000, 5000), y: clamp(data.y, -5000, 5000), angle: clamp(data.angle, -Math.PI * 2, Math.PI * 2),
      speed: clamp(data.speed, -800, 1800), lap: clamp(data.lap, 1, 9), checkpoint: clamp(data.checkpoint, 0, 99),
      boost: clamp(data.boost, 0, 1), finished: !!data.finished, t: now()
    };
    lobby.race.states[socket.id] = s;
  });

  socket.on('race:collect', data => {
    const code = socketLobby.get(socket.id);
    const lobby = lobbies.get(code);
    if (!lobby || !lobby.race || data?.raceId !== lobby.race.raceId) return;
    const id = String(data?.collectibleId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    if (!id || lobby.race.collected.has(id)) return;
    lobby.race.collected.add(id);
    io.to(code).emit('race:collected', { collectibleId: id, by: socket.id });
  });

  socket.on('race:finish', data => {
    const code = socketLobby.get(socket.id);
    const lobby = lobbies.get(code);
    if (!lobby || !lobby.race || data?.raceId !== lobby.race.raceId) return;
    if (lobby.race.finishes.some(f => f.id === socket.id)) return;
    const p = lobby.players.get(socket.id);
    const finish = {
      id: socket.id, name: p?.name || 'Racer', ai: false,
      time: clamp(data?.time, 0, 1000 * 60 * 60), bestLap: clamp(data?.bestLap, 0, 1000 * 60),
      wrenches: clamp(data?.wrenches, 0, 999), collected: clamp(data?.collected, 0, 99)
    };
    lobby.race.finishes.push(finish);
    io.to(code).emit('race:finish', finish);
  });

  socket.on('results:vote', data => {
    const code = socketLobby.get(socket.id);
    const lobby = lobbies.get(code);
    if (!lobby || lobby.status !== 'results') return;
    const action = ['retry','next','garage','lobby','home'].includes(data?.action) ? data.action : 'lobby';
    lobby.resultVotes = lobby.resultVotes || {};
    lobby.resultVotes[socket.id] = action;
    lobby.updatedAt = now();
    checkResultsAction(lobby);
  });

  socket.on('ping:check', cb => { if (typeof cb === 'function') cb({ serverNow: now() }); });

  socket.on('disconnect', () => leaveCurrentLobby(socket, false));
});

server.listen(PORT, HOST, () => {
  console.log(`Turbo Rift Racers running on http://${HOST}:${PORT}`);
});
