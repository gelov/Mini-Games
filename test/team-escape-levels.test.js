// Team Escape solvability: scripted bots play every level, at every team size and difficulty, through the
// real simulation, using exactly the selected number of players. Each segment has a scripted solution that
// only uses legal inputs (left/right/jump/E) - no teleporting - so passing means the variant is completable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../team-escape/js/sim.js';
import { buildLevel, LEVELS, TIEBREAKER, TEAM_SIZES, DIFFICULTIES, requirements, GROUND } from '../team-escape/js/levels.js';
import { PHYS } from '../team-escape/js/sim-constants.js';
import { CpuDirector } from '../team-escape/js/cpu.js';

const { PW } = PHYS;
const IDLE = () => ({ l: false, r: false, j: false });

function run(w, until, secs, label) {
  for (let i = 0; i < secs * 30; i++) {
    if (until()) return;
    w.step();
  }
  const where = [...w.bodies.values()].map((b) => `${b.id}@${b.x.toFixed(0)},${b.y.toFixed(0)}${b.ground ? 'g' : ''}`).join(' ');
  throw new Error(`timed out: ${label} [${where}]`);
}

const body = (w, id) => w.bodies.get(id);
const idle = (w, ids) => ids.forEach((id) => { const b = body(w, id); if (b) b.in = IDLE(); });

/** Walk bots to x. `hop` jumps over small obstacles; `press` treats being blocked as arriving. */
function walk(w, ids, x, { hop = true, press = false, secs = 25, label = 'walk' } = {}) {
  const stuck = new Map();
  const arrived = new Set();
  run(w, () => {
    let all = true;
    for (const id of ids) {
      const b = body(w, id);
      if (!b || arrived.has(id)) continue;
      const dx = x - b.x;
      const s = b.ground && (b.in.l || b.in.r) && Math.abs(b.moved) < 0.5 ? (stuck.get(id) ?? 0) + 1 : 0;
      stuck.set(id, s);
      if (b.ground && (Math.abs(dx) < 8 || (press && s >= 3))) {
        b.in = IDLE();
        arrived.add(id);
        continue;
      }
      all = false;
      b.in = { l: dx < 0, r: dx > 0, j: hop && (s >= 2 || (!b.ground && b.vy < 0)) };
    }
    return all;
  }, secs, `${label} -> ${x}`);
  idle(w, ids);
}

/** One full-height jump toward x, landing on whatever is there. */
function jumpTo(w, id, x, label = 'jump') {
  let left = false;
  let ticks = 0;
  run(w, () => {
    const b = body(w, id);
    if (!b) return true;
    ticks++;
    if (!b.ground) left = true;
    const dx = (typeof x === 'function' ? x() : x) - b.x;
    b.in = { l: dx < -4, r: dx > 4, j: !left || b.vy < 0 };
    return left && b.ground && ticks > 2;
  }, 4, `${label} -> ${x}`);
  idle(w, [id]);
  const b = body(w, id);
  return b;
}

function stack(w, base, top, wallX, label) {
  walk(w, [base, top], wallX, { hop: false, press: true, label: `${label} stack-walk` });
  const b = body(w, base);
  jumpTo(w, top, b.x, `${label} onto head`);
  const t = body(w, top);
  assert.equal(t.on, b, `${label}: ${top} should be on ${base}'s head (top ${t.x.toFixed(0)},${t.y.toFixed(0)} on ${t.on?.id ?? t.on?.x}; base ${b.x.toFixed(0)},${b.y.toFixed(0)} on ${b.on?.id ?? b.on?.x})`);
}

/** Line the team up single-file (no one on anyone's head) just before a segment. */
function spread(w, ids, x) {
  const stuck = new Map();
  const off = new Map(); // dismount direction per rider
  const done = new Set();
  run(w, () => {
    ids.forEach((id, i) => {
      const b = body(w, id);
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
    return ids.every((id) => done.has(id) || !w.bodies.has(id));
  }, 20, 'spread');
  idle(w, ids);
}

const pressE = (w, id) => { const b = body(w, id); b.ec += 1; b.eQueued = true; };

// ---------- one scripted solution per segment ----------

/** Play one segment with the CPU director's solution (used for Round 1's five-player obstacles). */
function viaCpu(w, ids, seg) {
  const cpu = new CpuDirector(w, ids);
  cpu.seg = w.level.segments.indexOf(seg);
  const next = cpu.seg + 1;
  run(w, () => {
    cpu.tick();
    return cpu.seg >= next;
  }, 120, seg.name);
  idle(w, ids);
}

const SOLVE = {
  stackCliff(w, ids, s) { viaCpu(w, ids, s); },
  liftKey(w, ids, s) { viaCpu(w, ids, s); },
  towerDoors(w, ids, s) { viaCpu(w, ids, s); },
  keyBridge(w, ids, s) { viaCpu(w, ids, s); },
  elevatorTiming(w, ids, s) { viaCpu(w, ids, s); },

  start() {},

  steps(w, ids, s) { walk(w, ids, s.x1 - 40, { label: 'steps' }); },

  plateGate(w, ids, s) {
    const holders = ids.slice(0, s.need);
    const rest = ids.slice(s.need);
    assert.ok(rest.length >= 1, 'someone must be free to pass the gate');
    walk(w, holders, s.x0 + 40 + 6, { label: 'to plate' });
    // spread holders across the plate
    holders.forEach((id, i) => walk(w, [id], s.x0 + 44 + i * 30, { label: 'spread' }));
    const plate = w.plates.find((p) => p.x === s.x0 + 40);
    run(w, () => plate.active, 2, 'plate active');
    walk(w, rest, s.x0 + 365, { label: 'through gate' });
    walk(w, holders, s.x0 + 420, { label: 'holders follow' });
    walk(w, ids, s.x1 - 40, { label: 'plateGate exit' });
  },

  climb(w, ids, s) {
    const wall = s.x0 + 180;
    const top = ids[s.tall ? 2 : 1];
    if (s.tall) {
      stack(w, ids[0], ids[1], wall, 'tall');
      walk(w, [ids[2]], wall, { hop: false, press: true });
      jumpTo(w, ids[2], body(w, ids[1]).x, 'third on stack');
      assert.equal(body(w, ids[2]).on, body(w, ids[1]), 'third player should be on the stack');
    } else {
      stack(w, ids[0], ids[1], wall, 'climb');
    }
    jumpTo(w, top, wall + 40, 'up the wall');
    walk(w, [top], wall + 50, { hop: false, label: 'top to plate' });
    const plate = w.plates.find((p) => p.x === wall + 30);
    run(w, () => plate.active, 1, 'assist plate');
    for (const id of ids) {
      if (id === top) continue;
      walk(w, [id], s.tall ? s.x0 - 20 : s.x0 + 20, { label: 'back up' });
      jumpTo(w, id, s.tall ? s.x0 + 65 : s.x0 + 95, 'step 1');
      if (s.tall) jumpTo(w, id, s.x0 + 145, 'step 2');
      jumpTo(w, id, wall + 20, 'onto ledge');
      assert.ok(body(w, id).y + PHYS.PH <= GROUND - (s.tall ? 165 : 128) + 1, `${id} should be on the ledge`);
    }
    walk(w, ids, s.x1 - 40, { label: 'climb exit' });
  },

  blockWall(w, ids, s) {
    if (s.big) return viaCpu(w, ids, s); // Round 2's big crate: stacking + plate steps, played by the CPU solution
    const block = w.blocks.find((k) => k.x === s.x0 + 120);
    const pushers = ids.slice(0, s.weight);
    walk(w, ids, s.x0 + 60, { label: 'to crate' });
    walk(w, ids.slice(s.weight), s.x0 + 45, { hop: false, label: 'crowd steps back' });
    spread(w, pushers, s.x0 + 90);
    pushers.forEach((id) => assert.equal(body(w, id).y, GROUND - PHYS.PH, `${id} should be on the ground`));
    walk(w, pushers, s.x0 + 120, { hop: false, press: true, label: 'pushers' });
    run(w, () => {
      pushers.forEach((id) => { body(w, id).in = { l: false, r: true, j: false }; });
      return block.x >= s.x0 + 360 - 60 - 0.5;
    }, 10, 'push crate to wall');
    idle(w, pushers);
    for (const id of ids) {
      walk(w, [id], s.x0 + 250, { label: 'line up' });
      jumpTo(w, id, s.x0 + 320, 'onto crate');
      jumpTo(w, id, s.x0 + 400, 'onto wall');
    }
    walk(w, ids, s.x1 - 40, { label: 'block exit' });
  },

  moving(w, ids, s) {
    const m = w.movers.find((x) => x.x1 === s.x0 + 124);
    walk(w, ids, s.x0 + 90, { label: 'pit edge' });
    for (const id of ids) {
      run(w, () => m.x < m.x1 + 3 && m.dx <= 0.05, 2 * m.period, 'mover home');
      jumpTo(w, id, () => m.x + 40, 'onto leaf');
      assert.equal(body(w, id).on, m, `${id} should ride the leaf`);
      run(w, () => m.x > m.x2 - 3, m.period, 'mover far');
      jumpTo(w, id, s.x0 + 520, 'off leaf');
    }
    walk(w, ids, s.x1 - 40, { label: 'moving exit' });
  },

  crumbles(w, ids, s) {
    const stones = w.crumbles.filter((c) => c.x > s.x0 && c.x < s.x1).sort((a, b) => a.x - b.x);
    walk(w, ids, s.x0 + 120, { label: 'crumble edge' });
    for (const id of ids) {
      run(w, () => stones.every((c) => !c.goneUntil), 5, 'stones regrown');
      for (const c of stones) jumpTo(w, id, c.x + c.w / 2 - PW / 2, 'stone');
      jumpTo(w, id, s.x1 - 120, 'off stones');
    }
    walk(w, ids, s.x1 - 40, { label: 'crumble exit' });
  },

  timedBridge(w, ids, s) {
    const lever = w.levers.find((l) => l.x === s.x0 + 150);
    walk(w, ids, lever.x - PW / 2, { label: 'to lantern' });
    pressE(w, ids[0]);
    w.step();
    assert.ok(lever.until > 0, 'lantern should light');
    walk(w, ids, s.x1 - 60, { label: 'cross bridge' });
  },

  levers(w, ids, s) {
    const levers = w.levers.filter((l) => l.x > s.x0 && l.x < s.x1).sort((a, b) => a.x - b.x);
    assert.ok(levers.length <= ids.length, 'enough players for every lantern');
    levers.forEach((l, i) => walk(w, [ids[i]], l.x - PW / 2, { label: `to lantern ${i}` }));
    levers.forEach((_, i) => pressE(w, ids[i]));
    w.step();
    const group = w.groups.find((g) => g.levers.includes(levers[0].id));
    assert.ok(group.latched, 'all lanterns together should open the gate');
    walk(w, ids, s.x1 - 40, { label: 'lever exit' });
  },

  key(w, ids, s) {
    if (s.ledge) {
      stack(w, ids[0], ids[1], s.x0 + 60, 'key ledge');
      jumpTo(w, ids[1], s.x0 + 192, 'onto key ledge');
    } else {
      walk(w, [ids[0]], s.x0 + 130, { label: 'to pedestal' });
      jumpTo(w, ids[0], s.x0 + 187, 'onto pedestal');
    }
    assert.ok(w.key.carrier, 'someone should hold the key');
    walk(w, ids, s.x1 - 40, { label: 'key exit' });
  },

  exit(w, ids) {
    const door = w.door;
    const mid = door.x + door.w / 2 - PW / 2;
    walk(w, [w.key.carrier], mid, { label: 'carrier to door' });
    assert.ok(door.unlocked, 'door should unlock');
    walk(w, ids, mid, { label: 'everyone out' });
  },
};

function play(levelId, size, difficulty) {
  const level = buildLevel(levelId, size, difficulty);
  const w = new World(level);
  const ids = Array.from({ length: size }, (_, i) => `p${i}`);
  ids.forEach((id, i) => w.addBody(id, i));
  run(w, () => [...w.bodies.values()].every((b) => b.ground), 3, 'settle');
  for (const seg of level.segments) {
    // Round 1's obstacles (played by the CPU solution) arrange their own players
    if (!['start', 'stackCliff', 'liftKey'].includes(seg.name) && !seg.big) spread(w, ids.filter((id) => w.bodies.has(id)), seg.x0 - 10);
    SOLVE[seg.name](w, ids.filter((id) => w.bodies.has(id)), seg);
    const fell = w.events.filter((e) => e.type === 'fall');
    assert.equal(fell.length, 0, `${seg.name}: nobody should fall (${fell.map((f) => f.by)})`);
    w.drainEvents();
  }
  assert.equal(w.escaped.size, size, 'every player escapes');
  return { level, secs: w.t };
}

const ALL = [...LEVELS, TIEBREAKER];

for (const def of ALL) {
  for (const size of TEAM_SIZES) {
    for (const difficulty of DIFFICULTIES) {
      test(`${def.id} is completable by exactly ${size} players (${difficulty})`, () => {
        const { level, secs } = play(def.id, size, difficulty);
        assert.ok(secs < 300, `bot run should fit the default 5-minute limit (took ${secs.toFixed(0)}s)`);
        assert.ok(level.width > 0);
      });
    }
  }
}

test('no mandatory puzzle asks for more players than the team has', () => {
  for (const def of ALL) {
    for (const size of TEAM_SIZES) {
      const L = buildLevel(def.id, size, 'normal');
      for (const p of L.plates) assert.ok(p.need < size, `${def.id}@${size}: plate needs ${p.need}`);
      for (const g of L.groups) assert.ok(g.levers.length <= size, `${def.id}@${size}: ${g.levers.length} levers`);
      for (const k of L.blocks) assert.ok(k.weight < size, `${def.id}@${size}: crate weight ${k.weight}`);
      assert.ok(L.key && L.door, 'key and door exist');
      assert.ok(L.checkpoints.length >= 2);
    }
  }
});

test('gameplay really scales with team size', () => {
  const small = requirements(5);
  const big = requirements(10);
  assert.ok(big.plateNeed > small.plateNeed && big.levers > small.levers && big.blockWeight > small.blockWeight);
  for (const def of LEVELS.filter((l) => l.id !== 'mossy-steps')) { // Round 1 is a fixed five-player design
    const a = buildLevel(def.id, 5, 'normal');
    const b = buildLevel(def.id, 10, 'normal');
    assert.ok(b.segments.length > a.segments.length, `${def.id}: 10-player layout has extra stages`);
  }
});

test('level builds are deterministic, so both teams and all clients get identical geometry', () => {
  for (const def of ALL) {
    for (const size of TEAM_SIZES) {
      assert.deepEqual(buildLevel(def.id, size, 'hard'), buildLevel(def.id, size, 'hard'));
    }
  }
});

test('one player cannot light two lanterns alone', () => {
  const level = buildLevel('twin-lanterns', 5, 'easy');
  const w = new World(level);
  w.addBody('solo', 0);
  const seg = level.segments.find((s) => s.name === 'levers');
  const levers = w.levers.filter((l) => l.x > seg.x0 && l.x < seg.x1);
  w.bodies.get('solo').x = seg.x0 + 20; // past the opening tower puzzle
  walk(w, ['solo'], levers[0].x - PW / 2);
  pressE(w, 'solo');
  walk(w, ['solo'], levers[1].x - PW / 2);
  pressE(w, 'solo');
  w.step();
  assert.equal(w.groups.find((g) => g.levers.includes(levers[0].id)).latched, false);
});

test('one player cannot climb a stacking wall alone', () => {
  const level = buildLevel('grand-escape', 5, 'normal');
  const w = new World(level);
  w.addBody('solo', 0);
  const seg = level.segments.find((s) => s.name === 'climb');
  w.bodies.get('solo').x = seg.x0 - 20;
  walk(w, ['solo'], seg.x0 + 180, { hop: false, press: true });
  jumpTo(w, 'solo', seg.x0 + 230);
  assert.ok(body(w, 'solo').x < seg.x0 + 180, 'solo player stays below the ledge');
});

test('round 1: four stacked players cannot reach the cliff, five can', () => {
  const level = buildLevel('mossy-steps', 5, 'normal');
  const seg = level.segments.find((x) => x.name === 'stackCliff');
  const cliffTop = GROUND - 238;
  for (const height of [4, 5]) {
    const w = new World(level);
    const ids = Array.from({ length: height }, (_, i) => `t${i}`);
    ids.forEach((id, i) => w.addBody(id, i));
    const cpu = new CpuDirector(w, ids);
    // build the tower the same way players do, then the top one jumps for the ledge
    const towerX = seg.x0 + 360 - 30;
    const gen = (function* () {
      yield* cpu.walk(ids.slice(1), towerX - 70);
      yield* cpu.walk([ids[0]], towerX, { hop: false });
      for (const id of ids.slice(1)) yield* cpu.climbTower(id, towerX);
      yield* cpu.jumpTo(ids.at(-1), seg.x0 + 460);
    })();
    run(w, () => gen.next().done, 60, `tower of ${height}`);
    const top = body(w, ids.at(-1));
    const made = top.x + PW / 2 > seg.x0 + 420 && top.y + PHYS.PH <= cliffTop + 2;
    assert.equal(made, height === 5, `tower of ${height} ${made ? 'reached' : 'did not reach'} the ledge`);
  }
});

function liftWorld() {
  const w = new World(buildLevel('mossy-steps', 5, 'normal'));
  const lift = w.movers.find((m) => m.kind === 'lift');
  const ids = ['a', 'b', 'c', 'd', 'e'];
  ids.forEach((id, i) => w.addBody(id, i));
  const board = (id, i) => Object.assign(body(w, id), { x: lift.x + 10 + i * 18, y: lift.y - PHYS.PH - 1, vy: 0 });
  return { w, lift, ids, board };
}

test('round 1: the lift goes up only with five aboard, then comes back down on its own', () => {
  const { w, lift, ids, board } = liftWorld();
  ids.slice(0, 4).forEach(board);
  body(w, 'e').x = lift.x - 200;
  run(w, () => w.t > 2, 3, 'settle four');
  assert.equal(lift.riders, 4);
  assert.equal(lift.y, lift.y1, 'four riders: it stays down');
  board('e', 4);
  run(w, () => lift.phase === 'top', 10, 'up with five');
  run(w, () => lift.phase === 'idle' && lift.y >= lift.y1 - 0.5, 10, 'back down after the top');
});

test('round 1: the lift heads down as soon as anyone steps off on the way up', () => {
  const { w, lift, ids, board } = liftWorld();
  ids.forEach(board);
  run(w, () => lift.y < lift.y1 - 60, 5, 'rising');
  Object.assign(body(w, 'e'), { x: lift.x - 200, y: GROUND - PHYS.PH - 1, vy: 0 });
  const y = lift.y;
  run(w, () => lift.y > y + 20, 3, 'goes down mid-way');
  assert.equal(lift.phase, 'down');
});

test('round 1: the lift always needs five, even after teammates cross to the hill', () => {
  const { w, lift, ids, board } = liftWorld();
  ids.forEach(board);
  run(w, () => lift.phase === 'top', 10, 'up');
  // three jump across; the two left behind can't work it on their own
  for (const id of ['a', 'b', 'c']) Object.assign(body(w, id), { x: lift.crossX + 40, y: lift.y2 - PHYS.PH - 1, vy: 0 });
  run(w, () => lift.phase === 'idle', 10, 'drops with two');
  w.step();
  assert.equal(lift.needNow, 5, 'still five');
  run(w, () => w.t > 20, 30, 'wait');
  assert.equal(lift.phase, 'idle', 'two riders: the lift stays down');
});

test('round 1: a staircase on the far side of the hill lets a stuck player climb back over', () => {
  const level = buildLevel('mossy-steps', 5, 'normal');
  const lift = level.movers.find((m) => m.kind === 'lift');
  const hill = lift.crossX;
  const hillEnd = hill + 140;
  const w = new World(level);
  w.addBody('s', 0);
  Object.assign(body(w, 's'), { x: hillEnd + 300, y: GROUND - PHYS.PH - 1, vy: 0 });
  run(w, () => body(w, 's').ground, 1, 'stand on the far side');
  for (const x of [hillEnd + 197, hillEnd + 137, hillEnd + 77, hillEnd + 17, hill + 100]) jumpTo(w, 's', x);
  assert.ok(body(w, 's').y + PHYS.PH <= lift.y2 + 2, 'back on top of the hill');
  walk(w, ['s'], hill - 60);
  assert.ok(body(w, 's').x < hill, 'dropped down on the lift side');
});

test('round 1: the key floats left of the lift, out of reach from the ground but not from the raised lift', () => {
  const level = buildLevel('mossy-steps', 5, 'normal');
  const lift = level.movers.find((m) => m.kind === 'lift');
  const hill = level.solids.find((o) => o.x === lift.crossX);
  assert.ok(level.key.x < lift.x, 'key is to the left of the lift');
  assert.ok(!level.solids.some((o) => o.x < level.key.x && o.x + o.w > level.key.x && o.y < GROUND && o.y > level.key.y - 40),
    'nothing holds the key up: it floats');
  assert.ok(hill && hill.x > lift.x + lift.w && hill.y + hill.h >= GROUND, 'the hill stands on the ground right of the lift');
  const towerReach = 5 * PHYS.PH + 117 + 12; // six-high tower's jump, head and pickup margin included
  assert.ok(GROUND - level.key.y > towerReach - PHYS.PH, 'no five- or six-high tower can grab it from the ground');
  // a player jumping left off the raised lift does grab it
  const w = new World(level);
  w.addBody('k', 0);
  const lw = w.movers.find((m) => m.kind === 'lift');
  lw.y = lw.y2;
  Object.assign(body(w, 'k'), { x: lw.x + 2, y: lw.y2 - PHYS.PH - 1, vy: 0 });
  run(w, () => body(w, 'k').ground, 1, 'stand on raised lift');
  jumpTo(w, 'k', lw.x - 60);
  assert.equal(w.key.carrier, 'k');
});

test('round 1: the cliff steps are only there while someone stands on the plate', () => {
  const level = buildLevel('mossy-steps', 5, 'normal');
  const w = new World(level);
  const plate = w.plates[0];
  const steps = w.gates.filter((g) => g.by.includes(plate.id));
  w.addBody('holder', 0);
  Object.assign(body(w, 'holder'), { x: plate.x + 20, y: plate.y - PHYS.PH - 1 });
  run(w, () => w.t > 0.5, 2, 'stand on plate');
  assert.ok(plate.active && steps.length === 3 && steps.every((g) => g.open), 'steps out while held');
  walk(w, ['holder'], plate.x + 200, { hop: false });
  w.step();
  assert.ok(!plate.active && steps.every((g) => !g.open), 'steps gone once the player steps off');
});

test('round 1: the hill is a long jump - from the lift edge you land on its lip, from the middle you fall short', () => {
  for (const [from, makesIt] of [['edge', true], ['middle', false]]) {
    const w = new World(buildLevel('mossy-steps', 5, 'normal'));
    const lift = w.movers.find((m) => m.kind === 'lift');
    lift.y = lift.y2;
    lift.phase = 'top';
    lift.topUntil = Infinity; // hold it still for this check
    w.addBody('j', 0);
    const x = from === 'edge' ? lift.x + lift.w - PHYS.PW : lift.x + lift.w / 2 - PHYS.PW / 2;
    Object.assign(body(w, 'j'), { x, y: lift.y2 - PHYS.PH - 1, vy: 0 });
    run(w, () => body(w, 'j').ground, 1, 'stand at the top');
    jumpTo(w, 'j', lift.crossX + 100);
    const b = body(w, 'j');
    const landed = b.y + PHYS.PH <= lift.y2 + 2 && b.x + PHYS.PW > lift.crossX;
    assert.equal(landed, makesIt, `jumping from the lift's ${from}`);
    if (makesIt) assert.ok(b.x < lift.crossX + 10, 'lands right on the lip, not comfortably');
  }
});

test('round 2: crate blocks the stair - push by 3 (never with a rider), stack over, push back for the last player', () => {
  const level = buildLevel('rootway', 5, 'normal');
  const seg = level.segments.find((x) => x.name === 'blockWall');
  const crateDef = level.blocks.find((k) => k.x >= seg.x0 && k.x < seg.x1);
  const hill = level.solids.find((o) => o.x === seg.x0 + 10);
  const step = level.solids.find((o) => o.x === seg.x0 + 436);
  const wall = level.solids.find((o) => o.x === seg.x0 + 526);
  assert.equal(crateDef.weight, 3);
  assert.ok(!level.solids.some((o) => o.x > crateDef.x && o.x < step.x && o.h < 30), 'no bump: the crate stops against the stair');
  assert.equal(crateDef.w, crateDef.h, 'square');
  assert.ok(crateDef.h > 117, 'taller than a lone jump');
  assert.ok(!level.solids.some((o) => o.x > seg.x0 && o.x < hill.x), 'the mini hill is the far-left piece');

  const standAt = (w, id, x, y) => { Object.assign(body(w, id), { x, y: y - PHYS.PH - 1, vy: 0 }); run(w, () => body(w, id).ground, 1, `stand ${id}`); };

  // a lone jump at the crate doesn't get on top
  let w = new World(level);
  w.addBody('a', 0);
  standAt(w, 'a', crateDef.x - 27, GROUND);
  jumpTo(w, 'a', crateDef.x + 30);
  assert.ok(body(w, 'a').y + PHYS.PH > crateDef.y + 2, 'one player cannot jump onto the crate');

  // from the mini hill, the crate is out of reach where it starts
  w = new World(level);
  w.addBody('m', 0);
  standAt(w, 'm', hill.x + hill.w - PHYS.PW, hill.y);
  jumpTo(w, 'm', crateDef.x + 10);
  assert.notEqual(body(w, 'm').on, w.blocks[0], 'mini hill is too far from the crate at the start');

  // two pushers can't move it, three can - but not with someone standing on it
  for (const [n, rider, moves] of [[2, false, false], [3, false, true], [3, true, false]]) {
    w = new World(level);
    const crate = w.blocks[0];
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    ids.forEach((id, i) => { w.addBody(id, i); Object.assign(body(w, id), { x: crate.x - PHYS.PW, y: GROUND - PHYS.PH - 1, vy: 0 }); });
    if (rider) { w.addBody('r', 9); standAt(w, 'r', crate.x + 50, crate.y); }
    run(w, () => w.t > 0.5, 1, 'settle');
    const x0 = crate.x;
    run(w, () => { ids.forEach((id) => { body(w, id).in = { l: false, r: true, j: false }; }); return w.t > 2; }, 3, 'push');
    assert.equal(crate.x > x0 + 20, moves, `${n} pushers${rider ? ' with a rider on top' : ''}: ${moves ? 'moves' : "doesn't move"}`);
  }

  // pushed back against the mini hill, the last player can hop on
  w = new World(level);
  w.blocks[0].x = hill.x + hill.w;
  w.addBody('l', 0);
  standAt(w, 'l', hill.x + hill.w - PHYS.PW, hill.y);
  jumpTo(w, 'l', hill.x + hill.w + 30);
  assert.equal(body(w, 'l').on, w.blocks[0], 'mini hill -> crate once it is pushed back');

  // the low step is one jump below the wall top
  w = new World(level);
  w.addBody('s', 0);
  standAt(w, 's', step.x + 20, step.y);
  jumpTo(w, 's', wall.x + 40);
  assert.ok(body(w, 's').y + PHYS.PH <= wall.y + 2, 'step -> wall in one jump');
});

test('round 2: a crate pushed into a player shoves them (never passes through), and stops if they are pinned', () => {
  const level = buildLevel('rootway', 5, 'normal');
  const seg = level.segments.find((x) => x.name === 'blockWall');
  const hill = level.solids.find((o) => o.x === seg.x0 + 10);
  const w = new World(level);
  const crate = w.blocks[0];
  crate.x = hill.x + hill.w + 120;
  const pushers = ['p0', 'p1', 'p2'];
  pushers.forEach((id, i) => { w.addBody(id, i); Object.assign(body(w, id), { x: crate.x + crate.w, y: GROUND - PHYS.PH - 1, vy: 0 }); });
  w.addBody('last', 5);
  Object.assign(body(w, 'last'), { x: crate.x - 40, y: GROUND - PHYS.PH - 1, vy: 0 });
  run(w, () => w.t > 3, 4, 'push back into the last player');
  const overlapping = () => { const b = body(w, 'last'); return b.x < crate.x + crate.w && b.x + PHYS.PW > crate.x && b.y < crate.y + crate.h && b.y + PHYS.PH > crate.y; };
  for (let i = 0; i < 60; i++) {
    pushers.forEach((id) => { body(w, id).in = { l: true, r: false, j: false }; });
    w.step();
    assert.ok(!overlapping(), 'the crate never overlaps the player');
  }
  assert.ok(body(w, 'last').x + PHYS.PW <= crate.x + 0.5, 'player is shoved ahead of the crate');
});

// ---------- Round 3, obstacle 1: tower, crate, plates and doors ----------

function towerDoorsWorld(n = 5) {
  const level = buildLevel('twin-lanterns', 5, 'normal');
  const seg = level.segments.find((x) => x.name === 'towerDoors');
  const w = new World(level);
  const ids = Array.from({ length: n }, (_, i) => `t${i}`);
  ids.forEach((id, i) => w.addBody(id, i));
  const find = (list, id) => list.find((o) => o.id === id);
  const parts = {
    crate: find(w.blocks, seg.crate), floorPlates: seg.floorPlates.map((p) => find(w.plates, p)),
    endPlate: find(w.plates, seg.endPlate), doors: seg.doors.map((d) => find(w.gates, d)), floorDoor: find(w.gates, seg.floorDoor),
  };
  return { w, seg, ids, ...parts };
}
const place = (w, id, x, feetY = GROUND) => Object.assign(body(w, id), { x, y: feetY - PHYS.PH, vx: 0, vy: 0, in: IDLE() });
const settle = (w, n = 10) => { for (let i = 0; i < n; i++) w.step(); };

test('round 3 obstacle 1: four stacked players cannot reach the ledge, five can', () => {
  for (const height of [4, 5]) {
    const { w, seg, ids } = towerDoorsWorld(height);
    const cpu = new CpuDirector(w, ids);
    const towerX = seg.edge - 60;
    ids.forEach((id) => place(w, id, towerX - 120));
    const gen = (function* () {
      yield* cpu.walk([ids[0]], towerX, { hop: false });
      for (const id of ids.slice(1)) yield* cpu.climbTower(id, towerX);
      yield* cpu.jumpTo(ids.at(-1), seg.edge + 20);
    })();
    run(w, () => gen.next().done, 60, `tower of ${height}`);
    const top = body(w, ids.at(-1));
    const made = top.x + PW / 2 > seg.edge && top.y + PHYS.PH <= GROUND - 238 + 2;
    assert.equal(made, height === 5, `tower of ${height} ${made ? 'reached' : 'did not reach'} the ledge`);
  }
});

test('round 3 obstacle 1: each floor plate opens just its own deck door, for a player or the crate', () => {
  const { w, ids, crate, floorPlates, doors } = towerDoorsWorld();
  const openDoors = () => doors.map((d) => (d.open ? 1 : 0)).join('');
  floorPlates.forEach((p, i) => {
    place(w, ids[0], p.x + 17);
    settle(w);
    assert.equal(openDoors(), '00000'.split('').map((_, k) => (k === i ? 1 : 0)).join(''), `player on plate ${i}`);
  });
  place(w, ids[0], floorPlates[0].x - 300);
  crate.x = floorPlates[2].x;
  settle(w);
  assert.equal(openDoors(), '00100', 'crate on plate 2');
  // all five at once: the crate plus four players
  floorPlates.filter((_, i) => i !== 2).forEach((p, i) => place(w, ids[i], p.x + 17));
  settle(w);
  assert.equal(openDoors(), '11111');
  place(w, ids[0], floorPlates[0].x - 300);
  settle(w);
  assert.equal(openDoors(), '01111', 'stepping off shuts that door again');
});

test('round 3 obstacle 1: the deck end plate holds the floor door open; the crate never passes it', () => {
  const { w, seg, ids, crate, floorPlates, endPlate, floorDoor } = towerDoorsWorld();
  crate.x = floorPlates[4].x + 2;
  settle(w);
  // three push the crate right, into the shut floor door, then while it's open
  for (const open of [false, true]) {
    place(w, ids[4], open ? endPlate.x + 12 : seg.edge - 300, open ? endPlate.y : GROUND);
    ids.slice(0, 3).forEach((id) => { place(w, id, crate.x - PW); body(w, id).in = { l: false, r: true, j: false }; });
    settle(w, 30);
    assert.equal(floorDoor.open, open);
    assert.ok(crate.x + crate.w <= floorDoor.x + 0.01, `crate stays left of the ${open ? 'open' : 'shut'} door`);
    idle(w, ids);
  }
  // a player can't slip past the shut door underneath the deck
  place(w, ids[4], seg.edge - 300);
  place(w, ids[0], crate.x + 20, GROUND - crate.h); // standing on the crate, walking into the door
  body(w, ids[0]).in = { l: false, r: true, j: false };
  settle(w, 60);
  assert.ok(!floorDoor.open && body(w, ids[0]).x + PW <= floorDoor.x + 0.01, 'shut floor door blocks the way');
});

// ---------- Round 3, obstacle 2: collapsing bridge and floating key ----------

function bridgeWorld(n) {
  const level = buildLevel('twin-lanterns', 5, 'normal');
  const seg = level.segments.find((x) => x.name === 'keyBridge');
  const w = new World(level);
  const ids = Array.from({ length: n }, (_, i) => `b${i}`);
  ids.forEach((id, i) => w.addBody(id, i));
  const tiles = w.crumbles.filter((c) => c.once);
  return { w, seg, ids, tiles };
}

test('round 3 obstacle 2: a lone walker crosses but drops every tile behind them; a follower falls and resets it', () => {
  const { w, seg, ids, tiles } = bridgeWorld(2);
  place(w, ids[0], seg.edge - 60);
  place(w, ids[1], seg.edge - 200);
  settle(w, 2);
  const startCp = w.cp;
  walk(w, [ids[0]], seg.end + 60, { hop: false });
  assert.ok(tiles.every((c) => c.goneUntil), 'whole bridge gone behind the walker');
  assert.equal(w.cp, startCp, "one player across doesn't move the team's checkpoint");
  let reset = false;
  run(w, () => {
    reset ||= w.events.some((e) => e.type === 'bridgeReset');
    w.events.length = 0;
    body(w, ids[1]).in = { l: false, r: true, j: false };
    return reset;
  }, 10, 'follower falls');
  idle(w, ids);
  assert.ok(tiles.every((c) => !c.goneUntil), 'bridge rebuilt');
  assert.ok(ids.every((id) => body(w, id).x < seg.edge), 'everyone on that stretch is back on the start floor');
});

test('round 3 obstacle 2: a tile drops under someone who stands still on it', () => {
  const { w, ids, tiles } = bridgeWorld(1);
  place(w, ids[0], tiles[3].x + 5);
  settle(w, 30);
  assert.ok(!tiles[3].goneUntil, 'holds for a moment');
  run(w, () => Boolean(tiles[3].goneUntil), 1, 'tile gives way'); // (the fall then resets the bridge)
});

test('round 3 obstacle 2: only the top of a five-high stack can reach the floating key', () => {
  for (const height of [4, 5]) {
    const { w, seg, ids } = bridgeWorld(height);
    const x = seg.keyX - PW / 2;
    ids.forEach((id, i) => place(w, id, x, GROUND - i * PHYS.PH));
    settle(w, 3);
    const top = body(w, ids.at(-1));
    top.in = { l: false, r: false, j: true };
    settle(w, 20);
    assert.equal(w.key.carrier === top.id, height === 5, `${height}-high stack ${w.key.carrier ? 'got' : 'missed'} the key`);
  }
});

// ---------- Round 4, obstacle 1: elevator timing ----------

function carWorld(n) {
  const level = buildLevel('crumbling-vault', 5, 'normal');
  const seg = level.segments.find((x) => x.name === 'elevatorTiming');
  const w = new World(level);
  const ids = Array.from({ length: n }, (_, i) => `e${i}`);
  ids.forEach((id, i) => w.addBody(id, i));
  const [shuttle, car, beam] = ['shuttle', 'car', 'beam'].map((k) => w.movers.find((m) => m.kind === k));
  return { w, seg, ids, shuttle, car, beam };
}
const onCar = (w, car, ids) => ids.forEach((id, i) => place(w, id, car.x + 4 + i * 28, car.y));

test('round 4 obstacle 1: the shuttle and the beam keep moving end to end on their own', () => {
  const { w, shuttle, beam, seg } = carWorld(0);
  let [lo, hi, minX, maxX, back] = [Infinity, -Infinity, Infinity, -Infinity, false];
  run(w, () => {
    lo = Math.min(lo, shuttle.y); hi = Math.max(hi, shuttle.y);
    minX = Math.min(minX, beam.x); maxX = Math.max(maxX, beam.x);
    back ||= beam.dx < 0;
    return w.t > 14;
  }, 15, 'cycle');
  assert.ok(lo <= shuttle.y2 + 0.5 && hi >= shuttle.y1 - 0.5, 'shuttle travels ground to deck');
  assert.ok(minX <= seg.car - 199 && maxX >= seg.right + 39 && back, 'beam sweeps the whole gap both ways');
});

test('round 4 obstacle 1: the car sinks for exactly three standing on it', () => {
  for (const [n, stackOne] of [[2, false], [3, false], [4, false], [4, true]]) {
    const { w, ids, car } = carWorld(n);
    onCar(w, car, stackOne ? ids.slice(0, 3) : ids);
    if (stackOne) place(w, ids[3], car.x + 4, car.y - PHYS.PH);
    settle(w, 15);
    assert.equal(car.phase !== 'top', n === 3 && !stackOne, `${n}${stackOne ? ' (one on a head)' : ''} -> ${car.phase}`);
  }
});

test('round 4 obstacle 1: three ride the car all the way to the floor; a fourth climbing on sends it back up', () => {
  const { w, ids, car } = carWorld(4);
  onCar(w, car, ids.slice(0, 3));
  run(w, () => car.phase === 'bottom', 4, 'down to the floor');
  assert.equal(car.y, GROUND, 'flush with the floor');
  const { w: w2, ids: crew, car: car2 } = carWorld(4);
  onCar(w2, car2, crew.slice(0, 3));
  run(w2, () => car2.y > car2.y1 + 60, 2, 'on its way down');
  place(w2, crew[3], car2.x + 100, car2.y - PHYS.PH);
  run(w2, () => car2.phase === 'top', 3, 'turns back with four aboard');
});

test('round 4 obstacle 1: a hop on the sunk car keeps it down; anyone leaving sends it straight back up', () => {
  const { w, ids, car } = carWorld(3);
  onCar(w, car, ids);
  run(w, () => car.phase === 'bottom', 4, 'sinks');
  body(w, ids[0]).in = { l: false, r: false, j: true };
  run(w, () => body(w, ids[0]).vy > 0, 1, 'hop apex');
  idle(w, ids);
  settle(w, 15);
  assert.equal(car.phase, 'bottom', 'a hop in place is not leaving');
  body(w, ids[2]).in = { l: false, r: true, j: true };
  run(w, () => car.phase === 'up', 1, 'rises once one has jumped out');
});

test('round 4 obstacle 1: the beam bars the gap on foot but passes over riders of the sunk car', () => {
  const { w, seg, ids, car, beam } = carWorld(4);
  place(w, ids[3], seg.deck + 20, car.y); // behind the beam at the far left of its sweep
  for (let i = 0; i < 20 * 30; i++) {
    body(w, ids[3]).in = { l: false, r: true, j: i % 20 === 0 };
    w.step();
    assert.ok(body(w, ids[3]).x + PW <= beam.x + 0.01, 'a lone player chasing the beam never gets past it');
  }
  assert.ok(body(w, ids[3]).x < seg.right, 'and is swept back off the far deck');
  const { w: w2, ids: crew, car: car2, beam: beam2 } = carWorld(3);
  onCar(w2, car2, crew);
  run(w2, () => beam2.x > car2.x + car2.w, 6, 'beam sweeps over');
  assert.equal(car2.phase, 'bottom');
  crew.forEach((id, i) => assert.ok(Math.abs(body(w2, id).x - (car2.x + 4 + i * 28)) < 1, 'riders never touched'));
});

test('round 4 obstacle 1: no way round underneath from the ground', () => {
  const { w, seg, ids } = carWorld(1);
  place(w, ids[0], seg.deck + 40);
  for (let i = 0; i < 12 * 30; i++) {
    body(w, ids[0]).in = { l: false, r: true, j: i % 10 === 0 };
    w.step();
  }
  assert.ok(body(w, ids[0]).x + PW <= seg.right + 181, 'stopped by the rock under the far deck');
});
