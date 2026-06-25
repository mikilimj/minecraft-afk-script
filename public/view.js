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
