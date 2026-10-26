import { SVG } from '../brew-leap/js/sprites.js';
import { mountNightSky } from '../shared/night-sky.js';
import { api, session, lastName, normalizeCode } from './ui.js';

document.querySelectorAll('[data-icon="mug"]').forEach((el) => { el.innerHTML = SVG.mug; });
mountNightSky(document.querySelector('.skyline'), { pillars: false });

// ---------- create ----------

const dialog = document.querySelector('[data-create-dialog]');
const createForm = document.querySelector('[data-create-form]');
const createError = document.querySelector('[data-create-error]');
const nameInput = createForm.elements.name;

document.querySelectorAll('[data-create]').forEach((btn) => btn.addEventListener('click', () => {
  createError.textContent = '';
  nameInput.value = lastName.get();
  dialog.showModal();
  nameInput.focus();
  nameInput.select();
}));
dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    createError.textContent = 'Enter a display name.';
    return;
  }
  const submit = createForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const room = await api('/rooms', { name });
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
    joinError.textContent = 'Room codes are 4 letters.';
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
