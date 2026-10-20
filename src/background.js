// Background service worker: polls feeds on their delay_timeout alarms, stores headlines,
// prunes them on clean_timeout, keeps the toolbar badge count and plays the alert sound.

import { alarmDueAt, feedIdFromAlarm, syncAlarms } from './lib/alarms.js';
import { MSG_COUNT, MSG_FETCH_FEED, MSG_FEEDS_CHANGED, MSG_REFRESH_ALL_FEEDS, MSG_REFRESH_FEED } from './lib/messages.js';
import { notifyIngest } from './lib/notify.js';
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
 * Готовить ответ страницы об ошибке: отказ с i18n-кодом (`rss.js`, `lib/offscreen.js`) уходит как
 * `{ code, params }`, чтобы страница подписала его на своём языке; всё остальное — как есть.
 */
function errorPayload(error) {
  if (error?.code) {
    return { code: error.code, params: error.params, message: error.message, status: error.status };
  }
  return error?.message ?? String(error);
}

/**
 * Записать диагноз ленты. Он второстепенен: его собственный сбой (например, хранилище переполнено)
 * не должен подменять собой настоящую причину, по которую загрузку не удалось дочитать.
 */
async function reportFeedHealth(feedId, health) {
  try {
    await store.markFeedChecked(feedId, health);
  } catch (diagnosticError) {
    console.warn(`could not record the health of feed ${feedId}:`, diagnosticError?.message ?? diagnosticError);
  }
}

/**
 * Сервер отверг наш ключ: та же адресная строка отвечает не лентой, а 412 / 404 / 410. Чаще всего
 * причина — валидатор, который лента уже не узнаёт, поэтому следующая попытка идёт без него: упрямый
 * сервер не должен превращать каждую загрузку в отказ.
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
 * Fetch one feed and write the new headlines to storage. Nothing here knows about the reads of the
 * same feed running elsewhere — that is the job of `ingestFeed`, which lets one feed be read once.
 * @param {{ nextAlarmAt?: number }} options - момент следующего будильника этой загрузки, чтобы
 *   диагноз ленты назвал его, а не вывел из `delay_timeout` (см. `storage.markFeedChecked`).
 */
async function readFeedOnce(feed, { nextAlarmAt = 0 } = {}) {
  const startedAt = Date.now();
  let result;

  try {
    /* Ключи описывают те заголовки, которые у нас лежат. Если их уже нет — ленту вычистил
     * `clean_timeout`, их удалили, хранилище очистили, — спрашивать по ним значит получить пустой
     * ответ вместо ленты и оставить читалку пустой до первой правки на сервере. Без ключей ленту
     * просят целиком, как раньше. */
    const held = await store.getItems();
    const validators = held.some((item) => item.feedId === feed.id)
      ? { etag: feed.etag, lastModified: feed.lastModified }
      : {};

    const fetched = await readFeed(feed, validators);

    /* Ответ сервера — это и ключи следующей загрузки: их записываем до того, как разберёмся с
     * заголовками, чтобы отказ ленты не обнулил то, что она только что подтвердила. 304 обновляет
     * ключ, но не возраст заголовков, которые этот ключ описывает. */
    await store.rememberFeedValidators(feed.id, {
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      fetchedAt: fetched.notModified ? 0 : Date.now(),
    });

    if (fetched.notModified) {
      /* «Не изменилось»: заголовки те же, что уже лежат в хранилище. Нечего ни парсить, ни
       * добавлять — а значит, и считать «новыми». */
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
  } catch (error) {
    await forgetValidators(feed, error);
    /* Диагноз пишется именно здесь: иначе отказ ленты не отличить от сбоя бейджа или сигнала, а
     * экран настроек показал бы здоровую ленту сломанной. */
    await reportFeedHealth(feed.id, { ok: false, error, time: startedAt, nextAlarmAt });
    throw error;
  }

  await reportFeedHealth(feed.id, { ok: true, time: Date.now(), nextAlarmAt });

  return result;
}

/**
 * Ленты, которые читает *этот* экземпляр воркера: `feedId` → его загрузка. `Set` здесь не годится:
 * второй запрос той же ленты должен не просто пропуска́ться, а дождаться ответа первого, чтобы
 * «Обновить» на ленте, которую как раз читают, не осталось без результата.
 */
const readingFeedIds = new Map();

/**
 * Занять ленту на время её чтения.
 * @returns {Promise<{ read: Promise<object> } | { locked: true } | null>} `read` — ленту читает этот
 *   же воркер; `locked` — её читает другой контекст (живой билет в хранилище); `null` — лента
 *   досталась этому вызову: её id стоит в `readingFeedIds`, билет хранилища взят.
 */
async function holdFeedRead(feedId) {
  /* Локальная проверка идёт первой и не ждёт хранилища: пока воркер читает ленту, любой другой
   * запрос той же ленты отсекается сразу — без гонки «прочитали билет — записали билет».
   * Просроченный билет при этом ленту не держит: локально она свободна, и `tryLockFeed` стирает
   * его сам. */
  const running = readingFeedIds.get(feedId);
  if (running) return { read: running.read };

  try {
    if (!(await store.tryLockFeed(feedId))) return { locked: true };
  } catch (error) {
    /* Хранилище не ответило — не причина отказать в загрузке: локального билета достаточно,
     * а лента, запертая из-за сбоя хранилища, не прочиталась бы вовсе. */
    console.warn(`could not lock feed ${feedId}:`, error?.message ?? error);
  }

  let settle = null;
  const read = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  /* Отказ этой загрузки может остаться без того, кто его ждёт: без обработчика воркер записал бы
   * его как «unhandled rejection». */
  read.catch(() => {});

  readingFeedIds.set(feedId, { read, settle });
  return null;
}

/** Отдать ленту: её прочитали (или прочесть не удалось) — её могут спросить снова. */
async function releaseFeedRead(feedId) {
  readingFeedIds.delete(feedId);
  try {
    await store.releaseFeedLock(feedId);
  } catch (error) {
    /* Просроченный билет снимает следующая уборка; лента от этого не заперта. */
    console.warn(`could not release feed ${feedId}:`, error?.message ?? error);
  }
}

/** Ответ тому, кому ленту не отдали: её читает другой контекст, и у этого запроса нет своих цифр. */
function lockedFeedResult() {
  /* `busy` отличает этот ответ от «0 заголовков»: лента не пуста и не сломана — её читают.
   * Диагноз ленты (`lastCheckedAt`) остаётся нетронутым: его пишет тот, кто её держит. */
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
    /* Звук и сообщение принадлежат загрузке, которая их начала: присоединившийся запрос только
     * берёт её ответ, каким бы он ни был — отказ приходит тем же текстом. Цифры этого ответа
     * настоящие: заголовки в хранилище именно эту ленту и принесли. */
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
    // settings screen: «Звук» gates the signal, «Показывать сообщение» gates the popup that
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

    /* Лента, которая читается всё хуже, ждёт между попытками дольше своего будильника
     * (`storage.markFeedChecked` пишет `nextRetryAt`). Будильник при этом не двигается: лишняя
     * попытка просто пропускается, поэтому одна битая лента не растягивает автоматическую загрузку
     * на весь свой отказ и не мешает остальным. Запрошенную вручную ленту читаем всегда. Так же
     * пропускается будильник ленты, которую читают прямо сейчас: тот же адрес уже спрошен. */
    const paused = feedPauseRemaining(feed);
    if (paused > 0) {
      console.info(
        `feed "${feed.name}": ${feed.fetchFailureCount} failures in a row, asked again in ${Math.ceil(paused / 60000)} min`,
      );
      return;
    }

    /* Когда ленту спросят снова — это следующий период её будильника, а не «сейчас + период»:
     * сработавший будильник Chrome уже ставит себе следующую встречу, и читалка называет её. */
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
