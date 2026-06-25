# Multi-Account Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run multiple Minecraft accounts at once (mix of premium/Microsoft and non-premium/offline), each managed from the web UI with per-section inherit-or-override settings.

**Architecture:** Extract the current singleton (`bot`, `state`, `botStatus`, timers, lifecycle functions) into a `BotRunner` class — one instance per account. The server holds a `Map<accountId, BotRunner>`. Config becomes `{ global, accounts }`; `resolveConfig` flattens each account to the runner's expected shape. A global `MicrosoftAuthQueue` serializes device-code logins (Microsoft-only); offline accounts launch in parallel.

**Tech Stack:** Node.js, Express 5, `ws`, mineflayer, mineflayer-pathfinder, Jest + supertest. Vanilla JS/HTML/CSS front-end.

## Global Constraints

- Node `require`/CommonJS modules (match existing `server.js` style); no TypeScript, no ESM.
- `auth` values are exactly `"offline"` (non-premium/cracked) and `"microsoft"` (premium). No other auth methods.
- Port validation: integer 1–65535. Reconnect delay: integer 1–3600 seconds.
- Config file path: `cache/config.json`. Microsoft token caches: `cache/nmp-cache/<accountId>/`.
- Tests run with `npm test` (Jest, `forceExit: true`). Each task ends green.
- Existing public behavior (single-bot connect→login→mode-select→transfer→AFK flow) must be preserved through Phase 1 with **no functional change**.
- Commit messages end with the existing project trailer style. Co-author line:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `util.js` (new) | `stripColors`, `extractChatText`, `resolveServerAddress`, console-noise suppression. Pure helpers, no module state. |
| `config.js` (new) | `DEFAULT_GLOBAL`, `DEFAULT_ACCOUNT`, `makeAccount`, `normalizeConfig`, `resolveConfig`, `loadConfig`, `saveConfig`. Owns the `{ global, accounts }` model and `cache/config.json` I/O. |
| `botRunner.js` (new) | `BotRunner` class: one account's full lifecycle. No module globals. |
| `msaQueue.js` (new) | `MicrosoftAuthQueue` class: serialize Microsoft device-code prompts across runners. |
| `server.js` (modify) | Express app, WebSocket server, `Map<accountId, BotRunner>`, REST API, broadcast/log, `start()`. Wires the modules together. |
| `public/index.html`, `public/app.js`, `public/style.css` (modify) | Account-list UI, per-account editors with per-section override toggles, global-defaults editor, auth banner with Skip, account-labelled log. |
| `tests/*` (modify/add) | Update `api.test.js`, `config.test.js` for new shape; add `resolve.test.js`, `msaQueue.test.js`. `srv.test.js` keeps working via re-export. |

---

# Phase 1 — Refactor to BotRunner (no behavior change)

Goal of this phase: the app behaves identically, but the singleton is encapsulated. All **existing** tests stay green throughout.

## Task 1: Extract pure helpers into `util.js`

**Files:**
- Create: `util.js`
- Modify: `server.js:12-18` (console suppression), `server.js:103-122` (`stripColors`, `extractChatText`), `server.js:250-270` (`resolveServerAddress`)
- Test: existing `tests/srv.test.js` (no change)

**Interfaces:**
- Produces: `module.exports = { stripColors, extractChatText, resolveServerAddress, installConsoleFilter, _log, _warn, _error }`.
  - `resolveServerAddress(host, port, opts?) -> Promise<{host, port}>` (unchanged signature/behavior, used by `srv.test.js`).
  - `installConsoleFilter()` installs the "chunk size is" filters and returns `{ _log, _warn, _error }` (the saved originals).

- [ ] **Step 1: Create `util.js` with the helpers moved verbatim**

```js
// util.js
const net = require('net');
const dns = require('dns').promises;

const _warn  = console.warn;
const _error = console.error;
const _log   = console.log;

function installConsoleFilter() {
  const noisy = (a) => typeof a[0] === 'string' && a[0].toLowerCase().includes('chunk size is');
  console.warn  = (...a) => { if (noisy(a)) return; _warn(...a); };
  console.error = (...a) => {
    if (noisy(a)) return;
    if (a[0] instanceof Error && a[0].message.toLowerCase().includes('chunk size is')) return;
    _error(...a);
  };
  console.log   = (...a) => { if (noisy(a)) return; _log(...a); };
  return { _log, _warn, _error };
}

function extractChatText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return String(obj);
  if (Array.isArray(obj)) return obj.map(extractChatText).join('');
  let r = '';
  if (obj.text      !== undefined) r += obj.text;
  if (obj.translate !== undefined) r += obj.translate;
  if (Array.isArray(obj.extra))    r += obj.extra.map(extractChatText).join('');
  return r;
}

function stripColors(text) {
  if (!text) return '';
  let plain = text;
  if (typeof text === 'object') {
    try { plain = extractChatText(text) || JSON.stringify(text); } catch { plain = String(text); }
  } else { plain = String(text); }
  return plain.replace(/§[0-9a-fk-orA-FK-OR]/g, '').trim();
}

async function resolveServerAddress(host, port, { resolveSrv = dns.resolveSrv, retries = 3, retryDelayMs = 400 } = {}) {
  if (net.isIP(host)) return { host, port };
  for (let attempt = 0; ; attempt++) {
    try {
      const records = await resolveSrv(`_minecraft._tcp.${host}`);
      if (records && records.length > 0) return { host: records[0].name, port: records[0].port };
      return { host, port };
    } catch (err) {
      if (err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND')) return { host, port };
      if (attempt >= retries) return { host, port };
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

module.exports = { stripColors, extractChatText, resolveServerAddress, installConsoleFilter, _log, _warn, _error };
```

- [ ] **Step 2: Update `server.js` to consume `util.js`**

At the top of `server.js`, remove the inline console suppression block (lines 12-18), the `stripColors`/`extractChatText` definitions, and the `resolveServerAddress` definition. Replace with:

```js
const { stripColors, extractChatText, resolveServerAddress, installConsoleFilter, _log, _warn, _error } = require('./util');
installConsoleFilter();
```

Keep `server.js` re-exporting `resolveServerAddress` so `srv.test.js` still imports it from `./server`:

```js
module.exports = { app, normalizeLoadedConfig, resolveServerAddress, start };
```

- [ ] **Step 3: Run the existing suite, expect green**

Run: `npm test`
Expected: PASS — `srv.test.js`, `config.test.js`, `api.test.js` all pass (no behavior changed).

- [ ] **Step 4: Commit**

```bash
git add util.js server.js
git commit -m "refactor: extract pure helpers into util.js

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Extract config into `config.js` (flat shape, behavior-preserving)

**Files:**
- Create: `config.js`
- Modify: `server.js:20-80` (CONFIG constants + load/save), `server.js:431-444` (config API still uses these)
- Test: existing `tests/config.test.js` (no change — still imports `normalizeLoadedConfig` from `./server`)

**Interfaces:**
- Produces: `module.exports = { DEFAULT_CONFIG, normalizeLoadedConfig, CACHE_DIR, CONFIG_FILE, loadConfigFile, saveConfigFile }`.
  - `normalizeLoadedConfig(parsed) -> flatConfig` — **unchanged** from current behavior (Phase 2 replaces it).
  - `loadConfigFile() -> flatConfig` reads `cache/config.json` (creates dir/defaults if missing), returns normalized config.
  - `saveConfigFile(config) -> void` writes it.

- [ ] **Step 1: Create `config.js` by moving the current config code verbatim**

```js
// config.js
const fs = require('fs');
const path = require('path');
const { _error } = require('./util');

const CACHE_DIR   = path.join(__dirname, 'cache');
const CONFIG_FILE = path.join(CACHE_DIR, 'config.json');

const DEFAULT_CONFIG = {
  host: '', port: 25565, username: '', version: '1.21.4', auth: 'offline', password: '',
  position: { enabled: false, x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
  antiAfk:  { enabled: true, interval: 20000 },
  reconnect: { enabled: true, delaySeconds: 30 },
  lobbyDelay: 2000, movementDelay: 3000, clickDelay: 700,
};

function normalizeLoadedConfig(parsed) {
  // ⇩ moved verbatim from server.js:32-63 (the existing legacy-key merge)
  const legacyPos    = parsed.position ?? parsed.pozycja  ?? {};
  const legacyAntiAfk = parsed.antiAfk  ?? parsed.antiAFK ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    password: parsed.password ?? parsed.haslo ?? DEFAULT_CONFIG.password,
    position: {
      ...DEFAULT_CONFIG.position, ...(parsed.position ?? {}),
      enabled: parsed.position?.enabled ?? legacyPos.wlaczone ?? DEFAULT_CONFIG.position.enabled,
      x: parsed.position?.x ?? legacyPos.x ?? DEFAULT_CONFIG.position.x,
      y: parsed.position?.y ?? legacyPos.y ?? DEFAULT_CONFIG.position.y,
      z: parsed.position?.z ?? legacyPos.z ?? DEFAULT_CONFIG.position.z,
      yaw: parsed.position?.yaw ?? legacyPos.yaw ?? DEFAULT_CONFIG.position.yaw,
      pitch: parsed.position?.pitch ?? legacyPos.pitch ?? DEFAULT_CONFIG.position.pitch,
    },
    antiAfk: {
      ...DEFAULT_CONFIG.antiAfk, ...(parsed.antiAfk ?? {}),
      enabled: parsed.antiAfk?.enabled ?? legacyAntiAfk.wlaczone ?? DEFAULT_CONFIG.antiAfk.enabled,
      interval: parsed.antiAfk?.interval ?? legacyAntiAfk.interwal ?? DEFAULT_CONFIG.antiAfk.interval,
    },
    reconnect: { ...DEFAULT_CONFIG.reconnect, ...(parsed.reconnect ?? {}) },
    lobbyDelay:    parsed.lobbyDelay    ?? parsed.opoznienieLobby ?? DEFAULT_CONFIG.lobbyDelay,
    movementDelay: parsed.movementDelay ?? parsed.opoznienieRuchu ?? DEFAULT_CONFIG.movementDelay,
    clickDelay:    parsed.clickDelay    ?? parsed.opoznienieKlik  ?? DEFAULT_CONFIG.clickDelay,
  };
}

function loadConfigFile() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = normalizeLoadedConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
      saveConfigFile(cfg);
      return cfg;
    } catch (err) { _error('Error reading config.json:', err.message); }
  }
  const cfg = { ...DEFAULT_CONFIG };
  saveConfigFile(cfg);
  return cfg;
}

function saveConfigFile(config) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8'); }
  catch (err) { _error('Error writing config.json:', err.message); }
}

module.exports = { DEFAULT_CONFIG, normalizeLoadedConfig, CACHE_DIR, CONFIG_FILE, loadConfigFile, saveConfigFile };
```

- [ ] **Step 2: Rewire `server.js` to use `config.js`**

Remove `server.js:20-80` (the CONFIG block, `saveConfig`, `loadConfig`). Replace with:

```js
const { DEFAULT_CONFIG, normalizeLoadedConfig, CACHE_DIR, CONFIG_FILE, loadConfigFile, saveConfigFile } = require('./config');

let CONFIG = { ...DEFAULT_CONFIG };
```

Replace the body of `loadConfig`/`saveConfig` call sites: in `start()`, `CONFIG = loadConfigFile();`. In `POST /api/config`, after `CONFIG = normalizeLoadedConfig(body);` call `saveConfigFile(CONFIG);`. Keep `module.exports.normalizeLoadedConfig = normalizeLoadedConfig` (re-export for `config.test.js`).

- [ ] **Step 3: Run the suite, expect green**

Run: `npm test`
Expected: PASS — `config.test.js` still passes against re-exported `normalizeLoadedConfig`; `api.test.js` config round-trip unchanged.

- [ ] **Step 4: Commit**

```bash
git add config.js server.js
git commit -m "refactor: extract config model into config.js

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Extract the bot lifecycle into `BotRunner` (single instance)

**Files:**
- Create: `botRunner.js`
- Modify: `server.js` (replace globals `bot`, `state`, `botStatus`, `antiAfkInterval`, `reconnectTimeout` and functions `startBot`/`stopBot`/`scheduleReconnect`/`startAntiAfk`/`clearAntiAfk`/`startNavigation`/`enterServer`/`startTransfer`/`onArriveAtTargetServer` with one `BotRunner` instance)
- Test: existing `tests/api.test.js` (no change)

**Interfaces:**
- Consumes: `resolveServerAddress`, `stripColors` from `util.js`; `BLOCKED_TRANSFER_PACKETS` (move into `botRunner.js`).
- Produces: `class BotRunner` with:
  - constructor `new BotRunner({ config, profilesFolder, log, setStatus, onAuth })`
    - `config`: flat config (today's `CONFIG` shape).
    - `profilesFolder`: string path for mineflayer token cache.
    - `log(level, text)`: injected logger.
    - `setStatus(state)`: injected status callback (`'idle'|'connecting'|'connected'|'reconnecting'`).
    - `onAuth({ verification_uri, user_code })`: injected MSA prompt callback.
  - `async start()` — begins the connect lifecycle.
  - `stop()` — tears the bot down, clears timers, sets idle.
  - `get status()` — current status string.

- [ ] **Step 1: Create `botRunner.js` — class wrapping the existing lifecycle**

Move the lifecycle code from `server.js` into the class **verbatim**, applying these exact substitutions to every moved line:

| In old `server.js` | In `BotRunner` |
|--------------------|----------------|
| `bot` | `this.bot` |
| `state` | `this.state` |
| `botStatus` | `this.status` (backing field `this._status`) |
| `antiAfkInterval` | `this.antiAfkInterval` |
| `reconnectTimeout` | `this.reconnectTimeout` |
| `CONFIG` | `this.config` |
| `log(lvl, txt)` | `this.log(lvl, txt)` |
| `setStatus(s)` | `this._setStatus(s)` |
| `broadcast('auth', d)` | `this.onAuth(d)` |
| `startBot()` etc. (calls) | `this.startBot()` etc. |

```js
// botRunner.js
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const GoalXYZ = goals.GoalXYZ;
const { stripColors, resolveServerAddress } = require('./util');

const BLOCKED_TRANSFER_PACKETS = new Set([
  'position', 'position_look', 'look', 'flying', 'window_close',
  'window_click', 'held_item_slot', 'arm_animation', 'entity_action', 'vehicle_move',
]);

class BotRunner {
  constructor({ config, profilesFolder, log, setStatus, onAuth }) {
    this.config = config;
    this.profilesFolder = profilesFolder;
    this.log = log;
    this._setStatusCb = setStatus;
    this.onAuth = onAuth || (() => {});
    this.bot = null;
    this._status = 'idle';
    this.antiAfkInterval = null;
    this.reconnectTimeout = null;
    this.state = {
      phase: 'LOBBY', loggedIn: false, seenLobby: false,
      onTargetServer: false, atPosition: false, transferTimeout: null,
    };
  }

  get status() { return this._status; }
  _setStatus(s) { this._status = s; this._setStatusCb(s); }

  // ── methods below are server.js:124-407 moved verbatim with the
  //    substitutions in the table above. Method names map 1:1 to the old
  //    function names: startAntiAfk, clearAntiAfk, scheduleReconnect,
  //    startNavigation, enterServer, startTransfer, onArriveAtTargetServer,
  //    stopBot (-> stop), startBot (-> start).

  startAntiAfk() { /* server.js:125-137 body, with substitutions */ }
  clearAntiAfk() { /* server.js:139-141 */ }
  scheduleReconnect() { /* server.js:144-170, calls this.startBot() */ }
  startNavigation() { /* server.js:173-187 */ }
  enterServer() { /* server.js:190-198 */ }
  startTransfer() { /* server.js:200-211 */ }
  onArriveAtTargetServer() { /* server.js:213-228 */ }

  stop() { /* server.js:231-241 stopBot() body, sets this._setStatus('idle') */ }

  async start() {
    // server.js:272-407 startBot() body, with substitutions, EXCEPT:
    //  - profilesFolder: this.profilesFolder  (was path.join(CACHE_DIR,'nmp-cache'))
    //  - onMsaCode handler calls this.onAuth({ verification_uri, user_code })
    //    in addition to this.log(...) lines (server.js:291-295)
  }
}

module.exports = { BotRunner, BLOCKED_TRANSFER_PACKETS };
```

> Implementer note: the method bodies are a mechanical move of `server.js:124-407`. Do not change control flow, timings, or log strings — Phase 1 is behavior-preserving. The only semantic edits are the three bullets in the `start()` comment.

- [ ] **Step 2: Rewire `server.js` to own one `BotRunner`**

Remove the moved globals and functions from `server.js`. Add:

```js
const path = require('path');
const { BotRunner } = require('./botRunner');

let runner = null;

function makeRunner() {
  return new BotRunner({
    config: CONFIG,
    profilesFolder: path.join(CACHE_DIR, 'nmp-cache'),
    log,                                   // existing module log(level,text)
    setStatus,                             // existing module setStatus(state)
    onAuth: (d) => broadcast('auth', d),
  });
}
```

Update the API handlers:

```js
app.post('/api/bot/start', (_req, res) => {
  if (runner && runner.status !== 'idle') return res.json({ ok: false, reason: 'already running' });
  runner = makeRunner();
  runner.start().catch((err) => { log('error', `Failed to start bot: ${err.message}`); setStatus('idle'); });
  res.json({ ok: true });
});

app.post('/api/bot/stop', (_req, res) => {
  if (runner) runner.stop();
  res.json({ ok: true });
});
```

`setStatus` keeps its current single-arg signature in Phase 1.

- [ ] **Step 3: Run the suite, expect green**

Run: `npm test`
Expected: PASS — `api.test.js` start/stop endpoints behave identically.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run: `node index.js`, open the UI, Connect to a known server, confirm connect→login→AFK works exactly as before, then Disconnect. Expected: identical behavior to pre-refactor.

- [ ] **Step 5: Commit**

```bash
git add botRunner.js server.js
git commit -m "refactor: extract bot lifecycle into BotRunner class

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 2 — Multi-account

## Task 4: New config model — `{ global, accounts }` + `resolveConfig`

**Files:**
- Modify: `config.js` (add new model + migration; keep `normalizeLoadedConfig` for flat-shape, now used only as the per-section normalizer)
- Test: Create `tests/resolve.test.js`; rewrite `tests/config.test.js`

**Interfaces:**
- Produces (added to `config.js` exports):
  - `DEFAULT_GLOBAL` — the section defaults: `{ server:{host,port,version}, position, antiAfk, reconnect, lobbyDelay, movementDelay, clickDelay }`.
  - `DEFAULT_ACCOUNT` — `{ id, name, enabled:true, account:{username,auth,password}, overrides:{server,position,antiAfk,reconnect}, server, position, antiAfk, reconnect }`.
  - `makeAccount(partial) -> account` — fills defaults, assigns `id` if missing (`'a'+Date.now()+random`).
  - `normalizeConfig(parsed) -> { global, accounts }` — migrates a legacy flat file into `global`, normalizes each account, dedupes ids.
  - `resolveConfig(global, account) -> flatConfig` — flat shape identical to `DEFAULT_CONFIG` (Task 2), consumed by `BotRunner`.
- `loadConfigFile`/`saveConfigFile` now read/write `{ global, accounts }`.

- [ ] **Step 1: Write failing tests for `resolveConfig`**

```js
// tests/resolve.test.js
const { resolveConfig, DEFAULT_GLOBAL, makeAccount } = require('../config');

test('inherits global section when override is false', () => {
  const global = { ...DEFAULT_GLOBAL, server: { host: 'g.host', port: 100, version: '1.20' } };
  const acc = makeAccount({ account: { username: 'bob', auth: 'offline', password: '' },
    overrides: { server: false }, server: { host: 'x', port: 1, version: 'z' } });
  const r = resolveConfig(global, acc);
  expect(r.host).toBe('g.host');
  expect(r.port).toBe(100);
  expect(r.version).toBe('1.20');
  expect(r.username).toBe('bob');
});

test('uses account section when override is true', () => {
  const global = { ...DEFAULT_GLOBAL, server: { host: 'g', port: 100, version: '1.20' } };
  const acc = makeAccount({ overrides: { server: true }, server: { host: 'own', port: 200, version: '1.21' } });
  const r = resolveConfig(global, acc);
  expect(r.host).toBe('own');
  expect(r.port).toBe(200);
});

test('account credentials always win regardless of overrides', () => {
  const acc = makeAccount({ account: { username: 'neo', auth: 'microsoft', password: 'pw' } });
  const r = resolveConfig(DEFAULT_GLOBAL, acc);
  expect(r.username).toBe('neo');
  expect(r.auth).toBe('microsoft');
  expect(r.password).toBe('pw');
});

test('global-only delays pass through', () => {
  const global = { ...DEFAULT_GLOBAL, lobbyDelay: 1234 };
  const r = resolveConfig(global, makeAccount({}));
  expect(r.lobbyDelay).toBe(1234);
});
```

```js
// tests/config.test.js  (rewrite)
const { normalizeConfig, DEFAULT_GLOBAL } = require('../config');

test('migrates a legacy flat config into global, empty accounts', () => {
  const out = normalizeConfig({ host: 'old.host', port: 5, antiAfk: { interval: 9999 } });
  expect(out.global.server.host).toBe('old.host');
  expect(out.global.server.port).toBe(5);
  expect(out.global.antiAfk.interval).toBe(9999);
  expect(out.accounts).toEqual([]);
});

test('passes through an already-new-shape config and fills account defaults', () => {
  const out = normalizeConfig({ global: { ...DEFAULT_GLOBAL },
    accounts: [{ name: 'A', account: { username: 'u', auth: 'offline', password: '' } }] });
  expect(out.accounts).toHaveLength(1);
  expect(out.accounts[0].id).toBeTruthy();
  expect(out.accounts[0].enabled).toBe(true);
  expect(out.accounts[0].overrides).toMatchObject({ server: false, position: false, antiAfk: false, reconnect: false });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- resolve.test.js config.test.js`
Expected: FAIL — `resolveConfig`, `normalizeConfig`, `DEFAULT_GLOBAL`, `makeAccount` not exported.

- [ ] **Step 3: Implement the new model in `config.js`**

```js
// add to config.js
const DEFAULT_GLOBAL = {
  server: { host: '', port: 25565, version: '1.21.4' },
  position: { enabled: false, x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
  antiAfk:  { enabled: true, interval: 20000 },
  reconnect: { enabled: true, delaySeconds: 30 },
  lobbyDelay: 2000, movementDelay: 3000, clickDelay: 700,
};

const DEFAULT_ACCOUNT = {
  id: '', name: 'Account', enabled: true,
  account: { username: '', auth: 'offline', password: '' },
  overrides: { server: false, position: false, antiAfk: false, reconnect: false },
  server: { ...DEFAULT_GLOBAL.server },
  position: { ...DEFAULT_GLOBAL.position },
  antiAfk: { ...DEFAULT_GLOBAL.antiAfk },
  reconnect: { ...DEFAULT_GLOBAL.reconnect },
};

function makeAccount(partial = {}) {
  const id = partial.id || `a${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    id,
    name: partial.name ?? DEFAULT_ACCOUNT.name,
    enabled: partial.enabled ?? true,
    account: { ...DEFAULT_ACCOUNT.account, ...(partial.account ?? {}) },
    overrides: { ...DEFAULT_ACCOUNT.overrides, ...(partial.overrides ?? {}) },
    server: { ...DEFAULT_GLOBAL.server, ...(partial.server ?? {}) },
    position: { ...DEFAULT_GLOBAL.position, ...(partial.position ?? {}) },
    antiAfk: { ...DEFAULT_GLOBAL.antiAfk, ...(partial.antiAfk ?? {}) },
    reconnect: { ...DEFAULT_GLOBAL.reconnect, ...(partial.reconnect ?? {}) },
  };
}

function normalizeGlobal(g = {}) {
  return {
    server: { ...DEFAULT_GLOBAL.server, ...(g.server ?? {}) },
    position: { ...DEFAULT_GLOBAL.position, ...(g.position ?? {}) },
    antiAfk: { ...DEFAULT_GLOBAL.antiAfk, ...(g.antiAfk ?? {}) },
    reconnect: { ...DEFAULT_GLOBAL.reconnect, ...(g.reconnect ?? {}) },
    lobbyDelay: g.lobbyDelay ?? DEFAULT_GLOBAL.lobbyDelay,
    movementDelay: g.movementDelay ?? DEFAULT_GLOBAL.movementDelay,
    clickDelay: g.clickDelay ?? DEFAULT_GLOBAL.clickDelay,
  };
}

function normalizeConfig(parsed = {}) {
  // New shape?
  if (parsed.global || parsed.accounts) {
    const seen = new Set();
    const accounts = (parsed.accounts ?? []).map((a) => {
      const acc = makeAccount(a);
      while (seen.has(acc.id)) acc.id = `a${Date.now()}${Math.floor(Math.random() * 1000)}`;
      seen.add(acc.id);
      return acc;
    });
    return { global: normalizeGlobal(parsed.global), accounts };
  }
  // Legacy flat file -> migrate into global, drop credentials (fresh-start).
  const flat = normalizeLoadedConfig(parsed);
  return {
    global: normalizeGlobal({
      server: { host: flat.host, port: flat.port, version: flat.version },
      position: flat.position, antiAfk: flat.antiAfk, reconnect: flat.reconnect,
      lobbyDelay: flat.lobbyDelay, movementDelay: flat.movementDelay, clickDelay: flat.clickDelay,
    }),
    accounts: [],
  };
}

function resolveConfig(global, account) {
  const g = normalizeGlobal(global);
  const pick = (section) => (account.overrides?.[section] ? account[section] : g[section]);
  const server = pick('server');
  return {
    host: server.host, port: server.port, version: server.version,
    username: account.account.username, auth: account.account.auth, password: account.account.password,
    position: { ...pick('position') },
    antiAfk: { ...pick('antiAfk') },
    reconnect: { ...pick('reconnect') },
    lobbyDelay: g.lobbyDelay, movementDelay: g.movementDelay, clickDelay: g.clickDelay,
  };
}
```

Update `loadConfigFile` to call `normalizeConfig` (not `normalizeLoadedConfig`) and to default to `{ global: normalizeGlobal({}), accounts: [] }` when no file exists. Update exports:

```js
module.exports = {
  DEFAULT_CONFIG, normalizeLoadedConfig, DEFAULT_GLOBAL, DEFAULT_ACCOUNT,
  makeAccount, normalizeConfig, resolveConfig,
  CACHE_DIR, CONFIG_FILE, loadConfigFile, saveConfigFile,
};
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- resolve.test.js config.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add config.js tests/resolve.test.js tests/config.test.js
git commit -m "feat: add {global,accounts} config model with resolveConfig

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `MicrosoftAuthQueue`

**Files:**
- Create: `msaQueue.js`
- Test: Create `tests/msaQueue.test.js`

**Interfaces:**
- Produces: `class MicrosoftAuthQueue`:
  - constructor `new MicrosoftAuthQueue({ broadcastActive, onSkip })`
    - `broadcastActive({ accountId, name, verification_uri, user_code } | null)` — called when the active prompt changes (null = none active).
    - `onSkip(accountId)` — called when an account is skipped (server stops that runner).
  - `request(accountId, name, msaData)` — enqueue a prompt; activates immediately if nothing active.
  - `complete(accountId)` — account finished logging in; if active, clear and activate next.
  - `remove(accountId)` — drop a queued/active account (e.g. its runner stopped); activate next if it was active.
  - `skip()` — skip the active account: calls `onSkip(activeId)`, then activates next. No-op if none active.
  - `get activeId()` — current active accountId or `null`.

- [ ] **Step 1: Write failing tests**

```js
// tests/msaQueue.test.js
const { MicrosoftAuthQueue } = require('../msaQueue');

function setup() {
  const active = [];
  const skipped = [];
  const q = new MicrosoftAuthQueue({
    broadcastActive: (p) => active.push(p),
    onSkip: (id) => skipped.push(id),
  });
  return { q, active, skipped };
}

test('first request becomes active immediately', () => {
  const { q, active } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  expect(q.activeId).toBe('a1');
  expect(active.at(-1)).toMatchObject({ accountId: 'a1', name: 'One', user_code: 'C1' });
});

test('second request waits behind the first', () => {
  const { q } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  expect(q.activeId).toBe('a1');
});

test('complete advances to the next queued account', () => {
  const { q, active } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  q.complete('a1');
  expect(q.activeId).toBe('a2');
  expect(active.at(-1)).toMatchObject({ accountId: 'a2' });
});

test('skip stops the active account and advances', () => {
  const { q, skipped } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  q.skip();
  expect(skipped).toEqual(['a1']);
  expect(q.activeId).toBe('a2');
});

test('queue empties to null active and broadcasts null', () => {
  const { q, active } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.complete('a1');
  expect(q.activeId).toBe(null);
  expect(active.at(-1)).toBe(null);
});

test('remove drops a waiting account without changing active', () => {
  const { q } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  q.remove('a2');
  q.complete('a1');
  expect(q.activeId).toBe(null);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- msaQueue.test.js`
Expected: FAIL — module not found / class undefined.

- [ ] **Step 3: Implement `msaQueue.js`**

```js
// msaQueue.js
class MicrosoftAuthQueue {
  constructor({ broadcastActive = () => {}, onSkip = () => {} } = {}) {
    this._broadcastActive = broadcastActive;
    this._onSkip = onSkip;
    this._queue = [];        // [{ accountId, name, verification_uri, user_code }]
    this._activeId = null;
  }

  get activeId() { return this._activeId; }

  request(accountId, name, msaData) {
    if (this._queue.some((e) => e.accountId === accountId) || this._activeId === accountId) return;
    this._queue.push({ accountId, name, ...msaData });
    if (!this._activeId) this._activate();
  }

  _activate() {
    const next = this._queue.shift() || null;
    this._activeId = next ? next.accountId : null;
    this._broadcastActive(next);
  }

  complete(accountId) {
    if (this._activeId === accountId) this._activate();
    else this._queue = this._queue.filter((e) => e.accountId !== accountId);
  }

  remove(accountId) {
    if (this._activeId === accountId) this._activate();
    else this._queue = this._queue.filter((e) => e.accountId !== accountId);
  }

  skip() {
    if (!this._activeId) return;
    const skipped = this._activeId;
    this._onSkip(skipped);
    this._activate();
  }
}

module.exports = { MicrosoftAuthQueue };
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- msaQueue.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add msaQueue.js tests/msaQueue.test.js
git commit -m "feat: add MicrosoftAuthQueue for serialized device-code login

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `BotRunner` integration — accountId, queue, per-account cache

**Files:**
- Modify: `botRunner.js`
- Test: covered via `tests/api.test.js` in Task 7 (no unit test for live mineflayer)

**Interfaces:**
- Consumes: `MicrosoftAuthQueue` instance (injected), resolved config from `resolveConfig`.
- Produces: updated `BotRunner` constructor:
  - `new BotRunner({ accountId, name, config, profilesFolder, log, setStatus, msaQueue })`
    - `log(level, text)` — server's logger already binds `accountId`; runner just calls `this.log(level, text)`.
    - `setStatus(state)` — server's callback already binds `accountId`.
    - `msaQueue` — `MicrosoftAuthQueue` instance (may be `null` for offline-only contexts).
  - `start()` registers MSA prompts with the queue; `stop()` removes itself from the queue.

- [ ] **Step 1: Update the constructor and MSA handling**

Replace the constructor signature and the `onMsaCode`/login-complete wiring:

```js
constructor({ accountId, name, config, profilesFolder, log, setStatus, msaQueue }) {
  this.accountId = accountId;
  this.name = name;
  this.config = config;
  this.profilesFolder = profilesFolder;
  this.log = log;
  this._setStatusCb = setStatus;
  this.msaQueue = msaQueue || null;
  this.bot = null;
  this._status = 'idle';
  this.antiAfkInterval = null;
  this.reconnectTimeout = null;
  this.state = { phase: 'LOBBY', loggedIn: false, seenLobby: false, onTargetServer: false, atPosition: false, transferTimeout: null };
}
```

In `start()`, change the mineflayer `onMsaCode` to route through the queue:

```js
onMsaCode: (data) => {
  this.log('warn', `Microsoft auth required — visit: ${data.verification_uri}`);
  this.log('warn', `Enter code: ${data.user_code}`);
  if (this.msaQueue) {
    this.msaQueue.request(this.accountId, this.name, {
      verification_uri: data.verification_uri, user_code: data.user_code,
    });
  }
},
```

In the `spawn` handler, once the bot is fully connected (the existing `botStatus = 'connected'; setStatus('connected')` point at the first lobby spawn), notify the queue that this account's login is done:

```js
// inside spawn handler, right after this._setStatus('connected') on first lobby spawn:
if (this.msaQueue) this.msaQueue.complete(this.accountId);
```

In `stop()`, remove from the queue so a queued-but-cancelled account advances the line:

```js
stop() {
  // ...existing teardown...
  if (this.msaQueue) this.msaQueue.remove(this.accountId);
  // bot.quit() teardown is what aborts an in-flight device-code poll.
}
```

> **Verify during implementation (spec risk #3):** confirm `bot.quit()` actually aborts prismarine-auth's device-code polling. Quick check: start a Microsoft account, reach the device-code prompt, call stop()/Skip, and confirm no further "authorization pending" polling appears in logs and the process has no lingering timer (the suite uses `forceExit`, so check logs/CPU, not just exit). If polling continues, add a cancellation path (e.g. capture the bot's underlying auth flow abort or null the client) before merge.

- [ ] **Step 2: Run the existing suite, expect green**

Run: `npm test`
Expected: PASS — no live-bot tests broke; `botRunner.js` still loads.

- [ ] **Step 3: Commit**

```bash
git add botRunner.js
git commit -m "feat: integrate BotRunner with auth queue and per-account identity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Server — runner Map, per-account REST API, account-tagged WS

**Files:**
- Modify: `server.js`
- Test: Rewrite `tests/api.test.js`

**Interfaces:**
- Consumes: `BotRunner` (Task 6), `MicrosoftAuthQueue` (Task 5), `resolveConfig`/`makeAccount`/`normalizeConfig`/`loadConfigFile`/`saveConfigFile` (Task 4).
- Produces: REST API and a `runners` Map keyed by `accountId`.

- [ ] **Step 1: Write failing API tests for the new shape**

```js
// tests/api.test.js  (rewrite)
const request = require('supertest');
const { app } = require('../server');

test('GET /api/config returns {global, accounts}', async () => {
  const res = await request(app).get('/api/config');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('global');
  expect(Array.isArray(res.body.accounts)).toBe(true);
});

test('POST /api/accounts adds an account with an id', async () => {
  const res = await request(app).post('/api/accounts')
    .send({ name: 'Bot1', account: { username: 'u', auth: 'offline', password: '' } });
  expect(res.status).toBe(200);
  expect(res.body.account.id).toBeTruthy();
  const list = await request(app).get('/api/config');
  expect(list.body.accounts.some((a) => a.id === res.body.account.id)).toBe(true);
});

test('DELETE /api/accounts/:id removes it', async () => {
  const add = await request(app).post('/api/accounts').send({ name: 'Temp' });
  const id = add.body.account.id;
  const del = await request(app).delete(`/api/accounts/${id}`);
  expect(del.status).toBe(200);
  const list = await request(app).get('/api/config');
  expect(list.body.accounts.some((a) => a.id === id)).toBe(false);
});

test('POST /api/config rejects bad port in global', async () => {
  const res = await request(app).post('/api/config')
    .send({ global: { server: { host: 'h', port: 99999, version: '1.21' } }, accounts: [] });
  expect(res.status).toBe(400);
});

test('start/stop unknown account id returns ok:false', async () => {
  const res = await request(app).post('/api/bot/start/nope');
  expect(res.body.ok).toBe(false);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- api.test.js`
Expected: FAIL — endpoints/shape don't exist yet.

- [ ] **Step 3: Rewrite the server wiring + API**

Replace the single-runner block and REST API in `server.js` with:

```js
const { MicrosoftAuthQueue } = require('./msaQueue');
const { resolveConfig, makeAccount, normalizeConfig, loadConfigFile, saveConfigFile } = require('./config');

let CONFIG = { global: undefined, accounts: [] };   // set in start()
const runners = new Map();                           // accountId -> BotRunner

const msaQueue = new MicrosoftAuthQueue({
  broadcastActive: (p) => broadcast('auth', p ? { active: true, ...p } : { active: false }),
  onSkip: (accountId) => { const r = runners.get(accountId); if (r) r.stop(); },
});

function accountLog(accountId) {
  return (level, text) => {
    const time = new Date().toLocaleTimeString();
    broadcast('log', { accountId, level, text, time });
    if (level === 'error') _error(`[${accountId}] ${text}`); else _log(`[${accountId}] ${text}`);
  };
}

function makeRunner(account) {
  const resolved = resolveConfig(CONFIG.global, account);
  return new BotRunner({
    accountId: account.id,
    name: account.name,
    config: resolved,
    profilesFolder: path.join(CACHE_DIR, 'nmp-cache', account.id),
    log: accountLog(account.id),
    setStatus: (state) => broadcast('status', { accountId: account.id, state }),
    msaQueue,
  });
}

function findAccount(id) { return CONFIG.accounts.find((a) => a.id === id); }

function validateGlobal(global) {
  const port = parseInt(global?.server?.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) return 'server.port must be 1–65535';
  const delay = parseInt(global?.reconnect?.delaySeconds, 10);
  if (isNaN(delay) || delay < 1 || delay > 3600) return 'reconnect.delaySeconds must be 1–3600';
  return null;
}

// ── REST API ──
app.get('/api/config', (_req, res) => res.json(CONFIG));

app.post('/api/config', (req, res) => {
  const body = req.body ?? {};
  const err = validateGlobal(body.global);
  if (err) return res.status(400).json({ error: err });
  CONFIG = normalizeConfig(body);
  saveConfigFile(CONFIG);
  res.json({ ok: true });
});

app.post('/api/accounts', (req, res) => {
  const account = makeAccount(req.body ?? {});
  CONFIG.accounts.push(account);
  saveConfigFile(CONFIG);
  res.json({ ok: true, account });
});

app.delete('/api/accounts/:id', (req, res) => {
  const r = runners.get(req.params.id);
  if (r) { r.stop(); runners.delete(req.params.id); }
  CONFIG.accounts = CONFIG.accounts.filter((a) => a.id !== req.params.id);
  saveConfigFile(CONFIG);
  res.json({ ok: true });
});

app.post('/api/bot/start/:id', (req, res) => {
  const account = findAccount(req.params.id);
  if (!account) return res.json({ ok: false, reason: 'unknown account' });
  let r = runners.get(account.id);
  if (r && r.status !== 'idle') return res.json({ ok: false, reason: 'already running' });
  r = makeRunner(account);
  runners.set(account.id, r);
  r.start().catch((e) => { accountLog(account.id)('error', `Failed to start: ${e.message}`); });
  res.json({ ok: true });
});

app.post('/api/bot/stop/:id', (req, res) => {
  const r = runners.get(req.params.id);
  if (r) r.stop();
  res.json({ ok: true });
});

app.post('/api/bot/start-all', (_req, res) => {
  for (const account of CONFIG.accounts) {
    if (!account.enabled) continue;
    let r = runners.get(account.id);
    if (r && r.status !== 'idle') continue;
    r = makeRunner(account);
    runners.set(account.id, r);
    r.start().catch((e) => accountLog(account.id)('error', `Failed to start: ${e.message}`));
  }
  res.json({ ok: true });
});

app.post('/api/bot/stop-all', (_req, res) => {
  for (const r of runners.values()) r.stop();
  res.json({ ok: true });
});

app.post('/api/auth/skip', (_req, res) => { msaQueue.skip(); res.json({ ok: true }); });
```

Update `start()`:

```js
function start(port = 3000) {
  CONFIG = loadConfigFile();
  server.listen(port, () => _log(`Web UI: http://localhost:${port}`));
}

module.exports = { app, normalizeConfig, resolveConfig, resolveServerAddress, start };
```

Remove the old single-runner `/api/bot/start` and `/api/bot/stop` handlers and the old `/api/config` validation block.

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS — `api.test.js` (new), `config.test.js`, `resolve.test.js`, `msaQueue.test.js`, `srv.test.js` all green.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/api.test.js
git commit -m "feat: per-account runner map and multi-account REST API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Front-end — account list, per-section override toggles, skip

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: `/api/config`, `/api/accounts`, `/api/accounts/:id`, `/api/bot/start/:id`, `/api/bot/stop/:id`, `/api/bot/start-all`, `/api/bot/stop-all`, `/api/auth/skip`; WS messages now carry `accountId`, and `auth` carries `{ active, accountId, name, verification_uri, user_code }`.

- [ ] **Step 1: Restructure `index.html`**

Replace the single settings panel with: (a) a **Global defaults** panel (the existing Server/Position/Anti-AFK/Reconnect fields, no username/auth/password), (b) an **Accounts** panel containing an `#account-list` (cards rendered by JS) plus "Add account", "Start all", "Stop all" buttons, and (c) an **account editor** template. Keep the log panel; add a Skip button to the auth banner. Concretely:

```html
<section class="accounts-panel">
  <div class="accounts-header">
    <h2>Accounts</h2>
    <div>
      <button id="btn-add" class="btn btn-secondary">Add account</button>
      <button id="btn-start-all" class="btn btn-primary">Start all</button>
      <button id="btn-stop-all" class="btn btn-danger">Stop all</button>
    </div>
  </div>
  <div id="account-list"></div>
</section>
```

In the auth banner, add `<button id="auth-skip" class="btn btn-ghost">Skip</button>` next to the existing dismiss control, and an element `#auth-account` to show the account name.

Each account card (built in JS) contains: name, a status badge, Start/Stop/Remove buttons, an Enabled checkbox, the Account fields (username / auth select / password), and for each of Server / Position / Anti-AFK / Reconnect a "Use global / Custom" toggle plus that section's fields (disabled when the toggle is off).

- [ ] **Step 2: Rewrite `public/app.js` rendering + state routing**

Key behaviors (full implementation):

```js
let config = { global: {}, accounts: [] };
const statuses = {};   // accountId -> state string

async function loadConfig() {
  config = await (await fetch('/api/config')).json();
  renderGlobal();
  renderAccounts();
}

function renderAccounts() {
  const list = document.getElementById('account-list');
  list.innerHTML = '';
  for (const acc of config.accounts) list.appendChild(renderAccountCard(acc));
}

function sectionToggle(acc, key, label, fieldsHtml) {
  // returns a fragment: a "Use global / Custom" checkbox bound to acc.overrides[key]
  // that enables/disables the fields in fieldsHtml.
}

function renderAccountCard(acc) {
  const el = document.createElement('div');
  el.className = 'account-card';
  el.dataset.id = acc.id;
  const st = statuses[acc.id] ?? 'idle';
  el.innerHTML = `
    <div class="account-card-head">
      <input class="acc-name" value="${escapeAttr(acc.name)}">
      <span class="badge ${st}" data-role="badge">● ${st}</span>
      <label class="toggle"><input type="checkbox" class="acc-enabled" ${acc.enabled ? 'checked' : ''}><span class="slider"></span></label>
      <button class="btn btn-primary acc-start">Start</button>
      <button class="btn btn-danger acc-stop">Stop</button>
      <button class="btn btn-ghost acc-remove">Remove</button>
    </div>
    <div class="account-card-body">
      <label>Username / Email<input class="acc-username" value="${escapeAttr(acc.account.username)}"></label>
      <label>Auth<select class="acc-auth">
        <option value="offline"${acc.account.auth === 'offline' ? ' selected' : ''}>Offline (cracked)</option>
        <option value="microsoft"${acc.account.auth === 'microsoft' ? ' selected' : ''}>Microsoft (premium)</option>
      </select></label>
      <label>Password<input type="password" class="acc-password" value="${escapeAttr(acc.account.password)}"></label>
      <!-- per-section override blocks for server/position/antiAfk/reconnect -->
    </div>`;
  wireAccountCard(el, acc);
  return el;
}
```

`wireAccountCard` reads inputs back into the `acc` object on change, renders each section's "Use global / Custom" checkbox bound to `acc.overrides[section]` (disabling the section inputs when unchecked), and wires the buttons:

```js
el.querySelector('.acc-start').onclick  = () => fetch(`/api/bot/start/${acc.id}`, { method: 'POST' });
el.querySelector('.acc-stop').onclick   = () => fetch(`/api/bot/stop/${acc.id}`,  { method: 'POST' });
el.querySelector('.acc-remove').onclick = async () => { await fetch(`/api/accounts/${acc.id}`, { method: 'DELETE' }); await loadConfig(); };
```

Saving: a single "Save settings" persists `config` (global + the edited account objects) via `POST /api/config`. "Add account" calls `POST /api/accounts` then `loadConfig()`.

WS routing:

```js
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'log')    appendLog(msg.accountId, msg.level, msg.text, msg.time);
  if (msg.type === 'status') applyStatus(msg.accountId, msg.state);
  if (msg.type === 'auth')   handleAuth(msg);
};

function applyStatus(accountId, state) {
  statuses[accountId] = state;
  const card = document.querySelector(`.account-card[data-id="${accountId}"]`);
  if (!card) return;
  const badge = card.querySelector('[data-role="badge"]');
  badge.className = `badge ${state}`;
  badge.textContent = `● ${state}`;
}

function handleAuth(msg) {
  const banner = document.getElementById('auth-banner');
  if (!msg.active) { banner.style.display = 'none'; return; }
  document.getElementById('auth-account').textContent = msg.name || msg.accountId;
  document.getElementById('auth-code').textContent = msg.user_code;
  document.getElementById('auth-link').href = msg.verification_uri;
  banner.style.display = 'flex';
}

document.getElementById('auth-skip').onclick = () => fetch('/api/auth/skip', { method: 'POST' });
document.getElementById('btn-add').onclick = async () => { await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadConfig(); };
document.getElementById('btn-start-all').onclick = () => fetch('/api/bot/start-all', { method: 'POST' });
document.getElementById('btn-stop-all').onclick  = () => fetch('/api/bot/stop-all', { method: 'POST' });
```

`appendLog` gets the account name prefix: look up `config.accounts` by id and prepend `[name]` to the log text.

Add `escapeAttr` (like `escapeHtml` but also escapes quotes).

- [ ] **Step 2b: Add `public/style.css` rules**

Add `.accounts-panel`, `.account-card`, `.account-card-head`, `.account-card-body`, and a disabled-section style (e.g. `.section-disabled { opacity: .5; pointer-events: none; }`). Reuse existing `.badge`, `.btn`, `.toggle`, `.slider` styles.

- [ ] **Step 3: Manual verification**

Run: `node index.js`, open the UI. Verify: add two accounts (one `offline`, one `microsoft`); Save; Start all → offline connects immediately; the microsoft account shows the auth banner with its name + Skip; Skip advances/stops it; per-section "Use global / Custom" toggles enable/disable section fields; each card's badge tracks its own status; log lines are prefixed with account names.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: multi-account web UI with per-section overrides and auth skip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Full verification + docs

**Files:**
- Modify: `docs/` if a README/usage note exists; otherwise none.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS — all of `srv.test.js`, `config.test.js`, `resolve.test.js`, `msaQueue.test.js`, `api.test.js`.

- [ ] **Step 2: End-to-end smoke with a real server**

Run `node index.js`. Configure global host/port. Add one offline + one microsoft account. Start all. Confirm: offline AFK works; microsoft device-code flow appears once at a time, queued; Skip works and the next premium account proceeds; per-account Disconnect stops only that bot; Stop all stops everything; reconnect still works per account.

- [ ] **Step 3: Commit any doc updates**

```bash
git add -A
git commit -m "docs: note multi-account usage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** BotRunner (Task 3,6), `{global,accounts}` + per-section override (Task 4), per-account cache dir (Task 7 `makeRunner`), fresh-start migration (Task 4 `normalizeConfig`), Microsoft-only queue + parallel offline (Task 5,7), Skip + quit-aborts-poll verification (Task 6), per-account API (Task 7), accountId on all WS messages (Task 7), UI (Task 8), test updates (Tasks 4,7). All spec sections map to a task.
- **Carried risk:** spec risk #3 (does `bot.quit()` abort the device-code poll) is an explicit verify-step in Task 6 — do not skip it.
- **Type consistency:** `resolveConfig(global, account)` returns the flat `DEFAULT_CONFIG` shape consumed by `BotRunner.config` everywhere. Queue methods (`request/complete/remove/skip/activeId`) are used identically in `msaQueue.test.js` and `server.js`/`botRunner.js`.
