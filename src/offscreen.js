// Runs in the offscreen document: the only extension context with a DOM, so it is where the feed
// answers are read — XML parsed with DOMParser, JSON Feed read as an object — and where audio is
// allowed to play.

import { MSG_FETCH_FEED, MSG_PLAY_SOUND } from './lib/messages.js';
import { fetchFeed } from './lib/rss.js';

/** Путь от корня расширения к файлу-сигналу (src/media/ceres.mp3). */
const DEFAULT_SOUND_FILE = 'src/media/ceres.mp3';

let alertAudio = null;

/**
 * Один переиспользуемый плеер: файл загружается в памяти offscreen-документа один раз и при
 * каждом сигнале начинается сначала. Значит, не тратится декодирование и не копятся слои звука.
 */
function getAlertAudio(src) {
  if (alertAudio && alertAudio.dataset.src === src) return alertAudio;

  const player = new Audio(chrome.runtime.getURL(src));
  player.preload = 'auto';
  player.dataset.src = src;
  player.addEventListener('error', () => {
    console.warn('could not load the sound file:', src);
    if (alertAudio === player) alertAudio = null;
  });
  alertAudio = player;
  return alertAudio;
}

/**
 * Сигнал «автоматическая загрузка принесла заголовки» — играем файл, а не синтезированный тон.
 * `volume` — доля громкости (0–1), выбранная на экране глобальных настроек; она применяется к
 * переиспользуемому плееру при каждом сигнале, чтобы новая громкость действовала сразу.
 * @returns {Promise<void>}
 */
async function playSoundFile(src = DEFAULT_SOUND_FILE, volume = 1) {
  const player = getAlertAudio(src);

  const fraction = Number(volume);
  player.volume = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;

  // Повторный сигнал обрывает предыдущее проигрывание и стартует с начала файла.
  player.pause();
  player.currentTime = 0;

  // Chrome может отказать в воспроизведении без жеста пользователя — это не должно ронять фон.
  await player.play();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG_PLAY_SOUND) {
    (async () => {
      try {
        await playSoundFile(message.src ?? DEFAULT_SOUND_FILE, message.volume ?? 1);
        sendResponse({ ok: true });
      } catch (error) {
        console.warn('could not play the sound:', error?.message ?? error);
        sendResponse({ ok: false });
      }
    })();
    return true; // keep the message channel open for the async reply
  }

  if (message?.type === MSG_FETCH_FEED) {
    (async () => {
      try {
        /* The worker hands over the validators it kept for this address: the request goes out as a
         * conditional one and may come back an empty 304. */
        const result = await fetchFeed(message.url, {
          etag: message.etag,
          lastModified: message.lastModified,
        });
        sendResponse({ ok: true, result });
      } catch (error) {
        // A feed failure carries an i18n `code`/`params`: hand them to the caller so the page can
        // render the failure in its own language; otherwise fall back to the raw message.
        const payload = error?.code
          ? { code: error.code, params: error.params, message: error.message, status: error.status }
          : error?.message ?? String(error);
        sendResponse({ ok: false, error: payload });
      }
    })();
    return true; // keep the message channel open for the async reply
  }

  return false;
});
