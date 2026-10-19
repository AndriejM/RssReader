// Pure helpers shared by the service worker, the reader page and the feeds page.
// Nothing here touches the chrome.* APIs so the logic stays easy to test (see scripts/test.mjs).

export const ALARM_PREFIX = 'feed:';
export const CLEANUP_ALARM_NAME = 'rss-reader:cleanup';

/** Chrome clamps alarm periods below this value in release builds. */
export const MIN_ALARM_PERIOD_MINUTES = 1;
export const CLEANUP_PERIOD_MINUTES = 1;

export const DEFAULT_DELAY_TIMEOUT = 30;
export const DEFAULT_CLEAN_TIMEOUT = 1440; // 1 day

/** Storage guard: newest headlines kept per feed. */
export const MAX_ITEMS_PER_FEED = 100;

/** Storage guard: feed `<description>` blobs are capped so `chrome.storage.local` stays lean. */
export const MAX_PREVIEW_CHARS = 8000;

/**
 * Storage guard: how long a «read» marker keeps a news out of the list. Feed servers do not
 * delete their own items, so without a horizon the same news would be offered forever.
 */
export const READ_TTL_DAYS = 7;

/** Bounds the user can pick for that horizon on the global settings screen. */
export const MIN_READ_TTL_DAYS = 1;
export const MAX_READ_TTL_DAYS = 3650;

/** Storage guard: how many read markers are kept; the oldest fall out first. */
export const MAX_READ_RECORDS = 1000;

/**
 * Volume of the alert signal, in percent: the slider on the global settings screen. 100 is the
 * default, which keeps the sound of the builds that had no volume control at all.
 */
export const DEFAULT_SOUND_VOLUME = 100;
export const MIN_SOUND_VOLUME = 0;
export const MAX_SOUND_VOLUME = 100;

/**
 * Normalize a timeout value coming from the UI (always minutes).
 */
export function toMinutes(value, fallback, { min = 1, max = 60 * 24 * 365 } = {}) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Normalize the «forget read after N days» value coming from the settings screen.
 */
export function toDays(value, fallback = READ_TTL_DAYS) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_READ_TTL_DAYS, Math.max(MIN_READ_TTL_DAYS, n));
}

/**
 * Normalize the signal volume coming from the settings screen slider (always percent).
 */
export function toVolume(value, fallback = DEFAULT_SOUND_VOLUME) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SOUND_VOLUME, Math.max(MIN_SOUND_VOLUME, n));
}

export function alarmPeriodMinutes(delayTimeout) {
  return Math.max(MIN_ALARM_PERIOD_MINUTES, toMinutes(delayTimeout, DEFAULT_DELAY_TIMEOUT));
}

function round2(value) {
  return String(Math.round(value * 100) / 100);
}

/** Подставить число в шаблон единицы измерения вида «{n} мин» (шаблоны приходят из i18n). */
function unitFormat(template, value) {
  return String(template).replace('{n}', String(value));
}

/**
 * Human readable form of a timeout given in minutes. `labels` comes from the active language
 * (`i18n.unitLabels`); the defaults keep the Russian wording so `util.js` stays testable as is.
 */
export function humanDuration(minutes, labels) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return labels?.empty ?? '—';
  if (m < 60) return unitFormat(labels?.minutes ?? '{n} мин', m);
  if (m < 1440) return unitFormat(labels?.hours ?? '{n} ч', round2(m / 60));
  return unitFormat(labels?.days ?? '{n} дн', round2(m / 1440));
}

/**
 * "5 мин назад" style label for a timestamp (publication date first, load time fallback).
 * Without `labels` it reads in Russian; the reader and settings screens pass `i18n.unitLabels()`.
 */
export function formatSince(time, now = Date.now(), labels) {
  const diff = Math.max(0, now - Number(time));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return labels?.justNow ?? 'только что';
  if (minutes < 60) return unitFormat(labels?.minutesAgo ?? '{n} мин назад', minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unitFormat(labels?.hoursAgo ?? '{n} ч назад', hours);
  const days = Math.floor(hours / 24);
  if (days < 30) return unitFormat(labels?.daysAgo ?? '{n} дн назад', days);
  return new Date(Number(time)).toLocaleDateString(labels?.locale ?? 'ru-RU');
}

/**
 * Badge text for the toolbar icon: 1..99 as a number, "*" above 99, nothing for 0.
 */
export function badgeText(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > 99) return '*';
  return String(n);
}

/**
 * Epoch timestamp of an item: the publication date (`pubDate`) when the feed record
 * carries one, the load time otherwise. 0 means "no usable date at all".
 */
export function itemTime(item) {
  const published = String(item?.pubDate ?? '').trim();
  if (published) {
    const parsed = Date.parse(published);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const stored = Number(item?.time ?? 0);
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

/**
 * The age of a «read» marker: the later of `pubDate` and the moment the headline was deleted.
 * Delete time is never earlier than publication, so a marker always lives its whole `ttlDays`
 * from the deletion instead of being born already expired.
 */
export function readTime(record) {
  const published = itemTime(record);
  const deleted = Number(record?.time ?? 0);
  return Math.max(published, Number.isFinite(deleted) && deleted > 0 ? deleted : 0);
}

/**
 * A headline is expired when it has been published for at least the feed's clean_timeout
 * (see `itemTime`): `expiry is counted from pubDate when the record has pubDate, then
 * the stored `time` acts as a fallback.
 */
export function isExpired(item, feed, now = Date.now(), fallbackClean = DEFAULT_CLEAN_TIMEOUT) {
  const clean = toMinutes(feed?.clean_timeout, fallbackClean);
  if (clean <= 0) return false;
  const published = itemTime(item);
  if (!published) return true;
  return now - published >= clean * 60000;
}

/**
 * A «read» marker stops keeping its news out of the list after `ttlDays`. Age is counted from the
 * later of `pubDate` and the moment the headline was deleted: counting from `pubDate` alone would
 * make a marker for an already old news useless from the start, and the news the user just deleted
 * would come back on the very next `delay_timeout`.
 */
export function isReadExpired(record, now = Date.now(), ttlDays = READ_TTL_DAYS) {
  const when = readTime(record);
  if (!when) return true;
  const ttl = Math.max(1, Number(ttlDays) || READ_TTL_DAYS);
  return now - when >= ttl * 24 * 60 * 60000;
}

/**
 * Keep the head of stored preview HTML and mark where the feed text was cut, so
 * `chrome.storage.local` does not swallow whole articles shipped in `<description>`.
 */
export function capPreview(text, max = MAX_PREVIEW_CHARS) {
  const value = String(text ?? '').trim();
  if (max > 0 && value.length > max) return `${value.slice(0, max)} […]`;
  return value;
}

export function normalizeUid(feedId, link) {
  return `${feedId}|${String(link ?? '').trim()}`;
}

export function isValidHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Resolve a possibly relative link against the feed/page URL. */
export function absoluteUrl(raw, base) {
  try {
    return new URL(String(raw).trim(), base).href;
  } catch {
    return null;
  }
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Turn whatever a feed or a page gave us for a title into plain text.
 */
export function cleanTitle(value, fallback = 'Без названия') {
  const text = String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

/**
 * Validate and normalize a feed record coming from the configuration screen.
 * Returns { feed, errors }. `errors` is a map of field -> message.
 * `messages` supplies the field-error texts in the active language (`feeds.error.*`); the
 * defaults keep the Russian wording so the pure logic stays testable on its own.
 */
export function normalizeFeed(input, messages = {}) {
  const errors = {};
  const name = String(input?.name ?? '').trim();
  const rssLink = String(input?.rss_link ?? '').trim();

  if (!name) errors.name = messages.name ?? 'Укажите название ленты';
  if (name.length > 120) errors.name = messages.nameTooLong ?? 'Название слишком длинное';
  if (!isValidHttpUrl(rssLink))
    errors.rss_link = messages.rss_link ?? 'Ссылка должна начинаться с http:// или https://';

  const delayRaw = Number(input?.delay_timeout);
  if (!Number.isFinite(delayRaw) || delayRaw < 1) {
    errors.delay_timeout = messages.delay_timeout ?? 'Период загрузки — не меньше 1 минуты';
  }
  const cleanRaw = Number(input?.clean_timeout);
  if (!Number.isFinite(cleanRaw) || cleanRaw < 1) {
    errors.clean_timeout = messages.clean_timeout ?? 'Время хранения — не меньше 1 минуты';
  }

  const feed = {
    name,
    rss_link: rssLink,
    delay_timeout: toMinutes(delayRaw, DEFAULT_DELAY_TIMEOUT),
    clean_timeout: toMinutes(cleanRaw, DEFAULT_CLEAN_TIMEOUT),
  };

  return { feed, errors };
}
