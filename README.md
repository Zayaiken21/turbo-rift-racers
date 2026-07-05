# Turbo Rift Racers — 5 File Render Build

This version is intentionally only five files so it is simple to upload from a phone and deploy on Render.

## Files

```text
index.html
server.js
package.json
render.yaml
README.md
```

## Local test

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Render settings

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

Health Check Path:

```text
/health
```

## Offline mode

Open `index.html` directly in a browser and press **Play Offline**. Offline mode uses local AI racers and localStorage saves.

## Online mode

Deploy on Render, open the Render URL, then use **Online Multiplayer** to create or join a lobby. The server uses Express + Socket.IO from the same origin. No database is required.

## Controls

Desktop:
- WASD or Arrow Keys to drive
- Space to boost
- Escape to pause

Mobile:
- Left joystick steers and controls throttle/reverse
- Right glowing BOOST button boosts
- Rotate sideways for the best view

## Important fixes in this build

- Mobile controls no longer appear on the main menu.
- Rotate overlay only appears in race scenes and can be dismissed.
- The menu is a real menu, not the race HUD behind it.
- Play Offline starts an actual circuit race with AI racers.
- There are visible full tracks, road edges, barriers, checkpoints, boost pads, ramps, wrenches, props, finish line, minimap, HUD, results, garage, shop, and save progress.
