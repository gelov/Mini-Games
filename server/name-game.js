// The Name Game: authoritative multiplayer server.
// Rooms live in memory. Clients receive a personalised view over Server-Sent Events and send actions over POST,
// so every rule (timers, hidden answers, giveaway words, scoring, Don't Bust) is enforced here, not in the browser.
import crypto from 'node:crypto';
import { CHARACTERS, CONNECTORS, findGiveaway } from './characters.js';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 100;
const OPTIONS_PER_PLAYER = 3;
const DECOYS = 4;
const RESULTS_SECS = 45;
const CLUE_MIN = 10;
const CLUE_MAX = 220;
const NAME_MAX = 20;
const HOST_GRACE_MS = 15_000;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;

const DECK_MODES = ['characters', 'employees'];
export const EMPLOYEE_MIN = OPTIONS_PER_PLAYER + DECOYS; // 7: the smallest deck that still deals distinct options + decoys
export const EMPLOYEE_MAX = 150;
const CHAR_NAME_MAX = 40;

export const DEFAULT_SETTINGS = { rounds: 3, describeSecs: 90, guessSecs: 60, deck: 'characters' };
const SETTING_LIMITS = { rounds: [1, 5], describeSecs: [45, 180], guessSecs: [20, 120] };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** "Most, but not everyone": how many correct guesses a description can take before it busts. */
export function bustLimit(guessers) {
  if (guessers <= 1) return 1;
  return Math.max(1, Math.min(guessers - 1, Math.ceil(guessers * 0.75)));
}

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const clampInt = (v, [lo, hi], fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const cleanName = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const cleanEmployeeName = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAR_NAME_MAX);

class Room {
  constructor(code, onChange) {
    this.code = code;
    this.onChange = onChange;
    this.players = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.employeeNames = []; // persists across rounds and back-to-lobby, independent of the active deck
    this.phase = 'lobby'; // lobby | describe | guess | results | final
    this.round = 0;
    this.r = null; // current round state
    this.lastResults = null;
    this.deadline = null;
    this.timer = null;
    this.hostId = null;
    this.hostOfflineSince = null;
    this.touched = Date.now();
    this.seq = 0;
  }

  // ---------- players ----------

  addPlayer(rawName) {
    const name = cleanName(rawName);
    if (!name) throw new GameError('Enter a display name.');
    const taken = [...this.players.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) {
      // a player who dropped off can reclaim their seat (new tab or device) by rejoining with the same name
      if (!taken.online) {
        taken.left = false;
        return taken;
      }
      throw new GameError('That name is already taken in this room.');
    }
    if (this.players.size >= MAX_PLAYERS) throw new GameError('This room is full.');
    const player = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomBytes(24).toString('hex'),
      name,
      score: 0,
      conns: 0,
      online: false,
      joinedAt: Date.now() + this.players.size, // keeps join order stable
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.changed();
    return player;
  }

  byToken(token) {
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  onlineIds() {
    return [...this.players.values()].filter((p) => p.online).map((p) => p.id);
  }

  connect(player) {
    player.conns++;
    player.online = true;
    if (player.id === this.hostId) this.hostOfflineSince = null;
    this.changed();
  }

  disconnect(player) {
    player.conns = Math.max(0, player.conns - 1);
    if (player.conns > 0) return;
    player.online = false;
    if (player.id === this.hostId) this.hostOfflineSince = Date.now();
    this.checkProgress();
    this.changed();
  }

  leave(player) {
    if (this.phase === 'lobby' || this.phase === 'final') {
      this.players.delete(player.id);
    } else {
      player.online = false;
      player.left = true;
    }
    if (player.id === this.hostId) this.passHost();
    this.checkProgress();
    this.changed();
  }

  passHost() {
    const next = [...this.players.values()]
      .filter((p) => p.online && p.id !== this.hostId)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) {
      this.hostId = next.id;
      this.hostOfflineSince = null;
    }
  }

  /** Called periodically: hand the host role on if the host has been gone for a while. */
  sweep(now) {
    if (this.hostOfflineSince && now - this.hostOfflineSince > HOST_GRACE_MS) {
      this.passHost();
      this.changed();
    }
  }

  // ---------- host controls ----------

  requireHost(player) {
    if (player.id !== this.hostId) throw new GameError('Only the host can do that.', 403);
  }

  updateSettings(player, patch = {}) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('Settings are locked during a game.');
    for (const key of Object.keys(SETTING_LIMITS)) {
      if (key in patch) this.settings[key] = clampInt(patch[key], SETTING_LIMITS[key], this.settings[key]);
    }
    if ('deck' in patch && DECK_MODES.includes(patch.deck)) this.settings.deck = patch.deck; // invalid values ignored
    this.changed();
  }

  setEmployeeNames(player, raw) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('Settings are locked during a game.');
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split('\n');
    const seen = new Set();
    const names = [];
    for (const entry of list) {
      const name = cleanEmployeeName(entry);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (names.length >= EMPLOYEE_MAX) break;
    }
    this.employeeNames = names;
    this.changed();
  }

  start(player) {
    this.requireHost(player);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('The game has already started.');
    if (this.onlineIds().length < MIN_PLAYERS) throw new GameError(`You need at least ${MIN_PLAYERS} players to start.`);
    if (this.settings.deck === 'employees' && this.employeeNames.length < EMPLOYEE_MIN) {
      throw new GameError(`Add at least ${EMPLOYEE_MIN} names to play with Offshorly employees (${this.employeeNames.length} so far).`);
    }
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
    this.startRound();
  }

  // ---------- rounds ----------

  startRound() {
    this.round++;
    const participants = this.onlineIds();
    const source = this.settings.deck === 'employees' ? this.employeeNames : CHARACTERS;
    const deck = shuffle(source);
    const options = {};
    participants.forEach((id, i) => {
      // unique across the room while the deck lasts; very large rooms wrap around and share some options
      options[id] = Array.from({ length: OPTIONS_PER_PLAYER }, (_, k) => deck[(i * OPTIONS_PER_PLAYER + k) % deck.length]);
    });
    this.r = {
      participants,
      options,
      picks: {},
      clues: {},
      order: [],
      candidates: [],
      index: 0,
      guesses: {},
      bustLimit: bustLimit(participants.length - 1),
      deck,
    };
    this.phase = 'describe';
    this.setDeadline(this.settings.describeSecs, () => this.endDescribe());
    this.changed();
  }

  pick(player, character) {
    const r = this.r;
    if (this.phase !== 'describe' || !r?.options[player.id]) throw new GameError('You are not describing this round.');
    if (r.clues[player.id]) throw new GameError('Your description is already locked in.');
    if (!r.options[player.id].includes(character)) throw new GameError('Pick one of your three characters.');
    r.picks[player.id] = character;
    this.changed();
  }

  submitClue(player, raw, chosen) {
    const r = this.r;
    if (this.phase !== 'describe' || !r?.options[player.id]) throw new GameError('You are not describing this round.');
    if (r.clues[player.id]) throw new GameError('Your description is already locked in.');
    // the pick can arrive with the clue, so a fast tap-then-submit can't race the separate pick request
    if (chosen !== undefined) {
      if (!r.options[player.id].includes(chosen)) throw new GameError('Pick one of your three characters.');
      r.picks[player.id] = chosen;
    }
    const character = r.picks[player.id];
    if (!character) throw new GameError('Pick a character first.');
    const clue = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (clue.length < CLUE_MIN) throw new GameError(`Write at least ${CLUE_MIN} characters.`);
    if (clue.length > CLUE_MAX) throw new GameError(`Keep it under ${CLUE_MAX} characters.`);
    const giveaway = findGiveaway(character, clue, this.settings.deck === 'employees' ? { minLen: 2, stops: CONNECTORS } : undefined);
    if (giveaway) throw new GameError(`No saying the name: "${giveaway}" gives it away.`);
    r.clues[player.id] = clue;
    this.changed();
    this.checkProgress();
  }

  endDescribe() {
    const r = this.r;
    r.order = shuffle(Object.keys(r.clues));
    if (r.order.length === 0) return this.endRound();
    const chosen = r.order.map((id) => r.picks[id]);
    const decoys = r.deck.filter((c) => !chosen.includes(c)).slice(-DECOYS);
    r.candidates = [...new Set([...chosen, ...decoys])].sort((a, b) => a.localeCompare(b));
    r.index = 0;
    this.startGuess();
  }

  startGuess() {
    const r = this.r;
    r.guesses[r.order[r.index]] = {};
    this.phase = 'guess';
    this.setDeadline(this.settings.guessSecs, () => this.endGuess());
    this.changed();
  }

  guess(player, character) {
    const r = this.r;
    if (this.phase !== 'guess') throw new GameError('There is nothing to guess right now.');
    const describer = r.order[r.index];
    if (player.id === describer) throw new GameError("You can't guess your own description.");
    if (!r.candidates.includes(character)) throw new GameError('Pick a character from the list.');
    const book = r.guesses[describer];
    if (book[player.id]) throw new GameError('Your guess is already locked in.');
    book[player.id] = character;
    this.changed();
    this.checkProgress();
  }

  endGuess() {
    const r = this.r;
    if (r.index + 1 < r.order.length) {
      r.index++;
      this.startGuess();
    } else {
      this.endRound();
    }
  }

  endRound() {
    const r = this.r;
    const reveals = r.order.map((describerId) => {
      const answer = r.picks[describerId];
      const book = r.guesses[describerId] ?? {};
      const correct = Object.keys(book).filter((id) => book[id] === answer);
      const bust = correct.length > r.bustLimit;
      const describerPoints = bust ? 0 : correct.length;
      for (const id of correct) this.award(id, 1);
      this.award(describerId, describerPoints);
      return {
        describerId,
        describerName: this.players.get(describerId)?.name ?? 'Someone',
        correctNames: correct.map((id) => this.players.get(id)?.name).filter(Boolean),
        answer,
        clue: r.clues[describerId],
        correctIds: correct,
        guessCount: Object.keys(book).length,
        bust,
        describerPoints,
      };
    });
    this.lastResults = { round: this.round, bustLimit: r.bustLimit, reveals };
    if (this.round >= this.settings.rounds) {
      this.phase = 'final';
      this.setDeadline(null);
    } else {
      this.phase = 'results';
      this.setDeadline(RESULTS_SECS, () => this.startRound());
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
    const online = new Set(this.onlineIds());
    if (this.phase === 'describe') {
      const waiting = r.participants.filter((id) => online.has(id) && !r.clues[id]);
      if (waiting.length === 0) this.endDescribe();
    } else if (this.phase === 'guess') {
      const describer = r.order[r.index];
      const book = r.guesses[describer];
      const waiting = [...online].filter((id) => id !== describer && !book[id]);
      if (waiting.length === 0) this.endGuess();
    }
  }

  setDeadline(secs, onTimeout) {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = secs ? Date.now() + secs * 1000 : null;
    this.deadlineSecs = secs || null;
    if (secs) this.timer = setTimeout(() => { onTimeout(); }, secs * 1000);
  }

  changed() {
    this.seq++;
    this.touched = Date.now();
    this.onChange(this);
  }

  // ---------- per-player view (never leaks other players' secrets) ----------

  viewFor(playerId) {
    const r = this.r;
    const online = new Set(this.onlineIds());
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
      bustPreview: bustLimit(Math.max(1, online.size - 1)),
      players,
      employee: {
        count: this.employeeNames.length,
        min: EMPLOYEE_MIN,
        max: EMPLOYEE_MAX,
        nameMax: CHAR_NAME_MAX,
        names: playerId === this.hostId ? this.employeeNames : undefined,
      },
    };

    if (this.phase === 'describe') {
      const mine = r.options[playerId];
      view.describe = {
        participating: Boolean(mine),
        options: mine ?? null,
        pick: r.picks[playerId] ?? null,
        clue: r.clues[playerId] ?? null,
        bustLimit: r.bustLimit,
        waitingOn: r.participants.filter((id) => !r.clues[id] && online.has(id)),
        doneIds: r.participants.filter((id) => r.clues[id]),
        clueMin: CLUE_MIN,
        clueMax: CLUE_MAX,
      };
    }

    if (this.phase === 'guess') {
      const describerId = r.order[r.index];
      const book = r.guesses[describerId];
      const isDescriber = describerId === playerId;
      view.guess = {
        index: r.index,
        total: r.order.length,
        describerId,
        clue: r.clues[describerId],
        candidates: r.candidates,
        isDescriber,
        answer: isDescriber ? r.picks[describerId] : null,
        yourGuess: book[playerId] ?? null,
        lockedIds: Object.keys(book),
        waitingOn: [...online].filter((id) => id !== describerId && !book[id]),
        bustLimit: r.bustLimit,
      };
    }

    if ((this.phase === 'results' || this.phase === 'final') && this.lastResults) {
      view.results = this.lastResults;
    }
    return view;
  }
}

// ---------- HTTP layer ----------

export function createNameGameApi() {
  const rooms = new Map();
  const streams = new Map(); // code -> Set<{ player, res }>

  function broadcast(room) {
    const set = streams.get(room.code);
    if (!set) return;
    for (const s of set) send(s.res, room.viewFor(s.player.id));
  }

  function send(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  function newCode() {
    for (let i = 0; i < 1000; i++) {
      let code = '';
      for (let j = 0; j < 4; j++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
    throw new GameError('Could not create a room, try again.', 503);
  }

  function getRoom(code) {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new GameError('Room not found. Check the code and try again.', 404);
    return room;
  }

  function auth(room, token) {
    const player = room.byToken(String(token || ''));
    if (!player || player.left) throw new GameError('You are not in this room.', 403);
    return player;
  }

  // housekeeping: host hand-over and idle room cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      room.sweep(now);
      const anyone = room.onlineIds().length > 0;
      if (!anyone && now - room.touched > ROOM_IDLE_MS) {
        clearTimeout(room.timer);
        rooms.delete(code);
        streams.delete(code);
      }
    }
  }, 5000).unref();

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8 * 1024) throw new GameError('Request too large.', 413);
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new GameError('Invalid request.');
    }
  }

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  const ACTIONS = {
    settings: (room, p, body) => room.updateSettings(p, body.settings),
    names: (room, p, body) => room.setEmployeeNames(p, body.names),
    start: (room, p) => room.start(p),
    pick: (room, p, body) => room.pick(p, body.character),
    clue: (room, p, body) => room.submitClue(p, body.clue, body.character),
    guess: (room, p, body) => room.guess(p, body.character),
    next: (room, p) => room.next(p),
    lobby: (room, p) => room.backToLobby(p),
    leave: (room, p) => room.leave(p),
  };

  async function handle(req, res, url) {
    // /api/name-game/rooms[/:code[/join|/events|/action]]
    const parts = url.pathname.split('/').filter(Boolean).slice(2);
    try {
      if (parts[0] !== 'rooms') throw new GameError('Not found.', 404);

      if (parts.length === 1 && req.method === 'POST') {
        const body = await readJson(req);
        const room = new Room(newCode(), broadcast);
        rooms.set(room.code, room);
        const host = room.addPlayer(body.name);
        if (body.settings) room.updateSettings(host, body.settings);
        return json(res, 201, { code: room.code, playerId: host.id, token: host.token });
      }

      const room = getRoom(parts[1]);

      if (parts.length === 2 && req.method === 'GET') {
        return json(res, 200, { code: room.code, phase: room.phase, players: room.players.size });
      }

      if (parts[2] === 'join' && req.method === 'POST') {
        const body = await readJson(req);
        const player = room.addPlayer(body.name);
        return json(res, 200, { code: room.code, playerId: player.id, token: player.token });
      }

      if (parts[2] === 'events' && req.method === 'GET') {
        const player = auth(room, url.searchParams.get('token'));
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 2000\n\n');
        const stream = { player, res };
        if (!streams.has(room.code)) streams.set(room.code, new Set());
        streams.get(room.code).add(stream);
        room.connect(player); // broadcasts, including to this new stream
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
          clearInterval(ping);
          streams.get(room.code)?.delete(stream);
          if (rooms.has(room.code)) room.disconnect(player);
        });
        return;
      }

      if (parts[2] === 'action' && req.method === 'POST') {
        const body = await readJson(req);
        const player = auth(room, body.token);
        const act = ACTIONS[body.type];
        if (!act) throw new GameError('Unknown action.');
        act(room, player, body);
        return json(res, 200, { ok: true });
      }

      throw new GameError('Not found.', 404);
    } catch (err) {
      if (err instanceof GameError) return json(res, err.status, { error: err.message });
      console.error(err);
      return json(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  return { handle, rooms };
}
