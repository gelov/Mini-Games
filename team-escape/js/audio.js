// Team Escape sound effects, synthesized on the shared Game Night AudioContext and silenced by the
// same mute toggle as every other page.
import { getSharedCtx, isMuted } from '../../shared/sfx.js';

const SOUNDS = {
  jump: [['square', 330, 520, 0.09, 0.05]],
  lever: [['triangle', 660, 660, 0.06, 0.12], ['triangle', 990, 990, 0.08, 0.1, 0.06]],
  plate: [['sine', 220, 180, 0.08, 0.14]],
  open: [['sawtooth', 110, 160, 0.25, 0.06]],
  key: [['triangle', 880, 880, 0.07, 0.12], ['triangle', 1175, 1175, 0.07, 0.12, 0.07], ['triangle', 1568, 1568, 0.12, 0.12, 0.14]],
  unlock: [['square', 392, 392, 0.08, 0.08], ['square', 523, 523, 0.08, 0.08, 0.08], ['square', 784, 784, 0.18, 0.08, 0.16]],
  escape: [['sine', 523, 1046, 0.2, 0.12]],
  fall: [['sawtooth', 300, 80, 0.3, 0.07]],
  checkpoint: [['triangle', 523, 659, 0.12, 0.1]],
  crumble: [['sawtooth', 90, 60, 0.18, 0.06]],
  win: [['square', 523, 523, 0.12, 0.09], ['square', 659, 659, 0.12, 0.09, 0.12], ['square', 784, 784, 0.12, 0.09, 0.24], ['square', 1046, 1046, 0.35, 0.09, 0.36]],
  tick: [['square', 880, 880, 0.04, 0.05]],
  go: [['square', 1046, 1046, 0.3, 0.08]],
  nope: [['square', 160, 140, 0.08, 0.05]],
};

export function sfx(name) {
  if (isMuted() || document.hidden) return;
  const ctx = getSharedCtx();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  for (const [type, f0, f1, dur, vol, delay = 0] of SOUNDS[name] ?? []) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0 + delay);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + delay + dur);
    gain.gain.setValueAtTime(0.0001, t0 + delay);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + delay);
    osc.stop(t0 + delay + dur + 0.02);
  }
}
