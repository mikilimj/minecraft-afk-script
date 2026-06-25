# Minecraft AFK Bot

A headless Minecraft bot that connects to a server, logs in, navigates through a
lobby/mode-selection menu onto a target game server, parks itself at a fixed
position, and keeps the connection alive indefinitely — all controlled from a
small web UI. It is built for keeping an account "AFK" (away-from-keyboard) on a
server without leaving a real game client running.

## What it does

- **Connects and stays connected.** Joins a Minecraft server and reconnects
  automatically (configurable delay) on kick, error, or dropped connection.
- **Handles login.** Supports both offline/"cracked" auth and Microsoft
  (premium) auth. For offline servers it watches chat for `register`/`login`
  prompts and replies with `/register` and `/login` using a configured password.
  For Microsoft auth it surfaces the device-login code/URL in the web UI.
- **Navigates the lobby.** Opens a hotbar mode-selection menu and clicks the
  Survival slot to transfer to the actual game server, smoothing over the
  server-transfer handshake (resource packs, configuration phase, etc.).
- **Holds a position.** Optionally pathfinds to a fixed X/Y/Z and faces a set
  yaw/pitch, then idles there.
- **Stays awake.** An anti-AFK routine periodically nudges the bot's view so the
  server doesn't time it out as idle.
- **Web UI + live log.** Configure everything, start/stop the bot, and watch a
  real-time activity log in the browser.

## How it works

The whole app is a single Node process ([index.js](index.js) →
[server.js](server.js)) serving both the bot and the UI:

- **Web server** — [Express](https://expressjs.com/) serves the static UI from
  [public/](public/) and a small REST API (`/api/config`, `/api/bot/start`,
  `/api/bot/stop`). A WebSocket (`ws`) pushes status changes and log lines to the
  browser in real time.
- **The bot** — built on [mineflayer](https://github.com/PrismarineJS/mineflayer)
  with [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)
  for navigation. The bot is driven by a small state machine
  (`LOBBY → MODE_SELECT → TRANSFER → SERVER`) reacting to mineflayer events
  (`spawn`, `message`, `windowOpen`, `goal_reached`, `death`, `kicked`, `end`).
- **Server transfer** — during the `TRANSFER` phase the bot intercepts the
  low-level protocol client to suppress movement/interaction packets and to
  auto-accept the destination server's resource pack, then resumes normally once
  the configuration phase finishes.
- **SRV resolution** — at connect time the host is resolved via its
  `_minecraft._tcp.<host>` SRV record with retries (`resolveServerAddress`),
  working around flaky DNS that would otherwise leave mineflayer with "no
  address."
- **Config persistence** — settings are saved to `cache/config.json`. Loading
  normalizes the config and migrates older/Polish-named keys to the current
  schema. Microsoft auth sessions are cached under `cache/nmp-cache/`.

> The `cache/` directory holds your config (including credentials) and auth
> sessions, and is git-ignored.

## Requirements

- [Node.js](https://nodejs.org/) (a recent LTS; Express 5 requires Node 18+)
- npm

## Setup

```bash
npm install
```

## Launch

```bash
npm start
```

Then open the web UI at **http://localhost:3006**.

(The port is set in [index.js](index.js) via `start(3006)`.)

## Using it

1. Open http://localhost:3006.
2. Fill in the settings:
   - **Server** — host, port, and Minecraft version (e.g. `1.21.4`).
   - **Account** — username/email, auth type (Offline or Microsoft), and an
     optional password used for chat-based `/login` on offline servers (leave
     empty to skip).
   - **AFK Position** — toggle on and set X/Y/Z plus yaw/pitch to have the bot
     pathfind to and face a fixed spot. Leave off to stand at spawn.
   - **Anti-AFK** — toggle and set the nudge interval (ms).
   - **Auto-Reconnect** — toggle and set the reconnect delay (seconds).
3. Click **Save Settings**.
4. Click **Connect** to start the bot, **Disconnect** to stop it.
5. Watch the **Activity Log** for connection, login, navigation, and chat events.
   If Microsoft auth is required, a banner shows the login code and link.

## Testing

```bash
npm test
```

Runs the Jest suite in [tests/](tests/) (config normalization, REST API, and SRV
resolution).
