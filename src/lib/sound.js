// The alert sound played through the offscreen document.
// A service worker has no DOM, so Chrome's offscreen API is the supported place to make sound.
// The sound itself is a bundled file from src/media, not a synthesised tone.

import { MSG_PLAY_SOUND } from './messages.js';
import { requestOffscreen } from './offscreen.js';
import { getSettings } from './storage.js';

/** Файл-сигнал: путь от корня расширения, его отдаёт chrome.runtime.getURL. */
export const SOUND_FILE = 'src/media/ceres.mp3';

async function soundEnabled() {
  const settings = await getSettings();
  return settings.sound !== false;
}

/**
 * Requirement: after an automatic headlines fetch that brought in more than 0 items, play
 * media/ceres.mp3 (offscreen-документ проигрывает его через <audio>).
 */
export async function playSound() {
  if (!(await soundEnabled())) return false;

  try {
    await requestOffscreen({ type: MSG_PLAY_SOUND, src: SOUND_FILE });
    return true;
  } catch (error) {
    console.warn('Звук не сыгран:', error?.message ?? error);
    return false;
  }
}
