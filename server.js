const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const GoalXYZ = goals.GoalXYZ;
const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns').promises;
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const { stripColors, extractChatText, resolveServerAddress, installConsoleFilter, _log, _warn, _error } = require('./util');
installConsoleFilter();

// ── CONFIG ───────────────────────────────────────────────────────────────────
const { DEFAULT_CONFIG, normalizeLoadedConfig, CACHE_DIR, CONFIG_FILE, loadConfigFile, saveConfigFile } = require('./config');

let CONFIG = { ...DEFAULT_CONFIG };

// ── BOT STATE ────────────────────────────────────────────────────────────────
const state = {
  phase: 'LOBBY',
  loggedIn: false,
  seenLobby: false,
  onTargetServer: false,
  atPosition: false,
  transferTimeout: null,
};

let botStatus = 'idle';
let bot = null;
let antiAfkInterval = null;
let reconnectTimeout = null;

const BLOCKED_TRANSFER_PACKETS = new Set([
  'position', 'position_look', 'look', 'flying', 'window_close',
  'window_click', 'held_item_slot', 'arm_animation', 'entity_action', 'vehicle_move',
]);


// ── ANTI-AFK ─────────────────────────────────────────────────────────────────
function startAntiAfk() {
  if (!CONFIG.antiAfk.enabled || antiAfkInterval) return;
  log('info', 'Anti-AFK started.');
  let lookLeft = true;
  antiAfkInterval = setInterval(() => {
    if (!bot || !bot.entity) return;
    const baseYaw   = CONFIG.position.yaw   !== undefined ? (CONFIG.position.yaw   * Math.PI) / 180 : bot.entity.yaw;
    const basePitch = CONFIG.position.pitch !== undefined ? (CONFIG.position.pitch * Math.PI) / 180 : bot.entity.pitch;
    const diff = lookLeft ? 0.05 : -0.05;
    lookLeft = !lookLeft;
    bot.look(baseYaw + diff, basePitch, true);
  }, CONFIG.antiAfk.interval);
}

function clearAntiAfk() {
  if (antiAfkInterval) { clearInterval(antiAfkInterval); antiAfkInterval = null; }
}

// ── RECONNECT ─────────────────────────────────────────────────────────────────
function scheduleReconnect() {
  clearAntiAfk();
  clearTimeout(state.transferTimeout);
  state.transferTimeout = null;
  if (reconnectTimeout) return;
  if (!CONFIG.reconnect.enabled) {
    botStatus = 'idle';
    setStatus('idle');
    log('info', 'Auto-reconnect disabled. Bot stopped.');
    return;
  }
  const delaySec = CONFIG.reconnect.delaySeconds;
  log('warn', `Reconnecting in ${delaySec}s...`);
  botStatus = 'reconnecting';
  setStatus('reconnecting');
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    state.phase         = 'LOBBY';
    state.loggedIn      = false;
    state.seenLobby     = false;
    state.onTargetServer = false;
    state.atPosition    = false;
    state.transferTimeout = null;
    log('info', 'Reconnecting...');
    startBot().catch((err) => log('error', `Failed to start bot: ${err.message}`));
  }, delaySec * 1000);
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function startNavigation() {
  if (!bot) return;
  try {
    const mcData    = bot.registry || require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    movements.canDig = false;
    bot.pathfinder.setMovements(movements);
    const goal = new GoalXYZ(CONFIG.position.x, CONFIG.position.y, CONFIG.position.z);
    log('info', `Navigating to X:${CONFIG.position.x} Y:${CONFIG.position.y} Z:${CONFIG.position.z}`);
    bot.pathfinder.setGoal(goal);
  } catch (err) {
    log('error', `Pathfinder error: ${err.message}`);
    startAntiAfk();
  }
}

// ── SERVER FLOW ───────────────────────────────────────────────────────────────
function enterServer() {
  if (state.phase === 'MODE_SELECT' || state.phase === 'TRANSFER' || state.onTargetServer) return;
  log('info', 'Opening mode selection menu (hotbar slot 5)...');
  state.phase = 'MODE_SELECT';
  setTimeout(() => {
    try { if (bot) { bot.setQuickBarSlot(4); bot.activateItem(); } }
    catch (err) { log('error', `Error using hotbar item: ${err.message}`); }
  }, 2000);
}

function startTransfer() {
  state.phase = 'TRANSFER';
  if (bot) bot.physicsEnabled = false;
  log('info', 'Transferring to target server...');
  clearTimeout(state.transferTimeout);
  state.transferTimeout = setTimeout(() => {
    if (state.phase === 'TRANSFER') {
      log('warn', 'Transfer timeout — continuing...');
      onArriveAtTargetServer();
    }
  }, 30000);
}

function onArriveAtTargetServer() {
  if (state.onTargetServer) return;
  state.onTargetServer = true;
  state.phase = 'SERVER';
  if (bot) bot.physicsEnabled = true;
  clearTimeout(state.transferTimeout);
  botStatus = 'connected';
  setStatus('connected');
  log('info', 'Arrived at target server.');
  if (CONFIG.position.enabled) {
    setTimeout(() => startNavigation(), CONFIG.movementDelay);
  } else {
    log('info', 'Movement disabled — standing at spawn.');
    startAntiAfk();
  }
}

// ── STOP BOT ──────────────────────────────────────────────────────────────────
function stopBot() {
  clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
  clearAntiAfk();
  clearTimeout(state.transferTimeout);
  state.transferTimeout = null;
  if (bot) { try { bot.removeAllListeners(); bot.quit(); } catch (_) {} bot = null; }
  botStatus = 'idle';
  setStatus('idle');
  log('info', 'Bot stopped.');
}

// ── START BOT ─────────────────────────────────────────────────────────────────
async function startBot() {
  if (bot) { try { bot.removeAllListeners(); bot.quit(); } catch (_) {} bot = null; }
  clearAntiAfk();
  clearTimeout(state.transferTimeout);
  state.transferTimeout = null;

  botStatus = 'connecting';
  setStatus('connecting');
  log('info', `Connecting to ${CONFIG.host}:${CONFIG.port}...`);

  const target = await resolveServerAddress(CONFIG.host, CONFIG.port);
  if (target.host !== CONFIG.host || target.port !== CONFIG.port) {
    log('info', `Resolved ${CONFIG.host} via SRV to ${target.host}:${target.port}`);
  }

  bot = mineflayer.createBot({
    host: target.host, port: target.port, username: CONFIG.username,
    version: CONFIG.version, auth: CONFIG.auth,
    profilesFolder: path.join(CACHE_DIR, 'nmp-cache'),
    onMsaCode: (data) => {
      log('warn', `Microsoft auth required — visit: ${data.verification_uri}`);
      log('warn', `Enter code: ${data.user_code}`);
      broadcast('auth', { verification_uri: data.verification_uri, user_code: data.user_code });
    },
  });

  bot.on('error', (err) => { log('error', `Connection error: ${err.message}`); scheduleReconnect(); });
  bot.on('kicked', (reason) => { log('warn', `Kicked: ${stripColors(reason)}`); scheduleReconnect(); });
  bot.on('end', () => { log('warn', 'Connection ended.'); scheduleReconnect(); });

  bot.loadPlugin(pathfinder);

  if (bot._client) {
    const originalWrite = bot._client.write.bind(bot._client);
    bot._client.write = (name, params) => {
      if (state.phase === 'TRANSFER' && BLOCKED_TRANSFER_PACKETS.has(name)) return;
      originalWrite(name, params);
    };
    bot._client.on('add_resource_pack', (data) => {
      if (state.phase !== 'TRANSFER') return;
      log('info', 'Accepting server resource pack...');
      originalWrite('resource_pack_receive', { uuid: data.uuid, result: 3 });
      originalWrite('resource_pack_receive', { uuid: data.uuid, result: 0 });
    });
    bot._client.on('finish_configuration', () => {
      if (state.phase === 'TRANSFER') setTimeout(() => onArriveAtTargetServer(), 1500);
    });
  }

  bot.on('death', () => {
    log('warn', 'Bot died — respawning...');
    clearAntiAfk();
    state.onTargetServer = false;
    state.atPosition     = false;
    state.phase          = 'TRANSFER';
    setTimeout(() => { try { bot.respawn(); } catch (err) { log('error', `Respawn error: ${err.message}`); } }, 2000);
  });

  bot.on('spawn', () => {
    if (!state.seenLobby) {
      state.seenLobby = true;
      state.phase     = 'LOBBY';
      botStatus       = 'connected';
      setStatus('connected');
      if (CONFIG.auth === 'microsoft') {
        log('info', 'Microsoft login — moving to target server...');
        state.loggedIn = true;
        setTimeout(() => enterServer(), CONFIG.lobbyDelay);
        return;
      }
      log('info', 'Connected to lobby — waiting for login prompt...');
      if (!CONFIG.password) {
        log('info', 'No password configured — skipping chat login.');
        state.loggedIn = true;
        setTimeout(() => enterServer(), CONFIG.lobbyDelay);
        return;
      }
      setTimeout(() => {
        if (!state.loggedIn) { log('info', 'No login prompt detected — proceeding.'); state.loggedIn = true; enterServer(); }
      }, 6000);
      return;
    }
    if (state.phase === 'TRANSFER') setTimeout(() => onArriveAtTargetServer(), 1500);
  });

  bot.on('message', (msg) => {
    const text  = msg.toString();
    const lower = text.toLowerCase();
    log('info', `[CHAT] ${text}`);
    if (!CONFIG.password) return;
    const registerTriggers = ['/register', 'register', 'zarejestruj'];
    const loginTriggers    = ['/login', 'login', 'zaloguj'];
    if (registerTriggers.some((t) => lower.includes(t)) && !lower.includes('unregister')) {
      log('info', 'Registering account...');
      setTimeout(() => bot.chat(`/register ${CONFIG.password} ${CONFIG.password}`), 600);
      return;
    }
    if (loginTriggers.some((t) => lower.includes(t)) && !state.loggedIn) {
      log('info', 'Logging in...');
      setTimeout(() => bot.chat(`/login ${CONFIG.password}`), 600);
      return;
    }
    const confirmations = ['logged in', 'welcome', 'successfully', 'login successful', 'zalogowano', 'zalogowałeś', 'pomyślnie', 'poprawnie'];
    if (!state.loggedIn && confirmations.some((p) => lower.includes(p))) {
      state.loggedIn = true;
      log('info', `Logged in! Moving to server in ${CONFIG.lobbyDelay / 1000}s...`);
      setTimeout(() => enterServer(), CONFIG.lobbyDelay);
    }
  });

  bot.on('windowOpen', (window) => {
    const title = stripColors(window.title ?? '').toUpperCase();
    log('info', `Opened window: "${title}"`);
    setTimeout(() => {
      if (state.phase === 'MODE_SELECT') {
        const target = window.slots[13];
        log('info', `Selecting Survival mode (slot 13). Item: ${target ? target.name : 'NONE'}`);
        bot.clickWindow(13, 0, 0).catch(() => log('info', 'Click interrupted by transfer (expected).'));
        startTransfer();
      }
    }, CONFIG.clickDelay);
  });

  bot.on('goal_reached', () => {
    log('info', 'Goal reached — at target position.');
    state.atPosition = true;
    if (CONFIG.position.yaw !== undefined && CONFIG.position.pitch !== undefined) {
      bot.look((CONFIG.position.yaw * Math.PI) / 180, (CONFIG.position.pitch * Math.PI) / 180, true);
    }
    startAntiAfk();
  });

  bot.on('path_update', (results) => {
    if (results.status === 'noPath') log('warn', 'Pathfinder: no path to goal. Check coordinates/obstacles.');
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
  if (botStatus !== 'idle') return res.json({ ok: false, reason: 'already running' });
  startBot().catch((err) => {
    log('error', `Failed to start bot: ${err.message}`);
    botStatus = 'idle';
    setStatus('idle');
  });
  res.json({ ok: true });
});

app.post('/api/bot/stop', (_req, res) => {
  stopBot();
  res.json({ ok: true });
});

// ── START ─────────────────────────────────────────────────────────────────────
function start(port = 3000) {
  CONFIG = loadConfigFile();
  server.listen(port, () => _log(`Web UI: http://localhost:${port}`));
}

module.exports = { app, normalizeLoadedConfig, resolveServerAddress, start };
