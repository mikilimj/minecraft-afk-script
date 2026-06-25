# Bot 3D View, Inventory & Command Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live 3D bot view (freecam + POV), an inventory panel, and a multi-bot command panel (move/chat/attack/autoclick) to the existing AFK dashboard.

**Architecture:** `BotRunner` gains command methods, an inventory snapshot emitter, and per-bot `prismarine-viewer` lifecycle bound to bot identity (re-attached on each spawn). `server.js` allocates viewer ports per accountId and adds `/api/bot/view/:id` and `/api/bot/command` endpoints, broadcasting `inventory` over the existing WS. The vanilla frontend gets a command panel with a checkbox bot-selector, per-card collapsible 3D-view (iframe) + inventory grid, and a standalone `view.html` pop-out.

**Tech Stack:** Node.js (CommonJS), Express 5, `ws`, `mineflayer`, `mineflayer-pathfinder`, `prismarine-viewer`, Jest + supertest, vanilla HTML/CSS/JS.

## Global Constraints

- CommonJS modules (`require`/`module.exports`) — no ESM.
- `prismarine-viewer` `mineflayer` mode: `require('prismarine-viewer').mineflayer(bot, { port, viewDistance, firstPerson })`. It sets `bot.viewer` (EventEmitter) with `.close()`. Calling it twice on one bot overwrites `bot.viewer` without closing the old server — always `close()` + null `bot.viewer` before re-attaching.
- Viewer requires `bot.entity` to exist → only attach after `spawn`.
- Viewer ports keyed by `accountId`, never by array index. Base port `3100`.
- 3D view is chunk-bound: only chunks the bot received (~`viewDistance`) exist.
- Existing WS broadcast helper: `broadcast(type, payload)` in `server.js:24`.
- Existing callback-injection pattern: `makeRunner()` in `server.js:42` passes `log`, `setStatus`, `msaQueue` into `BotRunner`.
- Tests set `process.env.AFK_CACHE_DIR` to a temp dir BEFORE requiring `server` (see `tests/api.test.js:1-6`). Match this in new server tests.
- Run all tests with `npm test`.

---

## File Structure

- **Modify `botRunner.js`** — command methods (`command` dispatcher + `chat`/`gotoXYZ`/`setControl`/`clearControls`/`attackNearest`/`startAutoclick`/`stopAutoclick`), inventory emit (`_emitInventory`), viewer lifecycle (`startViewer`/`stopViewer`/`_attachViewer`), and cleanup additions in `start()`/`stop()`. New constructor field `onInventory`.
- **Create `inventory.js`** — pure `snapshotInventory(bot)` helper (kept separate so it's unit-testable without a live bot).
- **Modify `server.js`** — `allocateViewerPort` helper (exported), `viewerPorts` Map, `onInventory` wiring in `makeRunner`, endpoints `POST/DELETE /api/bot/view/:id` and `POST /api/bot/command`.
- **Modify `public/index.html`** — command panel section; the per-card view/inventory markup is generated in `app.js`.
- **Modify `public/app.js`** — `inventory` WS handler + cache + render; bot-selector state; command POST helpers; per-card 3D-view + inventory collapsibles; Free/POV toggle.
- **Create `public/view.html`** + **`public/view.js`** — standalone pop-out viewer page.
- **Modify `public/style.css`** — command panel, inventory grid, collapsible, viewer iframe styles.
- **Create `tests/inventory.test.js`**, **`tests/viewerPort.test.js`**, **`tests/botCommands.test.js`** — unit tests. Extend **`tests/api.test.js`** for new endpoints.

---

## Task 1: Inventory snapshot helper

**Files:**
- Create: `inventory.js`
- Test: `tests/inventory.test.js`

**Interfaces:**
- Produces: `snapshotInventory(bot)` → `Array<{slot:number,name:string,displayName:string,count:number}|null>`. Returns `[]` when `bot` or `bot.inventory` is falsy. Maps `bot.inventory.slots` preserving index; empty/null slots become `null`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/inventory.test.js
const { snapshotInventory } = require('../inventory');

test('returns [] when bot has no inventory', () => {
  expect(snapshotInventory(null)).toEqual([]);
  expect(snapshotInventory({})).toEqual([]);
});

test('maps slots, preserving index and nulls', () => {
  const bot = { inventory: { slots: [
    null,
    { name: 'dirt', displayName: 'Dirt', count: 64 },
    null,
    { name: 'stone', displayName: 'Stone', count: 12 },
  ] } };
  expect(snapshotInventory(bot)).toEqual([
    null,
    { slot: 1, name: 'dirt', displayName: 'Dirt', count: 64 },
    null,
    { slot: 3, name: 'stone', displayName: 'Stone', count: 12 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/inventory.test.js`
Expected: FAIL — `Cannot find module '../inventory'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// inventory.js
function snapshotInventory(bot) {
  if (!bot || !bot.inventory || !Array.isArray(bot.inventory.slots)) return [];
  return bot.inventory.slots.map((item, slot) =>
    item ? { slot, name: item.name, displayName: item.displayName, count: item.count } : null
  );
}

module.exports = { snapshotInventory };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/inventory.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add inventory.js tests/inventory.test.js
git commit -m "feat: snapshotInventory helper"
```

---

## Task 2: Viewer port allocation helper

**Files:**
- Modify: `server.js` (add + export `allocateViewerPort`, add `VIEWER_PORT_BASE`)
- Test: `tests/viewerPort.test.js`

**Interfaces:**
- Produces: `allocateViewerPort(map, accountId, base)` → number. `map` is `Map<accountId,port>`. Returns existing port if already allocated for that id; otherwise the lowest free port `>= base` not present in `map.values()`, records it in `map`, and returns it.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/viewerPort.test.js
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.AFK_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-test-'));
const { allocateViewerPort } = require('../server');

test('allocates sequential free ports from base', () => {
  const m = new Map();
  expect(allocateViewerPort(m, 'a', 3100)).toBe(3100);
  expect(allocateViewerPort(m, 'b', 3100)).toBe(3101);
});

test('returns the same port for the same accountId', () => {
  const m = new Map();
  expect(allocateViewerPort(m, 'a', 3100)).toBe(3100);
  expect(allocateViewerPort(m, 'a', 3100)).toBe(3100);
});

test('reuses gaps freed by removed accounts', () => {
  const m = new Map([['a', 3100], ['c', 3102]]);
  expect(allocateViewerPort(m, 'd', 3100)).toBe(3101);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/viewerPort.test.js`
Expected: FAIL — `allocateViewerPort is not a function`

- [ ] **Step 3: Write minimal implementation**

In `server.js`, after the `runners` declaration (`server.js:14`) add:

```javascript
const VIEWER_PORT_BASE = 3100;
const viewerPorts = new Map();   // accountId -> viewer http port

function allocateViewerPort(map, accountId, base = VIEWER_PORT_BASE) {
  if (map.has(accountId)) return map.get(accountId);
  const used = new Set(map.values());
  let port = base;
  while (used.has(port)) port++;
  map.set(accountId, port);
  return port;
}
```

Add `allocateViewerPort` to the `module.exports` object at the bottom of `server.js`:

```javascript
module.exports = { app, normalizeConfig, resolveConfig, resolveServerAddress, start, allocateViewerPort };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/viewerPort.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server.js tests/viewerPort.test.js
git commit -m "feat: viewer port allocation keyed by accountId"
```

---

## Task 3: BotRunner command + autoclicker methods

**Files:**
- Modify: `botRunner.js` (add command methods; require `goals`/`Movements` already imported at top `botRunner.js:2`)
- Test: `tests/botCommands.test.js`

**Interfaces:**
- Consumes: `BotRunner` constructor (`botRunner.js:12`) — instantiate with stub callbacks for tests.
- Produces:
  - `command(action, params)` — dispatch; throws `Error('unknown action: X')` for unknown actions.
  - `chat(text)`, `setControl(key, state)`, `clearControls()`, `attackNearest(targetName)`, `gotoXYZ(x,y,z)`.
  - `startAutoclick(mode, intervalMs)` / `stopAutoclick()` — `this.autoclickInterval` holds the timer; left mode does `swingArm('right')` + `attack(nearest)`, right mode does `activateItem()`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/botCommands.test.js
const { BotRunner } = require('../botRunner');

function makeRunner() {
  return new BotRunner({
    accountId: 'a', name: 'A', config: {},
    profilesFolder: '/tmp/x', log: () => {}, setStatus: () => {},
  });
}

function fakeBot() {
  return {
    chat: jest.fn(),
    setControlState: jest.fn(),
    attack: jest.fn(),
    swingArm: jest.fn(),
    activateItem: jest.fn(),
    lookAt: jest.fn(),
    nearestEntity: jest.fn(() => ({ position: { offset: () => ({}) }, height: 1 })),
  };
}

test('chat forwards to bot.chat', () => {
  const r = makeRunner(); r.bot = fakeBot();
  r.command('chat', { text: '/hi' });
  expect(r.bot.chat).toHaveBeenCalledWith('/hi');
});

test('control sets and clearControls releases all keys', () => {
  const r = makeRunner(); r.bot = fakeBot();
  r.command('control', { key: 'forward', state: true });
  expect(r.bot.setControlState).toHaveBeenCalledWith('forward', true);
  r.command('clearControls', {});
  expect(r.bot.setControlState).toHaveBeenCalledWith('forward', false);
  expect(r.bot.setControlState).toHaveBeenCalledWith('jump', false);
});

test('attack attacks nearest entity', () => {
  const r = makeRunner(); r.bot = fakeBot();
  r.command('attack', {});
  expect(r.bot.attack).toHaveBeenCalled();
});

test('unknown action throws', () => {
  const r = makeRunner(); r.bot = fakeBot();
  expect(() => r.command('frobnicate', {})).toThrow(/unknown action/);
});

test('autoclick left mode swings on interval, stop clears it', () => {
  jest.useFakeTimers();
  const r = makeRunner(); r.bot = fakeBot();
  r.command('autoclick', { on: true, mode: 'left', intervalMs: 100 });
  jest.advanceTimersByTime(250);
  expect(r.bot.swingArm.mock.calls.length).toBe(2);
  r.command('autoclick', { on: false });
  jest.advanceTimersByTime(300);
  expect(r.bot.swingArm.mock.calls.length).toBe(2);
  jest.useRealTimers();
});

test('command is a no-op when bot is absent', () => {
  const r = makeRunner();   // no r.bot
  expect(() => r.command('chat', { text: 'x' })).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/botCommands.test.js`
Expected: FAIL — `r.command is not a function`

- [ ] **Step 3: Write minimal implementation**

In `botRunner.js`, add these methods inside the `BotRunner` class (e.g. after `clearAntiAfk()` near `botRunner.js:50`):

```javascript
  // ── COMMANDS ──────────────────────────────────────────────────────────────────
  command(action, params = {}) {
    switch (action) {
      case 'chat':          this.chat(params.text); break;
      case 'gotoXYZ':       this.gotoXYZ(params.x, params.y, params.z); break;
      case 'control':       this.setControl(params.key, params.state); break;
      case 'clearControls': this.clearControls(); break;
      case 'attack':        this.attackNearest(params.target); break;
      case 'autoclick':
        if (params.on) this.startAutoclick(params.mode, params.intervalMs);
        else this.stopAutoclick();
        break;
      default: throw new Error(`unknown action: ${action}`);
    }
  }

  chat(text) { if (this.bot && text) this.bot.chat(String(text)); }

  setControl(key, state) {
    const allowed = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
    if (this.bot && allowed.includes(key)) this.bot.setControlState(key, !!state);
  }

  clearControls() {
    if (!this.bot) return;
    for (const k of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) {
      this.bot.setControlState(k, false);
    }
  }

  gotoXYZ(x, y, z) {
    if (!this.bot) return;
    try {
      const mcData    = this.bot.registry || require('minecraft-data')(this.bot.version);
      const movements = new Movements(this.bot, mcData);
      movements.canDig = false;
      this.bot.pathfinder.setMovements(movements);
      this.bot.pathfinder.setGoal(new GoalXYZ(Number(x), Number(y), Number(z)));
      this.log('info', `Command: navigating to X:${x} Y:${y} Z:${z}`);
    } catch (err) {
      this.log('error', `goto error: ${err.message}`);
    }
  }

  attackNearest(targetName) {
    if (!this.bot) return;
    const match = targetName
      ? (e) => e.name === targetName || e.username === targetName
      : (e) => e.type === 'mob' || e.type === 'player' || e.type === 'hostile';
    const entity = this.bot.nearestEntity(match);
    if (!entity) { this.log('warn', 'Command: no entity to attack.'); return; }
    try {
      this.bot.lookAt(entity.position.offset(0, entity.height ?? 1, 0));
      this.bot.attack(entity);
    } catch (err) { this.log('error', `attack error: ${err.message}`); }
  }

  startAutoclick(mode = 'left', intervalMs = 200) {
    this.stopAutoclick();
    const interval = Math.max(20, parseInt(intervalMs, 10) || 200);
    this.log('info', `Autoclicker started (${mode}, ${interval}ms).`);
    this.autoclickInterval = setInterval(() => {
      if (!this.bot) return;
      try {
        if (mode === 'right') {
          this.bot.activateItem();
        } else {
          this.bot.swingArm('right');
          const entity = this.bot.nearestEntity((e) => e.type === 'mob' || e.type === 'player' || e.type === 'hostile');
          if (entity) this.bot.attack(entity);
        }
      } catch (_) { /* swing on empty world is harmless */ }
    }, interval);
  }

  stopAutoclick() {
    if (this.autoclickInterval) {
      clearInterval(this.autoclickInterval);
      this.autoclickInterval = null;
      this.log('info', 'Autoclicker stopped.');
    }
  }
```

Add `this.autoclickInterval = null;` in the constructor next to the other timer fields (`botRunner.js:22-23`).

In `stop()` (`botRunner.js:137`), add `this.stopAutoclick();` alongside the other cleanup calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/botCommands.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add botRunner.js tests/botCommands.test.js
git commit -m "feat: BotRunner command + autoclicker methods"
```

---

## Task 4: BotRunner viewer lifecycle

**Files:**
- Modify: `botRunner.js` (viewer methods + spawn re-attach + start/stop cleanup)

**Interfaces:**
- Consumes: `require('prismarine-viewer').mineflayer`.
- Produces:
  - `startViewer(port, firstPerson)` — record desired port/mode; if mode changed while attached, close+null `bot.viewer` first; then `_attachViewer()`.
  - `stopViewer()` — clear desired port, close + null `bot.viewer`.
  - `_attachViewer()` — no-op unless `this._viewerPort != null && this.bot && this.bot.entity && !this.bot.viewer`; else calls `mineflayerViewer(this.bot, { port, firstPerson, viewDistance: 6 })`.

This task is verified manually (needs a live server). No unit test — the viewer binds a real TCP port and needs a spawned bot.

- [ ] **Step 1: Add the require**

At the top of `botRunner.js` (after line 4), add:

```javascript
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
```

- [ ] **Step 2: Add viewer state to the constructor**

In the constructor (`botRunner.js:20-23` area), add:

```javascript
    this._viewerPort = null;
    this._viewerFirstPerson = false;
```

- [ ] **Step 3: Add the viewer methods**

Add inside the class (e.g. after `stopAutoclick()`):

```javascript
  // ── 3D VIEWER ─────────────────────────────────────────────────────────────────
  startViewer(port, firstPerson = false) {
    const modeChanged = this._viewerFirstPerson !== !!firstPerson;
    this._viewerPort = port;
    this._viewerFirstPerson = !!firstPerson;
    if (modeChanged && this.bot && this.bot.viewer) {
      try { this.bot.viewer.close(); } catch (_) {}
      this.bot.viewer = null;
    }
    this._attachViewer();
  }

  _attachViewer() {
    if (this._viewerPort == null) return;
    if (!this.bot || !this.bot.entity) return;   // viewer needs a spawned entity
    if (this.bot.viewer) return;                 // already attached
    try {
      mineflayerViewer(this.bot, {
        port: this._viewerPort,
        firstPerson: this._viewerFirstPerson,
        viewDistance: 6,
      });
      this.log('info', `3D view started on port ${this._viewerPort}.`);
    } catch (err) {
      this.log('error', `Viewer error: ${err.message}`);
    }
  }

  stopViewer() {
    this._viewerPort = null;
    if (this.bot && this.bot.viewer) {
      try { this.bot.viewer.close(); } catch (_) {}
      this.bot.viewer = null;
    }
  }
```

- [ ] **Step 4: Re-attach on spawn**

In the `spawn` handler (`botRunner.js:211`), add as the first line inside the handler:

```javascript
      this._attachViewer();
```

(idempotent — guarded by the `this.bot.viewer` check; safe on every spawn / transfer.)

- [ ] **Step 5: Close viewer on reconnect/restart (prevent port leak)**

In `start()` at the top where the old bot is torn down (`botRunner.js:151`), change:

```javascript
    if (this.bot) { try { this.bot.removeAllListeners(); this.bot.quit(); } catch (_) {} this.bot = null; }
```

to also close the viewer first:

```javascript
    if (this.bot) {
      try { this.bot.viewer && this.bot.viewer.close(); } catch (_) {}
      try { this.bot.removeAllListeners(); this.bot.quit(); } catch (_) {}
      this.bot = null;
    }
```

Do the same in `stop()` (`botRunner.js:143`) — change that line identically so a stopped bot frees its viewer port. Keep `this._viewerPort` set on reconnect (so it re-attaches after respawn) but cleared by `stopViewer()`/explicit stop. Note: the existing `stop()` already nulls `this.bot`; ensure the viewer close happens before `this.bot = null`.

- [ ] **Step 6: Manual smoke (deferred to final verification)**

No automated test. Verified in the final end-to-end checklist.

- [ ] **Step 7: Run full suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all existing + new unit tests; viewer code is not exercised).

- [ ] **Step 8: Commit**

```bash
git add botRunner.js
git commit -m "feat: per-bot prismarine-viewer lifecycle"
```

---

## Task 5: BotRunner inventory emit

**Files:**
- Modify: `botRunner.js` (constructor `onInventory`, `_emitInventory`, wiring, cleanup)

**Interfaces:**
- Consumes: `snapshotInventory` from `./inventory` (Task 1).
- Produces: constructor accepts `onInventory` callback; `_emitInventory()` throttles (500ms) then calls `this._onInventory(snapshotInventory(this.bot))`. `this._invThrottle` timer cleared in `stop()`.

This is verified manually + via the api test in Task 7. No standalone unit test (needs live inventory events).

- [ ] **Step 1: Require the helper**

At the top of `botRunner.js`, add:

```javascript
const { snapshotInventory } = require('./inventory');
```

- [ ] **Step 2: Accept the callback**

In the constructor destructure (`botRunner.js:12`), add `onInventory` and store it:

```javascript
  constructor({ accountId, name, config, profilesFolder, log, setStatus, msaQueue, onInventory }) {
```

```javascript
    this._onInventory = onInventory || null;
    this._invThrottle = null;
```

- [ ] **Step 3: Add the emit method**

```javascript
  _emitInventory() {
    if (!this._onInventory || this._invThrottle) return;
    this._invThrottle = setTimeout(() => {
      this._invThrottle = null;
      try { this._onInventory(snapshotInventory(this.bot)); } catch (_) {}
    }, 500);
  }
```

- [ ] **Step 4: Wire inventory events**

In the `spawn` handler (`botRunner.js:211`), after `this._attachViewer();`, add:

```javascript
      this._emitInventory();
      if (this.bot.inventory && !this._invWired) {
        this._invWired = true;
        this.bot.inventory.on('updateSlot', () => this._emitInventory());
      }
```

Add `this._invWired = false;` in the constructor. Reset it to `false` in `start()` (since a new bot has a new inventory) — add `this._invWired = false;` near the top of `start()` (`botRunner.js:152` area, by the other resets).

- [ ] **Step 5: Cleanup in stop()**

In `stop()` add:

```javascript
    if (this._invThrottle) { clearTimeout(this._invThrottle); this._invThrottle = null; }
```

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add botRunner.js
git commit -m "feat: throttled inventory snapshot emit from BotRunner"
```

---

## Task 6: Server endpoints — view, command, inventory broadcast

**Files:**
- Modify: `server.js` (wire `onInventory` in `makeRunner`; add 3 endpoints)
- Test: extend `tests/api.test.js`

**Interfaces:**
- Consumes: `allocateViewerPort` (Task 2), `runners` Map, `BotRunner.startViewer/stopViewer/command` (Tasks 3-4).
- Produces:
  - `POST /api/bot/view/:id` body `{ firstPerson?:bool }` → `{ port }` (409 `{error}` if not running).
  - `DELETE /api/bot/view/:id` → `{ ok:true }`.
  - `POST /api/bot/command` body `{ ids:[], action, params }` → `{ results:[{id,ok,reason?}] }`. Unknown/idle ids → `{id,ok:false,reason:'not running'}`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api.test.js`:

```javascript
test('POST /api/bot/view/:id returns 409 when not running', async () => {
  const add = await request(app).post('/api/accounts').send({ name: 'ViewBot' });
  const id = add.body.account.id;
  const res = await request(app).post(`/api/bot/view/${id}`).send({});
  expect(res.status).toBe(409);
});

test('POST /api/bot/command skips ids that are not running', async () => {
  const res = await request(app).post('/api/bot/command')
    .send({ ids: ['nope'], action: 'chat', params: { text: 'hi' } });
  expect(res.status).toBe(200);
  expect(res.body.results).toEqual([{ id: 'nope', ok: false, reason: 'not running' }]);
});

test('DELETE /api/bot/view/:id is ok even when no viewer', async () => {
  const res = await request(app).delete('/api/bot/view/nope');
  expect(res.body.ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/api.test.js`
Expected: FAIL — new endpoints return 404.

- [ ] **Step 3: Wire onInventory in makeRunner**

In `makeRunner()` (`server.js:44-52`), add to the `BotRunner` options:

```javascript
    onInventory: (slots) => broadcast('inventory', { accountId: account.id, slots }),
```

- [ ] **Step 4: Add the endpoints**

After `POST /api/bot/stop-all` (`server.js:142`), add:

```javascript
app.post('/api/bot/view/:id', (req, res) => {
  const r = runners.get(req.params.id);
  if (!r || r.status === 'idle') return res.status(409).json({ error: 'bot not running' });
  const port = allocateViewerPort(viewerPorts, req.params.id);
  r.startViewer(port, !!req.body?.firstPerson);
  res.json({ port });
});

app.delete('/api/bot/view/:id', (req, res) => {
  const r = runners.get(req.params.id);
  if (r) r.stopViewer();
  res.json({ ok: true });
});

app.post('/api/bot/command', (req, res) => {
  const { ids = [], action, params = {} } = req.body ?? {};
  const results = [];
  for (const id of ids) {
    const r = runners.get(id);
    if (!r || r.status === 'idle') { results.push({ id, ok: false, reason: 'not running' }); continue; }
    try { r.command(action, params); results.push({ id, ok: true }); }
    catch (e) { results.push({ id, ok: false, reason: e.message }); }
  }
  res.json({ results });
});
```

Also free the viewer port mapping when an account is deleted — in `DELETE /api/accounts/:id` (`server.js:102`), add after `runners.delete`:

```javascript
  viewerPorts.delete(req.params.id);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/api.test.js`
Expected: PASS (existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add server.js tests/api.test.js
git commit -m "feat: view/command endpoints + inventory broadcast"
```

---

## Task 7: Frontend — command panel (bot selector + actions)

**Files:**
- Modify: `public/index.html` (add command panel section), `public/app.js` (selector + command helpers), `public/style.css`

**Interfaces:**
- Consumes: `POST /api/bot/command` (Task 6), existing `config.accounts`, `loadConfig()`/`renderAccounts()`.
- Produces: `renderBotSelector()`, `selectedIds()`, `sendCommand(action, params)` in `app.js`.

Frontend — verified manually in the final checklist. Concrete code below; no unit test (no DOM test harness in this project).

- [ ] **Step 1: Add the command panel markup**

In `public/index.html`, inside `<section class="accounts-log-column">`, add **between** the `accounts-panel` section (ends line 87) and the `log-panel` section (line 89):

```html
      <section class="command-panel">
        <h2>Commands</h2>
        <div class="cmd-selector">
          <div class="cmd-selector-head">
            <span>Target bots</span>
            <div>
              <button id="cmd-select-all" class="btn btn-ghost">Select all</button>
              <button id="cmd-clear-all" class="btn btn-ghost">Clear all</button>
            </div>
          </div>
          <div id="cmd-bot-list" class="cmd-bot-list"></div>
        </div>

        <div class="cmd-group">
          <h3>Movement</h3>
          <div class="cmd-move-mode">
            <label><input type="radio" name="move-mode" value="pathfind" checked> Pathfind (XYZ)</label>
            <label><input type="radio" name="move-mode" value="manual"> Manual (WASD)</label>
          </div>
          <div id="cmd-pathfind" class="cmd-move-pane">
            <div class="row three">
              <label>X<input id="cmd-x" type="number" step="0.1" value="0"></label>
              <label>Y<input id="cmd-y" type="number" step="0.1" value="64"></label>
              <label>Z<input id="cmd-z" type="number" step="0.1" value="0"></label>
            </div>
            <button id="cmd-go" class="btn btn-primary">Go</button>
          </div>
          <div id="cmd-manual" class="cmd-move-pane" style="display:none">
            <div class="wasd-grid">
              <button class="wasd" data-key="forward">W</button>
              <button class="wasd" data-key="left">A</button>
              <button class="wasd" data-key="back">S</button>
              <button class="wasd" data-key="right">D</button>
              <button class="wasd" data-key="jump">Jump</button>
              <button class="wasd" data-key="sneak">Sneak</button>
              <button class="wasd" data-key="sprint">Sprint</button>
            </div>
            <button id="cmd-stop-move" class="btn btn-danger">Stop moving</button>
          </div>
        </div>

        <div class="cmd-group">
          <h3>Chat / command</h3>
          <div class="row">
            <input id="cmd-chat" type="text" placeholder="/say hello or plain chat">
            <button id="cmd-send" class="btn btn-primary">Send</button>
          </div>
        </div>

        <div class="cmd-group">
          <h3>Attack</h3>
          <div class="row">
            <input id="cmd-attack-target" type="text" placeholder="entity name (blank = nearest)">
            <button id="cmd-attack" class="btn btn-danger">Attack</button>
          </div>
        </div>

        <div class="cmd-group">
          <h3>Autoclicker</h3>
          <div class="row">
            <label class="narrow">Mode
              <select id="cmd-click-mode">
                <option value="left">Left (attack)</option>
                <option value="right">Right (use)</option>
              </select>
            </label>
            <label class="narrow">Interval (ms)<input id="cmd-click-interval" type="number" min="20" value="200"></label>
            <button id="cmd-click-start" class="btn btn-primary">Start</button>
            <button id="cmd-click-stop" class="btn btn-danger">Stop</button>
          </div>
        </div>
      </section>
```

- [ ] **Step 2: Add selector + command helpers to app.js**

Append to `public/app.js` (before the final `loadConfig();` call at line 400):

```javascript
// ── COMMAND PANEL ───────────────────────────────────────────────────────────────
function renderBotSelector() {
  const list = document.getElementById('cmd-bot-list');
  if (!list) return;
  const prev = selectedIds();
  list.innerHTML = '';
  for (const acc of config.accounts) {
    const id = document.createElement('label');
    id.className = 'cmd-bot-item';
    const checked = prev.includes(acc.id) ? ' checked' : '';
    id.innerHTML = `<input type="checkbox" class="cmd-bot-chk" value="${escapeAttr(acc.id)}"${checked}> ${escapeHtml(acc.name)}`;
    list.appendChild(id);
  }
}

function selectedIds() {
  return Array.from(document.querySelectorAll('.cmd-bot-chk:checked')).map((c) => c.value);
}

async function sendCommand(action, params = {}) {
  const ids = selectedIds();
  if (ids.length === 0) { appendLog(null, 'warn', 'No bots selected.'); return; }
  await fetch('/api/bot/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, action, params }),
  });
}

function wireCommandPanel() {
  document.getElementById('cmd-select-all').onclick = () =>
    document.querySelectorAll('.cmd-bot-chk').forEach((c) => { c.checked = true; });
  document.getElementById('cmd-clear-all').onclick = () =>
    document.querySelectorAll('.cmd-bot-chk').forEach((c) => { c.checked = false; });

  document.querySelectorAll('input[name="move-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      const manual = document.querySelector('input[name="move-mode"]:checked').value === 'manual';
      document.getElementById('cmd-manual').style.display = manual ? '' : 'none';
      document.getElementById('cmd-pathfind').style.display = manual ? 'none' : '';
    });
  });

  document.getElementById('cmd-go').onclick = () => sendCommand('gotoXYZ', {
    x: parseFloat(document.getElementById('cmd-x').value) || 0,
    y: parseFloat(document.getElementById('cmd-y').value) || 0,
    z: parseFloat(document.getElementById('cmd-z').value) || 0,
  });

  document.querySelectorAll('.wasd').forEach((btn) => {
    const key = btn.dataset.key;
    const down = () => sendCommand('control', { key, state: true });
    const up   = () => sendCommand('control', { key, state: false });
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
  });
  document.getElementById('cmd-stop-move').onclick = () => sendCommand('clearControls', {});

  document.getElementById('cmd-send').onclick = () => {
    const text = document.getElementById('cmd-chat').value;
    if (text) { sendCommand('chat', { text }); document.getElementById('cmd-chat').value = ''; }
  };
  document.getElementById('cmd-chat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('cmd-send').click();
  });

  document.getElementById('cmd-attack').onclick = () =>
    sendCommand('attack', { target: document.getElementById('cmd-attack-target').value.trim() || undefined });

  document.getElementById('cmd-click-start').onclick = () => sendCommand('autoclick', {
    on: true,
    mode: document.getElementById('cmd-click-mode').value,
    intervalMs: parseInt(document.getElementById('cmd-click-interval').value, 10) || 200,
  });
  document.getElementById('cmd-click-stop').onclick = () => sendCommand('autoclick', { on: false });
}

wireCommandPanel();
```

- [ ] **Step 3: Refresh the selector when accounts change**

In `renderAccounts()` (`app.js:155`), add `renderBotSelector();` as the last line of the function.

- [ ] **Step 4: Add styles**

Append to `public/style.css`:

```css
/* Command panel */
.command-panel { background: #1b1f27; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.command-panel h2 { margin: 0 0 12px; }
.cmd-group { border-top: 1px solid #2a2f3a; padding-top: 12px; margin-top: 12px; }
.cmd-group h3 { margin: 0 0 8px; font-size: 0.9rem; color: #aab; }
.cmd-selector-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.cmd-bot-list { display: flex; flex-wrap: wrap; gap: 8px; }
.cmd-bot-item { display: flex; align-items: center; gap: 4px; background: #232834; padding: 4px 8px; border-radius: 6px; font-size: 0.85rem; }
.cmd-move-mode { display: flex; gap: 16px; margin-bottom: 8px; }
.wasd-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.wasd { background: #2a2f3a; border: 1px solid #3a4150; color: #ddd; padding: 8px 14px; border-radius: 6px; cursor: pointer; user-select: none; }
.wasd:active { background: #3a4150; }
```

- [ ] **Step 5: Manual check (deferred to final verification)**

- [ ] **Step 6: Run full suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: multi-bot command panel UI"
```

---

## Task 8: Frontend — inventory grid + 3D view per card

**Files:**
- Modify: `public/app.js` (inventory WS handler + cache + per-card render; view open/close + Free/POV toggle), `public/style.css`

**Interfaces:**
- Consumes: WS `{type:'inventory', accountId, slots}` (Task 6), `POST/DELETE /api/bot/view/:id` (Task 6).
- Produces: `applyInventory(accountId, slots)`, `renderInventoryGrid(slots)`; per-card "3D View" + "Inventory" collapsibles injected during `renderAccountCard`.

- [ ] **Step 1: Handle the inventory WS message**

In `connectWS()` (`app.js:42-47`), add a branch:

```javascript
    if (msg.type === 'inventory') applyInventory(msg.accountId, msg.slots);
```

- [ ] **Step 2: Add inventory cache + render**

Add near the top state (`app.js:3`):

```javascript
const inventories = {};   // accountId -> slots array
```

Append helpers to `app.js`:

```javascript
// ── INVENTORY ───────────────────────────────────────────────────────────────────
function applyInventory(accountId, slots) {
  inventories[accountId] = slots;
  const card = document.querySelector(`.account-card[data-id="${CSS.escape(accountId)}"]`);
  if (!card) return;
  const grid = card.querySelector('[data-role="inv-grid"]');
  if (grid) grid.innerHTML = renderInventoryGrid(slots);
}

function renderInventoryGrid(slots) {
  const cells = [];
  for (let i = 0; i < 36; i++) {
    const item = (slots || [])[i];
    if (item) {
      cells.push(`<div class="inv-cell filled" title="${escapeAttr(item.displayName || item.name)}">` +
        `<span class="inv-name">${escapeHtml((item.name || '').replace(/_/g, ' '))}</span>` +
        `<span class="inv-count">${item.count}</span></div>`);
    } else {
      cells.push('<div class="inv-cell"></div>');
    }
  }
  return cells.join('');
}
```

- [ ] **Step 3: Inject the collapsibles into the account card**

In `renderAccountCard()` (`app.js:223`), add inside `account-card-body`, after the last `sectionHtml(...)` for `reconnect` (`app.js:250`):

```javascript
      <div class="section-group viewer-group">
        <h3>3D View
          <button class="btn btn-ghost view-toggle" data-role="view-toggle">Open</button>
          <label class="view-mode"><input type="checkbox" class="view-firstperson"> POV</label>
          <a class="btn btn-ghost view-popout" href="view.html?id=${escapeAttr(acc.id)}" target="_blank">Pop out</a>
        </h3>
        <div class="viewer-holder" data-role="viewer-holder"></div>
      </div>
      <div class="section-group">
        <h3>Inventory</h3>
        <div class="inv-grid" data-role="inv-grid">${renderInventoryGrid(inventories[acc.id])}</div>
      </div>
```

- [ ] **Step 4: Wire the view toggle in wireAccountCard**

In `wireAccountCard()` (`app.js:257`), before the closing brace (after the buttons block `app.js:300`), add:

```javascript
  // 3D view
  const viewBtn = el.querySelector('[data-role="view-toggle"]');
  const holder  = el.querySelector('[data-role="viewer-holder"]');
  const fpChk   = el.querySelector('.view-firstperson');
  let viewOpen = false;
  async function openView() {
    const res = await fetch(`/api/bot/view/${acc.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstPerson: fpChk.checked }),
    });
    const data = await res.json();
    if (!res.ok) { appendLog(acc.id, 'warn', data.error || 'Cannot open view'); return; }
    holder.innerHTML = `<iframe class="viewer-frame" src="http://${location.hostname}:${data.port}/"></iframe>`;
    viewOpen = true; viewBtn.textContent = 'Close';
  }
  async function closeView() {
    await fetch(`/api/bot/view/${acc.id}`, { method: 'DELETE' });
    holder.innerHTML = ''; viewOpen = false; viewBtn.textContent = 'Open';
  }
  viewBtn.onclick = () => (viewOpen ? closeView() : openView());
  fpChk.addEventListener('change', () => { if (viewOpen) openView(); });   // re-open with new mode
```

- [ ] **Step 5: Add styles**

Append to `public/style.css`:

```css
/* Inventory grid */
.inv-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 3px; }
.inv-cell { aspect-ratio: 1; background: #20242d; border: 1px solid #2a2f3a; border-radius: 4px; position: relative; font-size: 0.55rem; overflow: hidden; }
.inv-cell.filled { background: #2b3340; }
.inv-name { position: absolute; top: 2px; left: 2px; right: 2px; color: #cdd; line-height: 1.05; }
.inv-count { position: absolute; bottom: 1px; right: 3px; color: #fff; font-weight: 600; }
/* 3D view */
.viewer-group .view-toggle, .viewer-group .view-popout { margin-left: 8px; font-size: 0.8rem; }
.view-mode { margin-left: 8px; font-size: 0.8rem; }
.viewer-holder:empty { display: none; }
.viewer-frame { width: 100%; height: 320px; border: 1px solid #2a2f3a; border-radius: 6px; margin-top: 8px; }
```

- [ ] **Step 6: Run full suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: per-card inventory grid + embedded 3D view"
```

---

## Task 9: Standalone pop-out viewer page

**Files:**
- Create: `public/view.html`, `public/view.js`

**Interfaces:**
- Consumes: `POST /api/bot/view/:id` (Task 6), `GET /api/config` (for the bot name).
- Produces: a full-window page that opens the viewer for `?id=<accountId>` with a Free/POV toggle.

- [ ] **Step 1: Create view.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bot 3D View</title>
  <link rel="stylesheet" href="style.css">
  <style>
    body { margin: 0; height: 100vh; display: flex; flex-direction: column; }
    .view-bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #1b1f27; }
    .view-bar h1 { font-size: 1rem; margin: 0; }
    #pov-frame { flex: 1; border: 0; width: 100%; }
    .view-msg { padding: 12px; color: #f7b; }
  </style>
</head>
<body>
  <div class="view-bar">
    <h1 id="title">Bot 3D View</h1>
    <label><input type="checkbox" id="firstperson"> POV (first person)</label>
    <span class="view-msg" id="msg"></span>
  </div>
  <iframe id="pov-frame"></iframe>
  <script src="view.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create view.js**

```javascript
const id = new URLSearchParams(location.search).get('id');
const frame = document.getElementById('pov-frame');
const fpChk = document.getElementById('firstperson');
const msg = document.getElementById('msg');

async function setTitle() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    const acc = (cfg.accounts || []).find((a) => a.id === id);
    if (acc) document.getElementById('title').textContent = `3D View — ${acc.name}`;
  } catch (_) {}
}

async function open() {
  msg.textContent = '';
  const res = await fetch(`/api/bot/view/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstPerson: fpChk.checked }),
  });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || 'Cannot open view'; frame.removeAttribute('src'); return; }
  frame.src = `http://${location.hostname}:${data.port}/`;
}

fpChk.addEventListener('change', open);
setTitle();
if (id) open(); else msg.textContent = 'No bot id in URL.';
```

- [ ] **Step 3: Manual check (deferred to final verification)**

- [ ] **Step 4: Run full suite (no regressions)**

Run: `npm test`
Expected: PASS (static files don't affect tests).

- [ ] **Step 5: Commit**

```bash
git add public/view.html public/view.js
git commit -m "feat: standalone pop-out 3D viewer page"
```

---

## Final End-to-End Verification

Run against a real Minecraft server with at least 2 accounts configured.

- [ ] `npm test` — full suite green.
- [ ] `npm start`, open `http://localhost:3000`. Start 2 bots; wait for "connected".
- [ ] **3D view:** On each card click **Open** → an iframe renders the world on its own port (3100, 3101). Toggle **POV** → re-renders first-person. Confirm WASD + mouse freecam works in non-POV mode (camera flies within the loaded area).
- [ ] **Port stability:** Remove a *non-last* account; restart another bot and open its view → same port as before, iframe loads (no index drift).
- [ ] **Port freeing:** Click **Close** (or Stop the bot) then re-open → loads with no `EADDRINUSE` error in the server console.
- [ ] **Reconnect:** Kick a bot (or `/api/bot/stop` then start); after respawn open the view → re-attaches and shows the new world.
- [ ] **Inventory:** Give/drop items on a bot → its grid updates within ~1s; hover shows display names.
- [ ] **Pop out:** Click **Pop out** → `view.html` opens in a new tab and shows the same view; POV toggle works.
- [ ] **Commands:** Select both bots.
  - Send `/help` → both bots chat (see log/server).
  - Pathfind to a reachable XYZ → both walk there.
  - Manual: hold **W** → both move forward; release stops; **Stop moving** clears.
  - **Attack** (blank target) → both swing at nearest entity.
  - **Autoclicker** Start (200ms, left) → repeated swings; **Stop** halts; Stopping the bot also halts the clicker (no leaked interval).
  - **Select all** / **Clear all** toggle every checkbox.

---

## Self-Review Notes

- **Spec coverage:** 3D view (Tasks 4,8,9) ✓; freecam via stock MapControls (Task 8 manual) ✓; POV toggle (Tasks 6,8,9) ✓; chunk-bound constraint documented ✓; inventory (Tasks 1,5,6,8) ✓; command panel with selector + select/clear (Task 7) ✓; movement pathfind+manual (Tasks 3,7) ✓; chat (Tasks 3,7) ✓; attack (Tasks 3,7) ✓; autoclicker left/right + interval (Tasks 3,7) ✓; per-bot viewer ports keyed by accountId + lazy start + reconnect re-attach (Tasks 2,4,6) ✓.
- **Type consistency:** `command(action, params)`, `startViewer(port, firstPerson)`, `allocateViewerPort(map, accountId, base)`, `snapshotInventory(bot)`, WS type `inventory`, endpoints `/api/bot/view/:id` & `/api/bot/command` used identically across backend tasks and frontend consumers.
