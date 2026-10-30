// Team Escape world simulation: one instance per team. Pure JS (no DOM, no Node APIs) so the server runs
// it authoritatively and tests can drive it directly. Players collide with the level and can stand on each
// other's heads (that is how stacking works); they pass through each other sideways so crowds never jam.
import { PHYS } from './sim-constants.js';

const { G, JUMP_V, SPEED, PUSH_SPEED, MAX_FALL, PW, PH } = PHYS;
const JUMP_CUT = 260; // releasing jump early caps upward speed -> short hops
const REGROW = 2.5; // seconds before a crumbled stone grows back

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const r1 = (n) => Math.round(n * 10) / 10;

/** Move `b` along one axis, stopping at solids it did not already overlap. Returns the solid it hit. */
function moveAxis(b, dx, dy, solids) {
  const ignore = new Set();
  for (const s of solids) if (overlap(b, s)) ignore.add(s);
  b.x += dx;
  b.y += dy;
  let hit = null;
  for (const s of solids) {
    if (ignore.has(s) || !overlap(b, s)) continue;
    if (dx > 0) b.x = s.x - b.w;
    else if (dx < 0) b.x = s.x + s.w;
    else if (dy > 0) b.y = s.y - b.h;
    else if (dy < 0) b.y = s.y + s.h;
    hit = s;
  }
  return hit;
}

export class World {
  constructor(level) {
    this.level = level;
    this.t = 0;
    this.bodies = new Map();
    this.plates = level.plates.map((p) => ({ ...p, count: 0, active: false }));
    this.levers = level.levers.map((l) => ({ ...l, until: 0 }));
    this.groups = level.groups.map((g) => ({ ...g, active: false, latched: false }));
    this.gates = level.gates.map((g) => ({ ...g, open: false }));
    this.blocks = level.blocks.map((k) => ({ ...k, vy: 0, pushers: 0 }));
    this.movers = level.movers.map((m) => (m.kind === 'lift' || m.kind === 'car' || m.kind === 'shuttle'
      ? { ...m, y: m.y1, dx: 0, dy: 0, riders: 0, active: false }
      : { ...m, x: m.x1, dx: 0, dy: 0 }));
    this.crumbles = level.crumbles.map((c) => ({ ...c, load: 0, goneUntil: 0 }));
    this.key = level.key ? { x: level.key.x, y: level.key.y, carrier: null, used: false } : null;
    this.keyEverHeld = false;
    this.door = { ...level.door, unlocked: false };
    this.cp = 0;
    this.far = level.checkpoints[0].x; // furthest x any teammate has stood on, for timeout tie-breaks
    this.escaped = new Set();
    this.events = [];
    this.triggers = new Map();
    for (const p of this.plates) this.triggers.set(p.id, p);
    for (const g of this.groups) this.triggers.set(g.id, g);
  }

  // ---------- players ----------

  spawnPoint(idx) {
    const c = this.level.checkpoints[this.cp];
    return { x: c.x - PW / 2 + (((idx * 23) % 61) - 30), y: c.y - PH };
  }

  addBody(id, idx = this.bodies.size) {
    if (this.escaped.has(id) || this.bodies.has(id)) return;
    const s = this.spawnPoint(idx);
    this.bodies.set(id, {
      id, idx, x: s.x, y: s.y, w: PW, h: PH, vx: 0, vy: 0, face: 1,
      ground: false, on: null, moved: 0, jumpLeft: 0,
      in: { l: false, r: false, j: false }, ec: 0, jc: 0, eQueued: false,
    });
  }

  removeBody(id) {
    const b = this.bodies.get(id);
    if (!b) return;
    if (this.key && this.key.carrier === id) {
      this.key.carrier = null;
      if (!b.ground) Object.assign(this.key, { x: this.level.key.x, y: this.level.key.y });
    }
    this.bodies.delete(id);
  }

  /** Input from a client. `ec`/`jc` are press counters so a quick tap is never lost between ticks. */
  setInput(id, input = {}) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.in = { l: Boolean(input.l), r: Boolean(input.r), j: Boolean(input.j) };
    if (Number.isFinite(input.ec) && input.ec !== b.ec) {
      b.ec = input.ec;
      b.eQueued = true;
    }
    if (Number.isFinite(input.jc) && input.jc !== b.jc) {
      b.jc = input.jc;
      b.jumpLeft = 0.15; // buffered jump
    }
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  isActive(triggerId) {
    const t = this.triggers.get(triggerId);
    return Boolean(t && (t.active || t.latched));
  }

  // ---------- simulation ----------

  solidsFor(exclude) {
    const list = this.level.solids.slice();
    // a crate never fits through a doorway, open or shut
    for (const g of this.gates) if ((g.mode === 'gate') !== g.open || (exclude && g.mode === 'gate')) list.push(g);
    for (const c of this.crumbles) if (!c.goneUntil) list.push(c);
    for (const m of this.movers) list.push(m);
    for (const k of this.blocks) if (k !== exclude) list.push(k);
    return list;
  }

  step(dt = PHYS.DT) {
    const t = (this.t += dt);

    for (const m of this.movers) {
      if (m.kind === 'lift') {
        // count only players standing on it (as of last tick); enough at once starts it, then it keeps rising
        // five riders send it up; at the top it waits briefly then comes back down on its own,
        // and if anyone steps off on the way up (or at the top) it heads down straight away
        m.riders = 0;
        for (const b of this.bodies.values()) if (b.ground && b.on === m) m.riders++;
        m.phase ??= 'idle';
        // always five (or the whole team, if it's somehow smaller) - teammates on the far side
        // can come back down the hill's staircase to make up the numbers
        m.needNow = Math.min(m.need, this.bodies.size + this.escaped.size);
        const full = m.riders >= m.needNow;
        if (m.phase === 'idle' && full) {
          m.phase = 'up';
          this.emit('liftStart', { id: m.id });
        } else if (m.phase === 'up' && !full) m.phase = 'down';
        else if (m.phase === 'top') {
          // at the top, a team jumping off "together" gets a 0.3s window before the lift drops
          if (full) m.leftAt = null;
          else m.leftAt ??= t;
          if (t >= m.topUntil || (m.leftAt != null && t - m.leftAt >= 0.3)) {
            m.phase = 'down';
            m.leftAt = null;
          }
        }
        let ny = m.y;
        if (m.phase === 'up') {
          ny = Math.max(m.y2, m.y - m.speed * dt);
          if (ny <= m.y2) {
            m.phase = 'top';
            m.topUntil = t + (m.dwell ?? 1.5);
          }
        } else if (m.phase === 'down') {
          ny = Math.min(m.y1, m.y + m.speed * dt);
          if (ny >= m.y1) m.phase = 'idle';
        }
        m.active = m.phase === 'up' || m.phase === 'top';
        m.dy = ny - m.y;
        m.y = ny;
        continue;
      }
      if (m.kind === 'car') {
        this.stepCar(m, dt);
        continue;
      }
      if (m.kind === 'shuttle') {
        // pauses `dwell` seconds at each end, eases between them
        const ph = t % m.period;
        const mv = m.period / 2 - m.dwell;
        const u = ph < m.dwell ? 0 : ph < m.dwell + mv ? (ph - m.dwell) / mv : ph < 2 * m.dwell + mv ? 1 : 1 - (ph - 2 * m.dwell - mv) / mv;
        const ny = m.y1 + (m.y2 - m.y1) * (0.5 - 0.5 * Math.cos(Math.PI * u));
        m.dy = ny - m.y;
        m.y = ny;
        this.shove(m, 0);
        continue;
      }
      const k = 0.5 - 0.5 * Math.cos(((t % m.period) / m.period) * Math.PI * 2);
      const nx = m.x1 + (m.x2 - m.x1) * k;
      m.dx = nx - m.x;
      m.x = nx;
      if (m.kind === 'beam') this.shove(m, m.dx);
    }
    for (const c of this.crumbles) {
      if (c.goneUntil && t >= c.goneUntil) {
        c.goneUntil = 0;
        c.load = 0;
      }
    }
    for (const l of this.levers) if (l.until && t >= l.until) l.until = 0;
    for (const b of this.bodies.values()) {
      if (b.eQueued) {
        b.eQueued = false;
        this.interact(b);
      }
    }
    this.updateTriggers();

    this.stepBlocks(dt);
    this.stepBodies(dt);
    this.afterMove();
  }

  interact(b) {
    const cx = b.x + PW / 2;
    const feet = b.y + PH;
    const lever = this.levers.find((l) => Math.abs(cx - l.x) < 44 && Math.abs(feet - l.y) < 60);
    if (lever) {
      lever.until = this.t + lever.dur;
      this.emit('lever', { id: lever.id, by: b.id });
      return;
    }
    if (this.key && this.key.carrier === b.id) {
      let best = null;
      let bestD = 70;
      for (const o of this.bodies.values()) {
        if (o === b) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < bestD) [best, bestD] = [o, d];
      }
      if (best) {
        this.key.carrier = best.id;
        this.emit('pass', { from: b.id, to: best.id });
        return;
      }
    }
    this.emit('nothing', { by: b.id });
  }

  updateTriggers() {
    for (const g of this.groups) {
      const was = g.active || g.latched;
      g.active = g.levers.every((lid) => this.levers.find((l) => l.id === lid)?.until > 0);
      if (g.active && g.latch) g.latched = true;
      if (!was && g.latched) this.emit('unlockGroup', { id: g.id });
    }
    for (const g of this.gates) {
      const open = g.by.some((tid) => this.isActive(tid));
      if (open !== g.open) {
        g.open = open;
        this.emit(open ? 'open' : 'close', { id: g.id, mode: g.mode });
      }
    }
  }

  stepBlocks(dt) {
    for (const k of this.blocks) {
      let pushR = 0;
      let pushL = 0;
      for (const b of this.bodies.values()) {
        if (b.y >= k.y + k.h - 2 || b.y + PH <= k.y + 2) continue;
        if (b.in.r && !b.in.l && Math.abs(b.x + PW - k.x) < 3) pushR++;
        if (b.in.l && !b.in.r && Math.abs(b.x - (k.x + k.w)) < 3) pushL++;
      }
      k.pushers = Math.max(pushR, pushL);
      // nobody can push a crate while someone is standing on it
      const ridden = [...this.bodies.values()].some((b) => b.ground && b.on === k);
      const dir = ridden ? 0 : pushR >= k.weight ? 1 : pushL >= k.weight ? -1 : 0;
      const solids = this.solidsFor(k);
      if (dir) {
        const from = k.x;
        moveAxis(k, dir * PUSH_SPEED * dt, 0, solids);
        if (k.x !== from) this.shoveBodies(k, k.x - from);
      }
      k.vy = Math.min(k.vy + G * dt, MAX_FALL);
      if (moveAxis(k, 0, k.vy * dt, solids)) k.vy = 0;
    }
  }

  /** Round 4's elevator car rests flush with the decks. Exactly `need` players standing on it (nobody else in its
   *  column, so stacked or hovering extras count too) take it down to the floor; a fourth climbing on turns it
   *  straight back. It comes back up the moment anyone leaves the column (a hop straight up stays in it), holds
   *  while the beam is over a rider near the top so nobody gets pushed into it, and never comes down on anyone. */
  stepCar(m, dt) {
    const beam = this.movers.find((o) => o.kind === 'beam');
    const inside = [...this.bodies.values()].filter((b) => {
      const cx = b.x + PW / 2;
      return cx > m.x && cx < m.x + m.w && b.y + PH <= m.y + 1 && b.y + PH > m.y1 - 150;
    });
    m.riders = inside.length;
    // standing means both feet on it: anyone with a toe on a deck would stay behind on the deck
    const standing = inside.filter((b) => b.ground && Math.abs(b.y + PH - m.y) < 1 && b.x >= m.x && b.x + PW <= m.x + m.w).length;
    m.phase ??= 'top';
    m.armed ??= true;
    if (m.phase === 'top') {
      if (m.riders < m.need) m.armed = true;
      if (m.armed && standing === m.need && m.riders === m.need) {
        m.phase = 'down';
        m.armed = false;
        m.peak = m.riders;
        this.emit('liftStart', { id: m.id });
      }
    } else if (m.phase !== 'up') {
      if (m.riders < m.peak || (m.phase === 'down' && m.riders > m.need)) m.phase = 'up';
      else m.peak = m.riders;
    }
    let ny = m.y;
    if (m.phase === 'down') {
      const to = Math.min(m.y2, m.y + m.speed * dt);
      const under = [...this.bodies.values()].some((b) => b.x < m.x + m.w && b.x + PW > m.x && b.y >= m.y + m.h - 1 && b.y < to + m.h);
      if (!under) ny = to;
      if (ny >= m.y2) m.phase = 'bottom';
    } else if (m.phase === 'up') {
      const reach = beam.y + beam.h + m.speed * dt + 2;
      const blocked = beam && inside.some((b) => b.y < reach && b.x < beam.x + beam.w + 2 && b.x + PW > beam.x - 2);
      if (!blocked) ny = Math.max(m.y1, m.y - m.speed * dt);
      if (ny <= m.y1) m.phase = 'top';
    }
    m.active = m.phase !== 'top';
    m.dy = ny - m.y;
    m.y = ny;
  }

  /** A moving beam or shuttle never passes through a player: the beam pushes anyone it now overlaps out of its
   *  way, and the shuttle scoops them up on top. */
  shove(m, moved) {
    const solids = this.solidsFor(null).filter((o) => o !== m);
    for (const b of this.bodies.values()) {
      if (!overlap(b, m)) continue;
      if (b.ground && b.on === m) continue; // a rider being lifted
      if (m.kind === 'shuttle') {
        b.y = m.y - PH; // caught by it: ride on top instead
        continue;
      }
      const right = moved ? moved > 0 : b.x + PW / 2 > m.x + m.w / 2;
      moveAxis(b, right ? m.x + m.w - b.x : m.x - (b.x + PW), 0, solids);
      if (overlap(b, m)) b.x = right ? m.x + m.w : m.x - PW; // pinned: never left inside it
    }
  }

  /** A moving crate shoves players in its way; if one can't be shoved (pinned), the crate stops at them. */
  shoveBodies(k, moved) {
    const solids = this.solidsFor(k);
    for (const b of this.bodies.values()) {
      if (!overlap(b, k)) continue;
      const push = moved > 0 ? k.x + k.w - b.x : k.x - (b.x + b.w);
      moveAxis(b, push, 0, solids);
      if (overlap(b, k)) k.x = moved > 0 ? b.x - k.w : b.x + b.w;
    }
  }

  stepBodies(dt) {
    const solids = this.solidsFor(null);
    const movers = new Set(this.movers);
    // lowest bodies first so anyone standing on a head lands on where that head is this tick
    const order = [...this.bodies.values()].sort((a, b) => b.y - a.y);
    for (const b of order) {
      const x0 = b.x;
      // ride whatever we stood on last tick
      if (b.ground && b.on) {
        if (movers.has(b.on) && b.on.dy) b.y += b.on.dy; // ride a lift up with it
        const carry = movers.has(b.on) ? b.on.dx : this.bodies.has(b.on.id) ? b.on.moved : 0;
        if (carry) moveAxis(b, carry, 0, solids);
      }
      const dir = (b.in.r ? 1 : 0) - (b.in.l ? 1 : 0);
      if (dir) b.face = dir;
      b.vx = dir * SPEED;
      if (b.vx) moveAxis(b, b.vx * dt, 0, solids);

      b.jumpLeft = Math.max(0, b.jumpLeft - dt);
      if (b.ground && (b.in.j || b.jumpLeft > 0)) {
        b.vy = -JUMP_V;
        b.ground = false;
        b.jumpLeft = 0;
        this.emit('jump', { by: b.id });
      }
      if (!b.in.j && b.vy < -JUMP_CUT && b.jumpLeft === 0) b.vy = -JUMP_CUT;
      b.vy = Math.min(b.vy + G * dt, MAX_FALL);

      const prevBottom = b.y + PH;
      const hit = moveAxis(b, 0, b.vy * dt, solids);
      b.ground = false;
      b.on = null;
      if (hit && b.vy > 0) {
        b.ground = true;
        b.on = hit;
        b.vy = 0;
      } else if (hit) {
        b.vy = 0;
      }
      if (b.vy >= 0 && !b.ground) {
        // land on a teammate's head
        for (const o of this.bodies.values()) {
          if (o === b || Math.abs(o.x - b.x) > PW - 6) continue;
          if (prevBottom <= o.y + 0.5 && b.y + PH >= o.y) {
            b.y = o.y - PH;
            b.vy = 0;
            b.ground = true;
            b.on = o;
            break;
          }
        }
      }
      b.moved = b.x - x0;
    }
  }

  afterMove() {
    const t = this.t;
    const { hazards, checkpoints, height } = this.level;

    const loaded = new Set();
    for (const b of this.bodies.values()) {
      if (b.ground && this.crumbles.includes(b.on)) loaded.add(b.on);
      const hz = hazards.find((h) => overlap(b, h));
      if (hz?.resets) {
        this.resetBridge(hz.resets);
        break;
      }
      if (b.y > height + 40 || hz) this.respawn(b);
    }
    for (const c of this.crumbles) {
      if (c.goneUntil) continue;
      if (c.once) {
        // a bridge tile: drops for good once whoever stood on it steps off, or after `hold` seconds of standing
        const on = [...this.bodies.values()].some((b) => b.ground && Math.abs(b.y + PH - c.y) < 1 && b.x < c.x + c.w && b.x + PW > c.x);
        if (on) {
          c.touched = true;
          c.load += PHYS.DT;
        }
        if (c.touched && (!on || c.load >= c.hold)) {
          c.goneUntil = Infinity;
          this.emit('crumble', { id: c.id });
        }
        continue;
      }
      c.load = loaded.has(c) ? c.load + PHYS.DT : 0;
      if (c.load >= c.time) {
        c.goneUntil = t + REGROW;
        this.emit('crumble', { id: c.id });
      }
    }

    for (const b of this.bodies.values()) if (b.ground) this.far = Math.max(this.far, b.x + PW / 2);
    for (let i = this.cp + 1; i < checkpoints.length; i++) {
      const c = checkpoints[i];
      const past = (b) => b.ground && b.x + PW / 2 >= c.x;
      const bodies = [...this.bodies.values()];
      if (c.all && !bodies.every(past)) break; // a whole-team checkpoint holds back every one after it
      if (bodies.some(past)) {
        this.cp = i;
        this.emit('checkpoint', { index: i });
      }
    }

    for (const p of this.plates) {
      let n = 0;
      for (const b of this.bodies.values()) {
        if (b.ground && Math.abs(b.y + PH - p.y) < 1 && b.x + PW > p.x + 4 && b.x < p.x + p.w - 4) n++;
      }
      // `crates` plates also feel a crate resting on them (its centre over the plate)
      if (p.crates) n += this.blocks.filter((k) => Math.abs(k.y + k.h - p.y) < 1 && k.x + k.w / 2 > p.x && k.x + k.w / 2 < p.x + p.w).length;
      p.count = n;
      if (p.latch && n >= p.need) p.latched = true; // latching plates stay on once pressed
      const active = n >= p.need || Boolean(p.latched);
      if (active !== p.active) {
        p.active = active;
        this.emit(active ? 'plateOn' : 'plateOff', { id: p.id });
      }
    }

    const key = this.key;
    if (key && !key.used) {
      if (!key.carrier) {
        for (const b of this.bodies.values()) {
          if (Math.abs(b.x + PW / 2 - key.x) < PW / 2 + 12 && Math.abs(b.y + PH / 2 - key.y) < PH / 2 + 12) {
            key.carrier = b.id;
            this.keyEverHeld = true;
            this.emit('key', { by: b.id });
            break;
          }
        }
      }
      const c = key.carrier && this.bodies.get(key.carrier);
      if (c) {
        key.x = c.x + PW / 2;
        key.y = c.y - 14;
        if (overlap(c, this.door)) {
          key.used = true;
          key.carrier = null;
          this.door.unlocked = true;
          this.emit('unlock', { by: c.id });
        }
      }
    }

    if (this.door.unlocked) {
      for (const b of [...this.bodies.values()]) {
        const cx = b.x + PW / 2;
        if (b.ground && cx > this.door.x + 8 && cx < this.door.x + this.door.w - 8 && b.y + PH <= this.door.y + this.door.h + 1) {
          this.escaped.add(b.id);
          this.bodies.delete(b.id);
          this.emit('escape', { by: b.id });
        }
      }
    }
  }

  /** A fall from the collapsing bridge: rebuild it and send everyone on that stretch back to its start floor. */
  resetBridge(r) {
    for (const c of this.crumbles) {
      if (c.bridge === r.bridge) Object.assign(c, { goneUntil: 0, load: 0, touched: false });
    }
    const sent = [];
    for (const b of this.bodies.values()) {
      if (b.x + PW / 2 < r.x0 || b.x + PW / 2 >= r.x1) continue;
      Object.assign(b, { x: r.spawnX - PW / 2 + (((b.idx * 23) % 61) - 30), y: r.spawnY - PH, vx: 0, vy: 0, ground: false, on: null });
      sent.push(b.id);
    }
    const key = this.key;
    if (key && !key.used && (!key.carrier || sent.includes(key.carrier))) Object.assign(key, { x: this.level.key.x, y: this.level.key.y, carrier: null });
    this.emit('bridgeReset', { by: sent });
  }

  respawn(b) {
    const s = this.spawnPoint(b.idx);
    Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, ground: false, on: null });
    this.emit('fall', { by: b.id });
  }

  /** Objective progress in [0, 1], used to rank teams on timeout. Deterministic from world state. */
  progress(required) {
    const list = this.level.checkpoints;
    const cps = list.length - 1;
    const next = list[this.cp + 1];
    const frac = next ? Math.min(0.99, Math.max(0, (this.far - list[this.cp].x) / (next.x - list[this.cp].x))) : 0;
    const stage = cps > 0 ? Math.min(1, (this.cp + frac) / cps) : 0;
    const escaped = required > 0 ? Math.min(1, this.escaped.size / required) : 0;
    const score = stage * 0.5 + (this.keyEverHeld ? 0.15 : 0) + (this.door.unlocked ? 0.15 : 0) + escaped * 0.2;
    return Math.round(score * 1000) / 1000;
  }

  /** Compact per-tick state for clients. Static geometry is rebuilt client-side from the same level id. */
  snapshot() {
    return {
      t: r1(this.t),
      p: [...this.bodies.values()].map((b) => [b.id, r1(b.x), r1(b.y), b.face, b.ground ? 1 : 0]),
      g: this.gates.map((g) => (g.open ? 1 : 0)),
      pl: this.plates.map((p) => (p.latched ? Math.max(p.count, p.need) : p.count)), // latched plates read as on
      lv: this.levers.map((l) => (l.until ? r1(l.until - this.t) : 0)),
      gr: this.groups.map((g) => (g.latched ? 1 : 0)),
      k: this.blocks.map((k) => [r1(k.x), r1(k.y), k.pushers]),
      m: this.movers.map((m) => (m.kind && m.kind !== 'beam' ? [r1(m.x), r1(m.y), m.riders, m.active ? 1 : 0, m.needNow ?? m.need ?? 0] : r1(m.x))),
      c: this.crumbles.map((c) => (c.goneUntil ? 0 : c.load ? 1 : 2)),
      key: this.key && !this.key.used ? [r1(this.key.x), r1(this.key.y), this.key.carrier] : null,
      door: this.door.unlocked ? 1 : 0,
      cp: this.cp,
      esc: [...this.escaped],
    };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
