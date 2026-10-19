// RSS / Atom / RDF fetching and parsing.
// Runs inside the offscreen document, not in the service worker: this is the only context of
// the extension that has DOMParser. `host_permissions` make the request same-
// enough for the response to be readable (no CORS problem).

import { absoluteUrl, cleanTitle, isValidHttpUrl } from './util.js';
import { decodeResponseBytes, retargetXmlDeclaration } from './encoding.js';

const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';
const MAX_ENTRIES = 250;

/**
 * `If-Modified-Since` understands one format: an HTTP-date. Anything else is not sent at all — a
 * validator the server cannot read often costs a 400 instead of the feed itself.
 */
const HTTP_DATE = /^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** A `Last-Modified` we may answer with: only a real HTTP-date, written the one way it is written. */
export function httpDate(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!HTTP_DATE.test(raw)) return '';

  const at = Date.parse(raw);
  return Number.isFinite(at) ? new Date(at).toUTCString() : '';
}

/**
 * Validators of the last read of this feed (`store.rememberFeedValidators`): what the server asked us
 * to send back so it can answer «nothing changed» with an empty 304 instead of the whole feed.
 */
export function conditionalHeaders(validators = {}) {
  const headers = { Accept: ACCEPT };

  /* A weak validator (`W/"…"`) only promises the content is *semantically* equivalent. A GET wants
   * the exact bytes, so the reader does not claim a match it was never promised. */
  const tag = typeof validators.etag === 'string' ? validators.etag.trim() : '';
  if (tag && !tag.startsWith('W/')) headers['If-None-Match'] = tag;

  const since = httpDate(validators.lastModified);
  if (since) headers['If-Modified-Since'] = since;

  return headers;
}

export class FeedError extends Error {
  constructor(message, { status, code, params, cause } = {}) {
    super(message);
    this.name = 'FeedError';
    this.status = status;
    // `code` points at an `errors.<code>` i18n key and `params` fills its placeholders, so the
    // page that shows the failure renders it in the reader's own language.
    this.code = code;
    this.params = params;
    this.cause = cause;
  }
}

export async function fetchFeed(url, validators = {}) {
  // The URL comes from storage, which can also be edited by hand in the console: keep it to http(s).
  if (!isValidHttpUrl(url)) {
    throw new FeedError('feed link must be http(s)', { code: 'feedUrl' });
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      /* The reader keeps its own validators in storage and asks with them; Chrome's HTTP cache would
       * only hold a second, invisible copy of the same answer next to them. */
      cache: 'no-store',
      redirect: 'follow',
      headers: conditionalHeaders(validators),
    });
  } catch (cause) {
    throw new FeedError(`failed to load feed: ${cause?.message ?? cause}`, {
      code: 'feedFetch',
      params: { cause: cause?.message ?? String(cause) },
      cause,
    });
  }

  /*
   * For `fetch` a 304 is not `ok`, but here it is the answer we were hoping for: the feed still is
   * the one we hold, and the server sent no body to prove otherwise. `204` says the same in its own
   * way. Both keep the reader off the parse, the storage write and the «new headlines» count.
   */
  if (response.status === 304 || response.status === 204) {
    return { feedTitle: '', entries: [], notModified: true, ...readValidators(response) };
  }

  if (!response.ok) {
    throw new FeedError(`feed replied ${response.status}`, {
      code: 'feedStatus',
      params: { status: response.status, statusText: response.statusText },
      status: response.status,
    });
  }

  // The body is read as bytes and decoded by the encoding the feed actually uses (see
  // `lib/encoding.js`): `response.text()` reads UTF-8, which turns a Windows-1251 feed into
  // unreadable headlines before they ever reach storage.
  const { text, encoding, declared } = decodeResponseBytes(
    new Uint8Array(await response.arrayBuffer()),
    response.headers.get('content-type') ?? '',
  );
  if (declared && declared !== encoding) {
    console.warn(`feed declared ${declared}, its bytes read as ${encoding}: ${response.url || url}`);
  }
  if (!text.trim()) throw new FeedError('feed returned an empty response', { code: 'feedEmpty' });

  return { ...parseFeed(text, response.url || url), notModified: false, ...readValidators(response) };
}

/**
 * Validators of *this* answer. A server that stopped sending `ETag` clears the old one: a validator
 * it no longer recognises is a question it can only answer with the whole feed.
 */
export function readValidators(response) {
  return {
    etag: response.headers.get('etag')?.trim() ?? '',
    lastModified: httpDate(response.headers.get('last-modified')),
  };
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
  // The text is already decoded by `lib/encoding.js`; the declaration inside it must not invite an
  // XML processor to decode the same bytes a second time, in an encoding they are no longer in.
  const doc = new DOMParser().parseFromString(retargetXmlDeclaration(xml, 'utf-8'), 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new FeedError('not valid feed XML', { code: 'feedNotXml' });
  }

  const root = doc.documentElement;
  if (!root) throw new FeedError('empty feed XML', { code: 'feedEmptyXml' });

  const channel = childNodes(root, 'channel')[0];
  // An empty title stays empty in the record: the reader labels it in its own language, so the
  // stored data does not freeze the language it happened to be parsed in.
  const feedTitle = cleanTitle(firstText(root, 'title') || firstText(channel, 'title'), '');

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
      title: cleanTitle(firstText(node, 'title') || node.getAttribute('title'), ''),
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
