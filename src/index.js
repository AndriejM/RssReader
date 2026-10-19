// Three-panel reader: feeds -> stored headlines (title + pubDate) -> stored <description> rendered on click.

import { sanitizePreview } from './lib/extract.js';
import { describeError } from './lib/errors.js';
import { loadColumnWidths, mountColumnResizers, wireColumnWidthChanges } from './lib/columns.js';
import { loadFontScales, mountFontScales, wireFontScaleChanges } from './lib/fontsize.js';
import { adoptLanguage, applyI18n, currentLanguage, t, unitLabels } from './lib/i18n.js';
import { MSG_FEEDS_CHANGED, MSG_REFRESH_ALL_FEEDS, MSG_REFRESH_FEED } from './lib/messages.js';
import { mountNav } from './lib/nav.js';
import * as store from './lib/storage.js';
import { wireThemeButton } from './lib/theme.js';
import { formatSince, humanDuration, itemTime } from './lib/util.js';

/* Synchronous first pass: the cached language (or the browser language) is known before
 * `chrome.storage` resolves, so nothing here has to wait for the async read below. */
applyI18n();

const els = {
  totalCount: document.getElementById('total-count'),
  theme: document.getElementById('btn-theme'),
  refresh: document.getElementById('btn-refresh'),
  refreshAll: document.getElementById('btn-refresh-all'),
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
 * The first row of the left column is not a feed: it stands for all of them at once, and the middle
 * column then holds the headlines of every feed, newest first. A stored feed id is a UUID
 * (`lib/util.js` -> `newId`), so this sentinel cannot be mistaken for one of them.
 */
const ALL_FEEDS_ID = '__all__';

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

function isAllFeeds() {
  return state.feedId === ALL_FEEDS_ID;
}

function selectedFeed() {
  return state.feeds.find((feed) => feed.id === state.feedId) ?? null;
}

function countForFeed(feedId) {
  return state.items.filter((item) => item.feedId === feedId).length;
}

/** Whether a headline belongs to what the left column has selected now: one feed, or all of them. */
function inSelection(item) {
  return isAllFeeds() || item.feedId === state.feedId;
}

/**
 * Заголовки выбранного пункта левой колонки — в том же порядке, что в средней панели (свежие
 * сверху). «Все ленты» — это `state.items`, которые `renderAll()` уже отсортировал по дате.
 */
function itemsOfSelectedFeed() {
  if (!state.feedId) return [];
  return state.items.filter(inSelection);
}

function renderTotal() {
  els.totalCount.textContent = String(state.items.length);
}

/**
 * The row above the feeds: it is not one of them, so it is drawn apart (see `reader.css`) and its
 * meta line counts the headlines of every feed instead of naming one feed's refresh interval.
 */
function renderAllFeedsRow() {
  const li = document.createElement('li');
  li.className = `list-item list-all-feeds${state.feedId === ALL_FEEDS_ID ? ' selected' : ''}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML =
    '<span class="item-title"></span>' +
    '<span class="item-meta muted"></span>';
  button.querySelector('.item-title').textContent = t('reader.feeds.all');
  // Its meta line counts the headlines of every feed; the feeds themselves are named in the middle
  // column, where each headline carries the feed it came from.
  button.querySelector('.item-meta').textContent = t('reader.feeds.allMeta', {
    count: state.items.length,
  });

  button.addEventListener('click', () => selectFeed(ALL_FEEDS_ID));
  li.append(button);
  els.feedList.append(li);
}

function renderFeeds() {
  els.feedList.replaceChildren();
  els.feedsEmpty.hidden = state.feeds.length > 0;

  // With no feeds there is nothing to gather, so only the hint of the empty column is left.
  if (state.feeds.length > 0) renderAllFeedsRow();

  for (const feed of state.feeds) {
    const li = document.createElement('li');
    li.className = `list-item${feed.id === state.feedId ? ' selected' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML =
      '<span class="item-title"></span>' +
      '<span class="item-meta muted"></span>';
    button.querySelector('.item-title').textContent = feed.name || feed.rss_link;
    button.querySelector('.item-meta').textContent = t('reader.feed.itemMeta', {
      count: countForFeed(feed.id),
      duration: humanDuration(feed.delay_timeout, unitLabels()),
    });

    button.addEventListener('click', () => selectFeed(feed.id));
    li.append(button);
    els.feedList.append(li);
  }
}

function renderHeadlines() {
  els.headlineList.replaceChildren();

  const all = isAllFeeds();
  const feed = all ? null : selectedFeed();
  els.headlinesTitle.textContent = all
    ? t('reader.feeds.all')
    : feed?.name ?? t('reader.headlines.title');

  const items = itemsOfSelectedFeed();
  els.headlinesCount.textContent = items.length ? `${items.length}` : '';
  els.headlinesEmpty.hidden = items.length > 0;
  els.headlinesEmpty.textContent = all
    ? t('reader.headlines.emptyAllFeeds')
    : feed
      ? t('reader.headlines.emptyForFeed')
      : t('reader.headlines.emptyNoFeed');

  for (const item of items) {
    const li = document.createElement('li');
    li.className = `list-item${item.uid === state.uid ? ' selected' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML =
      '<span class="item-title"></span>' +
      '<span class="item-meta muted"></span>';
    // A headline the feed gave no title is labelled here, in the reader's language.
    button.querySelector('.item-title').textContent = item.title || t('common.untitled');
    // In «Все ленты» the meta line names the feed the headline came from; a single feed's list
    // needs no such tag.
    const when = itemTime(item);
    button.querySelector('.item-meta').textContent = [
      all ? item.feedName || item.rss_link : '',
      when ? t('reader.published', { since: formatSince(when, Date.now(), unitLabels()) }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    button.title = item.link;

    button.addEventListener('click', () => openItem(item));
    li.append(button);
    els.headlineList.append(li);
  }
}

/**
 * Move the left column's cursor — to a feed or to «Все ленты» — and put the middle column on the
 * first headline of whatever that selection now covers.
 */
function selectFeed(feedId) {
  state.feedId = feedId;
  // Switching feeds drops whatever headline was open.
  state.uid = null;
  renderFeeds();
  renderHeadlines();

  // The cursor in the middle column goes to the first headline of the feed that was just
  // picked; a feed whose headlines are all gone still has to say so in the empty panel.
  const first = itemsOfSelectedFeed()[0];
  if (first) openItem(first);
  else showPlaceholder(t('reader.placeholder.inMiddle'));

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
  a.title = t('reader.openOriginal.tooltip');
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

  const title = titleHeading(item.title || t('common.untitled'), item.link);
  const source = document.createElement('div');
  source.className = 'source';
  const name = item.feedName || item.rss_link;
  const when = itemTime(item);
  source.textContent = when
    ? t('reader.source', { name, since: formatSince(when, Date.now(), unitLabels()) })
    : name;

  const preview = sanitizePreview(item.description);
  if (!preview.node) {
    els.contentBody.replaceChildren(
      title,
      source,
      note(t('reader.content.noDescription'), 'error'),
      note(t('reader.content.originalByLink')),
    );
    return;
  }

  const notes = preview.truncated ? [note(t('reader.content.truncated'))] : [];
  els.contentBody.replaceChildren(title, source, preview.node, ...notes);
}

function note(text, kind = '') {
  const p = document.createElement('p');
  p.className = kind ? `note ${kind}` : 'note';
  p.textContent = text;
  return p;
}

/** Deleting a headline hands the reader over to the next headline of the same selection. */
async function deleteItem() {
  if (!state.uid) return;

  const feedId = state.feedId;
  const all = isAllFeeds();
  const position = itemsOfSelectedFeed().findIndex((item) => item.uid === state.uid);

  const uid = state.uid;
  await store.removeItem(uid);
  state.uid = null;
  saveSelection();
  await renderAll();

  // «Все ленты» keeps the whole list: the next headline is the one that stood below the removed
  // one, whatever feed it belongs to.
  const remaining = state.items.filter((item) => all || item.feedId === feedId);
  if (remaining.length === 0) {
    showPlaceholder(all ? t('reader.placeholder.deletedLastAll') : t('reader.placeholder.deletedLast'));
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
  // «Все ленты» is a selection too: reading it means reading every feed, as the header button does.
  // This button is held disabled while that read runs, so it cannot start a second one.
  if (isAllFeeds()) {
    els.refresh.disabled = true;
    els.refresh.classList.add('busy');
    try {
      await refreshAllFeeds();
    } finally {
      els.refresh.disabled = false;
      els.refresh.classList.remove('busy');
    }
    return;
  }

  const feed = selectedFeed();
  if (!feed) {
    showPlaceholder(t('reader.refresh.noFeed'));
    return;
  }

  const tip = els.refresh.title;
  els.refresh.disabled = true;
  els.refresh.classList.add('busy');
  els.refresh.title = t('common.loading');
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG_REFRESH_FEED, feedId: feed.id });
    if (!response?.ok) {
      showPlaceholder(t('reader.refresh.failed', { error: describeError(response?.error) }));
    }
    await renderAll();
  } finally {
    els.refresh.disabled = false;
    els.refresh.classList.remove('busy');
    els.refresh.title = tip;
  }
}

/**
 * The header button that reads every feed at once, whatever is selected in the left column.
 * The worker fetches them one after another and reports per feed; a feed that failed keeps its
 * stored headlines, so a partial failure is a notice rather than an empty screen.
 */
async function refreshAllFeeds() {
  if (state.feeds.length === 0) {
    showPlaceholder(t('reader.feeds.empty'));
    return;
  }

  const tip = els.refreshAll.title;
  els.refreshAll.disabled = true;
  els.refreshAll.classList.add('busy');
  els.refreshAll.title = t('common.loading');
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG_REFRESH_ALL_FEEDS });
    if (!response?.ok) {
      showPlaceholder(t('reader.refresh.failed', { error: describeError(response?.error) }));
    } else if (response.failed > 0) {
      const failure = (response.results ?? []).find((entry) => !entry.ok);
      showPlaceholder(t('reader.refreshAll.failed', { error: describeError(failure?.error) }));
    }
    await renderAll();
  } finally {
    els.refreshAll.disabled = false;
    els.refreshAll.classList.remove('busy');
    els.refreshAll.title = tip;
  }
}

async function renderAll() {
  state.feeds = await store.getFeeds();
  state.items = store.sortItems(await store.getItems());

  // The selected feed may have been deleted on the settings screen; «Все ленты» is no feed, so it
  // is not looked for in the list.
  if (state.feedId !== ALL_FEEDS_ID && !state.feeds.some((feed) => feed.id === state.feedId)) {
    state.feedId = null;
  }

  // The open headline may have expired (clean_timeout) or been deleted elsewhere.
  let message = null;
  if (state.uid && !state.items.some((item) => item.uid === state.uid && inSelection(item))) {
    state.uid = null;
    message = t('reader.placeholder.expired');
  }

  renderTotal();
  renderFeeds();
  renderHeadlines();
  if (message) showPlaceholder(message);
  return message;
}

/**
 * Repaint everything this page draws itself: `applyI18n()` only reaches the markup declared in
 * index.html, so the feed rows, the headline rows and the open article are rebuilt from `state`.
 */
function redraw() {
  renderTotal();
  renderFeeds();
  renderHeadlines();

  const item = state.uid
    ? state.items.find((candidate) => candidate.uid === state.uid && inSelection(candidate))
    : null;
  if (item) openItem(item);
}

/* Storage is written by the background worker while this page is open, so react to it. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // A language saved on the settings screen has to reach this page without a reload: adopt it,
  // re-apply the dictionary to the markup, then redraw the dynamically rendered panels.
  const language = changes.settings?.newValue?.language;
  if (language && language !== currentLanguage()) {
    adoptLanguage(language);
    applyI18n();
    redraw();
  }

  if (changes.items || changes.feeds) void renderAll();
});

// The same screen switcher every screen has: it fills the header `<nav>` and jumps within this tab,
// so the reader icon on a settings screen brings the reader back to the same place.
mountNav();
// The per-column size switchers, one in the head of each panel; their labels follow the same
// `data-i18n-*` rule as the switcher's, so a language change re-pastes them too.
mountFontScales();
wireFontScaleChanges();
// The draggable borders between the columns: each gap of the layout becomes a handle, and the width
// a drag leaves behind is remembered for the next time the reader opens.
mountColumnResizers();
wireColumnWidthChanges();
els.refresh.addEventListener('click', () => void refreshSelectedFeed());
els.refreshAll.addEventListener('click', () => void refreshAllFeeds());
els.clearAll.addEventListener('click', () => void clearAllHeadlines());
els.contentDelete.addEventListener('click', () => void deleteItem());
void wireThemeButton(els.theme);

async function init() {
  // The stored language wins; on first run there is none and the browser language is used.
  adoptLanguage(await store.getLanguage());
  applyI18n();

  // The sizes the columns had when the reader was last closed; `font-boot.js` has already painted
  // them from its cache, so this only confirms them against storage.
  await loadFontScales();

  // The same for the widths: `columns-boot.js` has painted them, storage confirms them.
  await loadColumnWidths();

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
  // left selected the cursor goes to the top of the left column: «Все ленты», taken through
  // selectFeed() to the newest headline of all of them.
  if (!isAllFeeds() && !selectedFeed() && state.feeds.length > 0) {
    selectFeed(ALL_FEEDS_ID);
    return;
  }

  // A headline that survived the cleanup keeps its place; otherwise the top of the list opens.
  const item =
    (state.uid
      ? state.items.find((candidate) => candidate.uid === state.uid && inSelection(candidate))
      : null) ??
    itemsOfSelectedFeed()[0] ??
    null;

  if (item) {
    openItem(item);
  } else if (state.feedId && !lostHeadline) {
    // Nothing to open at all: the selection stands, its panel says so.
    showPlaceholder(t('reader.placeholder.inMiddle'));
  }
}

void init();
