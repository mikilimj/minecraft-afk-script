const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const { resolveServerAddress, installConsoleFilter, _log, _error } = require('./util');
installConsoleFilter();
const { BotRunner } = require('./botRunner');

const { MicrosoftAuthQueue } = require('./msaQueue');
const { resolveConfig, makeAccount, normalizeConfig, loadConfigFile, saveConfigFile, CACHE_DIR } = require('./config');

let CONFIG = { global: null, accounts: [] };   // set in start()
const runners = new Map();                      // accountId -> BotRunner

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

// prismarine-viewer ships per-version item/block PNGs we can reuse for inventory icons.
const VIEWER_TEX = path.join(path.dirname(require.resolve('prismarine-viewer')), 'public', 'textures');

// Resolve a textures folder: prefer the configured version, else the newest shipped one.
function iconDir() {
  const want = CONFIG.global?.server?.version;
  if (want && fs.existsSync(path.join(VIEWER_TEX, want, 'items'))) return path.join(VIEWER_TEX, want);
  let versions = [];
  try {
    versions = fs.readdirSync(VIEWER_TEX, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (_) { /* ignore */ }
  const latest = versions[versions.length - 1];
  return latest ? path.join(VIEWER_TEX, latest) : VIEWER_TEX;
}

// ── EXPRESS + WEBSOCKET ──────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// Push current state to a freshly connected client so a page reload doesn't
// sit on stale defaults (status, inventory, pending auth) until the next change.
wss.on('connection', (ws) => {
  const sendTo = (type, payload) => ws.send(JSON.stringify({ type, ...payload }));
  for (const [id, r] of runners) {
    sendTo('status', { accountId: id, state: r.status });
    const slots = r.currentInventory();
    if (slots && slots.some(Boolean)) sendTo('inventory', { accountId: id, slots });
    const telemetry = r.currentTelemetry();
    if (telemetry) sendTo('telemetry', { accountId: id, data: telemetry });
  }
  const a = msaQueue.active;
  if (a) sendTo('auth', { active: true, ...a });
});

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
    onInventory: (slots) => broadcast('inventory', { accountId: account.id, slots }),
    onTelemetry: (data) => broadcast('telemetry', { accountId: account.id, data }),
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

function validateAccount(account) {
  if (account.overrides?.server) {
    const port = parseInt(account.server?.port, 10);
    if (isNaN(port) || port < 1 || port > 65535)
      return `account "${account.name}": server.port must be 1–65535`;
  }
  if (account.overrides?.reconnect) {
    const delay = parseInt(account.reconnect?.delaySeconds, 10);
    if (isNaN(delay) || delay < 1 || delay > 3600)
      return `account "${account.name}": reconnect.delaySeconds must be 1–3600`;
  }
  return null;
}

// ── ITEM ICONS ───────────────────────────────────────────────────────────────
app.get('/icons/:name', (req, res) => {
  const name = req.params.name;                       // e.g. "diamond_pickaxe.png"
  if (!/^[a-z0-9_]+\.png$/.test(name)) return res.sendStatus(404);
  const base = iconDir();
  for (const sub of ['items', 'blocks']) {
    const file = path.join(base, sub, name);
    if (file.startsWith(base) && fs.existsSync(file)) return res.sendFile(file);
  }
  res.sendStatus(404);
});

// ── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => res.json(CONFIG));

app.post('/api/config', (req, res) => {
  const body = req.body ?? {};
  const err = validateGlobal(body.global);
  if (err) return res.status(400).json({ error: err });
  for (const account of (body.accounts ?? [])) {
    const accErr = validateAccount(account);
    if (accErr) return res.status(400).json({ error: accErr });
  }
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
  viewerPorts.delete(req.params.id);
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

app.post('/api/auth/skip', (_req, res) => { msaQueue.skip(); res.json({ ok: true }); });

// ── START ─────────────────────────────────────────────────────────────────────
function start(port = 3000) {
  CONFIG = loadConfigFile();
  server.listen(port, () => _log(`Web UI: http://localhost:${port}`));
}

module.exports = { app, normalizeConfig, resolveConfig, resolveServerAddress, start, allocateViewerPort };
