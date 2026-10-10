// Configuration screen: add / edit / delete feeds and their timeouts.

import { MSG_FEEDS_CHANGED, MSG_REFRESH_FEED } from './lib/messages.js';
import * as store from './lib/storage.js';
import { READER_PAGE, pageUrl } from './lib/tabs.js';
import { wireThemeButton } from './lib/theme.js';
import { humanDuration, newId, normalizeFeed } from './lib/util.js';

const els = {
  cards: document.getElementById('feed-cards'),
  empty: document.getElementById('feeds-empty'),
  add: document.getElementById('btn-add'),
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

  const name = field('name — название ленты', 'text', feed.name, { title: 'Название ленты' });
  const rssLink = field('rss_link — ссылка для считывания новостей', 'text', feed.rss_link, { wide: true });
  const delay = field('delay_timeout — период загрузки заголовков', 'number', feed.delay_timeout, {
    min: '1',
    step: '1',
    unit: `мин (сейчас ${humanDuration(feed.delay_timeout)})`,
  });
  const clean = field('clean_timeout — время хранения новости', 'number', feed.clean_timeout, {
    min: '1',
    step: '1',
    unit: `мин (сейчас ${humanDuration(feed.clean_timeout)})`,
  });

  grid.append(name.wrap, rssLink.wrap, delay.wrap, clean.wrap);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary';
  save.textContent = draft ? 'Добавить ленту' : 'Сохранить';

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Загрузить сейчас';
  refresh.disabled = draft;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger';
  remove.textContent = draft ? 'Отменить' : 'Удалить';

  if (draft) {
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = 'Новая лента — сохраните её, чтобы включить автоматическую загрузку';
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
  const { feed, errors } = normalizeFeed(values);
  showFieldErrors(cardRecord, errors);

  if (Object.keys(errors).length > 0) {
    setStatus(cardRecord, 'Проверьте поля', 'error');
    return;
  }

  feed.id = cardRecord.feed.id ?? newId();
  await store.upsertFeed(feed);

  if (cardRecord.draft) state.drafts.delete(cardRecord.feed);
  setStatus(cardRecord, 'Сохранено', 'ok');

  await notifyBackground();
  await refreshCounts();

  // Re-fetch the new/edited feed right away so the reader is not left empty.
  await refreshCard({ ...cardRecord, feed, draft: false });
  await render();
}

async function removeCard(cardRecord) {
  if (!cardRecord.draft) {
    const name = cardRecord.feed.name || cardRecord.feed.rss_link;
    if (!window.confirm(`Удалить ленту «${name}» вместе с её заголовками?`)) return;
    await store.deleteFeed(cardRecord.feed.id);
  }
  state.drafts.delete(cardRecord.feed);
  await notifyBackground();
  await render();
}

async function refreshCard(cardRecord) {
  if (!cardRecord.feed.id) return;
  setStatus(cardRecord, 'Загрузка…');
  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG_REFRESH_FEED,
      feedId: cardRecord.feed.id,
    });
    if (response?.ok) {
      const read = response.skipped > 0 ? `, уже прочитано: ${response.skipped}` : '';
      setStatus(
        cardRecord,
        `Новых: ${response.added}, считано: ${response.seen}${read}`,
        response.added > 0 ? 'ok' : '',
      );
    } else {
      setStatus(cardRecord, response?.error ?? 'Ошибка загрузки', 'error');
    }
  } catch (error) {
    setStatus(cardRecord, String(error?.message ?? error), 'error');
  }
  await refreshCounts();
}

/** The worker owns the alarms and the badge: tell it the feeds changed. */
async function notifyBackground() {
  try {
    await chrome.runtime.sendMessage({ type: MSG_FEEDS_CHANGED });
  } catch (error) {
    console.warn('Не удалось сообщить фоновому рабочему об изменениях:', error?.message ?? error);
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
    cardRecord.stats.textContent = `в хранилище: ${count}`;
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

void wireThemeButton(els.theme);

/** Counts change from the background worker; only the stats line is refreshed so that
 *  whatever the user is typing in a card is not thrown away. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.items) void refreshCounts();
});

await render();
