// Shared helpers for Who's the Impostor? pages: API calls, per-tab session, and small markup builders.

const API = '/api/impostor';

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
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong.', res.status);
  return data;
}

// Per-tab identity: survives reloads (reconnect) and lets several tabs be different players.
const key = (code) => `impostor:${code}`;
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
// remembers the last display name to prefill forms
export const lastName = {
  get() { try { return localStorage.getItem('impostor:name') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('impostor:name', v); } catch { /* storage unavailable */ } },
};

export const normalizeCode = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** The secret word, on a cream outlined card (the impostor-game analogue of the Name Game nametag). */
export function wordcard(word, size = '') {
  return `<div class="wordcard ${size ? `wordcard--${size}` : ''}">
    <div class="wordcard__band"><b>SECRET</b><span>word</span></div>
    <div class="wordcard__body"><span class="wordcard__word">${esc(word)}</span></div>
  </div>`;
}

const AVATAR_COLORS = ['#f7ab5c', '#5dd9b3', '#9b7bff', '#ff6363', '#ffd166', '#6cc4ff', '#ff9ecd', '#a7e36b'];
export function avatar(player, size = '') {
  let h = 0;
  for (const ch of player.id || player.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initial = (player.name || '?').trim().charAt(0).toUpperCase();
  return `<span class="avatar ${size ? `avatar--${size}` : ''}" style="--av:${AVATAR_COLORS[h % AVATAR_COLORS.length]}" aria-hidden="true">${esc(initial)}</span>`;
}

const RING = 2 * Math.PI * 30;
export function timer() {
  return `<span class="timer" data-timer role="timer" aria-label="Time left">
    <svg viewBox="0 0 74 74" aria-hidden="true"><circle class="timer__track" cx="37" cy="37" r="30"/><circle class="timer__fill" cx="37" cy="37" r="30" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
    <b data-timer-text>0:00</b>
  </span>`;
}

/** Update every [data-timer] ring from a server deadline. Safe to call when no
 * ring is mounted (e.g. a player with nothing to do this phase, whose bar()
 * omits the ring) - querySelectorAll just finds nothing and the forEach is a
 * no-op, so this never throws. */
export function paintTimers(deadline, totalSecs, serverOffset) {
  const left = deadline ? Math.max(0, (deadline - (Date.now() + serverOffset)) / 1000) : 0;
  const frac = totalSecs ? Math.min(1, left / totalSecs) : 0;
  const s = Math.ceil(left);
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  document.querySelectorAll('[data-timer]').forEach((el) => {
    el.querySelector('[data-timer-text]').textContent = text;
    el.querySelector('.timer__fill').setAttribute('stroke-dashoffset', String(RING * (1 - frac)));
    el.classList.toggle('is-low', left <= 10);
  });
  document.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = text; });
  // Compact per-row countdown in the clue turn-order roster, visible to everyone
  // (not just the active player) so idle players can see the turn's time left
  // without a full roster re-render every tick - only text/class are touched.
  document.querySelectorAll('[data-row-timer]').forEach((el) => {
    el.querySelector('[data-row-timer-text]').textContent = text;
    el.classList.toggle('is-low', left <= 10);
  });
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
