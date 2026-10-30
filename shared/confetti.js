// Lightweight confetti burst for celebratory moments (final-screen winners).
// No dependencies: a full-viewport canvas, requestAnimationFrame physics, and
// a palette matching the Game Night UI. Not gated on mute - confetti is a
// visual celebration, independent of sound - but it IS gated on
// prefers-reduced-motion, since that media feature governs motion.

const PALETTE = ['#ff6363', '#5dd9b3', '#f7ab5c', '#6cc4ff', '#ff9ecd', '#9b7bff', '#fdf3d8'];
const GRAVITY = 420; // px/s^2
const DRAG = 0.0025;

let activeCanvas = null;
let activeRaf = null;
let activeTimeout = null;

function prefersReducedMotion() {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function teardown() {
  if (activeRaf) cancelAnimationFrame(activeRaf);
  if (activeTimeout) clearTimeout(activeTimeout);
  activeRaf = null;
  activeTimeout = null;
  if (activeCanvas && activeCanvas.parentNode) activeCanvas.parentNode.removeChild(activeCanvas);
  activeCanvas = null;
}

function makePiece(originX, originY) {
  const isCircle = Math.random() < 0.35;
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.9);
  const speed = 260 + Math.random() * 340;
  return {
    x: originX,
    y: originY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 10,
    size: 6 + Math.random() * 7,
    color: PALETTE[(Math.random() * PALETTE.length) | 0],
    isCircle,
    life: 0,
  };
}

/**
 * Fire a confetti burst.
 * @param {{durationMs?: number, originRect?: DOMRect|null}} opts
 */
export function fireConfetti({ durationMs = 3500, originRect = null } = {}) {
  if (typeof document === 'undefined') return;
  if (prefersReducedMotion()) return; // no-op: motion opted out

  teardown(); // never stack bursts

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '9999';
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  document.body.appendChild(canvas);
  activeCanvas = canvas;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let originX = w / 2;
  let originY = -20;
  if (originRect) {
    originX = originRect.left + originRect.width / 2;
    originY = originRect.top + originRect.height / 2;
  }

  const burstCount = originRect ? 140 : 180;
  const pieces = [];
  for (let i = 0; i < burstCount; i += 1) {
    pieces.push(makePiece(originX, originY));
  }
  // A second cluster from the opposite side when bursting from the top, for a
  // fuller spread across the viewport.
  if (!originRect) {
    for (let i = 0; i < burstCount; i += 1) {
      pieces.push({ ...makePiece(w * 0.15, originY), vx: makePiece(0, 0).vx });
    }
  }

  let lastTs = null;
  const startTs = performance.now();

  function frame(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    const elapsed = ts - startTs;

    ctx.clearRect(0, 0, w, h);
    let anyVisible = false;
    for (const p of pieces) {
      p.life += dt;
      p.vy += GRAVITY * dt;
      p.vx *= 1 - DRAG;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      if (p.y < h + 40) anyVisible = true;
      const fadeStart = durationMs - 700;
      const alpha = elapsed > fadeStart ? Math.max(0, 1 - (elapsed - fadeStart) / 700) : 1;
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.isCircle) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
      }
      ctx.restore();
    }

    if (elapsed < durationMs && anyVisible) {
      activeRaf = requestAnimationFrame(frame);
    } else {
      teardown();
    }
  }

  activeRaf = requestAnimationFrame(frame);
  // Hard stop as a backstop in case pieces never fully leave the viewport.
  activeTimeout = setTimeout(teardown, durationMs + 200);
}
