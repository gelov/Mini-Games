// Who's the Impostor?: authoritative multiplayer server.
// Everyone gets the same secret word except the impostor. Give clues one at a time, vote out the
// impostor, and the impostor can steal the round back by guessing the word. The server owns every
// rule (privacy, turn order, giveaway words, scoring) so the browser never sees secrets it shouldn't.
import crypto from 'node:crypto';
import { BaseRoom } from './base-room.js';
import { GameError, shuffle, clampInt, createRoomApi } from './room-core.js';
import { CATEGORIES } from './impostor-words.js';
import { findGiveaway } from './characters.js';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;
const CLUE_MAX = 30;
const STEAL_SECS = 30;
const RESULTS_SECS = 30;

export const DEFAULT_SETTINGS = { rounds: 5, clueSecs: 30, voteSecs: 45, category: 'random' };
const SETTING_LIMITS = { rounds: [1, 8], clueSecs: [15, 60], voteSecs: [20, 90] };
const CATEGORY_NAMES = Object.keys(CATEGORIES);

export const normalizeGuess = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim()
  .replace(/[^a-z0-9\s]+/g, '')
  .replace(/\s+/g, '');

export class Room extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, ...opts });
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = 'lobby'; // lobby | clue | vote | steal | results | final
    this.round = 0;
    this.r = null; // current round state
    this.lastResults = null;
  }

  // ---------- host controls ----------

  updateSettings(player, patch = {}) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('Settings are locked during a game.');
    for (const key of Object.keys(SETTING_LIMITS)) {
      if (key in patch) this.settings[key] = clampInt(patch[key], SETTING_LIMITS[key], this.settings[key]);
    }
    if ('category' in patch) {
      const c = patch.category;
      if (c === 'random' || CATEGORY_NAMES.includes(c)) this.settings.category = c; // invalid values ignored
    }
    this.changed();
  }

  start(player) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('The game has already started.');
    if (this.onlineIds().length < MIN_PLAYERS) throw new GameError(`You need at least ${MIN_PLAYERS} players to start.`);
    for (const p of this.players.values()) p.score = 0;
    this.round = 0;
    this.lastResults = null;
    this.startRound();
  }

  backToLobby(player) {
    this.requireHost(player);
    if (this.phase !== 'final') throw new GameError('Finish the game first.');
    for (const [id, p] of this.players) if (p.left) this.players.delete(id);
    for (const p of this.players.values()) p.score = 0;
    this.phase = 'lobby';
    this.round = 0;
    this.r = null;
    this.lastResults = null;
    this.setDeadline(null);
    this.changed();
  }

  next(player) {
    this.requireHost(player);
    if (this.phase !== 'results') throw new GameError('Nothing to skip to yet.');
    if (this.onlineIds().length < MIN_PLAYERS) throw new GameError(`You need at least ${MIN_PLAYERS} players to start a new round.`);
    this.startRound();
  }

  // ---------- rounds ----------

  startRound() {
    this.round++;
    const participants = this.onlineIds();
    const catName = this.settings.category === 'random'
      ? CATEGORY_NAMES[crypto.randomInt(CATEGORY_NAMES.length)]
      : this.settings.category;
    const words = CATEGORIES[catName] ?? CATEGORIES[CATEGORY_NAMES[0]];
    const word = words[crypto.randomInt(words.length)];
    const impostorId = participants[crypto.randomInt(participants.length)];
    this.r = {
      participants,
      impostorId,
      word,
      category: catName,
      order: shuffle(participants),
      index: 0,
      clues: {},
      votes: {},
      accused: null,
      stealGuess: null,
      stealOk: false,
    };
    this.phase = 'clue';
    this.setDeadline(this.settings.clueSecs, () => this.advanceClue());
    this.changed();
  }

  activeClueId() {
    const r = this.r;
    return r ? r.order[r.index] : undefined;
  }

  submitClue(player, raw) {
    const r = this.r;
    if (this.phase !== 'clue') throw new GameError('There is nothing to clue right now.');
    const active = this.activeClueId();
    if (player.id !== active) throw new GameError("It's not your turn to give a clue.");
    const clue = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!clue) throw new GameError('Write a clue.');
    if (clue.length > CLUE_MAX) throw new GameError(`Keep it under ${CLUE_MAX} characters.`);
    if (player.id !== r.impostorId) {
      const giveaway = findGiveaway(r.word, clue);
      if (giveaway) throw new GameError(`No saying the word: "${giveaway}" gives it away.`);
    }
    r.clues[player.id] = clue;
    this.advanceClue();
  }

  /** Move to the next clue-giver, skipping offline players; end the clue phase once the order is spent. */
  advanceClue() {
    const r = this.r;
    if (!r || this.phase !== 'clue') return;
    const active = this.activeClueId();
    if (active !== undefined && r.clues[active] === undefined) r.clues[active] = ''; // timeout/offline: shown as "—"
    r.index++;
    const online = new Set(this.onlineIds());
    while (r.index < r.order.length && !online.has(r.order[r.index])) {
      r.clues[r.order[r.index]] = '';
      r.index++;
    }
    if (r.index >= r.order.length) {
      this.startVote();
    } else {
      this.setDeadline(this.settings.clueSecs, () => this.advanceClue());
      this.changed();
    }
  }

  startVote() {
    const r = this.r;
    r.votes = {};
    this.phase = 'vote';
    this.setDeadline(this.settings.voteSecs, () => this.endVote());
    this.changed();
  }

  vote(player, targetId) {
    const r = this.r;
    if (this.phase !== 'vote') throw new GameError('There is nothing to vote on right now.');
    if (!r.participants.includes(player.id) || !this.onlineIds().includes(player.id)) {
      throw new GameError('You are not part of this round.');
    }
    if (r.votes[player.id]) throw new GameError('Your vote is already locked in.');
    if (targetId === player.id) throw new GameError("You can't vote for yourself.");
    if (!r.participants.includes(targetId)) throw new GameError('Pick a player from this round.');
    r.votes[player.id] = targetId;
    this.changed();
    this.checkProgress();
  }

  maybeEndVote() {
    const r = this.r;
    const online = new Set(this.onlineIds());
    const waiting = r.participants.filter((id) => online.has(id) && !r.votes[id]);
    if (waiting.length === 0) this.endVote();
  }

  endVote() {
    const r = this.r;
    const tally = new Map();
    for (const target of Object.values(r.votes)) tally.set(target, (tally.get(target) ?? 0) + 1);
    let accused = null;
    if (tally.size) {
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      if (sorted.length === 1 || sorted[0][1] > sorted[1][1]) accused = sorted[0][0]; // strict plurality only
    }
    r.accused = accused;
    if (accused && accused === r.impostorId && this.onlineIds().includes(r.impostorId)) {
      this.phase = 'steal';
      this.setDeadline(STEAL_SECS, () => this.finishRound());
      this.changed();
    } else {
      this.finishRound();
    }
  }

  steal(player, raw) {
    const r = this.r;
    if (this.phase !== 'steal') throw new GameError('There is nothing to steal right now.');
    if (player.id !== r.impostorId) throw new GameError('Only the impostor can guess the word.');
    if (r.stealGuess !== null) throw new GameError('You already guessed.');
    r.stealGuess = String(raw ?? '');
    const guess = normalizeGuess(r.stealGuess);
    r.stealOk = guess.length > 0 && guess === normalizeGuess(r.word);
    this.finishRound();
  }

  finishRound() {
    const r = this.r;
    const tally = new Map();
    for (const id of r.participants) tally.set(id, 0);
    for (const target of Object.values(r.votes)) tally.set(target, (tally.get(target) ?? 0) + 1);
    const caught = Boolean(r.accused && r.accused === r.impostorId);

    const points = [];
    for (const id of r.participants) {
      const p = this.players.get(id);
      let delta = 0;
      if (id === r.impostorId) {
        delta = caught ? (r.stealOk ? 2 : 0) : 2;
      } else if (r.votes[id] === r.impostorId) {
        delta = 1;
      }
      this.award(id, delta);
      points.push({ name: p?.name ?? 'Someone', delta });
    }

    this.lastResults = {
      round: this.round,
      word: r.word,
      category: r.category,
      impostorId: r.impostorId,
      impostorName: this.players.get(r.impostorId)?.name ?? 'Someone',
      accusedName: r.accused ? (this.players.get(r.accused)?.name ?? 'Someone') : null,
      caught,
      stealGuess: r.stealGuess,
      stealOk: r.stealOk,
      tally: [...tally.entries()].map(([id, votes]) => ({ id, name: this.players.get(id)?.name ?? 'Someone', votes })),
      clues: r.order.map((id) => ({ id, name: this.players.get(id)?.name ?? 'Someone', clue: r.clues[id] || '—', isImpostor: id === r.impostorId })),
      points,
    };

    if (this.round >= this.settings.rounds) {
      this.phase = 'final';
      this.setDeadline(null);
    } else {
      this.phase = 'results';
      this.setDeadline(RESULTS_SECS, () => {
        if (this.onlineIds().length >= MIN_PLAYERS) {
          this.startRound();
        } else {
          this.phase = 'final';
          this.setDeadline(null);
          this.changed();
        }
      });
    }
    this.changed();
  }

  award(id, points) {
    const p = this.players.get(id);
    if (p && points) p.score += points;
  }

  /** Advance early once everyone who is still here has acted. */
  checkProgress() {
    const r = this.r;
    if (!r) return;
    if (this.phase === 'clue') {
      const online = new Set(this.onlineIds());
      const active = this.activeClueId();
      if (active !== undefined && !online.has(active) && r.clues[active] === undefined) this.advanceClue();
    } else if (this.phase === 'vote') {
      this.maybeEndVote();
    }
  }

  // ---------- per-player view (never leaks other players' secrets) ----------

  viewFor(playerId) {
    const r = this.r;
    const players = [...this.players.values()]
      .filter((p) => !p.left)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, score: p.score, online: p.online }));
    const view = {
      now: Date.now(),
      seq: this.seq,
      code: this.code,
      phase: this.phase,
      you: playerId,
      hostId: this.hostId,
      round: this.round,
      settings: this.settings,
      deadline: this.deadline,
      deadlineSecs: this.deadlineSecs ?? null,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      categories: CATEGORY_NAMES,
      players,
    };

    if (r && this.phase === 'clue') {
      const isParticipant = r.participants.includes(playerId);
      const isImpostor = isParticipant && playerId === r.impostorId;
      const activeId = this.activeClueId();
      view.clue = {
        isParticipant,
        isImpostor,
        category: r.category,
        word: isParticipant && !isImpostor ? r.word : null,
        activeId,
        yourTurn: activeId === playerId,
        index: r.index,
        total: r.order.length,
        clues: r.order.slice(0, r.index).map((id) => ({ id, name: this.players.get(id)?.name ?? 'Someone', clue: r.clues[id] || '—' })),
        clueMax: CLUE_MAX,
      };
    }

    if (r && this.phase === 'vote') {
      const isParticipant = r.participants.includes(playerId);
      const isImpostor = isParticipant && playerId === r.impostorId;
      view.vote = {
        isParticipant,
        isImpostor,
        category: r.category,
        word: isParticipant && !isImpostor ? r.word : null,
        candidates: r.participants.filter((id) => id !== playerId),
        yourVote: r.votes[playerId] ?? null,
        lockedIds: Object.keys(r.votes),
        waitingOn: r.participants.filter((id) => this.onlineIds().includes(id) && !r.votes[id]),
        clues: r.order.map((id) => ({ id, name: this.players.get(id)?.name ?? 'Someone', clue: r.clues[id] || '—' })),
      };
    }

    if (r && this.phase === 'steal') {
      const isImpostor = playerId === r.impostorId;
      view.steal = {
        isImpostor,
        category: r.category,
        word: isImpostor ? null : r.word,
        accusedName: this.players.get(r.accused)?.name ?? 'Someone',
      };
    }

    if ((this.phase === 'results' || this.phase === 'final') && this.lastResults) {
      view.results = this.lastResults;
    }
    return view;
  }
}

export function createImpostorApi() {
  const ACTIONS = {
    settings: (room, p, body) => room.updateSettings(p, body.settings),
    start: (room, p) => room.start(p),
    clue: (room, p, body) => room.submitClue(p, body.clue),
    vote: (room, p, body) => room.vote(p, body.targetId),
    steal: (room, p, body) => room.steal(p, body.guess),
    next: (room, p) => room.next(p),
    lobby: (room, p) => room.backToLobby(p),
    leave: (room, p) => room.leave(p),
  };
  return createRoomApi({ RoomClass: Room, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, actions: ACTIONS });
}
