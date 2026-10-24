// Builds `distributive/` — the folder Chrome loads: the same extension, the same paths, the same
// files, only with its comments and spare whitespace stripped. `chrome://extensions` →
// "Load unpacked" → `distributive/`.
//
//   node scripts/build.mjs
//
// Only what the extension runs on is copied: `manifest.json`, `src/`, `icons/`, `_locales/`,
// `LICENSE`. `scripts/`, `examples/` and the two READMEs stay in the repository.
//
// Chrome refuses a service worker or an extension page whose parse breaks, so these minifiers are
// deliberately conservative: they remove comments and indentation and join lines only where no
// automatic semicolon can change the meaning. Names are never renamed — a module's `export` names
// are read by the files that import them, and the reader's `data-*` hooks, `getElementById` calls,
// storage keys and i18n keys name strings the DOM and the dictionaries hold.
//
// Nothing is bundled and nothing is inlined: an extension page's CSP blocks inline `<script>`
// bodies (see `src/theme-boot.js`), so every script and sheet keeps its own file and its own path.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'distributive');

/** A file ships when it lies in one of these directories or is named here. */
const SHIP_DIRS = ['src', 'icons', '_locales'];
const SHIP_FILES = ['manifest.json', 'LICENSE'];

/** These are the kinds this build knows how to strip; anything else is copied as it is. */
const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json']);

const WORD_CHAR = /[\p{L}\p{N}_$]/u;
const SPACE = /\s/;
const NUMBER_RE =
  /(?:0[xXbBoO][0-9a-fA-F_]+n?|(?:[1-9][0-9_]*|0)(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?n?|\.[0-9]+(?:[eE][+-]?[0-9]+)?n?)/yu;

/** After this word a `/` opens a regular expression instead of dividing. */
const REGEX_CONTEXT = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
  'do', 'else', 'yield', 'await',
]);

/** These words end what the line holds: the line below may be its own statement. */
const LINE_END_WORDS = new Set(['return', 'throw', 'break', 'continue', 'yield', 'await']);

/**
 * Tokens of a JavaScript file: text, kind, and whether a line break was crossed before them.
 * A template literal is one token — its `${ … }` parts are scanned but never split — so the markup
 * or addresses it carries cannot be mistaken for code, and its text is written back untouched.
 */
function tokenizeJs(source) {
  const tokens = [];
  let i = 0;
  let lineBreak = false;

  const push = (from, kind) => {
    tokens.push({ text: source.slice(from, i), kind, lineBreak });
    lineBreak = false;
  };

  /** Any step over a line break is remembered: it may be the only thing separating statements. */
  const crossedLine = (from, to) => {
    if (source.slice(from, to).includes('\n')) lineBreak = true;
  };

  const skipSpaceAndComments = () => {
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\n') {
        lineBreak = true;
        i += 1;
      } else if (SPACE.test(ch)) {
        i += 1;
      } else if (ch === '/' && source[i + 1] === '/') {
        i += 2;
        while (i < source.length && source[i] !== '\n') i += 1;
      } else if (ch === '/' && source[i + 1] === '*') {
        const close = source.indexOf('*/', i + 2);
        const stop = close === -1 ? source.length : close + 2;
        if (source.slice(i, stop).includes('\n')) lineBreak = true;
        i = stop;
      } else {
        return;
      }
    }
  };

  /** Pass over a `'…'` or `"…"`; the caller keeps its text. */
  const skipQuoted = (quote) => {
    const opened = i;
    i += 1;
    const remember = () => crossedLine(opened, i);
    while (i < source.length) {
      if (source[i] === '\\') {
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        i += 1;
        remember();
        return;
      }
      if (source[i] === '\n') {
        throw new Error(`a string opened at index ${opened} is closed by no quote`);
      }
      i += 1;
    }
    throw new Error(`a string opened at index ${opened} is closed by no quote`);
  };

  /** Pass over a `` `…` `` with its `${ … }` parts, counting only the braces that are code. */
  const skipTemplate = () => {
    const opened = i;
    i += 1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        i += 1;
        crossedLine(opened, i);
        return;
      }
      if (ch === '$' && source[i + 1] === '{') {
        i += 1; // stand on the `{`; `skipSubstitution` passes to the `}` that closes it
        skipSubstitution();
        continue;
      }
      i += 1;
    }
    throw new Error(`a template literal opened at index ${opened} is closed by no backtick`);
  };

  /** The last character before the cursor, spaces behind it ignored. */
  const previousMeaningful = () => {
    let j = i - 1;
    while (j >= 0 && SPACE.test(source[j])) j -= 1;
    return source[j] ?? '';
  };

  /** A `/` inside a `${ … }` opens a regular expression only after something no value ends with. */
  const opensRegexInside = () => '([,=+-*%!?&|:;{~^<>'.includes(previousMeaningful());

  /** `i` stands on the `{` that opens a `${ … }`: pass to the `}` that closes it. */
  const skipSubstitution = () => {
    const opened = i;
    let depth = 1;
    i += 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
      } else if (ch === '{') {
        depth += 1;
        i += 1;
      } else if (ch === '}') {
        depth -= 1;
        i += 1;
      } else if (ch === "'" || ch === '"') {
        skipQuoted(ch);
      } else if (ch === '`') {
        skipTemplate();
      } else if (ch === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
        skipSpaceAndComments();
      } else if (ch === '/' && opensRegexInside()) {
        skipRegex();
      } else {
        i += 1;
      }
    }
    if (depth !== 0) throw new Error(`a \${ … } opened at index ${opened} is closed by no brace`);
  };

  /** Pass over `/…/flags`; a `/` that divides is not passed over here. */
  const skipRegex = () => {
    const opened = i;
    let inClass = false;
    i += 1;
    const remember = () => crossedLine(opened, i);
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '\n') {
        throw new Error(`a regular expression opened at index ${opened} is closed by no slash`);
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        i += 1;
        remember();
        break;
      }
      i += 1;
    }
    while (i < source.length && WORD_CHAR.test(source[i])) i += 1; // g i m s u v y d
  };

  const opensRegex = () => {
    const prev = tokens.at(-1);
    if (!prev) return true;
    if (prev.kind === 'word') return REGEX_CONTEXT.has(prev.text);
    if (prev.kind === 'punct') return !/[)\]}]/.test(prev.text);
    return false; // a number, a string or a finished regex is divided by a `/`, never started by one
  };

  while (i < source.length) {
    skipSpaceAndComments();
    if (i >= source.length) break;

    const ch = source[i];
    const from = i;

    if (ch === "'" || ch === '"') {
      skipQuoted(ch);
      push(from, 'string');
    } else if (ch === '`') {
      skipTemplate();
      push(from, 'template');
    } else if (ch === '/' && opensRegex()) {
      skipRegex();
      push(from, 'regex');
    } else if (/[0-9]/u.test(ch) || (ch === '.' && /[0-9]/u.test(source[i + 1] ?? ''))) {
      NUMBER_RE.lastIndex = from;
      const match = NUMBER_RE.exec(source);
      if (!match || match.index !== from) {
        throw new Error(`a number at index ${from} is unreadable`);
      }
      i = from + match[0].length;
      push(from, 'number');
    } else if (WORD_CHAR.test(ch)) {
      i += 1;
      while (i < source.length && WORD_CHAR.test(source[i])) i += 1;
      push(from, 'word');
    } else {
      i += 1;
      push(from, 'punct');
    }
  }

  return tokens;
}

/**
 * Glue these two tokens or keep a gap? A gap stays when they would fuse into one token, and when
 * the break between them is the only thing that made the second line its own statement.
 */
function needsGap(prev, next) {
  if (next.text.startsWith('<!--') || prev.text.endsWith('-->')) return true;

  const wordish = (token) => token.kind === 'word' || token.kind === 'number';
  if (wordish(prev) && wordish(next)) return true;

  if (prev.kind === 'number' && (next.text === '+' || next.text === '-')) return true;
  if (prev.text === '+' && next.text.startsWith('+')) return true;
  if (prev.text === '-' && next.text.startsWith('-')) return true;
  if (next.kind === 'number' && (prev.text === '+' || prev.text === '-')) return true;

  if (prev.kind === 'word' && LINE_END_WORDS.has(prev.text)) return true;
  // A template glued to the line above it becomes a tag, a regex becomes a division: the break
  // stays when the line above it can end an expression.
  if (next.kind === 'template' || next.kind === 'regex') {
    if (prev.kind !== 'punct' || /[)\]}]/.test(prev.text)) return true;
  }
  if (next.text === '(' || next.text === '[' || next.text === '/') return true;

  return false;
}

function minifyJs(source) {
  const tokens = tokenizeJs(source);
  const parts = [];

  tokens.forEach((token, index) => {
    if (index === 0) {
      parts.push(token.text);
      return;
    }
    if (!needsGap(tokens[index - 1], token)) {
      parts.push(token.text);
    } else {
      parts.push(token.lineBreak ? '\n' : ' ');
      parts.push(token.text);
    }
  });

  return parts.join('');
}

/**
 * Top-level `{ … }` blocks and the declarations between them, in the order the sheet has them.
 * A block ends at the `}` that closes it, because a sheet puts no `;` between the rules of an
 * `@media`, and a declaration ends at the `;` that closes it.
 */
function splitRules(text) {
  const parts = [];
  let depth = 0;
  let from = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        parts.push(text.slice(from, i + 1));
        from = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));

  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * One declaration: only the last `:` splits a property from its value, because a pseudo-class
 * writes `:` in the part before it.
 */
function minifyDeclarationText(text) {
  const lastColon = text.lastIndexOf(':');
  if (lastColon === -1) return text.replace(/\s+/g, ' ').trim();
  const property = text.slice(0, lastColon).replace(/\s+/g, '');
  const value = text.slice(lastColon + 1).replace(/\s+/g, ' ').trim();
  return `${property}:${value}`;
}

/**
 * One rule or one declaration. The part before the first `{` is the selector, everything after it
 * is the body: nested rules when the body has blocks of its own, declarations when it has none.
 * A declaration splits at its last `:` only, because a pseudo-class writes `:` in its property.
 */
function minifyRule(decl) {
  const head = decl.indexOf('{');
  if (head === -1) return minifyDeclarationText(decl);

  const tail = decl.lastIndexOf('}');
  const selector = decl.slice(0, head).replace(/\s+/g, ' ').trim();
  const body = decl.slice(head + 1, tail > head ? tail : decl.length);

  const inner = body.includes('{')
    ? minifyCss(body)
    : splitRules(body).map(minifyDeclarationText).join(';');

  return inner ? `${selector}{${inner}}` : '';
}

function minifyCss(source) {
  return splitRules(source.replace(/\/\*[\s\S]*?\*\//g, '')).map(minifyRule).join('');
}

/**
 * Text between tags is whitespace HTML collapses anyway, so it can go. Text inside these tags is
 * read as written: an SVG glyph is a list of coordinates, a `<pre>` keeps the breaks its author
 * made, and a `<script>` or `<style>` body is minified by its own rules instead.
 */
const LITERAL_TAGS = new Set(['svg', 'pre', 'textarea', 'script', 'style', 'title']);

function minifyHtml(source) {
  const out = [];
  let i = 0;

  while (i < source.length) {
    const tagStart = source.indexOf('<', i);
    if (tagStart === -1) {
      out.push(collapseText(source.slice(i)));
      break;
    }

    out.push(collapseText(source.slice(i, tagStart)));

    const isComment = source.startsWith('<!--', tagStart);
    const tagEnd = isComment ? htmlCommentEnd(source, tagStart) : source.indexOf('>', tagStart);
    if (tagEnd === -1) {
      out.push(collapseText(source.slice(tagStart)));
      break;
    }

    const tag = source.slice(tagStart, tagEnd + 1);
    out.push(tag);
    const after = tagEnd + 1;

    const name = tag.match(/^<\/?\s*([a-zA-Z][\w-]*)/)?.[1]?.toLowerCase();
    const opens = name && !tag.startsWith('</') && !tag.endsWith('/>');
    if (opens && LITERAL_TAGS.has(name)) {
      const closing = new RegExp(`</\\s*${name}\\s*>`, 'i');
      const match = closing.exec(source.slice(after));
      if (!match) throw new Error(`<${name}> at index ${tagStart} is closed by no tag`);

      const body = source.slice(after, after + match.index);
      out.push(name === 'script' || name === 'style' ? minifyInside(name, body) : body);
      out.push(match[0]);
      i = after + match.index + match[0].length;
      continue;
    }

    i = after;
  }

  return out.join('\n').replace(/\n{2,}/g, '\n').trim();
}

function minifyInside(tag, body) {
  return tag === 'script' ? minifyJs(body) : minifyCss(body);
}

function collapseText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function htmlCommentEnd(source, from) {
  const close = source.indexOf('-->', from + 4);
  return close === -1 ? -1 : close + 2;
}

function minifyJson(source, file) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  return JSON.stringify(parsed);
}

function collectFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, found);
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function relativeTo(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function minifyByKind(file, source) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.js' || ext === '.mjs') return minifyJs(source);
    if (ext === '.css') return minifyCss(source);
    if (ext === '.html') return minifyHtml(source);
    if (ext === '.json') return minifyJson(source, relativeTo(file));
    return null; // nothing to strip: the file is copied whole
  } catch (error) {
    throw new Error(`${relativeTo(file)}: ${error.message}`);
  }
}

function bytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

/** Every file the extension ships, in the order the build writes them. */
function collectSources() {
  const sources = [];
  for (const dir of SHIP_DIRS) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) collectFiles(full, sources);
  }
  for (const file of SHIP_FILES) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) sources.push(full);
  }
  return sources.sort();
}

function build() {
  const sources = collectSources();

  if (fs.existsSync(outDir)) {
    for (const stale of collectFiles(outDir)) {
      const made = relativeTo(stale).split('/').slice(1).join('/');
      if (path.basename(stale).startsWith('.') || sources.some((file) => relativeTo(file) === made)) {
        continue;
      }
      throw new Error(
        `${relativeTo(stale)} lies in ${path.basename(outDir)}/ but no source file makes it — `
        + 'clear that folder by hand and build again',
      );
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  let before = 0;
  let after = 0;
  const rows = [];
  let copied = 0;

  for (const file of sources) {
    const relative = relativeTo(file);
    const target = path.join(outDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (!TEXT_EXT.has(path.extname(relative).toLowerCase())) {
      fs.copyFileSync(file, target);
      copied += 1;
      continue;
    }

    const original = fs.readFileSync(file, 'utf8');
    const minified = minifyByKind(file, original);
    if (minified === null) {
      fs.copyFileSync(file, target);
      copied += 1;
      continue;
    }
    fs.writeFileSync(target, minified);

    const saved = bytes(original) - bytes(minified);
    before += bytes(original);
    after += bytes(minified);
    rows.push({ relative, saved, percent: saved / bytes(original) });
  }

  rows.sort((a, b) => b.saved - a.saved);
  for (const row of rows) {
    console.log(
      `${row.relative.padEnd(26)} -${String(row.saved).padStart(7)} B`
      + `  (${(row.percent * 100).toFixed(1).padStart(5)}%)`,
    );
  }

  console.log(
    `\n${rows.length} files minified: ${before} B → ${after} B`
    + ` (${((1 - after / before) * 100).toFixed(1)}% lighter)`,
  );
  console.log(`${copied} files copied as they are`);
  console.log(`chrome://extensions → “Load unpacked” → ${path.basename(outDir)}/`);
}

const runDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) build();

export { build, collectSources, minifyCss, minifyHtml, minifyJs, minifyJson };
