// A small DOM for the Node test harness, with no dependencies.
//
//   import { installDom } from './fake-dom.mjs';
//   const uninstall = installDom();
//   // `new DOMParser()` and `document` now exist; call uninstall() when the test is done.
//
// The extension parses an XML feed and rebuilds a safe preview only where a real DOMParser lives —
// the offscreen document. The harness has no browser, so these paths used to be exercised in the
// browser alone (see the note in scripts/test.mjs). This shim gives the harness the DOM those two
// paths actually ask for, so `rss.parseXmlFeed` and `extract.sanitizePreview` can be held here.
//
// It is not a browser. It implements what these two paths use and nothing more:
//   - XML: elements with namespaces (resolved from `xmlns`), attributes, text, CDATA, entities,
//     comments; a document that is not well-formed is answered with a `parsererror` root, the way
//     Blink answers it, because that is the one thing `parseXmlFeed` relies on.
//   - HTML: a flat tree of tags and text — good enough to prove `sanitizePreview` keeps only its
//     safe subset; no implied `<html>`/`<body>`, no auto-closing of tags, no scripting.
// The tests below only assert things this shim is faithful about. Where its answer would differ from
// a browser's, no test leans on it.

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name) => {
    if (name[0] === '#') {
      const hex = name[1] === 'x' || name[1] === 'X';
      const code = Number.parseInt(hex ? name.slice(2) : name.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[name.toLowerCase()];
    return named ?? whole;
  });
}

class Node {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
  }

  get nodeType() {
    return 0;
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get textContent() {
    let text = '';
    for (const child of this.childNodes) {
      text += child.nodeType === 3 ? child.nodeValue : child.textContent;
    }
    return text;
  }

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) return node;
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
}

class CharacterData extends Node {
  constructor(ownerDocument, nodeValue) {
    super(ownerDocument);
    this.nodeValue = nodeValue;
  }

  get nodeType() {
    return 3;
  }
}

class Element extends Node {
  constructor(ownerDocument, { localName = '', namespaceURI = null, tagName = '', attributes = new Map() } = {}) {
    super(ownerDocument);
    this.localName = localName;
    this.namespaceURI = namespaceURI;
    this.tagName = tagName || localName;
    this._attributes = attributes;
  }

  get nodeType() {
    return 1;
  }

  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this._attributes.set(name, String(value));
  }

  hasAttribute(name) {
    return this._attributes.has(name);
  }

  getAttributeNames() {
    return [...this._attributes.keys()];
  }

  getElementsByTagName(localName) {
    return this.getElementsByTagNameNS('*', localName);
  }

  // A descendant search by local name, ignoring namespaces when `ns` is '*' — what `rss.anyTag` asks.
  getElementsByTagNameNS(ns, localName) {
    const found = [];
    const walk = (parent) => {
      for (const child of parent.children) {
        if (child.localName === localName && (ns === '*' || child.namespaceURI === ns)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
  }

  get nodeType() {
    return 9;
  }

  get documentElement() {
    return this.children[0] ?? null;
  }

  get body() {
    return this.getElementsByTagNameNS('*', 'body')[0] ?? null;
  }

  getElementsByTagName(localName) {
    return this.getElementsByTagNameNS('*', localName);
  }

  getElementsByTagNameNS(ns, localName) {
    return this.documentElement ? this.documentElement.getElementsByTagNameNS(ns, localName) : [];
  }

  createElement(tagName) {
    return new Element(this, { tagName, localName: tagName });
  }

  createTextNode(value) {
    return new CharacterData(this, String(value));
  }
}

// ---- XML ----

const XML_TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[^<>]*?)?)(\/?)>/g;

// Attributes of an opening tag: name="value", name='value' or bare name.
const XML_ATTR = /([A-Za-z_][\w.:-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttributes(raw) {
  const attrs = new Map();
  if (!raw) return attrs;
  XML_ATTR.lastIndex = 0;
  let match;
  while ((match = XML_ATTR.exec(raw))) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs.set(name, value);
  }
  return attrs;
}

function xmlErrorDocument() {
  // Blink names the element it leaves behind `parsererror`; `parseXmlFeed` reads that local name.
  const doc = new Document();
  const error = new Element(doc, { tagName: 'parsererror', localName: 'parsererror' });
  doc.appendChild(error);
  return doc;
}

function parseXml(text) {
  const doc = new Document();
  const stack = [{ node: doc, scope: new Map() }];
  let rootAdded = false;
  let malformed = false;
  let index = 0;

  XML_TOKEN.lastIndex = 0;
  let match;
  while ((match = XML_TOKEN.exec(text))) {
    const token = match[0];

    // Text the tokens left between them.
    const between = text.slice(index, match.index);
    index = match.index + token.length;
    const top = stack[stack.length - 1];
    if (between) {
      if (top.node.nodeType === 9) {
        // Content outside the root: whitespace a document may hold, anything else is not well-formed.
        if (between.trim() !== '') malformed = true;
      } else {
        top.node.appendChild(new CharacterData(doc, decodeEntities(between)));
      }
    }

    if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!DOCTYPE') || token.startsWith('<![')) {
      if (token.startsWith('<![CDATA[')) {
        if (top.node.nodeType === 9) malformed = true;
        else top.node.appendChild(new CharacterData(doc, match[1]));
      }
      continue; // comments, processing instructions and a doctype carry nothing the parser reads
    }

    const closing = match[2];
    const openingName = match[3];

    if (closing !== undefined) {
      // A closing tag carries the same prefix as its opening tag, so compare the names as written;
      // the element keeps `tagName` for exactly that.
      if (stack.length < 2 || top.node.tagName !== closing) {
        malformed = true;
        break;
      }
      stack.pop();
      continue;
    }

    if (openingName === undefined) continue;

    if (top.node.nodeType === 9 && rootAdded) malformed = true; // a second root element

    const attrs = parseAttributes(match[4]);
    const scope = new Map(top.scope);
    for (const [name, value] of attrs) {
      if (name === 'xmlns') scope.set('', value);
      else if (name.startsWith('xmlns:')) scope.set(name.slice(6), value);
    }

    const colon = openingName.indexOf(':');
    const prefix = colon < 0 ? '' : openingName.slice(0, colon);
    const localName = colon < 0 ? openingName : openingName.slice(colon + 1);
    const namespaceURI = scope.has(prefix) ? scope.get(prefix) : prefix === '' ? null : null;

    const element = new Element(doc, { tagName: openingName, localName, namespaceURI, attributes: attrs });
    top.node.appendChild(element);
    if (top.node.nodeType === 9) rootAdded = true;

    const selfClosing = match[5] === '/';
    if (!selfClosing) stack.push({ node: element, scope });
  }

  if (!malformed) {
    const tail = text.slice(index);
    if (tail.trim() !== '') malformed = true; // text after the last token
    if (stack.length > 1) malformed = true; // an element left open
    if (!rootAdded) malformed = true;
  }

  if (malformed || !doc.documentElement) return xmlErrorDocument();
  return doc;
}

// ---- HTML ----

const HTML_TOKEN = /<!--[\s\S]*?-->|<\/([A-Za-z][\w-]*)\s*>|<([A-Za-z][\w-]*)((?:\s+[^<>]*?)?)\/?>/g;
const HTML_ATTR = /([A-Za-z_:@][\w.@:-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function htmlAttributes(raw) {
  const attrs = new Map();
  if (!raw) return attrs;
  HTML_ATTR.lastIndex = 0;
  let match;
  while ((match = HTML_ATTR.exec(raw))) {
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs.set(match[1], value);
  }
  return attrs;
}

function parseHtml(text) {
  // A browser answers a fragment with `html > head + body` and puts the fragment's nodes in `body`;
  // `sanitizePreview` reads `parsed.body`, so give it the same scaffold.
  const doc = new Document();
  const html = new Element(doc, { tagName: 'html', localName: 'html' });
  const head = new Element(doc, { tagName: 'head', localName: 'head' });
  const body = new Element(doc, { tagName: 'body', localName: 'body' });
  html.appendChild(head);
  html.appendChild(body);
  doc.appendChild(html);

  const stack = [body];
  let index = 0;

  HTML_TOKEN.lastIndex = 0;
  let match;
  while ((match = HTML_TOKEN.exec(text))) {
    const between = text.slice(index, match.index);
    index = match.index + match[0].length;
    const top = stack[stack.length - 1];
    if (between) top.appendChild(new CharacterData(doc, decodeEntities(between)));

    if (match[0].startsWith('<!--')) continue;

    const closing = match[1];
    const openingName = match[2];

    if (closing !== undefined) {
      const lower = closing.toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName === lower) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (openingName === undefined) continue;

    const tagName = openingName.toLowerCase();
    const element = new Element(doc, { tagName, localName: tagName, attributes: htmlAttributes(match[3]) });
    top.appendChild(element);
    if (!HTML_VOID.has(tagName)) stack.push(element);
  }

  const tail = text.slice(index);
  if (tail) stack[0].appendChild(new CharacterData(doc, decodeEntities(tail)));
  return doc;
}

class DOMParser {
  parseFromString(source, type) {
    const mime = String(type ?? '').toLowerCase();
    return mime.includes('html') ? parseHtml(source) : parseXml(source);
  }
}

/** Install `DOMParser` and `document` for the tests, and return the function that removes them. */
export function installDom() {
  const hadParser = 'DOMParser' in globalThis;
  const hadDocument = 'document' in globalThis;
  const previousParser = globalThis.DOMParser;
  const previousDocument = globalThis.document;

  const document = new Document();
  globalThis.DOMParser = DOMParser;
  globalThis.document = document;

  return function uninstallDom() {
    if (hadParser) globalThis.DOMParser = previousParser;
    else delete globalThis.DOMParser;
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  };
}
