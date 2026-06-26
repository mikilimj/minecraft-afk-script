// ── STATE ─────────────────────────────────────────────────────────────────────
let config = { global: {}, accounts: [] };
const statuses    = {};   // accountId -> state string
const inventories = {};   // accountId -> slots array
const logs        = {};   // accountId -> [{ level, text, time }]
const auths       = {};   // accountId -> auth payload (or absent)
const unread      = {};   // accountId -> bool (log activity while tab not open)
const openViewers = new Set();   // accountIds with an open 3D viewer
let activeTab = 'general';        // 'general' | 'new' | <accountId>
let draft = null;                 // working object for the new-account form
let userSetSize = false;          // whether the user dragged the preview-size slider
const LOG_CAP = 500;

// ── HELPERS ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function findAccount(id) { return config.accounts.find((a) => a.id === id); }

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
    if      (msg.type === 'log')       onLog(msg);
    else if (msg.type === 'status')    onStatus(msg);
    else if (msg.type === 'auth')      onAuth(msg);
    else if (msg.type === 'inventory') onInventory(msg);
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}
connectWS();

// ── WS HANDLERS ─────────────────────────────────────────────────────────────────
function onStatus(msg) {
  statuses[msg.accountId] = msg.state;
  // Update every badge bound to this account (preview card and/or account panel).
  document.querySelectorAll(`[data-id="${CSS.escape(msg.accountId)}"] [data-role="badge"]`)
    .forEach((b) => { b.className = `badge ${msg.state}`; b.textContent = `● ${msg.state}`; });
  updateTabDot(msg.accountId);
}

function onInventory(msg) {
  inventories[msg.accountId] = msg.slots;
  document.querySelectorAll(`[data-id="${CSS.escape(msg.accountId)}"] [data-role="inv-grid"]`)
    .forEach((g) => { g.innerHTML = renderInventoryGrid(msg.slots); });
}

function onLog(msg) {
  const arr = (logs[msg.accountId] ||= []);
  arr.push({ level: msg.level, text: msg.text, time: msg.time });
  if (arr.length > LOG_CAP) arr.splice(0, arr.length - LOG_CAP);
  if (activeTab === msg.accountId) {
    const el = document.querySelector('#account-panel [data-role="acct-log"]');
    if (el) { appendLogEntry(el, msg.level, msg.text, msg.time); el.scrollTop = el.scrollHeight; }
  } else if (msg.accountId) {
    unread[msg.accountId] = true;
    updateTabDot(msg.accountId);
  }
}

function onAuth(msg) {
  if (msg.active && msg.accountId) {
    auths[msg.accountId] = msg;
  } else {
    // Inactive broadcast carries no accountId — clear all pending prompts.
    for (const k of Object.keys(auths)) delete auths[k];
  }
  if (activeTab !== 'general' && activeTab !== 'new') renderAuthBanner(activeTab);
  renderTabs();
}

// ── CONFIG LOAD ───────────────────────────────────────────────────────────────
async function loadConfig() {
  const res = await fetch('/api/config');
  const raw = await res.json();
  config = { global: coalesceGlobal(raw.global), accounts: raw.accounts ?? [] };
  renderGlobal();
  if (activeTab !== 'general' && activeTab !== 'new' && !findAccount(activeTab)) activeTab = 'general';
  renderTabs();
  refreshActivePanel();
}

// ── TAB BAR ───────────────────────────────────────────────────────────────────
function renderTabs() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';

  bar.appendChild(makeTab('general', 'General', false, false, 'idle'));
  for (const acc of config.accounts) {
    bar.appendChild(makeTab(acc.id, acc.name || '(unnamed)', !!unread[acc.id], !!auths[acc.id], statuses[acc.id] ?? 'idle'));
  }

  const add = document.createElement('button');
  add.className = 'tab tab-add' + (activeTab === 'new' ? ' active' : '');
  add.textContent = '＋ New account';
  add.onclick = () => showTab('new');
  bar.appendChild(add);
}

function makeTab(id, label, hasUnread, needsAuth, state) {
  const btn = document.createElement('button');
  btn.className = 'tab' + (activeTab === id ? ' active' : '');
  btn.dataset.tab = id;
  const dot = id === 'general' ? '' : `<span class="tab-dot ${state}"></span>`;
  const marks = (hasUnread ? '<span class="tab-mark unread" title="New activity">●</span>' : '') +
                (needsAuth ? '<span class="tab-mark auth" title="Login required">🔑</span>' : '');
  btn.innerHTML = `${dot}<span class="tab-label">${escapeHtml(label)}</span>${marks}`;
  btn.onclick = () => showTab(id);
  return btn;
}

function updateTabDot(accountId) {
  const tab = document.querySelector(`.tab[data-tab="${CSS.escape(accountId)}"]`);
  if (!tab) return;
  const dot = tab.querySelector('.tab-dot');
  if (dot) dot.className = `tab-dot ${statuses[accountId] ?? 'idle'}`;
  let mark = tab.querySelector('.tab-mark.unread');
  if (unread[accountId] && !mark) {
    mark = document.createElement('span');
    mark.className = 'tab-mark unread'; mark.title = 'New activity'; mark.textContent = '●';
    tab.appendChild(mark);
  } else if (!unread[accountId] && mark) {
    mark.remove();
  }
}

async function showTab(target) {
  // Free the 3D viewer and release any held movement keys when leaving an account tab.
  if (activeTab !== target && activeTab !== 'general' && activeTab !== 'new') {
    clearBotControls(activeTab);
    await closeViewerFor(activeTab);
  }
  activeTab = target;
  if (target !== 'general' && target !== 'new') unread[target] = false;
  renderTabs();
  refreshActivePanel();
}

function refreshActivePanel() {
  const gp = document.getElementById('general-panel');
  const ap = document.getElementById('account-panel');
  const dp = document.getElementById('draft-panel');
  const accountActive = activeTab !== 'general' && activeTab !== 'new';
  gp.hidden = activeTab !== 'general';
  ap.hidden = !accountActive;
  dp.hidden = activeTab !== 'new';
  if (activeTab === 'general') renderPreviewGrid();
  else if (activeTab === 'new') renderDraftPanel();
  else renderAccountPanel(findAccount(activeTab));
}

// ── GLOBAL SETTINGS ─────────────────────────────────────────────────────────────
function renderGlobal() {
  const g = config.global;
  document.getElementById('host').value               = g.server?.host     ?? '';
  document.getElementById('port').value               = g.server?.port     ?? 25565;
  document.getElementById('version').value            = g.server?.version  ?? '1.21.4';
  document.getElementById('position-enabled').checked  = g.position?.enabled  ?? false;
  document.getElementById('pos-x').value              = g.position?.x         ?? 0;
  document.getElementById('pos-y').value              = g.position?.y         ?? 64;
  document.getElementById('pos-z').value              = g.position?.z         ?? 0;
  document.getElementById('pos-yaw').value            = g.position?.yaw       ?? 0;
  document.getElementById('pos-pitch').value          = g.position?.pitch     ?? 0;
  document.getElementById('antiafk-enabled').checked   = g.antiAfk?.enabled   ?? true;
  document.getElementById('antiafk-interval').value    = g.antiAfk?.interval  ?? 20000;
  document.getElementById('reconnect-enabled').checked = g.reconnect?.enabled      ?? true;
  document.getElementById('reconnect-delay').value     = g.reconnect?.delaySeconds ?? 30;
}

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

// Persists global settings + all account edits (the API saves the whole config).
async function saveConfig() {
  const payload = { global: collectGlobal(), accounts: config.accounts };
  const res = await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.ok) config.global = payload.global;
  return data;
}

const saveMsgEl = document.getElementById('save-msg');
document.getElementById('btn-save').addEventListener('click', async () => {
  const data = await saveConfig();
  saveMsgEl.className = 'save-msg';
  if (data.ok) { saveMsgEl.textContent = 'Settings saved.'; }
  else { saveMsgEl.textContent = data.error ?? 'Failed to save.'; saveMsgEl.className = 'save-msg err'; }
  setTimeout(() => { saveMsgEl.textContent = ''; }, 3000);
});

// ── PREVIEW GRID (General tab) ──────────────────────────────────────────────────
function renderPreviewGrid() {
  const grid = document.getElementById('preview-grid');
  grid.innerHTML = '';
  if (config.accounts.length === 0) {
    grid.innerHTML = '<p class="empty-hint">No accounts yet — use “＋ New account”.</p>';
    return;
  }
  for (const acc of config.accounts) {
    const st = statuses[acc.id] ?? 'idle';
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.dataset.id = acc.id;
    card.innerHTML = `
      <div class="preview-head">
        <span class="preview-name">${escapeHtml(acc.name || '(unnamed)')}</span>
        <span class="badge ${st}" data-role="badge">● ${st}</span>
      </div>
      <div class="inv-grid mini" data-role="inv-grid">${renderInventoryGrid(inventories[acc.id])}</div>`;
    card.onclick = () => showTab(acc.id);
    grid.appendChild(card);
  }
  applyPreviewSize();
}

function applyPreviewSize() {
  const grid = document.getElementById('preview-grid');
  const slider = document.getElementById('preview-size');
  if (!grid || !slider) return;
  if (!userSetSize) {
    // Auto: more accounts → smaller tiles.
    const n = config.accounts.length || 1;
    const auto = Math.max(140, Math.min(440, 460 - (n - 1) * 45));
    slider.value = String(auto);
  }
  grid.style.setProperty('--tile', `${slider.value}px`);
}

document.getElementById('preview-size').addEventListener('input', () => {
  userSetSize = true;
  applyPreviewSize();
});

// ── ACCOUNT FORM FRAGMENTS (shared by account panel + draft) ────────────────────
function sectionHtml(label, key, fieldsHtml) {
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

// Credentials + the four override sections — reused by the account panel and the draft form.
function accountBodyHtml(acc) {
  return `
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
    ${sectionHtml('Auto-Reconnect', 'reconnect', reconnectFieldsHtml(acc))}`;
}

function applyOverride(fieldsDiv, labelEl, isCustom) {
  if (isCustom) { fieldsDiv.classList.remove('section-disabled'); labelEl.textContent = 'Custom'; }
  else          { fieldsDiv.classList.add('section-disabled');    labelEl.textContent = 'Use global'; }
}

function wireSection(fieldsDiv, section, acc) {
  const num = (cls, key, fb) => {
    const el = fieldsDiv.querySelector(cls); if (!el) return;
    el.addEventListener('input', (e) => { acc[section] = { ...acc[section], [key]: parseFloat(e.target.value) || fb }; });
  };
  const numInt = (cls, key, fb) => {
    const el = fieldsDiv.querySelector(cls); if (!el) return;
    el.addEventListener('input', (e) => { acc[section] = { ...acc[section], [key]: parseInt(e.target.value, 10) || fb }; });
  };
  const str = (cls, key) => {
    const el = fieldsDiv.querySelector(cls); if (!el) return;
    el.addEventListener('input', (e) => { acc[section] = { ...acc[section], [key]: e.target.value }; });
  };
  const chk = (cls, key) => {
    const el = fieldsDiv.querySelector(cls); if (!el) return;
    el.addEventListener('change', (e) => { acc[section] = { ...acc[section], [key]: e.target.checked }; });
  };

  if (section === 'server')   { str('.acc-server-host', 'host'); numInt('.acc-server-port', 'port', 25565); str('.acc-server-version', 'version'); }
  if (section === 'position')  { chk('.acc-position-enabled', 'enabled'); num('.acc-pos-x', 'x', 0); num('.acc-pos-y', 'y', 64); num('.acc-pos-z', 'z', 0); num('.acc-pos-yaw', 'yaw', 0); num('.acc-pos-pitch', 'pitch', 0); }
  if (section === 'antiAfk')   { chk('.acc-antiafk-enabled', 'enabled'); numInt('.acc-antiafk-interval', 'interval', 20000); }
  if (section === 'reconnect') { chk('.acc-reconnect-enabled', 'enabled'); numInt('.acc-reconnect-delay', 'delaySeconds', 30); }
}

// Wires name/enabled/credentials/override sections that mutate `acc` in place.
function wireAccountFields(root, acc) {
  const name = root.querySelector('.acc-name');
  if (name) name.addEventListener('input', (e) => { acc.name = e.target.value; });
  const enabled = root.querySelector('.acc-enabled');
  if (enabled) enabled.addEventListener('change', (e) => { acc.enabled = e.target.checked; });
  const username = root.querySelector('.acc-username');
  if (username) username.addEventListener('input', (e) => { acc.account = { ...acc.account, username: e.target.value }; });
  const auth = root.querySelector('.acc-auth');
  if (auth) auth.addEventListener('change', (e) => { acc.account = { ...acc.account, auth: e.target.value }; });
  const password = root.querySelector('.acc-password');
  if (password) password.addEventListener('input', (e) => { acc.account = { ...acc.account, password: e.target.value }; });

  root.querySelectorAll('.override-chk').forEach((chk) => {
    const section = chk.dataset.section;
    const fieldsDiv = chk.closest('.section-override').querySelector('.override-fields');
    const labelEl   = chk.closest('.section-override').querySelector('.override-label');
    const isCustom = !!(acc.overrides && acc.overrides[section]);
    chk.checked = isCustom;
    applyOverride(fieldsDiv, labelEl, isCustom);
    chk.addEventListener('change', (e) => {
      acc.overrides = { ...acc.overrides, [section]: e.target.checked };
      applyOverride(fieldsDiv, labelEl, e.target.checked);
    });
    wireSection(fieldsDiv, section, acc);
  });
}

// ── ACCOUNT PANEL (full page) ───────────────────────────────────────────────────
function renderAccountPanel(acc) {
  const ap = document.getElementById('account-panel');
  if (!acc) { ap.innerHTML = ''; ap.removeAttribute('data-id'); return; }
  ap.dataset.id = acc.id;
  const st = statuses[acc.id] ?? 'idle';
  ap.innerHTML = `
    <div class="account-head">
      <input class="acc-name" type="text" value="${escapeAttr(acc.name)}" placeholder="Account name">
      <span class="badge ${st}" data-role="badge">● ${st}</span>
      <label class="toggle" title="Enabled">
        <input type="checkbox" class="acc-enabled" ${acc.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
      <button class="btn btn-primary acc-start">Start</button>
      <button class="btn btn-danger acc-stop">Stop</button>
      <button class="btn btn-secondary acc-save">Save</button>
      <button class="btn btn-ghost acc-remove">Remove</button>
    </div>
    <div class="account-grid">
      <div class="account-col-settings">
        ${accountBodyHtml(acc)}
      </div>
      <div class="account-col-view">
        <div class="section-group viewer-group">
          <h3>3D View
            <button class="btn btn-ghost view-toggle" data-role="view-toggle">Open</button>
            <label class="view-mode" title="First-person (POV) vs orbit / third-person"><input type="checkbox" class="view-firstperson"> First-person</label>
            <a class="btn btn-ghost view-popout" href="view.html?id=${escapeAttr(acc.id)}" target="_blank">Pop out</a>
          </h3>
          <div class="viewer-holder" data-role="viewer-holder"></div>
          <p class="view-hint">WASD move · Space jump · Shift sneak · Ctrl sprint — drives this tab's bot. Click outside the 3D view if keys stop responding.</p>
        </div>
        <div class="section-group">
          <h3>Inventory</h3>
          <div class="inv-grid" data-role="inv-grid">${renderInventoryGrid(inventories[acc.id])}</div>
        </div>
        <div class="auth-banner" data-role="auth-banner" style="display:none">
          <div class="auth-banner-body">
            <div class="auth-banner-title">Microsoft login required</div>
            <div class="auth-banner-code" data-role="auth-code"></div>
            <div class="auth-banner-actions">
              <a data-role="auth-link" href="#" target="_blank" class="btn btn-primary auth-banner-btn">Open Microsoft login</a>
              <button class="btn btn-ghost acct-auth-skip">Skip</button>
            </div>
          </div>
        </div>
        <div class="section-group log-group">
          <h3>Activity log <button class="btn btn-ghost acct-log-clear">Clear</button></h3>
          <div class="log-entries" data-role="acct-log"></div>
        </div>
      </div>
    </div>`;
  wireAccountPanel(ap, acc);
  renderLogList(acc.id);
  renderAuthBanner(acc.id);
}

function wireAccountPanel(root, acc) {
  wireAccountFields(root, acc);

  root.querySelector('.acc-start').onclick = () => fetch(`/api/bot/start/${acc.id}`, { method: 'POST' });
  root.querySelector('.acc-stop').onclick  = () => fetch(`/api/bot/stop/${acc.id}`,  { method: 'POST' });
  root.querySelector('.acc-save').onclick  = async (e) => {
    const btn = e.target; const prev = btn.textContent;
    const data = await saveConfig();
    btn.textContent = data.ok ? 'Saved' : 'Error';
    renderTabs();   // reflect any name change in the tab
    setTimeout(() => { btn.textContent = prev; }, 1500);
  };
  root.querySelector('.acc-remove').onclick = async () => {
    await closeViewerFor(acc.id);
    await fetch(`/api/accounts/${acc.id}`, { method: 'DELETE' });
    activeTab = 'general';
    await loadConfig();
  };

  // 3D view
  const viewBtn = root.querySelector('[data-role="view-toggle"]');
  const holder  = root.querySelector('[data-role="viewer-holder"]');
  const fpChk   = root.querySelector('.view-firstperson');
  async function openView() {
    const res = await fetch(`/api/bot/view/${acc.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstPerson: fpChk.checked }),
    });
    const data = await res.json();
    if (!res.ok) { onLog({ accountId: acc.id, level: 'warn', text: data.error || 'Cannot open view', time: new Date().toLocaleTimeString() }); return; }
    holder.innerHTML = `<iframe class="viewer-frame" src="http://${location.hostname}:${data.port}/"></iframe>`;
    openViewers.add(acc.id);
    viewBtn.textContent = 'Close';
  }
  async function closeView() {
    await closeViewerFor(acc.id);
    holder.innerHTML = '';
    viewBtn.textContent = 'Open';
  }
  viewBtn.onclick = () => (openViewers.has(acc.id) ? closeView() : openView());
  fpChk.addEventListener('change', () => { if (openViewers.has(acc.id)) openView(); });

  // Auth + log controls
  root.querySelector('.acct-auth-skip').onclick = () => fetch('/api/auth/skip', { method: 'POST' });
  root.querySelector('.acct-log-clear').onclick = () => {
    logs[acc.id] = [];
    const el = root.querySelector('[data-role="acct-log"]');
    if (el) el.innerHTML = '';
  };
}

async function closeViewerFor(accountId) {
  if (!openViewers.has(accountId)) return;
  openViewers.delete(accountId);
  try { await fetch(`/api/bot/view/${accountId}`, { method: 'DELETE' }); } catch (_) {}
}

// ── DRAFT (new account) ─────────────────────────────────────────────────────────
function newDraftAccount() {
  return {
    name: '', enabled: true,
    account: { username: '', auth: 'offline', password: '' },
    overrides: {},
    server:   { ...DEFAULT_GLOBAL.server },
    position: { ...DEFAULT_GLOBAL.position },
    antiAfk:  { ...DEFAULT_GLOBAL.antiAfk },
    reconnect: { ...DEFAULT_GLOBAL.reconnect },
  };
}

function renderDraftPanel() {
  draft = newDraftAccount();
  const dp = document.getElementById('draft-panel');
  dp.innerHTML = `
    <div class="account-head">
      <input class="acc-name" type="text" value="" placeholder="New account name">
      <button class="btn btn-primary draft-add">Add account</button>
      <button class="btn btn-ghost draft-cancel">Cancel</button>
    </div>
    <div class="account-col-settings draft-form">
      ${accountBodyHtml(draft)}
    </div>`;
  wireAccountFields(dp, draft);

  dp.querySelector('.draft-add').onclick = async () => {
    const res = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    if (!res.ok || !data.account) return;
    const newId = data.account.id;
    activeTab = newId;
    await loadConfig();
  };
  dp.querySelector('.draft-cancel').onclick = () => showTab('general');
}

// ── LOG RENDERING ─────────────────────────────────────────────────────────────
function renderLogList(accountId) {
  const el = document.querySelector('#account-panel [data-role="acct-log"]');
  if (!el) return;
  el.innerHTML = '';
  for (const e of (logs[accountId] || [])) appendLogEntry(el, e.level, e.text, e.time);
  el.scrollTop = el.scrollHeight;
}

function appendLogEntry(el, level, text, time) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level || ''}`;
  entry.innerHTML =
    `<span class="log-time">${escapeHtml(time)}</span>` +
    `<span class="log-text">${escapeHtml(text ?? '')}</span>`;
  el.appendChild(entry);
}

// ── AUTH BANNER ─────────────────────────────────────────────────────────────────
function renderAuthBanner(accountId) {
  const banner = document.querySelector('#account-panel [data-role="auth-banner"]');
  if (!banner) return;
  const a = auths[accountId];
  if (!a) { banner.style.display = 'none'; return; }
  banner.querySelector('[data-role="auth-code"]').textContent = a.user_code || '';
  banner.querySelector('[data-role="auth-link"]').href = a.verification_uri || '#';
  banner.style.display = 'flex';
}

// ── INVENTORY GRID ──────────────────────────────────────────────────────────────
function renderInventoryGrid(slots) {
  const cells = [];
  // slots 9–35 = main inventory, slots 36–44 = hotbar (mineflayer window slot numbering)
  for (let i = 9; i <= 44; i++) {
    const item = (slots || [])[i];
    if (item) {
      cells.push(`<div class="inv-cell filled" title="${escapeAttr(item.displayName || item.name)}">` +
        `<img class="inv-icon" src="/icons/${encodeURIComponent(item.name || '')}.png" alt="" ` +
          `onerror="this.style.display='none';this.nextElementSibling.style.display='block'">` +
        `<span class="inv-name" style="display:none">${escapeHtml((item.name || '').replace(/_/g, ' '))}</span>` +
        `<span class="inv-count">${escapeHtml(item.count)}</span></div>`);
    } else {
      cells.push('<div class="inv-cell"></div>');
    }
  }
  return cells.join('');
}

// ── KEYBOARD BOT CONTROLS ───────────────────────────────────────────────────────
// WASD (+ Space/Shift/Ctrl) drive the bot of the active account tab via the
// command API. Cross-origin viewer iframe steals focus, so keep focus on the page.
const KEY_MAP = {
  KeyW: 'forward', KeyA: 'left', KeyS: 'back', KeyD: 'right',
  Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint',
};
const heldKeys = new Set();   // e.code values currently pressed

function controlTargetId() {
  return (activeTab !== 'general' && activeTab !== 'new') ? activeTab : null;
}

function sendBotCommand(id, action, params = {}) {
  if (!id) return;
  fetch('/api/bot/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id], action, params }),
  }).catch(() => {});
}
function sendControl(id, key, state) { sendBotCommand(id, 'control', { key, state }); }
function clearBotControls(id) { heldKeys.clear(); sendBotCommand(id, 'clearControls'); }

function isTypingTarget(t) { return t && t.closest && t.closest('input,textarea,select,[contenteditable]'); }

window.addEventListener('keydown', (e) => {
  const key = KEY_MAP[e.code];
  if (!key) return;
  const id = controlTargetId();
  if (!id || isTypingTarget(e.target)) return;
  e.preventDefault();
  if (heldKeys.has(e.code)) return;   // ignore auto-repeat
  heldKeys.add(e.code);
  sendControl(id, key, true);
});

window.addEventListener('keyup', (e) => {
  const key = KEY_MAP[e.code];
  if (!key || !heldKeys.has(e.code)) return;
  heldKeys.delete(e.code);
  const id = controlTargetId();
  if (id) sendControl(id, key, false);
});

window.addEventListener('blur', () => {
  const id = controlTargetId();
  if (id) clearBotControls(id); else heldKeys.clear();
});

// ── INIT ──────────────────────────────────────────────────────────────────────
loadConfig();
