// Configuration screen: add / edit / delete feeds and their timeouts, as rows of one table.

import { describeError } from './lib/errors.js';
import { discoverFeedIcon } from './lib/favicon.js';
import { adoptLanguage, applyI18n, currentLanguage, t, unitLabels } from './lib/i18n.js';
import { MSG_FEEDS_CHANGED, MSG_REFRESH_FEED } from './lib/messages.js';
import { mountNav } from './lib/nav.js';
import * as store from './lib/storage.js';
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
 * Что экран настроек знает о последней попытке прочесть ленту: когда её читали, когда следующая,
 * и — если лента сейчас сломана — почему, сколько отказов подряд и когда её попробуют снова.
 * Отказ подписывается тем же `describeError`, что и ошибка загрузки, поэтому код отказа не
 * остаётся сырым ключом словаря.
 */
function feedHealthLine(feed) {
  const labels = unitLabels();
  const parts = [];

  const checkedAt = Number(feed.lastCheckedAt);
  if (Number.isFinite(checkedAt) && checkedAt > 0) {
    parts.push(t('feeds.health.checked', { since: formatSince(checkedAt, Date.now(), labels) }));
  }

  const nextAt = Number(feed.nextAlarmAt);
  if (Number.isFinite(nextAt) && nextAt > 0) {
    parts.push(t('feeds.health.next', { until: formatUntil(nextAt, Date.now(), labels) }));
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

  /* Отказ назначает паузу, растущую с каждым сбоем: будильник ленты остаётся своим, но попытка
   * во время паузы пропускается (`background.js`), поэтому строка называет именно её срок. */
  const retryAt = Number(feed.nextRetryAt);
  if (retryAt > Date.now()) {
    parts.push(t('feeds.health.pause', { until: formatUntil(retryAt, Date.now(), labels) }));
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

  /* Здоровье ленты — отдельная строка под ней, постоянная: когда её читали, что вышло из этой
   * попытки и когда следующая. Она живёт отдельно от `status`, куда пишут мимолётный ответ кнопки
   * «Загрузить сейчас», чтобы диагноз не пропал, как только кончилось сообщение о загрузке. */
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
 * Что экран сообщает вслух: те же слова, что пишет глаз под рядом или под таблицей, но прочитанные
 * экраном. Живой статус отвечает на изменение текста, поэтому одно и то же сообщение двух подряд
 * кнопок снимается и ставится заново — иначе вторая «Сохранено» была бы молчанием. Пустая строка
 * молчит: перерисовка ряда из-за изменения хранилища на другом экране рассказом не считается.
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

  /* Первый ряд пустой таблицы: читалка ещё не показывала ни одной своей ленты. Спрашивать о этом
   * нужно до записи — после неё таблица уже не пуста, и отличить первый ряд от второго нельзя. */
  const firstFeed = (await store.getFeeds()).length === 0 && !(await store.getFirstFeedDone());

  await store.upsertFeed(feed);

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
   * Первый добавленный ряд получает подтверждение всей таблицы, а не заметку ряда: `render()` только
   * что перестроил ряды и их заметки, а рассказ здесь о том, что читалке есть что показывать. Строка
   * говорит о заголовках лишь тогда, когда их правда принесли: лента, которой не удалось прочесть
   * сервер, называет свой отказ в заметке ряда, и повторять его под таблицей незачем. Отметка
   * остаётся неснятой, чтобы подтверждение вышло один раз — при первом удачном добавлении.
   */
  if (firstFeed && loaded?.ok && !loaded.busy) {
    await store.setFirstFeedDone();
    setTransferStatus(t('feeds.status.firstFeed'), 'ok');
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
      if (iconUrl !== previousIcon) await store.upsertFeed({ id: feedId, icon: iconUrl });
      return;
    }
    if (previousIcon && !sameLink) await store.upsertFeed({ id: feedId, icon: null });
  } catch (error) {
    console.warn(`could not store the icon for feed ${feedId}:`, error?.message ?? error);
  }
}

async function removeRow(rowRecord) {
  if (!rowRecord.draft) {
    const name = rowRecord.feed.name || rowRecord.feed.rss_link;
    if (!window.confirm(t('feeds.confirmDelete', { name }))) return;
    await store.deleteFeed(rowRecord.feed.id);
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
        /* Ленту читает другой контекст: этот запрос её не начинал и поэтому не имеет своих цифр.
         * Тот же адрес второй раз не спросили, и строка честно говорит, что лента загружается. */
        setStatus(rowRecord, t('common.loading'));
      } else if (response.notModified) {
        /* Сервер ответил пустым 304: лента ровно та, что уже лежит в хранилище. «считано: 0»
         * выглядело бы как пустая лента, поэтому строка говорит прямо, что не изменилось ничего. */
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
    /* Загрузка оставила в хранилище свежий диагноз ленты; перечитаем его, чтобы постоянная строка
     * под рядом показала ту попытку, что только что случилась, а не ту, что была при открытии. */
    const fresh = await store.getFeed(rowRecord.feed.id);
    if (rowRecord.health && fresh) {
      const line = feedHealthLine(fresh);
      rowRecord.health.textContent = line;
      if (line) rowRecord.noteRow.hidden = false;
    }
  }

  /* Ответ чтения нужен не только строке ряда: он говорит, что первая лента действительно принесла
   * свои заголовки (см. `saveRow`). */
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
  state.feeds = await store.getFeeds();

  els.rows.replaceChildren();
  const rows = [
    ...state.feeds.map((feed) => buildRow(feed, { draft: false })),
    ...[...state.drafts].map((draft) => buildRow(draft, { draft: true })),
  ];

  for (const { record, note } of rows) {
    els.rows.append(record.row, note);
  }

  els.empty.hidden = rows.length > 0;
}

els.add.addEventListener('click', () => {
  state.drafts.add(store.emptyFeed());
  void render();
});

/**
 * Отчёт о переносе всей таблицы. Он не относится ни к одной строке, поэтому берёт себе строку под
 * таблицей, а не чужую заметку ряда.
 */
function setTransferStatus(message, kind = '') {
  els.transfer.textContent = message;
  els.transfer.className = kind ? `transfer-status muted ${kind}` : 'transfer-status muted';
  els.transfer.hidden = false;
  announce(message);
}

/**
 * Выписать таблицу лент в файл: то, что пользователь задал сам, без местных идентификаторов и без
 * диагноза чтения (см. `store.buildFeedsExport`). Адрес живёт ровно столько, сколько нужно,
 * чтобы загрузка забрала файл.
 */
async function exportFeeds() {
  const feeds = await store.getFeeds();

  if (feeds.length === 0) {
    setTransferStatus(t('feeds.export.empty'), 'error');
    return;
  }

  const payload = JSON.stringify(store.buildFeedsExport(feeds), null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));

  const link = document.createElement('a');
  link.href = url;
  link.download = store.FEED_EXPORT_FILE_NAME;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  setTransferStatus(t('feeds.export.done', { count: feeds.length }), 'ok');
}

/**
 * Прочитать принесённый файл и дописать его ленты тем, что уже настроены. Строки, которые не
 * прошли ту же проверку, что и строка таблицы, не спасаются «на глаз»: они просто не добавляются,
 * и их количество называется отдельно — пользователь видит, что в файле была кривая строка.
 */
async function importFeeds(file) {
  let text;
  try {
    text = await file.text();
  } catch (error) {
    console.warn('could not read the chosen file:', error?.message ?? error);
    setTransferStatus(t('feeds.import.error.json'), 'error');
    return;
  }

  const { feeds, skipped, code } = store.parseFeedsExport(text);
  if (code) {
    setTransferStatus(t(`feeds.import.error.${code}`), 'error');
    return;
  }

  const { added, existing } = await store.mergeFeeds(feeds);

  const parts = [];
  if (added > 0) parts.push(t('feeds.import.added', { count: added }));
  if (existing > 0) parts.push(t('feeds.import.existing', { count: existing }));
  if (skipped > 0) parts.push(t('feeds.import.invalid', { count: skipped }));

  if (parts.length === 0) setTransferStatus(t('feeds.import.none'), 'error');
  else setTransferStatus(parts.join(' · '), added > 0 ? 'ok' : '');

  /* Лента без будильника сама не читается: worker строит их по хранилищу, поэтому о новом ряду
   * нужно сказать ему, а не ждать ближайшей проверки. */
  if (added > 0) await notifyBackground();
  await render();
}

els.export.addEventListener('click', () => void exportFeeds());

els.import.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0] ?? null;
  // Поле отвечает на тот же файл вторично как на новое значение только когда оно пустое.
  els.importFile.value = '';
  if (file) void importFeeds(file);
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
adoptLanguage(await store.getLanguage());
applyI18n();

await render();
