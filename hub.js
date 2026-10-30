// Game Night menu. Reuses Brew Leap's sprite set so the hub and the game share one look.
import { SVG, toDataUrl, COLORS as C, INK } from './brew-leap/js/sprites.js';
import { mountNightSky } from './shared/night-sky.js';
import { cardScene } from './team-escape/js/art.js';
import { characterReady } from './team-escape/js/character.js';
import { unlock, play, isMuted, canHover, mountToggle, stopBackgroundMusic, wireUiSounds } from './shared/sfx.js';

// flat outlined purple gamepad, drawn in the same style as the game's icons (buttons animate via hub.css)
const CONTROLLER = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 28">
  <path d="M11 4 H29 C35.5 4 38.8 10 38.8 17 C38.8 23 36 26 32.8 26 C29.8 26 28 22.6 26.2 20.4 H13.8 C12 22.6 10.2 26 7.2 26 C4 26 1.2 23 1.2 17 C1.2 10 4.5 4 11 4 Z"
        fill="#9b7bff" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M8 8.6 C9.4 7.4 11 7 13 7" fill="none" stroke="#c7b6ff" stroke-width="1.6" stroke-linecap="round"/>
  <rect x="7.5" y="12.6" width="8.4" height="3" rx="1" fill="${INK}"/>
  <rect x="10.2" y="9.9" width="3" height="8.4" rx="1" fill="${INK}"/>
  <circle class="pad-btn pad-btn--a" cx="28" cy="11.8" r="2.1" fill="#f7ab5c" stroke="${INK}" stroke-width="1.4"/>
  <circle class="pad-btn pad-btn--b" cx="32.2" cy="16" r="2.1" fill="#5DD9B3" stroke="${INK}" stroke-width="1.4"/>
</svg>`;

const ICONS = { mug: SVG.mug, bean: SVG.bean, controller: CONTROLLER };
document.querySelectorAll('[data-icon]').forEach((el) => {
  el.innerHTML = ICONS[el.dataset.icon];
});

const cliff = (x, top, w, patch = false) => `
  <g stroke="${INK}" stroke-width="3" stroke-linejoin="round">
    <rect x="${x}" y="${top}" width="${w}" height="200" fill="${C.cliff}"/>
    <rect x="${x + 12}" y="${top + 16}" width="7" height="60" rx="3.5" fill="${C.cliffDark}" stroke="none"/>
    <rect x="${x + w - 26}" y="${top + 26}" width="9" height="70" rx="4.5" fill="${C.cliffDark}" stroke="none"/>
    <rect x="${x - 6}" y="${top - 8}" width="${w + 12}" height="17" rx="6" fill="${C.grass}"/>
    ${patch ? `<rect x="${x + w / 2 - 14}" y="${top - 3}" width="28" height="6" rx="3" fill="${C.grassLight}" stroke="none"/>` : ''}
  </g>`;

const THUMBS = {
  'brew-leap': `
    <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMax slice">
      <g fill="#b1d6e5"><rect x="20" y="60" width="44" height="160"/><rect x="200" y="40" width="50" height="180"/></g>
      <g fill="${C.cloud}"><circle cx="120" cy="96" r="26"/><circle cx="150" cy="84" r="34"/><circle cx="182" cy="98" r="22"/><rect x="96" y="96" width="108" height="24"/></g>
      <g fill="#8fbcd1"><rect x="80" y="100" width="40" height="120"/><rect x="252" y="80" width="46" height="140"/></g>
      ${cliff(-10, 150, 110)}${cliff(200, 140, 130, true)}
      <path d="M78 148 Q150 30 238 136" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round" opacity=".5"/>
      <image href="${toDataUrl(SVG.bean)}" x="176" y="56" width="26" height="26"/>
      <g transform="rotate(-8 140 70)"><image href="${toDataUrl(SVG.barista)}" x="112" y="32" width="58" height="72"/></g>
    </svg>`,
};
// The Name Game: its "HELLO my name is" sticker with a clue bubble and a guess, on the night sky
THUMBS['name-game'] = `
  <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">
    <rect width="320" height="200" fill="#1b3050"/>
    <g fill="#fdf3d8"><circle cx="28" cy="30" r="1.6"/><circle cx="292" cy="24" r="1.8"/><circle cx="250" cy="170" r="1.4"/><circle cx="60" cy="168" r="1.5"/><circle cx="300" cy="120" r="1.3"/></g>
    <g transform="rotate(-7 160 110)" stroke="${INK}" stroke-width="4" stroke-linejoin="round">
      <rect x="92" y="52" width="136" height="104" rx="12" fill="#fff6e8"/>
      <path d="M92 64 a12 12 0 0 1 12 -12 h112 a12 12 0 0 1 12 12 v32 h-136 z" fill="#ff6363"/>
      <text x="160" y="83" text-anchor="middle" font-family="Lilita One, Arial Rounded MT Bold, sans-serif" font-size="25" fill="#fff" stroke="none">HELLO</text>
      <text x="160" y="93" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="900" font-size="8" letter-spacing="1.2" fill="#fff" stroke="none">MY NAME IS</text>
      <text x="160" y="134" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="900" font-size="24" fill="${INK}" stroke="none">?????</text>
    </g>
    <g stroke="${INK}" stroke-width="3" stroke-linejoin="round">
      <path d="M16 22 h96 a10 10 0 0 1 10 10 v18 a10 10 0 0 1 -10 10 h-70 l-12 10 v-10 h-14 a10 10 0 0 1 -10 -10 v-18 a10 10 0 0 1 10 -10 z" fill="#1f3452"/>
      <path d="M212 148 h88 a10 10 0 0 1 10 10 v18 a10 10 0 0 1 -10 10 h-74 l-10 10 v-10 h-4 a10 10 0 0 1 -10 -10 v-18 a10 10 0 0 1 10 -10 z" fill="#5dd9b3"/>
    </g>
    <g fill="#eef4f8"><rect x="26" y="33" width="58" height="6" rx="3"/><rect x="26" y="44" width="80" height="6" rx="3" opacity=".7"/></g>
    <g fill="${INK}"><rect x="216" y="160" width="64" height="6" rx="3"/><rect x="216" y="171" width="44" height="6" rx="3" opacity=".7"/></g>
  </svg>`;

// Who's the Impostor?: a police lineup wall with a height chart and a spotlight aimed at the
// 3rd suspect (ponytail) - the impostor, who's tilted slightly, wearing suspicious sunglasses,
// and sitting under a "?" badge.
THUMBS['impostor'] = `
  <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">
    <rect width="320" height="200" fill="#1b3050"/>
    <rect x="0" y="168" width="320" height="32" fill="#16263f"/>
    <g stroke="#fdf3d8" stroke-width="1.4" opacity=".15">
      <line x1="0" y1="34" x2="320" y2="34"/>
      <line x1="0" y1="58" x2="320" y2="58"/>
      <line x1="0" y1="82" x2="320" y2="82"/>
      <line x1="0" y1="106" x2="320" y2="106"/>
      <line x1="0" y1="130" x2="320" y2="130"/>
      <line x1="0" y1="154" x2="320" y2="154"/>
    </g>
    <polygon points="208,-20 150,200 266,200" fill="#fdf3d8" opacity=".10"/>
    <polygon points="208,-20 178,200 238,200" fill="#fdf3d8" opacity=".07"/>
    <image href="assets/suspects/suspect-1.png" x="31.5" y="106" width="53" height="84"/>
    <image href="assets/suspects/suspect-2.png" x="103.1" y="106" width="53.8" height="84"/>
    <g transform="rotate(-4 208 148)">
      <image href="assets/suspects/suspect-3.png" x="177.3" y="106" width="61.3" height="88"/>
      <g stroke="${INK}" stroke-width="1.2" stroke-linejoin="round">
        <rect x="196.5" y="136.3" width="12" height="9" rx="4" fill="${INK}"/>
        <rect x="212.45" y="136.3" width="12" height="9" rx="4" fill="${INK}"/>
        <rect x="208.5" y="139.8" width="3.95" height="2" fill="${INK}" stroke="none"/>
        <circle cx="200" cy="139" r="1.1" fill="#fdf3d8" stroke="none"/>
        <circle cx="215.95" cy="139" r="1.1" fill="#fdf3d8" stroke="none"/>
      </g>
      <path d="M226.3 138.3 q-1.5 4 0 8 q2 2.5 0 5" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M226.3 138.3 q-1.5 4 0 8 q2 2.5 0 5 q-2 -1 -1 -5 q-1.5 -4.5 1 -8 z" fill="#6cc4ff" stroke="none" opacity=".9"/>
    </g>
    <image href="assets/suspects/suspect-4.png" x="240.5" y="106" width="63" height="84"/>
    <g transform="translate(208 42)" stroke="${INK}" stroke-width="3" stroke-linejoin="round">
      <circle cx="0" cy="0" r="17" fill="#fdf3d8"/>
      <text x="0" y="8" text-anchor="middle" font-family="Lilita One, Arial Rounded MT Bold, sans-serif" font-size="22" fill="#ff6363" stroke="none">?</text>
    </g>
  </svg>`;

// Team Escape: Sprouts boosting each other up to the key, with the locked exit door
THUMBS['team-escape'] = cardScene();
characterReady.then(() => {
  const el = document.querySelector('[data-thumb="team-escape"]');
  if (el) el.innerHTML = cardScene();
});

document.querySelectorAll('[data-thumb]').forEach((el) => {
  el.innerHTML = THUMBS[el.dataset.thumb] ?? '';
});

const games = document.querySelectorAll('.games > li');
document.querySelector('[data-total-count]').textContent = games.length;
document.querySelector('[data-ready-count]').textContent = document.querySelectorAll('.games a.game').length;

// ---------- night sky backdrop (shared with the game pages) ----------

mountNightSky(document.querySelector('.skyline'));

// ---------- sound ----------

if (canHover()) {
  document.querySelectorAll('a.game').forEach((link) => {
    link.addEventListener('pointerenter', () => play('hover'));
  });
}

document.querySelectorAll('a.game').forEach((link) => {
  link.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (isMuted()) return;
    unlock();
    play('select');
    stopBackgroundMusic({ fast: true });
    e.preventDefault();
    setTimeout(() => location.assign(link.href), 120);
  });
});

mountToggle(document.querySelector('.sound-toggle'));

// Global hover/click sounds for every other button on the hub. a.game cards keep
// their own coin-chime + nav-delay handling above (excluded inside wireUiSounds),
// and the sound-toggle keeps its own chirp (also excluded there).
wireUiSounds(document);
