// The arrangement of the reader's panels: which columns the reader shows and in what shape. The
// switcher in the head of the window offers one button per arrangement of `LAYOUTS`, and the shape in
// use is marked — like the size switcher of a column (`lib/fontsize.js`), the pressed step is the
// truth the page is painted at.
//
// `settings.layout` in chrome.storage.local is the source of truth, so every reader tab takes the
// same shape; localStorage caches the last choice so `layout-boot.js` can set the shape of the panels
// before the page module resolves — otherwise the reader would draw three columns, then throw the
// feeds column away a moment later.
//
// The shape itself is painted as `data-layout` on `.panels`: `reader.css` holds one grid per
// arrangement, and everything that depends on the shape (the handles of `lib/columns.js`, the
// selection of `index.js`) is told about a change by the `LAYOUT_EVENT` this module dispatches.

import { t } from './i18n.js';
import {
  LAYOUT_COLUMNS,
  LAYOUT_KEY,
  LAYOUT_PANELS,
  LAYOUTS,
  getLayout,
  normalizeLayout,
  setLayout,
} from './storage.js';

/** localStorage key holding the cached choice: written here, read here and by `layout-boot.js`. */
export const LAYOUT_CACHE_KEY = 'rss-reader:layout';

/**
 * The event the document gets when the painted arrangement changes. The panels of an arrangement are
 * laid out by the grid, so its borders move with it — and a column that disappears takes its
 * selection with it. Both are answered here rather than by the switcher, so a change coming from
 * another tab is answered the same way as a click.
 */
export const LAYOUT_EVENT = 'rss-reader:layout-change';

/** A page marks the holder of the switcher with `data-layout-switch`. */
const HOLDER_ATTR = 'data-layout-switch';
const STEP_ATTR = 'data-layout-step';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One caption per arrangement — the tooltip and the accessible name of its button. */
const STEP_LABELS = {
  three: 'reader.layout.three',
  list: 'reader.layout.list',
  split: 'reader.layout.split',
};

/** The name of the whole switcher: the tooltip of the group and its aria-label. */
const GROUP_LABEL = 'reader.layout.aria';

/**
 * The glyph of an arrangement is its shape: the outline of its columns. `icon-layout-<arrangement>`
 * of the page's sprite, so a new arrangement only has to add a `<symbol>`.
 */
function stepIcon(layout) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#icon-layout-${layout}`);
  svg.append(use);
  return svg;
}

function panelsSurface() {
  return document.querySelector('.panels');
}

function readCache() {
  // The choice is one word, so the cache holds it as it stands — no JSON to break.
  const cached = localStorage.getItem(LAYOUT_CACHE_KEY);
  return LAYOUTS.includes(cached) ? cached : null;
}

function writeCache(layout) {
  try {
    localStorage.setItem(LAYOUT_CACHE_KEY, layout);
  } catch {
    // Ignore cache failures: chrome.storage.local still carries the choice.
  }
}

/** The arrangement the page is painted at. */
export function currentLayout() {
  return normalizeLayout(panelsSurface()?.dataset.layout);
}

/** The panels of an arrangement, left to right — the same list the grid of `reader.css` lays out. */
export function layoutPanels(layout = currentLayout()) {
  return LAYOUT_PANELS[normalizeLayout(layout)];
}

/**
 * The same panels column by column: an entry per column, and a column that holds two windows one above
 * the other names both. `lib/columns.js` reads the borders of the arrangement from this list rather
 * than being told them again for every arrangement.
 */
export function layoutColumns(layout = currentLayout()) {
  return LAYOUT_COLUMNS[normalizeLayout(layout)];
}

/** Does the arrangement show the feeds column, and with it the choice of a single feed? */
export function showsFeedsPanel(layout = currentLayout()) {
  return layoutPanels(layout).includes('feeds');
}

function paintSteps(layout) {
  for (const button of document.querySelectorAll(`[${STEP_ATTR}]`)) {
    button.setAttribute('aria-pressed', String(button.dataset.layoutStep === layout));
  }
}

/** Paint the arrangement: the grid picks it up from `data-layout`, the switcher from `aria-pressed`. */
function paint(layout) {
  const panels = panelsSurface();
  if (!panels) return;

  const next = normalizeLayout(layout);
  const was = panels.dataset.layout;
  panels.dataset.layout = next;
  paintSteps(next);

  if (was !== next) document.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: { layout: next } }));
}

/** Apply the cached arrangement synchronously — before any `chrome.storage` read resolves. */
export function applyCachedLayout() {
  const layout = readCache();
  if (layout) paint(layout);
}

/**
 * Build the switcher inside every `data-layout-switch` holder the page has: one button per arrangement
 * of `LAYOUTS`, drawn as the outline of that arrangement's columns.
 *
 * Call it before the language is known — every label is written both as a value and as a
 * `data-i18n-*` attribute, so a later `applyI18n()` re-pastes it in the new language.
 */
export function mountLayoutSwitcher() {
  for (const holder of document.querySelectorAll(`[${HOLDER_ATTR}]`)) {
    holder.dataset.i18nTitle = GROUP_LABEL;
    holder.dataset.i18nAria = GROUP_LABEL;
    holder.title = t(GROUP_LABEL);
    holder.setAttribute('aria-label', t(GROUP_LABEL));
    holder.setAttribute('role', 'group');

    for (const layout of LAYOUTS) {
      const label = STEP_LABELS[layout] ?? GROUP_LABEL;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'layout-step';
      button.append(stepIcon(layout));
      button.dataset.layoutStep = layout;
      button.dataset.i18nTitle = label;
      button.dataset.i18nAria = label;
      button.title = t(label);
      button.setAttribute('aria-label', t(label));
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => void choose(layout));

      holder.append(button);
    }
  }

  applyCachedLayout();
}

/** One button: it writes through to storage, which hands the arrangement back to every tab. */
async function choose(layout) {
  const stored = await setLayout(layout);
  applyStoredLayout(stored);
}

/**
 * Take over the stored arrangement: cache it, paint it, and let a later language change find the
 * labels through `applyI18n()`.
 */
export function applyStoredLayout(layout) {
  const normalized = normalizeLayout(layout);
  writeCache(normalized);
  paint(normalized);
  return normalized;
}

/** Load the stored arrangement — the shape the reader opens with. */
export async function loadLayout() {
  return applyStoredLayout(await getLayout());
}

/** React to `chrome.storage.onChanged`: another reader tab chose another arrangement. */
export function wireLayoutChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const layout = changes.settings?.newValue?.[LAYOUT_KEY];
    if (layout) applyStoredLayout(layout);
  });
}
