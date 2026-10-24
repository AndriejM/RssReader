// Pure helpers shared by the service worker, the reader page and the feeds page.
// Nothing here touches the chrome.* APIs so the logic stays easy to test (see scripts/test.mjs).

export const ALARM_PREFIX = 'feed:';
export const CLEANUP_ALARM_NAME = 'rss-reader:cleanup';

/** Chrome clamps alarm periods below this value in release builds. */
export const MIN_ALARM_PERIOD_MINUTES = 1;
export const CLEANUP_PERIOD_MINUTES = 1;

export const DEFAULT_DELAY_TIMEOUT = 30;
export const DEFAULT_CLEAN_TIMEOUT = 1440; // 1 day

/**
 * How long the reader waits for an answer before it gives up on it. A site that hangs would
 * otherwise hold the whole background poll (feeds are read one after another) hostage.
 */
export const FEED_FETCH_TIMEOUT_MS = 15000;
export const ARTICLE_FETCH_TIMEOUT_MS = 12000;

/** The pause of a feed whose reads keep failing stops growing here: one day. */
export const MAX_FEED_BACKOFF_MINUTES = 1440; // 1 day

/** Storage guard: newest headlines kept per feed. */
export const MAX_ITEMS_PER_FEED = 250;

/**
 * Storage guard: newest headlines kept in total. A feed is capped on its own (`MAX_ITEMS_PER_FEED`),
 * but feeds are not: a reader of a hundred feeds would otherwise hold twenty-five thousand headlines
 * and their previews. When the total overflows, the oldest headlines of the whole shelf go first.
 */
export const MAX_ITEMS_TOTAL = 2000;

/** Storage guard: feed `<description>` blobs are capped so `chrome.storage.local` stays lean. */
export const MAX_PREVIEW_CHARS = 8000;

/** Uniform box (CSS pixels) given to every `<img>` a feed ships inside `<description>`. */
export const PREVIEW_IMAGE_WIDTH = 180;
export const PREVIEW_IMAGE_HEIGHT = 240;

/**
 * Storage guard: how long a «read» marker keeps a news out of the list. Feed servers do not
 * delete their own items, so without a horizon the same news would be offered forever.
 */
export const READ_TTL_DAYS = 7;

/** Bounds the user can pick for that horizon on the global settings screen. */
export const MIN_READ_TTL_DAYS = 1;
export const MAX_READ_TTL_DAYS = 3650;

/**
 * Storage guard: how many read markers are kept. Expired markers fall out first — they hold nothing
 * back anyway; only when the live ones alone overflow the list do the oldest live markers go, and
 * that is when `read_ttl_days` stops being the whole truth (see `honoredReadDays`).
 */
export const MAX_READ_RECORDS = 1000;

/**
 * Storage guard: a `guid`/`<id>` is an opaque string the feed invents. It is stored as the identity
 * of a headline, so it is kept short; a feed that puts a whole article in it is not an id.
 */
export const MAX_SOURCE_ID_CHARS = 200;

/** What marks the tail of an id the guard had to cut. */
export const SOURCE_ID_CUT = '#…';

/**
 * An id longer than the guard is cut — and two headlines whose ids differ only past the cut are then
 * the same id, so the reader would hold one of two news and never offer the other. The fingerprint of
 * the *whole* id goes with the cut: the headlines the feed calls differently stay different, while one
 * headline keeps the same shortened id across polls (which is the whole point of an id).
 *
 * The result can overflow what `MAX_SOURCE_ID_CHARS` allowed by the mark and the fingerprint, and it
 * does so on purpose: guarding the byte budget by cutting the fingerprint back would reintroduce the
 * merge it exists to prevent.
 */
export function shortenSourceId(raw) {
  const id = String(raw ?? '').trim();
  if (id.length <= MAX_SOURCE_ID_CHARS) return id;
  return `${id.slice(0, MAX_SOURCE_ID_CHARS)}${SOURCE_ID_CUT}${fingerprint(id)}`;
}

const FNV_PRIME = 0x01000193;

/** FNV-1a over the characters of a string, as 32 bits. */
function fnv1a(value, offset) {
  let hash = offset;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * A short, stable fingerprint of a string: two FNV-1a runs over the same text from different starting
 * states, so two ids that share a prefix — which is exactly the pair the cut would merge — differ here
 * as often as a 64-bit number can differ.
 */
export function fingerprint(value) {
  const text = String(value ?? '');
  const a = fnv1a(text, 0x811c9dc5);
  const b = fnv1a(text, (0x811c9dc5 ^ 0x9e3779b9) >>> 0);
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/**
 * Parameters that say nothing about *which* page is meant: the same article arrives with a
 * different tail of them from one poll of a feed to the next (a campaign tag added by a share
 * button, a click id per click), which is exactly the link-move dedup must survive.
 */
const TRACKING_PARAM =
  /^(utm_.+|source|medium|campaign|term|content|clid|gclid|dclid|fbclid|msclkid|yclid|igshid|icid|ihref|share_.+|ref_.+|ref|trk_.+|trk|vero_.+|mc_.+|s_kwcid|cmp|scene|si|si_[a-z0-9_.-]+|_hs.*)_?$/i;

/**
 * Volume of the alert signal, in percent: the slider on the global settings screen. 100 is the
 * default, which keeps the sound of the builds that had no volume control at all.
 */
export const DEFAULT_SOUND_VOLUME = 100;
export const MIN_SOUND_VOLUME = 0;
export const MAX_SOUND_VOLUME = 100;

/** How long the load message stays on screen before the extension clears it itself. */
export const NOTIFY_TTL_SECONDS = 8;

/**
 * How many load messages the extension keeps on screen at once. One automatic read reports on its
 * own, so a reader of forty feeds whose alarms land in the same minute gets a message per feed, and
 * Chrome puts no limit of its own on that stack: the oldest of them are cleared first.
 */
export const NOTIFY_MAX_ACTIVE = 3;

/**
 * Normalize a boolean setting: only a real `true`/`false` is kept, anything else takes the
 * fallback, so an absent key never turns a flag on by accident.
 */
export function toFlag(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Normalize the signal volume coming from the settings screen slider (always percent).
 */
export function toVolume(value, fallback = DEFAULT_SOUND_VOLUME) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SOUND_VOLUME, Math.max(MIN_SOUND_VOLUME, n));
}

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

/** The shortest alarm period Chrome may schedule for a feed, in minutes. */
export function alarmPeriodMinutes(delayTimeout) {
  return Math.max(MIN_ALARM_PERIOD_MINUTES, toMinutes(delayTimeout, DEFAULT_DELAY_TIMEOUT));
}

/**
 * How long a feed that keeps failing waits before it is asked again: its own poll period doubled
 * for every failure in a row (1, 2, 4, 8 …), capped at `MAX_FEED_BACKOFF_MINUTES`. One failure is
 * therefore no extra wait at all — the feed simply misses its next checks — and a feed that reads
 * cleanly waits exactly `delay_timeout`.
 */
export function feedBackoffMinutes(failures, delayTimeout = DEFAULT_DELAY_TIMEOUT) {
  const streak = Math.max(1, Math.round(Number(failures)) || 1);
  // Enough doublings to reach the cap for any period a feed may be given; keeps the product finite.
  const period = alarmPeriodMinutes(delayTimeout);
  return Math.min(MAX_FEED_BACKOFF_MINUTES, period * 2 ** Math.min(streak - 1, 11));
}

/**
 * How long a feed is still on pause: 0 when it is due to be read. `nextRetryAt` is written by
 * `storage.markFeedChecked`; a feed nobody has failed to read has no pause at all.
 */
export function feedPauseRemaining(feed, now = Date.now()) {
  const until = Number(feed?.nextRetryAt);
  if (!Number.isFinite(until) || until <= 0) return 0;
  return Math.max(0, until - Number(now));
}

/**
 * When a feed will be read next. The deadline should be looked for later of the two that name it:
 * the feed's alarm (`nextAlarmAt`) runs on its own schedule, while the pause after a failure
 * (`nextRetryAt`) only skips an attempt — the alarm itself does not move (see `background.js`). A
 * feed whose deadline has already passed answers this question with itself: its question should be
 * asked now. 0 — there is no deadline at all: nobody has read the feed and its alarm is not yet
 * recorded.
 */
export function feedNextCheckAt(feed, now = Date.now()) {
  const alarmAt = Number(feed?.nextAlarmAt);
  const retryAt = Number(feed?.nextRetryAt);
  const due = Number.isFinite(alarmAt) && alarmAt > 0 ? alarmAt : 0;
  const paused = Number.isFinite(retryAt) && retryAt > Number(now) ? retryAt : 0;
  return Math.max(due, paused);
}

function round2(value) {
  return String(Math.round(value * 100) / 100);
}

/** Substitute a number into a unit template like "{n} мин" (the templates come from i18n). */
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
 * "через 5 мин" style label for a future timestamp (the next poll of a feed). Mirrors
 * `formatSince`: the same steps into the future, and the same `labels` from the active language
 * (`i18n.unitLabels`); the defaults keep the Russian wording so `util.js` stays testable as is.
 * A time already past reads as "now", so a schedule that slipped does not name a time that has
 * already gone by.
 */
export function formatUntil(time, now = Date.now(), labels) {
  const when = Number(time);
  if (!Number.isFinite(when)) return labels?.empty ?? '—';
  const diff = when - Number(now);
  if (diff <= 0) return labels?.anyNow ?? 'сейчас';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return labels?.anyNow ?? 'сейчас';
  if (minutes < 60) return unitFormat(labels?.inMinutes ?? 'через {n} мин', minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unitFormat(labels?.inHours ?? 'через {n} ч', hours);
  const days = Math.floor(hours / 24);
  return unitFormat(labels?.inDays ?? 'через {n} дн', days);
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
 * How far ahead of our own clock a feed's publication date is still believed: a server whose clock
 * runs fast, a news scheduled for a later posting, a date written in the wrong timezone — all of them
 * state a moment that has not happened yet. Anything further ahead is counted as this ceiling,
 * because a headline dated in the future is one `clean_timeout` never overtakes (see `isExpired`).
 */
export const MAX_PUBDATE_SKEW_MS = 15 * 60 * 1000;

/**
 * Epoch timestamp of a feed's publication date, as one field of text: 0 when it states no date or a
 * date no clock can read. This is the one reading of `pubDate` the reader orders and expires
 * headlines by — the parser's cap, `storage.sortItems` and `readTime` all agree on it.
 *
 * `Date.parse` resolves the offset the date states (`Z`, `GMT`, `+03:00`) and, when it states none —
 * a bare `YYYY-MM-DD` or an RFC 822 date whose author forgot the offset, both common in the wild —
 * the zone of whoever asks. That half of the answer belongs to the machine, not to the feed, which is
 * why a date is stored as the ISO form of this number (see `normalizePubDate`) rather than as the
 * feed's own spelling.
 *
 * A date further ahead of `now` than `MAX_PUBDATE_SKEW_MS` is not believed as written: it counts as
 * that ceiling, so a headline of the future still ages out of the shelf. Call it with the moment the
 * record was read, not with the moment asked (as `itemTime` does): a ceiling that moves with the clock
 * would make a headline of the future permanently fifteen minutes old.
 */
export function pubDateTime(pubDate, now = Date.now()) {
  const published = String(pubDate ?? '').trim();
  if (!published) return 0;
  const parsed = Date.parse(published);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, now + MAX_PUBDATE_SKEW_MS);
}

/**
 * The `pubDate` a storage record keeps: the instant `pubDateTime` read out of the feed's text, written
 * back as one UTC ISO string — or nothing at all when the feed's date cannot be read.
 *
 * Storage does not keep the date the way the feed spelled it: a raw field is re-parsed wherever it is
 * used, in the zone of the machine that parses it, so the same headline is a different age on the
 * worker's clock and on the reader page; and a date ahead of the poll that read the feed keeps the
 * headline fresh forever. Both are settled once, here, against `notAfter` — the moment the feed was
 * read, the latest a publication date can honestly be, give or take a wrong server clock of
 * `MAX_PUBDATE_SKEW_MS`. A record written by an older build, whose `pubDate` is still the feed's raw
 * text, goes through the same reading on the way out (see `pubDateTime`).
 */
export function normalizePubDate(pubDate, notAfter = Date.now()) {
  const at = pubDateTime(pubDate, notAfter);
  return at ? new Date(at).toISOString() : '';
}

/**
 * Epoch timestamp of an item: the publication date (`pubDate`) when the feed record
 * carries one, the load time otherwise. 0 means "no usable date at all".
 *
 * The publication date is believed only up to the load time of the record — the moment the reader
 * actually got the news — because that is the latest date the record can honestly carry, and unlike
 * the clock it is a fact already stored: a headline dated a month ahead is dated by its own poll, and
 * its `clean_timeout` runs from there (see `isExpired`).
 */
export function itemTime(item, now = Date.now()) {
  const stored = Number(item?.time ?? 0);
  const loaded = Number.isFinite(stored) && stored > 0 ? stored : 0;
  const published = pubDateTime(item?.pubDate, loaded || now);
  if (published) return published;
  return loaded;
}

/**
 * The age of a «read» marker: the later of `pubDate` and the moment the headline was deleted.
 * Delete time is never earlier than publication, so a marker always lives its whole `ttlDays`
 * from the deletion instead of being born already expired.
 */
export function readTime(record, now = Date.now()) {
  const published = itemTime(record, now);
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
  const published = itemTime(item, now);
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
  const when = readTime(record, now);
  if (!when) return true;
  const ttl = Math.max(1, Number(ttlDays) || READ_TTL_DAYS);
  return now - when >= ttl * 24 * 60 * 60000;
}

/**
 * The horizon the read list really honours — `ttlDays` while every live marker fits in
 * `maxRecords`, otherwise the age of the oldest live marker the cap is forced to keep.
 *
 * A cap smaller than what the horizon asks for is the one way a deleted news comes back before its
 * term runs out. The horizon is a user setting, so the reader cannot keep that silent: whatever is
 * left of it is what the screens name.
 */
export function honoredReadDays(
  read,
  ttlDays = READ_TTL_DAYS,
  maxRecords = MAX_READ_RECORDS,
  now = Date.now(),
) {
  const ttl = Math.max(1, Number(ttlDays) || READ_TTL_DAYS);
  const list = Array.isArray(read) ? read.filter(Boolean) : [];
  if (list.length <= maxRecords) return ttl;

  const live = list
    .filter((record) => !isReadExpired(record, now, ttl))
    .sort((a, b) => readTime(b, now) - readTime(a, now));
  if (live.length <= maxRecords) return ttl;

  const age = now - readTime(live[maxRecords - 1], now);
  return Math.max(0, Math.min(ttl, Math.floor(age / (24 * 60 * 60000))));
}

/** How far from the end of the cut a half-written character reference may stand to be worth cutting away. */
const MAX_HALF_ENTITY_CHARS = 12;

/**
 * Move the cut back to the edge of the markup it fell into: the head of a tag whose tail is cut off
 * is worse than no tag at all, and a character reference whose `;` was cut off is no longer one.
 */
function previewCut(value) {
  const tag = value.lastIndexOf('<');
  if (tag > value.lastIndexOf('>')) return value.slice(0, tag);

  const entity = value.lastIndexOf('&');
  if (entity > value.lastIndexOf(';') && value.length - entity <= MAX_HALF_ENTITY_CHARS) return value.slice(0, entity);

  return value;
}

/**
 * Keep the head of stored preview HTML and mark where the feed text was cut, so
 * `chrome.storage.local` does not swallow whole articles shipped in `<description>`.
 *
 * The cut is moved back to the edge of the markup it landed in: a tag cut in the middle leaves its
 * attributes loose in the text as characters no renderer was meant to read, and a character reference
 * cut in the middle prints as the letters it was written to escape.
 */
export function capPreview(text, max = MAX_PREVIEW_CHARS) {
  const value = String(text ?? '').trim();
  if (!(max > 0) || value.length <= max) return value;
  return `${previewCut(value.slice(0, max)).trimEnd()} […]`;
}

const IMG_TAG = /<img\b[^>]*>/gi;
const IMG_NAME = /^<img\b/i;
/** The `src` of an `<img>`, quoted or not, the way the feed wrote it — an attribute, not the `data-src` of a lazy picture. */
const IMG_SRC_ATTR = /(?:^|[\s/])src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i;
/** Attributes that decide the size of the picture: the stored `width`/`height` must be the only ones. */
const IMG_SIZE_ATTR = /\s(?:width|height|style|srcset)=("[^"]*"|'[^']*'|[^\s>]+)/gi;
const IMG_TAG_CLOSE = /\s*\/?>$/;

/**
 * Drop every `<img>` whose address this reader cannot show.
 *
 * A `data:` picture is a whole news article written as base64 inside the text of another one, and
 * `extract.sanitizePreview` refuses a `src` that is not http(s) — so such a tag is not merely a picture
 * that will not render: it eats the `MAX_PREVIEW_CHARS` of its headline and pushes the text of the news,
 * with the pictures it could have shown, out of what storage keeps.
 */
export function dropUnpreviewableImages(text) {
  return String(text ?? '').replace(IMG_TAG, (tag) => {
    const quoted = IMG_SRC_ATTR.exec(tag)?.[1] ?? '';
    const src = quoted.replace(/^["']|["']$/g, '').trim();

    // The two spellings `extract.safeExternalUrl` accepts, and nothing else: a protocol-relative
    // address is the same address the page of the news is served under.
    return /^https?:\/\//i.test(src) || src.startsWith('//') ? tag : '';
  });
}

/**
 * Give every `<img>` of a feed description the same box, so headlines of different feeds line up
 * in the reader instead of keeping each feed's own sizes.
 *
 * Runs on the stored text, not on a DOM: the service worker has no `DOMParser`, so this is a text
 * rewrite. Both spellings a feed uses are covered by one pass, because `rss.parseFeed` reads
 * `<description>` as text — a tag inside CDATA and a tag written as `&lt;img&gt;` reach storage as
 * the same plain HTML string.
 *
 * `width`, `height` and `srcset` the feed put on the tag are dropped along with `style`: an inline
 * style would beat the attributes and put the picture back at the feed's size, and `srcset` would
 * let the browser pick a source cut for that size.
 */
export function normalizePreviewImages(text, { width = PREVIEW_IMAGE_WIDTH, height = PREVIEW_IMAGE_HEIGHT } = {}) {
  const w = Math.max(1, Math.round(Number(width)) || PREVIEW_IMAGE_WIDTH);
  const h = Math.max(1, Math.round(Number(height)) || PREVIEW_IMAGE_HEIGHT);

  return String(text ?? '').replace(IMG_TAG, (tag) => {
    const name = IMG_NAME.exec(tag)?.[0] ?? '<img';
    const rest = tag.slice(name.length).replace(IMG_SIZE_ATTR, '');
    const closing = IMG_TAG_CLOSE.exec(rest)?.[0] ?? '>';
    return `${name}${rest.slice(0, rest.length - closing.length)} width="${w}" height="${h}"${closing}`;
  });
}

export function normalizeUid(feedId, link) {
  return `${feedId}|${String(link ?? '').trim()}`;
}

/**
 * How a link must read to be recognised as one it has seen before: the *stored* `link` stays exactly
 * as the feed wrote it (that is the address the reader opens), while the match drops what a feed
 * changes between its own polls — `http` and `https`, the default port, `www`, a trailing slash, the
 * `#…` fragment and the tracking parameters.
 *
 * Returns the trimmed text back when the link is not something `URL` can read, so a comparison
 * degrades to a plain string match instead of dropping the headline.
 */
export function linkKey(link) {
  const raw = String(link ?? '').trim();
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;

  url.protocol = 'https:';
  /* The port has already been dropped by `URL` itself: an address named with its own protocol's
   * default port reads without a port already during parsing (`http://host:80` and `https://host:443`
   * arrive with an empty `port`), and changing the protocol fills the remaining port up to implied.
   * So only real ports are left here — `https://host:8080` is a different site. */
  url.username = '';
  url.password = '';
  url.hash = '';
  if (url.hostname.startsWith('www.')) url.hostname = url.hostname.slice(4);

  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) url.searchParams.delete(name);
  }

  /* `URL.pathname` is read-only, so the slash is cut from the path the URL keeps. Only a real tail
   * goes: `/` is the whole path of a site root, and dropping it would make the root and its empty
   * subdirectory the same page. */
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);

  // `pathname` and `search` are read through `URL`, so they come back percent-encoded the same way.
  return url.href;
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
