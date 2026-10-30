// Shared helpers for the Team Escape pages: API calls, per-tab session, and small formatters.
const API = '/api/team-escape';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("Can't reach the game server. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error && (res.status === 404 || res.status === 405)) {
    // a server started before Team Escape was added answers without our JSON error body
    throw new ApiError("The game server doesn't have Team Escape loaded yet. Restart it (npm start) and try again.", res.status);
  }
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong.', res.status);
  return data;
}

// Per-tab identity: survives reloads (reconnect) and lets several tabs be different players.
const key = (code) => `team-escape:${code}`;
export const session = {
  get(code) {
    try { return JSON.parse(sessionStorage.getItem(key(code))); } catch { return null; }
  },
  set(code, value) {
    try { sessionStorage.setItem(key(code), JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  clear(code) {
    try { sessionStorage.removeItem(key(code)); } catch { /* storage unavailable */ }
  },
};
export const lastName = {
  get() { try { return localStorage.getItem('team-escape:name') || localStorage.getItem('impostor:name') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('team-escape:name', v); } catch { /* storage unavailable */ } },
};

export const normalizeCode = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 134567 -> "02:14.5" */
export function clock(ms, tenths = true) {
  if (ms == null) return '--:--';
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((t % 1000) / 100)}` : base;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
