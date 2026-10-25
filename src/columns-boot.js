// Paint every reader window at its remembered size before the page module resolves.
// The sizes themselves live in `settings.column_widths` and `settings.row_heights` in
// chrome.storage.local; localStorage only caches the last maps so no window has to wait for the async
// read. Keeping this code in an external file is required in Chrome because extension page CSP blocks
// inline <script> bodies.
//
// The numbers are clamped here exactly as `lib/storage.js` clamps the stored maps — a cache written by
// an older build cannot give a window a size it is not allowed to have.
const COLUMN_CACHE_KEY = 'rss-reader:column-widths';
const ROW_CACHE_KEY = 'rss-reader:row-heights';
const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 900;
const DEFAULT_PANEL_WIDTHS = { feeds: 240, headlines: 340 };
const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT = 900;
const DEFAULT_ROW_HEIGHTS = { headlines: 340 };

/*
 * The two axes a window is sized along: the width of a column, and the height of a window in a column
 * that an arrangement cuts across. Each axis is cached under its own key, painted into its own custom
 * property, and clamped between its own bounds — the same pair of maps `lib/columns.js` reads and
 * writes.
 */
const AXES = [
  {
    cacheKey: COLUMN_CACHE_KEY,
    variable: (panel) => `--col-${panel}`,
    min: MIN_PANEL_WIDTH,
    max: MAX_PANEL_WIDTH,
    defaults: DEFAULT_PANEL_WIDTHS,
  },
  {
    cacheKey: ROW_CACHE_KEY,
    variable: (panel) => `--row-${panel}`,
    min: MIN_PANEL_HEIGHT,
    max: MAX_PANEL_HEIGHT,
    defaults: DEFAULT_ROW_HEIGHTS,
  },
];

try {
  const panels = document.querySelector('.panels');

  for (const axis of AXES) {
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(axis.cacheKey) ?? '');
    } catch {
      // Nothing usable cached — the sizes the stylesheet gives the windows stand until storage answers.
    }

    for (const [panel, fallback] of Object.entries(axis.defaults)) {
      const stored = Math.round(Number(cached?.[panel]));
      const size = Number.isFinite(stored)
        ? Math.min(Math.max(stored, axis.min), axis.max)
        : fallback;

      panels?.style.setProperty(axis.variable(panel), `${size}px`);
    }
  }
} catch {
  // Nothing cached (or localStorage is blocked): every window keeps the size the stylesheet gives it
  // until `lib/columns.js` loads the stored one.
}
