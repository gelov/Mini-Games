// Team Escape CPU players: an all-CPU team, driven tick by tick exactly as the server drives it, must
// escape every level at every team size and difficulty within the default 5-minute limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../team-escape/js/sim.js';
import { CpuDirector } from '../team-escape/js/cpu.js';
import { buildLevel, LEVELS, TIEBREAKER, TEAM_SIZES, DIFFICULTIES } from '../team-escape/js/levels.js';

function race(levelId, size, difficulty) {
  const w = new World(buildLevel(levelId, size, difficulty));
  const ids = Array.from({ length: size }, (_, i) => `cpu${i}`);
  ids.forEach((id, i) => w.addBody(id, i));
  const cpu = new CpuDirector(w, ids);
  for (let t = 0; t < 300 * 30 && w.escaped.size < size; t++) {
    cpu.tick();
    w.step();
  }
  return { w, cpu };
}

for (const def of [...LEVELS, TIEBREAKER]) {
  for (const size of TEAM_SIZES) {
    for (const difficulty of DIFFICULTIES) {
      test(`CPU team of ${size} escapes ${def.id} (${difficulty})`, () => {
        const { w, cpu } = race(def.id, size, difficulty);
        assert.equal(w.escaped.size, size, `escaped ${w.escaped.size}/${size} by ${w.t.toFixed(0)}s, stuck in segment ${cpu.seg} (${w.level.segments[cpu.seg]?.name}), ${cpu.retries} retries`);
      });
    }
  }
}

// A human playing alongside CPUs. The "human" is played by its own single-player director, which can't
// stack or hold a gate alone, so it only gets through if the CPUs wait for it at every plate, step and bridge.
function mixedRace(levelId, size) {
  const w = new World(buildLevel(levelId, size, 'normal'));
  const cpus = Array.from({ length: size - 1 }, (_, i) => `cpu${i}`);
  const human = 'human';
  [human, ...cpus].forEach((id, i) => w.addBody(id, i));
  const team = new CpuDirector(w, cpus, () => [human]);
  const player = new CpuDirector(w, [human], () => cpus);
  for (let t = 0; t < 300 * 30 && w.escaped.size < size; t++) {
    team.tick();
    player.tick();
    w.step();
  }
  return { w, team, player };
}

for (const def of [...LEVELS, TIEBREAKER]) {
  for (const size of TEAM_SIZES) {
    test(`1 human + ${size - 1} CPUs escape ${def.id} together`, () => {
      const { w, team, player } = mixedRace(def.id, size);
      assert.ok(w.escaped.has('human'), `human stuck in segment ${player.seg} (${w.level.segments[player.seg]?.name}); CPUs at ${team.seg}`);
      assert.equal(w.escaped.size, size);
    });
  }
}
