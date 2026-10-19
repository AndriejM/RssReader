// RSS / Atom / RDF fetching and parsing.
// Runs inside the offscreen document, not in the service worker: this is the only context of
// the extension that has DOMParser. `host_permissions` make the request same-
// enough for the response to be readable (no CORS problem).

import { FEED_FETCH_TIMEOUT_MS, absoluteUrl, cleanTitle, isValidHttpUrl, linkKey } from './util.js';
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

/**
 * Fetch one feed, but not forever: the request carries an `AbortController` and the reader gives up
 * on it after `timeoutMs`. A site that accepts the connection and never answers would otherwise sit
 * in the middle of the background poll — feeds are read one after another — and hold every feed
 * behind it. The limit covers the whole answer, body included: a slow body is as much a hang as a
 * slow header.
 */
export async function fetchFeed(url, validators = {}, { timeoutMs = FEED_FETCH_TIMEOUT_MS } = {}) {
  // The URL comes from storage, which can also be edited by hand in the console: keep it to http(s).
  if (!isValidHttpUrl(url)) {
    throw new FeedError('feed link must be http(s)', { code: 'feedUrl' });
  }

  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : FEED_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);

  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      /* The reader keeps its own validators in storage and asks with them; Chrome's HTTP cache would
       * only hold a second, invisible copy of the same answer next to them. */
      cache: 'no-store',
      redirect: 'follow',
      headers: conditionalHeaders(validators),
      signal: controller.signal,
    });

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
  } catch (error) {
    /* A failure we already described says its own piece: only what the timer broke needs one. */
    if (error instanceof FeedError) throw error;

    if (controller.signal.aborted) {
      throw new FeedError(`feed did not answer within ${Math.round(limit / 1000)}s`, {
        code: 'feedTimeout',
        params: { seconds: Math.round(limit / 1000) },
        cause: error,
      });
    }

    throw new FeedError(`failed to load feed: ${error?.message ?? error}`, {
      code: 'feedFetch',
      params: { cause: error?.message ?? String(error) },
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
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
 * Fields of entries reflect storage record: { title, description, pubDate, link, sourceId,
 * sourceIdType }.
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
    const identity = entryIdentity(node);
    const rawLink = firstText(node, 'link') || entryLink(node) || (identity.guidIsLink ? identity.guid : '');
    // Without a link there is nothing to open later, and absoluteUrl('') would resolve to
    // the feed URL itself.
    if (!rawLink) continue;

    const link = absoluteUrl(rawLink, baseUrl);
    if (!link) continue;

    const { sourceId, sourceIdType } = sourceIdentity({ ...identity, link });
    if (!sourceId) continue;

    // Two `<item>`s of one feed that the feed itself calls the same news are one headline here;
    // `storage.addItems` does the same across the polls.
    const key = `${sourceIdType}:${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({
      title: cleanTitle(firstText(node, 'title') || node.getAttribute('title'), ''),
      // Kept verbatim: `<description>` (or an Atom `<summary>`/`<content>` variant) carries
      // short news text in HTML — do not pipe it through cleanTitle, markup must survive.
      description: firstText(node, 'description') || firstText(node, 'summary') || firstText(node, 'content'),
      pubDate: firstText(node, 'pubDate') || firstText(node, 'published') || firstText(node, 'updated'),
      link,
      // What the feed calls this news: kept beside the link so a headline is still recognised when
      // the address it points at has moved (see `storage.makeItem`).
      sourceId,
      sourceIdType,
    });
  }

  return { feedTitle, entries };
}

/**
 * The id fields of one entry, read straight from the XML: the RSS `<guid>` with its `isPermaLink`
 * spelling, and the Atom `<id>`.
 */
function entryIdentity(node) {
  const [guid] = childNodes(node, 'guid');
  const [id] = childNodes(node, 'id');
  return {
    guid: guid?.textContent?.trim() ?? '',
    // An absent `isPermaLink` means «this guid is an address» (the RSS default); only an explicit
    // `isPermaLink="false"` says the guid is the feed's own opaque id.
    guidIsLink: guid ? (guid.getAttribute('isPermaLink') ?? 'true').toLowerCase() !== 'false' : true,
    atomId: id?.textContent?.trim() ?? '',
  };
}

/**
 * Dedup identity of an entry — values, not nodes, so the rule is testable without a DOM
 * (scripts/test.mjs).
 *
 * The feed's own id wins over its link, because that is the field a feed keeps stable while it
 * rewrites the address: an opaque RSS `<guid>`, then the Atom `<id>` (required by the Atom spec to
 * be unique and stable for the life of the entry). With neither, the identity *is* the link — read
 * the way `util.linkKey` reads it, so the copy of the next poll matches the one in storage.
 *
 * @param {{ link?: string, guid?: string, guidIsLink?: boolean, atomId?: string }} entry
 * @returns {{ sourceId: string, sourceIdType: 'link' | 'guid' | 'atom:id' }}
 */
export function sourceIdentity({ link = '', guid = '', guidIsLink = true, atomId = '' } = {}) {
  const rawGuid = String(guid ?? '').trim();
  const rawId = String(atomId ?? '').trim();

  if (rawGuid && !guidIsLink) return { sourceId: rawGuid, sourceIdType: 'guid' };
  if (rawId) return { sourceId: isValidHttpUrl(rawId) ? linkKey(rawId) : rawId, sourceIdType: 'atom:id' };

  /* A permalink guid is the address of the news — `parseFeed` opens it when the entry has no other
   * link — so such a guid is not an id of its own: the identity is the link the reader keeps. */
  return { sourceId: linkKey(link), sourceIdType: 'link' };
}
