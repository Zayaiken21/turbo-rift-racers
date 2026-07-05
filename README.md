# Turbo Rift Racers — Ultimate 5-File Build

This is the compact Render-ready build with only five project files. CSS and game JavaScript are embedded inside `index.html` so uploads from a phone stay simple while the server still supports Socket.IO multiplayer.

## File tree

```text
turbo-rift-racers-ultimate-5/
├─ index.html
├─ server.js
├─ package.json
├─ render.yaml
└─ README.md
```

## Render deployment

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

## Local testing

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Offline testing

Open `index.html` directly in a browser. Offline racing, AI, garage, shop, saves, controls, and procedural tracks still work. Online lobbies require the Node server.

## What is included

- Big seeded pseudo-3D circuits, not tiny circle tracks.
- Five themes: Neon City, Jungle Drift, Desert Canyon, Arctic Loop, and Sky Bridge.
- Jumps, tunnel portals, loop sections, boost pads, hazards, checkpoints, wrenches, scenery, mini-map, and results.
- Mobile-first forward-driving joystick and circular boost button.
- Desktop WASD/arrow keys and Space boost.
- Garage, shop, upgrades, wrench economy, and localStorage save system.
- Express + Socket.IO same-origin multiplayer with create/join lobby, host settings, map vote, ready flow, AI fill, and result voting.

## Multiplayer summary

The server owns lobby codes, host assignment, player membership, ready/map selections, race-start timing, and compact state relay. Clients render smoothly and keep offline mode available if the socket is unavailable.

## Tuning notes

Edit the embedded `TRACKS` array in `index.html` to add map seeds, paths, tunnels, jumps, loops, boost pads, hazards, and props. Edit `VEHICLES` to add cars or tune acceleration, top speed, handling, boost, durability, tier, and price.
