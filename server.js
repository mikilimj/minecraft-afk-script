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

// ── REST API ─────────────────────────────────────────────────────────────────
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

// ── START ─────────────────────────────────────────────────────────────────────
function start(port = 3000) {
  CONFIG = loadConfigFile();
  server.listen(port, () => _log(`Web UI: http://localhost:${port}`));
}

module.exports = { app, normalizeConfig, resolveConfig, resolveServerAddress, start };
