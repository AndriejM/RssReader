// One entry in the tab strip per extension screen: a second click on the toolbar icon activates
// the reader tab that is already open instead of stacking another copy of it, and the reader and
// the settings screen switch places inside that same tab.
//
// `permissions: ["tabs"]` in the manifest exists for one thing only: `chrome.tabs.query` reports
// a tab's URL just to an extension that is allowed to read it, and the URL is the only handle on
// "the tab that shows the reader". `host_permissions: <all_urls>` already lets this extension read
// every tab URL, so the permission does not add reach of its own.

/** The extension's own screens, relative to the extension root. */
export const READER_PAGE = 'src/index.html';
export const SETTINGS_PAGE = 'src/feeds.html';

/** Absolute URL of one of the extension's screens. */
export function pageUrl(page) {
  return chrome.runtime.getURL(page);
}

/**
 * Activate the tab that already shows `page`, or open it when it is open nowhere.
 *
 * The match is made here instead of with `chrome.tabs.query({ url })`: match patterns are written
 * for http/https-style URLs, and comparing the exact URL keeps this free of that question. When
 * the screen is open in several windows, the window the user clicked in (`preferWindowId`) wins,
 * so a click never pulls an unrelated window forward.
 */
export async function focusOrCreateTab(page, preferWindowId = null) {
  const url = pageUrl(page);
  const candidates = (await chrome.tabs.query({})).filter((tab) => tab.url === url);

  if (candidates.length === 0) return chrome.tabs.create({ url });

  const target = candidates.find((tab) => tab.windowId === preferWindowId)
    ?? candidates[candidates.length - 1];

  try {
    await chrome.tabs.update(target.id, { active: true });
    await chrome.windows.update(target.windowId, { focused: true });
    return target;
  } catch {
    // Chrome closed that tab or its window between the query and the activation.
    return chrome.tabs.create({ url });
  }
}
