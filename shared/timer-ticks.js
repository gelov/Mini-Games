// Timer ticking SFX for a server-driven countdown: a soft tick once per second
// normally, escalating to an aggressive alternating tick/tock twice per second
// inside the last 10 seconds, plus a one-shot "time's up" buzzer at expiry.
// Everyone in the room hears this (not impostor-only), driven off the same
// deadline/offset math as ui.js's paintTimers.

import { getSharedCtx, isMuted } from './sfx.js';

// Which phases get ticks/time's-up, and how to duck the background music bed
// during the aggressive last-10-seconds window, are page-specific (impostor's
// clue/vote/steal + mystery-music vs. the name game's describe/guess +
// namegame-music) - configured once per page via configureTicks() below.
let tickPhases = {};
let duckFn = () => {};

/** @param {{tickPhases?: Record<string, boolean>, duck?: (on: boolean) => void}} opts */
export function configureTicks({ tickPhases: phases = {}, duck } = {}) {
  tickPhases = phases || {};
  duckFn = typeof duck === 'function' ? duck : () => {};
}

const POLL_MS = 100;
const AGGRESSIVE_THRESHOLD = 10; // seconds
// The server replaces `deadline` with the *next* turn's deadline via its own
// setTimeout fired exactly at expiry (see base-room.js armDeadline), so a client
// that only polls for `left <= 0` almost always loses that race: by the time the
// 100ms poll (or the next SSE-driven render) observes left<=0, the deadline has
// often already been swapped out for the next phase/turn. So "time's up" is
// instead armed as its own local one-shot timer the moment a new tick-phase
// deadline is seen, scheduled to fire right when the countdown reaches zero on
// the client's own (offset-corrected) clock - not dependent on any further
// server push. A small early bias nudges it to win that race deterministically.
// If the deadline changes again before this timer fires (clue submitted early,
// everyone voted early, etc.), the timer is cancelled - an abandoned deadline
// never buzzes.
const TIMES_UP_EARLY_BIAS_MS = 40;

let intervalId = null;
let lastDeadline = undefined; // undefined = never seen; distinguishes from null
let lastSec = null;
let lastHalf = null;
let firedTimesUp = false;
let aggressiveOn = false;
let alternate = false;
let timesUpTimerId = null;
let hasActionNow = false; // latest "this player has something to do right now" flag

function tone(ctx, { freq, start, duration, gainPeak, type = 'sine' }) {
  if (!ctx || ctx.state !== 'running') return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  osc.addEventListener('ended', () => {
    osc.disconnect();
    gain.disconnect();
  });
}

function playSoftTick(ctx) {
  if (!ctx || ctx.state !== 'running') return;
  tone(ctx, { freq: 900, start: ctx.currentTime, duration: 0.06, gainPeak: 0.05, type: 'sine' });
}

function playAggressiveTick(ctx, high) {
  if (!ctx || ctx.state !== 'running') return;
  tone(ctx, {
    freq: high ? 1400 : 1100,
    start: ctx.currentTime,
    duration: 0.07,
    gainPeak: 0.09,
    type: 'square',
  });
}

function playTimesUp(ctx) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  // Short descending two-tone buzzer.
  tone(ctx, { freq: 420, start: t, duration: 0.18, gainPeak: 0.12, type: 'sawtooth' });
  tone(ctx, { freq: 260, start: t + 0.14, duration: 0.26, gainPeak: 0.12, type: 'sawtooth' });
}

function clearTimesUpTimer() {
  if (timesUpTimerId) {
    clearTimeout(timesUpTimerId);
    timesUpTimerId = null;
  }
}

function resetState() {
  lastSec = null;
  lastHalf = null;
  firedTimesUp = false;
  clearTimesUpTimer();
  if (aggressiveOn) {
    aggressiveOn = false;
    duckFn(false);
  }
}

function armTimesUpTimer(phase, deadline, offset) {
  const msLeft = deadline - (Date.now() + offset);
  const delay = Math.max(0, msLeft - TIMES_UP_EARLY_BIAS_MS);
  timesUpTimerId = setTimeout(() => {
    timesUpTimerId = null;
    // Only fire if this exact deadline is still the one in play (not abandoned
    // for an earlier-than-expiry phase/turn change) and we're still watching it.
    if (lastDeadline !== deadline || firedTimesUp) return;
    if (isMuted() || document.hidden || !hasActionNow) return; // stay silent, matches the rest of this module
    firedTimesUp = true;
    playTimesUp(getSharedCtx());
    if (aggressiveOn) {
      aggressiveOn = false;
      duckFn(false);
    }
  }, delay);
}

function tickOnce(phase, deadline, deadlineSecs, offset, hasAction) {
  hasActionNow = Boolean(hasAction);
  const isTickPhase = Boolean(tickPhases[phase]);
  if (deadline !== lastDeadline) {
    lastDeadline = deadline;
    resetState();
    if (isTickPhase && deadline && hasActionNow && !document.hidden) armTimesUpTimer(phase, deadline, offset);
  }

  if (isMuted() || document.hidden || !isTickPhase || !deadline || !hasActionNow) {
    if (aggressiveOn) {
      aggressiveOn = false;
      duckFn(false);
    }
    return;
  }

  const ctx = getSharedCtx();
  const left = Math.max(0, (deadline - (Date.now() + offset)) / 1000);
  const sec = Math.ceil(left);

  if (left <= 0) {
    // Backstop: the scheduled timer above normally fires this first, but cover
    // the case where it was delayed (e.g. a throttled background timer queue).
    if (!firedTimesUp) {
      firedTimesUp = true;
      playTimesUp(ctx);
    }
    if (aggressiveOn) {
      aggressiveOn = false;
      duckFn(false);
    }
    return;
  }

  if (left <= AGGRESSIVE_THRESHOLD) {
    if (!aggressiveOn) {
      aggressiveOn = true;
      duckFn(true);
    }
    const half = Math.floor(left * 2); // 0.5s buckets
    if (half !== lastHalf) {
      lastHalf = half;
      alternate = !alternate;
      playAggressiveTick(ctx, alternate);
    }
  } else {
    if (aggressiveOn) {
      aggressiveOn = false;
      duckFn(false);
    }
    if (sec !== lastSec) {
      lastSec = sec;
      playSoftTick(ctx);
    }
  }
}

/**
 * @param {boolean} hasAction - whether THIS player has something to do right now
 *   (e.g. it's their clue turn, they haven't voted yet, or they're the impostor
 *   during steal). Players with nothing to do get no ticks and no time's-up sound.
 */
export function syncTicks(phase, deadline, deadlineSecs, offset, hasAction) {
  if (!intervalId) {
    intervalId = setInterval(() => {
      if (!syncTicks.current) return;
      const { phase: p, deadline: d, deadlineSecs: ds, offset: o, hasAction: ha } = syncTicks.current;
      tickOnce(p, d, ds, o, ha);
    }, POLL_MS);
  }
  syncTicks.current = { phase, deadline, deadlineSecs, offset, hasAction };
  // Also tick immediately on each call (render-driven) so changes are responsive,
  // not just on the poll interval.
  tickOnce(phase, deadline, deadlineSecs, offset, hasAction);
}

export function stopTicks() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  syncTicks.current = null;
  lastDeadline = undefined;
  hasActionNow = false;
  resetState();
}
