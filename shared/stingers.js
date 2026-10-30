// One-shot round-result stingers for the impostor in-game room: a bright "gotcha"
// fanfare when the impostor is BUSTED, and a sly "they got away" motif when the
// impostor ESCAPED. Both synthesized (no audio files), played through the shared
// ctx, and duck the mystery-music bed for the duration via setDuck().

import { setDuck } from './mystery-music.js';

function tone(ctx, { freq, start, duration, gainPeak, type = 'sine', endFreq = null }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
  osc.addEventListener('ended', () => {
    osc.disconnect();
    gain.disconnect();
  });
}

function noiseBurst(ctx, start, duration, gainPeak, highpassHz = 4000) {
  const bufferDur = 0.3;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * bufferDur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  src.buffer = buffer;
  hp.type = 'highpass';
  hp.frequency.value = highpassHz;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0003, start + duration);
  src.connect(hp).connect(gain).connect(ctx.destination);
  src.start(start);
  src.stop(start + duration + 0.02);
  src.addEventListener('ended', () => {
    src.disconnect();
    hp.disconnect();
    gain.disconnect();
  });
}

const STINGER_DUR_MS = 1600;

/** Triumphant "gotcha" fanfare: rising C-E-G-C' major arpeggio into a sustained
 * major chord, plus a short sparkle burst. ~1.6s. */
export function playBusted(ctx) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  setDuck(true);
  const arpeggio = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  arpeggio.forEach((freq, i) => {
    tone(ctx, { freq, start: t + i * 0.1, duration: 0.28, gainPeak: 0.16, type: 'triangle' });
  });
  // Sustained bright major chord (C6-E6-G6) to land the fanfare.
  [1046.5, 1318.51, 1567.98].forEach((freq) => {
    tone(ctx, { freq, start: t + 0.42, duration: 1.0, gainPeak: 0.1, type: 'triangle' });
  });
  // Cymbal-ish sparkle burst right on the landing chord.
  noiseBurst(ctx, t + 0.4, 0.5, 0.05, 6000);
  setTimeout(() => setDuck(false), STINGER_DUR_MS);
}

/** Sly "they got away" motif: a descending sad-trombone wah-wah slide into a
 * dissonant minor chord. ~1.5s, clearly distinct from the BUSTED fanfare. */
export function playEscaped(ctx) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  setDuck(true);
  // "Wah-wah-wah": three descending pitch-bent slides, each a semitone lower,
  // classic sad-trombone/villain-getaway gesture.
  const slideStarts = [392.0, 349.23, 311.13]; // G4, F4, Eb4
  slideStarts.forEach((freq, i) => {
    tone(ctx, {
      freq,
      endFreq: freq * 0.72,
      start: t + i * 0.26,
      duration: 0.3,
      gainPeak: 0.14,
      type: 'sawtooth',
    });
  });
  // Dissonant low minor-ish chord lands the joke.
  [207.65, 246.94, 293.66].forEach((freq) => {
    tone(ctx, { freq, start: t + 0.82, duration: 0.7, gainPeak: 0.1, type: 'sawtooth' });
  });
  setTimeout(() => setDuck(false), STINGER_DUR_MS);
}
