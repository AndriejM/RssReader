// Global settings screen. Its first field is the horizon for «read» markers — how many days a
// deleted headline stays out of the list — written to storage only when «Записать» is pressed, next
// to a button that wipes the whole read list.
//
// The value is persisted in the shared settings store (chrome.storage.local), the same place the
// theme lives: the background worker reads it when it prunes read markers, so a plain per-page
// window.localStorage could not carry it.

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

  feeds: document.getElementById('btn-feeds'),
  reader: document.getElementById('btn-reader'),
  theme: document.getElementById('btn-theme'),
};

const state = {
  ttlDays: READ_TTL_DAYS,
  readCount: 0,
  /** The field holds a horizon the store does not have yet; only «Записать» commits it. */
  ttlPending: false,
};

function setStatus(message, kind = '') {
  els.status.textContent = message;
  els.status.className = kind ? `status ${kind}` : 'status';
}

/** Years are easier to read than a four-digit day count. */
function describeTtl(days) {
  if (days < 365) return `${days} дн`;
  return `${days} дн (${Math.round((days / 365) * 10) / 10} г)`;
}

async function renderReadStats() {
  const [read, ttlDays] = await Promise.all([store.getRead(), store.getReadTtlDays()]);
  state.ttlDays = ttlDays;
  state.readCount = read.length;

  els.readStats.textContent = state.readCount
    ? `прочитанных меток: ${state.readCount} · горят через ${describeTtl(state.ttlDays)}`
    : 'прочитанных меток нет';
}

/** Reflect the stored value in the field and clear any leftover error. */
async function renderTtl() {
  state.ttlDays = await store.getReadTtlDays();
  els.days.min = String(MIN_READ_TTL_DAYS);
  els.days.max = String(MAX_READ_TTL_DAYS);

  // The settings record changes for other reasons too (the theme lives in it), so an edit the
  // user has not written yet must survive them.
  if (!state.ttlPending) {
    els.days.value = String(state.ttlDays);
    els.daysError.textContent = '';
  }
  markPendingTtl();
}

/**
 * The field asks for a horizon the store does not have yet. A malformed value counts as pending
 * too, so pressing «Записать» explains the problem inline instead of looking inert.
 */
function ttlIsPending() {
  if (els.days.value.trim() === '' || !els.days.checkValidity()) return true;
  return Number(els.days.value) !== state.ttlDays;
}

/** Track the field against the stored value: «Записать» is enabled only when there is something to write. */
function markPendingTtl() {
  state.ttlPending = ttlIsPending();
  els.save.disabled = !state.ttlPending;
  els.save.title = state.ttlPending
    ? 'Записать значение read_ttl_days в хранилище'
    : 'Значение в поле уже записано';

  if (state.ttlPending) {
    if (!els.daysError.textContent) setStatus('Изменения не записаны', 'pending');
    return;
  }
  // Only our own hint goes away: a «Записано» confirmation must survive the storage event that
  // this very save announces back to the page.
  if (els.status.classList.contains('pending')) setStatus('');
}

/**
 * A raw field value is either an accepted whole number of days or a rejection we surface inline.
 * Storing clamps to the same bounds the input advertises, so an accepted value round-trips exactly.
 */
async function saveDays() {
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
  const saved = await store.setReadTtlDays(parsed);
  state.ttlDays = saved;
  state.ttlPending = false;
  els.save.disabled = true;
  setStatus(`Записано: горят через ${describeTtl(saved)}`, 'ok');

  // The worker watches the settings key and prunes the markers the new horizon has already
  // outrun; the storage event also refreshes this screen's own counters.
  await renderReadStats();
}

/**
 * A field edit is not written until «Записать» is pressed, so leaving the screen with a pending
 * value would drop it quietly — ask before doing that.
 */
function leavePage(url) {
  if (
    state.ttlPending &&
    !window.confirm('Значение read_ttl_days не записано. Уйти без записи?')
  ) {
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

els.days.addEventListener('input', markPendingTtl);
els.save.addEventListener('click', () => void saveDays());
els.clearRead.addEventListener('click', () => void clearRead());

// The screen reaches the reader the way the feeds screen does — the tab keeps its place.
els.feeds.addEventListener('click', () => leavePage(pageUrl(SETTINGS_PAGE)));
els.reader.addEventListener('click', () => leavePage(pageUrl(READER_PAGE)));

void wireThemeButton(els.theme);

/** Another page wrote read markers or settings; refresh the counters it affects. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[store.READ_KEY]) void renderReadStats();
  if (changes[store.SETTINGS_KEY]) void renderTtl().then(renderReadStats);
});

async function init() {
  await renderTtl();
  await renderReadStats();
}

void init();
