// Brew Leap engine: hold to charge, release to leap, land on the next cliff.
// One class drives both the playable game and the self-playing hero scene.
import { COLORS as C, INK, sprite } from './sprites.js';
import {
  W, H, drawBackdrop, drawCliff, drawGoalSign, drawLabel, drawPerfectPatch, roundRect,
} from './scene.js';

export const GRAVITY = 2600;
export const CHARGE_TIME = 1.0; // seconds for the meter to fill; it then drains (ping-pong)
export const MAX_HEARTS = 3;
export const GOAL_EVERY = 5;
export const PERFECT_HALF = 14;
const STAND_OFFSET = 34; // where the barista waits, measured back from a cliff's right edge
const WALK_SPEED = 280;
const PLAYER_SCREEN_RATIO = 0.3;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function launchVelocity(power) {
  return { vx: 180 + power * 620, vy: -(700 + power * 350) };
}

export function powerAt(seconds) {
  const k = (seconds / CHARGE_TIME) % 2;
  return k <= 1 ? k : 2 - k;
}

/** Horizontal distance travelled before falling back to a surface `rise` px above the start (negative = below). */
export function landingDistance(power, rise = 0) {
  const { vx, vy } = launchVelocity(power);
  const disc = vy * vy - 2 * GRAVITY * rise;
  if (disc < 0) return null;
  const t = (-vy + Math.sqrt(disc)) / GRAVITY;
  return vx * t;
}

export class Game {
  constructor(canvas, { mode = 'play', fit = 'contain', zoom = 1, on = {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = mode;
    this.fit = fit;
    this.zoom = zoom;
    this.on = on;
    this.running = false;
    this.paused = false;
    this.held = false;
    this.t = 0;
    this.view = { s: 1, ox: 0, oy: 0, left: 0, right: W };
    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
    this.reset();
    new ResizeObserver(this.resize).observe(canvas);
    this.resize();
  }

  // ---------- lifecycle ----------

  reset() {
    this.platforms = [];
    this.beans = [];
    this.particles = [];
    this.texts = [];
    this.cliffs = 0;
    this.beanCount = 0;
    this.hearts = MAX_HEARTS;
    this.over = false;
    this.held = false;
    const first = { x: 0, w: 420, top: 500, i: 0, seed: 7, goal: false };
    this.platforms.push(first);
    while (this.platforms.length < 8) this.addPlatform();
    this.cur = 0;
    this.player = {
      x: first.x + first.w - STAND_OFFSET, y: first.top, vx: 0, vy: 0,
      state: 'idle', power: 0, chargeStart: 0, chargeT: 0, squash: 0, tilt: 0,
    };
    this.camX = this.player.x - this.playerScreenX();
    this.aiWait = 0.8;
    this.emit();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.033, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) this.update(dt);
    this.draw();
    requestAnimationFrame(this.frame);
  }

  resize() {
    const cssW = this.canvas.clientWidth || 1;
    const cssH = this.canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    // cover: fill the width, but on tall screens only let the scene claim the lower ~62% (sky fills the rest)
    // contain: show the whole 16:9 world, but on portrait phones zoom so the action fills ~45% of the height
    const s = this.fit === 'cover'
      ? Math.max((cssW / W) * this.zoom, (cssH * 0.62) / H)
      : Math.max(Math.min(cssW / W, cssH / H), (cssH * 0.45) / H);
    const ox = (cssW - W * s) / 2;
    const oy = this.fit === 'cover' ? cssH - H * s : (cssH - H * s) / 2;
    this.view = { s, ox, oy, dpr, cssW, cssH, left: -ox / s, right: (cssW - ox) / s, top: -oy / s };
    if (!this.running) this.draw();
  }

  /** Where the waiting barista sits, in world units from the camera: ~30% into the visible width. */
  playerScreenX() {
    const { left, right } = this.view;
    return left + (right - left) * PLAYER_SCREEN_RATIO;
  }

  emit() {
    this.on.change?.({ hearts: this.hearts, cliffs: this.cliffs, beans: this.beanCount });
  }

  // ---------- world generation ----------

  addPlatform() {
    const prev = this.platforms[this.platforms.length - 1];
    const i = prev.i + 1;
    const lvl = Math.min(i, this.mode === 'attract' ? 4 : 40); // the hero demo stays on easy gaps
    const gap = rand(110 + lvl * 4, 200 + lvl * 6);
    const goal = i % GOAL_EVERY === 0;
    const w = goal ? rand(180, 220) : rand(Math.max(72, 150 - lvl * 2), Math.max(110, 230 - lvl * 3));
    const top = clamp(prev.top + rand(-60, 60), 430, 560);
    const p = { x: prev.x + prev.w + gap, w, top, i, seed: (Math.random() * 1e6) | 0, goal, refilled: false };
    this.platforms.push(p);
    if (Math.random() < 0.55) {
      this.beans.push({
        x: prev.x + prev.w + gap * rand(0.35, 0.65),
        y: Math.min(prev.top, top) - rand(100, 160),
        phase: Math.random() * 6,
        got: false,
      });
    }
  }

  // ---------- input ----------

  press() {
    this.held = true;
    if (this.paused || this.over) return;
    if (this.player.state === 'idle') this.beginCharge();
  }

  release() {
    this.held = false;
    const p = this.player;
    if (p.state !== 'charge' || this.paused) return;
    const v = launchVelocity(p.power);
    p.vx = v.vx;
    p.vy = v.vy;
    p.state = 'air';
    p.squash = -0.6;
    this.puff(p.x, p.y, 5);
    this.on.jump?.();
  }

  beginCharge() {
    const p = this.player;
    p.state = 'charge';
    p.chargeStart = performance.now();
    p.chargeT = 0;
    p.power = 0;
  }

  // ---------- simulation ----------

  update(dt) {
    this.t += dt;
    const p = this.player;
    if (this.mode === 'attract') this.autopilot(dt);

    switch (p.state) {
      case 'walk': {
        const cur = this.platforms[this.cur];
        const tx = cur.x + cur.w - STAND_OFFSET;
        const d = tx - p.x;
        if (Math.abs(d) < 2) {
          p.x = tx;
          p.state = 'idle';
          if (this.held && this.mode === 'play') this.beginCharge();
        } else {
          p.x += Math.sign(d) * Math.min(Math.abs(d), WALK_SPEED * dt);
        }
        break;
      }
      case 'charge':
        // wall-clock, so the meter tracks the real hold even when frames drop
        p.chargeT = (performance.now() - p.chargeStart) / 1000;
        p.power = powerAt(p.chargeT);
        break;
      case 'air':
        this.stepAir(dt);
        break;
      case 'fallen':
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.respawn();
        break;
      default:
        break;
    }

    p.squash += (0 - p.squash) * (1 - Math.exp(-dt * 12));

    for (const b of this.beans) {
      if (b.got || p.state !== 'air') continue;
      if (Math.hypot(b.x - p.x, b.y - (p.y - 45)) < 46) {
        b.got = true;
        this.beanCount++;
        this.burst(b.x, b.y, C.bean, 8);
        this.float('+1', b.x, b.y - 20, C.cream);
        this.emit();
      }
    }

    const cur = this.platforms[this.cur];
    const target = cur.x + cur.w - STAND_OFFSET - this.playerScreenX();
    this.camX += (target - this.camX) * (1 - Math.exp(-dt * 3.5));

    for (const pt of this.particles) {
      pt.vy += (pt.g ?? 900) * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const tx of this.texts) {
      tx.life -= dt;
      tx.y -= 40 * dt;
    }
    this.texts = this.texts.filter((tx) => tx.life > 0);

    while (this.cur > 2) {
      this.platforms.shift();
      this.cur--;
    }
    this.beans = this.beans.filter((b) => b.x > this.camX + this.view.left - 200);
  }

  stepAir(dt) {
    const p = this.player;
    const prevY = p.y;
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.tilt = clamp(p.vx / 4000, 0, 0.18) * (p.vy < 0 ? -1 : 1);

    const last = Math.min(this.platforms.length - 1, this.cur + 3);
    for (let k = this.cur; k <= last; k++) {
      const pl = this.platforms[k];
      const over = p.x >= pl.x - 8 && p.x <= pl.x + pl.w + 8;
      if (p.vy > 0 && over && prevY <= pl.top && p.y >= pl.top) {
        this.land(k);
        return;
      }
      // smacked into a cliff face: slide down it
      if (p.y > pl.top + 6 && p.x > pl.x - 12 && p.x < pl.x + 20 && p.vx > 0) {
        p.x = pl.x - 12;
        p.vx = 0;
      }
    }
    if (p.y > H + 180 + this.view.oy / this.view.s) this.fall();
  }

  land(k) {
    const p = this.player;
    const pl = this.platforms[k];
    p.y = pl.top;
    p.vx = 0;
    p.vy = 0;
    p.tilt = 0;
    p.squash = 0.55;
    p.state = 'walk';
    this.puff(p.x, pl.top, 8);
    if (k <= this.cur) return;

    this.cliffs += k - this.cur;
    this.cur = k;
    if (Math.abs(p.x - (pl.x + pl.w / 2)) <= PERFECT_HALF) {
      this.beanCount++;
      this.float('PERFECT!', p.x, pl.top - 140, C.grassLight);
      this.burst(p.x, pl.top - 10, C.grassLight, 10);
    }
    if (pl.goal && !pl.refilled) {
      pl.refilled = true;
      if (this.hearts < MAX_HEARTS) {
        this.hearts++;
        this.float('REFILL!', pl.x + pl.w - 40, pl.top - 130, C.heart);
      } else {
        this.float('GOAL!', pl.x + pl.w - 40, pl.top - 130, C.sign);
      }
    }
    while (this.platforms.length < this.cur + 8) this.addPlatform();
    this.on.land?.();
    this.emit();
  }

  fall() {
    const p = this.player;
    p.state = 'fallen';
    p.respawnT = 1.0;
    const cur = this.platforms[this.cur];
    this.float('SPLASH!', clamp(p.x, cur.x + cur.w + 60, cur.x + cur.w + 240), H - 140, C.cream);
    if (this.mode === 'attract') return;
    this.hearts--;
    this.emit();
    this.on.fall?.();
    if (this.hearts <= 0) {
      this.over = true;
      p.respawnT = Infinity;
      setTimeout(() => this.on.over?.({ cliffs: this.cliffs, beans: this.beanCount }), 700);
    }
  }

  respawn() {
    const p = this.player;
    const cur = this.platforms[this.cur];
    p.x = cur.x + cur.w - STAND_OFFSET;
    p.y = cur.top - 320;
    p.vx = 0;
    p.vy = 0;
    p.state = 'air';
  }

  autopilot(dt) {
    const p = this.player;
    if (p.state === 'idle') {
      this.aiWait -= dt;
      if (this.aiWait <= 0) {
        this.aiPower = this.solve();
        this.beginCharge();
      }
    } else if (p.state === 'charge' && p.chargeT <= CHARGE_TIME && p.power >= this.aiPower) {
      this.held = true;
      this.release();
      this.aiWait = rand(0.7, 1.4);
    }
  }

  solve() {
    const p = this.player;
    const next = this.platforms[this.cur + 1];
    const aim = next.x + next.w / 2 + rand(-18, 18) - p.x;
    let best = 0.5;
    let err = Infinity;
    for (let pw = 0; pw <= 1; pw += 0.005) {
      const d = landingDistance(pw, p.y - next.top);
      if (d == null) continue;
      if (Math.abs(d - aim) < err) {
        err = Math.abs(d - aim);
        best = pw;
      }
    }
    return best;
  }

  // ---------- effects ----------

  puff(x, y, n) {
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: x + rand(-14, 14), y: y - 4, vx: rand(-90, 90), vy: rand(-140, -40), g: 300, life: rand(0.3, 0.5), max: 0.5, r: rand(5, 9), color: '#ffffff' });
    }
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * rand(120, 220), vy: Math.sin(a) * rand(120, 220) - 80, g: 700, life: 0.55, max: 0.55, r: rand(4, 6), color, outline: true });
    }
  }

  float(text, x, y, color) {
    this.texts.push({ text, x, y, color, life: 1.1, max: 1.1 });
  }

  // ---------- rendering ----------

  draw() {
    const { ctx } = this;
    const v = this.view;
    if (!v.dpr) return;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.fillStyle = C.sky;
    ctx.fillRect(0, 0, v.cssW, v.cssH);
    ctx.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);

    drawBackdrop(ctx, this.camX, this.t, v);

    ctx.save();
    ctx.translate(-this.camX, 0);
    const left = this.camX + v.left - 40;
    const right = this.camX + v.right + 40;
    for (const pl of this.platforms) {
      if (pl.x + pl.w < left || pl.x > right) continue;
      drawCliff(ctx, pl.x, pl.top, pl.w, pl.seed);
      if (pl.i > 0) drawPerfectPatch(ctx, pl.x + pl.w / 2, pl.top, PERFECT_HALF);
      if (pl.goal) drawGoalSign(ctx, pl.x + pl.w - 44, pl.top - 6);
    }
    this.drawBeans(left, right);
    this.drawPlayer();
    this.drawParticles();
    for (const tx of this.texts) {
      const k = tx.life / tx.max;
      drawLabel(ctx, tx.text, tx.x, tx.y, tx.color, 40, Math.min(1, k * 2.5));
    }
    ctx.restore();
  }

  drawBeans(left, right) {
    const img = sprite('bean');
    if (!img.complete) return;
    for (const b of this.beans) {
      if (b.got || b.x < left || b.x > right) continue;
      const bob = Math.sin(this.t * 3 + b.phase) * 6;
      this.ctx.save();
      this.ctx.translate(b.x, b.y + bob);
      this.ctx.rotate(Math.sin(this.t * 2 + b.phase) * 0.25);
      this.ctx.drawImage(img, -19, -19, 38, 38);
      this.ctx.restore();
    }
  }

  drawPlayer() {
    const { ctx } = this;
    const p = this.player;
    if (p.state === 'fallen' && p.y > H + 100) return;
    const img = sprite('barista');
    if (!img.complete) return;

    let sx = 1;
    let sy = 1;
    let bob = 0;
    if (p.state === 'charge') {
      sy = 1 - p.power * 0.2;
      sx = 1 + p.power * 0.1;
    } else if (p.state === 'air') {
      sy = 1.06;
      sx = 0.95;
    } else if (p.state === 'walk') {
      bob = -Math.abs(Math.sin(this.t * 16)) * 5;
    } else {
      sy = 1 + Math.sin(this.t * 3) * 0.015;
    }
    sy -= p.squash * 0.25;
    sx += p.squash * 0.15;

    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(p.tilt);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -44, -108, 88, 110);
    ctx.restore();

    if (p.state === 'charge') this.drawMeter(p.x, p.y - 140, p.power);
  }

  drawMeter(x, y, power) {
    const { ctx } = this;
    const w = 86;
    const h = 16;
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.fillStyle = C.cream;
    roundRect(ctx, x - w / 2, y, w, h, 8);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = C.cliff;
    ctx.fillRect(x - w / 2, y, w * power, h);
    ctx.restore();
    roundRect(ctx, x - w / 2, y, w, h, 8);
    ctx.stroke();
  }

  drawParticles() {
    const { ctx } = this;
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
      if (pt.outline) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
