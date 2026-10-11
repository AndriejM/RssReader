// The alert sound played through the offscreen document.
// A service worker has no DOM, so Chrome's offscreen API is the supported place to make sound.
// The sound itself is a bundled file from src/media, chosen on the global settings screen;
// «Без звука» there silences the alert.

import { MSG_PLAY_SOUND } from './messages.js';
import { requestOffscreen } from './offscreen.js';
import { getSoundChoice, SOUND_NONE } from './storage.js';

/** Файл-сигнал: путь от корня расширения, его отдаёт chrome.runtime.getURL. "Без звука" returns SOUND_NONE. */

/**
 * Requirement: after an automatic headlines fetch that brought in more than 0 items, play
 * media/ceres.mp3 (offscreen-документ проигрывает его через <audio>).
 */
export async function playSound() {
  const src = await getSoundChoice();
  if (src === SOUND_NONE) return false;

  try {
    await requestOffscreen({ type: MSG_PLAY_SOUND, src });
    return true;
  } catch (error) {
    console.warn('Звук не сыгран:', error?.message ?? error);
    return false;
  }
}
