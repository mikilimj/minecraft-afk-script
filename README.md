# Minecraft AFK Bot

A headless Minecraft bot that connects to a server, logs in, navigates through a
lobby/mode-selection menu onto a target game server, parks itself at a fixed
position, and keeps the connection alive indefinitely — all controlled from a
small web UI. It is built for keeping an account "AFK" (away-from-keyboard) on a
server without leaving a real game client running.

## What it does

- **Runs multiple accounts at once.** Manage a list of accounts in the web UI —
  any mix of premium (Microsoft) and non-premium (offline) — each with its own
  bot, status, and start/stop control. Shared settings live in a global-defaults
  panel; each account can override any section (server, position, anti-AFK,
  reconnect) individually via a per-section "Use global / Custom" toggle.
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
  [public/](public/) and a REST API: `/api/config` (the `{ global, accounts }`
  document), `/api/accounts` (add) and `/api/accounts/:id` (remove),
  `/api/bot/start/:id` and `/api/bot/stop/:id` (per account),
  `/api/bot/start-all` and `/api/bot/stop-all`, and `/api/auth/skip`. A WebSocket
  (`ws`) pushes status changes and log lines — each tagged with its `accountId` —
  to the browser in real time.
- **The bots** — each account runs in its own `BotRunner`
  ([botRunner.js](botRunner.js)) instance, built on
  [mineflayer](https://github.com/PrismarineJS/mineflayer) with
  [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)
  for navigation. Each runner is driven by a small state machine
  (`LOBBY → MODE_SELECT → TRANSFER → SERVER`) reacting to mineflayer events
  (`spawn`, `message`, `windowOpen`, `goal_reached`, `death`, `kicked`, `end`).
  The server holds a `Map<accountId, BotRunner>` ([server.js](server.js)) and
  resolves each account's effective settings (`resolveConfig` in
  [config.js](config.js)) from the global defaults plus that account's overrides.
- **Microsoft login queue** — offline accounts start in parallel immediately;
  premium accounts that need a device-code login go through a global
  one-at-a-time queue ([msaQueue.js](msaQueue.js)). The active prompt's code/link
  is shown in the UI with the account's name, and a **Skip** button moves on to
  the next waiting account.
- **Server transfer** — during the `TRANSFER` phase the bot intercepts the
  low-level protocol client to suppress movement/interaction packets and to
  auto-accept the destination server's resource pack, then resumes normally once
  the configuration phase finishes.
- **SRV resolution** — at connect time the host is resolved via its
  `_minecraft._tcp.<host>` SRV record with retries (`resolveServerAddress`),
  working around flaky DNS that would otherwise leave mineflayer with "no
  address."
- **Config persistence** — settings are saved to `cache/config.json` as a
  `{ global, accounts }` document. Loading normalizes the config (and migrates an
  older single-account flat file into the `global` defaults, starting with an
  empty account list). Each account's Microsoft auth session is cached under its
  own `cache/nmp-cache/<accountId>/` so premium tokens never collide.

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
2. Set the **Global defaults** — the settings every account inherits unless it
   overrides them:
   - **Server** — host, port, and Minecraft version (e.g. `1.21.4`).
   - **AFK Position** — toggle on and set X/Y/Z plus yaw/pitch to have a bot
     pathfind to and face a fixed spot. Leave off to stand at spawn.
   - **Anti-AFK** — toggle and set the nudge interval (ms).
   - **Auto-Reconnect** — toggle and set the reconnect delay (seconds).
3. Click **Add account** and fill in each account:
   - **Account** — name, username/email, auth type (Offline or Microsoft), and an
     optional password used for chat-based `/login` on offline servers (leave
     empty to skip).
   - For any section (Server, Position, Anti-AFK, Reconnect), flip its
     **Use global / Custom** toggle to **Custom** to give that account its own
     values; leave it on **Use global** to inherit the defaults. This lets you,
     for example, point most accounts at one server while parking each on a
     different position.
4. Click **Save Settings**.
5. Start a single account with its **Start** button, or **Start all** to launch
   every enabled account. **Stop** / **Stop all** halt them. Offline accounts
   connect right away; premium accounts requiring a Microsoft login show a code
   one at a time — enter it, or click **Skip** to move to the next account.
6. Watch the **Activity Log** (each line labelled with its account) for
   connection, login, navigation, and chat events.

## Testing

```bash
npm test
```

Runs the Jest suite in [tests/](tests/): config normalization and migration
(`config.test.js`), per-account settings resolution (`resolve.test.js`), the
Microsoft auth queue (`msaQueue.test.js`), the REST API (`api.test.js`), and SRV
resolution (`srv.test.js`). The API tests redirect the cache directory to a temp
folder (`AFK_CACHE_DIR`), so running them never touches your real
`cache/config.json`.
