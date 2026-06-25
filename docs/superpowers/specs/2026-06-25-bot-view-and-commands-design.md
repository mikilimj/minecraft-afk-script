# Bot 3D View, Inventory & Command Panel — Design

**Date:** 2026-06-25
**Status:** Approved (design), pending spec review

## Context

The multi-account AFK dashboard (`server.js`, `botRunner.js`, `public/`) currently
manages bots through text-only controls: start/stop, per-account config overrides,
and an activity log. There is no way to *see* what a bot sees, inspect its
inventory, or drive bots interactively (move, chat, attack, autoclick).

This change adds three operator capabilities on top of the existing dashboard:

1. **3D live view** of what each bot sees (third-person freecam + first-person POV),
   embeddable inline on the main page and openable as a standalone browser tab.
2. **Inventory panel** showing each bot's current 36-slot inventory.
3. **Command panel** to drive one, several, or all bots at once — movement
   (pathfind XYZ or manual WASD), chat/commands, attack, and a configurable
   autoclicker.

## Non-Goals

- Scouting terrain far from the bot (impossible — see 3D View constraints).
- Recording/streaming video files. The 3D view is a live WebGL render only.
- Block editing / building via the viewer.

---

## 1. 3D Bot View

### Approach

Use `prismarine-viewer` (now installed) in its mineflayer mode. Each bot gets its
own viewer instance — a self-contained Express + socket.io server on a dedicated
port — embedded in the dashboard via an `<iframe>`.

`mineflayerViewer(bot, { port, viewDistance, firstPerson })`:
- Sets `bot.viewer` with a `close()` method (`http.close()` + socket disconnect)
  — verified in `node_modules/prismarine-viewer/lib/mineflayer.js`. This gives us
  clean teardown to free the port.
- The stock client (served at the viewer port root) already ships **`MapControls`**
  (WASD move, Space/Shift up-down, mouse rotate/pan/dolly) for third-person mode,
  and `setFirstPersonCamera` for `firstPerson: true`. This is our freecam — no
  custom client bundle needed.

### Lifecycle (the load-bearing part)

- **Port allocation by accountId, not array index.** Server keeps
  `viewerPorts = new Map()` (`accountId -> port`). Allocate the lowest free port
  from a base (e.g. `3100`) on first open; keep it pinned to that account so
  restarts reuse the same port and the iframe URL stays stable. Never key off
  `accounts.indexOf` — removing an account would shift every other bot's port.
- **Lazy start.** A viewer is created only when the operator opens that bot's view
  (each viewer holds its own chunk cache; eager viewers for every running bot is
  real memory cost). New REST endpoint `POST /api/bot/view/:id` → ensures the
  viewer is running, returns `{ port }`. `DELETE /api/bot/view/:id` → `close()`.
- **Bound to bot identity, not BotRunner.** `BotRunner.start()` recreates
  `this.bot` on every (re)connect, so `bot.viewer` lives on a stale object after a
  reconnect. `BotRunner` owns viewer lifecycle:
  - `startViewer(port)` — stores desired port + firstPerson flag, and if the bot
    has spawned (`bot.entity` exists) calls `mineflayerViewer`. Must be called
    after spawn (viewer reads `bot.entity.position` at construction).
  - On each fresh spawn, if a viewer port was requested, re-attach the viewer to
    the new bot on the same port.
  - `stopViewer()` — `bot.viewer?.close()`, clear the requested port.
  - `stop()` also tears down the viewer.

### Modes (Follow / Free / POV)

- **Free (default, `firstPerson: false`):** MapControls freecam — fly the camera
  with WASD + mouse around the loaded area.
- **POV (`firstPerson: true`):** camera locked to the bot's eyes/yaw/pitch.
- Toggling mode restarts that bot's viewer with the new `firstPerson` flag
  (cheap: `close()` + re-create on the same port). UI exposes a Free/POV toggle.
- Note: in third-person the camera target recenters when the bot *moves*; for a
  mostly-stationary AFK bot this is a non-issue.

### Constraints (must be surfaced to the user)

- **Chunk-bound.** The viewer only has the chunks the bot itself received from the
  server (~`viewDistance`, default 6, capped by server render distance). The
  camera can fly freely *within that bubble*; beyond it is empty void. You cannot
  scout distant terrain — that data does not exist on the bot.

### UI placement

- **Inline:** a collapsible "3D View" panel on each account card (iframe to the
  bot's viewer port). Collapsed by default so viewers stay lazy.
- **Standalone tab:** `public/view.html?id=<accountId>` — full-window iframe +
  the Free/POV toggle, opened via a "Pop out" link. Reuses the same REST endpoints.

---

## 2. Inventory Panel

### Approach

`BotRunner` listens to inventory-changing events and broadcasts a snapshot.

- On spawn and on `playerCollect` / window updates (`bot.inventory.on('updateSlot')`),
  emit a throttled snapshot: `bot.inventory.slots` mapped to
  `{ slot, name, displayName, count }` (null for empty). 36 player slots
  (9 hotbar + 27 main), plus optionally armor/offhand.
- New WS message: `{ type: 'inventory', accountId, slots: [...] }`, sent through
  the existing `broadcast()` in `server.js`. `BotRunner` gets an
  `onInventory(accountId, slots)` callback wired in `makeRunner()`, mirroring the
  existing `setStatus`/`log` callback pattern.
- Throttle to ~once per 500ms per bot to avoid WS spam.

### UI

- Inventory grid on each account card (collapsible, like the 3D view): 9×4 slot
  grid, each cell shows item count; hover shows `displayName`. Empty slots greyed.
- Frontend caches latest inventory per accountId; re-renders the matching card on
  each `inventory` message (mirrors `applyStatus`).

---

## 3. Command Panel

A new "Commands" section in `index.html` (below the accounts panel), wired in
`app.js`. All actions target the **currently selected bots**.

### Bot selector

- Checkbox list of all accounts (by name), kept in sync with the accounts list.
- **Select All** / **Clear All** buttons.
- Selection lives in frontend state; each command POST includes the selected
  `accountId[]`.

### Server-side command dispatch

New endpoint `POST /api/bot/command` with body `{ ids: [...], action, params }`.
Server looks up each runner and calls a new `BotRunner` method per action. Unknown
ids / idle runners are skipped (returns per-id results). Actions:

| Action | params | BotRunner behavior |
|--------|--------|--------------------|
| `chat` | `{ text }` | `bot.chat(text)` (works for chat + slash commands) |
| `gotoXYZ` | `{ x, y, z }` | set Movements + `pathfinder.setGoal(new GoalXYZ(...))` (reuse `startNavigation` pattern) |
| `control` | `{ key, state }` | `bot.setControlState(key, state)` — key ∈ forward/back/left/right/jump/sneak/sprint |
| `clearControls` | — | release all control states |
| `attack` | `{ target? }` | attack nearest hostile/entity, or named entity if given (`bot.attack(entity)` + `bot.swingArm()`) |
| `autoclick` | `{ mode, intervalMs, on }` | start/stop an interval; `mode` left = `attack`+`swingArm` on nearest entity, right = `activateItem` |

`BotRunner` owns the autoclicker interval (one per bot) and clears it in `stop()`
alongside the other timers, so a stopped/reconnecting bot never leaks a clicker.

### Command panel UI

- **Movement type toggle** (radio): *Pathfind (XYZ)* or *Manual (WASD)*.
  - Pathfind: X/Y/Z number inputs + **Go** → `gotoXYZ`.
  - Manual: on-screen W/A/S/D/Space/Shift buttons (press = `control` state true,
    release = false; also keyboard-driven while the panel is focused) +
    **Stop** → `clearControls`.
- **Chat / command input:** text field + **Send** → `chat`.
- **Attack:** **Attack nearest** button + optional entity-name input → `attack`.
- **Autoclicker:** mode select (Left-click attack / Right-click use), interval
  input (ms, default 200), **Start** / **Stop** toggle → `autoclick`.

---

## Affected files

- `package.json` — add `prismarine-viewer` dependency (done).
- `botRunner.js` — viewer lifecycle (`startViewer`/`stopViewer`, re-attach on
  spawn), inventory snapshot emit, command methods (`chat`/`goto`/`control`/
  `attack`/`autoclick`), autoclicker timer + cleanup in `stop()`.
- `server.js` — `viewerPorts` Map + port allocation; `onInventory` callback in
  `makeRunner`; endpoints: `POST/DELETE /api/bot/view/:id`,
  `POST /api/bot/command`. Broadcast `inventory` type.
- `public/index.html` — command panel section; per-card 3D-view + inventory
  collapsibles.
- `public/app.js` — bot-selector state + Select/Clear all; command POST helpers;
  inventory render + cache; viewer open/close + Free/POV toggle.
- `public/style.css` — styles for grid, command panel, collapsibles.
- `public/view.html` (new) — standalone pop-out viewer page.

## Reuse notes

- Follow the existing callback-injection pattern in `makeRunner()`
  (`server.js:42`) for `onInventory`, matching `setStatus`/`log`.
- Reuse the navigation setup in `startNavigation()` (`botRunner.js:80`) for
  `gotoXYZ` (Movements with `canDig=false`, GoalXYZ).
- Frontend: mirror `applyStatus()` (`app.js`) for per-card `inventory` updates.
- Broadcast via existing `broadcast(type, payload)` (`server.js:24`).

## Verification

1. `npm test` — existing suite still green (api/config/resolve/msaQueue/srv).
2. Manual, against a real server with at least 2 accounts:
   - Start 2 bots. Open 3D view on each → two iframes render distinct POVs on
     distinct ports. Toggle Free/POV. Confirm WASD/mouse freecam works in Free.
   - Remove a non-last account, restart another → its viewer port is unchanged
     (no index drift), iframe still loads.
   - Stop a bot → its viewer port frees (re-open works without "EADDRINUSE").
   - Force a reconnect (kick) → after respawn the viewer re-attaches on the same
     port and shows the new world.
   - Inventory grid updates when the bot picks up / drops items.
   - Command panel: select 2 bots, Send `/help` → both chat. Pathfind to XYZ →
     both walk. Manual WASD → both move; Stop releases. Attack nearest. Autoclick
     start (200ms) → repeated swings; Stop halts; stopping the bot also halts.
   - Select All / Clear All toggles every checkbox.
