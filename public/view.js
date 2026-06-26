const id = new URLSearchParams(location.search).get('id');
const frame = document.getElementById('pov-frame');
const fpChk = document.getElementById('firstperson');
const msg = document.getElementById('msg');

async function setTitle() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    const acc = (cfg.accounts || []).find((a) => a.id === id);
    if (acc) document.getElementById('title').textContent = `3D View — ${acc.name}`;
  } catch (_) {}
}

async function open() {
  msg.textContent = '';
  const res = await fetch(`/api/bot/view/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstPerson: fpChk.checked }),
  });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || 'Cannot open view'; frame.removeAttribute('src'); return; }
  frame.src = `http://${location.hostname}:${data.port}/`;
}

fpChk.addEventListener('change', open);
setTitle();
if (id) open(); else msg.textContent = 'No bot id in URL.';

window.addEventListener('beforeunload', () => {
  if (id) fetch(`/api/bot/view/${id}`, { method: 'DELETE', keepalive: true });
});

// ── KEYBOARD BOT CONTROLS ──────────────────────────────────────────────────────
// WASD drive this account's bot. The 3D iframe is cross-origin, so keep focus on
// the page (not inside the view) for keys to register.
const KEY_MAP = {
  KeyW: 'forward', KeyA: 'left', KeyS: 'back', KeyD: 'right',
  Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint',
};
const heldKeys = new Set();

function sendBotCommand(action, params = {}) {
  if (!id) return;
  fetch('/api/bot/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id], action, params }),
  }).catch(() => {});
}
function isTypingTarget(t) { return t && t.closest && t.closest('input,textarea,select,[contenteditable]'); }

window.addEventListener('keydown', (e) => {
  const key = KEY_MAP[e.code];
  if (!key || !id || isTypingTarget(e.target)) return;
  e.preventDefault();
  if (heldKeys.has(e.code)) return;
  heldKeys.add(e.code);
  sendBotCommand('control', { key, state: true });
});

window.addEventListener('keyup', (e) => {
  const key = KEY_MAP[e.code];
  if (!key || !heldKeys.has(e.code)) return;
  heldKeys.delete(e.code);
  sendBotCommand('control', { key, state: false });
});

window.addEventListener('blur', () => { heldKeys.clear(); sendBotCommand('clearControls'); });
