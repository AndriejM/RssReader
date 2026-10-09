// Runs in the offscreen document: the only extension context with a DOM, so it is where the
// feed XML is parsed and where audio is allowed to play.

import { MSG_FETCH_FEED, MSG_PLAY_SOUND } from './lib/messages.js';
import { fetchFeed, FeedError } from './lib/rss.js';

let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  if (audioContext.state === 'suspended') {
    // The offscreen document is never focused, so resume explicitly before scheduling.
    void audioContext.resume();
  }
  return audioContext;
}

/** Two short tones with a fast decay — close enough to a notification chime. */
function playChime() {
  const context = getAudioContext();
  if (!context) return;

  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, context.currentTime);
  master.connect(context.destination);

  const notes = [
    { frequency: 880, start: 0, duration: 0.16 },
    { frequency: 1318.5, start: 0.16, duration: 0.22 },
  ];

  for (const note of notes) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, context.currentTime);

    const begin = context.currentTime + note.start;
    const end = begin + note.duration;

    envelope.gain.setValueAtTime(0.0001, begin);
    envelope.gain.exponentialRampToValueAtTime(0.22, begin + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(envelope);
    envelope.connect(master);

    oscillator.start(begin);
    oscillator.stop(end + 0.02);
  }

  master.gain.setValueAtTime(0.25, context.currentTime);
  master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG_PLAY_SOUND) {
    try {
      playChime();
      sendResponse({ ok: true });
    } catch (error) {
      console.warn('Не удалось воспроизвести звук:', error?.message ?? error);
      sendResponse({ ok: false });
    }
    return true;
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
