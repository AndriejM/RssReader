// Paint every reader column at its remembered width before the page module resolves.
// The widths themselves live in `settings.column_widths` in chrome.storage.local; localStorage only
// caches the last map so no column has to wait for the async read. Keeping this code in an external
// file is required in Chrome because extension page CSP blocks inline <script> bodies.
//
// The numbers are clamped here exactly as `lib/storage.js` clamps the stored map — a cache written by
// an older build cannot give a column a width it is not allowed to have.
const WIDTH_CACHE_KEY = 'rss-reader:column-widths';
const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 900;
const DEFAULT_PANEL_WIDTHS = { feeds: 240, headlines: 340 };

try {
  const cached = JSON.parse(localStorage.getItem(WIDTH_CACHE_KEY) ?? '');
  const panels = document.querySelector('.panels');

  for (const [panel, fallback] of Object.entries(DEFAULT_PANEL_WIDTHS)) {
    const stored = Math.round(Number(cached?.[panel]));
    const width = Number.isFinite(stored)
      ? Math.min(Math.max(stored, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH)
      : fallback;

    panels?.style.setProperty(`--col-${panel}`, `${width}px`);
  }
} catch {
  // Nothing cached (or localStorage is blocked): every column keeps the width the stylesheet gives
  // it until `lib/columns.js` loads the stored one.
}
