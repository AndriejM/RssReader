// Background service worker: polls feeds on their delay_timeout alarms, stores headlines,
// prunes them on clean_timeout, keeps the toolbar badge count and plays the alert sound.

import { feedIdFromAlarm, syncAlarms } from './lib/alarms.js';
import { MSG_COUNT, MSG_FETCH_FEED, MSG_FEEDS_CHANGED, MSG_REFRESH_FEED } from './lib/messages.js';
import { requestOffscreen } from './lib/offscreen.js';
import { FeedError } from './lib/rss.js';
import { playSound } from './lib/sound.js';
import * as store from './lib/storage.js';
import { CLEANUP_ALARM_NAME, badgeText } from './lib/util.js';

chrome.runtime.onInstalled.addListener(() => {
  void bootstrap('install');
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap('startup');
});

// The worker can be torn down at any time; make sure alarms exist whenever it wakes up.
void bootstrap('wake');

// Requirement: clicking the toolbar icon opens the reader screen in a new tab.
// The manifest declares no default_popup, so this event fires on every icon click.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/index.html') });
});

// Pages write feeds/items directly, so the worker watches the storage to keep the alarms and
// the badge count in step with whatever the reader or the settings screen just changed.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[store.FEEDS_KEY]) {
    void syncAlarms();
    void store.cleanup().then(({ removed }) => {
      if (removed > 0) void updateBadge();
    });
    return;
  }
  if (changes[store.ITEMS_KEY]) void updateBadge();
});

async function bootstrap(reason) {
  try {
    await syncAlarms();
    await store.cleanup();
    await updateBadge();
  } catch (error) {
    console.warn(`bootstrap(${reason}) failed:`, error?.message ?? error);
  }
}

async function updateBadge() {
  const count = await store.countItems();
  await chrome.action.setBadgeText({ text: badgeText(count) });
  await chrome.action.setBadgeBackgroundColor({ color: '#1e88e5' });
}

/**
 * Read a feed through the offscreen document: a service worker has no DOMParser, so the XML is
 * loaded and parsed there and the parsed item fields (title, description, pubDate, link) come back.
 */
async function readFeed(url) {
  const response = await requestOffscreen({ type: MSG_FETCH_FEED, url });
  if (!response?.ok) {
    throw new FeedError(response?.error ?? 'не удалось прочитать ленту');
  }
  return response.result;
}

/**
 * Fetch one feed and write the new headlines to storage.
 * @param {{ notify?: boolean }} options - `notify` marks an alarm-driven (automatic) read,
 *   which is the only case that plays the sound.
 */
async function ingestFeed(feed, { notify = false } = {}) {
  const fetched = await readFeed(feed.rss_link);
  const now = Date.now();
  const candidates = fetched.entries.map((entry) =>
    store.makeItem({
      feed,
      title: entry.title,
      description: entry.description,
      pubDate: entry.pubDate,
      link: entry.link,
      time: now,
    }),
  );

  const added = await store.addItems(candidates);
  await updateBadge();

  if (added > 0 && notify) {
    await playSound();
  }

  return { added, seen: fetched.entries.length };
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === CLEANUP_ALARM_NAME) {
      const { removed } = await store.cleanup();
      if (removed > 0) await updateBadge();
      return;
    }

    const feedId = feedIdFromAlarm(alarm.name);
    if (!feedId) return;

    const feed = await store.getFeed(feedId);
    if (!feed) {
      // The feed was removed while its alarm was still queued.
      await syncAlarms();
      return;
    }

    const result = await ingestFeed(feed, { notify: true });
    console.info(`feed "${feed.name}": new ${result.added}, parsed ${result.seen}`);
  } catch (error) {
    const reason = error instanceof FeedError ? error.message : error?.message ?? error;
    console.warn(`alarm ${alarm.name} failed:`, reason);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG_REFRESH_FEED) {
    (async () => {
      try {
        const feedId = message.feedId;
        const feed = await store.getFeed(feedId);
        if (!feed) {
          sendResponse({ ok: false, error: 'Лента не найдена' });
          return;
        }
        const result = await ingestFeed(feed, { notify: false });
        sendResponse({ ok: true, ...result });
      } catch (error) {
        const reason = error instanceof FeedError ? error.message : error?.message ?? error;
        sendResponse({ ok: false, error: reason });
      }
    })();
    return true; // keep the message channel open for the async reply
  }

  if (message?.type === MSG_FEEDS_CHANGED) {
    (async () => {
      await syncAlarms();
      await store.cleanup();
      await updateBadge();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === MSG_COUNT) {
    (async () => {
      sendResponse({ ok: true, count: await store.countItems() });
    })();
    return true;
  }

  return false;
});
