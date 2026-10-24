// A message about an automatic load that brought headlines: Chrome's own popup
// (`chrome.notifications`), because a service worker has no page to put text on. It shows only
// when the `show_message` flag is on on the global settings screen.
//
// The label's language is the one recorded on the settings screen: `store.getLanguage()` also
// drops it into the `i18n.t()` cache. localStorage is unavailable to the worker, but it has its
// own in-memory cache, and with no record stored the fallback takes the browser's language.
//
// A click on the message opens the reader (`wireNotificationClicks`): the popup names how many
// headlines arrived — and they must be viewed where the extension shows them.

import { t } from './i18n.js';
import { getLanguage, getShowMessage } from './storage.js';
import { READER_PAGE, focusOrCreateTab } from './tabs.js';
import { NOTIFY_MAX_ACTIVE, NOTIFY_TTL_SECONDS } from './util.js';

const NOTIFICATION_ID = 'rss-reader:ingest';
const ID_PREFIX = `${NOTIFICATION_ID}:`;

/*
  The messages the extension has put on screen and not yet cleared — from oldest to newest. The
  list lives in the worker's memory, which is dropped between jobs: `chrome.notifications.getAll()`
  names these ids at the next run, so the list is not a beginning but only what the worker managed
  to remember.
*/
const shown = [];

/** A counter inside one id: two feeds reporting in the same millisecond do not share one id. */
let sequence = 0;

/** The message's id: the event's time and the counter inside it. */
export function notificationId(now, step) {
  return `${ID_PREFIX}${now}:${step}`;
}

/** The time `notificationId` hides in its second field — or 0 if the id cannot be read. */
function notificationTime(id) {
  if (!String(id ?? '').startsWith(ID_PREFIX)) return 0;
  const stamp = Number(id.slice(ID_PREFIX.length).split(':')[0]);
  return Number.isFinite(stamp) ? stamp : 0;
}

function remember(id) {
  if (!shown.includes(id)) shown.push(id);
}

function forget(id) {
  const at = shown.indexOf(id);
  if (at >= 0) shown.splice(at, 1);
}

/**
 * Clear the excess: one automatic event reads one feed and reports on itself, so forty feeds whose
 * alarms arrive in the same minute give forty messages. Chrome does not limit them, and meanwhile
 * the system center's queue stops being a queue of news.
 */
async function trimShown() {
  while (shown.length > NOTIFY_MAX_ACTIVE) {
    const oldest = shown[0];
    forget(oldest);
    await chrome.notifications.clear(oldest);
  }
}

/**
 * Clear what survived the worker's memory: `getAll` gives only ids, without time, but the time lies
 * in the id itself. The list of what the worker remembers is rebuilt from it — otherwise the limit
 * would count only the new messages while the old ones piled on top of it.
 *
 * @param {string[]} liveIds Messages Chrome names as live
 * @returns {Promise<string[]>} Cleared messages — from oldest to newest
 */
export async function pruneLiveNotifications(liveIds) {
  const ours = liveIds
    .filter((id) => String(id).startsWith(ID_PREFIX))
    .sort((first, second) => notificationTime(first) - notificationTime(second));

  shown.length = 0;
  shown.push(...ours);

  const cleared = [];
  while (shown.length > NOTIFY_MAX_ACTIVE) {
    const oldest = shown.shift();
    cleared.push(oldest);
    await chrome.notifications.clear(oldest);
  }
  return cleared;
}

/**
 * @param {number} count How many new headlines the load brought
 * @returns {Promise<boolean>} Whether the popup showed
 */
export async function notifyIngest(count) {
  if (!(count > 0)) return false;
  if (!(await getShowMessage())) return false;

  // The language comes from the same `settings` as the flag: `getLanguage` puts it into the `t()` cache.
  await getLanguage();

  // A unique id for every event: several feeds loaded in the same minute each get their own
  // message instead of overwriting one another.
  const id = notificationId(Date.now(), (sequence += 1));
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      // From a service worker a relative iconUrl is not resolved — Chrome answers
      // "Unable to download all specified images". An absolute extension URL works.
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t('app.name'),
      message: t('notify.news', { count }),
    });
    remember(id);
    await trimShown();
    // Chrome keeps a notification until the user closes it; this is a short load message,
    // so it clears itself.
    setTimeout(() => void chrome.notifications.clear(id), NOTIFY_TTL_SECONDS * 1000);
    return true;
  } catch (error) {
    console.warn('load message did not show:', error?.message ?? error);
    forget(id);
    return false;
  }
}

/**
 * A click on the message: it is cleared from the screen and from the list that kept its place, and
 * the reader — where the headlines it reported on live — is raised in the same tab as the toolbar
 * icon does.
 */
export async function answerNotificationClick(id) {
  await chrome.notifications.clear(id);
  forget(id);
  return focusOrCreateTab(READER_PAGE);
}

/* The listeners are placed once: the worker may be torn down and rebuilt, and Chrome must not
   answer one click twice. */
let wired = false;

/**
 * The worker places the listeners, like all its other listeners (`chrome.action.onClicked`): they
 * need to stand before Chrome calls them on an event.
 */
export function wireNotificationClicks() {
  if (wired) return;
  wired = true;

  chrome.notifications.onClicked.addListener((id) => {
    void answerNotificationClick(id);
  });

  // Clearing a message frees a slot in the limit: both what the user cleared and what cleared
  // itself after `NOTIFY_TTL_SECONDS`.
  chrome.notifications.onClosed.addListener((id) => forget(id));

  // Messages that survived the worker's memory are cleared at its start: otherwise the limit counts
  // only what the worker remembers, while the system center's queue holds everything else.
  void chrome.notifications
    .getAll()
    .then((live) => pruneLiveNotifications(Object.keys(live ?? {})))
    .catch(() => {});
}
