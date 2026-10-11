// Background service worker: polls feeds on their delay_timeout alarms, stores headlines,
// prunes them on clean_timeout, keeps the toolbar badge count and plays the alert sound.

import { feedIdFromAlarm, syncAlarms } from './lib/alarms.js';
import { MSG_COUNT, MSG_FETCH_FEED, MSG_FEEDS_CHANGED, MSG_REFRESH_FEED } from './lib/messages.js';
import { requestOffscreen } from './lib/offscreen.js';
import { FeedError } from './lib/rss.js';
import { playSound } from './lib/sound.js';
import * as store from './lib/storage.js';
import { READER_PAGE, focusOrCreateTab } from './lib/tabs.js';
import { CLEANUP_ALARM_NAME, badgeText } from './lib/util.js';

chrome.runtime.onInstalled.addListener(() => {
  void bootstrap('install');
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap('startup');
});

// The worker can be torn down at any time; make sure alarms exist whenever it wakes up.
void bootstrap('wake');

// Requirement: clicking the toolbar icon opens the reader screen in a new tab — but only when it
// is not open yet: a reader that is already in the tab strip is activated instead, together with
// its window. The manifest declares no default_popup, so this event fires on every icon click.
chrome.action.onClicked.addListener((clickedTab) => {
  void focusOrCreateTab(READER_PAGE, clickedTab?.windowId);
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
  // The read horizon is a global setting: shortening it should prune the markers it governs on
  // the next sweep rather than wait for a headline to expire.
  if (changes[store.SETTINGS_KEY]) {
    void store.cleanup().then(({ removed }) => {
      if (removed > 0) void updateBadge();
    });
  }
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
  // Chrome picks the label colour itself (the action API only exposes the pill background), so
  // the fix is a pill bright enough that its own label stays legible in Chrome's light and dark
  // toolbar themes — the old accent blue (#1e88e5) buried the digits. The darker tone keeps the
  // pill's edge visible on a light toolbar.
  const theme = await store.getTheme();
  await chrome.action.setBadgeBackgroundColor({ color: theme === 'light' ? '#e6a817' : '#ffd54f' });
}

/**
 * Read a feed through the offscreen document: a service worker has no DOMParser, so the XML is
 * loaded and parsed there and the parsed item fields (title, description, pubDate, link) come back.
 */
async function readFeed(url) {
  const response = await requestOffscreen({ type: MSG_FETCH_FEED, url });
  if (!response?.ok) {
    const err = response?.error;
    if (err && typeof err === 'object' && err.code) {
      throw new FeedError(err.code, { code: err.code, params: err.params });
    }
    const message = typeof err === 'string' ? err : (err?.message ?? 'feed could not be read');
    throw new FeedError(message, { code: 'feedUnknown', params: { message } });
  }
  return response.result;
}

/**
 * Готовить ответ страницы об ошибке: отказ с i18n-кодом (`rss.js`, `lib/offscreen.js`) уходит как
 * `{ code, params }`, чтобы страница подписала его на своём языке; всё остальное — как есть.
 */
function errorPayload(error) {
  if (error?.code) return { code: error.code, params: error.params, message: error.message };
  return error?.message ?? String(error);
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

  const { added, skipped } = await store.addItems(candidates);
  await updateBadge();

  if (added > 0 && notify) {
    await playSound();
  }

  return { added, skipped, seen: fetched.entries.length };
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
    console.info(
      `feed "${feed.name}": new ${result.added}, parsed ${result.seen}, already read ${result.skipped}`,
    );
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
          sendResponse({ ok: false, error: { code: 'feedNotFound' } });
          return;
        }
        const result = await ingestFeed(feed, { notify: false });
        sendResponse({ ok: true, ...result });
      } catch (error) {
        sendResponse({ ok: false, error: errorPayload(error) });
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
