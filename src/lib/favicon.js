// Site icon (favicon) discovery for a feed.
//
// When a feed is added, its page is read once and the icon the site declares is stored on the feed
// (`feeds.js` -> `store.upsertFeed`). The reader draws that stored link twice: next to the feed name
// in the left column, and — in «All feeds» — next to every headline of that feed in the middle one.
//
// The two network-free parts are pure: reading the icon out of a page's text (`pageIconCandidates`)
// and picking the best of the found links (`pickIcon`). They stay testable without a DOM or a network
// (scripts/test.mjs), so the regex that does the reading is covered there. Only `discoverFeedIcon`
// touches `fetch`: it runs on the feeds screen — an extension page, where `host_permissions` make the
// site readable — and a failure there is not worth a translated message: the feed simply gets no icon.

import { ARTICLE_FETCH_TIMEOUT_MS, absoluteUrl, isValidHttpUrl } from './util.js';
import { decodeResponseBytes } from './encoding.js';

/**
 * A `<link>` names the site icon through its `rel`. `icon` and `shortcut icon` are the favicon
 * itself; `apple-touch-icon` and `mask-icon` are the better-drawn variants a site often ships, used
 * only when the plain favicon is absent.
 */
function relIconScore(rel) {
  const tokens = String(rel ?? '').toLowerCase().split(/\s+/);
  if (tokens.includes('icon') || tokens.includes('shortcut')) return 3; // «icon», «shortcut icon»
  if (tokens.includes('apple-touch-icon') || tokens.includes('mask-icon')) return 2;
  return 0;
}

/** Attribute value of a tag: `name="…"`, `name='…'` or a bare `name=…`, quotes dropped. */
function tagAttr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = re.exec(tag);
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

/**
 * The icons a page declares in HTML: every `<link rel="…icon…">`, resolved against the page's own
 * URL. A relative `href` (`/favicon.ico`, `./icon.png`) is put on the page's host; a `data:` URI is
 * dropped, because only an http(s) link can be drawn from another extension page later.
 * Each candidate carries its `score` (see `relIconScore`) so `pickIcon` can rank them.
 */
export function iconLinkCandidates(html, baseUrl) {
  const found = [];
  for (const [tag] of String(html ?? '').matchAll(/<link\b[^>]*\/?>/gi)) {
    const score = relIconScore(tagAttr(tag, 'rel'));
    if (!score) continue;
    const href = tagAttr(tag, 'href');
    if (!href) continue;
    const url = absoluteUrl(href, baseUrl);
    if (isValidHttpUrl(url)) found.push({ score, url });
  }
  return found;
}

/**
 * The picture a feed itself ships: the RSS `<image><url>` of the channel (the "feed icon", the same
 * one many sites show for their RSS) and the Atom `<icon>`/`<logo>`. Text is read straight from the
 * document, so this works on the XML a feed is, without a parser; a CDATA-wrapped URL is unwrapped
 * first. Candidates get the same rank as a plain favicon — a feed image is no better a tile than the
 * site favicon, so it ties with `rel="icon"` and only beats the apple-touch/mask variants.
 */
export function feedImageCandidates(xml, baseUrl) {
  const found = [];
  for (const [block] of String(xml ?? '').matchAll(/<(image|icon|logo)\b[\s\S]*?<\/\1>/gi)) {
    // RSS puts the picture in a `<url>` child; Atom writes the URI as the text of `<icon>`/`<logo>`
    // itself. Read the child when it is there, otherwise take the block's own text as the URI.
    const raws = [...block.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].map((match) => match[1]);
    if (raws.length === 0) {
      raws.push(block);
    }
    for (const raw of raws) {
      // CDATA first: its closing `]]>` is a `>`, so peeling tags before unwrapping CDATA would
      // swallow the URI the CDATA is holding.
      const value = raw
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<[^>]*>/g, '')
        .trim();
      const url = absoluteUrl(value, baseUrl);
      if (isValidHttpUrl(url)) found.push({ score: 3, url });
    }
  }
  return found;
}

/**
 * Every icon a page's text names — the HTML `<link>`s and the feed's own `<image>`/`<icon>` — read
 * from the same text. Which of them a page is (HTML or XML) does not have to be known: a link block
 * finds nothing in XML, an image block finds nothing in HTML, so both passes can run over both.
 */
export function pageIconCandidates(text, baseUrl) {
  return [...iconLinkCandidates(text, baseUrl), ...feedImageCandidates(text, baseUrl)];
}

/**
 * The best of the candidates a page names: highest `rel` score first, and within one score a bigger
 * declared `sizes` (e.g. an apple-touch `180x180`) is preferred only as a tie-break among equal-kind
 * links. `null` when the page names no icon at all.
 */
export function pickIcon(candidates) {
  let best = null;
  for (const candidate of candidates ?? []) {
    if (!candidate?.url) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best?.url ?? null;
}

/** `https://host/` — the site root that a feed link's origin points at, or null if it has none. */
export function siteRoot(feedUrl) {
  try {
    const url = new URL(String(feedUrl));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}/`;
  } catch {
    return null;
  }
}

/**
 * Read one page and return its text with the URL it actually arrived from (a redirect moves the
 * icon's base). `null` for anything that cannot be read: a bad URL, a network failure, a non-2xx,
 * a body that is not text, a page that never answers — all mean "this page tells us nothing about
 * the icon", not an error.
 */
async function readPage(url) {
  if (!isValidHttpUrl(url)) return null;

  /* The icon read is a page read of its own: a site that hangs must not keep a request that the
   * feed was saved without waiting for hanging after it. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARTICLE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    // Only read a page that could carry an icon reference; an image or a binary is not one.
    if (type && !/html|xml|text/i.test(type)) return null;
    /* The bytes are read the way a feed is (see `lib/encoding.js`): a page served in Windows-1251
     * would otherwise reach the icon regexes as noise, and an `href` spelled in its own alphabet
     * would be read as no address at all. */
    return {
      text: decodeResponseBytes(new Uint8Array(await response.arrayBuffer()), type).text,
      url: response.url || url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find the icon of the site a feed belongs to.
 *
 * 1. The added URL is read: an HTML page declares `<link rel="icon">`, an RSS/Atom feed ships its
 *    own `<image>`/`<icon>` — both are picked out of the same text.
 * 2. If that page named no icon, the site root is read: the favicon usually lives on the home page,
 *    not on the feed document (a feed at `/rss` does not repeat what `/` declares). The root is
 *    skipped when it is the very page already read.
 * 3. Failing both, the conventional `/favicon.ico` at the site root is offered: the reader only draws
 *    an icon that loads, so a root that has none simply shows no icon (see `index.js`).
 *
 * @returns {Promise<string|null>} an absolute http(s) icon URL, or null when there is no site to ask.
 */
export async function discoverFeedIcon(feedUrl) {
  const root = siteRoot(feedUrl);
  if (!root) return null;

  const pages = [feedUrl];
  if (root !== feedUrl) pages.push(root);

  for (const url of pages) {
    const page = await readPage(url);
    if (!page) continue;
    const icon = pickIcon(pageIconCandidates(page.text, page.url));
    if (icon) return icon;
  }

  return `${new URL(root).origin}/favicon.ico`;
}
