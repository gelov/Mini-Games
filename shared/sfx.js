// Game Night sound effects. All sounds are synthesized with Web Audio - no audio files.
//
// Audio is deliberately NOT gated on prefers-reduced-motion: that media feature governs
// motion (animations/transitions), not sound. Muting is an explicit, separate user choice.

import { startMusic, stopMusic } from './music.js';

const MUTE_KEY = 'gamenight:muted';

let ctx = null;
let memMuted = false;
let lastHoverAt = 0;
let toggleBtn = null;

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return memMuted;
  }
}

function writeMuted(val) {
  memMuted = val;
  try {
    localStorage.setItem(MUTE_KEY, val ? '1' : '0');
  } catch {
    // ignore - fall back to in-memory value only
  }
}

export function isMuted() {
  return readMuted();
}

export function setMuted(val) {
  writeMuted(Boolean(val));
}

export function toggleMute() {
  const next = !isMuted();
  writeMuted(next);
  return next;
}

export function canHover() {
  return matchMedia('(hover: hover) and (pointer: fine)').matches;
}

// Music is pluggable: by default the hub's synthesized chiptune (shared/music.js)
// plays through the shared AudioContext below. A page can swap in its own track
// (e.g. shared/track.js for a looping audio file) via setMusicController() so the
// same mute key, toggle button, and waiting-pulse logic drive whatever music that
// page wants, without touching the chiptune or any other page's behavior.
const chiptuneController = {
  start(c) {
    startMusic(c);
  },
  stop(opts) {
    stopMusic(opts);
  },
  isWaiting() {
    return !ctx || ctx.state !== 'running';
  },
};
let musicController = chiptuneController;

export function setMusicController(controller) {
  musicController = controller && typeof controller.start === 'function' && typeof controller.stop === 'function'
    ? controller
    : chiptuneController;
}

function getOrCreateCtx() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

// Exposes the single shared AudioContext to other synthesized-audio modules (e.g.
// impostor's mystery music and timer ticks) so they don't create their own
// context - everything stays on one gesture-unlocked clock. Best-effort resume,
// same as every other call site here.
export function getSharedCtx() {
  const c = getOrCreateCtx();
  if (c) c.resume().catch(() => {});
  return c;
}

// The non-chiptune branch below starts its controller unconditionally (it owns
// its own media, e.g. an <audio> element) and only best-effort preps the shared
// AudioContext on the side, for UI blips - it must not gate that controller's
// start on the Web Audio autoplay policy, which is separate from (and can be
// stricter than) the HTMLMediaElement autoplay policy the controller itself deals with.
export function unlock() {
  const c = getOrCreateCtx();
  if (musicController !== chiptuneController) {
    if (!isMuted() && !document.hidden) musicController.start();
    if (c && c.state !== 'running') c.resume().catch(() => {});
    updateWaitingIndicator();
    return;
  }
  if (!c) return;
  if (c.state !== 'running') {
    c.resume()
      .then(() => {
        if (!isMuted() && !document.hidden) musicController.start(c);
        updateWaitingIndicator();
      })
      .catch(() => {});
  } else if (!isMuted() && !document.hidden) {
    musicController.start(c);
  }
  updateWaitingIndicator();
}

// Stops the current page's music; re-exported so callers (e.g. the hub's card click
// handler) can duck the music without reaching into the controller directly.
export function stopBackgroundMusic(opts) {
  musicController.stop(opts);
}

// "Make it automatic": browsers block audio until a user gesture, and there is no
// legitimate way around that. Best effort:
//  1. On load (if not muted), create the context and try to resume + start right
//     away. Some browsers (high media-engagement sites, certain flags/settings)
//     allow this and the music just plays.
//  2. If the context stays suspended, start it on the earliest possible gesture:
//     pointerdown/keydown/touchstart, plus click as a harmless fallback. All
//     listeners are removed once the context is running.
const EARLY_GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'click'];
let gestureListenersArmed = false;

function removeGestureListeners() {
  if (!gestureListenersArmed) return;
  gestureListenersArmed = false;
  EARLY_GESTURE_EVENTS.forEach((type) => window.removeEventListener(type, onEarlyGesture));
}

function onEarlyGesture() {
  unlock();
  if (ctx && ctx.state === 'running') {
    removeGestureListeners();
  }
}

function armGestureListeners() {
  if (gestureListenersArmed) return;
  gestureListenersArmed = true;
  EARLY_GESTURE_EVENTS.forEach((type) =>
    window.addEventListener(type, onEarlyGesture, { passive: true })
  );
}

// Re-check and repaint the waiting-pulse state. Exported so a non-chiptune
// controller (e.g. shared/track.js) can tell the toggle to refresh once its own
// async state changes (e.g. the play() promise resolving after mount).
export function refreshToggle() {
  updateWaitingIndicator();
}

function updateWaitingIndicator() {
  const btn = toggleBtn;
  if (!btn) return;
  const waiting = !isMuted() && musicController.isWaiting();
  btn.classList.toggle('sound-toggle--waiting', waiting);
}

function tryAutoStart() {
  if (isMuted()) return;
  // Best-effort stand up the shared AudioContext for UI blips on every page,
  // but don't let that gate a non-chiptune controller's own autoplay attempt
  // (see the comment on unlock() above).
  const c = getOrCreateCtx();
  if (musicController !== chiptuneController) {
    musicController.start();
    if (c) c.resume().catch(() => {});
    // A non-chiptune controller can still depend on this shared Web Audio ctx
    // for its own synthesized sounds (e.g. impostor's mystery-music.js and
    // timer-ticks.js), not just the <audio>/<video> element it owns directly.
    // Browsers with a strict autoplay policy (notably Safari/iOS) only honor
    // ctx.resume() when it's called synchronously inside a trusted gesture
    // handler - an async resume() attempted later from a poll/SSE callback can
    // be silently ignored forever. So arm the same early-gesture fallback used
    // by the chiptune path here too, or those synthesized sounds can stay
    // mute indefinitely on such browsers even though the controller's own
    // media element plays fine.
    if (!c || c.state !== 'running') armGestureListeners();
    updateWaitingIndicator();
    return;
  }
  if (!c) return;
  c.resume().catch(() => {});
  if (c.state === 'running') {
    musicController.start(c);
  } else {
    armGestureListeners();
  }
  updateWaitingIndicator();
}

// Kick off the best-effort autoplay attempt as soon as this module loads. Deferred
// to a microtask when the DOM is already ready so that a page which imports this
// module and then immediately calls setMusicController() (to swap in its own
// track) finishes that call first - otherwise the default chiptune could start
// for one tick before being swapped out.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryAutoStart, { once: true });
} else {
  queueMicrotask(tryAutoStart);
}

// Pause/resume the loop with the tab's visibility so it doesn't keep playing (or
// drift out of sync) in a background tab.
document.addEventListener('visibilitychange', () => {
  if (musicController !== chiptuneController) {
    updateWaitingIndicator();
    return;
  }
  if (document.hidden) {
    musicController.stop();
  } else if (ctx && !isMuted()) {
    ctx.resume().catch(() => {});
    musicController.start(ctx);
  }
  updateWaitingIndicator();
});

// bfcache fix: when the page is restored from the back/forward cache, the
// AudioContext can come back suspended with the music no longer scheduling.
// Resume it and restart the loop so sound survives the Back button.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  if (musicController !== chiptuneController) {
    updateWaitingIndicator();
    return;
  }
  if (!ctx) return;
  ctx.resume().catch(() => {});
  if (!isMuted()) {
    musicController.start(ctx);
  }
  updateWaitingIndicator();
});

function tone({ freq, start, duration, gainPeak, type = 'sine' }) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.005); // ~5ms attack
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// Tiny square-wave "blip", like a menu cursor move.
function playHover() {
  const now = performance.now();
  if (now - lastHoverAt < 60) return;
  lastHoverAt = now;
  const t = ctx.currentTime;
  tone({ freq: 1200, start: t, duration: 0.04, gainPeak: 0.045, type: 'square' });
}

// Light UI "tick" for ordinary button/link clicks everywhere (see wireUiSounds
// below) - gentler and shorter than the coin-chime `select` sound, which stays
// reserved for the hub's game-card picks.
function playClick() {
  const t = ctx.currentTime;
  tone({ freq: 880, start: t, duration: 0.045, gainPeak: 0.055, type: 'square' });
}

// Classic coin / power-up style confirm: a quick square-wave arpeggio rising.
function playSelect() {
  const t = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 - E5 - G5 - C6
  const step = 0.04;
  notes.forEach((freq, i) => {
    tone({ freq, start: t + i * step, duration: step * 1.3, gainPeak: 0.07, type: 'square' });
  });
}

// Short "1-up" style chirp for unmuting.
function playToggle() {
  const t = ctx.currentTime;
  tone({ freq: 659.25, start: t, duration: 0.05, gainPeak: 0.07, type: 'square' }); // E5
  tone({ freq: 1046.5, start: t + 0.05, duration: 0.09, gainPeak: 0.07, type: 'square' }); // C6
}

const SOUNDS = { hover: playHover, select: playSelect, toggle: playToggle, click: playClick };

export function play(name) {
  if (isMuted()) return;
  if (!ctx) return;
  if (ctx.state !== 'running') return;
  const fn = SOUNDS[name];
  if (fn) fn();
}

// ---------- global UI hover/click sounds (buttons, links, etc. site-wide) ----------

const UI_SOUND_SELECTOR = 'button, a[href], [role="button"], input[type="submit"], input[type="button"], .btn';
// Elements that already play their own dedicated sound and must not also get the
// generic hover/click here: the hub's game-cards (coin chime + nav delay, wired in
// hub.js) and the speaker toggle itself (its own chirp, wired in mountToggle above).
const UI_SOUND_EXCLUDE_SELECTOR = 'a.game, .sound-toggle';

function uiSoundTarget(el) {
  const target = el && el.closest ? el.closest(UI_SOUND_SELECTOR) : null;
  if (!target) return null;
  if (target.closest(UI_SOUND_EXCLUDE_SELECTOR)) return null;
  if (target.closest('[data-no-sfx]')) return null;
  if (target.disabled) return null;
  if (target.getAttribute('aria-disabled') === 'true') return null;
  return target;
}

let uiSoundsWiredRoots = null;

// Event-delegated hover/click sounds for every button-like control on a page,
// including ones rendered later (lobby screens, SSE re-renders, etc.) since the
// listeners live on `root`, not on the elements themselves. Call once per page.
export function wireUiSounds(root = document) {
  uiSoundsWiredRoots ??= new WeakSet();
  if (uiSoundsWiredRoots.has(root)) return;
  uiSoundsWiredRoots.add(root);

  let lastHoverTarget = null;
  root.addEventListener('pointerover', (e) => {
    const target = uiSoundTarget(e.target);
    if (target === lastHoverTarget) return; // moved between children of the same control
    lastHoverTarget = target;
    if (target && canHover()) play('hover');
  });

  root.addEventListener('click', (e) => {
    if (e.button !== undefined && e.button !== 0) return; // ignore middle/right-click
    const target = uiSoundTarget(e.target);
    if (target) play('click');
  });
}

const ICON_ON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="18" height="18" aria-hidden="true">
  <path d="M4 11 H9 L15 6 V22 L9 17 H4 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M19 10 C21.5 12 21.5 16 19 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M22 7 C26 10.5 26 17.5 22 21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;

const ICON_OFF = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="18" height="18" aria-hidden="true">
  <path d="M4 11 H9 L15 6 V22 L9 17 H4 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M19 10 L26 18 M26 10 L19 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;

function renderToggle(btn) {
  const muted = isMuted();
  btn.innerHTML = muted ? ICON_OFF : ICON_ON;
  btn.setAttribute('aria-pressed', String(muted));
  btn.setAttribute('aria-label', muted ? 'Unmute sounds' : 'Mute sounds');
}

export function mountToggle(btn) {
  if (!btn) return;
  toggleBtn = btn;
  renderToggle(btn);
  updateWaitingIndicator();
  btn.addEventListener('click', () => {
    const muted = toggleMute();
    renderToggle(btn);
    if (!muted) {
      unlock(); // starts/resumes whatever music controller is active (isMuted() is now false)
      if (musicController === chiptuneController) play('toggle'); // chiptune-only confirm chirp
    } else {
      musicController.stop();
    }
    updateWaitingIndicator();
  });
}
