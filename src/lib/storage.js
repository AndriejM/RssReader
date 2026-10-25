// Persistent storage for feeds and headlines.
// "localstorage" here is chrome.storage.local: it is the persistent store that is shared by
// the service worker, the reader page and the feeds page (window.localStorage is per-page and
// would not be visible to the background worker).

import {
  DEFAULT_CLEAN_TIMEOUT,
  DEFAULT_DELAY_TIMEOUT,
  DEFAULT_SOUND_VOLUME,
  FEED_FETCH_TIMEOUT_MS,
  MAX_ITEMS_PER_FEED,
  MAX_ITEMS_TOTAL,
  MAX_READ_RECORDS,
  READ_TTL_DAYS,
  alarmPeriodMinutes,
  capPreview,
  dropUnpreviewableImages,
  feedBackoffMinutes,
  honoredReadDays,
  isExpired,
  isReadExpired,
  itemTime,
  linkKey,
  newId,
  normalizeFeed,
  normalizePreviewImages,
  normalizePubDate,
  normalizeUid,
  readTime,
  shortenSourceId,
  toDays,
  toFlag,
  toMinutes,
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
export const ROW_HEIGHTS_KEY = 'row_heights';
export const LAYOUT_KEY = 'layout';

/** Marker of the first feed added — see `getFirstFeedDone`. */
export const FIRST_FEED_KEY = 'first_feed_done';

/** "Sound off": the automatic load stays without a signal. */
export const SOUND_NONE = 'none';

/** Signal files from `src/media` — what may be stored and played. Order = order in the combobox. */
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

/** The default signal file — as in every build before the settings screen had a choice. */
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
    /* Failures describe the address the feed was read from. When the address changes, the past
     * failures belong to another URL and explain nothing more, so they are reset. The same goes
     * for the server answers: an `ETag` from another address is a ready 304 for another feed. */
    if (feed.rss_link && feed.rss_link !== previous.rss_link) {
      clearFeedDiagnostics(next);
      clearFeedValidators(next);
    }
    feeds[index] = next;
  }
  await saveFeeds(feeds);
  return feeds;
}

/**
 * Diagnostic fields of a feed row: they describe the last attempt to read it, not its settings.
 * They appear only after the first load, so the row of a feed that was not read yet stays clean,
 * and `emptyFeed()` is exactly the set of fields the settings screen sets.
 */
const FEED_DIAGNOSTIC_KEYS = [
  'lastCheckedAt',
  'lastOkAt',
  'lastErrorAt',
  'lastErrorCode',
  'lastErrorParams',
  'lastErrorMessage',
  'fetchFailureCount',
  'nextAlarmAt',
  'nextRetryAt',
];

/**
 * The feed's answers to the past load, by which the next one may ask "did anything change":
 * the server's `ETag` and `Last-Modified` and the moment they were received. Like the diagnosis,
 * they describe the address the feed was read from: changing `rss_link` erases them with it.
 */
const FEED_CACHE_KEYS = ['etag', 'lastModified', 'lastFetchedAt'];

/** The failure text is kept short: it is needed for a label in the interface, not as a log. */
const MAX_FEED_ERROR_MESSAGE = 300;

function clearFeedDiagnostics(feed) {
  for (const key of FEED_DIAGNOSTIC_KEYS) delete feed[key];
  return feed;
}

function clearFeedValidators(feed) {
  for (const key of FEED_CACHE_KEYS) delete feed[key];
  return feed;
}

/**
 * Write the "health state" of the feed into its row: when it was last read, how that attempt ended
 * and how many failures piled up in a row. A success zeroes the counter and erases the past failure,
 * a failure accumulates them, so a feed with a constantly unavailable address is visible at once.
 * A failure also sets when the feed may be asked again (`nextRetryAt`): the pause grows
 * exponentially (`util.feedBackoffMinutes`) so that one broken feed does not eat every load.
 * @param {{ ok?: boolean, error?: unknown, time?: number, nextAlarmAt?: number }} options -
 *   `nextAlarmAt` is the moment the worker already knows the feed's alarm will run
 *   (`lib/alarms.js` -> `alarmDueAt`); without it the schedule is read from the same period formula
 *   `syncAlarms` creates the alarm with.
 */
export async function markFeedChecked(
  feedId,
  { ok = true, error = null, time = Date.now(), nextAlarmAt = 0 } = {},
) {
  const feeds = await getFeeds();
  const feed = feeds.find((candidate) => candidate.id === feedId);
  if (!feed) return false;

  const checkedAt = Number(time) || Date.now();
  feed.lastCheckedAt = checkedAt;

  /* The next check is when the feed's alarm goes off. We keep it so the reader and the settings
   * screen name the date instead of guessing it from `delay_timeout` alone. */
  const scheduled = Number(nextAlarmAt);
  feed.nextAlarmAt =
    Number.isFinite(scheduled) && scheduled > 0
      ? scheduled
      : checkedAt + alarmPeriodMinutes(feed.delay_timeout) * 60000;

  if (ok) {
    feed.lastOkAt = checkedAt;
    feed.fetchFailureCount = 0;
    delete feed.nextRetryAt;
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

    /* When to ask again: later with every failure, but never later than
     * `MAX_FEED_BACKOFF_MINUTES`. The feed's own alarm stays its own - extra attempts are simply
     * skipped (see `background.js`), so the pause does not disturb the schedule of other feeds. */
    feed.nextRetryAt =
      checkedAt + feedBackoffMinutes(feed.fetchFailureCount, feed.delay_timeout) * 60000;
  }

  await saveFeeds(feeds);
  return true;
}

/**
 * Write into the feed row the server's answers to this load - those very `ETag` and `Last-Modified`,
 * with which the next request may ask "did anything change" instead of asking for the whole feed
 * again. An empty server answer erases the old key: what the server no longer sends, it will not take.
 * @param {{ etag?: string, lastModified?: string, fetchedAt?: number }} answer - `fetchedAt` is the
 *   moment the server last sent the headlines these validators describe. Empty for a 304: the key is
 *   newer, the content is the same age it already was.
 */
export async function rememberFeedValidators(
  feedId,
  { etag = '', lastModified = '', fetchedAt = 0 } = {},
) {
  const feeds = await getFeeds();
  const feed = feeds.find((candidate) => candidate.id === feedId);
  if (!feed) return false;

  const tag = typeof etag === 'string' ? etag.trim() : '';
  if (tag) feed.etag = tag;
  else delete feed.etag;

  if (lastModified) feed.lastModified = lastModified;
  else delete feed.lastModified;

  /* The moment the headlines were received lives together with them, but not together with the
   * keys: it answers "when the feed was read last", even when the server sends nothing by which
   * the feed could be asked more cheaply. A 304 renews the key but not the age of what those keys
   * describe - an empty `fetchedAt` comes with it. */
  const at = Number(fetchedAt);
  if (at > 0) feed.lastFetchedAt = at;

  await saveFeeds(feeds);
  return true;
}

/**
 * Write into the feed rows the moment Chrome will really wake their alarm. `markFeedChecked` names
 * this date by the period formula counted from its own attempt; here the schedule itself states it
 * (see `lib/alarms.js`). A feed that already has the same moment stored is not touched, and the whole
 * list is written only when at least one row really changed: writing the whole list and changing
 * nothing would wake `chrome.storage.onChanged` - and through it a new `syncAlarms`, which would
 * write it again.
 * @param {Map<string, number>|Record<string, number>} times - `feedId` -> the moment the alarm fires
 * @returns {number} how many rows got this date
 */
export async function recordFeedAlarmTimes(times) {
  const entries = times instanceof Map ? [...times.entries()] : Object.entries(times ?? {});
  if (entries.length === 0) return 0;

  const feeds = await getFeeds();
  let touched = 0;
  for (const [feedId, at] of entries) {
    const feed = feeds.find((candidate) => candidate.id === feedId);
    const next = Number(at);
    if (!feed || !Number.isFinite(next) || next <= 0) continue;
    if (feed.nextAlarmAt === next) continue;
    feed.nextAlarmAt = next;
    touched += 1;
  }

  if (touched > 0) await saveFeeds(feeds);
  return touched;
}

/**
 * Feeds that are being read right now. Two parallel reads of one address are two answers that write
 * their headlines over each other, so a feed's busy state is kept here, not only in the worker's
 * memory: a service worker falls asleep in the middle of a load and loses its fast state together
 * with itself, while the ticket in the storage stays.
 */
export const FETCH_LOCKS_KEY = 'feed_fetch_locks';

/**
 * How long a feed counts as busy: the longest read a worker can start. Reading a feed is
 * `FEED_FETCH_TIMEOUT_MS` of waiting for an answer; parsing in the offscreen document may ask for it
 * twice (a freshly created document has not had time to take the message) and is not bounded by that
 * timeout, while `+ 15000` is room for the XML markup and for writing the headlines. A ticket longer
 * than this protects nothing already: a load that never came back must not close the feed for the
 * next ones.
 */
export const FETCH_LOCK_TTL_MS = FEED_FETCH_TIMEOUT_MS * 2 + 15000;

async function getFetchLocks() {
  const stored = await chrome.storage.local.get(FETCH_LOCKS_KEY);
  const locks = stored[FETCH_LOCKS_KEY];
  return locks && typeof locks === 'object' ? locks : {};
}

function saveFetchLocks(locks) {
  return chrome.storage.local.set({ [FETCH_LOCKS_KEY]: locks });
}

/** Whether a ticket is alive: an `until` in the past is a load that did not come back, not a busy feed. */
function lockHolds(lock, now) {
  return Number(lock?.until) > Number(now);
}

/**
 * Occupy a feed for the time of its read. Only live busy state is refused, and expired tickets are
 * erased along the way - otherwise a worker that fell asleep would leave the feed unreadable.
 * @returns {Promise<boolean>} `false` - someone else is reading the feed.
 */
export async function tryLockFeed(feedId, { now = Date.now(), ttlMs = FETCH_LOCK_TTL_MS } = {}) {
  const stored = await getFetchLocks();
  const alive = {};
  let dropped = 0;

  for (const [id, lock] of Object.entries(stored)) {
    if (lockHolds(lock, now)) alive[id] = lock;
    else dropped += 1;
  }

  if (alive[feedId]) {
    if (dropped > 0) await saveFetchLocks(alive);
    return false;
  }

  alive[feedId] = { until: Number(now) + ttlMs };
  await saveFetchLocks(alive);
  return true;
}

/** Give the feed back: it has been read - the next load may ask it. */
export async function releaseFeedLock(feedId) {
  const locks = await getFetchLocks();
  if (!(feedId in locks)) return false;
  delete locks[feedId];
  await saveFetchLocks(locks);
  return true;
}

/**
 * Erase the tickets of feeds whose load never brought an answer.
 * @returns {{ removed: number }}
 */
export async function cleanupFetchLocks(now = Date.now()) {
  const stored = await getFetchLocks();
  const alive = {};
  let removed = 0;

  for (const [id, lock] of Object.entries(stored)) {
    if (lockHolds(lock, now)) alive[id] = lock;
    else removed += 1;
  }

  if (removed > 0) await saveFetchLocks(alive);
  return { removed };
}

/** Deleting a feed also drops the headlines that belong to it. */
export async function deleteFeed(feedId) {
  const feeds = await getFeeds();
  await saveFeeds(feeds.filter((feed) => feed.id !== feedId));
  const items = await getItems();
  await saveItems(items.filter((item) => item.feedId !== feedId));
  /* Nobody can give back the deleted feed's ticket anymore: without this it would stay in the
   * storage until it expired on its own. */
  await releaseFeedLock(feedId);
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
 * `description` is kept as it often carries HTML text short news; the `<img>` tags it cannot show are
 * dropped and the rest are re-sized to one uniform box on the way in (see
 * `util.dropUnpreviewableImages` and `util.normalizePreviewImages`).
 * Service keys bind item to feed and allow dedup; the `pubDate` field acts as a timestamp for
 * the `clean_timeout` expiry (`time` — actual load time — as a fallback if feed has no date). It is
 * stored as the UTC instant `util.normalizePubDate` read out of the feed's text, not as the feed
 * spelled it: the raw field is a different moment in the zone of every machine that re-parses it, and
 * a date of the future is a headline `clean_timeout` never reaches.
 *
 * `sourceId`/`sourceIdType` are what the *feed* calls this news (its `<guid>` or its Atom `<id>`,
 * its link where the feed has neither — `rss.sourceIdentity`); `uid` is built on that id, not on the
 * link, so a headline stays one headline when the feed reissues it under a changed address.
 */
export function makeItem({
  feed,
  title,
  link,
  description = '',
  pubDate = '',
  sourceId = '',
  sourceIdType = 'link',
  time = Date.now(),
}) {
  const identity = sourceOf({ link, sourceId, sourceIdType });
  return {
    uid: normalizeUid(feed.id, identity.sourceId),
    feedId: feed.id,
    feedName: feed.name,
    rss_link: feed.rss_link,
    title,
    // Pictures the reader cannot show go first: a `data:` picture left in would take the whole
    // `MAX_PREVIEW_CHARS` and the cap would fall inside its base64 instead of inside the news.
    description: capPreview(normalizePreviewImages(dropUnpreviewableImages(description))),
    pubDate: normalizePubDate(pubDate, time),
    link,
    sourceId: identity.sourceId,
    sourceIdType: identity.sourceIdType,
    time,
  };
}

/**
 * The identity a headline is matched on: the id the feed gave it, normalized the same way on the
 * way in and on every later comparison.
 *
 * `linkKey` is applied only to a link. An opaque `guid`/`<id>` is kept as the feed wrote it: `URL`
 * would read `12345:ru` as a scheme and cut the id to pieces, and an id is meant to be stable
 * byte-for-byte anyway — which is why cutting it to the storage guard carries a fingerprint of the
 * whole id (see `util.shortenSourceId`).
 *
 * The kind is stored with the id, because the kind is not something a feed keeps: the same news is
 * addressed by its link until the day the feed starts stating a `<guid>` (see `identityIndex`).
 */
function sourceOf({ link, sourceId, sourceIdType = 'link' }) {
  const raw = String(sourceId ?? '').trim();
  const kind = String(sourceIdType ?? 'link').trim();
  if (raw) return { sourceId: shortenSourceId(raw), sourceIdType: IDENTITY_KINDS.has(kind) ? kind : 'link' };
  return { sourceId: linkKey(link), sourceIdType: 'link' };
}

/**
 * Identity of a stored headline, computed the way a new candidate's is computed — so a record
 * written before the feeds' own ids were kept (`uid` built on its raw link) still recognises the
 * headline it describes, instead of being copied by the next poll.
 *
 * It carries the `feedId`: two feeds that ship the same news are two headlines of two feeds, exactly
 * as a `uid` built on the link made them. Only the read markers reach across feeds (see
 * `readIdentity`), because a news the user deleted must not come back from anywhere.
 */
function identityOf(item) {
  return `${item?.feedId}|${sourceKeyOf(item)}`;
}

/** The identity of a headline on its own, without the feed that brought it: what a read marker is matched on. */
function sourceKeyOf(item) {
  const { sourceId, sourceIdType } = sourceOf({
    link: item?.link,
    sourceId: item?.sourceId,
    sourceIdType: item?.sourceIdType,
  });
  return `${sourceIdType}:${sourceId}`;
}

/** Kinds of identity a headline can be keyed on; anything else the storage reads as an address. */
const IDENTITY_KINDS = new Set(['link', 'guid', 'atom:id', 'json:id']);

/**
 * Whether a record is keyed by an id its feed states or by its address alone — what decides whether an
 * address may recognise it (see `identityIndex`).
 *
 * A record that names no id is keyed by its address whatever its field claims, and `sourceOf` already
 * reads an unknown kind as an address: the address is the only identity left to read such a record by.
 */
function sourceKindOf(item) {
  return sourceOf({
    link: item?.link,
    sourceId: item?.sourceId,
    sourceIdType: item?.sourceIdType,
  }).sourceIdType;
}

/**
 * The address a headline is also known by — the same `linkKey` a link-typed identity is built on,
 * held beside the feed that shipped it. An empty string when the record names no address.
 *
 * It exists for the poll where the *kind* of the identity changed: a feed that starts stating a
 * `<guid>` after a CMS upgrade is describing the headlines it used to ship under their address, and
 * the storage would otherwise offer them again as news it never had.
 */
function addressOf(item) {
  const key = addressKeyOf(item);
  return key ? `${item?.feedId}|${key}` : '';
}

/** The same address without the feed: what a read marker remembers, since a marker holds its news out of every feed. */
function addressKeyOf(record) {
  const key = linkKey(record?.link);
  return key ? `link:${key}` : '';
}

/**
 * Records indexed by what they are keyed on — the shelf's headlines or the read markers, which differ
 * only in whether their keys carry a feed.
 *
 * `ids` is the identity of every record. An address is held twice over: every address the records
 * name, and only the addresses of the records keyed by an address alone. A candidate is recognised by
 * address only when at least one of the two sides has nothing but an address to say — where both name
 * an id of their own, the ids are the news, and two of them at one address (a forum thread shipped
 * under its `?p=` as well as its `?t=`) are two headlines. `idless` carries the record itself, so a
 * candidate that brings an id for it can rename it instead of adding a copy.
 */
function identityIndex(records, { identityKey, addressKey }) {
  const ids = new Set();
  const addresses = new Set();
  const idless = new Map();

  for (const record of records) {
    ids.add(identityKey(record));
    const address = addressKey(record);
    if (!address) continue;
    addresses.add(address);
    if (sourceKindOf(record) === 'link') idless.set(address, record);
  }

  return { ids, addresses, idless };
}

/** The identity keys of the shelf: a headline belongs to the feed that shipped it. */
const SHELF_KEYS = { identityKey: identityOf, addressKey: addressOf };
/** The identity keys of the read list: a deleted news is held out of every feed. */
const MARKER_KEYS = { identityKey: readIdentity, addressKey: addressKeyOf };

/** Whether `candidate` names a record of `index` — by its id, or by an address one of the two is keyed on. */
function indexOf(candidate, index, { identityKey, addressKey }) {
  const key = identityKey(candidate);
  if (index.ids.has(key)) return { known: true, renamed: null };

  const address = addressKey(candidate);
  if (!address) return { known: false, renamed: null };

  if (sourceKindOf(candidate) === 'link') {
    return { known: index.addresses.has(address), renamed: null };
  }
  return { known: index.idless.has(address), renamed: index.idless.get(address) ?? null };
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
 * The shelf as a whole is capped too: `capPerFeed` bounds one feed, nothing bounds the number of
 * feeds. The oldest headlines of the whole shelf are the ones that go.
 */
export function capTotal(items) {
  const sorted = sortItems(items);
  return sorted.length <= MAX_ITEMS_TOTAL ? sorted : sorted.slice(0, MAX_ITEMS_TOTAL);
}

/** Both caps at once: the freshest headlines of every feed, of every feed the freshest overall. */
export function capItems(items) {
  return capTotal(capPerFeed(items));
}

/**
 * Store freshly read headlines, skipping the duplicates already in storage and the headlines the
 * user has deleted before — a feed server keeps shipping its old items, so without the read list
 * a deleted news would come back on the next `delay_timeout`.
 *
 * Duplicates are recognised by the identity of the headline (`sourceId`, its link where the feed
 * states no id) inside one feed; a read marker is matched across feeds. A headline whose feed changed
 * the *kind* of its identity — a `<guid>` appeared where the shelf only ever saw an address — is
 * recognised by its address and re-typed in place, not stored a second time.
 *
 * A headline whose `clean_timeout` had already run out when the feed shipped it never comes onto the
 * shelf: `cleanup` would take it back on the very next sweep. Servers keep their old items in the
 * feed for long after that, so without this the same ones were stored again on every poll — each time
 * counted as news the reader had never had, which made the load signal sound and the badge grow
 * without a single new headline ever reaching the list.
 * @returns {{ added: number, skipped: number, seen: number }} `added` counts the headlines that
 * stayed in storage after both caps ran.
 */
export async function addItems(candidates) {
  const fresh = candidates.filter((item) => item?.uid && item?.link);
  if (fresh.length === 0) return { added: 0, skipped: 0, seen: candidates.length };

  /* The same age the sweep counts, by the same `clean_timeout` of the feed the headline belongs to. */
  const now = Date.now();
  const [items, read, feeds] = await Promise.all([getItems(), getRead(), getFeeds()]);
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
  const shelf = identityIndex(items, SHELF_KEYS);
  const markers = identityIndex(read, MARKER_KEYS);
  const accepted = new Set();
  let skipped = 0;
  let retyped = 0;

  for (const candidate of fresh) {
    if (isExpired(candidate, feedById.get(candidate.feedId), now, DEFAULT_CLEAN_TIMEOUT)) continue;

    const match = indexOf(candidate, shelf, SHELF_KEYS);

    /* The poll changed the *kind* of the identity, not the news. A feed that started stating a
     * `<guid>` — a CMS upgrade, a feed moved to another generator — describes the headlines it used
     * to ship under their address alone: without this they would come back as news the reader never
     * had, the ones it deleted among them. The record already on the shelf takes the id the feed now
     * states, which is the identity that outlives the addresses that feed will change next. */
    if (match.renamed) {
      const stored = match.renamed;
      shelf.idless.delete(addressOf(stored));
      shelf.ids.delete(identityOf(stored));
      adoptIdentity(stored, candidate);
      shelf.ids.add(identityOf(stored));
      retyped += 1;
      continue;
    }
    if (match.known) continue;

    if (indexOf(candidate, markers, MARKER_KEYS).known) {
      skipped += 1;
      continue;
    }

    const address = addressOf(candidate);
    if (address) {
      shelf.addresses.add(address);
      if (sourceKindOf(candidate) === 'link') shelf.idless.set(address, candidate);
    }
    shelf.ids.add(identityOf(candidate));
    accepted.add(candidate.uid);
    items.push(candidate);
  }

  /* A headline a cap cut back is not a headline the reader has, so the numbers a load reports are
   * counted after the caps ran: they name the headlines that really are on the shelf. A record the
   * poll only re-typed is not a new headline either, but its new identity has to be written down. */
  if (accepted.size === 0 && retyped === 0) return { added: 0, skipped, seen: candidates.length };

  const kept = capItems(items);
  await saveItems(kept);
  const added = kept.reduce((n, item) => (accepted.has(item.uid) ? n + 1 : n), 0);
  return { added, skipped, seen: candidates.length };
}

/**
 * Give a stored headline the id its feed has started stating: everything the record says about the
 * news stays — its title, its preview, its address, the moment it arrived — and only the identity the
 * shelf keys it on becomes the id the feed promises to keep.
 *
 * `uid` moves with it. It is the key the pages name a headline by, and they read it back from storage
 * on every load; the alternative — keeping the record keyed by an address and matching it by address on
 * every poll — would lose the headline the moment the feed moved its address too.
 */
function adoptIdentity(item, candidate) {
  const { sourceId, sourceIdType } = sourceOf({
    link: candidate.link,
    sourceId: candidate.sourceId,
    sourceIdType: candidate.sourceIdType,
  });
  item.sourceId = sourceId;
  item.sourceIdType = sourceIdType;
  item.uid = normalizeUid(item.feedId, sourceId);
}


/**
 * Remove one headline from the list and remember it as read, so the same news is not offered
 * again until its read record expires (see `cleanupRead`). `restoreItem` is the way back from this.
 */
export async function removeItem(uid) {
  const items = await getItems();
  const kept = items.filter((item) => item.uid !== uid);
  if (kept.length === items.length) return false;

  await saveItems(kept);
  await markRead(items.filter((item) => item.uid === uid));
  return true;
}

/**
 * Put back a headline the reader has just deleted and forget the marker that held its news out of the
 * polls: undoing a delete has to take both back, or the headline that came back would be offered
 * again the moment its feed is next read.
 *
 * A headline of a feed that no longer exists has nowhere to live, so it is not restored.
 * @returns {boolean} whether the headline went back on the shelf
 */
export async function restoreItem(item) {
  if (!item?.uid) return false;

  const [items, feeds] = await Promise.all([getItems(), getFeeds()]);
  if (items.some((stored) => stored.uid === item.uid)) return false;
  if (!feeds.some((feed) => feed.id === item.feedId)) return false;

  await saveItems(capItems([...items, item]));
  await unmarkRead([item]);
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
 * record — see `util.readTime`. The date is normalized against the moment of deletion, the latest a
 * publication date can honestly be by the time the reader had the news in hand.
 *
 * `sourceId`/`sourceIdType` go with it: when the feed later reissues the news under another address,
 * the marker is still found by the id the feed calls it, and the deleted news does not come back.
 */
export function makeReadRecord(item, now = Date.now()) {
  const { sourceId, sourceIdType } = sourceOf({
    link: item?.link,
    sourceId: item?.sourceId,
    sourceIdType: item?.sourceIdType,
  });
  return {
    link: String(item?.link ?? '').trim(),
    sourceId,
    sourceIdType,
    pubDate: normalizePubDate(item?.pubDate, now),
    time: now,
  };
}

/** Identity a read marker is matched on, the same way a candidate's identity is computed. */
function readIdentity(record) {
  return sourceKeyOf(record);
}

/**
 * Forget the read markers of these headlines: the news they held back may be offered again.
 *
 * A marker is dropped by the same identity that put it there, so the marker one feed's headline made
 * goes together with the same news as another feed of the same site calls it.
 * @returns {number} how many markers the list lost
 */
export async function unmarkRead(items) {
  const fresh = (items ?? []).filter((item) => item?.link);
  if (fresh.length === 0) return 0;

  const read = await getRead();
  if (read.length === 0) return 0;

  /* The match turned around: here the headlines are the index and the markers are the candidates,
   * which is what it takes to drop a marker by the news it stands for rather than by the words its
   * own record happens to hold. `MARKER_KEYS` keys both sides without a feed, which is how a marker
   * reaches across the feeds of one site. */
  const shelf = identityIndex(fresh, MARKER_KEYS);
  const kept = read.filter((record) => !indexOf(record, shelf, MARKER_KEYS).known);
  const removed = read.length - kept.length;
  if (removed > 0) await saveRead(kept);
  return removed;
}

/** Remember headlines as read, newest first, without repeating a headline already stored. */
export async function markRead(items) {
  const fresh = (items ?? []).filter((item) => item?.link);
  if (fresh.length === 0) return 0;

  const now = Date.now();
  const [read, ttlDays] = await Promise.all([getRead(), getReadTtlDays()]);
  const markers = identityIndex(read, MARKER_KEYS);
  let added = 0;
  let retyped = 0;

  for (const item of fresh) {
    const record = makeReadRecord(item, now);
    const match = indexOf(record, markers, MARKER_KEYS);

    /* One marker per news, whatever feed of one site shipped it — by the id the feed calls it by, and
     * by its address when either side names no id. A marker made from a headline the shelf keyed by
     * address takes the id the feed has started stating, the way the headline itself does: from there
     * it holds the news out on the polls where its address moved along with the upgrade. */
    if (match.renamed) {
      markers.idless.delete(addressKeyOf(match.renamed));
      markers.ids.delete(readIdentity(match.renamed));
      match.renamed.sourceId = record.sourceId;
      match.renamed.sourceIdType = record.sourceIdType;
      markers.ids.add(readIdentity(match.renamed));
      retyped += 1;
      continue;
    }
    if (match.known) continue;

    const address = addressKeyOf(record);
    if (address) {
      markers.addresses.add(address);
      if (sourceKindOf(record) === 'link') markers.idless.set(address, record);
    }
    markers.ids.add(readIdentity(record));
    read.push(record);
    added += 1;
  }

  /* A re-typed marker is not a new marker, but its new identity has to be written down: it is what
   * holds the deleted news out of the polls that come after the feed started stating its ids. */
  if (added > 0 || retyped > 0) await saveRead(capRead(read, ttlDays, now).read);
  return added;
}

/**
 * Keep the read list within `MAX_READ_RECORDS`: the markers whose horizon has already run out go
 * first (they hold no news back anyway), and only when the live markers alone overflow the list do
 * the oldest live markers go with them — which shortens the horizon the user asked for, so the
 * number of markers sacrificed that way is reported instead of being decided in silence.
 * @returns {{ read: object[], droppedLive: number }}
 */
export function capRead(read, ttlDays = READ_TTL_DAYS, now = Date.now()) {
  const list = Array.isArray(read) ? read : [];
  if (list.length <= MAX_READ_RECORDS) return { read: list, droppedLive: 0 };

  const live = [];
  for (const record of list) {
    if (!isReadExpired(record, now, ttlDays)) live.push(record);
  }
  if (live.length <= MAX_READ_RECORDS) return { read: live, droppedLive: 0 };

  live.sort((a, b) => readTime(b, now) - readTime(a, now));
  return { read: live.slice(0, MAX_READ_RECORDS), droppedLive: live.length - MAX_READ_RECORDS };
}

/**
 * Which of `items` a read marker covers: a `Set` of their `uid`, matched exactly the way `addItems`
 * matches a fresh headline against the read list. A headline is therefore called read in the reader
 * exactly when its news would not come back from the polls — not when a flag somewhere says so.
 *
 * The markers whose horizon has run out are counted too: they still sit in the list, and until the
 * cleanup sweep takes them the reader still holds the news itself.
 * @returns {Set<string>}
 */
export function readMarksFor(items, read) {
  const markers = identityIndex(read ?? [], MARKER_KEYS);
  const marks = new Set();
  for (const item of items ?? []) {
    if (!item?.uid || !item?.link) continue;
    if (indexOf(item, markers, MARKER_KEYS).known) marks.add(item.uid);
  }
  return marks;
}

/** How long the markers the list can actually keep live: `ttlDays`, or less once the cap bites. */
export function readHonoredDays(read, ttlDays = READ_TTL_DAYS, now = Date.now()) {
  return honoredReadDays(read, ttlDays, MAX_READ_RECORDS, now);
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
  // The same sweep ages the tickets of reads that never came back, so a worker that fell asleep
  // mid-fetch cannot leave a feed locked.
  const { removed: lockRemoved } = await cleanupFetchLocks(now);
  return { removed, items: alive, readRemoved, lockRemoved };
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

/** The reader's columns, each with its own font size - left to right, as they stand on the page. */
export const FONT_PANELS = ['feeds', 'headlines', 'content'];

/** Steps of the switch: a multiplier of the column's base text size. */
export const FONT_SCALES = [0.85, 1, 1.2, 1.45];

/** A column's size until the user chooses another one. */
export const DEFAULT_FONT_SCALE = 1;

/**
 * A stored map is trusted exactly as far as it describes the reader's columns: to an unknown column
 * or a step outside the list we return the base size.
 */
export function normalizeFontScales(value) {
  const scales = {};
  for (const panel of FONT_PANELS) {
    const scale = value?.[panel];
    scales[panel] = FONT_SCALES.includes(scale) ? scale : DEFAULT_FONT_SCALE;
  }
  return scales;
}

/** Font size of every reader column - from `settings.font_scales`. */
export async function getFontScales() {
  const settings = await getSettings();
  return normalizeFontScales(settings[FONT_SCALES_KEY]);
}

/**
 * Remember the size of one column: the others take what already lies in the storage, not what was in
 * this page's memory - two open readers do not overwrite each other's choice.
 */
export async function setFontScale(panel, scale) {
  if (!FONT_PANELS.includes(panel)) return null;

  const scales = normalizeFontScales((await getSettings())[FONT_SCALES_KEY]);
  scales[panel] = FONT_SCALES.includes(scale) ? scale : DEFAULT_FONT_SCALE;
  await updateSettings({ [FONT_SCALES_KEY]: scales });
  return scales;
}

/* ------------------------------------------------ width of the reader's columns */

/** Columns whose width is moved by mouse: a border pulls the column to its left, the neighbour gives the rest away. */
export const RESIZABLE_PANELS = ['feeds', 'headlines'];

/**
 * Below this width a column cannot go: not even one headline fits, and the column stops being a
 * column. The same number stands as the lower bound in the grid's `minmax()` - so the bound holds it
 * even without the script.
 */
export const MIN_PANEL_WIDTH = 160;

/** Above this width we do not stretch a column: the reader's three columns must fit in the window. */
export const MAX_PANEL_WIDTH = 900;

/** A column's width until the user pulls its border. */
export const DEFAULT_PANEL_WIDTHS = { feeds: 240, headlines: 340 };

/**
 * The widths of the reader's columns: we trust the stored map exactly as far as it describes the
 * draggable columns - to an unknown column and to a number outside the bounds we give the default
 * width.
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

/** Column widths - from `settings.column_widths`. */
export async function getColumnWidths() {
  const settings = await getSettings();
  return normalizeColumnWidths(settings[COLUMN_WIDTHS_KEY]);
}

/**
 * Remember the width of one column: the others take what already lies in the storage, not what was in
 * this page's memory - two open readers do not overwrite each other's border.
 */
export async function setColumnWidth(panel, width) {
  if (!RESIZABLE_PANELS.includes(panel)) return null;

  const widths = normalizeColumnWidths((await getSettings())[COLUMN_WIDTHS_KEY]);
  widths[panel] = normalizeColumnWidths({ [panel]: width })[panel];
  await updateSettings({ [COLUMN_WIDTHS_KEY]: widths });
  return widths;
}

/* ------------------------------------------------ height of the reader's stacked windows */

/** Windows whose height is moved by mouse: a border pulls the window above it down, the one below gives the rest away. Only the arrangement that puts two windows in one column has such a border. */
export const RESIZABLE_ROWS = ['headlines'];

/** Below this height a window stops being a window: its head alone would fill it. */
export const MIN_PANEL_HEIGHT = 120;

/** Above this height we do not stretch a window: the reader must leave some text to the window below. */
export const MAX_PANEL_HEIGHT = 900;

/** A window's height until the user pulls its border. */
export const DEFAULT_ROW_HEIGHTS = { headlines: 340 };

/**
 * The heights of the reader's stacked windows: the stored map is trusted exactly as the map of widths
 * is - to an unknown window and to a number outside the bounds we give the default height.
 */
export function normalizeRowHeights(value) {
  const heights = {};
  for (const panel of RESIZABLE_ROWS) {
    const fallback = DEFAULT_ROW_HEIGHTS[panel];
    const height = Math.round(Number(value?.[panel]));
    if (!Number.isFinite(height)) {
      heights[panel] = fallback;
      continue;
    }
    heights[panel] = Math.min(Math.max(height, MIN_PANEL_HEIGHT), MAX_PANEL_HEIGHT);
  }
  return heights;
}

/** Heights of the stacked windows - from `settings.row_heights`. */
export async function getRowHeights() {
  const settings = await getSettings();
  return normalizeRowHeights(settings[ROW_HEIGHTS_KEY]);
}

/**
 * Remember the height of one window: the others take what already lies in the storage, not what was in
 * this page's memory - two open readers do not overwrite each other's border.
 */
export async function setRowHeight(panel, height) {
  if (!RESIZABLE_ROWS.includes(panel)) return null;

  const heights = normalizeRowHeights((await getSettings())[ROW_HEIGHTS_KEY]);
  heights[panel] = normalizeRowHeights({ [panel]: height })[panel];
  await updateSettings({ [ROW_HEIGHTS_KEY]: heights });
  return heights;
}

/* ------------------------------------------------- arrangement of the reader's panels */

/**
 * The arrangements the reader's panels can be put in:
 * `three` - feeds, headlines, article: the arrangement the reader has always had;
 * `list` - no feeds column: the headlines of every feed at once, and the open one beside them;
 * `split` - the feeds column kept, and the other column cut across: the headlines of one feed above
 *           the news chosen among them, one above the other, as a mail client puts them.
 */
export const LAYOUTS = ['three', 'list', 'split'];

/** The arrangement a reader opens with: the one that shows every panel the reader has.
 *  A name of an arrangement is also the value of `data-layout` on `.panels`. */
export const DEFAULT_LAYOUT = 'three';

/**
 * Which panels an arrangement shows, left to right. This is the one place that knows it: the grid of
 * `reader.css` lays these panels out, `lib/columns.js` derives from the order which border of them is
 * draggable and where its handle sits, and `index.js` asks it whether the feeds column - and with it
 * the choice of a single feed - exists at all.
 */
export const LAYOUT_PANELS = {
  three: ['feeds', 'headlines', 'content'],
  list: ['headlines', 'content'],
  split: ['feeds', 'headlines', 'content'],
};

/**
 * The same panels read column by column: one entry per column of the arrangement, and a column that
 * holds two windows one above the other names both of them, upper one first. `lib/columns.js` derives
 * from this the borders of the arrangement - the border that ends a column runs vertically, the border
 * between the two windows of a column runs across it - so an arrangement that cuts a column in two does
 * not have to describe its handles anywhere else.
 */
export const LAYOUT_COLUMNS = {
  three: [['feeds'], ['headlines'], ['content']],
  list: [['headlines'], ['content']],
  split: [['feeds'], ['headlines', 'content']],
};

/** A stored arrangement is trusted only while it names one the reader really has. */
export function normalizeLayout(value) {
  return LAYOUTS.includes(value) ? value : DEFAULT_LAYOUT;
}

/** The arrangement of the panels - from `settings.layout`. */
export async function getLayout() {
  const settings = await getSettings();
  return normalizeLayout(settings[LAYOUT_KEY]);
}

/** Remember the arrangement: every reader tab opens in the same shape next time. */
export async function setLayout(layout) {
  const next = normalizeLayout(layout);
  await updateSettings({ [LAYOUT_KEY]: next });
  return next;
}

/**
 * The interface language. A stored one is the user's choice. When there is no record (first run) we
 * take the browser's language; when the extension does not support it - English. Detecting it from
 * the browser writes nothing: the language is stored only when it is chosen on the settings screen.
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
 * the old "no sound" builds included — is replaced by the default file.
 */
export function normalizeSoundChoice(value) {
  return SOUND_FILES.includes(value) ? value : DEFAULT_SOUND_FILE;
}

/**
 * The signal file chosen on the global settings screen: a path from the extension's root. Builds
 * that stored only the old sound flag had no choice of a file: for them the default file plays, and
 * a `false` in the old key silences the signal through `getSoundEnabled`.
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
 * "Sound": whether the signal plays at all - a separate flag on the global settings screen, it is
 * not tied to the choice of the file, its volume or the load message. Builds that stored only the
 * old flag are read through it: a stored `false` (there was "Sound off") silences the signal,
 * everything else - there is sound.
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
 * The signal's volume in percent (0-100), chosen on the global settings screen: it is divided by
 * 100 and given to `HTMLAudioElement.volume` both in the preview and in the offscreen signal of the
 * automatic load.
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
 * "Show a message": the background reports through `chrome.notifications` how many headlines the
 * automatic load brought. There is no record - the build lived without this field, without
 * messages: the flag is off.
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

/**
 * First run on the feeds screen: a mark that a feed has already been added and its headlines came.
 * No mark - the reader has not shown any of its feeds yet, and after the first save the screen
 * confirms the result with a separate line. The mark is set once and never taken back: the feeds
 * screen does not repeat the same confirmation for every saved row.
 */
export async function getFirstFeedDone() {
  const settings = await getSettings();
  return toFlag(settings[FIRST_FEED_KEY], false);
}

export async function setFirstFeedDone() {
  await updateSettings({ [FIRST_FEED_KEY]: true });
  return true;
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

/* ------------------------------ carrying feeds between profiles ------------------------------ */

/**
 * The version of the file the feeds screen knows how to write out and to read. The format changes -
 * the number changes, and a file of another version is refused whole, not read at random.
 */
export const FEED_EXPORT_VERSION = 1;

/** Name of the written-out file - it is not translated: it is a file name, not an interface label. */
export const FEED_EXPORT_FILE_NAME = 'rss-reader-feeds.json';

/**
 * What a feed takes with it: only the fields the user himself set. `id` belongs to this profile - in
 * another one it may already belong to another feed; the diagnosis (`lastErrorCode`,
 * `fetchFailureCount`) and the server answer (`etag`, `lastModified`) describe a reading done here,
 * and somewhere else they would be someone else's.
 */
export function buildFeedsExport(feeds) {
  const rows = (Array.isArray(feeds) ? feeds : []).map((feed) => ({
    name: String(feed?.name ?? ''),
    rss_link: String(feed?.rss_link ?? ''),
    delay_timeout: toMinutes(feed?.delay_timeout, DEFAULT_DELAY_TIMEOUT),
    clean_timeout: toMinutes(feed?.clean_timeout, DEFAULT_CLEAN_TIMEOUT),
  }));

  return { version: FEED_EXPORT_VERSION, feeds: rows };
}

/**
 * Read the file the user brought to the screen. Returns `{ feeds, skipped, code }`: `feeds` are the
 * file's rows that passed the same check as a table row, but without `id` (this profile gives it);
 * `skipped` - how many rows the check refused, among them a repeat of the same address inside the
 * file; `code` - why the whole file was refused (`json` / `version` / `shape`) or `null` when the
 * file was read. The code names the key `feeds.import.error.<code>`, so the screen answers in its
 * own language and not in text frozen in one.
 */
export function parseFeedsExport(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch {
    return { feeds: [], skipped: 0, code: 'json' };
  }

  if (parsed?.version !== FEED_EXPORT_VERSION) {
    return { feeds: [], skipped: 0, code: 'version' };
  }
  if (!Array.isArray(parsed?.feeds)) {
    return { feeds: [], skipped: 0, code: 'shape' };
  }

  const feeds = [];
  const known = new Set();
  let skipped = 0;

  for (const row of parsed.feeds) {
    const { feed, errors } = normalizeFeed(row);
    const link = feed.rss_link;
    if (Object.keys(errors).length > 0 || !link || known.has(link)) {
      skipped += 1;
      continue;
    }
    known.add(link);
    feeds.push(feed);
  }

  return { feeds, skipped, code: null };
}

/**
 * Add to the storage the feeds that came from the file. A feed of the same address is already
 * configured - it stays as it is: a transfer must not strike out the local dates and must not
 * silently touch the headlines that this feed already has. Returns `{ added, existing }`.
 */
export async function mergeFeeds(feeds) {
  const stored = await getFeeds();
  const known = new Set(stored.map((feed) => String(feed?.rss_link ?? '').trim()));
  let added = 0;
  let existing = 0;

  for (const feed of Array.isArray(feeds) ? feeds : []) {
    const link = String(feed?.rss_link ?? '').trim();
    if (!link || known.has(link)) {
      existing += 1;
      continue;
    }
    known.add(link);
    stored.push({ ...feed, id: newId() });
    added += 1;
  }

  if (added > 0) await saveFeeds(stored);
  return { added, existing };
}
