// Persistent storage for feeds and headlines.
// "localstorage" here is chrome.storage.local: it is the persistent store that is shared by
// the service worker, the reader page and the feeds page (window.localStorage is per-page and
// would not be visible to the background worker).

import {
  DEFAULT_CLEAN_TIMEOUT,
  DEFAULT_DELAY_TIMEOUT,
  MAX_ITEMS_PER_FEED,
  capPreview,
  isExpired,
  itemTime,
  normalizeUid,
} from './util.js';

export const FEEDS_KEY = 'feeds';
export const ITEMS_KEY = 'items';
export const SETTINGS_KEY = 'settings';
export const THEME_KEY = 'theme';

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
  if (index === -1) feeds.push(feed);
  else feeds[index] = { ...feeds[index], ...feed };
  await saveFeeds(feeds);
  return feeds;
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

/** Wipe every stored headline (the reader's «Clear all» button); feeds and settings stay. */
export async function clearAllItems() {
  await saveItems([]);
}

/**
 * Build the storage record for one news item from a feed `<item>`:
 * the field `title`, `description`, `pubDate`, `link` taken straight from the feed XML record —
 * `description` is kept as it often carries HTML text short news.
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
    description: capPreview(description),
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
 * Store freshly read headlines, skipping duplicates.
 * @returns {number} how many headlines were actually added
 */
export async function addItems(candidates) {
  const fresh = candidates.filter((item) => item?.uid && item?.link);
  if (fresh.length === 0) return 0;

  const items = await getItems();
  const known = new Set(items.map((item) => item.uid));
  let added = 0;

  for (const candidate of fresh) {
    if (known.has(candidate.uid)) continue;
    known.add(candidate.uid);
    items.push(candidate);
    added += 1;
  }

  if (added > 0) await saveItems(capPerFeed(items));
  return added;
}

export async function removeItem(uid) {
  const items = await getItems();
  const kept = items.filter((item) => item.uid !== uid);
  if (kept.length !== items.length) await saveItems(kept);
  return kept.length !== items.length;
}

/**
 * Requirement: a headline lives in storage only until its feed's clean_timeout runs out.
 * The expiry is derived from the feed's current clean_timeout, so editing the feed
 * immediately affects the headlines it already has.
 */
export async function cleanup(now = Date.now()) {
  const [items, feeds] = await Promise.all([getItems(), getFeeds()]);
  if (items.length === 0) return { removed: 0, items };

  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
  const alive = items.filter((item) => {
    const feed = feedById.get(item.feedId);
    // A headline of a feed that no longer exists has nowhere to expire from: drop it.
    if (!feed) return false;
    return !isExpired(item, feed, now, DEFAULT_CLEAN_TIMEOUT);
  });

  const removed = items.length - alive.length;
  if (removed > 0) await saveItems(alive);
  return { removed, items: alive };
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
