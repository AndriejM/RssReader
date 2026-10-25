// Paint the arrangement of the panels the reader was last closed with, before the page module
// resolves. The choice itself lives in `settings.layout` in chrome.storage.local; localStorage only
// caches the last one so the reader never draws one shape and then throws a column away. Keeping this
// code in an external file is required in Chrome because extension page CSP blocks inline <script>
// bodies.
//
// The value is checked here exactly as `lib/storage.js` checks the stored one: a cache written by an
// older build cannot give the reader an arrangement it does not have.
const LAYOUT_CACHE_KEY = 'rss-reader:layout';
const LAYOUTS = ['three', 'list', 'split'];
const DEFAULT_LAYOUT = 'three';

try {
  const cached = localStorage.getItem(LAYOUT_CACHE_KEY);
  const panels = document.querySelector('.panels');

  panels?.setAttribute('data-layout', LAYOUTS.includes(cached) ? cached : DEFAULT_LAYOUT);
} catch {
  // Nothing cached (or localStorage is blocked): `.panels` keeps the arrangement the markup declares,
  // and `lib/layout.js` loads the stored one.
}
