// Turning the bytes of a feed response into text.
// Nothing here touches chrome.*: the rules of the decode are pure and testable (scripts/test.mjs),
// while `src/lib/rss.js` hands them the bytes of the response.
//
// Why this file exists: a body read with `response.text()` is read as UTF-8, so a feed served in
// Windows-1251 — still common for Russian sites — arrives as unreadable noise and is stored that
// way. The bytes are read instead, the encoding is looked for in the byte-order mark, the
// `Content-Type` header and the declaration inside the XML, and only the text that comes out of an
// encoding the bytes agree with goes on to `DOMParser` and, from there, to storage. A headline is
// kept as text, so no screen that prints it later can read the bytes wrong a second time.

const UTF8 = 'utf-8';

/**
 * The encoding assumed when the bytes are not valid UTF-8 — whether the feed declared no encoding
 * at all or insisted on one its bytes do not match. Windows-1251 is the encoding this reader
 * actually meets in that situation; other alphabets are not guessed, because a wrong single-byte
 * guess invents a text that reads fine and says something else.
 */
export const GUESSED_ENCODING = 'windows-1251';

/** Byte-order marks, longest first so one is not read as the prefix of another. */
const BOMS = [
  { label: 'utf-8', bytes: [0xef, 0xbb, 0xbf] },
  { label: 'utf-16be', bytes: [0xfe, 0xff] },
  { label: 'utf-16le', bytes: [0xff, 0xfe] },
];

/**
 * Spellings seen in feed responses, mapped to the labels `TextDecoder` accepts. Every result is
 * tried against the runtime too, so a name this browser has no decoder for is dropped instead of
 * thrown.
 */
const CHARSET_ALIASES = [
  ['utf8', 'utf-8'],
  ['unicode', 'utf-8'],
  ['utf16', 'utf-16'],
  ['utf16le', 'utf-16le'],
  ['utf16be', 'utf-16be'],
  ['1251', 'windows-1251'],
  ['w1251', 'windows-1251'],
  ['win1251', 'windows-1251'],
  ['windows1251', 'windows-1251'],
  ['ansi1251', 'windows-1251'],
  ['cp1251', 'windows-1251'],
  ['cp1251w', 'windows-1251'],
  ['1252', 'windows-1252'],
  ['cp1252', 'windows-1252'],
  ['ansi', 'windows-1252'],
  ['windows1252', 'windows-1252'],
  ['koi8', 'koi8-r'],
  ['koi8r', 'koi8-r'],
  ['koi8u', 'koi8-u'],
  ['cp866', 'ibm866'],
  ['866', 'ibm866'],
  ['latin1', 'iso-8859-1'],
  ['latin9', 'iso-8859-15'],
  ['iso88591', 'iso-8859-1'],
  ['iso88592', 'iso-8859-2'],
  ['iso88595', 'iso-8859-5'],
  ['iso885915', 'iso-8859-15'],
  ['usascii', 'iso-8859-1'],
];

/** `charset=windows-1251` in the shape a header or a meta tag actually writes it. */
const CHARSET_TOKEN = /\bcharset\s*=\s*["']?\s*([\w][\w.+-]*)/i;
/** Only the declaration at the very start of the document describes its bytes. */
const XML_DECLARATION = /^\s*<\?xml\b[^>]*?\bencoding\s*=\s*["']\s*([\w][\w.+-]*)/i;
const META_HTTP_CHARSET = /<meta[^>]*?http-equiv\s*=\s*["']?content-type["']?[^>]*?\bcharset\s*=\s*([\w][\w.+-]*)/i;
const META_CHARSET = /<meta[^>]*?\bcharset\s*=\s*["']?\s*([\w][\w.+-]*)/i;

/** The Cyrillic letters Russian text is written with. Windows-1251 maps them at 0xC0–0xDF, 0xE0–0xFF. */
const RUSSIAN = /[А-Яа-я]/g;
/** Any Cyrillic letter, Russian or not: `[Ѐ–ӿ]` is the whole Cyrillic block. */
const CYRILLIC = /[Ѐ-ӿ]/g;
/** Two Russian letters side by side: only text written in Russian produces them. */
const RUSSIAN_PAIR = /[А-Яа-я][А-Яа-я]/;
/**
 * Letters Windows-1251 can produce but Russian text does not write: the rest of the Cyrillic
 * alphabet (Serbian, Ukrainian, Church Slavonic), accented Latin, and the box drawing of Code Page
 * 866. Four of them in a row is a text written in one of those encodings, not a Russian feed.
 */
const FOREIGN_TELLS = /[À-ÿˠ-˯̄̌ЂѓЉљЊњЋќЏџЈјЅѕЇїІіҐґĐđŽžЎў░-▓╕╣║╗╝├┤┬┴┼]{4,}/;

/** `charset=windows-1251` out of a `Content-Type` header. */
export function charsetFromHeader(contentType) {
  return CHARSET_TOKEN.exec(String(contentType ?? ''))?.[1] ?? null;
}

/**
 * The encoding the document declares for itself: the `encoding=` of an XML declaration, the
 * `<meta charset>` of an HTML page. Only the beginning of the body is read — a charset written
 * deep inside cannot describe the bytes that opened the document.
 */
export function charsetFromMarkup(sample) {
  const text = String(sample ?? '').replace(/^\uFEFF/, '');
  return (
    XML_DECLARATION.exec(text)?.[1] ??
    META_HTTP_CHARSET.exec(text)?.[1] ??
    META_CHARSET.exec(text)?.[1] ??
    null
  );
}

/**
 * A name coming from a header or a declaration, mapped to a label `TextDecoder` accepts.
 * @returns {string|null} null when no decoder here knows that name
 */
export function normalizeCharset(name) {
  const raw = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    // Some headers write the label as a MIME encoded-word: `=?windows-1251?=`.
    .replace(/^=+|=+$/g, '');
  if (!raw) return null;

  const key = raw.replace(/[\s_-]+/g, '');
  const label = CHARSET_ALIASES.find(([alias]) => alias === key)?.[1] ?? raw;

  try {
    // A name is only a candidate until the runtime proves it can decode with it.
    new TextDecoder(label);
    return label;
  } catch {
    return null;
  }
}

/** @returns {string|null} the encoding a byte-order mark announces */
export function encodingFromBom(bytes) {
  const bom = BOMS.find(({ bytes: mark }) => mark.every((byte, index) => bytes[index] === byte));
  return bom?.label ?? null;
}

/**
 * Decode bytes strictly: either they really are in `label` or nothing comes back. A candidate that
 * cannot read the body is dropped instead of half-reading it, which is what keeps a wrong encoding
 * from being mistaken for a feed that loaded.
 * @returns {string|null}
 */
export function decodeStrict(bytes, label) {
  try {
    // `ignoreBOM`: the mark belongs to the choice of encoding, not to the text itself.
    return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Look at the beginning of the body without committing to an encoding: the markup there is ASCII. */
function headAsLatin1(bytes, limit = 8192) {
  return new TextDecoder('iso-8859-1').decode(bytes.subarray(0, Math.min(bytes.length, limit)));
}

const countRussian = (text) => text.match(RUSSIAN)?.length ?? 0;
const countCyrillic = (text) => text.match(CYRILLIC)?.length ?? 0;

/**
 * Did the text a claim produced actually come from the encoding it claims?
 *
 * UTF-8 is the encoding that cannot be fooled: bytes that pass through it whole and bring Cyrillic
 * with them are Cyrillic text. A single-byte encoding refuses no bytes at all, so its claim is only
 * as good as the text it yields — UTF-8 Russian read as Windows-1251 comes back with a third of its
 * letters from the corners of the alphabet (`ЂѓљҐґї`), and KOI8-U, ISO-8859-5, Code Page 866 or
 * Latin-1 come back with little else than those.
 */
function claimHeld(text, { utf8Cyrillic }) {
  // The misread of UTF-8 always keeps some Russian letters, so Cyrillic by itself proves nothing:
  // what has to hold is that the letters belong to the alphabet the feed claims.
  if (utf8Cyrillic) return countCyrillic(text) * 10 <= countRussian(text) * 11;
  // Foreign letters are only a doubt where the text claims to be Cyrillic: a Latin-1 feed that reads
  // in its own Latin-1 is exactly what it says it is.
  if (FOREIGN_TELLS.test(text) && countRussian(text) > 0) return false;
  return true;
}

/**
 * Do bytes nobody declared belong to a feed written in Windows-1251? Russian letters are the proof;
 * Cyrillic letters outside Russian (KOI8-U, ISO-8859-5, Code Page 866) or four letters of another
 * alphabet in a row (Latin-1 with its accents) say it is somebody else's text.
 *
 * `minLetters` and `minCyrillic` weigh how much of the body the encoding has to account for: a feed
 * buries its text in markup, tags and links, so a short one must be nearly all letters before the
 * guess means anything, and a long one is believed on its Cyrillic alone.
 */
function looksLikeWindows1251(text, { minLetters, minCyrillic }) {
  const russian = countRussian(text);
  if (russian < minLetters) return false;
  if (FOREIGN_TELLS.test(text)) return false;
  if (countCyrillic(text) > russian * 1.1) return false;
  if (countCyrillic(text) >= minCyrillic) return true;
  return RUSSIAN_PAIR.test(text);
}

/**
 * Read the bytes of a feed response and say which encoding they turned out to be in.
 *
 * The order follows how sure the evidence is: a byte-order mark is the encoding written into the
 * file, the `Content-Type` charset is what the server says, the declaration in the XML is what the
 * document says, and bytes that are valid UTF-8 settle the question by themselves. A claim the
 * bytes answer against — a header insisting on UTF-8 over a body served in Windows-1251 — is
 * dropped, and the next claim gets its turn.
 *
 * The text that comes back is decoded: it travels as a string from here on, so the headline that
 * reaches `chrome.storage.local` carries no encoding for anything that reads it later to get wrong.
 *
 * @param {Uint8Array} bytes raw response body
 * @param {string} [contentType] the response `Content-Type` header
 * @returns {{ text: string, encoding: string, declared: string|null }} `declared` is what the
 *   response claimed (`null` when it claimed nothing) so a feed whose claim did not hold can be seen
 * @throws {TypeError} `bytes` is not binary data
 */
export function decodeResponseBytes(bytes, contentType = '') {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('a feed body must be read as bytes');

  const bom = encodingFromBom(bytes);
  const mark = BOMS.find(({ label }) => label === bom)?.bytes.length ?? 0;
  const body = bom ? bytes.subarray(mark) : bytes;

  const inHeader = normalizeCharset(charsetFromHeader(contentType));
  const inMarkup = normalizeCharset(charsetFromMarkup(headAsLatin1(body)));
  const declared = inHeader ?? inMarkup;

  const claims = [bom, inHeader, inMarkup].filter(Boolean);

  // A body served in Windows-1251 gives itself away here: pushed through UTF-8 it breaks into
  // replacement characters and no Cyrillic survives. Bytes that do bring Cyrillic through are UTF-8.
  const utf8Cyrillic = countCyrillic(new TextDecoder(UTF8).decode(body)) > 0;

  // The claims go in the order of how sure they are: the mark in the file, then what the server
  // says, then what the document says.
  for (const label of claims) {
    const text = decodeStrict(body, label);
    if (text === null) continue;
    // UTF-8 proves itself by being valid; a single-byte claim refuses no bytes, so it is believed
    // only while the text it produces reads in the alphabet it names.
    if (label === UTF8 || claimHeld(text, { utf8Cyrillic })) {
      return { text, encoding: label, declared };
    }
  }

  // The claims did not hold. UTF-8 gets its turn even when nobody claimed it — the everyday feed
  // that is UTF-8 and never says so — and then the one guess this reader needs.
  if (!claims.includes(UTF8)) {
    const text = decodeStrict(body, UTF8);
    if (text !== null) return { text, encoding: UTF8, declared };
  }

  const guessed = decodeStrict(body, GUESSED_ENCODING);
  if (guessed !== null) {
    const weight = Math.min(body.length, 10_000);
    const limits = {
      minLetters: Math.max(24, Math.min(256, Math.round(weight / 40))),
      minCyrillic: Math.max(8, Math.min(128, Math.round(weight / 160))),
    };
    if (looksLikeWindows1251(guessed, limits)) {
      return { text: guessed, encoding: GUESSED_ENCODING, declared };
    }
  }

  // Bytes no decoder accounts for: keep the headlines as far as UTF-8 carries them rather than fail
  // the feed over an encoding nobody can name.
  return { text: new TextDecoder(UTF8).decode(body), encoding: UTF8, declared };
}

/**
 * Text handed to `DOMParser` as a string is already decoded, yet an XML processor that honours the
 * declaration inside the string would decode text that is not bytes any more. Keep the declaration
 * — it belongs to the document — but let it name the encoding the text really arrived in.
 */
export function retargetXmlDeclaration(xml, encoding) {
  return String(xml).replace(
    /^(\s*<\?xml\b[^>]*?\bencoding\s*=\s*)(["'])[^"']*\2/,
    (_match, head, quote) => `${head}${quote}${encoding}${quote}`,
  );
}
