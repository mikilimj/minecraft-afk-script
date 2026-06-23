/**
 * ╔══════════════════════════════════════════════════════╗
 * ║                MINECRAFT AFK BOT - TUI              ║
 * ║      Microsoft login, movement to a position        ║
 * ║      Interactive terminal text menu (TUI)           ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Installation: npm install mineflayer mineflayer-pathfinder
 * Run: node index.js
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const GoalXYZ = goals.GoalXYZ;
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Hide the "chunk size is X but only Y" warning from prismarine-chunk.
const originalConsoleWarn = console.warn;
console.warn = function (...args) {
  if (typeof args[0] === 'string' && args[0].toLowerCase().includes('chunk size is')) return;
  originalConsoleWarn.apply(console, args);
};
const originalConsoleError = console.error;
console.error = function (...args) {
  if (typeof args[0] === 'string' && args[0].toLowerCase().includes('chunk size is')) return;
  if (args[0] instanceof Error && args[0].message.toLowerCase().includes('chunk size is')) return;
  originalConsoleError.apply(console, args);
};
const originalConsoleLog = console.log;
console.log = function (...args) {
  if (typeof args[0] === 'string' && args[0].toLowerCase().includes('chunk size is')) return;
  originalConsoleLog.apply(console, args);
};

// ════════════════════════════════════════════════
//  CONFIGURATION - STORED IN CACHE
// ════════════════════════════════════════════════
const CACHE_DIR = path.join(__dirname, 'cache');
const CONFIG_FILE = path.join(CACHE_DIR, 'config.json');

// Default values - intentionally empty; the user fills them through the TUI.
const DEFAULT_CONFIG = {
  host: '',
  port: 25565,
  username: '',
  version: '1.21.4',
  auth: 'offline',
  password: '',

  // Position where the bot should stand.
  position: {
    enabled: false,
    x: 0,
    y: 64,
    z: 0,
    yaw: 0,
    pitch: 0,
  },

  // Anti-AFK protection.
  antiAfk: {
    enabled: true,
    interval: 20000,
  },

  // Delays in milliseconds.
  lobbyDelay: 2000,
  movementDelay: 3000,
  clickDelay: 700,
};

let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

function normalizeLoadedConfig(parsed) {
  const legacyPosition = parsed.position ?? parsed.pozycja ?? {};
  const legacyAntiAfk = parsed.antiAfk ?? parsed.antiAFK ?? {};

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    password: parsed.password ?? parsed.haslo ?? DEFAULT_CONFIG.password,
    position: {
      ...DEFAULT_CONFIG.position,
      ...(parsed.position ?? {}),
      enabled: parsed.position?.enabled ?? legacyPosition.wlaczone ?? DEFAULT_CONFIG.position.enabled,
      x: parsed.position?.x ?? legacyPosition.x ?? DEFAULT_CONFIG.position.x,
      y: parsed.position?.y ?? legacyPosition.y ?? DEFAULT_CONFIG.position.y,
      z: parsed.position?.z ?? legacyPosition.z ?? DEFAULT_CONFIG.position.z,
      yaw: parsed.position?.yaw ?? legacyPosition.yaw ?? DEFAULT_CONFIG.position.yaw,
      pitch: parsed.position?.pitch ?? legacyPosition.pitch ?? DEFAULT_CONFIG.position.pitch,
    },
    antiAfk: {
      ...DEFAULT_CONFIG.antiAfk,
      ...(parsed.antiAfk ?? {}),
      enabled: parsed.antiAfk?.enabled ?? legacyAntiAfk.wlaczone ?? DEFAULT_CONFIG.antiAfk.enabled,
      interval: parsed.antiAfk?.interval ?? legacyAntiAfk.interwal ?? DEFAULT_CONFIG.antiAfk.interval,
    },
    lobbyDelay: parsed.lobbyDelay ?? parsed.opoznienieLobby ?? DEFAULT_CONFIG.lobbyDelay,
    movementDelay: parsed.movementDelay ?? parsed.opoznienieRuchu ?? DEFAULT_CONFIG.movementDelay,
    clickDelay: parsed.clickDelay ?? parsed.opoznienieKlik ?? DEFAULT_CONFIG.clickDelay,
  };
}

// Ensure the cache/ directory exists.
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Load configuration from cache/config.json.
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    CONFIG = normalizeLoadedConfig(parsed);
    saveConfig();
  } catch (err) {
    console.error('Error reading cache/config.json, using default values:', err.message);
  }
} else {
  saveConfig();
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing config.json:', err.message);
  }
}

// ════════════════════════════════════════════════
//  USER INTERFACE (TUI)
// ════════════════════════════════════════════════
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function showTUI() {
  while (true) {
    console.clear();
    console.log('\x1b[36m══════════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[36m║                   MINECRAFT AFK BOT - TUI                ║\x1b[0m');
    console.log('\x1b[36m══════════════════════════════════════════════════════════════\x1b[0m');
    console.log(`\x1b[1m1. 👉 START BOT\x1b[0m`);
    console.log(`2. Server:          \x1b[32m${CONFIG.host}:${CONFIG.port}\x1b[0m`);
    console.log(`3. Account:         \x1b[32m${CONFIG.username}\x1b[0m (\x1b[35m${CONFIG.auth}\x1b[0m)`);
    console.log(`4. Login password:  ${CONFIG.password ? '\x1b[32mSET\x1b[0m' : '\x1b[31mMISSING (login skipped)\x1b[0m'}`);
    console.log(
      `5. AFK position:    \x1b[33mX:${CONFIG.position.x} Y:${CONFIG.position.y} Z:${CONFIG.position.z}\x1b[0m [Movement: ${
        CONFIG.position.enabled ? '\x1b[32mENABLED\x1b[0m' : '\x1b[31mDISABLED\x1b[0m'
      }]`
    );
    console.log(
      `6. Anti-AFK system: ${CONFIG.antiAfk.enabled ? '\x1b[32mENABLED\x1b[0m' : '\x1b[31mDISABLED\x1b[0m'} (interval: ${CONFIG.antiAfk.interval}ms)`
    );
    console.log(`7. Exit`);
    console.log('\x1b[36m══════════════════════════════════════════════════════════════\x1b[0m');

    const choice = await askQuestion('Choose an option (1-7): ');

    if (choice === '1') {
      // Validation - do not start the bot without required data.
      const missingHost = !CONFIG.host.trim();
      const missingUsername = !CONFIG.username.trim();
      if (missingHost || missingUsername) {
        console.log('');
        if (missingHost) console.log('\x1b[31m⛔ Missing server address! Set it in option 2.\x1b[0m');
        if (missingUsername) console.log('\x1b[31m⛔ Missing bot username / account email! Set it in option 3.\x1b[0m');
        await askQuestion('\nPress Enter to return to the menu...');
        continue;
      }
      console.clear();
      console.log('\x1b[36m🚀 Starting Minecraft connection...\x1b[0m');
      startBot();
      break;
    } else if (choice === '2') {
      const host = await askQuestion(`Enter the server host (current: ${CONFIG.host}): `);
      if (host) CONFIG.host = host;
      const portStr = await askQuestion(`Enter the server port (current: ${CONFIG.port}): `);
      if (portStr) {
        const port = parseInt(portStr, 10);
        if (!isNaN(port)) CONFIG.port = port;
      }
      saveConfig();
    } else if (choice === '3') {
      const username = await askQuestion(`Enter the bot username or Microsoft email (current: ${CONFIG.username}): `);
      if (username) CONFIG.username = username;

      console.log('\nChoose the authentication type:');
      console.log('1. offline (for cracked/non-premium accounts)');
      console.log('2. microsoft (for premium accounts)');
      const authChoice = await askQuestion('Choose (1 or 2): ');
      if (authChoice === '1') CONFIG.auth = 'offline';
      else if (authChoice === '2') CONFIG.auth = 'microsoft';
      saveConfig();
    } else if (choice === '4') {
      console.log('\nEnter the password for automatic login (/login, /register).');
      console.log('Leave the field empty and press Enter to completely skip chat-based auto login.');
      const password = await askQuestion('Enter password: ');
      CONFIG.password = password ? password : '';
      saveConfig();
    } else if (choice === '5') {
      console.log('\nShould movement to the target position be enabled?');
      console.log('1. Yes (the bot will use the pathfinder to walk to the coordinates)');
      console.log('2. No (the bot will stand where it spawns)');
      const movementChoice = await askQuestion('Choose (1 or 2): ');
      if (movementChoice === '1') CONFIG.position.enabled = true;
      else if (movementChoice === '2') CONFIG.position.enabled = false;

      if (CONFIG.position.enabled) {
        const xStr = await askQuestion(`Enter X coordinate (current: ${CONFIG.position.x}): `);
        if (xStr && !isNaN(parseFloat(xStr))) CONFIG.position.x = parseFloat(xStr);

        const yStr = await askQuestion(`Enter Y coordinate (current: ${CONFIG.position.y}): `);
        if (yStr && !isNaN(parseFloat(yStr))) CONFIG.position.y = parseFloat(yStr);

        const zStr = await askQuestion(`Enter Z coordinate (current: ${CONFIG.position.z}): `);
        if (zStr && !isNaN(parseFloat(zStr))) CONFIG.position.z = parseFloat(zStr);

        const yawStr = await askQuestion(`Enter Yaw rotation in degrees (current: ${CONFIG.position.yaw}): `);
        if (yawStr && !isNaN(parseFloat(yawStr))) CONFIG.position.yaw = parseFloat(yawStr);

        const pitchStr = await askQuestion(`Enter Pitch rotation in degrees (current: ${CONFIG.position.pitch}): `);
        if (pitchStr && !isNaN(parseFloat(pitchStr))) CONFIG.position.pitch = parseFloat(pitchStr);
      }
      saveConfig();
    } else if (choice === '6') {
      console.log('\nShould the Anti-AFK system (small head movements) be enabled?');
      console.log('1. Yes');
      console.log('2. No');
      const afkChoice = await askQuestion('Choose (1 or 2): ');
      if (afkChoice === '1') CONFIG.antiAfk.enabled = true;
      else if (afkChoice === '2') CONFIG.antiAfk.enabled = false;

      const intervalStr = await askQuestion(`Enter the interval between movements in ms (current: ${CONFIG.antiAfk.interval}): `);
      if (intervalStr && !isNaN(parseInt(intervalStr, 10))) CONFIG.antiAfk.interval = parseInt(intervalStr, 10);
      saveConfig();
    } else if (choice === '7') {
      console.log('Exiting...');
      process.exit(0);
    }
  }
}

// ════════════════════════════════════════════════
//  BOT STATE AND GLOBAL VARIABLES
// ════════════════════════════════════════════════
const state = {
  phase: 'LOBBY', // LOBBY -> MODE_SELECT -> TRANSFER -> SERVER
  loggedIn: false,
  seenLobby: false,
  onTargetServer: false,
  atPosition: false,
  transferTimeout: null,
};

let bot = null;
let antiAfkInterval = null;
let reconnectTimeout = null;

const BLOCKED_TRANSFER_PACKETS = new Set([
  'position',
  'position_look',
  'look',
  'flying',
  'window_close',
  'window_click',
  'held_item_slot',
  'arm_animation',
  'entity_action',
  'vehicle_move',
]);

// ════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ════════════════════════════════════════════════
function stripColors(text) {
  if (!text) return '';
  let plainText = text;
  if (typeof text === 'object') {
    try {
      plainText = extractChatText(text) || JSON.stringify(text);
    } catch {
      plainText = String(text);
    }
  } else {
    plainText = String(text);
  }
  return plainText.replace(/§[0-9a-fk-orA-FK-OR]/g, '').trim();
}

function extractChatText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return String(obj);
  if (Array.isArray(obj)) return obj.map(extractChatText).join('');
  let result = '';
  if (obj.text !== undefined) result += obj.text;
  if (obj.translate !== undefined) result += obj.translate;
  if (Array.isArray(obj.extra)) result += obj.extra.map(extractChatText).join('');
  return result;
}

// ════════════════════════════════════════════════
//  AUTOMATIC RECONNECT
// ════════════════════════════════════════════════
function scheduleReconnect() {
  clearAntiAfk();
  clearTimeout(state.transferTimeout);
  state.transferTimeout = null;
  if (reconnectTimeout) return;

  console.log('\x1b[33m🔄 Reconnect scheduled in 15 seconds...\x1b[0m');
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    console.log('\x1b[36m🔄 Reconnecting...\x1b[0m');

    // Reset bot state.
    state.phase = 'LOBBY';
    state.loggedIn = false;
    state.seenLobby = false;
    state.onTargetServer = false;
    state.atPosition = false;
    state.transferTimeout = null;

    startBot();
  }, 15000);
}

// ════════════════════════════════════════════════
//  START MINECRAFT BOT
// ════════════════════════════════════════════════
function startBot() {
  // Clear the previous bot and its listeners to avoid leaks.
  if (bot) {
    try {
      bot.removeAllListeners();
      bot.quit();
    } catch (e) {}
    bot = null;
  }
  clearAntiAfk();
  clearTimeout(state.transferTimeout);
  state.transferTimeout = null;

  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
    auth: CONFIG.auth,
    profilesFolder: path.join(CACHE_DIR, 'nmp-cache'), // Microsoft session cache (stored in cache/).
  });

  // Register immediate error and disconnect handlers.
  bot.on('error', (err) => {
    console.error('❌ Bot connection error:', err.message);
    scheduleReconnect();
  });

  bot.on('kicked', (reason) => {
    console.log('⚠️ Bot was kicked from the server:', stripColors(reason));
    scheduleReconnect();
  });

  bot.on('end', () => {
    console.log('⚠️ Connection to the server ended.');
    scheduleReconnect();
  });

  bot.loadPlugin(pathfinder);

  // Block PLAY packets during BungeeCord transfer (prevents DecoderException / kick).
  if (bot._client) {
    const originalWrite = bot._client.write.bind(bot._client);
    bot._client.write = (name, params) => {
      if (state.phase === 'TRANSFER' && BLOCKED_TRANSFER_PACKETS.has(name)) {
        return;
      }
      originalWrite(name, params);
    };

    // Handle resource packs during transfer.
    bot._client.on('add_resource_pack', (data) => {
      if (state.phase !== 'TRANSFER') return;
      console.log('📦 Accepting the server resource pack...');
      originalWrite('resource_pack_receive', { uuid: data.uuid, result: 3 });
      originalWrite('resource_pack_receive', { uuid: data.uuid, result: 0 });
    });

    // React to the end of configuration after transfer.
    bot._client.on('finish_configuration', () => {
      if (state.phase === 'TRANSFER') {
        setTimeout(() => onArriveAtTargetServer(), 1500);
      }
    });
  } else {
    console.warn('⚠️ bot._client is missing. BungeeCord optimization disabled.');
  }

  // Game event handling.
  bot.on('death', () => {
    console.log('💀 Bot died! Respawning and trying to return to the spot...');
    clearAntiAfk();
    state.onTargetServer = false;
    state.atPosition = false;
    state.phase = 'TRANSFER';

    setTimeout(() => {
      try {
        bot.respawn();
      } catch (err) {
        console.error('❌ Error while respawning:', err.message);
      }
    }, 2000);
  });

  bot.on('spawn', () => {
    if (!state.seenLobby) {
      state.seenLobby = true;
      state.phase = 'LOBBY';

      if (CONFIG.auth === 'microsoft') {
        console.log('🌐 Logged in through Microsoft (Premium). Moving to the target server...');
        state.loggedIn = true;
        setTimeout(() => {
          enterServer();
        }, CONFIG.lobbyDelay);
        return;
      }

      console.log('🌐 Connected to the lobby - waiting for the login command...');

      // If no password is configured, skip login immediately.
      if (!CONFIG.password) {
        console.log('⏳ No password configured in the TUI. Skipping chat login.');
        state.loggedIn = true;
        setTimeout(() => {
          enterServer();
        }, CONFIG.lobbyDelay);
        return;
      }

      // Otherwise wait 6 seconds for possible auto-login if it does not happen earlier.
      setTimeout(() => {
        if (!state.loggedIn) {
          console.log('⏳ No login request detected. Assuming an active session.');
          state.loggedIn = true;
          enterServer();
        }
      }, 6000);

      return;
    }

    if (state.phase === 'TRANSFER') {
      setTimeout(() => onArriveAtTargetServer(), 1500);
    }
  });

  bot.on('message', (msg) => {
    const text = msg.toString();
    const lower = text.toLowerCase();
    console.log('[CHAT]', text);

    // If the password field is empty, ignore login/register prompts entirely.
    if (!CONFIG.password) return;

    const registerTriggers = ['/register', 'register', 'zarejestruj'];
    const loginTriggers = ['/login', 'login', 'zaloguj'];

    // Registration.
    if (registerTriggers.some((trigger) => lower.includes(trigger)) && !lower.includes('unregister')) {
      console.log('📝 Registration request detected. Registering account...');
      setTimeout(() => bot.chat(`/register ${CONFIG.password} ${CONFIG.password}`), 600);
      return;
    }

    // Login.
    if (loginTriggers.some((trigger) => lower.includes(trigger)) && !state.loggedIn) {
      console.log('🔑 Login request detected. Logging in...');
      setTimeout(() => bot.chat(`/login ${CONFIG.password}`), 600);
      return;
    }

    // Login confirmation.
    const confirmations = [
      'logged in',
      'welcome',
      'successfully',
      'login successful',
      'zalogowano',
      'zalogowałeś',
      'pomyślnie',
      'poprawnie',
    ];
    if (!state.loggedIn && confirmations.some((phrase) => lower.includes(phrase))) {
      state.loggedIn = true;
      console.log(`✅ Logged in! Moving to the server in ${CONFIG.lobbyDelay / 1000}s...`);
      setTimeout(() => {
        enterServer();
      }, CONFIG.lobbyDelay);
    }
  });

  bot.on('windowOpen', (window) => {
    const title = stripColors(window.title ?? '').toUpperCase();
    console.log(`\n📦 Opened window: "${title}" (phase: ${state.phase})`);

    setTimeout(() => {
      if (state.phase === 'MODE_SELECT') {
        const target = window.slots[13];
        console.log(`🎮 Selecting Survival mode (slot 14, index 13). Item: ${target ? target.name : 'NONE'}`);

        bot.clickWindow(13, 0, 0).catch(() => {
          console.log('ℹ️ Click interrupted by transfer (expected).');
        });
        console.log('✅ Click sent - starting transfer...');
        startTransfer();
      }
    }, CONFIG.clickDelay);
  });

  // Pathfinding handling inside startBot.
  bot.on('goal_reached', () => {
    console.log('🎯 Goal reached! The bot is standing at the target location.');
    state.atPosition = true;

    if (CONFIG.position.yaw !== undefined && CONFIG.position.pitch !== undefined) {
      const yawRad = (CONFIG.position.yaw * Math.PI) / 180;
      const pitchRad = (CONFIG.position.pitch * Math.PI) / 180;
      bot.look(yawRad, pitchRad, true);
    }

    startAntiAfk();
  });

  bot.on('path_update', (results) => {
    if (results.status === 'noPath') {
      console.log('⚠️ Pathfinder could not find a path to the goal. Check obstacles or coordinate values.');
    }
  });
}

function enterServer() {
  if (state.phase === 'MODE_SELECT' || state.phase === 'TRANSFER' || state.onTargetServer) return;

  console.log('🧭 Using the item in hotbar slot 5 to open the mode selection menu...');
  state.phase = 'MODE_SELECT';

  setTimeout(() => {
    try {
      if (bot) {
        bot.setQuickBarSlot(4);
        bot.activateItem();
        console.log('✅ Item from the hotbar used!');
      }
    } catch (err) {
      console.error('❌ Error while using the hotbar item:', err.message);
    }
  }, 2000);
}

function startTransfer() {
  state.phase = 'TRANSFER';
  if (bot) {
    bot.physicsEnabled = false;
  }
  console.log('🔄 Transferring to the target server - pausing physics and movement packets...');

  clearTimeout(state.transferTimeout);
  state.transferTimeout = setTimeout(() => {
    if (state.phase === 'TRANSFER') {
      console.log('⏰ Transfer timeout - trying to continue...');
      onArriveAtTargetServer();
    }
  }, 30000);
}

function onArriveAtTargetServer() {
  if (state.onTargetServer) return;
  state.onTargetServer = true;
  state.phase = 'SERVER';
  if (bot) {
    bot.physicsEnabled = true;
  }
  clearTimeout(state.transferTimeout);

  console.log('✅ I am on the target server!');

  if (CONFIG.position.enabled) {
    console.log(`🧭 Preparing movement to the target spot in ${CONFIG.movementDelay / 1000}s...`);
    setTimeout(() => {
      startNavigation();
    }, CONFIG.movementDelay);
  } else {
    console.log('ℹ️ Movement is disabled in the configuration. Standing at the spawn point.');
    startAntiAfk();
  }
}

// ════════════════════════════════════════════════
//  PATHFINDER LOGIC (MOVEMENT)
// ════════════════════════════════════════════════
function startNavigation() {
  if (!bot) return;
  try {
    const mcData = bot.registry || require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);

    movements.canDig = false; // Do not break blocks or alter the map.

    bot.pathfinder.setMovements(movements);

    const goal = new GoalXYZ(CONFIG.position.x, CONFIG.position.y, CONFIG.position.z);
    console.log(`🏃 Starting route to the goal: X:${CONFIG.position.x}, Y:${CONFIG.position.y}, Z:${CONFIG.position.z}`);

    bot.pathfinder.setGoal(goal);
  } catch (err) {
    console.error('❌ Pathfinder configuration error:', err.message);
    console.log('⚠️ Falling back to standing still because of the pathfinder error.');
    startAntiAfk();
  }
}

// ════════════════════════════════════════════════
//  ANTI-AFK SYSTEM
// ════════════════════════════════════════════════
function startAntiAfk() {
  if (!CONFIG.antiAfk.enabled) return;
  if (antiAfkInterval) return;

  console.log('🔄 Starting Anti-AFK system (small head movements)...');
  let lookLeft = true;

  antiAfkInterval = setInterval(() => {
    if (!bot || !bot.entity) return;

    const baseYaw = CONFIG.position.yaw !== undefined ? (CONFIG.position.yaw * Math.PI) / 180 : bot.entity.yaw;
    const basePitch = CONFIG.position.pitch !== undefined ? (CONFIG.position.pitch * Math.PI) / 180 : bot.entity.pitch;

    const diff = lookLeft ? 0.05 : -0.05;
    lookLeft = !lookLeft;

    bot.look(baseYaw + diff, basePitch, true);
  }, CONFIG.antiAfk.interval);
}

function clearAntiAfk() {
  if (antiAfkInterval) {
    clearInterval(antiAfkInterval);
    antiAfkInterval = null;
    console.log('🛑 Anti-AFK system stopped.');
  }
}

// ════════════════════════════════════════════════
//  START THE TUI WHEN THE APP LAUNCHES
// ════════════════════════════════════════════════
showTUI();
