// RSS / Atom / RDF / JSON Feed fetching and parsing.
// Runs inside the offscreen document, not in the service worker: this is the only context of
// the extension that has DOMParser. `host_permissions` make the request same-
// enough for the response to be readable (no CORS problem).

import { FEED_FETCH_TIMEOUT_MS, absoluteUrl, cleanTitle, isValidHttpUrl, linkKey, pubDateTime } from './util.js';
import { decodeResponseBytes, retargetXmlDeclaration } from './encoding.js';

const ACCEPT =
  'application/feed+json, application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, application/json;q=0.7, */*;q=0.5';
const MAX_ENTRIES = 250;

/**
 * The media types a JSON Feed is served under. `application/feed+json` is the one the format
 * registers for itself; `application/json` is what a good part of the sites serving it actually
 * write in the header.
 */
const JSON_TYPES = new Set(['application/feed+json', 'application/json', 'application/x-jsonfeed', 'text/json']);

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

/** The media type of a response, without its `; charset=…`. */
function mediaType(contentType) {
  return String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/**
 * Did the server answer that this is JSON? A type is matched whole: `application/jsonfeed` is not
 * `application/json`, and a site that writes `application/xml` means XML even when its body starts
 * with a brace.
 */
export function isJsonType(contentType) {
  return JSON_TYPES.has(mediaType(contentType));
}

/**
 * Does the body open like a JSON object? JSON Feed says nothing about the type a site must write in
 * its header, only that the document is JSON — so a site that answers `text/html` over a JSON body
 * is still read as JSON.
 */
export function looksLikeJson(text) {
  return String(text ?? '').trimStart().startsWith('{');
}

/**
 * Is this answer a JSON Feed? The body decides first: an object is JSON whatever the header called
 * it. A header that names a JSON type counts too — until the body opens with markup, because a
 * misconfigured site answering `application/json` over an ordinary RSS document is a feed to be read,
 * not a failure to be reported.
 */
export function isJsonFeed(text, contentType) {
  if (looksLikeJson(text)) return true;
  return isJsonType(contentType) && !String(text ?? '').trimStart().startsWith('<');
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

    const contentType = response.headers.get('content-type') ?? '';

    // The body is read as bytes and decoded by the encoding the feed actually uses (see
    // `lib/encoding.js`): `response.text()` reads UTF-8, which turns a Windows-1251 feed into
    // unreadable headlines before they ever reach storage.
    const { text, encoding, declared } = decodeResponseBytes(
      new Uint8Array(await response.arrayBuffer()),
      contentType,
    );
    if (declared && declared !== encoding) {
      console.warn(`feed declared ${declared}, its bytes read as ${encoding}: ${response.url || url}`);
    }
    if (!text.trim()) throw new FeedError('feed returned an empty response', { code: 'feedEmpty' });

    return {
      ...parseFeed(text, response.url || url, contentType),
      notModified: false,
      ...readValidators(response),
    };
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
 * Needs a DOM for the XML formats: call it only from a context where DOMParser exists (the offscreen
 * document). JSON Feed is read from the same place, but needs no DOM: it is a plain object.
 * Fields of entries reflect storage record: { title, description, pubDate, link, sourceId,
 * sourceIdType }.
 *
 * Which format the answer is in is decided here, from the type the server wrote and — when it said
 * nothing useful — from how the body opens.
 */
export function parseFeed(text, baseUrl, contentType = '') {
  if (isJsonFeed(text, contentType)) return parseJsonFeed(text, baseUrl);
  return parseXmlFeed(text, baseUrl);
}

/**
 * The newest headlines of a feed first, whatever order the feed happened to write them in.
 *
 * A feed is not obliged to lead with its latest news: a WordPress archive, a forum or a blog lists
 * its items oldest first, and cutting such a feed at `MAX_ENTRIES` would keep its oldest headlines
 * and throw away the only ones the reader has not seen yet. So the candidate list is ordered by the
 * date the entry carries before it is cut — the same date `storage.capPerFeed` orders the stored
 * headlines by, which keeps the two caps cutting at the same headlines.
 *
 * An entry whose feed states no readable date is not invented an age: such entries keep the order
 * the feed wrote them in, among themselves and behind every dated one.
 *
 * The rule works on values, not on nodes: `parseJsonFeed` applies it to plain objects, which is what
 * lets the tests (scripts/test.mjs) hold it without a DOM.
 */
function newestFirst(values, dateOf) {
  return [...values]
    .map((value, index) => ({ value, index, at: pubDateTime(dateOf(value)) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((candidate) => candidate.value);
}

/** The publication date of an XML entry — the text `pubDate` of the entry record is built from. */
function entryDate(node) {
  return firstText(node, 'pubDate') || firstText(node, 'published') || firstText(node, 'updated');
}

/** The publication date of a JSON Feed item — the text `pubDate` of the entry record is built from. */
function jsonDate(item) {
  if (!item || typeof item !== 'object') return '';
  return jsonText(item.date_published) || jsonText(item.date_modified);
}

function parseXmlFeed(xml, baseUrl) {
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

  for (const node of newestFirst(nodes, entryDate).slice(0, MAX_ENTRIES)) {
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
      pubDate: entryDate(node),
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
 * JSON Feed (https://www.jsonfeed.org/version/1.1/): the document is one object and its `items` are
 * the headlines. Read as an object, not as markup — and, unlike the XML formats, with no DOM, which
 * is what lets the rules below be held by the tests (scripts/test.mjs).
 *
 * A JSON document that turns out to be no feed is a failure the reader reports rather than a feed
 * with no headlines: it was read as JSON, and the answer did not agree.
 */
export function parseJsonFeed(text, baseUrl) {
  let feed;
  try {
    feed = JSON.parse(text);
  } catch (error) {
    throw new FeedError('not valid feed JSON', { code: 'feedNotJson', cause: error });
  }

  if (!feed || typeof feed !== 'object' || Array.isArray(feed) || !Array.isArray(feed.items)) {
    throw new FeedError('feed JSON has no `items` array', { code: 'feedNotJson' });
  }

  const feedTitle = cleanTitle(jsonText(feed.title), '');

  const entries = [];
  const seen = new Set();

  for (const item of newestFirst(feed.items, jsonDate).slice(0, MAX_ENTRIES)) {
    if (!item || typeof item !== 'object') continue;

    const rawId = jsonText(item.id);
    // `url` is the address of the news; an `id` that is itself an address opens when the item has no
    // url — the same rule a permalink `<guid>` follows in RSS.
    const rawLink = jsonText(item.url) || (isValidHttpUrl(rawId) ? rawId : '');
    // Without a link there is nothing to open later, and absoluteUrl('') would resolve to
    // the feed URL itself.
    if (!rawLink) continue;

    const link = absoluteUrl(rawLink, baseUrl);
    if (!link) continue;

    const { sourceId, sourceIdType } = sourceIdentity({ link, jsonId: rawId });
    if (!sourceId) continue;

    // Two `items` of one feed that the feed calls the same news are one headline here.
    const key = `${sourceIdType}:${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const text = jsonText(item.content_html) || paragraph(jsonText(item.content_text));

    entries.push({
      title: cleanTitle(jsonText(item.title), ''),
      // `content_html` is HTML and is kept verbatim, like `<description>` is. `content_text` is plain
      // text: it becomes one paragraph, with its own angle brackets escaped so a plain text item is
      // not read as markup by the panel that shows it.
      // The pictures the item states outside its text lead the description, the way the picture of a
      // usual `<description>` leads it.
      description: `${jsonImages(item, baseUrl, text)}${text}`,
      // `date_published` is the format's own publication date; `date_modified` stands in when the
      // feed states only that.
      pubDate: jsonDate(item),
      link,
      // What the feed calls this news: kept beside the link so a headline is still recognised when
      // the address it points at has moved (see `storage.makeItem`).
      sourceId,
      sourceIdType,
    });
  }

  return { feedTitle, entries };
}

/** A field of a JSON feed as text: a number or a boolean (a numeric `id`, a `title` of one digit) is still readable. */
function jsonText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Plain text of a JSON Feed item, made into one paragraph. */
function paragraph(text) {
  if (!text) return '';
  return `<p>${escapeText(text)}</p>`;
}

/** Markup characters of a value written into the description — as text or as an attribute value. */
function escapeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The pictures a JSON Feed item states beside its text — its `image` and its image `attachments` —
 * as `<img>` tags. A preview picture of this reader is an `<img>` inside `description` and nothing
 * else: that is the tag `storage.makeItem` puts in one uniform box and `extract.sanitizePreview`
 * is willing to render, so the fields have to become tags here, in the parser.
 *
 * Two kinds of attachment are left out on purpose. One the feed marks `in_feed` — the feed says the
 * picture already stands in its `content_html`, and putting it twice is not an improvement — and one
 * of another kind than an image: an audio or video attachment has nothing to show in a preview.
 */
function jsonImages(item, baseUrl, content) {
  const candidates = [
    // `image` is either the address of the picture or an attachment object of the same shape as the
    // ones in `attachments`.
    typeof item.image === 'string' ? { url: item.image } : item.image,
    ...(Array.isArray(item.attachments) ? item.attachments : []),
  ];

  const tags = [];
  const used = new Set();

  for (const attachment of candidates) {
    if (!attachment || typeof attachment !== 'object') continue;
    if (attachment.in_feed === true) continue;

    const mime = jsonText(attachment.mime_type).toLowerCase();
    // An attachment that names no type is an image: `image/jpeg` is the default JSON Feed gives it.
    if (mime && !mime.startsWith('image/')) continue;

    const src = absoluteUrl(jsonText(attachment.url), baseUrl);
    // A relative address is resolved from the feed, as a relative `<link>` is. The reader previews
    // only http(s) pictures, so anything else (`data:`, `mailto:`) is not worth a tag.
    if (!src || !isValidHttpUrl(src)) continue;
    if (used.has(src) || content.includes(src)) continue;

    used.add(src);
    tags.push(`<img src="${src}" alt="${escapeText(jsonText(attachment.title_text))}" />`);
  }

  return tags.length ? `<p>${tags.join('')}</p>` : '';
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
 * be unique and stable for the life of the entry), then the `id` of a JSON Feed item (required by
 * JSON Feed to be unique and stable for the life of the item). With none of them, the identity *is*
 * the link — read the way `util.linkKey` reads it, so the copy of the next poll matches the one in
 * storage.
 *
 * @param {{ link?: string, guid?: string, guidIsLink?: boolean, atomId?: string, jsonId?: string }} entry
 * @returns {{ sourceId: string, sourceIdType: 'link' | 'guid' | 'atom:id' | 'json:id' }}
 */
export function sourceIdentity({
  link = '',
  guid = '',
  guidIsLink = true,
  atomId = '',
  jsonId = '',
} = {}) {
  const rawGuid = String(guid ?? '').trim();
  const rawId = String(atomId ?? '').trim();
  const rawJson = String(jsonId ?? '').trim();

  if (rawGuid && !guidIsLink) return { sourceId: rawGuid, sourceIdType: 'guid' };
  if (rawId) return { sourceId: isValidHttpUrl(rawId) ? linkKey(rawId) : rawId, sourceIdType: 'atom:id' };
  if (rawJson) return { sourceId: isValidHttpUrl(rawJson) ? linkKey(rawJson) : rawJson, sourceIdType: 'json:id' };

  /* A permalink guid is the address of the news — `parseFeed` opens it when the entry has no other
   * link — so such a guid is not an id of its own: the identity is the link the reader keeps. */
  return { sourceId: linkKey(link), sourceIdType: 'link' };
}
