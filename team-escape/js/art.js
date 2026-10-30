// Team Escape illustrations: Sprout characters, team emblems and the ruin scenes, in Brew Leap's flat
// outlined style (thick ink strokes, rounded joins, a few warm accents) but set in a night-time forest ruin.
// Players use the character art from character.js once it has loaded; sprout() is the fallback.
import { characterUrl, CHARACTER_ASPECT } from './character.js';
export const INK = '#08121d';
export const TEAM_COLORS = ['#5dd9b3', '#ff8a5c'];
export const TEAM_SHADES = ['#33a487', '#d8613a'];
export const PALETTE = {
  stone: '#7d8aa6', stoneDark: '#5d6987', stoneLight: '#a3aec6',
  moss: '#3d9381', mossLight: '#63c9b1',
  wood: '#c27a42', woodDark: '#8f5530',
  gold: '#ffd166', goldDark: '#e0a526',
  bramble: '#9b4f7a', lantern: '#ffb85c',
  skyTop: '#13233a', skyLow: '#1f3a5c',
};

const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

/** A Sprout: a round bean-shaped explorer with a leaf on top. */
export function sprout(color, { shade = color, flip = false, eyes = 'open', extra = '' } = {}) {
  const look = eyes === 'happy'
    ? `<path d="M23 31 q3 -4 6 0 M35 31 q3 -4 6 0" fill="none" ${S} stroke-width="3"/>`
    : `<circle cx="27" cy="31" r="4.6" fill="#fff" ${S} stroke-width="2.5"/><circle cx="39" cy="31" r="4.6" fill="#fff" ${S} stroke-width="2.5"/>
       <circle cx="28.5" cy="31.5" r="2" fill="${INK}"/><circle cx="40.5" cy="31.5" r="2" fill="${INK}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 72"${flip ? ' style="transform:scaleX(-1)"' : ''}>
    <path d="M32 18 Q30 8 22 5 Q30 3 35 9 Q38 3 46 4 Q40 9 34 18" fill="#63c9b1" ${S} stroke-width="3"/>
    <rect x="10" y="16" width="44" height="46" rx="20" fill="${color}" ${S} stroke-width="4"/>
    <path d="M14 46 Q32 58 50 46 V48 Q50 60 32 60 Q14 60 14 48 Z" fill="${shade}" opacity=".55"/>
    ${look}
    <path d="M29 41 Q33 44 37 41" fill="none" ${S} stroke-width="2.6"/>
    <circle cx="21" cy="39" r="2.8" fill="#ff9f8a" opacity=".7"/><circle cx="45" cy="39" r="2.8" fill="#ff9f8a" opacity=".7"/>
    <rect x="16" y="60" width="12" height="9" rx="4" fill="${INK}"/><rect x="36" y="60" width="12" height="9" rx="4" fill="${INK}"/>
    ${extra}
  </svg>`;
}

/** Team 1: a moss leaf on a round badge. Team 2: an ember flame. */
export const EMBLEMS = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="21" fill="${TEAM_COLORS[0]}" ${S} stroke-width="3.5"/>
    <path d="M14 33 Q12 16 33 12 Q36 30 18 34 Z" fill="#fff6e8" ${S} stroke-width="3"/>
    <path d="M15 33 Q22 25 29 17" fill="none" ${S} stroke-width="2.6"/>
  </svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="21" fill="${TEAM_COLORS[1]}" ${S} stroke-width="3.5"/>
    <path d="M24 10 Q34 20 32 29 Q31 37 24 37 Q16 37 16 29 Q16 23 21 19 Q21 25 24 26 Q22 18 24 10 Z" fill="#fff6e8" ${S} stroke-width="3"/>
  </svg>`,
];

export const KEY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24">
  <g ${S} stroke-width="3"><circle cx="11" cy="12" r="8" fill="${PALETTE.gold}"/><circle cx="11" cy="12" r="3" fill="#1f3452"/>
  <path d="M19 9 H44 V15 H40 V20 H35 V15 H19 Z" fill="${PALETTE.gold}"/></g></svg>`;

const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;

/** Ruin scene used by the landing hero (wide) and the hub card (compact). */
function scene({ w, h, compact }) {
  const g = h - (compact ? 34 : 70); // ground line
  const door = { x: w - (compact ? 92 : 190), w: compact ? 54 : 104, h: compact ? 72 : 140 };
  const ledge = { x: compact ? 104 : 250, w: compact ? 74 : 150, h: compact ? 46 : 92 };
  const sz = compact ? 34 : 70;
  const sp = (color, shade, x, y, opts = {}) => {
    const art = characterUrl(color === TEAM_COLORS[1] ? 1 : 0);
    if (!art) return `<image href="${dataUrl(sprout(color, { shade, ...opts }))}" x="${x}" y="${y}" width="${sz}" height="${sz * 1.125}"/>`;
    // same footprint as the sprout: centred, feet on the same line
    const w = sz * 1.35;
    const h = w / CHARACTER_ASPECT;
    return `<image href="${art}" x="${x + sz / 2 - w / 2}" y="${y + sz * 1.125 - h}" width="${w}" height="${h}"/>`;
  };
  const a = TEAM_COLORS[0];
  const b = TEAM_SHADES[0];
  const stars = Array.from({ length: compact ? 9 : 18 }, (_, i) => {
    const x = (i * 97 + 31) % w;
    const y = (i * 53 + 17) % (g - (compact ? 90 : 190));
    return `<circle cx="${x}" cy="${y + 10}" r="${1 + (i % 3) * 0.5}" fill="#fdf3d8" opacity="${0.4 + (i % 4) * 0.15}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMax slice">
    <rect width="${w}" height="${h}" fill="#1b3050"/>
    ${stars}
    <circle cx="${w * 0.18}" cy="${compact ? 34 : 70}" r="${compact ? 14 : 30}" fill="#fdf3d8" opacity=".9"/>
    <g fill="#24426a">
      <path d="M0 ${g} V${g - h * 0.32} l${w * 0.05} -${h * 0.08} l${w * 0.05} ${h * 0.08} V${g} Z"/>
      <rect x="${w * 0.36}" y="${g - h * 0.5}" width="${w * 0.06}" height="${h * 0.5}"/>
      <rect x="${w * 0.34}" y="${g - h * 0.53}" width="${w * 0.1}" height="${h * 0.04}"/>
      <path d="M${w * 0.55} ${g} V${g - h * 0.38} a${w * 0.08} ${w * 0.08} 0 0 1 ${w * 0.16} 0 V${g} h-${w * 0.04} V${g - h * 0.36} a${w * 0.04} ${w * 0.04} 0 0 0 -${w * 0.08} 0 V${g} Z"/>
    </g>
    <g fill="#1d3656"><circle cx="${w * 0.08}" cy="${g - 10}" r="${h * 0.14}"/><circle cx="${w * 0.9}" cy="${g - 6}" r="${h * 0.16}"/><circle cx="${w * 0.47}" cy="${g}" r="${h * 0.1}"/></g>
    <g ${S} stroke-width="${compact ? 3 : 4}">
      <rect x="-10" y="${g}" width="${w + 20}" height="${h}" fill="${PALETTE.stone}"/>
      <rect x="-10" y="${g - 6}" width="${w + 20}" height="${compact ? 12 : 16}" rx="6" fill="${PALETTE.moss}"/>
      <rect x="${ledge.x}" y="${g - ledge.h}" width="${ledge.w}" height="${ledge.h}" fill="${PALETTE.stone}"/>
      <rect x="${ledge.x - 4}" y="${g - ledge.h - 6}" width="${ledge.w + 8}" height="${compact ? 11 : 15}" rx="5" fill="${PALETTE.moss}"/>
      <path d="M${door.x - 10} ${g} V${g - door.h + door.w / 2} a${door.w / 2 + 10} ${door.w / 2 + 10} 0 0 1 ${door.w + 20} 0 V${g} Z" fill="${PALETTE.stoneDark}"/>
      <path d="M${door.x} ${g} V${g - door.h + door.w / 2} a${door.w / 2} ${door.w / 2} 0 0 1 ${door.w} 0 V${g} Z" fill="${PALETTE.wood}"/>
      <rect x="${door.x + door.w / 2 - (compact ? 7 : 13)}" y="${g - door.h * 0.48}" width="${compact ? 14 : 26}" height="${compact ? 14 : 26}" rx="4" fill="${PALETTE.gold}"/>
      <rect x="${(compact ? 40 : 80)}" y="${g - 4}" width="${compact ? 46 : 92}" height="${compact ? 8 : 12}" rx="3" fill="${PALETTE.lantern}"/>
    </g>
    <path d="M${door.x + door.w / 2} ${g - door.h * 0.46} v${compact ? 8 : 14}" stroke="${INK}" stroke-width="${compact ? 3 : 4}" stroke-linecap="round"/>
    <g opacity=".8" fill="${PALETTE.wood}" stroke="${INK}" stroke-width="2"><path d="M${door.x + 6} ${g - door.h * 0.3} h${door.w - 12}" /><path d="M${door.x + 6} ${g - door.h * 0.15} h${door.w - 12}"/></g>
    ${sp(a, b, ledge.x - sz * 0.95, g - sz * 1.1)}
    ${sp(a, b, ledge.x - sz * 0.95, g - sz * 2.05, { eyes: 'happy' })}
    ${sp(TEAM_COLORS[1], TEAM_SHADES[1], (compact ? 30 : 60), g - sz * 1.1)}
    ${sp(a, b, ledge.x + ledge.w * 0.3, g - ledge.h - sz * 1.1)}
    <g transform="translate(${ledge.x + ledge.w * 0.3 + sz * 0.55} ${g - ledge.h - sz * 1.45}) rotate(-18)">
      <image href="${dataUrl(KEY_SVG)}" x="0" y="0" width="${compact ? 34 : 68}" height="${compact ? 17 : 34}"/>
    </g>
    <g fill="${PALETTE.gold}">${[0.3, 0.62, 0.8].map((f, i) => `<circle class="firefly" style="--d:${i * 0.7}s" cx="${w * f}" cy="${g - h * (0.25 + i * 0.07)}" r="${compact ? 2 : 3.5}"/>`).join('')}</g>
  </svg>`;
}

export const heroScene = () => scene({ w: 720, h: 520, compact: false });
export const cardScene = () => scene({ w: 320, h: 200, compact: true });
export const sproutUrl = (team, opts) => characterUrl(team) ?? dataUrl(sprout(TEAM_COLORS[team], { shade: TEAM_SHADES[team], ...opts }));
