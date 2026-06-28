/* ════════════════════════════════════════════════════════════════════════════
   Mineflayer Control — dashboard (design imported from Claude Design)
   Reactive-ish vanilla JS: structural renders on tab/status changes, targeted
   patches for live telemetry / inventory / logs so the 3D viewer iframe persists.
   ════════════════════════════════════════════════════════════════════════════ */

// ── STATE ─────────────────────────────────────────────────────────────────────
let config = { global: {}, accounts: [] };
const statuses    = {};   // accountId -> state string ('idle'|'connecting'|'connected'|'reconnecting')
const inventories = {};   // accountId -> slots array
const telemetry   = {};   // accountId -> telemetry object
const logs        = {};   // accountId -> [{ level, text, time }]
const auths       = {};   // accountId -> auth payload
const unread      = {};   // accountId -> bool
const perBot      = {};   // accountId -> { view, acOn, acButton, acCps, acHold, acJitter }
const openViewers = new Set();
let activeTab = 'global'; // 'global' | <accountId>
let saveTimer = null;
const LOG_CAP = 500;

// ── HELPERS ───────────────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
}
function findAccount(id) { return config.accounts.find((a) => a.id === id); }
function isRunning(id) { const s = statuses[id]; return s && s !== 'idle'; }
function botState(id) { return (perBot[id] ||= { view: 'pov', acOn: false, acButton: 'left', acCps: 12, acHold: 50, acJitter: true }); }

// status → { label, cls } for pills / dots
function statusMeta(s) {
  if (s === 'connected')    return { label: 'ONLINE', cls: 'connected' };
  if (s === 'connecting')   return { label: 'CONNECTING', cls: 'connecting' };
  if (s === 'reconnecting') return { label: 'RECONNECTING', cls: 'reconnecting' };
  return { label: 'OFFLINE', cls: 'idle' };
}

// deterministic skin/body colours per account so avatars are stable & distinct
function seedFor(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 131 + str.charCodeAt(i)) >>> 0; return h || 7; }
function bodyColors(id) {
  const h = seedFor(id) % 360;
  return {
    skin:  `hsl(${(h + 30) % 360} 38% 55%)`,
    shirt: `hsl(${h} 55% 48%)`,
    pants: `hsl(${(h + 210) % 360} 30% 35%)`,
  };
}

// Default global shape (mirrors backend)
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
    lobbyDelay: g.lobbyDelay ?? DEFAULT_GLOBAL.lobbyDelay,
    movementDelay: g.movementDelay ?? DEFAULT_GLOBAL.movementDelay,
    clickDelay: g.clickDelay ?? DEFAULT_GLOBAL.clickDelay,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  APPEARANCE (theme + accent) — persisted in localStorage
// ════════════════════════════════════════════════════════════════════════════
const appearance = {
  theme: localStorage.getItem('mc.theme') || 'dark',
  accent: localStorage.getItem('mc.accent') || '#34d27b',
  hue: 0, sat: 0, val: 1,
  open: false,
};

function hsv2hex(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const t = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + t(r) + t(g) + t(b);
}
function hex2hsv(hex) {
  const s = (hex || '').replace('#', '').substring(0, 6);
  if (s.length < 6) return [0, 0, 1];
  const r = parseInt(s.substr(0, 2), 16) / 255, g = parseInt(s.substr(2, 2), 16) / 255, b = parseInt(s.substr(4, 2), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) { if (mx === r) h = (((g - b) / d) % 6) * 60; else if (mx === g) h = ((b - r) / d + 2) * 60; else h = ((r - g) / d + 4) * 60; }
  if (h < 0) h += 360;
  return [h, mx > 0 ? d / mx : 0, mx];
}
function contrast(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0a1f14' : '#ffffff';
}

function applyAppearance() {
  document.documentElement.dataset.theme = appearance.theme;
  document.documentElement.style.setProperty('--accent', appearance.accent);
  document.documentElement.style.setProperty('--on-accent', contrast(appearance.accent));
}
function setAccent(hex) {
  appearance.accent = hex;
  [appearance.hue, appearance.sat, appearance.val] = hex2hsv(hex);
  localStorage.setItem('mc.accent', hex);
  applyAppearance();
  renderAppearancePanel();
}
function setAccentHSV(h, s, v) { setAccent(hsv2hex(h, s, v)); }
function setTheme(t) { appearance.theme = t; localStorage.setItem('mc.theme', t); applyAppearance(); renderAppearancePanel(); }

const ACCENT_PRESETS = ['#34d27b', '#5b8cff', '#f0a93b', '#c06bff', '#f0556a', '#06b6d4', '#e11d48', '#0ea5e9'];

function renderAppearancePanel() {
  const mount = $('#appearance-mount');
  mount.innerHTML = '';
  if (!appearance.open) return;

  const backdrop = el('div', { class: 'appearance-backdrop', onclick: () => { appearance.open = false; renderAppearancePanel(); } });

  const svDot = el('div', { class: 'sv-dot', style: `left:${(appearance.sat * 100).toFixed(1)}%;top:${((1 - appearance.val) * 100).toFixed(1)}%;background:${appearance.accent}` });
  const svBox = el('div', { class: 'sv-box', style: `background:hsl(${Math.round(appearance.hue)},100%,50%)` },
    el('div', { class: 'sv-white' }), el('div', { class: 'sv-black' }), svDot);
  svBox.addEventListener('pointerdown', (e) => dragPick(e, svBox, (r, ev) => {
    const s = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const v = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
    setAccentHSV(appearance.hue, s, v);
  }));

  const hueCursor = el('div', { class: 'hue-cursor', style: `left:${(appearance.hue / 360 * 100).toFixed(1)}%;background:hsl(${Math.round(appearance.hue)},100%,50%)` });
  const hueBar = el('div', { class: 'hue-bar' }, hueCursor);
  hueBar.addEventListener('pointerdown', (e) => dragPick(e, hueBar, (r, ev) => {
    const h = Math.max(0, Math.min(360, (ev.clientX - r.left) / r.width * 360));
    setAccentHSV(h, appearance.sat, appearance.val);
  }));

  const hexInput = el('input', { class: 'hex-input', value: appearance.accent, maxlength: '7', placeholder: '#34d27b' });
  hexInput.addEventListener('change', (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setAccent(e.target.value); });

  const panel = el('div', { class: 'appearance-panel', onclick: (e) => e.stopPropagation() },
    el('div', { class: 'appearance-title', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg> Appearance' }),
    el('div', { class: 'appearance-section-label' }, 'Theme'),
    el('div', { class: 'seg-group', style: 'margin-bottom:22px' },
      el('button', { class: 'seg-btn' + (appearance.theme === 'dark' ? ' active' : ''), onclick: () => setTheme('dark') }, 'Dark'),
      el('button', { class: 'seg-btn' + (appearance.theme === 'light' ? ' active' : ''), onclick: () => setTheme('light') }, 'Light')),
    el('div', { class: 'appearance-section-label' }, 'Accent color'),
    svBox, hueBar,
    el('div', { class: 'hex-row' }, el('div', { class: 'hex-swatch', style: `background:${appearance.accent}` }), hexInput),
    el('div', { class: 'appearance-section-label', style: 'margin:16px 0 11px' }, 'Presets'),
    el('div', { class: 'presets' }, ...ACCENT_PRESETS.map((c) =>
      el('div', { class: 'preset' + (c.toLowerCase() === appearance.accent.toLowerCase() ? ' active' : ''), style: `background:${c}`, onclick: () => setAccent(c) }))),
  );
  mount.appendChild(backdrop);
  mount.appendChild(panel);
}

// pointer drag helper shared by SV box + hue bar
function dragPick(e, node, fn) {
  node.setPointerCapture(e.pointerId);
  const r = node.getBoundingClientRect();
  const move = (ev) => fn(r, ev);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', () => node.removeEventListener('pointermove', move), { once: true });
  fn(r, e);
}

$('#appearance-btn').addEventListener('click', () => { appearance.open = !appearance.open; renderAppearancePanel(); });

// ════════════════════════════════════════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════════════════════════════════════════
let ws;
function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if      (msg.type === 'status')    onStatus(msg);
    else if (msg.type === 'inventory') onInventory(msg);
    else if (msg.type === 'telemetry') onTelemetry(msg);
    else if (msg.type === 'log')       onLog(msg);
    else if (msg.type === 'auth')      onAuth(msg);
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}

function onStatus(msg) {
  const prevRunning = isRunning(msg.accountId);
  statuses[msg.accountId] = msg.state;
  updateOnlineLabel();
  renderTabs();
  // A running↔stopped transition on the active bot changes the right-pane layout.
  if (activeTab === msg.accountId && prevRunning !== isRunning(msg.accountId)) {
    renderRightPane();
  } else {
    patchStatusBadges(msg.accountId);
  }
}

function onInventory(msg) {
  inventories[msg.accountId] = msg.slots;
  if (activeTab === msg.accountId) patchInventory(msg.accountId);
}

function onTelemetry(msg) {
  telemetry[msg.accountId] = msg.data;
  if (activeTab === msg.accountId) patchTelemetry(msg.accountId);
}

function onLog(msg) {
  const arr = (logs[msg.accountId] ||= []);
  arr.push({ level: msg.level, text: msg.text, time: msg.time });
  if (arr.length > LOG_CAP) arr.splice(0, arr.length - LOG_CAP);
  if (activeTab === msg.accountId) {
    const box = $('[data-role="log-entries"]');
    if (box) { box.appendChild(logEntry(msg)); box.scrollTop = box.scrollHeight; }
  } else if (msg.accountId) {
    unread[msg.accountId] = true;
    renderTabs();
  }
}

function onAuth(msg) {
  if (msg.active && msg.accountId) auths[msg.accountId] = msg;
  else for (const k of Object.keys(auths)) delete auths[k];
  renderTabs();
  if (activeTab !== 'global') renderRightPane();
}

// ════════════════════════════════════════════════════════════════════════════
//  CONFIG LOAD / SAVE
// ════════════════════════════════════════════════════════════════════════════
async function loadConfig() {
  const raw = await (await fetch('/api/config')).json();
  config = { global: coalesceGlobal(raw.global), accounts: raw.accounts ?? [] };
  if (activeTab !== 'global' && !findAccount(activeTab)) activeTab = 'global';
  renderAll();
}

async function saveConfig() {
  const payload = { global: config.global, accounts: config.accounts };
  const res = await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}
// debounced autosave after field edits
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveConfig(), 600); }

// ════════════════════════════════════════════════════════════════════════════
//  TAB STRIP
// ════════════════════════════════════════════════════════════════════════════
function renderTabs() {
  const strip = $('#tabstrip');
  strip.innerHTML = '';

  strip.appendChild(makeTab({ id: 'global', name: 'Global', pinned: true }));
  for (const acc of config.accounts) {
    strip.appendChild(makeTab({
      id: acc.id, name: acc.name || '(unnamed)',
      status: statuses[acc.id] ?? 'idle',
      unread: !!unread[acc.id], needsAuth: !!auths[acc.id],
    }));
  }
  strip.appendChild(el('button', { class: 'tab-add', title: 'Add bot', onclick: addBot,
    html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"></path></svg>' }));
}

function makeTab({ id, name, pinned, status, unread: u, needsAuth }) {
  const active = activeTab === id;
  const kids = [];
  if (pinned) kids.push(el('span', { html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="opacity:.7"><path d="M14 3v6l3 3v2H7v-2l3-3V3zM11 16h2v5h-2z"></path></svg>' }));
  if (!pinned) kids.push(el('span', { class: `tab-dot ${statusMeta(status).cls}` }));
  kids.push(el('span', { class: 'tab-name' }, name));
  if (u) kids.push(el('span', { class: 'tab-mark', title: 'New activity', style: 'color:var(--accent)' }, '●'));
  if (needsAuth) kids.push(el('span', { class: 'tab-mark', title: 'Login required' }, '🔑'));
  if (!pinned) {
    kids.push(el('button', { class: 'tab-close', title: 'Remove bot',
      onclick: (e) => { e.stopPropagation(); removeBot(id); },
      html: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 5l14 14M19 5L5 19"></path></svg>' }));
  }
  return el('div', { class: 'tab' + (active ? ' active' : ''), dataset: { tab: id }, onclick: () => selectTab(id) }, ...kids);
}

async function selectTab(id) {
  if (activeTab !== id && activeTab !== 'global') {
    clearBotControls(activeTab);
    await closeViewerFor(activeTab);
  }
  activeTab = id;
  if (id !== 'global') unread[id] = false;
  renderAll();
}

function updateOnlineLabel() {
  const online = config.accounts.filter((a) => isRunning(a.id)).length;
  $('#online-label').textContent = `${online} online · ${config.accounts.length} total`;
}

// ════════════════════════════════════════════════════════════════════════════
//  ROOT RENDER
// ════════════════════════════════════════════════════════════════════════════
function renderAll() {
  applyAppearance();
  updateOnlineLabel();
  renderTabs();
  renderSettings();
  renderRightPane();
}

// ── BOT lifecycle (add/remove/connect) ────────────────────────────────────────
async function addBot() {
  const res = await fetch('/api/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Bot ${config.accounts.length + 1}` }),
  });
  const data = await res.json();
  if (!res.ok || !data.account) return;
  activeTab = data.account.id;
  await loadConfig();
}

async function removeBot(id) {
  await closeViewerFor(id);
  await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
  if (activeTab === id) activeTab = 'global';
  await loadConfig();
}

function startBot(id)  { fetch(`/api/bot/start/${id}`, { method: 'POST' }); }
function stopBot(id)   { fetch(`/api/bot/stop/${id}`,  { method: 'POST' }); }
function toggleConn(id) { (isRunning(id) ? stopBot : startBot)(id); }

// ════════════════════════════════════════════════════════════════════════════
//  LEFT SETTINGS PANEL
// ════════════════════════════════════════════════════════════════════════════
function toggle(on, onClick) {
  return el('div', { class: 'toggle' + (on ? ' on' : ''), onclick: onClick }, el('div', { class: 'knob' }));
}
function field(label, value, onInput, opts = {}) {
  const input = el('input', { value: value ?? '', placeholder: opts.placeholder || '', type: opts.type || 'text' });
  input.addEventListener('input', (e) => onInput(e.target.value));
  return el('label', { class: 'field' + (opts.flex2 ? ' flex2' : '') }, el('span', {}, label), input);
}
function card(titleNode, ...body) { return el('div', { class: 'card' }, titleNode, ...body); }
function cardTitle(text) { return el('div', { class: 'card-title' }, text); }
function cardHeadRow(text, right) { return el('div', { class: 'card-head-row' }, el('div', { class: 'card-title' }, text), right); }

function renderSettings() {
  const root = $('#settings');
  root.innerHTML = '';
  const isGlobal = activeTab === 'global';
  const acc = isGlobal ? null : findAccount(activeTab);
  const target = isGlobal ? config.global : acc;
  if (!target) { root.appendChild(el('p', { class: 'empty-hint' }, 'No selection.')); return; }

  // head
  if (isGlobal) {
    root.appendChild(el('div', { class: 'panel-head' },
      el('div', { class: 'head-text' }, el('span', { class: 'panel-title' }, 'General settings'), el('span', { class: 'panel-sub' }, 'Global defaults · all bots'))));
  } else {
    const col = bodyColors(acc.id);
    root.appendChild(el('div', { class: 'panel-head' },
      el('div', { class: 'avatar', style: `background:${col.skin}` }),
      el('div', { class: 'head-text' },
        el('span', { class: 'panel-title' }, acc.name || '(unnamed)'),
        el('span', { class: 'panel-sub' }, `${statusMeta(statuses[acc.id] ?? 'idle').label.toLowerCase()} · ${acc.account?.username || 'no account'}`))));
  }

  // section value accessor: bot sections use override → fall back to global
  const section = (key) => {
    if (isGlobal) return config.global[key];
    return acc.overrides?.[key] ? acc[key] : config.global[key];
  };
  const isCustom = (key) => isGlobal ? true : !!acc.overrides?.[key];
  const setSection = (key, patch) => {
    if (isGlobal) { config.global[key] = { ...config.global[key], ...patch }; }
    else { acc[key] = { ...acc[key], ...patch }; }
    queueSave();
  };
  const overrideBadge = (key) => {
    if (isGlobal) return null;
    const cust = isCustom(key);
    return el('span', { class: 'override-note', title: 'Toggle global / custom override',
      onclick: () => { acc.overrides = { ...acc.overrides, [key]: !cust }; queueSave(); renderSettings(); } },
      cust ? '● custom' : '○ global');
  };

  // ── Connection / Server ──
  const srv = section('server');
  const connBody = [];
  if (!isGlobal) {
    connBody.push(field('Account (username / email)', acc.account?.username, (v) => { acc.account = { ...acc.account, username: v }; queueSave(); }, { placeholder: 'username / email' }));
    const authSel = el('select', {},
      el('option', { value: 'offline' }, 'Offline (cracked)'),
      el('option', { value: 'microsoft' }, 'Microsoft (premium)'));
    authSel.value = acc.account?.auth || 'offline';
    authSel.addEventListener('change', (e) => { acc.account = { ...acc.account, auth: e.target.value }; queueSave(); });
    connBody.push(el('label', { class: 'field' }, el('span', {}, 'Auth'), authSel));
    connBody.push(field('Password', acc.account?.password, (v) => { acc.account = { ...acc.account, password: v }; queueSave(); }, { type: 'password', placeholder: 'leave empty to skip' }));
  }
  connBody.push(el('div', { class: 'field-row' },
    field('Host', srv.host, (v) => setSection('server', { host: v }), { placeholder: 'play.example.com', flex2: true }),
    field('Port', srv.port, (v) => setSection('server', { port: parseInt(v, 10) || 25565 }))));
  connBody.push(field('Version', srv.version, (v) => setSection('server', { version: v })));
  root.appendChild(card(cardHeadRow(isGlobal ? 'Server (Global Defaults)' : 'Connection', overrideBadge('server')), ...connBody));

  // ── AFK Position ──
  const pos = section('position');
  root.appendChild(card(
    el('div', { class: 'card-head-row' }, el('div', { class: 'card-title' }, 'AFK Position'),
      el('div', { style: 'display:flex;align-items:center;gap:10px' }, overrideBadge('position'), toggle(pos.enabled, () => setSection('position', { enabled: !pos.enabled })))),
    el('div', { class: 'field-row' },
      field('X', pos.x, (v) => setSection('position', { x: parseFloat(v) || 0 })),
      field('Y', pos.y, (v) => setSection('position', { y: parseFloat(v) || 0 })),
      field('Z', pos.z, (v) => setSection('position', { z: parseFloat(v) || 0 }))),
    el('div', { class: 'field-row' },
      field('Yaw', pos.yaw, (v) => setSection('position', { yaw: parseFloat(v) || 0 })),
      field('Pitch', pos.pitch, (v) => setSection('position', { pitch: parseFloat(v) || 0 })))));

  // ── Anti-AFK ──
  const anti = section('antiAfk');
  root.appendChild(card(
    el('div', { class: 'card-head-row' }, el('div', { class: 'card-title' }, 'Anti-AFK'),
      el('div', { style: 'display:flex;align-items:center;gap:10px' }, overrideBadge('antiAfk'), toggle(anti.enabled, () => setSection('antiAfk', { enabled: !anti.enabled })))),
    field('Interval (ms)', anti.interval, (v) => setSection('antiAfk', { interval: parseInt(v, 10) || 20000 }))));

  // ── Auto-Reconnect ──
  const rec = section('reconnect');
  root.appendChild(card(
    el('div', { class: 'card-head-row' }, el('div', { class: 'card-title' }, 'Auto-Reconnect'),
      el('div', { style: 'display:flex;align-items:center;gap:10px' }, overrideBadge('reconnect'), toggle(rec.enabled, () => setSection('reconnect', { delaySeconds: rec.delaySeconds, enabled: !rec.enabled })))),
    field('Delay (seconds)', rec.delaySeconds, (v) => setSection('reconnect', { delaySeconds: parseInt(v, 10) || 30 }))));

  // ── Autoclicker (bot only, runtime command) ──
  if (!isGlobal) root.appendChild(renderAutoclicker(acc));

  // ── Save status ──
  const saveBtn = el('button', { class: 'btn-save' }, 'Save settings');
  const msg = el('div', { class: 'save-msg' });
  saveBtn.addEventListener('click', async () => {
    const data = await saveConfig();
    msg.textContent = data.ok ? 'Settings saved.' : (data.error || 'Failed to save.');
    msg.className = 'save-msg' + (data.ok ? '' : ' err');
    renderTabs();
    setTimeout(() => { msg.textContent = ''; }, 3000);
  });
  root.appendChild(saveBtn);
  root.appendChild(msg);
}

function renderAutoclicker(acc) {
  const st = botState(acc.id);
  const apply = () => {
    if (!isRunning(acc.id)) return;
    if (st.acOn) sendBotCommand(acc.id, 'autoclick', { on: true, mode: st.acButton, intervalMs: Math.round(1000 / Math.max(1, st.acCps)) });
    else sendBotCommand(acc.id, 'autoclick', { on: false });
  };
  return card(
    el('div', { class: 'card-head-row' }, el('div', { class: 'card-title' }, 'Autoclicker'),
      toggle(st.acOn, () => { st.acOn = !st.acOn; apply(); renderSettings(); })),
    el('span', { style: 'display:block;font:600 12px Manrope;color:var(--muted);margin-bottom:7px' }, 'Mouse button'),
    el('div', { class: 'seg-group', style: 'margin-bottom:12px' },
      el('button', { class: 'seg-btn' + (st.acButton === 'left' ? ' active' : ''), onclick: () => { st.acButton = 'left'; apply(); renderSettings(); } }, 'Left'),
      el('button', { class: 'seg-btn' + (st.acButton === 'right' ? ' active' : ''), onclick: () => { st.acButton = 'right'; apply(); renderSettings(); } }, 'Right')),
    el('div', { class: 'field-row' },
      field('Clicks / sec', st.acCps, (v) => { st.acCps = parseInt(v, 10) || 12; apply(); }),
      field('Hold (ms)', st.acHold, (v) => { st.acHold = parseInt(v, 10) || 50; })),
    el('div', { class: 'inline-toggle-row' }, el('span', {}, 'Randomize jitter'),
      toggle(st.acJitter, () => { st.acJitter = !st.acJitter; renderSettings(); })));
}

// ════════════════════════════════════════════════════════════════════════════
//  RIGHT PANE — dispatch
// ════════════════════════════════════════════════════════════════════════════
function renderRightPane() {
  const mount = $('#right-pane-mount');
  mount.innerHTML = '';
  if (activeTab === 'global') mount.appendChild(renderGlobalGrid());
  else mount.appendChild(renderBotView(findAccount(activeTab)));
}

// ── GLOBAL GRID ──────────────────────────────────────────────────────────────
function renderGlobalGrid() {
  const pane = el('div', { class: 'right-pane' });
  const online = config.accounts.filter((a) => isRunning(a.id)).length;
  pane.appendChild(el('div', { class: 'grid-head' },
    el('div', { class: 'head-text' }, el('span', { class: 'panel-title' }, 'Bots'),
      el('span', { class: 'panel-sub' }, `${online} connected · ${config.accounts.length} configured`)),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn-accent', onclick: addBot,
      html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 5v14M5 12h14"></path></svg> Add new' })));

  const grid = el('div', { class: 'bot-grid' });
  if (config.accounts.length === 0) {
    grid.appendChild(el('p', { class: 'empty-hint' }, 'No bots yet — use “Add new”.'));
  }
  for (const acc of config.accounts) grid.appendChild(botCard(acc));
  grid.appendChild(el('button', { class: 'card-add', onclick: addBot,
    html: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg><span style="font:700 13px Manrope">Add bot</span>' }));
  pane.appendChild(grid);
  return pane;
}

function botCard(acc) {
  const col = bodyColors(acc.id);
  const st = statuses[acc.id] ?? 'idle';
  const meta = statusMeta(st);
  const t = telemetry[acc.id] || {};
  const running = isRunning(acc.id);
  const health = running ? (t.health ?? 0) : 0;
  const food = running ? (t.food ?? 0) : 0;

  return el('div', { class: 'bot-card', dataset: { id: acc.id } },
    el('div', { class: 'bot-card-head' },
      el('div', { class: 'avatar', style: `background:${col.skin}` }, el('i', { class: 'eye-l' }), el('i', { class: 'eye-r' })),
      el('div', { class: 'info' },
        el('span', { class: 'name' }, acc.name || '(unnamed)'),
        el('span', { class: 'server' }, `${acc.server?.host || config.global.server.host || '—'}:${acc.server?.port || config.global.server.port}`)),
      el('span', { class: `status-pill ${meta.cls}`, dataset: { role: 'pill' } }, meta.label)),
    el('div', { class: 'bot-card-bars' },
      el('div', { class: 'bar-row' },
        el('span', { html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="var(--danger)"><path d="M12 21s-7-4.5-9.5-9C.5 8 2.5 4 6 4c2 0 3.2 1.2 4 2.4C10.8 5.2 12 4 14 4c3.5 0 5.5 4 3.5 8C19 16.5 12 21 12 21z"></path></svg>' }),
        el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill health', dataset: { role: 'health-bar' }, style: `width:${health / 20 * 100}%` })),
        el('span', { class: 'bar-label', dataset: { role: 'health-label' } }, `${health}/20`)),
      el('div', { class: 'bar-row' },
        el('span', { html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="var(--gold)"><path d="M5 3c2 0 3 2 3 4s-1 3-1 5 2 3 2 6-1 3-2 3-2-1-2-3 1-4 1-6-2-3-2-5 0-4 1-4zm9 0c3 0 5 4 5 9 0 6-2 9-4 9-1 0-1-1-1-2v-7h-2V5c0-1 1-2 2-2z"></path></svg>' }),
        el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill food', dataset: { role: 'food-bar' }, style: `width:${food / 20 * 100}%` })),
        el('span', { class: 'bar-label', dataset: { role: 'food-label' } }, `${food}/20`))),
    el('div', { class: 'bot-card-foot' },
      el('span', { class: 'ping', dataset: { role: 'ping' } }, running ? `${t.ping ?? '—'} ms ping` : 'offline'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-conn' + (running ? '' : ' connect'), onclick: () => toggleConn(acc.id) }, running ? 'Disconnect' : 'Connect'),
      el('button', { class: 'btn-open', onclick: () => selectTab(acc.id) }, 'Open')));
}

// ════════════════════════════════════════════════════════════════════════════
//  BOT VIEW
// ════════════════════════════════════════════════════════════════════════════
function renderBotView(acc) {
  if (!acc) return el('div', { class: 'right-pane' }, el('p', { class: 'empty-hint' }, 'Bot not found.'));
  const view = el('div', { class: 'bot-view', dataset: { id: acc.id } });
  view.appendChild(el('div', { class: 'bot-view-top' }, renderPov(acc), renderSideCol(acc)));
  view.appendChild(el('div', { class: 'bot-view-bottom' }, renderInventoryCard(acc), renderArmorCard(acc)));
  if (auths[acc.id]) view.appendChild(renderAuthBanner(acc));
  view.appendChild(renderLogCard(acc));
  // kick off live data
  setTimeout(() => { patchTelemetry(acc.id); patchInventory(acc.id); renderLogEntries(acc.id); }, 0);
  return view;
}

// ── POV / 3D viewer ──
function renderPov(acc) {
  const st = botState(acc.id);
  const t = telemetry[acc.id] || {};
  const running = isRunning(acc.id);

  const pov = el('div', { class: 'pov', dataset: { role: 'pov' } });
  pov.appendChild(el('div', { class: 'pov-badges' },
    el('span', { class: 'pov-badge', dataset: { role: 'coords' } }, running && t.x != null ? `XYZ ${t.x} ${t.y} ${t.z}` : 'XYZ — — —'),
    el('span', { class: 'pov-badge', dataset: { role: 'dim' } }, running ? (t.dimension || 'overworld') : 'offline')));

  const povBtn = el('button', { class: st.view === 'pov' ? 'active' : '' }, 'POV');
  const freeBtn = el('button', { class: st.view === 'freecam' ? 'active' : '' }, 'Freecam');
  povBtn.addEventListener('click', () => { st.view = 'pov'; openView(acc.id, true); renderRightPane(); });
  freeBtn.addEventListener('click', () => { st.view = 'freecam'; openView(acc.id, false); renderRightPane(); });
  pov.appendChild(el('div', { class: 'pov-toggle' }, povBtn, freeBtn));

  const holder = el('div', { dataset: { role: 'viewer-holder' }, style: 'position:absolute;inset:0' });
  pov.appendChild(holder);
  if (running) {
    openView(acc.id, st.view === 'pov');
  } else {
    holder.appendChild(el('div', { class: 'pov-placeholder' },
      el('div', { style: 'font:700 14px Manrope' }, 'Bot offline'),
      el('div', { style: 'font:500 12px Manrope;opacity:.7' }, 'Connect the bot to open the 3D view'),
      el('button', { class: 'btn-accent', onclick: () => startBot(acc.id) }, 'Connect')));
  }
  return pov;
}

async function openView(id, firstPerson) {
  const holder = $(`[data-id="${CSS.escape(id)}"] [data-role="viewer-holder"]`);
  if (!holder) return;
  try {
    const res = await fetch(`/api/bot/view/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstPerson: !!firstPerson }),
    });
    const data = await res.json();
    if (!res.ok) { return; }
    holder.innerHTML = `<iframe class="viewer-frame" src="http://${location.hostname}:${data.port}/"></iframe>`;
    openViewers.add(id);
  } catch (_) { /* ignore */ }
}
async function closeViewerFor(id) {
  if (!openViewers.has(id)) return;
  openViewers.delete(id);
  try { await fetch(`/api/bot/view/${id}`, { method: 'DELETE' }); } catch (_) {}
}

// ── side column: minimap + vitals ──
function renderSideCol(acc) {
  return el('div', { class: 'side-col' },
    el('div', { class: 'mini-card' },
      el('div', { class: 'card-title' }, 'Minimap'),
      el('div', { class: 'mini-wrap' }, el('canvas', { dataset: { role: 'mini' } }))),
    renderVitals(acc));
}

function vitalBar(label, valText, cls, pct, role) {
  return el('div', { class: 'vital' },
    el('div', { class: 'vital-head' }, el('span', { class: 'lbl' }, label), el('span', { class: 'val', dataset: { role: role + '-label' } }, valText)),
    el('div', { class: 'vital-track' }, el('div', { class: `vital-fill ${cls}`, dataset: { role: role + '-bar' }, style: `width:${pct}%` })));
}

function renderVitals(acc) {
  const t = telemetry[acc.id] || {};
  const running = isRunning(acc.id);
  const h = running ? (t.health ?? 0) : 0, f = running ? (t.food ?? 0) : 0;
  const xpProg = running ? Math.round((t.xpProgress ?? 0) * 100) : 0;
  const statCell = (label, val, role) => el('div', { class: 'stat-cell' },
    el('div', { class: 'lbl' }, label), el('div', { class: 'val', dataset: { role } }, val));
  return el('div', { class: 'vitals-card' },
    el('div', { class: 'card-title' }, 'Vitals'),
    el('div', { class: 'vital-bars' },
      vitalBar('Health', `${h} / 20`, 'health', h / 20 * 100, 'v-health'),
      vitalBar('Hunger', `${f} / 20`, 'food', f / 20 * 100, 'v-food'),
      vitalBar('Experience', running ? `Lvl ${t.xpLevel ?? 0}` : 'Lvl 0', 'xp', xpProg, 'v-xp')),
    el('div', { class: 'stat-grid' },
      statCell('Ping', running ? `${t.ping ?? '—'} ms` : '—', 'st-ping'),
      statCell('Gamemode', running ? (t.gameMode || '—') : '—', 'st-gm'),
      statCell('Facing', running ? `${t.yaw ?? 0}°` : '—', 'st-yaw'),
      statCell('Uptime', running ? `${Math.floor((t.uptime ?? 0) / 60)} min` : '—', 'st-up'),
      statCell('Dimension', running ? (t.dimension || 'overworld') : '—', 'st-dim'),
      statCell('Position', running && t.x != null ? `${t.x} ${t.y} ${t.z}` : '—', 'st-pos')));
}

// ── inventory ──
function invCell(item, hot) {
  const cell = el('div', { class: 'inv-cell' + (hot ? ' hot' : '') });
  if (item) {
    cell.title = item.displayName || item.name;
    const img = el('img', { class: 'inv-icon', src: `/icons/${encodeURIComponent(item.name || '')}.png`, alt: '' });
    img.addEventListener('error', () => { img.style.display = 'none'; });
    cell.appendChild(img);
    if (item.count > 1) cell.appendChild(el('span', { class: 'inv-count' }, String(item.count)));
  }
  return cell;
}

function renderInventoryCard(acc) {
  const slots = inventories[acc.id] || [];
  const filled = slots.filter(Boolean).length;
  const main = el('div', { class: 'inv-grid', dataset: { role: 'inv-main' } });
  const hot = el('div', { class: 'inv-grid', dataset: { role: 'inv-hot' } });
  // mineflayer window slots: 9–35 main, 36–44 hotbar
  for (let i = 9; i <= 35; i++) main.appendChild(invCell(slots[i], false));
  for (let i = 36; i <= 44; i++) hot.appendChild(invCell(slots[i], true));
  return el('div', { class: 'inv-card' },
    el('div', { class: 'inv-card-head' }, el('span', { class: 'lbl' }, 'Inventory'),
      el('span', { class: 'count', dataset: { role: 'inv-count' } }, `${filled} / 36 slots`)),
    main, el('div', { class: 'inv-divider' }), hot);
}

// ── armor + player model ──
const ARMOR_ICONS = ['◇', '▢', '◫', '⬓'];
const ARMOR_LABELS = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
function buildArmorCol(acc) {
  const t = telemetry[acc.id] || {};
  const armor = (isRunning(acc.id) && t.armor) ? t.armor : [null, null, null, null];
  const armorCol = el('div', { class: 'armor-col', dataset: { role: 'armor-col', sig: JSON.stringify(armor) } }, el('div', { class: 'lbl' }, 'Armor'));
  armor.forEach((it, i) => {
    const slot = el('div', { class: 'armor-slot', title: it ? (it.displayName || it.name) : `${ARMOR_LABELS[i]} (empty)` });
    if (it) {
      const img = el('img', { class: 'inv-icon', src: `/icons/${encodeURIComponent(it.name)}.png`, alt: '' });
      img.addEventListener('error', () => { img.style.display = 'none'; slot.appendChild(el('span', { class: 'ph' }, ARMOR_ICONS[i])); });
      slot.appendChild(img);
    } else slot.appendChild(el('span', { class: 'ph' }, ARMOR_ICONS[i]));
    armorCol.appendChild(slot);
  });
  return armorCol;
}
function patchArmor(id) {
  const existing = $('[data-role="armor-col"]');
  if (!existing) return;
  const acc = findAccount(id); if (!acc) return;
  const t = telemetry[id] || {};
  const armor = (isRunning(id) && t.armor) ? t.armor : [null, null, null, null];
  if (existing.dataset.sig === JSON.stringify(armor)) return;
  existing.replaceWith(buildArmorCol(acc));
}
function renderArmorCard(acc) {
  const col = bodyColors(acc.id);
  const model = el('div', { class: 'model' },
    el('div', { style: `left:50%;top:0;transform:translateX(-50%);width:38px;height:38px;background:${col.skin}` }),
    el('div', { style: `left:50%;top:40px;transform:translateX(-50%);width:42px;height:50px;background:${col.shirt}` }),
    el('div', { style: `left:5px;top:42px;width:13px;height:46px;background:${col.skin}` }),
    el('div', { style: `right:5px;top:42px;width:13px;height:46px;background:${col.skin}` }),
    el('div', { style: `left:18px;top:92px;width:18px;height:48px;background:${col.pants}` }),
    el('div', { style: `right:18px;top:92px;width:18px;height:48px;background:${col.pants}` }));
  return el('div', { class: 'armor-card' }, buildArmorCol(acc),
    el('div', { class: 'model-col' }, el('div', { class: 'lbl' }, 'SKIN'), model));
}

// ── auth banner ──
function renderAuthBanner(acc) {
  const a = auths[acc.id];
  return el('div', { class: 'auth-banner' },
    el('div', { class: 'auth-title' }, 'Microsoft login required'),
    el('div', { class: 'auth-code' }, a.user_code || ''),
    el('div', { class: 'auth-actions' },
      el('a', { class: 'btn-accent', href: a.verification_uri || '#', target: '_blank' }, 'Open Microsoft login'),
      el('button', { class: 'btn-ghost', onclick: () => fetch('/api/auth/skip', { method: 'POST' }) }, 'Skip')));
}

// ── logs ──
function logEntry(e) {
  return el('div', { class: `log-entry ${e.level || ''}` },
    el('span', { class: 'log-time' }, e.time || ''), el('span', { class: 'log-text' }, e.text ?? ''));
}
function renderLogCard(acc) {
  const box = el('div', { class: 'log-entries', dataset: { role: 'log-entries' } });
  return el('div', { class: 'log-card' },
    el('div', { class: 'log-card-head' }, el('span', { class: 'lbl' }, 'Activity log'),
      el('button', { class: 'btn-ghost', onclick: () => { logs[acc.id] = []; box.innerHTML = ''; } }, 'Clear')),
    box);
}
function renderLogEntries(id) {
  const box = $('[data-role="log-entries"]');
  if (!box) return;
  box.innerHTML = '';
  for (const e of (logs[id] || [])) box.appendChild(logEntry(e));
  box.scrollTop = box.scrollHeight;
}

// ════════════════════════════════════════════════════════════════════════════
//  TARGETED PATCHES (no full re-render → 3D viewer iframe survives)
// ════════════════════════════════════════════════════════════════════════════
function patchStatusBadges(id) {
  const meta = statusMeta(statuses[id] ?? 'idle');
  const running = isRunning(id);
  // tab dot
  const dot = $(`.tab[data-tab="${CSS.escape(id)}"] .tab-dot`);
  if (dot) dot.className = `tab-dot ${meta.cls}`;
  // global card
  const card = $(`.bot-card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    const pill = $('[data-role="pill"]', card);
    if (pill) { pill.className = `status-pill ${meta.cls}`; pill.textContent = meta.label; }
    const conn = $('.btn-conn', card);
    if (conn) { conn.className = 'btn-conn' + (running ? '' : ' connect'); conn.textContent = running ? 'Disconnect' : 'Connect'; }
  }
  // bot-view head sub
  if (activeTab === id) {
    const sub = $('#settings .panel-sub');
    const acc = findAccount(id);
    if (sub && acc) sub.textContent = `${meta.label.toLowerCase()} · ${acc.account?.username || 'no account'}`;
  }
}

function setText(role, text, root = document) { const n = $(`[data-role="${role}"]`, root); if (n) n.textContent = text; }
function setWidth(role, pct, root = document) { const n = $(`[data-role="${role}"]`, root); if (n) n.style.width = pct + '%'; }

function patchTelemetry(id) {
  const t = telemetry[id]; if (!t) return;
  // global card bars (visible from grid)
  const card = $(`.bot-card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    setWidth('health-bar', t.health / 20 * 100, card); setText('health-label', `${t.health}/20`, card);
    setWidth('food-bar', t.food / 20 * 100, card); setText('food-label', `${t.food}/20`, card);
    setText('ping', `${t.ping ?? '—'} ms ping`, card);
  }
  if (activeTab !== id) return;
  // bot view vitals
  setWidth('v-health-bar', t.health / 20 * 100); setText('v-health-label', `${t.health} / 20`);
  setWidth('v-food-bar', t.food / 20 * 100); setText('v-food-label', `${t.food} / 20`);
  setWidth('v-xp-bar', Math.round((t.xpProgress ?? 0) * 100)); setText('v-xp-label', `Lvl ${t.xpLevel ?? 0}`);
  setText('st-ping', `${t.ping ?? '—'} ms`); setText('st-gm', t.gameMode || '—');
  setText('st-yaw', `${t.yaw ?? 0}°`); setText('st-up', `${Math.floor((t.uptime ?? 0) / 60)} min`);
  setText('st-dim', t.dimension || 'overworld'); setText('st-pos', t.x != null ? `${t.x} ${t.y} ${t.z}` : '—');
  setText('coords', t.x != null ? `XYZ ${t.x} ${t.y} ${t.z}` : 'XYZ — — —');
  setText('dim', t.dimension || 'overworld');
  patchArmor(id);
  drawMinimap(id);
}

function patchInventory(id) {
  if (activeTab !== id) return;
  const slots = inventories[id] || [];
  const main = $('[data-role="inv-main"]'), hot = $('[data-role="inv-hot"]');
  if (main) { main.innerHTML = ''; for (let i = 9; i <= 35; i++) main.appendChild(invCell(slots[i], false)); }
  if (hot)  { hot.innerHTML = '';  for (let i = 36; i <= 44; i++) hot.appendChild(invCell(slots[i], true)); }
  setText('inv-count', `${slots.filter(Boolean).length} / 36 slots`);
  // armor cells reflect inventory too (slots 5–8) via telemetry; patchTelemetry handles fills on refresh
}

// ── minimap: position + facing on a simple grid (no world data client-side) ──
function drawMinimap(id) {
  const canvas = $('[data-role="mini"]');
  if (!canvas) return;
  const t = telemetry[id];
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--card2').trim() || '#0d131e';
  ctx.fillRect(0, 0, W, H);
  // grid lines anchored to bot position so it scrolls as the bot moves
  const step = 20;
  const ox = t ? ((t.x % step) + step) % step : 0;
  const oz = t ? ((t.z % step) + step) % step : 0;
  ctx.strokeStyle = 'rgba(127,140,160,.22)'; ctx.lineWidth = 1;
  for (let x = -ox; x <= W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = -oz; y <= H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // player arrow
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(((t?.yaw ?? 0) + 180) * Math.PI / 180);
  ctx.fillStyle = css.getPropertyValue('--accent').trim() || '#34d27b';
  ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
//  KEYBOARD BOT CONTROLS (WASD drive the active bot)
// ════════════════════════════════════════════════════════════════════════════
const KEY_MAP = {
  KeyW: 'forward', KeyA: 'left', KeyS: 'back', KeyD: 'right',
  Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint',
};
const heldKeys = new Set();
function controlTargetId() { return activeTab !== 'global' ? activeTab : null; }
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
  const key = KEY_MAP[e.code]; if (!key) return;
  const id = controlTargetId();
  if (!id || isTypingTarget(e.target)) return;
  e.preventDefault();
  if (heldKeys.has(e.code)) return;
  heldKeys.add(e.code); sendControl(id, key, true);
});
window.addEventListener('keyup', (e) => {
  const key = KEY_MAP[e.code]; if (!key || !heldKeys.has(e.code)) return;
  heldKeys.delete(e.code);
  const id = controlTargetId(); if (id) sendControl(id, key, false);
});
window.addEventListener('blur', () => { const id = controlTargetId(); if (id) clearBotControls(id); else heldKeys.clear(); });
window.addEventListener('resize', () => { if (activeTab !== 'global') drawMinimap(activeTab); });

// ════════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════════
applyAppearance();
[appearance.hue, appearance.sat, appearance.val] = hex2hsv(appearance.accent);
connectWS();
loadConfig();
