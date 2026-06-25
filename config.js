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
