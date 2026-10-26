// Flat, outlined side-scroller scenery: sky, parallax skyline, clouds,
// background pillars and the foreground cliffs the barista leaps between.
import { COLORS as C, INK } from './sprites.js';

export const W = 1280;
export const H = 720;
export const DISPLAY_FONT = '"Lilita One", "Arial Rounded MT Bold", sans-serif';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------- repeating parallax layers ----------

const FAR_CITY = { width: 1500, items: [
  { x: 0, w: 120, h: 300 }, { x: 150, w: 90, h: 420, cap: 'step' }, { x: 260, w: 140, h: 250 },
  { x: 430, w: 110, h: 470, cap: 'spire' }, { x: 580, w: 160, h: 330 }, { x: 770, w: 95, h: 390 },
  { x: 900, w: 130, h: 280, cap: 'step' }, { x: 1060, w: 105, h: 450 }, { x: 1200, w: 150, h: 310, cap: 'spire' },
  { x: 1380, w: 100, h: 360 },
] };

const NEAR_CITY = { width: 1700, items: [
  { x: 40, w: 150, h: 360 }, { x: 260, w: 120, h: 470, cap: 'step' }, { x: 470, w: 100, h: 300 },
  { x: 640, w: 140, h: 520, cap: 'spire' }, { x: 860, w: 170, h: 280 }, { x: 1110, w: 110, h: 410 },
  { x: 1300, w: 160, h: 340, cap: 'step' }, { x: 1520, w: 120, h: 460 },
] };

const CLOUDS = { width: 1900, items: [
  { x: 120, y: 380, s: 1.25 }, { x: 760, y: 300, s: 0.8 }, { x: 1250, y: 410, s: 1.5 }, { x: 1650, y: 250, s: 0.65 },
] };

const PILLARS = { width: 1400, items: [
  { x: 60, w: 110, top: 610 }, { x: 330, w: 80, top: 650 }, { x: 560, w: 130, top: 590 },
  { x: 860, w: 90, top: 640 }, { x: 1110, w: 120, top: 605 },
] };

function eachRepeat(layer, offset, view, fn) {
  const pw = layer.width;
  // left edge of the tile that covers view.left; tiles sit at k * pw - offset
  const start = view.left - ((((view.left + offset) % pw) + pw) % pw);
  for (let base = start; base < view.right; base += pw) {
    for (const item of layer.items) fn(item, base + item.x);
  }
}

function drawWindows(ctx, x, w, h, seed, color) {
  const r = mulberry32(seed * 13 + 5);
  const top = H - h;
  const cols = Math.max(2, Math.floor((w - 16) / 22));
  const gap = (w - cols * 10) / (cols + 1);
  ctx.fillStyle = color;
  for (let y = top + 24; y < H - 20; y += 30) {
    for (let c = 0; c < cols; c++) {
      if (r() > 0.28) continue; // most windows stay dark; a few are lit
      roundRect(ctx, x + gap + c * (10 + gap), y, 10, 14, 2);
      ctx.fill();
    }
  }
}

function drawBuilding(ctx, x, w, h, cap, fill, { rounded = false, spires = true, windows = null, seed = 0 } = {}) {
  const top = H - h;
  ctx.fillStyle = fill;
  if (windows) {
    ctx.save();
    drawBuilding(ctx, x, w, h, cap, fill, { rounded, spires, seed });
    drawWindows(ctx, x, w, h, seed, windows);
    ctx.restore();
    return;
  }
  if (rounded) {
    // soft silhouettes: rounded tops, and step tiers that sink into the tier below so only top corners show
    const r = 8;
    roundRect(ctx, x, top, w, h + 1600, r);
    ctx.fill();
    if (cap === 'step') {
      roundRect(ctx, x + w * 0.2, top - 34, w * 0.6, 34 + r, 6);
      ctx.fill();
      roundRect(ctx, x + w * 0.4, top - 60, w * 0.2, 26 + 6, 5);
      ctx.fill();
    }
    if (cap !== 'spire' || !spires) return;
  } else {
    ctx.beginPath();
    ctx.rect(x, top, w, h + 1600);
    ctx.fill();
  }
  if (!rounded && cap === 'step') {
    ctx.fillRect(x + w * 0.2, top - 34, w * 0.6, 36);
    ctx.fillRect(x + w * 0.4, top - 60, w * 0.2, 28);
  } else if (cap === 'spire' && spires) {
    const cx = x + w / 2;
    ctx.fillRect(cx - 12, top - 60, 24, 62);
    ctx.beginPath();
    ctx.moveTo(cx - 30, top - 56);
    ctx.lineTo(cx, top - 92);
    ctx.lineTo(cx + 30, top - 56);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCloud(ctx, x, y, s, fill = C.cloud, shape = null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  if (shape) {
    // custom artwork: ~280 units wide, flat bottom on the same y + 60 baseline as the built-in cloud
    const k = 280 / shape.w;
    ctx.translate(-140, 60 - shape.h * k);
    ctx.scale(k, k);
    ctx.fillStyle = fill;
    ctx.fill(shape.path, 'evenodd');
    ctx.restore();
    return;
  }
  // overlapping puffs sitting on one flat baseline at y = 60
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const [cx, cy, r] of [[-96, 34, 26], [-50, 10, 50], [16, -6, 66], [86, 14, 46], [132, 36, 24]]) {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.rect(-122, 34, 278, 26);
  ctx.fill();
  ctx.restore();
}

/**
 * `omit` hides individual skyline buildings by their pattern x, e.g. { far: [430], near: [260] },
 * so other screens (like the Game Night menu) can clear space behind their headline.
 * `buildings` restyles the skyline: { rounded: true } softens corners, { spires: false } drops the arrow tops.
 * `palette` swaps the backdrop colours (e.g. a night scene); `windowsNear` lights some near-tower windows.
 * `city: false` leaves the skyline towers out entirely (clouds and pillars still draw).
 * `pillars: false` skips the background cliff pillars.
 * `clouds` swaps in custom cloud artwork: [{ path: Path2D, w, h }], used in turn across the cloud slots.
 */
export const DAY_BACKDROP = {
  cityFar: C.cityFar, cityNear: C.cityNear, cloud: C.cloud, windowsNear: null,
  pillar: C.pillar, pillarDark: C.pillarDark, pillarLight: '#c7b8bd', pillarCap: C.pillarCap, pillarEdge: '#7f7279',
};

export function drawBackdrop(ctx, camX, t, view, { omit = {}, buildings = {}, palette = {}, city = true, clouds = null, pillars = true } = {}) {
  const pal = { ...DAY_BACKDROP, ...palette };
  const far = new Set(omit.far);
  const near = new Set(omit.near);
  eachRepeat(FAR_CITY, camX * 0.1, view, (b, x) => {
    if (city && !far.has(b.x)) drawBuilding(ctx, x, b.w, b.h, b.cap, pal.cityFar, buildings);
  });
  eachRepeat(CLOUDS, camX * 0.05 + t * 8, view, (c, x) => {
    const shape = clouds ? clouds[CLOUDS.items.indexOf(c) % clouds.length] : null;
    drawCloud(ctx, x, c.y, c.s, pal.cloud, shape);
  });
  eachRepeat(NEAR_CITY, camX * 0.22, view, (b, x) => {
    if (city && !near.has(b.x)) {
      drawBuilding(ctx, x, b.w, b.h, b.cap, pal.cityNear, { ...buildings, windows: pal.windowsNear, seed: b.x });
    }
  });
  if (pillars) eachRepeat(PILLARS, camX * 0.5, view, (p, x) => drawCliff(ctx, x, p.top, p.w, (p.x * 7) | 0, true, pal));
}

// ---------- foreground pieces ----------

export function drawCliff(ctx, x, top, w, seed, muted = false, pal = DAY_BACKDROP) {
  const r = mulberry32(seed + 11);
  const body = muted ? pal.pillar : C.cliff;
  const dark = muted ? pal.pillarDark : C.cliffDark;
  const light = muted ? pal.pillarLight : C.cliffLight;
  const grass = muted ? pal.pillarCap : C.grass;
  const bottom = top + 1600;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = muted ? pal.pillarEdge : INK;
  ctx.lineWidth = muted ? 3 : 4;

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.rect(x, top, w, bottom - top);
  ctx.fill();
  ctx.stroke();

  // vertical erosion streaks
  ctx.fillStyle = dark;
  let sx = x + 9 + r() * 8;
  while (sx < x + w - 16) {
    const sw = 6 + r() * 9;
    const sy = top + 22 + r() * 46;
    const sh = 90 + r() * 260;
    roundRect(ctx, sx, sy, sw, sh, sw / 2);
    ctx.fill();
    sx += sw + 10 + r() * 20;
  }

  if (!muted) {
    // little outlined bricks
    ctx.lineWidth = 2.5;
    const bricks = w > 120 ? 3 : 2;
    for (let i = 0; i < bricks; i++) {
      const bx = x + 12 + r() * Math.max(4, w - 36);
      const by = top + 60 + r() * 170;
      ctx.fillStyle = light;
      roundRect(ctx, bx, by, 10, 26, 4);
      ctx.fill();
      ctx.stroke();
    }
    // chipped edge on one side
    const side = r() > 0.5;
    const cy = top + 120 + r() * 120;
    const ex = side ? x + w : x;
    const d = side ? 1 : -1;
    ctx.lineWidth = 4;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(ex, cy);
    ctx.lineTo(ex + 10 * d, cy + 14);
    ctx.lineTo(ex + 4 * d, cy + 30);
    ctx.lineTo(ex, cy + 38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // grass cap with scalloped drip edge
  ctx.lineWidth = muted ? 3 : 4;
  ctx.fillStyle = grass;
  const gx = x - 5;
  const gw = w + 10;
  ctx.beginPath();
  ctx.moveTo(gx, top - 7);
  ctx.lineTo(gx + gw, top - 7);
  ctx.lineTo(gx + gw, top + 12);
  const n = Math.max(3, Math.round(gw / 16));
  const seg = gw / n;
  for (let i = n; i > 0; i--) {
    const x1 = gx + seg * i;
    const x0 = gx + seg * (i - 1);
    ctx.quadraticCurveTo((x0 + x1) / 2, top + 22, x0, top + 12);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (!muted) {
    // tufts on the grass line
    ctx.lineWidth = 3;
    const tufts = Math.max(1, Math.floor(w / 70));
    for (let i = 0; i < tufts; i++) {
      const tx = x + 14 + r() * Math.max(4, w - 28);
      ctx.beginPath();
      ctx.moveTo(tx - 6, top - 7);
      ctx.lineTo(tx - 4, top - 15);
      ctx.lineTo(tx, top - 8);
      ctx.lineTo(tx + 3, top - 17);
      ctx.lineTo(tx + 6, top - 7);
      ctx.fillStyle = grass;
      ctx.fill();
      ctx.stroke();
    }
  }
}

export function drawPerfectPatch(ctx, cx, top, half) {
  ctx.fillStyle = C.grassLight;
  roundRect(ctx, cx - half, top - 4, half * 2, 8, 4);
  ctx.fill();
}

export function drawGoalSign(ctx, x, top) {
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.fillStyle = C.cliffDark;
  roundRect(ctx, x - 5, top - 62, 10, 60, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.sign;
  roundRect(ctx, x - 48, top - 102, 96, 44, 7);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = C.cream;
  ctx.lineWidth = 2.5;
  roundRect(ctx, x - 41, top - 95, 82, 30, 4);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `28px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GOAL', x, top - 78);
}

export function drawLabel(ctx, text, x, y, fill, size = 34, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.22;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}
