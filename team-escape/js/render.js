// Team Escape canvas renderer: draws one team's world from the level geometry (built locally from the
// shared level builder) plus the latest server snapshot. Everything is vector-drawn in the outlined
// Game Night style, so there are no image assets to load.
import { PALETTE as P, TEAM_COLORS, TEAM_SHADES, INK } from './art.js';
import { GROUND } from './levels.js';
import { PHYS } from './sim-constants.js';
import { themeFor, drawParticles, paintGround } from './themes.js';
import { characterImage, characterLayers, CHARACTER_ASPECT, ART_W } from './character.js';

const { PW, PH } = PHYS;
const VIEW_TOP = -90; // world y shown at the top of the screen: keeps the floor low, with lots of room above
const VIEW_H = 590;

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.level = null;
    this.camX = 0;
    this.disp = new Map(); // smoothed positions per entity
    this.anim = new Map(); // walk-cycle state per player
    this.gateLift = new Map(); // 0 = shut .. 1 = raised, eased per gate
    this.dt = 1 / 60;
    this.fx = [];
    this.texts = [];
    this.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
  }

  setLevel(level) {
    this.theme = themeFor(level.id);
    // one continuous cap per run of side-by-side solids at the same height (no joins between pieces)
    const tops = level.solids.filter((o) => !o.wood && !(o.w <= 40 && o.h > 1000)).sort((a, b) => a.y - b.y || a.x - b.x);
    this.caps = [];
    for (const o of tops) {
      const run = this.caps.find((c) => c.y === o.y && o.x <= c.x + c.w + 1 && o.x + o.w >= c.x - 1);
      if (run) {
        const x0 = Math.min(run.x, o.x);
        run.w = Math.max(run.x + run.w, o.x + o.w) - x0;
        run.x = x0;
      } else {
        this.caps.push({ x: o.x, y: o.y, w: o.w });
      }
    }
    if (this.level && this.level.id === level.id && this.level.teamSize === level.teamSize) return;
    this.level = level;
    this.disp.clear();
    this.anim.clear();
    this.fx = [];
    this.texts = [];
    this.camX = 0;
  }

  smooth(key, x, y, dt, snap = 60) {
    let d = this.disp.get(key);
    if (!d || Math.hypot(d.x - x, d.y - y) > snap * 4) {
      d = { x, y };
      this.disp.set(key, d);
    }
    const k = 1 - Math.exp(-dt * 20);
    d.x += (x - d.x) * k;
    d.y += (y - d.y) * k;
    return d;
  }

  burst(x, y, color, n = 10, speed = 160) {
    if (this.still) return;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      this.fx.push({ x, y, vx: Math.cos(a) * speed * (0.5 + Math.random()), vy: Math.sin(a) * speed * (0.5 + Math.random()) - 60, life: 0.7, color });
    }
  }

  float(x, y, text, color = '#fff6e8') {
    this.texts.push({ x, y, text, color, life: 1.4 });
  }

  /** Draw a frame. `focus` is the world x the camera should follow. */
  draw(state, { focusId, team, names, dt, time, controlId }) {
    const L = this.level;
    const ctx = this.ctx;
    if (!L) return;
    const scale = this.cssH / VIEW_H;
    const viewW = this.cssW / scale;

    // smoothed players
    this.dt = dt;
    const players = (state?.p ?? []).map(([id, x, y, face, ground]) => {
      const d = this.smooth(id, x, y, dt);
      return { id, x: d.x, y: d.y, face, ground };
    });
    const focus = players.find((p) => p.id === focusId);
    let fx = focus ? focus.x : players.length ? players.reduce((s, p) => s + p.x, 0) / players.length : L.checkpoints[0].x;
    if (!focus && !players.length && state?.door) fx = L.door.x;
    const target = Math.max(0, Math.min(L.width - viewW, fx - viewW * 0.42));
    this.camX += (target - this.camX) * (1 - Math.exp(-dt * 6));
    if (!Number.isFinite(this.camX)) this.camX = target;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // round scenery: decoration only, drawn behind every gameplay object
    const scenery = { camX: this.camX, viewW, cssW: this.cssW, cssH: this.cssH, time, still: this.still };
    this.theme.sky(ctx, scenery);
    ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, -this.camX * scale * this.dpr, -VIEW_TOP * scale * this.dpr);
    this.theme.back(ctx, scenery);
    drawParticles(ctx, this.theme, scenery);

    const left = this.camX - 60;
    const right = this.camX + viewW + 60;
    const vis = (o) => o.x + o.w > left && o.x < right;

    this.drawHazards(ctx, L.hazards.filter(vis), time);
    // checkpoints still work (respawn points) but aren't drawn; in-level text hints are not shown
    this.drawDoor(ctx, state?.door);

    L.solids.filter(vis).forEach((s) => this.drawSolid(ctx, s));
    this.caps.filter(vis).forEach((c) => this.drawCap(ctx, c));
    L.gates.forEach((g, i) => vis(g) && this.drawGate(ctx, g, Boolean(state?.g?.[i]), time));
    L.plates.forEach((p, i) => vis(p) && this.drawPlate(ctx, p, state?.pl?.[i] ?? 0));
    L.levers.forEach((l, i) => l.x > left && l.x < right && this.drawLever(ctx, l, state?.lv?.[i] ?? 0, this.latchedLever(l, state), time));
    L.crumbles.forEach((c, i) => vis(c) && this.drawCrumble(ctx, c, state?.c?.[i] ?? 2, time));
    L.movers.forEach((m, i) => {
      if (m.kind && m.kind !== 'beam') {
        const [lx, ly, riders, active, need] = state?.m?.[i] ?? [m.x, m.y1, 0, 0, m.need ?? 0];
        const d = this.smooth(`m${i}`, lx, ly, dt);
        this.drawMover(ctx, { ...m, x: d.x, y: d.y });
        if (need) this.drawBadge(ctx, d.x + m.w / 2, d.y + m.h + 8, `${riders}/${need}`, Boolean(active)); // under it, clear of riders
        return;
      }
      const d = this.smooth(`m${i}`, state?.m?.[i] ?? m.x1, m.y, dt);
      if (m.kind === 'beam') this.drawBeam(ctx, { ...m, x: d.x });
      else this.drawMover(ctx, { ...m, x: d.x });
    });
    L.blocks.forEach((k, i) => {
      const s = state?.k?.[i] ?? [k.x, k.y, 0];
      const d = this.smooth(`k${i}`, s[0], s[1], dt);
      this.drawBlock(ctx, { ...k, x: d.x, y: d.y }, s[2]);
    });

    const carrier = state?.key?.[2];
    // draw yourself last (on top); skip name tags that would pile onto one already shown
    const ordered = players.filter((p) => p.id !== controlId).concat(players.filter((p) => p.id === controlId));
    const tags = [];
    for (const p of ordered.slice().reverse()) {
      const clash = tags.some((t) => Math.abs(t.x - p.x) < 40 && Math.abs(t.y - p.y) < 14);
      p.tag = p.id === controlId || !clash;
      if (p.tag) tags.push(p);
    }
    for (const p of ordered) this.drawPlayer(ctx, p, team, p.tag ? names.get(p.id) ?? '' : '', p.id === controlId, time);
    if (state?.key) {
      const k = carrier ? players.find((p) => p.id === carrier) : null;
      const kx = k ? k.x + PW / 2 : state.key[0];
      const ky = k ? k.y - 14 : state.key[1] + (this.still ? 0 : Math.sin(time * 3) * 4);
      this.drawKey(ctx, kx, ky, !carrier, time);
    }

    this.drawFx(ctx, dt);
  }

  latchedLever(l, state) {
    const gi = this.level.groups.findIndex((g) => g.latch && g.levers.includes(l.id));
    return gi >= 0 && Boolean(state?.gr?.[gi]);
  }

  // ---------- backdrop ----------

  // ---------- level pieces ----------

  drawSolid(ctx, s) {
    if (s.w <= 40 && s.h > 1000) return; // invisible world walls
    if (s.wood) {
      // a wooden deck: plank slab with a darker lip along the top
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.fillStyle = P.wood;
      rr(ctx, s.x, s.y + 4, s.w, s.h - 4, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = P.woodDark;
      rr(ctx, s.x - 4, s.y, s.w + 8, 8, 3);
      ctx.fill();
      ctx.stroke();
      return;
    }
    const bottom = Math.min(s.y + s.h, 640);
    // platforms wear the round's ground layers, outlined like the reference
    // fill 1px past the sides so neighbouring solids overlap instead of leaving an anti-aliased seam
    paintGround(ctx, this.theme, { ...s, x: s.x - 1, w: s.w + 2 }, bottom);
    // outline only the exposed edges: the top, and sides that aren't butted against another solid
    // a side line runs from the top down to where a neighbouring solid starts (or the bottom if none)
    const sideEnd = (x) => {
      let end = bottom;
      for (const o of this.level.solids) {
        if (o === s || (o.w <= 40 && o.h > 1000) || o.y + o.h <= s.y) continue;
        if (Math.abs(o.x + o.w - x) < 1 || Math.abs(o.x - x) < 1) end = Math.min(end, Math.max(s.y, o.y));
        else if (o.x < x && o.x + o.w > x && o.y > s.y) end = Math.min(end, o.y); // stop where it sinks into the floor
      }
      return end;
    };
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.theme.strip.edge;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + s.w, s.y);
    for (const x of [s.x, s.x + s.w]) {
      const end = sideEnd(x);
      if (end > s.y) {
        ctx.moveTo(x, s.y);
        ctx.lineTo(x, end);
      }
    }
    if (s.y + s.h < 640) {
      ctx.moveTo(s.x, s.y + s.h);
      ctx.lineTo(s.x + s.w, s.y + s.h);
    }
    ctx.stroke();
  }

  /** Rounded grey cap along a floor's top edge, like the homepage cliffs' grass strip. */
  drawCap(ctx, c) {
    ctx.fillStyle = '#7a7d82';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    rr(ctx, c.x - 5, c.y - 6, c.w + 10, 15, 7);
    ctx.fill();
    ctx.stroke();
  }

  drawHazards(ctx, list, time) {
    const hz = this.theme.hazard;
    for (const h of list) {
      if (hz.pit) {
        ctx.fillStyle = hz.pit;
        ctx.fillRect(h.x, h.y - 40, h.w, 120);
      } else {
        // no pit backdrop: the scenery shows through; just give the hazard a floor
        ctx.fillStyle = '#474747';
        ctx.fillRect(h.x, h.y + 4, h.w, 80);
      }
      ctx.fillStyle = hz.fill;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      if (hz.style === 'water' || hz.style === 'acid') {
        // a liquid surface with a gentle wave
        ctx.beginPath();
        ctx.moveTo(h.x, h.y + h.h);
        for (let x = 0; x <= h.w; x += 12) {
          const wave = this.still ? 0 : Math.sin(time * 3 + (h.x + x) / 18) * 3;
          ctx.lineTo(h.x + x, h.y - 8 + wave);
        }
        ctx.lineTo(h.x + h.w, h.y + h.h);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = hz.style === 'acid' ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.6)';
        for (let x = h.x + 14; x < h.x + h.w - 20; x += 46) ctx.fillRect(x, h.y + 4, 18, 3);
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(h.x, h.y + h.h);
      const n = Math.max(2, Math.floor(h.w / 18));
      for (let i = 0; i <= n; i++) {
        const x = h.x + (h.w * i) / n;
        const wob = hz.style === 'bramble' && !this.still ? Math.sin(time * 2 + i) * 2 : 0;
        ctx.lineTo(x - h.w / n / 2, h.y + 6);
        ctx.lineTo(x, h.y - (hz.style === 'crystals' ? 22 : 16) + wob);
      }
      ctx.lineTo(h.x + h.w, h.y + h.h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawGate(ctx, g, open, time) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    if (g.mode === 'bridge') {
      if (open) {
        ctx.fillStyle = P.wood;
        rr(ctx, g.x, g.y, g.w, g.h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = P.woodDark;
        for (let x = g.x + 14; x < g.x + g.w - 6; x += 22) ctx.fillRect(x, g.y + 3, 4, g.h - 6);
      } else {
        ctx.setLineDash([8, 8]);
        ctx.strokeStyle = 'rgba(255,184,92,.55)';
        rr(ctx, g.x, g.y, g.w, g.h, 5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      return;
    }
    // gates reaching off the top of the world show 300px under a header; short ones (hung under a deck) show whole
    const bottom = g.y + g.h;
    const tall = g.y < bottom - 300;
    const top = tall ? bottom - 300 : g.y;
    // slide up / down over ~0.8s with ease-in-out instead of snapping
    const was = this.gateLift.get(g.id) ?? (open ? 1 : 0);
    const prog = this.still ? (open ? 1 : 0) : Math.max(0, Math.min(1, was + (open ? 1 : -1) * this.dt / 0.8));
    this.gateLift.set(g.id, prog);
    const ease = prog * prog * (3 - 2 * prog);
    const lift = (bottom - top) * 0.77 * ease;
    if (tall) {
      ctx.fillStyle = P.stoneDark;
      ctx.fillRect(g.x - 8, top - 20, g.w + 16, 24);
      ctx.strokeRect(g.x - 8, top - 20, g.w + 16, 24);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x - 10, top, g.w + 20, bottom - top);
    ctx.clip();
    ctx.globalAlpha = 1 - 0.5 * ease;
    ctx.fillStyle = P.wood;
    const y0 = top - lift;
    rr(ctx, g.x, y0, g.w, bottom - top, Math.min(4, g.w / 2));
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.woodDark;
    for (let y = y0 + 30; y < y0 + bottom - top; y += 46) ctx.fillRect(g.x + 3, y, g.w - 6, 6);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawPlate(ctx, p, count) {
    const active = count >= p.need;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.fillStyle = active ? P.lantern : '#c9a46a';
    rr(ctx, p.x, p.y - (active ? 3 : 7), p.w, active ? 5 : 9, 3);
    ctx.fill();
    ctx.stroke();
    if (p.quiet) return; // unmarked boards: finding the right one is part of the puzzle
    // need badge
    const cx = p.x + p.w / 2;
    ctx.fillStyle = active ? P.lantern : '#1f3452';
    rr(ctx, cx - 22, p.y - 40, 44, 22, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? INK : '#eef4f8';
    ctx.font = '900 13px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.min(count, 99)}/${p.need}`, cx, p.y - 28);
  }

  /** Small "n/need" counter, styled like the pressure-plate badge. */
  drawBadge(ctx, cx, y, text, on) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.fillStyle = on ? P.lantern : '#1f3452';
    rr(ctx, cx - 22, y, 44, 22, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = on ? INK : '#eef4f8';
    ctx.font = '900 13px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + 12);
  }

  drawLever(ctx, l, left, latched, time) {
    const lit = latched || left > 0;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    if (lit && !this.still) {
      const glow = ctx.createRadialGradient(l.x, l.y - 70, 4, l.x, l.y - 70, 60);
      glow.addColorStop(0, 'rgba(255,209,102,.55)');
      glow.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(l.x - 60, l.y - 130, 120, 120);
    }
    ctx.fillStyle = P.stoneDark;
    ctx.fillRect(l.x - 4, l.y - 56, 8, 56);
    ctx.strokeRect(l.x - 4, l.y - 56, 8, 56);
    ctx.fillStyle = lit ? P.gold : '#40597d';
    rr(ctx, l.x - 13, l.y - 84, 26, 30, 8);
    ctx.fill();
    ctx.stroke();
    if (left > 0 && !latched) {
      ctx.strokeStyle = P.gold;
      ctx.lineWidth = 3;
      ctx.beginPath();
      const frac = Math.min(1, left / Math.max(0.1, l.dur));
      ctx.arc(l.x, l.y - 69, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(8,18,29,.7)';
    rr(ctx, l.x - 9, l.y - 106, 18, 17, 6);
    ctx.fill();
    ctx.fillStyle = '#eef4f8';
    ctx.font = '900 11px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('E', l.x, l.y - 97);
  }

  drawCrumble(ctx, c, s, time) {
    if (c.once) return this.drawBridgeTile(ctx, c, s, time);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    if (s === 0) {
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(163,174,198,.45)';
      rr(ctx, c.x, c.y, c.w, c.h, 5);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    const shake = s === 1 && !this.still ? Math.sin(time * 60) * 1.5 : 0;
    ctx.fillStyle = P.stoneLight;
    rr(ctx, c.x + shake, c.y, c.w, c.h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x + c.w * 0.3 + shake, c.y + 2);
    ctx.lineTo(c.x + c.w * 0.42 + shake, c.y + c.h * 0.6);
    ctx.lineTo(c.x + c.w * 0.36 + shake, c.y + c.h - 2);
    ctx.moveTo(c.x + c.w * 0.7 + shake, c.y + 3);
    ctx.lineTo(c.x + c.w * 0.62 + shake, c.y + c.h - 3);
    ctx.stroke();
  }

  /** Collapsing-bridge tile: shakes while stood on, then tumbles down and fades out when it drops. */
  drawBridgeTile(ctx, c, s, time) {
    const fell = (this.tileFall ??= new Map());
    ctx.save();
    if (s === 0) {
      if (!fell.has(c.id)) fell.set(c.id, time);
      const t = time - fell.get(c.id);
      if (this.still || t > 0.6) return ctx.restore();
      ctx.globalAlpha = 1 - t / 0.6;
      ctx.translate(c.x + c.w / 2, c.y + 900 * t * t);
      ctx.rotate(t * ((c.x / c.w) % 2 < 1 ? 1.6 : -1.6));
      ctx.translate(-c.x - c.w / 2, -c.y);
    } else {
      fell.delete(c.id);
      if (s === 1 && !this.still) ctx.translate(Math.sin(time * 60) * 1.2, 0);
    }
    ctx.fillStyle = '#a9acb0';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    rr(ctx, c.x + 1, c.y, c.w - 2, c.h, 4);
    ctx.fill();
    ctx.stroke();
    const cx = c.x + c.w / 2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 8, c.y + c.h - 4);
    ctx.lineTo(cx, c.y + 4);
    ctx.lineTo(cx + 8, c.y + c.h - 4);
    ctx.stroke();
    ctx.restore();
  }

  /** Round 4's sweeping beam: a wooden post hanging from the sky down to the decks. */
  drawBeam(ctx, m) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.fillStyle = P.wood;
    rr(ctx, m.x, m.y, m.w, m.h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(m.x + 3, m.y, 3, m.h - 4);
  }

  drawMover(ctx, m) {
    // rounded wooden plank
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.fillStyle = P.wood;
    rr(ctx, m.x - 4, m.y - 2, m.w + 8, m.h + 4, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.woodDark;
    for (let x = m.x + 18; x < m.x + m.w - 8; x += 24) ctx.fillRect(x, m.y + 2, 3, m.h - 4);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(m.x + 4, m.y + 1, m.w - 8, 3);
  }


  drawBlock(ctx, k, pushers) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.fillStyle = P.wood;
    rr(ctx, k.x, k.y, k.w, k.h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = P.woodDark;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(k.x + 8, k.y + 8);
    ctx.lineTo(k.x + k.w - 8, k.y + k.h - 8);
    ctx.moveTo(k.x + k.w - 8, k.y + 8);
    ctx.lineTo(k.x + 8, k.y + k.h - 8);
    ctx.stroke();
    ctx.fillStyle = '#fff6e8';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    rr(ctx, k.x + k.w / 2 - 20, k.y - 30, 40, 22, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '900 13px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.min(pushers, k.weight)}/${k.weight}`, k.x + k.w / 2, k.y - 19);
  }

  drawDoor(ctx, unlocked) {
    const d = this.level.door;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.fillStyle = P.stoneDark;
    ctx.beginPath();
    ctx.moveTo(d.x - 14, d.y + d.h);
    ctx.lineTo(d.x - 14, d.y + 20);
    ctx.arc(d.x + d.w / 2, d.y + 20, d.w / 2 + 14, Math.PI, 0);
    ctx.lineTo(d.x + d.w + 14, d.y + d.h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(d.x, d.y + d.h);
    ctx.lineTo(d.x, d.y + 20);
    ctx.arc(d.x + d.w / 2, d.y + 20, d.w / 2, Math.PI, 0);
    ctx.lineTo(d.x + d.w, d.y + d.h);
    ctx.closePath();
    if (unlocked) {
      const g = ctx.createLinearGradient(0, d.y, 0, d.y + d.h);
      g.addColorStop(0, '#fff3c4');
      g.addColorStop(1, P.gold);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = P.wood;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = P.gold;
      rr(ctx, d.x + d.w / 2 - 12, d.y + d.h * 0.42, 24, 22, 4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(d.x + d.w / 2, d.y + d.h * 0.42, 8, Math.PI, 0);
      ctx.stroke();
    }
    if (this.theme.name === 'Crystal Cavern') this.drawCrystalGate(ctx, d, unlocked);
    ctx.font = '400 15px "Lilita One", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.strokeText('EXIT', d.x + d.w / 2, d.y - 24);
    ctx.fillStyle = '#fff6e8';
    ctx.fillText('EXIT', d.x + d.w / 2, d.y - 24);
  }

  /** Final-round flourish: crystals framing the exit, glowing once it's unlocked. */
  drawCrystalGate(ctx, d, unlocked) {
    const cx = d.x + d.w / 2;
    if (unlocked) {
      // flat halo, in keeping with the scenery's flat colour style
      ctx.fillStyle = 'rgba(143,211,207,.35)';
      ctx.beginPath();
      ctx.arc(cx, d.y + 30, 95, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    for (const [dx, h, blue] of [[-62, 70, false], [-44, 44, true], [62, 76, true], [44, 48, false], [0, 34, false]]) {
      const x = cx + dx;
      const base = dx === 0 ? d.y - 6 : d.y + d.h;
      const w = h * 0.3;
      ctx.fillStyle = blue ? '#609cb4' : '#6cbac1';
      ctx.beginPath();
      ctx.moveTo(x - w, base);
      ctx.lineTo(x, base - h);
      ctx.lineTo(x + w, base);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawKey(ctx, x, y, free, time) {
    if (free && !this.still) {
      const glow = ctx.createRadialGradient(x, y, 2, x, y, 40);
      glow.addColorStop(0, 'rgba(255,209,102,.6)');
      glow.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 40, y - 40, 80, 80);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.3);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.fillStyle = P.gold;
    ctx.beginPath();
    ctx.arc(-10, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-3, -2.5, 18, 5);
    ctx.rect(10, 2, 4, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1f3452';
    ctx.beginPath();
    ctx.arc(-10, 0, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Walk-cycle state from how far the (smoothed) player moved since last frame. */
  animate(p) {
    const dt = Math.max(this.dt, 1e-3);
    let a = this.anim.get(p.id);
    if (!a) {
      a = { lastX: p.x, turn: 0, phase: 0, swing: 0, walkSwing: 0, bob: 0 };
      this.anim.set(p.id, a);
    }
    const speed = Math.abs(p.x - a.lastX) / dt;
    a.lastX = p.x;
    if (this.still) return { turn: 0, swing: 0, walkSwing: -0.6, phase: 0, bob: 0 };
    const walking = p.ground && speed > 25;
    const ease = (k) => 1 - Math.exp(-dt * k);
    // turn sideways while moving or airborne, back to facing the camera when standing still
    a.turn += ((walking || !p.ground ? 1 : 0) - a.turn) * ease(12);
    if (walking) {
      a.phase += Math.min(speed, 300) * dt * 0.085; // stride synced to ground speed
      a.swing = Math.sin(a.phase) * 0.62;
      a.walkSwing = Math.sin(a.phase);
      a.bob = -Math.abs(Math.sin(a.phase)) * 2.4;
    } else if (!p.ground) {
      a.swing += (0.5 - a.swing) * ease(14); // mid-air stride
      a.walkSwing += (-0.6 - a.walkSwing) * ease(14); // close to the drawn stride
      a.bob += (0 - a.bob) * ease(14);
    } else {
      a.swing += (0 - a.swing) * ease(10);
      a.bob += (0 - a.bob) * ease(10);
      a.phase = 0;
    }
    return a;
  }

  /** Character art with swinging legs; returns its drawn height so the name tag can sit on top. */
  drawWalker(ctx, p, team) {
    const a = this.animate(p);
    const scale = 50 / ART_W; // both drawings share one scale so the body stays the same size
    const moving = a.turn > 0.5;
    const walkArt = moving ? characterLayers(team, 'walk') : null;
    const art = walkArt ?? characterLayers(team, 'front');
    ctx.save();
    ctx.translate(p.x + PW / 2, p.y + PH + a.bob);
    if (walkArt) {
      // walking / running: each leg is turned to hang straight down, then swung forward and back around that,
      // the two legs always opposite - one foot reaches forward while the other pushes back, then they swap.
      const amp = 0.62; // radians either side of straight down
      const legs = art.legs.map((leg, i) => {
        const [hx, hy] = leg.hip;
        const [fx, fy] = leg.foot ?? [hx, art.h];
        const len = Math.hypot(fx - hx, fy - hy);
        const drawn = Math.atan2(fx - hx, fy - hy); // foot angle from straight down in the drawing (+ = ahead)
        const want = (i === 0 ? 1 : -1) * amp * a.walkSwing;
        return { leg, angle: drawn - want, footY: hy + len * Math.cos(want) };
      });
      // a leg hanging straight down reaches lower than the drawn stride: lift the body so feet stay on the ground
      const ground = Math.max(...art.legs.map((l) => (l.foot ?? [0, art.h])[1]));
      const lift = Math.max(0, ...legs.map((l) => l.footY - ground)) * scale;
      ctx.translate(0, -lift);
      ctx.rotate(p.face * (0.05 + 0.025 * Math.sin(a.phase * 2))); // lean, rocking a little each step
      ctx.scale(p.face * scale, scale);
      ctx.translate(-art.w / 2, -art.h);
      legs.forEach(({ leg, angle }) => this.drawLeg(ctx, art, leg, angle));
    } else {
      // front view (squeezed a little while turning) with legs swinging in opposite directions
      const side = a.turn;
      ctx.rotate(p.face * 0.07 * side);
      ctx.scale(p.face * scale * (1 - 0.3 * side), scale);
      ctx.translate(-art.w / 2, -art.h);
      art.legs.forEach((leg, i) => this.drawLeg(ctx, art, leg, i === 0 ? a.swing : -a.swing, (i === 0 ? 6 : -6) * side));
    }
    ctx.drawImage(art.body, 0, 0, art.w, art.h);
    ctx.restore();
    return 50 / CHARACTER_ASPECT;
  }

  drawLeg(ctx, art, leg, angle, shift = 0) {
    const [hx, hy] = leg.hip;
    ctx.save();
    ctx.translate(hx + shift, hy);
    ctx.rotate(angle);
    ctx.translate(-hx, -hy);
    ctx.drawImage(leg.img, 0, 0, art.w, art.h);
    ctx.restore();
  }

  drawPlayer(ctx, p, team, name, isMe, time) {
    const color = TEAM_COLORS[team];
    const shade = TEAM_SHADES[team];
    const x = p.x;
    const y = p.y;
    const bob = p.ground || this.still ? 0 : -1;
    if (characterLayers(team, 'front')) {
      const h = this.drawWalker(ctx, p, team);
      this.drawTag(ctx, x, y + PH - h - 4, name, isMe, time);
      return;
    }
    const art = characterImage(team);
    if (art) {
      // art is wider than the hitbox (horns + arms); keep it centred with feet on the hitbox floor
      const w = 50;
      const h = w / CHARACTER_ASPECT;
      ctx.save();
      ctx.translate(x + PW / 2, y + PH + bob);
      if (p.face < 0) ctx.scale(-1, 1);
      ctx.drawImage(art, -w / 2, -h, w, h);
      ctx.restore();
      this.drawTag(ctx, x, y + PH - h - 4, name, isMe, time);
      return;
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    // leaf
    ctx.fillStyle = P.mossLight;
    ctx.beginPath();
    ctx.moveTo(x + PW / 2, y + 4 + bob);
    ctx.quadraticCurveTo(x + PW / 2 - 9 * p.face, y - 8 + bob, x + PW / 2 - 13 * p.face, y - 4 + bob);
    ctx.quadraticCurveTo(x + PW / 2 - 4 * p.face, y - 2 + bob, x + PW / 2, y + 4 + bob);
    ctx.fill();
    ctx.stroke();
    // body
    ctx.fillStyle = color;
    rr(ctx, x, y + 2 + bob, PW, PH - 6, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = shade;
    ctx.globalAlpha = 0.5;
    rr(ctx, x + 3, y + PH - 14 + bob, PW - 6, 7, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    // feet
    ctx.fillStyle = INK;
    rr(ctx, x + 3, y + PH - 5, 8, 5, 2);
    ctx.fill();
    rr(ctx, x + PW - 11, y + PH - 5, 8, 5, 2);
    ctx.fill();
    // eyes look where we're going
    const ex = x + PW / 2 + p.face * 3;
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.6;
    for (const dx of [-4.5, 4.5]) {
      ctx.beginPath();
      ctx.arc(ex + dx, y + 13 + bob, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    for (const dx of [-4.5, 4.5]) {
      ctx.beginPath();
      ctx.arc(ex + dx + p.face, y + 13.5 + bob, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawTag(ctx, x, y + bob, name, isMe, time);
  }

  /** Name tag (and the "you" arrow) above a character whose art top is at `top`. */
  drawTag(ctx, x, top, name, isMe, time) {
    if (!name && !isMe) return;
    const y = top;
    // name tag
    ctx.font = `${isMe ? 900 : 800} 11px Nunito, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = name.length > 12 ? `${name.slice(0, 11)}…` : name;
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = isMe ? '#fff6e8' : 'rgba(8,18,29,.6)';
    rr(ctx, x + PW / 2 - tw / 2, y - 26, tw, 15, 7);
    ctx.fill();
    ctx.fillStyle = isMe ? INK : '#eef4f8';
    ctx.fillText(label, x + PW / 2, y - 18);
    if (isMe) {
      ctx.fillStyle = '#fff6e8';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      const ay = y - 34 + (this.still ? 0 : Math.sin(time * 5) * 2);
      ctx.beginPath();
      ctx.moveTo(x + PW / 2 - 6, ay - 6);
      ctx.lineTo(x + PW / 2 + 6, ay - 6);
      ctx.lineTo(x + PW / 2, ay + 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawFx(ctx, dt) {
    for (const f of this.fx) {
      f.life -= dt;
      f.vy += 500 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      ctx.globalAlpha = Math.max(0, f.life / 0.7);
      ctx.fillStyle = f.color;
      ctx.fillRect(f.x - 3, f.y - 3, 6, 6);
    }
    this.fx = this.fx.filter((f) => f.life > 0);
    ctx.font = '400 18px "Lilita One", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 30 * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life));
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    this.texts = this.texts.filter((t) => t.life > 0);
  }
}
