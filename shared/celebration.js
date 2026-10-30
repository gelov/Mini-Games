// Triumphant final-screen celebration fanfare: a rising major arpeggio into a
// sustained bright chord, plus filtered-noise applause/crowd-cheer swells and
// sparkle on top. Bigger and longer than stingers.js's playBusted (~2.5-3s vs
// ~1.6s). Synthesized, no audio files. Routed straight to ctx.destination
// (this is a one-shot celebratory sting, not part of a duckable music bed).

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

function makeNoiseBuffer(ctx, duration) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noiseBurst(ctx, start, duration, gainPeak, highpassHz = 5000) {
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  src.buffer = makeNoiseBuffer(ctx, duration + 0.05);
  hp.type = 'highpass';
  hp.frequency.value = highpassHz;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0003, start + duration);
  src.connect(hp).connect(gain).connect(ctx.destination);
  src.start(start);
  src.stop(start + duration + 0.03);
  src.addEventListener('ended', () => {
    src.disconnect();
    hp.disconnect();
    gain.disconnect();
  });
}

/** Swelling filtered-noise "applause/crowd cheer": a bandpassed noise bed with
 * a slow volume swell, lower and longer than the sparkle noiseBurst above. */
function playApplauseSwell(ctx, start, duration, gainPeak) {
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const bp = ctx.createBiquadFilter();
  src.buffer = makeNoiseBuffer(ctx, duration + 0.1);
  src.loop = false;
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1800, start);
  bp.Q.value = 0.6;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + duration * 0.35);
  gain.gain.linearRampToValueAtTime(gainPeak * 0.8, start + duration * 0.7);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  src.connect(bp).connect(gain).connect(ctx.destination);
  src.start(start);
  src.stop(start + duration + 0.05);
  src.addEventListener('ended', () => {
    src.disconnect();
    bp.disconnect();
    gain.disconnect();
  });
}

/** Plays the "you win!" celebration: rising C major arpeggio -> sustained
 * bright chord, applause swells underneath, and a sparkle flourish on top.
 * ~2.6s total. Caller is responsible for checking isMuted(). */
export function playCelebration(ctx) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;

  // Crowd-cheer bed: two overlapping applause swells for a fuller, longer cheer.
  playApplauseSwell(ctx, t, 2.4, 0.07);
  playApplauseSwell(ctx, t + 0.5, 2.0, 0.05);

  // Rising arpeggio: C5 E5 G5 C6 E6 G6, bigger range than playBusted's single octave.
  const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
  arpeggio.forEach((freq, i) => {
    tone(ctx, { freq, start: t + i * 0.09, duration: 0.3, gainPeak: 0.17, type: 'triangle' });
  });

  // Sustained bright major chord (C6-E6-G6-C7) lands the fanfare, held long.
  const landStart = t + 0.62;
  [1046.5, 1318.51, 1567.98, 2093.0].forEach((freq) => {
    tone(ctx, { freq, start: landStart, duration: 1.7, gainPeak: 0.1, type: 'triangle' });
  });

  // Sparkle: a few high bell chimes scattered over the sustain.
  [2093.0, 2637.02, 3135.96].forEach((freq, i) => {
    tone(ctx, { freq, start: landStart + 0.15 + i * 0.22, duration: 0.6, gainPeak: 0.05, type: 'sine' });
  });

  // Cymbal-ish sparkle burst right on the landing chord, plus a second smaller one.
  noiseBurst(ctx, landStart, 0.6, 0.055, 6500);
  noiseBurst(ctx, landStart + 0.9, 0.4, 0.035, 7000);
}
