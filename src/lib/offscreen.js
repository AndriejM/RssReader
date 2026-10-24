// The offscreen document: the extension's only place with a real DOM.
// The service worker allows fetch but has neither DOMParser nor Web Audio, so parsing feed XML
// and playing the short signal happen here (manifest permission "offscreen").

const OFFSCREEN_URL = 'src/offscreen.html';
const REASONS = ['AUDIO_PLAYBACK', 'DOM_PARSER'];
// Chrome shows this justification in its own extensions UI, so it does not follow the interface
// language of the reader.
const JUSTIFICATION =
  'Parses feed responses (XML with DOMParser, JSON Feed as JSON) and plays a short signal: the service worker has no DOM access.';

let creationPromise = null;

/* The document is needed only for the duration of a request: parse a feed response or play a
 * signal. Chrome keeps an offscreen document open until it is explicitly closed, so without this
 * step it lives until the browser session ends — a live document with a DOM and network access that
 * nobody is using. So after the last request it closes itself.
 *
 * The period is chosen so it can actually fire: Chrome itself tears the background down after 30 s
 * of quiet, and a longer timer might simply not live to run. It is longer than any signal in
 * `src/media` (files of a few seconds) — so the document does not vanish under playing sound — and
 * short enough that a batch re-read of feeds does not recreate the window on every feed. */
export const IDLE_CLOSE_MS = 20_000;

let activeRequests = 0;
let closeTimer = null;
let closingPromise = null;

/**
 * An error with an i18n code: `code` points at the `errors.<code>` key, `params` fills its
 * placeholders, and `message` stays technical — only the console shows it.
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
 * Whether an offscreen document already exists.
 * `chrome.offscreen.hasDocument` exists only from Chrome 150, `chrome.runtime.getContexts` from
 * Chrome 116, and this lower edge is written in the manifest as `minimum_chrome_version`: below 116
 * there is nothing to ask with, and without an answer `ensureOffscreenDocument()` would create a
 * document on top of an already open one and feeds would fail with `errors.offscreenUnavailable`.
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

/** Creates the offscreen document if it is not there yet. The same window serves both sound and XML parsing. */
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

/** Postpone closing to the end of the idle period: requests coming one after another keep the document alive. */
function armIdleClose() {
  cancelIdleClose();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    void closeWhenIdle();
  }, IDLE_CLOSE_MS);
}

async function closeWhenIdle() {
  /* A request may have started while the timer was running: then the document is needed again. */
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
 * Send a message to the offscreen document and wait for its answer.
 * A just-created document may not have managed to register its listener yet, so there is one retry.
 * @returns {Promise<unknown>} the offscreen document's answer
 * @throws {Error} if there is no document or it did not answer
 */
export async function requestOffscreen(message, { attempts = 2, retryDelay = 150 } = {}) {
  /* The idle close has already begun — so a document must not be created on top of the closing one:
   * wait for the close to finish first. */
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

      // The key exists even when the answer is undefined: the document answered, just without useful data.
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
    /* The request is over — by answer or by failure. The idle countdown starts anew: a document
     * that did not answer closes together with the rest and is created fresh on the next read. */
    activeRequests -= 1;
    armIdleClose();
  }
}

/**
 * Close the document if it is open. The idle timer calls this too: the document lives exactly as
 * long as it is being used.
 */
export async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) return;
  await chrome.offscreen.closeDocument();
}
