// Persistent storage for feeds and headlines.
// "localstorage" here is chrome.storage.local: it is the persistent store that is shared by
// the service worker, the reader page and the feeds page (window.localStorage is per-page and
// would not be visible to the background worker).

import {
  DEFAULT_CLEAN_TIMEOUT,
  DEFAULT_DELAY_TIMEOUT,
  DEFAULT_SOUND_VOLUME,
  MAX_ITEMS_PER_FEED,
  MAX_READ_RECORDS,
  READ_TTL_DAYS,
  capPreview,
  isExpired,
  isReadExpired,
  itemTime,
  normalizePreviewImages,
  normalizeUid,
  readTime,
  toDays,
  toFlag,
  toVolume,
} from './util.js';
import {
  FALLBACK_LANGUAGE,
  detectBrowserLanguage,
  normalizeLanguage,
  setLanguageCache,
} from './i18n.js';

export const FEEDS_KEY = 'feeds';
export const ITEMS_KEY = 'items';
export const READ_KEY = 'read';
export const SETTINGS_KEY = 'settings';
export const THEME_KEY = 'theme';
export const READ_TTL_KEY = 'read_ttl_days';
export const SOUND_KEY = 'sound';
export const SOUND_FILE_KEY = 'sound_file';
export const SOUND_VOLUME_KEY = 'sound_volume';
export const SHOW_MESSAGE_KEY = 'show_message';
export const LANGUAGE_KEY = 'language';
export const FONT_SCALES_KEY = 'font_scales';
export const COLUMN_WIDTHS_KEY = 'column_widths';

/** «Без звука»: автоматическая загрузка остаётся без сигнала. */
export const SOUND_NONE = 'none';

/** Файлы-сигналы из `src/media` — то, что разрешено хранить и играть. Порядок = порядок в combobox. */
export const SOUND_FILES = [
  'src/media/ariel.mp3',
  'src/media/beep.mp3',
  'src/media/carme.mp3',
  'src/media/ceres.mp3',
  'src/media/elara.mp3',
  'src/media/europa.mp3',
  'src/media/iapetus.mp3',
  'src/media/io.mp3',
  'src/media/iphone.mp3',
  'src/media/iphone2.mp3',
  'src/media/rhea.mp3',
  'src/media/salacia.mp3',
  'src/media/tethys.mp3',
  'src/media/titan.mp3',
];

/** Файл-сигнал по умолчанию — как во всех сборках до появления выбора на экране настроек. */
export const DEFAULT_SOUND_FILE = 'src/media/ceres.mp3';

export async function getFeeds() {
  const stored = await chrome.storage.local.get(FEEDS_KEY);
  const feeds = stored[FEEDS_KEY];
  return Array.isArray(feeds) ? feeds : [];
}

export async function saveFeeds(feeds) {
  await chrome.storage.local.set({ [FEEDS_KEY]: feeds });
}

export async function getFeed(feedId) {
  const feeds = await getFeeds();
  return feeds.find((feed) => feed.id === feedId) ?? null;
}

export async function upsertFeed(feed) {
  const feeds = await getFeeds();
  const index = feeds.findIndex((candidate) => candidate.id === feed.id);
  if (index === -1) {
    feeds.push(feed);
  } else {
    const previous = feeds[index];
    const next = { ...previous, ...feed };
    /* Сбои описывают тот адрес, по которому ленту читали. Когда адрес меняют, прошлые сбои
     * относятся к другому URL и больше ничего не объясняют, поэтому они сбрасываются. */
    if (feed.rss_link && feed.rss_link !== previous.rss_link) clearFeedDiagnostics(next);
    feeds[index] = next;
  }
  await saveFeeds(feeds);
  return feeds;
}

/**
 * Диагностические поля строки ленты: они описывают последнюю попытку её прочесть, а не её
 * настройки. Появляются только после первой загрузки, поэтому строка ещё не читанной ленты остаётся
 * чистой, а `emptyFeed()` — ровно тем набором полей, что задаёт экран настроек.
 */
const FEED_DIAGNOSTIC_KEYS = [
  'lastCheckedAt',
  'lastOkAt',
  'lastErrorAt',
  'lastErrorCode',
  'lastErrorParams',
  'lastErrorMessage',
  'fetchFailureCount',
];

/** Текст отказа хранится коротким: он нужен для подписи в интерфейсе, а не как журнал. */
const MAX_FEED_ERROR_MESSAGE = 300;

function clearFeedDiagnostics(feed) {
  for (const key of FEED_DIAGNOSTIC_KEYS) delete feed[key];
  return feed;
}

/**
 * Записать в строку ленты её «состояние здоровья»: когда её читали последний раз, чем закончилась
 * эта попытка и сколько отказов подряд накопилось. Успех обнуляет счётчик и стирает прошлый отказ,
 * отказ — копит их, чтобы лента с постоянно недоступной адресной строкой была видна сразу.
 * @param {{ ok?: boolean, error?: unknown, time?: number }} options
 */
export async function markFeedChecked(feedId, { ok = true, error = null, time = Date.now() } = {}) {
  const feeds = await getFeeds();
  const feed = feeds.find((candidate) => candidate.id === feedId);
  if (!feed) return false;

  const checkedAt = Number(time) || Date.now();
  feed.lastCheckedAt = checkedAt;

  if (ok) {
    feed.lastOkAt = checkedAt;
    feed.fetchFailureCount = 0;
    delete feed.lastErrorAt;
    delete feed.lastErrorCode;
    delete feed.lastErrorParams;
    delete feed.lastErrorMessage;
  } else {
    const message = typeof error === 'string' ? error : error?.message;

    feed.lastErrorAt = checkedAt;
    if (error?.code) feed.lastErrorCode = String(error.code);
    else delete feed.lastErrorCode;

    if (error?.params && typeof error.params === 'object') feed.lastErrorParams = error.params;
    else delete feed.lastErrorParams;

    if (message) feed.lastErrorMessage = String(message).slice(0, MAX_FEED_ERROR_MESSAGE);
    else delete feed.lastErrorMessage;

    feed.fetchFailureCount = Math.max(1, (Number(feed.fetchFailureCount) || 0) + 1);
  }

  await saveFeeds(feeds);
  return true;
}

/** Deleting a feed also drops the headlines that belong to it. */
export async function deleteFeed(feedId) {
  const feeds = await getFeeds();
  await saveFeeds(feeds.filter((feed) => feed.id !== feedId));
  const items = await getItems();
  await saveItems(items.filter((item) => item.feedId !== feedId));
}

export async function getItems() {
  const stored = await chrome.storage.local.get(ITEMS_KEY);
  const items = stored[ITEMS_KEY];
  return Array.isArray(items) ? items : [];
}

export async function saveItems(items) {
  await chrome.storage.local.set({ [ITEMS_KEY]: items });
}

/** Newest first — by publication date (`pubDate`), load time is the fallback; ties break by title so the list stays stable. */
export function sortItems(items) {
  return [...items].sort((a, b) => {
    const at = itemTime(a);
    const bt = itemTime(b);
    if (at !== bt) return bt - at;
    return String(a.title).localeCompare(String(b.title));
  });
}

export async function itemsForFeed(feedId) {
  const items = await getItems();
  return sortItems(items.filter((item) => item.feedId === feedId));
}

export async function countItems() {
  return (await getItems()).length;
}

/**
 * Wipe every stored headline (the reader's «Clear all» button) and remember them as read,
 * otherwise the next feed read would hand them all back. Feeds and settings stay.
 */
export async function clearAllItems() {
  const items = await getItems();
  await saveItems([]);
  if (items.length > 0) await markRead(items);
}

/**
 * Wipe one feed's stored headlines (the reader's per-feed «Clear» button) and remember them as
 * read, otherwise the next read of that feed would hand them all back. Other feeds stay.
 */
export async function clearItemsForFeed(feedId) {
  const items = await getItems();
  const removed = items.filter((item) => item.feedId === feedId);
  if (removed.length === 0) return;
  await saveItems(items.filter((item) => item.feedId !== feedId));
  await markRead(removed);
}

/**
 * Build the storage record for one news item from a feed `<item>`:
 * the field `title`, `description`, `pubDate`, `link` taken straight from the feed XML record —
 * `description` is kept as it often carries HTML text short news; its `<img>` tags are re-sized to
 * one uniform box on the way in (see `util.normalizePreviewImages`).
 * Service keys bind item to feed and allow dedup; the `pubDate` field acts as a timestamp for
 * the `clean_timeout` expiry (`time` — actual load time — as a fallback if feed has no date).
 */
export function makeItem({ feed, title, link, description = '', pubDate = '', time = Date.now() }) {
  return {
    uid: normalizeUid(feed.id, link),
    feedId: feed.id,
    feedName: feed.name,
    rss_link: feed.rss_link,
    title,
    description: capPreview(normalizePreviewImages(description)),
    pubDate: String(pubDate ?? '').trim(),
    link,
    time,
  };
}

/** Keep only the newest MAX_ITEMS_PER_FEED headlines of every feed. */
export function capPerFeed(items) {
  const byFeed = new Map();
  for (const item of items) {
    const list = byFeed.get(item.feedId);
    if (list) list.push(item);
    else byFeed.set(item.feedId, [item]);
  }
  const kept = [];
  for (const list of byFeed.values()) {
    kept.push(...sortItems(list).slice(0, MAX_ITEMS_PER_FEED));
  }
  return sortItems(kept);
}

/**
 * Store freshly read headlines, skipping the duplicates already in storage and the headlines the
 * user has deleted before — a feed server keeps shipping its old items, so without the read list
 * a deleted news would come back on the next `delay_timeout`.
 * @returns {{ added: number, skipped: number, seen: number }}
 */
export async function addItems(candidates) {
  const fresh = candidates.filter((item) => item?.uid && item?.link);
  if (fresh.length === 0) return { added: 0, skipped: 0, seen: candidates.length };

  const [items, read] = await Promise.all([getItems(), getRead()]);
  const known = new Set(items.map((item) => item.uid));
  const readLinks = new Set(read.map((record) => record.link));
  let added = 0;
  let skipped = 0;

  for (const candidate of fresh) {
    if (known.has(candidate.uid)) continue;
    if (readLinks.has(candidate.link)) {
      skipped += 1;
      continue;
    }
    known.add(candidate.uid);
    items.push(candidate);
    added += 1;
  }

  if (added > 0) await saveItems(capPerFeed(items));
  return { added, skipped, seen: candidates.length };
}

/**
 * Remove one headline from the list and remember it as read, so the same news is not offered
 * again until its read record expires (see `cleanupRead`).
 */
export async function removeItem(uid) {
  const items = await getItems();
  const kept = items.filter((item) => item.uid !== uid);
  if (kept.length === items.length) return false;

  await saveItems(kept);
  await markRead(items.filter((item) => item.uid === uid));
  return true;
}

/* ------------------------------------------------------------------ read list */

export async function getRead() {
  const stored = await chrome.storage.local.get(READ_KEY);
  const read = stored[READ_KEY];
  return Array.isArray(read) ? read : [];
}

export async function saveRead(read) {
  await chrome.storage.local.set({ [READ_KEY]: read });
}

/**
 * Storage record for a headline the user deleted: `link` is the identity (a feed server reissues
 * the same link), while `pubDate` and `time` (the moment of deletion) together give the age of the
 * record — see `util.readTime`.
 */
export function makeReadRecord(item, now = Date.now()) {
  return {
    link: String(item?.link ?? '').trim(),
    pubDate: String(item?.pubDate ?? '').trim(),
    time: now,
  };
}

/** Remember headlines as read, newest first, without repeating a link already stored. */
export async function markRead(items) {
  const fresh = (items ?? []).filter((item) => item?.link);
  if (fresh.length === 0) return 0;

  const now = Date.now();
  const read = await getRead();
  const known = new Set(read.map((record) => record.link));
  let added = 0;

  for (const item of fresh) {
    const record = makeReadRecord(item, now);
    if (known.has(record.link)) continue;
    known.add(record.link);
    read.push(record);
    added += 1;
  }

  if (added > 0) await saveRead(capRead(read));
  return added;
}

/** Keep the newest `MAX_READ_RECORDS` markers; markers are small, but the list must not grow forever. */
export function capRead(read) {
  if (read.length <= MAX_READ_RECORDS) return read;
  const byAge = [...read].sort((a, b) => readTime(b) - readTime(a));
  return byAge.slice(0, MAX_READ_RECORDS);
}

/**
 * Forget read markers that lived their `read_ttl_days` (age counted from the later of `pubDate`
 * and the moment of deletion). Only then a news may be offered again. The horizon itself is the
 * global setting from the settings screen, so changing it takes effect on the very next sweep.
 * @returns {{ removed: number, read: object[] }}
 */
export async function cleanupRead(now = Date.now()) {
  const read = await getRead();
  if (read.length === 0) return { removed: 0, read };

  const ttlDays = await getReadTtlDays();
  const alive = read.filter((record) => !isReadExpired(record, now, ttlDays));
  const removed = read.length - alive.length;
  if (removed > 0) await saveRead(alive);
  return { removed, read: alive };
}

/** Wipe every «read» marker at once: the headlines they held back may be offered again. */
export async function clearRead() {
  const read = await getRead();
  if (read.length > 0) await saveRead([]);
  return read.length;
}

/**
 * Requirement: a headline lives in storage only until its feed's clean_timeout runs out.
 * The expiry is derived from the feed's current clean_timeout, so editing the feed
 * immediately affects the headlines it already has.
 */
export async function cleanup(now = Date.now()) {
  const [items, feeds] = await Promise.all([getItems(), getFeeds()]);

  let alive = items;
  let removed = 0;

  if (items.length > 0) {
    const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
    alive = items.filter((item) => {
      const feed = feedById.get(item.feedId);
      // A headline of a feed that no longer exists has nowhere to expire from: drop it.
      if (!feed) return false;
      return !isExpired(item, feed, now, DEFAULT_CLEAN_TIMEOUT);
    });

    removed = items.length - alive.length;
    if (removed > 0) await saveItems(alive);
  }

  // Read markers are pruned even when the headline list is empty: it is the only way a marker can
  // ever lapse, and a list of markers that never ages blocks the same news forever.
  const { removed: readRemoved } = await cleanupRead(now);
  return { removed, items: alive, readRemoved };
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY];
  return settings && typeof settings === 'object' ? settings : {};
}

export async function updateSettings(patch) {
  const settings = await getSettings();
  const next = { ...settings, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getTheme() {
  const settings = await getSettings();
  return settings[THEME_KEY] === 'light' ? 'light' : 'dark';
}

export async function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  await updateSettings({ [THEME_KEY]: next });
  return next;
}

/* ------------------------------------------------- font size of the reader's columns */

/** Колонки читалки, у каждой из которых свой размер шрифта, — слева направо, как они стоят на странице. */
export const FONT_PANELS = ['feeds', 'headlines', 'content'];

/** Шаги переключателя: множитель базового размера текста колонки. */
export const FONT_SCALES = [0.85, 1, 1.2, 1.45];

/** Размер колонки, пока пользователь не выбрал другой. */
export const DEFAULT_FONT_SCALE = 1;

/**
 * Хранимой карте доверяем ровно в той мере, в какой она описывает колонки читалки: неизвестной
 * колонке и шагу вне списка возвращаем базовый размер.
 */
export function normalizeFontScales(value) {
  const scales = {};
  for (const panel of FONT_PANELS) {
    const scale = value?.[panel];
    scales[panel] = FONT_SCALES.includes(scale) ? scale : DEFAULT_FONT_SCALE;
  }
  return scales;
}

/** Размер шрифта каждой колонки читалки — из `settings.font_scales`. */
export async function getFontScales() {
  const settings = await getSettings();
  return normalizeFontScales(settings[FONT_SCALES_KEY]);
}

/**
 * Запомнить размер одной колонки: остальные берут то, что уже лежит в хранилище, а не то, что
 * было в памяти этой страницы, — две открытые читалки не затирают выбор друг друга.
 */
export async function setFontScale(panel, scale) {
  if (!FONT_PANELS.includes(panel)) return null;

  const scales = normalizeFontScales((await getSettings())[FONT_SCALES_KEY]);
  scales[panel] = FONT_SCALES.includes(scale) ? scale : DEFAULT_FONT_SCALE;
  await updateSettings({ [FONT_SCALES_KEY]: scales });
  return scales;
}

/* ------------------------------------------------ width of the reader's columns */

/** Колонки, чью ширину меняют мышью: граница тянет колонку слева от себя, сосед отдаёт остаток. */
export const RESIZABLE_PANELS = ['feeds', 'headlines'];

/**
 * Ниже этой ширины колонку сделать нельзя: уже не влезет ни один заголовок, и колонка перестаёт
 * быть колонкой. Это же число стоит нижним пределом в `minmax()` сетки — так предел держится и
 * без скрипта.
 */
export const MIN_PANEL_WIDTH = 160;

/** Выше этой ширины колонку не растягиваем: три колонки читалки должны уместиться в окно. */
export const MAX_PANEL_WIDTH = 900;

/** Ширина колонки, пока пользователь не потянул её границу. */
export const DEFAULT_PANEL_WIDTHS = { feeds: 240, headlines: 340 };

/**
 * Ширины колонок читалки: доверяем хранимой карте ровно в той мере, в какой она описывает тянимые
 * колонки — неизвестной колонке и числу вне границ отдаём ширину по умолчанию.
 */
export function normalizeColumnWidths(value) {
  const widths = {};
  for (const panel of RESIZABLE_PANELS) {
    const fallback = DEFAULT_PANEL_WIDTHS[panel];
    const width = Math.round(Number(value?.[panel]));
    if (!Number.isFinite(width)) {
      widths[panel] = fallback;
      continue;
    }
    widths[panel] = Math.min(Math.max(width, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH);
  }
  return widths;
}

/** Ширины колонок — из `settings.column_widths`. */
export async function getColumnWidths() {
  const settings = await getSettings();
  return normalizeColumnWidths(settings[COLUMN_WIDTHS_KEY]);
}

/**
 * Запомнить ширину одной колонки: остальные берут то, что уже лежит в хранилище, а не то, что было
 * в памяти этой страницы, — две открытые читалки не затирают границу друг друга.
 */
export async function setColumnWidth(panel, width) {
  if (!RESIZABLE_PANELS.includes(panel)) return null;

  const widths = normalizeColumnWidths((await getSettings())[COLUMN_WIDTHS_KEY]);
  widths[panel] = normalizeColumnWidths({ [panel]: width })[panel];
  await updateSettings({ [COLUMN_WIDTHS_KEY]: widths });
  return widths;
}

/**
 * Язык интерфейса. Записанный — это выбор пользователя. Если записи нет (первый запуск), берём
 * язык браузера; если он не поддерживается расширением — английский. Определение по браузеру
 * ничего не пишет: язык сохраняется только когда его выбирают на экране настроек.
 */
export async function getLanguage() {
  const settings = await getSettings();
  const stored = normalizeLanguage(settings[LANGUAGE_KEY]);
  if (stored) {
    setLanguageCache(stored);
    return stored;
  }

  const language = detectBrowserLanguage() ?? FALLBACK_LANGUAGE;
  setLanguageCache(language);
  return language;
}

export async function setLanguage(language) {
  const next = normalizeLanguage(language) ?? FALLBACK_LANGUAGE;
  await updateSettings({ [LANGUAGE_KEY]: next });
  setLanguageCache(next);
  return next;
}

/**
 * Play only the signals bundled with the extension: an unknown path — a stored `SOUND_NONE` of
 * the old «Без звука» builds included — is replaced by the default file.
 */
export function normalizeSoundChoice(value) {
  return SOUND_FILES.includes(value) ? value : DEFAULT_SOUND_FILE;
}

/**
 * Файл-сигнал, выбранный на экране глобальных настроек: путь от корня расширения. Строит,
 * которые хранили только старый признак звука, не имели выбора файла: для них играет файл
 * по умолчанию, а `false` в старом ключе гасит сигнал через `getSoundEnabled`.
 */
export async function getSoundChoice() {
  const settings = await getSettings();
  return normalizeSoundChoice(settings[SOUND_FILE_KEY]);
}

export async function setSoundChoice(choice) {
  const next = normalizeSoundChoice(choice);
  await updateSettings({ [SOUND_FILE_KEY]: next });
  return next;
}

/**
 * «Звук»: играть ли сигнал вообще — отдельный признак на экране глобальных настроек, он
 * не связан с выбором файла, его громкостью или сообщением о загрузке. Строит, которые
 * хранили только старый признак, читаются через него: записанный `false` (там был «Без
 * звука») гасит сигнал, всё остальное — звуку быть.
 */
export async function getSoundEnabled() {
  const settings = await getSettings();
  const stored = settings[SOUND_KEY];
  if (typeof stored === 'boolean') return stored;
  return settings[SOUND_FILE_KEY] !== SOUND_NONE;
}

export async function setSoundEnabled(enabled) {
  const next = toFlag(enabled, true);
  await updateSettings({ [SOUND_KEY]: next });
  return next;
}

/**
 * Громкость сигнала в процентах (0–100), выбранная на экране глобальных настроек: её делят на
 * 100 и отдают `HTMLAudioElement.volume` и в превью, и в offscreen-сигнале автозагрузки.
 */
export async function getSoundVolume() {
  const settings = await getSettings();
  return toVolume(settings[SOUND_VOLUME_KEY], DEFAULT_SOUND_VOLUME);
}

export async function setSoundVolume(volume) {
  const next = toVolume(volume, DEFAULT_SOUND_VOLUME);
  await updateSettings({ [SOUND_VOLUME_KEY]: next });
  return next;
}

/**
 * «Показывать сообщение»: фон сообщает через `chrome.notifications`, сколько заголовков
 * принесла автоматическая загрузка. Записи нет — значит сборка без этого поля жила без
 * сообщений: флаг выключен.
 */
export async function getShowMessage() {
  const settings = await getSettings();
  return toFlag(settings[SHOW_MESSAGE_KEY], false);
}

export async function setShowMessage(enabled) {
  const next = toFlag(enabled, false);
  await updateSettings({ [SHOW_MESSAGE_KEY]: next });
  return next;
}

/** How long a «read» marker keeps its news out of the list, in days. */
export async function getReadTtlDays() {
  const settings = await getSettings();
  return toDays(settings[READ_TTL_KEY], READ_TTL_DAYS);
}

export async function setReadTtlDays(days) {
  const next = toDays(days, READ_TTL_DAYS);
  await updateSettings({ [READ_TTL_KEY]: next });
  return next;
}

/** Defaults for a brand new feed row. */
export function emptyFeed() {
  return {
    id: null,
    name: '',
    rss_link: '',
    delay_timeout: DEFAULT_DELAY_TIMEOUT,
    clean_timeout: DEFAULT_CLEAN_TIMEOUT,
  };
}
