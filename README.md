# Turbo Rift Racers — 5 File Build

This is a Render-ready 5-file build of **Turbo Rift Racers**.

## Files

- `index.html` — complete game UI, canvas racer, garage, shop, settings, lobby, and multiplayer client
- `server.js` — Express + Socket.IO multiplayer server
- `package.json` — dependencies and start script
- `render.yaml` — Render deployment helper
- `README.md` — setup guide

## Local Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Offline Mode

You can also open `index.html` directly in a browser for offline single-player mode.

## Render Deployment

- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Health Check Path:** `/health`

## Multiplayer Flow

1. Open **Online Multiplayer**.
2. Create or join a lobby.
3. Each player picks a preferred map and vehicle.
4. Players press **Ready Up**.
5. The host presses **Start Map Vote**.
6. The wheel spins, then the chosen map starts.

Map choice alone does **not** start the race.

## Controls

### Mobile
- Joystick up = accelerate forward
- Joystick down = brake / reverse feel
- Joystick left / right = steer
- Big glowing boost button = boost

### Desktop
- `WASD` or Arrow Keys = drive
- `Space` = boost
- `Escape` = pause

## Garage / Shop Save System

The game uses `localStorage` to save:
- player name
- wrench balance
- unlocked cars
- upgrade levels
- equipped trail
- settings
- best lap times

## Adding More Tracks Later

Inside `index.html`, add another entry to the `TRACKS` object and another pattern in `trackPattern()`.

## Adding More Vehicles Later

Add another vehicle to the `VEHICLES` array in `index.html`.

## Health Route

`/health` returns JSON so Render can verify the service is alive.
