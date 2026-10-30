import { SVG } from '../../brew-leap/js/sprites.js';
import { mountNightSky } from '../../shared/night-sky.js';
import { mountToggle, wireUiSounds } from '../../shared/sfx.js';
import { heroScene, EMBLEMS } from './art.js';
import { characterReady } from './character.js';
import { api, session, lastName, normalizeCode } from './ui.js';

document.querySelectorAll('[data-icon="mug"]').forEach((el) => { el.innerHTML = SVG.mug; });
const heroArt = document.querySelector('[data-hero-art]');
heroArt.innerHTML = heroScene();
characterReady.then(() => { heroArt.innerHTML = heroScene(); });
document.querySelector('[data-emblems]').innerHTML = EMBLEMS.join('');
mountNightSky(document.querySelector('.skyline'), { pillars: false });
mountToggle(document.querySelector('.sound-toggle'));
wireUiSounds(document);

// ---------- create ----------

const dialog = document.querySelector('[data-create-dialog]');
const form = document.querySelector('[data-create-form]');
const createError = document.querySelector('[data-create-error]');
const sizePicker = document.querySelector('[data-size-picker]');
let teamSize = 5;

sizePicker.innerHTML = [5, 6, 7, 8, 9, 10].map((n) =>
  `<button type="button" class="segmented__btn" data-size="${n}" aria-pressed="${n === teamSize}">${n}</button>`).join('');
sizePicker.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-size]');
  if (!btn) return;
  teamSize = Number(btn.dataset.size);
  sizePicker.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
});

document.querySelectorAll('[data-create]').forEach((btn) => btn.addEventListener('click', () => {
  createError.textContent = '';
  form.elements.name.value = lastName.get();
  dialog.showModal();
  form.elements.name.focus();
}));
dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = form.elements.name.value.trim();
  if (!name) {
    createError.textContent = 'Enter a display name.';
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const settings = {
      lobbyName: form.elements.lobbyName.value.trim(),
      teamSize,
      rounds: Number(form.elements.rounds.value),
      roundMins: Number(form.elements.roundMins.value),
      difficulty: form.elements.difficulty.value,
    };
    const room = await api('/rooms', { name, settings });
    lastName.set(name);
    session.set(room.code, { token: room.token, playerId: room.playerId });
    location.href = `play.html?room=${room.code}`;
  } catch (err) {
    createError.textContent = err.message;
    submit.disabled = false;
  }
});

// ---------- join ----------

const joinForm = document.querySelector('[data-join-form]');
const joinError = document.querySelector('[data-join-error]');
const codeInput = joinForm.elements.code;

codeInput.addEventListener('input', () => { codeInput.value = normalizeCode(codeInput.value); });
document.querySelector('[data-focus-join]').addEventListener('click', () => setTimeout(() => codeInput.focus(), 300));

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = normalizeCode(codeInput.value);
  if (code.length !== 4) {
    joinError.textContent = 'Lobby codes are 4 letters.';
    codeInput.focus();
    return;
  }
  try {
    await api(`/rooms/${code}`);
    location.href = `play.html?room=${code}`;
  } catch (err) {
    joinError.textContent = err.message;
  }
});
