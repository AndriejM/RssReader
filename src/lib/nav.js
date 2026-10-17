// The screen switcher, identical on all three extension screens: the same three icons in the
// top-right corner — reader, feed settings, global settings — with the theme toggle after them.
// The icons are built here rather than written out in each page so the switcher is literally the
// same everywhere: a page only says which screen it is (`data-nav-active` on its `<nav>`) and keeps
// its own controls in the same row, next to that `<nav>`.

import { t } from './i18n.js';
import { GLOBAL_SETTINGS_PAGE, READER_PAGE, SETTINGS_PAGE, pageUrl } from './tabs.js';

/** One entry per screen, always in the same order: its id, where it lives, which `<symbol>` of the
 *  page's sprite draws it, and which `nav.*` key names it — that key is both the tooltip and the
 *  accessible name, so every screen explains the icon the same way. */
export const SCREENS = [
  { id: 'reader', page: READER_PAGE, icon: 'icon-reader', label: 'nav.reader' },
  { id: 'feeds', page: SETTINGS_PAGE, icon: 'icon-settings', label: 'nav.feeds' },
  { id: 'global', page: GLOBAL_SETTINGS_PAGE, icon: 'icon-tune', label: 'nav.global' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One icon of the strip: the glyph comes from the sprite, the words come from the dictionary. */
function navItem(screen, { current }) {
  // A screen you are on is a marker, not a control you can press: keeping it a button would make it
  // tabbable without doing anything, and a disabled control is not guaranteed to show its tooltip.
  const item = document.createElement(current ? 'span' : 'button');
  if (!current) item.type = 'button';
  item.id = `nav-${screen.id}`;
  item.className = current ? 'icon-btn nav-btn current' : 'icon-btn nav-btn';
  // The attributes as well as the values: when the interface language changes, `applyI18n()`
  // re-pastes the tooltip from the same key.
  item.dataset.i18nTitle = screen.label;
  item.dataset.i18nAria = screen.label;
  item.title = t(screen.label);
  item.setAttribute('aria-label', t(screen.label));

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${screen.icon}`);
  svg.append(use);
  item.append(svg);

  if (current) {
    // The marker names the screen it stands for and says that this is where the reader is; the
    // `img` role is what lets the accessible name be announced on a plain `<span>`.
    item.setAttribute('role', 'img');
    item.setAttribute('aria-current', 'page');
  }

  return item;
}

/**
 * Fill the page's `<nav data-nav-active="reader|feeds|global">` with the three screen icons. The
 * page keeps its own controls — its theme toggle, its actions — in the same row, after the `<nav>`;
 * the pages differ only in that one attribute and in what they put next to it.
 *
 * `leave` lets a screen guard the jump: the global settings screen confirms before it drops edits
 * that were not written to storage.
 */
export function mountNav({ leave = (url) => window.location.assign(url) } = {}) {
  const nav = document.querySelector('nav[data-nav-active]');
  if (!nav) return null;

  const active = nav.dataset.navActive;
  const items = {};
  for (const screen of SCREENS) {
    const item = navItem(screen, { current: screen.id === active });
    items[screen.id] = item;
    if (screen.id !== active) {
      item.addEventListener('click', () => leave(pageUrl(screen.page)));
    }
  }

  // Prepended as one group: the icons come in the order of `SCREENS`, ahead of anything the page
  // may have put in its `<nav>`, on every screen.
  nav.prepend(...SCREENS.map((screen) => items[screen.id]));
  return { nav, items };
}
