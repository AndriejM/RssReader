// Paint every reader column at its remembered font size before the page module resolves.
// The sizes themselves live in `settings.font_scales` in chrome.storage.local; localStorage only
// caches the last map so no column has to wait for the async read. Keeping this code in an
// external file is required in Chrome because extension page CSP blocks inline <script> bodies.
const FONT_CACHE_KEY = 'rss-reader:font-scales';
const DEFAULT_FONT_SCALE = 1;

try {
  const cached = JSON.parse(localStorage.getItem(FONT_CACHE_KEY) ?? '');

  for (const [panel, scale] of Object.entries(cached)) {
    if (typeof scale !== 'number' || !Number.isFinite(scale)) continue;

    // The multiplier belongs to the column as a whole: the text it scales sits next to the panel
    // head, and a custom property only travels down the tree.
    const holder = document.querySelector(`[data-font-scale="${panel}"]`);
    const surface = holder ? holder.closest('.panel') ?? holder : null;
    surface?.style.setProperty('--font-scale', String(scale));
  }
} catch {
  // Nothing cached (or localStorage is blocked): every column keeps its default size until
  // `lib/fontsize.js` loads the stored one.
}
