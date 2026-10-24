// The alert sound played through the offscreen document.
// A service worker has no DOM, so Chrome's offscreen API is the supported place to make sound.
// The sound itself is a bundled file from src/media, chosen on the global settings screen;
// the «Sound» checkbox there switches the alert on and off.

import { MSG_PLAY_SOUND } from './messages.js';
import { requestOffscreen } from './offscreen.js';
import { getSoundChoice, getSoundEnabled, getSoundVolume } from './storage.js';

/**
 * Requirement: after an automatic headlines fetch that brought in more than 0 items, play the
 * signal chosen on the settings screen (the offscreen document plays it through <audio>) —
 * but only while the «Sound» flag is on.
 */
export async function playSound() {
  const [enabled, src, volume] = await Promise.all([
    getSoundEnabled(),
    getSoundChoice(),
    getSoundVolume(),
  ]);
  if (!enabled) return false;

  try {
    await requestOffscreen({ type: MSG_PLAY_SOUND, src, volume: volume / 100 });
    return true;
  } catch (error) {
    console.warn('sound did not play:', error?.message ?? error);
    return false;
  }
}
