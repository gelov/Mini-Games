// Game-agnostic multiplayer room plumbing, shared by every Game Night server game.
// A game module supplies a Room class (see base-room.js) and an action map; this factory wires up
// room creation, joining, Server-Sent Events broadcast, and the generic action/HTTP routing.
import crypto from 'node:crypto';

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const clampInt = (v, [lo, hi], fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export const cleanName = (raw, max = 20) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;

/**
 * Builds the HTTP/SSE layer for a game: POST rooms (create), GET rooms/:code (peek), POST
 * rooms/:code/join, GET rooms/:code/events (SSE), POST rooms/:code/action.
 * The room class owns all game rules; this factory only owns transport + lifecycle.
 */
export function createRoomApi({ RoomClass, minPlayers, maxPlayers, actions }) {
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

  // High-rate per-player state (e.g. Team Escape's 30Hz world snapshots), sent as a named SSE event so
  // it never mixes with the room view. `build(playerId)` returns a pre-serialised string or an object.
  function frame(room, build) {
    const set = streams.get(room.code);
    if (!set) return;
    for (const s of set) {
      const data = build(s.player.id);
      if (data != null) s.res.write(`event: frame\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    }
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
        room.dispose?.();
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

  async function handle(req, res, url) {
    // /api/<game>/rooms[/:code[/join|/events|/action]]
    const parts = url.pathname.split('/').filter(Boolean).slice(2);
    try {
      if (parts[0] !== 'rooms') throw new GameError('Not found.', 404);

      if (parts.length === 1 && req.method === 'POST') {
        const body = await readJson(req);
        const room = new RoomClass(newCode(), broadcast, { minPlayers, maxPlayers, frame });
        rooms.set(room.code, room);
        const host = room.addPlayer(body.name);
        if (body.settings && room.updateSettings) room.updateSettings(host, body.settings);
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
          'Cache-Control': 'no-cache',
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
        const act = actions[body.type];
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
