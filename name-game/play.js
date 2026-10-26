// The Name Game client: renders the server's per-player view and sends actions. The server owns all rules.
import { SVG } from '../brew-leap/js/sprites.js';
import { mountNightSky } from '../shared/night-sky.js';
import { api, session, lastName, normalizeCode, esc, nametag, avatar, timer, paintTimers, plural } from './ui.js';

document.querySelectorAll('[data-icon="mug"]').forEach((el) => { el.innerHTML = SVG.mug; });
mountNightSky(document.querySelector('.skyline'), { pillars: false });

const app = document.getElementById('app');
const code = normalizeCode(new URLSearchParams(location.search).get('room'));
if (code.length !== 4) location.replace('./');

const S = {
  auth: session.get(code),
  view: null,
  offset: 0,
  key: null,
  es: null,
  draft: '',
  draftRound: 0,
  localPick: null, // tapped character, sent with the clue so it can't lag behind the server
  selected: null,
  names: '',
  namesDirty: false,
};

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
  const es = new EventSource(`/api/name-game/rooms/${code}/events?token=${encodeURIComponent(S.auth.token)}`);
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
        ${nametag('???', 'xs')}
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
        <a class="btn btn--sm" href="./">Back to The Name Game</a>
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
        ${nametag('Nobody', 'xs')}
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

function screenKey(v) {
  switch (v.phase) {
    case 'describe': return `d:${v.round}:${v.describe.participating}:${Boolean(v.describe.clue)}`;
    case 'guess': return `g:${v.round}:${v.guess.index}:${v.guess.isDescriber}:${Boolean(v.guess.yourGuess)}`;
    case 'results':
    case 'final': return `${v.phase}:${v.round}:${isHost(v)}`;
    // keyed on host-ness + deck only: everything else that can change in the lobby (roster, settings values,
    // start button, employee count) is patched live so the names textarea never loses focus or its draft
    default: return `lobby:${isHost(v)}:${v.settings.deck}`;
  }
}

function render() {
  const v = S.view;
  const key = screenKey(v);
  if (key !== S.key) {
    S.key = key;
    if (v.phase === 'describe' && S.draftRound !== v.round) {
      S.draft = '';
      S.localPick = null;
      S.draftRound = v.round;
    }
    if (v.phase === 'guess') S.selected = null;
    if (v.phase === 'lobby') S.namesDirty = false;
    app.innerHTML = ({ lobby, describe, guess, results: resultsScreen, final: finalScreen })[v.phase](v);
    app.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
  }
  if (v.phase === 'lobby' && !S.namesDirty) S.names = (v.employee.names ?? []).join('\n');
  patch(v);
  paintTimers(v.deadline, v.deadlineSecs, S.offset);
}

/** Live bits that change without replacing the screen (so typing and selections survive). */
function patch(v) {
  const waiting = app.querySelector('[data-slot="waiting"]');
  if (waiting) waiting.innerHTML = waitingList(v);
  const leader = app.querySelector('[data-slot="leader"]');
  if (leader) leader.innerHTML = leaderboard(v);
  if (v.phase === 'describe' && v.describe.participating && !v.describe.clue) {
    const pick = S.localPick ?? v.describe.pick;
    app.querySelectorAll('[data-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === pick)));
  }
  if (v.phase === 'lobby') patchLobby(v);
}

/** The lobby screen is keyed on host-ness + deck only, so everything else updates here on every view. */
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

  const bustNote = app.querySelector('[data-slot="bustnote"]');
  if (bustNote) bustNote.innerHTML = `With ${plural(Math.max(0, online.length - 1), 'guesser')}, up to <b>${v.bustPreview}</b> can guess each description correctly. One more and the describer busts.`;

  const startArea = app.querySelector('[data-slot="startarea"]');
  if (startArea) {
    startArea.innerHTML = isHost(v)
      ? `<button class="btn btn--primary btn--lg btn--block" type="button" data-start ${need ? 'disabled' : ''}>${need ? `Waiting for ${plural(need, 'more player')}` : 'Start game'}</button>`
      : `<p class="note">Waiting for <b>${esc(host?.name ?? 'the host')}</b> to start the game. ${need ? `Needs ${plural(need, 'more player')}.` : ''}</p>`;
  }

  app.querySelectorAll('[data-deck]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.deck === v.settings.deck)));
  const deckText = app.querySelector('[data-slot="decktext"]');
  if (deckText) deckText.textContent = v.settings.deck === 'employees' ? 'Offshorly employees' : 'Famous characters';

  const nameHint = app.querySelector('[data-slot="nameshint"]');
  if (nameHint) nameHint.textContent = `${plural(v.employee.count, 'name')} saved · ${v.employee.min} needed`;
  const nameCount = app.querySelector('[data-slot="namescount"]');
  if (nameCount) nameCount.textContent = `${v.employee.count}`;

  const field = app.querySelector('[data-names]');
  if (field && !S.namesDirty && document.activeElement !== field) field.value = S.names;
}

function bar(v, small, title) {
  return `<div class="panel bar">
    <span class="chip">Round ${v.round} / ${v.settings.rounds}</span>
    <p class="bar__title"><small>${small}</small>${title}</p>
    ${timer()}
  </div>`;
}

function rosterItem(v, p, meta = '', extra = '') {
  const you = p.id === v.you;
  return `<li class="${p.online ? '' : 'is-offline'} ${you ? 'is-you' : ''} ${extra}">
    ${avatar(p)}<span class="roster__name">${esc(p.name)}${you ? ' (you)' : ''}</span>${meta}
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

function deckSetting(v) {
  const label = `<span class="setting__label">Names<small>What everyone guesses</small></span>`;
  if (!isHost(v)) {
    return `<div class="setting">${label}<p class="note" data-slot="decktext">${v.settings.deck === 'employees' ? 'Offshorly employees' : 'Famous characters'}</p></div>`;
  }
  return `<div class="setting setting--deck">
    ${label}
    <div class="segmented" role="group" aria-label="Names">
      <button class="segmented__btn" type="button" data-deck="characters" aria-pressed="${v.settings.deck === 'characters'}">Famous characters</button>
      <button class="segmented__btn" type="button" data-deck="employees" aria-pressed="${v.settings.deck === 'employees'}">Offshorly employees</button>
    </div>
  </div>`;
}

function namesSection(v) {
  if (v.settings.deck !== 'employees') return '';
  if (!isHost(v)) {
    return `<p class="note">Offshorly employees — <b data-slot="namescount">${v.employee.count}</b> names</p>`;
  }
  return `<div class="names">
    <label class="label" for="names">Names to guess</label>
    <textarea class="field" id="names" data-names placeholder="One name per line, e.g.\nJamie Cruz\nAlex Rivera" maxlength="${v.employee.max * (v.employee.nameMax + 1)}">${esc(S.names)}</textarea>
    <div class="names__foot">
      <span class="note" data-slot="nameshint">${plural(v.employee.count, 'name')} saved · ${v.employee.min} needed</span>
      <button class="btn btn--sm" type="button" data-save-names>Save names</button>
    </div>
  </div>`;
}

function lobby(v) {
  return `<div class="game"><div class="lobby">
    <section class="panel">
      <p class="eyebrow"><span class="chip chip--purple">Lobby</span> The Name Game</p>
      <div>
        <span class="label">Room code</span>
        <div class="code" role="img" aria-label="Room code ${esc(v.code)}">${[...v.code].map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      </div>
      <div>
        <label class="label" for="share">Invite link</label>
        <div class="share"><input class="field" id="share" readonly value="${esc(inviteLink())}"><button class="btn btn--sm" type="button" data-copy>Copy link</button></div>
      </div>
      <div class="settings">
        ${setting(v, 'rounds', 'Rounds', 'Everyone describes once per round', 1, String)}
        ${setting(v, 'describeSecs', 'Time to describe', 'Pick a character and write clues', 15, fmtSecs)}
        ${setting(v, 'guessSecs', 'Time to guess', 'For each description', 10, fmtSecs)}
        ${deckSetting(v)}
      </div>
      ${namesSection(v)}
      <p class="note" data-slot="bustnote"></p>
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

// describe ---------------------------------------------------------

function describe(v) {
  const d = v.describe;
  let main;
  if (!d.participating) {
    main = `<p class="eyebrow"><span class="chip chip--muted">Joined mid-round</span></p>
      <h3 class="bar__title">You'll describe from next round</h3>
      <p class="note">Hang tight while everyone writes their clues. You can still guess this round.</p>`;
  } else if (d.clue) {
    main = `<p class="eyebrow"><span class="chip chip--teal">Locked in</span></p>
      <div class="yours">${nametag(d.pick, 'xs')}<div><h3>Your description</h3><p>“${esc(d.clue)}”</p><p>Waiting for everyone else to finish. Remember: no hints!</p></div></div>`;
  } else {
    main = `<div>
        <span class="label">1 · Choose your character</span>
        <div class="pick-row">${d.options.map((o) => `<button class="pick" type="button" data-pick="${esc(o)}" aria-pressed="${d.pick === o}" aria-label="Describe ${esc(o)}">${nametag(o, 'sm')}</button>`).join('')}</div>
      </div>
      <form class="compose" data-clue-form novalidate>
        <label class="label" for="clue">2 · Describe them without saying their name</label>
        <textarea class="field" id="clue" maxlength="${d.clueMax}" placeholder="${v.settings.deck === 'employees' ? 'e.g. Sits by the window, always has coffee…' : 'e.g. A young wizard with a lightning-bolt scar…'}">${esc(S.draft)}</textarea>
        <div class="compose__foot">
          <p class="note">Most should get it. If more than <b>${d.bustLimit}</b> guess it, you bust.</p>
          <span class="counter" data-counter>${S.draft.length} / ${d.clueMax}</span>
        </div>
        <p class="error" data-clue-error role="alert"></p>
        <button class="btn btn--primary btn--lg" type="submit">Lock in description</button>
      </form>`;
  }
  return `<div class="game">
    ${bar(v, 'Describe', d.participating && !d.clue ? 'Pick a character and describe them' : 'Everyone is writing clues')}
    <div class="game__grid">
      <section class="panel game__main">${main}</section>
      <aside class="panel game__side"><h3>Waiting on…</h3><ul class="roster" data-slot="waiting"></ul></aside>
    </div>
  </div>`;
}

// guess ------------------------------------------------------------

function guess(v) {
  const g = v.guess;
  const describer = byId(v, g.describerId);
  const quote = `<p class="quote"><small>Described by ${esc(describer?.name ?? 'someone')}</small>${esc(g.clue)}</p>`;
  let body;
  if (g.isDescriber) {
    body = `<div class="yours">${nametag(g.answer, 'xs')}<div><h3>This one's yours</h3><p>Sit tight while everyone guesses. No hints, no faces!</p><p>If more than ${g.bustLimit} get it, you bust.</p></div></div>`;
  } else if (g.yourGuess) {
    body = `<div class="locked"><div><p>Your guess is locked in</p><strong>${esc(g.yourGuess)}</strong></div><p>Answers are revealed at the end of the round.</p></div>`;
  } else {
    const search = g.candidates.length > 12
      ? `<input class="field" type="search" placeholder="Search characters…" data-search aria-label="Search characters">`
      : '';
    body = `${search}
      <div class="candidates" role="group" aria-label="Characters">${g.candidates.map((c) => `<button class="candidate" type="button" data-candidate="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('')}</div>
      <div class="guess-foot">
        <span class="note">Up to <b>${g.bustLimit}</b> can get it before ${esc(describer?.name ?? 'they')} busts.</span>
        <button class="btn btn--primary btn--lg" type="button" data-lock disabled>Lock in guess</button>
      </div>`;
  }
  return `<div class="game">
    ${bar(v, `Description ${g.index + 1} of ${g.total}`, 'Which character matches this description?')}
    <div class="game__grid">
      <section class="panel game__main">${quote}${body}</section>
      <aside class="panel game__side"><h3>Waiting on…</h3><ul class="roster" data-slot="waiting"></ul></aside>
    </div>
  </div>`;
}

function waitingList(v) {
  if (v.phase === 'describe') {
    const d = v.describe;
    const ids = [...d.doneIds, ...d.waitingOn];
    return ids.map((id) => byId(v, id)).filter(Boolean).map((p) => {
      const done = d.doneIds.includes(p.id);
      return rosterItem(v, p, `<span class="roster__meta ${done ? 'done' : ''}">${done ? 'locked in' : p.online ? 'writing…' : 'away'}</span>`, done ? 'is-done' : '');
    }).join('');
  }
  if (v.phase === 'guess') {
    const g = v.guess;
    return v.players
      .filter((p) => p.id === g.describerId || g.lockedIds.includes(p.id) || g.waitingOn.includes(p.id))
      .map((p) => {
        if (p.id === g.describerId) return rosterItem(v, p, '<span class="roster__meta">describing</span>', 'is-done');
        const done = g.lockedIds.includes(p.id);
        return rosterItem(v, p, `<span class="roster__meta ${done ? 'done' : ''}">${done ? 'locked in' : 'thinking…'}</span>`, done ? 'is-done' : '');
      }).join('');
  }
  return '';
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
      <span class="roster__name">${esc(p.name)}${p.id === v.you ? ' (you)' : ''}</span>
      <span class="roster__score">${p.score}</span>
    </li>`).join('');
}

function revealItem(r, limit, i) {
  const cells = Math.max(r.guessCount, limit + 1);
  const meter = Array.from({ length: cells }, (_, k) => `<i class="${k < r.correctIds.length ? (k >= limit ? 'over' : 'on') : ''}"></i>`).join('');
  const score = r.bust
    ? '<span class="bust-badge">BUST!</span><span class="roster__meta">0 points</span>'
    : `<b>+${r.describerPoints}</b><span class="roster__meta">${r.describerPoints ? `to ${esc(r.describerName)}` : 'nobody got it'}</span>`;
  return `<li class="reveal ${r.bust ? 'is-bust' : ''}" style="--i:${i}">
    ${nametag(r.answer, 'xs')}
    <div class="reveal__body">
      <p class="reveal__by">Described by ${esc(r.describerName)}</p>
      <p class="reveal__clue">“${esc(r.clue)}”</p>
      <div class="reveal__who">${r.correctNames.map((n) => `<span>${esc(n)} +1</span>`).join('')}</div>
    </div>
    <div class="reveal__score">
      <div class="meter" aria-hidden="true">${meter}</div>
      <span class="roster__meta">${r.correctIds.length} of ${r.guessCount} guessed · limit ${limit}</span>
      ${score}
    </div>
  </li>`;
}

function reveals(v) {
  const res = v.results;
  if (!res || !res.reveals.length) return '<p class="note">No descriptions were written this round.</p>';
  return `<ol class="reveals">${res.reveals.map((r, i) => revealItem(r, res.bustLimit, i)).join('')}</ol>`;
}

function resultsScreen(v) {
  return `<div class="game">
    <div class="panel bar">
      <span class="chip chip--teal">Round ${v.results?.round ?? v.round} results</span>
      <p class="bar__title"><small>All answers revealed</small>Who got who?</p>
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
      <section class="panel game__main"><h3 class="bar__title"><small>Last round</small>Round ${v.results?.round ?? v.round} answers</h3>${reveals(v)}</section>
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
  if (t.matches('[data-deck]')) {
    const deck = t.dataset.deck;
    app.querySelectorAll('[data-deck]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    const err = await act('settings', { settings: { deck } });
    if (err) toast(err);
    return;
  }
  if (t.matches('[data-save-names]')) {
    t.disabled = true;
    const err = await act('names', { names: S.names });
    t.disabled = false;
    if (err) toast(err);
    else S.namesDirty = false;
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
  if (t.matches('[data-pick]')) {
    S.localPick = t.dataset.pick;
    app.querySelectorAll('[data-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    const err = await act('pick', { character: t.dataset.pick });
    if (err) toast(err);
    return;
  }
  if (t.matches('[data-candidate]')) {
    S.selected = t.dataset.candidate;
    app.querySelectorAll('[data-candidate]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    const lock = app.querySelector('[data-lock]');
    lock.disabled = false;
    lock.textContent = `Lock in ${S.selected}`;
    return;
  }
  if (t.matches('[data-lock]') && S.selected) {
    t.disabled = true;
    const err = await act('guess', { character: S.selected });
    if (err) { toast(err); t.disabled = false; }
  }
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'clue') {
    S.draft = e.target.value;
    const max = S.view.describe.clueMax;
    const counter = app.querySelector('[data-counter]');
    counter.textContent = `${S.draft.length} / ${max}`;
    counter.classList.toggle('is-bad', S.draft.length > max - 20);
  }
  if (e.target.matches('[data-names]')) {
    S.names = e.target.value;
    S.namesDirty = true;
  }
  if (e.target.matches('[data-search]')) {
    const q = e.target.value.trim().toLowerCase();
    app.querySelectorAll('[data-candidate]').forEach((b) => { b.hidden = q && !b.dataset.candidate.toLowerCase().includes(q); });
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
    const d = S.view.describe;
    const clue = S.draft.trim();
    const character = S.localPick ?? d.pick;
    if (!character) {
      errEl.textContent = 'Pick one of your three characters first.';
      return;
    }
    if (clue.length < d.clueMin) {
      errEl.textContent = `Write at least ${d.clueMin} characters.`;
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const err = await act('clue', { clue, character });
    if (err) {
      errEl.textContent = err;
      button.disabled = false;
    }
  }
});

// ---------- go ----------

if (S.auth?.token) connect();
else showJoin();
