// Light/dark theme shared by every extension page.
// chrome.storage.local is the source of truth; localStorage only caches the last value so a
// page can paint the right theme synchronously before the async read resolves.

import { getTheme, setTheme } from './storage.js';

const THEME_CACHE_KEY = 'rss-reader:theme';

export function applyCachedTheme() {
  let cached = null;
  try {
    cached = localStorage.getItem(THEME_CACHE_KEY);
  } catch {
    // Ignore: some environments block localStorage.
  }
  const theme = cached === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  return theme;
}

export async function loadTheme() {
  const theme = await getTheme();
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // Ignore cache failures.
  }
  return theme;
}

export async function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  await setTheme(next);
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_CACHE_KEY, next);
  } catch {
    // Ignore cache failures.
  }
  return next;
}

/**
 * Wire a button that flips the theme and keeps its label in sync. Icon-only buttons (marked
 * with .theme-toggle) draw their glyph from CSS and only take the label as a tooltip.
 */
export async function wireThemeButton(button) {
  const iconOnly = button.classList.contains('theme-toggle');

  const render = (theme) => {
    const label = theme === 'light' ? 'Тёмная тема' : 'Светлая тема';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(theme === 'light'));
    if (!iconOnly) button.textContent = label;
  };

  render(await loadTheme());

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      render(await toggleTheme());
    } finally {
      button.disabled = false;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const settings = changes.settings?.newValue;
    if (settings?.theme) render(settings.theme);
  });
}
