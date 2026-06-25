// ── STATE ─────────────────────────────────────────────────────────────────────
let config = { global: {}, accounts: [] };
const statuses = {};   // accountId -> state string
const inventories = {};   // accountId -> slots array

// ── HELPERS ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Default global shape matching backend DEFAULT_GLOBAL
const DEFAULT_GLOBAL = {
  server:   { host: '', port: 25565, version: '1.21.4' },
  position: { enabled: false, x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
  antiAfk:  { enabled: true, interval: 20000 },
  reconnect: { enabled: true, delaySeconds: 30 },
  lobbyDelay: 2000, movementDelay: 3000, clickDelay: 700,
};

function coalesceGlobal(g) {
  g = g || {};
  return {
    server:   { ...DEFAULT_GLOBAL.server,   ...(g.server   ?? {}) },
    position: { ...DEFAULT_GLOBAL.position, ...(g.position ?? {}) },
    antiAfk:  { ...DEFAULT_GLOBAL.antiAfk,  ...(g.antiAfk  ?? {}) },
    reconnect: { ...DEFAULT_GLOBAL.reconnect, ...(g.reconnect ?? {}) },
    lobbyDelay:    g.lobbyDelay    ?? DEFAULT_GLOBAL.lobbyDelay,
    movementDelay: g.movementDelay ?? DEFAULT_GLOBAL.movementDelay,
    clickDelay:    g.clickDelay    ?? DEFAULT_GLOBAL.clickDelay,
  };
}

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
let ws;
function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'log')       appendLog(msg.accountId, msg.level, msg.text, msg.time);
    if (msg.type === 'status')    applyStatus(msg.accountId, msg.state);
    if (msg.type === 'auth')      handleAuth(msg);
    if (msg.type === 'inventory') applyInventory(msg.accountId, msg.slots);
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}
connectWS();

// ── STATUS ────────────────────────────────────────────────────────────────────
function applyStatus(accountId, state) {
  statuses[accountId] = state;
  const card = document.querySelector(`.account-card[data-id="${CSS.escape(accountId)}"]`);
  if (!card) return;
  const badge = card.querySelector('[data-role="badge"]');
  badge.className = `badge ${state}`;
  badge.textContent = `● ${state}`;
}

// ── AUTH BANNER ───────────────────────────────────────────────────────────────
function handleAuth(msg) {
  const banner = document.getElementById('auth-banner');
  if (!msg.active) { banner.style.display = 'none'; return; }
  document.getElementById('auth-account').textContent = msg.name || msg.accountId || '';
  document.getElementById('auth-code').textContent = msg.user_code;
  document.getElementById('auth-link').href = msg.verification_uri;
  banner.style.display = 'flex';
}

document.getElementById('auth-dismiss').addEventListener('click', () => {
  document.getElementById('auth-banner').style.display = 'none';
});
document.getElementById('auth-skip').onclick = () => fetch('/api/auth/skip', { method: 'POST' });

// ── LOG ───────────────────────────────────────────────────────────────────────
const logEl = document.getElementById('log');

function appendLog(accountId, level, text, time) {
  const acc = config.accounts.find((a) => a.id === accountId);
  const prefix = acc ? `[${acc.name}] ` : (accountId ? `[${accountId}] ` : '');
  const entry = document.createElement('div');
  entry.className = `log-entry ${level || ''}`;
  entry.innerHTML =
    `<span class="log-time">${escapeHtml(time)}</span>` +
    `<span class="log-text">${escapeHtml(prefix + (text ?? ''))}</span>`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

document.getElementById('btn-clear-log').addEventListener('click', () => { logEl.innerHTML = ''; });

// ── CONFIG LOAD ───────────────────────────────────────────────────────────────
async function loadConfig() {
  const res = await fetch('/api/config');
  const raw = await res.json();
  config = {
    global:   coalesceGlobal(raw.global),
    accounts: raw.accounts ?? [],
  };
  renderGlobal();
  renderAccounts();
}

// ── RENDER GLOBAL ─────────────────────────────────────────────────────────────
function renderGlobal() {
  const g = config.global;
  document.getElementById('host').value              = g.server?.host     ?? '';
  document.getElementById('port').value              = g.server?.port     ?? 25565;
  document.getElementById('version').value           = g.server?.version  ?? '1.21.4';
  document.getElementById('position-enabled').checked = g.position?.enabled  ?? false;
  document.getElementById('pos-x').value             = g.position?.x         ?? 0;
  document.getElementById('pos-y').value             = g.position?.y         ?? 64;
  document.getElementById('pos-z').value             = g.position?.z         ?? 0;
  document.getElementById('pos-yaw').value           = g.position?.yaw       ?? 0;
  document.getElementById('pos-pitch').value         = g.position?.pitch     ?? 0;
  document.getElementById('antiafk-enabled').checked  = g.antiAfk?.enabled   ?? true;
  document.getElementById('antiafk-interval').value   = g.antiAfk?.interval  ?? 20000;
  document.getElementById('reconnect-enabled').checked = g.reconnect?.enabled      ?? true;
  document.getElementById('reconnect-delay').value     = g.reconnect?.delaySeconds ?? 30;
}

// ── COLLECT GLOBAL ────────────────────────────────────────────────────────────
function collectGlobal() {
  return {
    server: {
      host:    document.getElementById('host').value.trim(),
      port:    parseInt(document.getElementById('port').value, 10) || 25565,
      version: document.getElementById('version').value.trim() || '1.21.4',
    },
    position: {
      enabled: document.getElementById('position-enabled').checked,
      x:       parseFloat(document.getElementById('pos-x').value)     || 0,
      y:       parseFloat(document.getElementById('pos-y').value)     || 64,
      z:       parseFloat(document.getElementById('pos-z').value)     || 0,
      yaw:     parseFloat(document.getElementById('pos-yaw').value)   || 0,
      pitch:   parseFloat(document.getElementById('pos-pitch').value) || 0,
    },
    antiAfk: {
      enabled:  document.getElementById('antiafk-enabled').checked,
      interval: parseInt(document.getElementById('antiafk-interval').value, 10) || 20000,
    },
    reconnect: {
      enabled:      document.getElementById('reconnect-enabled').checked,
      delaySeconds: parseInt(document.getElementById('reconnect-delay').value, 10) || 30,
    },
    lobbyDelay:    config.global.lobbyDelay    ?? 2000,
    movementDelay: config.global.movementDelay ?? 3000,
    clickDelay:    config.global.clickDelay    ?? 700,
  };
}

// ── RENDER ACCOUNTS ───────────────────────────────────────────────────────────
function renderAccounts() {
  const list = document.getElementById('account-list');
  list.innerHTML = '';
  for (const acc of config.accounts) list.appendChild(renderAccountCard(acc));
  renderBotSelector();
}

// ── SECTION OVERRIDE BLOCK ────────────────────────────────────────────────────
// Returns an HTML string for a section inside an account card.
// key: 'server' | 'position' | 'antiAfk' | 'reconnect'
// fieldsHtml: inner fields markup
function sectionHtml(label, key, fieldsHtml) {
  // checked = Custom (override) = fields enabled; unchecked = use global = fields disabled
  return `
    <div class="section-group section-override" data-section="${key}">
      <h3>${label}
        <label class="toggle override-toggle" title="Use global / Custom">
          <input type="checkbox" class="override-chk" data-section="${key}">
          <span class="slider"></span>
        </label>
        <span class="override-label">Use global</span>
      </h3>
      <div class="override-fields">
        ${fieldsHtml}
      </div>
    </div>`;
}

function serverFieldsHtml(acc) {
  return `
    <div class="row">
      <label>Host<input class="acc-server-host" type="text" value="${escapeAttr(acc.server?.host)}"></label>
      <label class="narrow">Port<input class="acc-server-port" type="number" min="1" max="65535" value="${escapeAttr(acc.server?.port)}"></label>
    </div>
    <label>Version<input class="acc-server-version" type="text" value="${escapeAttr(acc.server?.version)}"></label>`;
}

function positionFieldsHtml(acc) {
  return `
    <label><input type="checkbox" class="acc-position-enabled"${acc.position?.enabled ? ' checked' : ''}> Enabled</label>
    <div class="row three">
      <label>X<input class="acc-pos-x" type="number" step="0.1" value="${escapeAttr(acc.position?.x)}"></label>
      <label>Y<input class="acc-pos-y" type="number" step="0.1" value="${escapeAttr(acc.position?.y)}"></label>
      <label>Z<input class="acc-pos-z" type="number" step="0.1" value="${escapeAttr(acc.position?.z)}"></label>
    </div>
    <div class="row two">
      <label>Yaw<input class="acc-pos-yaw" type="number" step="1" value="${escapeAttr(acc.position?.yaw)}"></label>
      <label>Pitch<input class="acc-pos-pitch" type="number" step="1" value="${escapeAttr(acc.position?.pitch)}"></label>
    </div>`;
}

function antiAfkFieldsHtml(acc) {
  return `
    <label><input type="checkbox" class="acc-antiafk-enabled"${acc.antiAfk?.enabled !== false ? ' checked' : ''}> Enabled</label>
    <label>Interval (ms)<input class="acc-antiafk-interval" type="number" min="1000" step="1000" value="${escapeAttr(acc.antiAfk?.interval)}"></label>`;
}

function reconnectFieldsHtml(acc) {
  return `
    <label><input type="checkbox" class="acc-reconnect-enabled"${acc.reconnect?.enabled !== false ? ' checked' : ''}> Enabled</label>
    <label>Delay (seconds)<input class="acc-reconnect-delay" type="number" min="1" max="3600" value="${escapeAttr(acc.reconnect?.delaySeconds)}"></label>`;
}

// ── ACCOUNT CARD RENDER ───────────────────────────────────────────────────────
function renderAccountCard(acc) {
  const el = document.createElement('div');
  el.className = 'account-card';
  el.dataset.id = acc.id;
  const st = statuses[acc.id] ?? 'idle';
  el.innerHTML = `
    <div class="account-card-head">
      <input class="acc-name" type="text" value="${escapeAttr(acc.name)}" placeholder="Account name">
      <span class="badge ${st}" data-role="badge">● ${st}</span>
      <label class="toggle" title="Enabled">
        <input type="checkbox" class="acc-enabled" ${acc.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
      <button class="btn btn-primary acc-start">Start</button>
      <button class="btn btn-danger acc-stop">Stop</button>
      <button class="btn btn-ghost acc-remove">Remove</button>
    </div>
    <div class="account-card-body">
      <div class="section-group">
        <h3>Account credentials</h3>
        <label>Username / Email<input class="acc-username" type="text" value="${escapeAttr(acc.account?.username)}"></label>
        <label>Auth
          <select class="acc-auth">
            <option value="offline"${acc.account?.auth === 'offline' ? ' selected' : ''}>Offline (cracked)</option>
            <option value="microsoft"${acc.account?.auth === 'microsoft' ? ' selected' : ''}>Microsoft (premium)</option>
          </select>
        </label>
        <label>Password<input class="acc-password" type="password" value="${escapeAttr(acc.account?.password)}" placeholder="Leave empty to skip"></label>
      </div>
      ${sectionHtml('Server', 'server', serverFieldsHtml(acc))}
      ${sectionHtml('AFK Position', 'position', positionFieldsHtml(acc))}
      ${sectionHtml('Anti-AFK', 'antiAfk', antiAfkFieldsHtml(acc))}
      ${sectionHtml('Auto-Reconnect', 'reconnect', reconnectFieldsHtml(acc))}
      <div class="section-group viewer-group">
        <h3>3D View
          <button class="btn btn-ghost view-toggle" data-role="view-toggle">Open</button>
          <label class="view-mode"><input type="checkbox" class="view-firstperson"> POV</label>
          <a class="btn btn-ghost view-popout" href="view.html?id=${escapeAttr(acc.id)}" target="_blank">Pop out</a>
        </h3>
        <div class="viewer-holder" data-role="viewer-holder"></div>
      </div>
      <div class="section-group">
        <h3>Inventory</h3>
        <div class="inv-grid" data-role="inv-grid">${renderInventoryGrid(inventories[acc.id])}</div>
      </div>
    </div>`;
  wireAccountCard(el, acc);
  return el;
}

// ── ACCOUNT CARD WIRING ───────────────────────────────────────────────────────
function wireAccountCard(el, acc) {
  // Name
  el.querySelector('.acc-name').addEventListener('input', (e) => { acc.name = e.target.value; });
  // Enabled
  el.querySelector('.acc-enabled').addEventListener('change', (e) => { acc.enabled = e.target.checked; });
  // Credentials
  el.querySelector('.acc-username').addEventListener('input', (e) => {
    acc.account = { ...acc.account, username: e.target.value };
  });
  el.querySelector('.acc-auth').addEventListener('change', (e) => {
    acc.account = { ...acc.account, auth: e.target.value };
  });
  el.querySelector('.acc-password').addEventListener('input', (e) => {
    acc.account = { ...acc.account, password: e.target.value };
  });

  // Per-section override toggles
  el.querySelectorAll('.override-chk').forEach((chk) => {
    const section = chk.dataset.section;
    const fieldsDiv = chk.closest('.section-override').querySelector('.override-fields');
    const labelEl   = chk.closest('.section-override').querySelector('.override-label');

    // Set initial state from acc.overrides
    const isCustom = !!(acc.overrides && acc.overrides[section]);
    chk.checked = isCustom;
    applyOverride(fieldsDiv, labelEl, isCustom);

    chk.addEventListener('change', (e) => {
      const custom = e.target.checked;
      acc.overrides = { ...acc.overrides, [section]: custom };
      applyOverride(fieldsDiv, labelEl, custom);
    });

    // Wire per-section field inputs back into acc
    wireSection(fieldsDiv, section, acc);
  });

  // Buttons
  el.querySelector('.acc-start').onclick = () => fetch(`/api/bot/start/${acc.id}`, { method: 'POST' });
  el.querySelector('.acc-stop').onclick  = () => fetch(`/api/bot/stop/${acc.id}`,  { method: 'POST' });
  el.querySelector('.acc-remove').onclick = async () => {
    await fetch(`/api/accounts/${acc.id}`, { method: 'DELETE' });
    await loadConfig();
  };

  // 3D view
  const viewBtn = el.querySelector('[data-role="view-toggle"]');
  const holder  = el.querySelector('[data-role="viewer-holder"]');
  const fpChk   = el.querySelector('.view-firstperson');
  let viewOpen = false;
  async function openView() {
    const res = await fetch(`/api/bot/view/${acc.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstPerson: fpChk.checked }),
    });
    const data = await res.json();
    if (!res.ok) { appendLog(acc.id, 'warn', data.error || 'Cannot open view'); return; }
    holder.innerHTML = `<iframe class="viewer-frame" src="http://${location.hostname}:${data.port}/"></iframe>`;
    viewOpen = true; viewBtn.textContent = 'Close';
  }
  async function closeView() {
    await fetch(`/api/bot/view/${acc.id}`, { method: 'DELETE' });
    holder.innerHTML = ''; viewOpen = false; viewBtn.textContent = 'Open';
  }
  viewBtn.onclick = () => (viewOpen ? closeView() : openView());
  fpChk.addEventListener('change', () => { if (viewOpen) openView(); });   // re-open with new mode
}

function applyOverride(fieldsDiv, labelEl, isCustom) {
  if (isCustom) {
    fieldsDiv.classList.remove('section-disabled');
    labelEl.textContent = 'Custom';
  } else {
    fieldsDiv.classList.add('section-disabled');
    labelEl.textContent = 'Use global';
  }
}

function wireSection(fieldsDiv, section, acc) {
  function num(cls, key, fallback) {
    const el = fieldsDiv.querySelector(cls);
    if (!el) return;
    el.addEventListener('input', (e) => {
      acc[section] = { ...acc[section], [key]: parseFloat(e.target.value) || fallback };
    });
  }
  function numInt(cls, key, fallback) {
    const el = fieldsDiv.querySelector(cls);
    if (!el) return;
    el.addEventListener('input', (e) => {
      acc[section] = { ...acc[section], [key]: parseInt(e.target.value, 10) || fallback };
    });
  }
  function str(cls, key) {
    const el = fieldsDiv.querySelector(cls);
    if (!el) return;
    el.addEventListener('input', (e) => {
      acc[section] = { ...acc[section], [key]: e.target.value };
    });
  }
  function chk(cls, key) {
    const el = fieldsDiv.querySelector(cls);
    if (!el) return;
    el.addEventListener('change', (e) => {
      acc[section] = { ...acc[section], [key]: e.target.checked };
    });
  }

  if (section === 'server') {
    str('.acc-server-host', 'host');
    numInt('.acc-server-port', 'port', 25565);
    str('.acc-server-version', 'version');
  }
  if (section === 'position') {
    chk('.acc-position-enabled', 'enabled');
    num('.acc-pos-x', 'x', 0);
    num('.acc-pos-y', 'y', 64);
    num('.acc-pos-z', 'z', 0);
    num('.acc-pos-yaw', 'yaw', 0);
    num('.acc-pos-pitch', 'pitch', 0);
  }
  if (section === 'antiAfk') {
    chk('.acc-antiafk-enabled', 'enabled');
    numInt('.acc-antiafk-interval', 'interval', 20000);
  }
  if (section === 'reconnect') {
    chk('.acc-reconnect-enabled', 'enabled');
    numInt('.acc-reconnect-delay', 'delaySeconds', 30);
  }
}

// ── SAVE ──────────────────────────────────────────────────────────────────────
const saveMsgEl = document.getElementById('save-msg');

document.getElementById('btn-save').addEventListener('click', async () => {
  const payload = {
    global:   collectGlobal(),
    accounts: config.accounts,
  };
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  saveMsgEl.className = 'save-msg';
  if (data.ok) {
    config.global = payload.global;
    saveMsgEl.textContent = 'Settings saved.';
  } else {
    saveMsgEl.textContent = data.error ?? 'Failed to save.';
    saveMsgEl.className = 'save-msg err';
  }
  setTimeout(() => { saveMsgEl.textContent = ''; }, 3000);
});

// ── ACCOUNT MANAGEMENT ────────────────────────────────────────────────────────
document.getElementById('btn-add').onclick = async () => {
  await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await loadConfig();
};
document.getElementById('btn-start-all').onclick = () => fetch('/api/bot/start-all', { method: 'POST' });
document.getElementById('btn-stop-all').onclick  = () => fetch('/api/bot/stop-all',  { method: 'POST' });

// ── COMMAND PANEL ───────────────────────────────────────────────────────────────
function renderBotSelector() {
  const list = document.getElementById('cmd-bot-list');
  if (!list) return;
  const prev = selectedIds();
  list.innerHTML = '';
  for (const acc of config.accounts) {
    const id = document.createElement('label');
    id.className = 'cmd-bot-item';
    const checked = prev.includes(acc.id) ? ' checked' : '';
    id.innerHTML = `<input type="checkbox" class="cmd-bot-chk" value="${escapeAttr(acc.id)}"${checked}> ${escapeHtml(acc.name)}`;
    list.appendChild(id);
  }
}

function selectedIds() {
  return Array.from(document.querySelectorAll('.cmd-bot-chk:checked')).map((c) => c.value);
}

async function sendCommand(action, params = {}) {
  const ids = selectedIds();
  if (ids.length === 0) { appendLog(null, 'warn', 'No bots selected.'); return; }
  await fetch('/api/bot/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, action, params }),
  });
}

function wireCommandPanel() {
  document.getElementById('cmd-select-all').onclick = () =>
    document.querySelectorAll('.cmd-bot-chk').forEach((c) => { c.checked = true; });
  document.getElementById('cmd-clear-all').onclick = () =>
    document.querySelectorAll('.cmd-bot-chk').forEach((c) => { c.checked = false; });

  document.querySelectorAll('input[name="move-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      const manual = document.querySelector('input[name="move-mode"]:checked').value === 'manual';
      document.getElementById('cmd-manual').style.display = manual ? '' : 'none';
      document.getElementById('cmd-pathfind').style.display = manual ? 'none' : '';
    });
  });

  document.getElementById('cmd-go').onclick = () => sendCommand('gotoXYZ', {
    x: parseFloat(document.getElementById('cmd-x').value) || 0,
    y: parseFloat(document.getElementById('cmd-y').value) || 0,
    z: parseFloat(document.getElementById('cmd-z').value) || 0,
  });

  document.querySelectorAll('.wasd').forEach((btn) => {
    const key = btn.dataset.key;
    const down = () => sendCommand('control', { key, state: true });
    const up   = () => sendCommand('control', { key, state: false });
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
  });
  document.getElementById('cmd-stop-move').onclick = () => sendCommand('clearControls', {});

  document.getElementById('cmd-send').onclick = () => {
    const text = document.getElementById('cmd-chat').value;
    if (text) { sendCommand('chat', { text }); document.getElementById('cmd-chat').value = ''; }
  };
  document.getElementById('cmd-chat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('cmd-send').click();
  });

  document.getElementById('cmd-attack').onclick = () =>
    sendCommand('attack', { target: document.getElementById('cmd-attack-target').value.trim() || undefined });

  document.getElementById('cmd-click-start').onclick = () => sendCommand('autoclick', {
    on: true,
    mode: document.getElementById('cmd-click-mode').value,
    intervalMs: parseInt(document.getElementById('cmd-click-interval').value, 10) || 200,
  });
  document.getElementById('cmd-click-stop').onclick = () => sendCommand('autoclick', { on: false });
}

wireCommandPanel();

// ── INVENTORY ───────────────────────────────────────────────────────────────────
function applyInventory(accountId, slots) {
  inventories[accountId] = slots;
  const card = document.querySelector(`.account-card[data-id="${CSS.escape(accountId)}"]`);
  if (!card) return;
  const grid = card.querySelector('[data-role="inv-grid"]');
  if (grid) grid.innerHTML = renderInventoryGrid(slots);
}

function renderInventoryGrid(slots) {
  const cells = [];
  for (let i = 0; i < 36; i++) {
    const item = (slots || [])[i];
    if (item) {
      cells.push(`<div class="inv-cell filled" title="${escapeAttr(item.displayName || item.name)}">` +
        `<span class="inv-name">${escapeHtml((item.name || '').replace(/_/g, ' '))}</span>` +
        `<span class="inv-count">${item.count}</span></div>`);
    } else {
      cells.push('<div class="inv-cell"></div>');
    }
  }
  return cells.join('');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
loadConfig();
