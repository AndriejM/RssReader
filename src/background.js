// Background service worker: polls feeds on their delay_timeout alarms, stores headlines,
// prunes them on clean_timeout, keeps the toolbar badge count and plays the alert sound.

import { alarmDueAt, feedIdFromAlarm, syncAlarms } from './lib/alarms.js';
import { MSG_COUNT, MSG_FETCH_FEED, MSG_FEEDS_CHANGED, MSG_REFRESH_ALL_FEEDS, MSG_REFRESH_FEED } from './lib/messages.js';
import { notifyIngest, wireNotificationClicks } from './lib/notify.js';
import { requestOffscreen } from './lib/offscreen.js';
import { FeedError } from './lib/rss.js';
import { playSound } from './lib/sound.js';
import * as store from './lib/storage.js';
import { READER_PAGE, focusOrCreateTab } from './lib/tabs.js';
import { CLEANUP_ALARM_NAME, alarmPeriodMinutes, badgeText, feedPauseRemaining } from './lib/util.js';

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

/* A click on the load message leads to the same place as the toolbar icon: the popup names how
 * many headlines arrived, while the headlines themselves live only in the reader. The listeners are
 * placed here, like the rest: the worker needs them standing before Chrome calls it on an event. */
wireNotificationClicks();

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
 * `validators` are the answers the last read of this feed left behind: the document may answer them
 * with an empty 304 instead of the whole feed.
 */
async function readFeed(feed, validators = {}) {
  const response = await requestOffscreen({
    type: MSG_FETCH_FEED,
    url: feed.rss_link,
    etag: validators.etag,
    lastModified: validators.lastModified,
  });
  if (!response?.ok) {
    const err = response?.error;
    if (err && typeof err === 'object' && err.code) {
      // `status` comes along: it is what tells a refused validator apart from a dead feed.
      throw new FeedError(err.code, { code: err.code, params: err.params, status: err.status });
    }
    const message = typeof err === 'string' ? err : (err?.message ?? 'feed could not be read');
    throw new FeedError(message, { code: 'feedUnknown', params: { message } });
  }
  return response.result;
}

/**
 * Prepare a page's error answer: a refusal with an i18n code (`rss.js`, `lib/offscreen.js`) goes
 * out as `{ code, params }` so the page labels it in its own language; everything else — as is.
 */
function errorPayload(error) {
  if (error?.code) {
    return { code: error.code, params: error.params, message: error.message, status: error.status };
  }
  return error?.message ?? String(error);
}

/**
 * Record a feed's diagnosis. It is secondary: its own failure (e.g. storage overflow) must not
 * stand in for the real reason the load could not be read to the end.
 */
async function reportFeedHealth(feedId, health) {
  try {
    await store.markFeedChecked(feedId, health);
  } catch (diagnosticError) {
    console.warn(`could not record the health of feed ${feedId}:`, diagnosticError?.message ?? diagnosticError);
  }
}

/**
 * The server rejected our key: the same address line answers not with a feed but with 412 / 404 /
 * 410. Most often the reason is a validator the feed no longer recognizes, so the next attempt goes
 * without it: a stubborn server must not turn every load into a refusal.
 */
async function forgetValidators(feed, error) {
  const status = Number(error?.status);
  if (!(feed.etag || feed.lastModified) || ![404, 410, 412].includes(status)) return;

  try {
    await store.rememberFeedValidators(feed.id, {});
    console.info(`feed "${feed.name}": ${status} — the reader stops asking with the answers it no longer gets`);
  } catch (storageError) {
    console.warn(`could not forget the validators of feed ${feed.id}:`, storageError?.message ?? storageError);
  }
}

/**
 * A failure that belongs not to the feed but to the reader itself: its storage did not give out the
 * headlines or did not accept them. The feed did not answer with such a failure — it already has an
 * answer on hand — so the failure is named by its own code: the feed's row renders it as a reader
 * fault, not as the feed's answer, and the feed does not go into a pause because of it.
 */
function storageFailure(feed, error) {
  const cause = error?.message ?? String(error);
  console.error(`feed "${feed.name}": the reader's own storage failed:`, cause);
  return Object.assign(new Error(`the storage of the extension did not answer: ${cause}`), {
    code: 'storageUnavailable',
    params: { cause },
    cause: error,
  });
}

/**
 * Fetch one feed and write the new headlines to storage. Nothing here knows about the reads of the
 * same feed running elsewhere — that is the job of `ingestFeed`, which lets one feed be read once.
 *
 * The two ways a read can fail are kept apart on purpose. A feed that refused — a dead address, a
 * 500, a body that is not a feed — is diagnosed on its row: the streak of failures grows, the pause
 * before the next attempt grows with it (see `storage.markFeedChecked`). A failure of the reader's
 * own shelf — the storage that would not take the headlines it just fetched — belongs to this
 * extension, not to the feed: counted as a feed failure it would push a healthy feed into an
 * exponential pause, show it broken on the settings screen and keep the reader from asking it again
 * at all. Such a read is recorded as what it was, an answer that came through.
 * @param {{ nextAlarmAt?: number }} options - the moment of this load's next alarm, so the feed's
 *   diagnosis names it instead of deriving it from `delay_timeout` (see `storage.markFeedChecked`).
 */
async function readFeedOnce(feed, { nextAlarmAt = 0 } = {}) {
  const startedAt = Date.now();
  let result;

  try {
    /* The keys describe the headlines we hold. If they are already gone — `clean_timeout` cleaned
     * the feed, they were deleted, the storage was cleared — asking with them means getting an empty
     * answer instead of a feed and leaving the reader empty until the first edit on the server.
     * Without keys the feed is asked in full, as before; with the same sense they are not sent when
     * one's own shelf is out of sight: a feed is not answerable for storage not answering. */
    let held = [];
    try {
      held = await store.getItems();
    } catch (shelfError) {
      console.warn(`could not read the stored headlines of feed "${feed.name}":`, shelfError?.message ?? shelfError);
    }

    const validators = held.some((item) => item.feedId === feed.id)
      ? { etag: feed.etag, lastModified: feed.lastModified }
      : {};

    const fetched = await readFeed(feed, validators);

    /* Everything past this point is the reader's shelf, not the feed's answer. The keys are written
     * before the headlines so a feed failure does not zero what the feed has just confirmed; a 304
     * updates the key but not the age of the headlines this key describes. A shelf failure does not
     * hinder the keys: for this answer they simply were not written, the previous ones stayed with
     * the feed. */
    try {
      await store.rememberFeedValidators(feed.id, {
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        fetchedAt: fetched.notModified ? 0 : Date.now(),
      });

      if (fetched.notModified) {
        /* "Unchanged": the headlines are the same ones already in storage. There is nothing to parse
         * or add — and therefore nothing to count as "new". */
        result = { added: 0, skipped: 0, seen: 0, notModified: true };
      } else {
        const now = Date.now();
        const candidates = fetched.entries.map((entry) =>
          store.makeItem({
            feed,
            title: entry.title,
            description: entry.description,
            pubDate: entry.pubDate,
            link: entry.link,
            sourceId: entry.sourceId,
            sourceIdType: entry.sourceIdType,
            time: now,
          }),
        );

        const { added, skipped } = await store.addItems(candidates);
        result = { added, skipped, seen: fetched.entries.length, notModified: false };
      }
    } catch (shelfError) {
      await reportFeedHealth(feed.id, { ok: true, time: Date.now(), nextAlarmAt });
      throw storageFailure(feed, shelfError);
    }
  } catch (error) {
    if (!(error instanceof FeedError)) {
      /* A failure with no feed mark on it is a fault of the reader itself: without the helper page
       * there is no way to ask the feed at all. Such a feed gets no diagnosis. */
      await reportFeedHealth(feed.id, { ok: true, time: Date.now(), nextAlarmAt });
      throw error;
    }

    await forgetValidators(feed, error);
    /* The diagnosis is written exactly here: otherwise a feed failure cannot be told apart from a
     * badge or signal fault, and the settings screen would show a healthy feed as broken. */
    await reportFeedHealth(feed.id, { ok: false, error, time: startedAt, nextAlarmAt });
    throw error;
  }

  await reportFeedHealth(feed.id, { ok: true, time: Date.now(), nextAlarmAt });

  return result;
}

/**
 * The feeds *this* worker instance is reading: `feedId` → its load. A `Set` does not work here: a
 * second request for the same feed must not merely be skipped but wait for the first one's answer,
 * so "Refresh" on a feed that is being read right now does not end up without a result.
 */
const readingFeedIds = new Map();

/**
 * Hold a feed for the duration of its read.
 * @returns {Promise<{ read: Promise<object> } | { locked: true } | null>} `read` — the feed is being
 *   read by this same worker; `locked` — another context is reading it (a live ticket in storage);
 *   `null` — this call got the feed: its id stands in `readingFeedIds`, the storage ticket is taken.
 */
async function holdFeedRead(feedId) {
  /* The local check goes first and does not wait for storage: while the worker reads a feed, any
   * other request for the same feed is cut off at once — without a "read the ticket — write the
   * ticket" race. An expired ticket does not hold the feed here: locally it is free, and
   * `tryLockFeed` erases the ticket itself. */
  const running = readingFeedIds.get(feedId);
  if (running) return { read: running.read };

  try {
    if (!(await store.tryLockFeed(feedId))) return { locked: true };
  } catch (error) {
    /* Storage not answering is no reason to refuse a load: the local ticket is enough, and a feed
     * locked because of a storage fault would never be read at all. */
    console.warn(`could not lock feed ${feedId}:`, error?.message ?? error);
  }

  let settle = null;
  const read = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  /* A failure of this load may end up with nobody waiting for it: without a handler the worker
   * would record it as an "unhandled rejection". */
  read.catch(() => {});

  readingFeedIds.set(feedId, { read, settle });
  return null;
}

/** Release a feed: it has been read (or reading failed) — it can be asked again. */
async function releaseFeedRead(feedId) {
  readingFeedIds.delete(feedId);
  try {
    await store.releaseFeedLock(feedId);
  } catch (error) {
    /* The next cleanup sweep removes an expired ticket; the feed is not locked because of it. */
    console.warn(`could not release feed ${feedId}:`, error?.message ?? error);
  }
}

/** The answer to whoever was not given the feed: another context is reading it, and this request has no numbers of its own. */
function lockedFeedResult() {
  /* `busy` tells this answer apart from "0 headlines": the feed is neither empty nor broken — it is
   * being read. The feed's diagnosis (`lastCheckedAt`) stays untouched: whoever holds the feed writes it. */
  return { added: 0, skipped: 0, seen: 0, notModified: false, busy: true };
}

/**
 * Fetch one feed and write the new headlines to storage — once at a time. A feed that is being
 * read right now is not asked a second time: a joiner takes the headlines of the read in progress,
 * and a read from another context (its ticket in storage is still alive) is skipped.
 * @param {{ notify?: boolean, nextAlarmAt?: number }} options - `notify` marks an alarm-driven
 *   (automatic) read, which is the only case that plays the sound. `nextAlarmAt` names the next
 *   alarm of this feed, which only the alarm itself knows.
 * @returns {Promise<object>} `{ added, skipped, seen, notModified, busy }`. Only a feed held by a
 *   read this request did not start answers `busy`; one that joined a read of its own worker answers
 *   with the headlines of that read, as if it had fetched them itself.
 */
async function ingestFeed(feed, { notify = false, nextAlarmAt = 0 } = {}) {
  const held = await holdFeedRead(feed.id);

  if (held?.read) {
    /* The sound and the message belong to the load that started them: a joining request only takes
     * its answer, whatever it is — a failure arrives as the same text. The numbers of this answer
     * are real: the headlines in storage are exactly what this feed brought. */
    const result = await held.read;
    console.info(`feed "${feed.name}": already being read, this request takes its answer`);
    return result;
  }

  if (held?.locked) {
    console.info(`feed "${feed.name}": read by another request, this one is skipped`);
    return lockedFeedResult();
  }

  const entry = readingFeedIds.get(feed.id);
  let result = null;
  let failure = null;

  try {
    result = await readFeedOnce(feed, { nextAlarmAt });
    entry.settle.resolve(result);
  } catch (error) {
    failure = error;
    entry.settle.reject(error);
  } finally {
    await releaseFeedRead(feed.id);
  }

  if (failure) throw failure;

  await updateBadge();

  if (result.added > 0 && notify) {
    // The two notifications of the same automatic event answer to their own flags on the
    // settings screen: «Sound on download» gates the signal, «Show a message» gates the popup that
    // names how many headlines came in. Neither one looks at the other's setting.
    await playSound();
    await notifyIngest(result.added);
  }

  return result;
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

    /* A feed that reads ever worse waits between attempts longer than its alarm
     * (`storage.markFeedChecked` writes `nextRetryAt`). The alarm does not move meanwhile: the extra
     * attempt is simply skipped, so one broken feed does not stretch the automatic load over its
     * whole failure or hinder the others. A feed requested by hand is always read. The alarm of a
     * feed being read right now is skipped the same way: that same address was already asked. */
    const paused = feedPauseRemaining(feed);
    if (paused > 0) {
      console.info(
        `feed "${feed.name}": ${feed.fetchFailureCount} failures in a row, asked again in ${Math.ceil(paused / 60000)} min`,
      );
      return;
    }

    /* When the feed is asked again is the next period of its alarm, not "now + period": a fired
     * alarm has already set its next meeting with Chrome, and the reader names that one. */
    const result = await ingestFeed(feed, {
      notify: true,
      nextAlarmAt: alarmDueAt(alarm, Date.now(), alarmPeriodMinutes(feed.delay_timeout)),
    });
    if (result.busy) return; // another context holds this feed; `ingestFeed` said so
    if (result.notModified) {
      // A 304: the reader asked, the server sent no body, nothing in the reader changed.
      console.info(`feed "${feed.name}": nothing new (304)`);
      return;
    }
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

  /*
   * Read every feed of the list in one click, in the order of that list. One after another on
   * purpose: N feeds at once would be N simultaneous requests from a single click. A feed that
   * refuses to be read does not stop the others — its error comes back with its id, so the page can
   * say how many feeds failed. Like a manual refresh of one feed, this plays no sound. A feed that
   * is being read already is not asked a second time: it waits for that read, and only a read of
   * another context answers `busy`.
   */
  if (message?.type === MSG_REFRESH_ALL_FEEDS) {
    (async () => {
      try {
        const feeds = await store.getFeeds();
        const results = [];
        for (const feed of feeds) {
          try {
            results.push({ feedId: feed.id, ok: true, ...(await ingestFeed(feed, { notify: false })) });
          } catch (error) {
            results.push({ feedId: feed.id, ok: false, error: errorPayload(error) });
          }
        }
        sendResponse({
          ok: true,
          results,
          failed: results.filter((result) => !result.ok).length,
        });
      } catch (error) {
        sendResponse({ ok: false, error: errorPayload(error) });
      }
    })();
    return true;
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
