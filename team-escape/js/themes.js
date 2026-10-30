// Team Escape round scenery, redrawn from the supplied reference sheet (four stacked side-view strips).
// Rounds 1-4 recreate those strips: every tree, building, crate, palm, valve and band below uses the
// positions, sizes and colours measured from the reference, in its pixel coordinates (the strip is 547 px
// wide). The game draws each strip at a fixed 3x scale (no stretching), tiles it sideways and scrolls it a
// little slower than the level for depth. Round 5 is a new strip built the same way with the same palette,
// outline weight and band structure. Scenery is decoration only: it never collides with anything, and the
// theme comes from the level id, so both teams always see the same scenery.
import { GROUND } from './levels.js';

export const S = 3; // world units per reference pixel
const TILE = 547; // reference strip width
const PARALLAX = 0.6; // scenery moves at 60% of the camera speed

// ---------- drawing helpers (reference-pixel coordinates) ----------

function poly(ctx, pts, fill, stroke, lw = 1.3) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function circle(ctx, x, y, r, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

/** A stacked evergreen: three tiers from `top` down to `base`, `w` wide at the bottom tier. */
function tieredTree(ctx, cx, top, base, w, fill, stroke) {
  const h = base - top;
  const tiers = [[0, 0.42, 0.5], [0.27, 0.7, 0.74], [0.52, 1, 1]];
  for (const [t0, t1, wf] of tiers) {
    const y0 = top + h * t0;
    const y1 = top + h * t1;
    const hw = (w / 2) * wf;
    poly(ctx, [cx, y0, cx + hw, y1, cx + hw * 0.45, y1, cx - hw * 0.45, y1, cx - hw, y1], fill, stroke);
  }
}

function cloud(ctx, x0, y0, x1, y1, fill, stroke) {
  const w = x1 - x0;
  const h = y1 - y0;
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.08, y1);
  ctx.arc(x0 + w * 0.22, y1 - h * 0.3, h * 0.3, Math.PI * 0.6, Math.PI * 1.6);
  ctx.arc(x0 + w * 0.48, y0 + h * 0.42, h * 0.42, Math.PI * 1.1, Math.PI * 1.95);
  ctx.arc(x0 + w * 0.76, y1 - h * 0.34, h * 0.32, Math.PI * 1.35, Math.PI * 0.35);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

/** Palm: trunk from the ground to the crown, then drooping fronds. `style` = colours (trunk/leaf/ink). */
function palm(ctx, baseX, baseY, crownX, crownY, spread, style) {
  const { trunk, leaf, ink, rings } = style;
  ctx.lineCap = 'round';
  if (ink) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 8.5;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(baseX + (crownX - baseX) * 0.1, (baseY + crownY) / 2, crownX, crownY);
    ctx.stroke();
  }
  ctx.strokeStyle = trunk;
  ctx.lineWidth = ink ? 6 : 5;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.quadraticCurveTo(baseX + (crownX - baseX) * 0.1, (baseY + crownY) / 2, crownX, crownY);
  ctx.stroke();
  if (rings) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    for (let t = 0.1; t < 0.95; t += 0.15) {
      const x = baseX + (crownX - baseX) * t * t * 0.9 + (crownX - baseX) * 0.1 * t;
      const y = baseY + (crownY - baseY) * t;
      ctx.beginPath();
      ctx.moveTo(x - 3, y + 0.8);
      ctx.lineTo(x + 3, y - 0.8);
      ctx.stroke();
    }
  }
  // fronds: two up-swept, four drooping, each with a notched tip
  for (const a of [-2.75, -2.25, -1.75, -1.25, -0.75, -0.3]) {
    const len = spread * (a < -2.4 || a > -0.5 ? 0.85 : 1);
    const droop = Math.abs(a + 1.5) * spread * 0.38;
    const ex = crownX + Math.cos(a) * len;
    const ey = crownY + Math.sin(a) * len * 0.55 + droop;
    const nx = -Math.sin(a) * spread * 0.32; // broad leaves, like the reference
    const ny = Math.cos(a) * spread * 0.22;
    ctx.beginPath();
    ctx.moveTo(crownX, crownY);
    ctx.quadraticCurveTo((crownX + ex) / 2 + nx, (crownY + ey) / 2 - Math.abs(ny) - 3, ex, ey);
    ctx.lineTo(ex - (ex - crownX) * 0.12, ey + 2.5);
    ctx.lineTo(ex - (ex - crownX) * 0.2, ey + 0.5);
    ctx.quadraticCurveTo((crownX + ex) / 2 - nx * 0.15, (crownY + ey) / 2 + spread * 0.18, crownX, crownY + 1);
    ctx.closePath();
    ctx.fillStyle = leaf;
    ctx.fill();
    if (ink) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
}

function crystal(ctx, x, base, h, w, fill, light, ink) {
  poly(ctx, [x - w, base, x - w * 0.85, base - h * 0.72, x, base - h, x + w * 0.85, base - h * 0.72, x + w, base], fill, ink, 1.3);
  poly(ctx, [x, base - h, x + w * 0.85, base - h * 0.72, x + w * 0.35, base, x, base], light);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x, base - h);
  ctx.lineTo(x, base);
  ctx.stroke();
}

// ---------- the five strips (all coordinates are reference pixels) ----------

const FOREST = {
  sky: '#e3e3e3',
  horizon: 100,
  // light teal back trees (peak x, peak y), dark teal mid trees, green decorated front trees
  light: [[17, 50], [51, 68], [87, 60], [99, 68], [115, 55], [131, 68], [153, 63], [170, 58], [224, 68], [244, 49],
    [263, 49], [291, 60], [330, 42], [353, 54], [408, 54], [453, 55], [485, 49], [493, 76], [530, 30]],
  dark: [[71, 33], [112, 28], [146, 45], [166, 82], [203, 33], [269, 46], [314, 33], [422, 47], [470, 25], [532, 47]],
  green: [[30, 44, 40], [79, 44, 27], [186, 28, 30], [381, 12, 44], [438, 42, 24], [507, 28, 34]],
  ornaments: [[26.5, 61.5, 3.5], [35.5, 83.5, 3.5], [45, 59.5, 2], [181.5, 66, 2.5], [193.5, 86.5, 4], [199.5, 64, 2.5],
    [169, 84.5, 2], [374, 29.5, 1.5], [380.5, 54.5, 2.5], [395.5, 53.5, 2.5], [374, 81, 5], [514, 43.5, 2.5],
    [501.5, 48.5, 2], [492.5, 65, 2.5], [516.5, 65, 3], [510, 84.5, 3.5], [78, 89.5, 1.5], [446, 90, 1.5]],
  clouds: [[93, 4, 133, 29], [321, 9, 348, 24]],
  draw(ctx) {
    for (const [x, y] of this.light) tieredTree(ctx, x, y, 98, (98 - y) * 0.62, '#6cbac1');
    for (const [x, y] of this.dark) tieredTree(ctx, x, y, 99, (99 - y) * 0.58, '#2b6961');
    for (const [x0, y0, x1, y1] of this.clouds) cloud(ctx, x0, y0, x1, y1, '#fdfefd', '#39736f');
    for (const [cx, top, w] of this.green) {
      poly(ctx, [cx - 2.5, 92, cx + 2.5, 92, cx + 2.5, 99.5, cx - 2.5, 99.5], '#b36b42', '#14302c', 1.1);
      tieredTree(ctx, cx, top, 94, w, '#5e9446', '#14302c');
    }
    for (const [x, y, r] of this.ornaments) circle(ctx, x, y, r, '#fdfefd', '#14302c', 0.9);
  },
  // ground layers under the horizon, top to bottom: [height px, colour]
  bands: [[2, '#0d3534'], [1, '#9eafad'], [1, '#fdfefd'], [1, '#91c4b5'], [3, '#72baa2'], [2, '#0d3534'],
    [7, '#2b6961'], [1, '#4e9390'], [15, '#6cbac1']],
  edge: '#0d3534',
};

const BELOW = 240 + 90; // buildings continue below the ground line, into pits and past cliff edges
const CITY = {
  sky: '#d8dfc6',
  horizon: 240,
  lightBlocks: [[17, 30, 158], [30, 70, 171], [150, 164, 220], [164, 179, 202], [208, 222, 182], [222, 236, 165],
    [236, 262, 182], [262, 276, 150], [314, 328, 227], [375, 389, 171], [406, 418, 196], [418, 432, 158],
    [432, 447, 181], [447, 465, 196], [465, 479, 182], [479, 487, 196]],
  darkBlocks: [[32, 54, 216], [240, 263, 196], [263, 286, 217], [345, 368, 217], [451, 474, 217]],
  draw(ctx) {
    for (const [x0, x1, top] of this.lightBlocks) poly(ctx, [x0, top, x1, top, x1, BELOW, x0, BELOW], '#a4a998');
    for (const [x0, x1, top] of this.darkBlocks) poly(ctx, [x0, top, x1, top, x1, BELOW, x0, BELOW], '#45473f');
  },
  bands: [[1, '#4f5154']], // one flat asphalt-grey floor
  edge: '#141413',
  below: 90, // let the skyline show through gaps in the ground
};

const BIG_PALM = { trunk: '#c18a60', leaf: '#a8b424', ink: '#00393d', rings: true };
const TROPICAL = {
  sky: '#dcdfde',
  horizon: 372,
  draw(ctx) {
    // light blue small palms, dark teal palms, then the three big coloured palms in front
    for (const [x, top] of [[17, 341], [164, 346], [374, 343], [523, 337]]) {
      palm(ctx, x + 1, 372, x - 1, top + 6, 15, { trunk: '#609cb4', leaf: '#609cb4' });
    }
    for (const [x, top, s] of [[111, 315, 26], [205, 324, 20], [325, 315, 26], [473, 312, 26]]) {
      palm(ctx, x + 4, 372, x - 3, top + 8, s, { trunk: '#004854', leaf: '#004854' });
    }
    palm(ctx, 52, 371, 62, 320, 34, BIG_PALM);
    palm(ctx, 295, 371, 277, 334, 28, BIG_PALM);
    palm(ctx, 428, 371, 421, 323, 34, BIG_PALM);
  },
  bands: [[2, '#41211a'], [1, '#e0d5d1'], [1, '#f8f7f6'], [2, '#d7a78b'], [1, '#c19881'], [2, '#40231c'], [7, '#573932'],
    [1, '#a87c56'], [8, '#c18a61'], [2, '#00363e'], [3, '#6cbac1'], [2, '#6cbac1'], [7, '#6cbac1'], [1, '#549e93'],
    [7, '#398461'], [9, '#1b3528']],
  // white dashes on the water band (x0, x1), drawn by the ground renderer
  dashes: [[63, 94], [173, 241], [396, 416]],
  dashY: 33, // pixels below the horizon
  edge: '#41211a',
};

const MECHANICAL = {
  sky: '#55704b',
  horizon: 506,
  // background wall bands above the floor (y from, colour), patches, and valves
  wall: [[429, '#55704c'], [433, '#e3e9e0'], [435, '#2a292a'], [437, '#55704b'], [446, '#79a16c'], [455, '#8fbf81'],
    [492, '#79a16c'], [498, '#55704b'], [506, null]],
  patches: [[311, 457, 320, 462], [371, 457, 380, 462], [66, 459, 74, 463], [79, 459, 87, 463], [189, 459, 198, 463],
    [500, 460, 509, 463], [448, 461, 451, 464], [21, 462, 24, 465], [203, 463, 211, 467], [339, 463, 346, 467],
    [138, 454, 143, 460], [203, 479, 212, 484], [338, 479, 346, 484], [522, 479, 528, 484], [40, 481, 49, 487],
    [98, 482, 107, 487], [351, 483, 359, 487], [462, 483, 471, 487], [169, 484, 178, 489], [229, 484, 238, 489],
    [477, 484, 483, 488], [505, 492, 513, 496], [50, 493, 55, 497], [83, 474, 91, 479], [302, 474, 311, 479],
    [524, 474, 532, 479], [27, 480, 35, 485], [246, 480, 255, 485], [467, 480, 476, 485]],
  valves: [60, 280, 501],
  draw(ctx) {
    for (let i = 0; i < this.wall.length - 1; i++) {
      const [y0, colour] = this.wall[i];
      const y1 = this.wall[i + 1][0];
      poly(ctx, [0, y0, TILE, y0, TILE, y1, 0, y1], colour);
    }
    for (const [x0, y0, x1, y1] of this.patches) poly(ctx, [x0, y0, x1, y0, x1, y1, x0, y1], '#79a16c');
    for (const x of this.valves) {
      circle(ctx, x, 476, 12.5, '#668a5e');
      poly(ctx, [x - 1.6, 482, x + 1.6, 482, x + 1.6, 520, x - 1.6, 520], '#5cb0c0', '#17594c', 0.9);
      circle(ctx, x, 476, 7.5, '#353b3a', '#1d2420', 1.4);
      circle(ctx, x, 476, 4.5, '#4a5150');
    }
  },
  bands: [[2, '#272727'], [1, '#9c9c9c'], [2, '#fbfbfb'], [3, '#c5c5c5'], [2, '#282b28'], [7, '#1b362a'], [15, '#388263'],
    [3, '#003240'], [6, '#6cbac1']],
  // pipes continuing through the floor bands
  floorPipes: [60, 142, 280, 375, 501],
  edge: '#272727',
};

// Round 5 - an original strip in the same style: crystal cavern
const CRYSTAL = {
  sky: '#d9dce1',
  horizon: 100,
  rocks: [[0, 40, 46], [40, 92, 30], [92, 150, 52], [150, 196, 38], [196, 262, 22], [262, 318, 44], [318, 370, 28],
    [370, 430, 50], [430, 488, 34], [488, 547, 42]],
  stalactites: [[24, 18], [58, 30], [131, 22], [172, 34], [228, 16], [290, 28], [347, 20], [402, 32], [459, 24], [517, 30]],
  back: [[45, 60, 10], [110, 66, 9], [208, 58, 11], [262, 70, 8], [335, 62, 10], [425, 56, 11], [480, 68, 8], [530, 60, 9]],
  front: [[30, 48, 13, true], [150, 40, 15, false], [228, 54, 11, true], [372, 34, 16, false], [455, 46, 12, true], [512, 38, 14, false]],
  sparkles: [[22, 52, 2.2], [36, 70, 1.5], [146, 46, 2.5], [158, 74, 1.6], [232, 58, 2], [368, 42, 2.8], [380, 70, 1.8],
    [460, 52, 2], [508, 46, 2.4], [519, 72, 1.5]],
  draw(ctx) {
    // ceiling, rock shelves, stalactites (stepped like the city skyline, flat like the forest's back trees)
    poly(ctx, [0, 0, TILE, 0, TILE, 8, 0, 8], '#57627a');
    for (const [x0, x1, top] of this.rocks) poly(ctx, [x0, 98, x0 + 6, top + 8, (x0 + x1) / 2, top, x1 - 6, top + 10, x1, 98], '#aab3bf');
    for (const [x, len] of this.stalactites) poly(ctx, [x - 8, 7, x + 8, 7, x, 7 + len], '#7d8a9e', '#14302c', 1.1);
    for (const [x, top, w] of this.back) crystal(ctx, x, 98, 98 - top, w, '#609cb4', '#9cc3d6', '#14302c');
    for (const [x, top, w, teal] of this.front) {
      crystal(ctx, x - w * 0.9, 98, (98 - top) * 0.55, w * 0.55, teal ? '#6cbac1' : '#8f86b8', teal ? '#bfe6e8' : '#c3bde0', '#14302c');
      crystal(ctx, x, 98, 98 - top, w, teal ? '#6cbac1' : '#8f86b8', teal ? '#bfe6e8' : '#c3bde0', '#14302c');
      crystal(ctx, x + w * 0.85, 98, (98 - top) * 0.4, w * 0.5, teal ? '#2b6961' : '#5e5687', teal ? '#4e9390' : '#8f86b8', '#14302c');
    }
    for (const [x, y, r] of this.sparkles) {
      poly(ctx, [x, y - r * 2, x + r * 0.6, y, x, y + r * 2, x - r * 0.6, y], '#fdfefd', '#14302c', 0.8);
    }
  },
  bands: [[2, '#14302c'], [1, '#9eafad'], [1, '#fdfefd'], [2, '#8fd3cf'], [2, '#14302c'], [7, '#573932'], [1, '#a87c56'],
    [9, '#7d8a9e'], [2, '#14302c'], [14, '#57627a']],
  edge: '#14302c',
};

// ---------- theme objects used by the renderer ----------

function makeTheme(name, strip, hazard) {
  return {
    name,
    strip,
    hazard,
    sky(ctx, v) {
      ctx.fillStyle = strip.sky;
      ctx.fillRect(0, 0, v.cssW, v.cssH);
    },
    /** Draw the strip behind the level: tiled, at 3x, its horizon on the ground line. */
    back(ctx, v) {
      const off = v.camX * (1 - PARALLAX);
      const span = TILE * S;
      const first = Math.floor((v.camX - off) / span) - 1;
      const last = Math.ceil((v.camX + v.viewW - off) / span) + 1;
      for (let i = first; i <= last; i++) {
        ctx.save();
        ctx.translate(i * span + off, GROUND - strip.horizon * S);
        ctx.scale(S, S);
        ctx.beginPath();
        ctx.rect(0, -400, TILE + 0.5, strip.horizon + 400 + (strip.below ?? 0));
        ctx.clip();
        strip.draw(ctx);
        ctx.restore();
      }
    },
  };
}

export const THEMES = {
  forest: makeTheme('Forest', FOREST, { style: 'bramble', fill: '#8a4f6d', pit: '#2b6961' }),
  city: makeTheme('Industrial City', CITY, { style: 'spikes', fill: '#c5c5c5', pit: null }),
  tropical: makeTheme('Tropical', TROPICAL, { style: 'water', fill: '#6cbac1', pit: '#1b3528' }),
  mechanical: makeTheme('Mechanical Industrial', MECHANICAL, { style: 'acid', fill: '#b6e05a', pit: '#1b362a' }),
  crystal: makeTheme('Crystal Cavern', CRYSTAL, { style: 'crystals', fill: '#8fd3cf', pit: '#57627a' }),
};

// every round currently uses the industrial city scenery (the other strips are kept for later)
const BY_LEVEL = {};

export const themeFor = (levelId) => THEMES[BY_LEVEL[levelId] ?? 'city'];

/** Paint a level solid with its strip's ground layers (the reference's horizontal bands). */
export function paintGround(ctx, theme, s, bottom) {
  const strip = theme.strip;
  let y = s.y;
  let last = strip.bands[0][1];
  for (const [h, colour] of strip.bands) {
    if (y >= bottom) break;
    ctx.fillStyle = colour;
    ctx.fillRect(s.x, y, s.w, Math.min(h * S, bottom - y) + 0.5);
    y += h * S;
    last = colour;
  }
  if (y < bottom) {
    ctx.fillStyle = last;
    ctx.fillRect(s.x, y, s.w, bottom - y);
  }
  // details that belong to the ground bands, locked to the world so they line up across platforms
  const tile = TILE * S;
  if (strip.dashes) {
    ctx.fillStyle = '#fafbf5';
    const dy = s.y + strip.dashY * S;
    if (dy < bottom) {
      for (let t = Math.floor(s.x / tile) * tile; t < s.x + s.w; t += tile) {
        for (const [x0, x1] of strip.dashes) {
          const a = Math.max(s.x, t + x0 * S);
          const b = Math.min(s.x + s.w, t + x1 * S);
          if (b > a) ctx.fillRect(a, dy, b - a, 4);
        }
      }
    }
  }
  if (strip.floorPipes) {
    const y0 = s.y + 9 * S;
    const y1 = Math.min(bottom, s.y + 31 * S);
    if (y1 > y0) {
      for (let t = Math.floor(s.x / tile) * tile; t < s.x + s.w; t += tile) {
        for (const px of strip.floorPipes) {
          const x = t + px * S;
          if (x < s.x + 6 || x > s.x + s.w - 6) continue;
          ctx.fillStyle = '#17594c';
          ctx.fillRect(x - 6, y0, 12, y1 - y0);
          ctx.fillStyle = '#5cb0c0';
          ctx.fillRect(x - 3.5, y0, 7, y1 - y0);
        }
      }
    }
  }
}

/** Kept for the renderer's API; the reference scenery has no ambient particles. */
export function drawParticles() {}
