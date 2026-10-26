// Single source of truth for the game's illustrated assets.
// The same SVG markup is inlined into the page and rasterised onto the canvas,
// so the landing page and the game always share one visual identity.

export const INK = '#22384c';

export const COLORS = {
  ink: INK,
  sky: '#c6eaf5',
  cityFar: '#b1d6e5',
  cityNear: '#8fbcd1',
  cityEdge: '#7eaec4',
  cloud: '#ffffff',
  cliff: '#f1a35e',
  cliffDark: '#de8745',
  cliffLight: '#f8c088',
  grass: '#63c9b1',
  grassDark: '#41a690',
  grassLight: '#a7ecd9',
  pillar: '#b4a3a9',
  pillarDark: '#9d8c94',
  pillarCap: '#93bfc0',
  sign: '#f7ab5c',
  cream: '#fff6e8',
  heart: '#ff6363',
  bean: '#8b5a3a',
  beanDark: '#5c3a24',
};

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

const barista = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 120">
  <g ${S} stroke-width="4">
    <path d="M36 84 L34 108 H46 L48 86 Z" fill="#2d4866"/>
    <path d="M50 86 L54 108 H66 L62 84 Z" fill="#2d4866"/>
    <path d="M30 106 H48 Q51 117 44 117 H30 Q25 117 30 106 Z" fill="${INK}"/>
    <path d="M52 106 H70 Q75 117 68 117 H54 Q49 117 52 106 Z" fill="${INK}"/>
    <path d="M32 62 Q22 72 30 82" fill="none"/>
    <path d="M30 62 Q30 52 42 52 H56 Q68 52 68 62 V88 H30 Z" fill="#ffffff"/>
    <path d="M36 66 H62 V88 H36 Z" fill="${COLORS.cliff}"/>
    <path d="M40 66 L44 55 M58 66 L54 55" fill="none" stroke-width="3"/>
    <path d="M64 62 Q73 65 74 72" fill="none"/>
    <rect x="70" y="66" width="16" height="16" rx="3" fill="#ffffff"/>
    <path d="M86 70 Q93 70 93 74 Q93 78 86 78" fill="none" stroke-width="3.5"/>
    <path d="M70 72 H86" fill="none" stroke-width="3"/>
    <path d="M75 61 q3 -4 0 -7 M81 61 q3 -4 0 -7" fill="none" stroke-width="2.5"/>
    <circle cx="32" cy="38" r="5" fill="#ffd8b5"/>
    <circle cx="50" cy="32" r="21" fill="#ffd8b5"/>
    <path d="M29 33 Q26 9 50 9 Q74 9 71 31 Q64 22 53 25 Q46 17 38 24 Q33 27 29 33 Z" fill="#2c6890"/>
    <path d="M48 10 Q51 2 59 5" fill="none" stroke-width="3.5"/>
    <circle cx="51" cy="36" r="7" fill="#ffffff" stroke-width="3"/>
    <circle cx="67" cy="36" r="7" fill="#ffffff" stroke-width="3"/>
    <path d="M58 36 H60" stroke-width="3"/>
  </g>
  <circle cx="53" cy="36.5" r="2.4" fill="${INK}"/>
  <circle cx="69" cy="36.5" r="2.4" fill="${INK}"/>
  <path d="M57 47 Q61 50 65 47" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <circle cx="45" cy="45" r="3.2" fill="#ff9f8a" opacity=".75"/>
</svg>`;

const bean = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <g transform="rotate(-28 16 16)" ${S}>
    <ellipse cx="16" cy="16" rx="10" ry="13" fill="${COLORS.bean}" stroke-width="3"/>
    <path d="M13 5 Q20 16 13 27" fill="none" stroke="${COLORS.beanDark}" stroke-width="2.6"/>
  </g>
  <ellipse cx="10.5" cy="11" rx="2" ry="3.4" fill="#b98463" transform="rotate(-28 10.5 11)"/>
</svg>`;

const heart = (fill) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 28">
  <path d="M16 26 C6 19 2 13.5 2 8.5 C2 4.6 5 2 8.8 2 C12 2 14.4 4 16 6.6 C17.6 4 20 2 23.2 2 C27 2 30 4.6 30 8.5 C30 13.5 26 19 16 26 Z"
        fill="${fill}" ${S} stroke-width="3"/>
  ${fill === COLORS.heart ? '<ellipse cx="8.6" cy="8" rx="2.4" ry="1.7" fill="#fff" opacity=".85" transform="rotate(-30 8.6 8)"/>' : ''}
</svg>`;

const mug = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g ${S} stroke-width="4">
    <path d="M22 15 q4 -5 0 -10 M32 15 q4 -5 0 -10" fill="none" stroke-width="3"/>
    <path d="M47 27 Q59 27 59 37 Q59 47 47 47" fill="none"/>
    <path d="M9 21 H47 V46 Q47 57 36 57 H20 Q9 57 9 46 Z" fill="#ffffff"/>
    <path d="M9 31 H47 V40 H9 Z" fill="${COLORS.cliff}" stroke-width="3"/>
  </g>
</svg>`;

export const SVG = {
  barista,
  bean,
  heart: heart(COLORS.heart),
  heartEmpty: heart('#d8e4ea'),
  mug,
};

export const toDataUrl = (svg) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.trim());

const images = {};
export function sprite(name) {
  if (!images[name]) {
    const img = new Image();
    img.decoding = 'async';
    img.src = toDataUrl(SVG[name]);
    images[name] = img;
  }
  return images[name];
}
