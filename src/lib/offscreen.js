// Offscreen-документ: единственное место расширения, где есть настоящий DOM.
// Service worker разрешает fetch, но в нём нет ни DOMParser, ни Web Audio, поэтому разбор XML
// лент и короткий сигнал играются здесь (разрешение manifest "offscreen").

const OFFSCREEN_URL = 'src/offscreen.html';
const REASONS = ['AUDIO_PLAYBACK', 'DOM_PARSER'];
// Chrome shows this justification in its own extensions UI, so it does not follow the interface
// language of the reader.
const JUSTIFICATION =
  'Parses feed responses (XML with DOMParser, JSON Feed as JSON) and plays a short signal: the service worker has no DOM access.';

let creationPromise = null;

/* Документ нужен только на время запроса: разобрать ответ ленты или сыграть сигнал. Chrome держит
 * offscreen-документ открытым, пока его явно не закроют, то есть без этого шага он живёт до конца
 * сессии браузера — живой документ с DOM и выходом в сеть, никем не востребованный. Поэтому после
 * последнего запроса он закрывается сам.
 *
 * Срок выбран так, чтобы успеть сработать: сам фон Chrome снимает за 30 с спокойствия, и таймер
 * дольше этого мог бы просто не дожить до своего запуска. Он длиннее любого сигнала из `src/media`
 * (файлы в несколько секунд) — чтобы документ не пропал под играющим звуком, — и достаточно
 * короткий, чтобы пакетная перечитка лент не создавала окно заново на каждой ленте. */
export const IDLE_CLOSE_MS = 20_000;

let activeRequests = 0;
let closeTimer = null;
let closingPromise = null;

/**
 * Ошибка с i18n-кодом: `code` указывает на ключ `errors.<code>`, `params` заполняет его
 * placeholders, а `message` остаётся техническим — его показывает только консоль.
 */
function codedError(code, message, params) {
  const error = new Error(message);
  error.code = code;
  error.params = params;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Есть ли уже offscreen-документ.
 * `chrome.offscreen.hasDocument` есть только с Chrome 150, `chrome.runtime.getContexts` — с Chrome 116,
 * и этот нижний край записан в манифесте как `minimum_chrome_version`: ниже 116 спросить нечем, а без
 * ответа `ensureOffscreenDocument()` создавал бы документ поверх уже открытого и ленты падали бы с
 * `errors.offscreenUnavailable`.
 */
export async function hasOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) {
    try {
      return await chrome.offscreen.hasDocument();
    } catch {
      // fall through to getContexts
    }
  }
  if (chrome.runtime?.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    return contexts.length > 0;
  }
  return false;
}

/** Создаёт offscreen-документ, если его ещё нет. Одно и то же окно служит и звуку, и разбору XML. */
export async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return true;

  if (!creationPromise) {
    creationPromise = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: REASONS,
        justification: JUSTIFICATION,
      })
      .catch((error) => {
        console.warn('could not create the offscreen document:', error?.message ?? error);
        return null;
      })
      .finally(() => {
        creationPromise = null;
      });
  }

  await creationPromise;
  return hasOffscreenDocument();
}

function cancelIdleClose() {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

/** Отложить закрытие на конец простоя: запросы, идущие один за другим, держат документ живым. */
function armIdleClose() {
  cancelIdleClose();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    void closeWhenIdle();
  }, IDLE_CLOSE_MS);
}

async function closeWhenIdle() {
  /* Запрос мог начаться, пока таймер шёл: тогда документ снова нужен. */
  if (activeRequests > 0) {
    armIdleClose();
    return;
  }

  closingPromise = closeOffscreenDocument()
    .catch((error) => {
      console.warn('could not close the offscreen document:', error?.message ?? error);
    })
    .finally(() => {
      closingPromise = null;
    });

  await closingPromise;
}

/**
 * Отправить сообщение offscreen-документу и дождаться его ответа.
 * Свежесозданный документ мог ещё не успеть зарегистрировать слушателя, поэтому одна повторная
 * попытка.
 * @returns {Promise<unknown>} ответ offscreen-документа
 * @throws {Error} если документа нет или он не ответил
 */
export async function requestOffscreen(message, { attempts = 2, retryDelay = 150 } = {}) {
  /* Закрытие по простою уже началось — значит, создавать документ поверх закрываемого нельзя:
   * сначала дождаться, пока оно закончится. */
  if (closingPromise) await closingPromise;

  if (!(await ensureOffscreenDocument())) {
    // `code` points at an `errors.<code>` key so the page that shows the failure renders it in the
    // reader's language, exactly like `rss.FeedError` does.
    throw codedError('offscreenUnavailable', 'offscreen document is unavailable');
  }

  activeRequests += 1;
  cancelIdleClose();

  try {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const sent = await new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (reply) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve({ reply });
        });
      });

      // Ключ есть даже когда ответ — undefined: документ ответил, просто без полезных данных.
      if (sent && 'reply' in sent) return sent.reply;

      lastError = sent?.error ?? null;
      if (attempt < attempts) await sleep(retryDelay);
    }

    throw codedError(
      'offscreenNoReply',
      `offscreen page did not answer${lastError ? `: ${lastError}` : ''}`,
      { cause: lastError ? `: ${lastError}` : '' },
    );
  } finally {
    /* Запрос закончен — ответом или отказом. Отсчёт простоя начинается заново: документ, который
     * не ответил, закрывается вместе с остальными и в следующее чтение создаётся заново. */
    activeRequests -= 1;
    armIdleClose();
  }
}

/**
 * Закрыть документ, если он открыт. Это же зовёт таймер простоя: документ живёт ровно столько,
 * сколько им пользуются.
 */
export async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) return;
  await chrome.offscreen.closeDocument();
}
