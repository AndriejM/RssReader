// Three-panel reader: feeds -> stored headlines (title + pubDate) -> stored <description> rendered on click.

import { fetchArticle, sanitizePreview } from './lib/extract.js';
import { describeError } from './lib/errors.js';
import { loadColumnWidths, mountColumnResizers, wireColumnWidthChanges } from './lib/columns.js';
import { loadFontScales, mountFontScales, wireFontScaleChanges } from './lib/fontsize.js';
import { adoptLanguage, applyI18n, currentLanguage, t, unitLabels } from './lib/i18n.js';
import { MSG_FEEDS_CHANGED, MSG_REFRESH_ALL_FEEDS, MSG_REFRESH_FEED } from './lib/messages.js';
import { LAYOUT_EVENT, loadLayout, mountLayoutSwitcher, showsFeedsPanel, wireLayoutChanges } from './lib/layout.js';
import { mountNav } from './lib/nav.js';
import * as store from './lib/storage.js';
import { SETTINGS_PAGE, pageUrl } from './lib/tabs.js';
import { wireThemeButton } from './lib/theme.js';
import { readerKeys } from './lib/keys.js';
import { feedNextCheckAt, formatSince, formatUntil, humanDuration, itemTime } from './lib/util.js';

/* Synchronous first pass: the cached language (or the browser language) is known before
 * `chrome.storage` resolves, so nothing here has to wait for the async read below. */
applyI18n();

const els = {
  theme: document.getElementById('btn-theme'),
  reload: document.getElementById('btn-load'),
  clear: document.getElementById('btn-clear'),

  feedList: document.getElementById('feed-list'),
  feedsEmpty: document.getElementById('feeds-empty'),

  headlinesTitle: document.getElementById('headlines-title'),
  headlinesCount: document.getElementById('headlines-count'),
  feedStatus: document.getElementById('feed-status'),
  headlineSearch: document.getElementById('headline-search'),
  headlineList: document.getElementById('headline-list'),
  headlinesEmpty: document.getElementById('headlines-empty'),
  startCard: document.getElementById('start-card'),
  openFeeds: document.getElementById('btn-open-feeds'),

  announce: document.getElementById('reader-announce'),

  header: document.querySelector('.app-header'),
  panels: document.querySelector('.panels'),
  keysHelp: document.getElementById('keys-help'),
  keysButton: document.getElementById('btn-keys'),
  keysClose: document.getElementById('btn-keys-close'),

  contentDelete: document.getElementById('content-delete'),
  contentRead: document.getElementById('content-read'),
  contentArticle: document.getElementById('content-article'),
  contentBody: document.getElementById('content-body'),
  /* The right panel's placeholder and the article itself are two neighbours, not one spot: the panel
   * says now the one, now the other, while the live region is not recreated (see `sayEmpty`). */
  contentEmpty: document.getElementById('content-empty'),
  articleBody: document.getElementById('article-body'),

  /* The undo line: headline deletion puts it up, and it is also what brings the headline back. */
  undoLine: document.getElementById('undo-line'),
  undoText: document.getElementById('undo-text'),
  undoButton: document.getElementById('btn-undo'),
};

const state = {
  feeds: [],
  items: [],
  /** The `uid`s of the headlines the "read" mark keeps out of the selections (see `store.readMarksFor`). */
  read: new Set(),
  feedId: null,
  uid: null,
  query: '',
  /** The headline the reader can still bring back: the headline itself and how long its undo line lives. */
  undo: null,
  /**
   * The request number for full text: `renderArticle` raises it on every headline open, and
   * `loadArticleText` compares its own number against it — so a page that arrives late does not rub
   * out an already open headline.
   */
  articleToken: 0,
  /**
   * The failure of the last attempt to read what is selected now: a dictionary key and the failure
   * itself. The line under the middle column's header holds it, not the right panel: a network
   * failure has no right to overwrite an open article.
   */
  refreshError: null,
};

/*
 * The first row of the left column is not a feed: it stands for all of them at once, and the middle
 * column then holds the headlines of every feed, newest first. A stored feed id is a UUID
 * (`lib/util.js` -> `newId`), so this sentinel cannot be mistaken for one of them.
 */
const ALL_FEEDS_ID = '__all__';

/*
 * The settings screen opens in this same tab, so coming back to the reader has to land on the
 * same feed, the same headline and the same search. `sessionStorage` lives exactly as long as the
 * tab does: a reader tab opened elsewhere still starts with nothing selected.
 */
const SELECTION_KEY = 'rss-reader:selection';

function saveSelection() {
  sessionStorage.setItem(
    SELECTION_KEY,
    JSON.stringify({ feedId: state.feedId, uid: state.uid, query: state.query }),
  );
}

function restoreSelection() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SELECTION_KEY) ?? '');
    state.feedId = typeof saved?.feedId === 'string' ? saved.feedId : null;
    state.uid = typeof saved?.uid === 'string' ? saved.uid : null;
    /* The search belongs to what was being read: a reader that comes back from a settings screen
     * comes back to the same filtered list, so the field is filled with the words it held. */
    state.query = typeof saved?.query === 'string' ? saved.query : '';
    els.headlineSearch.value = state.query;
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

/** The open headline as the shelf holds it, or `null` when the right panel shows no article. */
function openHeadline() {
  if (!state.uid) return null;
  return state.items.find((item) => item.uid === state.uid && inSelection(item)) ?? null;
}

function countForFeed(feedId) {
  return state.items.filter((item) => item.feedId === feedId).length;
}

/** Whether a headline belongs to what the left column has selected now: one feed, or all of them. */
function inSelection(item) {
  return isAllFeeds() || item.feedId === state.feedId;
}

/** Whether the search field asks for a part of a title. */
function queryActive() {
  return state.query.trim().length > 0;
}

/**
 * Everything the search field can recognise about a headline is what the middle column shows about
 * it: its own title and the feed it came from. Every word typed has to appear somewhere in that
 * text, so «habr javascript» narrows the list instead of finding nothing.
 */
function matchesQuery(item) {
  const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = [item.title, item.feedName, item.rss_link]
    .map((value) => String(value ?? '').toLowerCase())
    .join('\n');
  return words.every((word) => haystack.includes(word));
}

/**
 * The headlines of the chosen left-column entry — in the same order as in the middle panel (fresh on
 * top). "All feeds" is `state.items`, which `renderAll()` has already sorted by date. Search narrows
 * this list but does not change its order.
 */
function visibleItems() {
  if (!state.feedId) return [];
  return state.items.filter(inSelection).filter(matchesQuery);
}

/*
 * How a load ended: how many headlines came in and how many feeds refused. The answer for one feed
 * and for all of them has one shape: `added` in the answer or in each row of `results`, `failed` —
 * their count.
 */
function outcomeOf(response) {
  if (!response?.ok) return t('reader.announce.error', { error: describeError(response?.error) });

  const results = response.results ?? [response];
  const added = results.reduce((sum, entry) => sum + (Number(entry.added) || 0), 0);
  const failed = Number(response.failed) || results.filter((entry) => entry.ok === false).length;

  const parts = [added > 0 ? t('reader.announce.loaded', { count: added }) : t('reader.announce.none')];
  if (failed > 0) parts.push(t('reader.announce.failed', { count: failed }));
  return parts.join(' · ');
}

/**
 * The failure of the last attempt to read the feeds. `state.refreshError` holds the failure itself
 * (`{ code, params, message }`, as the worker brings it) and the key of its label, not their
 * translation: the status line is redrawn on a language change, and then it must tell of the fault in
 * the new language.
 */
function refreshFailureText(failure) {
  return t(failure.key, { error: describeError(failure.error) });
}

/**
 * An open article stays an article: its text lies in storage, and a temporary network fault has no
 * right to throw the reader out to the first headline. So the failure stands in the line under the
 * middle column's header — where the reader already speaks about loading the very same selection —
 * and only in the right panel when there is no article in it anyway.
 */
function reportRefreshFailure(key, error) {
  state.refreshError = { key, error: error ?? null };
  if (openHeadline()) renderFeedStatus();
  else sayEmpty(refreshFailureText(state.refreshError), { alert: true });
}


/**
 * Postpones a call of `fn` until the caller falls quiet for `wait` ms: fast events coming one after
 * another (every search character, every background write in `chrome.storage.onChanged`) redraw the
 * panels once at the end of the batch, not on every event.
 */
function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

/**
 * What the reader says aloud when a panel is redrawn: a `role="status"` line (see `index.html`) is
 * never drawn anywhere — only a screen reader reads it, and the same truth stands in the panels
 * themselves. An empty line says nothing: that way a reload from `chrome.storage.onChanged` does not
 * retell aloud what a mouse click or a key already said.
 */
function say(message) {
  if (!message) return;
  /* The same words one after another are not the change a screen reader will report: the line first
   * empties and fills on the next tick, so "got 5" sounds even when a feed was refreshed twice. */
  els.announce.textContent = '';
  setTimeout(() => {
    els.announce.textContent = message;
  }, 50);
}

/**
 * The row above the feeds: it is not one of them, so it is drawn apart (see `reader.css`) and its
 * meta line counts the headlines of every feed instead of naming one feed's refresh interval.
 */
function renderAllFeedsRow() {
  const all = state.feedId === ALL_FEEDS_ID;
  const li = document.createElement('li');
  li.className = `list-item list-all-feeds${all ? ' selected' : ''}`;

  const button = document.createElement('button');
  button.type = 'button';
  if (all) button.setAttribute('aria-current', 'true');
  // Not a feed, so it has no site icon of its own; the RSS glyph in the same box keeps every row of
  // the column on one grid.
  const box = document.createElement('span');
  box.className = 'item-icon';
  box.append(icon('rss'));

  const body = document.createElement('span');
  body.className = 'item-body';
  const title = document.createElement('span');
  title.className = 'item-title';
  title.textContent = t('reader.feeds.all');
  // Its meta line counts the headlines of every feed; the feeds themselves are named in the middle
  // column, where each headline carries the feed it came from.
  const meta = document.createElement('span');
  meta.className = 'item-meta muted';
  meta.textContent = t('reader.feeds.allMeta', { count: state.items.length });
  body.append(title, meta);

  button.append(box, body);
  button.addEventListener('click', () => chooseFeed(ALL_FEEDS_ID));
  li.append(button);
  els.feedList.append(li);
}

/**
 * A feed row's tooltip: when it was read last and how that attempt ended. The failure is labeled in
 * the page's language with the same `describeError` as a load error in the middle column, so a failure
 * code does not stay a raw dictionary key.
 */
function feedHealthTitle(feed) {
  const parts = [];
  const checkedAt = Number(feed.lastCheckedAt);
  if (Number.isFinite(checkedAt) && checkedAt > 0) {
    parts.push(t('reader.feed.lastChecked', { since: formatSince(checkedAt, Date.now(), unitLabels()) }));
  }

  if ((Number(feed.fetchFailureCount) || 0) > 0 && feed.lastErrorAt) {
    parts.push(
      t('reader.feed.lastError', {
        error: describeError({
          code: feed.lastErrorCode,
          params: feed.lastErrorParams,
          message: feed.lastErrorMessage || undefined,
        }),
      }),
    );
  }

  /* When the feed will be asked again. The alarm stands on its own schedule, and the pause after a
   * failure only skips an attempt (see `background.js`), so during a pause the line speaks of the
   * pause's deadline, and outside it — of the deadline the alarm itself names. */
  const retryAt = Number(feed.nextRetryAt);
  if (retryAt > Date.now()) {
    parts.push(t('reader.feed.nextRetry', { until: formatUntil(retryAt, Date.now(), unitLabels()) }));
  } else {
    const nextAt = feedNextCheckAt(feed);
    if (nextAt > 0) {
      parts.push(t('reader.feed.nextCheck', { until: formatUntil(nextAt, Date.now(), unitLabels()) }));
    }
  }

  return parts.join('\n');
}

function paintFeeds() {
  els.feedList.replaceChildren();
  els.feedsEmpty.hidden = state.feeds.length > 0;

  // With no feeds there is nothing to gather, so only the hint of the empty column is left.
  if (state.feeds.length > 0) renderAllFeedsRow();

  for (const feed of state.feeds) {
    const li = document.createElement('li');
    const selected = feed.id === state.feedId;
    li.className = `list-item${selected ? ' selected' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    /* The row remembers which feed it belongs to: `refreshAgedLabels` uses this to redraw its
     * last-check tooltip without rebuilding the column. */
    button.dataset.feedId = feed.id;
    // The left column's row selects a feed: `aria-current` tells a screen reader which of them is
    // selected — the same thing the selection color tells the eye.
    if (selected) button.setAttribute('aria-current', 'true');
    button.append(feedIconImg(feed.id));

    const body = document.createElement('span');
    body.className = 'item-body';
    const title = document.createElement('span');
    title.className = 'item-title';
    title.textContent = feed.name || feed.rss_link;
    const meta = document.createElement('span');
    meta.className = 'item-meta muted';
    meta.textContent = t('reader.feed.itemMeta', {
      count: countForFeed(feed.id),
      duration: humanDuration(feed.delay_timeout, unitLabels()),
    });
    body.append(title, meta);

    /* A feed that cannot be read must not look like an ordinary row: the failure glyph stands beside
     * its name, the failure counter under the name, and the details in the row's tooltip. */
    const failures = Number(feed.fetchFailureCount) || 0;
    if (failures > 0 && feed.lastErrorAt) {
      const warn = icon('warning');
      warn.classList.add('feed-warning');
      title.append(warn);

      const status = document.createElement('span');
      status.className = 'item-meta feed-health';
      status.textContent = t('reader.feed.failedCount', { count: failures });
      body.append(status);
    }
    const health = feedHealthTitle(feed);
    if (health) button.title = health;

    button.append(body);
    button.addEventListener('click', () => chooseFeed(feed.id));
    li.append(button);
    els.feedList.append(li);
  }
}

/**
 * The line under the middle panel's header: what the reader knows about loading what it shows.
 * "Headlines received 4 min ago" answers "why did no news come" without the worker's console, and
 * names beside it when they will be asked next: one feed has its own alarm, "all feeds" has the
 * earliest alarm of them all.
 *
 * The age of the headlines and the age of the check are different things: a 304 answer brings
 * nothing, so it does not move the moment they were received. That is exactly what is worth knowing:
 * the reader asked recently, and the server has had nothing newer since.
 */
function renderFeedStatus() {
  const all = isAllFeeds();
  const feed = all ? null : selectedFeed();
  const scope = all ? state.feeds : feed ? [feed] : [];
  const now = Date.now();
  const parts = [];

  const fetchedAt = Math.max(0, ...scope.map((candidate) => Number(candidate.lastFetchedAt) || 0));
  if (fetchedAt > 0) {
    parts.push(t('reader.status.lastFetched', { since: formatSince(fetchedAt, now, unitLabels()) }));
  }

  const nextAt = scope
    .map((candidate) => feedNextCheckAt(candidate, now))
    .filter((at) => at > 0)
    .sort((a, b) => a - b)[0];
  if (nextAt) {
    parts.push(t('reader.status.nextCheck', { until: formatUntil(nextAt, now, unitLabels()) }));
  }

  /* The failure of the last attempt is about the very selection this line speaks of. It stands at the
   * line's end and takes its own color (see `.panel-status.error`) so it does not look like an
   * ordinary deadline. */
  const failed = state.refreshError ? [refreshFailureText(state.refreshError)] : [];

  els.feedStatus.hidden = parts.length === 0 && failed.length === 0;
  els.feedStatus.classList.toggle('error', failed.length > 0);
  els.feedStatus.textContent = [...parts, ...failed].join(' · ');
}

/**
 * The reader's first run: while storage holds not a single feed, the middle column has nothing to
 * show, and its search field and "Load" / "Delete" buttons would act over an empty selection. So
 * until the first feed their place is taken by a card linking to the feeds screen. The function's
 * answer also tells the right panel what to show instead of an article.
 */
function renderStartCard() {
  const noFeeds = state.feeds.length === 0;
  els.startCard.hidden = !noFeeds;
  els.headlineSearch.hidden = noFeeds;
  els.reload.hidden = noFeeds;
  els.clear.hidden = noFeeds;
  return noFeeds;
}

/**
 * Label a headline row with what the column knows about it: the feed it came from (needed only by
 * "All feeds") and the age of the news itself. The same work is done by the tick that strikes through
 * the age in place (see `refreshAgedLabels`).
 */
function paintItemMeta(meta, item, all) {
  const when = itemTime(item);
  meta.textContent = [
    all ? item.feedName || item.rss_link : '',
    when ? t('reader.published', { since: formatSince(when, Date.now(), unitLabels()) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function paintHeadlines() {
  els.headlineList.replaceChildren();

  const all = isAllFeeds();
  const feed = all ? null : selectedFeed();
  els.headlinesTitle.textContent = all
    ? t('reader.feeds.all')
    : feed?.name ?? t('reader.headlines.title');

  const items = visibleItems();
  const searching = queryActive();
  const noFeeds = renderStartCard();
  els.headlinesCount.textContent = items.length ? `${items.length}` : '';

  /* With no feeds the first-run card, not the empty-list line, speaks of the middle column's emptiness:
   * "Choose a feed on the left" above an empty left column would advise choosing something that is
   * not there. */
  els.headlinesEmpty.hidden = items.length > 0 || noFeeds;
  if (!noFeeds) {
    els.headlinesEmpty.textContent = searching
      ? t('reader.headlines.emptySearch')
      : all
        ? t('reader.headlines.emptyAllFeeds')
        : feed
          ? t('reader.headlines.emptyForFeed')
          : t('reader.headlines.emptyNoFeed');
  }

  // The load/clear buttons sit in this head and act on this very selection, so their tooltip names
  // exactly what they now cover: a single feed, or every feed when «All feeds» is picked.
  els.reload.title = t(all ? 'reader.refreshAll.tooltip' : 'reader.refresh.tooltip');
  els.reload.setAttribute('aria-label', t(all ? 'reader.refreshAll.aria' : 'reader.refresh.aria'));
  els.clear.title = t(all ? 'reader.clearAll.tooltip' : 'reader.clearFeed.tooltip');
  els.clear.setAttribute('aria-label', t(all ? 'reader.clearAll.aria' : 'reader.clearFeed.aria'));

  // The line under this head speaks about the same selection as these two buttons.
  renderFeedStatus();

  let rowNumber = 0;
  for (const item of items) {
    const li = document.createElement('li');
    // `data-uid` gives the row a name by which `showHeadline()` finds it and moves the selection
    // without rebuilding the whole list (see `selectHeadline`).
    li.dataset.uid = item.uid;
    /* The middle column is a `listbox` (see `index.html`), so its row is an `option`, and the open
     * news is the one with `aria-selected`; without it a screen reader would call the list a list of
     * buttons. The row also needs an `id`: by it the list names the row the keyboard cursor stands on
     * (see `setActiveDescendant`). The name takes the row's place in the list: it is guaranteed not to
     * repeat, whereas `uid` is built on a feed id and could give a name with characters an `id` does
     * not tolerate (see `lib/util.js` -> `normalizeUid`). */
    li.id = `hl-${(rowNumber += 1)}`;
    li.setAttribute('role', 'option');
    const selected = item.uid === state.uid;
    const read = state.read.has(item.uid);
    li.setAttribute('aria-selected', selected ? 'true' : 'false');
    li.className = `list-item${selected ? ' selected' : ''}${read ? ' read' : ''}`;

    /* An `option` row holds no actions inside it: a button in it would be a second focus within one
     * selection and would break the list itself for a screen reader. So the row is a plain block, and
     * a click takes the whole row; the keyboard cursor meanwhile stands on the list itself (see
     * `index.html`). */
    const row = document.createElement('div');
    row.className = 'item-row';
    li.addEventListener('click', () => showHeadline(item));
    // Only «All feeds» needs a feed to stand beside the headline, so only there does the headline
    // carry its feed's icon; a single feed's list names that feed in the panel title instead.
    if (all) row.append(feedIconImg(item.feedId));

    const body = document.createElement('span');
    body.className = 'item-body';
    const title = document.createElement('span');
    title.className = 'item-title';
    // A headline the feed gave no title is labelled here, in the reader's language.
    title.textContent = item.title || t('common.untitled');
    /* The glyph of a headline marked as read: the same state the right panel's button puts on and
     * takes off, and the very reason the selections no longer bring this news. */
    if (read) title.append(readFlag());

    const meta = document.createElement('span');
    meta.className = 'item-meta muted';
    paintItemMeta(meta, item, all);
    body.append(title, meta);
    row.append(body);
    row.title = item.link;

    li.append(row);
    els.headlineList.append(li);
  }

  setActiveDescendant();
  /* A list that has nothing to show the cursor has no business being a Tab node either: a Tab stop
   * that names nothing only keeps the reader in place where the column is empty. */
  if (items.length > 0) els.headlineList.tabIndex = 0;
  else els.headlineList.removeAttribute('tabindex');
}

/**
 * The middle column's keyboard cursor: it stands on the list itself — one Tab node for the whole
 * column — and `aria-activedescendant` names the row the cursor stands on. Without it a screen reader
 * would know which row is selected but not where to lead the next arrow or what to read aloud.
 */
function setActiveDescendant() {
  const active = state.uid
    ? els.headlineList.querySelector(`.list-item[data-uid="${CSS.escape(state.uid)}"]`)
    : null;
  if (active) els.headlineList.setAttribute('aria-activedescendant', active.id);
  else els.headlineList.removeAttribute('aria-activedescendant');
}

/**
 * Move the left column's cursor — to a feed or to «All feeds» — and put the middle column on the
 * first headline of whatever that selection now covers.
 */
function chooseFeed(feedId) {
  state.feedId = feedId;
  // Switching feeds drops whatever headline was open.
  state.uid = null;
  /* The line under the middle column's header speaks about loading what is selected now: another
   * feed's failure must not carry over onto the new line. */
  state.refreshError = null;
  paintFeeds();
  paintHeadlines();

  // The cursor in the middle column goes to the first headline of the feed that was just
  // picked; a feed whose headlines are all gone still has to say so in the empty panel.
  const first = visibleItems()[0];
  if (first) showHeadline(first);
  else sayEmpty(queryActive() ? t('reader.headlines.emptySearch') : t('reader.placeholder.inMiddle'));

  saveSelection();
}

/**
 * The right panel without an article: in its place a line about why there is nothing to show. It
 * stands in the markup and keeps its place when the panel switches now to it, now to the article — a
 * live region that gets recreated cannot be announced to a screen reader. `alert` means a failure that
 * must be said at once; `status` — an ordinary "it is empty here" that must not interrupt reading.
 */
function sayEmpty(message, { alert = false } = {}) {
  state.uid = null;
  els.contentDelete.hidden = true;
  els.contentRead.hidden = true;
  els.contentArticle.hidden = true;
  els.articleBody.replaceChildren();

  const p = els.contentEmpty;
  p.hidden = false;
  p.setAttribute('role', alert ? 'alert' : 'status');
  p.classList.toggle('error', alert);
  p.textContent = message;
  setActiveDescendant();
}

/**
 * Search changes the middle column, and with it the open headline: it stays the same one while it is
 * visible, otherwise it moves to the first of those that remain, and when nothing remains the right
 * panel says so instead of an article.
 */
function applyQuerySelection() {
  const visible = visibleItems();

  if (visible.length === 0) {
    sayEmpty(queryActive() ? t('reader.headlines.emptySearch') : t('reader.placeholder.inMiddle'));
    paintHeadlines();
    saveSelection();
    return;
  }

  const current = visible.find((item) => item.uid === state.uid);
  const target = current ?? visible[0];
  /* Search changes the very set of visible rows, so the column is rebuilt from scratch:
   * `showHeadline()` would highlight the needed row in place, but the old rows — no longer matching
   * the query — would have stayed in the list. */
  state.uid = target.uid;
  saveSelection();
  paintHeadlines();
  renderArticle(target);
}

/** The check glyph of a read headline: the sprite's «read» icon, named for the stylesheet. */
function readFlag() {
  const flag = icon('read');
  flag.classList.add('read-flag');
  return flag;
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

/** The stored link to a feed's site icon (`lib/favicon.js`), or null when the feed has none. */
function feedIconUrl(feedId) {
  return state.feeds.find((feed) => feed.id === feedId)?.icon || null;
}

/**
 * The site icon of a feed: the stored link drawn at its own size in a fixed square. A feed whose
 * icon never loaded keeps the empty box, so every feed row stays as wide as its neighbour and the
 * missing picture is a hole, not a missing column.
 */
function feedIconImg(feedId) {
  const box = document.createElement('span');
  box.className = 'item-icon';
  const url = feedIconUrl(feedId);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
}

/**
 * The headline itself is the link to the original: it opens the news in a new tab, which is
 * why the toolbar no longer carries a separate "Open the original" control.
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

/**
 * Requirement: clicking a title shows the stored `<description>` in the right panel.
 * `followFocus` is set only where the keyboard moves the cursor: the middle column takes the focus,
 * and `aria-activedescendant` names the row the cursor now stands on, so its name is read out and
 * the next arrow continues from the row that is now open.
 */
function showHeadline(item, { followFocus = false } = {}) {
  state.uid = item.uid;
  saveSelection();
  /* Moving the cursor (`j`/`k`) does not change which headlines the column shows, so the new row is
   * highlighted in place instead of rebuilding the whole middle column: a full `paintHeadlines()` is
   * several thousand `<li>` and the same number of closures on every keypress. If the row is not on
   * screen (the visible set changed), the column has to be rebuilt entirely — it names the active
   * cursor's row itself anyway.
   * `focus()` goes to the middle column, not to its row: the list holds the cursor, the row is only
   * what it points at (see `setActiveDescendant`). */
  if (selectHeadline(item.uid)) setActiveDescendant();
  else paintHeadlines();
  if (followFocus) els.headlineList.focus();

  renderArticle(item);
}

/**
 * The headline a load brings the reader when it has no open one: the first of what the middle column
 * shows. A load does not move an open headline — all the more when the load failed and there are no
 * new headlines.
 */
function openTopHeadline() {
  if (state.uid) return;
  const first = visibleItems()[0];
  if (first) showHeadline(first);
}

/**
 * Moves the middle column's selection onto row `uid`, changing only two rows: the one that was open
 * and the one that opens. Returns `false` when the row is not on screen — meaning the visible set
 * changed and the column must be rebuilt, not patched in place.
 */
function selectHeadline(uid) {
  const next = els.headlineList.querySelector(`.list-item[data-uid="${CSS.escape(uid)}"]`);
  if (!next) return false;

  const prev = els.headlineList.querySelector('.list-item.selected');
  if (prev && prev !== next) {
    prev.classList.remove('selected');
    prev.setAttribute('aria-selected', 'false');
  }
  next.classList.add('selected');
  next.setAttribute('aria-selected', 'true');
  return true;
}

/** The right panel of an open news item: a title-link, the source and the stored `<description>`. */
function renderArticle(item) {
  /* A newly open news item starts with its stored preview; the full text, if the reader asks for it,
   * pulls in on top of it. The raised number cancels the page that was loading for the previous
   * headline: it must not arrive later and rub out this one. */
  state.articleToken += 1;
  els.contentDelete.hidden = false;
  els.contentEmpty.hidden = true;
  paintReadButton(item);
  paintArticleButton(item);

  const marked = state.read.has(item.uid) ? [note(t('reader.content.marked'), 'marked')] : [];
  const preview = sanitizePreview(item.description);
  if (!preview.node) {
    els.articleBody.replaceChildren(
      ...articleHead(item),
      ...marked,
      note(t('reader.content.noDescription'), 'error'),
      note(t('reader.content.originalByLink')),
    );
    return;
  }

  const notes = preview.truncated ? [note(t('reader.content.truncated'))] : [];
  els.articleBody.replaceChildren(...articleHead(item), ...marked, preview.node, ...notes);
}

/** The title link and the source line — the shared head of the right panel for the preview and for the full text. */
function articleHead(item) {
  const title = titleHeading(item.title || t('common.untitled'), item.link);
  const source = document.createElement('div');
  source.className = 'source';
  paintSource(source, item);
  return [title, source];
}

/**
 * The source line of the open article: the same age label the list row holds, and the same redraw in
 * place.
 */
function paintSource(source, item) {
  const name = item.feedName || item.rss_link;
  const when = itemTime(item);
  source.textContent = when
    ? t('reader.source', { name, since: formatSince(when, Date.now(), unitLabels()) })
    : name;
}

/**
 * The full-text button exists only for a headline there is somewhere to go to: without a link there is
 * nowhere to go, and a button that cannot do anything would be an empty hole in the panel.
 */
function paintArticleButton(item) {
  els.contentArticle.hidden = !item.link;
  els.contentArticle.disabled = false;
}

/**
 * The requirement "content is loaded dynamically": on the button (or the `f` key) the reader goes to the
 * headline's page and takes the article's text out of it, putting it over the stored preview.
 * The page loads for exactly `ARTICLE_FETCH_TIMEOUT_MS`; a refusal is named by its own code and signed in
 * the reader's language (`describeError`). The request number guards the race: if by then the cursor has
 * gone to another headline, the late page must not rub out what has just opened.
 */
async function loadArticleText() {
  const item = openHeadline();
  if (!item?.link) return;

  const token = ++state.articleToken;
  els.contentArticle.disabled = true;

  const marked = state.read.has(item.uid) ? [note(t('reader.content.marked'), 'marked')] : [];
  els.articleBody.replaceChildren(...articleHead(item), ...marked, note(t('reader.content.articleLoading')));

  let article;
  try {
    article = await fetchArticle(item.link);
  } catch (error) {
    if (token !== state.articleToken) return;
    els.articleBody.replaceChildren(
      ...articleHead(item),
      ...marked,
      note(describeError(error), 'error'),
      note(t('reader.content.originalByLink')),
    );
    return;
  } finally {
    /* The button is back in service only if this headline is still open: otherwise `renderArticle` of the
     * new one already answers for it. */
    if (token === state.articleToken) els.contentArticle.disabled = false;
  }

  if (token !== state.articleToken) return; // the cursor has gone: the late page is no longer wanted

  const paragraphs = article.paragraphs.map((text) => {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  });
  if (paragraphs.length === 0) {
    els.articleBody.replaceChildren(
      ...articleHead(item),
      ...marked,
      note(t('reader.content.articleNone')),
      note(t('reader.content.originalByLink')),
    );
    return;
  }

  const notes = article.truncated ? [note(t('reader.content.articleTruncated'))] : [];
  els.articleBody.replaceChildren(...articleHead(item), ...marked, ...paragraphs, ...notes);
}

function note(text, kind = '') {
  const p = document.createElement('p');
  p.className = kind ? `note ${kind}` : 'note';
  p.textContent = text;
  return p;
}

/**
 * "Mark read" is the read model where the reader can see it: the headline stays exactly where it
 * stands and takes the marker that keeps its news out of the polls for `read_ttl_days` (see
 * `store.markRead`). The same button takes the marker back, so what the reader marks is something it
 * can undo — unlike a delete, which throws the headline itself away.
 */
async function toggleHeadlineRead() {
  const item = openHeadline();
  if (!item) return;

  const wasRead = state.read.has(item.uid);
  els.contentRead.disabled = true;
  try {
    if (wasRead) await store.unmarkRead([item]);
    else await store.markRead([item]);
  } finally {
    els.contentRead.disabled = false;
  }

  /* The headline itself has not moved anywhere, so only its label is repainted: the middle column's row
   * and the right panel's button, not the whole column. */
  state.read = store.readMarksFor(state.items, await store.getRead());
  paintReadRow(item.uid, state.read.has(item.uid));
  paintReadButton(item);
  say(t(wasRead ? 'reader.announce.unmarked' : 'reader.announce.marked'));
}

/** The right panel's button: it names which way it acts now, and stands pressed when the mark stands. */
function paintReadButton(item) {
  const isRead = state.read.has(item.uid);
  const key = isRead ? 'unmark' : 'mark';

  els.contentRead.hidden = false;
  els.contentRead.setAttribute('aria-pressed', String(isRead));
  els.contentRead.title = t(`reader.content.${key}.tooltip`);
  els.contentRead.setAttribute('aria-label', t(`reader.content.${key}.aria`));
  els.contentRead.replaceChildren(icon(isRead ? 'unread' : 'read'));
}

/** Puts a mark on a single row or takes it off without rebuilding the middle column. */
function paintReadRow(uid, isRead) {
  const li = els.headlineList.querySelector(`.list-item[data-uid="${CSS.escape(uid)}"]`);
  const title = li?.querySelector('.item-title');
  if (!li || !title) return;

  li.classList.toggle('read', isRead);
  title.querySelector('.read-flag')?.remove();
  if (isRead) title.append(readFlag());
}

/** How long the window of an undo stands before the reader stops offering it. */
const UNDO_MS = 15000;

/**
 * The undo line for a delete: it lies along the lower edge of the article text, overlaid on the column
 * (see `.undo-line` in `styles/reader.css`), and names exactly what the reader can bring back — the
 * article text does not shift because of it. The window stands `UNDO_MS` and closes on `Esc`, so the key
 * touches neither the open headline nor what is typed in the search field.
 */
function offerUndo(item) {
  clearUndo();
  state.undo = { item, timer: setTimeout(clearUndo, UNDO_MS) };
  renderUndo();
}

function clearUndo() {
  if (!state.undo) return;
  clearTimeout(state.undo.timer);
  state.undo = null;
  els.undoLine.hidden = true;
  els.undoText.textContent = '';
}

/** Moves the undo line to the new language: its text names the deleted headline. */
function renderUndo() {
  if (!state.undo) {
    els.undoLine.hidden = true;
    return;
  }
  const item = state.undo.item;
  els.undoText.textContent = t('reader.undo.prompt', { title: item.title || t('common.untitled') });
  els.undoLine.hidden = false;
}

/**
 * Brings the deleted headline back: it takes its place on the shelf where it was, and the mark that kept
 * it out of the selections is taken off (see `store.restoreItem`) — otherwise the returned news would not
 * come back out of the feed, which is exactly what the reader asked for.
 */
async function undoDelete() {
  const removed = state.undo?.item;
  if (!removed) return;

  clearUndo();
  const restored = await store.restoreItem(removed);
  if (!restored) {
    say(t('reader.announce.undoFailed'));
    return;
  }

  state.uid = removed.uid;
  await renderAll();
  /* `renderAll()` rebuilds the columns but does not draw the article: without this the middle column
   * would put the selection back on the returned headline while the right panel stayed with what stood
   * before the delete. */
  const restoredItem = openHeadline();
  if (restoredItem) renderArticle(restoredItem);
  saveSelection();
  say(t('reader.announce.undone'));
}

/** Deleting a headline hands the reader to the next headline of the same selection. */
async function deleteItem() {
  if (!state.uid) return;

  const all = isAllFeeds();
  const position = visibleItems().findIndex((item) => item.uid === state.uid);

  const uid = state.uid;
  const removed = state.items.find((item) => item.uid === uid) ?? null;
  await store.removeItem(uid);
  state.uid = null;
  saveSelection();
  await renderAll();
  say(t('reader.announce.deleted'));
  if (removed) offerUndo(removed);

  // "All feeds" keeps the whole list: the next headline is the one that stood below the removed
  // one, whatever feed it belongs to. The search field filters that list exactly as it filters the
  // middle column, so the cursor lands on the next headline the reader can actually see.
  const remaining = visibleItems();
  if (remaining.length === 0) {
    sayEmpty(
      queryActive()
        ? t('reader.headlines.emptySearch')
        : all
          ? t('reader.placeholder.deletedLastAll')
          : t('reader.placeholder.deletedLast'),
    );
    return;
  }

  // Same slot in the list: the headline that used to sit below the removed one, or the last
  // one when the removed headline was the bottom of the list. `followFocus` — because the row that
  // held the focus is gone, and the cursor of the keyboard goes to the same slot it moved to.
  const next = remaining[Math.max(0, Math.min(position, remaining.length - 1))];
  showHeadline(next, { followFocus: true });
}

/**
 * The trash icon beside the middle panel's title: it removes from storage the headlines the left
 * column has selected — one feed's headlines, or (with "All feeds") every headline. They are
 * remembered as read so the next feed read does not hand them straight back. Deleting the whole
 * selection at once is the one thing on this screen that no undo window takes back, so it is
 * confirmed before it happens — the way a feed and a read list are deleted on the other two screens.
 * The storage write also makes the background worker refresh the badge, and this page's
 * storage.onChanged listener repaints the panels, so no extra bookkeeping is needed.
 */
async function clearSelectionHeadlines() {
  const targets = visibleItems();
  if (targets.length === 0) return;
  if (!window.confirm(t('reader.confirmClear', { count: targets.length }))) return;

  els.clear.disabled = true;
  try {
    if (isAllFeeds()) await store.clearAllItems();
    else await store.clearItemsForFeed(state.feedId);
    await renderAll();
    say(t('reader.announce.cleared', { count: targets.length }));
  } finally {
    els.clear.disabled = false;
  }
}

/**
 * The load icon beside the middle panel's title: it reads the headlines of whatever the left column
 * has selected — a single feed, or (with "All feeds") every feed of the list at once.
 */
async function reloadSelection() {
  if (isAllFeeds()) {
    await refreshAllFeeds();
    return;
  }

  const feed = selectedFeed();
  if (!feed) {
    sayEmpty(t('reader.refresh.noFeed'), { alert: true });
    return;
  }

  const tip = els.reload.title;
  els.reload.disabled = true;
  els.reload.classList.add('busy');
  els.reload.title = t('common.loading');
  try {
    /* The status line speaks of the last attempt: its past failure is taken off even before the panels
     * have been redrawn. */
    state.refreshError = null;
    const response = await chrome.runtime.sendMessage({ type: MSG_REFRESH_FEED, feedId: feed.id });
    if (!response?.ok) reportRefreshFailure('reader.refresh.failed', response?.error);
    await renderAll();
    if (response?.ok) openTopHeadline();
    say(outcomeOf(response));
  } finally {
    els.reload.disabled = false;
    els.reload.classList.remove('busy');
    els.reload.title = tip;
  }
}

/**
 * Read every feed at once. The load icon of the middle panel is the one that asked for it: it is the
 * button that spins and stays disabled while the worker fetches the feeds one after another. A feed
 * that failed keeps its stored headlines, so a partial failure is a notice rather than an empty screen.
 */
async function refreshAllFeeds() {
  if (state.feeds.length === 0) {
    // Asking to refresh what does not exist yet is the same first meeting as the empty middle column.
    sayEmpty(t('reader.start.contentHint'));
    return;
  }

  const tip = els.reload.title;
  els.reload.disabled = true;
  els.reload.classList.add('busy');
  els.reload.title = t('common.loading');
  try {
    state.refreshError = null;
    const response = await chrome.runtime.sendMessage({ type: MSG_REFRESH_ALL_FEEDS });
    if (!response?.ok) {
      reportRefreshFailure('reader.refresh.failed', response?.error);
    } else if (response.failed > 0) {
      const failure = (response.results ?? []).find((entry) => !entry.ok);
      reportRefreshFailure('reader.refreshAll.failed', failure?.error);
    }
    await renderAll();
    if (response?.ok) openTopHeadline();
    say(outcomeOf(response));
  } finally {
    els.reload.disabled = false;
    els.reload.classList.remove('busy');
    els.reload.title = tip;
  }
}

async function renderAll() {
  const [feeds, items, read] = await Promise.all([
    store.getFeeds(),
    store.getItems(),
    store.getRead(),
  ]);
  state.feeds = feeds;
  state.items = store.sortItems(items);
  /* The middle column draws the "read" marker where the storage holds it: by the very matching that keeps
   * a fresh headline out of the list of read ones (see `store.addItems`). */
  state.read = store.readMarksFor(state.items, read);

  // The selected feed may have been deleted on the settings screen; "All feeds" is no feed, so it
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

  paintFeeds();
  paintHeadlines();
  /* The right panel speaks either of the open headline having gone, or of the first feed there is not yet:
   * without it there is nothing to show there, and "select a headline" would be advice to select emptiness. */
  if (message) sayEmpty(message);
  else if (state.feeds.length === 0) sayEmpty(t('reader.start.contentHint'));
  return message;
}

/**
 * Repaint everything this page draws itself: `applyI18n()` only reaches the markup declared in
 * index.html, so the feed rows, the headline rows and the open article are rebuilt from `state`.
 */
function redraw() {
  paintFeeds();
  paintHeadlines();

  const item = openHeadline();
  if (item) showHeadline(item);
  else if (state.feeds.length === 0) sayEmpty(t('reader.start.contentHint'));
  /* The failure of the last load is something the page draws itself: a language change translates it too. */
  else if (state.refreshError) sayEmpty(refreshFailureText(state.refreshError), { alert: true });
  /* The undo line is also drawn in the words of the dictionary: a language change on the settings screen
   * reaches it too. */
  renderUndo();
}

/* Storage is written by the background worker while this page is open, so react to it. */

/* The background worker can make several writes in a row (walking the feeds, read marks), and each of
 * them raises `storage.onChanged`. The redraw is gathered into one call at the end of the batch. A tab
 * nobody sees is not redrawn in vain: it catches up on `visibilitychange`. */
let pendingStorageRender = false;
const scheduleStorageRender = debounce(() => {
  if (document.hidden) {
    pendingStorageRender = true;
    return;
  }
  void renderAll();
}, 200);

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

  if (changes.items || changes.feeds || changes.read) scheduleStorageRender();
});

// The same screen switcher every screen has: it fills the header `<nav>` and jumps within this tab,
// so the reader icon on a settings screen brings the reader back to the same place.
mountNav();
// The arrangement of the panels: three columns, or two once the feeds column is dropped. Its switcher
// is built before the first paint of the panels, so the button in use is marked from the start.
mountLayoutSwitcher();
wireLayoutChanges();
// The per-column size switchers, one in the head of each panel; their labels follow the same
// `data-i18n-*` rule as the switcher's, so a language change re-pastes them too.
mountFontScales();
wireFontScaleChanges();
// The draggable borders between the columns: each gap of the layout becomes a handle, and the width
// a drag leaves behind is remembered for the next time the reader opens.
mountColumnResizers();
wireColumnWidthChanges();
/*
 * A different arrangement adds or takes away the feeds column, and the selection follows what the
 * columns can show: with no feeds column the list is the whole of the feeds (the reader has no place
 * left to name one feed in), and coming back to three columns redraws the column that was hidden.
 */
document.addEventListener(LAYOUT_EVENT, () => {
  if (showsFeedsPanel()) paintFeeds();
  else if (!isAllFeeds()) chooseFeed(ALL_FEEDS_ID);
});
els.reload.addEventListener('click', () => void reloadSelection());
els.clear.addEventListener('click', () => void clearSelectionHeadlines());
els.contentDelete.addEventListener('click', () => void deleteItem());
els.contentRead.addEventListener('click', () => void toggleHeadlineRead());
els.contentArticle.addEventListener('click', () => void loadArticleText());
els.undoButton.addEventListener('click', () => void undoDelete());
/*
 * The keyboard help: the "?" button of the header opens it, its own cross and a click on the window's
 * background close it; the list itself closes on the `?` key too (see the handler below). The return of
 * focus is the same in every case: the cursor stands on the button that opened the window.
 */
els.keysButton.addEventListener('click', openKeysHelp);
els.keysClose.addEventListener('click', closeKeysHelp);
els.keysHelp.addEventListener('click', (event) => {
  // The card of the help lies inside the dialog: a click on the dialog itself is a click past the card.
  if (event.target === els.keysHelp) closeKeysHelp();
});
els.keysHelp.addEventListener('close', () => {
  els.header.removeAttribute('aria-hidden');
  els.panels.removeAttribute('aria-hidden');
  els.keysButton.focus();
});
/* The button of the first-run card goes the same road as the feeds icon in the screen switcher: a jump in
 * this same tab, so the selection and the search stay where they were. */
els.openFeeds.addEventListener('click', () => window.location.assign(pageUrl(SETTINGS_PAGE)));
void wireThemeButton(els.theme);

/* Every keypress in the search field rebuilds the whole middle column, so the column is redrawn not on
 * every character but when the reader falls silent for a moment. */
const onSearchInput = debounce(() => {
  state.query = els.headlineSearch.value ?? '';
  applyQuerySelection();
}, 180);
els.headlineSearch.addEventListener('input', onSearchInput);

/* The keyboard cursor of the middle column is held by the column itself, not by its rows: when the focus
 * moves to it, the row that cursor stands on is brought back into view. Otherwise its frame would stay
 * past the edge of the panel, and with it the answer to where the reader stands now. */
els.headlineList.addEventListener('focus', () => {
  els.headlineList.querySelector('.list-item[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
});

/*
 * An age named once is already untrue a minute later: "5 min ago" on the list row and the tooltip of the
 * feed row are drawn once, when the column is rebuilt. Rebuilding the column for this would throw away the
 * reader's place in the list and their cursor (see `showHeadline`), so the tick rewrites the labels
 * themselves: the list row finds its headline by `data-uid`, the feed row its feed by `data-feed-id`, the
 * article panel the headline open now.
 */
function refreshAgedLabels() {
  const all = isAllFeeds();

  for (const li of els.headlineList.querySelectorAll('.list-item[data-uid]')) {
    const meta = li.querySelector('.item-meta');
    if (!meta) continue;
    const item = state.items.find((candidate) => candidate.uid === li.dataset.uid);
    if (!item) continue;
    paintItemMeta(meta, item, all);
  }

  for (const button of els.feedList.querySelectorAll('.list-item button[data-feed-id]')) {
    const feed = state.feeds.find((candidate) => candidate.id === button.dataset.feedId);
    if (!feed) continue;
    const health = feedHealthTitle(feed);
    if (health) button.title = health;
    else button.removeAttribute('title');
  }

  const open = openHeadline();
  const source = open ? els.articleBody.querySelector('.source') : null;
  if (source) paintSource(source, open);

  renderFeedStatus();
}

/*
 * "4 min ago" should stay true while the reader stands open — otherwise the line speaks of the load as it
 * was at the moment the page was last redrawn. Once a minute all the age labels are rewritten together; a
 * tab nobody sees is not woken for this — it catches up on its own once it becomes visible again.
 */
setInterval(() => {
  if (!document.hidden) refreshAgedLabels();
}, 60000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  /* The tab was hidden while the background was writing — re-read the panels now with one `renderAll()`;
   * it refreshes the age of the labels too, so a separate call is not needed. */
  if (pendingStorageRender) {
    pendingStorageRender = false;
    void renderAll();
  } else {
    refreshAgedLabels();
  }
});

/** Whether the key belongs to the field being typed in, not to the reader around it. */
function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    Boolean(target?.isContentEditable)
  );
}


/**
 * Move the cursor of the middle column by one headline — of the same selection and in the same order
 * the column shows them, so a feed, "All feeds" and an active search all step through what is on
 * screen. The row is brought back into view because the keyboard moves the cursor faster than the
 * eye scrolls the list.
 */
function moveHeadline(delta) {
  const visible = visibleItems();
  if (visible.length === 0) return;

  const index = visible.findIndex((item) => item.uid === state.uid);
  // With no headline open yet the first press goes to the top of the list, its opposite to the bottom.
  const next =
    index === -1
      ? delta > 0
        ? 0
        : visible.length - 1
      : Math.max(0, Math.min(visible.length - 1, index + delta));

  showHeadline(visible[next], { followFocus: true });
  els.headlineList.querySelector('.list-item.selected')?.scrollIntoView({ block: 'nearest' });
}

/** The keyboard's stand-in for a click on the article title: the original in a new tab. */
function openOriginal() {
  const item = visibleItems().find((candidate) => candidate.uid === state.uid);
  if (!item?.link) return;
  window.open(item.link, '_blank', 'noopener,noreferrer');
}

/*
 * The keyboard help of the reader — the same list that leads the README, only where the keys are used.
 * `showModal()` puts the dialog over the screen and locks the keyboard cursor inside it; the header and the
 * columns get `aria-hidden` for that time, so Tab cannot leave the dialog and stay on an element hidden
 * under it. `aria-hidden` is taken off on the `close` event, that is, by any way the dialog ends: `Esc`,
 * the cross, a click on the background, or the very same `?` key.
 */
function openKeysHelp() {
  if (els.keysHelp.open) return;
  els.keysHelp.showModal();
  els.header.setAttribute('aria-hidden', 'true');
  els.panels.setAttribute('aria-hidden', 'true');
}

function closeKeysHelp() {
  if (!els.keysHelp.open) return;
  els.keysHelp.close();
}

/*
 * The keys of the reader. They are held back while a field is being typed in — the search field holds
 * the same letters — and never taken from Ctrl/Meta/Alt, which are the browser's own. A letter answers
 * to its place on the keyboard as well as to what the current layout prints (see `readerKeys`), so the
 * list of the keys is the same over any layout.
 *   /        focus the search field
 *   ↓ / j    next headline          ↑ / k  previous headline
 *   Enter    open the original of the open headline
 *   f        pull the full text of the open headline from its page
 *   r        re-read the selected feed ("All feeds" — every feed)
 *   m        mark the open headline read, or take the mark back
 *   d        delete the open headline
 *   u        take the last delete back, while its window stands
 *   Esc      the same take-back; in the search field — empty the field, while the cursor stands where it was
 *   ?        the list of these keys, in the reader itself
 */
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  /* While the help stands open the dialog takes the keyboard for itself: `?` and `Esc` belong to it, and a
   * headline must not be deleted or opened through the very list that explains how it is done. */
  if (els.keysHelp.open) {
    if (event.key === '?' || event.key === 'Escape') {
      event.preventDefault();
      closeKeysHelp();
    }
    return;
  }

  if (event.key === 'Escape' && event.target === els.headlineSearch) {
    els.headlineSearch.value = '';
    state.query = '';
    applyQuerySelection();
    return;
  }

  /* From the search field the arrows read the list below it: the field keeps what was typed, and the
   * cursor goes to the headlines it filters. */
  if (event.target === els.headlineSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    moveHeadline(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }

  /* The undo window gives way to the search field: there `Esc` belongs to what was typed. Outside a field
   * it means "take it back" and returns the headline deleted just now. */
  if (state.undo && event.key === 'Escape' && !isTypingTarget(event.target)) {
    event.preventDefault();
    void undoDelete();
    return;
  }

  if (isTypingTarget(event.target)) return;

  /* Of the names the pressed key carries, the reader acts on the one it knows: the layout's print comes
   * first, so the key answers also where the layout prints another letter. */
  for (const key of readerKeys(event)) {
    switch (key) {
      case '/':
        event.preventDefault();
        // While there are no feeds there is no search field in the middle column: `/` must not lead the
        // focus into a hidden field.
        if (els.headlineSearch.hidden) break;
        els.headlineSearch.focus();
        els.headlineSearch.select();
        return;
      case 'ArrowDown':
      case 'j':
        event.preventDefault();
        moveHeadline(1);
        return;
      case 'ArrowUp':
      case 'k':
        event.preventDefault();
        moveHeadline(-1);
        return;
      case 'Enter':
        if (!state.uid) break;
        event.preventDefault();
        openOriginal();
        return;
      case 'f':
        if (!state.uid) break;
        event.preventDefault();
        void loadArticleText();
        return;
      case 'm':
        if (!state.uid) break;
        event.preventDefault();
        void toggleHeadlineRead();
        return;
      case 'd':
        if (!state.uid) break;
        event.preventDefault();
        void deleteItem();
        return;
      case 'u':
        if (!state.undo) break;
        event.preventDefault();
        void undoDelete();
        return;
      case 'r':
        event.preventDefault();
        void reloadSelection();
        return;
      case '?':
        event.preventDefault();
        openKeysHelp();
        return;
      default:
        break;
    }
  }
});

async function init() {
  // The stored language wins; on first run there is none and the browser language is used.
  adoptLanguage(await store.getLanguage());
  applyI18n();

  // The sizes the columns had when the reader was last closed; `font-boot.js` has already painted
  // them from its cache, so this only confirms them against storage.
  await loadFontScales();

  // The same for the widths: `columns-boot.js` has painted them, storage confirms them.
  await loadColumnWidths();

  // The same for the arrangement of the panels: `layout-boot.js` has put its cached choice on
  // `.panels`, storage confirms it.
  await loadLayout();

  restoreSelection();
  /*
   * An arrangement with no feeds column has nowhere to choose a single feed in, so its list is always
   * the headlines of every feed. The choice is forced after the tab's selection is restored and not
   * through `chooseFeed()`: the headline the tab was left on keeps its place when it is still there.
   */
  if (!showsFeedsPanel()) state.feedId = ALL_FEEDS_ID;

  // Expired headlines should not linger in an open reader.
  await store.cleanup();
  // Ask the worker to re-sync the per-feed timers and the badge count after this read.
  try {
    await chrome.runtime.sendMessage({ type: MSG_FEEDS_CHANGED });
  } catch {
    // The worker might be asleep; its own alarm sweep covers it.
  }
  const lostHeadline = await renderAll();

  // renderAll() has already dropped a feed or a headline that no longer exists. With nothing
  // left selected the cursor goes to the top of the left column: "All feeds", taken through
  // chooseFeed() to the newest headline of all of them.
  if (!isAllFeeds() && !selectedFeed() && state.feeds.length > 0) {
    chooseFeed(ALL_FEEDS_ID);
    return;
  }

  // A headline that survived the cleanup keeps its place; otherwise the top of the list opens.
  const item =
    (state.uid
      ? state.items.find((candidate) => candidate.uid === state.uid && inSelection(candidate))
      : null) ??
    visibleItems()[0] ??
    null;

  if (item) {
    showHeadline(item);
  } else if (state.feedId && !lostHeadline) {
    // Nothing to open at all: the selection stands, its panel says so — or it says that the search
    // left no headline behind, because `restoreSelection()` has put back whatever was typed.
    sayEmpty(queryActive() ? t('reader.headlines.emptySearch') : t('reader.placeholder.inMiddle'));
  }
}

void init();
