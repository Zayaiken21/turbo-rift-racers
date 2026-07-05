# Turbo Rift Racers

Turbo Rift Racers is a complete browser-based arcade racing game with offline single-player, AI racers, local garage progression, procedural pseudo-3D sprites, mobile joystick controls, and Render-ready online multiplayer through Node.js, Express, and Socket.IO.

The first build is designed to run immediately with no paid assets, no external gameplay CDNs, no account system, no database, and no real-money shop.

## File tree

```text
turbo-rift-racers/
├─ package.json
├─ server.js
├─ render.yaml
├─ README.md
└─ public/
   ├─ index.html
   ├─ style.css
   └─ game.js
```

## Local testing

### Offline direct-browser mode

Open this file directly in a browser:

```text
public/index.html
```

Offline mode works even when Socket.IO is unavailable. Use **Play Offline** to start a race.

### Local online/server mode

From the project folder:

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

To test online multiplayer locally:

1. Open `http://localhost:3000` in two browser tabs or devices on the same network.
2. In tab one, choose **Online Multiplayer → Create Lobby**.
3. Copy the lobby code.
4. In tab two, choose **Online Multiplayer → Join Lobby** and enter the code.
5. Pick map votes and press **Ready** in both tabs.
6. The server starts the synchronized map spin wheel and launches the race.

## Render deployment

Create a new **Render Web Service** and use these settings:

```text
Build Command: npm install
Start Command: npm start
Environment: Node
```

The server uses `process.env.PORT`, serves the `public` folder, attaches Socket.IO to the same HTTP server, and exposes a health route:

```text
/health
```

Expected health response:

```json
{"ok":true,"name":"Turbo Rift Racers"}
```

You can also use the included `render.yaml` for Blueprint-style deployment.

## Controls

### Desktop

- **W / ArrowUp**: accelerate
- **S / ArrowDown**: brake or reverse
- **A / ArrowLeft**: steer left
- **D / ArrowRight**: steer right
- **Space**: boost
- **Escape**: pause menu

### Mobile and tablet

- Drag the left joystick.
- Push up to accelerate.
- Pull down to brake or reverse.
- Move left/right to steer.
- Tap the glowing circular **BOOST** button.
- Use **Full Screen** and rotate sideways for the best layout.

## Game modes

### Offline Quick Race

Offline mode uses local AI racers and works from a normal browser without running the Node server. It supports track choice, lap count, AI count, and difficulty.

### Online Lobby Race

Online mode connects to the same-origin Socket.IO server. Lobbies support short uppercase codes, host migration, ready status, map voting, AI fill, max racer selection, lap count selection, and connected garage changes.

If the server is unavailable, the game shows a friendly message and continues to support offline play.

## Multiplayer architecture

The server owns:

- lobby codes
- lobby membership
- host assignment and migration
- ready state
- lobby settings
- map vote spin result
- race start timestamp
- online AI racers
- collectible wrench ownership
- result votes

Clients send compact local car state during online races. The server validates basic ranges and rebroadcasts player and AI state at a fixed tick rate. Remote cars interpolate between updates for smoother motion.

This first version uses in-memory lobby state. Render restarts clear active lobbies, which is expected for the no-database first build.

## AI driving

Offline AI uses invisible waypoint arrays from each track. AI racers:

- target the next waypoint
- slow before sharp turns
- accelerate on straightaways
- use boost only when aligned
- avoid obstacles using forward detection
- avoid other cars with side steering bias
- recover and respawn if stuck
- obey checkpoint and lap progression

Online AI is simulated by the server so all connected players see the same AI opponents.

## Garage save system

Progress is saved with `localStorage` on each device. The save data includes:

- player name
- selected vehicle
- selected paint
- selected boost trail
- unlocked cars
- upgrade levels
- wrench balance
- best lap times
- completed tracks
- settings

The save object is versioned. If corrupted data is detected, the game restores safe defaults.

## Tracks included

1. Neon City Speedway
2. Jungle Drift Run
3. Desert Turbo Canyon
4. Arctic Loop Circuit
5. Sky Bridge Rally

Each track has its own color palette, road shape, boost pads, terrain zones, obstacles, props, checkpoints, AI route, start grid, finish banner, and wrench placements.

## Vehicles included

1. Rift Runner
2. Neon Fang
3. Thunder Beetle
4. Turbo Vanquish
5. Jetback Coupe
6. Mammoth Hauler
7. Solar Sprint
8. Phantom Drift
9. Cyber Panther
10. Rocket Wagon
11. Glacier Hornet
12. Canyon Crusher

Vehicles have acceleration, top speed, handling, boost, durability, rarity tier, unlock requirement, upgrade support, and procedural pseudo-3D rendering.

## How to add more tracks

Open `public/game.js` and extend:

```js
TRACK_IDS
TRACK_NAMES
buildTrack(id)
```

Add a new preset inside `buildTrack`. The procedural builder will create waypoints, checkpoints, spawns, boost pads, collectibles, terrain, obstacles, ramps, and props. For full control, add custom arrays for those track elements after the preset is created.

For online server AI, also add the track name/id to `server.js` in `TRACK_IDS`, `TRACK_NAMES`, and `serverWaypoints` if you want server-side AI to follow a custom route.

## How to add more vehicles

Open `public/game.js` and add a vehicle object to `VEHICLES`:

```js
{
  id: 'newcar',
  name: 'New Car Name',
  rarity: 'Pro',
  cost: 500,
  req: 'Buy with 500 wrenches',
  personality: 'Short driving description',
  stats: { accel: 75, top: 82, handling: 70, boost: 80, durability: 62 },
  color: '#25f4ff'
}
```

For online validation, also add the vehicle ID to the `known` set in `server.js` inside `safeVehicle()`.

## How to tune car physics

Open `public/game.js` and edit `carPhysicsTuning(vehicleId, balanced)`.

Important tuning values:

- `accelForce`
- `maxSpeed`
- `reverseSpeed`
- `turnRate`
- `grip`
- `boostForce`
- `boostDrain`
- `collisionKeep`

The current tuning is intentionally forgiving for mobile and younger players.

## How to change max racers

The game supports up to seven racers by default.

Client constant:

```js
const MAX_RACERS = 7;
```

Server constant:

```js
const MAX_RACERS = 7;
```

Increasing this requires wider spawn spacing, wider tracks, and more bandwidth testing.

## How to rebalance wrench rewards

Open `public/game.js` and edit `calculateReward(car, place)`.

Current reward sources:

- finishing placement
- collected track wrenches
- clean driving bonus
- best lap bonus
- collection bonus

Players never lose wrenches for bad races.

## How to customize UI colors

Open `public/style.css` and edit the root variables:

```css
:root {
  --cyan: #25f4ff;
  --pink: #ff3df2;
  --gold: #ffcb3d;
  --green: #77ff7a;
}
```

Track-specific colors are in `public/game.js` inside `buildTrack(id)`.

## How to add real sprite files later

The first build draws every sprite procedurally, so there are no missing asset paths. To add real sprites later:

1. Create `public/assets/`.
2. Put optimized PNG/WebP files inside it.
3. Preload images in `game.js`.
4. Replace or supplement functions like `drawCarSprite`, `drawTreeSprite`, `drawBuildingSprite`, and `drawWrenchSprite`.
5. Keep procedural fallback drawing if an image fails to load.

## How to upgrade server persistence later

The current server uses in-memory lobbies for a simple first deployment. For persistence, add Redis or a database and store:

- lobby metadata
- player membership
- reconnect tokens
- active race IDs
- result vote state

Do not store unnecessary personal data. The current build only uses nicknames and temporary socket IDs.

## No paid assets or hidden services

The game uses:

- HTML
- CSS
- Canvas
- plain JavaScript
- Web Audio API generated sounds
- Express
- Socket.IO

It does not require paid assets, external sprites, external audio files, accounts, ads, or a database.
