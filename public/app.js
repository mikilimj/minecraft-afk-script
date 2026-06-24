// ── ELEMENTS ──────────────────────────────────────────────────────────────────
const statusBadge   = document.getElementById('status-badge');
const btnConnect    = document.getElementById('btn-connect');
const btnDisconnect = document.getElementById('btn-disconnect');
const btnSave       = document.getElementById('btn-save');
const btnClearLog   = document.getElementById('btn-clear-log');
const logEl         = document.getElementById('log');
const saveMsgEl     = document.getElementById('save-msg');

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
let ws;
function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'log')    appendLog(msg.level, msg.text, msg.time);
    if (msg.type === 'status') applyStatus(msg.state);
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}
connectWS();

// ── STATUS ────────────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  idle:         '● Idle',
  connecting:   '● Connecting',
  connected:    '● Connected',
  reconnecting: '● Reconnecting',
};

function applyStatus(state) {
  statusBadge.className   = `badge ${state}`;
  statusBadge.textContent = STATUS_LABELS[state] ?? `● ${state}`;
  btnConnect.disabled     = state !== 'idle';
  btnDisconnect.disabled  = state === 'idle';
}

// ── LOG ───────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appendLog(level, text, time) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML =
    `<span class="log-time">${time}</span>` +
    `<span class="log-text">${escapeHtml(text)}</span>`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

btnClearLog.addEventListener('click', () => { logEl.innerHTML = ''; });

// ── CONFIG ────────────────────────────────────────────────────────────────────
let currentConfig = {};

async function loadConfig() {
  const res = await fetch('/api/config');
  currentConfig = await res.json();
  const c = currentConfig;
  document.getElementById('host').value              = c.host     ?? '';
  document.getElementById('port').value              = c.port     ?? 25565;
  document.getElementById('version').value           = c.version  ?? '1.21.4';
  document.getElementById('username').value          = c.username ?? '';
  document.getElementById('auth').value              = c.auth     ?? 'offline';
  document.getElementById('password').value          = c.password ?? '';
  document.getElementById('position-enabled').checked = c.position?.enabled  ?? false;
  document.getElementById('pos-x').value             = c.position?.x         ?? 0;
  document.getElementById('pos-y').value             = c.position?.y         ?? 64;
  document.getElementById('pos-z').value             = c.position?.z         ?? 0;
  document.getElementById('pos-yaw').value           = c.position?.yaw       ?? 0;
  document.getElementById('pos-pitch').value         = c.position?.pitch     ?? 0;
  document.getElementById('antiafk-enabled').checked  = c.antiAfk?.enabled   ?? true;
  document.getElementById('antiafk-interval').value   = c.antiAfk?.interval  ?? 20000;
  document.getElementById('reconnect-enabled').checked = c.reconnect?.enabled      ?? true;
  document.getElementById('reconnect-delay').value     = c.reconnect?.delaySeconds ?? 30;
}

function collectConfig() {
  return {
    ...currentConfig,
    host:     document.getElementById('host').value.trim(),
    port:     parseInt(document.getElementById('port').value, 10),
    version:  document.getElementById('version').value.trim(),
    username: document.getElementById('username').value.trim(),
    auth:     document.getElementById('auth').value,
    password: document.getElementById('password').value,
    position: {
      enabled: document.getElementById('position-enabled').checked,
      x:       parseFloat(document.getElementById('pos-x').value),
      y:       parseFloat(document.getElementById('pos-y').value),
      z:       parseFloat(document.getElementById('pos-z').value),
      yaw:     parseFloat(document.getElementById('pos-yaw').value),
      pitch:   parseFloat(document.getElementById('pos-pitch').value),
    },
    antiAfk: {
      enabled:  document.getElementById('antiafk-enabled').checked,
      interval: parseInt(document.getElementById('antiafk-interval').value, 10),
    },
    reconnect: {
      enabled:      document.getElementById('reconnect-enabled').checked,
      delaySeconds: parseInt(document.getElementById('reconnect-delay').value, 10),
    },
  };
}

btnSave.addEventListener('click', async () => {
  const cfg = collectConfig();
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  const data = await res.json();
  saveMsgEl.className = 'save-msg';
  if (data.ok) {
    currentConfig = cfg;
    saveMsgEl.textContent = 'Settings saved.';
  } else {
    saveMsgEl.textContent = data.error ?? 'Failed to save.';
    saveMsgEl.className = 'save-msg err';
  }
  setTimeout(() => { saveMsgEl.textContent = ''; }, 3000);
});

// ── BOT CONTROL ───────────────────────────────────────────────────────────────
btnConnect.addEventListener('click',    async () => { await fetch('/api/bot/start', { method: 'POST' }); });
btnDisconnect.addEventListener('click', async () => { await fetch('/api/bot/stop',  { method: 'POST' }); });

// ── INIT ──────────────────────────────────────────────────────────────────────
loadConfig();
