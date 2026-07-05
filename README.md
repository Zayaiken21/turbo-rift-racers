# Turbo Rift Racers — 5 File Render Build

This version is intentionally simplified to match your other Render games: only five files, with CSS and game JavaScript embedded inside `index.html`.

## Files

```text
index.html
server.js
package.json
render.yaml
README.md
```

## Render setup

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

`render.yaml` is included, so Render can auto-detect the web service.

## Local testing

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Offline testing

Open `index.html` directly in a browser. Offline single-player works without the server. Online multiplayer needs `npm start` or Render.

## Multiplayer

Socket.IO is served from the same Node server. Lobbies are stored in memory, which keeps deployment simple. Render restarts will clear active lobbies, but the game does not need a database for this version.
