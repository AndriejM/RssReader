// Сообщение об автоматической загрузке, принёсшей заголовки: popup самого Chrome
// (`chrome.notifications`), потому что у service worker'а нет страницы, куда можно положить
// текст. Показывается только когда на экране глобальных настроек включён флаг `show_message`.
//
// Язык подписи — тот, что записан на экране настроек: `store.getLanguage()` попутно кладёт его
// в кэш `i18n.t()`. Worker'у localStorage недоступен, но кэш в памяти у него свой, а при
// отсутствии записи fallback берёт язык браузера.

import { t } from './i18n.js';
import { getLanguage, getShowMessage } from './storage.js';
import { NOTIFY_TTL_SECONDS } from './util.js';

const NOTIFICATION_ID = 'rss-reader:ingest';

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
  const id = `${NOTIFICATION_ID}:${Date.now()}`;
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      // От service worker'а относительный iconUrl не разрешается — Chrome отвечает
      // «Unable to download all specified images». Абсолютный адрес расширения работает.
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t('app.name'),
      message: t('notify.news', { count }),
    });
    // Chrome держит уведомление до закрытия пользователем; это короткое сообщение о загрузке,
    // поэтому оно снимает себя само.
    setTimeout(() => void chrome.notifications.clear(id), NOTIFY_TTL_SECONDS * 1000);
    return true;
  } catch (error) {
    console.warn('load message did not show:', error?.message ?? error);
    return false;
  }
}
