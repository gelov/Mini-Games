// Game Night night sky, shared by the menu and the game pages.
import { W, H, drawBackdrop, mulberry32 } from '../brew-leap/js/scene.js';


// the three tall capped towers that sat behind the title: far spire, near stepped tower, near spire
const SKYLINE_OMIT = { far: [430], near: [260, 640] };

// custom cloud artwork (from the design files), filled with the night cloud colour
const CLOUD_SHAPES = [
  { w: 96, h: 46.27, d: 'M10.78,24.77h2.35c.47-6.62,6.23-11.83,13.27-11.83.72,0,1.41.06,2.08.17C31.17,5.49,38.81,0,47.85,0c7.04,0,13.24,3.35,16.9,8.45,1.27-.3,2.58-.44,3.93-.44,9.09,0,16.43,6.82,16.43,15.21,0,.53-.03,1.03-.08,1.55h.22c5.9,0,10.75,4.82,10.75,10.75h0c0,5.9-4.85,10.75-10.75,10.75H10.78c-5.93,0-10.78-4.85-10.78-10.75h0c0-5.93,4.85-10.75,10.78-10.75h0Z' },
  { w: 127.27, h: 45.57, d: 'M7.87,29.78h14.41c.36-5.79,5.18-10.39,11.08-10.39,2.05,0,3.96.55,5.62,1.5,1.77-6.32,7.59-10.94,14.49-10.94,1.94,0,3.8.36,5.51,1.03,3.41-6.51,10.22-10.97,18.09-10.97,9.75,0,17.92,6.87,19.95,16.04,6.26,1,11.03,6.4,11.03,12.94,0,.28,0,.55-.03.8h11.36c4.35,0,7.9,3.55,7.9,7.9h0c0,4.35-3.55,7.9-7.9,7.9H7.87c-4.32,0-7.87-3.55-7.87-7.9h0c0-4.35,3.55-7.9,7.87-7.9h0Z' },
  { w: 109.71, h: 62.5, d: 'M97.16,29.62c.61-.11,1.22-.17,1.86-.17,5.9,0,10.69,4.68,10.69,10.47s-4.79,10.47-10.69,10.47c-1.25,0-2.44-.22-3.55-.58-3.21,4.57-8.59,7.56-14.66,7.56-3.08,0-5.96-.75-8.45-2.11-4.07,4.46-9.86,7.23-16.32,7.23-5.18,0-9.95-1.8-13.74-4.82-1.83.66-3.82,1-5.9,1-5.24,0-9.95-2.24-13.3-5.85-2.22,1.16-4.79,1.83-7.51,1.83-8.62,0-15.6-6.59-15.6-14.74s6.98-14.71,15.6-14.71c.64,0,1.25.03,1.88.08,2.08-6.7,8.34-11.55,15.74-11.55h.47C37.04,5.68,44.99,0,54.25,0c10.14,0,18.7,6.79,21.39,16.07,1.72-.64,3.55-.97,5.49-.97,8.37,0,15.24,6.37,16.04,14.52h0Z' },
].map((c) => ({ ...c, path: new Path2D(c.d) }));

// Game Night is literally at night: dark-mode palette for the shared skyline
const NIGHT = {
  sky: '#13233a',
  cityFar: '#1b3050',
  cityNear: '#233f60',
  cloud: '#22395a',
  windowsNear: '#f5c46a',
  pillar: '#3a3550',
  pillarDark: '#2e2a42',
  pillarLight: '#4a4462',
  pillarCap: '#2d5a62',
  pillarEdge: '#151225',
};

// star field in viewport fractions: many small twinkling dots plus a handful of big shining sparkles
const STARS = (() => {
  const r = mulberry32(2024);
  return Array.from({ length: 110 }, () => ({
    x: r(), y: r() * 0.7, size: 0.6 + r() * 1.0, phase: r() * Math.PI * 2, speed: 0.8 + r() * 2.2,
  }));
})();
const SHINERS = (() => {
  const r = mulberry32(77);
  return Array.from({ length: 14 }, () => ({
    x: 0.03 + r() * 0.94, y: 0.04 + r() * 0.6, size: 2.5 + r() * 2.5, phase: r() * Math.PI * 2, speed: 1.2 + r() * 1.8,
  }));
})();

function sparkle(ctx, x, y, k) {
  // four-point star with concave sides
  const w = k * 0.22;
  ctx.beginPath();
  ctx.moveTo(x, y - k);
  ctx.quadraticCurveTo(x + w, y - w, x + k, y);
  ctx.quadraticCurveTo(x + w, y + w, x, y + k);
  ctx.quadraticCurveTo(x - w, y + w, x - k, y);
  ctx.quadraticCurveTo(x - w, y - w, x, y - k);
  ctx.fill();
}

function drawSky(ctx, v, t) {
  ctx.fillStyle = NIGHT.sky;
  ctx.fillRect(0, 0, v.cssW, v.cssH);

  ctx.fillStyle = '#fdf3d8';
  for (const st of STARS) {
    const tw = 0.5 + 0.5 * Math.sin(t * st.speed + st.phase);
    ctx.globalAlpha = 0.2 + 0.8 * tw * tw;
    ctx.beginPath();
    ctx.arc(st.x * v.cssW, st.y * v.cssH, st.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // shining stars: pulse in size and brightness, with a soft glow and a thin flare at their peak
  ctx.save();
  ctx.shadowColor = 'rgba(255, 228, 160, 0.95)';
  for (const st of SHINERS) {
    const x = st.x * v.cssW;
    const y = st.y * v.cssH;
    const tw = 0.5 + 0.5 * Math.sin(t * st.speed + st.phase);
    const k = st.size * (0.75 + 0.35 * tw);
    ctx.globalAlpha = 0.5 + 0.45 * tw;
    ctx.shadowBlur = 3 + 5 * tw;
    ctx.fillStyle = '#fff6dc';
    sparkle(ctx, x, y, k);
    if (tw > 0.8) {
      ctx.globalAlpha = (tw - 0.8) * 2.5;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - k * 1.7, y - 0.5, k * 3.4, 1);
      ctx.fillRect(x - 0.5, y - k * 1.7, 1, k * 3.4);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // flat outlined moon, top right
  const mr = Math.max(26, Math.min(v.cssW, v.cssH) * 0.055);
  const mx = v.cssW * 0.9;
  const my = v.cssH * 0.19;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#08121d';
  ctx.fillStyle = '#fff1cf';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f1dcaa';
  for (const [dx, dy, rr] of [[-0.32, -0.2, 0.2], [0.28, 0.12, 0.26], [-0.1, 0.42, 0.13]]) {
    ctx.beginPath();
    ctx.arc(mx + dx * mr, my + dy * mr, rr * mr, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draws the Game Night sky (stars, moon, custom clouds, optional pillars) on a fixed full-viewport canvas.
 * `pillars: false` leaves out the background cliff pillars for pages without the ground strip.
 */
export function mountNightSky(canvas, { pillars = true } = {}) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let view = null;
  let t = 0;
  let last = performance.now();

  function resize() {
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // fill the viewport, anchored to the bottom so the towers rise from the ground strip
    const s = Math.max(cssW / W, cssH / H);
    const ox = (cssW - W * s) / 2;
    const oy = cssH - H * s;
    view = { s, ox, oy, dpr, cssW, cssH, left: -ox / s, right: (cssW - ox) / s };
    draw();
  }

  function draw() {
    const v = view;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    drawSky(ctx, v, t);
    ctx.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
    drawBackdrop(ctx, 0, t, v, {
      omit: SKYLINE_OMIT,
      buildings: { rounded: true, spires: false },
      palette: NIGHT,
      city: false,
      clouds: CLOUD_SHAPES,
      pillars,
    });
  }

  function frame(now) {
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) draw();
    requestAnimationFrame(frame);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  if (!still) requestAnimationFrame(frame);
}
