// Team Escape client: renders the server's room view (lobby, results, final) and the live 30Hz world
// frames for your team, and sends inputs. The server owns every rule; this file only draws and asks.
import { SVG } from '../../brew-leap/js/sprites.js';
import { mountNightSky } from '../../shared/night-sky.js';
import { mountToggle, wireUiSounds, unlock } from '../../shared/sfx.js';
import { fireConfetti } from '../../shared/confetti.js';
import { buildLevel } from './levels.js';
import { Renderer } from './render.js';
import { EMBLEMS, TEAM_COLORS, KEY_SVG, sproutUrl } from './art.js';
import { sfx } from './audio.js';
import { characterReady } from './character.js';
import { api, session, lastName, normalizeCode, esc, clock, plural } from './ui.js';

document.querySelectorAll('[data-icon="mug"]').forEach((el) => { el.innerHTML = SVG.mug; });
mountNightSky(document.querySelector('.skyline'), { pillars: false });
mountToggle(document.querySelector('.topbar .sound-toggle'));
wireUiSounds(document);

const app = document.getElementById('app');
const statusEl = document.querySelector('[data-status]');
const toastEl = document.querySelector('[data-toast]');
const roomChip = document.querySelector('[data-room-chip]');
const code = normalizeCode(new URLSearchParams(location.search).get('room'));

let me = code ? session.get(code) : null;
let view = null;
let frame = null;
let offset = 0; // server clock - local clock
let es = null;
let sseErrors = 0;
let screen = null; // 'join' | 'lobby' | 'stage' | 'final' | 'gone'
let lastSeq = -1;

// ---------- small UI helpers ----------

function status(text) {
  statusEl.hidden = !text;
  statusEl.textContent = text || '';
}
let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}
const serverNow = () => Date.now() + offset;
const secsLeft = () => (view?.deadline ? Math.max(0, (view.deadline - serverNow()) / 1000) : 0);
const myPlayer = () => view?.players.find((p) => p.id === view.you);
const isHost = () => view && view.hostId === view.you;
const teamName = (i) => view?.teamNames?.[i] ?? `Team ${i + 1}`;
const emblem = (i, cls = '') => `<span class="emblem ${cls}" aria-hidden="true">${EMBLEMS[i]}</span>`;

async function act(type, extra = {}) {
  try {
    await api(`/rooms/${code}/action`, { token: me.token, type, ...extra });
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

// ---------- connection ----------

function connect() {
  es?.close();
  es = new EventSource(`/api/team-escape/rooms/${code}/events?token=${encodeURIComponent(me.token)}`);
  es.onopen = () => {
    sseErrors = 0;
    status(null);
  };
  es.onmessage = (e) => onView(JSON.parse(e.data));
  es.addEventListener('frame', (e) => onFrame(JSON.parse(e.data)));
  es.onerror = async () => {
    sseErrors++;
    status('Connection lost. Reconnecting…');
    try {
      await api(`/rooms/${code}`);
      if (sseErrors >= 3) {
        // the room is there but our seat isn't (removed, or the server restarted)
        es.close();
        session.clear(code);
        me = null;
        status(null);
        renderJoin("You're no longer in this lobby. Join again to jump back in.");
      }
    } catch (err) {
      if (err.status === 404) {
        es.close();
        status(null);
        renderGone('This lobby has closed or expired.');
      }
    }
  };
}

function onView(v) {
  if (v.seq < lastSeq) return;
  lastSeq = v.seq;
  offset = v.now - Date.now();
  const prev = view;
  view = v;
  if (v.removed) {
    es?.close();
    session.clear(code);
    renderGone('The host removed you from this lobby.');
    return;
  }
  roomChip.hidden = false;
  roomChip.querySelector('[data-room-code]').textContent = v.code;
  if (prev && prev.phase !== v.phase) onPhaseChange(prev.phase, v.phase);
  render();
}

function onPhaseChange(from, to) {
  if (to === 'countdown') frame = null;
  if (to === 'results' || to === 'final') {
    const h = view.match?.history.at(-1);
    const mine = myPlayer()?.team;
    if (h && h.winner !== null && h.winner === mine) sfx('win');
  }
  if (to === 'final') {
    const f = view.final;
    if (f && f.winner !== null && f.winner === myPlayer()?.team) fireConfetti();
  }
}

// ---------- rendering by phase ----------

function render() {
  if (!view) return;
  const phase = view.phase;
  if (phase === 'lobby') return renderLobby();
  if (phase === 'final') return renderFinal();
  return renderStage();
}

function renderGone(message) {
  screen = 'gone';
  stopStage();
  app.innerHTML = `<section class="game game--narrow"><div class="panel te-card">
    <h2>Lobby unavailable</h2><p>${esc(message)}</p>
    <div class="te-actions"><a class="btn btn--primary" href="./">Back to Team Escape</a></div>
  </div></section>`;
}

async function renderJoin(note = '') {
  screen = 'join';
  let info = null;
  try {
    info = await api(`/rooms/${code}`);
  } catch (err) {
    renderGone(err.status === 404 ? "That lobby code doesn't exist, or the lobby expired." : err.message);
    return;
  }
  app.innerHTML = `<section class="game game--narrow"><form class="panel te-card" data-join novalidate>
    <p class="eyebrow">Lobby ${esc(info.code)} · ${plural(info.players, 'player')}${info.phase !== 'lobby' ? ' · match in progress (you can spectate)' : ''}</p>
    <h2>Join Team Escape</h2>
    ${note ? `<p class="note">${esc(note)}</p>` : ''}
    <div><label class="label" for="join-name">Your display name</label>
    <input class="field" id="join-name" name="name" maxlength="20" autocomplete="nickname" required value="${esc(lastName.get())}"></div>
    <p class="error" data-error role="alert"></p>
    <div class="te-actions"><a class="btn" href="./">Cancel</a><button class="btn btn--primary" type="submit">Join lobby</button></div>
  </form></section>`;
  const form = app.querySelector('[data-join]');
  form.elements.name.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    const err = form.querySelector('[data-error]');
    if (!name) {
      err.textContent = 'Enter a display name.';
      return;
    }
    try {
      const res = await api(`/rooms/${code}/join`, { name });
      lastName.set(name);
      me = { token: res.token, playerId: res.playerId };
      session.set(code, me);
      app.innerHTML = '<p class="te-loading">Joining…</p>';
      connect();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}

// ---------- lobby ----------

function settingsPanel(host) {
  const s = view.settings;
  const seg = (name, values, current, label = (v) => v) => `<div class="segmented" role="group">${values.map((v) =>
    `<button type="button" class="segmented__btn" ${host ? `data-set="${name}" data-value="${v}"` : 'disabled'} aria-pressed="${v === current}">${label(v)}</button>`).join('')}</div>`;
  const stepper = (name, value, text, lo, hi) => `<div class="stepper">
    <button class="btn" type="button" ${host && value > lo ? `data-set="${name}" data-value="${value - 1}"` : 'disabled'} aria-label="Fewer">−</button>
    <output>${text}</output>
    <button class="btn" type="button" ${host && value < hi ? `data-set="${name}" data-value="${value + 1}"` : 'disabled'} aria-label="More">+</button></div>`;
  return `<div class="settings">
    <div class="setting setting--category"><span class="setting__label">Players per team<small>Puzzles are built for this size</small></span>${seg('teamSize', view.teamSizes, s.teamSize)}</div>
    <div class="setting"><span class="setting__label">Rounds</span>${stepper('rounds', s.rounds, s.rounds, 1, 9)}</div>
    <div class="setting"><span class="setting__label">Time per round</span>${stepper('roundMins', s.roundMins, `${s.roundMins} min`, 2, 10)}</div>
    <div class="setting setting--category"><span class="setting__label">Difficulty<small>Lantern window, bridge timers, crumble speed</small></span>${seg('difficulty', view.difficulties, s.difficulty, (v) => v[0].toUpperCase() + v.slice(1))}</div>
  </div>`;
}

function teamPanel(i) {
  const size = view.settings.teamSize;
  const members = view.players.filter((p) => p.team === i);
  const mine = myPlayer();
  const host = isHost();
  const slots = [];
  for (let n = 0; n < size; n++) {
    const p = members[n];
    if (!p) {
      const addCpu = host && (view.phase === 'lobby' || view.phase === 'final')
        ? `<button class="btn btn--sm slot__add" type="button" data-add-cpu="${i}">+ CPU</button>` : '';
      slots.push(`<li class="slot slot--empty"><span class="slot__avatar"></span><span class="slot__name">Open slot</span>${addCpu}</li>`);
      continue;
    }
    const tools = host && p.id !== view.you
      ? `<span class="slot__tools"><button class="icon-btn" type="button" data-kick="${p.id}" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}">✕</button>${p.online && !p.cpu ? `<button class="icon-btn" type="button" data-promote="${p.id}" title="Make host" aria-label="Make ${esc(p.name)} host">♛</button>` : ''}</span>`
      : '';
    slots.push(`<li class="slot ${p.online ? '' : 'is-offline'} ${p.id === view.you ? 'is-you' : ''}">
      <img class="slot__avatar" src="${sproutUrl(i, { eyes: p.ready ? 'happy' : 'open' })}" alt="">
      <span class="slot__name">${esc(p.name)}${p.id === view.hostId ? ' <span class="crown">host</span>' : ''}${p.cpu ? ' <span class="crown crown--cpu">CPU</span>' : ''}</span>
      <span class="slot__ready ${p.ready ? 'is-ready' : ''}">${p.online ? (p.ready ? 'Ready' : 'Not ready') : 'Offline'}</span>${tools}
    </li>`);
  }
  const full = members.length >= size;
  const inThis = mine?.team === i;
  const btn = inThis
    ? '<button class="btn btn--sm" type="button" data-team="none">Leave team</button>'
    : `<button class="btn btn--sm ${i ? 'btn--ember' : 'btn--teal'}" type="button" data-team="${i}" ${full ? 'disabled' : ''}>${full ? 'Team full' : 'Join Team'}</button>`;
  return `<section class="panel team team--${i}" aria-label="${esc(teamName(i))}">
    <header class="team__head">${emblem(i, 'emblem--lg')}<div><h3>${esc(teamName(i))}</h3><p class="team__count"><b>${members.length}</b> / ${size} players</p></div>${btn}</header>
    <ol class="slots">${slots.join('')}</ol>
  </section>`;
}

function renderLobby() {
  stopStage();
  screen = 'lobby';
  const host = isHost();
  const mine = myPlayer();
  const s = view.settings;
  const unassigned = view.players.filter((p) => p.team === null);
  const link = `${location.origin}${location.pathname}?room=${view.code}`;
  const hostP = view.players.find((p) => p.id === view.hostId);
  const ready = mine?.ready;
  app.innerHTML = `<section class="game te-lobby">
    <div class="panel bar">
      <span class="chip chip--teal">Lobby</span>
      <p class="bar__title"><small>${esc(s.lobbyName || 'Team Escape')}</small>Pick a team &amp; ready up</p>
      <div class="code" aria-label="Lobby code ${view.code}">${[...view.code].map((c) => `<span>${c}</span>`).join('')}</div>
    </div>

    <div class="te-teams">${teamPanel(0)}<div class="te-vs" aria-hidden="true">VS</div>${teamPanel(1)}</div>

    <div class="te-lobby__grid">
      <section class="panel te-card">
        <h3>Match settings</h3>
        ${settingsPanel(host)}
        ${host ? '' : `<p class="note">Only the host (<b>${esc(hostP?.name ?? '…')}</b>) can change these.${hostP && !hostP.online ? ' The host is offline; the role passes to the next player shortly.' : ''}</p>`}
      </section>
      <section class="panel te-card">
        <h3>Invite players</h3>
        <div class="share"><input class="field" readonly value="${esc(link)}" aria-label="Lobby link" data-link><button class="btn btn--sm" type="button" data-copy>Copy link</button></div>
        <p class="note">Each player joins on their own device with code <b>${view.code}</b>. Both teams need exactly <b>${s.teamSize}</b> players.</p>
        ${unassigned.length ? `<div><p class="label">Still choosing</p><ul class="chips">${unassigned.map((p) => `<li class="chip chip--muted">${esc(p.name)}${p.id === view.you ? ' (you)' : ''}</li>`).join('')}</ul></div>` : ''}
        <div class="te-actions te-actions--start">
          ${mine?.team !== null && mine?.team !== undefined ? `<button class="btn ${ready ? '' : 'btn--teal'}" type="button" data-ready="${ready ? 0 : 1}">${ready ? 'Not ready' : "I'm ready"}</button>` : '<p class="note">Join a team to ready up.</p>'}
          ${host ? `<button class="btn btn--primary" type="button" data-start ${view.startProblem ? 'aria-disabled="true"' : ''}>Start match</button>` : ''}
          ${host && view.players.filter((p) => p.team !== null).length < s.teamSize * 2 ? '<button class="btn btn--sm" type="button" data-fill-cpu>Fill empty slots with CPUs</button>' : ''}
          ${host && view.players.some((p) => p.cpu) ? '<button class="btn btn--sm" type="button" data-remove-cpus>Remove all CPUs</button>' : ''}
        </div>
        <p class="note" data-start-note>${esc(view.startProblem ?? (host ? 'Everyone is ready. Start when you like!' : 'Waiting for the host to start…'))}</p>
        <button class="linkish" type="button" data-leave>Leave lobby</button>
      </section>
    </div>
  </section>`;
}

// ---------- final ----------

function renderFinal() {
  stopStage();
  screen = 'final';
  const f = view.final;
  const m = view.match;
  const host = isHost();
  const w = f?.winner;
  const headline = w === null || w === undefined ? "It's a draw!" : `${esc(teamName(w))} escapes victorious!`;
  const rows = (m?.history ?? []).map((h) => `<tr>
    <td>${h.tiebreak ? 'SD' : h.round}</td><td>${esc(h.levelName)}</td>
    ${h.teams.map((t, i) => `<td class="${h.winner === i ? 'is-win' : ''}">${t.done ? clock(t.timeMs) : `DNF · ${Math.round(t.progress * 100)}%`}</td>`).join('')}
    <td>${h.winner === null ? 'Draw' : esc(teamName(h.winner))}</td></tr>`).join('');
  app.innerHTML = `<section class="game te-final">
    <div class="panel te-final__hero">
      ${w === null || w === undefined ? `${emblem(0, 'emblem--xl')}${emblem(1, 'emblem--xl')}` : emblem(w, 'emblem--xl')}
      <div><p class="eyebrow">Match complete</p><h2>${headline}</h2>
      <p class="te-score">${esc(teamName(0))} <b>${f?.scores[0] ?? 0}</b> – <b>${f?.scores[1] ?? 0}</b> ${esc(teamName(1))}</p></div>
    </div>
    <div class="te-stats">
      ${[0, 1].map((i) => `<div class="panel stat-card team--${i}">${emblem(i)}<h3>${esc(teamName(i))}</h3>
        <dl><div><dt>Rounds won</dt><dd>${f?.roundsWon[i] ?? 0}</dd></div>
        <div><dt>Total escape time</dt><dd>${f?.totals[i].completed ? clock(f.totals[i].timeMs) : '—'}</dd></div>
        <div><dt>Rounds completed</dt><dd>${f?.totals[i].completed ?? 0} / ${m?.history.length ?? 0}</dd></div></dl></div>`).join('')}
      <div class="panel stat-card"><span class="emblem" aria-hidden="true">${KEY_SVG}</span><h3>Fastest escape</h3>
        ${f?.fastest ? `<p class="te-big">${clock(f.fastest.timeMs)}</p><p>${esc(teamName(f.fastest.team))} · ${esc(f.fastest.levelName)}</p>` : '<p>No team escaped this match.</p>'}</div>
    </div>
    <div class="panel te-card"><h3>Round by round</h3><div class="table-wrap"><table class="te-table">
      <thead><tr><th>#</th><th>Level</th><th>${esc(teamName(0))}</th><th>${esc(teamName(1))}</th><th>Winner</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="te-actions te-actions--center">
      ${host ? '<button class="btn btn--primary btn--lg" type="button" data-restart>Play again</button><button class="btn btn--lg" type="button" data-lobby>Return to lobby</button>' : '<p class="note">Waiting for the host to play again or return to the lobby…</p>'}
      <button class="btn btn--lg" type="button" data-leave>Leave game</button>
    </div>
  </section>`;
}

// ---------- the live stage (countdown, play, results) ----------

let stage = null;

function renderStage() {
  const team = myPlayer()?.team ?? 0;
  if (screen !== 'stage' || !stage) mountStage();
  screen = 'stage';
  const L = view.level;
  const level = buildLevel(L.id, view.match.teamSize, view.match.difficulty);
  stage.level = level;
  stage.team = team === 1 ? 1 : 0;
  stage.renderer.setLevel(level);
  stage.names = new Map(view.players.map((p) => [p.id, p.name]));
  stage.el.dataset.team = String(stage.team);
  stage.el.querySelector('[data-devend]').hidden = !(view.dev && isHost());
  const hud = stage.el.querySelector('[data-hud-title]');
  hud.innerHTML = `<small>${L.tiebreak ? 'Sudden death' : `Round ${view.round} of ${view.match.rounds}`}</small>${esc(L.name)}`;
  stage.el.querySelector('[data-my-team]').innerHTML = `${emblem(stage.team)}<b>${esc(teamName(stage.team))}</b><span>${view.match.teamSize} players</span>`;
  renderOverlay();
}

function mountStage() {
  app.innerHTML = `<section class="stage" data-stage>
    <canvas class="stage__canvas" aria-label="Team Escape level"></canvas>
    <div class="hud">
      <div class="hud__box hud__round" data-hud-title></div>
      <div class="hud__box hud__timer"><span data-hud-time>0:00</span></div>
      <div class="hud__box hud__team">
        <div class="hud__teamname" data-my-team></div>
        <div class="hud__stats">
          <span class="hud__stat" data-key-status title="Key"></span>
          <span class="hud__stat" data-door-status title="Exit door"></span>
          <span class="hud__stat" data-escaped title="Escaped"></span>
        </div>
      </div>
      <div class="hud__box hud__opp" data-opp></div>
    </div>
    <div class="touch" data-touch hidden>
      <div class="touch__pad"><button type="button" data-key="l" aria-label="Move left">◀</button><button type="button" data-key="r" aria-label="Move right">▶</button></div>
      <div class="touch__pad"><button type="button" data-key="e" aria-label="Use">E</button><button type="button" data-key="j" aria-label="Jump">▲</button></div>
    </div>
    <div class="overlay" data-overlay hidden></div>
    <div class="overlay overlay--pause" data-pause hidden>
      <div class="panel te-card">
        <h2>Paused</h2>
        <p class="note">The race keeps running for everyone else. Your teammates are counting on you!</p>
        <div class="te-actions"><button class="btn btn--primary" type="button" data-resume>Resume</button>
        <button class="sound-toggle" type="button" data-pause-sound aria-pressed="false" aria-label="Mute sounds"></button></div>
        <ul class="te-controls">
          <li><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> Move</li>
          <li><kbd>W</kbd> / <kbd>↑</kbd> / <kbd>Space</kbd> Jump (land on a teammate to stand on them)</li>
          <li><kbd>E</kbd> Light a lantern · hand the key to a nearby teammate</li>
        </ul>
        <div class="te-actions"><button class="linkish" type="button" data-leave>Leave game</button>
        <button class="linkish" type="button" data-devend hidden>Dev: end round now</button></div>
      </div>
    </div>
  </section>`;
  const el = app.querySelector('[data-stage]');
  stage = {
    el,
    renderer: new Renderer(el.querySelector('canvas')),
    names: new Map(),
    team: 0,
    level: null,
    raf: 0,
    last: performance.now(),
  };
  mountToggle(el.querySelector('[data-pause-sound]'));
  document.body.classList.add('is-playing');
  if (matchMedia('(hover: none) and (pointer: coarse)').matches) el.querySelector('[data-touch]').hidden = false;
  wireTouch(el.querySelector('[data-touch]'));
  stage.raf = requestAnimationFrame(loop);
}

function stopStage() {
  if (!stage) return;
  cancelAnimationFrame(stage.raf);
  stage = null;
  document.body.classList.remove('is-playing');
  releaseAll();
}

let lastTick = null;
function loop(now) {
  if (!stage) return;
  const dt = Math.min(0.1, (now - stage.last) / 1000);
  stage.last = now;
  const controlId = view?.you;
  stage.renderer.draw(frame, { focusId: controlId, controlId, team: stage.team, names: stage.names, dt, time: now / 1000 });
  updateHud(now);
  stage.raf = requestAnimationFrame(loop);
}

function updateHud(now) {
  const el = stage.el;
  const phase = view.phase;
  const left = secsLeft();
  const t = Math.ceil(left);
  const timeEl = el.querySelector('[data-hud-time]');
  if (phase === 'play') {
    timeEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    timeEl.parentElement.classList.toggle('is-low', left <= 30);
  } else if (phase === 'countdown') {
    timeEl.textContent = 'Ready';
  } else {
    timeEl.textContent = 'Done';
  }
  if (phase === 'countdown' && t !== lastTick) {
    if (t <= 3 && t > 0) sfx('tick');
    lastTick = t;
    const n = el.querySelector('[data-count]');
    if (n) n.textContent = t > 0 ? String(t) : 'GO!';
  }

  const teams = frame?.teams ?? view.teams;
  if (teams) {
    const mine = teams[stage.team];
    const opp = teams[1 - stage.team];
    const keyText = { waiting: 'Key: find it', held: 'Key: carried', used: 'Key: used' }[mine.key];
    el.querySelector('[data-key-status]').innerHTML = `<i class="key-ico ${mine.key !== 'waiting' ? 'is-on' : ''}">${KEY_SVG}</i>${keyText}`;
    el.querySelector('[data-door-status]').innerHTML = `<i class="door-ico ${mine.door ? 'is-on' : ''}"></i>${mine.door ? 'Door open' : 'Door locked'}`;
    el.querySelector('[data-escaped]').innerHTML = `<b>${mine.escaped}</b>/${mine.required} out`;
    const pct = Math.round(opp.progress * 100);
    el.querySelector('[data-opp]').innerHTML = `${emblem(1 - stage.team)}<div class="opp__body"><span>${esc(teamName(1 - stage.team))}${opp.done ? ` · escaped ${clock(opp.timeMs, false)}` : ''}</span>
      <span class="meter"><span style="width:${pct}%;background:${TEAM_COLORS[1 - stage.team]}"></span></span></div><b>${opp.done ? 'OUT' : `${pct}%`}</b>`;
  }
}

function renderOverlay() {
  const ov = stage.el.querySelector('[data-overlay]');
  const phase = view.phase;
  if (phase === 'countdown') {
    const L = view.level;
    const req = L.req;
    ov.hidden = false;
    ov.className = 'overlay overlay--count';
    ov.innerHTML = `<div class="panel te-card te-countdown">
      <p class="eyebrow">${L.tiebreak ? 'Sudden death tiebreaker' : `Round ${view.round} of ${view.match.rounds}`} · ${view.match.teamSize} per team</p>
      <h2>${esc(L.name)}</h2><p>${esc(L.blurb)}</p>
      <p class="te-count" data-count>${Math.ceil(secsLeft())}</p>
      <ul class="te-goals"><li>Grab the key</li><li>Unlock the door</li><li>Get all ${view.match.teamSize} out</li></ul>
      <p class="note">${levelNotes(stage.level, req)}</p>
      ${view.round === 1 || L.tiebreak ? `<ul class="te-controls">
        <li><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> Move</li>
        <li><kbd>W</kbd> / <kbd>↑</kbd> / <kbd>Space</kbd> Jump · land on teammates to stack</li>
        <li><kbd>E</kbd> Light lanterns · pass the key</li><li><kbd>Esc</kbd> Pause menu</li></ul>` : ''}
      ${myPlayer()?.team === null ? '<p class="note">You are spectating Team Moss.</p>' : ''}
    </div>`;
    lastTick = null;
    return;
  }
  if (phase === 'results') {
    const h = view.match.history.at(-1);
    ov.hidden = false;
    ov.className = 'overlay overlay--results';
    ov.innerHTML = resultsCard(h);
    return;
  }
  ov.hidden = true;
  ov.innerHTML = '';
}

/** What this level asks of the team, so nobody is surprised by a 3-player plate. */
function levelNotes(level, req) {
  const notes = [];
  const segs = new Set(level.segments.map((x) => x.name));
  if (segs.has('stackCliff')) notes.push('stack <b>5</b> high to reach the cliff');
  if (segs.has('liftKey')) notes.push('get <b>5</b> on the lift');
  if (segs.has('plateGate')) notes.push(`plates need <b>${req.plateNeed}</b> players`);
  if (segs.has('climb') || level.segments.some((x) => x.name === 'key' && x.ledge)) notes.push(`stack up on ${level.segments.some((x) => x.tall) ? '<b>2</b> teammates' : 'a teammate'}`);
  if (segs.has('levers')) notes.push(`light <b>${req.levers}</b> lanterns at once`);
  if (segs.has('blockWall')) notes.push(`crates need <b>${req.blockWeight}</b> pushers`);
  if (segs.has('elevatorTiming')) notes.push('exactly <b>3</b> sink the car');
  if (segs.has('timedBridge') || segs.has('moving') || segs.has('crumbles')) notes.push('watch the timing');
  return notes.length ? `This level: ${notes.join(' · ')}` : '';
}

const MESSAGES = {
  win: ['Clean escape!', 'Teamwork makes the door work.', 'Out before the lanterns cooled!'],
  draw: ['Dead heat!', 'Neck and neck — nobody blinked.'],
  timeout: ['The ruins kept everyone… this time.', 'Close! Progress decides it.'],
};
const pick = (list, n) => list[n % list.length];

function resultsCard(h) {
  const host = isHost();
  const m = view.match;
  const msg = h.winner === null ? pick(MESSAGES.draw, h.round) : h.decidedBy === 'progress' ? pick(MESSAGES.timeout, h.round) : pick(MESSAGES.win, h.round);
  const line = (i) => {
    const t = h.teams[i];
    return `<li class="res-row team--${i} ${h.winner === i ? 'is-win' : ''}">${emblem(i)}<b>${esc(teamName(i).toUpperCase())}</b>
      <span>${t.done ? clock(t.timeMs) : `DNF · ${Math.round(t.progress * 100)}% progress`}</span></li>`;
  };
  const dots = Array.from({ length: m.rounds }, (_, i) => {
    const r = m.history.find((x) => x.round === i + 1 && !x.tiebreak);
    return `<span class="dot ${r ? (r.winner === null ? 'is-draw' : `is-t${r.winner}`) : ''}"></span>`;
  }).join('');
  return `<div class="panel te-card te-results">
    <p class="eyebrow">${h.tiebreak ? 'Sudden death' : `Round ${h.round}`} · ${esc(h.levelName)}</p>
    <ul class="res-rows">${line(0)}${line(1)}</ul>
    <h2>${h.winner === null ? 'ROUND DRAW' : `ROUND WINNER: ${esc(teamName(h.winner).toUpperCase())}`}</h2>
    <p class="te-score">MATCH SCORE: <b>${h.scores[0]}–${h.scores[1]}</b></p>
    <p class="te-msg">${esc(msg)}</p>
    <div class="dots" aria-label="Match progress">${dots}</div>
    ${m.tiebreakNext ? '<p class="note"><b>All square!</b> Sudden-death tiebreaker next.</p>' : ''}
    <p class="note">Next round in <b data-next>${Math.ceil(secsLeft())}</b>s</p>
    ${host ? `<div class="te-actions"><button class="btn btn--primary" type="button" data-next-round>${m.tiebreakNext ? 'Start sudden death' : 'Next round'}</button>
      <button class="btn btn--sm" type="button" data-restart>Restart match</button><button class="btn btn--sm" type="button" data-lobby>Back to lobby</button></div>` : ''}
  </div>`;
}

setInterval(() => {
  const n = document.querySelector('[data-next]');
  if (n) n.textContent = String(Math.ceil(secsLeft()));
}, 250);

// ---------- frames & events ----------

let prevPhaseForGo = null;
function onFrame(f) {
  const team = stage?.team ?? 0;
  if (f.team !== team) return;
  frame = f;
  if (view?.phase === 'play' && prevPhaseForGo !== 'play') sfx('go');
  prevPhaseForGo = view?.phase;
  if (!stage) return;
  const R = stage.renderer;
  const L = stage.level;
  const pos = (id) => {
    const p = f.p.find((x) => x[0] === id);
    return p ? { x: p[1] + 13, y: p[2] } : null;
  };
  const mineId = view.you;
  for (const e of f.ev ?? []) {
    switch (e.type) {
      case 'jump': if (e.by === mineId) sfx('jump'); break;
      case 'lever': {
        const l = L.levers.find((x) => x.id === e.id);
        sfx('lever');
        if (l) R.float(l.x, l.y - 110, 'Lit!', '#ffd166');
        break;
      }
      case 'plateOn': sfx('plate'); break;
      case 'unlockGroup': sfx('unlock'); toast('All lanterns lit — the gate is open!'); break;
      case 'open': if (e.mode === 'gate') sfx('open'); break;
      case 'key': {
        sfx('key');
        const p = pos(e.by);
        if (p) { R.burst(p.x, p.y, '#ffd166', 14); R.float(p.x, p.y - 30, `${stage.names.get(e.by) ?? 'Someone'} has the key!`, '#ffd166'); }
        break;
      }
      case 'pass': {
        const p = pos(e.to);
        if (p) R.float(p.x, p.y - 30, 'Key passed!', '#ffd166');
        break;
      }
      case 'unlock': sfx('unlock'); R.burst(L.door.x + L.door.w / 2, L.door.y + 30, '#ffd166', 24, 220); R.float(L.door.x + L.door.w / 2, L.door.y - 40, 'Door unlocked!', '#ffd166'); break;
      case 'escape': sfx('escape'); R.burst(L.door.x + L.door.w / 2, L.door.y + 60, TEAM_COLORS[team], 10); break;
      case 'fall': if (e.by === mineId) { sfx('fall'); toast('Oops! Try again from your team\'s last safe spot.'); } break;
      case 'checkpoint': sfx('checkpoint'); break;
      case 'crumble': sfx('crumble'); break;
      case 'nothing': if (e.by === mineId) sfx('nope'); break;
      case 'teamDone': sfx('win'); toast('Your whole team escaped!'); break;
      default:
    }
  }
}

// ---------- input ----------

const keys = { l: false, r: false, j: false };
let ec = 0;
let jc = 0;
let sending = false;
let pending = false;

function sendInput() {
  if (view?.phase !== 'play') return;
  if (sending) {
    pending = true;
    return;
  }
  sending = true;
  const body = { token: me.token, type: 'input', ...keys, ec, jc };
  api(`/rooms/${code}/action`, body)
    .catch(() => {})
    .finally(() => {
      sending = false;
      if (pending) {
        pending = false;
        sendInput();
      }
    });
}

function setKey(k, down) {
  if (k === 'e') {
    if (down) {
      ec++;
      sendInput();
    }
    return;
  }
  if (keys[k] === down) return;
  keys[k] = down;
  if (k === 'j' && down) jc++;
  sendInput();
}

function releaseAll() {
  const any = keys.l || keys.r || keys.j;
  keys.l = keys.r = keys.j = false;
  if (any) sendInput();
}

const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'j', KeyW: 'j', Space: 'j', KeyE: 'e' };

window.addEventListener('keydown', (e) => {
  if (screen !== 'stage') return;
  if (e.target.closest?.('input, textarea, select')) return;
  const pause = stage?.el.querySelector('[data-pause]');
  if (e.code === 'Escape') {
    e.preventDefault();
    pause.hidden = !pause.hidden;
    releaseAll();
    return;
  }
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault(); // no page scrolling while playing
  if (!pause.hidden || e.repeat) return;
  unlock();
  setKey(k, true);
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k && screen === 'stage') setKey(k, false);
});
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

function wireTouch(pad) {
  pad.querySelectorAll('[data-key]').forEach((btn) => {
    const k = btn.dataset.key;
    const down = (e) => { e.preventDefault(); unlock(); btn.classList.add('is-down'); setKey(k, true); };
    const up = (e) => { e.preventDefault(); btn.classList.remove('is-down'); setKey(k, false); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  });
}

// ---------- clicks ----------

app.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  const d = t.dataset;
  if (d.set) {
    const value = d.set === 'difficulty' ? d.value : Number(d.value);
    act('settings', { settings: { [d.set]: value } });
  } else if (d.team) {
    act('team', { team: d.team === 'none' ? null : Number(d.team) });
  } else if (d.ready !== undefined) {
    act('ready', { ready: d.ready === '1' });
  } else if ('start' in d) {
    if (view.startProblem) toast(view.startProblem);
    else act('start');
  } else if (d.addCpu !== undefined) {
    act('addCpu', { team: Number(d.addCpu) });
  } else if ('fillCpu' in d) {
    act('addCpu', { team: 'fill' });
  } else if ('removeCpus' in d) {
    act('removeCpus');
  } else if ('devend' in d) {
    act('devEnd');
    t.closest('[data-pause]').hidden = true;
  } else if (d.kick) {
    act('kick', { id: d.kick });
  } else if (d.promote) {
    act('promote', { id: d.promote });
  } else if ('copy' in d) {
    const input = app.querySelector('[data-link]');
    try {
      await navigator.clipboard.writeText(input.value);
      toast('Link copied!');
    } catch {
      input.select();
      toast('Press Ctrl/Cmd+C to copy.');
    }
  } else if ('nextRound' in d) {
    act('next');
  } else if ('restart' in d) {
    act('restart');
  } else if ('lobby' in d) {
    act('lobby');
  } else if ('resume' in d) {
    t.closest('[data-pause]').hidden = true;
  } else if ('leave' in d) {
    await act('leave');
    es?.close();
    session.clear(code);
    location.href = './';
  }
});

roomChip.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${code}`);
    toast('Lobby link copied!');
  } catch {
    toast(`Lobby code: ${code}`);
  }
});

// ---------- boot ----------

await characterReady; // lobby avatars and in-game players use the character art

if (!code) {
  renderGone('No lobby code in the link.');
} else if (!me) {
  renderJoin();
} else {
  app.innerHTML = '<p class="te-loading">Connecting…</p>';
  connect();
}
