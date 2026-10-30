// Team Escape server: lobby rules, start validation, live frames over SSE, and round scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createTeamEscapeApi, Room } from '../server/team-escape.js';

function startServer() {
  const api = createTeamEscapeApi();
  const server = http.createServer((req, res) => api.handle(req, res, new URL(req.url, 'http://x')));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, api, base: `http://127.0.0.1:${server.address().port}/api/team-escape` })));
}

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

/** Minimal SSE client: collects room views and frames. */
function listen(url) {
  const ctrl = new AbortController();
  const out = { views: [], frames: [], close: () => ctrl.abort() };
  fetch(url, { signal: ctrl.signal }).then(async (res) => {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        (block.startsWith('event: frame') ? out.frames : out.views).push(JSON.parse(data.slice(6)));
      }
    }
  }).catch(() => {});
  return out;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await wait(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

test('full lobby -> live match flow over HTTP/SSE with two teams of 5', async () => {
  const { server, api, base } = await startServer();
  try {
    const host = (await post(`${base}/rooms`, { name: 'Host', settings: { teamSize: 5, rounds: 2, roundMins: 2 } })).body;
    const code = host.code;
    const players = [host];
    for (let i = 1; i < 10; i++) players.push((await post(`${base}/rooms/${code}/join`, { name: `P${i}` })).body);
    assert.equal((await fetch(`${base}/rooms/ZZZZ`)).status, 404, 'bad codes are rejected');

    const streams = players.map((p) => listen(`${base}/rooms/${code}/events?token=${p.token}`));
    await until(() => streams.every((s) => s.views.length), 4000, 'views');
    const act = (p, type, extra = {}) => post(`${base}/rooms/${code}/action`, { token: p.token, type, ...extra });

    for (let i = 0; i < 10; i++) assert.equal((await act(players[i], 'team', { team: i < 5 ? 0 : 1 })).status, 200);
    const extra = (await post(`${base}/rooms/${code}/join`, { name: 'Late' })).body;
    assert.equal((await act(extra, 'team', { team: 0 })).status, 400, 'full teams refuse new players');
    assert.equal((await act(players[1], 'start')).status, 403, 'only the host starts');
    assert.match((await act(host, 'start')).body.error, /ready/, 'everyone must be ready');
    for (const p of players) await act(p, 'ready', { ready: true });
    assert.equal((await act(host, 'start')).status, 200);

    assert.equal((await act(players[2], 'team', { team: 1 })).status, 400, 'no team switching mid-match');
    assert.equal((await act(host, 'settings', { settings: { teamSize: 10 } })).status, 400, 'team size is locked mid-match');

    const room = api.rooms.get(code);
    assert.equal(room.phase, 'countdown');
    assert.equal(room.r.worlds[0].bodies.size, 5);
    assert.equal(room.r.worlds[1].bodies.size, 5);
    assert.deepEqual(room.r.worlds[0].level, room.r.worlds[1].level, 'both teams get the identical level');
    assert.equal(room.r.level.teamSize, 5);

    room.beginPlay(); // skip the 7s countdown
    const p0 = players[0];
    const before = room.r.worlds[0].bodies.get(p0.playerId).x;
    await act(p0, 'input', { r: true });
    await until(() => room.r.worlds[0].bodies.get(p0.playerId).x > before + 30, 3000, 'movement');
    await act(p0, 'input', { r: false });

    // frames: each player only gets their own team's world
    await until(() => streams[0].frames.length > 3 && streams[9].frames.length > 3, 3000, 'frames');
    assert.equal(streams[0].frames.at(-1).team, 0);
    assert.equal(streams[9].frames.at(-1).team, 1);
    assert.ok(streams[9].frames.at(-1).p.every(([id]) => players.slice(5).some((p) => p.playerId === id)));
    assert.equal(streams[0].frames.at(-1).teams.length, 2, 'opponent progress is included');

    streams.forEach((s) => s.close());
  } finally {
    for (const room of api.rooms.values()) room.dispose();
    server.closeAllConnections();
    server.close();
  }
});

// ---------- room rules without the network ----------

function fakeRoom(teamSize = 5) {
  const room = new Room('TEST', () => {}, { frame: () => {} });
  const host = room.addPlayer('Host');
  room.updateSettings(host, { teamSize, rounds: 2 });
  const ps = [host];
  for (let i = 1; i < teamSize * 2; i++) ps.push(room.addPlayer(`P${i}`));
  ps.forEach((p, i) => {
    p.online = true;
    room.setTeam(p, i < teamSize ? 0 : 1);
    room.setReady(p, true);
  });
  return { room, host, ps };
}

test('shrinking the team size moves the newest players out and un-readies everyone', () => {
  const { room, host } = fakeRoom(6);
  room.updateSettings(host, { teamSize: 5 });
  assert.equal(room.teamOf(0).length, 5);
  assert.equal(room.teamOf(1).length, 5);
  assert.equal([...room.players.values()].filter((p) => p.team === null).length, 2);
  assert.ok([...room.players.values()].every((p) => !p.ready));
});

for (const size of [5, 6, 7, 8, 9, 10]) {
  test(`match at ${size} per team uses the ${size}-player level for both teams`, () => {
    const { room, host } = fakeRoom(size);
    room.start(host);
    assert.equal(room.r.level.teamSize, size);
    assert.equal(room.r.worlds[0].bodies.size, size);
    assert.equal(room.r.worlds[1].bodies.size, size);
    assert.ok(room.r.level.plates.every((p) => p.need < size));
    room.dispose();
  });
}

test('scoring: faster team wins, timeouts compare progress, ties go to sudden death', () => {
  const { room, host } = fakeRoom(5);
  room.start(host);
  room.beginPlay();
  room.r.finish = [90_000, 120_000];
  room.endRound();
  let h = room.match.history.at(-1);
  assert.equal(h.winner, 0);
  assert.deepEqual(room.match.scores, [1, 0]);
  assert.equal(room.phase, 'results');

  room.startRound();
  room.beginPlay();
  room.r.worlds[1].cp = 2; // team 2 got further before time ran out
  room.endRound();
  h = room.match.history.at(-1);
  assert.equal(h.winner, 1);
  assert.equal(h.decidedBy, 'progress');
  assert.deepEqual(room.match.scores, [1, 1]);
  assert.equal(room.phase, 'results', 'tied after the last round -> sudden death');
  assert.equal(room.match.tiebreak, true);

  room.startRound();
  assert.equal(room.r.level.id, 'sudden-sprout');
  assert.equal(room.r.level.teamSize, 5);
  room.beginPlay();
  room.endRound(); // nobody moved: equal progress -> draw
  assert.equal(room.match.history.at(-1).winner, null);
  assert.deepEqual(room.match.scores, [1.5, 1.5]);
  assert.equal(room.phase, 'final');
  const f = room.finalSummary();
  assert.equal(f.winner, null);
  assert.equal(f.fastest.timeMs, 90_000);
  room.dispose();
});

test('a team finishes only when every required teammate is out; quitters do not block', () => {
  const { room, host, ps } = fakeRoom(5);
  room.start(host);
  room.beginPlay();
  const w = room.r.worlds[0];
  for (const p of ps.slice(0, 4)) {
    w.escaped.add(p.id);
    w.bodies.delete(p.id);
  }
  room.step();
  assert.equal(room.r.finish[0], null, 'one teammate still inside');
  room.leave(ps[4]);
  room.step();
  assert.ok(room.r.finish[0] !== null, 'left player is no longer required');
  room.dispose();
});

test('a dropped player still counts for a grace period (no disconnect exploits)', () => {
  const { room, host, ps } = fakeRoom(5);
  room.start(host);
  room.beginPlay();
  const w = room.r.worlds[0];
  for (const p of ps.slice(0, 4)) {
    w.escaped.add(p.id);
    w.bodies.delete(p.id);
  }
  ps[4].conns = 1;
  room.disconnect(ps[4]);
  room.step();
  assert.equal(room.r.finish[0], null);
  ps[4].offlineAt = Date.now() - 20_000;
  room.step();
  assert.ok(room.r.finish[0] !== null);
  room.dispose();
});

test('host hand-over skips bots and goes to the next online human', () => {
  const { room, host, ps } = fakeRoom(5);
  room.hostOfflineSince = Date.now() - 20_000;
  host.online = false;
  room.sweep(Date.now());
  assert.equal(room.hostId, ps[1].id);
});

test('host can fill both teams with CPUs, who then play a whole round on their own', () => {
  const room = new Room('CPUS', () => {}, { frame: () => {} });
  const host = room.addPlayer('Host');
  host.online = true;
  room.updateSettings(host, { teamSize: 5, rounds: 1 });
  room.addCpu(host, 0);
  assert.equal(room.teamOf(0).length, 1);
  room.addCpu(host, 'fill');
  assert.equal(room.teamOf(0).length, 5);
  assert.equal(room.teamOf(1).length, 5);
  assert.throws(() => room.addCpu(host, 1), /full/);
  assert.equal(room.startCheck(), null, 'CPUs are always ready');
  assert.deepEqual(room.onlineIds(), [host.id], 'CPUs never count as humans (host hand-over, idle cleanup)');

  room.start(host); // host spectates; both teams are all CPU
  room.beginPlay();
  for (let i = 0; i < 300 * 30 && room.phase === 'play'; i++) room.step();
  const h = room.match.history.at(-1);
  assert.ok(h, 'round finished without the timer');
  assert.ok(h.teams[0].done && h.teams[1].done, 'both CPU teams escaped');
  assert.throws(() => room.removeCpus(host), /between matches/);
  room.backToLobby(host);
  room.removeCpus(host);
  assert.equal(room.players.size, 1);
});
