// Three-panel reader: feeds -> stored headlines (title + pubDate) -> stored <description> rendered on click.

import { sanitizePreview } from './lib/extract.js';
import { MSG_FEEDS_CHANGED, MSG_REFRESH_FEED } from './lib/messages.js';
import * as store from './lib/storage.js';
import { SETTINGS_PAGE, pageUrl } from './lib/tabs.js';
import { wireThemeButton } from './lib/theme.js';
import { formatSince, humanDuration, itemTime } from './lib/util.js';

const els = {
  totalCount: document.getElementById('total-count'),
  settings: document.getElementById('btn-settings'),
  theme: document.getElementById('btn-theme'),
  refresh: document.getElementById('btn-refresh'),
  clearAll: document.getElementById('btn-clear-all'),

  feedList: document.getElementById('feed-list'),
  feedsEmpty: document.getElementById('feeds-empty'),

  headlinesTitle: document.getElementById('headlines-title'),
  headlinesCount: document.getElementById('headlines-count'),
  headlineList: document.getElementById('headline-list'),
  headlinesEmpty: document.getElementById('headlines-empty'),

  contentDelete: document.getElementById('content-delete'),
  contentBody: document.getElementById('content-body'),
};

const state = {
  feeds: [],
  items: [],
  feedId: null,
  uid: null,
};

/*
 * The settings screen opens in this same tab, so coming back to the reader has to land on the
 * same feed and headline. `sessionStorage` lives exactly as long as the tab does: a reader tab
 * opened elsewhere still starts with nothing selected.
 */
const SELECTION_KEY = 'rss-reader:selection';

function saveSelection() {
  sessionStorage.setItem(SELECTION_KEY, JSON.stringify({ feedId: state.feedId, uid: state.uid }));
}

function restoreSelection() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SELECTION_KEY) ?? '');
    state.feedId = typeof saved?.feedId === 'string' ? saved.feedId : null;
    state.uid = typeof saved?.uid === 'string' ? saved.uid : null;
  } catch {
    // Nothing usable stored — start with nothing selected.
  }
}

function selectedFeed() {
  return state.feeds.find((feed) => feed.id === state.feedId) ?? null;
}

function countForFeed(feedId) {
  return state.items.filter((item) => item.feedId === feedId).length;
}

/** Заголовки выбранной ленты — в том же порядке, что в средней панели (свежие сверху). */
function itemsOfSelectedFeed() {
  if (!state.feedId) return [];
  return state.items.filter((item) => item.feedId === state.feedId);
}

function renderTotal() {
  els.totalCount.textContent = String(state.items.length);
}

function renderFeeds() {
  els.feedList.replaceChildren();
  els.feedsEmpty.hidden = state.feeds.length > 0;

  for (const feed of state.feeds) {
    const li = document.createElement('li');
    li.className = `list-item${feed.id === state.feedId ? ' selected' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML =
      '<span class="item-title"></span>' +
      '<span class="item-meta muted"></span>';
    button.querySelector('.item-title').textContent = feed.name || feed.rss_link;
    button.querySelector('.item-meta').textContent =
      `${countForFeed(feed.id)} загол. · обновл. каждые ${humanDuration(feed.delay_timeout)}`;

    button.addEventListener('click', () => selectFeed(feed.id));
    li.append(button);
    els.feedList.append(li);
  }
}

function renderHeadlines() {
  els.headlineList.replaceChildren();

  const feed = selectedFeed();
  els.headlinesTitle.textContent = feed?.name ?? 'Заголовки';

  const items = feed ? state.items.filter((item) => item.feedId === feed.id) : [];
  els.headlinesCount.textContent = items.length ? `${items.length}` : '';
  els.headlinesEmpty.hidden = items.length > 0;
  els.headlinesEmpty.textContent = feed
    ? 'Для этой ленты пока нет заголовков в хранилище.'
    : 'Выберите ленту слева.';

  for (const item of items) {
    const li = document.createElement('li');
    li.className = `list-item${item.uid === state.uid ? ' selected' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML =
      '<span class="item-title"></span>' +
      '<span class="item-meta muted"></span>';
    button.querySelector('.item-title').textContent = item.title;
    const when = itemTime(item);
    button.querySelector('.item-meta').textContent =
      when ? `publ. ${formatSince(when)}` : '';
    button.title = item.link;

    button.addEventListener('click', () => openItem(item));
    li.append(button);
    els.headlineList.append(li);
  }
}

function selectFeed(feedId) {
  state.feedId = feedId;
  // Switching feeds drops whatever headline was open.
  state.uid = null;
  renderFeeds();
  renderHeadlines();
  showPlaceholder('Заголовки этой ленты — в средней панели.');
  saveSelection();
}

function showPlaceholder(message) {
  state.uid = null;
  els.contentDelete.hidden = true;

  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = message;
  els.contentBody.replaceChildren(p);
}

/** Clone one of the <symbol> icons declared in index.html. */
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

/**
 * The headline itself is the link to the original: it opens the news in a new tab, which is
 * why the toolbar no longer carries a separate «Открыть оригинал» control.
 */
function titleHeading(text, link) {
  const h1 = document.createElement('h1');
  const a = document.createElement('a');
  a.href = link;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = 'Открыть оригинал в новой вкладке';
  a.textContent = text;
  h1.append(a, icon('external'));
  return h1;
}

/** Requirement: clicking a title shows the stored `<description>` in the right panel. */
function openItem(item) {
  state.uid = item.uid;
  saveSelection();
  renderHeadlines();

  els.contentDelete.hidden = false;

  const title = titleHeading(item.title, item.link);
  const source = document.createElement('div');
  source.className = 'source';
  const name = item.feedName || item.rss_link;
  const when = itemTime(item);
  source.textContent = when ? `${name} · publ. ${formatSince(when)}` : name;

  const preview = sanitizePreview(item.description);
  if (!preview.node) {
    els.contentBody.replaceChildren(
      title,
      source,
      note('Нет описание в хранилище for this news.', 'error'),
      note('Оригинал доступен по ссылк в заголов news.'),
    );
    return;
  }

  const notes = preview.truncated ? [note('Description trunc at len limit.')] : [];
  els.contentBody.replaceChildren(title, source, preview.node, ...notes);
}

function note(text, kind = '') {
  const p = document.createElement('p');
  p.className = kind ? `note ${kind}` : 'note';
  p.textContent = text;
  return p;
}

/** Deleting a headline hands the reader over to the next headline of the same feed. */
async function deleteItem() {
  if (!state.uid) return;

  const feedId = state.feedId;
  const position = itemsOfSelectedFeed().findIndex((item) => item.uid === state.uid);

  const uid = state.uid;
  await store.removeItem(uid);
  state.uid = null;
  saveSelection();
  await renderAll();

  const remaining = state.items.filter((item) => item.feedId === feedId);
  if (remaining.length === 0) {
    showPlaceholder('Заголовок удалён: в этой ленте больше ничего не осталось.');
    return;
  }

  // Same slot in the list: the headline that used to sit below the removed one, or the last
  // one when the removed headline was the bottom of the list.
  const next = remaining[Math.max(0, Math.min(position, remaining.length - 1))];
  openItem(next);
}

/**
 * The «Clear all» icon next to the header badge: it empties the headline storage in one click.
 * The storage write also makes the background worker refresh the toolbar badge, and the reader's
 * own storage.onChanged listener repaints the panels, so no extra bookkeeping is needed here.
 */
async function clearAllHeadlines() {
  if (state.items.length === 0) return;

  els.clearAll.disabled = true;
  try {
    await store.clearAllItems();
    await renderAll();
  } finally {
    els.clearAll.disabled = false;
  }
}

async function refreshSelectedFeed() {
  const feed = selectedFeed();
  if (!feed) {
    showPlaceholder('Сначала выберите ленту.');
    return;
  }

  const tip = els.refresh.title;
  els.refresh.disabled = true;
  els.refresh.classList.add('busy');
  els.refresh.title = 'Загрузка…';
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG_REFRESH_FEED, feedId: feed.id });
    if (!response?.ok) {
      showPlaceholder(`Не удалось обновить ленту: ${response?.error ?? 'неизвестная ошибка'}`);
    }
    await renderAll();
  } finally {
    els.refresh.disabled = false;
    els.refresh.classList.remove('busy');
    els.refresh.title = tip;
  }
}

async function renderAll() {
  state.feeds = await store.getFeeds();
  state.items = store.sortItems(await store.getItems());

  // The selected feed may have been deleted on the settings screen.
  if (!state.feeds.some((feed) => feed.id === state.feedId)) state.feedId = null;

  // The open headline may have expired (clean_timeout) or been deleted elsewhere.
  let message = null;
  if (state.uid && !state.items.some((item) => item.uid === state.uid)) {
    state.uid = null;
    message = 'Открытый заголовок удалён из хранилища: истёк clean_timeout.';
  }

  renderTotal();
  renderFeeds();
  renderHeadlines();
  if (message) showPlaceholder(message);
  return message;
}

/* Storage is written by the background worker while this page is open, so react to it. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.items || changes.feeds) void renderAll();
});

els.settings.addEventListener('click', () => {
  // The settings screen takes over this tab instead of adding a third one: «Открыть читалку»
  // on that screen brings the reader back to the same place.
  window.location.assign(pageUrl(SETTINGS_PAGE));
});
els.refresh.addEventListener('click', () => void refreshSelectedFeed());
els.clearAll.addEventListener('click', () => void clearAllHeadlines());
els.contentDelete.addEventListener('click', () => void deleteItem());
void wireThemeButton(els.theme);

async function init() {
  restoreSelection();
  // Expired headlines should not linger in an open reader.
  const { removed } = await store.cleanup();
  // Ask the worker to re-sync the per-feed timers and the badge count after this read.
  try {
    await chrome.runtime.sendMessage({ type: MSG_FEEDS_CHANGED });
  } catch {
    // The worker might be asleep; its own alarm sweep covers it.
  }
  if (removed > 0) renderTotal();
  const lostHeadline = await renderAll();

  // renderAll() has already dropped a feed or a headline that no longer exists. With nothing
  // left selected the reader would open on empty panels, so the cursor goes to the top: the
  // first feed in the list and the first headline of that feed.
  if (!selectedFeed() && state.feeds.length > 0) selectFeed(state.feeds[0].id);

  // A headline that survived the cleanup keeps its place; otherwise the top of the list opens.
  const item =
    (state.uid
      ? state.items.find(
          (candidate) => candidate.uid === state.uid && candidate.feedId === state.feedId,
        )
      : null) ??
    itemsOfSelectedFeed()[0] ??
    null;

  if (item) {
    openItem(item);
  } else if (state.feedId && !lostHeadline) {
    // Nothing to open at all: the feed is selected, its panel says so.
    showPlaceholder('Заголовки этой ленты — в средней панели.');
  }
}

void init();
