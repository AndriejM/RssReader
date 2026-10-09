// A short alert tone played through the offscreen document.
// A service worker has no DOM, so Chrome's offscreen API is the supported place to make sound.
// The tone is synthesised there, so no audio file is bundled.

import { MSG_PLAY_SOUND } from './messages.js';
import { requestOffscreen } from './offscreen.js';
import { getSettings } from './storage.js';

async function soundEnabled() {
  const settings = await getSettings();
  return settings.sound !== false;
}

/**
 * Requirement: after an automatic headlines fetch that brought in more than 0 items,
 * emit a system sound.
 */
export async function playSound() {
  if (!(await soundEnabled())) return false;

  try {
    await requestOffscreen({ type: MSG_PLAY_SOUND });
    return true;
  } catch (error) {
    console.warn('Звук не сыгран:', error?.message ?? error);
    return false;
  }
}
