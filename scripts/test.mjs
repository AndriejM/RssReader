// Unit tests for the pure helpers shared by the service worker and the extension pages.
//
//   node scripts/test.mjs
//
// Only the chrome-free logic is covered (src/lib/util.js, src/lib/storage.js, src/lib/i18n.js), plus the guards that read the pages themselves. The chrome.*-dependent code is exercised in the
// browser.

import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as encoding from '../src/lib/encoding.js';
import * as i18n from '../src/lib/i18n.js';
import { SCREENS } from '../src/lib/nav.js';
import * as store from '../src/lib/storage.js';
import * as util from '../src/lib/util.js';

const {
  DEFAULT_CLEAN_TIMEOUT,
  DEFAULT_DELAY_TIMEOUT,
  MAX_ITEMS_PER_FEED,
  MAX_READ_RECORDS,
  MAX_READ_TTL_DAYS,
  MIN_READ_TTL_DAYS,
  READ_TTL_DAYS,
  alarmPeriodMinutes,
  badgeText,
  cleanTitle,
  formatSince,
  humanDuration,
  isExpired,
  isReadExpired,
  isValidHttpUrl,
  absoluteUrl,
  newId,
  normalizeFeed,
  normalizeUid,
  toDays,
  toMinutes,
} = util;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

/* ---------------------------- timeouts ---------------------------- */

test('toMinutes rounds, clamps and falls back', () => {
  assert.equal(toMinutes(5.6, 30), 6);
  assert.equal(toMinutes('45', 30), 45);
  assert.equal(toMinutes(0, 30), 1, 'never below the 1 minute floor');
  assert.equal(toMinutes(-10, 30), 1);
  assert.equal(toMinutes(1e12, 30), 60 * 24 * 365, 'clamped to the ceiling');
  assert.equal(toMinutes('abc', 30), 30);
  assert.equal(toMinutes(undefined, 30), 30);
  assert.equal(toMinutes(NaN, 30), 30);
  assert.equal(toMinutes(null, 30), 1, 'Number(null) is 0, so it clamps to the 1 minute floor');
  assert.equal(toMinutes('', 30), 1, 'an empty input field is 0, so it clamps too');
  assert.equal(toMinutes(30, 30, { min: 10, max: 20 }), 20, 'custom bounds are honoured');
});

test('toDays rounds, clamps and falls back like the read horizon it feeds', () => {
  assert.equal(toDays(30), 30);
  assert.equal(toDays('14', 30), 14);
  assert.equal(toDays(6.4, 30), 6);
  assert.equal(toDays(0, 30), MIN_READ_TTL_DAYS, 'never below the 1 day floor');
  assert.equal(toDays(-5, 30), MIN_READ_TTL_DAYS);
  assert.equal(toDays(1e9, 30), MAX_READ_TTL_DAYS, 'clamped to the ceiling');
  assert.equal(toDays('', 30), MIN_READ_TTL_DAYS, 'an empty field is 0, so it clamps too');
  assert.equal(toDays(undefined), READ_TTL_DAYS, 'missing setting keeps the default horizon');
  assert.equal(toDays('bogus', 30), 30);
});

test('alarmPeriodMinutes never asks Chrome for less than a minute', () => {
  assert.equal(alarmPeriodMinutes(0), 1);
  assert.equal(alarmPeriodMinutes(0.4), 1);
  assert.equal(alarmPeriodMinutes(1), 1);
  assert.equal(alarmPeriodMinutes(90), 90);
  assert.equal(alarmPeriodMinutes('bogus'), DEFAULT_DELAY_TIMEOUT);
});

test('humanDuration reads like a person wrote it', () => {
  assert.equal(humanDuration(45), '45 мин');
  assert.equal(humanDuration(60), '1 ч');
  assert.equal(humanDuration(90), '1.5 ч');
  assert.equal(humanDuration(1440), '1 дн');
  assert.equal(humanDuration(2880), '2 дн');
  assert.equal(humanDuration(0), '—');
  assert.equal(humanDuration(-5), '—');
  assert.equal(humanDuration('x'), '—');
});

test('formatSince counts back from now', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatSince(now, now), 'только что');
  assert.equal(formatSince(now - 40_000, now), 'только что');
  assert.equal(formatSince(now - 5 * MINUTE, now), '5 мин назад');
  assert.equal(formatSince(now - 3 * 60 * MINUTE, now), '3 ч назад');
  assert.equal(formatSince(now - 2 * DAY, now), '2 дн назад');
  assert.match(formatSince(now - 40 * DAY, now), /2023/);
});

/* ---------------------------- badge ---------------------------- */

test('badgeText: 1..99 as a number, * above 99, empty for none', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(1), '1');
  assert.equal(badgeText(9), '9');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '*');
  assert.equal(badgeText(1000), '*');
  assert.equal(badgeText(-3), '');
  assert.equal(badgeText(undefined), '');
  assert.equal(badgeText('42'), '42');
});

/* ---------------------------- expiry ---------------------------- */

test('isExpired uses the feed clean_timeout', () => {
  const now = 1_700_000_000_000;
  const feed = { clean_timeout: 60 };

  assert.equal(isExpired({ time: now - 30 * MINUTE }, feed, now), false);
  assert.equal(isExpired({ time: now - 59 * MINUTE }, feed, now), false);
  assert.equal(isExpired({ time: now - 60 * MINUTE }, feed, now), true, 'exactly at the limit is expired');
  assert.equal(isExpired({ time: now - 90 * MINUTE }, feed, now), true);
  assert.equal(isExpired({ time: now + MINUTE }, feed, now), false, 'a future item is alive');

  assert.equal(isExpired({ time: now - 60 * MINUTE }, {}, now), false, 'falls back to a day');
  assert.equal(isExpired({ time: now - 2 * DAY }, {}, now), true);
  assert.equal(isExpired({ time: now }, undefined, now), false);
  assert.equal(isExpired({}, feed, now), true, 'a headline with no load time counts as stale');
});

test('clean_timeout in minutes, not seconds or hours', () => {
  const now = 1_700_000_000_000;
  assert.equal(DEFAULT_CLEAN_TIMEOUT, 1440);
  assert.equal(isExpired({ time: now - 1439 * MINUTE }, { clean_timeout: 1440 }, now), false);
  assert.equal(isExpired({ time: now - 1440 * MINUTE }, { clean_timeout: 1440 }, now), true);
});

/* ---------------------------- urls and titles ---------------------------- */

test('isValidHttpUrl accepts only http(s)', () => {
  assert.equal(isValidHttpUrl('https://example.com/feed'), true);
  assert.equal(isValidHttpUrl('http://localhost:8080/rss'), true);
  assert.equal(isValidHttpUrl('  https://example.com  '), true);
  assert.equal(isValidHttpUrl('ftp://example.com/feed'), false);
  assert.equal(isValidHttpUrl('example.com/feed'), false);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl(''), false);
  assert.equal(isValidHttpUrl(undefined), false);
});

test('absoluteUrl resolves relative links against the feed', () => {
  assert.equal(absoluteUrl('/news/a', 'https://example.com/rss/feed.xml'), 'https://example.com/news/a');
  assert.equal(absoluteUrl('news/a', 'https://example.com/rss/feed.xml'), 'https://example.com/rss/news/a');
  assert.equal(absoluteUrl('./a', 'https://example.com/rss/feed.xml'), 'https://example.com/rss/a');
  assert.equal(absoluteUrl('https://other.site/x', 'https://example.com/rss/feed.xml'), 'https://other.site/x');
  assert.equal(absoluteUrl('   https://example.com/a   ', 'https://example.com'), 'https://example.com/a');
  assert.equal(absoluteUrl('http://', 'https://example.com'), null, 'an unparseable link yields null');
  assert.equal(absoluteUrl('/a', 'not a base'), null, 'an unparseable base yields null');
});

test('absoluteUrl of an empty link falls back to the base, so callers must check first', () => {
  // rss.js skips entries with no link before resolving, otherwise every linkless entry
  // would be stored as the feed's own URL.
  assert.equal(absoluteUrl('', 'https://example.com/rss/feed.xml'), 'https://example.com/rss/feed.xml');
});

test('cleanTitle strips markup and whitespace', () => {
  assert.equal(cleanTitle('<b>Привет</b>  <i>мир</i>'), 'Привет мир');
  assert.equal(cleanTitle('  a\n\n\tb  '), 'a b');
  assert.equal(cleanTitle('<script>evil()</script>text'), 'evil() text');
  assert.equal(cleanTitle(''), 'Без названия');
  assert.equal(cleanTitle('   '), 'Без названия');
  assert.equal(cleanTitle(null, 'фолбэк'), 'фолбэк');
  assert.equal(cleanTitle('<br/>', 'фолбэк'), 'фолбэк');
});

/* ---------------------------- feed records ---------------------------- */

test('normalizeFeed accepts a complete row', () => {
  const { feed, errors } = normalizeFeed({
    id: 'x1',
    name: ' Хабр ',
    rss_link: 'https://habr.com/ru/rss/all/',
    delay_timeout: '15',
    clean_timeout: '720',
  });

  assert.deepEqual(errors, {});
  assert.deepEqual(feed, {
    name: 'Хабр',
    rss_link: 'https://habr.com/ru/rss/all/',
    delay_timeout: 15,
    clean_timeout: 720,
  });
});

test('normalizeFeed reports every broken field at once', () => {
  const { feed, errors } = normalizeFeed({
    name: '',
    rss_link: 'habr.com/rss',
    delay_timeout: 0,
    clean_timeout: -1,
  });

  assert.equal(errors.name, 'Укажите название ленты');
  assert.equal(errors.rss_link, 'Ссылка должна начинаться с http:// или https://');
  assert.equal(errors.delay_timeout, 'Период загрузки — не меньше 1 минуты');
  assert.equal(errors.clean_timeout, 'Время хранения — не меньше 1 минуты');
  assert.equal(feed.delay_timeout, 1, 'an out-of-range number is clamped, but the errors above block the save');
  assert.equal(feed.clean_timeout, 1);
});

test('normalizeFeed guards the name length and fills defaults', () => {
  assert.ok(normalizeFeed({ name: 'a'.repeat(121), rss_link: 'https://a.b', delay_timeout: 5, clean_timeout: 5 }).errors.name);
  assert.equal(normalizeFeed({ name: 'a'.repeat(120), rss_link: 'https://a.b', delay_timeout: 5, clean_timeout: 5 }).errors.name, undefined);

  const { feed } = normalizeFeed({ name: 'n', rss_link: 'https://a.b', delay_timeout: 'x', clean_timeout: 'y' });
  assert.equal(feed.delay_timeout, DEFAULT_DELAY_TIMEOUT);
  assert.equal(feed.clean_timeout, DEFAULT_CLEAN_TIMEOUT);

  assert.deepEqual(store.emptyFeed(), {
    id: null,
    name: '',
    rss_link: '',
    delay_timeout: DEFAULT_DELAY_TIMEOUT,
    clean_timeout: DEFAULT_CLEAN_TIMEOUT,
  });
});

test('newId is unique enough to key a storage record', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newId()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.ok(id.length > 4);
});

/* ---------------------------- headline records ---------------------------- */

test('makeItem stores feed link, headline, article link and load time', () => {
  const feed = { id: 'f1', name: 'Хабр', rss_link: 'https://habr.com/ru/rss/all/' };
  const time = 1_700_000_000_000;
  const item = store.makeItem({ feed, title: 'Заголовок', link: 'https://habr.com/ru/news/1/', time });

  assert.deepEqual(item, {
    uid: 'f1|https://habr.com/ru/news/1/',
    feedId: 'f1',
    feedName: 'Хабр',
    rss_link: 'https://habr.com/ru/rss/all/',
    title: 'Заголовок',
    description: '',
    pubDate: '',
    link: 'https://habr.com/ru/news/1/',
    time,
  });
  assert.equal(store.makeItem({ feed, title: 't', link: 'u' }).time > 0, true, 'time defaults to now');
  assert.equal(normalizeUid('f1', '  https://a '), 'f1|https://a');
});

test('sortItems is newest first, title breaks ties, input is untouched', () => {
  const items = [
    { uid: 'old', title: 'old', time: 10 },
    { uid: 'b', title: 'b', time: 20 },
    { uid: 'a', title: 'a', time: 20 },
  ];
  assert.deepEqual(store.sortItems(items).map((item) => item.uid), ['a', 'b', 'old']);
  assert.deepEqual(items.map((item) => item.uid), ['old', 'b', 'a']);
  assert.deepEqual(store.sortItems([]), []);
});

test('capPerFeed keeps the newest headlines of every feed', () => {
  const items = [];
  for (let i = 0; i < MAX_ITEMS_PER_FEED + 7; i += 1) items.push({ uid: `u1-${i}`, feedId: 'f1', title: `1-${i}`, time: i });
  for (let i = 0; i < 5; i += 1) items.push({ uid: `u2-${i}`, feedId: 'f2', title: `2-${i}`, time: i });

  const kept = store.capPerFeed(items);
  const f1 = kept.filter((item) => item.feedId === 'f1');
  const f2 = kept.filter((item) => item.feedId === 'f2');

  assert.equal(f1.length, MAX_ITEMS_PER_FEED);
  assert.equal(f2.length, 5, 'a small feed is left alone');
  assert.equal(f1[0].uid, `u1-${MAX_ITEMS_PER_FEED + 6}`, 'newest kept first');
  assert.equal(f1.at(-1).uid, 'u1-7', 'the 7 oldest dropped');
  assert.equal(store.capPerFeed([]).length, 0);
});

/* ---------------------------- read list ---------------------------- */

test('makeReadRecord keeps the link, the publication date and the delete time', () => {
  const time = 1_700_000_000_000;
  const record = store.makeReadRecord(
    { link: '  https://habr.com/ru/news/1/ ', pubDate: 'Tue, 01 Oct 2024 08:00:00 GMT' },
    time,
  );
  assert.deepEqual(record, {
    link: 'https://habr.com/ru/news/1/',
    pubDate: 'Tue, 01 Oct 2024 08:00:00 GMT',
    time,
  });
  assert.equal(store.makeReadRecord({ link: '' }).link, '', 'no link, nothing to match on');
});

test('isReadExpired keeps a news out for READ_TTL_DAYS from its deletion', () => {
  const now = 1_700_000_000_000;
  const fresh = new Date(now - 6 * DAY).toUTCString();
  const old = new Date(now - 8 * DAY).toUTCString();

  assert.equal(READ_TTL_DAYS, 7);
  assert.equal(isReadExpired({ link: 'a', pubDate: fresh, time: now }, now), false);
  assert.equal(
    isReadExpired({ link: 'a', pubDate: old, time: now }, now),
    false,
    'a news published 8 days ago and deleted only now is still kept out',
  );
  assert.equal(
    isReadExpired({ link: 'a', pubDate: old, time: now - 7 * DAY }, now),
    true,
    'the marker ages from the deletion',
  );
  assert.equal(
    isReadExpired({ link: 'a', pubDate: fresh, time: now - 2 * DAY }, now, 1),
    true,
    'a custom ttl is honoured',
  );
  assert.equal(
    isReadExpired({ link: 'a', pubDate: fresh, time: now }, now, 1),
    false,
    'a freshly deleted marker survives even a 1 day ttl',
  );
});

test('a read marker with no pubDate expires by its delete time', () => {
  const now = 1_700_000_000_000;
  assert.equal(isReadExpired({ link: 'a', pubDate: '', time: now - 6 * DAY }, now), false);
  assert.equal(isReadExpired({ link: 'a', pubDate: '', time: now - 7 * DAY }, now), true);
  assert.equal(isReadExpired({ link: 'a' }, now), true, 'no dates at all: the marker is useless');
});

test('normalizeSoundChoice keeps only bundled signals or «Без звука»', () => {
  assert.equal(store.normalizeSoundChoice(store.SOUND_NONE), store.SOUND_NONE);
  assert.equal(store.normalizeSoundChoice('src/media/titan.mp3'), 'src/media/titan.mp3');
  assert.equal(
    store.normalizeSoundChoice(store.DEFAULT_SOUND_FILE),
    store.DEFAULT_SOUND_FILE,
    'the default signal stays the default',
  );
  assert.ok(store.SOUND_FILES.includes('src/media/ceres.mp3'), 'ceres is one of the bundled options');
  assert.equal(store.normalizeSoundChoice('src/media/evil.mp3'), store.DEFAULT_SOUND_FILE, 'unknown file falls back');
  assert.equal(store.normalizeSoundChoice('src/elsewhere/x.mp3'), store.DEFAULT_SOUND_FILE, 'not from src/media');
  assert.equal(store.normalizeSoundChoice(undefined), store.DEFAULT_SOUND_FILE);
  assert.equal(store.normalizeSoundChoice(null), store.DEFAULT_SOUND_FILE);
});

test('normalizeFontScales gives every reader column a size from the ladder', () => {
  assert.deepEqual(store.FONT_PANELS, ['feeds', 'headlines', 'content'], 'the columns of the reader, left to right');
  assert.ok(
    store.FONT_SCALES.includes(store.DEFAULT_FONT_SCALE),
    'the size a column has until the user picks one is one of the steps it can be picked from',
  );
  assert.deepEqual(store.normalizeFontScales(undefined), { feeds: 1, headlines: 1, content: 1 });
  assert.deepEqual(
    store.normalizeFontScales({ feeds: 1.2, headlines: 1.45, content: 0.85 }),
    { feeds: 1.2, headlines: 1.45, content: 0.85 },
    'a stored map is taken as it is',
  );
  assert.deepEqual(
    store.normalizeFontScales({ feeds: 4, headlines: 'large', content: null }),
    { feeds: 1, headlines: 1, content: 1 },
    'a size outside the ladder falls back to the default',
  );
  assert.deepEqual(
    store.normalizeFontScales({ feeds: 1.2, sidebar: 1.45 }),
    { feeds: 1.2, headlines: 1, content: 1 },
    'a column the reader does not have is not kept',
  );
});

test('capRead keeps the newest read markers', () => {
  const read = [];
  for (let i = 0; i < MAX_READ_RECORDS + 5; i += 1) read.push({ link: `l${i}`, time: i });

  const kept = store.capRead(read);
  assert.equal(kept.length, MAX_READ_RECORDS);
  assert.equal(kept[0].link, `l${MAX_READ_RECORDS + 4}`, 'newest first');
  assert.equal(kept.at(-1).link, 'l5', 'the 5 oldest dropped');
  assert.equal(store.capRead(read.slice(0, 10)).length, 10, 'a list under the cap is untouched');
});

/* ---------------------------- feed encoding ---------------------------- */

/** Bytes of the sample feed the reader actually fails on: RSS served as Windows-1251. */
const CP1251_FEED = new Uint8Array(
  fs.readFileSync(new URL('../examples/nnm_example_rss_item.xml', import.meta.url)),
);
const CYRILLIC_HEADLINE = 'Коллекция короткометражных мультфильмов (1984-2011) BDRip, HDTVRip [Platinum]';

/** Rewrite the encoding the document claims for itself, without touching the bytes. */
function reFeed(bytes, declaration) {
  const source = new TextDecoder('iso-8859-1').decode(bytes);
  const text = declaration
    ? source.replace(/<\?xml[^>]*\?>/, declaration)
    : source.replace(/<\?xml[^>]*\?>/, '<?xml version="1.0"?>');
  return new Uint8Array(Buffer.from(text, 'latin1'));
}

/** A feed in an encoding the reader does not guess, declared the way a real one declares it. */
function feedDeclaredAs(label, bytes) {
  const head = new Uint8Array(
    Buffer.from(`<?xml version="1.0" encoding="${label}"?>\n<rss><channel><title>`, 'latin1'),
  );
  const tail = new Uint8Array(Buffer.from('</title></channel></rss>', 'latin1'));
  return new Uint8Array([...head, ...bytes, ...tail]);
}

test('the encoding is read from the header, the document or the bytes', () => {
  assert.equal(encoding.charsetFromHeader('text/xml; charset=windows-1251'), 'windows-1251');
  assert.equal(encoding.charsetFromHeader('application/rss+xml;charset="UTF-8"'), 'UTF-8');
  assert.equal(encoding.charsetFromHeader('application/rss+xml'), null, 'no claim');

  assert.equal(
    encoding.charsetFromMarkup('<?xml version="1.0" encoding="windows-1251"?>'),
    'windows-1251',
  );
  assert.equal(encoding.charsetFromMarkup('<meta charset="utf-8">'), 'utf-8');
  assert.equal(
    encoding.charsetFromMarkup('<meta http-equiv="Content-Type" content="text/html; charset=cp1251">'),
    'cp1251',
  );
  assert.equal(encoding.charsetFromMarkup('<rss version="2.0">'), null, 'a document says nothing');

  assert.equal(encoding.normalizeCharset('Windows-1251'), 'windows-1251');
  assert.equal(encoding.normalizeCharset('cp1251'), 'windows-1251', 'the spelling PHP writes');
  assert.equal(encoding.normalizeCharset('KOI8'), 'koi8-r');
  assert.equal(encoding.normalizeCharset('  "utf8"  '), 'utf-8');
  assert.equal(encoding.normalizeCharset('windows-9999'), null, 'no decoder for that name');
});

test('a Windows-1251 feed is stored as readable text, not as the bytes it arrived in', () => {
  assert.equal(encoding.encodingFromBom(CP1251_FEED), null, 'the sample feed opens with `<?xml`, not with a mark');
  assert.equal(encoding.decodeStrict(CP1251_FEED, 'utf-8'), null, 'its bytes are not valid UTF-8');

  const feed = encoding.decodeResponseBytes(CP1251_FEED, 'text/xml; charset=windows-1251');

  assert.equal(feed.encoding, 'windows-1251');
  assert.equal(feed.declared, 'windows-1251');
  assert.ok(feed.text.includes(CYRILLIC_HEADLINE), 'the headline of the sample feed reads in Cyrillic');
  assert.ok(!feed.text.includes('\ufffd'), 'nothing was lost to a replacement character');

  // This is the read the reader used to do: the same bytes taken for UTF-8.
  const misread = new TextDecoder().decode(CP1251_FEED);
  assert.ok(!misread.includes(CYRILLIC_HEADLINE), 'the sample feed really is the bug it describes');
});

test('an undeclared Windows-1251 feed is recognised by what its bytes read as', () => {
  const bytes = reFeed(CP1251_FEED, null);
  const feed = encoding.decodeResponseBytes(bytes, 'text/xml');

  assert.equal(feed.declared, null, 'neither the server nor the document says anything');
  assert.equal(feed.encoding, encoding.GUESSED_ENCODING, 'the Cyrillic in the body settles it');
  assert.ok(feed.text.includes(CYRILLIC_HEADLINE), 'and the headline is still read');
});

test('a feed in another Cyrillic encoding keeps the encoding it declared', () => {
  // Cyrillic letters spelled the way KOI8-R spells them: not UTF-8, not Windows-1251.
  const koi8 = new Uint8Array([0xF0, 0xF2, 0xC9, 0xE2, 0xA5, 0xD4, 0x20, 0xEC, 0xC9, 0xF2]);
  const declared = new TextDecoder('koi8-r').decode(koi8);
  const feed = encoding.decodeResponseBytes(feedDeclaredAs('koi8-r', koi8), 'text/xml; charset=koi8-r');

  assert.ok(declared.length > 0 && !declared.includes('\ufffd'), 'the bytes are read whole by KOI8-R');
  assert.match(declared, /[Ѐ-ӿ]/, 'and what comes out is Cyrillic');
  assert.equal(feed.encoding, 'koi8-r', 'the guess is only for a feed that declares nothing');
  assert.ok(feed.text.includes(declared), 'the title is read in the encoding it names');
  assert.ok(!feed.text.includes('\ufffd'), 'nothing was lost on the way');
});

test('what a feed claims is believed only while the bytes agree with it', () => {
  // A feed that insists on UTF-8 over bytes that are Windows-1251 gets overruled.
  const lying = reFeed(CP1251_FEED, '<?xml version="1.0" encoding="utf-8"?>');
  const feed = encoding.decodeResponseBytes(lying, 'text/xml; charset=utf-8');

  assert.equal(feed.declared, 'utf-8', 'the claim it made is still reported');
  assert.equal(feed.encoding, 'windows-1251', 'the bytes win');
  assert.ok(feed.text.includes(CYRILLIC_HEADLINE), 'so the headline reads');

  // The other way round: UTF-8 bytes claiming Windows-1251 stay UTF-8.
  const utf8 = new Uint8Array(Buffer.from(feed.text, 'utf8'));
  const forCyrillic = encoding.decodeResponseBytes(utf8, 'text/xml; charset=windows-1251');

  assert.equal(forCyrillic.declared, 'windows-1251');
  assert.equal(forCyrillic.encoding, 'utf-8', 'UTF-8 that reads whole is not a single-byte feed');
  assert.ok(forCyrillic.text.includes(CYRILLIC_HEADLINE), 'read the way it was written');

  // A byte-order mark outranks a header written wrong over the same bytes.
  const marked = encoding.decodeResponseBytes(
    new Uint8Array([...Buffer.from('\ufeff', 'utf8'), ...utf8]),
    'text/xml; charset=windows-1251',
  );

  assert.equal(marked.encoding, 'utf-8', 'the mark is the encoding written into the file');
  assert.ok(!marked.text.startsWith('\ufeff'), 'the mark is not left in the text');
});

test('bytes that are neither UTF-8 nor Cyrillic are not invented as Windows-1251', () => {
  const latin1 = new Uint8Array(
    Buffer.from('Café naïve résumé — année 1881, Straße, Göteborg', 'latin1'),
  );
  const read = encoding.decodeResponseBytes(latin1, 'text/plain');

  assert.equal(read.encoding, 'utf-8', 'an accented Latin text is not guessed as Cyrillic');
  assert.ok(!read.text.includes('Ñ'), 'no Cyrillic was invented out of the accents');

  assert.equal(
    encoding.decodeResponseBytes(latin1, 'text/plain; charset=windows-1251').encoding,
    'windows-1251',
    'a charset the header really declared is honoured',
  );
});

test('a body no decoder accounts for is kept as far as UTF-8 carries it', () => {
  // `<title>` + a byte that begins a UTF-8 sequence but is followed by ASCII: no decoder claims it.
  const broken = new Uint8Array(Buffer.from('<title>\u00c3(</title>', 'latin1'));
  const read = encoding.decodeResponseBytes(broken, 'text/xml');

  assert.equal(read.encoding, 'utf-8');
  assert.ok(read.text.includes('<title>'), 'the markup survives');
  assert.ok(read.text.includes('\ufffd'), 'and the bytes that cannot be read are shown as such');
});

test('the XML declaration states the encoding the text really arrived in', () => {
  const feed = encoding.decodeResponseBytes(CP1251_FEED, 'text/xml');
  const fixed = encoding.retargetXmlDeclaration(feed.text, 'utf-8');

  assert.match(fixed, /^<\?xml version="1\.0" encoding="utf-8"\?>/, 'the declaration follows the decode');
  assert.ok(!/^<\?xml[^>]*windows-1251/.test(fixed), 'the encoding the text is no longer in is gone');

  assert.equal(
    encoding.retargetXmlDeclaration('<?xml version="1.0" encoding=" windows-1251" ?><rss/>', 'utf-8'),
    '<?xml version="1.0" encoding="utf-8" ?><rss/>',
    'only the encoding is rewritten, the rest of the document is left alone',
  );
  assert.equal(
    encoding.retargetXmlDeclaration('<rss version="2.0"><channel/></rss>', 'utf-8'),
    '<rss version="2.0"><channel/></rss>',
    'a document that declares nothing is returned as it is',
  );
});

/* ---------------------------- language ---------------------------- */

test('every language dictionary translates every key of the base one', () => {
  const base = i18n.dictionaryKeys(i18n.LANGUAGES[0]).sort();
  assert.ok(base.length > 100, 'the reader has a real dictionary, not a handful of strings');
  for (const lang of i18n.LANGUAGES) {
    assert.deepEqual(i18n.dictionaryKeys(lang).sort(), base, `${lang} covers the same keys`);
  }
});

/**
 * A failure that reaches a page carries an `errors.<code>` key, never its own text. This guard
 * keeps that rule: a code thrown in the worker or the parser must have a dictionary entry in
 * every language, otherwise the page would show text frozen in one language.
 */
test('an error thrown for a page names a key every language translates', () => {
  const files = [
    'src/background.js',
    'src/offscreen.js',
    'src/lib/rss.js',
    'src/lib/offscreen.js',
    'src/lib/extract.js',
  ];
  const codes = new Set();

  for (const file of files) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/code: '(\w+)'/g)) codes.add(match[1]);
    for (const match of source.matchAll(/codedError\('(\w+)'/g)) codes.add(match[1]);
  }

  assert.ok(codes.size > 0, 'the sources do throw coded failures');
  assert.ok(
    codes.has('feedUrl') && codes.has('offscreenUnavailable') && codes.has('articleFetch'),
    'the scan reaches every place that throws a failure a page shows',
  );
  for (const lang of i18n.LANGUAGES) {
    const keys = i18n.dictionaryKeys(lang);
    for (const code of codes) {
      assert.ok(keys.includes(`errors.${code}`), `${lang} is missing errors.${code}`);
    }
  }
});

/**
 * The screen switcher is one and the same row of icons on every screen, and a page differs from its
 * neighbours only by the screen it declares. This guard keeps a page from losing its `<nav>`, from
 * writing its own navigation buttons around it, or from pointing at an icon its sprite does not draw.
 */
test('every screen carries the same switcher and names the screen it is', () => {
  const pages = {
    'src/index.html': 'reader',
    'src/feeds.html': 'feeds',
    'src/settings.html': 'global',
  };
  const declared = [];

  for (const [file, active] of Object.entries(pages)) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

    const navs = [...source.matchAll(/<nav class="nav" data-nav-active="(\w+)"/g)];
    assert.equal(navs.length, 1, `${file} carries exactly one switcher`);
    assert.equal(navs[0][1], active, `${file} declares the switcher of ${active}`);
    declared.push(navs[0][1]);

    for (const screen of SCREENS) {
      assert.ok(
        source.includes(`<symbol id="${screen.icon}"`),
        `${file} cannot draw the ${screen.id} icon: its sprite has no ${screen.icon}`,
      );
      assert.ok(
        i18n.dictionaryKeys(i18n.LANGUAGES[0]).includes(screen.label),
        `${screen.label} has no caption, so the ${screen.id} icon would have no tooltip`,
      );
    }
  }

  assert.deepEqual(
    declared.sort(),
    SCREENS.map((screen) => screen.id).sort(),
    'the screens named by the switcher are exactly the pages that carry it',
  );
});

/**
 * What a page asks for and what a page has are kept in step by hand. A `data-i18n*` that names a key
 * no language translates shows the raw key to the user, and a `<use href="#icon-…">` that names a
 * glyph the page's own sprite does not define draws nothing. Both fail silently, so they are guarded.
 */
test('a screen names only the captions and the glyphs it really has', () => {
  for (const file of ['src/index.html', 'src/feeds.html', 'src/settings.html']) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

    for (const lang of i18n.LANGUAGES) {
      const keys = new Set(i18n.dictionaryKeys(lang));
      for (const [, key] of source.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) {
        assert.ok(keys.has(key), `${lang} has no ${key}, which ${file} asks to show`);
      }
    }

    const symbols = new Set([...source.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(symbols.size > 0, `${file} carries no icon sprite`);
    for (const [, id] of source.matchAll(/<use href="#([^"]+)"/g)) {
      assert.ok(symbols.has(id), `${file} draws ${id}, which its own sprite does not define`);
    }
  }

  /* The actions of a feed row are built in `feeds.js`, so the glyphs they use are named only in
   * that script and not in the markup the loop above reads. */
  const feedsHtml = fs.readFileSync(new URL('../src/feeds.html', import.meta.url), 'utf8');
  const feedsJs = fs.readFileSync(new URL('../src/feeds.js', import.meta.url), 'utf8');
  for (const [, icon] of feedsJs.matchAll(/actionButton\('([^']+)'[^)]*\)/g)) {
    assert.ok(
      feedsHtml.includes(`<symbol id="icon-${icon}"`),
      `a feed row offers the "${icon}" action, which the feeds sprite does not draw`,
    );
  }
});

/**
 * The size switcher of a reader column is built by `src/lib/fontsize.js`, so neither its captions nor
 * the sizes it offers appear in the markup the guard above reads. What the page declares, what the
 * script offers and what the stylesheet draws are kept in step here: a column with no step of its own
 * would be scaled by nothing, and a step with no CSS size would be drawn at the column's own size.
 */
test('every reader column has a size switcher that can be labelled and drawn', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../src/lib/fontsize.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles/reader.css', import.meta.url), 'utf8');

  const columns = [...html.matchAll(/data-font-scale="(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(columns, store.FONT_PANELS, 'one switcher per reader column, in the order of the columns');

  const captions = [...script.matchAll(/'(reader\.fontScale\.\w+)'/g)].map((match) => match[1]);
  assert.equal(
    new Set(captions).size,
    store.FONT_SCALES.length + 1,
    'one caption per offered size, plus the name of the switcher itself',
  );
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of new Set(captions)) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the size switcher asks to show`);
    }
  }

  for (const scale of store.FONT_SCALES) {
    assert.ok(
      css.includes(`.font-step[data-font-scale-step="${scale}"]`),
      `reader.css gives no size to the ${scale} step of the switcher`,
    );
  }
});

test('normalizeColumnWidths keeps every draggable column inside its own limits', () => {
  assert.deepEqual(store.RESIZABLE_PANELS, ['feeds', 'headlines'], 'the borders the mouse can drag');
  assert.deepEqual(
    store.normalizeColumnWidths(undefined),
    { ...store.DEFAULT_PANEL_WIDTHS },
    'a reader that was never resized opens at the widths of the stylesheet',
  );

  assert.deepEqual(
    store.normalizeColumnWidths({ feeds: 300, headlines: 420 }),
    { feeds: 300, headlines: 420 },
    'a stored map is taken as it is',
  );
  assert.equal(store.normalizeColumnWidths({ feeds: 10 }).feeds, store.MIN_PANEL_WIDTH, 'the minimum width is never crossed');
  assert.equal(
    store.normalizeColumnWidths({ headlines: 1e6 }).headlines,
    store.MAX_PANEL_WIDTH,
    'clamped to the ceiling',
  );
  assert.equal(
    store.normalizeColumnWidths({ feeds: 10 }).headlines,
    store.DEFAULT_PANEL_WIDTHS.headlines,
    'a column nobody resized keeps its own default',
  );

  assert.equal(store.normalizeColumnWidths({ feeds: '250' }).feeds, 250, 'a width written as text is a width');
  assert.equal(store.normalizeColumnWidths({ feeds: 240.6 }).feeds, 241, 'a column is a whole number of pixels wide');
  assert.equal(
    store.normalizeColumnWidths({ feeds: 'abc' }).feeds,
    store.DEFAULT_PANEL_WIDTHS.feeds,
    'not a width at all',
  );
  assert.equal(store.normalizeColumnWidths({ side: 500 }).side, undefined, 'no column the reader has no border for');
});

/**
 * A border of the reader is a handle `src/lib/columns.js` builds out of the gap the markup declares,
 * so neither its caption nor the width limits it refuses to cross appear in the markup the guards
 * above read. What the page declares, what the script places and draws, and what the stylesheet
 * gives the handle are kept in step here: a gap with no handle drags nothing, and a handle the grid
 * does not place in a gap sits on top of a column.
 */
test('every reader border is a handle that can be grabbed, placed and clamped', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../src/lib/columns.js', import.meta.url), 'utf8');
  const boot = fs.readFileSync(new URL('../src/columns-boot.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles/reader.css', import.meta.url), 'utf8');

  const borders = [...html.matchAll(/data-column-resize="(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(borders, store.RESIZABLE_PANELS, 'one handle per draggable border, in the order of the columns');

  for (const panel of store.RESIZABLE_PANELS) {
    assert.ok(
      html.includes(`id="panel-${panel}"`),
      `the ${panel} column has no id, so its handle has nothing to name in aria-controls`,
    );
    assert.ok(
      html.indexOf(`class="panel panel-${panel}"`) < html.indexOf(`data-column-resize="${panel}"`),
      `the handle of ${panel} stands before its column, so the grid puts them in each other's place`,
    );
    assert.ok(
      css.includes(`--col-${panel}:`) && script.includes('`--col-${panel}`'),
      `nothing paints the width of the ${panel} column`,
    );
  }

  for (const lang of i18n.LANGUAGES) {
    assert.ok(
      i18n.dictionaryKeys(lang).includes('reader.column.resize'),
      `${lang} has no reader.column.resize, which every border asks to show`,
    );
  }

  assert.match(css, /\.col-resize\s*\{[^}]*cursor: col-resize/, 'reader.css draws the handle as a border you can grab');
  assert.ok(
    !/\.col-resize\s*\{[^}]*position:\s*absolute/.test(css),
    'the handle fills its gap cell as a grid item: absolutely positioned with only `top` given it is zero wide and zero tall, and no mouse can hit it',
  );
  assert.ok(css.includes('left: -1px'), 'the strip of the handle lies on the column border the user aims at');
  assert.match(css, /--panel-min:\s*\d+px/, 'reader.css gives every column a floor in its own minmax');
  assert.equal(
    Number(css.match(/--panel-min:\s*(\d+)px/)[1]),
    store.MIN_PANEL_WIDTH,
    'the floor of the grid and the floor of the stored width are the same number',
  );

  for (const panel of store.RESIZABLE_PANELS) {
    assert.equal(
      css.match(new RegExp(`--col-${panel}: ([0-9]+)px`))?.[1],
      String(store.DEFAULT_PANEL_WIDTHS[panel]),
      `reader.css opens the ${panel} column at a width lib/storage.js does not default to`,
    );
    assert.ok(
      boot.includes(`${panel}: ${store.DEFAULT_PANEL_WIDTHS[panel]}`),
      `columns-boot.js has no default width for the ${panel} column`,
    );
  }

  assert.ok(boot.includes(`MIN_PANEL_WIDTH = ${store.MIN_PANEL_WIDTH}`), 'columns-boot.js clamps to the same minimum');
  assert.ok(boot.includes(`MAX_PANEL_WIDTH = ${store.MAX_PANEL_WIDTH}`), 'columns-boot.js clamps to the same ceiling');

  // The width is written when the button is released, and the minimum is what the drag cannot cross.
  assert.ok(script.includes("addEventListener('pointerup'"), 'releasing the border is what writes its width');
  assert.ok(script.includes('MIN_PANEL_WIDTH),'), 'the drag stops at the minimum width instead of crossing it');
  assert.ok(
    script.includes('setPointerCapture'),
    'a border released outside the reader window still ends its drag instead of following the cursor',
  );
});

/**
 * A page and the worker are edited apart as easily as a page and its sprite: a message a page sends
 * that no worker answers hangs that page's `await` forever, and a name the worker answers that no
 * exported constant spells is a typo the next page is free to make. Both are read here.
 */
test('every message a page sends is one the worker answers', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  const exported = new Set(
    [...read('src/lib/messages.js').matchAll(/export const (MSG_\w+)/g)].map((match) => match[1]),
  );
  const answered = new Set(
    ['src/background.js', 'src/offscreen.js']
      .flatMap((file) => [...read(file).matchAll(/message\?\.type === (MSG_\w+)/g)])
      .map((match) => match[1]),
  );

  for (const file of [
    'src/index.js',
    'src/feeds.js',
    'src/settings.js',
    'src/background.js',
    'src/lib/sound.js',
  ]) {
    for (const [, name] of read(file).matchAll(/type:\s*(MSG_\w+)/g)) {
      assert.ok(exported.has(name), `${file} sends ${name}, which lib/messages.js does not export`);
      assert.ok(answered.has(name), `${name} is sent by ${file}, which no worker answers`);
    }
  }
});

/**
 * The reader header reads the whole list at once, and picking a feed in the left column puts the
 * middle column on that feed's first headline. `index.js` is the only place either is wired, so the
 * markup id, the message a click carries, the silence of a manual read and the cursor itself are
 * checked against each other here.
 */
test('the header reads every feed and a picked feed opens on its first headline', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const worker = read('src/background.js');

  assert.ok(html.includes('id="btn-refresh-all"'), 'the reader header has no button that reads every feed');
  assert.ok(
    page.includes("document.getElementById('btn-refresh-all')"),
    'the page does not know the button the header declares',
  );
  assert.ok(
    page.includes('els.refreshAll.addEventListener'),
    'that button is looked up but wired to nothing',
  );
  assert.ok(
    page.includes('{ type: MSG_REFRESH_ALL_FEEDS }'),
    'a click on it sends the worker no message',
  );

  /* A read the user asked for by hand stays silent, whatever its scope: only an alarm-driven read
   * plays the sound, so the handler must not repeat what the alarm branch does. */
  const handlerStart = worker.indexOf('message?.type === MSG_REFRESH_ALL_FEEDS');
  assert.ok(handlerStart > 0, 'the worker answers no MSG_REFRESH_ALL_FEEDS');
  const handler = worker.slice(handlerStart, worker.indexOf('MSG_FEEDS_CHANGED', handlerStart));
  assert.ok(handler.length > 0 && handler.includes('notify: false'), 'a manual read of every feed is silent');
  assert.ok(!handler.includes('notify: true'), 'a manual read is not treated as an alarm');

  const select = page.slice(page.indexOf('function selectFeed'), page.indexOf('function showPlaceholder'));
  assert.ok(select.length > 0, 'selectFeed is gone, so nothing follows a click on a feed row');
  assert.ok(select.includes('itemsOfSelectedFeed()[0]'), 'a picked feed is not taken to its first headline');
  assert.ok(select.includes('openItem(first)'), 'the middle column is left with a placeholder');
});

test('t() follows the adopted language and fills placeholders', () => {
  i18n.adoptLanguage('en');
  assert.equal(i18n.t('settings.save'), 'Save');
  assert.equal(
    i18n.t('feeds.result', { added: 2, seen: 5, read: i18n.t('feeds.resultRead', { skipped: 1 }) }),
    'New: 2, parsed: 5, already read: 1',
  );
  assert.equal(i18n.t('reader.published', { since: 'just now' }), 'pub. just now');

  i18n.adoptLanguage('ru');
  assert.equal(i18n.t('settings.save'), 'Записать');
  assert.equal(i18n.t('settings.status.saved', { parts: 'звук: ceres.mp3' }), 'Записано: звук: ceres.mp3');

  assert.equal(i18n.t('no.such.key'), 'no.such.key', 'a missing key shows itself instead of nothing');
});

test('an unsupported language falls back to English', () => {
  assert.equal(i18n.FALLBACK_LANGUAGE, 'en');
  assert.equal(i18n.normalizeLanguage('it'), null);
  assert.equal(i18n.adoptLanguage('it'), 'en', 'a browser language the reader has no dictionary for');
  assert.equal(i18n.adoptLanguage(undefined), 'en');
  assert.equal(i18n.adoptLanguage('ru'), 'ru');
});

test('units follow the language, but the pure helpers keep their own default', () => {
  const en = i18n.unitLabels('en');
  assert.equal(humanDuration(45, en), '45 min');
  assert.equal(humanDuration(90, en), '1.5 h');
  assert.equal(humanDuration(1440, en), '1 d');
  assert.equal(humanDuration(0, en), '—');

  const now = 1_700_000_000_000;
  assert.equal(formatSince(now, now, en), 'just now');
  assert.equal(formatSince(now - 5 * MINUTE, now, en), '5 min ago');
  assert.equal(formatSince(now - 2 * DAY, now, en), '2 d ago');

  assert.equal(humanDuration(90), '1.5 ч', 'no labels: the base language is used');
});

/* ---------------------------- runner ---------------------------- */

let failures = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${error?.message ?? error}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} passed`);
process.exitCode = failures === 0 ? 0 : 1;
