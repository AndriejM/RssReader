// Message names shared by the service worker and the extension pages.
// Kept separate from background.js so pages can import it without registering listeners.

export const MSG_REFRESH_FEED = 'rss-reader:refresh-feed';
export const MSG_FEEDS_CHANGED = 'rss-reader:feeds-changed';
export const MSG_COUNT = 'rss-reader:count';
export const MSG_PLAY_SOUND = 'rss-reader:play-sound';
export const MSG_FETCH_FEED = 'rss-reader:fetch-feed';
