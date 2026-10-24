// Runs in the offscreen document: the only extension context with a DOM, so it is where the feed
// answers are read — XML parsed with DOMParser, JSON Feed read as an object — and where audio is
// allowed to play.

import { MSG_FETCH_FEED, MSG_PLAY_SOUND } from './lib/messages.js';
import { fetchFeed } from './lib/rss.js';

/** Путь от корня расширения к файлу-сигналу (src/media/ceres.mp3). */
const DEFAULT_SOUND_FILE = 'src/media/ceres.mp3';

let alertAudio = null;

/** Проигрывание, которое ещё не дошло до звука: его `play()` висит, пока файл грузится. */
let playback = null;

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
  /* Смена файла на экране настроек: проигрывание старого игрока больше не описывает звук, который
   * читалка хочет услышать, поэтому новый сигнал не должен к нему присоединяться. */
  playback = null;
  alertAudio = player;
  return alertAudio;
}

/**
 * Отказ, который Chrome даёт `pause()`, не давшему начатому `play()` дойти до звука: «The play()
 * request was interrupted by a call to pause()». Такой обрыв — не сбой, а следующий сигнал,
 * пришедший, пока предыдущий ещё грузился (ленты перечитываются одна за другой).
 */
function wasInterrupted(error) {
  return error?.name === 'NotSupportedError' && /interrupted/i.test(String(error?.message ?? ''));
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

  /* Сигнал, который ещё не заиграл, нечего обрывать: его `play()` и так начнёт файл с нуля, а
   * `pause()` поверх него лишь отвергает то проигрывание — Chrome поднимает отказ «The play()
   * request was interrupted by a call to pause()» в консоль, и он попадает в ошибки расширения.
   * Поэтому новый сигнал догоняет такое проигрывание, а не обрывает его. */
  const pending = playback;

  if (pending === null) {
    // Прежде играющий звук уже дошёл до проигрывания: его прерывают и начинают файл сначала.
    player.pause();
    player.currentTime = 0;
  }

  // Chrome может отказать в воспроизведении без жеста пользователя — это не должно ронять фон.
  const started = pending ?? player.play();
  playback = started;

  function forget() {
    if (playback === started) playback = null;
  }

  /* Отклонение принимается здесь же: обрыв `play()` — рабочее событие, а не сбой, и он не должен
   * остаться необработанным. Заодно по нему видно, что проигрывание больше не идёт. */
  const settled = started.then(forget, forget);

  try {
    await settled;
  } catch (error) {
    /* Отказ мог принести и следующий сигнал, оборвав этот: звук тогда сыграл тот сигнал, и
     * сообщать об отказе не нужно. Настоящий отказ (файл, политика автовоспроизведения)
     * остаётся ошибкой. */
    if (!wasInterrupted(error)) throw error;
  }
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
