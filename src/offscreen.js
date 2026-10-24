// Runs in the offscreen document: the only extension context with a DOM, so it is where the feed
// answers are read — XML parsed with DOMParser, JSON Feed read as an object — and where audio is
// allowed to play.

import { MSG_FETCH_FEED, MSG_PLAY_SOUND } from './lib/messages.js';
import { fetchFeed } from './lib/rss.js';

/** Path from the extension root to the signal file (src/media/ceres.mp3). */
const DEFAULT_SOUND_FILE = 'src/media/ceres.mp3';

let alertAudio = null;

/** A playback that has not reached sound yet: its `play()` hangs while the file loads. */
let playback = null;

/**
 * One reused player: the file is loaded once in the offscreen document's memory and restarted on
 * every signal. So no decoding is wasted and no layers of sound pile up.
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
  /* Changing the file on the settings screen: the old player's playback no longer describes the
   * sound the reader wants to hear, so a new signal must not join it. */
  playback = null;
  alertAudio = player;
  return alertAudio;
}

/**
 * The failure Chrome gives when a started-but-not-yet-sounding `play()` is answered by `pause()`:
 * "The play() request was interrupted by a call to pause()". Such a break is not a fault but the
 * next signal arriving while the previous one was still loading (feeds are re-read one after
 * another).
 */
function wasInterrupted(error) {
  return error?.name === 'NotSupportedError' && /interrupted/i.test(String(error?.message ?? ''));
}

/**
 * The "automatic load brought headlines" signal — we play a file, not a synthesized tone.
 * `volume` is the volume fraction (0–1) chosen on the global settings screen; it is applied to the
 * reused player on every signal so a new volume takes effect at once.
 * @returns {Promise<void>}
 */
async function playSoundFile(src = DEFAULT_SOUND_FILE, volume = 1) {
  const player = getAlertAudio(src);

  const fraction = Number(volume);
  player.volume = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;

  /* There is no point breaking a signal that has not started playing yet: its `play()` will begin
   * the file from zero anyway, while a `pause()` on top of it only rejects that playback — Chrome
   * raises the failure "The play() request was interrupted by a call to pause()" in the console,
   * and it lands in the extension's errors. So a new signal catches up with such a playback
   * instead of breaking it. */
  const pending = playback;

  if (pending === null) {
    // A sound that was already playing has reached playback: it is interrupted and the file starts over.
    player.pause();
    player.currentTime = 0;
  }

  // Chrome may refuse playback without a user gesture — that must not bring the background down.
  const started = pending ?? player.play();
  playback = started;

  function forget() {
    if (playback === started) playback = null;
  }

  /* The rejection is handled right here: a broken `play()` is a working event, not a fault, and it
   * must not stay unhandled. It also shows that the playback is no longer running. */
  const settled = started.then(forget, forget);

  try {
    await settled;
  } catch (error) {
    /* The failure may have come from the next signal breaking this one: the sound then played that
     * signal, and no failure needs reporting. A real failure (the file, the autoplay policy)
     * stays an error. */
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
