// Team Escape levels: a deterministic, team-size-aware builder shared by the server (authoritative sim)
// and the browser (renderer). Levels are hand-designed sequences of tested puzzle "segments"; the team
// size only picks which segments appear and how many players each one asks for, so every variant is a
// known, solvable layout. Same (levelId, teamSize, difficulty) in -> identical geometry out, for both teams.
import { PHYS } from './sim-constants.js';

export const TEAM_SIZES = [5, 6, 7, 8, 9, 10];
export const DIFFICULTIES = ['easy', 'normal', 'hard'];
export const GROUND = 400; // y of the ground surface
export const WORLD_H = 600;
const PIT_Y = GROUND + 50; // hazard strip at the bottom of every pit (shallow, so it stays on screen)

const TUNING = {
  //               lever window (s)  bridge (s)  crumble (s)  mover period (s)
  easy: { leverWin: 1.8, bridge: 9, crumble: 1.3, mover: 5.2 },
  normal: { leverWin: 1.3, bridge: 7, crumble: 0.9, mover: 4.4 },
  hard: { leverWin: 0.9, bridge: 5, crumble: 0.6, mover: 3.6 },
};

/** How many players each cooperative mechanic asks for, per team size. Never more than the team has. */
export function requirements(teamSize) {
  const s = TEAM_SIZES.includes(teamSize) ? teamSize : 5;
  return {
    tier: s <= 5 ? 0 : s <= 7 ? 1 : 2,
    plateNeed: Math.max(2, Math.floor(s / 2)), // 5:2 6:3 7:3 8:4 9:4 10:5
    levers: Math.min(4, Math.floor((s - 1) / 2)), // 5:2 6:2 7:3 8:3 9:4 10:4
    blockWeight: s <= 6 ? 2 : 3,
  };
}

// Heights chosen against the sim's physics (see PHYS / tests): a lone jump clears ~117px,
// standing on one teammate ~151px, on two ~185px.
export const CLIMB_H = 128; // needs a 2-player stack
export const TALL_CLIMB_H = 165; // needs a 3-player stack
export const BLOCK_WALL_H = 160; // block (60) + jump, or a 3-player stack
// Round 2's big crate: a square too tall to jump onto alone, pushed by 3 (never with anyone standing on it).
// The stair's low step is one jump below the wall top, but the crate blocks the way to it: stack to get over,
// and the left-behind player is helped by pushing the crate back to the mini hill, then hopping over it.
export const BIG_CRATE = 136;
const MINI_HILL_H = 45;
const STAIR_STEP_H = 70;
const STAIR_STEP_W = 90;
export const BIG_WALL_H = STAIR_STEP_H + 100; // one jump up from the low step
export const BIG_CRATE_PUSHERS = 3;
const LEVER_GAP = 430;
// Round 3's opening puzzle: a five-high tower puts one player on the upper deck. Each of the five floor plates
// opens the deck door above it (a player or the crate counts), so the four below plus the crate - pushed by
// three - must cover all five at once; the deck's end plate then opens the floor door for them.
// Round 3's collapsing bridge: every tile drops once whoever stood on it steps off (or after a short stand), so
// only one walker ever crosses - the team rides across as a stack on that walker. The key floats over the middle,
// reachable only by the top of a five-high stack (a four-high top can't touch it).
export const BRIDGE_TILES = 15;
export const BRIDGE_TILE_W = 37;
export const BRIDGE_KEY_H = 285; // key centre above the bridge
const TILE_HOLD = 1.5; // seconds a tile bears a standing player before it drops anyway
export const DECK_TOP = 238 + 73; // one jump up from the ledge (STACK_CLIFF_H + 73)
export const DECK_UNDER = 128; // headroom under the deck: three players high, never four
const LEDGE_UNDER = 56; // the ledge hangs low enough that the crate can't be pushed out to the tower spot
// Round 1: a cliff only a five-high tower reaches (a four-high tower tops out at ~219px), and a lift that
// only rises with five players standing on it, up to a key ledge no tower of five can reach from below.
export const STACK_CLIFF_H = 238;
export const STACK_NEED = 5;
export const LIFT_TOP = 280; // lift's raised surface and the hill's top: above any five-high tower's reach
export const KEY_HEIGHT = 345; // floating key: only reachable by jumping off the raised lift
export const LIFT_NEED = 5; // too far for one player to hit two levers inside any lever window
// Round 4's opening puzzle: a shuttle lifts the team to a wooden deck no tower reaches. A beam hangs from the sky over
// the gap to the next deck, sweeping across it; the only way past is the elevator car between the decks, which goes
// down to the floor only when exactly three stand on it (four or more and it stays put) and comes back up as soon
// as anyone steps off. So three ride it down, the rest walk on from the floor, one steps off and hops back on to
// send it up, timed so it arrives just after the beam has swept left, and everyone walks out on the far deck.
export const DECK_H = 280; // both decks: above any five-high tower's reach
export const CAR_NEED = 3;
export const CAR_W = 150; // five side by side

// ---------- segments: each appends entities at ctx.x and advances it ----------

function ground(ctx, w, top = GROUND) {
  ctx.solids.push({ x: ctx.x, y: top, w, h: WORLD_H - top + 40 });
  ctx.x += w;
}
const id = (ctx, p) => `${p}${ctx.n++}`;
const checkpoint = (ctx, x, y = GROUND, all = false) => ctx.checkpoints.push(all ? { x, y, all } : { x, y });
const sign = (ctx, x, y, text) => ctx.signs.push({ x, y, text });

const SEG = {
  start(ctx) {
    ctx.solids.push({ x: -40, y: -2000, w: 40, h: 2000 + WORLD_H + 40 }); // left world wall
    checkpoint(ctx, 70);
    sign(ctx, 200, GROUND, '← → move · ↑ jump');
    ground(ctx, 340);
    return 4;
  },

  steps(ctx) {
    const x = ctx.x;
    ground(ctx, 380);
    ctx.solids.push({ x: x + 80, y: GROUND - 50, w: 90, h: 50 }, { x: x + 170, y: GROUND - 100, w: 90, h: 100 });
    return 5;
  },

  /** Hold-open gate: `need` players on the plate keep it open; a 1-player plate past the gate frees the holders. */
  plateGate(ctx, { need }) {
    const x = ctx.x;
    ground(ctx, 460);
    const a = id(ctx, 'p');
    const b = id(ctx, 'p');
    const plateW = Math.max(90, need * 30 + 20);
    ctx.plates.push({ id: a, x: x + 40, y: GROUND, w: plateW, need });
    ctx.plates.push({ id: b, x: x + 340, y: GROUND, w: 70, need: 1 });
    ctx.gates.push({ id: id(ctx, 'g'), x: x + 280, y: -1600, w: 26, h: 1600 + GROUND, by: [a, b], mode: 'gate' });
    checkpoint(ctx, x + 360);
    sign(ctx, x + 40 + plateW / 2, GROUND - 4, `${need} on the plate`);
    return 12;
  },

  /** A ledge one player can't jump: stack on a teammate, then the top player holds a plate that drops steps. */
  climb(ctx, { tall = false } = {}) {
    const x = ctx.x;
    const h = tall ? TALL_CLIMB_H : CLIMB_H;
    ground(ctx, 180);
    const top = GROUND - h;
    ctx.solids.push({ x: ctx.x, y: top, w: 240, h: WORLD_H - top + 40 });
    const plate = id(ctx, 'p');
    ctx.plates.push({ id: plate, x: ctx.x + 30, y: top, w: 70, need: 1 });
    const steps = tall ? [[x + 40, GROUND - 55], [x + 120, GROUND - 110]] : [[x + 70, GROUND - 64]];
    for (const [sx, sy] of steps) {
      ctx.gates.push({ id: id(ctx, 'b'), x: sx, y: sy, w: 60, h: 18, by: [plate], mode: 'bridge' });
    }
    sign(ctx, x + 60, GROUND, tall ? 'Stack three high' : 'Stack up!');
    ctx.x += 240;
    checkpoint(ctx, ctx.x - 60, top);
    ground(ctx, 120);
    return tall ? 22 : 16;
  },

  /** A crate that needs `weight` players pushing together, used as a step up a wall. */
  /** A crate pushed against a wall as a step up. */
  blockWall(ctx, { weight, big = false }) {
    if (big) return SEG.bigCrate(ctx, { weight });
    const x = ctx.x;
    ctx.solids.push({ x: x + 10, y: GROUND - 18, w: 20, h: 18 }); // curb keeps the crate in this segment
    ground(ctx, 360);
    ctx.blocks.push({ id: id(ctx, 'k'), x: x + 120, y: GROUND - 60, w: 60, h: 60, weight });
    const top = GROUND - BLOCK_WALL_H;
    ctx.solids.push({ x: ctx.x, y: top, w: 200, h: WORLD_H - top + 40 });
    sign(ctx, x + 150, GROUND - 64, `Push ×${weight}`);
    ctx.x += 200;
    checkpoint(ctx, ctx.x - 60, top);
    ground(ctx, 120);
    return 20;
  },

  /** Round 2: the square crate blocks the way to the stair; mini hill far left for the push-back. */
  bigCrate(ctx, { weight }) {
    const x = ctx.x;
    ctx.solids.push({ x: x + 10, y: GROUND - MINI_HILL_H, w: 60, h: MINI_HILL_H }); // mini hill, far left
    ctx.blocks.push({ id: id(ctx, 'k'), x: x + 220, y: GROUND - BIG_CRATE, w: BIG_CRATE, h: BIG_CRATE, weight });
    // the crate starts 80px short of the stair and stops against its low step; teammates on the step
    // can still push it back (the step is low enough for them to reach the crate's side)
    const stepX = x + 220 + BIG_CRATE + 80;
    ground(ctx, stepX + STAIR_STEP_W - x);
    ctx.solids.push({ x: stepX, y: GROUND - STAIR_STEP_H, w: STAIR_STEP_W, h: STAIR_STEP_H }); // low stair step
    const top = GROUND - BIG_WALL_H;
    ctx.solids.push({ x: ctx.x, y: top, w: 200, h: WORLD_H - top + 40 });
    sign(ctx, x + 290, GROUND - BIG_CRATE - 4, `Push ×${weight}`);
    ctx.x += 200;
    checkpoint(ctx, ctx.x - 60, top);
    ground(ctx, 120);
    return 45;
  },

  /** Shuttle platform over a bramble pit. */
  moving(ctx, { period }) {
    const x = ctx.x;
    ground(ctx, 120);
    const pit = 380;
    ctx.hazards.push({ x: ctx.x, y: PIT_Y, w: pit, h: 40 });
    ctx.movers.push({ id: id(ctx, 'm'), x1: ctx.x + 4, x2: ctx.x + pit - 104, y: GROUND - 16, w: 100, h: 18, period });
    ctx.x += pit;
    ground(ctx, 160);
    checkpoint(ctx, ctx.x - 100);
    sign(ctx, x + 40, GROUND, 'Ride the platform');
    return 10 + period;
  },

  /** Stones that crumble shortly after someone stands on them, then grow back. */
  crumbles(ctx, { count, crumble }) {
    ground(ctx, 140);
    const pit = count * 130 + 50;
    ctx.hazards.push({ x: ctx.x, y: PIT_Y, w: pit, h: 40 });
    for (let i = 0; i < count; i++) {
      ctx.crumbles.push({ id: id(ctx, 'c'), x: ctx.x + 50 + i * 130, y: GROUND - 10 - (i % 2) * 30, w: 74, h: 22, time: crumble });
    }
    ctx.x += pit;
    ground(ctx, 160);
    checkpoint(ctx, ctx.x - 100);
    return 8 + count * 3;
  },

  /** A pit too wide to jump. A lantern on either side raises a timed bridge. */
  timedBridge(ctx, { dur }) {
    const x = ctx.x;
    ground(ctx, 220);
    const pit = 270;
    const l1 = id(ctx, 'l');
    const l2 = id(ctx, 'l');
    const g1 = id(ctx, 'G');
    const g2 = id(ctx, 'G');
    ctx.levers.push({ id: l1, x: x + 150, y: GROUND, dur }, { id: l2, x: x + 220 + pit + 60, y: GROUND, dur });
    ctx.groups.push({ id: g1, levers: [l1], latch: false }, { id: g2, levers: [l2], latch: false });
    ctx.hazards.push({ x: ctx.x, y: PIT_Y, w: pit, h: 40 });
    ctx.gates.push({ id: id(ctx, 'b'), x: ctx.x, y: GROUND, w: pit, h: 18, by: [g1, g2], mode: 'bridge' });
    ctx.x += pit;
    ground(ctx, 220);
    checkpoint(ctx, ctx.x - 80);
    sign(ctx, x + 150, GROUND - 70, `E: bridge for ${dur}s`);
    return 14;
  },

  /** `count` lanterns too far apart for one runner: all must be lit within the window to open the gate. */
  levers(ctx, { count, win }) {
    const x = ctx.x;
    const w = 200 + (count - 1) * LEVER_GAP + 200;
    ground(ctx, w + 140);
    const ids = [];
    for (let i = 0; i < count; i++) {
      const lid = id(ctx, 'l');
      ids.push(lid);
      ctx.levers.push({ id: lid, x: x + 200 + i * LEVER_GAP, y: GROUND, dur: win });
    }
    const g = id(ctx, 'G');
    ctx.groups.push({ id: g, levers: ids, latch: true });
    ctx.gates.push({ id: id(ctx, 'g'), x: x + w, y: -1600, w: 26, h: 1600 + GROUND, by: [g], mode: 'gate' });
    checkpoint(ctx, x + w + 80);
    sign(ctx, x + 200 + ((count - 1) * LEVER_GAP) / 2, GROUND - 60, `Light all ${count} together (E)`);
    return 18 + count * 3;
  },

  /** Round 3, obstacle 1: tower to the ledge, then crate + floor plates open the deck doors, and the deck's
   *  end plate opens the floor door. Geometry is recorded on the segment for the CPU solver. */
  towerDoors(ctx, seg) {
    const x = ctx.x;
    const edge = x + 300; // the ledge's left face; the tower stands just left of it
    const deck = edge + 50;
    const deckW = 730;
    ground(ctx, deck + deckW + 220 - x);
    ctx.solids.push({ x: edge, y: GROUND - STACK_CLIFF_H, w: 60, h: STACK_CLIFF_H - LEDGE_UNDER });
    ctx.solids.push({ x: deck, y: GROUND - DECK_TOP, w: deckW, h: DECK_TOP - DECK_UNDER });
    const floor = [0, 1, 2, 3, 4].map((i) => ({ id: id(ctx, 'p'), x: deck + 315 + i * 75, y: GROUND, w: 60, need: 1, quiet: true, crates: true }));
    ctx.plates.push(...floor);
    const crate = id(ctx, 'k');
    ctx.blocks.push({ id: crate, x: edge + 118, y: GROUND - 60, w: 60, h: 60, weight: 3 });
    const deckY = GROUND - DECK_TOP;
    const doors = [0, 1, 2, 3, 4].map((i) => ({
      id: id(ctx, 'g'), x: deck + 315 + i * 50, y: -1600, w: 14, h: 1600 + deckY, by: [floor[i].id], mode: 'gate', // plate i opens door i
    }));
    const endPlate = { id: id(ctx, 'p'), x: deck + 565, y: deckY, w: 50, need: 1, quiet: true };
    ctx.plates.push(endPlate);
    // the floor door sits right after the last plate, so a crate shoved all the way still rests on it
    const floorDoor = { id: id(ctx, 'g'), x: floor[4].x + floor[4].w + 3, y: GROUND - DECK_UNDER, w: 14, h: DECK_UNDER, by: [endPlate.id], mode: 'gate' };
    ctx.gates.push(...doors, floorDoor);
    Object.assign(seg, {
      edge, deck, deckEnd: deck + deckW, crate, floorPlates: floor.map((p) => p.id), endPlate: endPlate.id,
      doors: doors.map((d) => d.id), floorDoor: floorDoor.id,
    });
    checkpoint(ctx, ctx.x - 60);
    return 60;
  },

  /** Round 3, obstacle 2: the collapsing bridge over spikes, with the key floating above its middle. Falling in
   *  resets the whole attempt (tiles back, everyone on the bridge's start floor, key back if it was on them). */
  keyBridge(ctx, seg) {
    const x = ctx.x;
    ground(ctx, 220);
    checkpoint(ctx, x + 100);
    const edge = ctx.x;
    const span = BRIDGE_TILES * BRIDGE_TILE_W;
    const bridge = id(ctx, 'B');
    for (let i = 0; i < BRIDGE_TILES; i++) {
      ctx.crumbles.push({ id: id(ctx, 'c'), x: edge + i * BRIDGE_TILE_W, y: GROUND, w: BRIDGE_TILE_W, h: 16, once: true, hold: TILE_HOLD, bridge });
    }
    ctx.key = { x: edge + span / 2, y: GROUND - BRIDGE_KEY_H };
    ctx.x += span;
    ground(ctx, 260);
    ctx.hazards.push({ x: edge, y: PIT_Y, w: span, h: 40, resets: { bridge, x0: x, x1: ctx.x, spawnX: x + 100, spawnY: GROUND } });
    checkpoint(ctx, edge + span + 120, GROUND, true); // only once the whole team is across
    Object.assign(seg, { edge, end: edge + span, keyX: ctx.key.x });
    return 45;
  },

  /** Five-high stacking cliff across a small pit; holding the plate on top brings out steps for the others. */
  stackCliff(ctx) {
    const x = ctx.x;
    ground(ctx, 360);
    const edge = ctx.x; // start platform ends here; pit below, then the cliff
    const pit = 60;
    const top = GROUND - STACK_CLIFF_H;
    ctx.hazards.push({ x: edge, y: PIT_Y, w: pit, h: 40 });
    ctx.x += pit;
    ctx.solids.push({ x: ctx.x, y: top, w: 300, h: WORLD_H - top + 40 });
    const plate = id(ctx, 'p');
    ctx.plates.push({ id: plate, x: ctx.x + 40, y: top, w: 70, need: 1 });
    // steps up from the start platform to the cliff, there only while someone stands on the plate
    for (const [dx, h] of [[-230, 60], [-160, 120], [-90, 180]]) {
      ctx.gates.push({ id: id(ctx, 'b'), x: edge + dx, y: GROUND - h, w: 60, h: 18, by: [plate], mode: 'bridge' });
    }
    sign(ctx, x + 150, GROUND, `Stack ${STACK_NEED} high!`);
    ctx.x += 300;
    checkpoint(ctx, ctx.x - 80, top);
    return 30;
  },

  /** A lift that needs five riders to go up and turns straight back down at the top; the key floats to its left
   *  and the team has to jump from the top onto the hill on its right together, as it arrives. */
  liftKey(ctx) {
    const x = ctx.x;
    const top = GROUND - LIFT_TOP;
    const gap = 140; // a long jump: from the lift's edge you land right on the hill's lip
    ground(ctx, 220 + 120 + gap + 140 + 400); // arrival, lift, gap, hill, staircase + run-out to the exit
    const liftX = x + 220;
    const hillX = liftX + 120 + gap;
    ctx.movers.push({ id: id(ctx, 'm'), kind: 'lift', x: liftX, y1: GROUND - 18, y2: top, w: 120, h: 18, need: LIFT_NEED, speed: 80, dwell: 0, crossX: hillX }); // no pause at the top
    ctx.solids.push({ x: hillX, y: top, w: 140, h: WORLD_H - top + 40 });
    // staircase down the hill's right side, so anyone who ends up over there can climb back and help ride
    const hillEnd = hillX + 140;
    [240, 180, 120, 60].forEach((h, i) => {
      ctx.solids.push({ x: hillEnd + i * 60, y: GROUND - h, w: 60, h: WORLD_H - GROUND + h + 40 });
    });
    ctx.key = { x: liftX - 25, y: GROUND - KEY_HEIGHT }; // floating just off the lift's left edge
    sign(ctx, x + 110, GROUND - 40, `All ${LIFT_NEED} on the lift`);
    checkpoint(ctx, hillEnd + 320); // past the staircase
    return 40;
  },

  /** Shuttle up to a deck; a sweeping beam bars the gap to the next deck except to riders of the sunk car. */
  elevatorTiming(ctx, seg) {
    const x = ctx.x;
    const top = GROUND - DECK_H;
    const shuttleX = x + 160;
    const deck = shuttleX + 80 + 16;
    const car = deck + 340;
    const right = car + CAR_W;
    const rock = right + 180;
    const stairs = rock + 160;
    // the shuttle sinks flush into the ground at the bottom of its run, so the team just walks on
    ctx.solids.push({ x, y: GROUND, w: shuttleX - x, h: WORLD_H - GROUND + 40 }, { x: shuttleX, y: GROUND + 18, w: 80, h: WORLD_H - GROUND + 22 });
    ctx.x = shuttleX + 80;
    // the car sinks flush into the floor too
    ground(ctx, car - ctx.x);
    ctx.solids.push({ x: car, y: GROUND + 18, w: CAR_W, h: WORLD_H - GROUND + 22 });
    ctx.x = right;
    ground(ctx, stairs + 4 * 60 + 200 - ctx.x);
    checkpoint(ctx, x + 80);
    ctx.movers.push({ id: id(ctx, 'm'), kind: 'shuttle', x: shuttleX, y1: GROUND, y2: top, w: 80, h: 18, period: 8, dwell: 1.5 });
    ctx.solids.push({ x: deck, y: top, w: 340, h: 34, wood: true });
    const carM = { id: id(ctx, 'm'), kind: 'car', x: car, y1: top, y2: GROUND, w: CAR_W, h: 18, need: CAR_NEED, speed: 110 };
    const beam = { id: id(ctx, 'm'), kind: 'beam', x1: car - 200, x2: right + 40, y: -1600, w: 14, h: 1600 + top, period: 6.5 };
    ctx.movers.push(carM, beam);
    ctx.solids.push({ x: right, y: top, w: rock + 160 - right, h: 34, wood: true });
    ctx.solids.push({ x: rock, y: top + 34, w: 160, h: DECK_H - 34 });
    [224, 168, 112, 56].forEach((h, i) => ctx.solids.push({ x: stairs + i * 60, y: GROUND - h, w: 60, h }));
    sign(ctx, car + CAR_W / 2, top - 4, `Exactly ${CAR_NEED} sink the car`);
    checkpoint(ctx, stairs + 4 * 60 + 120, GROUND, true); // only once the whole team is down the stairs
    Object.assign(seg, { deck, car, right, stairs });
    return 45;
  },

  key(ctx, { ledge = false } = {}) {
    const x = ctx.x;
    ground(ctx, 360);
    if (ledge) {
      const top = GROUND - CLIMB_H;
      ctx.solids.push({ x: x + 150, y: top, w: 110, h: 20 }); // floating, so the team can walk underneath
      ctx.key = { x: x + 205, y: top - 34 };
      sign(ctx, x + 90, GROUND, 'Boost to the key');
    } else {
      ctx.solids.push({ x: x + 170, y: GROUND - 30, w: 60, h: 30 });
      ctx.key = { x: x + 200, y: GROUND - 64 };
    }
    return ledge ? 12 : 5;
  },

  exit(ctx) {
    const x = ctx.x;
    ground(ctx, 400);
    ctx.door = { x: x + 220, y: GROUND - 96, w: 70, h: 96 };
    ctx.solids.push({ x: ctx.x, y: -2000, w: 40, h: 2000 + WORLD_H + 40 }); // right world wall
    sign(ctx, x + 120, GROUND, 'Bring the key!');
    return 8;
  },
};

// ---------- level recipes ----------
// Each recipe returns the ordered segment list for a requirement profile `q` and difficulty tuning `d`.

export const LEVELS = [
  {
    id: 'mossy-steps',
    name: 'Mossy Steps',
    blurb: 'Stack five high, then ride the lift to the key.',
    // fixed design for every team size: both obstacles need exactly five players
    recipe: () => [['start'], ['stackCliff'], ['liftKey'], ['exit']],
  },
  {
    id: 'rootway',
    name: 'Rootway Bridge',
    blurb: 'Shove the crate, ride the leaves.',
    recipe: (q, d) => [
      ['start'], ['blockWall', { weight: BIG_CRATE_PUSHERS, big: true }], ['moving', { period: d.mover }],
      q.tier >= 1 && ['moving', { period: d.mover * 0.85 }],
      ['key'], ['plateGate', { need: q.plateNeed }],
      q.tier >= 2 && ['blockWall', { weight: BIG_CRATE_PUSHERS, big: true }],
      ['exit'],
    ],
  },
  {
    id: 'twin-lanterns',
    name: 'Twin Lanterns',
    blurb: 'Light every lantern at once.',
    recipe: (q, d) => [
      ['start'], ['towerDoors'], ['keyBridge'], ['levers', { count: q.levers, win: d.leverWin }],
      ['timedBridge', { dur: d.bridge }],
      q.tier >= 1 && ['plateGate', { need: q.plateNeed }],
      q.tier >= 2 && ['levers', { count: q.levers, win: d.leverWin }],
      ['exit'],
    ],
  },
  {
    id: 'crumbling-vault',
    name: 'Crumbling Vault',
    blurb: 'Cross before the stones give way.',
    recipe: (q, d) => [
      ['start'], ['elevatorTiming'], ['climb'],
      ['timedBridge', { dur: d.bridge }], ['key', { ledge: true }],
      q.tier >= 1 && ['crumbles', { count: 3, crumble: d.crumble }],
      ['plateGate', { need: q.plateNeed }],
      ['exit'],
    ],
  },
  {
    id: 'grand-escape',
    name: 'The Grand Escape',
    blurb: 'Everything you learned, all at once.',
    recipe: (q, d) => [
      ['start'], ['climb', { tall: q.tier >= 2 }], ['blockWall', { weight: q.blockWeight }],
      ['levers', { count: q.levers, win: d.leverWin }], ['moving', { period: d.mover }],
      ['key', { ledge: true }], ['plateGate', { need: q.plateNeed }],
      q.tier >= 1 && ['crumbles', { count: 3, crumble: d.crumble }],
      q.tier >= 2 && ['plateGate', { need: q.plateNeed }],
      ['exit'],
    ],
  },
];

export const TIEBREAKER = {
  id: 'sudden-sprout',
  name: 'Sudden Sprout',
  blurb: 'Tiebreaker. First team out takes the match.',
  recipe: (q) => [['start'], ['plateGate', { need: q.plateNeed }], ['climb'], ['key'], ['exit']],
};

export const levelFor = (round, tiebreak = false) => (tiebreak ? TIEBREAKER : LEVELS[(round - 1) % LEVELS.length]);
export const findLevel = (levelId) => (levelId === TIEBREAKER.id ? TIEBREAKER : LEVELS.find((l) => l.id === levelId));

/** Build the full geometry for a level at a team size and difficulty. Pure and deterministic. */
export function buildLevel(levelId, teamSize, difficulty = 'normal') {
  const def = findLevel(levelId);
  if (!def) throw new Error(`Unknown level ${levelId}`);
  const q = requirements(teamSize);
  const d = TUNING[difficulty] ?? TUNING.normal;
  const ctx = {
    x: 0, n: 0,
    solids: [], hazards: [], plates: [], gates: [], levers: [], groups: [], blocks: [], movers: [], crumbles: [],
    checkpoints: [], signs: [], key: null, door: null,
  };
  const segments = def.recipe(q, d).filter(Boolean).map(([name, opts]) => ({ name, ...(opts ?? {}) }));
  let expectedSecs = 0;
  for (const seg of segments) {
    seg.x0 = ctx.x;
    expectedSecs += SEG[seg.name](ctx, seg);
    seg.x1 = ctx.x;
  }
  return {
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    teamSize,
    difficulty,
    req: q,
    segments,
    width: ctx.x,
    height: WORLD_H,
    expectedSecs: Math.round(expectedSecs * (1 + teamSize / 20)),
    solids: ctx.solids, hazards: ctx.hazards, plates: ctx.plates, gates: ctx.gates, levers: ctx.levers,
    groups: ctx.groups, blocks: ctx.blocks, movers: ctx.movers, crumbles: ctx.crumbles,
    checkpoints: ctx.checkpoints, signs: ctx.signs, key: ctx.key, door: ctx.door,
    phys: PHYS,
  };
}
