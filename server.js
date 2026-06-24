const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const GoalXYZ = goals.GoalXYZ;
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

// Suppress "chunk size is X" noise from prismarine-chunk
const _warn  = console.warn;
const _error = console.error;
const _log   = console.log;
console.warn  = (...a) => { if (typeof a[0] === 'string' && a[0].toLowerCase().includes('chunk size is')) return; _warn(...a); };
console.error = (...a) => { if (typeof a[0] === 'string' && a[0].toLowerCase().includes('chunk size is')) return; if (a[0] instanceof Error && a[0].message.toLowerCase().includes('chunk size is')) return; _error(...a); };
console.log   = (...a) => { if (typeof a[0] === 'string' && a[0].toLowerCase().includes('chunk size is')) return; _log(...a); };

// ── CONFIG ───────────────────────────────────────────────────────────────────
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
  const legacyPos    = parsed.position ?? parsed.pozycja  ?? {};
  const legacyAntiAfk = parsed.antiAfk  ?? parsed.antiAFK ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    password: parsed.password ?? parsed.haslo ?? DEFAULT_CONFIG.password,
    position: {
      ...DEFAULT_CONFIG.position,
      ...(parsed.position ?? {}),
      enabled: parsed.position?.enabled ?? legacyPos.wlaczone  ?? DEFAULT_CONFIG.position.enabled,
      x:       parsed.position?.x       ?? legacyPos.x         ?? DEFAULT_CONFIG.position.x,
      y:       parsed.position?.y       ?? legacyPos.y         ?? DEFAULT_CONFIG.position.y,
      z:       parsed.position?.z       ?? legacyPos.z         ?? DEFAULT_CONFIG.position.z,
      yaw:     parsed.position?.yaw     ?? legacyPos.yaw       ?? DEFAULT_CONFIG.position.yaw,
      pitch:   parsed.position?.pitch   ?? legacyPos.pitch     ?? DEFAULT_CONFIG.position.pitch,
    },
    antiAfk: {
      ...DEFAULT_CONFIG.antiAfk,
      ...(parsed.antiAfk ?? {}),
      enabled:  parsed.antiAfk?.enabled  ?? legacyAntiAfk.wlaczone ?? DEFAULT_CONFIG.antiAfk.enabled,
      interval: parsed.antiAfk?.interval ?? legacyAntiAfk.interwal  ?? DEFAULT_CONFIG.antiAfk.interval,
    },
    reconnect: {
      ...DEFAULT_CONFIG.reconnect,
      ...(parsed.reconnect ?? {}),
    },
    lobbyDelay:    parsed.lobbyDelay    ?? parsed.opoznienieLobby ?? DEFAULT_CONFIG.lobbyDelay,
    movementDelay: parsed.movementDelay ?? parsed.opoznienieRuchu ?? DEFAULT_CONFIG.movementDelay,
    clickDelay:    parsed.clickDelay    ?? parsed.opoznienieKlik  ?? DEFAULT_CONFIG.clickDelay,
  };
}

let CONFIG = { ...DEFAULT_CONFIG };

function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf-8'); }
  catch (err) { _error('Error writing config.json:', err.message); }
}

function loadConfig() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      CONFIG = normalizeLoadedConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
      saveConfig();
    } catch (err) { _error('Error reading config.json:', err.message); }
  } else { saveConfig(); }
}

// ── PLACEHOLDER BOT STATE (filled in Task 4) ────────────────────────────────
let botStatus = 'idle';
let bot = null;
let antiAfkInterval = null;
let reconnectTimeout = null;

function clearAntiAfk() {
  if (antiAfkInterval) { clearInterval(antiAfkInterval); antiAfkInterval = null; }
}

function startBot() {}   // replaced in Task 4

function stopBot() {
  clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
  clearAntiAfk();
  if (bot) { try { bot.removeAllListeners(); bot.quit(); } catch (_) {} bot = null; }
  botStatus = 'idle';
  setStatus('idle');
  log('info', 'Bot stopped.');
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
  saveConfig();
  res.json({ ok: true });
});

app.post('/api/bot/start', (_req, res) => {
  if (botStatus !== 'idle') return res.json({ ok: false, reason: 'already running' });
  startBot();
  res.json({ ok: true });
});

app.post('/api/bot/stop', (_req, res) => {
  stopBot();
  res.json({ ok: true });
});

// ── START ─────────────────────────────────────────────────────────────────────
function start(port = 3000) {
  loadConfig();
  server.listen(port, () => _log(`Web UI: http://localhost:${port}`));
}

module.exports = { app, normalizeLoadedConfig, start };
