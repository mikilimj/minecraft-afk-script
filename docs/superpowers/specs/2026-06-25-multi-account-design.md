# Multi-Account Support — Design

**Date:** 2026-06-25
**Status:** Approved, pending implementation plan

## Goal

Let the AFK bot run **more than one account at the same time** — a mix of
premium (Microsoft auth) and non-premium (offline / cracked) accounts — managed
from the web UI. Each account can either inherit shared settings or override
them per-section.

## Problem with current code

`server.js` is a singleton. There is exactly one global `bot`, one `CONFIG`,
one `state` object, one `botStatus`, and one set of timers (`antiAfkInterval`,
`reconnectTimeout`, `state.transferTimeout`). Every lifecycle function
(`startBot`, `stopBot`, `scheduleReconnect`, `enterServer`, `startTransfer`,
`startAntiAfk`, `startNavigation`, and all `bot.on(...)` handlers) closes over
those globals. Running N accounts requires N independent copies of all of it.

## Architecture: `BotRunner`

Extract a **`BotRunner`** unit (class or factory closure). One instance per
account owns everything currently global:

- `bot` (the mineflayer instance)
- `state` (`phase`, `loggedIn`, `seenLobby`, `onTargetServer`, `atPosition`,
  `transferTimeout`)
- `status` (`idle` / `connecting` / `connected` / `reconnecting`)
- `antiAfkInterval`, `reconnectTimeout`
- All lifecycle methods and event handlers, moved off the module scope onto the
  runner.

The runner is constructed with:
- `accountId` — stable id, also names the runner's auth-cache subdir.
- a **resolved, flat config** (same shape as today's `CONFIG`) — the runner does
  not know about global-vs-override; it just receives the effective config.
- an **injected logger** bound to its `accountId`. Every `log` / `status` /
  `auth` WebSocket message it emits carries `accountId` so the UI routes it to
  the correct account row.

The HTTP/WS server holds a `Map<accountId, BotRunner>` and a global
**MicrosoftAuthQueue** (see below).

**What a unit does / how it's used / what it depends on:**
- `BotRunner`: runs one account's connect→login→transfer→AFK lifecycle. Used via
  `runner.start()` / `runner.stop()`. Depends on the resolved config, the
  injected logger, and `resolveServerAddress`.
- `MicrosoftAuthQueue`: serializes device-code prompts across runners. Used by
  runners calling `queue.request(accountId, msaData)` and the API calling
  `queue.skip()`. Depends on nothing but the broadcast logger.

## Config / data model

`cache/config.json` changes from a flat object to:

```jsonc
{
  "global": {
    // current DEFAULT_CONFIG: host, port, version, position, antiAfk,
    // reconnect, lobbyDelay, movementDelay, clickDelay
  },
  "accounts": [
    {
      "id": "a1",                 // stable; also names cache/nmp-cache/<id>/
      "name": "MainPremium",
      "enabled": true,
      "account": {                // ALWAYS per-account
        "username": "",
        "auth": "microsoft",      // "microsoft" = premium, "offline" = cracked
        "password": ""
      },
      "overrides": {              // the "shared vs per-account" switches
        "server": false,
        "position": true,
        "antiAfk": false,
        "reconnect": false
      },
      "server":    { "host": "", "port": 25565, "version": "1.21.4" },
      "position":  { "enabled": false, "x": 0, "y": 64, "z": 0, "yaw": 0, "pitch": 0 },
      "antiAfk":   { "enabled": true, "interval": 20000 },
      "reconnect": { "enabled": true, "delaySeconds": 30 }
    }
  ]
}
```

### Override granularity: per-section

Each account chooses, **per section**, whether to inherit the global value or
use its own. Sections that can toggle: **Server**, **Position**, **Anti-AFK**,
**Reconnect**. The **Account** section (username / auth / password) is always
per-account and has no toggle. This is the "button to choose which is more
suitable for current usage."

### Effective config

`resolveConfig(global, account)` produces a flat config in the exact shape of
today's `CONFIG`:

- For each toggleable section, use `account.<section>` when
  `account.overrides.<section>` is true, otherwise `global.<section>`.
- `username` / `auth` / `password` always come from `account.account`.
- `lobbyDelay` / `movementDelay` / `clickDelay` always come from `global`.

Runners only ever see the resolved config.

### Per-account auth cache

Today `profilesFolder` is a single shared `nmp-cache`. With multiple Microsoft
accounts, each account gets its own `profilesFolder = cache/nmp-cache/<id>/` so
premium token caches cannot collide. (To verify during implementation: whether
prismarine-auth already keys by username — the per-id subdir is the zero-cost
safe default regardless.)

### Migration: fresh start

On first load of an old flat `config.json`: its values become `global`
defaults, `accounts` starts empty. No automatic conversion into an account.
`normalizeLoadedConfig` is reworked to normalize the `{ global, accounts }`
shape (and to upgrade a legacy flat file into `global`).

## Launch behavior + Microsoft auth queue

- **Offline accounts start in parallel, immediately.** The "one login at a time"
  rule is about the **Microsoft device-code prompt only**, not about launching.
  Offline (cracked) runners never enter the queue.
- **MicrosoftAuthQueue (global, Microsoft-only):** when a premium runner's
  `onMsaCode` fires, it enqueues. Only one device-code prompt is active at a
  time. The active prompt is broadcast to the UI with its `accountId` and the
  verification URL + user code. Other premium runners wait their turn.
- **Skip:** `POST /api/auth/skip` dismisses the current account's login, stops
  that runner, and advances the queue to the next waiting premium account.
  - **To verify during implementation:** that `bot.quit()` actually aborts
    prismarine-auth's in-flight device-code polling loop rather than leaking a
    timer. If it does not, a dedicated cancellation path is required. This is a
    correctness risk, not an assumption.

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/config`            | returns `{ global, accounts }` |
| POST   | `/api/config`            | saves `{ global, accounts }` (validated) |
| POST   | `/api/accounts`          | add an account (server assigns `id`) |
| DELETE | `/api/accounts/:id`      | remove an account (stops its runner first) |
| POST   | `/api/bot/start/:id`     | start one account's runner |
| POST   | `/api/bot/stop/:id`      | stop one account's runner |
| POST   | `/api/bot/start-all`     | start all enabled accounts |
| POST   | `/api/bot/stop-all`      | stop all runners |
| POST   | `/api/auth/skip`         | skip the active Microsoft login |

Validation (port 1–65535, reconnect delay 1–3600) now runs against each
account's effective server/reconnect values.

## Web UI

- **Account list** — one card per account: name, status badge, per-account
  Start / Stop buttons, and an Enabled toggle. Add-account and Remove-account
  controls. Start-all / Stop-all buttons.
- **Settings editor** — selecting a card opens its editor. The Account section
  is always editable; Server / Position / Anti-AFK / Reconnect each have a
  "Use global / Custom" switch that, when off, greys out the fields and shows
  the inherited global values.
- **Global defaults editor** — a separate panel editing `global`.
- **Auth banner** — shows which account the current Microsoft login is for, the
  code + link, plus a **Skip** button.
- **Activity log** — each line is labelled with the account name/id (logs from
  all runners share one feed).

## WebSocket messages

All existing message types (`log`, `status`, `auth`) gain an `accountId` field.
The auth message additionally identifies the account name for display. The
front-end routes status to the matching card and labels log lines.

## Testing

- `tests/api.test.js` and `tests/config.test.js` assert the **current** flat
  config shape and `normalizeLoadedConfig` behavior. They **will break** with
  the new shape and must be updated as part of this work — not an afterthought.
- New tests:
  - `resolveConfig` — override true/false per section produces the right flat
    config.
  - `normalizeLoadedConfig` — legacy flat file upgrades into `global`; missing
    fields fill from defaults.
  - API — `{ global, accounts }` round-trips; add/remove account; per-account
    start/stop validation.
  - MicrosoftAuthQueue — only one active prompt; skip advances to next; offline
    accounts never enqueue.

## Implementation phasing

**Phase 1 — Refactor, no behavior change.** Extract `BotRunner`; drive the
single existing bot through one runner instance. Config shape unchanged. All
existing tests still pass. This de-risks the singleton→instance move.

**Phase 2 — Multi-account.** Config becomes `{ global, accounts }`; server holds
a `Map` of runners; add per-account API + UI; add the MicrosoftAuthQueue; update
and add tests.

## Out of scope (YAGNI)

- Per-account independent target servers beyond the per-section Server override
  already specified.
- Account groups / profiles / import-export.
- Auth methods other than `offline` and `microsoft`.
- Concurrency limits / staggered-launch throttling (can be added later if the
  server rejects rapid joins).
