const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const { resolveServerAddress, installConsoleFilter, _log, _warn, _error } = require('./util');
installConsoleFilter();
const { BotRunner } = require('./botRunner');

// ── CONFIG ───────────────────────────────────────────────────────────────────
const { DEFAULT_CONFIG, normalizeLoadedConfig, CACHE_DIR, CONFIG_FILE, loadConfigFile, saveConfigFile } = require('./config');

let CONFIG = { ...DEFAULT_CONFIG };

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

function log(level, text) {
  const time = new Date().toLocaleTimeString();
  broadcast('log', { level, text, time });
  if (level === 'error') _error(text); else _log(text);
}

function setStatus(state) { broadcast('status', { state }); }

// ── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => res.json(CONFIG));

app.post('/api/config', (req, res) => {
  const body  = req.body ?? {};
  const port  = parseInt(body.port, 10);
  if (isNaN(port) || port < 1 || port > 65535)
    return res.status(400).json({ error: 'port must be 1–65535' });
  const delay = parseInt(body.reconnect?.delaySeconds, 10);
  if (isNaN(delay) || delay < 1 || delay > 3600)
    return res.status(400).json({ error: 'reconnect.delaySeconds must be 1–3600' });
  CONFIG = normalizeLoadedConfig(body);
  saveConfigFile(CONFIG);
  res.json({ ok: true });
});

app.post('/api/bot/start', (_req, res) => {
  if (runner && runner.status !== 'idle') return res.json({ ok: false, reason: 'already running' });
  runner = makeRunner();
  runner.start().catch((err) => { log('error', `Failed to start bot: ${err.message}`); runner._status = 'idle'; setStatus('idle'); });
  res.json({ ok: true });
});

app.post('/api/bot/stop', (_req, res) => {
  if (runner) runner.stop();
  res.json({ ok: true });
});

// ── START ─────────────────────────────────────────────────────────────────────
function start(port = 3000) {
  CONFIG = loadConfigFile();
  server.listen(port, () => _log(`Web UI: http://localhost:${port}`));
}

module.exports = { app, normalizeLoadedConfig, resolveServerAddress, start };
