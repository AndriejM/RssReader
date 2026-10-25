// Size of the reader's windows: the border between two of them is a handle. Hover it, hold the left
// mouse button, move — the window before the border takes the size and its neighbour gives the rest
// back. The last window of a row or of a column is never dragged: it keeps whatever the window leaves.
//
// A border runs along one of two axes. Between two columns it is vertical and drags a width; between
// the two windows one arrangement puts above each other it is horizontal and drags a height. The
// markup declares both kinds (`data-column-resize` and `data-row-resize`), and `layoutColumns()` says
// which borders an arrangement really has — a handle of a border that arrangement does not give its
// panels is hidden.
//
// `settings.column_widths` and `settings.row_heights` in chrome.storage.local are the source of truth,
// so every reader tab opens at the same sizes; localStorage caches the last maps so `columns-boot.js`
// paints the windows at their remembered sizes before the page module resolves — the same split
// `lib/fontsize.js` uses. The size is written when the button is released, not while the border moves.

import { t } from './i18n.js';
import { LAYOUT_EVENT, layoutColumns } from './layout.js';
import {
  COLUMN_WIDTHS_KEY,
  MAX_PANEL_HEIGHT,
  MAX_PANEL_WIDTH,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  RESIZABLE_PANELS,
  RESIZABLE_ROWS,
  ROW_HEIGHTS_KEY,
  getColumnWidths,
  getRowHeights,
  normalizeColumnWidths,
  normalizeRowHeights,
  setColumnWidth,
  setRowHeight,
} from './storage.js';

/** localStorage keys holding the cached maps: written here, read here and by `columns-boot.js`. */
export const COLUMN_CACHE_KEY = 'rss-reader:column-widths';
export const ROW_CACHE_KEY = 'rss-reader:row-heights';

/**
 * The two axes a border runs along. Each one says how the markup names its handle, which custom
 * property carries its size, what the drag measures and writes, and where the handle of a border
 * stands in the grid — `areaFor()` reads the columns of the arrangement from `layoutColumns()`.
 */
const AXES = [
  {
    /** The attribute naming the window to the left of the border, and the class of its handle. */
    attr: 'data-column-resize',
    dataKey: 'columnResize',
    handleClass: 'col-resize',
    /** The windows whose width the mouse moves. */
    panels: RESIZABLE_PANELS,
    variable: (panel) => `--col-${panel}`,
    label: 'reader.column.resize',
    orientation: 'vertical',
    /** The body class that keeps the cursor of this axis while its border is held. */
    cursorClass: 'resizing-col',
    /** The pointer coordinate the drag reads, and the size of the surface it is read against. */
    pointer: (event) => event.clientX,
    surface: 'clientWidth',
    /** The gap the handle sits in, and the floor and ceiling of the size it drags. */
    gap: (panels) => cssNumber(panels, '--col-gap'),
    floorVariable: '--panel-min',
    min: MIN_PANEL_WIDTH,
    max: MAX_PANEL_WIDTH,
    read: normalizeColumnWidths,
    load: getColumnWidths,
    write: setColumnWidth,
    storageKey: COLUMN_WIDTHS_KEY,
    cacheKey: COLUMN_CACHE_KEY,
  },
  {
    /** The attribute naming the window above the border, and the class of its handle. */
    attr: 'data-row-resize',
    dataKey: 'rowResize',
    handleClass: 'row-resize',
    /** The windows whose height the mouse moves. */
    panels: RESIZABLE_ROWS,
    variable: (panel) => `--row-${panel}`,
    label: 'reader.row.resize',
    orientation: 'horizontal',
    cursorClass: 'resizing-row',
    pointer: (event) => event.clientY,
    surface: 'clientHeight',
    gap: (panels) => cssNumber(panels, '--row-gap'),
    floorVariable: '--panel-row-min',
    min: MIN_PANEL_HEIGHT,
    max: MAX_PANEL_HEIGHT,
    read: normalizeRowHeights,
    load: getRowHeights,
    write: setRowHeight,
    storageKey: ROW_HEIGHTS_KEY,
    cacheKey: ROW_CACHE_KEY,
  },
];

function panelsSurface() {
  return document.querySelector('.panels');
}

/** A length written as a custom property, or 0 when the stylesheet gives the reader none. */
function cssNumber(panels, property) {
  const value = Number.parseFloat(getComputedStyle(panels).getPropertyValue(property));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Is the page in its stacked form now? The stylesheet decides when the columns of an arrangement wrap
 * into rows, not this script, so the question is asked of the grid the stylesheet gave the panels:
 * `grid-template-rows` counts more than one track as soon as the panels are wrapped, and an arrangement
 * that cuts one of its columns in two is the exception — its second row belongs to the same column, not
 * to a wrapped panel. Asking the width directly would repeat a number the stylesheet owns.
 */
function stacked(panels) {
  if (!panels) return false;
  const rows = getComputedStyle(panels).gridTemplateRows.trim().split(/\s+/).length;
  if (rows <= 1) return false;
  // A wrapped panel is a column of one window: the columns that share the first row are the whole of
  // the arrangement, and the window that took a row of its own is not their neighbour any more.
  return layoutColumns().every((column) => column.length === 1);
}

/** The columns of the arrangement as the page shows them now, wrapped form included. */
function shownColumns(panels) {
  const columns = layoutColumns();
  // In the stacked form the last panel of the arrangement takes a row of its own (see the
  // `max-width` rule of `reader.css`), so the border that used to end the previous column stops being
  // a column border and stops being a handle.
  return stacked(panels) ? columns.slice(0, -1) : columns;
}

/**
 * Where a handle belongs now, or nothing at all when this arrangement gives that border no cell. The
 * size the handle drags belongs to the window that stands before it.
 *
 * A width border ends a column: the grid of an arrangement is `column gap column gap column`, so the
 * border that ends the column standing `i`-th owns the gap column `2i + 2` and runs the whole height
 * of that column. In the stacked form only the first row holds columns side by side, so the border
 * that stays a handle keeps the cell of that row alone — the row under it belongs to the panel that
 * wrapped. A height border runs across a column: the border below the window that is `j`-th in the
 * column that is `i`-th owns the gap row `2j + 2` of that same column.
 */
function areaFor(axis, panel, panels) {
  const columns = shownColumns(panels);

  if (axis.orientation === 'vertical') {
    const index = columns.findIndex((column) => column[0] === panel);
    // A column that holds two windows is not ended by a width border: the border below its upper window
    // belongs to the row axis, and the lower window is the last of the column.
    if (index < 0 || index === columns.length - 1 || columns[index].length > 1) return null;
    return {
      gridColumn: `${2 * index + 2} / ${2 * index + 3}`,
      gridRow: stacked(panels) ? '1 / 2' : '1 / -1',
    };
  }

  for (let i = 0; i < columns.length; i += 1) {
    const j = columns[i].indexOf(panel);
    if (j < 0 || j === columns[i].length - 1) continue;
    return { gridColumn: `${2 * i + 1} / ${2 * i + 2}`, gridRow: `${2 * j + 2} / ${2 * j + 3}` };
  }
  return null;
}

/**
 * Re-place every handle: the borders move when the reader changes its arrangement or its shape.
 *
 * The cells are given back in a pass of their own, before any handle is asked where it belongs. A cell the
 * script wrote into a handle's `style` stays there, and a handle that spans a row the new arrangement does
 * not have adds that row to the grid: `stacked()` counts the rows of the grid, answers that the columns are
 * wrapped when they are not, and the arrangement loses the handle of its last border — the window that
 * border used to end is then auto-placed into the gap track beside it. Hiding the handle gives the cell
 * back no better: `display: none` takes it out of the grid, which leaves the cell free again.
 */
function paintAreas() {
  const panels = panelsSurface();
  if (!panels) return;

  const handles = [];
  for (const axis of AXES) {
    for (const panel of axis.panels) {
      const handle = document.querySelector(`[${axis.attr}="${panel}"]`);
      if (!handle) continue;

      handle.style.removeProperty('grid-column');
      handle.style.removeProperty('grid-row');
      handles.push([axis, panel, handle]);
    }
  }

  for (const [axis, panel, handle] of handles) {
    const area = areaFor(axis, panel, panels);
    handle.hidden = !area;
    if (!area) continue;

    Object.assign(handle.style, area);
  }
}

/**
 * The largest a window may become in the room the panels have now: every gap keeps its size and every
 * other window that shares the row or the column keeps its own minimum, so the floor is never crossed
 * from either side of the border. Only the windows of one row can give width away (stacked, the
 * article owns a row of its own), and only the windows of one column can give height away.
 */
function maxPanelSize(axis, panels, panel) {
  const neighbours =
    axis.orientation === 'vertical'
      ? shownColumns(panels).length - 1
      : (layoutColumns().find((column) => column.includes(panel))?.length ?? 1) - 1;
  const floor = Math.max(axis.min, cssNumber(panels, axis.floorVariable));
  const room = panels[axis.surface] - (floor + axis.gap(panels)) * neighbours;
  return Math.max(axis.min, Math.min(axis.max, room));
}

/* ------------------------------------------------------------------ sizes of one axis */

/** The sizes every axis is painted at, while nothing has been painted yet the map is not there. */
const applied = new Map();

/** The map a drag starts from, so releasing one border does not drop the sizes of the others. */
function currentSizes(axis) {
  if (applied.has(axis.cacheKey)) return applied.get(axis.cacheKey);
  try {
    return axis.read(JSON.parse(localStorage.getItem(axis.cacheKey) ?? ''));
  } catch {
    return null; // Nothing usable stored — the stored sizes decide on their own.
  }
}

function writeCache(axis, sizes) {
  try {
    localStorage.setItem(axis.cacheKey, JSON.stringify(sizes));
  } catch {
    // Ignore cache failures: chrome.storage.local still carries the sizes.
  }
}

/** Paint the windows the mouse sizes; the last window of a row or column takes what is left over. */
function paint(axis, sizes) {
  const panels = panelsSurface();
  if (!panels) return;

  for (const panel of axis.panels) {
    panels.style.setProperty(axis.variable(panel), `${sizes[panel]}px`);
  }
}

/* ------------------------------------------------------------------ dragging */

/** The drag in progress, or null while no border is held. */
let dragging = null;

function endDrag(commit) {
  const drag = dragging;
  if (!drag) return;

  const { axis } = drag;
  dragging = null;
  document.removeEventListener('pointermove', drag.move);
  document.removeEventListener('pointerup', drag.up);
  document.removeEventListener('pointercancel', drag.up);
  document.body.classList.remove('resizing', axis.cursorClass);

  if (!commit) {
    // The border goes back to the size the window had before the press.
    paint(axis, applied.get(axis.cacheKey) ?? drag.sizes);
    return;
  }

  const sizes = axis.read(drag.sizes);
  applied.set(axis.cacheKey, sizes);
  writeCache(axis, sizes);
  void axis.write(drag.panel, sizes[drag.panel]).then((stored) => {
    if (stored) paint(axis, stored);
  });
}

function beginDrag(axis, handle, event) {
  const panel = handle.dataset[axis.dataKey];
  if (!axis.panels.includes(panel)) return;

  const panels = panelsSurface();
  if (!panels) return;

  const start = currentSizes(axis) ?? axis.read(null);
  const limit = maxPanelSize(axis, panels, panel);
  // A copy of the painted sizes: the drag writes into it while `start` stays the size the border is
  // pulled from, and `applied` — the same map when one is already painted — is left untouched.
  const sizes = { ...start };
  let moved = false;

  // The border follows the pointer one pixel per pixel. `start` is the size the window is painted
  // at, not the size it measures: a window too small for both of its neighbours keeps them at the
  // floor, and the remembered size must not change just because the pointer was pressed.
  const move = (moveEvent) => {
    moved = true;
    sizes[panel] = Math.min(
      Math.max(start[panel] + (axis.pointer(moveEvent) - axis.pointer(event)), axis.min),
      limit,
    );
    paint(axis, sizes);
  };

  // A border that was only pressed and never moved writes nothing: the window keeps its size.
  const up = () => endDrag(moved);
  const cancel = () => endDrag(false);

  dragging = { axis, panel, sizes, move, up };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.body.classList.add('resizing', axis.cursorClass);
}

/* ------------------------------------------------------------------ mounting */

/**
 * Put a handle into every gap the reader's layout declares — `data-column-resize` for a border between
 * two columns, `data-row-resize` for a border between the two windows of one column: the handle is the
 * gap itself, so it is never laid out over a window and never eats one of its pixels.
 *
 * Call it before the language is known — every caption is written both as a value and as a
 * `data-i18n-*` attribute, so a later `applyI18n()` re-pastes it in the new language.
 */
export function mountSizeHandles() {
  const panels = panelsSurface();
  if (!panels) return;

  for (const axis of AXES) {
    for (const gap of panels.querySelectorAll(`[${axis.attr}]`)) {
      const panel = gap.dataset[axis.dataKey];
      if (!axis.panels.includes(panel)) continue;

      gap.classList.add(axis.handleClass);
      gap.dataset.i18nTitle = axis.label;
      gap.dataset.i18nAria = axis.label;
      gap.title = t(axis.label);
      gap.setAttribute('aria-label', t(axis.label));
      gap.setAttribute('role', 'separator');
      gap.setAttribute('aria-orientation', axis.orientation);
      gap.setAttribute('aria-controls', `panel-${panel}`);

      gap.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return; // Only the left button drags.
        event.preventDefault();
        beginDrag(axis, gap, event);
        // Capture the pointer only for a drag that really started: releasing the button outside the
        // reader's window then still ends the drag instead of leaving the window glued to the cursor.
        if (dragging) {
          try {
            gap.setPointerCapture?.(event.pointerId);
          } catch {
            // Nothing to capture (the pointer is already gone): the document still sees the release.
          }
        }
      });
    }
  }

  /* A handle is placed by the grid area its border belongs to, and that area changes when the reader
   * switches between its forms or between its arrangements: the windows the borders sit between differ.
   * The sizes are painted with them — a border the grid gives no cell for keeps the size of its window,
   * so the next arrangement that cuts that column again opens at the height it was left at. */
  const repaint = () => {
    paintAreas();
    applyCachedSizes();
  };
  repaint();
  window.addEventListener('resize', paintAreas);
  document.addEventListener(LAYOUT_EVENT, repaint);
}

/** Apply the cached sizes of both axes synchronously — before any `chrome.storage` read resolves. */
export function applyCachedSizes() {
  for (const axis of AXES) {
    const sizes = currentSizes(axis);
    if (!sizes) continue;
    applied.set(axis.cacheKey, sizes);
    paint(axis, sizes);
  }
}

/**
 * Take over the stored sizes of one axis: paint, cache, and let a later language change find the
 * captions through `applyI18n()`.
 */
export function applyStoredSizes(axis, sizes) {
  const normalized = axis.read(sizes);
  applied.set(axis.cacheKey, normalized);
  writeCache(axis, normalized);
  paint(axis, normalized);
  return normalized;
}

/** The axis whose sizes a key of `settings` carries, or null for a key the reader does not size. */
function axisOfKey(key) {
  return AXES.find((axis) => axis.storageKey === key) ?? null;
}

/** Load the stored sizes of every axis — the sizes the reader opens with. */
export async function loadSizes() {
  for (const axis of AXES) applyStoredSizes(axis, await axis.load());
}

/**
 * React to `chrome.storage.onChanged`: another tab, or another border of this page, moved a window.
 * One listener answers both axes: the key of `settings` the change carries says which of them did.
 */
export function wireSizeChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const settings = changes.settings?.newValue;
    if (!settings) return;

    for (const axis of AXES) {
      const sizes = settings[axis.storageKey];
      if (sizes) applyStoredSizes(axis, sizes);
    }
  });
}
