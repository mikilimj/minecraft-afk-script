const net = require('net');
const dns = require('dns').promises;

const _warn  = console.warn;
const _error = console.error;
const _log   = console.log;

function installConsoleFilter() {
  const noisy = (a) => typeof a[0] === 'string' && a[0].toLowerCase().includes('chunk size is');
  console.warn  = (...a) => { if (noisy(a)) return; _warn(...a); };
  console.error = (...a) => {
    if (noisy(a)) return;
    if (a[0] instanceof Error && a[0].message.toLowerCase().includes('chunk size is')) return;
    _error(...a);
  };
  console.log   = (...a) => { if (noisy(a)) return; _log(...a); };
  return { _log, _warn, _error };
}

function extractChatText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return String(obj);
  if (Array.isArray(obj)) return obj.map(extractChatText).join('');
  let r = '';
  if (obj.text      !== undefined) r += obj.text;
  if (obj.translate !== undefined) r += obj.translate;
  if (Array.isArray(obj.extra))    r += obj.extra.map(extractChatText).join('');
  return r;
}

function stripColors(text) {
  if (!text) return '';
  let plain = text;
  if (typeof text === 'object') {
    try { plain = extractChatText(text) || JSON.stringify(text); } catch { plain = String(text); }
  } else { plain = String(text); }
  return plain.replace(/§[0-9a-fk-orA-FK-OR]/g, '').trim();
}

async function resolveServerAddress(host, port, { resolveSrv = dns.resolveSrv, retries = 3, retryDelayMs = 400 } = {}) {
  if (net.isIP(host)) return { host, port };
  for (let attempt = 0; ; attempt++) {
    try {
      const records = await resolveSrv(`_minecraft._tcp.${host}`);
      if (records && records.length > 0) return { host: records[0].name, port: records[0].port };
      return { host, port };
    } catch (err) {
      if (err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND')) return { host, port };
      if (attempt >= retries) return { host, port };
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

module.exports = { stripColors, extractChatText, resolveServerAddress, installConsoleFilter, _log, _warn, _error };
