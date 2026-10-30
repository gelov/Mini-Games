// Mysterious "who's the impostor" background score for the in-game room. No audio
// files: a lookahead scheduler drives a sneaky pizzicato bass, a sparse music-box
// motif, a low drone, occasional suspense swells, and a soft brushed hat, all
// through a single master gain (via a lowpass) so fades/mute/stop/duck affect
// everything at once. Mirrors the structure of shared/music.js.

const BPM = 76;
const BEAT_DUR = 60 / BPM; // seconds per quarter note
const STEPS_PER_BAR = 8; // eighth notes per bar (4/4)
const STEP_DUR = BEAT_DUR / 2;
const BARS_PER_PHRASE = 8;
const SWELL_EVERY_BARS = 8; // one suspense swell per phrase
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.1; // seconds scheduled ahead of ctx.currentTime
const TARGET_GAIN = 0.05;
const FADE_IN = 1.0;
const FADE_OUT = 0.4;
const FADE_OUT_FAST = 0.12;
const DUCK_GAIN = 0.4;
const DUCK_RAMP = 0.15;

// A minor, low register, with chromatic semitone creeps for the noir/Pink Panther feel.
const A2 = 110.0;
const NOTE = {
  A1: 55.0, A2: 110.0, Bb2: 116.54, B2: 123.47, C3: 130.81, Db3: 138.59,
  D3: 146.83, Eb3: 155.56, E3: 164.81, F3: 174.61, Fs3: 184.99, G3: 196.0,
  Ab3: 207.65, A3: 220.0, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63,
  G4: 392.0, A4: 440.0,
};

// Sneaky walking-bass line, 8 steps per bar, chromatic creeps. null = rest/hold.
const BASS_PATTERN = [
  [NOTE.A2, null, NOTE.Bb2, null, NOTE.B2, null, NOTE.C3, null],
  [NOTE.A2, null, null, NOTE.G3, null, NOTE.Fs3, null, null],
  [NOTE.A2, null, NOTE.Bb2, null, NOTE.B2, null, NOTE.C3, NOTE.Db3],
  [NOTE.D3, null, null, NOTE.C3, null, NOTE.B2, null, null],
  [NOTE.A2, null, NOTE.Bb2, null, NOTE.B2, null, NOTE.C3, null],
  [NOTE.A2, null, null, NOTE.E3, null, NOTE.G3, null, null],
  [NOTE.A2, null, NOTE.C3, null, NOTE.E3, null, NOTE.D3, NOTE.Db3],
  [NOTE.C3, null, null, NOTE.B2, null, NOTE.Bb2, null, NOTE.A2],
];

// Sparse music-box motif, mostly rests. Each entry is [step, freq] per bar.
const MOTIF = [
  [[2, NOTE.E4]],
  [],
  [[4, NOTE.C4], [6, NOTE.D4]],
  [[0, NOTE.A3]],
  [],
  [[3, NOTE.E4], [5, NOTE.G4]],
  [[1, NOTE.A4]],
  [[6, NOTE.C4], [7, NOTE.A3]],
];

let musicCtx = null;
let masterGain = null;
let lowpass = null;
let noiseBuffer = null;
let schedulerId = null;
let nextStepTime = 0;
let stepIndex = 0;
let barIndex = 0;
let playing = false;
let intensityLevel = 0;
let ducked = false;

function buildNoiseBuffer(ctx) {
  const duration = 0.1;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function ensureGraph(ctx) {
  if (masterGain && musicCtx === ctx) return;
  musicCtx = ctx;
  masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 1100; // calm (intensity 0): dark, muffled
  lowpass.connect(masterGain).connect(ctx.destination);
  noiseBuffer = buildNoiseBuffer(ctx);
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

// Every voice below routes through `lowpass`, which feeds the single `masterGain`.
// Nothing connects straight to ctx.destination, so fades/mute/stop/duck affect all.

function playBassNote(ctx, freq, start, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, start);
  // pizzicato: fast attack, quick decay - sneaky staccato feel
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.5, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration * 0.6);
  osc.connect(gain).connect(lowpass);
  osc.start(start);
  osc.stop(start + duration * 0.6 + 0.02);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function playMotifNote(ctx, freq, start) {
  // music-box / celesta: sine fundamental + soft bell-ish partial, short decay.
  const osc = ctx.createOscillator();
  const partial = ctx.createOscillator();
  const gain = ctx.createGain();
  const partialGain = ctx.createGain();
  osc.type = 'sine';
  partial.type = 'triangle';
  osc.frequency.setValueAtTime(freq, start);
  partial.frequency.setValueAtTime(freq * 2.76, start); // inharmonic bell-ish partial
  const duration = 0.9;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.14, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0008, start + duration);
  partialGain.gain.setValueAtTime(0, start);
  partialGain.gain.linearRampToValueAtTime(0.03, start + 0.004);
  partialGain.gain.exponentialRampToValueAtTime(0.0005, start + duration * 0.5);
  osc.connect(gain).connect(lowpass);
  partial.connect(partialGain).connect(lowpass);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  partial.start(start);
  partial.stop(start + duration * 0.5 + 0.02);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
  partial.addEventListener('ended', () => cleanupNode(partial, partialGain));
}

let droneOsc = null;
let droneGain = null;

function ensureDrone(ctx) {
  if (droneOsc) return;
  droneOsc = ctx.createOscillator();
  droneGain = ctx.createGain();
  droneOsc.type = 'sine';
  droneOsc.frequency.setValueAtTime(NOTE.A1, ctx.currentTime);
  droneGain.gain.setValueAtTime(0, ctx.currentTime);
  droneGain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 1.2);
  droneOsc.connect(droneGain).connect(lowpass);
  droneOsc.start();
}

function stopDrone() {
  if (!droneOsc) return;
  const osc = droneOsc;
  const gain = droneGain;
  droneOsc = null;
  droneGain = null;
  if (musicCtx && gain) {
    const now = musicCtx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.3);
  }
  try {
    osc.stop((musicCtx ? musicCtx.currentTime : 0) + 0.35);
  } catch {
    // already stopped
  }
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function playSwell(ctx, start) {
  // Slow filter-sweep suspense swell: soft rising minor chord, swept open then closed.
  const gain = ctx.createGain();
  const freqs = [NOTE.A2, NOTE.C3, NOTE.E3];
  const duration = 5;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.08, start + duration * 0.6);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  gain.connect(lowpass);
  const oscs = freqs.map((f) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, start);
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + duration + 0.05);
    osc.addEventListener('ended', () => cleanupNode(osc));
    return osc;
  });
  // GainNode has no 'ended' event; clean it up once the last oscillator ends.
  oscs[oscs.length - 1].addEventListener('ended', () => cleanupNode(gain));
}

function playHat(ctx, start) {
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  src.buffer = noiseBuffer;
  hp.type = 'highpass';
  hp.frequency.value = 5500;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.018, start + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0003, start + 0.03);
  src.connect(hp).connect(gain).connect(lowpass);
  src.start(start);
  src.stop(start + 0.04);
  src.addEventListener('ended', () => cleanupNode(src, hp, gain));
}

let heartbeatPhase = 0;

function playHeartbeat(ctx, start) {
  // Low thudding pulse layered in at intensity 1 (vote/steal), on the downbeat.
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(70, start);
  osc.frequency.exponentialRampToValueAtTime(38, start + 0.12);
  gain.gain.setValueAtTime(0.1, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
  osc.connect(gain).connect(lowpass);
  osc.start(start);
  osc.stop(start + 0.18);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function scheduleStep(ctx, time) {
  const bar = BARS_PER_PHRASE ? barIndex % BARS_PER_PHRASE : 0;
  const bassFreq = BASS_PATTERN[bar % BASS_PATTERN.length][stepIndex];
  if (bassFreq) {
    playBassNote(ctx, bassFreq, time, STEP_DUR * 2);
  }

  const motifHits = MOTIF[bar % MOTIF.length];
  const hit = motifHits.find(([s]) => s === stepIndex);
  if (hit) {
    playMotifNote(ctx, hit[1], time);
  }

  // Soft brushed hat on offbeats, sparse.
  if (stepIndex % 4 === 2) {
    playHat(ctx, time);
  }

  // Heartbeat layer only at raised intensity, on the downbeat of each bar.
  if (intensityLevel >= 1 && stepIndex === 0) {
    playHeartbeat(ctx, time);
  }

  // Suspense swell every N bars, started at the top of the bar.
  if (stepIndex === 0 && barIndex % SWELL_EVERY_BARS === 0 && barIndex !== 0) {
    playSwell(ctx, time);
  }

  stepIndex += 1;
  if (stepIndex >= STEPS_PER_BAR) {
    stepIndex = 0;
    barIndex += 1;
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
    nextStepTime += STEP_DUR;
  }
}

export function startMystery(ctx, { intensity = 0 } = {}) {
  if (!ctx) return;
  intensityLevel = intensity;
  if (playing) return; // no double-start while already playing
  ensureGraph(ctx);
  playing = true;
  stepIndex = 0;
  barIndex = 0;
  heartbeatPhase = 0;
  nextStepTime = ctx.currentTime + 0.05;
  ensureDrone(ctx);
  lowpass.frequency.setTargetAtTime(intensityLevel >= 1 ? 2200 : 1100, ctx.currentTime, 0.4);
  const now = ctx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(ducked ? TARGET_GAIN * DUCK_GAIN : 0, now);
  masterGain.gain.linearRampToValueAtTime(ducked ? TARGET_GAIN * DUCK_GAIN : TARGET_GAIN, now + FADE_IN);
  schedulerId = setInterval(schedulerTick, LOOKAHEAD_MS);
}

export function stopMystery({ fast = false } = {}) {
  if (schedulerId) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
  if (!playing) return;
  playing = false;
  stopDrone();
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
  if (musicCtx && lowpass && playing) {
    lowpass.frequency.setTargetAtTime(level >= 1 ? 2200 : 1100, musicCtx.currentTime, 0.4);
  }
}

export function setDuck(on) {
  ducked = Boolean(on);
  if (!musicCtx || !masterGain || !playing) return;
  const now = musicCtx.currentTime;
  const target = ducked ? TARGET_GAIN * DUCK_GAIN : TARGET_GAIN;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(target, now + DUCK_RAMP);
}

export function isMysteryPlaying() {
  return playing;
}
