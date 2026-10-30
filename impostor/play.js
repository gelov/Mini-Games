// Who's the Impostor? client: renders the server's per-player view and sends actions. The server owns all rules.
import { SVG } from '../brew-leap/js/sprites.js';
import { mountNightSky } from '../shared/night-sky.js';
import { mountTrack } from '../shared/track.js';
import { isMuted, mountToggle, setMusicController, refreshToggle, wireUiSounds, getSharedCtx } from '../shared/sfx.js';
import { startMystery, stopMystery, setIntensity, isMysteryPlaying, setDuck } from '../shared/mystery-music.js';
import { syncTicks, stopTicks, configureTicks } from '../shared/timer-ticks.js';
import { playBusted, playEscaped } from '../shared/stingers.js';
import { playCelebration } from '../shared/celebration.js';
import { fireConfetti } from '../shared/confetti.js';
import { api, session, lastName, normalizeCode, esc, wordcard, avatar, timer, paintTimers, plural } from './ui.js';
import { IMPOSTOR_MUSIC_VOLUME } from './music-config.js';

// Tick phases + duck target for shared/timer-ticks.js, specific to this room.
configureTicks({ tickPhases: { clue: true, vote: true, steal: true }, duck: setDuck });

document.querySelectorAll('[data-icon="mug"]').forEach((el) => { el.innerHTML = SVG.mug; });
mountNightSky(document.querySelector('.skyline'), { pillars: false });

// Same jazz track as the landing page; restarts from the top on this navigation
// (no cross-page playhead handoff yet - acceptable for now). Volume lives in
// ./music-config.js, shared with landing.js.
const impostorTrack = mountTrack('../assets/audio/impostor-jazz.mp3', { volume: IMPOSTOR_MUSIC_VOLUME, isMuted, onChange: refreshToggle });

// Composite music controller: jazz plays in the lobby/final screens, a synthesized
// mystery score (shared/mystery-music.js) plays during the live clue/vote/steal/
// results phases, with a crossfade between the two when the phase group changes.
// Routed to sfx.js via setMusicController so mute/unmute/visibility/bfcache all
// keep working exactly as before, just against whichever source is "current".
const JAZZ_PHASES = { lobby: true, final: true };
const MYSTERY_PHASES = { clue: true, vote: true, steal: true, results: true };
let currentSource = 'jazz'; // 'jazz' | 'mystery'
let roomMuted = false;

function startCurrent() {
  if (roomMuted) return;
  // Don't resume/start audio in a hidden tab (e.g. an SSE-driven phase change
  // landing while backgrounded) - setPhase() above still records the current
  // source so the visibilitychange handlers (this module's own for mystery,
  // shared/track.js's own for jazz) start the right one once visible again.
  if (document.hidden) return;
  if (currentSource === 'jazz') {
    impostorTrack.start();
  } else {
    const ctx = getSharedCtx();
    startMystery(ctx, { intensity: 0 });
  }
}

const musicController = {
  start() {
    roomMuted = false;
    startCurrent();
  },
  stop(opts) {
    roomMuted = true;
    impostorTrack.stop(opts);
    stopMystery(opts);
  },
  isWaiting() {
    return currentSource === 'jazz' ? impostorTrack.isWaiting() : false;
  },
  setPhase(phase) {
    const nextSource = JAZZ_PHASES[phase] ? 'jazz' : MYSTERY_PHASES[phase] ? 'mystery' : currentSource;
    if (nextSource === 'mystery') {
      setIntensity(phase === 'vote' || phase === 'steal' ? 1 : 0);
    }
    if (nextSource === currentSource) return;
    const outgoing = currentSource;
    currentSource = nextSource;
    if (outgoing === 'jazz') {
      impostorTrack.stop({ fast: true });
    } else {
      stopMystery({ fast: true });
    }
    startCurrent();
  },
};
setMusicController(musicController);
mountToggle(document.querySelector('.sound-toggle'));
wireUiSounds(document); // global hover/click sounds; covers the SSE-rerendered lobby/play buttons too

const app = document.getElementById('app');
const code = normalizeCode(new URLSearchParams(location.search).get('room'));
if (code.length !== 4) location.replace('./');

const S = {
  auth: session.get(code),
  view: null,
  offset: 0,
  key: null,
  es: null,
  clueDraft: '',
  clueDraftIndex: -1,
  selectedVote: null,
  stealDraft: '',
  stingerRound: null, // last round number this tab has already played a result stinger for
  lastPhase: null, // previous v.phase, used to detect "a new game just started"
  celebrated: false, // whether this tab has already fired the final-screen celebration+confetti for the current game
  celebrateTimerId: null, // pending setTimeout id for the celebration, cancelled if we leave 'final' first
};

// sfx.js's own visibilitychange handler early-returns for non-chiptune controllers
// (it only knows how to pause/resume a plain controller via start()/stop(), and
// shared/track.js's jazz <audio> element already pauses itself on hidden via its
// own listener). The synthesized mystery score has no such built-in behavior, so
// it must be paused/resumed here directly, same as jazz, or it keeps scheduling
// oscillators (and ticks keep polling) in a hidden tab.
document.addEventListener('visibilitychange', () => {
  if (currentSource !== 'mystery') return;
  if (document.hidden) {
    if (isMysteryPlaying()) stopMystery({ fast: true });
  } else if (!roomMuted && !isMuted()) {
    const ctx = getSharedCtx();
    const phase = S.view?.phase;
    startMystery(ctx, { intensity: phase === 'vote' || phase === 'steal' ? 1 : 0 });
  }
});

// ---------- chrome: room chip, status, toast ----------

const roomChip = document.querySelector('[data-room-chip]');
roomChip.querySelector('[data-room-code]').textContent = code;
const inviteLink = () => `${location.origin}${location.pathname}?room=${code}`;
roomChip.addEventListener('click', () => copy(inviteLink()));

const statusEl = document.querySelector('[data-status]');
const toastEl = document.querySelector('[data-toast]');
let toastTimer;
function setStatus(msg) {
  statusEl.hidden = !msg;
  statusEl.textContent = msg || '';
}
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Invite link copied');
  } catch {
    const field = app.querySelector('#share');
    field?.select();
    setStatus('Copy the link from the box');
  }
  setTimeout(() => setStatus(''), 1800);
}

// ---------- connection ----------

function connect() {
  S.es?.close();
  roomChip.hidden = false;
  const es = new EventSource(`/api/impostor/rooms/${code}/events?token=${encodeURIComponent(S.auth.token)}`);
  S.es = es;
  es.onmessage = (e) => {
    setStatus('');
    const view = JSON.parse(e.data);
    S.offset = view.now - Date.now();
    S.view = view;
    render();
  };
  es.onerror = async () => {
    if (es.readyState !== EventSource.CLOSED) {
      setStatus('Reconnecting…');
      return;
    }
    // the server refused the stream: the room is gone, or this tab is no longer a player in it
    try {
      await api(`/rooms/${code}`);
      session.clear(code);
      S.auth = null;
      showJoin('You were disconnected from this room. Rejoin with your name to pick up where you left off.');
    } catch (err) {
      if (err.status === 404) showGone();
      else {
        setStatus('Reconnecting…');
        setTimeout(connect, 2000);
      }
    }
  };
}

async function act(type, extra = {}) {
  try {
    await api(`/rooms/${code}/action`, { token: S.auth.token, type, ...extra });
    return null;
  } catch (err) {
    return err.message;
  }
}

setInterval(() => {
  if (S.view) paintTimers(S.view.deadline, S.view.deadlineSecs, S.offset);
}, 250);

// ---------- join / gone ----------

async function showJoin(message = '') {
  S.es?.close();
  S.key = null;
  roomChip.hidden = true;
  try {
    await api(`/rooms/${code}`);
  } catch (err) {
    if (err.status === 404) return showGone();
  }
  app.innerHTML = `
    <div class="game game--narrow">
      <section class="panel center-card">
        ${wordcard('???', 'xs')}
        <h2>Join room ${esc(code)}</h2>
        <p>${esc(message || 'Pick the name everyone will see on the leaderboard.')}</p>
        <form data-join-form novalidate>
          <div>
            <label class="label" for="player-name">Display name</label>
            <input class="field" id="player-name" name="name" maxlength="20" autocomplete="nickname" value="${esc(lastName.get())}" required>
          </div>
          <p class="error" data-join-error role="alert"></p>
          <button class="btn btn--primary btn--lg btn--block" type="submit">Join game</button>
        </form>
        <a class="btn btn--sm" href="./">Back to Who's the Impostor?</a>
      </section>
    </div>`;
  const input = app.querySelector('#player-name');
  input.focus();
  input.select();
}

function showGone() {
  S.es?.close();
  S.view = null;
  roomChip.hidden = true;
  session.clear(code);
  app.innerHTML = `
    <div class="game game--narrow">
      <section class="panel center-card">
        ${wordcard('Gone', 'xs')}
        <h2>Room not found</h2>
        <p>Room ${esc(code)} doesn't exist or has ended. Rooms close after a couple of hours without players, or when the server restarts.</p>
        <div class="actions"><a class="btn btn--primary" href="./">Create a new game</a><a class="btn" href="../">Game Night menu</a></div>
      </section>
    </div>`;
}

// ---------- rendering ----------

const byId = (v, id) => v.players.find((p) => p.id === id);
const isHost = (v) => v.hostId === v.you;
const fmtSecs = (s) => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`);
const CATEGORY_LABELS = {
  Animals: 'Animals',
  'Food & Drink': 'Food & Drink',
  'Office & Work': 'Office & Work',
  'Movies & TV': 'Movies & TV',
  'Places & Travel': 'Places & Travel',
  'Sports & Hobbies': 'Sports & Hobbies',
  'Household Objects': 'Household',
};

function screenKey(v) {
  switch (v.phase) {
    case 'clue': return `c:${v.round}:${v.clue.index}:${v.clue.isParticipant}:${v.clue.isImpostor}`;
    case 'vote': return `v:${v.round}:${Boolean(v.vote.yourVote)}`;
    case 'steal': return `s:${v.round}:${v.steal.isImpostor}`;
    case 'results':
    case 'final': return `${v.phase}:${v.round}:${isHost(v)}`;
    // keyed on host-ness only: settings values, start button, roster are patched live
    default: return `lobby:${isHost(v)}`;
  }
}

// Key for de-duping the round-result stinger: a reload mid-results/final (or a
// late SSE reconnect) must not replay it, so the last-played round is
// remembered both in memory (S.stingerRound) and in sessionStorage (survives
// reloads, scoped per room+tab the same way session.js stores the player's
// auth). `round` alone isn't globally unique though - it resets to 1 every new
// game ("Play again" from final, or back-to-lobby then start again) - so this
// key is explicitly cleared the moment a new game is detected starting (see
// resetStingerDedup()/render() below), before any round number can collide
// with a prior game's.
const stingerStorageKey = `impostor:stinger:${code}`;
// Same new-game-scoped dedup pattern as the stinger, for the final-screen
// celebration (fanfare + confetti): fires once per game, survives reloads on
// the final screen via sessionStorage, and is cleared alongside the stinger
// dedup the moment a new game is detected (see enteringNewGame in render()).
const celebrateStorageKey = `impostor:celebrate:${code}`;

function resetStingerDedup() {
  S.stingerRound = null;
  try {
    sessionStorage.removeItem(stingerStorageKey);
  } catch {
    // ignore - in-memory guard already cleared
  }
}

function resetCelebrateDedup() {
  S.celebrated = false;
  if (S.celebrateTimerId) {
    clearTimeout(S.celebrateTimerId);
    S.celebrateTimerId = null;
  }
  try {
    sessionStorage.removeItem(celebrateStorageKey);
  } catch {
    // ignore - in-memory guard already cleared
  }
}

function maybeFireCelebration(v) {
  if (v.phase !== 'final') {
    if (S.celebrateTimerId) {
      clearTimeout(S.celebrateTimerId);
      S.celebrateTimerId = null;
    }
    return;
  }
  if (S.celebrated || S.celebrateTimerId) return;
  let alreadyPlayed = false;
  try {
    alreadyPlayed = sessionStorage.getItem(celebrateStorageKey) === '1';
  } catch {
    // storage unavailable - fall back to the in-memory guard only
  }
  if (alreadyPlayed) {
    S.celebrated = true;
    return;
  }
  S.celebrateTimerId = setTimeout(() => {
    S.celebrateTimerId = null;
    S.celebrated = true;
    try {
      sessionStorage.setItem(celebrateStorageKey, '1');
    } catch {
      // ignore - in-memory guard still prevents a replay within this tab/session
    }
    if (!isMuted()) {
      playCelebration(getSharedCtx());
      const card = app.querySelector('.podium__step--1') || app.querySelector('.podium');
      fireConfetti({ originRect: card?.getBoundingClientRect() ?? null });
    }
  }, 1500);
}

function maybeFireResultStinger(v) {
  const res = v.results;
  if (!res || typeof res.round !== 'number') return;
  if (S.stingerRound === res.round) return;
  let alreadyPlayed = false;
  try {
    alreadyPlayed = Number(sessionStorage.getItem(stingerStorageKey)) === res.round;
  } catch {
    // storage unavailable - fall back to the in-memory guard only
  }
  S.stingerRound = res.round;
  if (alreadyPlayed) return;
  try {
    sessionStorage.setItem(stingerStorageKey, String(res.round));
  } catch {
    // ignore - in-memory guard still prevents a replay within this tab/session
  }
  if (isMuted()) return;
  // An impostor win (never caught, or caught-then-stole-it-back) reads as
  // ESCAPED; a loss (caught and the steal failed or never landed) reads as BUSTED.
  const escaped = !res.caught || res.stealOk;
  stopTicks(); // the stinger should cut any lingering tick sound, not overlap it
  const ctx = getSharedCtx();
  if (escaped) playEscaped(ctx); else playBusted(ctx);
}

function render() {
  const v = S.view;
  const key = screenKey(v);
  if (key !== S.key) {
    S.key = key;
    // Detect "a new game just started" so the stinger dedup key (keyed only on
    // round number) can't collide with the same round number from a prior game
    // in this room: either freshly back in the lobby, or round 1 of a fresh
    // clue phase arriving right after the previous game's final screen (the
    // "Play again" button skips the lobby and goes straight from final to
    // clue). S.lastPhase === null covers a tab that (re)loads directly into an
    // already-running game's round 1.
    const prevPhase = S.lastPhase;
    S.lastPhase = v.phase;
    const enteringNewGame = v.phase === 'lobby'
      || (v.phase === 'clue' && v.round === 1 && (prevPhase === 'final' || prevPhase === null));
    if (enteringNewGame) { resetStingerDedup(); resetCelebrateDedup(); }
    if (v.phase === 'clue' && v.clue.yourTurn) {
      if (S.clueDraftIndex !== v.clue.index) { S.clueDraft = ''; S.clueDraftIndex = v.clue.index; }
    }
    if (v.phase === 'vote') S.selectedVote = null;
    if (v.phase === 'steal') S.stealDraft = '';
    // The server skips the 'results' phase entirely on the last round and goes
    // straight to 'final' (see server/impostor.js finishRound), but still
    // populates the same v.results field for it - so the final round's stinger
    // must fire on first entry into 'final', not just on 'results'.
    if (v.phase === 'results' || v.phase === 'final') maybeFireResultStinger(v);
    maybeFireCelebration(v);
    app.innerHTML = ({ lobby, clue, vote, steal, results: resultsScreen, final: finalScreen })[v.phase](v);
    app.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
  }
  patch(v);
  paintTimers(v.deadline, v.deadlineSecs, S.offset);
  musicController.setPhase(v.phase);
  syncTicks(v.phase, v.deadline, v.deadlineSecs, S.offset, hasOwnAction(v));
}

/** Live bits that change without replacing the screen (so typing and selections survive). */
function patch(v) {
  const leader = app.querySelector('[data-slot="leader"]');
  if (leader) leader.innerHTML = leaderboard(v);
  if (v.phase === 'lobby') patchLobby(v);
  if (v.phase === 'vote') patchVote(v);
  if (v.phase === 'clue') patchClue(v);
}

function patchLobby(v) {
  const online = v.players.filter((p) => p.online);
  const need = Math.max(0, v.minPlayers - online.length);
  const host = byId(v, v.hostId);

  app.querySelectorAll('[data-stepper]').forEach((el) => {
    const key = el.dataset.stepper;
    el.textContent = key === 'rounds' ? String(v.settings[key]) : fmtSecs(v.settings[key]);
  });

  const roster = app.querySelector('[data-slot="roster"]');
  if (roster) roster.innerHTML = v.players.map((p) => rosterItem(v, p, p.id === v.hostId ? '<span class="crown">Host</span>' : (p.online ? '' : '<span class="roster__meta">away</span>'))).join('');

  const count = app.querySelector('[data-slot="playercount"]');
  if (count) count.textContent = `${online.length} / ${v.maxPlayers}`;

  const startArea = app.querySelector('[data-slot="startarea"]');
  if (startArea) {
    startArea.innerHTML = isHost(v)
      ? `<button class="btn btn--primary btn--lg btn--block" type="button" data-start ${need ? 'disabled' : ''}>${need ? `Waiting for ${plural(need, 'more player')}` : 'Start game'}</button>`
      : `<p class="note">Waiting for <b>${esc(host?.name ?? 'the host')}</b> to start the game. ${need ? `Needs ${plural(need, 'more player')}.` : ''}</p>`;
  }

  app.querySelectorAll('[data-category]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.category === v.settings.category)));
}

function patchVote(v) {
  const waiting = app.querySelector('[data-slot="waiting"]');
  if (waiting) waiting.innerHTML = waitingVote(v);
}

function patchClue(v) {
  const side = app.querySelector('[data-slot="turnside"]');
  if (side) side.innerHTML = turnRoster(v);
}

function bar(v, small, title, showTimer = true) {
  return `<div class="panel bar">
    <span class="chip">Round ${v.round} / ${v.settings.rounds}</span>
    <p class="bar__title"><small>${small}</small>${title}</p>
    ${showTimer ? timer() : ''}
  </div>`;
}

/** Whether THIS player has something to do right now (vs. just watching): drives
 * whether they see the countdown ring/hear ticks, so idle players aren't confused
 * by a timer for an action that isn't theirs. */
function hasOwnAction(v) {
  switch (v.phase) {
    case 'clue': return Boolean(v.clue?.isParticipant && v.clue.yourTurn);
    case 'vote': return Boolean(v.vote?.isParticipant && !v.vote.yourVote);
    case 'steal': return Boolean(v.steal?.isImpostor);
    default: return false;
  }
}

function rosterItem(v, p, meta = '', extra = '') {
  const you = p.id === v.you;
  return `<li class="${p.online ? '' : 'is-offline'} ${you ? 'is-you' : ''} ${extra}">
    ${avatar(p)}<span class="roster__name" title="${esc(p.name)}">${esc(p.name)}${you ? ' (you)' : ''}</span>${meta}
  </li>`;
}

// lobby ------------------------------------------------------------

function setting(v, key, label, hint, step, format) {
  const value = v.settings[key];
  const control = isHost(v)
    ? `<div class="stepper">
        <button class="btn" type="button" data-setting="${key}" data-step="${-step}" aria-label="Decrease ${label}">−</button>
        <output data-stepper="${key}">${format(value)}</output>
        <button class="btn" type="button" data-setting="${key}" data-step="${step}" aria-label="Increase ${label}">+</button>
      </div>`
    : `<div class="stepper"><output data-stepper="${key}">${format(value)}</output></div>`;
  return `<div class="setting"><span class="setting__label">${label}<small>${hint}</small></span>${control}</div>`;
}

function categorySetting(v) {
  const label = `<span class="setting__label">Category<small>What the secret word is about</small></span>`;
  if (!isHost(v)) {
    const text = v.settings.category === 'random' ? 'Surprise me' : (CATEGORY_LABELS[v.settings.category] ?? v.settings.category);
    return `<div class="setting">${label}<p class="note">${esc(text)}</p></div>`;
  }
  const options = ['random', ...v.categories];
  return `<div class="setting setting--category">
    ${label}
    <div class="segmented" role="group" aria-label="Category">
      ${options.map((c) => `<button class="segmented__btn" type="button" data-category="${esc(c)}" aria-pressed="${v.settings.category === c}">${esc(c === 'random' ? 'Surprise me' : (CATEGORY_LABELS[c] ?? c))}</button>`).join('')}
    </div>
  </div>`;
}

function lobby(v) {
  return `<div class="game"><div class="lobby">
    <section class="panel">
      <p class="eyebrow"><span class="chip chip--purple">Lobby</span> Who's the Impostor?</p>
      <div>
        <span class="label">Room code</span>
        <div class="code" role="img" aria-label="Room code ${esc(v.code)}">${[...v.code].map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      </div>
      <div>
        <label class="label" for="share">Invite link</label>
        <div class="share"><input class="field" id="share" readonly value="${esc(inviteLink())}"><button class="btn btn--sm" type="button" data-copy>Copy link</button></div>
      </div>
      <div class="settings">
        ${setting(v, 'rounds', 'Rounds', 'How many rounds to play', 1, String)}
        ${setting(v, 'clueSecs', 'Time to clue', 'Per player, each turn', 5, fmtSecs)}
        ${setting(v, 'voteSecs', 'Time to vote', 'For the whole table', 5, fmtSecs)}
        ${categorySetting(v)}
      </div>
      <div data-slot="startarea"></div>
    </section>
    <section class="panel">
      <div class="bar__title">Players <span class="chip chip--muted" data-slot="playercount"></span></div>
      <ul class="roster" data-slot="roster"></ul>
      <p class="note">${v.minPlayers}–${v.maxPlayers} players. 6 or more is ideal.</p>
      <button class="btn btn--sm" type="button" data-leave>Leave room</button>
    </section>
  </div></div>`;
}

// clue ---------------------------------------------------------------

function turnRoster(v) {
  const c = v.clue;
  const doneIds = new Set(c.clues.map((cl) => cl.id));
  return v.players.filter((p) => !p.left).map((p) => {
    let meta = '';
    let extra = '';
    if (doneIds.has(p.id)) { meta = '<span class="roster__meta done">clued</span>'; extra = 'is-done'; }
    else if (p.id === c.activeId) {
      // Live per-turn countdown, visible to everyone (not just the active player),
      // so idle players can see at a glance how long the current turn has left.
      // paintTimers() keeps the text/is-low state fresh every 250ms via [data-row-timer].
      meta = '<span class="roster__meta roster__meta--timer" data-row-timer>⏱<b data-row-timer-text>0:00</b></span>';
      extra = 'is-active';
    } else { meta = `<span class="roster__meta">${p.online ? 'waiting' : 'away'}</span>`; }
    return rosterItem(v, p, meta, extra);
  }).join('');
}

function clue(v) {
  const c = v.clue;
  const activePlayer = byId(v, c.activeId);
  let top;
  if (!c.isParticipant) {
    top = `<p class="eyebrow"><span class="chip chip--muted">Joined mid-round</span></p>
      <h3 class="bar__title">You'll join from next round</h3>
      <p class="note">Hang tight while this round plays out.</p>`;
  } else if (c.isImpostor) {
    top = `<div class="impostor-banner">
      <span class="impostor-banner__badge">?</span>
      <div><h3>You're the Impostor</h3><p>Category: <b>${esc(CATEGORY_LABELS[c.category] ?? c.category)}</b>. You don't know the word, listen closely and blend in!</p></div>
    </div>`;
  } else {
    top = `<div class="yours">${wordcard(c.word, 'xs')}<div><h3>The secret word</h3><p>Category: <b>${esc(CATEGORY_LABELS[c.category] ?? c.category)}</b>. Give a clue that proves you know it, without saying it outright.</p></div></div>`;
  }

  const cluesSoFar = c.clues.length
    ? `<ul class="clue-log">${c.clues.map((cl) => `<li>${avatar({ id: cl.id, name: cl.name })}<b>${esc(cl.name)}</b><span class="${cl.clue === '—' ? 'is-blank' : ''}">${cl.clue === '—' ? 'no clue given' : `“${esc(cl.clue)}”`}</span></li>`).join('')}</ul>`
    : '<p class="note">No clues yet this round.</p>';

  let turnBlock;
  if (c.isParticipant && c.yourTurn) {
    turnBlock = `<div class="turn-indicator is-you">It's your turn</div>
      <form class="clue-compose" data-clue-form novalidate>
        <label class="label" for="clue-input">Your clue</label>
        <input class="field" id="clue-input" data-autofocus maxlength="${c.clueMax}" placeholder="One short clue…" autocomplete="off" value="${esc(S.clueDraft)}">
        <div class="compose__foot">
          <p class="note">No saying the word, the game blocks it.</p>
          <span class="counter" data-counter>${S.clueDraft.length} / ${c.clueMax}</span>
        </div>
        <p class="error" data-clue-error role="alert"></p>
        <button class="btn btn--primary btn--lg" type="submit">Lock in clue</button>
      </form>`;
  } else {
    turnBlock = `<div class="turn-indicator">Waiting on <b>${esc(activePlayer?.name ?? 'someone')}</b>…</div>`;
  }

  return `<div class="game">
    ${bar(v, `Clue ${c.index + 1} of ${c.total}`, c.isParticipant && c.yourTurn ? 'Give a clue, one at a time' : "Who's got the real word?", hasOwnAction(v))}
    <div class="game__grid">
      <section class="panel game__main">${top}${cluesSoFar}${turnBlock}</section>
      <aside class="panel game__side"><h3>Turn order</h3><ul class="roster" data-slot="turnside"></ul></aside>
    </div>
  </div>`;
}

// vote ----------------------------------------------------------------

function waitingVote(v) {
  const g = v.vote;
  return v.players.filter((p) => !p.left).map((p) => {
    const done = g.lockedIds.includes(p.id);
    return rosterItem(v, p, `<span class="roster__meta ${done ? 'done' : ''}">${done ? 'locked in' : p.online ? 'thinking…' : 'away'}</span>`, done ? 'is-done' : '');
  }).join('');
}

function vote(v) {
  const g = v.vote;
  const cluesList = `<ul class="clue-log">${g.clues.map((cl) => `<li>${avatar({ id: cl.id, name: cl.name })}<b>${esc(cl.name)}</b><span class="${cl.clue === '—' ? 'is-blank' : ''}">${cl.clue === '—' ? 'no clue given' : `“${esc(cl.clue)}”`}</span></li>`).join('')}</ul>`;

  let body;
  if (!g.isParticipant) {
    body = `<p class="eyebrow"><span class="chip chip--muted">Joined mid-round</span></p><p class="note">You'll vote from next round.</p>`;
  } else if (g.yourVote) {
    const target = byId(v, g.yourVote);
    body = `<div class="locked"><div><p>Your vote is locked in</p><strong>${esc(target?.name ?? 'Someone')}</strong></div><p>Results are revealed once everyone has voted.</p></div>`;
  } else {
    body = `<div class="candidates" role="group" aria-label="Players">${g.candidates.map((id) => { const p = byId(v, id); return `<button class="candidate" type="button" data-candidate="${esc(id)}" aria-pressed="false">${avatar(p)}${esc(p?.name ?? 'Unknown')}</button>`; }).join('')}</div>
      <div class="guess-foot">
        <span class="note">Vote for who you think is the Impostor.</span>
        <button class="btn btn--primary btn--lg" type="button" data-lock disabled>Lock in vote</button>
      </div>`;
  }

  return `<div class="game">
    ${bar(v, 'Vote', 'Who do you think is the Impostor?', hasOwnAction(v))}
    <div class="game__grid">
      <section class="panel game__main">${cluesList}${body}</section>
      <aside class="panel game__side"><h3>Waiting on…</h3><ul class="roster" data-slot="waiting"></ul></aside>
    </div>
  </div>`;
}

// steal -----------------------------------------------------------------

function steal(v) {
  const s = v.steal;
  let body;
  if (s.isImpostor) {
    body = `<div class="steal-box">
      <h3>You were caught!</h3>
      <p>One last chance: guess the secret word exactly to steal the round back.</p>
      <form data-steal-form novalidate>
        <input class="field" data-autofocus maxlength="40" autocomplete="off" placeholder="Guess the word…" value="${esc(S.stealDraft)}">
        <p class="error" data-steal-error role="alert"></p>
        <button class="btn btn--primary btn--lg" type="submit">Guess</button>
      </form>
    </div>`;
  } else {
    body = `<div class="steal-box">
      <h3>${esc(s.accusedName)} was caught!</h3>
      <p>They get one guess at the secret word before it's revealed.</p>
    </div>`;
  }
  return `<div class="game">
    ${bar(v, 'Final chance', 'The Impostor is guessing the word…', hasOwnAction(v))}
    <section class="panel game__main">${body}</section>
  </div>`;
}

// results / final --------------------------------------------------

function ranked(v) {
  const list = [...v.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  let prev = null;
  return list.map((p, i) => {
    if (p.score !== prev) rank = i + 1;
    prev = p.score;
    return { ...p, rank };
  });
}

function leaderboard(v) {
  return ranked(v).map((p) => `<li class="${p.id === v.you ? 'is-you' : ''}">
      <span class="leader__rank">${p.rank}</span>${avatar(p)}
      <span class="roster__name" title="${esc(p.name)}">${esc(p.name)}${p.id === v.you ? ' (you)' : ''}</span>
      <span class="roster__score">${p.score}</span>
    </li>`).join('');
}

function reveals(v) {
  const res = v.results;
  if (!res) return '';
  const maxVotes = Math.max(1, ...res.tally.map((t) => t.votes));
  const outcomeBadge = res.caught
    ? `<span class="outcome-badge outcome-badge--caught">${res.stealOk ? 'Caught — but stole it back!' : 'Caught!'}</span>`
    : '<span class="outcome-badge outcome-badge--escaped">Escaped!</span>';
  return `
    <div class="reveal-head">
      <span class="impostor-banner__badge">?</span>
      <div>
        <h3>${esc(res.impostorName)} was the Impostor</h3>
        <p>The word was <b>${esc(res.word)}</b> (${esc(CATEGORY_LABELS[res.category] ?? res.category)}). ${outcomeBadge}</p>
        ${res.accusedName ? `<p class="note">The table voted for <b>${esc(res.accusedName)}</b>.</p>` : '<p class="note">No one got enough votes, no accusation this round.</p>'}
        ${res.stealGuess ? `<p class="note">Steal guess: “${esc(res.stealGuess)}” — ${res.stealOk ? 'correct!' : 'wrong.'}</p>` : ''}
      </div>
    </div>
    <div>
      <h3 class="bar__title" style="margin-bottom:10px">Votes</h3>
      <ul class="tally">${res.tally.map((t) => `<li class="${t.id === res.impostorId ? 'is-impostor' : ''}">${avatar(t)}<span class="tally__bar"><span style="width:${(t.votes / maxVotes) * 100}%"></span></span><span class="tally__count">${t.votes}</span></li>`).join('')}</ul>
    </div>
    <div>
      <h3 class="bar__title" style="margin-bottom:10px">Clues</h3>
      <ul class="reveal-clues">${res.clues.map((c) => `<li class="${c.isImpostor ? 'is-impostor' : ''}">${avatar(c)}<b>${esc(c.name)}</b><span class="clue-text">${c.clue === '—' ? 'no clue given' : `“${esc(c.clue)}”`}</span>${c.isImpostor ? '<span class="impostor-tag">Impostor</span>' : ''}</li>`).join('')}</ul>
    </div>
    <div>
      <h3 class="bar__title" style="margin-bottom:10px">Points this round</h3>
      <ul class="points-list">${res.points.map((p) => `<li><span>${esc(p.name)}</span><b class="${p.delta === 0 ? 'is-zero' : ''}">${p.delta > 0 ? `+${p.delta}` : '0'}</b></li>`).join('')}</ul>
    </div>`;
}

function resultsScreen(v) {
  return `<div class="game">
    <div class="panel bar">
      <span class="chip chip--teal">Round ${v.results?.round ?? v.round} results</span>
      <p class="bar__title"><small>All revealed</small>Who was the Impostor?</p>
      <span class="note">Next round in <b data-countdown>0:00</b></span>
      ${isHost(v) ? '<button class="btn btn--primary" type="button" data-next>Next round</button>' : ''}
    </div>
    <div class="game__grid">
      <section class="panel game__main">${reveals(v)}</section>
      <aside class="panel game__side"><h3>Leaderboard</h3><ol class="leader" data-slot="leader"></ol></aside>
    </div>
  </div>`;
}

function finalScreen(v) {
  const list = ranked(v);
  const top = list.filter((p) => p.rank === 1);
  const headline = top.length > 1 ? "It's a tie!" : `${esc(top[0]?.name ?? 'Nobody')} wins!`;
  const sub = top.length > 1 ? `${top.map((p) => esc(p.name)).join(' & ')} share the crown` : `with ${plural(top[0]?.score ?? 0, 'point')}`;
  const step = (p, n) => (p ? `<div class="podium__step podium__step--${n}">${avatar(p, 'lg')}<span class="podium__name">${esc(p.name)}</span><span class="podium__pts">${plural(p.score, 'pt')}</span><div class="podium__block">${p.rank}</div></div>` : '<div></div>');
  return `<div class="game">
    <section class="panel game__main">
      <div class="winner"><p class="eyebrow">Final results</p><h2>${headline}</h2><p class="note">${sub}</p></div>
      <div class="podium">${step(list[1], 2)}${step(list[0], 1)}${step(list[2], 3)}</div>
      <div class="actions">
        ${isHost(v)
          ? '<button class="btn btn--primary btn--lg" type="button" data-start>Play again</button><button class="btn" type="button" data-lobby>Back to lobby</button>'
          : '<p class="note">Waiting for the host to start another game…</p>'}
        <a class="btn" href="../">Game Night menu</a>
      </div>
    </section>
    <div class="game__grid">
      <section class="panel game__main"><h3 class="bar__title"><small>Last round</small>Round ${v.results?.round ?? v.round} reveal</h3>${reveals(v)}</section>
      <aside class="panel game__side"><h3>Leaderboard</h3><ol class="leader" data-slot="leader"></ol></aside>
    </div>
  </div>`;
}

// ---------- interactions ----------

app.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-copy]');
  if (!t || t.disabled) return;
  const v = S.view;

  if (t.matches('[data-copy]')) return copy(inviteLink());
  if (t.matches('[data-setting]')) {
    const key = t.dataset.setting;
    const err = await act('settings', { settings: { [key]: v.settings[key] + Number(t.dataset.step) } });
    if (err) toast(err);
    return;
  }
  if (t.matches('[data-category]')) {
    const category = t.dataset.category;
    app.querySelectorAll('[data-category]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    const err = await act('settings', { settings: { category } });
    if (err) toast(err);
    return;
  }
  if (t.matches('[data-start]')) {
    t.disabled = true;
    const err = await act('start');
    if (err) { toast(err); t.disabled = false; }
    return;
  }
  if (t.matches('[data-next]')) return void act('next').then((err) => err && toast(err));
  if (t.matches('[data-lobby]')) return void act('lobby').then((err) => err && toast(err));
  if (t.matches('[data-leave]')) {
    await act('leave');
    session.clear(code);
    location.href = './';
    return;
  }
  if (t.matches('[data-candidate]')) {
    S.selectedVote = t.dataset.candidate;
    app.querySelectorAll('[data-candidate]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    const lock = app.querySelector('[data-lock]');
    lock.disabled = false;
    const target = byId(v, S.selectedVote);
    lock.textContent = `Lock in ${target?.name ?? 'vote'}`;
    return;
  }
  if (t.matches('[data-lock]') && S.selectedVote) {
    t.disabled = true;
    const err = await act('vote', { targetId: S.selectedVote });
    if (err) { toast(err); t.disabled = false; }
  }
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'clue-input') {
    S.clueDraft = e.target.value;
    const max = S.view.clue.clueMax;
    const counter = app.querySelector('[data-counter]');
    if (counter) {
      counter.textContent = `${S.clueDraft.length} / ${max}`;
      counter.classList.toggle('is-bad', S.clueDraft.length > max - 5);
    }
  }
  if (e.target.matches('[data-steal-form] input')) {
    S.stealDraft = e.target.value;
  }
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;

  if (form.matches('[data-join-form]')) {
    const name = form.elements.name.value.trim();
    const errEl = form.querySelector('[data-join-error]');
    if (!name) {
      errEl.textContent = 'Enter a display name.';
      return;
    }
    try {
      const joined = await api(`/rooms/${code}/join`, { name });
      lastName.set(name);
      S.auth = { token: joined.token, playerId: joined.playerId };
      session.set(code, S.auth);
      connect();
    } catch (err) {
      if (err.status === 404) showGone();
      else errEl.textContent = err.message;
    }
    return;
  }

  if (form.matches('[data-clue-form]')) {
    const errEl = form.querySelector('[data-clue-error]');
    const clueText = S.clueDraft.trim();
    if (!clueText) {
      errEl.textContent = 'Write a clue first.';
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const err = await act('clue', { clue: clueText });
    if (err) {
      errEl.textContent = err;
      button.disabled = false;
    }
    return;
  }

  if (form.matches('[data-steal-form]')) {
    const errEl = form.querySelector('[data-steal-error]');
    const guess = S.stealDraft.trim();
    if (!guess) {
      errEl.textContent = 'Enter a guess.';
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const err = await act('steal', { guess });
    if (err) {
      errEl.textContent = err;
      button.disabled = false;
    }
  }
});

// ---------- go ----------

if (S.auth?.token) connect();
else showJoin();
