// Offscreen-документ: единственное место расширения, где есть настоящий DOM.
// Service worker разрешает fetch, но в нём нет ни DOMParser, ни Web Audio, поэтому разбор XML
// лент и короткий сигнал играются здесь (разрешение manifest "offscreen").

const OFFSCREEN_URL = 'src/offscreen.html';
const REASONS = ['AUDIO_PLAYBACK', 'DOM_PARSER'];
const JUSTIFICATION =
  'Разбирает XML-ответы лент и проигрывает короткий сигнал: у service worker нет доступа к DOM.';

let creationPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        console.warn('Не удалось создать offscreen документ:', error?.message ?? error);
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
    throw new Error('не удалось открыть служебную страницу расширения');
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

  throw new Error(`служебная страница расширения не ответила${lastError ? `: ${lastError}` : ''}`);
}

export async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) return;
  await chrome.offscreen.closeDocument();
}
