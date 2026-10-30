// Loops a real audio file (e.g. background music) via an HTMLAudioElement, with
// the same autoplay-gesture handling and fade behaviour as shared/music.js's
// synthesized chiptune, so pages can swap one for the other behind sfx.js's
// setMusicController() hook.

const EARLY_GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'click'];

export function mountTrack(src, { volume = 0.35, fadeInMs = 1500, fadeOutMs = 250, isMuted, onChange } = {}) {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;

  let fadeTimer = null;
  let waiting = false;
  let gestureArmed = false;
  // "Should this track be playing right now" per the owning page's controller
  // (e.g. impostor/play.js's jazz vs. mystery crossfade) - independent of
  // audio.paused, which also goes true while merely hidden. Without this,
  // visibilitychange/pageshow would call start() on every refocus regardless
  // of whether the page had since explicitly stop()'d this track in favor of
  // another source, bringing it back to play alongside that other source.
  let active = false;

  const muted = () => (typeof isMuted === 'function' ? isMuted() : false);
  const notify = () => {
    if (typeof onChange === 'function') onChange();
  };

  function clearFade() {
    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function fadeTo(target, ms) {
    clearFade();
    const steps = Math.max(1, Math.round(ms / 50));
    const stepAmt = (target - audio.volume) / steps;
    let i = 0;
    fadeTimer = setInterval(() => {
      i += 1;
      const next = i >= steps ? target : audio.volume + stepAmt;
      audio.volume = Math.min(1, Math.max(0, next));
      if (i >= steps) {
        clearFade();
        if (target === 0) audio.pause();
      }
    }, 50);
  }

  function removeGestureListeners(handler) {
    EARLY_GESTURE_EVENTS.forEach((type) => window.removeEventListener(type, handler));
  }

  function armGestureListeners() {
    if (gestureArmed) return;
    gestureArmed = true;
    const onGesture = () => {
      gestureArmed = false;
      removeGestureListeners(onGesture);
      if (muted()) return;
      attemptPlay();
    };
    EARLY_GESTURE_EVENTS.forEach((type) => window.addEventListener(type, onGesture, { passive: true }));
  }

  function attemptPlay() {
    waiting = true;
    const result = audio.play();
    if (!result || typeof result.then !== 'function') {
      // Older browsers: assume it worked.
      waiting = false;
      fadeTo(volume, fadeInMs);
      notify();
      return;
    }
    result
      .then(() => {
        waiting = false;
        fadeTo(volume, fadeInMs);
        notify();
      })
      .catch(() => {
        waiting = true;
        armGestureListeners();
        notify();
      });
  }

  function start() {
    if (muted()) return;
    active = true;
    if (!audio.paused) {
      fadeTo(volume, fadeInMs);
      return;
    }
    attemptPlay();
  }

  function stop({ fast = false } = {}) {
    active = false;
    if (audio.paused) {
      waiting = false;
      return;
    }
    fadeTo(0, fast ? 100 : fadeOutMs);
  }

  function isWaiting() {
    return waiting;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearFade();
      audio.pause();
    } else if (active && !muted()) {
      start();
    }
  });

  // bfcache fix: a page restored via back/forward can come back with the
  // element paused even though it was playing before navigation.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    if (active && !muted()) start();
  });

  // Best-effort autoplay attempt as soon as the track mounts.
  if (!muted()) start();

  return { audio, start, stop, isWaiting };
}
