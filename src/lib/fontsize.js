// Font size of the reader's columns: the switcher in the head of a column scales the text of
// that column only, never the neighbouring ones.
//
// `settings.font_scales` in chrome.storage.local is the source of truth, so the sizes survive a
// reload and every reader tab starts with the same ones. localStorage caches the last map purely
// so a column is painted at its size before the async read resolves — the same split the theme
// toggle uses (see `theme-boot.js` and `lib/theme.js`).

import { t } from './i18n.js';
import {
  FONT_PANELS,
  FONT_SCALES,
  FONT_SCALES_KEY,
  getFontScales,
  normalizeFontScales,
  setFontScale,
} from './storage.js';

/** localStorage key holding the cached map: written here, read here and by `font-boot.js`. */
export const FONT_CACHE_KEY = 'rss-reader:font-scales';

/** A page marks the holder of a column's switcher with `data-font-scale="<column>"`. */
const PANEL_ATTR = 'data-font-scale';
const STEP_ATTR = 'data-font-scale-step';

/** One label per step of `FONT_SCALES`, in the same order — the tooltip and the accessible name. */
const STEP_LABELS = [
  'reader.fontScale.small',
  'reader.fontScale.normal',
  'reader.fontScale.large',
  'reader.fontScale.xlarge',
];

/** The name of the whole switcher: the tooltip of the group and its aria-label. */
const GROUP_LABEL = 'reader.fontScale.aria';

function panelHolder(panel) {
  return document.querySelector(`[${PANEL_ATTR}="${panel}"]`);
}

/**
 * The column the switcher belongs to. The multiplier has to be set on the whole column, not on the
 * switcher: a custom property only travels down the tree, while the text it scales sits next to
 * the panel head, not under it.
 */
function panelSurface(holder) {
  return holder.closest('.panel') ?? holder;
}

function readCache() {
  try {
    return normalizeFontScales(JSON.parse(localStorage.getItem(FONT_CACHE_KEY) ?? ''));
  } catch {
    return null; // Nothing usable stored — the stored sizes decide on their own.
  }
}

function writeCache(scales) {
  try {
    localStorage.setItem(FONT_CACHE_KEY, JSON.stringify(scales));
  } catch {
    // Ignore cache failures: chrome.storage.local still carries the sizes.
  }
}

/** Paint one column: the multiplier its text is scaled by, and the step that shows as pressed. */
function paint(panel, scale) {
  const holder = panelHolder(panel);
  if (!holder) return;

  panelSurface(holder).style.setProperty('--font-scale', String(scale));
  for (const button of holder.querySelectorAll(`[${STEP_ATTR}]`)) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.fontScaleStep) === scale));
  }
}

function paintAll(scales) {
  for (const panel of FONT_PANELS) paint(panel, scales[panel]);
}

/** Apply the cached sizes synchronously — before any `chrome.storage` read resolves. */
export function applyCachedFontScales() {
  const scales = readCache();
  if (scales) paintAll(scales);
}

/**
 * Build the switcher inside every `data-font-scale` holder the page has: one button per step of
 * `FONT_SCALES`, drawn as the letter A at the size that button stands for.
 *
 * Call it before the language is known — every label is written both as a value and as a
 * `data-i18n-*` attribute, so a later `applyI18n()` re-pastes it in the new language.
 */
export function mountFontScales() {
  for (const holder of document.querySelectorAll(`[${PANEL_ATTR}]`)) {
    const panel = holder.dataset.fontScale;
    if (!FONT_PANELS.includes(panel)) continue;

    holder.dataset.i18nTitle = GROUP_LABEL;
    holder.dataset.i18nAria = GROUP_LABEL;
    holder.title = t(GROUP_LABEL);
    holder.setAttribute('aria-label', t(GROUP_LABEL));
    holder.setAttribute('role', 'group');

    FONT_SCALES.forEach((scale, index) => {
      const label = STEP_LABELS[index] ?? STEP_LABELS[STEP_LABELS.length - 1];

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'font-step';
      // The glyph is the whole control: its size in CSS is the size the button stands for.
      button.textContent = 'A';
      button.dataset.fontScaleStep = String(scale);
      button.dataset.i18nTitle = label;
      button.dataset.i18nAria = label;
      button.title = t(label);
      button.setAttribute('aria-label', t(label));
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => void choose(panel, scale));

      holder.append(button);
    });
  }

  applyCachedFontScales();
}

/** One step of one column: it writes through to storage, which hands the map back to every tab. */
async function choose(panel, scale) {
  const scales = await setFontScale(panel, scale);
  if (scales) applyStoredFontScales(scales);
}

/**
 * Take over the stored sizes: paint, cache, and let a later language change find the labels
 * through `applyI18n()`.
 */
export function applyStoredFontScales(scales) {
  const normalized = normalizeFontScales(scales);
  writeCache(normalized);
  paintAll(normalized);
  return normalized;
}

/** Load the stored sizes — the sizes the reader opens with. */
export async function loadFontScales() {
  return applyStoredFontScales(await getFontScales());
}

/** React to `chrome.storage.onChanged`: another tab, or another column of this page, changed a size. */
export function wireFontScaleChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const scales = changes.settings?.newValue?.[FONT_SCALES_KEY];
    if (scales) applyStoredFontScales(scales);
  });
}
