// Global settings screen. It holds the horizon for «read» markers — how many days a deleted
// headline stays out of the list — the mp3 signal played when an automatic fetch brings news
// (with its on/off flag and volume) and the interface language. None of the fields writes on
// its own: all of them go to storage only when «Save» is pressed, next to a button that
// wipes the whole read list.
//
// The values are persisted in the shared settings store (chrome.storage.local), the same place the
// theme lives: the background worker reads them when it prunes read markers and when it plays the
// alert, so a plain per-page window.localStorage could not carry them.

import { LANGUAGE_NAMES, adoptLanguage, applyI18n, currentLanguage, t } from './lib/i18n.js';
import { mountNav } from './lib/nav.js';
import * as store from './lib/storage.js';
import { wireThemeButton } from './lib/theme.js';
import {
  DEFAULT_SOUND_VOLUME,
  MAX_READ_RECORDS,
  MAX_READ_TTL_DAYS,
  MIN_READ_TTL_DAYS,
  READ_TTL_DAYS,
} from './lib/util.js';

const els = {
  days: document.getElementById('read-ttl-days'),
  daysError: document.getElementById('read-ttl-error'),
  save: document.getElementById('btn-save'),
  clearRead: document.getElementById('btn-clear-read'),
  readStats: document.getElementById('read-stats'),
  status: document.getElementById('read-status'),
  announce: document.getElementById('settings-announce'),

  sound: document.getElementById('sound-file'),
  soundEnabled: document.getElementById('sound-enabled'),
  soundStats: document.getElementById('sound-stats'),
  playSound: document.getElementById('btn-sound-play'),
  volume: document.getElementById('sound-volume'),
  volumeValue: document.getElementById('sound-volume-value'),
  showMessage: document.getElementById('show-message'),

  language: document.getElementById('language-file'),

  theme: document.getElementById('btn-theme'),
};

// Static captions are drawn before the storage read resolves: the cached (or detected) language
// already knows which of them this page should show.
applyI18n();

const state = {
  ttlDays: READ_TTL_DAYS,
  readCount: 0,
  soundChoice: store.DEFAULT_SOUND_FILE,
  soundEnabled: true,
  soundVolume: DEFAULT_SOUND_VOLUME,
  showMessage: false,
  language: currentLanguage(),
  /** A field holds a value the store does not have yet; only «Save» commits it. */
  ttlPending: false,
  soundPending: false,
  soundEnabledPending: false,
  volumePending: false,
  messagePending: false,
  languagePending: false,
};

/**
 * What the screen announces aloud: the same line that stands under the field table, but read out by
 * a screen reader. A live status answers to a change of text, so the same message from two presses in
 * a row is cleared and set anew — otherwise the second "Saved" would be silence. An empty line is
 * silent.
 */
function announce(message) {
  if (!message) return;
  els.announce.textContent = '';
  setTimeout(() => {
    els.announce.textContent = message;
  }, 50);
}

/**
 * The outcome of working with the fields — aloud; the hint about unwritten values — not: `pending`
 * hangs on the screen from the first character typed in a field, and repeating it on every keypress
 * would deafen the screen.
 */
function setStatus(message, kind = '') {
  els.status.textContent = message;
  els.status.className = kind ? `status ${kind}` : 'status';
  if (kind === 'ok' || kind === 'error') announce(message);
}

/** Years are easier to read than a four-digit day count. */
function describeTtl(days) {
  if (days < 365) return t('settings.ttlDays', { days });
  return t('settings.ttlYears', { days, years: Math.round((days / 365) * 10) / 10 });
}

/** How the stored sound choice reads to a person. */
function describeSound(choice) {
  return choice.slice('src/media/'.length);
}

async function renderReadStats() {
  const [read, ttlDays] = await Promise.all([store.getRead(), store.getReadTtlDays()]);
  state.ttlDays = ttlDays;
  state.readCount = read.length;

  if (!state.readCount) {
    els.readStats.textContent = t('settings.readStats.none');
    return;
  }

  /*
   * The cap on the number of markers is the one thing that can cut the horizon the user wrote: when
   * the live markers no longer fit, the oldest are forgotten before their term and their news comes
   * back early. The card names the horizon the storage really honours, not the one it was asked for.
   */
  const honored = store.readHonoredDays(read, ttlDays);
  const parts = [t('settings.readStats', { count: state.readCount, ttl: describeTtl(honored) })];
  if (honored < ttlDays) {
    parts.push(
      t('settings.readStats.capped', { max: MAX_READ_RECORDS, honored: describeTtl(honored) }),
    );
  }
  els.readStats.textContent = parts.join(' · ');
}

/** Reflect the stored horizon in the field and clear any leftover error. */
async function renderTtl() {
  state.ttlDays = await store.getReadTtlDays();
  els.days.min = String(MIN_READ_TTL_DAYS);
  els.days.max = String(MAX_READ_TTL_DAYS);

  // The settings record changes for other reasons too (the theme, the sound and the language live
  // in it), so an edit the user has not written yet must survive them.
  if (!state.ttlPending) {
    els.days.value = String(state.ttlDays);
    els.daysError.textContent = '';
  }
}

/** Show the stored signal in the combobox and under it. */
async function renderSound() {
  state.soundChoice = await store.getSoundChoice();
  if (!state.soundPending) els.sound.value = state.soundChoice;

  els.soundStats.textContent = t('settings.soundStats', { name: describeSound(state.soundChoice) });
}

/** Show the stored sound flag in the checkbox. */
async function renderSoundEnabled() {
  state.soundEnabled = await store.getSoundEnabled();
  if (!state.soundEnabledPending) els.soundEnabled.checked = state.soundEnabled;
}

/** Show the stored volume on the slider and in its readout. */
async function renderVolume() {
  state.soundVolume = await store.getSoundVolume();
  if (!state.volumePending) els.volume.value = String(state.soundVolume);

  updateVolumeReadout();
}

/** The slider names its own percent right next to itself; no dictionary is needed for a number. */
function updateVolumeReadout() {
  els.volumeValue.textContent = `${els.volume.value}%`;
}

/** The slider value as the fraction `HTMLAudioElement.volume` expects. */
function volumeFraction() {
  return Number(els.volume.value) / 100;
}

/** Show the stored flag in the checkbox. */
async function renderMessage() {
  state.showMessage = await store.getShowMessage();
  if (!state.messagePending) els.showMessage.checked = state.showMessage;
}

/** Show the stored language in the combobox. */
async function renderLanguage() {
  state.language = await store.getLanguage();
  if (!state.languagePending) els.language.value = state.language;
}

/**
 * Reflect the stored fields in the form, then judge them together. Pending must not be judged
 * while a field still shows the value it had before its own render: an empty days field would
 * otherwise look like an unwritten edit and block `renderTtl` from filling it.
 */
async function refreshFields() {
  await renderTtl();
  await renderSound();
  await renderSoundEnabled();
  await renderVolume();
  await renderMessage();
  await renderLanguage();
  markPending();
}

/**
 * A field asks for a value the store does not have yet. A malformed value counts as pending too,
 * so pressing «Save» explains the problem inline instead of looking inert.
 */
function ttlIsPending() {
  if (els.days.value.trim() === '' || !els.days.checkValidity()) return true;
  return Number(els.days.value) !== state.ttlDays;
}

function soundIsPending() {
  return els.sound.value !== state.soundChoice;
}

function soundEnabledIsPending() {
  return els.soundEnabled.checked !== state.soundEnabled;
}

function volumeIsPending() {
  return Number(els.volume.value) !== state.soundVolume;
}

function messageIsPending() {
  return els.showMessage.checked !== state.showMessage;
}

function languageIsPending() {
  return els.language.value !== state.language;
}

/**
 * Track every field against the store: «Save» is enabled only when at least one of them has
 * something to write.
 */
function markPending() {
  state.ttlPending = ttlIsPending();
  state.soundPending = soundIsPending();
  state.soundEnabledPending = soundEnabledIsPending();
  state.volumePending = volumeIsPending();
  state.messagePending = messageIsPending();
  state.languagePending = languageIsPending();
  const dirty =
    state.ttlPending ||
    state.soundPending ||
    state.soundEnabledPending ||
    state.volumePending ||
    state.messagePending ||
    state.languagePending;

  els.save.disabled = !dirty;
  els.save.title = dirty ? t('settings.save.tooltipDirty') : t('settings.save.tooltipClean');

  if (dirty) {
    if (!els.daysError.textContent) setStatus(t('settings.status.pending'), 'pending');
    return;
  }
  // Only our own hint goes away: a «Saved» confirmation must survive the storage event that
  // this very save announces back to the page.
  if (els.status.classList.contains('pending')) setStatus('');
}

/**
 * A raw days value is either an accepted whole number of days or a rejection we surface inline.
 * Storing clamps to the same bounds the input advertises, so an accepted value round-trips exactly.
 * The signal and the language are written by the same press of «Save»: only a bundled sound
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
    els.daysError.textContent = t('settings.ttlError', {
      min: MIN_READ_TTL_DAYS,
      max: MAX_READ_TTL_DAYS,
    });
    setStatus(t('settings.status.error'), 'error');
    state.ttlPending = true;
    els.save.disabled = false;
    return;
  }
  els.daysError.textContent = '';

  const parts = [];
  if (parsed !== state.ttlDays) {
    const saved = await store.setReadTtlDays(parsed);
    state.ttlDays = saved;
    parts.push(t('settings.savedTtl', { ttl: describeTtl(saved) }));
  }
  if (els.sound.value !== state.soundChoice) {
    const saved = await store.setSoundChoice(els.sound.value);
    state.soundChoice = saved;
    els.sound.value = saved;
    parts.push(t('settings.savedSound', { name: describeSound(saved) }));
  }
  if (els.soundEnabled.checked !== state.soundEnabled) {
    const saved = await store.setSoundEnabled(els.soundEnabled.checked);
    state.soundEnabled = saved;
    els.soundEnabled.checked = saved;
    parts.push(
      t('settings.savedSoundEnabled', {
        state: saved ? t('settings.savedSoundEnabled.on') : t('settings.savedSoundEnabled.off'),
      }),
    );
  }
  if (Number(els.volume.value) !== state.soundVolume) {
    const saved = await store.setSoundVolume(Number(els.volume.value));
    state.soundVolume = saved;
    els.volume.value = String(saved);
    updateVolumeReadout();
    parts.push(t('settings.savedVolume', { volume: saved }));
  }
  if (els.showMessage.checked !== state.showMessage) {
    const saved = await store.setShowMessage(els.showMessage.checked);
    state.showMessage = saved;
    els.showMessage.checked = saved;
    parts.push(
      t('settings.savedMessage', {
        state: saved ? t('settings.savedMessage.on') : t('settings.savedMessage.off'),
      }),
    );
  }
  if (els.language.value !== state.language) {
    const saved = await store.setLanguage(els.language.value);
    state.language = saved;
    els.language.value = saved;
    parts.push(t('settings.savedLanguage', { name: LANGUAGE_NAMES[saved] }));
    // The language is the one setting this screen draws with: the whole page follows the write.
    applyI18n();
    fillSoundOptions();
    fillLanguageOptions();
  }

  if (parts.length === 0) {
    setStatus(t('settings.status.nothing'), 'ok');
    return;
  }

  state.ttlPending = false;
  state.soundPending = false;
  state.soundEnabledPending = false;
  state.volumePending = false;
  state.messagePending = false;
  state.languagePending = false;
  markPending();
  setStatus(t('settings.status.saved', { parts: parts.join(' · ') }), 'ok');

  // The worker watches the settings key and prunes the markers the new horizon has already
  // outrun; the storage event also refreshes this screen's own counters.
  await renderReadStats();
  els.soundStats.textContent = t('settings.soundStats', {
    name: describeSound(state.soundChoice),
  });
}

/**
 * A field edit is not written until «Save» is pressed, so leaving the screen with a pending
 * value would drop it quietly — ask before doing that.
 */
function leavePage(url) {
  const dirty =
    state.ttlPending ||
    state.soundPending ||
    state.soundEnabledPending ||
    state.volumePending ||
    state.messagePending ||
    state.languagePending;
  if (dirty && !window.confirm(t('settings.confirmLeave'))) {
    return;
  }
  window.location.assign(url);
}

/**
 * Listen to the signal chosen in the combobox — even one not yet written to storage — so it can be
 * picked by ear. This page has a DOM, so it plays the bundled file directly through <audio>, not
 * through the offscreen document a service worker uses for the automatic-load signal.
 */
function playPreview() {
  const choice = els.sound.value;
  const audio = new Audio(chrome.runtime.getURL(choice));
  // The preview answers to the slider as it stands now — even to a volume not written yet —
  // so the alert can be adjusted by ear before «Save».
  audio.volume = volumeFraction();
  els.playSound.classList.add('playing');

  const stop = () => {
    els.playSound.classList.remove('playing');
    audio.removeEventListener('ended', stop);
    audio.removeEventListener('error', fail);
  };
  const fail = () => {
    stop();
    setStatus(t('settings.status.playError'), 'error');
  };

  audio.addEventListener('ended', stop);
  audio.addEventListener('error', fail);
  audio.play().catch(() => fail());
}

async function clearRead() {
  if (state.readCount === 0) {
    setStatus(t('settings.status.emptyRead'), 'ok');
    return;
  }
  if (!window.confirm(t('settings.confirmClear'))) {
    return;
  }

  els.clearRead.disabled = true;
  try {
    const removed = await store.clearRead();
    await renderReadStats();
    setStatus(t('settings.status.cleared', { count: removed }), 'ok');
  } finally {
    els.clearRead.disabled = false;
  }
}

els.days.addEventListener('input', markPending);
els.sound.addEventListener('change', markPending);
els.soundEnabled.addEventListener('change', markPending);
els.volume.addEventListener('input', () => {
  updateVolumeReadout();
  markPending();
});
els.showMessage.addEventListener('change', markPending);
els.language.addEventListener('change', markPending);
els.playSound.addEventListener('click', playPreview);
els.save.addEventListener('click', () => void saveFields());
els.clearRead.addEventListener('click', () => void clearRead());

// The screen switcher reaches the reader the way the feeds screen does — the tab keeps its place —
// but every jump here goes through `leavePage`, which asks before dropping unsaved fields.
mountNav({ leave: leavePage });

void wireThemeButton(els.theme);

/** Another page wrote read markers or settings; refresh the counters it affects. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // A language written here comes back to us as an event too: `saveFields` has already adopted it,
  // so only a change made by another page re-draws this screen.
  const next = normalize(changes[store.SETTINGS_KEY]?.newValue?.language);
  if (next && next !== currentLanguage()) onLanguageChange(next);
  if (changes[store.READ_KEY]) void renderReadStats();
  if (changes[store.SETTINGS_KEY]) void refreshFields().then(renderReadStats);
});

function normalize(value) {
  return LANGUAGE_NAMES[value] ? value : null;
}

/** Redraw every caption this screen draws itself, in the language another page chose. */
function onLanguageChange(language) {
  adoptLanguage(language);
  state.language = language;
  state.languagePending = false;
  applyI18n();
  fillSoundOptions();
  fillLanguageOptions();
  els.language.value = language;
  setStatus('');
}

/** Fill the comboboxes: the signals come from the bundled media, the languages from the dictionaries. */
function fillSoundOptions() {
  const value = els.sound.value;
  els.sound.replaceChildren();
  els.sound.append(...store.SOUND_FILES.map((file) => soundOption(file)));
  if (value) els.sound.value = value;
}

/** One option per signal, named by its own file name. */
function soundOption(choice) {
  return option(choice, choice.slice('src/media/'.length, -'.mp3'.length));
}

/**
 * Languages are named in their own language («Русский», «English») — the usual convention, so the
 * list keeps its captions readable whichever language is active.
 */
function fillLanguageOptions() {
  const value = els.language.value;
  els.language.replaceChildren();
  els.language.append(...Object.entries(LANGUAGE_NAMES).map(([code, name]) => option(code, name)));
  if (value) els.language.value = value;
}

function option(value, label) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

async function init() {
  // Language of the synchronous first pass, before `chrome.storage` had anything to say.
  const drawnLanguage = currentLanguage();

  fillSoundOptions();
  fillLanguageOptions();
  await refreshFields();
  // The stored setting wins over the cached or detected language the captions were drawn with.
  if (state.language !== drawnLanguage) onLanguageChange(state.language);
  await renderReadStats();
}

void init();
