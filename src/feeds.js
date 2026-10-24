// Configuration screen: add / edit / delete feeds and their timeouts, as rows of one table.

import { describeError } from './lib/errors.js';
import { discoverFeedIcon } from './lib/favicon.js';
import { adoptLanguage, applyI18n, currentLanguage, t, unitLabels } from './lib/i18n.js';
import { MSG_FEEDS_CHANGED, MSG_REFRESH_FEED } from './lib/messages.js';
import { mountNav } from './lib/nav.js';
import * as storage from './lib/storage.js';
import { wireThemeButton } from './lib/theme.js';
import { formatSince, formatUntil, humanDuration, newId, normalizeFeed } from './lib/util.js';

/* Synchronous first pass: the cached language (or the browser language) is known before
 * `chrome.storage` resolves, so the markup below is not left in Russian while we wait. */
applyI18n();

const els = {
  rows: document.getElementById('feed-rows'),
  empty: document.getElementById('feeds-empty'),
  add: document.getElementById('btn-add'),
  export: document.getElementById('btn-export'),
  import: document.getElementById('btn-import'),
  importFile: document.getElementById('file-import'),
  transfer: document.getElementById('transfer-status'),
  announce: document.getElementById('feeds-announce'),
  theme: document.getElementById('btn-theme'),
};

const state = {
  feeds: [],
  /** Rows the user is filling in but has not saved yet. */
  drafts: new Set(),
};

/**
 * Records of the rows the table holds right now — rebuilt by `render()`. The age of a feed's
 * diagnosis is redrawn from them without rebuilding the table (see `refreshHealthLines`).
 */
let liveRows = [];

/** `<td>` of a text column: the input and the error line under it. */
function textCell(value, { label }) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value ?? '';
  // The caption of the column is this cell's header, but a `<td>` is not a `<label>` and a table
  // gives an input no name of its own, so the input carries the caption itself.
  input.setAttribute('aria-label', label);

  const error = document.createElement('div');
  error.className = 'error';

  const cell = document.createElement('td');
  // On a narrow screen the columns collapse and every cell names the field it holds.
  cell.dataset.column = label;
  cell.append(input, error);
  return { cell, input, error };
}

/** `<td>` of a minutes column: the number being edited plus its human reading, which follows it. */
function minutesCell(value, { label, labels }) {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = value ?? '';
  input.min = '1';
  input.step = '1';
  input.setAttribute('aria-label', label);

  const duration = document.createElement('span');
  duration.className = 'duration muted';
  const showDuration = () => {
    duration.textContent = humanDuration(input.value, labels);
  };
  input.addEventListener('input', showDuration);
  showDuration();

  const minutes = document.createElement('div');
  minutes.className = 'minutes';
  minutes.append(input, duration);

  const error = document.createElement('div');
  error.className = 'error';

  const cell = document.createElement('td');
  cell.className = 'col-minutes';
  cell.dataset.column = label;
  cell.append(minutes, error);
  return { cell, input, error };
}

/** An action of a row: the glyph says what it does, its tooltip and its name repeat it. */
function actionButton(icon, caption, { danger = false, disabled = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = danger ? 'icon-btn danger' : 'icon-btn';
  button.title = caption;
  button.setAttribute('aria-label', caption);
  button.disabled = disabled;
  button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-${icon}"></use></svg>`;
  return button;
}

/**
 * What the settings screen knows about the last attempt to read a feed: when it was read, when the
 * next one is, and — if the feed is broken right now — why, how many failures in a row and when it
 * will be tried again. The failure is labeled with the same `describeError` as a load error, so a
 * failure code does not stay a raw dictionary key.
 */
function feedHealthLine(feed, now = Date.now(), labels = unitLabels()) {
  const parts = [];

  const checkedAt = Number(feed.lastCheckedAt);
  if (Number.isFinite(checkedAt) && checkedAt > 0) {
    parts.push(t('feeds.health.checked', { since: formatSince(checkedAt, now, labels) }));
  }

  const nextAt = Number(feed.nextAlarmAt);
  if (Number.isFinite(nextAt) && nextAt > 0) {
    parts.push(t('feeds.health.next', { until: formatUntil(nextAt, now, labels) }));
  }

  const failures = Number(feed.fetchFailureCount) || 0;
  if (failures > 0 && feed.lastErrorAt) {
    const error = describeError({
      code: feed.lastErrorCode,
      params: feed.lastErrorParams,
      message: feed.lastErrorMessage || undefined,
    });
    parts.push(t('feeds.health.error', { error }));
    parts.push(t('feeds.health.streak', { count: failures }));
  }

  /* A failure assigns a pause that grows with every fault: the feed's alarm stays its own, but an
   * attempt during the pause is skipped (`background.js`), so the line names exactly its deadline. */
  const retryAt = Number(feed.nextRetryAt);
  if (retryAt > now) {
    parts.push(t('feeds.health.pause', { until: formatUntil(retryAt, now, labels) }));
  }

  return parts.join(' · ');
}

/**
 * Build one editable row of the feed table. `feed` may be a draft (no id yet).
 */
function buildRow(feed, { draft }) {
  const labels = unitLabels();

  const row = document.createElement('tr');
  row.className = draft ? 'feed-row draft' : 'feed-row';

  const name = textCell(feed.name, { label: t('feeds.field.name') });
  const rssLink = textCell(feed.rss_link, { label: t('feeds.field.rss') });
  const delay = minutesCell(feed.delay_timeout, {
    label: t('feeds.field.delay'),
    labels,
  });
  const clean = minutesCell(feed.clean_timeout, {
    label: t('feeds.field.clean'),
    labels,
  });

  const actions = document.createElement('td');
  actions.className = 'col-actions';

  const save = actionButton('save', draft ? t('feeds.addCard') : t('feeds.save'));
  const refresh = actionButton('refresh', t('feeds.loadNow'), { disabled: draft });
  const remove = actionButton('trash', draft ? t('feeds.cancel') : t('feeds.delete'), {
    danger: true,
  });
  actions.append(save, refresh, remove);

  row.append(name.cell, rssLink.cell, delay.cell, clean.cell, actions);

  /* A row of the table holds only the fields, so a message about the row as a whole — what a load
   * returned, "Saved", "Check the fields", what a draft still waits for — gets its own line under
   * the row, as wide as the table. */
  const noteRow = document.createElement('tr');
  noteRow.className = draft ? 'row-note draft' : 'row-note';
  noteRow.hidden = !draft;

  const noteCell = document.createElement('td');
  noteCell.colSpan = 5;

  /* A feed's health is its own line under it, a permanent one: when it was read, what came of this
   * attempt and when the next one is. It lives apart from `status`, which a transient answer of the
   * "Load now" button is written into, so the diagnosis does not vanish as soon as the load message
   * ends. */
  const health = document.createElement('div');
  health.className = 'feed-health muted';
  const healthLine = draft ? '' : feedHealthLine(feed);
  health.textContent = healthLine;

  const status = document.createElement('span');
  status.className = 'status';
  if (draft) status.textContent = t('feeds.draftNote');

  noteCell.append(health, status);
  noteRow.append(noteCell);
  if (healthLine) noteRow.hidden = false;

  const rowRecord = {
    feed,
    draft,
    row,
    noteRow,
    status,
    health,
    inputs: {
      name: name.input,
      rss_link: rssLink.input,
      delay_timeout: delay.input,
      clean_timeout: clean.input,
    },
    errors: {
      name: name.error,
      rss_link: rssLink.error,
      delay_timeout: delay.error,
      clean_timeout: clean.error,
    },
  };

  save.addEventListener('click', () => void saveRow(rowRecord));
  remove.addEventListener('click', () => void removeRow(rowRecord));
  refresh.addEventListener('click', () => void refreshRow(rowRecord));

  return { record: rowRecord, note: noteRow };
}

/**
 * What the screen announces aloud: the same words it writes under a row or under the table, but read
 * out by a screen reader. A live status answers to a change of text, so the same message from two
 * buttons in a row is cleared and set anew — otherwise the second "Saved" would be silence. An empty
 * line is silent: a row redrawn because storage changed on another screen does not count as a story.
 */
function announce(message) {
  if (!message) return;
  els.announce.textContent = '';
  setTimeout(() => {
    els.announce.textContent = message;
  }, 50);
}

function setStatus(rowRecord, message, kind = '') {
  rowRecord.status.textContent = message;
  rowRecord.status.className = kind ? `status ${kind}` : 'status';
  rowRecord.noteRow.hidden = false;
  announce(message);
}

function showFieldErrors(rowRecord, errors) {
  for (const [key, error] of Object.entries(rowRecord.errors)) {
    error.textContent = errors[key] ?? '';
  }
}

function readRow(rowRecord) {
  return {
    id: rowRecord.feed.id,
    name: rowRecord.inputs.name.value,
    rss_link: rowRecord.inputs.rss_link.value,
    delay_timeout: rowRecord.inputs.delay_timeout.value,
    clean_timeout: rowRecord.inputs.clean_timeout.value,
  };
}

async function saveRow(rowRecord) {
  const values = readRow(rowRecord);
  const { feed, errors } = normalizeFeed(values, {
    name: t('feeds.error.name'),
    nameTooLong: t('feeds.error.nameTooLong'),
    rss_link: t('feeds.error.link'),
    delay_timeout: t('feeds.error.delay'),
    clean_timeout: t('feeds.error.clean'),
  });
  showFieldErrors(rowRecord, errors);

  if (Object.keys(errors).length > 0) {
    setStatus(rowRecord, t('feeds.status.checkFields'), 'error');
    return;
  }

  feed.id = rowRecord.feed.id ?? newId();

  /* The first row of an empty table: the reader has not shown a single one of its feeds yet. That
   * must be asked before the write — after it the table is no longer empty, and the first row cannot
   * be told from the second. */
  const firstFeed = (await storage.getFeeds()).length === 0 && !(await storage.getFirstFeedDone());

  await storage.upsertFeed(feed);

  /*
   * Reading the site icon is a request of its own, kept out of the save's way: the feed is saved and
   * its headlines load whether or not the icon read finishes, and the reader takes the icon from the
   * storage write `attachFeedIcon` makes (see `lib/favicon.js`).
   */
  void attachFeedIcon(feed.id, feed.rss_link, rowRecord.feed);

  if (rowRecord.draft) state.drafts.delete(rowRecord.feed);
  setStatus(rowRecord, t('feeds.status.saved'), 'ok');

  await notifyBackground();

  // Re-fetch the new/edited feed right away so the reader is not left empty.
  const loaded = await refreshRow({ ...rowRecord, feed, draft: false });
  await render();

  /*
   * The first added row gets a confirmation for the whole table, not a row note: `render()` has just
   * rebuilt the rows and their notes, and the story here is that the reader has something to show.
   * The line speaks of headlines only when they really came: a feed that could not read the server
   * names its failure in the row's note, and repeating it under the table is pointless. The mark
   * stays uncleared so the confirmation comes out once — at the first successful add.
   */
  if (firstFeed && loaded?.ok && !loaded.busy) {
    await storage.setFirstFeedDone();
    sayTransfer(t('feeds.status.firstFeed'), 'ok');
  }
}

/**
 * Read the icon of the site the feed points at and store a link to it on the feed (`lib/favicon.js`).
 * A fresh icon is written only when it differs from the one already stored, so re-saving a feed that
 * already has its icon does not rewrite storage for nothing. A read that names no icon keeps the
 * feed's old one when the link is unchanged (the read simply failed) and drops it when the link moved
 * to a site that could not be read — a foreign icon is not kept for a feed that is no longer there.
 */
async function attachFeedIcon(feedId, newLink, previousFeed) {
  const previousIcon = previousFeed?.icon ?? null;
  const sameLink = Boolean(previousFeed) && previousFeed.rss_link === newLink;

  let iconUrl = null;
  try {
    iconUrl = await discoverFeedIcon(newLink);
    if (iconUrl) {
      if (iconUrl !== previousIcon) await storage.upsertFeed({ id: feedId, icon: iconUrl });
      return;
    }
    if (previousIcon && !sameLink) await storage.upsertFeed({ id: feedId, icon: null });
  } catch (error) {
    console.warn(`could not store the icon for feed ${feedId}:`, error?.message ?? error);
  }
}

async function removeRow(rowRecord) {
  if (!rowRecord.draft) {
    const name = rowRecord.feed.name || rowRecord.feed.rss_link;
    if (!window.confirm(t('feeds.confirmDelete', { name }))) return;
    await storage.deleteFeed(rowRecord.feed.id);
  }
  state.drafts.delete(rowRecord.feed);
  await notifyBackground();
  await render();
}

async function refreshRow(rowRecord) {
  if (!rowRecord.feed.id) return null;
  setStatus(rowRecord, t('common.loading'));
  let response = null;
  try {
    response = await chrome.runtime.sendMessage({
      type: MSG_REFRESH_FEED,
      feedId: rowRecord.feed.id,
    });
    if (response?.ok) {
      if (response.busy) {
        /* Another context is reading the feed: this request did not start its read and therefore has
         * no numbers of its own. The same address was not asked a second time, and the line honestly
         * says the feed is loading. */
        setStatus(rowRecord, t('common.loading'));
      } else if (response.notModified) {
        /* The server answered with an empty 304: the feed is exactly the one already in storage.
         * "read: 0" would look like an empty feed, so the line says straight out that nothing
         * changed. */
        setStatus(rowRecord, t('feeds.resultUnchanged'));
      } else {
        setStatus(
          rowRecord,
          t('feeds.result', {
            added: response.added,
            seen: response.seen,
            read:
              response.skipped > 0 ? t('feeds.resultRead', { skipped: response.skipped }) : '',
          }),
          response.added > 0 ? 'ok' : '',
        );
      }
    } else {
      setStatus(
        rowRecord,
        response?.error ? describeError(response.error) : t('feeds.status.loadError'),
        'error',
      );
    }
  } catch (error) {
    setStatus(rowRecord, describeError(error), 'error');
    return null;
  } finally {
    /* The load left a fresh feed diagnosis in storage; re-read it so the permanent line under the
     * row shows the attempt that just happened, not the one from when the screen opened. */
    const fresh = await storage.getFeed(rowRecord.feed.id);
    if (rowRecord.health && fresh) {
      /* The same diagnosis is written into the row record itself: without it the next tick
       * (`refreshHealthLines`) would redraw the line from the feed as it was before this load. */
      rowRecord.feed = fresh;
      const line = feedHealthLine(fresh);
      rowRecord.health.textContent = line;
      if (line) rowRecord.noteRow.hidden = false;
    }
  }

  /* The read's answer is needed not only by the row's line: it says that the first feed really
   * brought its headlines (see `saveRow`). */
  return response;
}

/** The worker owns the alarms and the badge: tell it the feeds changed. */
async function notifyBackground() {
  try {
    await chrome.runtime.sendMessage({ type: MSG_FEEDS_CHANGED });
  } catch (error) {
    console.warn('could not tell the background worker about the changes:', error?.message ?? error);
  }
}

async function render() {
  state.feeds = await storage.getFeeds();

  els.rows.replaceChildren();
  const rows = [
    ...state.feeds.map((feed) => buildRow(feed, { draft: false })),
    ...[...state.drafts].map((draft) => buildRow(draft, { draft: true })),
  ];

  /* The rows the screen keeps open: `refreshHealthLines` strikes through the age of the diagnosis
   * along them without rebuilding the table. */
  liveRows = rows.map(({ record }) => record);

  for (const { record, note } of rows) {
    els.rows.append(record.row, note);
  }

  els.empty.hidden = rows.length > 0;
}

els.add.addEventListener('click', () => {
  state.drafts.add(storage.emptyFeed());
  void render();
});

/**
 * A report about moving the whole table. It belongs to no single row, so it takes its own line under
 * the table instead of borrowing a row's note.
 */
function sayTransfer(message, kind = '') {
  els.transfer.textContent = message;
  els.transfer.className = kind ? `transfer-status muted ${kind}` : 'transfer-status muted';
  els.transfer.hidden = false;
  announce(message);
}

/**
 * Write the feed table out to a file: what the user set themselves, without local ids and without a
 * read diagnosis (see `storage.buildFeedsExport`). The address lives exactly as long as the download
 * needs to take the file.
 */
async function exportFeeds() {
  const feeds = await storage.getFeeds();

  if (feeds.length === 0) {
    sayTransfer(t('feeds.export.empty'), 'error');
    return;
  }

  const payload = JSON.stringify(storage.buildFeedsExport(feeds), null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));

  const link = document.createElement('a');
  link.href = url;
  link.download = storage.FEED_EXPORT_FILE_NAME;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  sayTransfer(t('feeds.export.done', { count: feeds.length }), 'ok');
}

/**
 * Read the brought-in file and append its feeds to the ones already configured. Lines that do not
 * pass the same check a table line passes are not saved "by eye": they simply are not added, and
 * their count is named separately — the user sees the file held a broken line.
 */
async function readFeedsFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (error) {
    console.warn('could not read the chosen file:', error?.message ?? error);
    sayTransfer(t('feeds.import.error.json'), 'error');
    return;
  }

  const { feeds, skipped, code } = storage.parseFeedsExport(text);
  if (code) {
    sayTransfer(t(`feeds.import.error.${code}`), 'error');
    return;
  }

  const { added, existing } = await storage.mergeFeeds(feeds);

  const parts = [];
  if (added > 0) parts.push(t('feeds.import.added', { count: added }));
  if (existing > 0) parts.push(t('feeds.import.existing', { count: existing }));
  if (skipped > 0) parts.push(t('feeds.import.invalid', { count: skipped }));

  if (parts.length === 0) sayTransfer(t('feeds.import.none'), 'error');
  else sayTransfer(parts.join(' · '), added > 0 ? 'ok' : '');

  /* A feed without an alarm never reads itself: the worker builds the alarms from storage, so a new
   * row must be reported to it instead of waiting for the next sweep. */
  if (added > 0) await notifyBackground();
  await render();
}

els.export.addEventListener('click', () => void exportFeeds());

els.import.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0] ?? null;
  // The field answers to the same file a second time as a new value only when it is empty.
  els.importFile.value = '';
  if (file) void readFeedsFile(file);
});

// The screen switcher shared by all three screens: it takes over this tab, so the reader the nav
// opens is the tab this screen was reached from.
mountNav();

void wireThemeButton(els.theme);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // A language saved on the settings screen has to reach this page without a reload: adopt it,
  // re-apply the dictionary to the static markup, then rebuild the rows — their captions, units
  // and buttons were built from the old language and do not follow `applyI18n()`.
  const language = changes.settings?.newValue?.language;
  if (language && language !== currentLanguage()) {
    adoptLanguage(language);
    applyI18n();
    void render();
  }
});

// The stored language wins; on first run there is none and the browser language is used.
adoptLanguage(await storage.getLanguage());
applyI18n();

await render();

/*
 * A row's diagnosis line speaks of time: when the feed was read and when it will be asked again. It
 * is drawn together with the row, and the table stands open exactly as long as it is being edited —
 * so once a minute the lines are struck through in place. A tab nobody is looking at is not woken for
 * this: it will catch up on its own once it becomes visible again.
 */
function refreshHealthLines() {
  const now = Date.now();
  const labels = unitLabels();

  for (const record of liveRows) {
    if (record.draft) continue;
    const line = feedHealthLine(record.feed, now, labels);
    if (line === record.health.textContent) continue;
    record.health.textContent = line;
    if (line) record.noteRow.hidden = false;
  }
}

setInterval(() => {
  if (!document.hidden) refreshHealthLines();
}, 60000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshHealthLines();
});
