// Runs in the offscreen document: the only extension context with a DOM, so it is where the
// feed XML is parsed and where audio is allowed to play.

import { MSG_FETCH_FEED, MSG_PLAY_SOUND } from './lib/messages.js';
import { fetchFeed, FeedError } from './lib/rss.js';

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
    console.warn('Не удалось загрузить файл звука:', src);
    if (alertAudio === player) alertAudio = null;
  });
  alertAudio = player;
  return alertAudio;
}

/**
 * Сигнал «автоматическая загрузка принесла заголовки» — играем файл, а не синтезированный тон.
 * @returns {Promise<void>}
 */
async function playSoundFile(src = DEFAULT_SOUND_FILE) {
  const player = getAlertAudio(src);

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
        await playSoundFile(message.src ?? DEFAULT_SOUND_FILE);
        sendResponse({ ok: true });
      } catch (error) {
        console.warn('Не удалось воспроизвести звук:', error?.message ?? error);
        sendResponse({ ok: false });
      }
    })();
    return true; // keep the message channel open for the async reply
  }

  if (message?.type === MSG_FETCH_FEED) {
    (async () => {
      try {
        const result = await fetchFeed(message.url);
        sendResponse({ ok: true, result });
      } catch (error) {
        const reason = error instanceof FeedError ? error.message : error?.message ?? error;
        sendResponse({ ok: false, error: reason });
      }
    })();
    return true; // keep the message channel open for the async reply
  }

  return false;
});
