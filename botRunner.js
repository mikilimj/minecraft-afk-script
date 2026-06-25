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

  // ── ANTI-AFK ─────────────────────────────────────────────────────────────────
  startAntiAfk() {
    if (!this.config.antiAfk.enabled || this.antiAfkInterval) return;
    this.log('info', 'Anti-AFK started.');
    let lookLeft = true;
    this.antiAfkInterval = setInterval(() => {
      if (!this.bot || !this.bot.entity) return;
      const baseYaw   = this.config.position.yaw   !== undefined ? (this.config.position.yaw   * Math.PI) / 180 : this.bot.entity.yaw;
      const basePitch = this.config.position.pitch !== undefined ? (this.config.position.pitch * Math.PI) / 180 : this.bot.entity.pitch;
      const diff = lookLeft ? 0.05 : -0.05;
      lookLeft = !lookLeft;
      this.bot.look(baseYaw + diff, basePitch, true);
    }, this.config.antiAfk.interval);
  }

  clearAntiAfk() {
    if (this.antiAfkInterval) { clearInterval(this.antiAfkInterval); this.antiAfkInterval = null; }
  }

  // ── RECONNECT ─────────────────────────────────────────────────────────────────
  scheduleReconnect() {
    this.clearAntiAfk();
    clearTimeout(this.state.transferTimeout);
    this.state.transferTimeout = null;
    if (this.reconnectTimeout) return;
    if (!this.config.reconnect.enabled) {
      this._setStatus('idle');
      this.log('info', 'Auto-reconnect disabled. Bot stopped.');
      return;
    }
    const delaySec = this.config.reconnect.delaySeconds;
    this.log('warn', `Reconnecting in ${delaySec}s...`);
    this._setStatus('reconnecting');
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.state.phase         = 'LOBBY';
      this.state.loggedIn      = false;
      this.state.seenLobby     = false;
      this.state.onTargetServer = false;
      this.state.atPosition    = false;
      this.state.transferTimeout = null;
      this.log('info', 'Reconnecting...');
      this.start().catch((err) => this.log('error', `Failed to start bot: ${err.message}`));
    }, delaySec * 1000);
  }

  // ── NAVIGATION ────────────────────────────────────────────────────────────────
  startNavigation() {
    if (!this.bot) return;
    try {
      const mcData    = this.bot.registry || require('minecraft-data')(this.bot.version);
      const movements = new Movements(this.bot, mcData);
      movements.canDig = false;
      this.bot.pathfinder.setMovements(movements);
      const goal = new GoalXYZ(this.config.position.x, this.config.position.y, this.config.position.z);
      this.log('info', `Navigating to X:${this.config.position.x} Y:${this.config.position.y} Z:${this.config.position.z}`);
      this.bot.pathfinder.setGoal(goal);
    } catch (err) {
      this.log('error', `Pathfinder error: ${err.message}`);
      this.startAntiAfk();
    }
  }

  // ── SERVER FLOW ───────────────────────────────────────────────────────────────
  enterServer() {
    if (this.state.phase === 'MODE_SELECT' || this.state.phase === 'TRANSFER' || this.state.onTargetServer) return;
    this.log('info', 'Opening mode selection menu (hotbar slot 5)...');
    this.state.phase = 'MODE_SELECT';
    setTimeout(() => {
      try { if (this.bot) { this.bot.setQuickBarSlot(4); this.bot.activateItem(); } }
      catch (err) { this.log('error', `Error using hotbar item: ${err.message}`); }
    }, 2000);
  }

  startTransfer() {
    this.state.phase = 'TRANSFER';
    if (this.bot) this.bot.physicsEnabled = false;
    this.log('info', 'Transferring to target server...');
    clearTimeout(this.state.transferTimeout);
    this.state.transferTimeout = setTimeout(() => {
      if (this.state.phase === 'TRANSFER') {
        this.log('warn', 'Transfer timeout — continuing...');
        this.onArriveAtTargetServer();
      }
    }, 30000);
  }

  onArriveAtTargetServer() {
    if (this.state.onTargetServer) return;
    this.state.onTargetServer = true;
    this.state.phase = 'SERVER';
    if (this.bot) this.bot.physicsEnabled = true;
    clearTimeout(this.state.transferTimeout);
    this._setStatus('connected');
    this.log('info', 'Arrived at target server.');
    if (this.config.position.enabled) {
      setTimeout(() => this.startNavigation(), this.config.movementDelay);
    } else {
      this.log('info', 'Movement disabled — standing at spawn.');
      this.startAntiAfk();
    }
  }

  // ── STOP BOT ──────────────────────────────────────────────────────────────────
  stop() {
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
    this.clearAntiAfk();
    clearTimeout(this.state.transferTimeout);
    this.state.transferTimeout = null;
    if (this.bot) { try { this.bot.removeAllListeners(); this.bot.quit(); } catch (_) {} this.bot = null; }
    this._setStatus('idle');
    this.log('info', 'Bot stopped.');
  }

  // ── START BOT ─────────────────────────────────────────────────────────────────
  async start() {
    if (this.bot) { try { this.bot.removeAllListeners(); this.bot.quit(); } catch (_) {} this.bot = null; }
    this.clearAntiAfk();
    clearTimeout(this.state.transferTimeout);
    this.state.transferTimeout = null;

    this._setStatus('connecting');
    this.log('info', `Connecting to ${this.config.host}:${this.config.port}...`);

    const target = await resolveServerAddress(this.config.host, this.config.port);
    if (target.host !== this.config.host || target.port !== this.config.port) {
      this.log('info', `Resolved ${this.config.host} via SRV to ${target.host}:${target.port}`);
    }

    this.bot = mineflayer.createBot({
      host: target.host, port: target.port, username: this.config.username,
      version: this.config.version, auth: this.config.auth,
      profilesFolder: this.profilesFolder,
      onMsaCode: (data) => {
        this.log('warn', `Microsoft auth required — visit: ${data.verification_uri}`);
        this.log('warn', `Enter code: ${data.user_code}`);
        this.onAuth({ verification_uri: data.verification_uri, user_code: data.user_code });
      },
    });

    this.bot.on('error', (err) => { this.log('error', `Connection error: ${err.message}`); this.scheduleReconnect(); });
    this.bot.on('kicked', (reason) => { this.log('warn', `Kicked: ${stripColors(reason)}`); this.scheduleReconnect(); });
    this.bot.on('end', () => { this.log('warn', 'Connection ended.'); this.scheduleReconnect(); });

    this.bot.loadPlugin(pathfinder);

    if (this.bot._client) {
      const originalWrite = this.bot._client.write.bind(this.bot._client);
      this.bot._client.write = (name, params) => {
        if (this.state.phase === 'TRANSFER' && BLOCKED_TRANSFER_PACKETS.has(name)) return;
        originalWrite(name, params);
      };
      this.bot._client.on('add_resource_pack', (data) => {
        if (this.state.phase !== 'TRANSFER') return;
        this.log('info', 'Accepting server resource pack...');
        originalWrite('resource_pack_receive', { uuid: data.uuid, result: 3 });
        originalWrite('resource_pack_receive', { uuid: data.uuid, result: 0 });
      });
      this.bot._client.on('finish_configuration', () => {
        if (this.state.phase === 'TRANSFER') setTimeout(() => this.onArriveAtTargetServer(), 1500);
      });
    }

    this.bot.on('death', () => {
      this.log('warn', 'Bot died — respawning...');
      this.clearAntiAfk();
      this.state.onTargetServer = false;
      this.state.atPosition     = false;
      this.state.phase          = 'TRANSFER';
      setTimeout(() => { try { this.bot.respawn(); } catch (err) { this.log('error', `Respawn error: ${err.message}`); } }, 2000);
    });

    this.bot.on('spawn', () => {
      if (!this.state.seenLobby) {
        this.state.seenLobby = true;
        this.state.phase     = 'LOBBY';
        this._setStatus('connected');
        if (this.config.auth === 'microsoft') {
          this.log('info', 'Microsoft login — moving to target server...');
          this.state.loggedIn = true;
          setTimeout(() => this.enterServer(), this.config.lobbyDelay);
          return;
        }
        this.log('info', 'Connected to lobby — waiting for login prompt...');
        if (!this.config.password) {
          this.log('info', 'No password configured — skipping chat login.');
          this.state.loggedIn = true;
          setTimeout(() => this.enterServer(), this.config.lobbyDelay);
          return;
        }
        setTimeout(() => {
          if (!this.state.loggedIn) { this.log('info', 'No login prompt detected — proceeding.'); this.state.loggedIn = true; this.enterServer(); }
        }, 6000);
        return;
      }
      if (this.state.phase === 'TRANSFER') setTimeout(() => this.onArriveAtTargetServer(), 1500);
    });

    this.bot.on('message', (msg) => {
      const text  = msg.toString();
      const lower = text.toLowerCase();
      this.log('info', `[CHAT] ${text}`);
      if (!this.config.password) return;
      const registerTriggers = ['/register', 'register', 'zarejestruj'];
      const loginTriggers    = ['/login', 'login', 'zaloguj'];
      if (registerTriggers.some((t) => lower.includes(t)) && !lower.includes('unregister')) {
        this.log('info', 'Registering account...');
        setTimeout(() => this.bot.chat(`/register ${this.config.password} ${this.config.password}`), 600);
        return;
      }
      if (loginTriggers.some((t) => lower.includes(t)) && !this.state.loggedIn) {
        this.log('info', 'Logging in...');
        setTimeout(() => this.bot.chat(`/login ${this.config.password}`), 600);
        return;
      }
      const confirmations = ['logged in', 'welcome', 'successfully', 'login successful', 'zalogowano', 'zalogowałeś', 'pomyślnie', 'poprawnie'];
      if (!this.state.loggedIn && confirmations.some((p) => lower.includes(p))) {
        this.state.loggedIn = true;
        this.log('info', `Logged in! Moving to server in ${this.config.lobbyDelay / 1000}s...`);
        setTimeout(() => this.enterServer(), this.config.lobbyDelay);
      }
    });

    this.bot.on('windowOpen', (window) => {
      const title = stripColors(window.title ?? '').toUpperCase();
      this.log('info', `Opened window: "${title}"`);
      setTimeout(() => {
        if (this.state.phase === 'MODE_SELECT') {
          const target = window.slots[13];
          this.log('info', `Selecting Survival mode (slot 13). Item: ${target ? target.name : 'NONE'}`);
          this.bot.clickWindow(13, 0, 0).catch(() => this.log('info', 'Click interrupted by transfer (expected).'));
          this.startTransfer();
        }
      }, this.config.clickDelay);
    });

    this.bot.on('goal_reached', () => {
      this.log('info', 'Goal reached — at target position.');
      this.state.atPosition = true;
      if (this.config.position.yaw !== undefined && this.config.position.pitch !== undefined) {
        this.bot.look((this.config.position.yaw * Math.PI) / 180, (this.config.position.pitch * Math.PI) / 180, true);
      }
      this.startAntiAfk();
    });

    this.bot.on('path_update', (results) => {
      if (results.status === 'noPath') this.log('warn', 'Pathfinder: no path to goal. Check coordinates/obstacles.');
    });
  }
}

module.exports = { BotRunner, BLOCKED_TRANSFER_PACKETS };
