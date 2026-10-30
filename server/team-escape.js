// Team Escape: authoritative multiplayer server. Two teams race through identical copies of a level.
// The server owns team assignment, the team size, level choice, physics (one World per team, 30 ticks/s),
// timers, round results and scoring; browsers only send inputs and draw what they're sent.
import { BaseRoom } from './base-room.js';
import { GameError, clampInt, cleanName, createRoomApi } from './room-core.js';
import { World } from '../team-escape/js/sim.js';
import { buildLevel, levelFor, TEAM_SIZES, DIFFICULTIES } from '../team-escape/js/levels.js';
import { PHYS } from '../team-escape/js/sim-constants.js';
import { CpuDirector } from '../team-escape/js/cpu.js';

const TEAM_NAMES = ['Team Moss', 'Team Ember'];
const MAX_ROOM = 24; // two teams of 10 plus a few spectators
const OFFLINE_GRACE_MS = 15_000; // a dropped teammate still counts toward "everyone escaped" for this long
const RESULTS_SECS = 25;
const DEV = process.env.TEAM_ESCAPE_DEV === '1';

export const DEFAULT_SETTINGS = { lobbyName: '', teamSize: 5, rounds: 5, roundMins: 5, difficulty: 'normal' };
const LIMITS = { rounds: [1, 9], roundMins: [2, 10] };

export class Room extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, { minPlayers: 10, maxPlayers: MAX_ROOM, ...opts });
    this.frame = opts.frame ?? (() => {});
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = 'lobby'; // lobby | countdown | play | results | final
    this.round = 0;
    this.match = null;
    this.r = null;
    this.tick = null;
  }

  // ---------- players & teams ----------

  addPlayer(rawName) {
    const p = super.addPlayer(rawName);
    p.team ??= null;
    p.ready ??= false;
    return p;
  }

  present(p) {
    return p.online || p.cpu;
  }

  onlineIds() {
    return [...this.players.values()].filter((p) => p.online && !p.cpu).map((p) => p.id);
  }

  passHost() {
    const next = [...this.players.values()]
      .filter((p) => p.online && !p.cpu && p.id !== this.hostId)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) {
      this.hostId = next.id;
      this.hostOfflineSince = null;
    }
  }

  teamOf(i) {
    return [...this.players.values()].filter((p) => p.team === i && !p.left).sort((a, b) => a.joinedAt - b.joinedAt);
  }

  setTeam(player, team) {
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError("Teams are locked while a match is on.");
    if (team !== null && team !== 0 && team !== 1) throw new GameError('Pick Team 1 or Team 2.');
    if (team === player.team) return;
    if (team !== null && this.teamOf(team).length >= this.settings.teamSize) throw new GameError(`${TEAM_NAMES[team]} is full.`);
    player.team = team;
    player.ready = false;
    this.changed();
  }

  setReady(player, ready) {
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('The match has already started.');
    if (player.team === null) throw new GameError('Join a team first.');
    player.ready = Boolean(ready);
    this.changed();
  }

  connect(player) {
    super.connect(player);
    const w = this.worldOf(player);
    if (w && (this.phase === 'play' || this.phase === 'countdown')) w.addBody(player.id, this.r.rosters[player.team].indexOf(player.id));
  }

  disconnect(player) {
    if (player.conns <= 1) {
      this.worldOf(player)?.removeBody(player.id);
      player.offlineAt = Date.now();
    }
    super.disconnect(player);
  }

  leave(player) {
    this.worldOf(player)?.removeBody(player.id);
    super.leave(player);
  }

  // ---------- host controls ----------

  updateSettings(player, patch = {}) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('Settings are locked during a match.');
    for (const key of Object.keys(LIMITS)) {
      if (key in patch) this.settings[key] = clampInt(patch[key], LIMITS[key], this.settings[key]);
    }
    if ('lobbyName' in patch) this.settings.lobbyName = cleanName(patch.lobbyName, 24);
    if ('difficulty' in patch && DIFFICULTIES.includes(patch.difficulty)) this.settings.difficulty = patch.difficulty;
    if ('teamSize' in patch) {
      const size = Number(patch.teamSize);
      if (!TEAM_SIZES.includes(size)) throw new GameError('Teams can be 5 to 10 players.');
      if (size !== this.settings.teamSize) {
        this.settings.teamSize = size;
        for (const i of [0, 1]) {
          // newest arrivals step out if a team shrank below its current headcount
          for (const p of this.teamOf(i).slice(size)) p.team = null;
        }
        for (const p of this.players.values()) if (!p.cpu) p.ready = false;
      }
    }
    this.changed();
  }

  kick(player, targetId) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('You can remove players between matches.');
    const target = this.players.get(targetId);
    if (!target || target.id === player.id) throw new GameError('Pick another player.');
    this.players.delete(target.id);
    this.changed();
  }

  promote(player, targetId) {
    this.requireHost(player);
    const target = this.players.get(targetId);
    if (!target || target.cpu || !target.online) throw new GameError('Pick an online player.');
    this.hostId = target.id;
    this.changed();
  }

  /** Host: add a CPU player to a team (or, with team = 'fill', top up both teams). CPUs solve puzzles
   *  themselves and wait for their human teammates, so a match can be tested with any number of people. */
  addCpu(player, team) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('Add CPUs between matches.');
    const teams = team === 'fill' ? [0, 1] : [Number(team)];
    if (!teams.every((t) => t === 0 || t === 1)) throw new GameError('Pick Team 1 or Team 2.');
    let added = 0;
    for (const t of teams) {
      while (this.teamOf(t).length < this.settings.teamSize) {
        const label = t ? 'Ember' : 'Moss';
        let k = 1;
        while ([...this.players.values()].some((p) => p.name === `CPU ${label} ${k}`)) k++;
        const cpu = super.addPlayer(`CPU ${label} ${k}`);
        Object.assign(cpu, { team: t, ready: true, cpu: true, online: true });
        added++;
        if (team !== 'fill') break;
      }
    }
    if (!added) throw new GameError(team === 'fill' ? 'Both teams are already full.' : 'That team is full.');
    this.changed();
  }

  removeCpus(player) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('Remove CPUs between matches.');
    for (const [id, p] of this.players) if (p.cpu) this.players.delete(id);
    this.changed();
  }

  /** Dev-only: finish the current round right now (scored from real progress) to test results screens. */
  devEndRound(player) {
    if (!DEV) throw new GameError('Dev tools are off.', 403);
    this.requireHost(player);
    if (this.phase === 'countdown') this.beginPlay();
    this.endRound();
  }

  startCheck() {
    const size = this.settings.teamSize;
    for (const i of [0, 1]) {
      const team = this.teamOf(i);
      if (team.length !== size) return `${TEAM_NAMES[i]} needs ${size} players (has ${team.length}).`;
      if (team.some((p) => !this.present(p))) return `Someone on ${TEAM_NAMES[i]} is offline.`;
      if (team.some((p) => !p.ready)) return `Waiting for everyone on ${TEAM_NAMES[i]} to ready up.`;
    }
    return null;
  }

  start(player) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('The match has already started.');
    const problem = this.startCheck();
    if (problem) throw new GameError(problem);
    // team size, difficulty and round count are frozen for the whole match
    this.match = {
      teamSize: this.settings.teamSize,
      difficulty: this.settings.difficulty,
      rounds: this.settings.rounds,
      roundMs: this.settings.roundMins * 60_000,
      rosters: [this.teamOf(0).map((p) => p.id), this.teamOf(1).map((p) => p.id)],
      scores: [0, 0],
      history: [],
      tiebreak: false,
    };
    this.round = 0;
    this.startRound();
  }

  restart(player) {
    this.requireHost(player);
    if (this.phase === 'lobby') throw new GameError('Start a match first.');
    this.stopRound();
    this.phase = 'final';
    this.start(player);
  }

  backToLobby(player) {
    this.requireHost(player);
    this.stopRound();
    for (const [id, p] of this.players) if (p.left) this.players.delete(id);
    for (const p of this.players.values()) if (!p.cpu) p.ready = false;
    this.phase = 'lobby';
    this.match = null;
    this.round = 0;
    this.setDeadline(null);
    this.changed();
  }

  next(player) {
    this.requireHost(player);
    if (this.phase !== 'results') throw new GameError('Nothing to skip to yet.');
    this.startRound();
  }

  // ---------- rounds ----------

  startRound() {
    const m = this.match;
    this.round++;
    const tiebreak = m.tiebreak;
    const def = levelFor(this.round, tiebreak);
    const level = buildLevel(def.id, m.teamSize, m.difficulty);
    const worlds = [new World(level), new World(level)];
    // both teams play the roster locked at match start, in the same spawn order
    m.rosters.forEach((ids, i) => ids.forEach((id, idx) => {
      const p = this.players.get(id);
      if (p && this.present(p) && !p.left) worlds[i].addBody(id, idx);
    }));
    // CPUs on each team get a director that plays for them and waits for that team's humans
    const cpus = worlds.map((w, i) => new CpuDirector(
      w,
      m.rosters[i].filter((id) => this.players.get(id)?.cpu),
      () => m.rosters[i].filter((id) => !this.players.get(id)?.cpu && w.bodies.has(id)),
    ));
    this.r = { levelId: def.id, levelName: def.name, level, worlds, cpus, tiebreak, startedAt: null, finish: [null, null], rosters: m.rosters };
    this.phase = 'countdown';
    this.setDeadline(this.round === 1 ? 7 : 4, () => this.beginPlay());
    this.startTicking();
    this.changed();
  }

  beginPlay() {
    this.phase = 'play';
    this.r.startedAt = Date.now();
    this.setDeadline(this.match.roundMs / 1000, () => this.endRound());
    this.changed();
  }

  startTicking() {
    clearInterval(this.tick);
    this.tick = setInterval(() => this.step(), PHYS.DT * 1000);
    this.tick.unref?.();
  }

  stopRound() {
    clearInterval(this.tick);
    this.tick = null;
  }

  dispose() {
    this.stopRound();
    clearTimeout(this.timer);
  }

  /** Teammates who must be through the door: on the roster, not quit, and not offline past the grace period. */
  required(team) {
    const now = Date.now();
    return this.r.rosters[team].filter((id) => {
      const p = this.players.get(id);
      if (!p || p.left) return false;
      return this.present(p) || now - (p.offlineAt ?? now) < OFFLINE_GRACE_MS;
    });
  }

  step() {
    const r = this.r;
    if (!r) return;
    const frames = [null, null];
    for (const i of [0, 1]) {
      const w = r.worlds[i];
      if (this.phase === 'play' && r.finish[i] === null) {
        r.cpus[i].tick();
        w.step();
      }
      const events = w.drainEvents();
      if (this.phase === 'play' && r.finish[i] === null) {
        const req = this.required(i);
        if (req.length && req.every((id) => w.escaped.has(id))) {
          r.finish[i] = Date.now() - r.startedAt;
          events.push({ type: 'teamDone', team: i });
          this.changed();
        }
      }
      frames[i] = { ...w.snapshot(), ev: events };
    }
    const summary = [0, 1].map((i) => this.teamSummary(i));
    const json = [0, 1].map((i) => JSON.stringify({ team: i, ...frames[i], teams: summary }));
    this.frame(this, (playerId) => {
      const p = this.players.get(playerId);
      return json[p?.team === 1 ? 1 : 0];
    });
    if (this.phase === 'play' && r.finish[0] !== null && r.finish[1] !== null) this.endRound();
  }

  teamSummary(i) {
    const r = this.r;
    const w = r.worlds[i];
    const req = this.required(i).length;
    return {
      done: r.finish[i] !== null,
      timeMs: r.finish[i],
      escaped: w.escaped.size,
      required: req,
      players: r.rosters[i].length,
      key: w.door.unlocked ? 'used' : w.key?.carrier ? 'held' : 'waiting',
      door: w.door.unlocked,
      progress: r.finish[i] !== null ? 1 : w.progress(req),
    };
  }

  endRound() {
    const r = this.r;
    const m = this.match;
    if (!r || (this.phase !== 'play' && this.phase !== 'countdown')) return;
    this.stopRound();
    const teams = [0, 1].map((i) => this.teamSummary(i));
    let winner = null;
    if (teams[0].done && teams[1].done) {
      winner = teams[0].timeMs === teams[1].timeMs ? null : teams[0].timeMs < teams[1].timeMs ? 0 : 1;
    } else if (teams[0].done || teams[1].done) {
      winner = teams[0].done ? 0 : 1;
    } else if (teams[0].progress !== teams[1].progress) {
      winner = teams[0].progress > teams[1].progress ? 0 : 1;
    }
    if (winner === null) {
      m.scores[0] += 0.5;
      m.scores[1] += 0.5;
    } else {
      m.scores[winner] += 1;
    }
    m.history.push({
      round: this.round, levelId: r.levelId, levelName: r.levelName, tiebreak: r.tiebreak,
      teams, winner, decidedBy: teams[0].done || teams[1].done ? 'time' : 'progress', scores: [...m.scores],
    });

    const regularDone = this.round >= m.rounds;
    if (r.tiebreak || (regularDone && m.scores[0] !== m.scores[1])) {
      this.phase = 'final';
      this.setDeadline(null);
    } else {
      if (regularDone) m.tiebreak = true; // tied after the last round: sudden death next
      this.phase = 'results';
      this.setDeadline(RESULTS_SECS, () => this.startRound());
    }
    this.changed();
  }

  // ---------- inputs ----------

  input(player, body) {
    if (this.phase !== 'play') return;
    this.worldOf(player)?.setInput(player.id, body);
  }

  worldOf(player) {
    if (!this.r || !player || (player.team !== 0 && player.team !== 1)) return null;
    if (!this.r.rosters[player.team].includes(player.id)) return null;
    return this.r.worlds[player.team];
  }

  // ---------- per-player view ----------

  finalSummary() {
    const m = this.match;
    if (!m) return null;
    const h = m.history;
    const roundsWon = [0, 1].map((i) => h.filter((x) => x.winner === i).length);
    let fastest = null;
    for (const x of h) {
      x.teams.forEach((t, i) => {
        if (t.done && (!fastest || t.timeMs < fastest.timeMs)) fastest = { team: i, timeMs: t.timeMs, round: x.round, levelName: x.levelName };
      });
    }
    const totals = [0, 1].map((i) => ({
      timeMs: h.reduce((s, x) => s + (x.teams[i].done ? x.teams[i].timeMs : 0), 0),
      completed: h.filter((x) => x.teams[i].done).length,
    }));
    const winner = m.scores[0] === m.scores[1] ? null : m.scores[0] > m.scores[1] ? 0 : 1;
    return { scores: m.scores, winner, roundsWon, fastest, totals };
  }

  viewFor(playerId) {
    const me = this.players.get(playerId);
    const players = [...this.players.values()]
      .filter((p) => !p.left)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, online: this.present(p), cpu: Boolean(p.cpu) }));
    const view = {
      now: Date.now(),
      seq: this.seq,
      code: this.code,
      phase: this.phase,
      you: me ? playerId : null,
      removed: !me,
      hostId: this.hostId,
      round: this.round,
      settings: this.settings,
      deadline: this.deadline,
      deadlineSecs: this.deadlineSecs ?? null,
      teamNames: TEAM_NAMES,
      teamSizes: TEAM_SIZES,
      difficulties: DIFFICULTIES,
      players,
      dev: DEV,
      startProblem: this.phase === 'lobby' || this.phase === 'final' ? this.startCheck() : null,
    };
    if (this.match) {
      const m = this.match;
      view.match = {
        teamSize: m.teamSize, difficulty: m.difficulty, rounds: m.rounds, roundMs: m.roundMs,
        rosters: m.rosters, scores: m.scores, history: m.history, tiebreakNext: m.tiebreak,
      };
    }
    if (this.r && this.phase !== 'lobby') {
      view.level = { id: this.r.levelId, name: this.r.levelName, tiebreak: this.r.tiebreak, blurb: this.r.level.blurb, req: this.r.level.req };
      view.teams = [0, 1].map((i) => this.teamSummary(i));
    }
    if (this.phase === 'final') view.final = this.finalSummary();
    return view;
  }
}

export function createTeamEscapeApi() {
  const ACTIONS = {
    settings: (room, p, body) => room.updateSettings(p, body.settings),
    team: (room, p, body) => room.setTeam(p, body.team ?? null),
    ready: (room, p, body) => room.setReady(p, body.ready),
    start: (room, p) => room.start(p),
    input: (room, p, body) => room.input(p, body),
    next: (room, p) => room.next(p),
    restart: (room, p) => room.restart(p),
    lobby: (room, p) => room.backToLobby(p),
    kick: (room, p, body) => room.kick(p, body.id),
    promote: (room, p, body) => room.promote(p, body.id),
    addCpu: (room, p, body) => room.addCpu(p, body.team),
    removeCpus: (room, p) => room.removeCpus(p),
    devEnd: (room, p) => room.devEndRound(p),
    leave: (room, p) => room.leave(p),
  };
  return createRoomApi({ RoomClass: Room, minPlayers: 10, maxPlayers: MAX_ROOM, actions: ACTIONS });
}
