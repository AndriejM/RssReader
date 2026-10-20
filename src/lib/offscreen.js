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

/**
 * Отправить сообщение offscreen-документу и дождаться его ответа.
 * Свежесозданный документ мог ещё не успеть зарегистрировать слушателя, поэтому одна повторная
 * попытка.
 * @returns {Promise<unknown>} ответ offscreen-документа
 * @throws {Error} если документа нет или он не ответил
 */
export async function requestOffscreen(message, { attempts = 2, retryDelay = 150 } = {}) {
  if (!(await ensureOffscreenDocument())) {
    // `code` points at an `errors.<code>` key so the page that shows the failure renders it in the
    // reader's language, exactly like `rss.FeedError` does.
    throw codedError('offscreenUnavailable', 'offscreen document is unavailable');
  }

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
}

export async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) return;
  await chrome.offscreen.closeDocument();
}
