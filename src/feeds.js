// Configuration screen: add / edit / delete feeds and their timeouts.

import { describeError } from './lib/errors.js';
import { adoptLanguage, applyI18n, currentLanguage, t, unitLabels } from './lib/i18n.js';
import { MSG_FEEDS_CHANGED, MSG_REFRESH_FEED } from './lib/messages.js';
import * as store from './lib/storage.js';
import { GLOBAL_SETTINGS_PAGE, READER_PAGE, pageUrl } from './lib/tabs.js';
import { wireThemeButton } from './lib/theme.js';
import { humanDuration, newId, normalizeFeed } from './lib/util.js';

/* Synchronous first pass: the cached language (or the browser language) is known before
 * `chrome.storage` resolves, so the markup below is not left in Russian while we wait. */
applyI18n();

const els = {
  cards: document.getElementById('feed-cards'),
  empty: document.getElementById('feeds-empty'),
  add: document.getElementById('btn-add'),
  settings: document.getElementById('btn-settings'),
  reader: document.getElementById('btn-reader'),
  theme: document.getElementById('btn-theme'),
};

const state = {
  feeds: [],
  /** Cards the user is filling in but has not saved yet. */
  drafts: new Set(),
  itemsByFeed: new Map(),
};

function field(label, inputType, value, { unit = '', step = '', min = '', wide = false, title = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = wide ? 'field wide' : 'field';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = inputType;
  input.value = value ?? '';
  if (step) input.step = step;
  if (min) input.min = min;
  if (title) input.title = title;
  input.setAttribute('aria-label', label);

  const error = document.createElement('div');
  error.className = 'error';

  if (unit) {
    const unitRow = document.createElement('div');
    unitRow.className = 'unit';
    unitRow.append(input, Object.assign(document.createElement('span'), { textContent: unit }));
    wrap.append(labelEl, unitRow, error);
  } else {
    wrap.append(labelEl, input, error);
  }

  return { wrap, input, error };
}

/**
 * Build one editable card. `feed` may be a draft (no id yet).
 */
function buildCard(feed, { draft }) {
  const card = document.createElement('div');
  card.className = draft ? 'feed-card draft' : 'feed-card';

  const head = document.createElement('div');
  head.className = 'feed-card-head';
  const stats = document.createElement('span');
  stats.className = 'stats';
  const status = document.createElement('span');
  status.className = 'status';
  head.append(stats, status);

  const grid = document.createElement('div');
  grid.className = 'grid';

  const labels = unitLabels();

  const name = field(t('feeds.field.name'), 'text', feed.name, {
    title: t('feeds.field.namePlaceholder'),
  });
  const rssLink = field(t('feeds.field.rss'), 'text', feed.rss_link, { wide: true });
  const delay = field(t('feeds.field.delay'), 'number', feed.delay_timeout, {
    min: '1',
    step: '1',
    unit: t('feeds.field.delayUnit', { duration: humanDuration(feed.delay_timeout, labels) }),
  });
  const clean = field(t('feeds.field.clean'), 'number', feed.clean_timeout, {
    min: '1',
    step: '1',
    unit: t('feeds.field.cleanUnit', { duration: humanDuration(feed.clean_timeout, labels) }),
  });

  grid.append(name.wrap, rssLink.wrap, delay.wrap, clean.wrap);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary';
  save.textContent = draft ? t('feeds.addCard') : t('feeds.save');

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = t('feeds.loadNow');
  refresh.disabled = draft;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger';
  remove.textContent = draft ? t('feeds.cancel') : t('feeds.delete');

  if (draft) {
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = t('feeds.draftNote');
    actions.append(save, remove, note);
  } else {
    actions.append(save, refresh, remove);
  }
  grid.append(actions);

  const cardRecord = {
    feed,
    draft,
    card,
    stats,
    status,
    inputs: { name, rss_link: rssLink, delay_timeout: delay, clean_timeout: clean },
  };

  save.addEventListener('click', () => void saveCard(cardRecord));
  remove.addEventListener('click', () => void removeCard(cardRecord));
  refresh.addEventListener('click', () => void refreshCard(cardRecord));

  card.append(head, grid);
  return cardRecord;
}

function setStatus(cardRecord, message, kind = '') {
  cardRecord.status.textContent = message;
  cardRecord.status.className = kind ? `status ${kind}` : 'status';
}

function showFieldErrors(cardRecord, errors) {
  for (const [key, input] of Object.entries(cardRecord.inputs)) {
    input.error.textContent = errors[key] ?? '';
  }
}

function readCard(cardRecord) {
  return {
    id: cardRecord.feed.id,
    name: cardRecord.inputs.name.input.value,
    rss_link: cardRecord.inputs.rss_link.input.value,
    delay_timeout: cardRecord.inputs.delay_timeout.input.value,
    clean_timeout: cardRecord.inputs.clean_timeout.input.value,
  };
}

async function saveCard(cardRecord) {
  const values = readCard(cardRecord);
  const { feed, errors } = normalizeFeed(values, {
    name: t('feeds.error.name'),
    nameTooLong: t('feeds.error.nameTooLong'),
    rss_link: t('feeds.error.link'),
    delay_timeout: t('feeds.error.delay'),
    clean_timeout: t('feeds.error.clean'),
  });
  showFieldErrors(cardRecord, errors);

  if (Object.keys(errors).length > 0) {
    setStatus(cardRecord, t('feeds.status.checkFields'), 'error');
    return;
  }

  feed.id = cardRecord.feed.id ?? newId();
  await store.upsertFeed(feed);

  if (cardRecord.draft) state.drafts.delete(cardRecord.feed);
  setStatus(cardRecord, t('feeds.status.saved'), 'ok');

  await notifyBackground();
  await refreshCounts();

  // Re-fetch the new/edited feed right away so the reader is not left empty.
  await refreshCard({ ...cardRecord, feed, draft: false });
  await render();
}

async function removeCard(cardRecord) {
  if (!cardRecord.draft) {
    const name = cardRecord.feed.name || cardRecord.feed.rss_link;
    if (!window.confirm(t('feeds.confirmDelete', { name }))) return;
    await store.deleteFeed(cardRecord.feed.id);
  }
  state.drafts.delete(cardRecord.feed);
  await notifyBackground();
  await render();
}

async function refreshCard(cardRecord) {
  if (!cardRecord.feed.id) return;
  setStatus(cardRecord, t('common.loading'));
  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG_REFRESH_FEED,
      feedId: cardRecord.feed.id,
    });
    if (response?.ok) {
      setStatus(
        cardRecord,
        t('feeds.result', {
          added: response.added,
          seen: response.seen,
          read:
            response.skipped > 0 ? t('feeds.resultRead', { skipped: response.skipped }) : '',
        }),
        response.added > 0 ? 'ok' : '',
      );
    } else {
      setStatus(
        cardRecord,
        response?.error ? describeError(response.error) : t('feeds.status.loadError'),
        'error',
      );
    }
  } catch (error) {
    setStatus(cardRecord, describeError(error), 'error');
  }
  await refreshCounts();
}

/** The worker owns the alarms and the badge: tell it the feeds changed. */
async function notifyBackground() {
  try {
    await chrome.runtime.sendMessage({ type: MSG_FEEDS_CHANGED });
  } catch (error) {
    console.warn('could not tell the background worker about the changes:', error?.message ?? error);
  }
}

async function refreshCounts() {
  const items = await store.getItems();
  const counts = new Map();
  for (const item of items) {
    counts.set(item.feedId, (counts.get(item.feedId) ?? 0) + 1);
  }
  state.itemsByFeed = counts;
  for (const cardRecord of currentCards()) {
    if (!cardRecord.feed.id) continue;
    const count = counts.get(cardRecord.feed.id) ?? 0;
    cardRecord.stats.textContent = t('feeds.stats', { count });
  }
}

/** Cards currently mounted, in DOM order. */
function currentCards() {
  return [...els.cards.querySelectorAll('.feed-card')].map((card) => card.__record);
}

async function render() {
  state.feeds = await store.getFeeds();

  els.cards.replaceChildren();
  const cards = [
    ...state.feeds.map((feed) => buildCard(feed, { draft: false })),
    ...[...state.drafts].map((draft) => buildCard(draft, { draft: true })),
  ];

  for (const cardRecord of cards) {
    cardRecord.card.__record = cardRecord;
    els.cards.append(cardRecord.card);
  }

  els.empty.hidden = cards.length > 0;
  await refreshCounts();
}

els.add.addEventListener('click', () => {
  state.drafts.add(store.emptyFeed());
  void render();
});

els.reader.addEventListener('click', () => {
  // Back to the reader in the same tab: this screen is reached from the reader, and the reader
  // restores the feed and the headline that were open before the jump.
  window.location.assign(pageUrl(READER_PAGE));
});

els.settings.addEventListener('click', () => {
  window.location.assign(pageUrl(GLOBAL_SETTINGS_PAGE));
});

void wireThemeButton(els.theme);

/** Counts change from the background worker; only the stats line is refreshed so that
 *  whatever the user is typing in a card is not thrown away. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // A language saved on the settings screen has to reach this page without a reload: adopt it,
  // re-apply the dictionary to the static markup, then rebuild the cards — their labels, units
  // and buttons were built from the old language and do not follow `applyI18n()`.
  const language = changes.settings?.newValue?.language;
  if (language && language !== currentLanguage()) {
    adoptLanguage(language);
    applyI18n();
    void render();
    return;
  }

  if (changes.items) void refreshCounts();
});

// The stored language wins; on first run there is none and the browser language is used.
adoptLanguage(await store.getLanguage());
applyI18n();

await render();
