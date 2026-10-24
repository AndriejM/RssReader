// All interface texts of the extension are gathered here: to add a language it is enough to add a
// dictionary instead of hunting for strings through markup and scripts. The page applies them via
// `applyI18n`, and dynamic messages are built via `t(key, params)`.
//
// Keys with placeholders like {name} substitute values from params; the key order in the
// dictionaries is the same, so the dictionaries are easy to compare against each other. The default
// dictionary is FALLBACK_LANGUAGE (English), so the pure helpers (`util.js`) stay testable without
// access to chrome.storage.

/** The localStorage key where the chosen language is cached for a synchronous `t()` before chrome.storage is read. */
export const LANGUAGE_CACHE_KEY = 'rss-reader:language';

/** Supported languages. The first is the base dictionary the others are compared against. */
export const LANGUAGES = ['ru', 'en', 'uk', 'pl', 'de', 'fr', 'es'];

/** The default language when settings hold none and the browser language is unsupported. */
export const FALLBACK_LANGUAGE = 'en';

/** Each language's native name — shown in the picker as «Русский», «English». */
export const LANGUAGE_NAMES = {
  ru: 'Русский',
  en: 'English',
  uk: 'Українська',
  pl: 'Polski',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
};

/** The locale code for `<html lang>`, CSS and `toLocaleDateString`. */
export const LOCALES = {
  ru: 'ru-RU',
  en: 'en-US',
  uk: 'uk-UA',
  pl: 'pl-PL',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
};

/**
 * The number forms each language tells apart (CLDR rules): Slavic languages split 1, 2-4, 5-20 and
 * the remaining tens, Western ones only "one" and "many". A dictionary entry is a string (one form
 * for all numbers) or an object with these categories: then `t()` takes the one a number from
 * params falls into (see `COUNT_PARAMS`). The object lists only the categories whose form differs
 * from `other`: missing categories take `other`. So «загол.» or «мин», which are the same at any
 * number, are written as a single `other`.
 */
export const PLURAL_CATEGORIES = {
  ru: ['one', 'few', 'many', 'other'],
  en: ['one', 'other'],
  uk: ['one', 'few', 'many', 'other'],
  pl: ['one', 'few', 'many', 'other'],
  de: ['one', 'other'],
  fr: ['one', 'other'],
  es: ['one', 'other'],
};

/**
 * Keys where a number stands next to a noun or verb and agrees with it: they are held by a form per
 * language category. Counters after a label («прочитанных меток: {count}») are outside the list:
 * that form is correct at any number.
 */
export const PLURAL_KEYS = [
  'reader.feeds.allMeta',
  'reader.feed.itemMeta',
  'reader.confirmClear',
  'reader.announce.loaded',
  'reader.announce.failed',
  'reader.announce.cleared',
  'feeds.health.streak',
  'settings.ttlDays',
  'settings.ttlYears',
  'notify.news',
];

/** Parameters whose number sets the form: headline and feed counters, a period in days. */
const COUNT_PARAMS = ['count', 'n', 'days'];

const DICTIONARIES = {
  ru: {
    'app.name': 'RSS Reader',

    'common.loading': 'Загрузка…',
    'common.unknownError': 'неизвестная ошибка',
    'common.publishedShort': 'опубл.',
    'common.untitled': 'Заголовок без названия',
    'common.theme.light': 'Светлая тема',
    'common.theme.dark': 'Тёмная тема',
    'common.theme.toggle': 'Переключить тему',

    // The screen switcher's labels — one set for all three screens: the tooltip and aria-label too.
    'nav.reader': 'Читалка',
    'nav.feeds': 'Настройки лент',
    'nav.global': 'Глобальные настройки',
    'nav.group': 'Переключение между экранами расширения',

    'reader.count.tooltip': 'Заголовков в хранилище',
    'reader.clearAll.tooltip': 'Удалить все заголовки из хранилище',
    'reader.clearAll.aria': 'Удалить все',
    'reader.clearFeed.tooltip': 'Удалить заголовки этой ленты из хранилища',
    'reader.clearFeed.aria': 'Удалить',

    'reader.feeds.panelAria': 'Список RSS лент',
    'reader.feeds.title': 'Ленты',
    'reader.feeds.empty': 'Лент нет. Добавьте их на экране «Настройки лент».',
    'reader.feeds.all': 'Все ленты',
    'reader.feeds.allMeta': { other: '{count} загол.' },
    'reader.refresh.tooltip': 'Загрузить заголовки выбранной ленты',
    'reader.refresh.aria': 'Обновить',
    'reader.refreshAll.tooltip': 'Загрузить заголовки всех лент сейчас',
    'reader.refreshAll.aria': 'Обновить все ленты',
    'reader.feed.itemMeta': { other: '{count} загол. · обновл. каждые {duration}' },
    'reader.feed.failedCount': 'сбоев загрузки: {count}',
    'reader.feed.lastChecked': 'последняя проверка: {since}',
    'reader.feed.lastError': 'последняя ошибка: {error}',
    'reader.feed.nextRetry': 'следующая попытка: {until}',
    'reader.feed.nextCheck': 'следующая проверка: {until}',
    'reader.status.lastFetched': 'заголовки получены {since}',
    'reader.status.nextCheck': 'следующая проверка {until}',

    // First acquaintance with the reader: the middle column is empty until a single feed is added,
    // and its button leads to the feeds screen. The right panel's label says the same where the
    // article stands.
    'reader.start.title': 'Лент пока нет',
    'reader.start.hint': 'Добавьте первую ленту: её заголовки появятся в этой колонке, а текст новости — в правой.',
    'reader.start.openFeeds': 'Открыть настройки лент',
    'reader.start.contentHint': 'Лент пока нет: добавьте первую на экране «Настройки лент».',

    'reader.headlines.panelAria': 'Заголовки новостей',
    'reader.headlines.title': 'Заголовки',
    'reader.headlines.emptyNoFeed': 'Выберите ленту слева.',
    'reader.headlines.emptyForFeed': 'Для этой ленты пока нет заголовков в хранилище.',
    'reader.headlines.emptyAllFeeds': 'Ни в одной ленте пока нет заголовков в хранилище.',
    'reader.headlines.emptySearch': 'Ни один заголовок не подходит к поиску.',
    'reader.search.placeholder': 'Поиск по заголовкам',
    'reader.search.aria': 'Поиск по заголовкам',
    'reader.published': 'опубл. {since}',

    // The reader's own keyboard hint: the "?" button in its header and the `?` key itself. Its lines
    // say what the README table lists — now beside where the keys are used.
    'reader.keys.toggle': 'Показать, чем управляется читалка',
    'reader.keys.title': 'Клавиши читалки',
    'reader.keys.close': 'Закрыть подсказку',
    'reader.keys.caption': 'Клавиши читалки и то, что делает каждая из них',
    'reader.keys.columnKey': 'Клавиша',
    'reader.keys.columnWhat': 'Что делает',
    'reader.keys.search': 'перейти в поле поиска',
    'reader.keys.next': 'открыть следующий заголовок выбранного',
    'reader.keys.prev': 'открыть предыдущий заголовок выбранного',
    'reader.keys.original': 'открыть оригинал открытого заголовка в новой вкладке',
    'reader.keys.refresh': 'перечитать выбранную ленту («Все ленты» — все)',
    'reader.keys.mark': 'пометить открытый заголовок прочитанным, или снять эту метку',
    'reader.keys.delete': 'удалить открытый заголовок (его ещё можно вернуть)',
    'reader.keys.undo': 'вернуть только что удалённый заголовок',
    'reader.keys.escape': 'очистить поле поиска, оставив открытый заголовок; вне поля — вернуть удалённый',
    'reader.keys.help': 'открыть или закрыть эту подсказку (Esc закрывает её тоже)',
    'reader.keys.fullText': 'прочитать полный текст открытого заголовка со страницы',
    'reader.keys.hint': 'Клавиши не работают, пока идёт набор в поле (в поиске те же буквы), и никогда не отнимаются у Ctrl/Meta/Alt. Стрелки работают и из поля поиска: набранные слова остаются, а курсор идёт по тем заголовкам, которые поиск оставляет. Буквы узнаются по своему месту на клавиатуре, а не по тому, что печатает раскладка: на кириллической раскладке эти клавиши печатают «о», «л», «к», «ь», «в», «г», а поле поиска открывается клавишей под / (той, что печатает там «.»).',

    'reader.content.panelAria': 'Содержание новости',
    'reader.content.delete.tooltip': 'Удалить заголовок из списка и из хранилища',
    'reader.content.delete.aria': 'Удалить',
    'reader.content.mark.tooltip': 'Пометить прочитанным: ни одна лента не принесёт эту новость снова',
    'reader.content.mark.aria': 'Пометить прочитанным',
    'reader.content.unmark.tooltip': 'Снять метку: лента снова принесёт этот заголовок',
    'reader.content.unmark.aria': 'Снять метку прочитанного',
    'reader.content.empty': 'Выберите заголовок новости в средней панели.',
    'reader.placeholder.inMiddle': 'Заголовки этой ленты — в средней панели.',
    'reader.placeholder.deletedLast': 'Заголовок удалён: в этой ленте больше ничего не осталось.',
    'reader.placeholder.deletedLastAll': 'Заголовок удалён: в хранилище больше ничего не осталось.',
    'reader.placeholder.expired': 'Открытый заголовок удалён из хранилища: истёк clean_timeout.',
    'reader.source': '{name} · опубл. {since}',
    'reader.openOriginal.tooltip': 'Открыть оригинал в новой вкладке',
    'reader.content.noDescription': 'Нет описания в хранилище для этой новости.',
    'reader.content.originalByLink': 'Оригинал доступен по ссылке в заголовке новости.',
    'reader.content.truncated': 'Описание обрезано из-за ограничения длины.',
    'reader.content.marked': 'Заголовок помечен прочитанным: его не принесёт ни одна лента, пока горит его метка.',
    'reader.content.article.tooltip': 'Загрузить полный текст новости со страницы',
    'reader.content.article.aria': 'Полный текст',
    'reader.content.articleLoading': 'Читаем страницу…',
    'reader.content.articleTruncated': 'Текст статьи обрезан из-за ограничения длины.',
    'reader.content.articleNone': 'На странице не нашлось текста статьи.',
    'reader.undo.prompt': 'Удалён «{title}»',
    'reader.undo.button': 'Вернуть',
    'reader.confirmClear': {
      one: 'Удалить {count} заголовок? Он будет помечен прочитанным и не вернётся, пока горит его метка.',
      few: 'Удалить {count} заголовка? Они будут помечены прочитанными и не вернутся, пока горят их метки.',
      other: 'Удалить {count} заголовков? Они будут помечены прочитанными и не вернутся, пока горят их метки.',
    },
    'reader.refresh.noFeed': 'Сначала выберите ленту.',
    'reader.refresh.failed': 'Не удалось обновить ленту: {error}',
    'reader.refreshAll.failed': 'Не удалось обновить часть лент: {error}',

    // The column font-size switcher: the group label and four steps — the tooltip and
    // aria-label of each step too.
    'reader.fontScale.aria': 'Размер шрифта этой колонки',
    'reader.fontScale.small': 'Мелкий шрифт',
    'reader.fontScale.normal': 'Обычный шрифт',
    'reader.fontScale.large': 'Крупный шрифт',
    'reader.fontScale.xlarge': 'Очень крупный шрифт',

    // What the reader announces aloud when a panel is redrawn: a hidden `role="status"` line says
    // it (see `index.js`), not the text an eye reads.
    'reader.announce.loaded': { other: 'получено новых заголовков: {count}' },
    'reader.announce.none': 'новых заголовков нет',
    'reader.announce.failed': { other: 'не удалось обновить лент: {count}' },
    'reader.announce.error': 'обновление не удалось: {error}',
    'reader.announce.cleared': { other: 'заголовков удалено: {count}' },
    'reader.announce.deleted': 'заголовок удалён',
    'reader.announce.marked': 'заголовок помечен прочитанным',
    'reader.announce.unmarked': 'метка прочитанного снята',
    'reader.announce.undone': 'заголовок возвращён',
    'reader.announce.undoFailed': 'вернуть заголовок не удалось: его ленты больше нет',
    'reader.feeds.list.aria': 'Ленты: выберите ленту, чтобы увидеть её заголовки',
    'reader.headlines.list.aria': 'Список заголовков выбранной ленты',

    // The boundary between columns: its tooltip and aria-label.
    'reader.column.resize': 'Потяните, чтобы изменить ширину колонки',

    'feeds.title': 'Настройки RSS лент',
    'feeds.caption': 'Таблица лент: название, ссылка, период загрузки заголовков, время хранения новости',
    'feeds.add': 'Добавить ленту',
    'feeds.empty': 'Лент нет. Нажмите «Добавить ленту».',
    'feeds.info.tooltip': 'Как устроены период загрузки и время хранения',
    'feeds.info.aria': 'Как устроены период загрузки и время хранения',
    'feeds.hint':
      'Период загрузки заголовков — как часто лента опрашивается автоматически (в минутах; Chrome не позволяет реже одной минуты). Время хранения новости — сколько новость остаётся в хранилище после загрузки (в минутах), по истечении этого времени она удаляется автоматически.',

    'feeds.field.name': 'Название ленты',
    'feeds.field.rss': 'Ссылка',
    'feeds.field.delay': 'Период загрузки заголовков',
    'feeds.field.clean': 'Время хранения новости',

    'feeds.save': 'Сохранить',
    'feeds.addCard': 'Добавить ленту',
    'feeds.loadNow': 'Загрузить сейчас',
    'feeds.delete': 'Удалить',
    'feeds.cancel': 'Отменить',
    'feeds.draftNote': 'Новая лента — сохраните её, чтобы включить автоматическую загрузку',
    'feeds.status.saved': 'Сохранено',
    'feeds.status.firstFeed': 'Лента добавлена, первые заголовки получены.',
    'feeds.status.checkFields': 'Проверьте поля',
    'feeds.status.loadError': 'Ошибка загрузки',
    'feeds.confirmDelete': 'Удалить ленту «{name}» вместе с её заголовками?',
    'feeds.result': 'Новых: {added}, считано: {seen}{read}',
    'feeds.resultRead': ', уже прочитано: {skipped}',
    'feeds.resultUnchanged': 'Сервер ответил: лента не изменилась',
    'feeds.error.name': 'Укажите название ленты',
    'feeds.error.nameTooLong': 'Название слишком длинное',
    'feeds.error.link': 'Ссылка должна начинаться с http:// или https://',
    'feeds.error.delay': 'Период загрузки — не меньше 1 минуты',
    'feeds.error.clean': 'Время хранения — не меньше 1 минуты',

    'feeds.export': 'Выписать ленты в файл',
    'feeds.import': 'Прочитать ленты из файла',
    'feeds.export.done': 'лент выписано: {count}',
    'feeds.export.empty': 'Нечего выписывать: лент нет',
    'feeds.import.added': 'лент добавлено: {count}',
    'feeds.import.existing': 'уже настроено: {count}',
    'feeds.import.invalid': 'отвергнуто строк: {count}',
    'feeds.import.none': 'файл прочитан, но новых лент в нём нет',
    'feeds.import.error.json': 'Файл не читается как JSON',
    'feeds.import.error.version': 'Файл выписан другой версией формата',
    'feeds.import.error.shape': 'В файле нет списка лент',

    'feeds.health.checked': 'проверено {since}',
    'feeds.health.next': 'следующая проверка {until}',
    'feeds.health.error': 'ошибка: {error}',
    'feeds.health.streak': { other: 'сбоев подряд: {count}' },
    'feeds.health.pause': 'следующая попытка {until}',

    'settings.title': 'Глобальные настройки',
    'settings.caption': 'Настройки: горизонт отметок о прочитанном, сигнал загрузки, язык интерфейса',
    'settings.save': 'Записать',
    'settings.clearRead': 'Забыть прочитанные',
    'settings.ttl': 'через сколько дней забыть прочитанные',
    'settings.daysUnit': 'дней',
    'settings.sound': 'Звук при скачивании',
    'settings.soundNone': 'Без звука',
    'settings.soundName': 'имя файла',
    'settings.soundPlay.tooltip': 'Прослушать выбранный сигнал',
    'settings.soundPlay.aria': 'Прослушать выбранный сигнал',
    'settings.soundVolume': 'Громкость сигнала',
    'settings.soundEnabled': 'включен',
    'settings.showMessage': 'Показывать сообщение',
    'settings.info.tooltip': 'Как работают прочитанные метки',
    'settings.info.aria': 'Как работают прочитанные метки',
    'settings.hint':
      'Заголовок, удалённый из читалки, помечается прочитанным, чтобы лента не вернула его при следующей загрузке. Через несколько дней метка сгорает, и новость может появиться снова. «Забыть прочитанные» удаляет все метки сразу — удалённые новости вернутся в ленты.',
    'settings.readStats.none': 'прочитанных меток нет',
    'settings.readStats': 'прочитанных меток: {count} · горят через {ttl}',
    'settings.readStats.capped':
      'читалка держит не больше {max} меток: самые старые забыты раньше срока, эти горят через {honored}',
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
    'settings.ttlDays': { other: '{days} дн' },
    'settings.ttlYears': { other: '{days} дн ({years} г)' },
    'settings.savedTtl': 'горят через {ttl}',
    'settings.savedSound': 'звук: {name}',
    'settings.savedSoundEnabled': 'звук {state}',
    'settings.savedSoundEnabled.on': 'включён',
    'settings.savedSoundEnabled.off': 'выключен',
    'settings.savedVolume': 'громкость: {volume}%',
    'settings.savedMessage': 'сообщение: {state}',
    'settings.savedMessage.on': 'включено',
    'settings.savedMessage.off': 'выключено',
    'settings.savedLanguage': 'язык: {name}',
    'settings.soundDescNone': 'без звука',
    'settings.language': 'Язык интерфейса',

    // The automatic-load popup: how many headlines it brought.
    'notify.news': { other: 'Получено новых заголовков: {count}' },

    'errors.feedNotFound': 'Лента не найдена',
    'errors.feedUrl': 'Ссылка ленты должна начинаться с http:// или https://',
    'errors.feedFetch': 'Не удалось загрузить ленту: {cause}',
    'errors.feedStatus': 'Лента ответила {status} {statusText}',
    'errors.feedTimeout': 'Лента не ответила за {seconds} с',
    'errors.feedEmpty': 'Лента вернула пустой ответ',
    'errors.feedNotXml': 'Ответ не похож на корректный XML ленты',
    'errors.feedEmptyXml': 'Пустой XML ленты',
    'errors.feedNotFeed': 'Ответ не похож на ленту новостей',
    'errors.feedNotJson': 'Ответ не похож на корректную JSON-ленту',
    'errors.feedUnknown': 'не удалось прочитать ленту: {message}',
    'errors.storageUnavailable': 'хранилище читалки не ответило: {cause}',
    'errors.offscreenUnavailable': 'не удалось открыть служебную страницу расширения',
    'errors.offscreenNoReply': 'служебная страница расширения не ответила{cause}',
    'errors.articleFetch': 'Не удалось загрузить страницу: {cause}',
    'errors.articleStatus': 'Страница ответила {status} {statusText}',
    'errors.articleTimeout': 'Страница не ответила за {seconds} с',
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
    'units.inMinutes': 'через {n} мин',
    'units.inHours': 'через {n} ч',
    'units.inDays': 'через {n} дн',
    'units.anyNow': 'сейчас',
  },

  en: {
    'app.name': 'RSS Reader',

    'common.loading': 'Loading…',
    'common.unknownError': 'unknown error',
    'common.publishedShort': 'pub.',
    'common.untitled': 'Untitled headline',
    'common.theme.light': 'Light theme',
    'common.theme.dark': 'Dark theme',
    'common.theme.toggle': 'Toggle theme',

    // Captions of the screen switcher — one set for all three screens: it is both the tooltip
    // and the aria-label there.
    'nav.reader': 'Reader',
    'nav.feeds': 'Feed settings',
    'nav.global': 'Global settings',
    'nav.group': 'Switch between the extension screens',

    'reader.count.tooltip': 'Headlines in storage',
    'reader.clearAll.tooltip': 'Delete every headline from storage',
    'reader.clearAll.aria': 'Delete all',
    'reader.clearFeed.tooltip': "Delete this feed's headlines from storage",
    'reader.clearFeed.aria': 'Delete',

    'reader.feeds.panelAria': 'List of RSS feeds',
    'reader.feeds.title': 'Feeds',
    'reader.feeds.empty': 'No feeds yet. Add them on the Feed settings screen.',
    'reader.feeds.all': 'All feeds',
    'reader.feeds.allMeta': { one: '{count} headline', other: '{count} headlines' },
    'reader.refresh.tooltip': 'Load headlines for the selected feed',
    'reader.refresh.aria': 'Refresh',
    'reader.refreshAll.tooltip': 'Load headlines of every feed now',
    'reader.refreshAll.aria': 'Refresh all feeds',
    'reader.feed.itemMeta': {
      one: '{count} headline · refresh every {duration}',
      other: '{count} headlines · refresh every {duration}',
    },
    'reader.feed.failedCount': 'load failures: {count}',
    'reader.feed.lastChecked': 'last checked: {since}',
    'reader.feed.lastError': 'last error: {error}',
    'reader.feed.nextRetry': 'next attempt: {until}',
    'reader.feed.nextCheck': 'next check: {until}',
    'reader.status.lastFetched': 'headlines fetched {since}',
    'reader.status.nextCheck': 'next check {until}',

    // The reader's first run: the middle column is empty while no feed has been added, and its button
    // leads to the feeds screen. The right panel says the same where an article would stand.
    'reader.start.title': 'No feeds yet',
    'reader.start.hint': 'Add your first feed: its headlines appear in this column and the news text in the one to the right.',
    'reader.start.openFeeds': 'Open feed settings',
    'reader.start.contentHint': 'No feeds yet: add your first one on the Feed settings screen.',

    'reader.headlines.panelAria': 'News headlines',
    'reader.headlines.title': 'Headlines',
    'reader.headlines.emptyNoFeed': 'Select a feed on the left.',
    'reader.headlines.emptyForFeed': 'This feed has no headlines in storage yet.',
    'reader.headlines.emptyAllFeeds': 'No feed has any headlines in storage yet.',
    'reader.headlines.emptySearch': 'No headline matches this search.',
    'reader.search.placeholder': 'Search headlines',
    'reader.search.aria': 'Search headlines',
    'reader.published': 'pub. {since}',

    // The reader's own key help: the «?» in its header and the `?` key itself. Its rows say what the
    // table of the README lists — now where the keys are actually used.
    'reader.keys.toggle': 'Show the keys the reader answers to',
    'reader.keys.title': 'Reader keys',
    'reader.keys.close': 'Close the key list',
    'reader.keys.caption': 'The keys of the reader and what each of them does',
    'reader.keys.columnKey': 'Key',
    'reader.keys.columnWhat': 'What it does',
    'reader.keys.search': 'put the cursor in the search field',
    'reader.keys.next': 'open the next headline of the current selection',
    'reader.keys.prev': 'open the previous headline of the current selection',
    'reader.keys.original': 'open the original of the open headline in a new tab',
    'reader.keys.refresh': 're-read the selected feed (“All feeds” — every feed)',
    'reader.keys.mark': 'mark the open headline read, or take that mark back',
    'reader.keys.delete': 'delete the open headline (it can still be taken back)',
    'reader.keys.undo': 'take back the headline just deleted',
    'reader.keys.escape': 'empty the search field, keeping the open headline; outside the field, take back the deleted headline',
    'reader.keys.help': 'open or close this key list (Esc closes it too)',
    'reader.keys.fullText': 'read the full text of the open headline from its page',
    'reader.keys.hint': 'The keys are held back while a field is being typed in (the search field holds the same letters) and are never taken from Ctrl/Meta/Alt. The arrows work from inside the search field too: the words stay, and the cursor moves through the headlines the search leaves. Letters are recognised by their place on the keyboard, not by the character the current layout prints: on a Cyrillic layout these keys print «о», «л», «к», «ь», «в», «г», and the search field takes the key standing under / (the one printing «.» there).',

    'reader.content.panelAria': 'News content',
    'reader.content.delete.tooltip': 'Delete the headline from the list and from storage',
    'reader.content.delete.aria': 'Delete',
    'reader.content.mark.tooltip': 'Mark read: no feed brings this news back',
    'reader.content.mark.aria': 'Mark read',
    'reader.content.unmark.tooltip': 'Take the mark off: the feed brings this headline again',
    'reader.content.unmark.aria': 'Take the read mark off',
    'reader.content.empty': 'Select a news headline in the middle panel.',
    'reader.placeholder.inMiddle': 'This feed’s headlines are in the middle panel.',
    'reader.placeholder.deletedLast': 'Headline deleted: nothing else is left in this feed.',
    'reader.placeholder.deletedLastAll': 'Headline deleted: nothing else is left in storage.',
    'reader.placeholder.expired': 'The open headline left storage: clean_timeout expired.',
    'reader.source': '{name} · pub. {since}',
    'reader.openOriginal.tooltip': 'Open the original in a new tab',
    'reader.content.noDescription': 'No description stored for this news.',
    'reader.content.originalByLink': 'The original is available at the link in the headline.',
    'reader.content.truncated': 'Description truncated at the length limit.',
    'reader.content.marked': 'This headline is marked read: no feed brings it back while its mark lives.',
    'reader.content.article.tooltip': 'Load the full text of this news from its page',
    'reader.content.article.aria': 'Full text',
    'reader.content.articleLoading': 'Reading the page…',
    'reader.content.articleTruncated': 'Article text truncated at the length limit.',
    'reader.content.articleNone': 'No article text was found on the page.',
    'reader.undo.prompt': 'Deleted “{title}”',
    'reader.undo.button': 'Undo',
    'reader.confirmClear': {
      one: 'Delete {count} headline? It will be marked read and will not come back while its mark lives.',
      other: 'Delete {count} headlines? They will be marked read and will not come back while their marks live.',
    },
    'reader.refresh.noFeed': 'Select a feed first.',
    'reader.refresh.failed': 'Failed to refresh the feed: {error}',
    'reader.refreshAll.failed': 'Some feeds could not be refreshed: {error}',

    // The per-column font size switcher: the name of the group and its four steps — each step is
    // both the tooltip and the accessible name there.
    'reader.fontScale.aria': 'Font size in this column',
    'reader.fontScale.small': 'Small font',
    'reader.fontScale.normal': 'Normal font',
    'reader.fontScale.large': 'Large font',
    'reader.fontScale.xlarge': 'Extra-large font',

    // What the reader says out loud when a panel is repainted: a hidden `role="status"` line carries
    // these, not a text the eye reads.
    'reader.announce.loaded': { one: '{count} new headline loaded', other: '{count} new headlines loaded' },
    'reader.announce.none': 'no new headlines',
    'reader.announce.failed': { one: '{count} feed could not be refreshed', other: '{count} feeds could not be refreshed' },
    'reader.announce.error': 'refresh failed: {error}',
    'reader.announce.cleared': { one: '{count} headline removed', other: '{count} headlines removed' },
    'reader.announce.deleted': 'headline deleted',
    'reader.announce.marked': 'headline marked read',
    'reader.announce.unmarked': 'the read mark was taken off',
    'reader.announce.undone': 'headline brought back',
    'reader.announce.undoFailed': 'the headline could not be brought back: its feed is gone',
    'reader.feeds.list.aria': 'Feeds: pick a feed to read its headlines',
    'reader.headlines.list.aria': 'List of headlines of the selected feed',

    // The border between two columns: its tooltip and its aria-label.
    'reader.column.resize': 'Drag to change the width of this column',

    'feeds.title': 'RSS feed settings',
    'feeds.caption': 'Feed table: name, link, headline fetch period, news storage time',
    'feeds.add': 'Add feed',
    'feeds.empty': 'No feeds yet. Press “Add feed”.',
    'feeds.info.tooltip': 'How the fetch period and the storage time work',
    'feeds.info.aria': 'How the fetch period and the storage time work',
    'feeds.hint':
      'Headline fetch period — how often the feed is read automatically (in minutes; Chrome does not allow less than 1 minute). News storage time — how long a news stays in storage after it is loaded (in minutes); after that time it is removed automatically.',

    'feeds.field.name': 'Feed name',
    'feeds.field.rss': 'Link',
    'feeds.field.delay': 'Headline fetch period',
    'feeds.field.clean': 'News storage time',

    'feeds.save': 'Save',
    'feeds.addCard': 'Add feed',
    'feeds.loadNow': 'Load now',
    'feeds.delete': 'Delete',
    'feeds.cancel': 'Cancel',
    'feeds.draftNote': 'New feed — save it to turn on automatic loading',
    'feeds.status.saved': 'Saved',
    'feeds.status.firstFeed': 'Feed added, its first headlines loaded.',
    'feeds.status.checkFields': 'Check the fields',
    'feeds.status.loadError': 'Loading failed',
    'feeds.confirmDelete': 'Delete the feed “{name}” together with its headlines?',
    'feeds.result': 'New: {added}, parsed: {seen}{read}',
    'feeds.resultRead': ', already read: {skipped}',
    'feeds.resultUnchanged': 'The server answered: the feed has not changed',
    'feeds.error.name': 'Enter a feed name',
    'feeds.error.nameTooLong': 'The name is too long',
    'feeds.error.link': 'The link must start with http:// or https://',
    'feeds.error.delay': 'Fetch period — at least 1 minute',
    'feeds.error.clean': 'Storage time — at least 1 minute',

    'feeds.export': 'Export feeds to a file',
    'feeds.import': 'Import feeds from a file',
    'feeds.export.done': 'feeds exported: {count}',
    'feeds.export.empty': 'Nothing to export: there are no feeds',
    'feeds.import.added': 'feeds added: {count}',
    'feeds.import.existing': 'already set up: {count}',
    'feeds.import.invalid': 'rows rejected: {count}',
    'feeds.import.none': 'the file was read, but it holds no new feeds',
    'feeds.import.error.json': 'The file does not read as JSON',
    'feeds.import.error.version': 'The file was written in another format version',
    'feeds.import.error.shape': 'The file has no list of feeds',

    'feeds.health.checked': 'checked {since}',
    'feeds.health.next': 'next check {until}',
    'feeds.health.error': 'error: {error}',
    'feeds.health.streak': { one: '{count} failure in a row', other: '{count} failures in a row' },
    'feeds.health.pause': 'next attempt {until}',

    'settings.title': 'Global settings',
    'settings.caption': 'Settings: the horizon of read markers, the load signal, the interface language',
    'settings.save': 'Save',
    'settings.clearRead': 'Forget read',
    'settings.ttl': 'after how many days to forget read headlines',
    'settings.daysUnit': 'days',
    'settings.sound': 'Sound on download',
    'settings.soundNone': 'No sound',
    'settings.soundName': 'file name',
    'settings.soundPlay.tooltip': 'Preview the selected signal',
    'settings.soundPlay.aria': 'Preview the selected signal',
    'settings.soundVolume': 'Signal volume',
    'settings.soundEnabled': 'enabled',
    'settings.showMessage': 'Show a message',
    'settings.info.tooltip': 'How the read markers work',
    'settings.info.aria': 'How the read markers work',
    'settings.hint':
      'A headline deleted from the reader is marked as read so a feed does not bring it back on the next load. After a few days the marker burns out and the news may appear again. “Forget read” deletes every marker at once — the headlines you removed before come back to the feeds.',
    'settings.readStats.none': 'no read markers',
    'settings.readStats': 'read markers: {count} · burn out after {ttl}',
    'settings.readStats.capped':
      'the reader keeps at most {max} markers: the oldest were forgotten before their term, these burn out after {honored}',
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
    'settings.ttlDays': { other: '{days} d' },
    'settings.ttlYears': { other: '{days} d ({years} yr)' },
    'settings.savedTtl': 'burn out after {ttl}',
    'settings.savedSound': 'sound: {name}',
    'settings.savedSoundEnabled': 'sound {state}',
    'settings.savedSoundEnabled.on': 'on',
    'settings.savedSoundEnabled.off': 'off',
    'settings.savedVolume': 'volume: {volume}%',
    'settings.savedMessage': 'message: {state}',
    'settings.savedMessage.on': 'on',
    'settings.savedMessage.off': 'off',
    'settings.savedLanguage': 'language: {name}',
    'settings.soundDescNone': 'no sound',
    'settings.language': 'Interface language',

    // The automatic-load popup: how many headlines that load brought.
    'notify.news': { one: '{count} new headline loaded', other: '{count} new headlines loaded' },

    'errors.feedNotFound': 'Feed not found',
    'errors.feedUrl': 'The feed link must start with http:// or https://',
    'errors.feedFetch': 'Failed to load the feed: {cause}',
    'errors.feedStatus': 'The feed replied {status} {statusText}',
    'errors.feedTimeout': 'The feed did not answer within {seconds} s',
    'errors.feedEmpty': 'The feed returned an empty response',
    'errors.feedNotXml': 'The response does not look like valid feed XML',
    'errors.feedEmptyXml': 'Empty feed XML',
    'errors.feedNotFeed': 'The response is not a news feed',
    'errors.feedNotJson': 'The response does not look like valid feed JSON',
    'errors.feedUnknown': 'could not read the feed: {message}',
    'errors.storageUnavailable': 'the storage of the extension did not answer: {cause}',
    'errors.offscreenUnavailable': 'could not open the extension helper page',
    'errors.offscreenNoReply': 'the extension helper page did not answer{cause}',
    'errors.articleFetch': 'Failed to load the page: {cause}',
    'errors.articleStatus': 'The page replied {status} {statusText}',
    'errors.articleTimeout': 'The page did not answer within {seconds} s',
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
    'units.inMinutes': 'in {n} min',
    'units.inHours': 'in {n} h',
    'units.inDays': 'in {n} d',
    'units.anyNow': 'now',
  },

  uk: {
    'app.name': 'RSS Reader',

    'common.loading': 'Завантаження…',
    'common.unknownError': 'невідома помилка',
    'common.publishedShort': 'опубл.',
    'common.untitled': 'Заголовок без назви',
    'common.theme.light': 'Світла тема',
    'common.theme.dark': 'Темна тема',
    'common.theme.toggle': 'Перемкнути тему',

    // The screen switcher's labels — one set for all three screens: they are themselves the tooltip and aria-label.
    'nav.reader': 'Читалка',
    'nav.feeds': 'Налаштування стрічок',
    'nav.global': 'Глобальні налаштування',
    'nav.group': 'Перемикання між екранами розширення',

    'reader.count.tooltip': 'Заголовки у сховищі',
    'reader.clearAll.tooltip': 'Видалити всі заголовки зі сховища',
    'reader.clearAll.aria': 'Видалити всі',
    'reader.clearFeed.tooltip': 'Видалити заголовки цієї стрічки зі сховища',
    'reader.clearFeed.aria': 'Видалити',

    'reader.feeds.panelAria': 'Список RSS-стрічок',
    'reader.feeds.title': 'Стрічки',
    'reader.feeds.empty': 'Стрічок немає. Додайте їх на екрані «Налаштування стрічок».',
    'reader.feeds.all': 'Усі стрічки',
    'reader.feeds.allMeta': { other: '{count} загол.' },
    'reader.refresh.tooltip': 'Завантажити заголовки обраної стрічки',
    'reader.refresh.aria': 'Оновити',
    'reader.refreshAll.tooltip': 'Завантажити заголовки всіх стрічок зараз',
    'reader.refreshAll.aria': 'Оновити всі стрічки',
    'reader.feed.itemMeta': { other: '{count} загол. · оновл. кожні {duration}' },
    'reader.feed.failedCount': 'помилок завантаження: {count}',
    'reader.feed.lastChecked': 'остання перевірка: {since}',
    'reader.feed.lastError': 'остання помилка: {error}',
    'reader.feed.nextRetry': 'наступна спроба: {until}',
    'reader.feed.nextCheck': 'наступна перевірка: {until}',
    'reader.status.lastFetched': 'заголовки отримано {since}',
    'reader.status.nextCheck': 'наступна перевірка {until}',

    // First acquaintance with the reader: the middle column is empty until a single feed is added,
    // and its button leads to the feeds screen. The right panel's label says the same where the
    // article stands.
    'reader.start.title': 'Ще немає стрічок',
    'reader.start.hint': 'Додайте першу стрічку: її заголовки з’являться в цій колонці, а текст новини — в правій.',
    'reader.start.openFeeds': 'Відкрити налаштування стрічок',
    'reader.start.contentHint': 'Ще немає стрічок: додайте першу на екрані «Налаштування стрічок».',

    'reader.headlines.panelAria': 'Заголовки новин',
    'reader.headlines.title': 'Заголовки',
    'reader.headlines.emptyNoFeed': 'Оберіть стрічку ліворуч.',
    'reader.headlines.emptyForFeed': 'Для цієї стрічки ще немає заголовків у сховищі.',
    'reader.headlines.emptyAllFeeds': 'У жодній стрічці ще немає заголовків у сховищі.',
    'reader.headlines.emptySearch': 'Жоден заголовок не відповідає пошуку.',
    'reader.search.placeholder': 'Пошук заголовків',
    'reader.search.aria': 'Пошук заголовків',
    'reader.published': 'опубл. {since}',

    // The reader's own keyboard hint: the "?" button in its header and the `?` key itself. Its lines
    // say what the README table lists — now beside where the keys are actually used.
    'reader.keys.toggle': 'Показати клавіші, яким відповідає читалка',
    'reader.keys.title': 'Клавіші читалки',
    'reader.keys.close': 'Закрити підказку',
    'reader.keys.caption': 'Клавіші читалки та те, що робить кожна з них',
    'reader.keys.columnKey': 'Клавіша',
    'reader.keys.columnWhat': 'Що робить',
    'reader.keys.search': 'перейти до поля пошуку',
    'reader.keys.next': 'відкрити наступний заголовок вибраного',
    'reader.keys.prev': 'відкрити попередній заголовок вибраного',
    'reader.keys.original': 'відкрити оригінал відкритого заголовка в новій вкладці',
    'reader.keys.refresh': 'перечитати вибрану стрічку («Усі стрічки» — усі)',
    'reader.keys.mark': 'позначити відкритий заголовок прочитаним або зняти цю позначку',
    'reader.keys.delete': 'видалити відкритий заголовок (його ще можна повернути)',
    'reader.keys.undo': 'повернути щойно видалений заголовок',
    'reader.keys.escape': 'очистити поле пошуку, залишивши відкритий заголовок; поза полем — повернути видалений',
    'reader.keys.help': 'відкрити або закрити цю підказку (Esc закриває її також)',
    'reader.keys.fullText': 'прочитати повний текст відкритого заголовка зі сторінки',
    'reader.keys.hint': 'Клавіші не діють, поки триває набір у полі (у пошуку ті самі літери), і ніколи не відбираються в Ctrl/Meta/Alt. Стрілки працюють і з поля пошуку: набрані слова залишаються, а курсор іде тими заголовками, які пошук залишає. Літери впізнаються за своїм місцем на клавіатурі, а не за тим, що друкує поточна розкладка: на кириличній розкладці ці клавіші друкують «о», «л», «к», «ь», «в», «г», а поле пошуку відкриває клавіша під / (та, що друкує там «.»).',

    'reader.content.panelAria': 'Зміст новини',
    'reader.content.delete.tooltip': 'Видалити заголовок зі списку та зі сховища',
    'reader.content.delete.aria': 'Видалити',
    'reader.content.mark.tooltip': 'Позначити прочитаним: жодна стрічка не принесе цю новину знову',
    'reader.content.mark.aria': 'Позначити прочитаним',
    'reader.content.unmark.tooltip': 'Зняти позначку: стрічка знову принесе цей заголовок',
    'reader.content.unmark.aria': 'Зняти позначку прочитаного',
    'reader.content.empty': 'Оберіть заголовок новини у середній панелі.',
    'reader.placeholder.inMiddle': 'Заголовки цієї стрічки — у середній панелі.',
    'reader.placeholder.deletedLast': 'Заголовок видалено: у цій стрічці більше нічого не залишилося.',
    'reader.placeholder.deletedLastAll': 'Заголовок видалено: у сховищі більше нічого не залишилося.',
    'reader.placeholder.expired': 'Відкритий заголовок видалено зі сховища: минув clean_timeout.',
    'reader.source': '{name} · опубл. {since}',
    'reader.openOriginal.tooltip': 'Відкрити оригінал у новій вкладці',
    'reader.content.noDescription': 'Опис цієї новини не збережено у сховищі.',
    'reader.content.originalByLink': 'Оригінал доступний за посиланням у заголовку новини.',
    'reader.content.truncated': 'Опис обрізано через обмеження довжини.',
    'reader.content.marked': 'Заголовок позначений прочитаним: жодна стрічка його не принесе, поки горить його позначка.',
    'reader.content.article.tooltip': 'Завантажити повний текст цієї новини зі сторінки',
    'reader.content.article.aria': 'Повний текст',
    'reader.content.articleLoading': 'Читаємо сторінку…',
    'reader.content.articleTruncated': 'Текст статті обрізано через обмеження довжини.',
    'reader.content.articleNone': 'На сторінці не знайдено тексту статті.',
    'reader.undo.prompt': 'Видалено «{title}»',
    'reader.undo.button': 'Повернути',
    'reader.confirmClear': {
      one: 'Видалити {count} заголовок? Він буде позначений прочитаним і не повернеться, поки горить його позначка.',
      few: 'Видалити {count} заголовки? Вони будуть позначені прочитаними і не повернуться, поки горять їхні позначки.',
      other: 'Видалити {count} заголовків? Вони будуть позначені прочитаними і не повернуться, поки горять їхні позначки.',
    },
    'reader.refresh.noFeed': 'Спочатку оберіть стрічку.',
    'reader.refresh.failed': 'Не вдалося оновити стрічку: {error}',
    'reader.refreshAll.failed': 'Не вдалося оновити частину стрічок: {error}',

    'reader.fontScale.aria': 'Розмір шрифту в цій колонці',
    'reader.fontScale.small': 'Малий шрифт',
    'reader.fontScale.normal': 'Звичайний шрифт',
    'reader.fontScale.large': 'Великий шрифт',
    'reader.fontScale.xlarge': 'Дуже великий шрифт',

    'reader.announce.loaded': { other: 'отримано нових заголовків: {count}' },
    'reader.announce.none': 'нових заголовків немає',
    'reader.announce.failed': { other: 'не вдалося оновити стрічок: {count}' },
    'reader.announce.error': 'оновлення не вдалося: {error}',
    'reader.announce.cleared': { other: 'заголовків видалено: {count}' },
    'reader.announce.deleted': 'заголовок видалено',
    'reader.announce.marked': 'заголовок позначено прочитаним',
    'reader.announce.unmarked': 'позначку прочитаного знято',
    'reader.announce.undone': 'заголовок повернуто',
    'reader.announce.undoFailed': 'повернути заголовок не вдалося: його стрічки більше немає',
    'reader.feeds.list.aria': 'Стрічки: оберіть стрічку, щоб бачити її заголовки',
    'reader.headlines.list.aria': 'Список заголовків вибраної стрічки',

    'reader.column.resize': 'Перетягніть, щоб змінити ширину колонки',

    'feeds.title': 'Налаштування RSS-стрічок',
    'feeds.caption': 'Таблиця стрічок: назва, посилання, період завантаження заголовків, час зберігання новини',
    'feeds.add': 'Додати стрічку',
    'feeds.empty': 'Стрічок немає. Натисніть «Додати стрічку».',
    'feeds.info.tooltip': 'Як влаштовані період завантаження та час зберігання',
    'feeds.info.aria': 'Як влаштовані період завантаження та час зберігання',
    'feeds.hint':
      'Період завантаження заголовків — як часто стрічка опитується автоматично (у хвилинах, Chrome не дозволяє рідше 1 хвилини). Час зберігання новини — скільки новина залишається в сховищі після завантаження (у хвилинах), по закінченні цього часу вона видаляється автоматично.',

    'feeds.field.name': 'Назва стрічки',
    'feeds.field.rss': 'Посилання',
    'feeds.field.delay': 'Період завантаження заголовків',
    'feeds.field.clean': 'Час зберігання новини',

    'feeds.save': 'Зберегти',
    'feeds.addCard': 'Додати стрічку',
    'feeds.loadNow': 'Завантажити зараз',
    'feeds.delete': 'Видалити',
    'feeds.cancel': 'Скасувати',
    'feeds.draftNote': 'Нова стрічка — збережіть її, щоб увімкнути автоматичне завантаження',
    'feeds.status.saved': 'Збережено',
    'feeds.status.firstFeed': 'Стрічку додано, перші заголовки отримано.',
    'feeds.status.checkFields': 'Перевірте поля',
    'feeds.status.loadError': 'Помилка завантаження',
    'feeds.confirmDelete': 'Видалити стрічку «{name}» разом з її заголовками?',
    'feeds.result': 'Нових: {added}, зчитано: {seen}{read}',
    'feeds.resultRead': ', уже прочитано: {skipped}',
    'feeds.resultUnchanged': 'Сервер відповів: стрічку не змінено',
    'feeds.error.name': 'Вкажіть назву стрічки',
    'feeds.error.nameTooLong': 'Назва завелика',
    'feeds.error.link': 'Посилання має починатися з http:// або https://',
    'feeds.error.delay': 'Період завантаження — не менше 1 хвилини',
    'feeds.error.clean': 'Час зберігання — не менше 1 хвилини',

    'feeds.export': 'Виписати стрічки у файл',
    'feeds.import': 'Прочитати стрічки з файла',
    'feeds.export.done': 'стрічок виписано: {count}',
    'feeds.export.empty': 'Нічого виписувати: стрічок немає',
    'feeds.import.added': 'стрічок додано: {count}',
    'feeds.import.existing': 'уже налаштовано: {count}',
    'feeds.import.invalid': 'рядків отвергнуто: {count}',
    'feeds.import.none': 'файл прочитано, але нових стрічок у ньому немає',
    'feeds.import.error.json': 'Файл не читається як JSON',
    'feeds.import.error.version': 'Файл виписаний іншою версією формату',
    'feeds.import.error.shape': 'У файлі немає списку стрічок',

    'feeds.health.checked': 'перевірено {since}',
    'feeds.health.next': 'наступна перевірка {until}',
    'feeds.health.error': 'помилка: {error}',
    'feeds.health.streak': { other: 'подряд збоїв: {count}' },
    'feeds.health.pause': 'наступна спроба {until}',

    'settings.title': 'Глобальні налаштування',
    'settings.caption': 'Налаштування: горизонт міток прочитаного, сигнал завантаження, мова інтерфейсу',
    'settings.save': 'Записати',
    'settings.clearRead': 'Забути прочитані',
    'settings.ttl': 'через скільки днів забути прочитані',
    'settings.daysUnit': 'днів',
    'settings.sound': 'Звук під час завантаження',
    'settings.soundNone': 'Без звуку',
    'settings.soundName': 'ім’я файлу',
    'settings.soundPlay.tooltip': 'Прослухати обраний сигнал',
    'settings.soundPlay.aria': 'Прослухати обраний сигнал',
    'settings.soundVolume': 'Гучність сигналу',
    'settings.soundEnabled': 'увімкнено',
    'settings.showMessage': 'Показувати повідомлення',
    'settings.info.tooltip': 'Як працюють мітки прочитаного',
    'settings.info.aria': 'Як працюють мітки прочитаного',
    'settings.hint':
      'Заголовок, видалений із читалки, позначається як прочитаний, щоб стрічка не повернула його під час наступного завантаження. За кілька днів мітка згорає, і новина може з’явитися знову. «Забути прочитані» видаляє всі мітки одразу — видалені новини повернуться у стрічки.',
    'settings.readStats.none': 'міток прочитаного немає',
    'settings.readStats': 'міток прочитаного: {count} · згорають через {ttl}',
    'settings.readStats.capped':
      'читалка тримає не більше {max} міток: найдатовіші забуті достроково, ці згорають через {honored}',
    'settings.soundStats': 'зараз грає: {name}',
    'settings.save.tooltipDirty': 'Записати строк, звук і мову до сховища',
    'settings.save.tooltipClean': 'Усі поля вже записані',
    'settings.status.pending': 'Зміни не записані',
    'settings.status.error': 'Не записано',
    'settings.status.nothing': 'Немає чого записувати',
    'settings.status.saved': 'Записано: {parts}',
    'settings.status.nothingToPlay': 'Без звуку — грати нічого',
    'settings.status.playError': 'Не вдалося прослухати сигнал',
    'settings.confirmLeave': 'Зміни не записані. Піти без запису?',
    'settings.confirmClear': 'Забути всі мітки прочитаного? Видалені новини можуть повернутися у стрічки.',
    'settings.status.cleared': 'Забуто прочитаних: {count}',
    'settings.status.emptyRead': 'Список прочитаних уже порожній',
    'settings.ttlError': 'Ціле число від {min} до {max} днів',
    'settings.ttlDays': { other: '{days} дн' },
    'settings.ttlYears': { other: '{days} дн ({years} р)' },
    'settings.savedTtl': 'згорають через {ttl}',
    'settings.savedSound': 'звук: {name}',
    'settings.savedSoundEnabled': 'звук {state}',
    'settings.savedSoundEnabled.on': 'увімкнено',
    'settings.savedSoundEnabled.off': 'вимкнено',
    'settings.savedVolume': 'гучність: {volume}%',
    'settings.savedMessage': 'повідомлення: {state}',
    'settings.savedMessage.on': 'увімкнено',
    'settings.savedMessage.off': 'вимкнено',
    'settings.savedLanguage': 'мова: {name}',
    'settings.soundDescNone': 'без звуку',
    'settings.language': 'Мова інтерфейсу',

    // The automatic-load popup: how many headlines it brought.
    'notify.news': { other: 'Отримано нових заголовків: {count}' },

    'errors.feedNotFound': 'Стрічку не знайдено',
    'errors.feedUrl': 'Посилання стрічки має починатися з http:// або https://',
    'errors.feedFetch': 'Не вдалося завантажити стрічку: {cause}',
    'errors.feedStatus': 'Стрічка відповіла {status} {statusText}',
    'errors.feedTimeout': 'Стрічка не відповіла за {seconds} с',
    'errors.feedEmpty': 'Стрічка повернула порожню відповідь',
    'errors.feedNotXml': 'Відповідь не схожа на коректний XML стрічки',
    'errors.feedEmptyXml': 'Порожній XML стрічки',
    'errors.feedNotFeed': 'Відповідь не схожа на стрічку новин',
    'errors.feedNotJson': 'Відповідь не схожа на коректну JSON-стрічку',
    'errors.feedUnknown': 'не вдалося прочитати стрічку: {message}',
    'errors.storageUnavailable': 'сховище читалки не відповіло: {cause}',
    'errors.offscreenUnavailable': 'не вдалося відкрити службову сторінку розширення',
    'errors.offscreenNoReply': 'службова сторінка розширення не відповіла{cause}',
    'errors.articleFetch': 'Не вдалося завантажити сторінку: {cause}',
    'errors.articleStatus': 'Сторінка відповіла {status} {statusText}',
    'errors.articleTimeout': 'Сторінка не відповіла за {seconds} с',
    'errors.articleType': 'Непідтримуваний тип вмісту: {type}',
    'errors.articleEmpty': 'На сторінці немає вмісту',

    'units.empty': '—',
    'units.minutes': '{n} хв',
    'units.hours': '{n} год',
    'units.days': '{n} дн',
    'units.justNow': 'щойно',
    'units.minutesAgo': '{n} хв тому',
    'units.hoursAgo': '{n} год тому',
    'units.daysAgo': '{n} дн тому',
    'units.inMinutes': 'через {n} хв',
    'units.inHours': 'через {n} год',
    'units.inDays': 'через {n} дн',
    'units.anyNow': 'зараз',
  },

  pl: {
    'app.name': 'RSS Reader',

    'common.loading': 'Ładowanie…',
    'common.unknownError': 'nieznany błąd',
    'common.publishedShort': 'opubl.',
    'common.untitled': 'Nagłówek bez tytułu',
    'common.theme.light': 'Motyw jasny',
    'common.theme.dark': 'Motyw ciemny',
    'common.theme.toggle': 'Przełącz motyw',

    // Podpisy przełącznika ekranów — jedno dla wszystkich trzech ekranów: tam samo tooltip
    // i aria-label.
    'nav.reader': 'Czytnik',
    'nav.feeds': 'Ustawienia kanałów',
    'nav.global': 'Ustawienia globalne',
    'nav.group': 'Przełączanie między ekranami rozszerzenia',

    'reader.count.tooltip': 'Nagłówki w pamięci',
    'reader.clearAll.tooltip': 'Usuń wszystkie nagłówki z pamięci',
    'reader.clearAll.aria': 'Usuń wszystkie',
    'reader.clearFeed.tooltip': 'Usuń nagłówki tego kanału z pamięci',
    'reader.clearFeed.aria': 'Usuń',

    'reader.feeds.panelAria': 'Lista kanałów RSS',
    'reader.feeds.title': 'Kanały',
    'reader.feeds.empty': 'Brak kanałów. Dodaj je na ekranie „Ustawienia kanałów”.',
    'reader.feeds.all': 'Wszystkie kanały',
    'reader.feeds.allMeta': { one: '{count} nagłówek', few: '{count} nagłówki', other: '{count} nagłówków' },
    'reader.refresh.tooltip': 'Wczytaj nagłówki wybranego kanału',
    'reader.refresh.aria': 'Odśwież',
    'reader.refreshAll.tooltip': 'Wczytaj nagłówki wszystkich kanałów teraz',
    'reader.refreshAll.aria': 'Odśwież wszystkie kanały',
    'reader.feed.itemMeta': { other: '{count} nagłów. · odśwież. co {duration}' },
    'reader.feed.failedCount': 'błędy pobierania: {count}',
    'reader.feed.lastChecked': 'ostatnio sprawdzono: {since}',
    'reader.feed.lastError': 'ostatni błąd: {error}',
    'reader.feed.nextRetry': 'następna próba: {until}',
    'reader.feed.nextCheck': 'następne sprawdzenie: {until}',
    'reader.status.lastFetched': 'nagłówki pobrano {since}',
    'reader.status.nextCheck': 'następne sprawdzenie {until}',

    // Pierwsze otwarcie czytnika: środkowa kolumna jest pusta, dopóki nie ma żadnego kanału, i jej
    // przycisk prowadzi do ekranu kanałów. Podpis prawego panelu mówi to samo tam, gdzie stałby artykuł.
    'reader.start.title': 'Brak kanałów',
    'reader.start.hint': 'Dodaj pierwszy kanał: jego nagłówki pojawią się w tej kolumnie, a treść wiadomości w tej po prawej.',
    'reader.start.openFeeds': 'Otwórz ustawienia kanałów',
    'reader.start.contentHint': 'Brak kanałów: dodaj pierwszy na ekranie „Ustawienia kanałów”.',

    'reader.headlines.panelAria': 'Nagłówki wiadomości',
    'reader.headlines.title': 'Nagłówki',
    'reader.headlines.emptyNoFeed': 'Wybierz kanał po lewej stronie.',
    'reader.headlines.emptyForFeed': 'Ten kanał nie ma jeszcze nagłówków w pamięci.',
    'reader.headlines.emptyAllFeeds': 'Żaden kanał nie ma jeszcze nagłówków w pamięci.',
    'reader.headlines.emptySearch': 'Żaden nagłówek nie pasuje do wyszukiwania.',
    'reader.search.placeholder': 'Szukaj wśród nagłówków',
    'reader.search.aria': 'Szukaj wśród nagłówków',
    'reader.published': 'opubl. {since}',

    // Podpowiedź o klawiszach samego czytnika: przycisk «?» w jego nagłówku i ten sam klawisz `?`.
    // Jej wiersze mówią to samo co tabela README — teraz tam, gdzie klawisze są naprawdę używane.
    'reader.keys.toggle': 'Pokaż klawisze, którym czytnik odpowiada',
    'reader.keys.title': 'Klawisze czytnika',
    'reader.keys.close': 'Zamknij listę klawiszy',
    'reader.keys.caption': 'Klawisze czytnika i to, co każdy z nich robi',
    'reader.keys.columnKey': 'Klawisz',
    'reader.keys.columnWhat': 'Co robi',
    'reader.keys.search': 'przejdź do pola wyszukiwania',
    'reader.keys.next': 'otwórz następny nagłówek bieżącego wyboru',
    'reader.keys.prev': 'otwórz poprzedni nagłówek bieżącego wyboru',
    'reader.keys.original': 'otwórz oryginał otwartego nagłówka w nowej karcie',
    'reader.keys.refresh': 'wczytaj ponownie wybrany kanał („Wszystkie kanały” — wszystkie)',
    'reader.keys.mark': 'oznacz otwarty nagłówek jako przeczytany lub usuń to oznaczenie',
    'reader.keys.delete': 'usuń otwarty nagłówek (wciąż można go cofnąć)',
    'reader.keys.undo': 'cofnij nagłówek właśnie usunięty',
    'reader.keys.escape': 'wyczyść pole wyszukiwania, zachowując otwarty nagłówek; poza polem — cofnij usunięty nagłówek',
    'reader.keys.help': 'otwórz lub zamknij tę listę klawiszy (Esc też ją zamyka)',
    'reader.keys.fullText': 'wczytaj pełny tekst otwartego nagłówka ze strony',
    'reader.keys.hint': 'Klawisze są wstrzymywane, gdy trwa pisanie w polu (pole wyszukiwania zawiera te same litery) i nigdy nie są odbierane Ctrl/Meta/Alt. Strzałki działają także z pola wyszukiwania: wpisane słowa zostają, a kursor wędruje po nagłówkach, których wyszukiwanie zostawia. Litery są rozpoznawane według ich miejsca na klawiaturze, nie według znaku, który wypisuje bieżący układ: na cyrylickim układzie te klawisze wypisują «о», «л», «к», «ь», «в», «г», a pole wyszukiwania otwiera klawisz stojący pod / (ten, który wypisuje tam «.»).',

    'reader.content.panelAria': 'Treść wiadomości',
    'reader.content.delete.tooltip': 'Usuń nagłówek z listy i z pamięci',
    'reader.content.delete.aria': 'Usuń',
    'reader.content.mark.tooltip': 'Oznacz jako przeczytany: żaden kanał nie przyniesie tej wiadomości ponownie',
    'reader.content.mark.aria': 'Oznacz jako przeczytany',
    'reader.content.unmark.tooltip': 'Usuń oznaczenie: kanał znowu przyniesie ten nagłówek',
    'reader.content.unmark.aria': 'Usuń oznaczenie przeczytania',
    'reader.content.empty': 'Wybierz nagłówek wiadomości w środkowym panelu.',
    'reader.placeholder.inMiddle': 'Nagłówki tego kanału są w środkowym panelu.',
    'reader.placeholder.deletedLast': 'Nagłówek usunięty: w tym kanale nic więcej nie zostało.',
    'reader.placeholder.deletedLastAll': 'Nagłówek usunięty: w pamięci nic więcej nie zostało.',
    'reader.placeholder.expired': 'Otwarty nagłówek został usunięty z pamięci: upłynął clean_timeout.',
    'reader.source': '{name} · opubl. {since}',
    'reader.openOriginal.tooltip': 'Otwórz oryginał w nowej karcie',
    'reader.content.noDescription': 'Brak opisu tej wiadomości w pamięci.',
    'reader.content.originalByLink': 'Oryginał jest dostępny pod linkiem w nagłówku wiadomości.',
    'reader.content.truncated': 'Opis skrócony z powodu limitu długości.',
    'reader.content.marked': 'Ten nagłówek jest oznaczony jako przeczytany: żaden kanał go nie przyniesie, dopóki jego oznaczenie żyje.',
    'reader.content.article.tooltip': 'Wczytaj pełny tekst tej wiadomości ze strony',
    'reader.content.article.aria': 'Pełny tekst',
    'reader.content.articleLoading': 'Czytamy stronę…',
    'reader.content.articleTruncated': 'Tekst artykułu skrócony z powodu limitu długości.',
    'reader.content.articleNone': 'Na stronie nie znaleziono tekstu artykułu.',
    'reader.undo.prompt': 'Usunięto „{title}”',
    'reader.undo.button': 'Cofnij',
    'reader.confirmClear': {
      one: 'Usunąć {count} nagłówek? Zostanie oznaczony jako przeczytany i nie wróci, dopóki jego oznaczenie żyje.',
      few: 'Usunąć {count} nagłówki? Zostaną oznaczone jako przeczytane i nie wrócą, dopóki ich oznaczenia żyją.',
      other: 'Usunąć {count} nagłówków? Zostaną oznaczone jako przeczytane i nie wrócą, dopóki ich oznaczenia żyją.',
    },
    'reader.refresh.noFeed': 'Najpierw wybierz kanał.',
    'reader.refresh.failed': 'Nie udało się odświeżyć kanału: {error}',
    'reader.refreshAll.failed': 'Nie udało się odświeżyć części kanałów: {error}',

    'reader.fontScale.aria': 'Rozmiar czcionki w tej kolumnie',
    'reader.fontScale.small': 'Mała czcionka',
    'reader.fontScale.normal': 'Normalna czcionka',
    'reader.fontScale.large': 'Duża czcionka',
    'reader.fontScale.xlarge': 'Bardzo duża czcionka',

    'reader.announce.loaded': {
      one: 'pobrano {count} nowy nagłówek',
      few: 'pobrano {count} nowe nagłówki',
      other: 'pobrano {count} nowych nagłówków',
    },
    'reader.announce.none': 'brak nowych nagłówków',
    'reader.announce.failed': {
      one: 'nie udało się odświeżyć {count} kanału',
      few: 'nie udało się odświeżyć {count} kanały',
      other: 'nie udało się odświeżyć {count} kanałów',
    },
    'reader.announce.error': 'odświeżanie nie powiodło się: {error}',
    'reader.announce.cleared': {
      one: 'usunięto {count} nagłówek',
      few: 'usunięto {count} nagłówki',
      other: 'usunięto {count} nagłówków',
    },
    'reader.announce.deleted': 'nagłówek usunięty',
    'reader.announce.marked': 'nagłówek oznaczony jako przeczytany',
    'reader.announce.unmarked': 'oznaczenie przeczytania zostało usunięte',
    'reader.announce.undone': 'nagłówek został przywrócony',
    'reader.announce.undoFailed': 'nie udało się przywrócić nagłówka: jego kanału już nie ma',
    'reader.feeds.list.aria': 'Kanały: wybierz kanał, aby zobaczyć jego nagłówki',
    'reader.headlines.list.aria': 'Lista nagłówków wybranego kanału',

    'reader.column.resize': 'Przeciągnij, aby zmienić szerokość tej kolumny',

    'feeds.title': 'Ustawienia kanałów RSS',
    'feeds.caption': 'Tabela kanałów: nazwa, link, okres pobierania nagłówków, czas przechowywania wiadomości',
    'feeds.add': 'Dodaj kanał',
    'feeds.empty': 'Brak kanałów. Naciśnij „Dodaj kanał”.',
    'feeds.info.tooltip': 'Jak działają okres pobierania i czas przechowywania',
    'feeds.info.aria': 'Jak działają okres pobierania i czas przechowywania',
    'feeds.hint':
      'Okres pobierania nagłówków — jak często kanał jest odczytywany automatycznie (w minutach; Chrome nie pozwala rzadziej niż 1 minutę). Czas przechowywania wiadomości — jak długo wiadomość pozostaje w pamięci po wczytaniu (w minutach); po upływie tego czasu jest usuwana automatycznie.',

    'feeds.field.name': 'Nazwa kanału',
    'feeds.field.rss': 'Link',
    'feeds.field.delay': 'Okres pobierania nagłówków',
    'feeds.field.clean': 'Czas przechowywania wiadomości',

    'feeds.save': 'Zapisz',
    'feeds.addCard': 'Dodaj kanał',
    'feeds.loadNow': 'Wczytaj teraz',
    'feeds.delete': 'Usuń',
    'feeds.cancel': 'Anuluj',
    'feeds.draftNote': 'Nowy kanał — zapisz go, aby włączyć automatyczne wczytywanie',
    'feeds.status.saved': 'Zapisano',
    'feeds.status.firstFeed': 'Kanał dodany, pierwsze nagłówki wczytane.',
    'feeds.status.checkFields': 'Sprawdź pola',
    'feeds.status.loadError': 'Wczytywanie nie powiodło się',
    'feeds.confirmDelete': 'Usunąć kanał „{name}” razem z jego nagłówkami?',
    'feeds.result': 'Nowe: {added}, wczytano: {seen}{read}',
    'feeds.resultRead': ', już przeczytane: {skipped}',
    'feeds.resultUnchanged': 'Serwer odpowiedział: kanał się nie zmienił',
    'feeds.error.name': 'Podaj nazwę kanału',
    'feeds.error.nameTooLong': 'Nazwa jest zbyt długa',
    'feeds.error.link': 'Link musi zaczynać się od http:// lub https://',
    'feeds.error.delay': 'Okres pobierania — co najmniej 1 minuta',
    'feeds.error.clean': 'Czas przechowywania — co najmniej 1 minuta',

    'feeds.export': 'Wyeksportuj kanały do pliku',
    'feeds.import': 'Zaimportuj kanały z pliku',
    'feeds.export.done': 'kanałów wyeksportowanych: {count}',
    'feeds.export.empty': 'Nie ma czego eksportować: brak kanałów',
    'feeds.import.added': 'kanałów dodanych: {count}',
    'feeds.import.existing': 'już ustawionych: {count}',
    'feeds.import.invalid': 'wierszy odrzuconych: {count}',
    'feeds.import.none': 'plik odczytany, ale nie ma w nim nowych kanałów',
    'feeds.import.error.json': 'Plik nie jest czytelnym JSON',
    'feeds.import.error.version': 'Plik zapisany w innej wersji formatu',
    'feeds.import.error.shape': 'W pliku nie ma listy kanałów',

    'feeds.health.checked': 'sprawdzono {since}',
    'feeds.health.next': 'następne sprawdzenie {until}',
    'feeds.health.error': 'błąd: {error}',
    'feeds.health.streak': { one: '{count} błąd z rzędu', few: '{count} błędy z rzędu', other: '{count} błędów z rzędu' },
    'feeds.health.pause': 'następna próba {until}',

    'settings.title': 'Ustawienia globalne',
    'settings.caption': 'Ustawienia: horyzont znaczników przeczytanych, sygnał wczytywania, język interfejsu',
    'settings.save': 'Zapisz',
    'settings.clearRead': 'Zapomnij przeczytane',
    'settings.ttl': 'po ilu dniach zapomnieć przeczytane',
    'settings.daysUnit': 'dni',
    'settings.sound': 'Dźwięk przy pobieraniu',
    'settings.soundNone': 'Bez dźwięku',
    'settings.soundName': 'nazwa pliku',
    'settings.soundPlay.tooltip': 'Odtwórz wybrany sygnał',
    'settings.soundPlay.aria': 'Odtwórz wybrany sygnał',
    'settings.soundVolume': 'Głośność sygnału',
    'settings.soundEnabled': 'włączony',
    'settings.showMessage': 'Pokazuj komunikat',
    'settings.info.tooltip': 'Jak działają znaczniki przeczytanych',
    'settings.info.aria': 'Jak działają znaczniki przeczytanych',
    'settings.hint':
      'Nagłówek usunięty z czytnika jest oznaczany jako przeczytany, aby kanał nie przywrócił go przy następnym wczytywaniu. Po kilku dniach znacznik wygasa i wiadomość może pojawić się ponownie. „Zapomnij przeczytane” usuwa wszystkie znaczniki naraz — usunięte wiadomości wrócą do kanałów.',
    'settings.readStats.none': 'brak znaczników przeczytanych',
    'settings.readStats': 'znaczniki przeczytanych: {count} · wygasają po {ttl}',
    'settings.readStats.capped':
      'czytnik przechowuje nie więcej niż {max} znaczników: najstarsze zapomniano przed terminem, te wygasają po {honored}',
    'settings.soundStats': 'teraz gra: {name}',
    'settings.save.tooltipDirty': 'Zapisz horyzont, dźwięk i język w pamięci',
    'settings.save.tooltipClean': 'Wszystkie pola są już zapisane',
    'settings.status.pending': 'Zmiany nie są zapisane',
    'settings.status.error': 'Nie zapisano',
    'settings.status.nothing': 'Nie ma czego zapisywać',
    'settings.status.saved': 'Zapisano: {parts}',
    'settings.status.nothingToPlay': 'Bez dźwięku — nie ma czego odtwarzać',
    'settings.status.playError': 'Nie udało się odtworzyć sygnału',
    'settings.confirmLeave': 'Zmiany nie są zapisane. Wyjść bez zapisu?',
    'settings.confirmClear': 'Zapomnieć wszystkie znaczniki przeczytanych? Usunięte wiadomości mogą wrócić do kanałów.',
    'settings.status.cleared': 'Zapomniane znaczniki przeczytanych: {count}',
    'settings.status.emptyRead': 'Lista przeczytanych jest już pusta',
    'settings.ttlError': 'Liczba całkowita od {min} do {max} dni',
    'settings.ttlDays': { one: '{days} dzień', other: '{days} dni' },
    'settings.ttlYears': {
      one: '{days} dzień ({years} rok)',
      few: '{days} dni ({years} lata)',
      other: '{days} dni ({years} lat)',
    },
    'settings.savedTtl': 'wygasają po {ttl}',
    'settings.savedSound': 'dźwięk: {name}',
    'settings.savedSoundEnabled': 'dźwięk {state}',
    'settings.savedSoundEnabled.on': 'włączony',
    'settings.savedSoundEnabled.off': 'wyłączony',
    'settings.savedVolume': 'głośność: {volume}%',
    'settings.savedMessage': 'komunikat: {state}',
    'settings.savedMessage.on': 'włączony',
    'settings.savedMessage.off': 'wyłączony',
    'settings.savedLanguage': 'język: {name}',
    'settings.soundDescNone': 'bez dźwięku',
    'settings.language': 'Język interfejsu',

    // Popup automatycznego pobierania: ile nagłówków przyniosło to pobieranie.
    'notify.news': {
      one: 'Wczytano {count} nowy nagłówek',
      few: 'Wczytano {count} nowe nagłówki',
      other: 'Wczytano {count} nowych nagłówków',
    },

    'errors.feedNotFound': 'Kanał nie znaleziony',
    'errors.feedUrl': 'Link kanału musi zaczynać się od http:// lub https://',
    'errors.feedFetch': 'Nie udało się wczytać kanału: {cause}',
    'errors.feedStatus': 'Kanał odpowiedział {status} {statusText}',
    'errors.feedTimeout': 'Kanał nie odpowiedział w ciągu {seconds} s',
    'errors.feedEmpty': 'Kanał zwrócił pustą odpowiedź',
    'errors.feedNotXml': 'Odpowiedź nie wygląda na poprawny XML kanału',
    'errors.feedEmptyXml': 'Pusty XML kanału',
    'errors.feedNotFeed': 'Odpowiedź nie jest kanałem informacyjnym',
    'errors.feedNotJson': 'Odpowiedź nie wygląda na poprawny JSON kanału',
    'errors.feedUnknown': 'nie udało się odczytać kanału: {message}',
    'errors.storageUnavailable': 'pamięć czytnika nie odpowiedziała: {cause}',
    'errors.offscreenUnavailable': 'nie udało się otworzyć pomocniczej strony rozszerzenia',
    'errors.offscreenNoReply': 'pomocnicza strona rozszerzenia nie odpowiedziała{cause}',
    'errors.articleFetch': 'Nie udało się wczytać strony: {cause}',
    'errors.articleStatus': 'Strona odpowiedziała {status} {statusText}',
    'errors.articleTimeout': 'Strona nie odpowiedziała w ciągu {seconds} s',
    'errors.articleType': 'Nieobsługiwany typ treści: {type}',
    'errors.articleEmpty': 'Strona nie ma treści',

    'units.empty': '—',
    'units.minutes': '{n} min',
    'units.hours': '{n} godz.',
    'units.days': '{n} dni',
    'units.justNow': 'właśnie teraz',
    'units.minutesAgo': '{n} min temu',
    'units.hoursAgo': '{n} godz. temu',
    'units.daysAgo': '{n} dni temu',
    'units.inMinutes': 'za {n} min',
    'units.inHours': 'za {n} godz.',
    'units.inDays': 'za {n} dni',
    'units.anyNow': 'teraz',
  },

  de: {
    'app.name': 'RSS Reader',

    'common.loading': 'Wird geladen…',
    'common.unknownError': 'unbekannter Fehler',
    'common.publishedShort': 'veröff.',
    'common.untitled': 'Überschrift ohne Titel',
    'common.theme.light': 'Helles Theme',
    'common.theme.dark': 'Dunkles Theme',
    'common.theme.toggle': 'Theme wechseln',

    // Beschriftungen des Bildschirmwechslers — ein Satz für alle drei Bildschirme: hier sind sie
    // zugleich Tooltip und aria-label.
    'nav.reader': 'Lesefenster',
    'nav.feeds': 'Feed-Einstellungen',
    'nav.global': 'Globale Einstellungen',
    'nav.group': 'Zwischen den Bildschirmen der Erweiterung wechseln',

    'reader.count.tooltip': 'Überschriften im Speicher',
    'reader.clearAll.tooltip': 'Alle Überschriften aus dem Speicher löschen',
    'reader.clearAll.aria': 'Alle löschen',
    'reader.clearFeed.tooltip': 'Überschriften dieses Feeds aus dem Speicher löschen',
    'reader.clearFeed.aria': 'Löschen',

    'reader.feeds.panelAria': 'Liste der RSS-Feeds',
    'reader.feeds.title': 'Feeds',
    'reader.feeds.empty': 'Keine Feeds. Fügen Sie sie auf dem Bildschirm „Feed-Einstellungen“ hinzu.',
    'reader.feeds.all': 'Alle Feeds',
    'reader.feeds.allMeta': { other: '{count} Überschr.' },
    'reader.refresh.tooltip': 'Überschriften des ausgewählten Feeds laden',
    'reader.refresh.aria': 'Aktualisieren',
    'reader.refreshAll.tooltip': 'Überschriften aller Feeds jetzt laden',
    'reader.refreshAll.aria': 'Alle Feeds aktualisieren',
    'reader.feed.itemMeta': { other: '{count} Überschr. · Aktualisierung alle {duration}' },
    'reader.feed.failedCount': 'Abruf-Fehler: {count}',
    'reader.feed.lastChecked': 'zuletzt geprüft: {since}',
    'reader.feed.lastError': 'letzter Fehler: {error}',
    'reader.feed.nextRetry': 'nächster Versuch: {until}',
    'reader.feed.nextCheck': 'nächste Prüfung: {until}',
    'reader.status.lastFetched': 'Headlines abgerufen {since}',
    'reader.status.nextCheck': 'nächste Prüfung {until}',

    // Die erste Begegnung mit dem Lesefenster: die mittlere Spalte ist leer, solange kein Feed
    // hinzugefügt ist, und ihr Knopf führt zu den Feed-Einstellungen. Der rechte Panel sagt dasselbe
    // dort, wo ein Artikel stünde.
    'reader.start.title': 'Noch keine Feeds',
    'reader.start.hint': 'Fügen Sie Ihren ersten Feed hinzu: seine Schlagzeilen erscheinen in dieser Spalte, der Nachrichtentext in der rechten.',
    'reader.start.openFeeds': 'Feed-Einstellungen öffnen',
    'reader.start.contentHint': 'Noch keine Feeds: fügen Sie Ihren ersten auf dem Bildschirm „Feed-Einstellungen“ hinzu.',

    'reader.headlines.panelAria': 'Nachrichtenschlagzeilen',
    'reader.headlines.title': 'Schlagzeilen',
    'reader.headlines.emptyNoFeed': 'Wählen Sie links einen Feed aus.',
    'reader.headlines.emptyForFeed': 'Für diesen Feed liegen noch keine Schlagzeilen im Speicher.',
    'reader.headlines.emptyAllFeeds': 'Für keinen Feed liegen noch Schlagzeilen im Speicher.',
    'reader.headlines.emptySearch': 'Keine Schlagzeile passt zu dieser Suche.',
    'reader.search.placeholder': 'Schlagzeilen durchsuchen',
    'reader.search.aria': 'Schlagzeilen durchsuchen',
    'reader.published': 'veröff. {since}',

    // Die eigene Tastaturhilfe des Readers: der Button »?“ in seinem Kopf und dieselbe Taste `?`.
    // Ihre Zeilen sagen, was die Tabelle des README aufführt – jetzt dort, wo die Tasten gebraucht werden.
    'reader.keys.toggle': 'Die Tasten des Readers zeigen',
    'reader.keys.title': 'Tasten des Readers',
    'reader.keys.close': 'Tastaturübersicht schließen',
    'reader.keys.caption': 'Die Tasten des Readers und was jede von ihnen tut',
    'reader.keys.columnKey': 'Taste',
    'reader.keys.columnWhat': 'Wirkung',
    'reader.keys.search': 'Cursor ins Suchfeld setzen',
    'reader.keys.next': 'nächste Schlagzeile der Auswahl öffnen',
    'reader.keys.prev': 'vorherige Schlagzeile der Auswahl öffnen',
    'reader.keys.original': 'Original der geöffneten Schlagzeile in neuem Tab öffnen',
    'reader.keys.refresh': 'ausgewählten Feed neu einlesen („Alle Feeds“ — alle)',
    'reader.keys.mark': 'die geöffnete Schlagzeile als gelesen markieren oder diese Markierung zurücknehmen',
    'reader.keys.delete': 'geöffnete Schlagzeile löschen (sie lässt sich noch zurückholen)',
    'reader.keys.undo': 'die gerade gelöschte Schlagzeile zurückholen',
    'reader.keys.escape': 'Suchfeld leeren, die geöffnete Schlagzeile bleibt; außerhalb des Feldes die gelöschte Schlagzeile zurückholen',
    'reader.keys.help': 'diese Tastaturübersicht öffnen oder schließen (Esc schließt sie auch)',
    'reader.keys.fullText': 'den Volltext der geöffneten Schlagzeile von der Seite lesen',
    'reader.keys.hint': 'Die Tasten sind zurückgehalten, während in ein Feld geschrieben wird (das Suchfeld belegt dieselben Buchstaben), und werden Ctrl/Meta/Alt nie entnommen. Die Pfeile funktionieren auch im Suchfeld: die Wörter bleiben, der Cursor wandert durch die Schlagzeilen, die die Suche übrig lässt. Die Buchstaben werden nach ihrer Stelle auf der Tastatur erkannt, nicht nach dem Zeichen, das die aktuelle Belegung druckt: auf einer kyrillischen Belegung drucken diese Tasten «о», «л», «к», «ь», «в», «г», und das Suchfeld gehört der Taste unter / (der mit «.»).',

    'reader.content.panelAria': 'Inhalt der Nachricht',
    'reader.content.delete.tooltip': 'Schlagzeile aus der Liste und aus dem Speicher löschen',
    'reader.content.delete.aria': 'Löschen',
    'reader.content.mark.tooltip': 'Als gelesen markieren: kein Feed bringt diese Nachricht zurück',
    'reader.content.mark.aria': 'Als gelesen markieren',
    'reader.content.unmark.tooltip': 'Markierung zurücknehmen: der Feed bringt diese Schlagzeile wieder',
    'reader.content.unmark.aria': 'Markierung als gelesen zurücknehmen',
    'reader.content.empty': 'Wählen Sie eine Schlagzeile im mittleren Bereich.',
    'reader.placeholder.inMiddle': 'Die Schlagzeilen dieses Feeds sind im mittleren Bereich.',
    'reader.placeholder.deletedLast': 'Schlagzeile gelöscht: in diesem Feed ist nichts mehr übrig.',
    'reader.placeholder.deletedLastAll': 'Schlagzeile gelöscht: im Speicher ist nichts mehr übrig.',
    'reader.placeholder.expired': 'Die geöffnete Schlagzeile wurde aus dem Speicher entfernt: clean_timeout abgelaufen.',
    'reader.source': '{name} · veröff. {since}',
    'reader.openOriginal.tooltip': 'Original in einem neuen Tab öffnen',
    'reader.content.noDescription': 'Für diese Nachricht ist keine Beschreibung gespeichert.',
    'reader.content.originalByLink': 'Das Original ist über den Link in der Schlagzeile erreichbar.',
    'reader.content.truncated': 'Beschreibung wegen der Längenbegrenzung gekürzt.',
    'reader.content.marked': 'Diese Schlagzeile ist als gelesen markiert: kein Feed bringt sie zurück, solange ihre Markierung lebt.',
    'reader.content.article.tooltip': 'Den vollständigen Text dieser Nachricht von der Seite laden',
    'reader.content.article.aria': 'Volltext',
    'reader.content.articleLoading': 'Die Seite wird gelesen…',
    'reader.content.articleTruncated': 'Artikeltext wegen der Längenbegrenzung gekürzt.',
    'reader.content.articleNone': 'Auf der Seite wurde kein Artikeltext gefunden.',
    'reader.undo.prompt': '„{title}“ gelöscht',
    'reader.undo.button': 'Rückgängig',
    'reader.confirmClear': {
      one: '{count} Schlagzeile löschen? Sie wird als gelesen markiert und kommt nicht zurück, solange ihre Markierung lebt.',
      other: '{count} Schlagzeilen löschen? Sie werden als gelesen markiert und kommen nicht zurück, solange ihre Markierungen leben.',
    },
    'reader.refresh.noFeed': 'Zuerst einen Feed auswählen.',
    'reader.refresh.failed': 'Feed konnte nicht aktualisiert werden: {error}',
    'reader.refreshAll.failed': 'Einige Feeds konnten nicht aktualisiert werden: {error}',

    'reader.fontScale.aria': 'Schriftgröße in dieser Spalte',
    'reader.fontScale.small': 'Kleine Schrift',
    'reader.fontScale.normal': 'Normale Schrift',
    'reader.fontScale.large': 'Große Schrift',
    'reader.fontScale.xlarge': 'Sehr große Schrift',

    'reader.announce.loaded': { one: '{count} neue Schlagzeile geladen', other: '{count} neue Schlagzeilen geladen' },
    'reader.announce.none': 'keine neuen Schlagzeilen',
    'reader.announce.failed': { one: '{count} Feed konnte nicht aktualisiert werden', other: '{count} Feeds konnten nicht aktualisiert werden' },
    'reader.announce.error': 'Aktualisierung fehlgeschlagen: {error}',
    'reader.announce.cleared': { one: '{count} Schlagzeile entfernt', other: '{count} Schlagzeilen entfernt' },
    'reader.announce.deleted': 'Schlagzeile gelöscht',
    'reader.announce.marked': 'Schlagzeile als gelesen markiert',
    'reader.announce.unmarked': 'die Lese-Markierung wurde zurückgenommen',
    'reader.announce.undone': 'Schlagzeile zurückgeholt',
    'reader.announce.undoFailed': 'die Schlagzeile ließ sich nicht zurückholen: ihr Feed existiert nicht mehr',
    'reader.feeds.list.aria': 'Feeds: wählen Sie einen Feed, um seine Schlagzeilen zu lesen',
    'reader.headlines.list.aria': 'Liste der Schlagzeilen des gewählten Feeds',

    'reader.column.resize': 'Ziehen, um die Breite dieser Spalte zu ändern',

    'feeds.title': 'Einstellungen der RSS-Feeds',
    'feeds.caption': 'Feedtabelle: Name, Link, Zeitraum des Schlagzeilenladens, Aufbewahrungszeit der Nachricht',
    'feeds.add': 'Feed hinzufügen',
    'feeds.empty': 'Keine Feeds. Klicken Sie auf „Feed hinzufügen“.',
    'feeds.info.tooltip': 'So funktionieren Ladezeitraum und Aufbewahrungszeit',
    'feeds.info.aria': 'So funktionieren Ladezeitraum und Aufbewahrungszeit',
    'feeds.hint':
      'Zeitraum des Schlagzeilenladens — wie oft der Feed automatisch gelesen wird (in Minuten; Chrome erlaubt weniger als 1 Minute nicht). Aufbewahrungszeit der Nachricht — wie lange eine Nachricht nach dem Laden im Speicher bleibt (in Minuten); danach wird sie automatisch gelöscht.',

    'feeds.field.name': 'Feed-Name',
    'feeds.field.rss': 'Link',
    'feeds.field.delay': 'Zeitraum des Schlagzeilenladens',
    'feeds.field.clean': 'Aufbewahrungszeit der Nachricht',

    'feeds.save': 'Speichern',
    'feeds.addCard': 'Feed hinzufügen',
    'feeds.loadNow': 'Jetzt laden',
    'feeds.delete': 'Entfernen',
    'feeds.cancel': 'Abbrechen',
    'feeds.draftNote': 'Neuer Feed — speichern, um das automatische Laden einzuschalten',
    'feeds.status.saved': 'Gespeichert',
    'feeds.status.firstFeed': 'Feed hinzugefügt, erste Schlagzeilen geladen.',
    'feeds.status.checkFields': 'Felder überprüfen',
    'feeds.status.loadError': 'Fehler beim Laden',
    'feeds.confirmDelete': 'Feed „{name}“ samt seinen Schlagzeilen löschen?',
    'feeds.result': 'Neu: {added}, gelesen: {seen}{read}',
    'feeds.resultRead': ', bereits gelesen: {skipped}',
    'feeds.resultUnchanged': 'Der Server antwortete: Der Feed ist unverändert',
    'feeds.error.name': 'Geben Sie einen Feed-Namen an',
    'feeds.error.nameTooLong': 'Name ist zu lang',
    'feeds.error.link': 'Der Link muss mit http:// oder https:// beginnen',
    'feeds.error.delay': 'Ladezeitraum — mindestens 1 Minute',
    'feeds.error.clean': 'Aufbewahrungszeit — mindestens 1 Minute',

    'feeds.export': 'Feeds in eine Datei schreiben',
    'feeds.import': 'Feeds aus einer Datei lesen',
    'feeds.export.done': 'Feeds geschrieben: {count}',
    'feeds.export.empty': 'Nichts zu schreiben: Es gibt keine Feeds',
    'feeds.import.added': 'Feeds hinzugefügt: {count}',
    'feeds.import.existing': 'schon eingerichtet: {count}',
    'feeds.import.invalid': 'Zeilen verworfen: {count}',
    'feeds.import.none': 'Die Datei ist gelesen, enthält aber keine neuen Feeds',
    'feeds.import.error.json': 'Die Datei ist kein lesbares JSON',
    'feeds.import.error.version': 'Die Datei ist in einer anderen Formatversion geschrieben',
    'feeds.import.error.shape': 'Die Datei enthält keine Feedliste',

    'feeds.health.checked': 'zuletzt geprüft {since}',
    'feeds.health.next': 'nächste Prüfung {until}',
    'feeds.health.error': 'Fehler: {error}',
    'feeds.health.streak': { other: '{count} Fehler in Folge' },
    'feeds.health.pause': 'nächster Versuch {until}',

    'settings.title': 'Globale Einstellungen',
    'settings.caption': 'Einstellungen: Horizont der gelesenen Markierungen, Ladesignal, Sprache der Oberfläche',
    'settings.save': 'Speichern',
    'settings.clearRead': 'Gelesene vergessen',
    'settings.ttl': 'Gelesene nach wie vielen Tagen vergessen',
    'settings.daysUnit': 'Tage',
    'settings.sound': 'Ton beim Herunterladen',
    'settings.soundNone': 'Ohne Ton',
    'settings.soundName': 'Dateiname',
    'settings.soundPlay.tooltip': 'Ausgewähltes Signal anhören',
    'settings.soundPlay.aria': 'Ausgewähltes Signal anhören',
    'settings.soundVolume': 'Signal-Lautstärke',
    'settings.soundEnabled': 'aktiviert',
    'settings.showMessage': 'Meldung anzeigen',
    'settings.info.tooltip': 'Wie gelesene Markierungen funktionieren',
    'settings.info.aria': 'Wie gelesene Markierungen funktionieren',
    'settings.hint':
      'Eine aus der Lesefenster-Liste gelöschte Schlagzeile wird als gelesen markiert, damit der Feed sie beim nächsten Laden nicht zurückbringt. Nach einigen Tagen verfällt die Markierung, und die Nachricht kann wieder erscheinen. „Gelesene vergessen“ löscht alle Markierungen auf einmal — gelöschte Nachrichten kehren in die Feeds zurück.',
    'settings.readStats.none': 'keine gelesenen Markierungen',
    'settings.readStats': 'gelesene Markierungen: {count} · verfallen in {ttl}',
    'settings.readStats.capped':
      'der Leser hält höchstens {max} Markierungen: die ältesten wurden vor ihrer Frist vergessen, diese verfallen in {honored}',
    'settings.soundStats': 'spielt gerade: {name}',
    'settings.save.tooltipDirty': 'Frist, Ton und Sprache im Speicher ablegen',
    'settings.save.tooltipClean': 'Alle Felder sind bereits gespeichert',
    'settings.status.pending': 'Änderungen nicht gespeichert',
    'settings.status.error': 'Nicht gespeichert',
    'settings.status.nothing': 'Es gibt nichts zu speichern',
    'settings.status.saved': 'Gespeichert: {parts}',
    'settings.status.nothingToPlay': 'Ohne Ton — es gibt nichts abzuspielen',
    'settings.status.playError': 'Signal konnte nicht angehört werden',
    'settings.confirmLeave': 'Änderungen sind nicht gespeichert. Ohne Speichern fortfahren?',
    'settings.confirmClear': 'Alle gelesenen Markierungen vergessen? Gelöschte Nachrichten können in die Feeds zurückkehren.',
    'settings.status.cleared': 'Vergessene Gelesene: {count}',
    'settings.status.emptyRead': 'Die Liste der Gelesenen ist bereits leer',
    'settings.ttlError': 'Ganzzahl von {min} bis {max} Tagen',
    'settings.ttlDays': { other: '{days} T.' },
    'settings.ttlYears': { other: '{days} T. ({years} J.)' },
    'settings.savedTtl': 'verfallen in {ttl}',
    'settings.savedSound': 'Ton: {name}',
    'settings.savedSoundEnabled': 'Ton {state}',
    'settings.savedSoundEnabled.on': 'an',
    'settings.savedSoundEnabled.off': 'aus',
    'settings.savedVolume': 'Lautstärke: {volume}%',
    'settings.savedMessage': 'Meldung: {state}',
    'settings.savedMessage.on': 'ein',
    'settings.savedMessage.off': 'aus',
    'settings.savedLanguage': 'Sprache: {name}',
    'settings.soundDescNone': 'ohne Ton',
    'settings.language': 'Oberflächensprache',

    // Der Popup des automatischen Ladens: wie viele Schlagzeilen es gebracht hat.
    'notify.news': { one: '{count} neue Schlagzeile geladen', other: '{count} neue Schlagzeilen geladen' },

    'errors.feedNotFound': 'Feed nicht gefunden',
    'errors.feedUrl': 'Der Feed-Link muss mit http:// oder https:// beginnen',
    'errors.feedFetch': 'Feed konnte nicht geladen werden: {cause}',
    'errors.feedStatus': 'Feed antwortete {status} {statusText}',
    'errors.feedTimeout': 'Der Feed hat nicht innerhalb von {seconds} s geantwortet',
    'errors.feedEmpty': 'Feed hat eine leere Antwort zurückgegeben',
    'errors.feedNotXml': 'Die Antwort sieht nicht nach korrektem Feed-XML aus',
    'errors.feedEmptyXml': 'Leeres Feed-XML',
    'errors.feedNotFeed': 'Die Antwort ist kein News-Feed',
    'errors.feedNotJson': 'Die Antwort sieht nicht nach korrektem Feed-JSON aus',
    'errors.feedUnknown': 'Feed konnte nicht gelesen werden: {message}',
    'errors.storageUnavailable': 'Der Speicher der Erweiterung hat nicht geantwortet: {cause}',
    'errors.offscreenUnavailable': 'Die Diensthälfte der Erweiterung konnte nicht geöffnet werden',
    'errors.offscreenNoReply': 'Die Diensthälfte der Erweiterung hat nicht geantwortet{cause}',
    'errors.articleFetch': 'Seite konnte nicht geladen werden: {cause}',
    'errors.articleStatus': 'Seite antwortete {status} {statusText}',
    'errors.articleTimeout': 'Die Seite hat nicht innerhalb von {seconds} s geantwortet',
    'errors.articleType': 'Nicht unterstützter Inhaltstyp: {type}',
    'errors.articleEmpty': 'Die Seite hat keinen Inhalt',

    'units.empty': '—',
    'units.minutes': '{n} Min.',
    'units.hours': '{n} Std.',
    'units.days': '{n} T.',
    'units.justNow': 'gerade eben',
    'units.minutesAgo': 'vor {n} Min.',
    'units.hoursAgo': 'vor {n} Std.',
    'units.daysAgo': 'vor {n} T.',
    'units.inMinutes': 'in {n} Min.',
    'units.inHours': 'in {n} Std.',
    'units.inDays': 'in {n} T.',
    'units.anyNow': 'jetzt',
  },

  fr: {
    'app.name': 'RSS Reader',

    'common.loading': 'Chargement…',
    'common.unknownError': 'erreur inconnue',
    'common.publishedShort': 'publ.',
    'common.untitled': 'Titre sans intitulé',
    'common.theme.light': 'Thème clair',
    'common.theme.dark': 'Thème sombre',
    'common.theme.toggle': 'Changer de thème',

    // Légendes du sélecteur d'écrans — un seul jeu pour les trois écrans : c'est à la fois
    // l'infobulle et l'aria-label.
    'nav.reader': 'Lecteur',
    'nav.feeds': 'Réglages des flux',
    'nav.global': 'Réglages globaux',
    'nav.group': 'Basculer entre les écrans de l’extension',

    'reader.count.tooltip': 'Titres dans le stockage',
    'reader.clearAll.tooltip': 'Supprimer tous les titres du stockage',
    'reader.clearAll.aria': 'Tout supprimer',
    'reader.clearFeed.tooltip': 'Supprimer les titres de ce flux du stockage',
    'reader.clearFeed.aria': 'Supprimer',

    'reader.feeds.panelAria': 'Liste des flux RSS',
    'reader.feeds.title': 'Flux',
    'reader.feeds.empty': 'Aucun flux. Ajoutez-les sur l’écran « Réglages des flux ».',
    'reader.feeds.all': 'Tous les flux',
    'reader.feeds.allMeta': { one: '{count} titre', other: '{count} titres' },
    'reader.refresh.tooltip': 'Charger les titres du flux sélectionné',
    'reader.refresh.aria': 'Actualiser',
    'reader.refreshAll.tooltip': 'Charger maintenant les titres de tous les flux',
    'reader.refreshAll.aria': 'Actualiser tous les flux',
    'reader.feed.itemMeta': { one: '{count} titre · actualisation toutes les {duration}', other: '{count} titres · actualisation toutes les {duration}' },
    'reader.feed.failedCount': 'échecs de chargement : {count}',
    'reader.feed.lastChecked': 'dernière vérification : {since}',
    'reader.feed.lastError': 'dernière erreur : {error}',
    'reader.feed.nextRetry': 'nouvel essai : {until}',
    'reader.feed.nextCheck': 'prochaine vérification : {until}',
    'reader.status.lastFetched': 'titres récupérés {since}',
    'reader.status.nextCheck': 'prochaine vérification {until}',

    // La première ouverture du lecteur : la colonne du milieu est vide tant qu’aucun flux n’est
    // ajouté, et son bouton mène à l’écran des flux. Le panneau de droite dit la même chose là où
    // se tiendrait l’article.
    'reader.start.title': 'Aucun flux pour le moment',
    'reader.start.hint': 'Ajoutez votre premier flux : ses titres s’affichent dans cette colonne et le texte de l’actualité dans celui de droite.',
    'reader.start.openFeeds': 'Ouvrir les réglages des flux',
    'reader.start.contentHint': 'Aucun flux pour le moment : ajoutez le vôtre sur l’écran « Réglages des flux ».',

    'reader.headlines.panelAria': 'Titres des actualités',
    'reader.headlines.title': 'Titres',
    'reader.headlines.emptyNoFeed': 'Sélectionnez un flux à gauche.',
    'reader.headlines.emptyForFeed': 'Ce flux n’a encore aucun titre dans le stockage.',
    'reader.headlines.emptyAllFeeds': 'Aucun flux n’a encore de titre dans le stockage.',
    'reader.headlines.emptySearch': 'Aucun titre ne correspond à cette recherche.',
    'reader.search.placeholder': 'Rechercher dans les titres',
    'reader.search.aria': 'Rechercher dans les titres',
    'reader.published': 'publ. {since}',

    // L’aide sur les touches du lecteur lui-même : le bouton « ? » dans son en-tête et la touche `?`
    // elle-même. Ses lignes disent ce que la liste du README énumère — là où les touches servent.
    'reader.keys.toggle': 'Afficher les touches auxquelles le lecteur répond',
    'reader.keys.title': 'Touches du lecteur',
    'reader.keys.close': 'Fermer la liste des touches',
    'reader.keys.caption': 'Les touches du lecteur et ce que chacune fait',
    'reader.keys.columnKey': 'Touche',
    'reader.keys.columnWhat': 'Action',
    'reader.keys.search': 'placer le curseur dans le champ de recherche',
    'reader.keys.next': 'ouvrir le titre suivant de la sélection',
    'reader.keys.prev': 'ouvrir le titre précédent de la sélection',
    'reader.keys.original': 'ouvrir l’original du titre ouvert dans un nouvel onglet',
    'reader.keys.refresh': 'recharger le flux sélectionné (« Tous les flux » — tous)',
    'reader.keys.mark': 'marquer le titre ouvert comme lu, ou retirer cette marque',
    'reader.keys.delete': 'supprimer le titre ouvert (il peut encore être récupéré)',
    'reader.keys.undo': 'récupérer le titre qui vient d’être supprimé',
    'reader.keys.escape': 'vider le champ de recherche, le titre ouvert reste ; hors du champ, récupérer le titre supprimé',
    'reader.keys.help': 'ouvrir ou fermer cette liste de touches (Esc la ferme aussi)',
    'reader.keys.fullText': 'lire le texte intégral du titre ouvert depuis sa page',
    'reader.keys.hint': 'Les touches sont tenues en réserve pendant la saisie d’un champ (le champ de recherche porte les mêmes lettres) et ne sont jamais prises à Ctrl/Meta/Alt. Les flèches fonctionnent aussi depuis le champ de recherche : les mots restent, le curseur parcourt les titres que la recherche laisse. Les lettres sont reconnues d’après leur place sur le clavier, non d’après le caractère que la disposition actuelle imprime : sur une disposition cyrillique, ces touches impriment «о», «л», «к», «ь», «в», «г», et le champ de recherche appartient à la touche placée sous / (celle qui imprime «.» là).',

    'reader.content.panelAria': 'Contenu de l’actualité',
    'reader.content.delete.tooltip': 'Supprimer le titre de la liste et du stockage',
    'reader.content.delete.aria': 'Supprimer',
    'reader.content.mark.tooltip': 'Marquer comme lu : aucun flux ne rapportera cette actualité à nouveau',
    'reader.content.mark.aria': 'Marquer comme lu',
    'reader.content.unmark.tooltip': 'Retirer la marque : le flux rapportera ce titre à nouveau',
    'reader.content.unmark.aria': 'Retirer la marque de lecture',
    'reader.content.empty': 'Sélectionnez un titre dans le panneau du milieu.',
    'reader.placeholder.inMiddle': 'Les titres de ce flux sont dans le panneau du milieu.',
    'reader.placeholder.deletedLast': 'Titre supprimé : il ne reste plus rien dans ce flux.',
    'reader.placeholder.deletedLastAll': 'Titre supprimé : il ne reste plus rien dans le stockage.',
    'reader.placeholder.expired': 'Le titre ouvert a quitté le stockage : clean_timeout expiré.',
    'reader.source': '{name} · publ. {since}',
    'reader.openOriginal.tooltip': 'Ouvrir l’original dans un nouvel onglet',
    'reader.content.noDescription': 'Aucune description enregistrée pour cette actualité.',
    'reader.content.originalByLink': 'L’original est accessible par le lien du titre.',
    'reader.content.truncated': 'Description tronquée à la limite de longueur.',
    'reader.content.marked': 'Ce titre est marqué comme lu : aucun flux ne le rapportera tant que sa marque est active.',
    'reader.content.article.tooltip': 'Charger le texte intégral de cette actualité depuis sa page',
    'reader.content.article.aria': 'Texte intégral',
    'reader.content.articleLoading': 'Lecture de la page…',
    'reader.content.articleTruncated': 'Texte de l’article tronqué à la limite de longueur.',
    'reader.content.articleNone': 'Aucun texte d’article trouvé sur la page.',
    'reader.undo.prompt': '« {title} » supprimé',
    'reader.undo.button': 'Annuler',
    'reader.confirmClear': {
      one: 'Supprimer {count} titre ? Il sera marqué comme lu et ne reviendra pas tant que sa marque est active.',
      other: 'Supprimer {count} titres ? Ils seront marqués comme lus et ne reviendront pas tant que leurs marques sont actives.',
    },
    'reader.refresh.noFeed': 'Sélectionnez d’abord un flux.',
    'reader.refresh.failed': 'Échec de l’actualisation du flux : {error}',
    'reader.refreshAll.failed': 'Certains flux n’ont pas pu être actualisés : {error}',

    'reader.fontScale.aria': 'Taille de la police dans cette colonne',
    'reader.fontScale.small': 'Petite police',
    'reader.fontScale.normal': 'Police normale',
    'reader.fontScale.large': 'Grande police',
    'reader.fontScale.xlarge': 'Très grande police',

    'reader.announce.loaded': { one: '{count} nouveau titre chargé', other: '{count} nouveaux titres chargés' },
    'reader.announce.none': 'aucun nouveau titre',
    'reader.announce.failed': { one: '{count} flux n’a pas pu être actualisé', other: '{count} flux n’ont pas pu être actualisés' },
    'reader.announce.error': 'actualisation échouée : {error}',
    'reader.announce.cleared': { one: '{count} titre supprimé', other: '{count} titres supprimés' },
    'reader.announce.deleted': 'titre supprimé',
    'reader.announce.marked': 'titre marqué comme lu',
    'reader.announce.unmarked': 'la marque de lecture a été retirée',
    'reader.announce.undone': 'titre récupéré',
    'reader.announce.undoFailed': 'impossible de récupérer le titre : son flux n’existe plus',
    'reader.feeds.list.aria': 'Flux : choisissez un flux pour lire ses titres',
    'reader.headlines.list.aria': 'Liste des titres du flux choisi',

    'reader.column.resize': 'Faites glisser pour modifier la largeur de cette colonne',

    'feeds.title': 'Réglages des flux RSS',
    'feeds.caption': 'Tableau des flux : nom du flux, lien, périodicité du chargement des titres, durée de conservation de l’actualité',
    'feeds.add': 'Ajouter un flux',
    'feeds.empty': 'Aucun flux. Cliquez sur « Ajouter un flux ».',
    'feeds.info.tooltip': 'Comment fonctionnent la périodicité et la durée de conservation',
    'feeds.info.aria': 'Comment fonctionnent la périodicité et la durée de conservation',
    'feeds.hint':
      'Périodicité du chargement des titres — à quelle fréquence le flux est lu automatiquement (en minutes ; Chrome n’autorise pas moins d’une minute). Durée de conservation de l’actualité — pendant combien de temps une actualité reste dans le stockage après son chargement (en minutes) ; passé ce délai, elle est supprimée automatiquement.',

    'feeds.field.name': 'Nom du flux',
    'feeds.field.rss': 'Lien',
    'feeds.field.delay': 'Périodicité du chargement des titres',
    'feeds.field.clean': 'Durée de conservation de l’actualité',

    'feeds.save': 'Enregistrer',
    'feeds.addCard': 'Ajouter un flux',
    'feeds.loadNow': 'Charger maintenant',
    'feeds.delete': 'Supprimer',
    'feeds.cancel': 'Annuler',
    'feeds.draftNote': 'Nouveau flux — enregistrez-le pour activer le chargement automatique',
    'feeds.status.saved': 'Enregistré',
    'feeds.status.firstFeed': 'Flux ajouté, premiers titres chargés.',
    'feeds.status.checkFields': 'Vérifiez les champs',
    'feeds.status.loadError': 'Erreur de chargement',
    'feeds.confirmDelete': 'Supprimer le flux « {name} » avec ses titres ?',
    'feeds.result': 'Nouveaux : {added}, lus : {seen}{read}',
    'feeds.resultRead': ', déjà lus : {skipped}',
    'feeds.resultUnchanged': 'Le serveur a répondu : le flux n’a pas changé',
    'feeds.error.name': 'Indiquez un nom de flux',
    'feeds.error.nameTooLong': 'Nom trop long',
    'feeds.error.link': 'Le lien doit commencer par http:// ou https://',
    'feeds.error.delay': 'Périodicité de chargement — au moins 1 minute',
    'feeds.error.clean': 'Durée de conservation — au moins 1 minute',

    'feeds.export': 'Écrire les flux dans un fichier',
    'feeds.import': 'Lire les flux depuis un fichier',
    'feeds.export.done': 'flux écrits : {count}',
    'feeds.export.empty': 'Rien à écrire : aucun flux',
    'feeds.import.added': 'flux ajoutés : {count}',
    'feeds.import.existing': 'déjà réglés : {count}',
    'feeds.import.invalid': 'lignes rejetées : {count}',
    'feeds.import.none': 'le fichier est lu, mais il n’apporte aucun flux',
    'feeds.import.error.json': 'Le fichier n’est pas du JSON lisible',
    'feeds.import.error.version': 'Le fichier est écrit dans une autre version du format',
    'feeds.import.error.shape': 'Le fichier ne contient pas de liste de flux',

    'feeds.health.checked': 'vérifié {since}',
    'feeds.health.next': 'prochaine vérification {until}',
    'feeds.health.error': 'erreur : {error}',
    'feeds.health.streak': { one: '{count} échec d’affilée', other: '{count} échecs d’affilée' },
    'feeds.health.pause': 'nouvel essai {until}',

    'settings.title': 'Réglages globaux',
    'settings.caption': 'Réglages : horizon des marques de lecture, signal de chargement, langue de l’interface',
    'settings.save': 'Enregistrer',
    'settings.clearRead': 'Oublier les lus',
    'settings.ttl': 'Oublier les lus après un nombre de jours donné',
    'settings.daysUnit': 'jours',
    'settings.sound': 'Son lors du téléchargement',
    'settings.soundNone': 'Sans son',
    'settings.soundName': 'nom du fichier',
    'settings.soundPlay.tooltip': 'Écouter le signal choisi',
    'settings.soundPlay.aria': 'Écouter le signal choisi',
    'settings.soundVolume': 'Volume du signal',
    'settings.soundEnabled': 'activé',
    'settings.showMessage': 'Afficher un message',
    'settings.info.tooltip': 'Fonctionnement des marques de lecture',
    'settings.info.aria': 'Fonctionnement des marques de lecture',
    'settings.hint':
      'Un titre supprimé du lecteur est marqué comme lu pour que le flux ne le ramène pas au chargement suivant. Au bout de quelques jours, la marque s’éteint et l’actualité peut réapparaître. « Oublier les lus » supprime toutes les marques d’un coup — les actualités supprimées reviennent dans les flux.',
    'settings.readStats.none': 'aucune marque de lecture',
    'settings.readStats': 'marques de lecture : {count} · expiration dans {ttl}',
    'settings.readStats.capped':
      'le lecteur garde au plus {max} marques : les plus anciennes ont été oubliées avant leur délai, celles-ci expirent dans {honored}',
    'settings.soundStats': 'en lecture : {name}',
    'settings.save.tooltipDirty': 'Enregistrer le délai, le son et la langue dans le stockage',
    'settings.save.tooltipClean': 'Tous les champs sont déjà enregistrés',
    'settings.status.pending': 'Modifications non enregistrées',
    'settings.status.error': 'Non enregistré',
    'settings.status.nothing': 'Rien à enregistrer',
    'settings.status.saved': 'Enregistré : {parts}',
    'settings.status.nothingToPlay': 'Sans son — rien à lire',
    'settings.status.playError': 'Impossible d’écouter le signal',
    'settings.confirmLeave': 'Modifications non enregistrées. Quitter sans enregistrer ?',
    'settings.confirmClear': 'Oublier toutes les marques de lecture ? Les actualités supprimées peuvent revenir dans les flux.',
    'settings.status.cleared': 'Lus oubliés : {count}',
    'settings.status.emptyRead': 'La liste des lus est déjà vide',
    'settings.ttlError': 'Nombre entier de {min} à {max} jours',
    'settings.ttlDays': { other: '{days} j' },
    'settings.ttlYears': { one: '{days} j ({years} an)', other: '{days} j ({years} ans)' },
    'settings.savedTtl': 'expiration dans {ttl}',
    'settings.savedSound': 'son : {name}',
    'settings.savedSoundEnabled': 'son {state}',
    'settings.savedSoundEnabled.on': 'activé',
    'settings.savedSoundEnabled.off': 'désactivé',
    'settings.savedVolume': 'volume : {volume} %',
    'settings.savedMessage': 'message : {state}',
    'settings.savedMessage.on': 'activé',
    'settings.savedMessage.off': 'désactivé',
    'settings.savedLanguage': 'langue : {name}',
    'settings.soundDescNone': 'sans son',
    'settings.language': 'Langue de l’interface',

    // Le popup du téléchargement automatique : combien de titres il a apportés.
    'notify.news': { one: '{count} nouveau titre chargé', other: '{count} nouveaux titres chargés' },

    'errors.feedNotFound': 'Flux introuvable',
    'errors.feedUrl': 'Le lien du flux doit commencer par http:// ou https://',
    'errors.feedFetch': 'Impossible de charger le flux : {cause}',
    'errors.feedStatus': 'Le flux a répondu {status} {statusText}',
    'errors.feedTimeout': 'Le flux n’a pas répondu sous {seconds} s',
    'errors.feedEmpty': 'Le flux a renvoyé une réponse vide',
    'errors.feedNotXml': 'La réponse ne ressemble pas à un XML de flux valide',
    'errors.feedEmptyXml': 'XML de flux vide',
    'errors.feedNotFeed': 'La réponse n’est pas un flux d’actualités',
    'errors.feedNotJson': 'La réponse ne ressemble pas à un JSON de flux valide',
    'errors.feedUnknown': 'impossible de lire le flux : {message}',
    'errors.storageUnavailable': 'le stockage de l’extension n’a pas répondu : {cause}',
    'errors.offscreenUnavailable': 'impossible d’ouvrir la page de service de l’extension',
    'errors.offscreenNoReply': 'la page de service de l’extension n’a pas répondu{cause}',
    'errors.articleFetch': 'Impossible de charger la page : {cause}',
    'errors.articleStatus': 'La page a répondu {status} {statusText}',
    'errors.articleTimeout': 'La page n’a pas répondu sous {seconds} s',
    'errors.articleType': 'Type de contenu non pris en charge : {type}',
    'errors.articleEmpty': 'La page n’a pas de contenu',

    'units.empty': '—',
    'units.minutes': '{n} min',
    'units.hours': '{n} h',
    'units.days': '{n} j',
    'units.justNow': 'à l’instant',
    'units.minutesAgo': 'il y a {n} min',
    'units.hoursAgo': 'il y a {n} h',
    'units.daysAgo': 'il y a {n} j',
    'units.inMinutes': 'dans {n} min',
    'units.inHours': 'dans {n} h',
    'units.inDays': 'dans {n} j',
    'units.anyNow': 'maintenant',
  },

  es: {
    'app.name': 'RSS Reader',

    'common.loading': 'Cargando…',
    'common.unknownError': 'error desconocido',
    'common.publishedShort': 'publ.',
    'common.untitled': 'Titular sin título',
    'common.theme.light': 'Tema claro',
    'common.theme.dark': 'Tema oscuro',
    'common.theme.toggle': 'Cambiar tema',

    // Rótulos del selector de pantallas — un solo juego para las tres pantallas: aquí son a la
    // vez tooltip y aria-label.
    'nav.reader': 'Lector',
    'nav.feeds': 'Ajustes de fuentes',
    'nav.global': 'Ajustes globales',
    'nav.group': 'Cambiar entre las pantallas de la extensión',

    'reader.count.tooltip': 'Titulares en el almacenamiento',
    'reader.clearAll.tooltip': 'Eliminar todos los titulares del almacenamiento',
    'reader.clearAll.aria': 'Eliminar todo',
    'reader.clearFeed.tooltip': 'Eliminar los titulares de esta fuente del almacenamiento',
    'reader.clearFeed.aria': 'Eliminar',

    'reader.feeds.panelAria': 'Lista de fuentes RSS',
    'reader.feeds.title': 'Fuentes',
    'reader.feeds.empty': 'No hay fuentes. Añádalas en la pantalla «Ajustes de fuentes».',
    'reader.feeds.all': 'Todas las fuentes',
    'reader.feeds.allMeta': { one: '{count} titular', other: '{count} titulares' },
    'reader.refresh.tooltip': 'Cargar los titulares de la fuente seleccionada',
    'reader.refresh.aria': 'Actualizar',
    'reader.refreshAll.tooltip': 'Cargar ahora los titulares de todas las fuentes',
    'reader.refreshAll.aria': 'Actualizar todas las fuentes',
    'reader.feed.itemMeta': { other: '{count} titul. · actualización cada {duration}' },
    'reader.feed.failedCount': 'fallos de carga: {count}',
    'reader.feed.lastChecked': 'última comprobación: {since}',
    'reader.feed.lastError': 'último error: {error}',
    'reader.feed.nextRetry': 'próximo intento: {until}',
    'reader.feed.nextCheck': 'próxima comprobación: {until}',
    'reader.status.lastFetched': 'titulares obtenidos {since}',
    'reader.status.nextCheck': 'próxima comprobación {until}',

    // La primera apertura del lector: la columna del centro está vacía mientras no haya ninguna
    // fuente, y su botón lleva a la pantalla de fuentes. El panel de la derecha dice lo mismo allí
    // donde estaría la noticia.
    'reader.start.title': 'Todavía no hay fuentes',
    'reader.start.hint': 'Aañada su primera fuente: sus titulares aparecerán en esta columna y el texto de la noticia en la de la derecha.',
    'reader.start.openFeeds': 'Abrir ajustes de fuentes',
    'reader.start.contentHint': 'Todavía no hay fuentes: añada la primera en la pantalla «Ajustes de fuentes».',

    'reader.headlines.panelAria': 'Titulares de noticias',
    'reader.headlines.title': 'Titulares',
    'reader.headlines.emptyNoFeed': 'Seleccione una fuente a la izquierda.',
    'reader.headlines.emptyForFeed': 'Esta fuente aún no tiene titulares en el almacenamiento.',
    'reader.headlines.emptyAllFeeds': 'Ninguna fuente tiene todavía titulares en el almacenamiento.',
    'reader.headlines.emptySearch': 'Ningún titular coincide con esta búsqueda.',
    'reader.search.placeholder': 'Buscar titulares',
    'reader.search.aria': 'Buscar titulares',
    'reader.published': 'publ. {since}',

    // Ayuda de teclas del propio lector: el botón «?» en su cabecera y la misma tecla `?`. Sus filas
    // dicen lo mismo que enumera la tabla del README, ahora junto a donde las teclas se usan.
    'reader.keys.toggle': 'Mostrar las teclas a las que responde el lector',
    'reader.keys.title': 'Teclas del lector',
    'reader.keys.close': 'Cerrar la lista de teclas',
    'reader.keys.caption': 'Las teclas del lector y lo que cada una hace',
    'reader.keys.columnKey': 'Tecla',
    'reader.keys.columnWhat': 'Qué hace',
    'reader.keys.search': 'llevar el cursor al campo de búsqueda',
    'reader.keys.next': 'abrir el siguiente titular de la selección actual',
    'reader.keys.prev': 'abrir el titular anterior de la selección actual',
    'reader.keys.original': 'abrir el original del titular abierto en una pestaña nueva',
    'reader.keys.refresh': 'volver a leer la fuente seleccionada («Todas las fuentes» — todas)',
    'reader.keys.mark': 'marcar como leído el titular abierto o quitar esa marca',
    'reader.keys.delete': 'eliminar el titular abierto (todavía se puede recuperar)',
    'reader.keys.undo': 'recuperar el titular recién eliminado',
    'reader.keys.escape': 'vaciar el campo de búsqueda y conservar el titular abierto; fuera del campo, recuperar el titular eliminado',
    'reader.keys.help': 'abrir o cerrar esta lista de teclas (Esc también la cierra)',
    'reader.keys.fullText': 'leer el texto completo del titular abierto desde su página',
    'reader.keys.hint': 'Las teclas no actúan mientras se escribe en un campo (el campo de búsqueda usa las mismas letras) y nunca se le quitan a Ctrl/Meta/Alt. Las flechas funcionan también desde el campo de búsqueda: las palabras se quedan y el cursor recorre los titulares que la búsqueda deja. Las letras se reconocen por su lugar en el teclado, no por el carácter que imprime la distribución actual: en una distribución cirílica esas teclas imprimen «о», «л», «к», «ь», «в», «г», y el campo de búsqueda corresponde a la tecla situada bajo / (la que imprime «.» allí).',

    'reader.content.panelAria': 'Contenido de la noticia',
    'reader.content.delete.tooltip': 'Eliminar el titular de la lista y del almacenamiento',
    'reader.content.delete.aria': 'Eliminar',
    'reader.content.mark.tooltip': 'Marcar como leído: ninguna fuente volverá a traer esta noticia',
    'reader.content.mark.aria': 'Marcar como leído',
    'reader.content.unmark.tooltip': 'Quitar la marca: la fuente volverá a traer este titular',
    'reader.content.unmark.aria': 'Quitar la marca de lectura',
    'reader.content.empty': 'Seleccione un titular en el panel central.',
    'reader.placeholder.inMiddle': 'Los titulares de esta fuente están en el panel central.',
    'reader.placeholder.deletedLast': 'Titular eliminado: no queda nada más en esta fuente.',
    'reader.placeholder.deletedLastAll': 'Titular eliminado: no queda nada más en el almacenamiento.',
    'reader.placeholder.expired': 'El titular abierto salió del almacenamiento: clean_timeout expirado.',
    'reader.source': '{name} · publ. {since}',
    'reader.openOriginal.tooltip': 'Abrir el original en una pestaña nueva',
    'reader.content.noDescription': 'No hay descripción guardada para esta noticia.',
    'reader.content.originalByLink': 'El original está disponible en el enlace del titular.',
    'reader.content.truncated': 'Descripción recortada por el límite de longitud.',
    'reader.content.marked': 'Este titular está marcado como leído: ninguna fuente lo traerá mientras su marca esté viva.',
    'reader.content.article.tooltip': 'Cargar el texto completo de esta noticia desde su página',
    'reader.content.article.aria': 'Texto completo',
    'reader.content.articleLoading': 'Leyendo la página…',
    'reader.content.articleTruncated': 'Texto del artículo recortado por el límite de longitud.',
    'reader.content.articleNone': 'No se encontró texto del artículo en la página.',
    'reader.undo.prompt': '«{title}» eliminado',
    'reader.undo.button': 'Deshacer',
    'reader.confirmClear': {
      one: '¿Eliminar {count} titular? Quedará marcado como leído y no volverá mientras su marca esté viva.',
      other: '¿Eliminar {count} titulares? Quedarán marcados como leídos y no volverán mientras sus marcas estén vivas.',
    },
    'reader.refresh.noFeed': 'Primero seleccione una fuente.',
    'reader.refresh.failed': 'No se pudo actualizar la fuente: {error}',
    'reader.refreshAll.failed': 'No se pudieron actualizar algunas fuentes: {error}',

    'reader.fontScale.aria': 'Tamaño de la letra en esta columna',
    'reader.fontScale.small': 'Letra pequeña',
    'reader.fontScale.normal': 'Letra normal',
    'reader.fontScale.large': 'Letra grande',
    'reader.fontScale.xlarge': 'Letra muy grande',

    'reader.announce.loaded': { one: '{count} titular nuevo cargado', other: '{count} titulares nuevos cargados' },
    'reader.announce.none': 'no hay titulares nuevos',
    'reader.announce.failed': { one: '{count} fuente no se pudo actualizar', other: '{count} fuentes no se pudieron actualizar' },
    'reader.announce.error': 'error al actualizar: {error}',
    'reader.announce.cleared': { one: '{count} titular eliminado', other: '{count} titulares eliminados' },
    'reader.announce.deleted': 'titular eliminado',
    'reader.announce.marked': 'titular marcado como leído',
    'reader.announce.unmarked': 'la marca de lectura se ha quitado',
    'reader.announce.undone': 'titular recuperado',
    'reader.announce.undoFailed': 'no se pudo recuperar el titular: su fuente ya no existe',
    'reader.feeds.list.aria': 'Fuentes: elija una fuente para leer sus titulares',
    'reader.headlines.list.aria': 'Lista de titulares de la fuente seleccionada',

    'reader.column.resize': 'Arrastre para cambiar el ancho de esta columna',

    'feeds.title': 'Ajustes de fuentes RSS',
    'feeds.caption': 'Tabla de fuentes: nombre de la fuente, enlace, periodicidad de carga de titulares, tiempo de conservación de la noticia',
    'feeds.add': 'Añadir fuente',
    'feeds.empty': 'No hay fuentes. Pulse «Añadir fuente».',
    'feeds.info.tooltip': 'Cómo funcionan la periodicidad de carga y el tiempo de conservación',
    'feeds.info.aria': 'Cómo funcionan la periodicidad de carga y el tiempo de conservación',
    'feeds.hint':
      'Periodicidad de carga de titulares — cada cuánto se lee la fuente automáticamente (en minutos; Chrome no permite menos de 1 minuto). Tiempo de conservación de la noticia — cuánto tiempo se guarda una noticia en el almacenamiento después de cargarse (en minutos); transcurrido ese tiempo se elimina automáticamente.',

    'feeds.field.name': 'Nombre de la fuente',
    'feeds.field.rss': 'Enlace',
    'feeds.field.delay': 'Periodicidad de carga de titulares',
    'feeds.field.clean': 'Tiempo de conservación de la noticia',

    'feeds.save': 'Guardar',
    'feeds.addCard': 'Añadir fuente',
    'feeds.loadNow': 'Cargar ahora',
    'feeds.delete': 'Eliminar',
    'feeds.cancel': 'Cancelar',
    'feeds.draftNote': 'Fuente nueva — guárdela para activar la carga automática',
    'feeds.status.saved': 'Guardado',
    'feeds.status.firstFeed': 'Fuente añadida, primeros titulares cargados.',
    'feeds.status.checkFields': 'Revise los campos',
    'feeds.status.loadError': 'Error de carga',
    'feeds.confirmDelete': '¿Eliminar la fuente «{name}» junto con sus titulares?',
    'feeds.result': 'Nuevos: {added}, leídos: {seen}{read}',
    'feeds.resultRead': ', ya leídos: {skipped}',
    'feeds.resultUnchanged': 'El servidor respondió: la fuente no ha cambiado',
    'feeds.error.name': 'Indique el nombre de la fuente',
    'feeds.error.nameTooLong': 'Nombre demasiado largo',
    'feeds.error.link': 'El enlace debe empezar por http:// o https://',
    'feeds.error.delay': 'Periodicidad de carga — no menos de 1 minuto',
    'feeds.error.clean': 'Tiempo de conservación — no menos de 1 minuto',

    'feeds.export': 'Guardar las fuentes en un archivo',
    'feeds.import': 'Leer las fuentes desde un archivo',
    'feeds.export.done': 'fuentes guardadas: {count}',
    'feeds.export.empty': 'Nada que guardar: no hay fuentes',
    'feeds.import.added': 'fuentes añadidas: {count}',
    'feeds.import.existing': 'ya configuradas: {count}',
    'feeds.import.invalid': 'filas rechazadas: {count}',
    'feeds.import.none': 'el archivo se leyó, pero no trae fuentes nuevas',
    'feeds.import.error.json': 'El archivo no se lee como JSON',
    'feeds.import.error.version': 'El archivo fue escrito en otra versión del formato',
    'feeds.import.error.shape': 'El archivo no contiene una lista de fuentes',

    'feeds.health.checked': 'comprobado {since}',
    'feeds.health.next': 'próxima comprobación {until}',
    'feeds.health.error': 'error: {error}',
    'feeds.health.streak': { one: '{count} fallo seguido', other: '{count} fallos seguidos' },
    'feeds.health.pause': 'próximo intento {until}',

    'settings.title': 'Ajustes globales',
    'settings.caption': 'Ajustes: horizonte de las marcas de leídas, señal de carga, idioma de la interfaz',
    'settings.save': 'Grabar',
    'settings.clearRead': 'Olvidar los leídos',
    'settings.ttl': 'olvidar los leídos pasados cuántos días',
    'settings.daysUnit': 'días',
    'settings.sound': 'Sonido al descargar',
    'settings.soundNone': 'Sin sonido',
    'settings.soundName': 'nombre del archivo',
    'settings.soundPlay.tooltip': 'Escuchar la señal elegida',
    'settings.soundPlay.aria': 'Escuchar la señal elegida',
    'settings.soundVolume': 'Volumen de la señal',
    'settings.soundEnabled': 'activado',
    'settings.showMessage': 'Mostrar un mensaje',
    'settings.info.tooltip': 'Cómo funcionan las marcas de lectura',
    'settings.info.aria': 'Cómo funcionan las marcas de lectura',
    'settings.hint':
      'Un titular eliminado del lector se marca como leído para que la fuente no lo devuelva en la siguiente carga. Pasados unos días la marca se agota y la noticia puede volver a aparecer. «Olvidar los leídos» elimina todas las marcas de una vez — las noticias eliminadas vuelven a las fuentes.',
    'settings.readStats.none': 'no hay marcas de lectura',
    'settings.readStats': 'marcas de lectura: {count} · caducan en {ttl}',
    'settings.readStats.capped':
      'el lector guarda como máximo {max} marcas: las más antiguas se olvidaron antes de plazo, estas caducan en {honored}',
    'settings.soundStats': 'suena ahora: {name}',
    'settings.save.tooltipDirty': 'Grabar el plazo, el sonido y el idioma en el almacenamiento',
    'settings.save.tooltipClean': 'Todos los campos ya están grabados',
    'settings.status.pending': 'Cambios no grabados',
    'settings.status.error': 'No grabado',
    'settings.status.nothing': 'No hay nada que grabar',
    'settings.status.saved': 'Grabado: {parts}',
    'settings.status.nothingToPlay': 'Sin sonido — no hay nada que reproducir',
    'settings.status.playError': 'No se pudo escuchar la señal',
    'settings.confirmLeave': 'Cambios no grabados. ¿Salir sin grabar?',
    'settings.confirmClear': '¿Olvidar todas las marcas de lectura? Las noticias eliminadas pueden volver a las fuentes.',
    'settings.status.cleared': 'Leídos olvidados: {count}',
    'settings.status.emptyRead': 'La lista de leídos ya está vacía',
    'settings.ttlError': 'Número entero de {min} a {max} días',
    'settings.ttlDays': { other: '{days} d' },
    'settings.ttlYears': { other: '{days} d ({years} a)' },
    'settings.savedTtl': 'caducan en {ttl}',
    'settings.savedSound': 'sonido: {name}',
    'settings.savedSoundEnabled': 'sonido {state}',
    'settings.savedSoundEnabled.on': 'activado',
    'settings.savedSoundEnabled.off': 'desactivado',
    'settings.savedVolume': 'volumen: {volume}%',
    'settings.savedMessage': 'mensaje: {state}',
    'settings.savedMessage.on': 'activado',
    'settings.savedMessage.off': 'desactivado',
    'settings.savedLanguage': 'idioma: {name}',
    'settings.soundDescNone': 'sin sonido',
    'settings.language': 'Idioma de la interfaz',

    // El popup de la descarga automática: cuántos titulares trajo esa descarga.
    'notify.news': { one: '{count} nuevo titular descargado', other: '{count} nuevos titulares descargados' },

    'errors.feedNotFound': 'Fuente no encontrada',
    'errors.feedUrl': 'El enlace de la fuente debe empezar por http:// o https://',
    'errors.feedFetch': 'No se pudo cargar la fuente: {cause}',
    'errors.feedStatus': 'La fuente respondió {status} {statusText}',
    'errors.feedTimeout': 'La fuente no respondió en {seconds} s',
    'errors.feedEmpty': 'La fuente devolvió una respuesta vacía',
    'errors.feedNotXml': 'La respuesta no parece un XML válido de fuente',
    'errors.feedEmptyXml': 'XML de fuente vacío',
    'errors.feedNotFeed': 'La respuesta no es una fuente de noticias',
    'errors.feedNotJson': 'La respuesta no parece un JSON válido de fuente',
    'errors.feedUnknown': 'no se pudo leer la fuente: {message}',
    'errors.storageUnavailable': 'el almacenamiento del lector no respondió: {cause}',
    'errors.offscreenUnavailable': 'no se pudo abrir la página de servicio de la extensión',
    'errors.offscreenNoReply': 'la página de servicio de la extensión no respondió{cause}',
    'errors.articleFetch': 'No se pudo cargar la página: {cause}',
    'errors.articleStatus': 'La página respondió {status} {statusText}',
    'errors.articleTimeout': 'La página no respondió en {seconds} s',
    'errors.articleType': 'Tipo de contenido no admitido: {type}',
    'errors.articleEmpty': 'La página no tiene contenido',

    'units.empty': '—',
    'units.minutes': '{n} min',
    'units.hours': '{n} h',
    'units.days': '{n} d',
    'units.justNow': 'ahora mismo',
    'units.minutesAgo': 'hace {n} min',
    'units.hoursAgo': 'hace {n} h',
    'units.daysAgo': 'hace {n} d',
    'units.inMinutes': 'en {n} min',
    'units.inHours': 'en {n} h',
    'units.inDays': 'en {n} d',
    'units.anyNow': 'ahora',
  },
};

/** Cached language so `t()` can run synchronously inside render loops like `humanDuration`. */
let cached = null;

export function normalizeLanguage(value) {
  return LANGUAGES.includes(value) ? value : null;
}

/**
 * The language from localStorage: extension pages of one origin see the same localStorage, so the
 * reader and the settings screen agree on the language synchronously, before the asynchronous read
 * of chrome.storage resolves.
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
 * The browser language in the form of a supported code: `ru-RU`/`en-GB` → `ru`/`en`. The first
 * supported one from `navigator.languages`. If the browser speaks a language the dictionary lacks —
 * null.
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

/** The language for synchronous rendering: the one already chosen, else the localStorage cache, else the browser language. */
export function currentLanguage() {
  cached = cached ?? getLanguageCache() ?? detectBrowserLanguage() ?? FALLBACK_LANGUAGE;
  return cached;
}

/** Substitute the `{key}` placeholders in a string from params. */
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] !== undefined && params[name] !== null ? String(params[name]) : match,
  );
}

/**
 * The form for an integer per CLDR rules: Russian, Ukrainian and Polish need "one", "few" and
 * "many"; French "one" covers zero too ("0 titre"); the rest make do with "one" and "many". A
 * fractional number (a period expressed in years) does not agree a noun.
 */
export function pluralCategory(lang, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return 'other';
  const n = Math.abs(number);
  if (lang === 'ru' || lang === 'uk' || lang === 'pl') {
    const lastTwo = n % 100;
    const last = n % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'many';
    if (last === 1) return 'one';
    if (last >= 2 && last <= 4) return 'few';
    return 'many';
  }
  if (lang === 'fr') return n <= 1 ? 'one' : 'other';
  return n === 1 ? 'one' : 'other';
}

/** The number a form agrees with: the first counter a record was given. */
function countParam(params) {
  if (!params) return null;
  for (const name of COUNT_PARAMS) {
    if (params[name] !== undefined && params[name] !== null) return params[name];
  }
  return null;
}

/**
 * The number form from an object entry: the language's category, with missing categories taking
 * `other`. The form must hold the number itself — there is nothing to substitute it with if
 * `{count}` went missing, and such an entry stays the only mistake a dictionary can make silently.
 */
function pluralForm(forms, lang, params, key) {
  const count = countParam(params);
  const template = (count === null ? null : forms[pluralCategory(lang, count)]) ?? forms.other ?? '';
  if (count !== null && !COUNT_PARAMS.some((name) => template.includes(`{${name}}`))) {
    console.warn(`i18n: ${key} (${lang}) has a plural form without the number itself`);
  }
  return template;
}

/**
 * The string of the current language: a missing key is fetched from the `FALLBACK_LANGUAGE`
 * dictionary, and an entry with number forms takes the one a number in params falls into.
 */
export function t(key, params) {
  const lang = currentLanguage();
  const dictionary = DICTIONARIES[lang] ?? DICTIONARIES[FALLBACK_LANGUAGE];
  const entry = dictionary[key] ?? DICTIONARIES[FALLBACK_LANGUAGE][key] ?? key;
  const template = typeof entry === 'string' ? entry : pluralForm(entry, lang, params, key);
  return interpolate(template, params);
}

/** The dictionary keys of a language: a test compares them against the base dictionary so a new language is not half-done. */
export function dictionaryKeys(lang = LANGUAGES[0]) {
  return Object.keys(DICTIONARIES[lang] ?? {});
}

/**
 * A dictionary entry as it is: a string or an object of number forms. A test compares categories
 * and placeholders between languages through it.
 */
export function dictionaryEntry(key, lang = LANGUAGES[0]) {
  const entry = (DICTIONARIES[lang] ?? {})[key];
  if (entry === undefined) return undefined;
  return typeof entry === 'string' ? entry : { ...entry };
}

/** Measurement units (min/h/d, "ago") for the current language — the `util.js` helpers take them from here. */
export function unitLabels(lang = currentLanguage()) {
  const dictionary = DICTIONARIES[lang] ?? DICTIONARIES[FALLBACK_LANGUAGE];
  return {
    empty: dictionary['units.empty'],
    minutes: dictionary['units.minutes'],
    hours: dictionary['units.hours'],
    days: dictionary['units.days'],
    justNow: dictionary['units.justNow'],
    minutesAgo: dictionary['units.minutesAgo'],
    hoursAgo: dictionary['units.hoursAgo'],
    daysAgo: dictionary['units.daysAgo'],
    inMinutes: dictionary['units.inMinutes'],
    inHours: dictionary['units.inHours'],
    inDays: dictionary['units.inDays'],
    anyNow: dictionary['units.anyNow'],
    locale: LOCALES[lang] ?? LOCALES[FALLBACK_LANGUAGE],
  };
}

/**
 * Apply the dictionary to a page: an element's text or attributes come from the i18n attributes
 * (`data-i18n`, `data-i18n-title`, `data-i18n-aria`, `data-i18n-placeholder`), and `<html lang>` is
 * brought to the chosen language. Called after the language is loaded and on every change of it.
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
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  }
}

/**
 * Load the language from the setting into the cache and return it — called at the start of every
 * page. `store` chooses the language itself; here we only move it into the cache for a synchronous
 * `t()`.
 */
export function adoptLanguage(language) {
  const normalized = normalizeLanguage(language) ?? FALLBACK_LANGUAGE;
  setLanguageCache(normalized);
  return normalized;
}
