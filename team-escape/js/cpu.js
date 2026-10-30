// Team Escape CPU players. A CpuDirector steers every CPU on one team through the level, one segment at a
// time, using the same per-puzzle solutions the solvability tests prove. It only ever sets the inputs a
// human could (left / right / jump / E). Humans on the team are never steered; instead CPUs hold plates,
// lanterns and bridges until those humans are through, and step back if a puzzle needs more players than
// the CPUs alone can supply.
//
// Each script is a generator: `yield` = wait one tick. The server calls tick() once before every world
// step. Any timeout (humans in the way, a CPU knocked off a ledge) restarts the current segment.
import { PHYS } from './sim-constants.js';
import { GROUND, STACK_CLIFF_H } from './levels.js';

const { PW, PH } = PHYS;
const IDLE = () => ({ l: false, r: false, j: false });
const FOREVER = Infinity;

class Timeout extends Error {}

export class CpuDirector {
  constructor(world, cpuIds, humanIds = () => []) {
    this.w = world;
    this.cpus = cpuIds;
    this.humanIds = humanIds;
    this.seg = 0;
    this.gen = null;
    this.retries = 0;
  }

  // ---------- plumbing ----------

  tick() {
    if (!this.cpus.some((id) => this.w.bodies.has(id))) return;
    if (!this.gen) this.gen = this.run();
    try {
      this.gen.next();
    } catch (err) {
      // a timeout means "try this puzzle again"; anything else is a bug, but must never stop the match
      if (!(err instanceof Timeout)) console.error('Team Escape CPU error:', err);
      this.retries++;
      this.gen = null;
      this.idle(this.cpus);
    }
  }

  *run() {
    const segs = this.w.level.segments;
    while (this.seg < segs.length) {
      const s = segs[this.seg];
      // regroup before each puzzle (Round 1's obstacles arrange their own players, e.g. a plate holder up top)
      if (!['start', 'exit', 'stackCliff', 'liftKey', 'towerDoors', 'elevatorTiming'].includes(s.name)) yield* this.spread(this.behind(s.x1 - 60), s.x0 - 10);
      yield* SOLVE[s.name].call(this, s);
      this.seg++;
    }
  }

  body(id) { return this.w.bodies.get(id); }
  live() { return this.cpus.filter((id) => this.w.bodies.has(id)); }
  /** CPUs whose centre is left of x (still have work to do there). */
  behind(x) { return this.live().filter((id) => this.body(id).x + PW / 2 < x); }
  humans() { return this.humanIds().filter((id) => this.w.bodies.has(id)); }
  humansPast(x) { return this.humans().every((id) => this.body(id).x + PW / 2 > x); }
  idle(ids) { ids.forEach((id) => { const b = this.body(id); if (b) b.in = IDLE(); }); }
  press(id) { const b = this.body(id); if (b) { b.ec += 1; b.eQueued = true; } }

  *wait(cond, secs = FOREVER) {
    for (let i = 0; !cond(); i++) {
      if (i > secs * 30) throw new Timeout();
      yield;
    }
  }

  /** Walk CPUs to x (a number, or a function of (id, index)). `hop` clears small steps; `press` counts being blocked as arriving. */
  *walk(ids, x, { hop = true, press = false, secs = 25 } = {}) {
    const stuck = new Map();
    const arrived = new Set();
    const target = typeof x === 'function' ? x : () => x;
    yield* this.wait(() => {
      let all = true;
      ids.forEach((id, i) => {
        const b = this.body(id);
        if (!b || arrived.has(id)) return;
        const dx = target(id, i) - b.x;
        const s = b.ground && (b.in.l || b.in.r) && Math.abs(b.moved) < 0.5 ? (stuck.get(id) ?? 0) + 1 : 0;
        stuck.set(id, s);
        if (b.ground && (Math.abs(dx) < 8 || (press && s >= 3))) {
          b.in = IDLE();
          arrived.add(id);
          return;
        }
        all = false;
        b.in = { l: dx < 0, r: dx > 0, j: hop && (s >= 2 || (!b.ground && b.vy < 0)) };
      });
      return all;
    }, secs);
    this.idle(ids);
  }

  /** One full-height jump toward x (a number or a function), landing on whatever is there. */
  *jumpTo(id, x) {
    let left = false;
    let ticks = 0;
    yield* this.wait(() => {
      const b = this.body(id);
      if (!b) return true;
      ticks++;
      if (!b.ground) left = true;
      const dx = (typeof x === 'function' ? x() : x) - b.x;
      b.in = { l: dx < -4, r: dx > 4, j: !left || b.vy < 0 };
      return left && b.ground && ticks > 2;
    }, 4);
    this.idle([id]);
  }

  /** Get everyone off each other's heads and gathered around x. */
  *spread(ids, x) {
    const stuck = new Map();
    const off = new Map();
    const done = new Set();
    yield* this.wait(() => {
      ids.forEach((id, i) => {
        const b = this.body(id);
        if (!b || done.has(id)) return;
        const s = b.ground && (b.in.l || b.in.r) && Math.abs(b.moved) < 0.5 ? (stuck.get(id) ?? 0) + 1 : 0;
        stuck.set(id, s);
        if (b.on && 'idx' in b.on) {
          let d = off.get(id) ?? 1;
          if (s >= 2) off.set(id, (d = -d));
          b.in = { l: d < 0, r: d > 0, j: false };
          return;
        }
        const dx = x - i * 2 - b.x;
        if (b.ground && (Math.abs(dx) < 8 || s >= 3)) {
          b.in = IDLE();
          done.add(id);
          return;
        }
        b.in = { l: dx < 0, r: dx > 0, j: false };
      });
      return ids.every((id) => done.has(id) || !this.w.bodies.has(id));
    }, 20);
    this.idle(ids);
  }

  /** Stand `top` on `base`'s head beside x. */
  *stack(base, top, x) {
    yield* this.walk([base, top], x, { hop: false, press: true });
    const b = this.body(base);
    if (!b) throw new Timeout();
    yield* this.jumpTo(top, b.x);
    if (this.body(top)?.on !== b) throw new Timeout();
  }

  /** Round 2: three push the crate up to the stair; players stack over it and go step -> wall; whoever is
   *  left behind gets the empty crate pushed back to the mini hill by teammates, then hops over it. */
  *bigCrate(s) {
    const x0 = s.x0;
    const hillEnd = x0 + 70;
    const stepX = x0 + 436;
    const wall = x0 + 526;
    const wallTop = this.w.level.solids.find((o) => o.x === wall).y;
    const crate = this.w.blocks.find((k) => k.x >= x0 && k.x < wall);
    if (!crate) throw new Timeout();
    const atStair = () => crate.x >= stepX - crate.w - 0.5;
    // back at the mini hill - possibly with the left-behind player squeezed in between (still one easy hop)
    const atHill = () => crate.x <= hillEnd + PW + 1;
    const up = (id) => {
      const b = this.body(id);
      return b && b.x + PW > wall && b.y + PH <= wallTop + 2;
    };
    const rightOf = (id) => { const b = this.body(id); return b && b.x >= crate.x + crate.w - 4; };
    const leftOf = (id) => { const b = this.body(id); return b && b.x + PW <= crate.x + 4 && !up(id); };
    const onCrate = (id) => this.body(id)?.ground && this.body(id)?.on === crate;
    const overTheCrate = function* (id) {
      // from the crate's top: walk off its right side, then step -> wall
      yield* this.walk([id], crate.x + crate.w + 30, { secs: 15 });
    }.bind(this);
    const climbStair = function* (id) {
      yield* this.walk([id], stepX + 20, { secs: 15 }); // hops onto the low step
      yield* this.jumpTo(id, wall + 40);
      if (!up(id)) throw new Timeout();
    }.bind(this);

    // 1. three push the crate up to the stair (nobody standing on it)
    if (!atStair() && !atHill() && !this.live().some(rightOf)) {
      const pushers = this.live().filter(leftOf).slice(0, crate.weight);
      if (pushers.length === crate.weight) {
        yield* this.walk(pushers, crate.x, { press: true, secs: 20 });
        yield* this.wait(() => {
          pushers.forEach((id) => { const b = this.body(id); if (b) b.in = { l: false, r: true, j: false }; });
          return atStair();
        }, 10);
        this.idle(pushers);
      }
    }
    // 2. while the crate is away from the mini hill, players stack over it; the base stays behind
    const left = this.live().filter(leftOf);
    if (!atHill() && left.length >= 2) {
      const base = left[0];
      yield* this.walk([base], crate.x, { hop: false, press: true, secs: 20 });
      for (const id of left.slice(1)) {
        yield* this.walk([id], crate.x - 60, { secs: 20 });
        yield* this.jumpTo(id, () => this.body(base)?.x ?? crate.x);
        if (this.body(id)?.on !== this.body(base)) throw new Timeout();
        yield* this.jumpTo(id, crate.x + 30);
        if (!onCrate(id)) throw new Timeout();
        yield* overTheCrate(id);
      }
    }
    // 3. anyone still behind (CPU or human): teammates on the right push the empty crate back to the mini hill
    const behind = () => [...this.live(), ...this.humans()].filter(leftOf);
    if (behind().length && !atHill()) {
      const helpers = this.live().filter(rightOf).slice(0, crate.weight);
      if (helpers.length === crate.weight) {
        for (const id of helpers) if (up(id)) throw new Timeout(); // (helpers wait below the wall)
        yield* this.wait(() => ![...this.bodies()].some(onCrate), 10);
        yield* this.walk(helpers, crate.x + crate.w, { press: true, secs: 20 });
        yield* this.wait(() => {
          helpers.forEach((id) => { const b = this.body(id); if (b) b.in = { l: true, r: false, j: false }; });
          return atHill();
        }, 12);
        this.idle(helpers);
      } else {
        yield* this.wait(atHill); // humans have to help push it back
      }
    }
    // 4. the ones behind hop mini hill -> crate -> over
    for (const id of this.live().filter(leftOf)) {
      yield* this.walk([id], hillEnd - 26, { secs: 20 });
      yield* this.jumpTo(id, crate.x + 30);
      if (!onCrate(id)) throw new Timeout();
      yield* overTheCrate(id);
    }
    // 5. everyone up the stair, once no one is left behind
    yield* this.wait(() => !behind().length);
    for (const id of this.live().filter((x) => !up(x))) yield* climbStair(id);
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40);
  }

  bodies() {
    return [...this.w.bodies.keys()];
  }

  /** Everyone (any teammate) standing in a column at x: the tower, bottom first. */
  towerAt(x) {
    return [...this.w.bodies.values()].filter((b) => b.ground && Math.abs(b.x - x) < 24).sort((a, b) => b.y - a.y);
  }

  /** Hop up a tower head by head until standing on its top. */
  *climbTower(id, x) {
    for (let tries = 0; tries < 6; tries++) {
      const me = this.body(id);
      if (!me) return;
      const others = this.towerAt(x).filter((b) => b !== me);
      const topBody = others.at(-1);
      if (topBody && me.on === topBody) return;
      yield* this.jumpTo(id, () => topBody?.x ?? x);
    }
    throw new Timeout();
  }

  /** Stack `tower` (bottom first) at x. Only our own players are driven; the rest are waited for, so every
   *  director sharing the same order builds the same tower. */
  *buildTower(tower, x, mine) {
    yield* this.spread(tower.filter((id) => mine.has(id)), x - 70);
    for (const [i, id] of tower.entries()) {
      if (mine.has(id)) {
        if (i === 0) yield* this.walk([id], x, { hop: false });
        else yield* this.climbTower(id, x);
      }
      yield* this.wait(() => this.towerAt(x)[i]?.id === id, 20);
    }
    // settled: everyone in order, each standing on the one below, for a few ticks running
    let calm = 0;
    yield* this.wait(() => {
      const ok = tower.every((id, i) => { const b = this.body(id); return b && b.ground && (i === 0 || b.on === this.body(tower[i - 1])); });
      calm = ok ? calm + 1 : 0;
      return calm >= 6;
    }, 10);
  }

  /** Hold position for a few ticks between moves so humans can see what the CPU is doing. */
  *pause(ticks = 6) {
    for (let i = 0; i < ticks; i++) yield;
  }
}

// ---------- per-segment solutions (`this` is the director) ----------

const SOLVE = {
  *start() {},

  *steps(s) {
    yield* this.walk(this.behind(s.x1 - 40), s.x1 - 40);
  },

  *plateGate(s) {
    const gateX = s.x0 + 280;
    const latch = s.x0 + 365;
    const plate = this.w.plates.find((p) => p.x === s.x0 + 40);
    const gate = this.w.gates.find((g) => g.x === gateX);
    const back = this.behind(gateX);
    const ahead = this.live().filter((id) => !back.includes(id));
    // anyone already through keeps the latch plate pressed for the rest
    if (ahead.length) yield* this.walk(ahead.slice(0, 1), latch);
    const holders = back.length > s.need ? back.slice(0, s.need) : back;
    const rest = back.filter((id) => !holders.includes(id));
    if (holders.length) {
      yield* this.walk(holders, (id, i) => s.x0 + 44 + i * 30, { secs: 30 });
      // short of players? the humans have to fill the plate (or the latch) for us
      yield* this.wait(() => plate.active || gate.open);
    }
    if (rest.length) yield* this.walk(rest, latch);
    const keeper = ahead[0] ?? rest[0];
    if (holders.length) {
      if (!keeper) yield* this.wait(() => gate.open); // a human must hold the latch plate
      yield* this.walk(holders, s.x0 + 420, { secs: 30 });
    }
    // keep the latch pressed until every human is through too
    if (keeper) yield* this.wait(() => this.humansPast(gateX + 30));
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40);
  },

  *climb(s) {
    const wall = s.x0 + 180;
    const h = GROUND - (s.tall ? 165 : 128);
    const plate = this.w.plates.find((p) => p.x === wall + 30);
    const up = (id) => {
      const b = this.body(id);
      return b && ((b.x + PW > wall && b.y + PH <= h + 2) || b.x > wall + 240);
    };
    let ups = this.live().filter(up);
    const downs = () => this.live().filter((id) => !up(id));
    if (!ups.length) {
      const need = s.tall ? 3 : 2;
      const d = downs();
      if (d.length < need) {
        // not enough CPUs to stack: wait for a human to get up and hold the plate
        yield* this.wait(() => plate.active);
      } else if (s.tall) {
        yield* this.stack(d[0], d[1], wall);
        yield* this.walk([d[2]], wall, { hop: false, press: true });
        yield* this.jumpTo(d[2], () => this.body(d[1])?.x ?? wall);
        if (this.body(d[2])?.on !== this.body(d[1])) throw new Timeout();
        yield* this.jumpTo(d[2], wall + 40);
      } else {
        yield* this.stack(d[0], d[1], wall);
        yield* this.jumpTo(d[1], wall + 40);
      }
      ups = this.live().filter(up);
    }
    const holder = ups[0];
    if (holder) yield* this.walk([holder], wall + 50, { hop: false });
    if (holder) yield* this.wait(() => plate.active, 3);
    else yield* this.wait(() => plate.active);
    for (const id of downs()) {
      yield* this.walk([id], s.tall ? s.x0 - 20 : s.x0 + 20);
      yield* this.jumpTo(id, s.tall ? s.x0 + 65 : s.x0 + 95);
      if (s.tall) yield* this.jumpTo(id, s.x0 + 145);
      yield* this.jumpTo(id, wall + 20);
      if (!up(id)) throw new Timeout();
    }
    // the holder stays on the plate until every human is up too
    yield* this.wait(() => this.humans().every((id) => {
      const b = this.body(id);
      return (b.x + PW > wall && b.y + PH <= h + 2) || b.x > wall + 240;
    }));
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40);
  },

  *blockWall(s) {
    if (s.big) {
      yield* this.bigCrate(s);
      return;
    }
    const wall = s.x0 + 360;
    const crate = this.w.blocks.find((k) => k.id && k.x >= s.x0 && k.x < wall);
    if (!crate) throw new Timeout();
    const atWall = () => crate.x >= wall - crate.w - 0.5;
    if (!atWall()) {
      const behind = () => this.live().filter((id) => this.body(id).x + PW <= crate.x + 2);
      if (behind().length >= crate.weight) {
        const pushers = behind().slice(0, crate.weight);
        const others = this.live().filter((id) => !pushers.includes(id) && this.body(id).x < wall);
        yield* this.walk([...pushers, ...others].filter((id) => this.body(id).x < s.x0 + 40), s.x0 + 60); // hop the curb
        if (others.length) yield* this.walk(others, s.x0 + 45, { hop: false });
        yield* this.spread(pushers, Math.max(s.x0 + 50, crate.x - 30));
        yield* this.walk(pushers, crate.x, { hop: false, press: true });
        yield* this.wait(() => {
          pushers.forEach((id) => { const b = this.body(id); if (b) b.in = { l: false, r: true, j: false }; });
          return atWall();
        }, 10);
        this.idle(pushers);
      } else {
        yield* this.wait(atWall); // humans have to help push
      }
    }
    for (const id of this.live().filter((x) => this.body(x).x < wall)) {
      yield* this.walk([id], crate.x - 70);
      yield* this.jumpTo(id, crate.x + crate.w / 2 - PW / 2);
      yield* this.jumpTo(id, wall + 40);
      if (this.body(id) && this.body(id).x < wall) throw new Timeout();
    }
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40);
  },

  *moving(s) {
    const m = this.w.movers.find((x) => x.x1 === s.x0 + 124);
    const pitEnd = s.x0 + 500;
    const todo = this.behind(pitEnd);
    yield* this.walk(todo, s.x0 + 90);
    for (const id of todo) {
      yield* this.wait(() => m.x < m.x1 + 3 && m.dx <= 0.05, 2 * m.period + 1);
      yield* this.jumpTo(id, () => m.x + 40);
      if (this.body(id)?.on !== m) throw new Timeout();
      yield* this.wait(() => m.x > m.x2 - 3, m.period + 1);
      yield* this.jumpTo(id, s.x0 + 520);
    }
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40);
  },

  *crumbles(s) {
    const stones = this.w.crumbles.filter((c) => c.x > s.x0 && c.x < s.x1).sort((a, b) => a.x - b.x);
    const pitEnd = s.x1 - 160;
    const todo = this.behind(pitEnd);
    yield* this.walk(todo, s.x0 + 120);
    for (const id of todo) {
      yield* this.wait(() => stones.every((c) => !c.goneUntil), 6);
      for (const c of stones) yield* this.jumpTo(id, c.x + c.w / 2 - PW / 2);
      yield* this.jumpTo(id, s.x1 - 120);
    }
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40);
  },

  *timedBridge(s) {
    const near = this.w.levers.find((l) => l.x === s.x0 + 150);
    const far = this.w.levers.find((l) => l.x === s.x0 + 220 + 270 + 60);
    const pitEnd = s.x0 + 220 + 270;
    const todo = this.behind(pitEnd);
    if (todo.length) {
      yield* this.walk(todo, near.x - PW / 2);
      this.press(todo[0]);
      yield;
      yield* this.walk(todo, s.x1 - 60, { secs: 15 });
    }
    // a CPU minds the far lantern while any human is still on the near side
    if (this.humans().some((id) => this.body(id).x + PW / 2 < pitEnd)) {
      const keeper = this.live()[0];
      if (keeper) {
        yield* this.walk([keeper], far.x - PW / 2);
        yield* this.wait(() => {
          if (!far.until) this.press(keeper);
          return this.humansPast(pitEnd + 20);
        });
      }
    }
  },

  *levers(s) {
    const levers = this.w.levers.filter((l) => l.x > s.x0 && l.x < s.x1).sort((a, b) => a.x - b.x);
    const group = this.w.groups.find((g) => g.levers.includes(levers[0].id));
    const gateX = levers.at(-1).x + 200;
    if (!group.latched) {
      const crew = this.behind(gateX).slice(0, levers.length);
      yield* this.walk(crew, (id, i) => levers[i].x - PW / 2, { secs: 30 });
      // keep our lanterns lit; any lanterns without a CPU need a human
      yield* this.wait(() => {
        crew.forEach((id, i) => { if (!levers[i].until) this.press(id); });
        return group.latched;
      });
    }
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40, { secs: 40 });
  },

  /** Round 3, obstacle 1. Roles come from the whole team sorted by join order, so every director (one per
   *  CPU group, plus a human's own) agrees on them and only drives its own players: the first five build the
   *  tower and the top one climbs to the deck; of the rest, three push the crate onto the last floor plate and
   *  four hold the other plates (one deck door each); the climber crosses the doors and holds the end plate
   *  until everyone is through. */
  *towerDoors(s) {
    const mine = new Set(this.live());
    const plate = (pid) => this.w.plates.find((p) => p.id === pid);
    const [floorPlates, endPlate] = [s.floorPlates.map(plate), plate(s.endPlate)];
    const floorDoor = this.w.gates.find((g) => g.id === s.floorDoor);
    const crate = this.w.blocks.find((k) => k.id === s.crate);
    const ledgeTop = GROUND - STACK_CLIFF_H;
    const up = (id) => { const b = this.body(id); return b && b.x + PW / 2 > s.edge && b.y + PH <= ledgeTop + 2; };
    const through = (id) => { const b = this.body(id); return !b || (b.ground && b.x > floorDoor.x + floorDoor.w + 4); };
    const team = [...this.w.bodies.values()].sort((a, b) => a.idx - b.idx).map((b) => b.id);
    const towerX = s.edge - 60;
    const climber = team.find(up) ?? team[4];
    if (!up(climber)) {
      yield* this.buildTower(team.slice(0, 5), towerX, mine);
      if (mine.has(climber)) {
        yield* this.jumpTo(climber, s.edge + 20);
        if (!up(climber)) throw new Timeout();
      }
      yield* this.wait(() => up(climber), 10);
    }
    const below = team.filter((id) => id !== climber);
    // three push the crate all the way to the floor door (it comes to rest on the last plate); then the four
    // below hold the other four plates, one each
    const pushers = below.slice(0, 3);
    const holders = below.slice(0, 4);
    const crateHome = () => crate.x + crate.w >= floorDoor.x - 0.5;
    const myBelow = below.filter((id) => mine.has(id));
    if (!crateHome()) {
      yield* this.spread(myBelow, towerX);
      const myPushers = pushers.filter((id) => mine.has(id));
      yield* this.walk(myPushers, () => crate.x - PW, { hop: false, press: true });
      yield* this.wait(() => {
        myPushers.forEach((id) => { this.body(id).in = { l: false, r: true, j: false }; });
        return crateHome();
      }, 25);
      this.idle(myPushers);
    }
    // from here everyone acts at once, so drive each of our players every tick:
    // holders stand on the floor plates, climber crosses the doors and holds the end plate until everyone below
    // is through the floor door, then all head on
    const stuck = new Map();
    const drive = (id, x) => {
      const b = this.body(id);
      if (!b) return true;
      const st = b.ground && (b.in.l || b.in.r) && Math.abs(b.moved) < 0.5 ? (stuck.get(id) ?? 0) + 1 : 0;
      stuck.set(id, st);
      const dx = x - b.x;
      if (Math.abs(dx) < 6 && b.ground) { b.in = IDLE(); return true; }
      b.in = { l: dx < 0, r: dx > 0, j: st >= 2 || (!b.ground && b.vy < 0) };
      return false;
    };
    const doorsOpen = () => s.doors.every((gid) => this.w.gates.find((g) => g.id === gid).open);
    const out = s.x1 - 40;
    const lastDoor = this.w.gates.find((g) => g.id === s.doors.at(-1));
    let opened = false; // once the floor door has opened, the holders' job is done
    yield* this.wait(() => {
      opened ||= endPlate.active;
      let done = true;
      for (const id of mine) {
        if (!this.body(id)) continue;
        if (id === climber) {
          if (!below.every(through)) {
            if (doorsOpen() || this.body(id).x > lastDoor.x + lastDoor.w) drive(id, endPlate.x + (endPlate.w - PW) / 2);
            done = false;
          } else done = drive(id, out) && done;
        } else if (holders.includes(id) && !opened) {
          const p = floorPlates[holders.indexOf(id)];
          drive(id, p.x + (p.w - PW) / 2);
          done = false;
        } else if (opened || through(id)) done = drive(id, out) && done;
        else { this.body(id).in = IDLE(); done = false; }
      }
      return done;
    }, 90);
    this.idle([...mine]);
  },

  /** Round 3, obstacle 2: the whole team stacks on the start floor, the base walks the stack across the
   *  collapsing bridge, stops under the key for the top player's grab, then carries on to the far floor. */
  *keyBridge(s) {
    const mine = new Set(this.live());
    const team = [...this.w.bodies.values()].sort((a, b) => a.idx - b.idx).map((b) => b.id);
    const [base, top] = [team[0], team.at(-1)];
    const stackX = s.edge - 40;
    const across = () => team.every((id) => { const b = this.body(id); return !b || (b.ground && b.x > s.end + 10); });
    if (!across()) {
      yield* this.buildTower(team, stackX, mine);
      // a tall team (6+) carries a middle rider through the key on the way; any teammate holding it will do
      const keyed = () => team.includes(this.w.key.carrier);
      if (mine.has(base)) yield* this.walk([base], s.keyX - PW / 2, { hop: false, secs: 6 });
      else yield* this.wait(() => Math.abs(this.body(base).x - (s.keyX - PW / 2)) < 8 || keyed(), 12);
      if (mine.has(top) && !keyed()) {
        yield* this.jumpTo(top, () => this.body(team.at(-2))?.x ?? s.keyX);
        if (!keyed()) throw new Timeout();
      }
      yield* this.wait(() => keyed() && this.body(top)?.on === this.body(team.at(-2)), 6);
      if (mine.has(base)) yield* this.walk([base], s.end + 60, { hop: false, secs: 6 });
      yield* this.wait(() => this.body(base)?.x > s.end + 40, 12);
    }
    // everyone climbs down on the far floor
    yield* this.spread(team.filter((id) => mine.has(id)), s.end + 120);
    yield* this.wait(across, 15);
  },

  *stackCliff(s) {
    const edge = s.x0 + 360;
    const cliff = edge + 60;
    const top = GROUND - 238;
    const plate = this.w.plates.find((p) => p.x === cliff + 40);
    const up = (id) => {
      const b = this.body(id);
      return b && b.x + PW / 2 > cliff && b.y + PH <= top + 2;
    };
    // the plate only holds the steps while someone stands on it
    const anyUp = () => [...this.live(), ...this.humans()].some(up);
    if (!anyUp()) {
      const towerX = edge - 30;
      const crew = this.behind(edge);
      const others = this.humans().filter((id) => this.body(id).x < edge);
      if (crew.length + others.length < 5 || (crew.length < 5 && others.length >= 5)) {
        yield* this.wait(anyUp); // not enough of us yet, or the others can build it alone
      } else if (crew.length >= 5 || crew.length >= others.length) {
        // we build the tower from the bottom; if we run out, the humans climb on top and make the jump
        const tower = crew.slice(0, 5);
        yield* this.walk(tower.slice(1), towerX - 70);
        yield* this.walk([tower[0]], towerX, { hop: false });
        for (const id of tower.slice(1)) yield* this.climbTower(id, towerX);
        if (tower.length < 5) yield* this.wait(anyUp);
        else {
          yield* this.jumpTo(tower[4], cliff + 40);
          if (!up(tower[4])) throw new Timeout();
        }
      } else {
        // the others are building: wait until their tower is tall enough, then climb it and jump
        yield* this.walk(crew, towerX - 70);
        yield* this.wait(() => this.towerAt(towerX).length >= 5 - crew.length);
        for (const id of crew) yield* this.climbTower(id, towerX);
        const topId = crew.at(-1);
        yield* this.jumpTo(topId, cliff + 40);
        if (!up(topId)) throw new Timeout();
      }
    }
    // a CPU that made it up stands on the plate and stays there until everyone is up
    const holder = this.live().find(up);
    if (holder) {
      yield* this.walk([holder], cliff + 60, { hop: false });
      yield* this.wait(() => plate.active, 3);
    } else {
      yield* this.wait(() => plate.active); // a human is up there and has to hold the plate
    }
    // climbers leave the tower from the top down, so nobody gets carried off on someone's head
    const climbers = this.live().filter((x) => !up(x) && this.body(x).x < cliff).sort((m, n) => this.body(m).y - this.body(n).y);
    for (const id of climbers) {
      yield* this.spread([id], edge - 300); // off any heads, then a run-up from left of the first step
      yield* this.walk([id], edge - 300);
      yield* this.wait(() => plate.active);
      for (const x of [edge - 213, edge - 143, edge - 73, cliff + 30]) yield* this.jumpTo(id, x);
      if (!up(id)) throw new Timeout();
    }
    yield* this.wait(() => this.humans().every((id) => up(id) || this.body(id).x > cliff + 300));
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40);
  },

  *liftKey(s) {
    const lift = this.w.movers.find((m) => m.kind === 'lift');
    const hill = lift.crossX;
    const hillTop = lift.y2;
    const key = this.w.key;
    const across = (id) => {
      const b = this.body(id);
      // past the hill's edge, or standing on its top even with just a foot on the lip
      return b && (b.x + PW / 2 > hill || (b.ground && b.x + PW > hill && b.y + PH <= hillTop + 2));
    };
    const onLift = (id) => this.body(id)?.ground && this.body(id)?.on === lift;
    const atBottom = () => lift.phase === 'idle' || lift.phase === undefined;

    // board a group of up to five and ride to the top (humans may make up the numbers)
    const ride = function* (group, spot) {
      yield* this.wait(atBottom, 20);
      yield* this.walk(group, lift.x + 40, { secs: 40 });
      yield* this.spread(group, lift.x + spot); // stand on the side of the lift we'll jump from
      if (!group.every(onLift)) throw new Timeout();
      yield* this.wait(() => lift.phase === 'top', 60);
    }.bind(this);

    const hillEnd = hill + 140;
    const humansLeft = () => this.humans().filter((id) => !across(id));
    // someone over the hill climbs the staircase back up, then drops off the hill's left side
    const goBack = function* (id) {
      const b = this.body(id);
      if (!(b.y + PH <= hillTop + 2 && b.x + PW > hill)) {
        yield* this.walk([id], hillEnd + 262, { secs: 30 });
        for (const x of [hillEnd + 197, hillEnd + 137, hillEnd + 77, hillEnd + 17, hill + 100]) yield* this.jumpTo(id, x);
      }
      yield* this.walk([id], hill - 60, { secs: 20 });
      if (across(id)) throw new Timeout();
    }.bind(this);

    for (let guard = 0; guard < 12; guard++) {
      const need = lift.needNow ?? lift.need;
      let crew = this.live().filter((id) => !across(id));
      const keyDone = !key || key.used || key.carrier;
      // finished once everyone (CPUs and humans) is across with the key in hand
      if (keyDone && !crew.length && !humansLeft().length) break;
      // fewer than five on the lift side: bring CPUs back over the hill to make up the numbers
      const short = need - crew.length - humansLeft().length;
      if (short > 0) {
        const helpers = this.live().filter(across).slice(0, short);
        for (const id of helpers) yield* goBack(id);
        crew = this.live().filter((id) => !across(id));
      }
      const wave = crew.slice(0, need);
      const rest = crew.slice(wave.length);
      if (rest.length) yield* this.walk(rest, lift.x - 120, { secs: 40 });
      if (!keyDone) {
        // key ride: one rider jumps off to the left to grab the floating key
        yield* ride(wave, 22);
        if (!key.carrier) yield* this.jumpTo(wave[0], key.x - PW / 2 - 6);
        if (!key.carrier && !key.used) throw new Timeout();
        yield* this.wait(atBottom, 20);
        continue;
      }
      // hill ride: everyone aboard jumps across together as the lift reaches the top
      yield* ride(wave, lift.w - PW + 6);
      const left = new Set();
      yield* this.wait(() => {
        let all = true; // steer every jumper each tick (no early exit, or the later ones never jump)
        wave.forEach((id, i) => {
          const b = this.body(id);
          if (!b) return;
          if (!b.ground) left.add(id);
          const done = left.has(id) && b.ground;
          b.in = done ? { l: false, r: false, j: false } : { l: false, r: b.x < hill + 40 + i * 6, j: !left.has(id) || b.vy < 0 };
          if (!done) all = false;
        });
        return all;
      }, 4);
      this.idle(wave);
      if (!wave.every(across)) throw new Timeout();
      yield* this.walk(wave, hillEnd + 280, { secs: 20 }); // down the staircase, out of the next wave's way
    }
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40, { secs: 30 });
  },

  /** Round 4: three ride the shuttle up and take the car down to the floor (from the near deck, or from the far
   *  deck to fetch the last one or two); the rest walk on from the floor. Then one steps off and hops straight back
   *  on, sending it up just as the beam sweeps left, so it arrives behind the beam and everyone walks out right. */
  *elevatorTiming(s) {
    const mine = new Set(this.live());
    const team = () => [...this.w.bodies.values()].sort((a, b) => a.idx - b.idx).map((b) => b.id);
    const shuttle = this.w.movers.find((m) => m.kind === 'shuttle');
    const car = this.w.movers.find((m) => m.kind === 'car');
    const beam = this.w.movers.find((m) => m.kind === 'beam');
    const top = car.y1;
    const cx = (id) => this.body(id).x + PW / 2;
    const feet = (id) => this.body(id).y + PH;
    const across = (id) => this.body(id) && cx(id) > s.right + 4 && (feet(id) <= top + 2 || cx(id) > s.stairs);
    const upLeft = (id) => this.body(id) && feet(id) <= top + 2 && cx(id) > s.deck - 100 && cx(id) < s.right;
    const inCar = (id) => this.body(id) && cx(id) > car.x && cx(id) < car.x + car.w && feet(id) > top + 2 && feet(id) <= car.y + 1;
    const below = (id) => this.body(id) && !across(id) && !upLeft(id);
    const shuttleAt = (lo, hi) => { const ph = this.w.t % shuttle.period; return ph >= lo && ph < hi; };
    const mv = shuttle.period / 2 - shuttle.dwell;
    const safe = (i) => car.x - 240 - i * 28; // on the near deck, clear of the beam's sweep (it reaches car.x - 186)
    const far = (i) => s.right + 70 + i * 28; // on the far deck, clear of the beam's overhang
    const floor = (i) => car.x - 40 - i * 28; // on the floor under the near deck
    const slot = (i) => car.x + 12 + i * 28; // floor boarders on the car's left, riders down on its right
    const lowSlot = (i) => car.x + 66 + i * 24; // well inside: walks stop up to 8px off
    // targets key on each player's place in the full role list, since we only drive our own; everything here is
    // level (both lifts rest flush), so nobody hops - a hop in a crowd lands on a head
    const go = (ids, x, opts) => this.walk(ids.filter((id) => mine.has(id)), typeof x === 'function' ? (id) => x(id, ids.indexOf(id)) : x, { hop: false, ...opts });
    // every step waits on the whole team's positions, so a teammate driven by someone else stays in sync with ours
    const at = (ids, x) => ids.every((id, i) => { const b = this.body(id); return !b || (b.ground && Math.abs(b.x - x(i)) < 12); });
    const lineUp = function* (ids, x, secs = 20) {
      yield* go(ids, (id, i) => x(i), { secs });
      yield* this.wait(() => at(ids, x), secs);
    }.bind(this);

    for (let guard = 0; guard < 20; guard++) {
      const T = team();
      if (T.every(across)) break;
      if (car.phase !== 'top') {
        // a trip went wrong: anyone in the car steps off so it comes back up, then go again
        yield* go(T.filter(inCar), (id, i) => floor(i), { secs: 6 });
        yield* this.wait(() => car.phase === 'top', 10);
        continue;
      }
      const behind = T.filter((id) => !across(id));
      const up = behind.filter(upLeft);
      const low = behind.filter(below);
      let riders;
      let board;
      let fromLeft = behind.length >= 3;
      if (fromLeft) {
        if (up.length < 3) {
          // shuttle: just enough to make three up top, boarding while it rests flush with the ground
          const wave = low.slice(0, 3 - up.length);
          yield* go(wave, shuttle.x - 40, { secs: 30 });
          yield* this.wait(() => shuttleAt(0, shuttle.dwell - 0.8), 10);
          yield* go(wave, (id, i) => shuttle.x + 2 + i * 25, { secs: 2 });
          yield* this.wait(() => shuttleAt(shuttle.dwell + mv + 0.1, 2 * shuttle.dwell + mv), 10);
          yield* go(wave.filter((id) => this.body(id)?.on === shuttle), (id, i) => s.deck + 40 + i * 28, { secs: 3 });
          yield* this.wait(() => wave.every((id) => !this.body(id) || upLeft(id)), 12);
          continue;
        }
        [riders, board] = [up.slice(0, 3), low.slice(0, 2)];
      } else {
        if (up.length) {
          // the last one or two wait on the floor: off the near deck's far end
          yield* go(up, s.deck - 130, { secs: 10 });
          yield* this.wait(() => !up.some(upLeft), 12);
          continue;
        }
        [riders, board] = [T.filter(across).slice(0, 3), low];
      }
      // line up out of the beam's way
      yield* lineUp(board, floor);
      yield* lineUp(riders, fromLeft ? safe : far);
      // three board behind the beam as it sweeps away from them (all on the same sweep), and ride the car down
      yield* this.wait(() => (fromLeft ? beam.dx > 0 && beam.x > car.x - 180 && beam.x < car.x - 150 : beam.dx < 0 && beam.x + beam.w < car.x && beam.x + beam.w > car.x - 40), 10);
      yield* go(riders, (id, i) => lowSlot(2 - i), { secs: 4 });
      yield* this.wait(() => car.phase === 'bottom', 5);
      yield* lineUp(board, slot, 4);
      // as the beam sweeps left across the car, one steps off and hops back on: it rises in time to arrive behind it
      yield* this.wait(() => beam.dx < 0 && beam.x > car.x + 40 && beam.x < car.x + 75, 10);
      const hopper = board[0] ?? riders[2];
      if (mine.has(hopper)) {
        yield* this.walk([hopper], car.x - 34, { hop: false, secs: 2 });
        yield* this.wait(() => car.phase === 'up', 1);
        yield* this.jumpTo(hopper, car.x + 4);
      }
      yield* this.wait(() => car.phase === 'top', 8);
      yield* go([...riders, ...board], (id, i) => far(i), { secs: 6 });
    }
    yield* go(this.live().filter((id) => this.body(id).x < s.x1 - 60), s.x1 - 60, { secs: 20 });
    yield* this.wait(() => team().every((id) => this.body(id).x > s.stairs + 200), 30);
  },

  *key(s) {
    const key = this.w.key;
    if (key && !key.used && !key.carrier) {
      const crew = this.behind(s.x1);
      if (s.ledge) {
        if (crew.length >= 2) {
          yield* this.stack(crew[0], crew[1], s.x0 + 60);
          yield* this.jumpTo(crew[1], s.x0 + 192);
        } else {
          yield* this.wait(() => key.carrier || key.used);
        }
      } else if (crew.length) {
        yield* this.walk([crew[0]], s.x0 + 130);
        yield* this.jumpTo(crew[0], s.x0 + 187);
      }
      if (!key.carrier && !key.used) throw new Timeout();
    }
    yield* this.walk(this.live().filter((id) => this.body(id).x < s.x1 - 40), s.x1 - 40);
  },

  *exit() {
    const door = this.w.door;
    const mid = door.x + door.w / 2 - PW / 2;
    const carrier = this.w.key?.carrier;
    if (!door.unlocked && carrier && this.cpus.includes(carrier)) yield* this.walk([carrier], mid, { secs: 30 });
    yield* this.wait(() => door.unlocked);
    yield* this.walk(this.live(), mid, { secs: 30 });
  },
};
