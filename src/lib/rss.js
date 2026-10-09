// RSS / Atom / RDF fetching and parsing.
// Runs inside the offscreen document, not in the service worker: this is the only context of
// the extension that has DOMParser. `host_permissions` make the request same-
// enough for the response to be readable (no CORS problem).

import { absoluteUrl, cleanTitle, isValidHttpUrl } from './util.js';

const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';
const MAX_ENTRIES = 50;

export class FeedError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'FeedError';
    this.status = status;
    this.cause = cause;
  }
}

export async function fetchFeed(url) {
  // The URL comes from storage, which can also be edited by hand in the console: keep it to http(s).
  if (!isValidHttpUrl(url)) {
    throw new FeedError('Ссылка ленты должна начинаться с http:// или https://');
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: ACCEPT },
    });
  } catch (cause) {
    throw new FeedError(`Не удалось загрузить ленту: ${cause?.message ?? cause}`, { cause });
  }

  if (!response.ok) {
    throw new FeedError(`Лента ответила ${response.status} ${response.statusText}`);
  }

  // Feeds come as UTF-8 here, so `response.text()` can decode the bytes directly.
  const text = await response.text();
  if (!text.trim()) throw new FeedError('Лента вернула пустой ответ');

  return parseFeed(text, response.url || url);
}

/** Children of `parent` whose local name matches, ignoring namespaces. */
function childNodes(parent, localName) {
  const found = [];
  for (const node of parent?.children ?? []) {
    if (node.localName === localName) found.push(node);
  }
  return found;
}

function firstText(parent, localName) {
  const [node] = childNodes(parent, localName);
  return node?.textContent?.trim() ?? '';
}

function anyTag(doc, localName) {
  // '*' as the namespace matches elements in any (or no) namespace.
  return [...doc.getElementsByTagNameNS('*', localName)];
}

/** Atom links carry rel/href instead of text. */
function entryLink(entry) {
  const links = childNodes(entry, 'link');
  if (links.length === 0) return '';

  const alternate =
    links.find((link) => link.getAttribute('rel') === 'alternate') ??
    links.find((link) => !link.getAttribute('rel')) ??
    links[0];

  return (alternate?.getAttribute('href') ?? '').trim();
}

/**
 * Needs a DOM: call it only from a context where DOMParser exists (the offscreen document).
 * Fields of entries reflect storage record: { feedTitle: string, entries: Array<{ title, description, pubDate, link }> }.
 */
export function parseFeed(xml, baseUrl) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new FeedError('Ответ не похож на корректный XML ленты');
  }

  const root = doc.documentElement;
  if (!root) throw new FeedError('Пустой XML ленты');

  const channel = childNodes(root, 'channel')[0];
  const feedTitle = cleanTitle(firstText(root, 'title') || firstText(channel, 'title'), 'Лента без названия');

  // RSS 2.0 / RDF use <item>, Atom uses <entry>.
  const nodes = anyTag(doc, 'item');
  if (nodes.length === 0) nodes.push(...anyTag(doc, 'entry'));

  const entries = [];
  const seen = new Set();

  for (const node of nodes.slice(0, MAX_ENTRIES)) {
    const rawLink = firstText(node, 'link') || entryLink(node) || guidAsLink(node);
    // Without a link there is nothing to open later, and absoluteUrl('') would resolve to
    // the feed URL itself.
    if (!rawLink) continue;

    const link = absoluteUrl(rawLink, baseUrl);
    if (!link) continue;
    if (seen.has(link)) continue;
    seen.add(link);

    entries.push({
      title: cleanTitle(firstText(node, 'title') || node.getAttribute('title')),
      // Kept verbatim: `<description>` (or an Atom `<summary>`/`<content>` variant) carries
      // short news text in HTML — do not pipe it through cleanTitle, markup must survive.
      description: firstText(node, 'description') || firstText(node, 'summary') || firstText(node, 'content'),
      pubDate: firstText(node, 'pubDate') || firstText(node, 'published') || firstText(node, 'updated'),
      link,
    });
  }

  return { feedTitle, entries };
}

function guidAsLink(node) {
  const [guid] = childNodes(node, 'guid');
  if (!guid) return '';
  const isLink = (guid.getAttribute('isPermaLink') ?? 'true').toLowerCase() === 'true';
  return isLink ? guid.textContent?.trim() ?? '' : '';
}
