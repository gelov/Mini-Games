// Game Night menu. Reuses Brew Leap's sprite set so the hub and the game share one look.
import { SVG, toDataUrl, COLORS as C, INK } from './brew-leap/js/sprites.js';
import { mountNightSky } from './shared/night-sky.js';

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

// Who's the Impostor?: a row of suspects on the night sky, one wearing a disguise with a "?" above.
THUMBS['impostor'] = `
  <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">
    <rect width="320" height="200" fill="#1b3050"/>
    <g fill="#fdf3d8"><circle cx="22" cy="26" r="1.6"/><circle cx="298" cy="22" r="1.8"/><circle cx="268" cy="168" r="1.4"/><circle cx="46" cy="162" r="1.5"/><circle cx="306" cy="110" r="1.3"/><circle cx="150" cy="18" r="1.4"/></g>
    <g stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">
      <!-- crew member 1: side-glancing left -->
      <g transform="translate(58 128)">
        <rect x="-26" y="10" width="52" height="56" rx="18" fill="#6cc4ff"/>
        <circle cx="0" cy="-8" r="26" fill="#fdf3d8"/>
        <circle cx="7" cy="-9" r="3" fill="${INK}" stroke="none"/>
        <circle cx="-5" cy="-9" r="3" fill="${INK}" stroke="none"/>
      </g>
      <!-- crew member 2: side-glancing right toward suspect -->
      <g transform="translate(130 134)">
        <rect x="-24" y="8" width="48" height="52" rx="17" fill="#5dd9b3"/>
        <circle cx="0" cy="-10" r="24" fill="#fdf3d8"/>
        <circle cx="6" cy="-11" r="2.8" fill="${INK}" stroke="none"/>
        <circle cx="12" cy="-10" r="2.8" fill="${INK}" stroke="none"/>
      </g>
      <!-- the impostor: sunglasses + hat, "?" mark above -->
      <g transform="translate(208 118)">
        <rect x="-30" y="14" width="60" height="62" rx="20" fill="#f7ab5c"/>
        <circle cx="0" cy="-6" r="28" fill="#fdf3d8"/>
        <path d="M-24 -20 a24 20 0 0 1 48 0 z" fill="${INK}"/>
        <rect x="-22" y="-20" width="44" height="7" rx="3.5" fill="${INK}"/>
        <rect x="-20" y="-10" width="16" height="9" rx="4" fill="${INK}"/>
        <rect x="4" y="-10" width="16" height="9" rx="4" fill="${INK}"/>
        <rect x="-4" y="-7" width="8" height="3" fill="${INK}"/>
        <path d="M-10 10 q10 8 20 0" fill="none" stroke="${INK}" stroke-width="3"/>
      </g>
      <!-- crew member 3: side-glancing left toward suspect -->
      <g transform="translate(272 132)">
        <rect x="-22" y="10" width="44" height="50" rx="16" fill="#ff9ecd"/>
        <circle cx="0" cy="-8" r="22" fill="#fdf3d8"/>
        <circle cx="-7" cy="-9" r="2.6" fill="${INK}" stroke="none"/>
        <circle cx="-1" cy="-8" r="2.6" fill="${INK}" stroke="none"/>
      </g>
    </g>
    <g transform="translate(208 52)" stroke="${INK}" stroke-width="3" stroke-linejoin="round">
      <circle cx="0" cy="0" r="17" fill="#fdf3d8"/>
      <text x="0" y="8" text-anchor="middle" font-family="Lilita One, Arial Rounded MT Bold, sans-serif" font-size="22" fill="#ff6363" stroke="none">?</text>
    </g>
  </svg>`;

document.querySelectorAll('[data-thumb]').forEach((el) => {
  el.innerHTML = THUMBS[el.dataset.thumb] ?? '';
});

const games = document.querySelectorAll('.games > li');
document.querySelector('[data-total-count]').textContent = games.length;
document.querySelector('[data-ready-count]').textContent = document.querySelectorAll('.games a.game').length;

// ---------- night sky backdrop (shared with the game pages) ----------

mountNightSky(document.querySelector('.skyline'));
