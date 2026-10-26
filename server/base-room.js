// Generic multiplayer room primitives shared by every Game Night game: players, connections,
// host hand-over and deadlines. A game module extends BaseRoom and implements checkProgress()/viewFor().
import crypto from 'node:crypto';
import { GameError, cleanName } from './room-core.js';

const HOST_GRACE_MS = 15_000;

export class BaseRoom {
  constructor(code, onChange, opts = {}) {
    this.code = code;
    this.onChange = onChange;
    this.minPlayers = opts.minPlayers ?? 2;
    this.maxPlayers = opts.maxPlayers ?? 100;
    this.players = new Map();
    this.phase = 'lobby';
    this.hostId = null;
    this.hostOfflineSince = null;
    this.timer = null;
    this.deadline = null;
    this.deadlineSecs = null;
    this.touched = Date.now();
    this.seq = 0;
  }

  // ---------- players ----------

  addPlayer(rawName, nameMax = 20) {
    const name = cleanName(rawName, nameMax);
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
    if (this.players.size >= this.maxPlayers) throw new GameError('This room is full.');
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

  // ---------- abstract: implemented by the game ----------

  /** Advance early once everyone who is still here has acted. Override per game. */
  checkProgress() {}

  /** Per-player view (never leaks other players' secrets). Override per game. */
  viewFor(_playerId) {
    throw new Error('viewFor() not implemented');
  }
}
