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
import { feedNextCheckAt, formatSince, formatUntil, humanDuration, itemTime } from './lib/util.js';

/* Synchronous first pass: the cached language (or the browser language) is known before
 * `chrome.storage` resolves, so nothing here has to wait for the async read below. */
applyI18n();

const els = {
  totalCount: document.getElementById('total-count'),
  theme: document.getElementById('btn-theme'),
  refresh: document.getElementById('btn-refresh'),
  load: document.getElementById('btn-load'),
  clear: document.getElementById('btn-clear'),

  feedList: document.getElementById('feed-list'),
  feedsEmpty: document.getElementById('feeds-empty'),

  headlinesTitle: document.getElementById('headlines-title'),
  headlinesCount: document.getElementById('headlines-count'),
  feedStatus: document.getElementById('feed-status'),
  headlineSearch: document.getElementById('headline-search'),
  headlineList: document.getElementById('headline-list'),
  headlinesEmpty: document.getElementById('headlines-empty'),

  announce: document.getElementById('reader-announce'),

  contentDelete: document.getElementById('content-delete'),
  contentBody: document.getElementById('content-body'),
};

const state = {
  feeds: [],
  items: [],
  feedId: null,
  uid: null,
  query: '',
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
 * Заголовки выбранного пункта левой колонки — в том же порядке, что в средней панели (свежие
 * сверху). «Все ленты» — это `state.items`, которые `renderAll()` уже отсортировал по дате.
 * Поиск сузает этот список, но не меняет его порядок.
 */
function itemsOfSelectedFeed() {
  if (!state.feedId) return [];
  return state.items.filter(inSelection).filter(matchesQuery);
}

/*
 * Чем закончилась загрузка: сколько заголовков пришло и сколько лент отказалось. Ответ за одну ленту
 * и за все — одной формы: `added` в ответе или в каждой строке `results`, `failed` — их число.
 */
function refreshOutcome(response) {
  if (!response?.ok) return t('reader.announce.error', { error: describeError(response?.error) });

  const results = response.results ?? [response];
  const added = results.reduce((sum, entry) => sum + (Number(entry.added) || 0), 0);
  const failed = Number(response.failed) || results.filter((entry) => entry.ok === false).length;

  const parts = [added > 0 ? t('reader.announce.loaded', { count: added }) : t('reader.announce.none')];
  if (failed > 0) parts.push(t('reader.announce.failed', { count: failed }));
  return parts.join(' · ');
}

function renderTotal() {
  els.totalCount.textContent = String(state.items.length);
}

/**
 * Что читалка говорит вслух, когда панель перерисовывается: строка `role="status"` (см. `index.html`)
 * нигде не рисуется — её только читает экран, и та же правда стоит в самих панелях. Пустая строка
 * не говорит ничего: так перезагрузка от `chrome.storage.onChanged` не пересказывает вслух то, о чём
 * уже сказал щелчок мыши или клавиша.
 */
function announce(message) {
  if (!message) return;
  /* Одни и те же слова подряд — не то изменение, о котором экран сообщит: строка сначала пустеет,
   * а наполняется следующим тиком, поэтому «получено 5» звучит и когда ленту обновили дважды. */
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
  button.addEventListener('click', () => selectFeed(ALL_FEEDS_ID));
  li.append(button);
  els.feedList.append(li);
}

/**
 * Подсказка строки ленты: когда её читали в последний раз и чем закончилась эта попытка. Отказ
 * подписывается на языке страницы тем же `describeError`, что и ошибка загрузки в средней панели,
 * поэтому код отказа не остаётся сырым ключом словаря.
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

  /* Когда ленту спросят снова. Будильник стоит своего расписания, а пауза после отказа только
   * пропуска́ет попытку (см. `background.js`), поэтому во время паузы говорят о её сроке,
   * а вне её — о сроке, который называет сам будильник. */
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

function renderFeeds() {
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
    // Строка левой колонки выбирает ленту: `aria-current` говорит экрану, какая из них выбрана, —
    // то же самое, что цвет выделения говорит глаз.
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

    /* Лента, которую не удаётся прочесть, не должна выглядеть обычной строкой: значок отказа стоит
     * рядом с её названием, счётчик отказов — под названием, а подробности — в подсказке строки. */
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
    button.addEventListener('click', () => selectFeed(feed.id));
    li.append(button);
    els.feedList.append(li);
  }
}

/**
 * Строка под головой средней панели: что читалка знает о загрузке того, что она показывает.
 * «Заголовки получены 4 мин назад» отвечает на «почему новости не пришли» без console воркера,
 * а рядом называет, когда их спросят сами: у одной ленты — её будильник, у «всех лент» — самый
 * ранний из будильников всех.
 *
 * Возраст заголовков и возраст проверки — разные вещи: ответ 304 ничего не приносит, поэтому он
 * не двигает момент, когда их получили. Именно это и стоит знать: спрашивали недавно, на сервере
 * с тех пор ничего нет.
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

  els.feedStatus.hidden = parts.length === 0;
  els.feedStatus.textContent = parts.join(' · ');
}

function renderHeadlines() {
  els.headlineList.replaceChildren();

  const all = isAllFeeds();
  const feed = all ? null : selectedFeed();
  els.headlinesTitle.textContent = all
    ? t('reader.feeds.all')
    : feed?.name ?? t('reader.headlines.title');

  const items = itemsOfSelectedFeed();
  const searching = queryActive();
  els.headlinesCount.textContent = items.length ? `${items.length}` : '';
  els.headlinesEmpty.hidden = items.length > 0;
  els.headlinesEmpty.textContent = searching
    ? t('reader.headlines.emptySearch')
    : all
      ? t('reader.headlines.emptyAllFeeds')
      : feed
        ? t('reader.headlines.emptyForFeed')
        : t('reader.headlines.emptyNoFeed');

  // The load/clear buttons sit in this head and act on this very selection, so their tooltip names
  // exactly what they now cover: a single feed, or every feed when «Все ленты» is picked.
  els.load.title = t(all ? 'reader.refreshAll.tooltip' : 'reader.refresh.tooltip');
  els.load.setAttribute('aria-label', t(all ? 'reader.refreshAll.aria' : 'reader.refresh.aria'));
  els.clear.title = t(all ? 'reader.clearAll.tooltip' : 'reader.clearFeed.tooltip');
  els.clear.setAttribute('aria-label', t(all ? 'reader.clearAll.aria' : 'reader.clearFeed.aria'));

  // The line under this head speaks about the same selection as these two buttons.
  renderFeedStatus();

  for (const item of items) {
    const li = document.createElement('li');
    // Средняя колонка — `listbox` (см. `index.html`), поэтому её строка — `option`, а открытая
    // новость — та, что `aria-selected`; без этого экран назвал бы список списком кнопок.
    li.setAttribute('role', 'option');
    const selected = item.uid === state.uid;
    li.setAttribute('aria-selected', selected ? 'true' : 'false');
    li.className = `list-item${selected ? ' selected' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    // Only «Все ленты» needs a feed to stand beside the headline, so only there does the headline
    // carry its feed's icon; a single feed's list names that feed in the panel title instead.
    if (all) button.append(feedIconImg(item.feedId));

    const body = document.createElement('span');
    body.className = 'item-body';
    const title = document.createElement('span');
    title.className = 'item-title';
    // A headline the feed gave no title is labelled here, in the reader's language.
    title.textContent = item.title || t('common.untitled');

    const meta = document.createElement('span');
    meta.className = 'item-meta muted';
    // In «Все ленты» the meta line names the feed the headline came from; a single feed's list
    // needs no such tag.
    const when = itemTime(item);
    meta.textContent = [
      all ? item.feedName || item.rss_link : '',
      when ? t('reader.published', { since: formatSince(when, Date.now(), unitLabels()) }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    body.append(title, meta);
    button.append(body);
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
  else showPlaceholder(queryActive() ? t('reader.headlines.emptySearch') : t('reader.placeholder.inMiddle'));

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

/**
 * Поиск меняет среднюю колонку, а с ней и открытый заголовок: он остаётся тем же, пока его видно,
 * иначе переходит на первый из тех, что остались, а когда не осталось ничего — правая панель
 * говорит об этом вместо статьи.
 */
function applyQuerySelection() {
  const visible = itemsOfSelectedFeed();

  if (visible.length === 0) {
    showPlaceholder(queryActive() ? t('reader.headlines.emptySearch') : t('reader.placeholder.inMiddle'));
    renderHeadlines();
    saveSelection();
    return;
  }

  const current = visible.find((item) => item.uid === state.uid);
  openItem(current ?? visible[0]);
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

/**
 * Requirement: clicking a title shows the stored `<description>` in the right panel.
 * `followFocus` is set only where the keyboard moves the cursor: the row of the middle column takes
 * the focus, so its name is read out and the next arrow continues from the row that is now open.
 */
function openItem(item, { followFocus = false } = {}) {
  state.uid = item.uid;
  saveSelection();
  renderHeadlines();
  if (followFocus) els.headlineList.querySelector('.list-item.selected > button')?.focus();

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

  const all = isAllFeeds();
  const position = itemsOfSelectedFeed().findIndex((item) => item.uid === state.uid);

  const uid = state.uid;
  await store.removeItem(uid);
  state.uid = null;
  saveSelection();
  await renderAll();
  announce(t('reader.announce.deleted'));

  // «Все ленты» keeps the whole list: the next headline is the one that stood below the removed
  // one, whatever feed it belongs to. The search field filters that list exactly as it filters the
  // middle column, so the cursor lands on the next headline the reader can actually see.
  const remaining = itemsOfSelectedFeed();
  if (remaining.length === 0) {
    showPlaceholder(
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
  openItem(next, { followFocus: true });
}

/**
 * The trash icon beside the middle panel's title: it removes from storage the headlines the left
 * column has selected — one feed's headlines, or (with «Все ленты») every headline. They are
 * remembered as read so the next feed read does not hand them straight back. The storage write also
 * makes the background worker refresh the badge, and this page's storage.onChanged listener repaints
 * the panels, so no extra bookkeeping is needed.
 */
async function clearSelectionHeadlines() {
  const targets = itemsOfSelectedFeed();
  if (targets.length === 0) return;

  els.clear.disabled = true;
  try {
    if (isAllFeeds()) await store.clearAllItems();
    else await store.clearItemsForFeed(state.feedId);
    await renderAll();
    announce(t('reader.announce.cleared', { count: targets.length }));
  } finally {
    els.clear.disabled = false;
  }
}

/**
 * The load icon beside the middle panel's title: it reads the headlines of whatever the left column
 * has selected — a single feed, or (with «Все ленты») every feed of the list at once.
 */
async function refreshSelection() {
  if (isAllFeeds()) {
    await refreshAllFeeds(els.load);
    return;
  }

  const feed = selectedFeed();
  if (!feed) {
    showPlaceholder(t('reader.refresh.noFeed'));
    return;
  }

  const tip = els.load.title;
  els.load.disabled = true;
  els.load.classList.add('busy');
  els.load.title = t('common.loading');
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG_REFRESH_FEED, feedId: feed.id });
    if (!response?.ok) {
      showPlaceholder(t('reader.refresh.failed', { error: describeError(response?.error) }));
    }
    await renderAll();
    announce(refreshOutcome(response));
  } finally {
    els.load.disabled = false;
    els.load.classList.remove('busy');
    els.load.title = tip;
  }
}

async function refreshSelectedFeed() {
  // «Все ленты» is a selection too: reading it means reading every feed, as the middle button does.
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
    announce(refreshOutcome(response));
  } finally {
    els.refresh.disabled = false;
    els.refresh.classList.remove('busy');
    els.refresh.title = tip;
  }
}

/**
 * Read every feed at once. `target` is the button that asked for it — the load icon in the middle
 * panel head or the refresh icon in the feeds panel — so the button that was pressed is the one that
 * spins and stays disabled while the worker fetches the feeds one after another. A feed that failed
 * keeps its stored headlines, so a partial failure is a notice rather than an empty screen.
 */
async function refreshAllFeeds(target = els.refresh) {
  if (state.feeds.length === 0) {
    showPlaceholder(t('reader.feeds.empty'));
    return;
  }

  const tip = target.title;
  target.disabled = true;
  target.classList.add('busy');
  target.title = t('common.loading');
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG_REFRESH_ALL_FEEDS });
    if (!response?.ok) {
      showPlaceholder(t('reader.refresh.failed', { error: describeError(response?.error) }));
    } else if (response.failed > 0) {
      const failure = (response.results ?? []).find((entry) => !entry.ok);
      showPlaceholder(t('reader.refreshAll.failed', { error: describeError(failure?.error) }));
    }
    await renderAll();
    announce(refreshOutcome(response));
  } finally {
    target.disabled = false;
    target.classList.remove('busy');
    target.title = tip;
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
els.load.addEventListener('click', () => void refreshSelection());
els.clear.addEventListener('click', () => void clearSelectionHeadlines());
els.contentDelete.addEventListener('click', () => void deleteItem());
void wireThemeButton(els.theme);

els.headlineSearch.addEventListener('input', () => {
  state.query = els.headlineSearch.value ?? '';
  applyQuerySelection();
});

/*
 * «4 мин назад» должно оставаться правдой, пока читалка стоит открытой, — иначе строка говорит о
 * загрузке, какой она была в момент, когда страницу последний раз перерисовывали. Раз в минуту её
 * перечёркивают заново; вкладку, которой никто не видит, для этого не будят — она догонит сама,
 * когда снова станет видимой.
 */
setInterval(() => {
  if (!document.hidden) renderFeedStatus();
}, 60000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderFeedStatus();
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
 * the column shows them, so a feed, «Все ленты» and an active search all step through what is on
 * screen. The row is brought back into view because the keyboard moves the cursor faster than the
 * eye scrolls the list.
 */
function moveHeadline(delta) {
  const visible = itemsOfSelectedFeed();
  if (visible.length === 0) return;

  const index = visible.findIndex((item) => item.uid === state.uid);
  // With no headline open yet the first press goes to the top of the list, its opposite to the bottom.
  const next =
    index === -1
      ? delta > 0
        ? 0
        : visible.length - 1
      : Math.max(0, Math.min(visible.length - 1, index + delta));

  openItem(visible[next], { followFocus: true });
  els.headlineList.querySelector('.list-item.selected')?.scrollIntoView({ block: 'nearest' });
}

/** The keyboard's stand-in for a click on the article title: the original in a new tab. */
function openOriginal() {
  const item = itemsOfSelectedFeed().find((candidate) => candidate.uid === state.uid);
  if (!item?.link) return;
  window.open(item.link, '_blank', 'noopener,noreferrer');
}

/*
 * The keys of the reader. They are held back while a field is being typed in — the search field holds
 * the same letters — and never taken from Ctrl/Meta/Alt, which are the browser's own.
 *   /        focus the search field
 *   ↓ / j    next headline          ↑ / k  previous headline
 *   Enter    open the original of the open headline
 *   r        re-read the selected feed («Все ленты» — every feed)
 *   d        delete the open headline
 *   Esc      empty the search field, while the cursor stands where it was
 */
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

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

  if (isTypingTarget(event.target)) return;

  switch (event.key) {
    case '/':
      event.preventDefault();
      els.headlineSearch.focus();
      els.headlineSearch.select();
      break;
    case 'ArrowDown':
    case 'j':
      event.preventDefault();
      moveHeadline(1);
      break;
    case 'ArrowUp':
    case 'k':
      event.preventDefault();
      moveHeadline(-1);
      break;
    case 'Enter':
      if (!state.uid) break;
      event.preventDefault();
      openOriginal();
      break;
    case 'd':
      if (!state.uid) break;
      event.preventDefault();
      void deleteItem();
      break;
    case 'r':
      event.preventDefault();
      void refreshSelectedFeed();
      break;
    default:
      break;
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
    // Nothing to open at all: the selection stands, its panel says so — or it says that the search
    // left no headline behind, because `restoreSelection()` has put back whatever was typed.
    showPlaceholder(queryActive() ? t('reader.headlines.emptySearch') : t('reader.placeholder.inMiddle'));
  }
}

void init();
