const fs = require('fs');
const path = require('path');
const { _error } = require('./util');

const CACHE_DIR   = process.env.AFK_CACHE_DIR || path.join(__dirname, 'cache');
const CONFIG_FILE = path.join(CACHE_DIR, 'config.json');

const DEFAULT_CONFIG = {
  host: '', port: 25565, username: '', version: '1.21.4', auth: 'offline', password: '',
  position: { enabled: false, x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
  antiAfk:  { enabled: true, interval: 20000 },
  reconnect: { enabled: true, delaySeconds: 30 },
  lobbyDelay: 2000, movementDelay: 3000, clickDelay: 700,
};

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

function normalizeGlobal(g) {
  g = g || {};
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

function loadConfigFile() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
      saveConfigFile(cfg);
      return cfg;
    } catch (err) { _error('Error reading config.json:', err.message); }
  }
  const cfg = { global: normalizeGlobal({}), accounts: [] };
  saveConfigFile(cfg);
  return cfg;
}

function saveConfigFile(config) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8'); }
  catch (err) { _error('Error writing config.json:', err.message); }
}

module.exports = {
  DEFAULT_CONFIG, normalizeLoadedConfig, DEFAULT_GLOBAL, DEFAULT_ACCOUNT,
  makeAccount, normalizeConfig, resolveConfig,
  CACHE_DIR, CONFIG_FILE, loadConfigFile, saveConfigFile,
};
