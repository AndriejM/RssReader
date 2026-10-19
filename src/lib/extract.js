// Extraction of the body of a news article, done at click time.
// Only text nodes are lifted out of the page and re-rendered by the reader page, so no
// third-party markup, script or style ever reaches the extension's DOM.

import { ARTICLE_FETCH_TIMEOUT_MS, cleanTitle } from './util.js';

const MAX_PARAGRAPHS = 60;
const MAX_CHARACTERS = 16000;
const MIN_PARAGRAPH_LENGTH = 40;

const BOILERPLATE_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'input', 'select',
  'figure', 'picture', 'video', 'audio',
  '[aria-hidden="true"]',
].join(', ');

const AD_PATTERN = /ad|advert|cookie|newsletter|promo|related|sidebar|share|social|comment|banner|subscribe|popup|recirc|outbrain|taboola/i;

/** Safe subset for rendering stored RSS `<description>` previews. */
const PREVIEW_ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'em', 'hr', 'i', 'img', 'li', 'ol', 'p', 'small', 'strong', 'sub', 'sup', 'u', 'ul',
]);
const PREVIEW_VOID_TAGS = new Set(['br', 'hr', 'img']);
const PREVIEW_ALLOWED_ATTRS = new Map([
  ['a', new Set(['href', 'title'])],
  // `width`/`height` are stored on purpose: `storage.makeItem` puts one uniform box on every
  // preview image, and dropping it here would throw that work away at render time.
  ['img', new Set(['src', 'alt', 'title', 'width', 'height'])],
]);

function safeExternalUrl(value) {
  const url = String(value ?? '').trim();
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) return url;
  return null;
}

export class ArticleError extends Error {
  constructor(message, { status, code, params, cause } = {}) {
    super(message);
    this.name = 'ArticleError';
    this.status = status;
    // Same shape as `rss.FeedError`: the page renders `errors.<code>` in its own language, while
    // `message` stays a technical description for the console.
    this.code = code;
    this.params = params;
    this.cause = cause;
  }
}

/**
 * Load the page of a headline, but not forever: the request carries an `AbortController`. A reader
 * that clicks a headline should get an answer — even a «this page did not answer» one — instead of a
 * panel that waits on a site which never replies.
 */
export async function fetchArticle(url, { timeoutMs = ARTICLE_FETCH_TIMEOUT_MS } = {}) {
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : ARTICLE_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);

  let response;
  let html;

  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ArticleError(`page replied ${response.status}`, {
        code: 'articleStatus',
        params: { status: response.status, statusText: response.statusText },
      });
    }

    const type = response.headers.get('content-type') ?? '';
    if (type && !/html|xml|text/i.test(type)) {
      throw new ArticleError(`unsupported content type: ${type}`, {
        code: 'articleType',
        params: { type },
      });
    }

    html = await response.text();
  } catch (error) {
    if (error instanceof ArticleError) throw error;

    if (controller.signal.aborted) {
      throw new ArticleError(`page did not answer within ${Math.round(limit / 1000)}s`, {
        code: 'articleTimeout',
        params: { seconds: Math.round(limit / 1000) },
        cause: error,
      });
    }

    const reason = error?.message ?? String(error);
    throw new ArticleError(`failed to load the page: ${reason}`, {
      code: 'articleFetch',
      params: { cause: reason },
      cause: error,
    });
  } finally {
    /* The limit is a limit on the network, not on reading it: once the bytes are here, the
     * extraction may take as long as the page asks for. */
    clearTimeout(timer);
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc.body) throw new ArticleError('the page has no content', { code: 'articleEmpty' });

  return {
    url: response.url || url,
    pageTitle: cleanTitle(doc.querySelector('title')?.textContent, ''),
    ...extractArticle(doc),
  };
}

function textOf(element) {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function stripBoilerplate(doc) {
  for (const element of doc.querySelectorAll(BOILERPLATE_SELECTOR)) {
    element.remove();
  }
  // Second pass over class/id hints: ad slots, cookie walls, comment threads.
  for (const element of [...doc.querySelectorAll('[class], [id]')]) {
    const hint = `${element.className ?? ''} ${element.id ?? ''}`;
    if (hint && AD_PATTERN.test(hint)) element.remove();
  }
}

/**
 * Pick the container that holds the article: an explicit article/main element when it is
 * rich enough, otherwise the block container with the longest chain of real paragraphs.
 */
function findArticleRoot(doc) {
  const explicit = doc.querySelector(
    'article, main, [role="main"], [itemprop="articleBody"], ' +
    '[class*="article-body" i], [class*="article-content" i], [class*="story" i], [id*="article" i]'
  );
  if (explicit && collectParagraphs(explicit).join('\n').length > 400) return explicit;

  let best = null;
  let bestScore = 0;
  for (const candidate of doc.querySelectorAll('div, section, article, main')) {
    const parts = collectParagraphs(candidate);
    const characters = parts.reduce((sum, part) => sum + part.length, 0);
    if (parts.length < 2 || characters < 300) continue;
    // Weight by content density so huge wrapper divs do not outscore the real article.
    const score = characters / (candidate.querySelectorAll('*').length + 1);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best ?? explicit ?? doc.body;
}

function collectParagraphs(root) {
  const parts = [];
  for (const element of root.querySelectorAll('p, li, blockquote, h2, h3')) {
    const text = textOf(element);
    if (text.length < MIN_PARAGRAPH_LENGTH) continue;
    if (parts.includes(text)) continue;
    parts.push(text);
  }
  return parts;
}

function dedupeParagraphs(parts) {
  const kept = [];
  for (const part of parts) {
    // Drop a paragraph that is already contained in a longer neighbour.
    if (kept.some((other) => other.length > part.length && other.includes(part))) continue;
    kept.push(part);
  }
  return kept;
}

/**
 * @returns {{ paragraphs: string[], truncated: boolean, thin: boolean }}
 */
export function extractArticle(doc) {
  stripBoilerplate(doc);

  const root = findArticleRoot(doc);
  let paragraphs = dedupeParagraphs(collectParagraphs(root));

  // Nothing article-like: fall back to whatever readable text the page has.
  const characters = paragraphs.reduce((sum, part) => sum + part.length, 0);
  if (characters < 300) {
    const fallback = (root.textContent ?? '').split(/\n{2,}/).map(textOf).filter((text) => text.length >= 20);
    if (fallback.length > 0) paragraphs = fallback;
  }

  let truncated = paragraphs.length > MAX_PARAGRAPHS;
  paragraphs = paragraphs.slice(0, MAX_PARAGRAPHS);

  const limited = [];
  let total = 0;
  for (const paragraph of paragraphs) {
    if (total >= MAX_CHARACTERS) {
      truncated = true;
      break;
    }
    total += paragraph.length;
    limited.push(paragraph);
  }

  return {
    paragraphs: limited,
    truncated,
    thin: limited.reduce((sum, part) => sum + part.length, 0) < 500,
  };
}

/**
 * Safe preview node for stored RSS description text. Feed descriptions can contain HTML from
 * the source feed, so rebuild only a safe subset before the reader page inserts it in its own DOM.
 * @param {null|string|null|null|null} source
 * @returns {{ node: HTMLElement|null, truncated: boolean }}
 */
export function sanitizePreview(source) {
  const text = String(source ?? '').trim();
  if (!text) return { node: null, truncated: false };

  const parsed = new DOMParser().parseFromString(text, 'text/html');
  const sourceRoot = parsed.body ?? parsed.documentElement;
  const roots = sourceRoot?.childNodes?.length ? [...sourceRoot.childNodes] : [];
  if (roots.length === 0) return { node: null, truncated: false };

  const container = document.createElement('div');
  container.className = 'preview';
  let visible = 0;

  function appendSafe(node, parent, depth = 0) {
    if (!node || depth > 80) return;

    if (node.nodeType === 3) {
      const value = node.nodeValue?.replace(/\s+/g, ' ') ?? '';
      if (/\S/.test(value)) {
        parent.appendChild(document.createTextNode(value));
        visible += value.trim().length;
      }
      return;
    }

    if (node.nodeType !== 1) return;

    const tag = (node.tagName ?? '').toLowerCase();
    if (
      !tag ||
      tag === 'script' || tag === 'style' ||
      tag === 'iframe' || tag === 'object' || tag === 'embed' ||
      tag === 'form' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select'
    ) {
      return;
    }

    if (!PREVIEW_ALLOWED_TAGS.has(tag)) {
      for (const child of [...(node.childNodes ?? [])]) appendSafe(child, parent, depth + 1);
      return;
    }

    const copy = document.createElement(tag);
    const allowedAttrs = PREVIEW_ALLOWED_ATTRS.get(tag);

    if (allowedAttrs) {
      for (const name of node.getAttributeNames?.() ?? []) {
        if (!allowedAttrs.has(name)) continue;
        const value = node.getAttribute(name);

        if (name === 'href' || name === 'src') {
          const safeUrl = safeExternalUrl(value);
          if (safeUrl) copy.setAttribute(name, safeUrl);
        } else {
          copy.setAttribute(name, String(value ?? ''));
        }
      }
    }

    if (tag === 'img' && !copy.getAttribute('src')) return;

    for (const child of [...node.childNodes]) {
      appendSafe(child, copy, depth + 1);
    }

    if (!PREVIEW_VOID_TAGS.has(tag) && copy.childNodes.length === 0) return;

    parent.appendChild(copy);
    if (tag === 'img') visible += 1;
  }

  for (const child of roots) appendSafe(child, container, 0);
  if (!visible) return { node: null, truncated: false };

  const truncated = /…\s*\]/.test(text);
  return { node: container, truncated };
}
