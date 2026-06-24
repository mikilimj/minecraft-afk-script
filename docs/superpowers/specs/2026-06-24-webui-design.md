# Web UI Design — Minecraft AFK Bot

Date: 2026-06-24

## Overview

Replace the terminal TUI with a local web dashboard that runs alongside the bot process. The user opens `http://localhost:3000` in any browser to control the bot, change settings, and watch a live activity log.

## Architecture

### Files

| File | Role |
|---|---|
| `server.js` | Express HTTP server, WebSocket server, all bot logic (migrated from `index.js`) |
| `index.js` | Thin entrypoint — requires `server.js` and starts it |
| `public/index.html` | Single-page dashboard |
| `public/style.css` | Dark theme styles |
| `public/app.js` | Frontend logic — WebSocket client, REST calls, DOM updates |

`cache/config.json` remains the persistence layer, unchanged in format except for the addition of the `reconnect` key.

### New dependencies

- `express` — HTTP server and static file serving
- `ws` — WebSocket server for real-time log streaming

### Config shape (addition)

```json
"reconnect": {
  "enabled": true,
  "delaySeconds": 30
}
```

---

## REST API

| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Returns current in-memory config as JSON |
| POST | `/api/config` | Accepts full config object, validates, saves to disk |
| POST | `/api/bot/start` | Connects the bot (no-op if already connected) |
| POST | `/api/bot/stop` | Disconnects the bot and cancels any pending reconnect |

---

## WebSocket Protocol

Server → Client messages (JSON):

```json
{ "type": "log", "level": "info|warn|error", "text": "..." }
{ "type": "status", "state": "idle|connecting|connected|reconnecting" }
```

The client reconnects the WebSocket automatically on close (1 second delay) so that refreshing the page or restarting the server does not require manual action.

---

## UI Layout

Single-page dashboard. No tabs, no sidebar. Dark theme.

```
┌─────────────────────────────────────────────────────────┐
│  Minecraft AFK Bot          ● Connected   [Disconnect]  │
├──────────────────────────┬──────────────────────────────┤
│  SETTINGS                │  ACTIVITY LOG               │
│                          │                              │
│  Server                  │  12:01:05  Connected to...  │
│  ┌──────────┐ ┌────┐     │  12:01:06  [CHAT] Welcome   │
│  │ host     │ │port│     │  12:01:12  Logged in!       │
│  └──────────┘ └────┘     │  12:02:30  ⚠ Kicked: ...   │
│                          │  12:02:31  Reconnecting     │
│  Account                 │  12:03:01  Connected to...  │
│  ...                     │                              │
│                          │                              │
│  AFK Position  [toggle]  │                              │
│  ...                     │                              │
│                          │                              │
│  Anti-AFK      [toggle]  │                              │
│  Interval: 20000 ms      │                              │
│                          │                              │
│  Reconnect     [toggle]  │                              │
│  Delay: 30 sec           │                              │
│                          │                              │
│            [Save]        │                              │
└──────────────────────────┴──────────────────────────────┘
```

### Visual style

- Background: `#0f1117`, card surfaces: `#1a1d27`, borders: `#2a2d3e`
- Accent: green `#22c55e` (connected), yellow `#eab308` (reconnecting), red `#ef4444` (error)
- Font: Inter (Google Fonts), 14px base
- Status badge is a colored dot + text next to the title
- Log entries are color-coded by level (info = default, warn = yellow, error = red)
- Settings panel scrolls independently; log panel auto-scrolls to the latest entry

---

## Bot Control

- **Connect** button: calls `POST /api/bot/start`. Disabled while already connected or connecting.
- **Disconnect** button: calls `POST /api/bot/stop`. Cancels any pending reconnect timer.
- **Auto-reconnect**: when the bot emits `end`, `kicked`, or `error` events and `reconnect.enabled` is true, the server waits `reconnect.delaySeconds` seconds then calls `startBot()` again. The countdown is broadcast over WebSocket as status `reconnecting`.

---

## Spec Self-Review

- No placeholders or TODOs.
- Architecture matches feature list.
- REST + WebSocket are non-overlapping: REST for commands/config, WS for push events.
- Reconnect delay is in seconds in config/UI, converted to ms internally.
- Config validation on `POST /api/config`: port must be numeric 1–65535, delaySeconds must be 1–3600.
- Scope is focused: one page, one process, local-only. No auth, no multi-user.
