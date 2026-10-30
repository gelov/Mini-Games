import { SVG, toDataUrl, sprite, COLORS as C, INK } from './sprites.js';
import { Game, MAX_HEARTS, GRAVITY, PERFECT_HALF, launchVelocity, powerAt } from './game.js';
import { setMusicController, wireUiSounds } from '../../shared/sfx.js';

document.documentElement.classList.add('js');

// Brew Leap has no background music of its own (no hub chiptune, no track) and no
// speaker toggle in its topbar (its design system doesn't import shared/night.css,
// so the shared toggle isn't a cheap drop-in here) - but menu/overlay buttons still
// get the shared hover/click blips, gated on the same 'gamenight:muted' key used
// everywhere else. A silent controller stands up the shared AudioContext for those
// blips without starting any music.
setMusicController({ start() {}, stop() {}, isWaiting: () => false });
wireUiSounds(document); // menu + overlay buttons only; the canvas/hold-to-brew input is untouched (no matching selector)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- per-device personal best (a convenience, not a leaderboard) ----------

const BEST_KEY = 'brew-leap:best';
const best = {
  get() {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
  },
  set(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* storage unavailable */ }
  },
};

// ---------- icons & sprites ----------

const ICONS = { mug: SVG.mug, bean: SVG.bean, heart: SVG.heart, 'heart-empty': SVG.heartEmpty };

function paintIcon(el, name = el.dataset.icon) {
  el.dataset.icon = name;
  el.innerHTML = ICONS[name];
}
$$('[data-icon]').forEach((el) => paintIcon(el));

const baristaUrl = toDataUrl(SVG.barista);
$$('[data-sprite="barista"]').forEach((img) => { img.src = baristaUrl; });

// ---------- title ----------

let charIndex = 0;
$$('[data-split]').forEach((word) => {
  const text = word.textContent.trim();
  word.textContent = '';
  for (const ch of text) {
    const span = document.createElement('span');
    span.className = 'char';
    span.textContent = ch;
    span.style.setProperty('--i', charIndex++);
    word.append(span);
  }
});
const title = $('.title');
if (!reduceMotion) {
  title.classList.add('is-intro');
  setTimeout(() => title.classList.remove('is-intro'), 1700);
}

// ---------- hero: the real game, playing itself ----------

const heroCanvas = $('.hero__scene');
const hero = new Game(heroCanvas, { mode: 'attract', fit: 'cover', zoom: 0.82 });
let heroVisible = true;
let playing = false;

function syncHero() {
  if (!reduceMotion && heroVisible && !playing) hero.start();
  else hero.stop();
}

Promise.all([sprite('barista').decode(), sprite('bean').decode(), document.fonts.ready])
  .catch(() => {})
  .then(() => hero.draw());

new IntersectionObserver(([entry]) => {
  heroVisible = entry.isIntersecting;
  syncHero();
}).observe(heroCanvas);

// ---------- step illustrations ----------

const cliff = (x, top, w, patch = false) => `
  <g stroke="${INK}" stroke-width="3" stroke-linejoin="round">
    <rect x="${x}" y="${top}" width="${w}" height="200" fill="${C.cliff}"/>
    <rect x="${x + 12}" y="${top + 16}" width="7" height="60" rx="3.5" fill="${C.cliffDark}" stroke="none"/>
    <rect x="${x + w - 30}" y="${top + 26}" width="9" height="70" rx="4.5" fill="${C.cliffDark}" stroke="none"/>
    <rect x="${x - 6}" y="${top - 8}" width="${w + 12}" height="17" rx="6" fill="${C.grass}"/>
    ${patch ? `<rect x="${x + w / 2 - 14}" y="${top - 3}" width="28" height="6" rx="3" fill="${C.grassLight}" stroke="none"/>` : ''}
  </g>`;

const barista = (x, y, extra = '') =>
  `<image href="${baristaUrl}" x="${x}" y="${y}" width="56" height="70" ${extra}/>`;

const MINI = {
  charge: `
    <svg viewBox="0 0 320 160" aria-hidden="true">
      ${cliff(-10, 112, 190)}${cliff(250, 104, 90)}
      <g transform="translate(150 112)">
        <g>
          ${barista(-28, -70)}
          ${reduceMotion ? '' : '<animateTransform attributeName="transform" type="scale" values="1 1;1.1 0.8;1 1" dur="1.6s" repeatCount="indefinite"/>'}
        </g>
      </g>
      <rect x="120" y="14" width="60" height="14" rx="7" fill="${C.cream}" stroke="${INK}" stroke-width="3"/>
      <rect x="122" y="16" width="40" height="10" rx="5" fill="${C.cliff}">
        ${reduceMotion ? '' : '<animate attributeName="width" values="2;56;2" dur="1.6s" repeatCount="indefinite"/>'}
      </rect>
    </svg>`,
  leap: `
    <svg viewBox="0 0 320 160" aria-hidden="true">
      ${cliff(-10, 118, 100)}${cliff(220, 110, 110)}
      <path d="M70 116 Q160 -20 262 108" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round" opacity=".55"/>
      <image href="${toDataUrl(SVG.bean)}" x="186" y="34" width="26" height="26"/>
      <g transform="rotate(-10 150 60)">${barista(124, 22)}</g>
    </svg>`,
  land: `
    <svg viewBox="0 0 320 160" aria-hidden="true">
      ${cliff(-10, 112, 60)}${cliff(110, 116, 170, true)}
      ${barista(167, 46)}
      <g fill="#fff" stroke="${INK}" stroke-width="2.5">
        <circle cx="160" cy="106" r="6"/><circle cx="148" cy="100" r="4"/>
        <circle cx="232" cy="106" r="6"/><circle cx="244" cy="100" r="4"/>
      </g>
    </svg>`,
};
$$('[data-mini]').forEach((el) => { el.innerHTML = MINI[el.dataset.mini]; });

// ---------- timing trainer: the same physics on one warm-up gap ----------

(function trainer() {
  const stage = $('[data-trainer-stage]');
  if (!stage) return;
  const btn = $('[data-trainer-btn]');
  const verdict = $('[data-trainer-verdict]');
  const img = $('.trainer__barista', stage);
  const meter = $('.trainer__meter', stage);
  const fill = $('[data-trainer-fill]');

  // stage is 760 x 420 world units; cliffs match the CSS percentages
  const U = { w: 760, h: 420, top: 0.7 * 420 };
  const fromRight = 0.3 * U.w;
  const to = { l: 0.62 * U.w, r: 0.88 * U.w };
  const startX = fromRight - 34;

  let state = 'idle';
  let x = startX;
  let y = U.top;
  let vx = 0;
  let vy = 0;
  let chargeStart = 0;
  let power = 0;
  let last = 0;

  function place(scaleX = 1, scaleY = 1) {
    img.style.left = `${((x - 44) / U.w) * 100}%`;
    img.style.top = `${((y - 108) / U.h) * 100}%`;
    img.style.transformOrigin = '50% 100%';
    img.style.transform = `scale(${scaleX}, ${scaleY})`;
    meter.style.left = `${((x - 42) / U.w) * 100}%`;
    meter.style.top = `${((y - 142) / U.h) * 100}%`;
  }

  function say(text, good) {
    verdict.textContent = text;
    verdict.classList.toggle('is-good', good === true);
    verdict.classList.toggle('is-bad', good === false);
  }

  function reset() {
    state = 'idle';
    x = startX;
    y = U.top;
    place();
  }

  function finish(text, good) {
    state = 'done';
    say(text, good);
    setTimeout(reset, 1300);
  }

  function tick(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'charge') {
      power = powerAt((now - chargeStart) / 1000);
      fill.style.width = `${power * 100}%`;
      place(1 + power * 0.1, 1 - power * 0.2);
    } else if (state === 'air') {
      const prevY = y;
      vy += GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      if (vy > 0 && prevY <= U.top && y >= U.top) {
        if (x >= to.l - 8 && x <= to.r + 8) {
          y = U.top;
          place(1.1, 0.85);
          const off = Math.abs(x - (to.l + to.r) / 2);
          return finish(off <= PERFECT_HALF ? 'Perfect patch! That\'s a bonus bean.' : 'Landed! You\'re ready.', true);
        }
        if (x <= fromRight + 8) {
          y = U.top;
          place();
          return finish('Barely a hop. Hold longer.', false);
        }
      }
      if (y > U.top + 6 && x > to.l - 12 && x < to.l + 20 && vx > 0) {
        x = to.l - 12;
        vx = 0;
      }
      place(0.95, 1.06);
      if (y > U.h + 140) return finish(x < to.l ? 'Too short. Splash!' : 'Overshot. Splash!', false);
    } else {
      return;
    }
    requestAnimationFrame(tick);
  }

  function press() {
    if (state !== 'idle') return;
    state = 'charge';
    chargeStart = performance.now();
    power = 0;
    btn.classList.add('is-pressed');
    meter.classList.add('is-on');
    say(' ');
    last = performance.now();
    requestAnimationFrame(tick);
  }

  function release() {
    btn.classList.remove('is-pressed');
    if (state !== 'charge') return;
    meter.classList.remove('is-on');
    const v = launchVelocity(power);
    vx = v.vx;
    vy = v.vy;
    state = 'air';
  }

  btn.addEventListener('pointerdown', (e) => {
    btn.setPointerCapture?.(e.pointerId);
    press();
  });
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('click', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) press();
  });
  btn.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault();
    release();
  });

  reset();
})();

// ---------- the game ----------

const overlay = $('#play');
const stage = $('[data-stage]', overlay);
const heartsEl = $('[data-hearts]', overlay);
const cliffsEl = $('[data-cliffs]', overlay);
const beansEl = $('[data-beans]', overlay);
const panels = {
  start: $('[data-panel="start"]', overlay),
  pause: $('[data-panel="pause"]', overlay),
  over: $('[data-panel="over"]', overlay),
};

heartsEl.innerHTML = '<i></i>'.repeat(MAX_HEARTS);
[...heartsEl.children].forEach((el) => paintIcon(el, 'heart'));

let game = null;
let phase = 'closed'; // closed | start | run | pause | over
let lastTrigger = null;
let shownCliffs = 0;

// move focus into panels only for keyboard players; mouse/touch players shouldn't see a focus ring
let keyboardUser = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key === 'Enter') keyboardUser = true; }, true);
window.addEventListener('pointerdown', () => { keyboardUser = false; }, true);

function showPanel(name) {
  for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
  if (name && keyboardUser) $('.pill--primary', panels[name])?.focus({ preventScroll: true });
}

function renderHud({ hearts, cliffs, beans }) {
  [...heartsEl.children].forEach((el, i) => {
    const want = i < hearts ? 'heart' : 'heart-empty';
    if (el.dataset.icon === want) return;
    paintIcon(el, want);
    el.classList.toggle('is-lost', want === 'heart-empty');
    if (want === 'heart') {
      el.classList.remove('is-gain');
      void el.offsetWidth;
      el.classList.add('is-gain');
    }
  });
  heartsEl.setAttribute('aria-label', `${hearts} of ${MAX_HEARTS} hearts`);
  beansEl.textContent = beans;
  cliffsEl.textContent = cliffs;
  if (cliffs !== shownCliffs) {
    cliffsEl.classList.remove('is-bump');
    void cliffsEl.offsetWidth;
    cliffsEl.classList.add('is-bump');
    shownCliffs = cliffs;
  }
}

function onOver({ cliffs, beans }) {
  if (phase !== 'run') return;
  phase = 'over';
  const prev = best.get();
  const top = Math.max(prev, cliffs);
  if (top > prev) best.set(top);
  $('[data-final-cliffs]').textContent = cliffs;
  $('[data-final-beans]').textContent = beans;
  $('[data-final-best]').textContent = top;
  let note = '';
  if (cliffs > prev && prev > 0) note = 'New personal best!';
  else if (cliffs === 0) note = 'Tip: watch the meter. It drains again if you hold too long.';
  else if (cliffs < prev) note = `${prev - cliffs} ${prev - cliffs === 1 ? 'cliff' : 'cliffs'} short of your best.`;
  $('[data-final-note]').textContent = note;
  updateBest();
  showPanel('over');
}

function openGame() {
  if (phase !== 'closed') return;
  playing = true;
  overlay.hidden = false;
  document.body.classList.add('is-playing');
  if (!game) {
    game = new Game($('.play__canvas', overlay), { mode: 'play', on: { change: renderHud, over: onOver } });
  } else {
    game.resize();
    game.reset();
  }
  shownCliffs = 0;
  game.paused = true;
  game.start();
  phase = 'start';
  showPanel('start');
  syncHero();
  if (location.hash !== '#play') history.pushState(null, '', '#play');
}

function closeGame() {
  if (phase === 'closed') return;
  phase = 'closed';
  playing = false;
  game.stop();
  overlay.hidden = true;
  document.body.classList.remove('is-playing');
  if (location.hash === '#play') history.replaceState(null, '', location.pathname + location.search);
  syncHero();
  lastTrigger?.focus({ preventScroll: true });
}

function begin() {
  phase = 'run';
  showPanel(null);
  game.held = false;
  game.paused = false;
  document.activeElement?.blur();
}

function pause() {
  if (phase !== 'run') return;
  phase = 'pause';
  game.paused = true;
  game.held = false;
  if (game.player.state === 'charge') game.player.state = 'idle';
  showPanel('pause');
}

function restart() {
  game.reset();
  shownCliffs = 0;
  begin();
}

const ACTIONS = { begin, pause, resume: begin, restart, exit: closeGame };

$$('[data-play]').forEach((btn) => btn.addEventListener('click', () => {
  lastTrigger = btn;
  openGame();
}));

overlay.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action) ACTIONS[action]();
});

stage.addEventListener('pointerdown', (e) => {
  if (phase !== 'run' || e.button > 0 || e.target.closest('button')) return;
  stage.setPointerCapture?.(e.pointerId);
  game.press();
});
const releaseGame = () => { if (phase === 'run') game.release(); };
stage.addEventListener('pointerup', releaseGame);
stage.addEventListener('pointercancel', releaseGame);
stage.addEventListener('contextmenu', (e) => e.preventDefault());

const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
window.addEventListener('keydown', (e) => {
  if (phase === 'closed') return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (phase === 'run') pause();
    else if (phase === 'pause') begin();
    else if (e.code === 'Escape') closeGame();
    return;
  }
  const onButton = document.activeElement?.tagName === 'BUTTON';
  if ((e.code === 'Space' || e.code === 'Enter') && !onButton && (phase === 'start' || phase === 'over')) {
    e.preventDefault();
    if (phase === 'start') begin();
    else restart();
    return;
  }
  if (JUMP_KEYS.has(e.code) && phase === 'run') {
    e.preventDefault();
    if (!e.repeat) game.press();
  }
});
window.addEventListener('keyup', (e) => {
  if (JUMP_KEYS.has(e.code) && phase === 'run') {
    e.preventDefault();
    game.release();
  }
});
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

window.addEventListener('popstate', () => {
  if (location.hash === '#play') openGame();
  else closeGame();
});

// ---------- personal best, reveals, deep link ----------

function updateBest() {
  const el = $('[data-best]');
  const value = best.get();
  el.hidden = value === 0;
  el.textContent = `Your best on this device: ${value} ${value === 1 ? 'cliff' : 'cliffs'}`;
  const chip = $('[data-best-chip]');
  if (chip) chip.textContent = `Best ${String(value).padStart(2, '0')}`;
}
updateBest();

const revealer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('is-in');
    revealer.unobserve(entry.target);
  }
}, { threshold: 0.15 });
$$('.reveal').forEach((el) => revealer.observe(el));

if (location.hash === '#play') openGame();
