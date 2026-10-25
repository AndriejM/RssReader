// Width of the reader's columns: the border between two columns is a handle. Hover it, hold the
// left mouse button, move right or left — the column to the left of the border takes the width and
// its neighbour gives the rest back. The last column is never dragged: it keeps whatever is left of
// the window's width.
//
// `settings.column_widths` in chrome.storage.local is the source of truth, so every reader tab opens
// at the same widths; localStorage caches the last map so `columns-boot.js` paints the columns at
// their remembered widths before the page module resolves — the same split `lib/fontsize.js` uses.
// The width is written when the button is released, not while the border moves.

import { t } from './i18n.js';
import { LAYOUT_EVENT, layoutPanels } from './layout.js';
import {
  COLUMN_WIDTHS_KEY,
  MIN_PANEL_WIDTH,
  RESIZABLE_PANELS,
  getColumnWidths,
  normalizeColumnWidths,
  setColumnWidth,
} from './storage.js';

/** localStorage key holding the cached map: written here, read here and by `columns-boot.js`. */
export const COLUMN_CACHE_KEY = 'rss-reader:column-widths';

/** The class of a border handle and the attribute naming the column its drag sizes. */
const HANDLE_CLASS = 'col-resize';
const PANEL_ATTR = 'data-column-resize';

/** The name of a handle: its tooltip and its accessible name. */
const HANDLE_LABEL = 'reader.column.resize';

/**
 * Where a handle sits. The grid of an arrangement is `column gap column gap column`, so a handle owns
 * the gap column that follows the column it sizes (see `reader.css`): the panel that stands `i`-th in
 * the arrangement has its border in the grid column `2i + 2`.
 */
function areaOf(index) {
  return { gridColumn: `${2 * index + 2} / ${2 * index + 3}`, gridRow: '1 / 2' };
}

/** The panels the arrangement painted on the page shows, left to right. */
function shownPanels() {
  return layoutPanels();
}

/**
 * Is the page in its stacked form now? The stylesheet decides when the panels wrap into rows, not this
 * script, so the question is asked of the grid the stylesheet gave the panels: more than one row means
 * the panels wrapped. Asking the width directly would repeat a number the stylesheet owns.
 */
function stacked(panels) {
  if (!panels) return false;
  return getComputedStyle(panels).gridTemplateRows.trim().split(/\s+/).length > 1;
}

/**
 * The panels that share the first row: in the stacked form the last panel of the arrangement takes a row
 * of its own (see the `max-width` rule of `reader.css`), so its border stops being a column border and
 * stops being a handle.
 */
function rowPanels(panels) {
  const shown = shownPanels();
  return stacked(panels) ? shown.slice(0, -1) : shown;
}

/** Where a handle belongs now, or nothing at all when this arrangement gives that border no cell. */
function areaFor(panel) {
  const row = rowPanels(panelsSurface());
  const index = row.indexOf(panel);
  // The last panel of the row has no border to its right, and a panel the arrangement does not show
  // has no column of its own at all.
  return index < 0 || index === row.length - 1 ? null : areaOf(index);
}

function panelsSurface() {
  return document.querySelector('.panels');
}

/** How wide a gap column is: the drag has to leave room for the gaps it sits in. */
function columnGap(panels) {
  const gap = Number.parseFloat(getComputedStyle(panels).getPropertyValue('--col-gap'));
  return Number.isFinite(gap) ? gap : 0;
}

function readCache() {
  try {
    return normalizeColumnWidths(JSON.parse(localStorage.getItem(COLUMN_CACHE_KEY) ?? ''));
  } catch {
    return null; // Nothing usable stored — the stored widths decide on their own.
  }
}

function writeCache(widths) {
  try {
    localStorage.setItem(COLUMN_CACHE_KEY, JSON.stringify(widths));
  } catch {
    // Ignore cache failures: chrome.storage.local still carries the widths.
  }
}

/** Paint the columns the mouse sizes; the last column takes the width that is left over. */
function paint(widths) {
  const panels = panelsSurface();
  if (!panels) return;

  for (const panel of RESIZABLE_PANELS) {
    panels.style.setProperty(`--col-${panel}`, `${widths[panel]}px`);
  }
}

/** Re-place every handle: the borders move when the reader changes its arrangement or its shape. */
function paintAreas() {
  for (const panel of RESIZABLE_PANELS) {
    const handle = document.querySelector(`[${PANEL_ATTR}="${panel}"]`);
    if (!handle) continue;

    const area = areaFor(panel);
    handle.hidden = !area;
    if (area) Object.assign(handle.style, area);
  }
}

/**
 * The widest a column may become in the room the panels have now: every gap keeps its width and every
 * other column of the same row keeps its own minimum, so `MIN_PANEL_WIDTH` is never crossed from
 * either side of the border.
 */
function maxPanelWidth(panels) {
  // Only the panels of the same row can give width away: stacked, the article owns a row of its own.
  const neighbours = rowPanels(panels).length - 1;
  const room = panels.clientWidth - (MIN_PANEL_WIDTH + columnGap(panels)) * neighbours;
  return Math.max(MIN_PANEL_WIDTH, room);
}

/* ------------------------------------------------------------------ dragging */

/** The widths the page is painted at: what an interrupted drag puts back. */
let applied = null;

/** The map a drag starts from, so releasing one border does not drop the widths of the others. */
function currentWidths() {
  return applied ?? normalizeColumnWidths(readCache());
}

/** The drag in progress, or null while no border is held. */
let dragging = null;

function endDrag(commit) {
  const drag = dragging;
  if (!drag) return;

  dragging = null;
  document.removeEventListener('pointermove', drag.move);
  document.removeEventListener('pointerup', drag.up);
  document.removeEventListener('pointercancel', drag.up);
  document.body.classList.remove('resizing');

  if (!commit) {
    // The border goes back to the width the column had before the press.
    paint(applied ?? drag.widths);
    return;
  }

  const widths = normalizeColumnWidths(drag.widths);
  applied = widths;
  writeCache(widths);
  void setColumnWidth(drag.panel, widths[drag.panel]).then((stored) => {
    if (stored) paint(stored);
  });
}

function beginDrag(handle, event) {
  const panel = handle.dataset.columnResize;
  if (!RESIZABLE_PANELS.includes(panel)) return;

  const panels = panelsSurface();
  if (!panels) return;

  const start = currentWidths();
  const limit = maxPanelWidth(panels);
  // A copy of the painted widths: the drag writes into it while `start` stays the width the border is
  // pulled from, and `applied` — the same map when one is already painted — is left untouched.
  const widths = { ...start };
  let moved = false;

  // The border follows the pointer one pixel per pixel. `start` is the width the column is painted
  // at, not the width it measures: a window too narrow for both columns keeps them at the floor,
  // and the remembered width must not change just because the pointer was pressed.
  const move = (moveEvent) => {
    moved = true;
    widths[panel] = Math.min(
      Math.max(start[panel] + (moveEvent.clientX - event.clientX), MIN_PANEL_WIDTH),
      limit,
    );
    paint(widths);
  };

  // A border that was only pressed and never moved writes nothing: the column keeps its width.
  const up = () => endDrag(moved);
  const cancel = () => endDrag(false);

  dragging = { panel, widths, move, up };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.body.classList.add('resizing');
}

/* ------------------------------------------------------------------ mounting */

/**
 * Put a handle into every gap the reader's layout declares with `data-column-resize`: the handle is
 * the gap itself, so it is never laid out over a column.
 *
 * Call it before the language is known — the caption is written both as a value and as a
 * `data-i18n-*` attribute, so a later `applyI18n()` re-pastes it in the new language.
 */
export function mountColumnResizers() {
  const panels = panelsSurface();
  if (!panels) return;

  for (const gap of panels.querySelectorAll('[data-column-resize]')) {
    const panel = gap.dataset.columnResize;
    if (!RESIZABLE_PANELS.includes(panel)) continue;

    gap.classList.add(HANDLE_CLASS);
    gap.dataset.i18nTitle = HANDLE_LABEL;
    gap.dataset.i18nAria = HANDLE_LABEL;
    gap.title = t(HANDLE_LABEL);
    gap.setAttribute('aria-label', t(HANDLE_LABEL));
    gap.setAttribute('role', 'separator');
    gap.setAttribute('aria-orientation', 'vertical');
    gap.setAttribute('aria-controls', `panel-${panel}`);

    gap.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return; // Only the left button drags.
      event.preventDefault();
      beginDrag(gap, event);
      // Capture the pointer only for a drag that really started: releasing the button outside the
      // reader's window then still ends the drag instead of leaving the column glued to the cursor.
      if (dragging) {
        try {
          gap.setPointerCapture?.(event.pointerId);
        } catch {
          // Nothing to capture (the pointer is already gone): the document still sees the release.
        }
      }
    });
  }

  // A handle is placed by the grid area its border belongs to, and that area changes when the reader
  // switches between its forms or between its arrangements: the panels the borders sit between differ.
  paintAreas();
  window.addEventListener('resize', paintAreas);
  document.addEventListener(LAYOUT_EVENT, paintAreas);

  applyCachedColumnWidths();
}

/** Apply the cached widths synchronously — before any `chrome.storage` read resolves. */
export function applyCachedColumnWidths() {
  const widths = readCache();
  if (!widths) return;
  applied = widths;
  paint(widths);
}

/**
 * Take over the stored widths: paint, cache, and let a later language change find the captions
 * through `applyI18n()`.
 */
export function applyStoredColumnWidths(widths) {
  const normalized = normalizeColumnWidths(widths);
  applied = normalized;
  writeCache(normalized);
  paint(normalized);
  return normalized;
}

/** Load the stored widths — the widths the reader opens with. */
export async function loadColumnWidths() {
  return applyStoredColumnWidths(await getColumnWidths());
}

/** React to `chrome.storage.onChanged`: another tab, or another border of this page, moved a column. */
export function wireColumnWidthChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const widths = changes.settings?.newValue?.[COLUMN_WIDTHS_KEY];
    if (widths) applyStoredColumnWidths(widths);
  });
}
