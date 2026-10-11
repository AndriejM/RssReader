// Global settings screen. It holds the horizon for «read» markers — how many days a deleted
// headline stays out of the list — and the mp3 signal played when an automatic fetch brings news.
// Neither field writes on its own: both go to storage only when «Записать» is pressed, next to a
// button that wipes the whole read list.
//
// The values are persisted in the shared settings store (chrome.storage.local), the same place the
// theme lives: the background worker reads them when it prunes read markers and when it plays the
// alert, so a plain per-page window.localStorage could not carry them.

import * as store from './lib/storage.js';
import { READER_PAGE, SETTINGS_PAGE, pageUrl } from './lib/tabs.js';
import { wireThemeButton } from './lib/theme.js';
import { MAX_READ_TTL_DAYS, MIN_READ_TTL_DAYS, READ_TTL_DAYS } from './lib/util.js';

const els = {
  days: document.getElementById('read-ttl-days'),
  daysError: document.getElementById('read-ttl-error'),
  save: document.getElementById('btn-save'),
  clearRead: document.getElementById('btn-clear-read'),
  readStats: document.getElementById('read-stats'),
  status: document.getElementById('read-status'),

  sound: document.getElementById('sound-file'),
  soundStats: document.getElementById('sound-stats'),

  feeds: document.getElementById('btn-feeds'),
  reader: document.getElementById('btn-reader'),
  theme: document.getElementById('btn-theme'),
};

const state = {
  ttlDays: READ_TTL_DAYS,
  readCount: 0,
  soundChoice: store.DEFAULT_SOUND_FILE,
  /** A field holds a value the store does not have yet; only «Записать» commits it. */
  ttlPending: false,
  soundPending: false,
};

/**
 * Options for the sound combobox: «Без звука» first — it silences the alert — then every signal
 * bundled in `src/media`, named by its file so the choice is recognisable.
 */
const SOUND_OPTIONS = [
  { value: store.SOUND_NONE, label: 'Без звука' },
  ...store.SOUND_FILES.map((file) => ({
    value: file,
    label: file.slice('src/media/'.length, -'.mp3'.length),
  })),
];

function setStatus(message, kind = '') {
  els.status.textContent = message;
  els.status.className = kind ? `status ${kind}` : 'status';
}

/** Years are easier to read than a four-digit day count. */
function describeTtl(days) {
  if (days < 365) return `${days} дн`;
  return `${days} дн (${Math.round((days / 365) * 10) / 10} г)`;
}

/** How the stored sound choice reads to a person. */
function describeSound(choice) {
  return choice === store.SOUND_NONE ? 'без звука' : choice.slice('src/media/'.length);
}

async function renderReadStats() {
  const [read, ttlDays] = await Promise.all([store.getRead(), store.getReadTtlDays()]);
  state.ttlDays = ttlDays;
  state.readCount = read.length;

  els.readStats.textContent = state.readCount
    ? `прочитанных меток: ${state.readCount} · горят через ${describeTtl(state.ttlDays)}`
    : 'прочитанных меток нет';
}

/** Reflect the stored horizon in the field and clear any leftover error. */
async function renderTtl() {
  state.ttlDays = await store.getReadTtlDays();
  els.days.min = String(MIN_READ_TTL_DAYS);
  els.days.max = String(MAX_READ_TTL_DAYS);

  // The settings record changes for other reasons too (the theme and the sound live in it), so an
  // edit the user has not written yet must survive them.
  if (!state.ttlPending) {
    els.days.value = String(state.ttlDays);
    els.daysError.textContent = '';
  }
}

/** Show the stored signal in the combobox and under it. */
async function renderSound() {
  state.soundChoice = await store.getSoundChoice();
  if (!state.soundPending) els.sound.value = state.soundChoice;

  els.soundStats.textContent = `сейчас играет: ${describeSound(state.soundChoice)}`;
}

/**
 * Reflect the stored pair in the fields, then judge them together. Pending must not be judged
 * while a field still shows the value it had before its own render: an empty days field would
 * otherwise look like an unwritten edit and block `renderTtl` from filling it.
 */
async function refreshFields() {
  await renderTtl();
  await renderSound();
  markPending();
}

/**
 * The field asks for a horizon the store does not have yet. A malformed value counts as pending
 * too, so pressing «Записать» explains the problem inline instead of looking inert.
 */
function ttlIsPending() {
  if (els.days.value.trim() === '' || !els.days.checkValidity()) return true;
  return Number(els.days.value) !== state.ttlDays;
}

function soundIsPending() {
  return els.sound.value !== state.soundChoice;
}

/**
 * Track both fields against the store: «Записать» is enabled only when at least one of them has
 * something to write.
 */
function markPending() {
  state.ttlPending = ttlIsPending();
  state.soundPending = soundIsPending();
  const dirty = state.ttlPending || state.soundPending;

  els.save.disabled = !dirty;
  els.save.title = dirty
    ? 'Записать read_ttl_days и звук в хранилище'
    : 'Оба поля уже записаны';

  if (dirty) {
    if (!els.daysError.textContent) setStatus('Изменения не записаны', 'pending');
    return;
  }
  // Only our own hint goes away: a «Записано» confirmation must survive the storage event that
  // this very save announces back to the page.
  if (els.status.classList.contains('pending')) setStatus('');
}

/**
 * A raw days value is either an accepted whole number of days or a rejection we surface inline.
 * Storing clamps to the same bounds the input advertises, so an accepted value round-trips exactly.
 * The sound is written by the same press of «Записать»: only a bundled signal or «Без звука»
 * reach storage, and the worker picks the new file up on its very next alert.
 */
async function saveFields() {
  const parsed = Number(els.days.value);
  if (
    els.days.value.trim() === '' ||
    !els.days.checkValidity() ||
    !Number.isInteger(parsed) ||
    parsed < MIN_READ_TTL_DAYS ||
    parsed > MAX_READ_TTL_DAYS
  ) {
    els.daysError.textContent =
      `Целое число от ${MIN_READ_TTL_DAYS} до ${MAX_READ_TTL_DAYS} дней`;
    setStatus('Не записано', 'error');
    state.ttlPending = true;
    els.save.disabled = false;
    return;
  }
  els.daysError.textContent = '';

  const parts = [];
  if (parsed !== state.ttlDays) {
    const saved = await store.setReadTtlDays(parsed);
    state.ttlDays = saved;
    parts.push(`горят через ${describeTtl(saved)}`);
  }
  if (els.sound.value !== state.soundChoice) {
    const saved = await store.setSoundChoice(els.sound.value);
    state.soundChoice = saved;
    els.sound.value = saved;
    parts.push(`звук: ${describeSound(saved)}`);
  }

  if (parts.length === 0) {
    setStatus('Нечего записывать', 'ok');
    return;
  }

  state.ttlPending = false;
  state.soundPending = false;
  els.save.disabled = true;
  setStatus(`Записано: ${parts.join(' · ')}`, 'ok');

  // The worker watches the settings key and prunes the markers the new horizon has already
  // outrun; the storage event also refreshes this screen's own counters.
  await renderReadStats();
  els.soundStats.textContent = `сейчас играет: ${describeSound(state.soundChoice)}`;
}

/**
 * A field edit is not written until «Записать» is pressed, so leaving the screen with a pending
 * value would drop it quietly — ask before doing that.
 */
function leavePage(url) {
  const dirty = state.ttlPending || state.soundPending;
  if (dirty && !window.confirm('Изменения не записаны. Уйти без записи?')) {
    return;
  }
  window.location.assign(url);
}

async function clearRead() {
  if (state.readCount === 0) {
    setStatus('Список прочитанных уже пуст', 'ok');
    return;
  }
  if (!window.confirm('Забыть все прочитанные метки? Удалённые новости могут вернуться в ленты.')) {
    return;
  }

  els.clearRead.disabled = true;
  try {
    const removed = await store.clearRead();
    await renderReadStats();
    setStatus(`Забыто прочитанных: ${removed}`, 'ok');
  } finally {
    els.clearRead.disabled = false;
  }
}

els.days.addEventListener('input', markPending);
els.sound.addEventListener('change', markPending);
els.save.addEventListener('click', () => void saveFields());
els.clearRead.addEventListener('click', () => void clearRead());

// The screen reaches the reader the way the feeds screen does — the tab keeps its place.
els.feeds.addEventListener('click', () => leavePage(pageUrl(SETTINGS_PAGE)));
els.reader.addEventListener('click', () => leavePage(pageUrl(READER_PAGE)));

void wireThemeButton(els.theme);

/** Another page wrote read markers or settings; refresh the counters it affects. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[store.READ_KEY]) void renderReadStats();
  if (changes[store.SETTINGS_KEY]) void refreshFields().then(renderReadStats);
});

/** Fill the combobox once: its options are fixed by the bundled media, its value comes from storage. */
function fillSoundOptions() {
  for (const option of SOUND_OPTIONS) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    els.sound.appendChild(element);
  }
}

async function init() {
  fillSoundOptions();
  await refreshFields();
  await renderReadStats();
}

void init();
