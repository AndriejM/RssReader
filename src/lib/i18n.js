// Все тексты интерфейса расширения собраны здесь: чтобы добавить язык, достаточно добавить
// словарь, а не искать строки по разметке и скриптам. Страница применяет их через `applyI18n`,
// а динамические сообщения строятся через `t(key, params)`.
//
// Ключи с placeholders вида {name} подставляют значения из params; порядок ключей в словарях
// одинаков, поэтому словари легко сверять между собой. Словарь по умолчанию русский, поэтому
// чистые хелперы (`util.js`) остаются тестируемыми без доступа к chrome.storage.

/** Ключ localStorage, куда кэшируется выбранный язык для синхронного `t()` до чтения chrome.storage. */
export const LANGUAGE_CACHE_KEY = 'rss-reader:language';

/** Поддерживаемые языки. Первый — базовый словарь, с которым сверяются остальные. */
export const LANGUAGES = ['ru', 'en'];

/** Язык по умолчанию, когда в настройках его нет и язык браузера не поддерживается. */
export const FALLBACK_LANGUAGE = 'en';

/** Нативное имя каждого языка — показывается в picker как «Русский», «English». */
export const LANGUAGE_NAMES = {
  ru: 'Русский',
  en: 'English',
};

/** Код локали для `<html lang>`, CSS и `toLocaleDateString`. */
export const LOCALES = {
  ru: 'ru-RU',
  en: 'en-US',
};

const DICTIONARIES = {
  ru: {
    'app.name': 'RSS Reader',

    'common.loading': 'Загрузка…',
    'common.unknownError': 'неизвестная ошибка',
    'common.publishedShort': 'опубл.',
    'common.untitled': 'Заголовок без названия',
    'common.theme.light': 'Светлая тема',
    'common.theme.dark': 'Тёмная тема',

    'reader.count.tooltip': 'Заголовков в хранилище',
    'reader.clearAll.tooltip': 'Удалить все заголовки из хранилище',
    'reader.clearAll.aria': 'Удалить все',
    'reader.feedsSettings.tooltip': 'Настройки лент',
    'reader.feedsSettings.aria': 'Настройки лент',
    'reader.globalSettings.tooltip': 'Глобальные настройки',
    'reader.globalSettings.aria': 'Глобальные настройки',
    'reader.theme.tooltip': 'Переключить тему',

    'reader.feeds.panelAria': 'Список RSS лент',
    'reader.feeds.title': 'Ленты',
    'reader.feeds.empty': 'Лент нет. Добавьте их на экране «Настройки лент».',
    'reader.refresh.tooltip': 'Загрузить заголовки выбранной ленты',
    'reader.refresh.aria': 'Обновить',
    'reader.feed.itemMeta': '{count} загол. · обновл. каждые {duration}',

    'reader.headlines.panelAria': 'Заголовки новостей',
    'reader.headlines.title': 'Заголовки',
    'reader.headlines.emptyNoFeed': 'Выберите ленту слева.',
    'reader.headlines.emptyForFeed': 'Для этой ленты пока нет заголовков в хранилище.',
    'reader.published': 'опубл. {since}',

    'reader.content.panelAria': 'Содержание новости',
    'reader.content.delete.tooltip': 'Удалить заголовок из списка и из хранилища',
    'reader.content.delete.aria': 'Удалить',
    'reader.content.empty': 'Выберите заголовок новости в средней панели.',
    'reader.placeholder.inMiddle': 'Заголовки этой ленты — в средней панели.',
    'reader.placeholder.deletedLast': 'Заголовок удалён: в этой ленте больше ничего не осталось.',
    'reader.placeholder.expired': 'Открытый заголовок удалён из хранилища: истёк clean_timeout.',
    'reader.source': '{name} · опубл. {since}',
    'reader.openOriginal.tooltip': 'Открыть оригинал в новой вкладке',
    'reader.content.noDescription': 'Нет описания в хранилище для этой новости.',
    'reader.content.originalByLink': 'Оригинал доступен по ссылке в заголовке новости.',
    'reader.content.truncated': 'Описание обрезано из-за ограничения длины.',
    'reader.refresh.noFeed': 'Сначала выберите ленту.',
    'reader.refresh.failed': 'Не удалось обновить ленту: {error}',

    'feeds.title': 'Настройки RSS лент',
    'feeds.add': 'Добавить ленту',
    'feeds.global': 'Глобальные настройки',
    'feeds.reader': 'Открыть читалку',
    'feeds.empty': 'Лент нет. Нажмите «Добавить ленту».',
    'feeds.hint':
      'delay_timeout — период автоматической загрузки заголовков (минуты, Chrome не позволяет реже 1 минуты). clean_timeout — сколько новость хранится в localstorage после загрузки (минуты), по истечении этого времени она удаляется автоматически.',

    'feeds.field.name': 'name — название ленты',
    'feeds.field.namePlaceholder': 'Название ленты',
    'feeds.field.rss': 'rss_link — ссылка для считывания новостей',
    'feeds.field.delay': 'delay_timeout — период загрузки заголовков',
    'feeds.field.delayUnit': 'мин (сейчас {duration})',
    'feeds.field.clean': 'clean_timeout — время хранения новости',
    'feeds.field.cleanUnit': 'мин (сейчас {duration})',

    'feeds.save': 'Сохранить',
    'feeds.addCard': 'Добавить ленту',
    'feeds.loadNow': 'Загрузить сейчас',
    'feeds.delete': 'Удалить',
    'feeds.cancel': 'Отменить',
    'feeds.draftNote': 'Новая лента — сохраните её, чтобы включить автоматическую загрузку',
    'feeds.stats': 'в хранилище: {count}',
    'feeds.status.saved': 'Сохранено',
    'feeds.status.checkFields': 'Проверьте поля',
    'feeds.status.loadError': 'Ошибка загрузки',
    'feeds.confirmDelete': 'Удалить ленту «{name}» вместе с её заголовками?',
    'feeds.result': 'Новых: {added}, считано: {seen}{read}',
    'feeds.resultRead': ', уже прочитано: {skipped}',
    'feeds.error.name': 'Укажите название ленты',
    'feeds.error.nameTooLong': 'Название слишком длинное',
    'feeds.error.link': 'Ссылка должна начинаться с http:// или https://',
    'feeds.error.delay': 'Период загрузки — не меньше 1 минуты',
    'feeds.error.clean': 'Время хранения — не меньше 1 минуты',

    'settings.title': 'Глобальные настройки',
    'settings.feeds': 'Настройки лент',
    'settings.reader': 'Открыть читалку',
    'settings.save': 'Записать',
    'settings.clearRead': 'Забыть прочитанные',
    'settings.ttl': 'через сколько дней забыть прочитанные',
    'settings.daysUnit': 'дней',
    'settings.sound': 'Звук при скачивании',
    'settings.soundNone': 'Без звука',
    'settings.soundName': 'имя файла',
    'settings.soundPlay.tooltip': 'Прослушать выбранный сигнал',
    'settings.soundPlay.aria': 'Прослушать выбранный сигнал',
    'settings.info.tooltip': 'Как работают прочитанные метки',
    'settings.info.aria': 'Как работают прочитанные метки',
    'settings.hint':
      'Заголовок, удалённый из читалки, помечается прочитанным, чтобы лента не вернула его при следующей загрузке. Через несколько дней метка сгорает, и новость может появиться снова. «Забыть прочитанные» удаляет все метки сразу — удалённые новости вернутся в ленты.',
    'settings.readStats.none': 'прочитанных меток нет',
    'settings.readStats': 'прочитанных меток: {count} · горят через {ttl}',
    'settings.soundStats': 'сейчас играет: {name}',
    'settings.save.tooltipDirty': 'Записать срок, звук и язык в хранилище',
    'settings.save.tooltipClean': 'Все поля уже записаны',
    'settings.status.pending': 'Изменения не записаны',
    'settings.status.error': 'Не записано',
    'settings.status.nothing': 'Нечего записывать',
    'settings.status.saved': 'Записано: {parts}',
    'settings.status.nothingToPlay': 'Без звука — играть нечего',
    'settings.status.playError': 'Не удалось прослушать сигнал',
    'settings.confirmLeave': 'Изменения не записаны. Уйти без записи?',
    'settings.confirmClear': 'Забыть все прочитанные метки? Удалённые новости могут вернуться в ленты.',
    'settings.status.cleared': 'Забыто прочитанных: {count}',
    'settings.status.emptyRead': 'Список прочитанных уже пуст',
    'settings.ttlError': 'Целое число от {min} до {max} дней',
    'settings.ttlDays': '{days} дн',
    'settings.ttlYears': '{days} дн ({years} г)',
    'settings.savedTtl': 'горят через {ttl}',
    'settings.savedSound': 'звук: {name}',
    'settings.savedLanguage': 'язык: {name}',
    'settings.soundDescNone': 'без звука',
    'settings.language': 'Язык интерфейса',

    'errors.feedNotFound': 'Лента не найдена',
    'errors.feedUrl': 'Ссылка ленты должна начинаться с http:// или https://',
    'errors.feedFetch': 'Не удалось загрузить ленту: {cause}',
    'errors.feedStatus': 'Лента ответила {status} {statusText}',
    'errors.feedEmpty': 'Лента вернула пустой ответ',
    'errors.feedNotXml': 'Ответ не похож на корректный XML ленты',
    'errors.feedEmptyXml': 'Пустой XML ленты',
    'errors.feedUnknown': 'не удалось прочитать ленту: {message}',
    'errors.offscreenUnavailable': 'не удалось открыть служебную страницу расширения',
    'errors.offscreenNoReply': 'служебная страница расширения не ответила{cause}',
    'errors.articleFetch': 'Не удалось загрузить страницу: {cause}',
    'errors.articleStatus': 'Страница ответила {status} {statusText}',
    'errors.articleType': 'Неподдерживаемый тип содержимого: {type}',
    'errors.articleEmpty': 'На странице нет содержимого',

    'units.empty': '—',
    'units.minutes': '{n} мин',
    'units.hours': '{n} ч',
    'units.days': '{n} дн',
    'units.justNow': 'только что',
    'units.minutesAgo': '{n} мин назад',
    'units.hoursAgo': '{n} ч назад',
    'units.daysAgo': '{n} дн назад',
  },

  en: {
    'app.name': 'RSS Reader',

    'common.loading': 'Loading…',
    'common.unknownError': 'unknown error',
    'common.publishedShort': 'pub.',
    'common.untitled': 'Untitled headline',
    'common.theme.light': 'Light theme',
    'common.theme.dark': 'Dark theme',

    'reader.count.tooltip': 'Headlines in storage',
    'reader.clearAll.tooltip': 'Delete every headline from storage',
    'reader.clearAll.aria': 'Delete all',
    'reader.feedsSettings.tooltip': 'Feed settings',
    'reader.feedsSettings.aria': 'Feed settings',
    'reader.globalSettings.tooltip': 'Global settings',
    'reader.globalSettings.aria': 'Global settings',
    'reader.theme.tooltip': 'Toggle theme',

    'reader.feeds.panelAria': 'List of RSS feeds',
    'reader.feeds.title': 'Feeds',
    'reader.feeds.empty': 'No feeds yet. Add them on the Feed settings screen.',
    'reader.refresh.tooltip': 'Load headlines for the selected feed',
    'reader.refresh.aria': 'Refresh',
    'reader.feed.itemMeta': '{count} headlines · refresh every {duration}',

    'reader.headlines.panelAria': 'News headlines',
    'reader.headlines.title': 'Headlines',
    'reader.headlines.emptyNoFeed': 'Select a feed on the left.',
    'reader.headlines.emptyForFeed': 'This feed has no headlines in storage yet.',
    'reader.published': 'pub. {since}',

    'reader.content.panelAria': 'News content',
    'reader.content.delete.tooltip': 'Delete the headline from the list and from storage',
    'reader.content.delete.aria': 'Delete',
    'reader.content.empty': 'Select a news headline in the middle panel.',
    'reader.placeholder.inMiddle': 'This feed’s headlines are in the middle panel.',
    'reader.placeholder.deletedLast': 'Headline deleted: nothing else is left in this feed.',
    'reader.placeholder.expired': 'The open headline left storage: clean_timeout expired.',
    'reader.source': '{name} · pub. {since}',
    'reader.openOriginal.tooltip': 'Open the original in a new tab',
    'reader.content.noDescription': 'No description stored for this news.',
    'reader.content.originalByLink': 'The original is available at the link in the headline.',
    'reader.content.truncated': 'Description truncated at the length limit.',
    'reader.refresh.noFeed': 'Select a feed first.',
    'reader.refresh.failed': 'Failed to refresh the feed: {error}',

    'feeds.title': 'RSS feed settings',
    'feeds.add': 'Add feed',
    'feeds.global': 'Global settings',
    'feeds.reader': 'Open the reader',
    'feeds.empty': 'No feeds yet. Press “Add feed”.',
    'feeds.hint':
      'delay_timeout — how often headlines are fetched automatically (minutes; Chrome does not allow less than 1 minute). clean_timeout — how long a news stays in localstorage after it is loaded (minutes); after that time it is removed automatically.',

    'feeds.field.name': 'name — feed name',
    'feeds.field.namePlaceholder': 'Feed name',
    'feeds.field.rss': 'rss_link — link used to read the news',
    'feeds.field.delay': 'delay_timeout — headline fetch period',
    'feeds.field.delayUnit': 'min (currently {duration})',
    'feeds.field.clean': 'clean_timeout — how long a news is kept',
    'feeds.field.cleanUnit': 'min (currently {duration})',

    'feeds.save': 'Save',
    'feeds.addCard': 'Add feed',
    'feeds.loadNow': 'Load now',
    'feeds.delete': 'Delete',
    'feeds.cancel': 'Cancel',
    'feeds.draftNote': 'New feed — save it to turn on automatic loading',
    'feeds.stats': 'in storage: {count}',
    'feeds.status.saved': 'Saved',
    'feeds.status.checkFields': 'Check the fields',
    'feeds.status.loadError': 'Loading failed',
    'feeds.confirmDelete': 'Delete the feed “{name}” together with its headlines?',
    'feeds.result': 'New: {added}, parsed: {seen}{read}',
    'feeds.resultRead': ', already read: {skipped}',
    'feeds.error.name': 'Enter a feed name',
    'feeds.error.nameTooLong': 'The name is too long',
    'feeds.error.link': 'The link must start with http:// or https://',
    'feeds.error.delay': 'Fetch period — at least 1 minute',
    'feeds.error.clean': 'Storage time — at least 1 minute',

    'settings.title': 'Global settings',
    'settings.feeds': 'Feed settings',
    'settings.reader': 'Open the reader',
    'settings.save': 'Save',
    'settings.clearRead': 'Forget read',
    'settings.ttl': 'after how many days to forget read headlines',
    'settings.daysUnit': 'days',
    'settings.sound': 'Sound on download',
    'settings.soundNone': 'No sound',
    'settings.soundName': 'file name',
    'settings.soundPlay.tooltip': 'Preview the selected signal',
    'settings.soundPlay.aria': 'Preview the selected signal',
    'settings.info.tooltip': 'How the read markers work',
    'settings.info.aria': 'How the read markers work',
    'settings.hint':
      'A headline deleted from the reader is marked as read so a feed does not bring it back on the next load. After a few days the marker burns out and the news may appear again. “Forget read” deletes every marker at once — the headlines you removed before come back to the feeds.',
    'settings.readStats.none': 'no read markers',
    'settings.readStats': 'read markers: {count} · burn out after {ttl}',
    'settings.soundStats': 'now playing: {name}',
    'settings.save.tooltipDirty': 'Write the horizon, the sound and the language to storage',
    'settings.save.tooltipClean': 'Every field is already saved',
    'settings.status.pending': 'Changes are not saved',
    'settings.status.error': 'Not saved',
    'settings.status.nothing': 'Nothing to save',
    'settings.status.saved': 'Saved: {parts}',
    'settings.status.nothingToPlay': 'No sound — nothing to play',
    'settings.status.playError': 'Could not play the signal',
    'settings.confirmLeave': 'Changes are not saved. Leave without saving?',
    'settings.confirmClear': 'Forget every read marker? The news you deleted may return to the feeds.',
    'settings.status.cleared': 'Forgotten read markers: {count}',
    'settings.status.emptyRead': 'The read list is already empty',
    'settings.ttlError': 'A whole number from {min} to {max} days',
    'settings.ttlDays': '{days} d',
    'settings.ttlYears': '{days} d ({years} yr)',
    'settings.savedTtl': 'burn out after {ttl}',
    'settings.savedSound': 'sound: {name}',
    'settings.savedLanguage': 'language: {name}',
    'settings.soundDescNone': 'no sound',
    'settings.language': 'Interface language',

    'errors.feedNotFound': 'Feed not found',
    'errors.feedUrl': 'The feed link must start with http:// or https://',
    'errors.feedFetch': 'Failed to load the feed: {cause}',
    'errors.feedStatus': 'The feed replied {status} {statusText}',
    'errors.feedEmpty': 'The feed returned an empty response',
    'errors.feedNotXml': 'The response does not look like valid feed XML',
    'errors.feedEmptyXml': 'Empty feed XML',
    'errors.feedUnknown': 'could not read the feed: {message}',
    'errors.offscreenUnavailable': 'could not open the extension helper page',
    'errors.offscreenNoReply': 'the extension helper page did not answer{cause}',
    'errors.articleFetch': 'Failed to load the page: {cause}',
    'errors.articleStatus': 'The page replied {status} {statusText}',
    'errors.articleType': 'Unsupported content type: {type}',
    'errors.articleEmpty': 'The page has no content',

    'units.empty': '—',
    'units.minutes': '{n} min',
    'units.hours': '{n} h',
    'units.days': '{n} d',
    'units.justNow': 'just now',
    'units.minutesAgo': '{n} min ago',
    'units.hoursAgo': '{n} h ago',
    'units.daysAgo': '{n} d ago',
  },
};

/** Cached language so `t()` can run synchronously inside render loops like `humanDuration`. */
let cached = null;

export function normalizeLanguage(value) {
  return LANGUAGES.includes(value) ? value : null;
}

/**
 * Язык из localStorage: страницы расширения одного происхождения видят один и тот же localStorage,
 * поэтому читалка и экран настроек согласуют язык синхронно, до того как разрешится асинхронное
 * чтение chrome.storage.
 */
export function getLanguageCache() {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_CACHE_KEY));
  } catch {
    return null;
  }
}

export function setLanguageCache(language) {
  cached = language;
  try {
    localStorage.setItem(LANGUAGE_CACHE_KEY, language);
  } catch {
    // Some environments block localStorage; chrome.storage still carries the value.
  }
}

/**
 * Язык браузера в форме поддерживаемого кода: `ru-RU`/`en-GB` → `ru`/`en`. Первый поддерживаемый
 * из `navigator.languages`. Если браузер говорит на языке, которого в словаре нет — null.
 */
export function detectBrowserLanguage() {
  const nav = globalThis.navigator;
  const candidates = [
    nav?.language,
    ...(Array.isArray(nav?.languages) ? nav.languages : []),
  ];
  for (const candidate of candidates) {
    const match = normalizeLanguage(String(candidate ?? '').toLowerCase().split('-')[0]);
    if (match) return match;
  }
  return null;
}

/** Язык для синхронного рендера: уже выбранный, иначе кэш localStorage, иначе язык браузера. */
export function currentLanguage() {
  cached = cached ?? getLanguageCache() ?? detectBrowserLanguage() ?? FALLBACK_LANGUAGE;
  return cached;
}

/** Подставить `{key}` placeholders из params в строку. */
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] !== undefined && params[name] !== null ? String(params[name]) : match,
  );
}

/** Строка текущего языка; недостающий ключ берётся из словаря по умолчанию (ru). */
export function t(key, params) {
  const lang = currentLanguage();
  const dictionary = DICTIONARIES[lang] ?? DICTIONARIES[LANGUAGES[0]];
  const template =
    dictionary[key] ?? DICTIONARIES[LANGUAGES[0]][key] ?? key;
  return interpolate(template, params);
}

/** Ключи словаря языка: тест сверяет их с базовым словарём, чтобы новый язык не был половинчатым. */
export function dictionaryKeys(lang = LANGUAGES[0]) {
  return Object.keys(DICTIONARIES[lang] ?? {});
}

/** Единицы измерения (мин/ч/дн, «назад») для текущего языка — хелперы `util.js` берут их отсюда. */
export function unitLabels(lang = currentLanguage()) {
  const dictionary = DICTIONARIES[lang] ?? DICTIONARIES[LANGUAGES[0]];
  return {
    empty: dictionary['units.empty'],
    minutes: dictionary['units.minutes'],
    hours: dictionary['units.hours'],
    days: dictionary['units.days'],
    justNow: dictionary['units.justNow'],
    minutesAgo: dictionary['units.minutesAgo'],
    hoursAgo: dictionary['units.hoursAgo'],
    daysAgo: dictionary['units.daysAgo'],
    locale: LOCALES[lang] ?? LOCALES[FALLBACK_LANGUAGE],
  };
}

/**
 * Применить словарь к странице: текст или атрибут элемента берутся из i18n-атрибутов
 * (`data-i18n`, `data-i18n-title`, `data-i18n-aria`), а `<html lang>` приводится к выбранному
 * языку. Вызывается после загрузки языка и при каждом его изменении.
 */
export function applyI18n(root = document) {
  document.documentElement.lang = LOCALES[currentLanguage()] ?? currentLanguage();

  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.getAttribute('data-i18n-title'));
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  }
}

/**
 * Загрузить язык из настройки в кэш и вернуть его — вызывается при старте каждой страницы.
 * Сам язык выбирает `store`; здесь только переносим его в кэш для синхронного `t()`.
 */
export function adoptLanguage(language) {
  const normalized = normalizeLanguage(language) ?? FALLBACK_LANGUAGE;
  setLanguageCache(normalized);
  return normalized;
}
