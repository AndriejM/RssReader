// Сообщение об автоматической загрузке, принёсшей заголовки: popup самого Chrome
// (`chrome.notifications`), потому что у service worker'а нет страницы, куда можно положить
// текст. Показывается только когда на экране глобальных настроек включён флаг `show_message`.
//
// Язык подписи — тот, что записан на экране настроек: `store.getLanguage()` попутно кладёт его
// в кэш `i18n.t()`. Worker'у localStorage недоступен, но кэш в памяти у него свой, а при
// отсутствии записи fallback берёт язык браузера.
//
// Клик по сообщению открывает читалку (`wireNotificationClicks`): popup называет, сколько
// заголовков пришло, — и смотреть их нужно там, где их показывает расширение.

import { t } from './i18n.js';
import { getLanguage, getShowMessage } from './storage.js';
import { READER_PAGE, focusOrCreateTab } from './tabs.js';
import { NOTIFY_MAX_ACTIVE, NOTIFY_TTL_SECONDS } from './util.js';

const NOTIFICATION_ID = 'rss-reader:ingest';
const ID_PREFIX = `${NOTIFICATION_ID}:`;

/*
  Сообщения, которые расширение вынесло на экран и ещё не сняло, — от старых к новым. Список живёт
  в памяти worker'а, а её снимают между делами: `chrome.notifications.getAll()` называет эти id при
  следующем запуске, поэтому список — не начало, а только то, что worker успел запомнить.
*/
const shown = [];

/** Счётчик внутри одного id: две ленты, отчитавшиеся в одну миллисекунду, не получают один id. */
let sequence = 0;

/** id сообщения: время события и счётчик внутри него. */
export function notificationId(now, step) {
  return `${ID_PREFIX}${now}:${step}`;
}

/** Время, которое `notificationId` прячет в своём втором поле, — или 0, если id не читается. */
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
 * Снять лишнее: одно автоматическое событие читает одну ленту и рапортует о себе само, поэтому
 * сорок лент, чьи будильники приходят в одну минуту, дают сорок сообщений. Chrome их не
 * ограничивает, а очередь системного центра тем временем перестаёт быть очередью новостей.
 */
async function trimShown() {
  while (shown.length > NOTIFY_MAX_ACTIVE) {
    const oldest = shown[0];
    forget(oldest);
    await chrome.notifications.clear(oldest);
  }
}

/**
 * Снять то, что пережило память worker'а: `getAll` даёт одни id, без времени, зато время лежит в
 * самом id. Список того, что worker помнит, строится по нему заново — иначе лимит считал бы только
 * новые сообщения, а старые висели бы поверх него.
 *
 * @param {string[]} liveIds Сообщения, которые Chrome называет живыми
 * @returns {Promise<string[]>} Снятые сообщения — от старых к новым
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
 * @param {number} count Сколько новых заголовков принесла загрузка
 * @returns {Promise<boolean>} Показался ли popup
 */
export async function notifyIngest(count) {
  if (!(count > 0)) return false;
  if (!(await getShowMessage())) return false;

  // Язык берётся из того же `settings`, что и флаг: `getLanguage` кладёт его в кэш `t()`.
  await getLanguage();

  // Уникальный id на каждое событие: несколько лент, загрузившихся в одну минуту, получают
  // по своему сообщению, а не переписывают друг друга.
  const id = notificationId(Date.now(), (sequence += 1));
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      // От service worker'а относительный iconUrl не разрешается — Chrome отвечает
      // «Unable to download all specified images». Абсолютный адрес расширения работает.
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t('app.name'),
      message: t('notify.news', { count }),
    });
    remember(id);
    await trimShown();
    // Chrome держит уведомление до закрытия пользователем; это короткое сообщение о загрузке,
    // поэтому оно снимает себя само.
    setTimeout(() => void chrome.notifications.clear(id), NOTIFY_TTL_SECONDS * 1000);
    return true;
  } catch (error) {
    console.warn('load message did not show:', error?.message ?? error);
    forget(id);
    return false;
  }
}

/**
 * Клик по сообщению: оно снимается с экрана и из списка, державшего для него место, а читалка —
 * там, где живут заголовки, о которых оно сообщило — та же вкладка, что поднимает и иконка в
 * тулбаре.
 */
export async function answerNotificationClick(id) {
  await chrome.notifications.clear(id);
  forget(id);
  return focusOrCreateTab(READER_PAGE);
}

/* Слушатели стоят один раз: worker может быть вычислен заново, а Chrome не должен отвечать на один
   клик дважды. */
let wired = false;

/**
 * Слушатели ставит worker, как и остальные свои слушатели (`chrome.action.onClicked`): им нужно,
 * чтобы они стояли до того, как Chrome позовёт их по событию.
 */
export function wireNotificationClicks() {
  if (wired) return;
  wired = true;

  chrome.notifications.onClicked.addListener((id) => {
    void answerNotificationClick(id);
  });

  // Снятие сообщения освобождает место в лимите: и то, что снял пользователь, и то, что сняло
  // само себя по `NOTIFY_TTL_SECONDS`.
  chrome.notifications.onClosed.addListener((id) => forget(id));

  // Сообщения, пережившие память worker'а, снимаются при его запуске: иначе лимит считает только
  // то, что worker помнит, а очередь системного центра — всё остальное.
  void chrome.notifications
    .getAll()
    .then((live) => pruneLiveNotifications(Object.keys(live ?? {})))
    .catch(() => {});
}
