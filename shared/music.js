// Playful 8-bit menu theme for the Game Night hub. No audio files, no dependencies:
// a lookahead scheduler drives a chiptune lead, a bouncing bass, fast chip arps, and
// a light drum kit, all through a single master gain so fades/mute/stop affect everything.

const BPM = 126;
const STEP_DUR = 60 / BPM / 4; // sixteenth-note step duration (seconds)
const STEPS_PER_BAR = 16;
const BARS_PER_PHRASE = 8;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.1; // seconds scheduled ahead of ctx.currentTime
const TARGET_GAIN = 0.055;
const FADE_IN = 0.8;
const FADE_OUT = 0.3;
const FADE_OUT_FAST = 0.1;

// I - V - vi - IV in C major, one chord per bar (C, G, Am, F repeated x2 per 8-bar phrase).
const CHORDS = [
  { root: 261.63, bass: 130.81, notes: [261.63, 329.63, 392.0] }, // C major
  { root: 392.0, bass: 196.0, notes: [392.0, 493.88, 587.33] }, // G major
  { root: 220.0, bass: 110.0, notes: [220.0, 261.63, 329.63] }, // A minor
  { root: 349.23, bass: 174.61, notes: [349.23, 440.0, 523.25] }, // F major
];

// Catchy A / A' 8-bar lead phrase. Each bar is 16 sixteenth-note steps; null = rest.
// Scale degrees are absolute frequencies (Hz) for a bright, hummable chiptune melody
// over C-G-Am-F-C-G-Am-F. Short staccato notes, with a quick arpeggio flourish at the
// end of the phrase (bar 8).
const N = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
};

function bar(...hits) {
  // hits: [stepIndex, freq] pairs -> fills a 16-step bar, rest elsewhere.
  const steps = new Array(STEPS_PER_BAR).fill(null);
  for (let i = 0; i < hits.length; i += 2) steps[hits[i]] = hits[i + 1];
  return steps;
}

const LEAD_PHRASE_A = [
  bar(0, N.C5, 4, N.E5, 8, N.G5, 12, N.E5), // over C
  bar(0, N.D5, 4, N.B4, 8, N.G4, 12, N.B4), // over G
  bar(0, N.C5, 4, N.A4, 8, N.E5, 12, N.C5), // over Am
  bar(0, N.A4, 4, N.F4, 6, N.A4, 8, N.C5, 12, N.A4), // over F
  bar(0, N.C5, 4, N.E5, 8, N.G5, 12, N.E5), // over C
  bar(0, N.D5, 4, N.B4, 8, N.G4, 12, N.B4), // over G
  bar(0, N.C5, 4, N.A4, 8, N.E5, 12, N.C5), // over Am
  // bar 8: quick arpeggio flourish up and resolve
  bar(0, N.F4, 2, N.A4, 4, N.C5, 6, N.F5, 8, N.A5, 10, N.F5, 12, N.C5, 14, N.A4),
];

// A' variation: answers the phrase with a slightly different melodic turn so the
// 8-bar loop doesn't feel like an exact repeat on the second pass.
const LEAD_PHRASE_A_PRIME = [
  bar(0, N.E5, 4, N.G5, 8, N.C5, 12, N.G4),
  bar(0, N.B4, 4, N.D5, 8, N.G4, 12, N.D5),
  bar(0, N.E5, 4, N.C5, 8, N.A4, 12, N.E5),
  bar(0, N.F4, 4, N.A4, 6, N.C5, 8, N.A4, 12, N.F4),
  bar(0, N.E5, 4, N.G5, 8, N.C5, 12, N.G4),
  bar(0, N.B4, 4, N.D5, 8, N.G4, 12, N.D5),
  bar(0, N.E5, 4, N.C5, 8, N.A4, 12, N.E5),
  bar(0, N.C5, 2, N.E5, 4, N.G5, 6, N.C5, 8, N.E5, 10, N.G5, 12, N.A5, 14, N.G5),
];

const LEAD_PHRASES = [LEAD_PHRASE_A, LEAD_PHRASE_A_PRIME];

let musicCtx = null;
let masterGain = null;
let lowpass = null;
let leadWave = null; // narrow pulse wave (~25%) for the lead
let arpWave = null; // narrower pulse wave (~12.5%) for the quiet chip arps
let noiseBuffer = null;
let schedulerId = null;
let nextStepTime = 0;
let stepIndex = 0;
let barIndex = 0;
let phraseCount = 0;
let playing = false;

function buildPulseWave(ctx, dutyCycle) {
  // Approximate a pulse wave of the given duty cycle via additive harmonics.
  const terms = 24;
  const real = new Float32Array(terms + 1);
  const imag = new Float32Array(terms + 1);
  for (let n = 1; n <= terms; n += 1) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * dutyCycle);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function buildNoiseBuffer(ctx) {
  const duration = 0.08;
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
  lowpass.frequency.value = 7000; // gentle tame of square-wave harshness, no muffling
  lowpass.connect(masterGain).connect(ctx.destination);
  leadWave = buildPulseWave(ctx, 0.25);
  arpWave = buildPulseWave(ctx, 0.125);
  noiseBuffer = buildNoiseBuffer(ctx);
}

function cleanupNode(osc, gain) {
  osc.disconnect();
  gain.disconnect();
}

// Every voice below routes through `lowpass`, which feeds the single `masterGain`.
// Nothing connects straight to ctx.destination or bypasses masterGain, so fades,
// mute, and stop reliably affect all of them.

function playLead(ctx, freq, start, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.setPeriodicWave(leadWave);
  osc.frequency.setValueAtTime(freq, start);
  const sustain = duration * 0.55; // staccato: short note, clear gap after
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.22, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + sustain);
  osc.connect(gain).connect(lowpass);
  osc.start(start);
  osc.stop(start + sustain + 0.02);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function playBass(ctx, freq, start, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.28, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration * 0.9);
  osc.connect(gain).connect(lowpass);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function playArp(ctx, freq, start, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.setPeriodicWave(arpWave);
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.07, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration * 0.85);
  osc.connect(gain).connect(lowpass);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function playHiHat(ctx, start) {
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  src.buffer = noiseBuffer;
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.05, start + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.035);
  src.connect(hp).connect(gain).connect(lowpass);
  src.start(start);
  src.stop(start + 0.04);
  src.addEventListener('ended', () => {
    src.disconnect();
    hp.disconnect();
    gain.disconnect();
  });
}

function playKick(ctx, start) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, start);
  osc.frequency.exponentialRampToValueAtTime(48, start + 0.09);
  gain.gain.setValueAtTime(0.18, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
  osc.connect(gain).connect(lowpass);
  osc.start(start);
  osc.stop(start + 0.13);
  osc.addEventListener('ended', () => cleanupNode(osc, gain));
}

function scheduleStep(ctx, time) {
  const chord = CHORDS[barIndex % CHORDS.length];
  const phrase = LEAD_PHRASES[phraseCount % LEAD_PHRASES.length];
  const leadBar = phrase[barIndex % BARS_PER_PHRASE];

  // Bass: octave-bouncing root/octave pattern on eighths (every 2 sixteenth steps).
  if (stepIndex % 2 === 0) {
    const eighth = (stepIndex / 2) % 2;
    const freq = eighth === 0 ? chord.bass : chord.bass * 2;
    playBass(ctx, freq, time, STEP_DUR * 2 * 0.85);
  }

  // Lead melody.
  const leadFreq = leadBar[stepIndex];
  if (leadFreq) {
    playLead(ctx, leadFreq, time, STEP_DUR * 2);
  }

  // Fast chip arpeggio: quiet 16th-note chord arp under the lead.
  const chordTone = chord.notes[stepIndex % chord.notes.length];
  playArp(ctx, chordTone * 2, time, STEP_DUR * 0.9);

  // Drums: soft kick on beats 1 & 3 (steps 0, 8), hi-hat on offbeats (odd eighths: 2,6,10,14).
  if (stepIndex === 0 || stepIndex === 8) {
    playKick(ctx, time);
  }
  if (stepIndex % 4 === 2) {
    playHiHat(ctx, time);
  }

  stepIndex += 1;
  if (stepIndex >= STEPS_PER_BAR) {
    stepIndex = 0;
    barIndex += 1;
    if (barIndex >= BARS_PER_PHRASE) {
      barIndex = 0;
      phraseCount += 1;
    }
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

export function startMusic(ctx) {
  if (!ctx) return;
  if (playing) return; // no double-start while already playing
  ensureGraph(ctx);
  playing = true;
  stepIndex = 0;
  barIndex = 0;
  nextStepTime = ctx.currentTime + 0.05;
  const now = ctx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(TARGET_GAIN, now + FADE_IN);
  schedulerId = setInterval(schedulerTick, LOOKAHEAD_MS);
}

export function stopMusic({ fast = false } = {}) {
  if (schedulerId) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
  if (!playing) return;
  playing = false;
  if (musicCtx && masterGain) {
    const now = musicCtx.currentTime;
    const dur = fast ? FADE_OUT_FAST : FADE_OUT;
    const ctx = musicCtx;
    const gainToKill = masterGain;
    gainToKill.gain.cancelScheduledValues(now);
    gainToKill.gain.setValueAtTime(gainToKill.gain.value, now);
    // Fade out, then fully disconnect so any still-sustaining notes (exponential
    // ramps on individual voice gains) are cut rather than left audible.
    gainToKill.gain.linearRampToValueAtTime(0, now + dur);
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

export function isMusicPlaying() {
  return playing;
}
