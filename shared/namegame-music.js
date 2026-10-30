// Name Game background score: a light game-show "lobby" loop and a quirky
// "ingame" thinking-time groove, synthesized (no audio files). Structured like
// shared/music.js and shared/mystery-music.js: a lookahead scheduler, a single
// masterGain -> lowpass routing so fades/mute/stop/duck affect everything,
// a fresh graph on restart, a double-start guard, throttle catch-up, and
// per-voice cleanup.
//
// Two themes share one engine (one masterGain/scheduler) so switching themes
// mid-game is a quick crossfade (fade down, swap pattern state, fade back up)
// rather than two competing audio graphs.

const BPM_LOBBY = 116;
const BPM_INGAME = 100;
const STEPS_PER_BAR = 8; // eighth notes per bar (4/4)
const BARS_PER_PHRASE = 8;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.1; // seconds scheduled ahead of ctx.currentTime
const TARGET_GAIN = 0.05;
const FADE_IN = 0.8;
const FADE_OUT = 0.35;
const FADE_OUT_FAST = 0.12;
const RETHEME_FADE = 0.22; // quick dip/rise when switching theme without a full stop
const DUCK_GAIN = 0.45;
const DUCK_RAMP = 0.15;

const NOTE = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
  Eb3: 155.56, Eb4: 311.13, Bb3: 233.08, Bb4: 466.16, Gb4: 369.99,
};

// ---------- Lobby theme: bouncy game-show lounge loop, C major, playful. ----------
// Marimba/pizzicato bass walking I-vi-IV-V, with a bright bell melody on top.
const LOBBY_BASS = [
  [NOTE.C3, null, NOTE.E3, null, NOTE.G3, null, NOTE.E3, null],
  [NOTE.A3, null, NOTE.C4, null, NOTE.E3, null, NOTE.C4, null],
  [NOTE.F3, null, NOTE.A3, null, NOTE.C4, null, NOTE.A3, null],
  [NOTE.G3, null, NOTE.B3, null, NOTE.D4, null, NOTE.B3, null],
];
const LOBBY_MELODY = [
  [[0, NOTE.C5], [3, NOTE.E5], [6, NOTE.G5]],
  [[1, NOTE.A4], [4, NOTE.C5]],
  [[0, NOTE.F4], [3, NOTE.A4], [6, NOTE.C5]],
  [[2, NOTE.D5], [5, NOTE.G4], [7, NOTE.B4]],
];

// ---------- Ingame theme: quirky "thinking time" groove, light tension. ----------
// Minor-leaning pizzicato bass + off-kilter marimba stabs. Intensity 0 = sparse
// (describe, everyone quietly writing); intensity 1 = a second percussive layer
// and a brighter filter (guess, the clock is ticking on everyone at once).
const INGAME_BASS = [
  [NOTE.Eb3, null, null, NOTE.G3, null, NOTE.Bb3, null, null],
  [NOTE.Eb3, null, NOTE.F3, null, null, NOTE.G3, null, null],
  [NOTE.C3, null, null, NOTE.Eb3, null, NOTE.G3, null, null],
  [NOTE.Bb3, null, NOTE.C4, null, null, NOTE.Eb3, null, null],
];
const INGAME_STAB = [
  [[2, NOTE.Gb4]],
  [[5, NOTE.Bb4], [7, NOTE.Eb4]],
  [[1, NOTE.Eb4]],
  [[4, NOTE.Gb4], [6, NOTE.Bb4]],
];
// Extra syncopated layer, only heard at intensity >= 1.
const INGAME_PULSE = [
  [[0, NOTE.Eb4], [4, NOTE.Eb4]],
  [[0, NOTE.F4], [4, NOTE.F4]],
  [[0, NOTE.C4], [4, NOTE.C4]],
  [[0, NOTE.Bb3], [4, NOTE.Bb3]],
];

const THEMES = {
  lobby: { bpm: BPM_LOBBY, bass: LOBBY_BASS, lead: LOBBY_MELODY, pulse: null, lowpassCalm: 2600, lowpassHot: 2600 },
  ingame: { bpm: BPM_INGAME, bass: INGAME_BASS, lead: INGAME_STAB, pulse: INGAME_PULSE, lowpassCalm: 1400, lowpassHot: 2300 },
};

let musicCtx = null;
let masterGain = null;
let lowpass = null;
let schedulerId = null;
let nextStepTime = 0;
let stepIndex = 0;
let barIndex = 0;
let playing = false;
let intensityLevel = 0;
let ducked = false;
let currentTheme = 'lobby';
let retheming = false;
let retimeTimerId = null; // pending retheme setTimeout, cancelled on stop/restart/re-retheme
let generation = 0; // bumped on every stop/start/retheme so a stale retheme callback can't touch a newer graph
let stepDur = 60 / THEMES.lobby.bpm / 2;

function ensureGraph(ctx) {
  if (masterGain && musicCtx === ctx) return;
  musicCtx = ctx;
  masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = THEMES[currentTheme].lowpassCalm;
  lowpass.connect(masterGain).connect(ctx.destination);
}

function cleanupNode(...nodes) {
  nodes.forEach((n) => {
    try {
      n.disconnect();
    } catch {
      // already disconnected
    }
  });
}

// Every voice below routes through `lowpass`, which feeds the single
// `masterGain`. Nothing connects straight to ctx.destination, so fades/mute/
// stop/duck affect all of them.

function playMarimba(ctx, freq, start, duration, peak = 0.3) {
  // Plucked marimba/pizzicato: triangle fundamental + quick sine thump, fast decay.
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(lowpass);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function playBell(ctx, freq, start) {
  // Bright bell/celesta hit for the lobby melody: sine + inharmonic partial.
  const osc = ctx.createOscillator();
  const partial = ctx.createOscillator();
  const gain = ctx.createGain();
  const partialGain = ctx.createGain();
  osc.type = 'sine';
  partial.type = 'sine';
  osc.frequency.setValueAtTime(freq, start);
  partial.frequency.setValueAtTime(freq * 2.4, start);
  const duration = 0.55;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.16, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0008, start + duration);
  partialGain.gain.setValueAtTime(0, start);
  partialGain.gain.linearRampToValueAtTime(0.04, start + 0.004);
  partialGain.gain.exponentialRampToValueAtTime(0.0005, start + duration * 0.4);
  osc.connect(gain).connect(lowpass);
  partial.connect(partialGain).connect(lowpass);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  partial.start(start);
  partial.stop(start + duration * 0.4 + 0.02);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
  partial.addEventListener('ended', () => cleanupNode(partial, partialGain));
}

function playStab(ctx, freq, start) {
  // Quirky square-ish stab for the ingame groove's melodic layer.
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, start);
  const duration = 0.22;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.1, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0008, start + duration);
  osc.connect(gain).connect(lowpass);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function playShaker(ctx, start) {
  // Light woodblock-ish tick to keep the lobby loop bouncy, high-passed noise burst.
  const duration = 0.03;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  src.buffer = buffer;
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.03, start + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0003, start + duration);
  src.connect(hp).connect(gain).connect(lowpass);
  src.start(start);
  src.stop(start + duration + 0.01);
  src.addEventListener('ended', () => cleanupNode(src, hp, gain));
}

function scheduleStep(ctx, time) {
  const theme = THEMES[currentTheme];
  const bar = barIndex % theme.bass.length;
  const freq = theme.bass[bar][stepIndex];
  if (freq) {
    if (currentTheme === 'lobby') playMarimba(ctx, freq, time, 0.5, 0.26);
    else playMarimba(ctx, freq, time, 0.32, 0.3);
  }

  const leadHits = theme.lead[bar % theme.lead.length];
  const hit = leadHits.find(([s]) => s === stepIndex);
  if (hit) {
    if (currentTheme === 'lobby') playBell(ctx, hit[1], time);
    else playStab(ctx, hit[1], time);
  }

  if (currentTheme === 'lobby' && stepIndex % 2 === 1) {
    playShaker(ctx, time);
  }

  if (currentTheme === 'ingame' && intensityLevel >= 1 && theme.pulse) {
    const pulseHits = theme.pulse[bar % theme.pulse.length];
    const pHit = pulseHits.find(([s]) => s === stepIndex);
    if (pHit) playMarimba(ctx, pHit[1], time, 0.18, 0.14);
  }

  stepIndex += 1;
  if (stepIndex >= STEPS_PER_BAR) {
    stepIndex = 0;
    barIndex += 1;
    if (barIndex >= BARS_PER_PHRASE) barIndex = 0;
  }
}

function schedulerTick() {
  if (!musicCtx) return;
  // If the tab was throttled and we've fallen behind, jump forward instead of
  // burst-scheduling every missed step.
  if (nextStepTime < musicCtx.currentTime) {
    nextStepTime = musicCtx.currentTime;
  }
  while (nextStepTime < musicCtx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(musicCtx, nextStepTime);
    nextStepTime += stepDur;
  }
}

function currentTarget() {
  return ducked ? TARGET_GAIN * DUCK_GAIN : TARGET_GAIN;
}

function clearRetimeTimer() {
  if (retimeTimerId) {
    clearTimeout(retimeTimerId);
    retimeTimerId = null;
  }
  retheming = false;
}

export function startNameMusic(ctx, { theme = 'lobby', intensity = 0 } = {}) {
  if (!ctx || !THEMES[theme]) return;
  intensityLevel = intensity;
  if (playing && currentTheme === theme) {
    // Already on the requested theme - but if a retheme to a *different*
    // theme is mid-dip (currentTheme only flips once its callback fires), a
    // stale timer would otherwise still win and switch us away a moment
    // later even though the caller just asked to stay on this one. Cancel it
    // and restore this theme's gain instead of leaving it to fade out.
    if (retimeTimerId) {
      clearRetimeTimer();
      generation += 1;
      if (musicCtx && masterGain) {
        const t = musicCtx.currentTime;
        masterGain.gain.cancelScheduledValues(t);
        masterGain.gain.setValueAtTime(masterGain.gain.value, t);
        masterGain.gain.linearRampToValueAtTime(currentTarget(), t + RETHEME_FADE);
      }
    }
    return; // no double-start, same theme
  }
  ensureGraph(ctx);
  const now = ctx.currentTime;

  if (playing && currentTheme !== theme) {
    // Quick crossfade: dip, swap the active pattern set, rise back up - one
    // engine, so this reads as a theme switch rather than a hard stop/start.
    // Cancel any retheme already in flight first, so overlapping theme
    // switches (or a stop landing mid-dip) can't leave two stale callbacks
    // racing each other or touching a graph that's since been torn down.
    clearRetimeTimer();
    generation += 1;
    const gen = generation;
    retheming = true;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, now + RETHEME_FADE);
    retimeTimerId = setTimeout(() => {
      retimeTimerId = null;
      // A stop (or a newer retheme/start) since this was scheduled means this
      // callback is stale: the graph it would touch may already be null'd out
      // (stopNameMusic nulls masterGain/lowpass but leaves musicCtx set), or
      // it would stomp on a playback that's since restarted from scratch.
      if (gen !== generation || !playing || !lowpass || !masterGain) return;
      currentTheme = theme;
      stepDur = 60 / THEMES[theme].bpm / 2;
      stepIndex = 0;
      barIndex = 0;
      lowpass.frequency.setTargetAtTime(
        intensityLevel >= 1 ? THEMES[theme].lowpassHot : THEMES[theme].lowpassCalm,
        musicCtx ? musicCtx.currentTime : 0,
        0.3
      );
      if (!musicCtx) return;
      const t = musicCtx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(0, t);
      masterGain.gain.linearRampToValueAtTime(currentTarget(), t + RETHEME_FADE);
      retheming = false;
    }, Math.ceil(RETHEME_FADE * 1000) + 5);
    return;
  }

  clearRetimeTimer();
  generation += 1;
  currentTheme = theme;
  stepDur = 60 / THEMES[theme].bpm / 2;
  playing = true;
  stepIndex = 0;
  barIndex = 0;
  nextStepTime = ctx.currentTime + 0.05;
  lowpass.frequency.setTargetAtTime(
    intensityLevel >= 1 ? THEMES[theme].lowpassHot : THEMES[theme].lowpassCalm,
    now,
    0.3
  );
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(ducked ? TARGET_GAIN * DUCK_GAIN : 0, now);
  masterGain.gain.linearRampToValueAtTime(currentTarget(), now + FADE_IN);
  schedulerId = setInterval(schedulerTick, LOOKAHEAD_MS);
}

export function stopNameMusic({ fast = false } = {}) {
  if (schedulerId) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
  clearRetimeTimer();
  generation += 1; // invalidates any retheme callback still in flight
  if (!playing) return;
  playing = false;
  if (musicCtx && masterGain) {
    const now = musicCtx.currentTime;
    const dur = fast ? FADE_OUT_FAST : FADE_OUT;
    const gainToKill = masterGain;
    gainToKill.gain.cancelScheduledValues(now);
    gainToKill.gain.setValueAtTime(gainToKill.gain.value, now);
    gainToKill.gain.linearRampToValueAtTime(0, now + dur);
    const ctx = musicCtx;
    setTimeout(() => {
      try {
        gainToKill.disconnect();
      } catch {
        // already disconnected
      }
    }, Math.ceil(dur * 1000) + 20);
    // Build a fresh master graph for the next start so restarts don't stack
    // nodes onto an already-fading (or disconnected) master.
    masterGain = null;
    lowpass = null;
    musicCtx = ctx;
  }
}

export function setIntensity(level) {
  intensityLevel = level;
  if (musicCtx && lowpass && playing && !retheming) {
    const theme = THEMES[currentTheme];
    lowpass.frequency.setTargetAtTime(level >= 1 ? theme.lowpassHot : theme.lowpassCalm, musicCtx.currentTime, 0.3);
  }
}

export function setDuck(on) {
  ducked = Boolean(on);
  if (!musicCtx || !masterGain || !playing || retheming) return;
  const now = musicCtx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(currentTarget(), now + DUCK_RAMP);
}

export function isNameMusicPlaying() {
  return playing;
}
