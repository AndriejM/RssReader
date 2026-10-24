// Unit tests for the pure helpers shared by the service worker and the extension pages.
//
//   node scripts/test.mjs
//
// The chrome-free logic is covered directly (src/lib/util.js, src/lib/storage.js, src/lib/i18n.js, the
// decoding rules of src/lib/encoding.js, the JSON Feed parsing of src/lib/rss.js). The worker and the
// offscreen document are run under one fake `chrome` (see "the worker and the document, running"), so
// their lifecycle — an alarm, a message from a page, a popup a user clicks — is tested by what the
// reader ends up storing and showing rather than by reading their source. An extension page cannot
// run in Node either, so where a test has to look in one it looks at the contract between its pieces
// — a markup id and the name the page maps it to, a message constant, a function found by what it
// does — and not at the local names themselves. Markup, CSS and the dictionaries are still kept in
// step by reading the files. Parsing an XML feed and rebuilding a safe preview need a DOMParser, so
// they run under the small dependency-free DOM in scripts/fake-dom.mjs — enough to hold what these
// two paths actually ask of a node, not a browser.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectSources, minifyCss, minifyHtml, minifyJs } from './build.mjs';
import { installDom } from './fake-dom.mjs';
import * as alarmsLib from '../src/lib/alarms.js';
import * as encoding from '../src/lib/encoding.js';
import * as extract from '../src/lib/extract.js';
import * as favicon from '../src/lib/favicon.js';
import * as i18n from '../src/lib/i18n.js';
import { readerKeys } from '../src/lib/keys.js';
import { SCREENS } from '../src/lib/nav.js';
import * as notify from '../src/lib/notify.js';
import { IDLE_CLOSE_MS } from '../src/lib/offscreen.js';
import { MSG_COUNT, MSG_FEEDS_CHANGED, MSG_FETCH_FEED, MSG_PLAY_SOUND, MSG_REFRESH_ALL_FEEDS, MSG_REFRESH_FEED } from '../src/lib/messages.js';
import * as offscreenLib from '../src/lib/offscreen.js';
import * as rss from '../src/lib/rss.js';
import * as store from '../src/lib/storage.js';
import { READER_PAGE } from '../src/lib/tabs.js';
import * as util from '../src/lib/util.js';

const {
  ARTICLE_FETCH_TIMEOUT_MS,
  DEFAULT_CLEAN_TIMEOUT,
  DEFAULT_DELAY_TIMEOUT,
  DEFAULT_SOUND_VOLUME,
  FEED_FETCH_TIMEOUT_MS,
  MAX_FEED_BACKOFF_MINUTES,
  MAX_ITEMS_PER_FEED,
  MAX_ITEMS_TOTAL,
  MAX_PREVIEW_CHARS,
  MAX_PUBDATE_SKEW_MS,
  MAX_READ_RECORDS,
  MAX_READ_TTL_DAYS,
  MAX_SOURCE_ID_CHARS,
  MAX_SOUND_VOLUME,
  MIN_READ_TTL_DAYS,
  MIN_SOUND_VOLUME,
  NOTIFY_MAX_ACTIVE,
  PREVIEW_IMAGE_HEIGHT,
  PREVIEW_IMAGE_WIDTH,
  READ_TTL_DAYS,
  SOURCE_ID_CUT,
  alarmPeriodMinutes,
  badgeText,
  capPreview,
  cleanTitle,
  dropUnpreviewableImages,
  feedBackoffMinutes,
  feedNextCheckAt,
  feedPauseRemaining,
  fingerprint,
  formatSince,
  humanDuration,
  honoredReadDays,
  isExpired,
  isReadExpired,
  isValidHttpUrl,
  absoluteUrl,
  itemTime,
  linkKey,
  newId,
  normalizeFeed,
  normalizePreviewImages,
  normalizePubDate,
  normalizeUid,
  pubDateTime,
  shortenSourceId,
  toDays,
  toFlag,
  toMinutes,
  toVolume,
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

test('toVolume rounds, clamps and falls back like the signal volume it feeds', () => {
  assert.equal(toVolume(70), 70);
  assert.equal(toVolume('45', 30), 45);
  assert.equal(toVolume(62.6, 30), 63);
  assert.equal(toVolume(-5, 30), MIN_SOUND_VOLUME, 'silent is allowed, below it is not');
  assert.equal(toVolume(140, 30), MAX_SOUND_VOLUME, 'clamped to the ceiling');
  assert.equal(toVolume('', 30), MIN_SOUND_VOLUME, 'an empty field is 0, so it clamps there');
  assert.equal(
    toVolume(undefined),
    DEFAULT_SOUND_VOLUME,
    'a build with no volume setting keeps the old full-volume sound',
  );
  assert.equal(toVolume('bogus', 30), 30);
});

test('toFlag keeps only real booleans, so an absent setting never turns a flag on', () => {
  assert.equal(toFlag(true), true);
  assert.equal(toFlag(false), false, 'a stored false beats any fallback');
  assert.equal(toFlag(undefined, true), true, 'an absent key takes the fallback');
  assert.equal(toFlag(undefined), false, 'no key and no fallback: the silent default');
  assert.equal(toFlag('true'), false, 'a string is not a boolean');
  assert.equal(toFlag(1, true), true, 'a number is not a boolean either, so it falls back');
});

test('alarmPeriodMinutes never asks Chrome for less than a minute', () => {
  assert.equal(alarmPeriodMinutes(0), 1);
  assert.equal(alarmPeriodMinutes(0.4), 1);
  assert.equal(alarmPeriodMinutes(1), 1);
  assert.equal(alarmPeriodMinutes(90), 90);
  assert.equal(alarmPeriodMinutes('bogus'), DEFAULT_DELAY_TIMEOUT);
});

test('feedBackoffMinutes doubles the period of a feed that keeps failing', () => {
  assert.equal(feedBackoffMinutes(1, 30), 30, 'one failure only makes the feed miss its next check');
  assert.equal(feedBackoffMinutes(2, 30), 60);
  assert.equal(feedBackoffMinutes(3, 30), 120);
  assert.equal(feedBackoffMinutes(5, 30), 480, 'a feed that keeps failing is asked every 8 hours');
  assert.equal(
    feedBackoffMinutes(50, 30),
    MAX_FEED_BACKOFF_MINUTES,
    'the pause stops growing at a day: a feed is never dropped for good',
  );

  assert.equal(feedBackoffMinutes(0, 30), 30, 'a feed nobody failed to read waits exactly its period');
  assert.equal(feedBackoffMinutes('bogus', 30), 30, 'a streak that is not a number is one failure');
  assert.equal(feedBackoffMinutes(2, 0), 2, 'the pause is never finer than the shortest period Chrome allows');
  assert.equal(feedBackoffMinutes(2, 'bogus'), DEFAULT_DELAY_TIMEOUT * 2);
});

test('feedPauseRemaining names the wait left, and none at all for a feed that never failed', () => {
  const now = 10 * MINUTE;
  assert.equal(feedPauseRemaining({ nextRetryAt: now + 5 * MINUTE }, now), 5 * MINUTE);
  assert.equal(feedPauseRemaining({ nextRetryAt: now }, now), 0, 'a pause that ran out asks again');
  assert.equal(feedPauseRemaining({ nextRetryAt: now - MINUTE }, now), 0);
  assert.equal(feedPauseRemaining({}, now), 0, 'a healthy feed waits for nothing');
  assert.equal(feedPauseRemaining({ nextRetryAt: 'bogus' }, now), 0);
  assert.equal(feedPauseRemaining(undefined, now), 0);
});

/**
 * The reader answers "when is this feed asked next" from one number, while storage keeps two: the
 * alarm of the feed and the pause a failing feed sits out. The answer is the later of them, because
 * a pause skips an attempt without moving the alarm (see `background.js`).
 */
test('feedNextCheckAt takes the later of the alarm and the pause made on top of it', () => {
  const now = 10 * MINUTE;
  assert.equal(feedNextCheckAt({ nextAlarmAt: now + 20 * MINUTE }, now), now + 20 * MINUTE);
  assert.equal(
    feedNextCheckAt({ nextAlarmAt: now + 20 * MINUTE, nextRetryAt: now + 40 * MINUTE }, now),
    now + 40 * MINUTE,
    'a pause that outlives the alarm is when the feed is really read again',
  );
  assert.equal(
    feedNextCheckAt({ nextAlarmAt: now + 20 * MINUTE, nextRetryAt: now + 5 * MINUTE }, now),
    now + 20 * MINUTE,
    'a pause that runs out before the alarm leaves the alarm itself in charge',
  );
  assert.equal(
    feedNextCheckAt({ nextAlarmAt: now - MINUTE }, now),
    now - MINUTE,
    'an alarm that already went off — or was delayed by a sleeping device — is due now',
  );
  assert.equal(feedNextCheckAt({}, now), 0, 'a feed nobody has read has no schedule to name');
  assert.equal(feedNextCheckAt({ nextAlarmAt: 'bogus', nextRetryAt: 'bogus' }, now), 0);
  assert.equal(feedNextCheckAt(undefined, now), 0);
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

test('linkKey reads the same page however the feed spelled its link', () => {
  const one = 'https://example.com/ru/news/1';

  assert.equal(linkKey('http://example.com/ru/news/1'), one, 'http and https are the same page');
  assert.equal(linkKey('https://www.example.com/ru/news/1'), one, 'www is the same site');
  assert.equal(linkKey('https://example.com/ru/news/1/'), one, 'the trailing slash of an article');
  assert.equal(linkKey('https://example.com:443/ru/news/1'), one, 'the port the protocol implies');
  assert.equal(
    linkKey('https://example.com/ru/news/1/?utm_source=telegram&utm_campaign=share&gclid=x&ref=rss'),
    one,
    'a tail of tracking parameters says nothing about which page is meant',
  );
  assert.equal(linkKey('https://example.com/ru/news/1#part-2'), one, 'a fragment is not another news');
  assert.equal(
    linkKey('http://user:pass@example.com/ru/news/1'),
    one,
    'credentials of one reader are not part of the page',
  );

  // What a link really says is kept: only the parts a feed varies between its own polls go.
  assert.equal(linkKey('https://example.com/ru/news/1?page=2'), 'https://example.com/ru/news/1?page=2');
  assert.equal(linkKey('https://example.com/a?q=utm_test'), 'https://example.com/a?q=utm_test');
  assert.equal(linkKey('https://example.com/a?utm_test=1'), 'https://example.com/a', 'a parameter named utm_* is a tracking parameter');
  assert.equal(linkKey('https://example.com/a?utmip=1'), 'https://example.com/a?utmip=1', 'a parameter that only looks like one is kept');
  assert.equal(
    linkKey('http://example.com:8080/ru/news/1'),
    'https://example.com:8080/ru/news/1',
    'a real port is a different site, only the implied one is dropped',
  );
  assert.equal(
    linkKey('https://www.example.com/'),
    'https://example.com/',
    'the whole path of a site root is not a trailing slash',
  );
  assert.equal(linkKey('https://web.example.com/a'), 'https://web.example.com/a', 'only the www prefix');
  assert.equal(linkKey('  https://a.b/x  '), 'https://a.b/x');

  assert.equal(linkKey('mailto:a@b.c'), 'mailto:a@b.c', 'not a web link: compared as text');
  assert.equal(linkKey('not a link at all'), 'not a link at all', 'a comparison degrades, a headline does not vanish');
  assert.equal(linkKey(''), '');
  assert.equal(linkKey(undefined), '');
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
    uid: 'f1|https://habr.com/ru/news/1',
    feedId: 'f1',
    feedName: 'Хабр',
    rss_link: 'https://habr.com/ru/rss/all/',
    title: 'Заголовок',
    description: '',
    pubDate: '',
    // The address the reader opens stays exactly as the feed wrote it; the trailing slash is gone
    // only from the `uid`, which exists to recognise the same headline on the next poll.
    link: 'https://habr.com/ru/news/1/',
    sourceId: 'https://habr.com/ru/news/1',
    sourceIdType: 'link',
    time,
  });
  assert.equal(store.makeItem({ feed, title: 't', link: 'u' }).time > 0, true, 'time defaults to now');
  assert.equal(normalizeUid('f1', '  https://a '), 'f1|https://a');
});

test('a stored pubDate is one UTC instant, not the date the feed spelled', () => {
  const feed = { id: 'f1', name: 'Хабр', rss_link: 'https://habr.com/ru/rss/all/' };
  const time = Date.parse('2024-11-14T22:13:20Z');

  const spelled = store.makeItem({ feed, title: 'a', link: 'u1', pubDate: 'Thu, 14 Nov 2024 22:13:20 GMT', time });
  assert.equal(spelled.pubDate, '2024-11-14T22:13:20.000Z', 'the RFC 822 date of an RSS feed becomes the ISO form');

  const offset = store.makeItem({ feed, title: 'b', link: 'u2', pubDate: '2024-11-14T15:00:00-05:00', time });
  assert.equal(offset.pubDate, '2024-11-14T20:00:00.000Z', 'the offset the feed states is honoured, not the zone of the reader');

  const reloaded = store.makeItem({ feed, title: 'c', link: 'u3', pubDate: '2024-11-14 22:13:20', time });
  assert.ok(reloaded.pubDate.endsWith('Z'), 'a date that stated no zone is stored as one the record itself states');
  assert.equal(
    pubDateTime(reloaded.pubDate, time + 100 * DAY),
    Date.parse(reloaded.pubDate),
    'and it reads back as that same instant whenever anyone asks, in whichever zone they ask from',
  );

  assert.equal(store.makeItem({ feed, title: 'd', link: 'u4', pubDate: 'вчера после обеда', time }).pubDate, '', 'a date no clock can read is no date at all');
  assert.equal(itemTime(spelled, time), time, 'so its age counts from the publication the feed stated');
});

test('a publication date of the future is believed only as far as the clock of the poll', () => {
  const feed = { id: 'f1', name: 'Хабр', rss_link: 'https://habr.com/ru/rss/all/' };
  const now = 1_700_000_000_000;

  assert.equal(MAX_PUBDATE_SKEW_MS, 15 * MINUTE);
  const ahead = new Date(now + 5 * MINUTE).toISOString();
  assert.equal(pubDateTime(ahead, now), now + 5 * MINUTE, 'a server a few minutes ahead of our clock is not a lie');

  const far = store.makeItem({ feed, title: 'a', link: 'u1', pubDate: new Date(now + 30 * DAY).toISOString(), time: now });
  assert.equal(far.pubDate, new Date(now + MAX_PUBDATE_SKEW_MS).toISOString(), 'a news of next month is dated by the poll that shipped it');

  assert.equal(isExpired(far, { clean_timeout: 60 }, now), false, 'it is not stale on the poll that read it');
  assert.equal(
    isExpired(far, { clean_timeout: 60 }, now + MAX_PUBDATE_SKEW_MS + 61 * MINUTE),
    true,
    'and it does age out: an unclamped date of the future is a headline `clean_timeout` never reaches',
  );
});

test('a headline stored with the raw date an older build kept is read the same clamped way', () => {
  const now = 1_700_000_000_000;
  const legacy = { pubDate: 'Thu, 01 Jan 2038 00:00:00 GMT', time: now - DAY };

  assert.equal(
    itemTime(legacy, now),
    legacy.time + MAX_PUBDATE_SKEW_MS,
    'the stored text is not believed ahead of the poll that stored it, which — unlike the clock — does not move',
  );
  assert.ok(isExpired(legacy, { clean_timeout: 60 }, now), 'its age is a day old, so its shelf expires it at once');
  assert.equal(isReadExpired({ link: 'a', pubDate: legacy.pubDate, time: now - DAY }, now), false, 'a read marker of the future still holds its news out');
});

test('normalizePubDate clamps to the moment the feed was read', () => {
  const at = Date.parse('2024-11-14T22:13:20Z');
  assert.equal(normalizePubDate('Thu, 14 Nov 2024 22:13:20 GMT', at), '2024-11-14T22:13:20.000Z');
  assert.equal(normalizePubDate(new Date(at + DAY).toISOString(), at), new Date(at + MAX_PUBDATE_SKEW_MS).toISOString());
  assert.equal(normalizePubDate('', at), '');
  assert.equal(normalizePubDate(undefined, at), '');
  assert.equal(normalizePubDate('  ', at), '');
  assert.equal(normalizePubDate('not a date', at), '', 'a date no clock can read keeps the record without one');
});

test('makeItem keys a headline by what the feed calls it, not by its address', () => {
  const feed = { id: 'f1', name: 'Lenta', rss_link: 'https://lenta.ru/rss' };
  const opaque = 'urn:uuid:6f2c1c0a-1';

  const byGuid = store.makeItem({
    feed,
    title: 't',
    link: 'https://lenta.ru/articles/2024/10/01/x/',
    sourceId: opaque,
    sourceIdType: 'guid',
  });
  assert.equal(byGuid.sourceId, opaque, 'an opaque guid is kept as the feed wrote it');
  assert.equal(byGuid.sourceIdType, 'guid');
  assert.equal(byGuid.link, 'https://lenta.ru/articles/2024/10/01/x/', 'the link to open is untouched');
  assert.equal(byGuid.uid, `f1|${opaque}`, 'a moved address does not make a second headline');

  /* The link is normalized into the id only when there is no id: an opaque `guid` is not a URL, and
   * reading it as one would cut `12345:ru` to `12345`. */
  assert.equal(
    store.makeItem({ feed, title: 't', link: 'https://a.b/x/?utm_source=rss', sourceId: '12345:ru', sourceIdType: 'guid' }).sourceId,
    '12345:ru',
  );

  const id = store.makeItem({ feed, title: 't', link: 'http://a.b/x', sourceId: ' tag-42 ', sourceIdType: 'atom:id' });
  assert.deepEqual(
    { sourceId: id.sourceId, sourceIdType: id.sourceIdType },
    { sourceId: 'tag-42', sourceIdType: 'atom:id' },
    'the kind the feed gave is the kind that is stored',
  );
});

/* ------------------------- preview pictures ------------------------- */

test('normalizePreviewImages puts every feed picture in the same box', () => {
  assert.equal(
    normalizePreviewImages('<p><img src="https://lostpix.com/img/a.jpg" /></p>'),
    '<p><img src="https://lostpix.com/img/a.jpg" width="180" height="240" /></p>',
  );
  // A tag the feed already sized, with its own inline style: both are replaced.
  assert.equal(
    normalizePreviewImages('<img width="256" src="https://a/i.php?link=%2Fx.jpg" style="margin:8px;">'),
    '<img src="https://a/i.php?link=%2Fx.jpg" width="180" height="240">',
  );
  assert.equal(
    normalizePreviewImages('<IMG SRC="https://a/b.jpg"><img src="https://a/c.jpg">'),
    '<IMG SRC="https://a/b.jpg" width="180" height="240"><img src="https://a/c.jpg" width="180" height="240">',
  );
  assert.equal(normalizePreviewImages('plain text, no markup'), 'plain text, no markup');
  assert.equal(normalizePreviewImages(''), '');
});

test('normalizePreviewImages keeps the rest of the description untouched', () => {
  assert.equal(
    normalizePreviewImages('<a href="https://a/1"><img src="https://a/1.jpg" /></a>Читать', {
      width: 120,
      height: 90,
    }),
    '<a href="https://a/1"><img src="https://a/1.jpg" width="120" height="90" /></a>Читать',
  );
  assert.equal(
    normalizePreviewImages('<b>Жанр</b>: анимация<br />'),
    '<b>Жанр</b>: анимация<br />',
  );
});

test('dropUnpreviewableImages removes the pictures the reader cannot show', () => {
  // A `data:` picture is base64 of the whole article: it eats the storage cap of its headline and
  // `extract.sanitizePreview` refuses to render it.
  assert.equal(
    dropUnpreviewableImages('<p><img src="data:image/jpeg;base64,U0laRVpPTkU=" /><b>Жанр</b></p>'),
    '<p><b>Жанр</b></p>',
  );
  assert.equal(
    dropUnpreviewableImages('<img src=data:image/png;base64,U0laRVpPTkU= alt="x">Читать'),
    'Читать',
  );
  assert.equal(dropUnpreviewableImages("<IMG SRC='data:,Hello'>"), '');
  // An `<img>` with no address at all is the same useless tag.
  assert.equal(dropUnpreviewableImages('<a href="https://a/1"><img></a>Читать'), '<a href="https://a/1"></a>Читать');
  assert.equal(dropUnpreviewableImages('<img src="./a.jpg">Читать'), 'Читать');
  // A lazy picture of a feed: `data-src` is not an address the reader renders. Where the feed states
  // both, the real `src` is what decides.
  assert.equal(dropUnpreviewableImages('<img data-src="https://a/1.jpg">Читать'), 'Читать');
  assert.equal(
    dropUnpreviewableImages('<img data-src="data:image/png;base64,AAA" src="https://a/1.jpg">'),
    '<img data-src="data:image/png;base64,AAA" src="https://a/1.jpg">',
  );

  // The two spellings `extract.safeExternalUrl` accepts are kept, and the rest of the markup stands.
  assert.equal(
    dropUnpreviewableImages('<img src="https://a/1.jpg"><img src="http://a/2.jpg"><img src="//a/3.jpg">'),
    '<img src="https://a/1.jpg"><img src="http://a/2.jpg"><img src="//a/3.jpg">',
  );
  assert.equal(dropUnpreviewableImages('<b>Жанр</b>: анимация<br />'), '<b>Жанр</b>: анимация<br />');
  assert.equal(dropUnpreviewableImages('plain text, no markup'), 'plain text, no markup');
  assert.equal(dropUnpreviewableImages(''), '');
});

test('capPreview cuts at the edge of the markup, not inside it', () => {
  // A tag cut in the middle leaves its attributes loose in the text; a cut moves back before it.
  assert.equal(capPreview('<p>aaa</p><img src="https://a/b.jpg">', 10), '<p>aaa</p> […]');
  // Same for a character reference cut in the middle, which would print as the letters it escapes.
  assert.equal(capPreview('one &amp; two', 6), 'one […]');
  // A `&` too far from the cut to be a reference the cut broke is left where the feed wrote it.
  assert.equal(capPreview(`a&${'b'.repeat(40)}`, 25), `a&${'b'.repeat(23)} […]`);
  // A cut that lands in the middle of a tag takes the space it left at the end with the tag.
  assert.equal(capPreview('text <img src="https://a/b.jpg">', 6), 'text […]');
  // Text the feed wrote plainly is cut wherever the cap falls: nothing of it is markup.
  assert.equal(capPreview('abcdefghij', 5), 'abcde […]');
  assert.equal(capPreview('short enough', 8000), 'short enough');
  assert.equal(capPreview('', 8000), '');
  assert.equal(capPreview('keep all of it', 0), 'keep all of it');
});

test('makeItem stores the preview pictures at the size the reader sets', () => {
  const feed = { id: 'f1', name: 'lostpix', rss_link: 'https://lostpix.com/rss' };
  const item = store.makeItem({
    feed,
    title: 't',
    link: 'https://lostpix.com/n/1',
    // The two spellings a feed uses: a real tag (what CDATA leaves after the XML parse) and a tag
    // written as entities — `rss.parseFeed` reads `<description>` as text, so storage sees both as
    // this same plain HTML string.
    description: '<img src="https://a/1.jpg" /><img width="640" height="480" src="https://a/2.jpg">',
  });

  assert.equal(
    item.description,
    '<img src="https://a/1.jpg" width="180" height="240" />' +
      '<img src="https://a/2.jpg" width="180" height="240">',
  );
});

test('makeItem keeps the text of a headline whose description carries a data: picture', () => {
  const feed = { id: 'f1', name: 'lostpix', rss_link: 'https://lostpix.com/rss' };
  const item = store.makeItem({
    feed,
    title: 't',
    link: 'https://lostpix.com/n/1',
    // A feed that ships its picture as base64: the blob alone is longer than the storage cap, so a
    // cap run over it would store the blob and none of the news.
    description: `<img src="data:image/png;base64,${'AAAA'.repeat(MAX_PREVIEW_CHARS)}" />${'<p>Новости</p>'.repeat(2000)}`,
  });

  assert.ok(!item.description.includes('base64'));
  assert.ok(item.description.startsWith('<p>Новости</p>'));
  assert.ok(item.description.endsWith(' […]'));
  assert.ok(item.description.length <= MAX_PREVIEW_CHARS + 6);
});

test('previewImageSize never lets a stored picture ask for more than the box of the reader', () => {
  // A headline an older build stored with the sizes its feed declared.
  assert.equal(extract.previewImageSize('640', PREVIEW_IMAGE_WIDTH), PREVIEW_IMAGE_WIDTH);
  assert.equal(extract.previewImageSize(480, PREVIEW_IMAGE_HEIGHT), PREVIEW_IMAGE_HEIGHT);
  // A picture the storage box already fits is kept as it is; a part of a pixel is a whole pixel.
  assert.equal(extract.previewImageSize(120, PREVIEW_IMAGE_WIDTH), 120);
  assert.equal(extract.previewImageSize('119.6', PREVIEW_IMAGE_WIDTH), 120);
  // Not a size at all: no attribute rather than a box of zero or a negative one.
  assert.equal(extract.previewImageSize('0', PREVIEW_IMAGE_WIDTH), null);
  assert.equal(extract.previewImageSize(-40, PREVIEW_IMAGE_HEIGHT), null);
  assert.equal(extract.previewImageSize('abc', PREVIEW_IMAGE_WIDTH), null);
  assert.equal(extract.previewImageSize('', PREVIEW_IMAGE_HEIGHT), null);
  assert.equal(extract.previewImageSize(undefined, PREVIEW_IMAGE_WIDTH), null);
});

/**
 * A preview picture is a request to the site that owns it, made by the reader page itself, and what
 * that request looks like is decided in three files at once: the box `util.js` writes into storage,
 * the rules `reader.css` gives the rebuilt preview, and what `src/index.html` declares to the site it
 * asks. Nothing repeats the other, so the limits are held here: a stylesheet that drifts from the box
 * draws a picture bigger than storage meant, and a page that names no referrer policy sends the
 * address of the extension to every site whose picture the reader shows.
 */
test('a preview picture is drawn in the box of the reader and names no reader to the site that owns it', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles/reader.css', import.meta.url), 'utf8');

  assert.match(
    html,
    /<meta name="referrer" content="no-referrer"\s*\/>/,
    "src/index.html loads a third party's picture but tells no referrer policy to the page that asks for it",
  );

  /* The subset `extract.sanitizePreview` rebuilds is a small document of its own: a tag of it that no
   * rule of `reader.css` takes is drawn the way the feed's own stylesheet would have drawn it — a list
   * without its indent, a quotation without its line, a picture without its box. */
  for (const tag of ['p', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'hr', 'img']) {
    assert.ok(extract.PREVIEW_ALLOWED_TAGS.has(tag), `reader.css gives a preview <${tag}> a shape the sanitizer never rebuilds`);
    assert.ok(
      new RegExp('\\.preview ' + tag + '[\\s,{]').test(css),
      `a stored preview can carry <${tag}>, which reader.css gives no rule of its own`,
    );
  }

  const box = css.match(/\.preview img \{[^}]*\}/)?.[0];
  assert.ok(box, 'reader.css gives no rule to a preview picture');
  assert.equal(
    Number(box.match(/max-width:\s*min\((\d+)px/)?.[1]),
    PREVIEW_IMAGE_WIDTH,
    'the width a preview picture may ask for is the width of the box storage writes on it',
  );
  assert.equal(
    Number(box.match(/max-height:\s*(\d+)px/)?.[1]),
    PREVIEW_IMAGE_HEIGHT,
    'the height a preview picture may ask for is the height of that box',
  );
  assert.ok(
    /\.preview img \{[^}]*\bheight:\s*auto/.test(css) && /\.preview img \{[^}]*\bwidth:\s*auto/.test(css),
    'a preview picture keeps its own proportions instead of being squashed into the attributes',
  );
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

test('capTotal bounds the headlines of every feed together', () => {
  const fullFeeds = MAX_ITEMS_TOTAL / MAX_ITEMS_PER_FEED;
  assert.ok(Number.isInteger(fullFeeds), 'the total cap is a whole number of full feeds');

  const feed = (id, from) =>
    Array.from({ length: MAX_ITEMS_PER_FEED }, (_, i) => ({
      uid: `${id}-${i}`,
      feedId: id,
      title: `${id} ${i}`,
      time: from + i,
    }));

  const items = [];
  for (let f = 0; f < fullFeeds; f += 1) items.push(...feed(`f${f}`, (f + 1) * MAX_ITEMS_PER_FEED));
  assert.equal(store.capTotal(items).length, MAX_ITEMS_TOTAL, 'a shelf exactly full is left alone');

  /* A feed older than the whole shelf: every headline of every other feed is fresher than any of
   * its own, so there is room for the newcomer only by dropping what the shelf holds oldest. */
  items.push(...feed('old', 0));
  const kept = store.capTotal(items);
  assert.equal(kept.length, MAX_ITEMS_TOTAL, 'the shelf does not grow with every feed added to it');
  assert.equal(
    kept.filter((item) => item.feedId === 'old').length,
    0,
    'the oldest headlines of the whole shelf go first, whoever they belong to',
  );
  assert.equal(kept[0].feedId, `f${fullFeeds - 1}`, 'newest first');
  assert.equal(
    store.capItems(items).length,
    MAX_ITEMS_TOTAL,
    'the cap of one feed and the cap of all of them are applied together',
  );
});

/* ---------------------------- read list ---------------------------- */

test('makeReadRecord keeps the link, the publication date and the delete time', () => {
  const time = Date.parse('2024-10-05T00:00:00Z');
  const record = store.makeReadRecord(
    { link: '  https://habr.com/ru/news/1/ ', pubDate: 'Tue, 01 Oct 2024 08:00:00 GMT' },
    time,
  );
  assert.deepEqual(record, {
    link: 'https://habr.com/ru/news/1/',
    sourceId: 'https://habr.com/ru/news/1',
    sourceIdType: 'link',
    pubDate: '2024-10-01T08:00:00.000Z',
    time,
  });
  assert.equal(store.makeReadRecord({ link: '' }).link, '', 'no link, nothing to match on');

  const byId = store.makeReadRecord({ link: 'https://a.b/x/', sourceId: 'guid:99', sourceIdType: 'guid' }, time);
  assert.deepEqual(
    { sourceId: byId.sourceId, sourceIdType: byId.sourceIdType },
    { sourceId: 'guid:99', sourceIdType: 'guid' },
    'the marker remembers the id the feed calls the news by: it must still match when the address moves',
  );

  const ahead = store.makeReadRecord({ link: 'https://a.b/y', pubDate: new Date(time + 30 * DAY).toISOString() }, time);
  assert.equal(
    ahead.pubDate,
    new Date(time + MAX_PUBDATE_SKEW_MS).toISOString(),
    'a marker is never dated ahead of the deletion that wrote it, or its horizon would never run out',
  );
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

test('normalizeSoundChoice keeps only bundled signals — the old «Без звука» falls back to the default', () => {
  assert.equal(
    store.normalizeSoundChoice(store.SOUND_NONE),
    store.DEFAULT_SOUND_FILE,
    'a stored «Без звука» of the old builds plays the default file; its silence lives in the sound flag',
  );
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

test('capRead burns the expired markers before it touches a live one', () => {
  const now = 1_700_000_000_000;
  const live = Array.from({ length: MAX_READ_RECORDS }, (_, i) => ({ link: `l${i}`, time: now - i * DAY }));
  const dead = Array.from({ length: 5 }, (_, i) => ({ link: `d${i}`, time: now - (MAX_READ_TTL_DAYS + 1) * DAY }));

  const capped = store.capRead([...live, ...dead], MAX_READ_TTL_DAYS, now);
  assert.equal(capped.read.length, MAX_READ_RECORDS);
  assert.equal(capped.droppedLive, 0, 'the horizon survived: what went had already burned out');
  assert.deepEqual(
    capped.read.map((record) => record.link),
    live.map((record) => record.link),
    'a marker that still keeps its news out is not what the cap sacrifices',
  );

  const untouched = store.capRead(live.slice(0, 10), MAX_READ_TTL_DAYS, now);
  assert.equal(untouched.read.length, 10, 'a list under the cap is untouched');
  assert.equal(untouched.droppedLive, 0);
});

test('capRead sacrifices the oldest live markers only when they no longer fit — and says so', () => {
  const now = 1_700_000_000_000;
  const live = Array.from({ length: MAX_READ_RECORDS + 5 }, (_, i) => ({ link: `l${i}`, time: now - i * DAY }));

  const capped = store.capRead(live, MAX_READ_TTL_DAYS, now);
  assert.equal(capped.read.length, MAX_READ_RECORDS);
  assert.equal(capped.droppedLive, 5, 'the five live markers the list has no room for are named, not lost in silence');
  assert.equal(capped.read[0].link, 'l0', 'newest first');
  assert.equal(capped.read.at(-1).link, `l${MAX_READ_RECORDS - 1}`, 'the oldest live markers went');
  assert.equal(capped.read.some((record) => record.link.startsWith('d')), false);
});

test('honoredReadDays names the horizon the read list really keeps', () => {
  const now = 1_700_000_000_000;
  const live = Array.from({ length: MAX_READ_RECORDS }, (_, i) => ({ link: `l${i}`, time: now - i * DAY }));

  assert.equal(honoredReadDays(live, MAX_READ_TTL_DAYS, MAX_READ_RECORDS, now), MAX_READ_TTL_DAYS);
  assert.equal(
    honoredReadDays([...live, { link: 'dead', time: now - (MAX_READ_TTL_DAYS + 1) * DAY }], MAX_READ_TTL_DAYS, MAX_READ_RECORDS, now),
    MAX_READ_TTL_DAYS,
    'a marker whose term has run out is not what shortens the horizon',
  );

  const overflow = Array.from({ length: MAX_READ_RECORDS + 3 }, (_, i) => ({ link: `l${i}`, time: now - i * DAY }));
  assert.equal(
    honoredReadDays(overflow, MAX_READ_TTL_DAYS, MAX_READ_RECORDS, now),
    MAX_READ_RECORDS - 1,
    'the cap bites: the horizon left is the age of the oldest marker the list can still hold',
  );
  assert.equal(honoredReadDays([], MAX_READ_TTL_DAYS, MAX_READ_RECORDS, now), MAX_READ_TTL_DAYS);
  assert.equal(honoredReadDays(undefined, MAX_READ_TTL_DAYS, MAX_READ_RECORDS, now), MAX_READ_TTL_DAYS);
});

/* -------------------- dedup by what the feed calls a headline -------------------- */

test('a headline the feed reissues under another address stays one headline', async () => {
  const feed = { id: 'f1', name: 'Lenta', rss_link: 'https://lenta.ru/rss' };
  const forget = storageMemory();

  try {
    const first = store.makeItem({ feed, title: 'A', link: 'https://lenta.ru/a/1/?utm_source=rss' });
    assert.equal((await store.addItems([first])).added, 1);

    const again = store.makeItem({ feed, title: 'A', link: 'http://www.lenta.ru:443/a/1/#more' });
    assert.deepEqual(
      await store.addItems([again]),
      { added: 0, skipped: 0, seen: 1 },
      'the poll saw it and the storage already had it: not a «deleted before» skip',
    );

    const stored = await store.getItems();
    assert.equal(stored.length, 1, 'no second copy of the same news');
    assert.equal(
      stored[0].link,
      'https://lenta.ru/a/1/?utm_source=rss',
      'the stored address is the one the reader opens, not the key it was matched by',
    );

    /* A query the site really routes on is a different news: the key drops tracking parameters, not
     * the address. */
    const page2 = store.makeItem({ feed, title: 'B', link: 'https://lenta.ru/a/1?page=2' });
    assert.equal((await store.addItems([page2])).added, 1, 'a second page of the same article');
  } finally {
    forget();
  }
});

test('the id a feed states recognises its news after the address moves', async () => {
  const feed = { id: 'f1', name: 'Nnm', rss_link: 'https://nnmclub.to/rss' };
  const id = 'nnm:396698';
  const forget = storageMemory();

  try {
    const before = store.makeItem({
      feed,
      title: 'A',
      link: 'https://nnmclub.to/forum/viewtopic.php?t=396698',
      sourceId: id,
      sourceIdType: 'guid',
    });
    await store.addItems([before]);

    const moved = store.makeItem({
      feed,
      title: 'A, renamed by the site',
      link: 'https://nnmclub.to/forum/viewtopic.php?p=9999999',
      sourceId: id,
      sourceIdType: 'guid',
    });
    assert.deepEqual(
      await store.addItems([moved]),
      { added: 0, skipped: 0, seen: 1 },
      'the guid is the news; the address it points at is not',
    );

    const other = store.makeItem({
      feed,
      title: 'B',
      link: 'https://nnmclub.to/forum/viewtopic.php?t=396698',
      sourceId: 'nnm:396699',
      sourceIdType: 'guid',
    });
    assert.equal((await store.addItems([other])).added, 1, 'another id at the same address is another news');
  } finally {
    forget();
  }
});

test('a headline stored before the ids were kept is not copied by the next poll', async () => {
  const feed = { id: 'f1', name: 'Hab', rss_link: 'https://habr.com/ru/rss/' };
  const forget = storageMemory();

  try {
    /* A record as the older builds of this reader wrote it: `uid` built on the raw link, no
     * `sourceId`. It must still recognise the headline it describes. */
    await store.saveItems([
      {
        uid: 'f1|https://habr.com/ru/news/1/?utm_source=rss',
        feedId: 'f1',
        feedName: 'Hab',
        rss_link: feed.rss_link,
        title: 'A',
        description: '',
        pubDate: '',
        link: 'https://habr.com/ru/news/1/?utm_source=rss',
        time: 1000,
      },
    ]);

    const candidate = store.makeItem({ feed, title: 'A', link: 'https://habr.com/ru/news/1/' });
    assert.deepEqual(await store.addItems([candidate]), { added: 0, skipped: 0, seen: 1 });
    assert.equal((await store.getItems()).length, 1, 'the reader did not duplicate its own stored list');
  } finally {
    forget();
  }
});

test('a feed that starts stating its own ids is one feed: its headlines do not come back', async () => {
  const feed = { id: 'f1', name: 'Blog', rss_link: 'https://blog.example/rss' };
  const forget = storageMemory();

  try {
    /* The shelf as every poll before the CMS upgrade wrote it: a headline keyed by its address. */
    const before = store.makeItem({ feed, title: 'A', link: 'https://blog.example/posts/1?utm_source=rss' });
    assert.equal((await store.addItems([before])).added, 1);

    /* The same news on the first poll after the upgrade: the feed names it, and keeps the address. */
    const upgraded = store.makeItem({
      feed,
      title: 'A',
      link: 'https://www.blog.example/posts/1/',
      sourceId: 'tag:blog,2024:1',
      sourceIdType: 'guid',
    });
    assert.deepEqual(
      await store.addItems([upgraded]),
      { added: 0, skipped: 0, seen: 1 },
      'a new kind of identity is not a new news',
    );

    const stored = await store.getItems();
    assert.equal(stored.length, 1, 'the reader did not duplicate the headline it already had');
    assert.equal(
      stored[0].uid,
      'f1|tag:blog,2024:1',
      'the record the poll re-typed now carries the id the feed promises to keep',
    );
    assert.equal(stored[0].link, 'https://blog.example/posts/1?utm_source=rss', 'and keeps the address it read');

    /* The upgrade moved the address too, a month later: the id is what holds the headline in place. */
    const moved = store.makeItem({
      feed,
      title: 'A, renamed by the site',
      link: 'https://blog.example/2024/01/a-renamed/',
      sourceId: 'tag:blog,2024:1',
      sourceIdType: 'guid',
    });
    assert.deepEqual(
      await store.addItems([moved]),
      { added: 0, skipped: 0, seen: 1 },
      're-typing it was what made its address free to move',
    );
    assert.equal((await store.getItems()).length, 1);
  } finally {
    forget();
  }
});

test('a headline deleted before the feed had ids stays deleted after it started stating them', async () => {
  const feed = { id: 'f1', name: 'Blog', rss_link: 'https://blog.example/rss' };
  const forget = storageMemory();

  try {
    const before = store.makeItem({ feed, title: 'A', link: 'https://blog.example/posts/1' });
    await store.addItems([before]);
    assert.equal(await store.removeItem(before.uid), true);

    const marker = (await store.getRead())[0];
    assert.equal(marker.sourceIdType, 'link', 'the marker was made from a headline keyed by its address');

    const upgraded = store.makeItem({
      feed,
      title: 'A',
      link: 'https://blog.example/posts/1/',
      sourceId: 'tag:blog,2024:1',
      sourceIdType: 'guid',
    });
    assert.deepEqual(
      await store.addItems([upgraded]),
      { added: 0, skipped: 1, seen: 1 },
      'the removed headline is the one an upgrade brings back, and the marker is what stops it',
    );
    assert.equal((await store.getItems()).length, 0);
  } finally {
    forget();
  }
});

test('a feed that stops stating its ids does not lose the headlines it keyed by them', async () => {
  const feed = { id: 'f1', name: 'Blog', rss_link: 'https://blog.example/rss' };
  const forget = storageMemory();

  try {
    const withId = store.makeItem({
      feed,
      title: 'A',
      link: 'https://blog.example/posts/1',
      sourceId: 'tag:blog,2024:1',
      sourceIdType: 'guid',
    });
    await store.addItems([withId]);

    const dropped = store.makeItem({ feed, title: 'A', link: 'https://blog.example/posts/1/' });
    assert.deepEqual(
      await store.addItems([dropped]),
      { added: 0, skipped: 0, seen: 1 },
      'the address is enough to recognise a headline the storage keys by an id',
    );
    assert.equal((await store.getItems()).length, 1, 'and it is not re-typed by a poll that states less');
  } finally {
    forget();
  }
});

test('one deleted news is one marker, whichever way its feed calls it', async () => {
  const feed = { id: 'f1', name: 'Blog', rss_link: 'https://blog.example/rss' };
  const forget = storageMemory();

  try {
    const byAddress = store.makeItem({ feed, title: 'A', link: 'https://blog.example/posts/1' });
    assert.equal(await store.markRead([byAddress]), 1);

    const byId = store.makeItem({
      feed,
      title: 'A',
      link: 'https://blog.example/posts/1/',
      sourceId: 'tag:blog,2024:1',
      sourceIdType: 'guid',
    });
    assert.equal(await store.markRead([byId]), 0, 'a marker keyed by an address holds out the same news by its id');

    const retyped = await store.getRead();
    assert.equal(retyped.length, 1, 'the marker was re-typed, not doubled');
    assert.equal(retyped[0].sourceIdType, 'guid', 'it took the id the feed states now');
    assert.equal(retyped[0].sourceId, 'tag:blog,2024:1', 'and holds its news out by that id from here on');

    const secondId = store.makeItem({
      feed,
      title: 'A, now with another id',
      link: 'https://blog.example/posts/1',
      sourceId: 'tag:blog,2024:2',
      sourceIdType: 'guid',
    });
    assert.equal(
      await store.markRead([secondId]),
      1,
      'where both sides name an id of their own, the ids are the news: one address holds two markers',
    );

    const elsewhere = store.makeItem({
      feed,
      title: 'B',
      link: 'https://blog.example/posts/2',
      sourceId: 'tag:blog,2024:3',
      sourceIdType: 'guid',
    });
    assert.equal(await store.markRead([elsewhere]), 1, 'another news is another marker');
    assert.equal((await store.getRead()).length, 3);
  } finally {
    forget();
  }
});

test('a deleted news stays deleted when the feed ships it under another link', async () => {
  const feed = { id: 'f1', name: 'Nnm', rss_link: 'https://nnmclub.to/rss' };
  const id = 'nnm:396698';
  const forget = storageMemory();

  try {
    const item = store.makeItem({
      feed,
      title: 'A',
      link: 'https://nnmclub.to/forum/viewtopic.php?t=396698',
      sourceId: id,
      sourceIdType: 'guid',
    });
    await store.addItems([item]);
    assert.equal(await store.removeItem(item.uid), true);

    const reissued = store.makeItem({
      feed,
      title: 'A',
      link: 'https://nnmclub.to/forum/viewtopic.php?p=9999999',
      sourceId: id,
      sourceIdType: 'guid',
    });
    const read = await store.getRead();
    assert.equal(read.length, 1, 'the deletion left one marker');
    assert.equal(read[0].sourceId, id, 'the marker remembers the id the feed calls the news by');

    assert.deepEqual(
      await store.addItems([reissued]),
      { added: 0, skipped: 1, seen: 1 },
      'skipped: it is the read marker that stopped it',
    );

    /* A marker of one kind does not match a headline the feed describes another way. */
    const byLink = store.makeItem({ feed, title: 'A', link: 'https://nnmclub.to/forum/viewtopic.php?p=1' });
    assert.equal((await store.addItems([byLink])).added, 1, 'a news without the guid is not the marked one');
  } finally {
    forget();
  }
});

test('taking a read mark off lets the news back into every feed that ships it', async () => {
  const blog = { id: 'f1', name: 'Blog', rss_link: 'https://blog.example/rss' };
  const comments = { id: 'f2', name: 'Blog comments', rss_link: 'https://blog.example/comments/rss' };
  const forget = storageMemory();

  try {
    await store.saveFeeds([blog, comments]);

    /* A marker made by one feed holds its news out of the other; the marker is keyed without a feed,
     * so taking it off has to work the same way round — from a headline of either feed. */
    const byId = store.makeItem({
      feed: blog,
      title: 'A',
      link: 'https://blog.example/posts/1',
      sourceId: 'tag:blog,2024:1',
      sourceIdType: 'guid',
    });
    const sameNews = store.makeItem({
      feed: comments,
      title: 'A',
      link: 'https://blog.example/comments/posts/1',
      sourceId: 'tag:blog,2024:1',
      sourceIdType: 'guid',
    });

    assert.equal(await store.markRead([byId]), 1);
    assert.deepEqual(await store.addItems([sameNews]), { added: 0, skipped: 1, seen: 1 }, 'the marker of the first feed holds the news out of the second');

    assert.equal(await store.unmarkRead([sameNews]), 1, 'a headline of another feed names the same news, so its marker goes');
    assert.equal((await store.getRead()).length, 0);
    assert.equal((await store.addItems([sameNews])).added, 1, 'and the news is offered again');

    /* The same for a marker the shelf keyed by an address alone: the address crosses feeds too. */
    const byAddress = store.makeItem({ feed: blog, title: 'B', link: 'https://blog.example/posts/2' });
    const sameAddress = store.makeItem({ feed: comments, title: 'B', link: 'https://blog.example/posts/2' });
    await store.markRead([byAddress]);
    assert.equal(await store.unmarkRead([sameAddress]), 1);
    assert.equal((await store.getRead()).length, 0);

    /* A marker keyed by an id is taken off by a headline that only knows the address of it: the two
     * are the same news exactly when `addItems` would have recognised one as the other — an address
     * matched because one of the two has nothing but an address to say. */
    const idOnly = store.makeItem({
      feed: blog,
      title: 'C',
      link: 'https://blog.example/posts/3',
      sourceId: 'tag:blog,2024:3',
      sourceIdType: 'guid',
    });
    await store.markRead([idOnly]);
    const addressOnly = store.makeItem({ feed: comments, title: 'C', link: 'https://blog.example/posts/3' });
    assert.equal(await store.unmarkRead([addressOnly]), 1, 'one side without an id is enough to name the news');
    assert.equal((await store.getRead()).length, 0);

    /* Where both sides name an id of their own, the ids are the news: one address holds two of them,
     * and a headline of the other is not the marked one. */
    const otherC = store.makeItem({
      feed: comments,
      title: 'C, another id',
      link: 'https://blog.example/posts/3',
      sourceId: 'tag:blog,2024:4',
      sourceIdType: 'guid',
    });
    await store.markRead([idOnly]);
    assert.equal(await store.unmarkRead([otherC]), 0, 'the marker of one id holds out another');
    assert.equal((await store.getRead()).length, 1);

    assert.equal(await store.unmarkRead([]), 0, 'nothing asked for, nothing taken');
    assert.equal(await store.unmarkRead([null, { title: 'no link' }]), 0);
  } finally {
    forget();
  }
});

test('undoing a delete puts the headline back and takes its marker with it', async () => {
  const feed = { id: 'f1', name: 'Blog', rss_link: 'https://blog.example/rss' };
  const forget = storageMemory();

  try {
    await store.saveFeeds([feed]);
    const item = store.makeItem({ feed, title: 'A', link: 'https://blog.example/posts/1' });
    const neighbour = store.makeItem({ feed, title: 'B', link: 'https://blog.example/posts/2' });
    await store.addItems([item, neighbour]);

    assert.equal(await store.removeItem(item.uid), true);
    assert.equal((await store.getItems()).length, 1, 'the shelf lost the headline');
    assert.equal((await store.getRead()).length, 1, 'and its news is held out by a marker');

    assert.equal(await store.restoreItem(item), true);
    const back = await store.getItems();
    assert.equal(back.length, 2);
    assert.ok(back.some((stored) => stored.uid === item.uid), 'the same headline, not a copy the next poll ships');
    assert.equal((await store.getRead()).length, 0, 'the marker went with it, or the next read would delete it again');

    assert.equal((await store.addItems([item])).added, 0, 'the poll that re-ships it is not a second headline');
  } finally {
    forget();
  }
});

test('a delete is not undone where the headline has nowhere to live', async () => {
  const feed = { id: 'f1', name: 'Blog', rss_link: 'https://blog.example/rss' };
  const forget = storageMemory();

  try {
    await store.saveFeeds([feed]);
    const item = store.makeItem({ feed, title: 'A', link: 'https://blog.example/posts/1' });
    await store.addItems([item]);
    await store.removeItem(item.uid);

    await store.saveFeeds([]);
    assert.equal(await store.restoreItem(item), false, 'the feed that owned the headline is gone');
    assert.equal((await store.getItems()).length, 0, 'and no orphan headline was written back');
    assert.equal((await store.getRead()).length, 1, 'the marker stays: the news is still held out of the feeds that remain');

    await store.saveFeeds([feed]);
    assert.equal(await store.restoreItem(item), true);
    assert.equal(await store.restoreItem(item), false, 'a headline already on the shelf is not restored a second time');
    assert.equal((await store.getItems()).length, 1);

    assert.equal(await store.restoreItem(null), false);
    assert.equal(await store.restoreItem({ title: 'no uid' }), false);
  } finally {
    forget();
  }
});

test('readMarksFor calls a headline read by the marker that would hold it off the shelf', () => {
  const blog = { id: 'f1', name: 'Blog', rss_link: 'https://blog.example/rss' };
  const mirror = { id: 'f2', name: 'Mirror', rss_link: 'https://mirror.example/rss' };

  const marked = store.makeItem({
    feed: blog,
    title: 'A',
    link: 'https://blog.example/posts/1',
    sourceId: 'tag:blog,2024:1',
    sourceIdType: 'guid',
  });
  const marker = store.makeReadRecord(marked, 1000);

  const sameNews = store.makeItem({
    feed: mirror,
    title: 'A',
    link: 'https://mirror.example/a/1',
    sourceId: 'tag:blog,2024:1',
    sourceIdType: 'guid',
  });
  const byAddress = store.makeItem({ feed: mirror, title: 'A', link: 'https://blog.example/posts/1' });
  const otherId = store.makeItem({
    feed: mirror,
    title: 'A, another id',
    link: 'https://blog.example/posts/1',
    sourceId: 'tag:blog,2024:2',
    sourceIdType: 'guid',
  });
  const unmarked = store.makeItem({ feed: blog, title: 'B', link: 'https://blog.example/posts/2' });

  const marks = store.readMarksFor([marked, sameNews, byAddress, otherId, unmarked], [marker]);
  assert.deepEqual(
    [...marks].sort(),
    [marked.uid, sameNews.uid, byAddress.uid].sort(),
    'the marked headline, the mirror of the same news, and the headline that meets the marker at its '
      + 'address; another id at that address is another news',
  );

  assert.equal(store.readMarksFor([byAddress], [store.makeReadRecord(byAddress, 1000)]).size, 1, 'a marker keyed by an address covers the headline it holds');
  assert.equal(store.readMarksFor([unmarked], [marker]).size, 0, 'another news is not covered');
  assert.equal(store.readMarksFor([], [marker]).size, 0);
  assert.equal(store.readMarksFor(null, null).size, 0);

  /* A marker whose horizon has run out still sits in the list, so the reader still holds the news it
   * stands for until `cleanupRead` sweeps it. */
  const stale = store.makeReadRecord(unmarked, 1000);
  assert.ok(util.isReadExpired(stale, Date.now(), 7), 'the horizon of this marker ran out long ago');
  assert.ok(store.readMarksFor([unmarked], [stale]).has(unmarked.uid), 'and still counts as a mark in the reader');
});

test('markRead keeps one marker for a news two feeds of one site ship twice', async () => {
  const feed = { id: 'f1', name: 'Nnm', rss_link: 'https://nnmclub.to/rss' };
  const forget = storageMemory();

  try {
    const first = store.makeItem({ feed, title: 'A', link: 'https://a.b/x', sourceId: 'g1', sourceIdType: 'guid' });
    const second = store.makeItem({ feed, title: 'A', link: 'https://a.b/y', sourceId: 'g1', sourceIdType: 'guid' });

    assert.equal(await store.markRead([first, second]), 1);
    assert.equal(await store.markRead([first]), 0, 'a marker is not stored twice');
    assert.equal((await store.getRead()).length, 1);
  } finally {
    forget();
  }
});

test('the cap of the read list burns its dead markers, not the ones that still hold a news', async () => {
  const feed = { id: 'f1', name: 'Site', rss_link: 'https://a.b/rss' };
  const forget = storageMemory();

  try {
    await store.setReadTtlDays(MAX_READ_TTL_DAYS);

    const marker = (path, ageDays) => ({
      link: `https://a.b/${path}`,
      sourceId: `https://a.b/${path}`,
      sourceIdType: 'link',
      pubDate: '',
      time: Date.now() - ageDays * DAY,
    });

    const stored = [];
    for (let i = 0; i < MAX_READ_RECORDS - 100; i += 1) stored.push(marker(`live/${i}`, 1));
    for (let i = 0; i < 100; i += 1) stored.push(marker(`dead/${i}`, MAX_READ_TTL_DAYS + 1));
    assert.equal(stored.length, MAX_READ_RECORDS, 'a full list of markers, a hundred of them burned out');
    await store.saveRead(stored);

    const extra = Array.from({ length: 10 }, (_, i) =>
      store.makeItem({ feed, title: `extra ${i}`, link: `https://a.b/extra/${i}` }),
    );
    assert.equal(await store.markRead(extra), extra.length);

    const read = await store.getRead();
    assert.equal(read.length, MAX_READ_RECORDS - 90, 'the list stays capped');
    assert.equal(read.filter((record) => record.link.includes('/dead/')).length, 0, 'burned-out markers were the first to go');
    assert.equal(
      read.filter((record) => record.link.includes('/live/')).length,
      MAX_READ_RECORDS - 100,
      'a marker that still keeps its news out is not what the cap sacrifices: the horizon is not broken to fit the list',
    );
    assert.equal(
      read.filter((record) => record.link.includes('/extra/')).length,
      10,
      'the news deleted just now is held back too',
    );
    assert.equal(store.readHonoredDays(read, MAX_READ_TTL_DAYS), MAX_READ_TTL_DAYS);
  } finally {
    forget();
  }
});

test('the same news of two feeds stays two headlines', async () => {
  const syndicated = 'https://a.b/news/1/?utm_source=rss';
  const forget = storageMemory();

  try {
    const first = store.makeItem({ feed: { id: 'f1', name: 'Site', rss_link: 'https://a.b/rss' }, title: 'A', link: syndicated });
    const second = store.makeItem({ feed: { id: 'f2', name: 'Mirror', rss_link: 'https://b.a/rss' }, title: 'A', link: 'https://www.a.b/news/1' });

    assert.equal((await store.addItems([first, second])).added, 2, 'each feed keeps its own copy of a news it ships');
    assert.equal((await store.itemsForFeed('f2'))[0].feedName, 'Mirror');
  } finally {
    forget();
  }
});

test('the stored headlines of all feeds together do not grow without bound', async () => {
  const forget = storageMemory();
  const feeds = MAX_ITEMS_TOTAL / MAX_ITEMS_PER_FEED + 1;

  try {
    /* Nine feeds of 250 headlines each, every headline of the last one older than every headline
     * of every feed before it — all of them young enough for `addItems` to keep them at all, so what
     * throws them back out is the cap and nothing else. */
    const candidates = [];
    for (let f = 0; f < feeds; f += 1) {
      const feed = { id: `f${f}`, name: `Feed ${f}`, rss_link: `https://a.b/${f}/rss` };
      for (let i = 0; i < MAX_ITEMS_PER_FEED; i += 1) {
        candidates.push(store.makeItem({
          feed,
          title: `news ${f}-${i}`,
          link: `https://a.b/${f}/news/${i}`,
          pubDate: new Date(Date.now() - (f * MAX_ITEMS_PER_FEED + i) * (MINUTE / 2)).toUTCString(),
        }));
      }
    }

    assert.equal(
      (await store.addItems(candidates)).added,
      MAX_ITEMS_TOTAL,
      'the load reports the headlines that stayed on the shelf, not the ones its caps threw back out',
    );
    const items = await store.getItems();
    assert.equal(items.length, MAX_ITEMS_TOTAL, 'a feed is capped on its own, and now the shelf of all of them is capped too');
    assert.equal(
      items.filter((item) => item.feedId === `f${feeds - 1}`).length,
      0,
      'the freshest headlines of the eight feeds stayed, the oldest feed of the shelf is the one with no room left',
    );
    assert.equal(await store.countItems(), MAX_ITEMS_TOTAL, 'the badge counts the shelf the reader really holds');
  } finally {
    forget();
  }
});

test('a headline whose clean_timeout had already run out is not news the reader has never had', async () => {
  const feed = { id: 'f1', name: 'Old news', rss_link: 'https://a.b/rss', delay_timeout: 30, clean_timeout: 60 };
  const forget = storageMemory();
  const age = (minutes) => new Date(Date.now() - minutes * MINUTE).toUTCString();

  try {
    await store.saveFeeds([feed]);

    const fresh = store.makeItem({ feed, title: 'fresh', link: 'https://a.b/news/1', pubDate: age(30) });
    const stale = store.makeItem({ feed, title: 'stale', link: 'https://a.b/news/2', pubDate: age(90) });

    assert.deepEqual(
      await store.addItems([fresh, stale]),
      { added: 1, skipped: 0, seen: 2 },
      'the headline the sweep would take back at once is not counted among the headlines it brought',
    );
    assert.deepEqual(
      (await store.getItems()).map((item) => item.link),
      ['https://a.b/news/1'],
      'and it does not sit on the shelf waiting for the sweep',
    );
    assert.equal((await store.getRead()).length, 0, 'a headline the reader never had is not remembered as read');

    /* The server keeps shipping its old item: every next poll has to say the same, or the same
     * headline is «new» again on every `delay_timeout` and the load signal sounds over a list that
     * never changed. */
    assert.deepEqual(
      await store.addItems([fresh, store.makeItem({ feed, title: 'stale', link: 'https://a.b/news/2', pubDate: age(91) })]),
      { added: 0, skipped: 0, seen: 2 },
      'neither of them is news the second time round',
    );
    assert.equal(await store.countItems(), 1, 'the badge counts one headline, not one headline and its backlog');
  } finally {
    forget();
  }
});

/* ---------------- the sweep and the reader's «Clear all» ---------------- */

/**
 * `store.cleanup` runs on every alarm cycle and before the reader writes a headline; `clearAllItems` is what
 * the «Clear all» button of the reader page does. Which headlines they leave on the shelf was held only in
 * their source: that a headline of a feed the reader deleted has no `clean_timeout` left to expire from, that
 * a shelf emptied by hand is not a shelf of news the reader has never seen, and that the sweep of headlines
 * is also the only way a read marker ever lapses.
 */
test('the sweep takes back the headlines whose clean_timeout ran out, the ones whose feed is gone, and the markers that lived their term', async () => {
  const forget = storageMemory();
  const age = (minutes) => new Date(Date.now() - minutes * MINUTE).toUTCString();
  const feed = { id: 'f1', name: 'Site', rss_link: 'https://a.b/rss', clean_timeout: 1440 };
  const deletedFeed = { id: 'gone', name: 'Deleted feed', rss_link: 'https://c.d/rss' };

  try {
    await store.saveFeeds([feed]);
    await store.addItems([
      store.makeItem({ feed, title: 'fresh', link: 'https://a.b/news/1', pubDate: age(30) }),
      store.makeItem({ feed, title: 'stale', link: 'https://a.b/news/2', pubDate: age(90) }),
      store.makeItem({ feed: deletedFeed, title: 'orphan', link: 'https://c.d/news/3', pubDate: age(10) }),
    ]);
    await store.saveRead([
      { link: 'https://a.b/news/a', sourceId: 'https://a.b/news/a', sourceIdType: 'link', pubDate: '', time: Date.now() - 2 * DAY },
      { link: 'https://a.b/news/b', sourceId: 'https://a.b/news/b', sourceIdType: 'link', pubDate: '', time: Date.now() - (READ_TTL_DAYS + 3) * DAY },
    ]);

    assert.equal(await store.countItems(), 3, 'while the feed asked for a day of headlines, all three of them were news the shelf kept');

    /* The expiry of a headline is derived from the `clean_timeout` its feed has *now*, so editing the feed
     * reaches the headlines it stored long before the edit. */
    feed.clean_timeout = 60;
    await store.saveFeeds([feed]);

    const swept = await store.cleanup();

    assert.equal(swept.removed, 2, 'the headline past the `clean_timeout` of its feed, and the headline of a feed the reader deleted: it has nowhere to expire from, so it cannot stay');
    assert.deepEqual(swept.items.map((item) => item.link), ['https://a.b/news/1'], 'the sweep answers with what the shelf holds now');
    assert.deepEqual((await store.getItems()).map((item) => item.link), ['https://a.b/news/1'], 'and that is what it wrote down');

    assert.equal(swept.readRemoved, 1, 'the sweep of the headlines is also the sweep of the read list, which is the only way a marker ever lapses');
    assert.deepEqual((await store.getRead()).map((record) => record.link), ['https://a.b/news/a'], 'a marker that still lives its `read_ttl_days` keeps holding its news off the shelf');
    assert.equal(swept.lockRemoved, 0, 'and the tickets of reads that never came back — none here — are aged by the same sweep');

    assert.equal((await store.getFeeds()).length, 1, 'a sweep ages headlines and markers, never the feeds the reader configured');
  } finally {
    forget();
  }
});

test('the «Clear all» of the reader empties the shelf and remembers every headline it took as read', async () => {
  const forget = storageMemory();
  const age = (minutes) => new Date(Date.now() - minutes * MINUTE).toUTCString();
  const one = { id: 'f1', name: 'Site', rss_link: 'https://a.b/rss', clean_timeout: 60 };
  const other = { id: 'f2', name: 'Other site', rss_link: 'https://c.d/rss', clean_timeout: 60 };

  try {
    await store.saveFeeds([one, other]);
    await store.updateSettings({ sound_enabled: false });
    await store.addItems([
      store.makeItem({ feed: one, title: 'A', link: 'https://a.b/news/1', pubDate: age(10) }),
      store.makeItem({ feed: one, title: 'B', link: 'https://a.b/news/2', pubDate: age(20) }),
      store.makeItem({ feed: other, title: 'C', link: 'https://c.d/news/3', pubDate: age(30) }),
    ]);

    assert.equal(await store.countItems(), 3);

    await store.clearAllItems();

    assert.equal(await store.countItems(), 0, 'the shelf is empty, of every feed at once');
    assert.deepEqual((await store.getFeeds()).map((feed) => feed.id), ['f1', 'f2'], 'the feeds stay configured: the reader cleared its headlines, not what it reads');
    assert.deepEqual(await store.getSettings(), { sound_enabled: false }, 'and so do its settings');

    assert.equal((await store.getRead()).length, 3, 'every headline the reader threw away is remembered as one it has had');

    const kept = await store.addItems([
      store.makeItem({ feed: one, title: 'A', link: 'https://a.b/news/1', pubDate: age(1) }),
      store.makeItem({ feed: other, title: 'C', link: 'https://c.d/news/3', pubDate: age(1) }),
    ]);
    assert.deepEqual(kept, { added: 0, skipped: 2, seen: 2 }, 'so the next poll of the same feed does not hand them all back as news');
    assert.equal(await store.countItems(), 0);

    /* «Clear all» of a shelf that is already empty has nothing to remember, and inventing a marker for
     * nothing is how the read list fills with records no headline ever matches. */
    await store.clearAllItems();
    assert.equal((await store.getRead()).length, 3, 'the markers are the ones the headlines made, not one more for an empty shelf');

    await store.clearRead();
    assert.deepEqual(await store.addItems([store.makeItem({ feed: one, title: 'A', link: 'https://a.b/news/1', pubDate: age(1) })]), { added: 1, skipped: 0, seen: 1 }, 'and taking the marks off is the way back: the news is offered again');
  } finally {
    forget();
  }
});

test('a guid is stored short: an id of a feed is not a whole article', () => {
  const feed = { id: 'f1', name: 'X', rss_link: 'https://a.b/rss' };
  const long = 'x'.repeat(MAX_SOURCE_ID_CHARS + 400);
  const item = store.makeItem({
    feed,
    title: 't',
    link: 'https://a.b/x',
    sourceId: long,
    sourceIdType: 'guid',
  });

  assert.ok(
    item.sourceId.startsWith(long.slice(0, MAX_SOURCE_ID_CHARS)),
    'the id stays what the feed wrote, as far as the guard keeps it',
  );
  assert.equal(
    item.sourceId,
    `${long.slice(0, MAX_SOURCE_ID_CHARS)}${SOURCE_ID_CUT}${fingerprint(long)}`,
    'the cut is marked, and the fingerprint of the whole id goes with it',
  );
  assert.equal(item.uid, `f1|${item.sourceId}`);

  const next = store.makeItem({ feed, title: 't', link: 'https://a.b/y', sourceId: long, sourceIdType: 'guid' });
  assert.equal(next.sourceId, item.sourceId, 'one id is shortened to one id: the next poll knows its news');

  const neighbour = store.makeItem({ feed, title: 'u', link: 'https://a.b/z', sourceId: `${long}1`, sourceIdType: 'guid' });
  assert.notEqual(neighbour.sourceId, item.sourceId, 'the cut does not merge two ids that differ only past it');

  assert.equal(shortenSourceId(' tag-42 '), 'tag-42', 'an id within the guard is kept whole');
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

test('a JSON body is not read as a page that declares a charset inside it', () => {
  // Cyrillic spelled the way UTF-8 spells it, inside a JSON string that talks about a Windows-1251 page.
  const json = `{"title":"${CYRILLIC_HEADLINE}","content_html":"<meta charset=\"windows-1251\">"}`;
  const read = encoding.decodeResponseBytes(new TextEncoder().encode(json), 'application/json');

  assert.equal(read.declared, null, 'JSON declares no encoding of its bytes');
  assert.equal(read.encoding, 'utf-8');
  assert.ok(read.text.includes(CYRILLIC_HEADLINE), 'the headline is not read through someone else\'s charset');
});

/* ---------------------------- JSON Feed ---------------------------- */

/** The sample of the format the reader meets: JSON Feed 1.1, written the way a real one is written. */
const JSON_FEED = fs.readFileSync(new URL('../examples/example_json_feed.json', import.meta.url), 'utf8');

/** What a call throws, instead of what it returns. */
function thrownBy(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

/** An answer of a feed server that is JSON: `feedResponse` with the type the site really writes. */
async function readAnswer(contentType, body) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    feedResponse({ headers: { 'content-type': contentType }, body });
  try {
    return await rss.fetchFeed('https://a.b/feed');
  } finally {
    if (realFetch) globalThis.fetch = realFetch;
    else delete globalThis.fetch;
  }
}

test('the reader asks for JSON Feed and tells it from an XML feed', () => {
  const asked = rss.conditionalHeaders();
  assert.ok(asked.Accept.includes('application/feed+json'), 'the read names the format it can read');
  assert.ok(asked.Accept.includes('application/json'), 'and the type many sites serve it under');

  assert.ok(rss.isJsonType('application/feed+json'), 'the type the format registers for itself');
  assert.ok(rss.isJsonType('application/feed+json; charset=utf-8'), 'the charset does not hide it');
  assert.ok(rss.isJsonType('  Application/JSON  '), 'a header is matched whatever its case');
  assert.ok(!rss.isJsonType('application/jsonfeed'), 'a type is matched whole, not by prefix');
  assert.ok(!rss.isJsonType('application/rss+xml'), 'XML stays XML');
  assert.ok(!rss.isJsonType(''), 'an answer that names nothing is not JSON');

  assert.ok(rss.looksLikeJson('  \n{"items":[]}'), 'a body that opens like an object');
  assert.ok(!rss.looksLikeJson('[{"id": 1}]'), 'an array is not a feed: JSON Feed puts its items in an object');
  assert.ok(!rss.looksLikeJson('<?xml version="1.0"?><rss/>'));

  assert.ok(rss.isJsonFeed('{"items": []}', 'text/html'), 'the body decides whatever the header says');
  assert.ok(rss.isJsonFeed('{"items": []}', ''), 'and an answer that names nothing is read by its body');
  assert.ok(rss.isJsonFeed('{"items": []}', 'application/rss+xml'), 'even against a header that says XML');
  assert.ok(
    !rss.isJsonFeed('<rss><channel/></rss>', 'application/json'),
    'a site answering `application/json` over an ordinary RSS document is a feed, not a failure',
  );
  assert.ok(!rss.isJsonFeed('<?xml version="1.0"?><rss/>', 'application/feed+json'));
});

test('a JSON Feed item becomes the same entry an <item> becomes', () => {
  const feed = rss.parseJsonFeed(JSON_FEED, 'https://multfilmy.example/feed.json');

  assert.equal(feed.feedTitle, 'Короткометражные мультфильмы');
  assert.equal(feed.entries.length, 3);

  const [html, text, noTitle] = feed.entries;

  assert.deepEqual(
    {
      title: html.title,
      pubDate: html.pubDate,
      link: html.link,
      sourceId: html.sourceId,
      sourceIdType: html.sourceIdType,
    },
    {
      title: 'Коллекция короткометражных мультфильмов (1984-2011) BDRip',
      pubDate: '2026-10-12T09:32:48+03:00',
      link: 'https://multfilmy.example/news/1041',
      sourceId: 'https://multfilmy.example/news/1041',
      sourceIdType: 'json:id',
    },
  );
  assert.ok(
    html.description.includes('<img src="https://multfilmy.example/img/pixarddda35886b18e856.jpg"'),
    'content_html is kept as it is written: the preview picture of the item survives',
  );

  // An `id` that is not an address is kept the way the feed wrote it; a relative `url` is resolved
  // from the feed address, exactly as a relative `<link>` is.
  assert.deepEqual(
    { sourceId: text.sourceId, sourceIdType: text.sourceIdType, link: text.link },
    { sourceId: '1042', sourceIdType: 'json:id', link: 'https://multfilmy.example/news/1042' },
  );
  assert.equal(text.pubDate, '2026-10-11T21:04:00Z', 'date_modified stands in for a date_published the feed omits');
  assert.equal(
    text.description,
    '<p><img src="https://multfilmy.example/img/multfilm-goda.jpg" alt="" /></p><p>Обычный текст без разметки: он становится одним абзацем, а его &lt;угловые скобки&gt; не читаются как HTML.</p>',
    'content_text is plain text: it is put in a paragraph, its markup characters stay text, and the picture the item states leads it',
  );

  // An item with no title is still a headline: the reader labels an empty one in its own language.
  assert.equal(noTitle.title, '');
  assert.ok(
    noTitle.description.includes('<p>Заголовок без title: читалка подписывает его своим словом.</p>'),
    'the text of the item is still there, behind its picture',
  );
});

test('the pictures a JSON Feed item states outside its text become its preview picture', () => {
  const [html, image, poster] = rss.parseJsonFeed(JSON_FEED, 'https://multfilmy.example/feed.json').entries;

  // `image` written as a plain address: it becomes the tag a preview picture has to be, and it leads
  // the description the way the picture of a usual <description> leads it.
  assert.ok(
    image.description.startsWith('<p><img src="https://multfilmy.example/img/multfilm-goda.jpg" alt="" /></p>'),
    'the item that ships no picture in its text is not left without one',
  );

  // An attachment that names no `mime_type` is an image — `image/jpeg` is the default JSON Feed gives
  // it — and its relative `url` is resolved from the feed, as a relative `<link>` is. `title_text`
  // becomes the alternative text of the picture, with its own ampersand escaped.
  assert.ok(
    poster.description.includes('<img src="https://multfilmy.example/img/poster-1043.jpg" alt="Постер &amp; кадр" />'),
    'an image attachment of an item that states no image is a preview picture too',
  );
  assert.ok(!poster.description.includes('audio/1043.mp3'), 'an audio attachment has nothing to show in a preview');

  // The picture the item already ships inside its `content_html` is not shipped a second time.
  assert.equal((html.description.match(/<img\b/g) ?? []).length, 1, 'one picture of one news, however the feed spelled it');

  const once = rss.parseJsonFeed(
    JSON.stringify({
      items: [
        {
          id: 'tag:7',
          url: 'https://a.b/x',
          content_html: '<p><img src="https://a.b/i.jpg" /></p>',
          attachments: [
            // The feed says this one already stands in the content.
            { url: 'https://a.b/i.jpg', mime_type: 'image/jpeg', in_feed: true },
            // And this one repeats the address without saying so.
            { url: 'https://a.b/i.jpg', mime_type: 'image/jpeg' },
            { url: 'mailto:someone@a.b', title_text: 'not a picture at all' },
          ],
        },
      ],
    }),
    'https://a.b/feed.json',
  );
  assert.equal((once.entries[0].description.match(/<img\b/g) ?? []).length, 1, 'neither an `in_feed` attachment nor a repeated address adds a picture');
  assert.ok(!once.entries[0].description.includes('mailto:'), 'only a picture the reader can load is worth a tag');

  const record = store.makeItem({
    feed: { id: 'jf', name: 'JSON', rss_link: 'https://multfilmy.example/feed.json' },
    title: 'Картинка',
    link: 'https://multfilmy.example/news/1042',
    description: image.description,
  });
  assert.ok(
    record.description.includes('<img src="https://multfilmy.example/img/multfilm-goda.jpg" alt="" width="180" height="240"'),
    'the picture a JSON Feed stated reaches storage in the same box the reader gives every other one',
  );
});

test('sourceIdentity names a JSON Feed headline by the id the feed states', () => {
  assert.deepEqual(
    rss.sourceIdentity({ link: 'https://a.b/x', jsonId: 'tag:42' }),
    { sourceId: 'tag:42', sourceIdType: 'json:id' },
    'an opaque id is kept whole',
  );
  assert.deepEqual(
    rss.sourceIdentity({ link: 'https://a.b/x', jsonId: 'http://www.a.b/x?utm_source=feed#1' }),
    { sourceId: 'https://a.b/x', sourceIdType: 'json:id' },
    'an id that is an address is read the way a link is read',
  );
  assert.deepEqual(
    rss.sourceIdentity({ link: 'https://a.b/x', jsonId: '' }),
    { sourceId: 'https://a.b/x', sourceIdType: 'link' },
    'an item with no id is its link',
  );
  assert.deepEqual(
    rss.sourceIdentity({ link: 'https://a.b/x', guid: 'g1', guidIsLink: false, jsonId: 'j1' }),
    { sourceId: 'g1', sourceIdType: 'guid' },
    'the id of the format the document is written in wins; JSON Feed has no guid to win with',
  );

  const item = store.makeItem({
    feed: { id: 'jf', name: 'JSON', rss_link: 'https://a.b/feed.json' },
    title: 't',
    link: 'https://a.b/x',
    sourceId: 'tag:42',
    sourceIdType: 'json:id',
  });
  assert.deepEqual(
    { sourceId: item.sourceId, sourceIdType: item.sourceIdType },
    { sourceId: 'tag:42', sourceIdType: 'json:id' },
    'the record keeps the id the JSON Feed gave its news',
  );
});

test('two items one JSON Feed calls the same news are one headline, and a long feed is capped', () => {
  const repeated = rss.parseJsonFeed(
    JSON.stringify({
      title: 'Repeated',
      items: [
        { id: 'tag:42', url: 'https://a.b/one', title: 'A' },
        { id: 'tag:42', url: 'https://a.b/two', title: 'A, once more' },
        { id: 43, url: 'https://a.b/three', title: 'B' },
        { id: 'tag:42', url: 'https://a.b/one', title: 'A, again' },
        { id: 'no url, no id', title: 'nothing to open' },
        null,
      ],
    }),
    'https://a.b/feed.json',
  );

  assert.deepEqual(
    repeated.entries.map((entry) => entry.link),
    ['https://a.b/one', 'https://a.b/three'],
    'the dedup of one response is the same rule the XML loop applies',
  );
  assert.deepEqual(
    repeated.entries.map((entry) => entry.sourceIdType),
    ['json:id', 'json:id'],
    'a numeric id is kept as the feed wrote it',
  );

  const many = { title: 'Many', items: [] };
  for (let i = 0; i < 260; i += 1) many.items.push({ id: `item-${i}`, url: `https://a.b/${i}` });
  assert.equal(rss.parseJsonFeed(JSON.stringify(many), 'https://a.b/feed.json').entries.length, 250);
});

test('a long feed is cut at its newest headlines, not at whatever it listed first', () => {
  /* A WordPress archive, a forum, a blog in ascending order: the feed ships its oldest news first.
   * Cutting the list where the document ends would keep 250 old headlines and drop the fresh ones —
   * while `storage.capPerFeed` happily stores 250 newest, so they would never be seen. */
  const archive = { title: 'Archive', items: [] };
  for (let i = 0; i < 260; i += 1) {
    archive.items.push({
      id: `item-${i}`,
      url: `https://a.b/${i}`,
      title: `News ${i}`,
      date_published: new Date(Date.UTC(2024, 0, 1) + i * DAY).toISOString(),
    });
  }

  const kept = rss.parseJsonFeed(JSON.stringify(archive), 'https://a.b/feed.json').entries;

  assert.equal(kept.length, 250);
  assert.equal(kept[0].title, 'News 259', 'the newest news, however late the feed listed it');
  assert.equal(kept.at(-1).title, 'News 10', 'the cut drops the oldest news, not the freshest');

  const times = kept.map((entry) => util.pubDateTime(entry.pubDate));
  assert.deepEqual([...times], [...times].sort((a, b) => b - a), 'the parser hands the newest first, as storage sorts them');
});

test('a feed gives no age to an entry it dates badly, and such entries keep their order', () => {
  const parsed = rss
    .parseJsonFeed(
      JSON.stringify({
        title: 'Mixed',
        items: [
          { id: 'undated-1', url: 'https://a.b/undated-1', title: 'Undated one' },
          { id: 'dated', url: 'https://a.b/dated', title: 'Dated', date_modified: '2024-05-01T00:00:00Z' },
          { id: 'undated-2', url: 'https://a.b/undated-2', title: 'Undated two' },
          { id: 'bad-date', url: 'https://a.b/bad', title: 'Bad date', date_published: 'not a date' },
        ],
      }),
      'https://a.b/feed.json',
    )
    .entries.map((entry) => entry.title);

  assert.deepEqual(parsed, ['Dated', 'Undated one', 'Undated two', 'Bad date']);
});

test('a JSON document that is not a feed fails with a code every language translates', () => {
  for (const body of ['{ not json', '{"title": "no items"}', '{"items": {}}', '[{"id": 1}]']) {
    const error = thrownBy(() => rss.parseJsonFeed(body, 'https://a.b/feed.json'));
    assert.ok(error instanceof rss.FeedError, body);
    assert.equal(error.code, 'feedNotJson', body);
  }

  assert.deepEqual(
    rss.parseJsonFeed('{"title": "Empty", "items": []}', 'https://a.b/feed.json').entries,
    [],
    'a feed that ships nothing right now is a feed, not a failure',
  );
});

test('the type of the answer decides the parser: JSON Feed, and a site that lies about its type', async () => {
  const declared = await readAnswer('application/feed+json; charset=utf-8', JSON_FEED);
  assert.equal(declared.feedTitle, 'Короткометражные мультфильмы');
  assert.equal(declared.entries.length, 3);
  assert.equal(declared.entries[0].sourceIdType, 'json:id');
  assert.equal(declared.notModified, false, 'a body was read, so the read is not a «nothing changed»');

  const mislabeled = await readAnswer('text/html', JSON_FEED);
  assert.equal(mislabeled.entries.length, 3, 'a body that opens with a brace is read as JSON anyway');
});

test('an answer that is JSON but no feed fails with a code of its own', async () => {
  const broken = await readAnswer('application/feed+json', '{ "items": [').then(
    () => null,
    (caught) => caught,
  );
  assert.ok(broken instanceof rss.FeedError);
  assert.equal(broken.code, 'feedNotJson', 'the page is told the answer was not a feed, in its own language');

  const error = await readAnswer('application/feed+json', '{"title": "an API answer, not a feed"}').then(
    () => null,
    (caught) => caught,
  );
  assert.equal(error.code, 'feedNotJson', 'a JSON object with no `items` is not read as an empty feed');
});

/* ---------------------- an XML answer that is not a feed ---------------------- */

/**
 * An XML document that is not a feed ends like every other failure: with a code of its own, so the
 * settings screen calls the feed broken and `storage.markFeedChecked` starts its pause. Read as «a
 * valid feed with no headlines», the same answer would record the feed healthy and never back off.
 */
test('a document whose root is not a feed is refused; a feed with no headlines is not', () => {
  assert.ok(rss.isFeedDocument('rss', 0), 'a feed that ships nothing right now is a feed, not a failure');
  assert.ok(rss.isFeedDocument('feed', 0), 'the same in Atom');
  assert.ok(rss.isFeedDocument('RDF', 0), 'RDF writes its root `<rdf:RDF>`: the local name is uppercase');
  assert.ok(
    rss.isFeedDocument('html', 3),
    'a document of another root that does carry headlines is read as the feed it behaves like',
  );

  assert.ok(!rss.isFeedDocument('html', 0), 'an error page in XHTML is not an empty feed');
  assert.ok(!rss.isFeedDocument('urlset', 0), 'nor is a sitemap that parsed clean');
  assert.ok(!rss.isFeedDocument('errors', 0), 'nor an API answer that happens to be well-formed XML');
  assert.ok(!rss.isFeedDocument('', 0), 'and a document that names nothing is not a feed either');
});

test('a failed XML parse is recognised whatever namespace the engine reports it in', () => {
  /* Blink answers a document it could not read with a `parsererror` element in a namespace of its own,
   * where a CSS type selector does not reach it. The guard is the lookup the parser itself uses. */
  const source = fs.readFileSync(new URL('../src/lib/rss.js', import.meta.url), 'utf8');

  assert.ok(!/querySelector\(\s*['"]parsererror/.test(source), 'no namespace-bound selector looks for the failure');
  assert.ok(/localName === 'parsererror'/.test(source), 'the root the processor left behind is read directly');
  assert.ok(/anyTag\(doc, 'parsererror'\)/.test(source), 'and the tree is searched ignoring namespaces');
});

/* ---------------- an XML feed, read by a DOMParser ---------------- */

/**
 * The tests below these hold the rules of `rss.js` by handing them an element the test made itself, which
 * is enough for what the reader stores from an `<item>`. What no hand-made element can hold is what the XML
 * processor makes of a whole document: the namespace a `<dc:date>` ends up in when only its prefix declares
 * one, the `parsererror` a document that is not well-formed leaves behind, the headlines a duplicated
 * `<guid>` costs. `rss.parseXmlFeed` asks for a `DOMParser` to answer any of that, so these tests run under
 * the small dependency-free DOM of `scripts/fake-dom.mjs` — what the offscreen document hands the parser, and
 * no more of a browser than the assertions here need.
 */
function withDom(run) {
  const uninstall = installDom();
  try {
    return run();
  } finally {
    uninstall();
  }
}

const FEED_BASE = 'https://example.com/feed.xml';

test('an RSS 2.0 document becomes the headlines the reader stores', () => withDom(() => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0">
      <channel>
        <title>  Example  Feed  </title>
        <item>
          <title><![CDATA[Hello <b>world</b>]]></title>
          <description><![CDATA[<p>First <i>news</i></p>]]></description>
          <pubDate>Mon, 06 Oct 2025 09:00:00 GMT</pubDate>
          <link>https://example.com/a1</link>
          <guid isPermaLink="false">tag:example.com,2025:id-1</guid>
        </item>
        <item>
          <title>Second</title>
          <description>Plain second</description>
          <link>/a2</link>
        </item>
        <item>
          <title>The same news again</title>
          <link>https://example.com/a1?utm=rss</link>
          <guid isPermaLink="false">tag:example.com,2025:id-1</guid>
        </item>
      </channel>
    </rss>`;

  const { feedTitle, entries } = rss.parseFeed(xml, FEED_BASE);

  assert.equal(feedTitle, 'Example Feed', 'the name of the feed is read out of the document, its markup and its doubled spaces gone');
  assert.equal(entries.length, 2, 'the feed ships one news twice, under two addresses: the `<guid>` calls them one news, so the reader is shown it once');

  assert.equal(entries[0].title, 'Hello world', 'the headline is read out of the CDATA of the title, markup gone');
  assert.equal(entries[0].description, '<p>First <i>news</i></p>', 'and the description keeps its markup: a CDATA block is text of the document, not an escaped one');
  assert.equal(entries[0].pubDate, 'Mon, 06 Oct 2025 09:00:00 GMT', 'the date of the item is the one its `<pubDate>` states');
  assert.equal(entries[0].link, 'https://example.com/a1', 'a link that is already absolute is kept as it is');
  assert.deepEqual(
    { sourceId: entries[0].sourceId, sourceIdType: entries[0].sourceIdType },
    { sourceId: 'tag:example.com,2025:id-1', sourceIdType: 'guid' },
    'a `<guid isPermaLink="false">` is an id of the feed, not an address, and it is kept beside the link',
  );

  assert.equal(entries[1].link, 'https://example.com/a2', 'a site that writes its links short is completed against the address of the feed');
  assert.deepEqual(
    { sourceId: entries[1].sourceId, sourceIdType: entries[1].sourceIdType },
    { sourceId: 'https://example.com/a2', sourceIdType: 'link' },
    'an item that states no id is named by the address of its page',
  );
}));

test('an Atom document keeps the namespaces its root declares', () => withDom(() => {
  const xml = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      <entry>
        <title type="html">Atom &lt;b&gt;entry&lt;/b&gt;</title>
        <id>urn:uuid:1234-5678</id>
        <link href="https://example.com/atom1" rel="alternate"/>
        <link href="https://example.com/feed.xml" rel="self"/>
        <updated>2025-10-06T09:00:00Z</updated>
        <summary>short summary</summary>
        <content type="html">&lt;p&gt;the whole &lt;em&gt;text&lt;/em&gt;&lt;/p&gt;</content>
      </entry>
    </feed>`;

  const { feedTitle, entries } = rss.parseFeed(xml, FEED_BASE);

  assert.equal(feedTitle, 'Atom Feed', 'a feed whose tags carry no prefix is still read, because its root declared the default namespace');
  assert.equal(entries.length, 1);

  const [entry] = entries;
  assert.equal(entry.link, 'https://example.com/atom1', 'the address of the news is the `rel="alternate"` link, not the `rel="self"` one that points back at the feed');
  assert.equal(entry.description, '<p>the whole <em>text</em></p>', 'the whole text of `<content>` wins over the `<summary>`, and its escaped markup is markup again');
  assert.equal(entry.title, 'Atom entry', 'a `<title type="html">` is read as the text under its markup');
  assert.deepEqual(
    { sourceId: entry.sourceId, sourceIdType: entry.sourceIdType },
    { sourceId: 'urn:uuid:1234-5678', sourceIdType: 'atom:id' },
    'the id of an Atom entry is kept even where it is no address at all',
  );
}));

test('an RDF feed reaches the parser through its prefixed root and its Dublin Core date', () => withDom(() => {
  const xml = `<?xml version="1.0"?>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
             xmlns:dc="http://purl.org/dc/elements/1.1/"
             xmlns="http://purl.org/rss/1.0/">
      <title>RDF Feed</title>
      <item rdf:about="https://example.com/rdf1">
        <title>RDF news</title>
        <link>https://example.com/rdf1</link>
        <description>RDF body</description>
        <dc:date>2025-10-05T00:00:00Z</dc:date>
      </item>
    </rdf:RDF>`;

  const { feedTitle, entries } = rss.parseFeed(xml, FEED_BASE);

  assert.equal(feedTitle, 'RDF Feed');
  assert.equal(entries.length, 1, 'the root of an RDF feed is `<rdf:RDF>`: the parser reads the headlines out of it whatever it calls the root');
  assert.equal(entries[0].pubDate, '2025-10-05T00:00:00Z', 'an RDF feed dates its news with `<dc:date>`: the namespace the `dc:` prefix declares is what lets the parser find it');
}));

test('the whole text a WordPress feed ships in another namespace leads its headline', () => withDom(() => {
  const xml = `<rss><channel>
      <title>WP</title>
      <item>
        <title>WP post</title>
        <link>https://example.com/wp</link>
        <description>Short excerpt.</description>
        <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/">&lt;p&gt;The whole post.&lt;/p&gt;</content:encoded>
      </item>
    </channel></rss>`;

  const [entry] = rss.parseFeed(xml, FEED_BASE).entries;

  assert.equal(entry.description, '<p>The whole post.</p>', 'the excerpt of a site that ships its whole text in `<content:encoded>` is not what the reader shows');
}));

test('the pictures a Media RSS entry states lead its preview through the parser too', () => withDom(() => {
  const xml = `<rss><channel>
      <title>Media</title>
      <item>
        <title>With pictures</title>
        <link>https://example.com/m</link>
        <description>body text</description>
        <media:thumbnail xmlns:media="http://search.yahoo.com/mrss/" url="https://cdn.example/thumb.jpg"/>
        <media:content xmlns:media="http://search.yahoo.com/mrss/" url="https://cdn.example/sound.mp3" type="audio/mpeg"/>
        <media:content xmlns:media="http://search.yahoo.com/mrss/" url="https://cdn.example/full.png" type="image/png" medium="image"/>
      </item>
    </channel></rss>`;

  const [entry] = rss.parseFeed(xml, FEED_BASE).entries;

  assert.ok(
    entry.description.startsWith('<p><img src="https://cdn.example/thumb.jpg" alt="" /><img src="https://cdn.example/full.png" alt="" /></p>'),
    'the `<media:thumbnail>` and the image `<media:content>` both lead the text, in the order the reader shows them',
  );
  assert.ok(!entry.description.includes('sound.mp3'), 'the audio an entry carries has nothing to show in a preview');
  assert.ok(entry.description.endsWith('body text'), 'and the text of the entry stays under them');
}));

test('a document the XML processor could not read is refused as a broken feed', () => withDom(() => {
  /* One tag closed under another, which is the mistake a hand-made element cannot make: it has no
   * processor to disagree with. Read as a feed, the answer would parse as one with no headlines, the feed
   * would be recorded healthy and its backoff would never start. */
  assert.throws(
    () => rss.parseFeed('<?xml version="1.0"?>\n<rss><channel><item><title>broken</link></item></channel></rss>', FEED_BASE),
    (error) => {
      assert.ok(error instanceof rss.FeedError);
      assert.equal(error.code, 'feedNotXml', 'the failure names the key every language of the reader translates');
      return true;
    },
  );

  assert.throws(
    () => rss.parseFeed('<?xml version="1.0"?><rss><channel><item><title>unclosed', FEED_BASE),
    (error) => error.code === 'feedNotXml',
    'the same for a document that simply stops in the middle',
  );
}));

test('a page in place of a feed is refused by the parser, with a code of its own', () => withDom(() => {
  /* `isFeedDocument` decides this from a root name and a headline count; here it is decided by what a
   * site actually answers when its address is not a feed at all — the HTML page of the site, or an
   * ordinary XML document of another kind. */
  for (const [label, body] of [
    ['an error page in HTML', '<!DOCTYPE html>\n<html><body><p>Not found</p></body></html>'],
    ['a sitemap', '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>'],
  ]) {
    assert.throws(
      () => rss.parseFeed(body, FEED_BASE),
      (error) => {
        assert.ok(error instanceof rss.FeedError, `${label} is refused as a failure, not as an empty feed`);
        assert.equal(error.code, 'feedNotFeed');
        return true;
      },
    );
  }

  const empty = rss.parseFeed('<rss><channel><title>Quiet feed</title></channel></rss>', FEED_BASE);
  assert.deepEqual(empty, { feedTitle: 'Quiet feed', entries: [] }, 'a feed that ships nothing right now is a feed: it is read healthy, with no headlines');
}));

/**
 * What `extract.sanitizePreview` ended up with, walked out of the node it rebuilt: `scripts/fake-dom.mjs`
 * keeps no `outerHTML`, so the tree the reader page is about to insert is shown tag by tag instead.
 */
function previewShape(node) {
  if (node === null) return null;
  if (node.nodeType === 3) return JSON.stringify(node.nodeValue);
  const attrs = node.getAttributeNames().map((name) => `${name}="${node.getAttribute(name)}"`).join(' ');
  const children = node.childNodes.map(previewShape).join('');
  const lazy = node.tagName === 'img' && node.loading === 'lazy' ? '[lazy]' : '';
  return `<${node.tagName}${attrs ? ` ${attrs}` : ''}>${children}</${node.tagName}>${lazy}`;
}

test('the HTML of a feed description is rebuilt as the safe subset the reader may insert', () => withDom(() => {
  const { node, truncated } = extract.sanitizePreview(
    '<p>Safe  text</p>\n    <script>alert(1)</script><style>p{}</style>\n'
    + '<a href="javascript:alert(1)">bad link</a>'
    + '<a href="https://ok.example/x" onclick="steal()" title="kept">good link</a>'
    + '<img src="https://img.example/a.jpg" alt="the alt" width="640" height="90">',
  );

  assert.equal(truncated, false);
  assert.equal(node.className, 'preview', 'the container is the one `reader.css` gives its rules to');
  assert.equal(
    previewShape(node),
    '<div>'
    + '<p>"Safe text"</p>'
    + '<a>"bad link"</a>'
    + '<a href="https://ok.example/x" title="kept">"good link"</a>'
    + '<img src="https://img.example/a.jpg" alt="the alt" width="180" height="90"></img>[lazy]'
    + '</div>',
    'no script, no style, no handler: the address a link cannot be given is dropped instead of the link, the picture keeps the box the reader set and is asked for only when the reader is near it',
  );

  assert.equal(
    previewShape(extract.sanitizePreview('<span>wrapped <b>bold</b></span><div>div text</div><table><tr><td>cell</td></tr></table>').node),
    '<div>"wrapped "<b>"bold"</b>"div text""cell"</div>',
    'a tag the reader does not allow is not thrown away with its text: its children are lifted in its place',
  );

  assert.equal(
    previewShape(extract.sanitizePreview('<img src="relative.jpg" alt="nothing to show"><img src="//cdn.example/protocol-free.png">').node),
    '<div><img src="//cdn.example/protocol-free.png"></img>[lazy]</div>',
    'a picture whose address is not http(s) is dropped whole, and one the feed wrote without a protocol is kept as the address it is',
  );

  assert.deepEqual(extract.sanitizePreview('<script>x</script><img src="data:image/png;base64,AAAA">'), { node: null, truncated: false }, 'a description of nothing the reader may show is no preview at all');
  assert.deepEqual(extract.sanitizePreview(''), { node: null, truncated: false });
  assert.deepEqual(extract.sanitizePreview(null), { node: null, truncated: false });

  assert.equal(extract.sanitizePreview('<p>cut off… ]</p>').truncated, true, 'a description the feed cut short says so, and the reader offers its link out');
}));

/* ---------------- the fields of one XML entry ---------------- */

/**
 * An element of a feed, made without a DOM. `rss.entryDate`, `rss.entryDescription` and
 * `rss.entryImages` ask a node only what a node answers — `children`, `localName`, `namespaceURI`,
 * `textContent`, `getAttribute` — so the rules that decide what the reader stores from an `<item>` can
 * be held here instead of only in the browser.
 */
function el(localName, { ns = null, text = '', attrs = {}, children = [] } = {}) {
  return {
    localName,
    namespaceURI: ns,
    textContent: text,
    children,
    getAttribute: (name) => attrs[name] ?? null,
  };
}

const ATOM_NS = 'http://www.w3.org/2005/Atom';
const CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/';
const MEDIA_NS = 'http://search.yahoo.com/mrss/';
const DC_NS = 'http://purl.org/dc/elements/1.1/';

/**
 * An RDF feed dates its news with `<dc:date>` and writes no `<pubDate>` at all. Read as having no
 * date, the headline reaches storage with `pubDate: ''`, `util.itemTime` answers its load time, and
 * `clean_timeout` counts from the poll that happened to read the feed — a news published a week ago is
 * kept a fresh week longer, and one the feed shipped years ago is kept as long as the reader has known
 * it.
 */
test('the date of an XML entry is the Dublin Core date of an RDF feed', () => {
  const rdf = el('item', {
    children: [
      el('title', { text: 'A news of an RDF feed' }),
      el('date', { ns: DC_NS, text: '2026-10-11T09:08:32+03:00' }),
    ],
  });

  const published = util.pubDateTime(rss.entryDate(rdf));
  assert.equal(published, Date.parse('2026-10-11T09:08:32+03:00'), 'the date is read, not invented');

  const loadedAWeekLater = { pubDate: rss.entryDate(rdf), time: published + 7 * DAY };
  assert.equal(util.itemTime(loadedAWeekLater), published, 'its age counts from the publication');
  assert.ok(
    util.isExpired(loadedAWeekLater, { clean_timeout: 7 * 24 * 60 }, published + 8 * DAY),
    'so a feed of one week ago is expired one week after its news was published, not after the poll',
  );

  /* The same date under the stricter of the two Dublin Core namespaces, and the RSS/Atom dates asked
   * before it: an RDF feed that states both is dated by the one its format calls the publication. */
  assert.equal(rss.entryDate(el('item', { children: [el('issued', { ns: DC_NS, text: '2026-01-02' })] })), '2026-01-02');
  assert.equal(
    rss.entryDate(el('item', { children: [el('date', { ns: DC_NS, text: 'dc' }), el('pubDate', { text: 'rss' })] })),
    'rss',
    'a feed that states its own date is dated by it',
  );
  assert.equal(rss.entryDate(el('entry', { children: [el('updated', { ns: ATOM_NS, text: 'atom' })] })), 'atom');
  assert.equal(rss.entryDate(el('item', { children: [el('title', { text: 'no date here' })] })), '', 'no date is invented');
});

/**
 * A WordPress feed ships the whole post in `content:encoded` and an excerpt in `<description>`. Asked
 * in the other order, the reader stores the excerpt and never shows the text the feed really shipped.
 */
test('the full text of an entry wins over its excerpt', () => {
  const wordpress = el('item', {
    children: [
      el('title', { text: 'A post' }),
      el('description', { text: 'Short excerpt.' }),
      el('encoded', { ns: CONTENT_NS, text: '<p>The whole post.</p>' }),
    ],
  });
  assert.equal(rss.entryDescription(wordpress), '<p>The whole post.</p>');

  assert.equal(
    rss.entryDescription(el('item', { children: [el('description', { text: 'Only an excerpt.' })] })),
    'Only an excerpt.',
    'a feed that ships nothing but an excerpt is read by its excerpt',
  );
  assert.equal(
    rss.entryDescription(el('entry', { children: [el('summary', { ns: ATOM_NS, text: 'Atom excerpt.' })] })),
    'Atom excerpt.',
  );
  assert.equal(
    rss.entryDescription(el('entry', { children: [
      el('summary', { ns: ATOM_NS, text: 'excerpt' }),
      el('content', { ns: ATOM_NS, text: '<p>Atom full text.</p>' }),
    ] })),
    '<p>Atom full text.</p>',
    'the `<content>` of an Atom entry is its text',
  );

  /* `<media:content>` shares the local name of the Atom text element and carries no text at all: asked
   * by name alone it answers «no text» and the excerpt the feed wrote stays unread. */
  const media = el('item', {
    children: [
      el('description', { text: 'The excerpt of a media feed.' }),
      el('content', { ns: MEDIA_NS, attrs: { url: 'https://cdn.example/a.jpg', medium: 'image' } }),
    ],
  });
  assert.equal(rss.entryDescription(media), 'The excerpt of a media feed.', 'a picture is not the text of a news');

  assert.equal(
    rss.entryDescription(el('item', { children: [el('content', { ns: 'http://turbo.yandex.ru', text: 'text of a turbo feed' })] })),
    'text of a turbo feed',
    'a full text of a feed that names it its own way is still read',
  );
  assert.equal(rss.entryDescription(el('item', { children: [] })), '', 'an entry with no text has none');
});

/**
 * The preview picture of this reader is an `<img>` inside `description` and nothing else, so the
 * pictures a media feed states in attributes have to become tags here, in the parser.
 */
test('the pictures a Media RSS entry states become its preview', () => {
  const feedLink = 'https://example.com/news/a';

  const withThumbnail = el('item', {
    children: [
      el('description', { text: '<p>Text of a media news.</p>' }),
      el('thumbnail', { ns: MEDIA_NS, attrs: { url: 'https://cdn.example/preview.jpg' } }),
    ],
  });
  assert.equal(
    rss.entryDescription(withThumbnail),
    '<p>Text of a media news.</p>',
    'the text of the feed is not moved by the picture',
  );
  assert.equal(
    rss.entryImages(withThumbnail, feedLink, rss.entryDescription(withThumbnail)),
    '<p><img src="https://cdn.example/preview.jpg" alt="" /></p>',
  );

  /* A feed that groups its media writes neither element under `<item>`: a search over the direct
   * children finds no picture and no text in such an entry. */
  const grouped = el('item', {
    children: [
      el('group', { ns: MEDIA_NS, children: [
        el('content', { ns: MEDIA_NS, attrs: { url: '/media/preview.jpg', medium: 'image', title: 'The picture' } }),
        el('description', { ns: MEDIA_NS, text: '<p>Text inside a media group.</p>' }),
      ] }),
    ],
  });
  assert.equal(rss.entryDescription(grouped), '<p>Text inside a media group.</p>', 'media text is read from inside the group');
  assert.equal(
    rss.entryImages(grouped, feedLink, rss.entryDescription(grouped)),
    '<p><img src="https://example.com/media/preview.jpg" alt="The picture" /></p>',
    'a relative picture is resolved from the page of the news, which is where a media feed writes it',
  );

  const video = el('item', {
    children: [
      el('content', { ns: MEDIA_NS, attrs: { url: 'https://cdn.example/clip.mp4', medium: 'video' } }),
      el('content', { ns: MEDIA_NS, attrs: { url: 'https://cdn.example/frame.jpg', type: 'image/jpeg' } }),
      el('content', { ns: MEDIA_NS, attrs: { url: 'https://cdn.example/no-type.jpg' } }),
    ],
  });
  assert.equal(
    rss.entryImages(video, feedLink, ''),
    '<p><img src="https://cdn.example/frame.jpg" alt="" /><img src="https://cdn.example/no-type.jpg" alt="" /></p>',
    'a video is not a preview; a picture that names no type is one',
  );

  const repeats = el('item', {
    children: [
      el('thumbnail', { ns: MEDIA_NS, attrs: { url: 'https://cdn.example/a.jpg' } }),
      el('thumbnail', { ns: MEDIA_NS, attrs: { url: 'https://cdn.example/a.jpg' } }),
      el('thumbnail', { ns: MEDIA_NS, attrs: { url: 'data:image/png;base64,AAA' } }),
      el('thumbnail', { ns: MEDIA_NS, attrs: { width: '120' } }),
    ],
  });
  assert.equal(
    rss.entryImages(repeats, feedLink, ''),
    '<p><img src="https://cdn.example/a.jpg" alt="" /></p>',
    'one picture once, and an element that states no address is no picture',
  );

  assert.equal(
    rss.entryImages(repeats, feedLink, 'the text already carries https://cdn.example/a.jpg'),
    '',
    'a picture the text of the entry already shows is not put in front of it a second time',
  );

  const mediaTitleOnly = el('item', { children: [el('content', { ns: 'http://other.example', attrs: { url: 'https://cdn.example/x.jpg' } })] });
  assert.equal(rss.entryImages(mediaTitleOnly, feedLink, ''), '', 'a picture of another vocabulary is not Media RSS');
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
 * A placeholder belongs to the contract of a key: a dictionary that renames `{count}` or drops
 * `{duration}` leaves the reader with a hole where a number should stand. So every form of a key —
 * plural ones included — fills the same set of placeholders as the base dictionary.
 */
test('every language fills the same placeholders in every form of a key', () => {
  const names = (template) =>
    new Set([...String(template).matchAll(/\{(\w+)\}/g)].map((match) => match[1]));

  const formsOf = (key, lang) => {
    const entry = i18n.dictionaryEntry(key, lang);
    assert.notEqual(entry, undefined, `${lang} does not translate ${key}`);
    return typeof entry === 'string' ? { other: entry } : entry;
  };

  for (const key of i18n.dictionaryKeys(i18n.LANGUAGES[0])) {
    const contract = [...names(formsOf(key, i18n.LANGUAGES[0]).other)].sort();
    for (const lang of i18n.LANGUAGES) {
      for (const [category, template] of Object.entries(formsOf(key, lang))) {
        assert.deepEqual(
          [...names(template)].sort(),
          contract,
          `${key} in ${lang} (${category}) fills other placeholders than the base dictionary does`,
        );
      }
    }
  }
});

/**
 * A count that stands next to its noun cannot be one string: one such string says "1 headlines".
 * These keys carry an object of plural forms, and its categories are ones the language has — with
 * `other` always there, because a category the dictionary omits takes it.
 */
test('a count that agrees with a noun carries plural forms for its language', () => {
  assert.ok(i18n.PLURAL_KEYS.length > 0, 'the reader reports counts, so it has count-bearing keys');

  for (const key of i18n.PLURAL_KEYS) {
    for (const lang of i18n.LANGUAGES) {
      const entry = i18n.dictionaryEntry(key, lang);
      assert.equal(typeof entry, 'object', `${lang} keeps ${key} as one string for every number`);
      const extra = Object.keys(entry).filter(
        (category) => !i18n.PLURAL_CATEGORIES[lang].includes(category),
      );
      assert.deepEqual(extra, [], `${lang} has no plural category "${extra[0]}" for ${key}`);
      assert.equal(
        typeof entry.other,
        'string',
        `${lang} has no "other" form of ${key}, which every omitted category takes`,
      );
    }
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
 * A page and the reader are edited apart as easily as a page and its sprite: a message a page sends
 * that no half of the reader answers hangs that page's `await` forever. A page cannot run in Node, so
 * the name it sends is still compared with what `lib/messages.js` exports — but whether the reader
 * answers it is no longer read off the worker's text (a renamed listener argument is not a broken
 * reader). Every name the module exports is put to the running pair, and the pair answers.
 */
test('every message a page sends is one the reader answers', async () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  const exported = new Set(
    [...read('src/lib/messages.js').matchAll(/export const (MSG_\w+)/g)].map((match) => match[1]),
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
    }
  }

  /* What each name has to carry to be answerable at all, and the value the reader answers it under.
   * A name added to `lib/messages.js` without a question here is a name this test has never put to
   * the reader. */
  const asks = {
    MSG_REFRESH_FEED: [MSG_REFRESH_FEED, { feedId: 'running' }],
    MSG_REFRESH_ALL_FEEDS: [MSG_REFRESH_ALL_FEEDS, {}],
    MSG_FEEDS_CHANGED: [MSG_FEEDS_CHANGED, {}],
    MSG_COUNT: [MSG_COUNT, {}],
    MSG_PLAY_SOUND: [MSG_PLAY_SOUND, { src: 'src/media/ceres.mp3' }],
    MSG_FETCH_FEED: [MSG_FETCH_FEED, { url: 'https://example.com/feed.json' }],
  };

  const reader = runningReader({ storage: { feeds: [runningFeed()] }, server: feedServer() });

  try {
    for (const name of exported) {
      assert.ok(name in asks, `${name} is exported by lib/messages.js but never asked here`);

      const [type, payload] = asks[name];
      const asked = { type, ...payload };
      const answer = (await reader.ask(asked)) ?? (await reader.askDocument(asked));

      assert.notEqual(
        answer,
        null,
        `${name} is a name neither half of the reader answers: the page that sends it waits forever`,
      );
      assert.equal(
        answer.ok,
        true,
        `${name} was answered with a failure: ${JSON.stringify(answer.error ?? answer)}`,
      );
    }
  } finally {
    reader.forget();
  }
});

/**
 * The bodies of the top-level functions of a page script, keyed by whatever each one is called.
 * A page cannot run in Node, so where a test has to look inside one it looks at these bodies: the
 * function a click runs, the one that writes a table, are *found* here instead of being assumed.
 */
function functionsOf(source) {
  const marks = [...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
  return new Map(marks.map((match, i) => [
    match[1],
    source.slice(match.index, i + 1 < marks.length ? marks[i + 1].index : source.length),
  ]));
}

/**
 * The name a page script gives an element its markup declares, looked up through the markup id: the
 * word the page happens to keep it under is the page's own business, the id is the markup's promise.
 */
function nameOfId(source, id) {
  return [...source.matchAll(/(\w+):\s*document\.getElementById\('([^']+)'\)/g)]
    .find((match) => match[2] === id)?.[1] ?? null;
}

/** Does this body call something whose only argument is exactly this name? */
function callOn(body, argument) {
  return [...body.matchAll(/(\w+)\((\w+)\)/g)].some((match) => match[2] === argument);
}

/** `.name` — whatever the page calls the element its markup declares by this id. */
function elementOf(source, id) {
  const key = nameOfId(source, id);
  return key ? `.${key}` : null;
}

/** The name a page gives the storage module it borrows. */
function storeAlias(source) {
  return source.match(/import \* as (\w+) from '\.\/lib\/storage\.js'/)?.[1] ?? null;
}

/** The function a screen speaks through: the one that writes the live line its markup declares. */
function announcerOf(source, id) {
  const line = elementOf(source, id);
  if (!line) return null;
  return [...functionsOf(source)].find(([, body]) => body.includes(`${line}.textContent`))?.[0] ?? null;
}

/**
 * The function a screen falls back to when it has nothing to show: the one that puts its placeholder
 * in place. A page may reach the element it declares through a local alias (`const p = els.slot`),
 * so this follows both the direct `.slot.x` reads and the alias they copy it to, and asks for the
 * placeholder to be shown and written — not merely named, which is what hiding it for an article does.
 */
function placeholderOf(source, id) {
  const name = nameOfId(source, id);
  if (!name) return null;
  return [...functionsOf(source)].find(([, body]) => {
    const touched = new Set([
      ...[...body.matchAll(/els\.([A-Za-z0-9_]+)/g)].map((match) => match[1]),
      ...[...body.matchAll(/\b([A-Za-z0-9_]+)\s*=\s*els\.[A-Za-z0-9_]+/g)].map((match) => match[1]),
    ]);
    if (!touched.has(name)) return false;
    const named = (property) =>
      [...body.matchAll(new RegExp(`\\b([A-Za-z0-9_]+)\\.${property}\\s*=`, 'g'))]
        .some((match) => touched.has(match[1]));
    return named('hidden') || named('textContent');
  })?.[0] ?? null;
}

/**
 * The reader header reads the whole list at once, and picking a feed in the left column puts the
 * middle column on that feed's first headline. `index.js` is the only place either is wired, so the
 * pieces are compared with each other here: the markup id and the name the page maps it to, the
 * function a click runs and the function the `r` key runs, the message the read carries.
 */
test('the header reads every feed and a picked feed opens on its first headline', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const fns = functionsOf(page);

  assert.ok(html.includes('id="btn-load"'), 'the middle column head has no button that reads feeds');
  assert.ok(!html.includes('id="btn-refresh"'), 'the feeds panel head keeps a second button for the same read');

  /* The page knows that button by one name — whatever the markup id is mapped to — and that name is
   * the one the wiring has to answer. */
  const button = page.match(/(\w+):\s*document\.getElementById\('btn-load'\)/)?.[1] ?? null;
  assert.ok(button, 'the page does not know the button the markup declares');

  const wiring = new RegExp(`\\.${button}\\.addEventListener\\('click'[^\\n]*`).exec(page);
  assert.ok(wiring, `the ${button} button is looked up but wired to nothing`);
  const clickRuns = wiring[0].match(/\b(\w+)\(\)/)?.[1] ?? null;
  assert.ok(clickRuns, `a click on the ${button} button runs no function of the page`);

  /* One whole-list read, sent to the worker from exactly one place, reached by that click. */
  const whole = [...fns].filter(([, body]) => /sendMessage\(\s*\{\s*type:\s*MSG_REFRESH_ALL_FEEDS\b/.test(body));
  assert.equal(whole.length, 1, 'the page keeps a second copy of the whole-list read');

  const [readEveryFeed] = whole.map(([name]) => name);
  assert.ok(
    clickRuns === readEveryFeed ||
      (fns.get(clickRuns) ?? '').includes(`${readEveryFeed}(`),
    `the button runs ${clickRuns}, which never asks the worker to read every feed`,
  );

  /* A read the user asked for by hand stays silent, whatever its scope — shown on the running worker
   * («the load signal sounds only on an automatic read that brought headlines»). The `r` key reads
   * the same selection the button reads. */
  const presses = [...page.matchAll(/^\s*case 'r':/gm)];
  assert.equal(presses.length, 1, 'the page answers the r key more than once');
  const starts = [...page.matchAll(/^\s*(?:case |default:)/gm)].map((match) => match.index);
  const keyBody = page.slice(presses[0].index, starts.find((i) => i > presses[0].index) ?? page.length);
  assert.match(keyBody, /preventDefault\(\)/, 'the r key is read as typing in a field');
  assert.ok(
    keyBody.includes(`${clickRuns}()`),
    `the r key does not read the selection the ${button} button reads`,
  );

  /* Picking a feed moves the cursor of the middle column to the first headline of that feed; a feed
   * whose headlines are all gone still has to say so. */
  const picked = chooserOf(page);
  assert.equal(picked.length, 1, 'a picked feed is not taken to its first headline');
});

/** The functions of a page that answer a click on a feed row: they name a selection and open its
 * first headline. */
function chooserOf(page) {
  return [...functionsOf(page)].filter(([, body]) => {
    const first = body.match(/const (\w+) = (?:[\w.]+\(\)|[\w.]+)\[0\];/);
    return Boolean(first) && body.includes('state.feedId =') && callOn(body, first[1]);
  });
}

/**
 * The first row of the left column is not a feed but all of them at once: it has a name of its own,
 * a look of its own, the whole stored list behind it, and it is where the reader opens. `index.js` is
 * the only place the row is built, so its sentinel, the list it selects and the CSS that sets it
 * apart are kept in step here.
 */
test('the left column leads with all feeds, whose headlines are the whole stored list', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const page = read('src/index.js');
  const css = read('src/styles/reader.css');
  const fns = functionsOf(page);

  /* The sentinel is whatever const the page compares its own selection against. */
  const sentinel = [...page.matchAll(/const (\w+) = '([^']+)';/g)].find((match) =>
    page.includes(`state.feedId === ${match[1]}`) || page.includes(`state.feedId !== ${match[1]}`));
  assert.ok(sentinel, 'the reader names no selection that stands for every feed');
  const [, sentinelName, allId] = sentinel;
  /* A stored feed id is a UUID, or `id-<base36>-<base36>` when the generator is missing
   * (`lib/util.js` -> `newId`): a sentinel built that way could be mistaken for a real feed. */
  assert.ok(
    !/^[0-9a-z-]+$/i.test(allId),
    `the sentinel ${allId} is a name a generated feed id could also carry`,
  );

  /* Picking a feed is one function's work; the row of every feeds hands it its sentinel. */
  const choosers = chooserOf(page).map(([name]) => name);
  assert.equal(choosers.length, 1, 'a click on a feed row is the work of more than one function');
  const [chooser] = choosers;

  const rows = [...fns].filter(([, body]) =>
    body.includes("t('reader.feeds.all')") && body.includes(`${chooser}(${sentinelName}`));
  assert.equal(rows.length, 1, 'the left column builds its row above the feeds in more than one place');
  const [rowName] = rows[0];

  const drawn = [...fns].filter(([, body]) => body.includes(`${rowName}(`) && /for \(const \w+ of state\.feeds\)/.test(body));
  assert.equal(drawn.length, 1, 'the row above the feeds is drawn by nobody, or by more than one column');
  const [, drawBody] = drawn[0];
  assert.ok(
    drawBody.indexOf(`${rowName}(`) < drawBody.search(/for \(const \w+ of state\.feeds\)/),
    'the row is drawn among the feeds instead of over them',
  );

  /* The middle column follows the selection: the all-selection is the stored list itself, which
   * `renderAll()` has already put newest first. */
  const [isAll] = [...fns]
    .filter(([, body]) => body.includes(`state.feedId === ${sentinelName}`))
    .map(([name]) => name);
  assert.ok(isAll, 'nothing tells the all-selection apart from a feed');

  const taken = [...fns].filter(([, body]) => /state\.items\.filter\((\w+)\)/.test(body));
  assert.ok(taken.length >= 1, 'the middle column takes its headlines from elsewhere than the stored list');
  const filtered = taken.map(([, body]) => body.match(/state\.items\.filter\((\w+)\)/)[1]);
  assert.ok(
    filtered.some((name) => (fns.get(name) ?? '').includes(`${isAll}(`)),
    'the all-selection is not the stored list of every feed',
  );

  /* The reader opens on that row, not on whichever feed happens to be first. */
  const openings = [...fns].filter(([, body]) => body.includes(`${chooser}(${sentinelName}`));
  assert.equal(openings.length, 2, 'the all-feeds row is chosen by only some of the ways the reader opens');
  assert.ok(!page.includes(`${chooser}(state.feeds[0].id)`), 'the reader still opens on its first feed');

  assert.ok(css.includes('.list-all-feeds'), 'the row is drawn exactly like a feed row');

  const captions = [
    'reader.feeds.all',
    'reader.feeds.allMeta',
    'reader.headlines.emptyAllFeeds',
    'reader.placeholder.deletedLastAll',
  ];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the all-feeds row asks to show`);
    }
  }
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

/** The language a key falls back to is the one `FALLBACK_LANGUAGE` names, not the base dictionary. */
test('a key a language lacks is taken from English', () => {
  const source = fs.readFileSync(new URL('../src/lib/i18n.js', import.meta.url), 'utf8');
  assert.ok(
    !source.includes('DICTIONARIES[LANGUAGES[0]]'),
    'the fallback lookups name FALLBACK_LANGUAGE, not the first dictionary of the list',
  );

  const entry = i18n.dictionaryEntry('settings.status.saved', 'en');
  const forms = typeof entry === 'string' ? { other: entry } : entry;
  assert.ok(
    forms.other.includes('{parts}'),
    'the English dictionary is the one a missing key is taken from: it carries {parts}',
  );
});

/** Categories CLDR gives a whole number: the Slavic languages split 1, 2-4 and 5-20. */
test('a number takes the plural category its language has for it', () => {
  assert.deepEqual(
    [1, 2, 4, 5, 11, 14, 21, 22, 25, 101, 111, 200].map((n) => i18n.pluralCategory('ru', n)),
    ['one', 'few', 'few', 'many', 'many', 'many', 'one', 'few', 'many', 'one', 'many', 'many'],
    'Russian splits 1, 2-4 and 5-20, keeps 21 as one and 11-14 as many',
  );
  assert.deepEqual(
    [1, 2, 5, 21, 22].map((n) => i18n.pluralCategory('uk', n)),
    ['one', 'few', 'many', 'one', 'few'],
    'Ukrainian divides numbers the way Russian does',
  );
  assert.deepEqual(
    [1, 2, 5, 21, 22].map((n) => i18n.pluralCategory('pl', n)),
    ['one', 'few', 'many', 'one', 'few'],
    'Polish divides numbers the same way, without a category of its own for two',
  );
  assert.deepEqual(
    [0, 1, 2].map((n) => i18n.pluralCategory('en', n)),
    ['other', 'one', 'other'],
    'English knows only one and many',
  );
  assert.deepEqual(
    [0, 1, 2].map((n) => i18n.pluralCategory('fr', n)),
    ['one', 'one', 'other'],
    'French counts zero as one: "0 titre"',
  );
  assert.deepEqual(
    [1, 2].map((n) => i18n.pluralCategory('de', n)),
    ['one', 'other'],
    'German knows only one and many',
  );
  assert.equal(i18n.pluralCategory('ru', 1.5), 'other', 'a fraction agrees with no noun');
});

/**
 * Grammar a reader hears: a count next to its noun has to agree with it, and "1 headlines" or
 * "1 dni" is what one string for every number says.
 */
test('a count of one is not written like a count of many', () => {
  const cases = [
    ['en', 'reader.feeds.allMeta', 1, '1 headline'],
    ['en', 'reader.announce.cleared', 1, '1 headline removed'],
    ['en', 'feeds.health.streak', 1, '1 failure in a row'],
    ['de', 'reader.confirmClear', 1, '1 Schlagzeile löschen? Sie wird als gelesen markiert und kommt nicht zurück, solange ihre Markierung lebt.'],
    ['de', 'reader.announce.failed', 1, '1 Feed konnte nicht aktualisiert werden'],
    ['fr', 'reader.feeds.allMeta', 1, '1 titre'],
    ['fr', 'reader.feeds.allMeta', 0, '0 titre'],
    ['fr', 'feeds.health.streak', 1, '1 échec d’affilée'],
    ['es', 'reader.feeds.allMeta', 1, '1 titular'],
    ['es', 'reader.announce.failed', 1, '1 fuente no se pudo actualizar'],
    ['pl', 'reader.feeds.allMeta', 1, '1 nagłówek'],
    ['pl', 'reader.feeds.allMeta', 3, '3 nagłówki'],
    ['pl', 'reader.feeds.allMeta', 5, '5 nagłówków'],
    ['pl', 'settings.ttlDays', 1, '1 dzień', 'days'],
    ['pl', 'settings.ttlDays', 7, '7 dni', 'days'],
    ['ru', 'reader.confirmClear', 1, 'Удалить 1 заголовок? Он будет помечен прочитанным и не вернётся, пока горит его метка.'],
    ['ru', 'reader.confirmClear', 3, 'Удалить 3 заголовка? Они будут помечены прочитанными и не вернутся, пока горят их метки.'],
    ['ru', 'reader.confirmClear', 11, 'Удалить 11 заголовков? Они будут помечены прочитанными и не вернутся, пока горят их метки.'],
    ['uk', 'reader.confirmClear', 1, 'Видалити 1 заголовок? Він буде позначений прочитаним і не повернеться, поки горить його позначка.'],
    ['uk', 'reader.confirmClear', 3, 'Видалити 3 заголовки? Вони будуть позначені прочитаними і не повернуться, поки горять їхні позначки.'],
  ];

  try {
    for (const [lang, key, count, said, name = 'count'] of cases) {
      i18n.adoptLanguage(lang);
      assert.equal(i18n.t(key, { [name]: count }), said, `${lang} says ${key} of ${count} wrong`);
    }
  } finally {
    i18n.adoptLanguage('ru');
  }
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

/* ---------------------------- site icon (favicon) ---------------------------- */

test('iconLinkCandidates reads the favicon a page declares and resolves it against the page', () => {
  const html = `
    <head>
      <link rel="shortcut icon" href="/favicon.ico">
      <link rel="icon" type="image/png" href="/assets/site.png">
      <link rel="apple-touch-icon" sizes="180x180" href="../touch.png">
      <link rel="alternate" href="/other">
      <link rel="icon" href="data:image/png;base64,AAAA">
    </head>`;

  const found = favicon.iconLinkCandidates(html, 'https://example.com/news/rss');
  const byUrl = new Map(found.map((c) => [c.url, c.score]));

  assert.ok(byUrl.get('https://example.com/favicon.ico'), 'a root-relative favicon is put on the site host');
  assert.equal(byUrl.get('https://example.com/assets/site.png'), 3, 'rel="icon" outranks the variants');
  assert.ok(byUrl.has('https://example.com/touch.png'), 'a relative apple-touch-icon resolves too');
  assert.equal(byUrl.get('https://example.com/other'), undefined, 'rel="alternate" is not an icon');
  assert.ok(
    ![...byUrl.keys()].some((url) => url.startsWith('data:')),
    'a data: URI is dropped: only an http(s) link can be drawn from another page',
  );
});

test('feedImageCandidates reads the picture a feed ships in its own XML', () => {
  const xml = `
    <rss><channel>
      <image><url>https://example.com/img/channel.png</url></image>
    </channel></rss>`;
  const atom = `
    <feed>
      <icon><![CDATA[/feed-icon.png]]></icon>
    </feed>`;

  const rss = favicon.feedImageCandidates(xml, 'https://example.com/rss.xml');
  const atomFound = favicon.feedImageCandidates(atom, 'https://example.com/feed.atom');

  assert.deepEqual(
    rss.map((c) => c.url),
    ['https://example.com/img/channel.png'],
    'the RSS channel image is read',
  );
  assert.deepEqual(
    atomFound.map((c) => c.url),
    ['https://example.com/feed-icon.png'],
    'an Atom icon is unwrapped from CDATA and resolved',
  );
});

test('pickIcon prefers the plain favicon, then the feed image, then the fancy variants', () => {
  const best = favicon.pickIcon([
    { score: 2, url: 'https://example.com/touch.png' },
    { score: 3, url: 'https://example.com/favicon.ico' },
    { score: 3, url: 'https://example.com/channel.png' },
  ]);
  assert.equal(best, 'https://example.com/favicon.ico', 'the highest score wins');
  assert.equal(favicon.pickIcon([]), null, 'a page that names no icon has none');
  assert.equal(favicon.pickIcon(null), null, 'no candidates at all is still no icon');
});

test('siteRoot is the site root an icon fallback hangs off', () => {
  assert.equal(favicon.siteRoot('https://example.com/deep/rss.xml'), 'https://example.com/');
  assert.equal(favicon.siteRoot('http://a.b:8080/x'), 'http://a.b:8080/');
  assert.equal(favicon.siteRoot('not a url'), null, 'a link with no origin offers no fallback');
});

/* ------------------------- feed health ------------------------- */

/**
 * A feed carries its own record of the last read: when it was read, whether the read worked, and how
 * many failures ran in a row. `chrome.storage.local` is stood in for here — the fields and their
 * reset are the part a wrong reader display could not be blamed for.
 */
test('a feed remembers its own last read: the streak of failures, its reason, and its reset', async () => {
  const memory = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return key in memory ? { [key]: structuredClone(memory[key]) } : {};
        },
        async set(patch) {
          for (const [key, value] of Object.entries(patch)) memory[key] = structuredClone(value);
        },
      },
    },
  };

  try {
    const base = { id: 'health', name: 'Health', rss_link: 'https://a.b/rss' };
    const [fresh] = await store.upsertFeed(base);
    assert.equal(fresh.lastCheckedAt, undefined, 'a feed nobody has read reports a check it never had');

    await store.markFeedChecked('health', {
      ok: false,
      error: { code: 'httpStatus', params: { status: 404 }, message: 'HTTP 404' },
      time: 1000,
    });
    let feed = (await store.getFeeds())[0];
    assert.equal(feed.lastCheckedAt, 1000, 'the read is dated by the read itself');
    assert.equal(feed.nextAlarmAt, 1000 + 30 * 60000, 'the next check is one feed period after this read');
    assert.equal(feed.fetchFailureCount, 1);
    assert.equal(feed.lastErrorCode, 'httpStatus', 'the reason stays a dictionary key, not its text');
    assert.deepEqual(feed.lastErrorParams, { status: 404 });
    assert.equal(feed.lastErrorMessage, 'HTTP 404');
    assert.equal(
      feed.nextRetryAt,
      1000 + 30 * 60000,
      'one failure only makes the feed miss its own next check',
    );

    await store.markFeedChecked('health', { ok: false, error: 'no route', time: 2000 });
    feed = (await store.getFeeds())[0];
    assert.equal(feed.fetchFailureCount, 2, 'a feed that keeps failing keeps counting');
    assert.equal(feed.lastErrorCode, undefined, 'a failure with no code leaves no stale code behind');
    assert.equal(feed.lastErrorMessage, 'no route');
    assert.equal(
      feed.nextRetryAt,
      2000 + 60 * 60000,
      'the second failure in a row doubles the wait before the feed is asked again',
    );

    await store.markFeedChecked('health', { ok: true, time: 3000 });
    feed = (await store.getFeeds())[0];
    assert.equal(feed.fetchFailureCount, 0, 'a read that worked closes the streak');
    assert.equal(feed.lastOkAt, 3000);
    assert.equal(feed.nextAlarmAt, 3000 + 30 * 60000, 'a healthy feed is still due for its next check');
    assert.equal(feed.nextRetryAt, undefined, 'a feed that answered is not held in its pause');
    assert.equal(feed.lastErrorAt, undefined, 'an old failure is not shown over a feed that now works');
    assert.equal(feed.lastErrorCode, undefined);

    assert.equal(await store.markFeedChecked('gone', { ok: true, time: 4000 }), false, 'a deleted feed writes nothing');

    await store.markFeedChecked('health', { ok: false, error: { code: 'feedUrl', message: 'bad link' }, time: 5000 });
    await store.upsertFeed({ ...base, rss_link: 'https://a.b/new' });
    feed = (await store.getFeeds())[0];
    assert.equal(feed.rss_link, 'https://a.b/new');
    assert.equal(feed.fetchFailureCount, undefined, 'the failures of the old address are not blamed on the new one');
    assert.equal(feed.lastCheckedAt, undefined);
    assert.equal(feed.nextAlarmAt, undefined, 'a schedule kept for the old address is not carried to the new one');
    assert.equal(feed.nextRetryAt, undefined, 'a pause made for the old address does not follow the feed');

    await store.markFeedChecked('health', { ok: false, error: { code: 'feedUrl', message: 'x'.repeat(900) }, time: 6000 });
    feed = (await store.getFeeds())[0];
    assert.ok(feed.lastErrorMessage.length <= 300, 'a stored failure is kept short');
  } finally {
    delete globalThis.chrome;
  }
});

/* ------------------------- reader search & keys ------------------------- */

/**
 * The middle column filters its headlines and the reader answers to the keyboard. Both live only in
 * the page script, so the field the markup declares, the filter that narrows the selection, the keys
 * that move the cursor and the captions they need are kept in step here.
 */
test('the middle column filters its headlines, and the reader answers to the keyboard', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const css = read('src/styles/reader.css');
  const dictionary = read('src/lib/i18n.js');

  assert.ok(html.includes('id="headline-search"'), 'the middle column declares no search field');
  assert.ok(page.includes("document.getElementById('headline-search')"), 'the page does not know the field the markup declares');
  assert.ok(page.includes("els.headlineSearch.addEventListener('input'"), 'what is typed in that field is read by nobody');

  /* A search narrows the selection of the left column; it must not replace it, or «Все ленты» would
   * stop being the whole stored list. */
  assert.ok(
    page.includes('state.items.filter(inSelection).filter(matchesQuery)'),
    'the search is not a filter over the headlines of the current selection',
  );
  /* The search belongs to the reading position, so it travels with it back from a settings screen. */
  assert.ok(page.includes('query: state.query'), 'the search is not kept with the selection');
  assert.ok(page.includes(`${elementOf(page, 'headline-search')}.value = state.query`), 'the field is left empty of what it filtered by');

  assert.ok(dictionary.includes("querySelectorAll('[data-i18n-placeholder]')"), 'a placeholder no dictionary re-applies stays in one language');
  assert.ok(css.includes('.panel-search'), 'the search field the markup declares is not styled');

  assert.ok(page.includes("document.addEventListener('keydown'"), 'the reader answers to no keys');
  for (const key of ["'ArrowDown'", "'ArrowUp'", "'/'", "'Enter'", "'Escape'"]) {
    assert.ok(page.includes(`case ${key}:`) || page.includes(`${key} &&`), `no key handler for ${key}`);
  }
  assert.ok(page.includes('isTypingTarget'), 'the keys are taken from the field being typed in');

  /* The reader answers to the key that was pressed, not only to the character the current layout
   * printed: the names of the pressed key are taken from `readerKeys`, and the reader tries them in
   * the order it is given. */
  assert.ok(page.includes('for (const key of readerKeys(event))'), 'a reader key is named only by what a layout printed');

  const captions = [
    'reader.search.placeholder',
    'reader.search.aria',
    'reader.headlines.emptySearch',
    'reader.feed.failedCount',
    'reader.feed.lastChecked',
    'reader.feed.lastError',
  ];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the reader asks to show`);
    }
  }

  assert.ok(css.includes('.feed-health'), 'a feed that fails to load is not set apart from the others');
});

/* ---------------- the reader explains its own keys ---------------- */

/**
 * The keys the reader answers to are listed where they are used, not only in the README: the «?» of its
 * header and the `?` key open a window whose table names every key the page script really handles.
 * The window takes the keyboard while it stands, so no headline is deleted through the list that
 * explains how to delete one. Markup, script, stylesheet and the seven dictionaries are kept in step.
 */
test('the reader explains its keys inside the reader', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const css = read('src/styles/reader.css');

  /* The list is a window of its own, named by its own head and closed by its own button. */
  assert.ok(html.includes('id="keys-help"'), 'the reader declares no key list of its own');
  assert.ok(html.includes('aria-labelledby="keys-help-title"'), 'the key list is named by nothing a screen reader can read');
  assert.ok(html.includes('id="btn-keys"'), 'no button of the reader opens the key list');
  assert.ok(html.includes('id="btn-keys-close"'), 'the key list has no way out for a mouse');
  assert.ok(html.includes('<symbol id="icon-help"'), 'the reader sprite never defines the «?» it asks for');
  assert.ok(html.includes('<symbol id="icon-close"'), 'the reader sprite never defines the glyph that closes the list');

  assert.ok(
    page.includes("document.getElementById('btn-keys')"),
    'the page does not know the button the markup declares',
  );
  assert.ok(page.includes(`${elementOf(page, 'btn-keys')}.addEventListener`), 'the button of the key list answers to no click');

  /* A window that holds the keyboard: `showModal`, the neighbours hidden while it stands, and the
   * same `?` that opened it closing it again. */
  assert.ok(page.includes(`${elementOf(page, 'keys-help')}.showModal()`), 'the key list is no modal, so Esc and the tab order are its own problem');
  assert.ok(page.includes("addEventListener('close'"), 'nothing puts back what opening the list took from the rest of the screen');
  assert.ok(page.includes("els.header.setAttribute('aria-hidden', 'true')"), 'a tab can walk out of the list into the screen behind it');
  assert.ok(page.includes("els.header.removeAttribute('aria-hidden')"), 'the screen behind the list stays voiceless once the list is gone');
  assert.ok(page.includes(`${elementOf(page, 'keys-help')}.addEventListener`), 'a click beside the list closes nothing');
  assert.ok(page.includes("case '?':"), 'no key opens the list the reader carries');
  assert.ok(
    page.includes(`${elementOf(page, 'keys-help')}.open) return;`),
    'the keys of the reader keep working through the list that explains them',
  );

  /* Every key the page really answers to stands in the table, and the table adds none it does not answer to. */
  const handled = new Set([
    ...page.matchAll(/^ {6}case '([^']+)':$/gm),
    ...page.matchAll(/event\.key === '([^']+)'/g),
  ].map(([, key]) => key));
  const glyphs = new Map([
    ['ArrowDown', '↓'],
    ['ArrowUp', '↑'],
    ['Escape', 'Esc'],
  ]);
  const keyOf = new Map([...glyphs].map(([key, glyph]) => [glyph, key]));
  assert.ok(handled.size >= 7, 'the reader answers to too few keys for its own list to make sense');
  for (const key of handled) {
    const glyph = glyphs.get(key) ?? key;
    assert.ok(html.includes(`<kbd>${glyph}</kbd>`), `the reader answers to ${key}, which its own list never names`);
  }
  const listed = new Set([...html.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map(([, glyph]) => glyph));
  assert.ok(listed.has('Esc'), 'the list names no key that ends the search it describes');
  for (const glyph of listed) {
    const key = keyOf.get(glyph) ?? glyph;
    assert.ok(handled.has(key) || key === 'Escape', `the list names ${glyph}, which the reader never answers to`);
  }

  const captions = [
    'reader.keys.toggle',
    'reader.keys.title',
    'reader.keys.close',
    'reader.keys.caption',
    'reader.keys.columnKey',
    'reader.keys.columnWhat',
    'reader.keys.search',
    'reader.keys.next',
    'reader.keys.prev',
    'reader.keys.original',
    'reader.keys.refresh',
    'reader.keys.mark',
    'reader.keys.delete',
    'reader.keys.undo',
    'reader.keys.escape',
    'reader.keys.help',
    'reader.keys.hint',
  ];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the key list asks to show`);
    }
  }

  /* The window is drawn as part of the reader, and it is the whole screen: only then is a click beside
   * the card a click the page can see (see `reader.css`). */
  assert.ok(css.includes('.keys-help[open]'), 'the layout of the key list is not held back until the window is opened');
  assert.ok(
    !/\.keys-help(?![\w-])(?!\[open\])(?!::)/.test(css),
    'a rule for the bare key list overrides `dialog:not([open])`, so the reader opens with the list in front of it',
  );
  assert.ok(css.includes('.keys-help::backdrop'), 'the rest of the screen stays unshaded behind the list');
  assert.ok(css.includes('.keys-keys kbd'), 'the keys of the list are typed as plain running text');
  assert.ok(css.includes('.keys-table'), 'the list of keys is laid out as no table');
});

/* --------------- the reader keys over a keyboard of another layout --------------- */

/**
 * The key list names its keys with the Latin letters and the `/` of an English keyboard, while a
 * keyboard answers with the character its current layout prints. On the Russian layout those same
 * physical keys print Cyrillic, and no key of it prints `/` at all, so a reader that answered only to
 * `event.key` went silent for exactly the readers whose screen is Russian. The name of the physical key
 * is added after the printed one, so a layout that moves its letters (Dvorak, AZERTY) keeps answering
 * through the glyph its own keys carry.
 */
test('a reader key answers to the key that was pressed, not to the layout that printed it', () => {
  const pressed = (key, code, shiftKey = false) => readerKeys({ key, code, shiftKey });

  /* The keys of the list, pressed at their place on the Russian layout. */
  const cyrillic = [
    ['о', 'KeyJ', 'j'],
    ['л', 'KeyK', 'k'],
    ['к', 'KeyR', 'r'],
    ['ь', 'KeyM', 'm'],
    ['в', 'KeyD', 'd'],
    ['г', 'KeyU', 'u'],
    ['.', 'Slash', '/'],
  ];
  for (const [printed, code, wanted] of cyrillic) {
    assert.ok(pressed(printed, code).includes(wanted), `${printed} (${code}) is not the ${wanted} of the key list`);
  }

  /* The printed name keeps the front place: a layout that puts its letters elsewhere answers to its
   * own glyph, and the reader tries that glyph before the place of an English keyboard. */
  assert.equal(pressed('о', 'KeyJ')[0], 'о', 'the letter of the layout is pushed behind the letter of the list');
  assert.ok(pressed('j', 'KeyH').includes('j'), 'a layout that moves its letters loses the j its key prints');
  assert.equal(pressed('j', 'KeyH')[0], 'j', 'the printed letter is not the first the reader tries');

  /* `?` is given no second name: where a layout keeps it off the key of `/`, it prints it from another
   * key, and the printed name leads there. So the `?` of one layout never becomes the search field of
   * another, and the second name of `/` belongs to its own key only. */
  assert.ok(!pressed('?', 'Slash', true).includes('/'), 'the `?` of a keyboard puts the cursor in the search field');
  assert.ok(pressed('?', 'Slash', true).includes('?'), 'the `?` standing on its own key is not answered to');
  assert.ok(!pressed('.', 'Period').includes('/'), 'the second name of `/` is given to another key');

  /* A key that states no physical name is still answered to by what it printed. */
  assert.deepEqual(pressed('j', undefined), ['j'], 'a key without `event.code` loses the letter it printed');
});

/**
 * The mark "read" has a place on the screen: a toggle in the article panel, a glyph on the row of the
 * middle column, a note above the text, and a window that takes a delete back. Every one of them is a
 * name shared by the markup, the script that draws it, the stylesheet that styles it and the seven
 * dictionaries, so the four are kept in step here as the rest of the reader's parts are.
 */
test('the reader shows the read mark, its toggle and the way back from a delete', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const css = read('src/styles/reader.css');

  /* The three glyphs the mark, its removal and the undo borrow from the sprite. */
  for (const glyph of ['icon-read', 'icon-unread', 'icon-undo']) {
    assert.ok(html.includes(`<symbol id="${glyph}"`), `the reader sprite never defines ${glyph}`);
  }
  assert.ok(page.includes("icon(isRead ? 'unread' : 'read')"), 'the toggle never changes the glyph it shows');

  /* The toggle of the article panel: declared, wired, and announced the way a toggle is announced. */
  assert.ok(html.includes('id="content-read"'), 'the reader declares no button that marks a headline read');
  assert.ok(page.includes("document.getElementById('content-read')"), 'the page does not know the button the markup declares');
  assert.ok(page.includes(`${elementOf(page, 'content-read')}.addEventListener`), 'the read toggle answers to no click');
  assert.ok(page.includes("els.contentRead.setAttribute('aria-pressed', String(isRead))"), 'the toggle never says which way it stands');
  assert.ok(page.includes("els.contentRead.hidden = true"), 'a placeholder leaves the toggle standing over no headline');
  assert.ok(/els\.contentRead\.title = t\(`reader\.content\.\$\{key\}\.tooltip`\)/.test(page), 'the toggle explains nothing about what a mark does to the feeds');

  /* Marking is a storage act, not a flag of the page: both directions go through the read list. */
  assert.ok(page.includes("await store.unmarkRead([item])"), 'taking the mark off asks the storage for nothing');
  assert.ok(page.includes(`await ${storeAlias(page)}.markRead([item])`), 'putting the mark on never reaches the read list');
  assert.ok(page.includes(`${storeAlias(page)}.readMarksFor(state.items, read)`), 'the middle column draws no mark the storage really holds');

  /* The glyph on the row, and the row itself going quiet under it. */
  assert.ok(page.includes('title.append(readFlag())'), 'a read headline carries no mark in the middle column');
  assert.ok(css.includes('.item-title .read-flag'), 'the mark of a headline is styled as no part of the reader');
  assert.ok(css.includes('.list-item.read'), 'a read headline is laid out like every other headline');
  assert.ok(css.includes('.list-item.selected .item-title .read-flag'), 'the mark disappears on the selected headline');

  /* What the article says about its own mark. */
  assert.ok(page.includes("note(t('reader.content.marked'), 'marked')"), 'the article never says its headline is held out of the feeds');
  assert.ok(css.includes('.note.marked'), 'the note about the mark is styled as no part of the reader');

  /* The window of an undo: its line, its button, its timer, and the keys that take a delete back. */
  assert.ok(html.includes('id="undo-line"'), 'the reader declares no line that offers an undo');
  assert.ok(html.includes('id="btn-undo"'), 'an undo is offered to a mouse by nothing');
  assert.ok(page.includes("document.getElementById('btn-undo')"), 'the page does not know the undo button the markup declares');
  assert.ok(page.includes(`${elementOf(page, 'btn-undo')}.addEventListener`), 'the undo button answers to no click');
  assert.ok(page.includes('offerUndo(removed)'), 'a delete offers no way back');
  assert.ok(page.includes('setTimeout(clearUndo, UNDO_MS)'), 'the window of an undo is never closed, or never timed at all');
  assert.ok(page.includes(`await ${storeAlias(page)}.restoreItem(`), 'the undo asks the storage for nothing');
  assert.ok(page.includes('if (restoredItem) renderArticle(restoredItem);'), 'an undo that put the headline back leaves the right panel showing the article of another headline');
  assert.ok(page.includes(`${announcerOf(page, 'reader-announce')}(t('reader.announce.undoFailed'))`), 'an undo that could not happen is not announced');
  assert.ok(page.includes("case 'u':"), 'no key takes a delete back');
  assert.ok(page.includes("if (state.undo && event.key === 'Escape'"), 'nothing outside the button takes a delete back');
  assert.ok(page.includes('!isTypingTarget(event.target)'), 'the undo window takes Esc from a field that is being typed in');

  /* A line whose own class makes it a flex box is not hidden by `[hidden]` alone. */
  assert.ok(css.includes('.undo-line[hidden]'), 'the undo line shows straight through its own `hidden`');
  assert.ok(css.includes('.undo-btn'), 'the undo button is styled as no part of the reader');
  assert.ok(css.includes('.undo-btn .icon'), 'the glyph of the undo is drawn at no size of its own');

  /* The one bulk delete no undo window takes back asks first — as a feed and a read list do. */
  assert.ok(/window\.confirm\(t\('reader\.confirmClear'/.test(page), 'the reader deletes a whole selection without asking');

  /* Every caption these parts ask to show, in every language the reader speaks. */
  const captions = [
    'reader.keys.mark',
    'reader.keys.undo',
    'reader.keys.delete',
    'reader.keys.escape',
    'reader.content.mark.tooltip',
    'reader.content.mark.aria',
    'reader.content.unmark.tooltip',
    'reader.content.unmark.aria',
    'reader.content.marked',
    'reader.undo.prompt',
    'reader.undo.button',
    'reader.confirmClear',
    'reader.announce.marked',
    'reader.announce.unmarked',
    'reader.announce.undone',
    'reader.announce.undoFailed',
  ];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the read mark asks to show`);
    }
  }

  /* A mark that reaches across the feeds is the mark the storage holds: the reader must not invent its
   * own shorter match, or the same news would stand marked in one column and fresh in another. */
  const setMarks = [...page.matchAll(/state\.read = /g)].length;
  const fromStorage = [...page.matchAll(/state\.read = store\.readMarksFor/g)].length;
  assert.equal(setMarks, fromStorage, 'the reader sets its read marks by something other than the match the storage itself uses');
});

/**
 * The README promises «содержание подгружается динамически в момент клика»: a headline click shows
 * the stored `<description>`, and the full text of the page is pulled over it on demand — by the
 * button in the article toolbar or by the `f` key. `extract.fetchArticle` and `extract.extractArticle`
 * stand only for this, so the guard keeps the whole trip — the import, the button, its glyph, the key,
 * the race guard and the seven dictionaries — from going dark and turning them back into dead code.
 */
test('the reader pulls the full text of an open headline from its page', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');

  /* The extraction is not left unused: the page imports `fetchArticle` and reaches the open headline's
   * page with it, under the reader's own timeout. */
  assert.ok(/import \{[^}]*\bfetchArticle\b[^}]*\} from '\.\/lib\/extract\.js'/.test(page), 'the reader never imports the article fetch it promises');
  assert.ok(page.includes('await fetchArticle(item.link)'), 'the full-text request is sent to no headline');

  /* The button: declared, drawn by a glyph the reader really defines, and wired to the load. */
  assert.ok(html.includes('id="content-article"'), 'the reader declares no button that pulls the full text');
  assert.ok(html.includes('<symbol id="icon-article"'), 'the reader asks for a full-text glyph its sprite never defines');
  assert.ok(html.includes('data-i18n-title="reader.content.article.tooltip"'), 'the full-text button is named by nothing a language translates');
  assert.ok(page.includes("document.getElementById('content-article')"), 'the page does not know the full-text button the markup declares');
  assert.ok(page.includes(`${elementOf(page, 'content-article')}.addEventListener`), 'the full-text button answers to no click');
  assert.ok(page.includes(`${elementOf(page, 'content-article')}.hidden = true`), 'a placeholder leaves the full-text button standing over no headline');

  /* The key stands in the switch and in the reader's own key list, both ways. */
  assert.ok(page.includes("case 'f':"), 'no key asks the reader to pull the full text');
  assert.ok(html.includes('<kbd>f</kbd>'), 'the reader answers to f, which its own list never names');

  /* A page that answers late must not overwrite a headline the cursor has already moved on to. */
  assert.ok(page.includes('state.articleToken += 1'), 'opening a headline does not retire the page still loading for the last one');
  assert.ok(page.includes('const token = ++state.articleToken'), 'the full-text load keeps no token to judge a late answer by');
  assert.ok(page.includes('token !== state.articleToken'), 'a late page is allowed to overwrite the article that opened since it was asked');

  /* An extraction that finds nothing, and a page that refuses, are said in the reader's own language. */
  assert.ok(page.includes("note(t('reader.content.articleNone'))"), 'a page with no article text is left without a word about it');
  assert.ok(page.includes('note(describeError(error)'), 'a page that refuses its full text is not named by a key every language translates');

  const captions = [
    'reader.keys.fullText',
    'reader.content.article.tooltip',
    'reader.content.article.aria',
    'reader.content.articleLoading',
    'reader.content.articleTruncated',
    'reader.content.articleNone',
  ];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the full-text article asks to show`);
    }
  }
});

/* ---------------------- feed health on the settings screen ---------------------- */

/**
 * The settings screen carries the diagnosis the worker records for each feed, and the reader marks a
 * feed that refuses to be read. The wording lives only in the page scripts, so each caption, the glyph
 * it draws and the stylesheet that styles it are kept in step here, alongside the keys every language
 * must translate.
 */
test('the feeds screen reports the health of each feed and the reader flags a failing feed', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const feedsHtml = read('src/feeds.html');
  const feedsJs = read('src/feeds.js');
  const indexHtml = read('src/index.html');
  const page = read('src/index.js');
  const readerCss = read('src/styles/reader.css');
  const feedsCss = read('src/styles/feeds.css');

  /* The settings screen names the last read, the next one due, the reason a feed failed and the
   * streak of failures — the reason written by `describeError`, not a raw dictionary key. */
  for (const key of ['feeds.health.checked', 'feeds.health.next', 'feeds.health.error', 'feeds.health.streak']) {
    assert.ok(feedsJs.includes(`t('${key}'`), `the feeds screen never shows ${key}`);
  }
  assert.ok(feedsJs.includes('describeError'), 'a stored failure is shown as a raw key, not in the page language');
  assert.ok(feedsJs.includes('feedHealthLine'), 'no line gathers what the screen knows about a feed');

  /* The reader sets a failing feed apart with a warning glyph and its failure count. */
  assert.ok(page.includes("icon('warning')"), 'the reader marks no failing feed with a glyph');
  assert.ok(page.includes('feed-warning'), 'the reader warning glyph is styled by no class');

  /* The glyph each script draws must be defined by the sprite of its own screen. */
  assert.ok(indexHtml.includes('<symbol id="icon-warning"'), 'the reader asks for a warning glyph its sprite never defines');
  assert.ok(feedsHtml.includes('<symbol id="icon-warning"'), 'the feeds sprite names a glyph no feed row will use');

  assert.ok(readerCss.includes('.feed-warning'), 'the reader warning glyph is drawn at no size of its own');
  assert.ok(feedsCss.includes('.row-note .feed-health'), 'the diagnosis under a feed row is not styled');

  const captions = [
    'feeds.health.checked',
    'feeds.health.next',
    'feeds.health.error',
    'feeds.health.streak',
    'units.inMinutes',
    'units.inHours',
    'units.inDays',
    'units.anyNow',
  ];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the feeds screen asks to show`);
    }
  }
});

/* ---------------- the load the reader names ---------------- */

/**
 * The reader answers «почему новости не пришли» on its own screen: the line under the head of the
 * middle column names when the headlines of what is selected came in and when they are next asked
 * for automatically. Markup, script, stylesheet and the seven dictionaries are kept in step here.
 */
test('the reader names the last load and the next check of what it shows', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const css = read('src/styles/reader.css');

  assert.ok(html.includes('id="feed-status"'), 'the middle column declares no line about its own load');
  assert.ok(page.includes("document.getElementById('feed-status')"), 'the page does not know the line the markup declares');
  assert.ok(page.includes('function renderFeedStatus()'), 'nothing gathers what the reader knows about its selection');
  assert.ok(page.includes('renderFeedStatus();'), 'the line the markup declares is drawn by nobody');
  assert.ok(css.includes('.panel-status'), 'the line the markup declares is not styled');

  /* One feed and «Все ленты» are both covered: the age is the newest of the feeds the selection
   * stands for, the next check is the earliest of them. */
  assert.ok(page.includes('state.feeds : feed ? [feed] : []'), 'the line does not follow the selection of the left column');
  assert.ok(page.includes('feedNextCheckAt('), 'the reader names no next check of its own selection');
  assert.ok(page.includes('lastFetchedAt'), 'the reader names no moment its headlines came in');

  /* «4 мин назад» is drawn once and then left standing; it has to be redrawn while the reader is open. */
  assert.ok(page.includes('setInterval('), 'the line stops aging while the reader sits open');
  assert.ok(page.includes("'visibilitychange'"), 'a tab that came back shows the age it sat out');

  const captions = ['reader.status.lastFetched', 'reader.status.nextCheck', 'reader.feed.nextCheck'];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the reader asks to show`);
    }
  }
});

/**
 * A load that fails is a fact about the selection, not about the headline that stands open: the text the
 * reader was showing stays on the screen, the failure is named by the line under the head of the middle
 * column, and a reader with no open article holds the same words in a live region of the right panel that
 * is announced as an alert. Only a load that brought headlines moves the reader to the top of the list.
 * Markup, script, stylesheet and the seven dictionaries are kept in step here.
 */
test('a failed load keeps the open headline and names itself in the status line', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const css = read('src/styles/reader.css');

  /* The right panel is split: a live region that always stands there, and the article beside it. */
  assert.ok(html.includes('id="content-empty" role="status"'), 'the right panel declares no live region to speak in');
  assert.ok(html.includes('id="article-body"'), 'the article of the reader is not kept apart from what the panel announces');
  for (const id of ['content-empty', 'article-body']) {
    assert.ok(page.includes(`document.getElementById('${id}')`), 'the page does not know the element the markup declares');
  }

  const placeholder = placeholderOf(page, 'content-empty');
  const reportsFailure = [...functionsOf(page)]
    .filter(([, body]) => body.includes('state.refreshError = {'))
    .map(([name]) => name);
  assert.equal(reportsFailure.length, 1, 'a failed load is kept by more than one path of the reader');
  const [failure] = reportsFailure;
  const [failureText] = [...functionsOf(page)]
    .filter(([, body]) => /return t\(\w+\.key,/.test(body))
    .map(([name]) => name);

  /* A failed load is never painted over the open article. */
  for (const key of ['reader.refresh.failed', 'reader.refreshAll.failed']) {
    assert.equal(page.split(`${placeholder}(t('${key}'`).length - 1, 0,
      `the failure ${key} is shown in place of the headline the reader was showing`);
    assert.equal(page.split(`${failure}('${key}'`).length - 1, key === 'reader.refresh.failed' ? 2 : 1,
      `the failure ${key} is named by no path that loads the feeds`);
  }
  assert.ok(page.includes('if (openHeadline()) renderFeedStatus();'), 'a failure with an open article repaints the article');

  /* The failure waits in the reader's state — the raw words of the worker, translated again on a language
   * change — and reaches the screen through the line under the head of the middle column. */
  assert.ok(page.includes('refreshError: null'), 'the reader keeps no failed load of its own');
  assert.equal(page.split('state.refreshError = null;').length - 1, 3, 'a new load or another selection does not forget the failure of the last one');
  assert.ok(page.includes(`state.refreshError ? [${failureText}(state.refreshError)] : []`), 'the status line does not carry the failure of the load');
  assert.ok(page.includes("els.feedStatus.classList.toggle('error'"), 'the status line does not say that what it carries is a failure');

  /* Only a load that answered moves the reader to the top of the list. */
  assert.equal(page.split('if (response?.ok) openTopHeadline();').length - 1, 2, 'a load that failed moves the reader away from its open headline');

  /* With no article to keep, the same words are spoken by the live region of the right panel. */
  assert.ok(page.includes("p.setAttribute('role', alert ? 'alert' : 'status')"), 'a failure of a load is not announced to a screen reader');
  assert.ok(page.includes(`${placeholderOf(page, 'content-empty')}(t('reader.refresh.noFeed'), { alert: true })`), 'the reader shows an empty selection as no alert');
  assert.ok(page.includes(`else if (state.refreshError) ${placeholder}(${failureText}(state.refreshError), { alert: true });`), 'a language change leaves the failure of a load standing in the language of the last one');
  assert.ok(page.includes(`${elementOf(page, 'article-body')}.replaceChildren()`), 'a placeholder leaves the article of the last headline on the screen');
  assert.ok(page.includes(`${elementOf(page, 'content-empty')}.hidden = true`), 'a headline leaves the words of the placeholder under itself');

  assert.ok(css.includes('.panel-status.error'), 'a failure in the status line is not shown as a failure');
  assert.ok(css.includes('.empty.error'), 'a failure in the right panel is not shown as a failure');

  const captions = ['reader.refresh.failed', 'reader.refreshAll.failed'];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the reader asks to show`);
    }
  }
});

/* ---------------- the first run of a reader with no feeds ---------------- */

/**
 * A reader whose feeds have never been added has nothing to list, so it has to say that in its own
 * words: the middle column holds a card that names the empty screen and hands over the way to the
 * feeds screen, the controls that would act on an empty selection stand aside, and the feeds screen
 * confirms the first added feed once — under the table, where a word about the whole table belongs.
 * Markup, script, stylesheet, storage and the seven dictionaries are kept in step here.
 */
test('the reader greets a first run that has no feeds', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const fns = functionsOf(page);
  const feedsJs = read('src/feeds.js');
  const storageJs = read('src/lib/storage.js');
  const css = read('src/styles/reader.css');

  /* The card is declared in the markup so that `applyI18n()` reaches its words on a language change. */
  assert.ok(html.includes('id="start-card"'), 'the middle column declares no card for a reader with no feeds');
  assert.ok(html.includes('id="btn-open-feeds"'), 'the card of a first run offers no way to the feeds screen');
  assert.ok(
    page.includes("document.getElementById('start-card')"),
    'the page does not know the card its own markup declares',
  );
  assert.ok(
    page.includes("document.getElementById('btn-open-feeds')"),
    'the page does not know the button its own markup declares',
  );

  /* One function decides that there is nothing to list, and the columns ask it instead of guessing. */
  const decided = [...page.matchAll(/const (\w+) = (\w+)\(\);/g)].find((match) =>
    page.includes(`|| ${match[1]};`) && fns.has(match[2]));
  assert.ok(decided, 'nothing decides when the card stands in for the list');
  const [, noFeeds, decidesIt] = decided;
  assert.ok((fns.get(decidesIt) ?? '').includes(`.${nameOfId(page, 'start-card')}.hidden =`),
    `the ${decidesIt} function does not put the card of a first run in place of the list`);

  const emptyLine = page.split(/\r?\n/).find((line) =>
    line.includes(`.${nameOfId(page, 'headlines-empty')}.hidden =`));
  assert.ok(emptyLine?.trimEnd().endsWith(`|| ${noFeeds};`),
    'the empty-list line keeps speaking over the card of a first run');

  /* A search field and two icons that act on an empty selection would only look usable. */
  for (const id of ['headline-search', 'btn-load', 'btn-clear']) {
    const control = nameOfId(page, id);
    assert.ok(control && page.includes(`.${control}.hidden = ${noFeeds};`),
      `the ${id} control of an empty reader is left standing as if it had something to do`);
  }
  const searchGuard = page.split(/\r?\n/).find((line) =>
    line.includes(`.${nameOfId(page, 'headline-search')}.hidden) break;`));
  assert.ok(searchGuard?.trimStart().startsWith('if ('),
    'the `/` key takes the focus to a field an empty reader has hidden',
  );

  /* `hidden` on a control whose own class names its `display` hides nothing: the screen has to say
   * it itself, or the controls of the middle column stay drawn next to the card. */
  assert.ok(css.includes('.panel-head [hidden]'), 'no rule hides a control whose class names its display');
  assert.ok(css.includes('.start-card'), 'the card the markup declares is not styled');
  assert.ok(css.includes('.start-card[hidden]'), 'the card is left drawn after the first feed arrives');
  assert.ok(css.includes('.start-card-icon'), 'the glyph of the card is drawn at no size of its own');

  /* The button goes the way the screen switcher goes: the same tab, so the selection stays where it was. */
  assert.ok(
    page.includes("import { SETTINGS_PAGE, pageUrl } from './lib/tabs.js';"),
    'the reader does not know where the feeds screen lives',
  );
  const openFeeds = nameOfId(page, 'btn-open-feeds');
  assert.ok(openFeeds && page.includes(`.${openFeeds}.addEventListener`),
    'the card the markup declares has no answer to its own button');
  assert.ok(
    page.includes('window.location.assign(pageUrl(SETTINGS_PAGE))'),
    'the card of a first run leads nowhere',
  );

  /* The right panel says the same as the middle one instead of asking for a headline no feed has. */
  assert.equal(
    page.split(`${placeholderOf(page, 'content-empty')}(t('reader.start.contentHint'))`).length - 1,
    3,
    'the right panel is told about the first run by only some of the ways it is repainted',
  );

  /* The first added feed is confirmed once, under the table, and the mark that made it once lives
   * in the settings the worker shares with the screens. */
  for (const name of ['FIRST_FEED_KEY', 'getFirstFeedDone', 'setFirstFeedDone']) {
    assert.ok(
      new RegExp(`export (async function|const) ${name}\\b`).test(storageJs),
      `storage.js does not offer ${name}`,
    );
  }
  const storeAs = feedsJs.match(/import \* as (\w+) from '\.\/lib\/storage\.js'/)?.[1] ?? null;
  assert.ok(
    storeAs && feedsJs.includes(`(await ${storeAs}.getFeeds()).length === 0 && !(await ${storeAs}.getFirstFeedDone())`),
    'the first row of an empty table is not told apart from the rows after it',
  );
  /* The word about the whole table is spoken through the transfer line the markup declares, whatever
   * the page calls the function that writes it. */
  const transferFn = [...functionsOf(feedsJs)].find(([, body]) =>
    body.includes(`${elementOf(feedsJs, 'transfer-status')}.textContent`))?.[0] ?? null;
  assert.ok(
    transferFn && feedsJs.includes(`${transferFn}(t('feeds.status.firstFeed'), 'ok')`),
    'a first feed leaves no word about the table it just entered',
  );
  assert.ok(
    feedsJs.includes('if (firstFeed && loaded?.ok && !loaded.busy)'),
    'the confirmation promises headlines a feed that failed never brought',
  );
  assert.ok(
    feedsJs.indexOf(`await ${storeAs}.setFirstFeedDone();`) <
      feedsJs.indexOf(`${transferFn}(t('feeds.status.firstFeed')`),
    'the mark is left unwritten, so the same word comes back on every save',
  );

  const captions = [
    'reader.start.title',
    'reader.start.hint',
    'reader.start.openFeeds',
    'reader.start.contentHint',
    'feeds.status.firstFeed',
  ];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which a first run asks to show`);
    }
  }
});

/** The first-feed mark is a setting: absent before the first feed, kept after it is written. */
test('the mark of a first feed is absent until it is written', async () => {
  const forget = storageMemory();
  try {
    assert.equal(await store.getFirstFeedDone(), false, 'a reader that never added a feed has no mark');
    assert.equal(await store.setFirstFeedDone(), true);
    assert.equal(await store.getFirstFeedDone(), true, 'the confirmation is told once, not on every save');

    const stored = await chrome.storage.local.get(store.SETTINGS_KEY);
    assert.equal(stored[store.SETTINGS_KEY][store.FIRST_FEED_KEY], true);
  } finally {
    forget();
  }
});

/* ---------------- what the reader says out loud ---------------- */

/**
 * The reader is used by an ear and by a keyboard, not only by an eye: the outcome of a load is said
 * from a line no eye sees, the two lists name themselves and the row among them that is chosen, the
 * middle column keeps its keyboard cursor on one node instead of on every row it shows, and the
 * spinning glyph is a decoration a reader who asks for no motion never gets. Markup, script,
 * stylesheet and the seven dictionaries are kept in step here.
 */
test('the reader announces its outcomes and keeps a keyboard cursor visible', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const html = read('src/index.html');
  const page = read('src/index.js');
  const css = read('src/styles/reader.css');
  const theme = read('src/styles/theme.css');

  /* The line a screen reader reads and an eye never sees. */
  assert.ok(
    html.includes('id="reader-announce" role="status" aria-live="polite"'),
    'the reader declares no line a screen reader reports',
  );
  assert.ok(
    page.includes("document.getElementById('reader-announce')"),
    'the page does not know the line the markup declares',
  );
  const fns = functionsOf(page);
  const announceLine = nameOfId(page, 'reader-announce');
  const announcers = [...fns].filter(([, body]) => body.includes(`.${announceLine}.textContent`));
  assert.equal(announcers.length, 1, 'nobody writes to the line the markup declares');
  const [announceName] = announcers[0];

  const outcomes = [...page.matchAll(/(\w+)\((\w+)\(response\)\);/g)];
  assert.equal(outcomes.length, 2, 'a load is announced by only some of the buttons that can start one');
  for (const [, said, gathered] of outcomes) {
    assert.equal(said, announceName, 'a load is announced to a line other than the one the markup declares');
    assert.ok(fns.has(gathered), 'noone gathers what a load ended with');
  }
  assert.ok(
    page.includes(`${announceName}(t('reader.announce.deleted')`),
    'a deleted headline is said to nobody who cannot see the panels',
  );
  assert.ok(
    page.includes(`${announceName}(t('reader.announce.cleared'`),
    'a cleared column is said to nobody who cannot see the panels',
  );

  assert.ok(theme.includes('.sr-only'), 'no stylesheet describes the line the reader announces from');
  const hidden = theme.slice(
    theme.indexOf('.sr-only {'),
    theme.indexOf('}', theme.indexOf('.sr-only {')),
  );
  assert.ok(
    !hidden.includes('display: none') && !hidden.includes('visibility: hidden'),
    'a line hidden with `display: none` is a line no screen reader reads either',
  );

  /* The two lists name themselves and say which of their rows the selection has. */
  assert.ok(html.includes('id="feed-list" role="list"'), 'the left column declares no list');

  const listbox = (html.match(/<ul[^>]*id="headline-list"[^>]*>/) ?? [''])[0];
  assert.ok(
    listbox.includes('role="listbox"'),
    'the middle column declares a list of rows instead of a list of choices',
  );
  assert.ok(
    listbox.includes('tabindex="0"'),
    'the middle column is no stop of Tab, so a keyboard never reaches its list at all',
  );
  assert.equal(
    (html.match(/tabindex=/g) ?? []).length,
    1,
    'the reader spreads its Tab over the rows of a column instead of one cursor',
  );

  const rowPainters = [...fns].filter(([, body]) => body.includes(".setAttribute('role', 'option')"));
  assert.equal(rowPainters.length, 1, 'the rows of the middle column are built in more than one place');
  const [, rowBody] = rowPainters[0];
  assert.ok(rowBody.includes(".setAttribute('aria-selected'"),
    'the open headline is not named among the options it belongs to');
  assert.ok(!rowBody.includes("createElement('button')"),
    'a button inside an option makes the same list a pile of tab stops');
  assert.ok(
    page.includes(`.${nameOfId(page, 'headline-list')}.setAttribute('aria-activedescendant'`),
    'the middle column never names the row its keyboard cursor stands on',
  );
  assert.equal(
    page.split("setAttribute('aria-current', 'true')").length - 1,
    2,
    'the chosen feed row is named for a feed but not for the all-feeds row',
  );

  /* A cursor the keyboard moves is a cursor an eye can find. */
  const moves = [...fns].filter(([, body]) => /\(\w+\[\w+\], \{ \w+: true \}\)/.test(body));
  assert.equal(moves.length, 1, 'the keyboard moves the cursor of more than one column');
  const moved = moves[0][1].match(/(\w+)\((\w+)\[\w+\], \{ (\w+): true \}\)/);
  assert.ok(moved, 'the arrows leave the focus where it already stood');
  const [, openName, , focusOption] = moved;
  assert.ok(fns.has(openName), 'the arrows open no headline of that list');
  assert.ok(
    (fns.get(openName) ?? '').includes(`{ ${focusOption} = false }`),
    'opening a headline with the keyboard is no different from opening it with a mouse',
  );
  assert.ok(
    (fns.get(openName) ?? '').includes(`.${nameOfId(page, 'headline-list')}.focus()`),
    'the column whose cursor the keyboard moves never takes the focus that cursor stands in',
  );
  assert.ok(
    css.includes('.list-item > button:focus-visible'),
    'a row reached with the keyboard is drawn exactly like a row reached with the mouse',
  );
  assert.ok(
    css.includes('#headline-list:focus-visible .list-item.selected'),
    'the row the middle column points at keeps no cursor an eye can find',
  );
  assert.ok(
    css.includes('.list-item.selected > button:focus-visible'),
    'the cursor on a filled row keeps the colour it cannot be seen in',
  );

  /* The spin is decoration: the load still shows as a held button with its own tooltip. */
  const reducedAt = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reducedAt > 0, 'the reader has no answer for a user who asks for no motion');
  assert.ok(css.indexOf('animation: none', reducedAt) > 0, 'the glyph keeps spinning for a user who asks for no motion');
  assert.ok(css.indexOf('transition: none', reducedAt) > 0, 'the border handle keeps fading for a user who asks for no motion');

  const captions = [
    'reader.announce.loaded',
    'reader.announce.none',
    'reader.announce.failed',
    'reader.announce.error',
    'reader.announce.cleared',
    'reader.announce.deleted',
    'reader.feeds.list.aria',
    'reader.headlines.list.aria',
  ];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the reader asks to say or to name with`);
    }
  }
});

/* ---------------- what the other two screens say out loud ---------------- */

/**
 * The feeds screen and the settings screen answer an ear the way the reader does: the markup declares
 * a line a screen reader reports, the page script knows it, and the same function that writes what an
 * eye sees under a row, under the table or under the fields writes that line too. A table is named by
 * its own caption, the line no eye sees is described once for all three screens, and a button colour
 * stops cross-fading for whoever asks the system for no motion.
 */
test('the feeds and settings screens say what their buttons did', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const feedsHtml = read('src/feeds.html');
  const feedsJs = read('src/feeds.js');
  const settingsHtml = read('src/settings.html');
  const settingsJs = read('src/settings.js');
  const readerCss = read('src/styles/reader.css');
  const theme = read('src/styles/theme.css');

  for (const [screen, html, page] of [
    ['feeds', feedsHtml, feedsJs],
    ['settings', settingsHtml, settingsJs],
  ]) {
    assert.ok(
      html.includes(`id="${screen}-announce" role="status" aria-live="polite"`),
      `the ${screen} screen declares no line a screen reader reports`,
    );
    assert.ok(
      page.includes(`document.getElementById('${screen}-announce')`),
      `the ${screen} page does not know the line its own markup declares`,
    );
    assert.ok(announcerOf(page, `${screen}-announce`), `nothing writes to the live line of the ${screen} screen`);
  }

  /* Both screens speak from the place that already writes the words an eye sees: whatever a function
   * puts where an eye reads it, it hands the same words to the live line of its own markup. */
  const speakers = (source, id) => {
    const says = announcerOf(source, id);
    if (!says) return [];
    /* A speaker is a screen action that writes where an eye reads it and hands the same words to the
     * live line. The live line's own writer is not such an action — it is the line they all speak in. */
    return [...functionsOf(source)].filter(
      ([name, body]) => name !== says && body.includes(`${says}(`) && body.includes('.textContent ='),
    );
  };

  assert.equal(
    speakers(feedsJs, 'feeds-announce').length,
    2,
    'a feed row or a transfer of the whole table is said to nobody who cannot see it',
  );

  const settingsSpeakers = speakers(settingsJs, 'settings-announce');
  assert.equal(settingsSpeakers.length, 1, 'the settings screen says nothing out loud about what «Записать» wrote');
  assert.ok(
    settingsSpeakers[0]?.[1].includes("if (kind === 'ok' || kind === 'error')"),
    'a word of the settings screen is said out loud whatever kind it was',
  );

  const settingsWriter = [...functionsOf(settingsJs)].find(([, body]) =>
    body.includes(`${elementOf(settingsJs, 'read-status')}.textContent`))?.[0] ?? null;
  assert.ok(
    settingsWriter && settingsJs.includes(`${settingsWriter}(t('settings.status.pending'), 'pending')`),
    'the settings screen no longer marks an unwritten field',
  );

  /* A table is named by a caption: the `<th>` row is a head a sighted person reads, not a name a
   * screen reader says when it enters the table. */
  assert.ok(
    feedsHtml.includes('<caption class="sr-only" data-i18n="feeds.caption">'),
    'the feed table has no caption for a screen reader',
  );
  assert.ok(
    settingsHtml.includes('<caption class="sr-only" data-i18n="settings.caption">'),
    'the settings table has no caption for a screen reader',
  );

  /* The «?» of both screens is a `<summary>`: tabbable, but no `button`, so it has to be named by the
   * outline rule of the shared stylesheet or a keyboard opens it blind. */
  assert.ok(
    theme.includes('summary:focus-visible'),
    'the explanation folded behind a «?» takes no cursor a keyboard can see',
  );

  /* The colours of a button stop cross-fading for a user who asks for no motion — on every screen, so
   * the rule lives in the stylesheet all three share. */
  const reducedAt = theme.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reducedAt > 0, 'no stylesheet answers a user who asks for no motion');
  assert.ok(theme.indexOf('transition: none', reducedAt) > 0, 'a button colour still cross-fades on command');
  assert.ok(
    !readerCss.includes('.sr-only {'),
    'the line no eye sees is described once per screen instead of once for all three screens',
  );

  const captions = ['feeds.caption', 'settings.caption'];
  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of captions) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which a table of this screen asks to be named`);
    }
  }
});

test('the settings screen names the horizon its read list can really hold', () => {
  const page = fs.readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8');

  assert.match(
    page,
    /store\.readHonoredDays\(read, ttlDays\)/,
    'the foot of the card shows the horizon the storage honours, not only the one it was asked for',
  );
  assert.match(
    page,
    /settings\.readStats\.capped/,
    'a cap that cut the horizon short is said out loud instead of decided in silence',
  );

  for (const lang of i18n.LANGUAGES) {
    const keys = new Set(i18n.dictionaryKeys(lang));
    for (const key of ['settings.readStats', 'settings.readStats.capped']) {
      assert.ok(keys.has(key), `${lang} has no ${key}, which the foot of the settings card asks to show`);
    }
  }
});

/*
 * A name taken from a module that does not export it is not an error a browser reports: it is
 * `undefined`, and a card that says «at most undefined markers» is exactly the kind of mistake a
 * test should meet before a user reads it. Every module of the extension exports its names on their
 * own line, so both ways a file borrows — by name, or through a whole module it names — can be
 * checked against what the borrowed module really exports.
 */
test('every name a file borrows from another is one that module really exports', () => {
  const src = new URL('../src/', import.meta.url);
  const files = fs
    .readdirSync(src, { recursive: true })
    .filter((entry) => String(entry).endsWith('.js'))
    .map((entry) => String(entry).split('\\').join('/'));

  assert.ok(files.length > 10, 'the scan of the sources found almost nothing to check');

  const exportsOf = (url) => {
    const source = fs.readFileSync(url, 'utf8');
    const names = new Set();
    for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+(\w+)/gm)) {
      names.add(match[1]);
    }
    for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of match[1].split(',')) {
        const name = part.split(/\s+as\s+/).pop().trim();
        if (name) names.add(name);
      }
    }
    return names;
  };

  const exported = new Map();
  for (const file of files) {
    exported.set(new URL(file, src).href, exportsOf(new URL(file, src)));
  }

  for (const file of files) {
    const url = new URL(file, src);
    const source = fs.readFileSync(url, 'utf8');

    for (const match of source.matchAll(/^import\s+\{([^}]*)\}\s+from\s+'([^']+)'/gm)) {
      const [, names, spec] = match;
      if (!spec.startsWith('.')) continue;

      const target = new URL(spec, url);
      const available = exported.get(target.href);
      assert.ok(available, `${file} imports ${spec}, which is not a module of this extension`);

      for (const part of names.split(',')) {
        const name = part.split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        assert.ok(
          available.has(name),
          `${file} takes ${name} from ${spec}, which does not export it`,
        );
      }
    }

    /* A namespace import answers for every name the file reaches through it — the way a screen asks
     * the storage for a constant it has no copy of of its own. */
    for (const match of source.matchAll(/^import\s+\*\s+as\s+(\w+)\s+from\s+'(\.[^']+)'/gm)) {
      const [, alias, spec] = match;
      const available = exported.get(new URL(spec, url).href);
      assert.ok(available, `${file} borrows ${spec}, which is not a module of this extension`);

      /* The import line itself names the module it borrows: it is not a use of a name in it. */
      for (const used of source.replace(match[0], '').matchAll(new RegExp(`[^\\w.]${alias}\\.(\\w+)`, 'g'))) {
        assert.ok(
          available.has(used[1]),
          `${file} reads ${alias}.${used[1]}, which ${spec} does not export`,
        );
      }
    }
  }
});

/* ---------------- the schedule the reader names ---------------- */

/**
 * The reader answers «когда ленту спросят снова» with a moment it did not invent: `syncAlarms` reads
 * it off the alarms Chrome really runs and writes it into the feed row. A sync that learned nothing
 * has to write nothing — otherwise the write would wake `chrome.storage.onChanged`, which asks for
 * the same sync again, and the worker would chase its own storage forever.
 */
test('the schedule the reader names is the one Chrome really runs', async () => {
  const memory = {};
  const now = Date.now();
  const pending = `${util.ALARM_PREFIX}pending`;
  const overdue = `${util.ALARM_PREFIX}overdue`;
  const scheduled = new Map([
    [pending, { name: pending, periodInMinutes: 30, scheduledTime: now + 12 * MINUTE }],
    [overdue, { name: overdue, periodInMinutes: 30, scheduledTime: now - 5 * MINUTE }],
    [util.CLEANUP_ALARM_NAME, { name: util.CLEANUP_ALARM_NAME, periodInMinutes: util.CLEANUP_PERIOD_MINUTES }],
  ]);

  let writes = 0;
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return key in memory ? { [key]: structuredClone(memory[key]) } : {};
        },
        async set(patch) {
          writes += 1;
          for (const [key, value] of Object.entries(patch)) memory[key] = structuredClone(value);
        },
      },
    },
    alarms: {
      async getAll() {
        return [...scheduled.values()];
      },
      async clear(name) {
        return scheduled.delete(name);
      },
      async create(name, info) {
        scheduled.set(name, { name, ...info, scheduledTime: Date.now() + info.periodInMinutes * MINUTE });
      },
    },
  };

  try {
    await store.upsertFeed({ id: 'pending', name: 'Pending', rss_link: 'https://a.b/rss', delay_timeout: 30 });
    await store.upsertFeed({ id: 'overdue', name: 'Overdue', rss_link: 'https://b.a/rss', delay_timeout: 30 });
    await store.upsertFeed({ id: 'fresh', name: 'Fresh', rss_link: 'https://c.b/rss', delay_timeout: 30 });

    await alarmsLib.syncAlarms();
    const byId = new Map((await store.getFeeds()).map((feed) => [feed.id, feed]));

    assert.equal(byId.get('pending').nextAlarmAt, now + 12 * MINUTE, 'an alarm that has not run is named by its own clock, not by the period');
    assert.equal(
      byId.get('overdue').nextAlarmAt,
      now - 5 * MINUTE + 30 * MINUTE,
      'an alarm that already went off is due one period after that run',
    );
    const fresh = byId.get('fresh').nextAlarmAt;
    assert.ok(
      fresh > Date.now() && fresh <= Date.now() + 30 * MINUTE,
      'an alarm created by this sync is due one period from now',
    );
    assert.equal(
      fresh,
      scheduled.get(`${util.ALARM_PREFIX}fresh`).scheduledTime,
      'the row names the same moment the new alarm itself carries, to the millisecond',
    );
    assert.equal(byId.get('pending').lastCheckedAt, undefined, 'a schedule is not a diagnosis: nothing claims the feed was read');

    writes = 0;
    await alarmsLib.syncAlarms();
    assert.equal(writes, 0, 'a sync that learned nothing rewrites nothing, so it cannot wake itself again');

    /* A feed whose period changed gets a new alarm — and with it a new schedule. */
    await store.upsertFeed({ id: 'pending', name: 'Pending', rss_link: 'https://a.b/rss', delay_timeout: 60 });
    await alarmsLib.syncAlarms();
    const moved = (await store.getFeeds()).find((feed) => feed.id === 'pending');
    assert.equal(scheduled.get(pending).periodInMinutes, 60, 'the alarm itself follows the new period');
    assert.ok(
      moved.nextAlarmAt >= now + 60 * MINUTE,
      'the schedule named for the feed is the one the new alarm carries',
    );
  } finally {
    delete globalThis.chrome;
  }
});

/* ---------------- the worker and the document, running ---------------- */

/**
 * The two halves that need Chrome are not read as text here: they are imported once, given one fake
 * `chrome`, and asked to work. A listener they register is a plain function a test can call the way
 * Chrome calls it, so an alarm walks the whole route — the row of the feed, the worker, the offscreen
 * document, the request, the answer, back to the row — and the test reads what the row says.
 *
 * Both halves read `chrome` from the global at the moment they are *called*, which is what lets one
 * import serve every scenario: the scenario swaps the global, the listeners stay where the pair put
 * them. That is why the pair is imported once, here, and never again.
 */

/** Every listener the pair registered while it was imported, tagged with the half that put it up. */
const readerListeners = [];
let readerOwner = null;

function readerEvents(event) {
  return {
    addListener(fn) {
      readerListeners.push({ event, owner: readerOwner, fn });
    },
  };
}

/** The listeners of one half, as the functions Chrome would be handed. */
function readerCalls(event, owner) {
  return readerListeners
    .filter((listener) => listener.event === event && (owner === undefined || listener.owner === owner))
    .map((listener) => listener.fn);
}

/**
 * The `chrome` of one scenario: the storage of a profile, its alarms, the offscreen document that
 * answers the worker, the popups and the tabs the reader shows — and, when a test wants the reader to
 * fail at its own shelf, the writes it refuses.
 */
function readerChrome({ storage = {}, refuse = null, hasDocument = false } = {}) {
  const memory = structuredClone(storage);
  const alarms = new Map();
  const popups = new Map();
  const state = {
    requests: [],
    badge: [],
    sounds: [],
    tabs: [],
    tabUpdates: [],
    /* Every message the worker sent to the document, and every popup it asked the system to show: a
     * test asks here whether the worker signalled a load it was not asked to signal. */
    sends: [],
    notifications: [],
    popups,
    document: { open: hasDocument, created: 0, closed: 0 },
  };

  /* A request that is still on its way between the two contexts, counted so a scenario can wait for
   * the reads it started instead of guessing how many waits they take. */
  const hops = new Set();

  const api = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => (state.document.open ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
      lastError: null,
      onInstalled: readerEvents('runtime.onInstalled'),
      onStartup: readerEvents('runtime.onStartup'),
      onMessage: readerEvents('runtime.onMessage'),
      sendMessage(message, reply) {
        /* A message from the worker reaches the *other* context: the worker does not answer itself. */
        state.sends.push({ ...message });
        const answers = [];
        const waits = [];

        for (const listener of readerCalls('runtime.onMessage', 'document')) {
          const hop = { settled: false, answer: null };
          const wait = new Promise((done) => { hop.answer = done; });
          const answer = (payload) => {
            answers.push(payload);
            if (hop.settled) return;
            hop.settled = true;
            hops.delete(hop);
            hop.answer(payload);
          };

          const keepsChannel = listener(message, { id: 'reader-document' }, answer);
          /* The document answers when its own work is done; until then this hop is outstanding, and a
           * scenario that ends early has to answer it itself. */
          if (keepsChannel === true && !hop.settled) {
            hops.add(hop);
            waits.push(wait);
          }
        }

        Promise.all(waits).then(() => {
          api.runtime.lastError = answers.length > 0 ? null : { message: 'Receiving end does not exist.' };
          reply(answers.length > 0 ? answers[0] : undefined);
          api.runtime.lastError = null;
        });
      },
      /**
       * The document has answered. Chrome gives a reply to a context that answers the message, so
       * this is where a scenario hands the answer over to the requests it has left on the way.
       */
      answerDocument(payload) {
        for (const hop of [...hops]) {
          if (hop.settled) continue;
          hop.settled = true;
          hops.delete(hop);
          hop.answer(payload);
        }
      },
    },
    action: {
      onClicked: readerEvents('action.onClicked'),
      async setBadgeText(details) { state.badge.push(details.text); },
      async setBadgeBackgroundColor() {},
    },
    storage: {
      local: {
        async get(key) {
          return key in memory ? { [key]: structuredClone(memory[key]) } : {};
        },
        async set(patch) {
          for (const [key, value] of Object.entries(patch)) {
            if (refuse?.(key)) throw new Error(`the shelf of the reader would not take ${key}`);
            memory[key] = structuredClone(value);
          }
        },
      },
      onChanged: readerEvents('storage.onChanged'),
    },
    alarms: {
      onAlarm: readerEvents('alarms.onAlarm'),
      async getAll() { return [...alarms.values()]; },
      async create(name, info) {
        alarms.set(name, { name, ...info, scheduledTime: Date.now() + info.periodInMinutes * MINUTE });
        return true;
      },
      async clear(name) { return alarms.delete(name); },
    },
    notifications: {
      onClicked: readerEvents('notifications.onClicked'),
      onClosed: readerEvents('notifications.onClosed'),
      async create(id, options) {
        popups.set(id, { id });
        state.notifications.push({ id, options });
        return true;
      },
      async clear(id) { return popups.delete(id); },
      async getAll() { return Object.fromEntries(popups); },
    },
    offscreen: {
      async hasDocument() { return state.document.open; },
      async createDocument(options) {
        state.document.open = true;
        state.document.created += 1;
        state.createOptions = options;
        return undefined;
      },
      async closeDocument() {
        state.document.open = false;
        state.document.closed += 1;
        return undefined;
      },
    },
    tabs: {
      async query() { return [...state.tabs]; },
      async create(options) {
        const tab = { id: state.tabs.length + 1, windowId: 1, ...options };
        state.tabs.push(tab);
        return tab;
      },
      async update(id, patch) {
        state.tabUpdates.push({ id, ...patch });
        return { id, ...patch };
      },
    },
    windows: { async update(id, patch) { return { id, ...patch }; } },
  };

  return { api, state, hops };
}

/**
 * Import the pair under a `chrome` that answers everything their first lines ask for: the worker
 * bootstraps, wires the popup listeners and asks which popups are still live, so the warm-up has to
 * answer all three. The imports cannot be static: a module read before a scenario installed its
 * `chrome` would fail on the first `chrome.*` of its top level.
 */
async function importReaderPair() {
  const warm = readerChrome({ storage: {} });
  globalThis.chrome = warm.api;

  readerOwner = 'worker';
  await import('../src/background.js');
  readerOwner = 'document';
  await import('../src/offscreen.js');
  readerOwner = null;

  /* The wake of the worker is not awaited by the worker itself; let it finish before its Chrome goes. */
  await new Promise((done) => setTimeout(done, 0));
  delete globalThis.chrome;
}

/**
 * The `Audio` of the scenarios: the offscreen document keeps one player for one signal file, so a
 * fake that stood per scenario would be reused out of its own scenario. It names its scenario's
 * record of the signal only when the signal is actually played.
 */
let soundSink = null;

class TestAudio {
  constructor(src) {
    this.src = src;
    this.dataset = {};
    this.volume = 1;
    this.currentTime = 0;
    this.paused = true;
  }

  addEventListener() {}
  pause() { this.paused = true; }
  async play() {
    this.paused = false;
    soundSink?.push({ src: this.src, volume: this.volume });
  }
}

/**
 * One scenario of the running pair: a profile of storage, a feed server, and every request the
 * document made recorded as it left.
 * @param {{ storage?: object, server?: Function, refuse?: Function, hasDocument?: boolean }} scenario
 */
function runningReader(scenario = {}) {
  const { api, state, hops } = readerChrome(scenario);
  globalThis.chrome = api;

  const realFetch = globalThis.fetch;
  const realAudio = globalThis.Audio;
  const realSink = soundSink;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const server = scenario.server ?? (() => feedResponse({ status: 500 }));
  soundSink = state.sounds;
  globalThis.Audio = TestAudio;

  /* A scenario ends long before the waits it started run: the offscreen document arms an idle close
   * and a popup takes its own time off the screen, and by the time either is due this scenario's
   * `chrome` is gone. So every timer a scenario starts is tracked — with the wait it stands for, so a
   * test can read the limit a request was given — and cancelled when the scenario ends.
   */
  const timers = new Map();
  const waits = [];
  globalThis.setTimeout = (fn, delay, ...rest) => {
    const wait = { ms: delay, cancelled: false, fired: false };
    const handle = realSetTimeout(() => {
      timers.delete(handle);
      wait.fired = true;
      fn(...rest);
    }, delay);
    wait.handle = handle;
    wait.fire = () => fn(...rest);
    wait.cancel = () => {
      wait.cancelled = true;
      realClearTimeout(handle);
    };
    timers.set(handle, wait);
    waits.push(wait);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    const wait = timers.get(handle);
    if (wait) wait.cancelled = true;
    timers.delete(handle);
    realClearTimeout(handle);
  };

  globalThis.fetch = async (url, init) => {
    /* The signal of a request is recorded as it left: a test that wants to know whether a read can
     * be interrupted at all reads it here rather than counting `AbortController`s in the source.
     */
    const request = { url: String(url), headers: { ...(init?.headers ?? {}) }, signal: init?.signal ?? null };
    state.requests.push(request);
    return server(request);
  };

  /**
   * Ask one half of the pair a message the way the other half does, and take its answer. The answer
   * can be a long way off: the read it reports hops through the offscreen document, so this waits for
   * the reply itself and not for a fixed number of waits.
   */
  function askHalf(owner, message) {
    return new Promise((resolve) => {
      let answered = false;
      let openHandlers = 0;
      const from = owner === 'worker' ? 'reader-page' : 'reader-worker';

      for (const handler of readerCalls('runtime.onMessage', owner)) {
        const keepsChannel = handler(message, { id: from }, (payload) => {
          if (answered) return;
          answered = true;
          resolve(payload);
        });
        if (keepsChannel === true) openHandlers += 1;
        if (answered) return;
      }

      /* No listener kept the channel open and none answered: Chrome sends no reply at all. */
      if (!answered && openHandlers === 0) resolve(null);
    });
  }

  return {
    ...state,
    chrome: api,
    /**
     * Let the waits a scenario started come due: the real ones run on the real clock, and every
     * request still on its way between the two contexts is answered. A test that drives a wait by
     * hand — the idle close of the document — does this instead of waiting out its 20 s.
     */
    settle: async () => {
      while (hops.size > 0) {
        api.runtime.answerDocument({ ok: true });
        await new Promise((done) => realSetTimeout(done, 0));
      }
      await new Promise((done) => realSetTimeout(done, 0));
    },
    /**
     * One turn of the real clock: enough for a listener this scenario called to reach the wait it is
     * standing in. Unlike `settle`, this answers nothing — a read can stay in flight across it.
     */
    tick: () => new Promise((done) => realSetTimeout(done, 0)),
    /**
     * Wait for a fact the running pair is expected to bring about, on the real clock, and say whether
     * it ever appeared. A test that needs a read to have *reached* its request asks here instead of
     * guessing how many turns that takes.
     */
    async waitUntil(fact, tries = 25) {
      for (let attempt = 0; attempt < tries; attempt += 1) {
        if (fact()) return true;
        await new Promise((done) => realSetTimeout(done, 0));
      }
      return fact();
    },
    /** Ask one half of the pair the way the other half does. */
    askHalf,
    /** Ask the worker a message the way a page does. */
    ask: (message) => askHalf('worker', message),
    /** Ask the offscreen document a message the way the worker does. */
    askDocument: (message) => askHalf('document', message),
    /** Every wait this scenario has armed and has not taken back, with the delay it stands for. */
    armedWaits: () => waits.filter((wait) => !wait.cancelled && !wait.fired),
    /** Call the worker the way Chrome does when one of its alarms goes off. */
    alarm: (alarm) => Promise.all(readerCalls('alarms.onAlarm', 'worker').map((fn) => fn(alarm))),
    forget() {
      /* A read this scenario abandoned still holds its feed and its document: a later scenario would
       * find the feed locked and the document counted open. Chrome takes both back when the worker
       * stops, so a scenario does the same before it goes. */
      api.runtime.answerDocument({ ok: true });
      for (const [handle, wait] of timers) {
        wait.cancelled = true;
        realClearTimeout(handle);
      }
      timers.clear();
      soundSink = realSink;
      if (realAudio) globalThis.Audio = realAudio;
      else delete globalThis.Audio;
      if (realFetch) globalThis.fetch = realFetch;
      else delete globalThis.fetch;
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      delete globalThis.chrome;
    },
  };
}

const readerPair = await importReaderPair();

/** The feed of a scenario: a row of the kind the feeds screen writes. */
function runningFeed(over = {}) {
  return {
    id: 'running',
    name: 'Running',
    rss_link: 'https://example.com/feed.json',
    delay_timeout: 30,
    /* The sample headlines are days old: a `clean_timeout` of a day would have the shelf refuse them
     * as expired before the read ever got to them. */
    clean_timeout: 30 * 24 * 60,
    ...over,
  };
}

/** The same feed answer, served the way a site serves it: a JSON Feed and the type it is under. */
function feedServer({ etag = '', lastModified = '', body = JSON_FEED } = {}) {
  const headers = { 'content-type': 'application/feed+json' };
  if (etag) headers.etag = etag;
  if (lastModified) headers['last-modified'] = lastModified;
  return () => feedResponse({ headers, body });
}

/**
 * A headline the shelf of the reader already holds for the feed of a scenario: `link` and the id the
 * feed states for it, so a test can put one headline of `feedServer()` on the shelf before the read.
 */
function storedFeedHeadline(link, id) {
  return storedHeadline({ link, sourceId: id, sourceIdType: 'json:id' });
}

/**
 * Every headline `feedServer()` serves, already on the shelf: the read of this feed can bring nothing
 * the reader does not have.
 */
function storedFeedHeadlines() {
  const feed = JSON.parse(JSON_FEED);
  return feed.items.map((item) =>
    storedFeedHeadline(
      new URL(item.url ?? item.id, feed.feed_url).href,
      String(item.id),
    ),
  );
}

/** A headline the shelf of the reader already holds for the feed of a scenario. */
function storedHeadline(over = {}) {
  return store.makeItem({
    feed: runningFeed(),
    title: 'Already on the shelf',
    link: 'https://example.com/already-here',
    description: '',
    pubDate: '',
    sourceId: 'already-here',
    sourceIdType: 'guid',
    time: Date.now(),
    ...over,
  });
}

/**
 * The worker writes the next check of a feed from the alarm it is answering, not from a formula it
 * guesses: the next read is the next period of the alarm that just went off, so the reader can name
 * it the moment the headlines come in.
 */
test('an automatic read records the next alarm of its own alarm', async () => {
  const reader = runningReader({ storage: { feeds: [runningFeed()] }, server: feedServer() });

  try {
    assert.ok(readerPair !== null, 'the worker and the document were not imported');
    assert.ok(
      readerCalls('alarms.onAlarm', 'worker').length === 1,
      'the worker registers no answer to its alarms',
    );

    const alarm = {
      name: `${util.ALARM_PREFIX}running`,
      periodInMinutes: 30,
      scheduledTime: Date.now() - MINUTE,
    };
    await reader.alarm(alarm);

    const feed = (await store.getFeeds()).find((candidate) => candidate.id === 'running');
    assert.equal(
      feed.nextAlarmAt,
      alarm.scheduledTime + 30 * MINUTE,
      'the read did not name the next period of the alarm it was answering',
    );
    assert.equal(reader.requests.length, 1, 'the read of an alarm that went off made no request');
    assert.equal(reader.requests[0].url, 'https://example.com/feed.json', 'a different feed was asked for');

    const items = await store.itemsForFeed('running');
    assert.ok(items.length > 0, 'the headlines of a feed that answered were not stored');
    assert.equal(feed.fetchFailureCount, 0, 'a read that came through left a failure behind');
    assert.equal(feed.lastErrorCode, undefined, 'a read that came through left a diagnosis behind');
    assert.ok(feed.lastCheckedAt > 0, 'the row of the feed does not say when it was read');
  } finally {
    reader.forget();
  }
});

/* ---------------- what a feed calls a headline ---------------- */

test('sourceIdentity names a headline by the id the feed states', () => {
  assert.deepEqual(
    rss.sourceIdentity({ guid: 'tag:example,2024:42', guidIsLink: false, link: 'https://a.b/x' }),
    { sourceId: 'tag:example,2024:42', sourceIdType: 'guid' },
    'isPermaLink="false" is the feed promising an id of its own, stable while its links move',
  );
  assert.deepEqual(
    rss.sourceIdentity({ guid: '  https://a.b/x?utm_source=rss  ', guidIsLink: false }),
    { sourceId: 'https://a.b/x?utm_source=rss', sourceIdType: 'guid' },
    'an id is stored as the feed wrote it: normalizing it as a link would rewrite an opaque value',
  );
  assert.deepEqual(
    rss.sourceIdentity({ guid: ' ', guidIsLink: false, link: 'https://a.b/x' }),
    { sourceId: 'https://a.b/x', sourceIdType: 'link' },
    'an empty guid is no id',
  );
  assert.deepEqual(
    rss.sourceIdentity({ guid: 'https://a.b/x', guidIsLink: true, link: 'https://a.b/y' }),
    { sourceId: 'https://a.b/y', sourceIdType: 'link' },
    'a guid that says it is an address is an address: the identity follows the link the reader keeps',
  );
  assert.deepEqual(
    rss.sourceIdentity({ atomId: 'tag:blog,2005:/posts/42', link: 'https://blog.example/posts/42' }),
    { sourceId: 'tag:blog,2005:/posts/42', sourceIdType: 'atom:id' },
    'Atom requires an <id> that outlives every link of the entry',
  );
  assert.deepEqual(
    rss.sourceIdentity({ atomId: 'http://www.blog.example/posts/42/', link: 'https://blog.example/posts/42' }),
    { sourceId: 'https://blog.example/posts/42', sourceIdType: 'atom:id' },
    'an Atom id spelled as an address is read the way a link is read',
  );
  assert.deepEqual(
    rss.sourceIdentity({ guid: 'g1', guidIsLink: false, atomId: 'a1' }),
    { sourceId: 'g1', sourceIdType: 'guid' },
    'the guid of an RSS item is asked first: an <id> inside an <item> is another vocabulary',
  );
  assert.deepEqual(
    rss.sourceIdentity({ link: 'not a link at all' }),
    { sourceId: 'not a link at all', sourceIdType: 'link' },
    'an unreadable link still identifies its headline as text',
  );
  assert.deepEqual(
    rss.sourceIdentity({ link: ' ' }),
    { sourceId: '', sourceIdType: 'link' },
    'nothing to identify: parseFeed drops such an entry',
  );
});

/** The JSON Feed of the headlines a test names, written the way a site writes one. */
function statedFeed(items) {
  return JSON.stringify({
    version: 'https://www.jsonfeed.org/version/1.1/',
    title: 'Stated ids',
    home_page_url: 'https://example.com/',
    feed_url: 'https://example.com/feed.json',
    items,
  });
}

/**
 * What a feed calls its news travels the whole way through the running reader: the offscreen document
 * reads the id and the date off the item, the worker writes them into the record it stores, and the
 * next poll recognises the news by that id — so a site that moves its addresses does not refill the
 * reader with news the reader already has.
 *
 * (That a long feed is cut at its *newest* headlines, and that two items one feed calls the same news
 * are one headline, are shown on the parser itself.)
 */
test('the id a feed states makes the whole trip: parse — record — next poll', async () => {
  const alarm = {
    name: `${util.ALARM_PREFIX}running`,
    periodInMinutes: 30,
    scheduledTime: Date.now() - MINUTE,
  };
  const fresh = new Date(Date.now() - 2 * HOUR).toISOString();
  const older = new Date(Date.now() - 5 * HOUR).toISOString();

  let served = statedFeed([
    { id: 'news-77', url: 'https://old.example/a/77', title: 'Stated by its own id', date_published: fresh },
    { id: 'news-78', url: 'https://old.example/a/78', title: 'The older news', date_published: older },
  ]);

  const reader = runningReader({
    storage: { feeds: [runningFeed()] },
    server: () => feedServer({ body: served })(),
  });

  try {
    await reader.alarm(alarm);

    const first = await store.itemsForFeed('running');
    assert.equal(first.length, 2, 'the reader stored no headlines of this feed');
    assert.equal(first[0].title, 'Stated by its own id', 'the shelf is not ordered by the date the feed stated');
    assert.deepEqual(
      { sourceId: first[0].sourceId, sourceIdType: first[0].sourceIdType },
      { sourceId: 'news-77', sourceIdType: 'json:id' },
      'the id the feed states did not reach the record the reader stores',
    );
    assert.equal(first[0].uid, 'running|news-77', 'the record is not keyed by the id the feed states');
    assert.equal(first[0].pubDate, fresh, 'the date the parser ordered the items by is not the date the record carries');

    /* The next poll of the same site, after it moved every address it states these ids stand for. */
    served = statedFeed([
      { id: 'news-77', url: 'https://new.example/story/77', title: 'Stated by its own id', date_published: fresh },
      { id: 'news-78', url: 'https://new.example/story/78', title: 'The older news', date_published: older },
    ]);

    const poll = await reader.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });
    assert.equal(poll?.seen, 2, 'the second read did not see the headlines the feed shipped');
    assert.equal(poll?.added, 0, 'a feed that moved its addresses brought news the reader already had');
    assert.equal((await store.itemsForFeed('running')).length, 2, 'the reader doubled its own headlines');
    assert.equal(reader.requests.length, 2, 'the two polls asked the feed another number of times');
  } finally {
    reader.forget();
  }
});

/* ------------------------- conditional GET ------------------------- */

/** An answer of a feed server without the network: only the parts the reader of a feed reads. */
function feedResponse({ status = 200, headers = {}, body = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    url: '',
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async arrayBuffer() {
      return new TextEncoder().encode(body).buffer;
    },
  };
}

/** `chrome.storage.local` without Chrome: enough for the feed row one read writes. */
function storageMemory() {
  const memory = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return key in memory ? { [key]: structuredClone(memory[key]) } : {};
        },
        async set(patch) {
          for (const [key, value] of Object.entries(patch)) memory[key] = structuredClone(value);
        },
      },
    },
  };
  return () => delete globalThis.chrome;
}

test('httpDate keeps a real HTTP-date and refuses anything else', () => {
  assert.equal(rss.httpDate('Mon, 07 Oct 2024 09:30:00 GMT'), 'Mon, 07 Oct 2024 09:30:00 GMT');
  assert.equal(rss.httpDate('  Mon, 7 Oct 2024 09:30:00 GMT  '), 'Mon, 07 Oct 2024 09:30:00 GMT');
  assert.equal(rss.httpDate(''), '');
  assert.equal(rss.httpDate(null), '');
  assert.equal(
    rss.httpDate('sometime last Tuesday'),
    '',
    'a validator the server cannot read would buy a 400 instead of a feed',
  );
});

test('the next read asks with exactly the validators the feed gave us', () => {
  const plain = rss.conditionalHeaders();
  assert.deepEqual(Object.keys(plain), ['Accept'], 'a feed nobody has read is asked for plainly');

  const asked = rss.conditionalHeaders({
    etag: '"abc123"',
    lastModified: 'Mon, 07 Oct 2024 09:30:00 GMT',
  });
  assert.equal(asked['If-None-Match'], '"abc123"');
  assert.equal(asked['If-Modified-Since'], 'Mon, 07 Oct 2024 09:30:00 GMT');
  assert.ok(asked.Accept.includes('application/rss+xml'), 'the read still names what it can read');

  assert.equal(
    rss.conditionalHeaders({ etag: 'W/"abc123"' })['If-None-Match'],
    undefined,
    'a weak validator promises meaning, not the bytes a GET wants',
  );
  assert.equal(
    rss.conditionalHeaders({ lastModified: 'yesterday' })['If-Modified-Since'],
    undefined,
    'a date the server cannot parse is not sent at all',
  );
  assert.equal(rss.conditionalHeaders({ etag: '  "abc123"  ' })['If-None-Match'], '"abc123"');
});

test('the validators travel with the answer, and a server that stops sending them clears them', () => {
  const answered = rss.readValidators(
    feedResponse({ headers: { etag: '"abc123"', 'last-modified': 'Mon, 07 Oct 2024 09:30:00 GMT' } }),
  );
  assert.deepEqual(answered, { etag: '"abc123"', lastModified: 'Mon, 07 Oct 2024 09:30:00 GMT' });

  assert.deepEqual(rss.readValidators(feedResponse({})), {
    etag: '',
    lastModified: '',
  });

  assert.deepEqual(
    rss.readValidators(feedResponse({ status: 304, headers: { etag: '"newer"' } })),
    { etag: '"newer"', lastModified: '' },
    'a 304 may carry a fresher key than the body it refuses to send',
  );
});

test('a 304 is an answer, not a failure: nothing is read, nothing is parsed', async () => {
  const requests = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return feedResponse({
      status: 304,
      headers: { etag: '"second"', 'last-modified': 'Tue, 08 Oct 2024 10:00:00 GMT' },
    });
  };

  try {
    const result = await rss.fetchFeed('https://a.b/rss', {
      etag: '"first"',
      lastModified: 'Mon, 07 Oct 2024 09:30:00 GMT',
    });

    assert.equal(requests.length, 1);
    const sent = requests[0].init;
    assert.deepEqual(
      Object.keys(sent.headers).sort(),
      ['Accept', 'If-Modified-Since', 'If-None-Match'],
      'the read goes out with both validators and nothing else',
    );
    assert.equal(sent.headers['If-None-Match'], '"first"');
    assert.equal(sent.headers['If-Modified-Since'], 'Mon, 07 Oct 2024 09:30:00 GMT');
    assert.equal(sent.cache, 'no-store', "the reader keeps its own validators, not Chrome's cache");

    assert.equal(result.notModified, true);
    assert.deepEqual(result.entries, []);
    assert.equal(result.feedTitle, '');
    assert.deepEqual(
      { etag: result.etag, lastModified: result.lastModified },
      { etag: '"second"', lastModified: 'Tue, 08 Oct 2024 10:00:00 GMT' },
      'the keys of the next read are the ones this answer gave',
    );
  } finally {
    if (realFetch) globalThis.fetch = realFetch;
    else delete globalThis.fetch;
  }
});

test('a status that is not a feed is a failure that carries its number', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => feedResponse({ status: 429 });

  try {
    const error = await rss.fetchFeed('https://a.b/rss').then(
      () => null,
      (caught) => caught,
    );

    assert.ok(error instanceof rss.FeedError);
    assert.equal(error.code, 'feedStatus', 'the page still gets a key it can translate');
    assert.equal(error.status, 429, 'the number travels, so the worker can tell a dead feed from a refused key');
    assert.deepEqual(error.params, { status: 429, statusText: '' });
  } finally {
    if (realFetch) globalThis.fetch = realFetch;
    else delete globalThis.fetch;
  }
});

test('a feed remembers the answers it was given, and forgets them with the address they describe', async () => {
  const forget = storageMemory();

  try {
    const base = { id: 'cond', name: 'Conditional', rss_link: 'https://a.b/rss' };
    await store.upsertFeed(base);

    await store.rememberFeedValidators('cond', {
      etag: '"first"',
      lastModified: 'Mon, 07 Oct 2024 09:30:00 GMT',
      fetchedAt: 1000,
    });
    let feed = (await store.getFeeds())[0];
    assert.equal(feed.etag, '"first"');
    assert.equal(feed.lastModified, 'Mon, 07 Oct 2024 09:30:00 GMT');
    assert.equal(feed.lastFetchedAt, 1000, 'the date belongs to the headlines these keys describe');

    // A 304 refreshes the keys without making the headlines it did not send any fresher.
    await store.rememberFeedValidators('cond', { etag: '"second"', fetchedAt: 0 });
    feed = (await store.getFeeds())[0];
    assert.equal(feed.etag, '"second"');
    assert.equal(feed.lastFetchedAt, 1000, 'a 304 sends no headlines, so nothing became newer');

    // The server stopped answering with keys: the next read must ask plainly.
    await store.rememberFeedValidators('cond', {});
    feed = (await store.getFeeds())[0];
    assert.equal(feed.etag, undefined);
    assert.equal(feed.lastModified, undefined);
    assert.equal(
      feed.lastFetchedAt,
      1000,
      'a feed whose server sends no keys still knows when its headlines came in',
    );

    assert.equal(await store.rememberFeedValidators('gone', { etag: '"x"' }), false, 'a deleted feed writes nothing');

    await store.rememberFeedValidators('cond', { etag: '"first"', lastModified: 'Mon, 07 Oct 2024 09:30:00 GMT', fetchedAt: 2000 });
    await store.markFeedChecked('cond', { ok: false, error: { code: 'feedStatus', message: 'HTTP 500' }, time: 3000 });
    feed = (await store.getFeeds())[0];
    assert.equal(feed.etag, '"first"', 'a feed that failed is not punished by forgetting the key it still has');

    await store.upsertFeed({ ...base, rss_link: 'https://a.b/new' });
    feed = (await store.getFeeds())[0];
    assert.equal(feed.rss_link, 'https://a.b/new');
    assert.equal(feed.etag, undefined, 'a key of the old address could answer 304 for a different feed');
    assert.equal(feed.lastModified, undefined);
    assert.equal(feed.lastFetchedAt, undefined);
    assert.equal(feed.lastErrorCode, undefined);

    assert.deepEqual(
      Object.keys(store.emptyFeed()),
      ['id', 'name', 'rss_link', 'delay_timeout', 'clean_timeout'],
      'a feed nobody has read still describes only its settings',
    );
  } finally {
    forget();
  }
});

/**
 * A validator is worth nothing if it never reaches the request the extension makes in another of its
 * parts. The route runs for real here: the keys the row of the feed holds go to the worker, the
 * worker hands them to the offscreen document, the document puts them on the request, and what the
 * answer sends back lands on the row again.
 */
test('the validators of a feed make the whole trip: the row — the worker — the document — the request', async () => {
  const held = 'Mon, 07 Oct 2024 09:30:00 GMT';
  const cameInAt = Date.now() - 2 * HOUR;
  const reader = runningReader({
    storage: {
      feeds: [runningFeed({ etag: '"held"', lastModified: held, lastFetchedAt: cameInAt })],
      items: [storedHeadline()],
    },
    server: ({ headers }) =>
      headers['If-None-Match']
        ? feedResponse({
            status: 304,
            headers: { etag: '"next"', 'last-modified': 'Tue, 08 Oct 2024 10:00:00 GMT' },
          })
        : feedServer()(),
  });

  try {
    await reader.alarm({
      name: `${util.ALARM_PREFIX}running`,
      periodInMinutes: 30,
      scheduledTime: Date.now() - MINUTE,
    });

    assert.equal(reader.requests.length, 1, 'the read of this alarm made no request of its own');
    assert.equal(
      reader.requests[0].headers['If-None-Match'],
      '"held"',
      'the key the row holds never reached the request the document made',
    );
    assert.equal(
      reader.requests[0].headers['If-Modified-Since'],
      held,
      'the date the row holds never reached the request the document made',
    );

    const row = (await store.getFeeds()).find((candidate) => candidate.id === 'running');
    assert.equal(row.etag, '"next"', 'the key the answer sent back was not written to the row');
    assert.equal(row.lastModified, 'Tue, 08 Oct 2024 10:00:00 GMT', 'nor was the date it sent back');

    assert.equal(await store.countItems(), 1, 'a 304 wrote headlines of its own');
    assert.equal(
      row.lastFetchedAt,
      cameInAt,
      'a 304 sends no headlines, so the age the new key describes is not made newer',
    );
    assert.ok(row.lastOkAt > 0, 'a 304 is an answer, but the row does not say the feed answered');
  } finally {
    reader.forget();
  }
});

/**
 * A 304 only makes sense while the reader still holds what the keys describe: after `clean_timeout`
 * purged the headlines of a feed, asking politely answers an empty body and leaves the reader empty
 * until somebody edits the site.
 */
test('a feed whose headlines are gone is asked for plainly, not with the keys that answer 304', async () => {
  const reader = runningReader({
    storage: {
      feeds: [runningFeed({ etag: '"held"', lastModified: 'Mon, 07 Oct 2024 09:30:00 GMT' })],
      items: [],
    },
    server: feedServer({ etag: '"next"', lastModified: 'Tue, 08 Oct 2024 10:00:00 GMT' }),
  });

  try {
    await reader.alarm({
      name: `${util.ALARM_PREFIX}running`,
      periodInMinutes: 30,
      scheduledTime: Date.now() - MINUTE,
    });

    assert.equal(reader.requests.length, 1, 'the read of this alarm made no request of its own');
    assert.equal(
      reader.requests[0].headers['If-None-Match'],
      undefined,
      'the reader asked with a key that would have answered an empty body',
    );
    assert.equal(
      reader.requests[0].headers['If-Modified-Since'],
      undefined,
      'the reader asked with a date that would have answered an empty body',
    );

    assert.ok((await store.countItems()) > 0, 'a feed whose headlines were gone was not read again');
    const row = (await store.getFeeds()).find((candidate) => candidate.id === 'running');
    assert.equal(row.etag, '"next"', 'the whole answer did not leave its keys on the row');
  } finally {
    reader.forget();
  }
});

/**
 * «не изменилось» and «0 headlines» are two words for two different answers, and the feeds screen can
 * only tell them apart if the worker's answer says which one it was. Both reads run here on the same
 * feed: one server answers an empty 304, the other sends the whole feed again and every headline of it
 * is already on the shelf — the same `added: 0`, a different read.
 */
test('the feeds screen tells an unchanged feed from a feed that brought nothing', async () => {
  const unchanged = runningReader({
    storage: {
      feeds: [runningFeed({ etag: '"held"', lastFetchedAt: Date.now() - HOUR })],
      items: storedFeedHeadlines(),
    },
    server: () => feedResponse({ status: 304, headers: { etag: '"next"' } }),
  });

  try {
    const answer = await unchanged.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });

    assert.equal(answer?.ok, true, 'the worker answered nothing to a feed that only confirmed itself');
    assert.equal(
      answer.notModified,
      true,
      'a 304 reaches the page as a read of nothing, so the page cannot know it was a 304',
    );
    assert.equal(answer.added, 0);
    assert.equal(answer.seen, 0, 'a 304 sends no body, so nothing was parsed');
    assert.equal(
      unchanged.requests[0].headers['If-None-Match'],
      '"held"',
      'the read was not asked with the key the row holds',
    );
  } finally {
    unchanged.forget();
  }

  /* The same feed, asked plainly: it brought its headlines and every one of them was already here. */
  const repeated = runningReader({
    storage: { feeds: [runningFeed()], items: storedFeedHeadlines() },
    server: feedServer(),
  });

  try {
    const answer = await repeated.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });

    assert.equal(answer?.ok, true, 'the worker answered nothing to a feed that sent its headlines');
    assert.equal(
      answer.notModified,
      false,
      'a read that parsed a body is not a 304, whatever its count says',
    );
    assert.equal(answer.added, 0, 'a headline the shelf holds is counted as new');
    assert.equal(answer.seen, JSON.parse(JSON_FEED).items.length, 'the headlines of the body were not parsed');
  } finally {
    repeated.forget();
  }

  /* The word for the first of them is the reader's own, translated by every language it speaks. */
  const feedsJs = fs.readFileSync(new URL('../src/feeds.js', import.meta.url), 'utf8');
  assert.ok(
    feedsJs.includes("t('feeds.resultUnchanged')"),
    'the feeds screen says something other than the dictionary key for a feed that only confirmed itself',
  );
  for (const lang of i18n.LANGUAGES) {
    assert.ok(
      i18n.dictionaryKeys(lang).includes('feeds.resultUnchanged'),
      `${lang} has no feeds.resultUnchanged, which an unchanged feed asks to show`,
    );
  }
});

/**
 * Two failures can end a read, and only one of them belongs to the feed: a dead address, a 500, a
 * body that is not a feed diagnoses the feed and pauses it; a shelf the reader could not write to
 * diagnoses nothing, because the feed never had the chance to refuse. Here the shelf of the reader is
 * what fails, and the row of the feed shows which of the two it was.
 */
test('a read that the reader itself could not finish leaves the feed healthy', async () => {
  const reader = runningReader({
    storage: { feeds: [runningFeed()] },
    server: feedServer(),
    refuse: (key) => key === store.ITEMS_KEY,
  });

  try {
    await reader.alarm({
      name: `${util.ALARM_PREFIX}running`,
      periodInMinutes: 30,
      scheduledTime: Date.now() - MINUTE,
    });
    await reader.settle();

    assert.equal(reader.requests.length, 1, 'the feed was not even asked');

    const row = (await store.getFeeds()).find((candidate) => candidate.id === 'running');
    assert.ok(row.lastCheckedAt > 0, 'the read the reader could not finish left no mark on the feed');
    assert.equal(row.fetchFailureCount, 0, 'the reader counted its own shelf as a refusal of the feed');
    assert.equal(row.nextRetryAt, undefined, 'a healthy feed was put in a pause because the reader could not write');
    assert.equal(row.lastErrorCode, undefined, 'the failure of the reader was written as an answer of the feed');
    assert.ok(row.lastOkAt > 0, 'the row does not say the feed answered');
    assert.equal(await store.countItems(), 0, 'the shelf that refused nevertheless kept the headlines');

    assert.equal(feedPauseRemaining(row), 0, 'the next alarm of this feed is not held off by a fault of the reader');

    /* The fault of the shelf is named by a key of its own, so the page can say it is the reader that
     * failed — the same read asked by hand answers with it. */
    const answer = await reader.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });
    assert.equal(answer.ok, false, 'a read by hand invented an answer for a shelf that refuses');
    assert.equal(answer.error.code, 'storageUnavailable', 'the fault of the shelf carries no key a language can translate');
  } finally {
    reader.forget();
  }
});

test('an automatic read waits out the pause of a failing feed, a read by hand does not', async () => {
  const reader = runningReader({
    storage: {
      feeds: [runningFeed({
        fetchFailureCount: 2,
        nextRetryAt: Date.now() + 10 * MINUTE,
        lastErrorCode: 'feedStatus',
      })],
    },
    server: feedServer(),
  });

  try {
    await reader.alarm({
      name: `${util.ALARM_PREFIX}running`,
      periodInMinutes: 30,
      scheduledTime: Date.now(),
    });

    assert.equal(reader.requests.length, 0, 'a feed in its pause was asked anyway');

    /* A read by hand is an explicit order: the pause of a feed does not refuse it. */
    const answer = await reader.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });
    assert.equal(answer?.ok, true, 'the worker refused a read the user asked for by hand');
    assert.equal(reader.requests.length, 1, 'the read by hand asked no feed');

    const row = (await store.getFeeds()).find((candidate) => candidate.id === 'running');
    assert.equal(row.fetchFailureCount, 0, 'a read that came through left the streak of failures standing');
    assert.equal(row.nextRetryAt, undefined, 'a feed that answered is not kept in its pause');
  } finally {
    reader.forget();
  }

  /* Reading the whole list is a read by hand too: it asks a feed that is in its pause as well. */
  const batch = runningReader({
    storage: { feeds: [runningFeed({ fetchFailureCount: 2, nextRetryAt: Date.now() + 10 * MINUTE, lastErrorCode: 'feedStatus' })] },
    server: feedServer(),
  });

  try {
    const answer = await batch.ask({ type: MSG_REFRESH_ALL_FEEDS });
    assert.equal(answer?.ok, true, 'the worker answered nothing to a read of the whole list');
    assert.ok(
      answer.results.some((result) => result.feedId === 'running' && result.ok),
      'a batch read left the feed that was in its pause unread',
    );
    assert.equal(batch.requests.length, 1, 'the batch asked no feed');
  } finally {
    batch.forget();
  }
});

/* --------------------- fetch timeouts & feed pause --------------------- */

/**
 * A site that takes a request and then says nothing at all is the whole reason a limit exists. This
 * puts a read in front of such a site — or in front of one that answers, when a test wants to know
 * what a read does with a wait it no longer needs — and reports what the read did while it waited:
 * the request it sent, with the signal that could interrupt it, and every wait it armed, recorded
 * rather than left to run so a test can pull one down by hand instead of sitting out the reader's
 * limit.
 *
 * Whether a request can be interrupted at all, whether the wait put on it is the reader's own limit,
 * and whether that wait is taken back once the answer arrived are told here by what the read ends up
 * doing. None of it is readable from the source: a controller nobody aborts looks in the text exactly
 * like one somebody aborts.
 */
function watchedRead({ server = null } = {}) {
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const requests = [];
  const waits = [];
  const started = [];

  globalThis.fetch = (url, init) => {
    const signal = init?.signal ?? null;
    const request = { url: String(url), signal };
    requests.push(request);

    if (server) return Promise.resolve(server(request));

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('the reader had already stopped waiting'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new Error('the reader stopped waiting for the site')));
      /* A request no signal could interrupt must not hang the suite either: it gives up by itself. */
      if (!signal) realSetTimeout(() => reject(new Error('a request no signal could interrupt')), 200);
    });
  };

  globalThis.setTimeout = (fn, ms) => {
    const wait = { ms, cancelled: false, fire: () => fn() };
    waits.push(wait);
    return wait;
  };
  globalThis.clearTimeout = (wait) => {
    if (wait) wait.cancelled = true;
  };

  return {
    requests,
    /** One turn of the real clock: enough for a read started here to reach the request it makes. */
    turn: () => new Promise((done) => realSetTimeout(done, 0)),
    /** The waits that are still armed: nothing has pulled them down, nothing has taken them back. */
    armed: () => waits.filter((wait) => !wait.cancelled),
    /** Start a read under this watch. A failure comes back as `{error}` instead of being thrown. */
    start(read) {
      const outcome = Promise.resolve().then(read).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      started.push(outcome);
      return outcome;
    },
    /**
     * Pull every wait still armed down by hand and report what each read this watch started ended as.
     * `hung` says the reader had no way at all to stop its own request. The watch's fakes go back
     * whichever way the reads end.
     */
    async finish(ms = 200) {
      for (const wait of waits) {
        if (!wait.cancelled) wait.fire();
      }
      const patience = new Promise((done) => realSetTimeout(() => done('hung'), ms));
      const settled = await Promise.race([Promise.all(started), patience]);

      globalThis.fetch = realFetch;
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      return settled;
    },
  };
}

test('every request the reader waits for is waited for only so long', async () => {
  /* The three sites the reader waits for: the read that reaches them, the limit it arms, and — for
   * the two that diagnose what stopped them — the key that failure carries. */
  const sites = [
    {
      what: 'a feed',
      read: (watch) => watch.start(() => rss.fetchFeed('https://example.com/feed.json')),
      limit: FEED_FETCH_TIMEOUT_MS,
      code: 'feedTimeout',
    },
    {
      what: 'the page of a headline',
      read: (watch) => watch.start(() => extract.fetchArticle('https://example.com/article')),
      limit: ARTICLE_FETCH_TIMEOUT_MS,
      code: 'articleTimeout',
    },
    {
      what: 'the page an icon is looked for on',
      /* `discoverFeedIcon` reports no failure for a page it cannot read; only its fallback shows that
       * it stopped waiting at all. The feed address is a site root, so the icon read is one request. */
      read: (watch) => watch.start(() => favicon.discoverFeedIcon('https://example.com/')),
      limit: ARTICLE_FETCH_TIMEOUT_MS,
      code: null,
    },
  ];

  for (const site of sites) {
    const watch = watchedRead();
    site.read(watch);
    await watch.turn();

    /* The read has left; its answer has not come. */
    assert.equal(watch.requests.length, 1, `${site.what}: the read made no request, so nothing was waited for`);
    assert.equal(
      typeof watch.requests[0].signal?.addEventListener,
      'function',
      `${site.what}: the request carries no signal, so nothing can interrupt it`,
    );
    assert.equal(
      watch.armed().length,
      1,
      `${site.what}: nothing stands ready to stop this request`,
    );
    assert.equal(
      watch.armed()[0].ms,
      site.limit,
      `${site.what} is not waited for as long as the reader says it is`,
    );
    assert.equal(
      watch.requests[0].signal.aborted,
      false,
      `${site.what} was stopped before its wait came due`,
    );

    const [ended] = await watch.finish();

    assert.notEqual(
      ended,
      'hung',
      `${site.what} keeps waiting on a site that never answers: its wait was armed but never pulled`,
    );
    assert.equal(
      watch.requests[0].signal.aborted,
      true,
      `${site.what}: pulling the wait down did not interrupt the request it stands for`,
    );

    if (site.code) {
      assert.equal(ended.value, undefined, `${site.what} invented an answer for a site that sent none`);
      assert.equal(
        ended.error?.code,
        site.code,
        `${site.what} failed without the key a language translates it with`,
      );
    } else {
      assert.equal(
        ended.value,
        'https://example.com/favicon.ico',
        `${site.what} was not read, and the icon of its site is not the fallback the reader offers`,
      );
    }
  }

  /* A wait that is still armed after its answer arrived would interrupt the next request put on it. */
  const answered = watchedRead({
    server: () => feedResponse({
      headers: { 'content-type': 'application/feed+json' },
      body: JSON_FEED,
    }),
  });
  const read = answered.start(() => rss.fetchFeed('https://example.com/feed.json'));

  const [cameBack] = await answered.finish();
  assert.equal(cameBack.value?.entries.length, JSON.parse(JSON_FEED).items.length, 'the feed that answered was not read');
  assert.equal(answered.armed().length, 0, 'a read that answered left its wait armed for the next request');

  assert.ok(
    FEED_FETCH_TIMEOUT_MS >= 10_000 && FEED_FETCH_TIMEOUT_MS <= 20_000,
    'a feed read is waited for between 10 and 20 seconds',
  );
  assert.ok(
    ARTICLE_FETCH_TIMEOUT_MS >= 10_000 && ARTICLE_FETCH_TIMEOUT_MS <= 15_000,
    'a page — an icon, an article — is waited for between 10 and 15 seconds',
  );
});

/* --------------- one feed is read once (in-flight lock) --------------- */

test('a feed that is being read is held; its neighbour is not', async () => {
  const forget = storageMemory();

  try {
    assert.equal(await store.tryLockFeed('a'), true, 'a feed nobody reads is taken');
    assert.equal(await store.tryLockFeed('a'), false, 'the same feed is not read twice at once');
    assert.equal(await store.tryLockFeed('b'), true, 'the hold belongs to one feed, not to the list');

    await store.releaseFeedLock('a');
    assert.equal(await store.tryLockFeed('a'), true, 'a read that ended gives its feed back');
    assert.equal(await store.releaseFeedLock('c'), false, 'there was nothing to give back');
  } finally {
    forget();
  }
});

test('a hold that outlived the read it protects stops holding', async () => {
  const forget = storageMemory();

  try {
    const ttl = store.FETCH_LOCK_TTL_MS;
    assert.ok(
      ttl > FEED_FETCH_TIMEOUT_MS * 2,
      'the offscreen document may ask one feed twice (`requestOffscreen` makes two attempts), so the hold must outlive both',
    );

    const t0 = 1000;
    await store.tryLockFeed('a', { now: t0 });
    assert.equal(
      await store.tryLockFeed('a', { now: t0 + ttl - 1 }),
      false,
      'a read that is still running holds its feed',
    );
    assert.equal(
      await store.tryLockFeed('a', { now: t0 + ttl }),
      true,
      'a service worker that fell asleep mid-read must not leave the feed unreadable',
    );

    await store.tryLockFeed('stale', { now: t0 });
    await store.tryLockFeed('live', { now: t0, ttlMs: 3 * ttl });
    assert.deepEqual(
      await store.cleanupFetchLocks(t0 + 2 * ttl - 1),
      { removed: 1 },
      'the sweep of a minute drops the ticket of a read that never came back and leaves the live one',
    );
    assert.equal(await store.tryLockFeed('stale', { now: t0 + ttl }), true, 'the sweep gave the stale feed back');
  } finally {
    forget();
  }
});

test('a deleted feed takes its hold with it', async () => {
  const forget = storageMemory();

  try {
    await store.upsertFeed({ id: 'gone', name: 'Gone', rss_link: 'https://a.b/rss' });
    await store.tryLockFeed('gone');
    await store.deleteFeed('gone');

    const stored = await chrome.storage.local.get(store.FETCH_LOCKS_KEY);
    assert.deepEqual(stored[store.FETCH_LOCKS_KEY] ?? {}, {}, 'nothing holds a feed nobody can read');
  } finally {
    forget();
  }
});

/**
 * The lock only works if the worker really uses it: an alarm and a read by hand are two independent
 * paths to the same address. Both are run here against one running worker — a second request takes the
 * answer of the read in progress instead of asking the address again, a feed another context holds is
 * not asked at all (not by a page, not by its own alarm), and a read that failed gives its feed back.
 */
test('one feed is read once, whoever asked for the read', async () => {
  const alarm = {
    name: `${util.ALARM_PREFIX}running`,
    periodInMinutes: 30,
    scheduledTime: Date.now() - MINUTE,
  };

  /* A read held at its request: the feed answers only when this test lets it, so the request that
   * follows is surely made while the first is still in flight. */
  let releaseRead = null;
  const gate = new Promise((done) => { releaseRead = done; });
  const joining = runningReader({
    storage: { feeds: [runningFeed()] },
    server: async () => {
      await gate;
      return feedServer()();
    },
  });

  try {
    const reading = joining.alarm(alarm);
    assert.ok(
      await joining.waitUntil(() => joining.requests.length === 1),
      'the automatic read never got as far as its request',
    );

    const asked = joining.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });
    await joining.tick();

    assert.equal(
      joining.requests.length, 1,
      'the second request asked the address again while the read it joined was still going',
    );

    releaseRead();
    await reading;
    const answer = await asked;

    assert.equal(answer?.ok, true, 'the request that joined the read was never answered');
    assert.equal(
      answer?.busy, undefined,
      'a request of the very worker doing the read was told the feed is busy',
    );
    assert.equal(answer?.added, 3, 'the joined request did not take the headlines of the read it joined');
    assert.equal(answer?.seen, 3, 'the joined request reported no numbers of its own');
    assert.equal(joining.requests.length, 1, 'two requests of one feed read it twice');
  } finally {
    joining.forget();
  }

  /* A live ticket in the storage stands for a read this worker did not start — another window, a
   * worker that woke again. Such a feed is left alone: no request, no parsing, and `busy` says why
   * the answer carries no headlines. */
  const held = runningReader({ storage: { feeds: [runningFeed()] }, server: feedServer() });
  try {
    assert.equal(await store.tryLockFeed('running'), true, 'nobody should hold the feed before this test holds it');

    const asked = await held.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });
    assert.equal(asked?.busy, true, 'a read of a feed another context holds does not say so');
    assert.deepEqual(
      { added: asked?.added, skipped: asked?.skipped, seen: asked?.seen },
      { added: 0, skipped: 0, seen: 0 },
      'a feed that is being read is reported empty, not counted by the read that holds it',
    );
    assert.equal(held.requests.length, 0, 'the reader asked the address of a feed it was told is held');
    assert.equal(held.sends.length, 0, 'the reader still asked its document to parse a held feed');

    /* The same feed's own alarm: standing down is the answer, not a second read. */
    await held.alarm(alarm);
    assert.equal(held.requests.length, 0, 'the alarm of a feed being read asked the address anyway');
    assert.equal(held.sounds.length, 0, 'a skipped read signalled a load it never made');
    assert.equal(held.notifications.length, 0, 'a skipped read interrupted with a popup');

    /* The batch read goes by the same rule: it reports the held feed rather than reading it. */
    const batch = await held.ask({ type: MSG_REFRESH_ALL_FEEDS });
    assert.deepEqual(
      batch?.results,
      [{ feedId: 'running', ok: true, added: 0, skipped: 0, seen: 0, notModified: false, busy: true }],
      'a read of every feed took the feed another context holds',
    );
    assert.equal(held.requests.length, 0, 'the read of every feed asked a held feed anyway');
  } finally {
    held.forget();
  }

  /* A read that failed held its feed only while it was going: the feed is readable right after it. */
  let asks = 0;
  const failing = runningReader({
    storage: { feeds: [runningFeed()] },
    server: () => {
      asks += 1;
      return asks === 1 ? feedResponse({ status: 500 }) : feedServer()();
    },
  });
  try {
    const first = await failing.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });
    assert.equal(first?.ok, false, 'a feed that answered a failure reported no failure');
    assert.equal(first?.busy, undefined, 'the read that failed left its feed held');

    const second = await failing.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });
    assert.equal(second?.ok, true, 'the feed of a read that failed is not readable again');
    assert.equal(second?.added, 3, 'the read that followed a failure brought no headlines');
    assert.equal(failing.requests.length, 2, 'a failed read asked the address more than once');
  } finally {
    failing.forget();
  }
});

/**
 * The signal of a load belongs to an automatic read that really brought headlines, and its numbers
 * are the ones the shelf reported — a read that kept nothing cannot sound, and a read the user asked
 * for by hand is silent whatever it brought.
 */
test('the load signal sounds only on an automatic read that brought headlines', async () => {
  const alarm = {
    name: `${util.ALARM_PREFIX}running`,
    periodInMinutes: 30,
    scheduledTime: Date.now() - MINUTE,
  };

  /* An automatic read that brought headlines: the signal and the popup belong to it, and the popup
   * only where the user asked for one on the settings screen. */
  const automatic = runningReader({
    storage: { feeds: [runningFeed()], settings: { [store.SHOW_MESSAGE_KEY]: true } },
    server: feedServer(),
  });
  try {
    await automatic.alarm(alarm);

    assert.equal(automatic.requests.length, 1, 'the alarm read the feed did not ask it');
    assert.equal(automatic.sounds.length, 1, 'an automatic read that brought headlines played no signal');
    assert.equal(automatic.sends.filter((send) => send.type === MSG_PLAY_SOUND).length, 1,
      'the signal was never asked of the document that is allowed to play it');
    assert.equal(automatic.notifications.length, 1, 'the load that brought headlines showed no popup');
    assert.ok(automatic.popups.size > 0, 'the popup of the load is not on the screen');
  } finally {
    automatic.forget();
  }

  /* The same feed, the same headlines, read by hand: the user is standing in front of the reader. */
  const byHand = runningReader({
    storage: { feeds: [runningFeed()], settings: { [store.SHOW_MESSAGE_KEY]: true } },
    server: feedServer(),
  });
  try {
    const answer = await byHand.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });

    assert.equal(answer?.ok, true, 'the read by hand did not read the feed');
    assert.equal(byHand.requests.length, 1, 'a read by hand asked no feed');
    assert.equal(byHand.sounds.length, 0, 'a read the user asked for by hand played its signal anyway');
    assert.equal(byHand.notifications.length, 0, 'a read the user asked for by hand interrupted with a popup');
  } finally {
    byHand.forget();
  }

  /* An automatic read of a feed whose headlines are already on the shelf brought nothing, so it
   * cannot sound: the signal would promise headlines the list does not have. */
  const unchanged = runningReader({
    storage: {
      feeds: [runningFeed()],
      items: storedFeedHeadlines(),
      settings: { [store.SHOW_MESSAGE_KEY]: true },
    },
    server: feedServer(),
  });
  try {
    await unchanged.alarm({ ...alarm, scheduledTime: Date.now() });

    assert.equal(unchanged.requests.length, 1, 'the automatic read of this feed made no request');
    assert.equal(unchanged.sounds.length, 0, 'a load that brought no headlines played its signal');
    assert.equal(unchanged.notifications.length, 0, 'a load that brought no headlines showed a popup');
    assert.equal((await store.itemsForFeed('running')).length, 3, 'a load that brought nothing rewrote the shelf');
  } finally {
    unchanged.forget();
  }

  /* The numbers a load reports — and the signal it earns — are those of the headlines the shelf
   * really took, not of the ones its feed happened to ship: one of the three is already there, so
   * the read brings two, and two is enough to sound. */
  const partly = runningReader({
    storage: {
      feeds: [runningFeed()],
      items: [storedFeedHeadline('https://multfilmy.example/news/1042', '1042')],
      settings: { [store.SHOW_MESSAGE_KEY]: true },
    },
    server: feedServer(),
  });
  try {
    await partly.alarm({ ...alarm, scheduledTime: Date.now() });

    const held = await store.itemsForFeed('running');
    assert.equal(held.length, 3, 'the two headlines the shelf did not have did not reach it');
    assert.equal(partly.sounds.length, 1, 'a load that brought two new headlines stayed silent');
    assert.equal(partly.notifications.length, 1, 'a load that brought two new headlines showed no popup');
  } finally {
    partly.forget();
  }

  /* A read of the whole list, asked by hand: it reads the feed and stays silent for it, exactly as
   * the read of one feed does. */
  const batch = runningReader({
    storage: { feeds: [runningFeed()], settings: { [store.SHOW_MESSAGE_KEY]: true } },
    server: feedServer(),
  });
  try {
    const answer = await batch.ask({ type: MSG_REFRESH_ALL_FEEDS });

    assert.equal(answer?.failed, 0, 'the read of every feed failed on the one feed there is');
    assert.equal(answer?.results[0]?.added, 3, 'the read of every feed brought no headlines');
    assert.equal(batch.requests.length, 1, 'the read of every feed asked the one feed another number of times');
    assert.equal(batch.sounds.length, 0, 'a read of every feed, asked by hand, played its signal');
    assert.equal(batch.notifications.length, 0, 'a read of every feed, asked by hand, interrupted with a popup');
  } finally {
    batch.forget();
  }

  /* A headline the user deleted is held off the shelf by its mark: the read counts it, does not add
   * it, and the two that did arrive are what the signal speaks of. */
  const marked = runningReader({
    storage: {
      feeds: [runningFeed()],
      read: [store.makeReadRecord(storedFeedHeadline('https://multfilmy.example/news/1042', '1042'))],
    },
    server: feedServer(),
  });
  try {
    const answer = await marked.ask({ type: MSG_REFRESH_FEED, feedId: 'running' });

    assert.equal(answer?.seen, 3, 'the read does not say how many headlines the feed shipped');
    assert.equal(answer?.added, 2, 'the read counts a headline the reader has already seen as news');
    assert.equal(answer?.skipped, 1, 'the headline the user deleted is not counted as news');
    assert.equal(marked.sounds.length, 0, 'a read the user asked for by hand played its signal anyway');
  } finally {
    marked.forget();
  }
});

/* ------------------------- the popup that brings the reader ------------------------- */

/**
 * A system popup is worth its noise only when clicking it lands somewhere and when a batch of feeds
 * cannot bury the user in popups. The popup center, the tabs and the click Chrome hands back are all
 * stood in for here; the ids, the ceiling and the answer to a click are ours to get right.
 */
test('a popup a user clicks opens the reader, and a batch keeps only its newest popups', async () => {
  const opened = [];
  const created = [];
  const popups = new Map();
  /* Anything the reader tries to wire *again* on this stub: the answers were wired once, when the
   * pair was imported, and this test uses those listeners. */
  const rewired = [];

  globalThis.chrome = {
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    storage: { local: { async get() { return { settings: { show_message: true, language: 'en' } }; } } },
    notifications: {
      async create(id, options) {
        created.push(id);
        popups.set(id, options);
        return id;
      },
      async clear(id) {
        popups.delete(id);
        return true;
      },
      async getAll() {
        return Object.fromEntries(popups);
      },
      onClicked: { addListener: (fn) => rewired.push(fn) },
      onClosed: { addListener: (fn) => rewired.push(fn) },
    },
    tabs: {
      async query() {
        return [];
      },
      async create(options) {
        opened.push(options.url);
        return { id: 7 };
      },
      async update(id, patch) {
        return { id, ...patch };
      },
    },
    windows: { async update(id) { return { id }; } },
  };

  /* The popup TTL is a real wait; a test of the ceiling has no reason to sit through it. */
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

  try {
    const clicks = readerCalls('notifications.onClicked', 'worker');
    const closures = readerCalls('notifications.onClosed', 'worker');
    assert.equal(clicks.length, 1, 'the worker listens to a click on a popup exactly once');
    assert.equal(closures.length, 1, 'a popup that disappeared on its own is forgotten');

    const ids = [];
    for (let headlines = 1; headlines <= 6; headlines += 1) {
      assert.equal(await notify.notifyIngest(headlines), true, 'a load that brought headlines shows its popup');
    }
    ids.push(...created);

    assert.equal(
      ids.length,
      6,
      'six loads each show their own popup',
    );

    assert.equal(
      new Set(ids).size,
      6,
      'six feeds bring six distinct popups, not one popup rewritten six times by an id made of the same millisecond',
    );
    assert.equal(
      popups.size,
      NOTIFY_MAX_ACTIVE,
      `six loads leave ${NOTIFY_MAX_ACTIVE} popups on the screen, not six`,
    );
    assert.ok(
      !popups.has(ids[0]) && !popups.has(ids[1]) && !popups.has(ids[2]),
      'the oldest popups are the ones that went away',
    );

    const newest = ids[5];
    assert.ok(popups.has(newest), 'the newest popup is the one that stayed');
    assert.match(newest, /^rss-reader:ingest:\d+:\d+$/, 'a popup id names what it is and when it was made');

    /* The answer to a click: its own popup goes, the reader comes. */
    await notify.answerNotificationClick(newest);
    assert.deepEqual(
      opened,
      [`chrome-extension://test/${READER_PAGE}`],
      'the click opens the reader the extension itself ships',
    );
    assert.ok(!popups.has(newest), 'the popup you clicked is taken off the screen');

    /* The listener the worker raised hands the click to that same answer, and Chrome does not wait
     * for it — so its work is followed from the outside, not by awaiting the listener. */
    await clicks[0](ids[4]);
    await settle();
    assert.equal(opened.length, 2, 'the raised listener answers its click the same way');
    assert.ok(!popups.has(ids[4]), 'the popup the listener was clicked on is taken off the screen');

    notify.wireNotificationClicks();
    assert.equal(rewired.length, 0, 'the same worker answers one click twice');
  } finally {
    globalThis.setTimeout = realSetTimeout;
    delete globalThis.chrome;
  }
});

/**
 * The ceiling is kept by us, but the popups of a worker that died and came back are Chrome's. Pruning
 * them on startup is what keeps a closed popup from leaving its three predecessors on the screen.
 */
test('popups left over from an earlier worker drop the oldest until only the newest ceiling remains', async () => {
  const cleared = [];
  globalThis.chrome = {
    notifications: {
      async clear(id) {
        cleared.push(id);
        return true;
      },
    },
  };

  try {
    const base = 1_700_000_000_000;
    const stale = [];
    for (let n = 0; n < NOTIFY_MAX_ACTIVE + 2; n += 1) {
      stale.push(notify.notificationId(base + n * 1000, n));
    }

    /* Chrome reports the live popups in an order of its own; the time sits in the id we made. */
    const overCapacity = NOTIFY_MAX_ACTIVE + 2 - NOTIFY_MAX_ACTIVE;
    assert.deepEqual(
      await notify.pruneLiveNotifications([...stale].reverse()),
      stale.slice(0, overCapacity),
      'the oldest popups are cleared, whatever order Chrome listed them in',
    );
    assert.deepEqual(cleared, stale.slice(0, overCapacity), 'the clears are those of the cleared popups');

    const kept = stale.slice(overCapacity);
    assert.deepEqual(await notify.pruneLiveNotifications(kept), [], 'a queue already at the ceiling keeps what it holds');
    assert.deepEqual(await notify.pruneLiveNotifications(kept), [], 'pruning the same queue again clears nothing more');

    assert.deepEqual(
      await notify.pruneLiveNotifications(['another-extension:ping']),
      [],
      'the popups of another extension are not ours to close',
    );
    assert.equal(cleared.length, overCapacity, 'nothing but our own oldest popups was ever cleared');

    assert.deepEqual(
      await notify.pruneLiveNotifications([]),
      [],
      'a reader that saw no popups forgets popups it never had',
    );
  } finally {
    delete globalThis.chrome;
  }
});

/**
 * A popup is worth showing only when the worker really raised the listeners that answer a click on it.
 * The ones used here are what `src/background.js` registered while it was imported — the worker is never
 * asked to wire anything again — and they are driven by a real automatic load through a real popup of
 * the running reader, as far as the tab the reader opens.
 */
test('the worker wires the popup click at startup', async () => {
  const clicks = readerCalls('notifications.onClicked', 'worker');
  const closures = readerCalls('notifications.onClosed', 'worker');

  assert.equal(clicks.length, 1, 'nothing answers a click on the popup the reader shows');
  assert.equal(closures.length, 1, 'nothing notices a popup that came off the screen on its own');

  const reader = runningReader({
    storage: {
      feeds: [runningFeed()],
      settings: { [store.SHOW_MESSAGE_KEY]: true, [store.LANGUAGE_KEY]: 'en' },
    },
    server: feedServer(),
  });

  try {
    await reader.alarm({
      name: `${util.ALARM_PREFIX}running`,
      periodInMinutes: 30,
      scheduledTime: Date.now() - MINUTE,
    });

    const [popup] = reader.notifications;
    assert.ok(popup, 'the automatic load showed no popup to click');
    assert.ok(reader.popups.has(popup.id), 'the popup the worker asked for is not on the screen');

    /* Chrome does not wait for the answer to a click, so its work is followed from the outside. */
    clicks[0](popup.id);
    const readerPage = reader.chrome.runtime.getURL(READER_PAGE);

    assert.ok(
      await reader.waitUntil(() => reader.tabs.some((tab) => tab.url === readerPage)),
      'clicking the popup never brought the reader up',
    );
    assert.equal(reader.popups.size, 0, 'the popup a user clicked is still on the screen');

    /* The reader the first click opened is the one the next click finds: one entry in the tab strip. */
    clicks[0](popup.id);
    assert.ok(
      await reader.waitUntil(() => reader.tabUpdates.length === 1),
      'a second click did not find the reader tab that was already open',
    );
    assert.equal(reader.tabs.length, 1, 'a second click stacked a second copy of the reader');
    assert.equal(reader.tabUpdates[0].active, true, 'the reader tab that was open was not brought forward');
  } finally {
    reader.forget();
  }
});

/* --------------------- the document the worker closes behind it --------------------- */

/**
 * Chrome keeps an offscreen document open until somebody closes it, so a reader that only borrows a
 * DOM — parse the answer of a feed, play the signal — would otherwise hold a live document with
 * network access for the rest of the browser session, long after the feed it parsed lies on the
 * shelf. Raising that close is ours; this shows it answers: requests that follow one another share
 * one document, the quiet after them closes it, and a later request opens a fresh one.
 */
test('the offscreen document is closed once the reader stops borrowing it', async () => {
  const created = [];
  const closed = [];
  const waits = [];
  let open = false;

  globalThis.chrome = {
    offscreen: {
      async createDocument(options) {
        created.push(options);
        open = true;
      },
      async closeDocument() {
        // Chrome throws here when no document is open.
        if (!open) throw new Error('no offscreen document to close');
        open = false;
        closed.push('closed');
      },
    },
    runtime: {
      async getContexts({ contextTypes }) {
        return contextTypes.includes('OFFSCREEN_DOCUMENT') && open ? [{ id: 'offscreen' }] : [];
      },
      sendMessage(_message, callback) {
        callback({ ok: true, result: { entries: [] } });
      },
    },
  };

  /* The idle wait is a real wait; the test drives the wait it stands in for. */
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => {
    const wait = { fn, ms, cancelled: false };
    waits.push(wait);
    return wait;
  };
  globalThis.clearTimeout = (wait) => {
    if (wait) wait.cancelled = true;
  };
  const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

  try {
    await offscreenLib.requestOffscreen({ type: MSG_FETCH_FEED, url: 'https://example.test/rss' });
    assert.equal(created.length, 1, 'a read that needs a DOM gets its document');
    assert.deepEqual(
      created[0].reasons,
      ['AUDIO_PLAYBACK', 'DOM_PARSER'],
      'the one document is raised for the parsing and for the signal together',
    );

    await offscreenLib.requestOffscreen({ type: MSG_PLAY_SOUND, src: 'src/media/ceres.mp3' });
    assert.equal(
      created.length,
      1,
      'the request that follows uses the document that is already open',
    );

    const live = waits.filter((wait) => !wait.cancelled);
    assert.equal(live.length, 1, 'one wait for the close stands, not one per request');
    assert.equal(live[0].ms, IDLE_CLOSE_MS, 'the close waits out the quiet after the last request');
    assert.equal(
      closed.length,
      0,
      'a document the reader still works with is not closed under it: the signal has to finish first',
    );

    live[0].fn();
    await settle();
    assert.equal(closed.length, 1, 'the quiet after the last request closes the document');
    assert.equal(
      await offscreenLib.hasOffscreenDocument(),
      false,
      'the reader does not count a document it closed',
    );

    await offscreenLib.requestOffscreen({ type: MSG_FETCH_FEED, url: 'https://example.test/rss' });
    assert.equal(created.length, 2, 'a request that comes later opens a fresh document');

    /* Close raised by the worker itself does not wait for the quiet: no request is left — close. */
    for (const wait of waits) globalThis.clearTimeout(wait);
    await offscreenLib.closeOffscreenDocument();
    assert.equal(
      closed.length,
      2,
      'the document a request opened is closed again by the same worker',
    );

    await offscreenLib.closeOffscreenDocument();
    assert.equal(
      closed.length,
      2,
      'a close asked for with no document open does not ask Chrome a second time',
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    delete globalThis.chrome;
  }
});

/**
 * Простой не должен закрыть документ под запросом, который ещё идёт: одно чтение уже ответило и
 * поставило таймер закрытия, а другое всё ещё держит связь с offscreen-документом. Тот же таймер
 * в этом случае ставит новую попытку вместо закрытия.
 */
test('a close on standby waits for the read that is still going', async () => {
  const closed = [];
  const waits = [];
  let open = false;
  let answer = null;
  let sends = 0;

  globalThis.chrome = {
    offscreen: {
      async createDocument() {
        open = true;
      },
      async closeDocument() {
        if (!open) throw new Error('no offscreen document to close');
        open = false;
        closed.push('closed');
      },
    },
    runtime: {
      async getContexts({ contextTypes }) {
        return contextTypes.includes('OFFSCREEN_DOCUMENT') && open ? [{ id: 'offscreen' }] : [];
      },
      sendMessage(_message, callback) {
        sends += 1;
        /* Первое чтение отвечает не сразу: оно держит документ, пока тест сам не ответит. */
        if (sends === 1) {
          answer = () => callback({ ok: true, result: { entries: [] } });
          return;
        }
        callback({ ok: true, result: { entries: [] } });
      },
    },
  };

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => {
    const wait = { fn, ms, cancelled: false };
    waits.push(wait);
    return wait;
  };
  globalThis.clearTimeout = (wait) => {
    if (wait) wait.cancelled = true;
  };
  const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

  try {
    const inflight = offscreenLib.requestOffscreen({
      type: MSG_FETCH_FEED,
      url: 'https://example.test/rss',
      attempts: 1,
    });
    await settle();

    /* Чтение, которое ответило: оно и ставит тот таймер, что собирается закрыть документ. */
    await offscreenLib.requestOffscreen({ type: MSG_PLAY_SOUND, src: 'src/media/ceres.mp3' });

    const armed = waits.filter((wait) => !wait.cancelled);
    assert.equal(
      armed.length,
      1,
      'a read that finished arms the close while another read is still going',
    );

    armed[0].cancelled = true;
    armed[0].fn();
    assert.equal(
      closed.length,
      0,
      'the close on standby does not take the document away from a read that still works with it',
    );

    answer();
    await inflight;

    const live = waits.filter((wait) => !wait.cancelled);
    assert.equal(live.length, 1, 'the read that finished arms one fresh wait');
    live[0].fn();
    await settle();
    assert.equal(closed.length, 1, 'and the document goes when nothing is left to answer');
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    delete globalThis.chrome;
  }
});

/**
 * Срок закрытия — не украшение: он должен и дожить до своего запуска, и переждать сигнал, который
 * играет в этом же документе.
 */
test('the wait before the close is short enough to happen and long enough to be safe', () => {
  assert.ok(
    IDLE_CLOSE_MS < 30_000,
    'Chrome stands the worker down after 30 s of quiet: a close armed later than that may never run',
  );
  assert.ok(
    IDLE_CLOSE_MS > 10_000,
    'and the wait has to outlast the signal the document is still playing — the bundled files are a few seconds long',
  );
});

/* ------------------------- the age written on a row ------------------------- */

/**
 * «5 мин назад» строки списка, подсказка строки ленты, строка источника открытой статьи и строка
 * диагностики под рядом таблицы лент — всё это нарисовано один раз, когда колонка или таблица
 * собрана. Через минуту каждая из них говорит неправду, если её не перечеркнуть на том же месте:
 * перестроить среднюю колонку ради одной такой строки — значит выбросить место читателя в списке.
 */
test('every age the screens write is redrawn while they sit open', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const page = read('src/index.js');
  const feedsScreen = read('src/feeds.js');

  /* One tick of the reader repaints every aged label it can see, not the line under the head alone. */
  const tick = page.match(/function refreshAgedLabels\(\)[\s\S]*?\n\}/);
  assert.ok(tick, 'nothing redraws the ages the columns drew when they were built');
  for (const [call, what] of [
    ['paintItemMeta(', 'the age of a headline row'],
    ['feedHealthTitle(', 'the tooltip of a feed row'],
    ['paintSource(', 'the source line of the open article'],
    ['renderFeedStatus(', 'the line under the head of the middle column'],
  ]) {
    assert.ok(tick[0].includes(call), `the tick leaves ${what} standing at the age it was drawn with`);
  }

  assert.match(
    page,
    /setInterval\(\(\) => \{\s*if \(!document\.hidden\) refreshAgedLabels\(\);/,
    'the minute tick still repaints the status line alone',
  );
  /* The tick paints the ages through the very functions the columns built them with. Which name each
   * of them gives its arguments is its own business; that both of them reach the same function the
   * same way is what keeps the two drawings from drifting apart. */
  const callsOf = (name, source) =>
    [...source.matchAll(new RegExp(`(?<![\w.])(?<!function )${name}\(([^)]*)\)`, 'g'))]
      .map((match) => match[1].split(',').map((part) => part.trim()).filter(Boolean));

  const metaCalls = callsOf('paintItemMeta', page);
  assert.ok(
    metaCalls.length >= 2,
    'only the tick paints the meta line of a headline, so the middle column draws it another way',
  );
  assert.equal(
    new Set(metaCalls.map((call) => call.length)).size,
    1,
    'the middle column draws its meta line one way and the tick another way',
  );

  /* The tick reaches a row through the mark the row already carries, so nothing is rebuilt to learn
   * what a row stands for. */
  assert.ok(
    /\.querySelectorAll\('\.list-item\[data-uid\]'\)/.test(page),
    'a row of the middle column carries no name the tick could find its headline by',
  );
  assert.ok(
    tick[0].includes("'.list-item[data-uid]'"),
    'the tick does not look for the rows the middle column marked',
  );
  assert.ok(
    /\.dataset\.feedId = /.test(page),
    'a row of the left column carries no name the tick could find its feed by',
  );
  assert.ok(
    /\.dataset\.feedId\b/.test(tick[0]),
    'the tick does not use the name the left column wrote',
  );

  /* The feed table writes the same age under every row, and had no tick at all. */
  assert.match(
    feedsScreen,
    /function feedHealthLine\(feed, now = Date\.now\(\), labels = unitLabels\(\)\)/,
    'the diagnosis line of a row cannot be drawn for a clock other than the one its row was built with',
  );
  assert.match(
    feedsScreen,
    /setInterval\(\(\) => \{\s*if \(!document\.hidden\) refreshHealthLines\(\);/,
    'the feed screen leaves its diagnosis lines standing while the table sits open',
  );
  assert.ok(feedsScreen.includes("'visibilitychange'"), 'a feed screen that was hidden shows the age it sat out');

  const redraw = feedsScreen.match(/function refreshHealthLines\(\)[\s\S]*?\n\}/);
  assert.ok(redraw, 'nothing redraws the diagnosis lines of the feed table');
  assert.ok(
    /feedHealthLine\(\w+\.feed,\s*\w+,\s*\w+\)/.test(redraw[0]),
    'the redraw of a diagnosis line takes its numbers from somewhere other than the row it stands under',
  );

  const load = feedsScreen.match(/async function refreshRow\([\s\S]*?\n\}/);
  assert.ok(load, 'the feeds screen has no load of a single feed');
  assert.ok(
    /\.feed = (?!this)/.test(load[0]),
    'a row keeps the diagnosis of the load it just did, so its next redraw would undo it',
  );
});

/* ---------------------------- carrying feeds between profiles ---------------------------- */

/**
 * The file is the one thing a user of a local reader can move to another profile, so both ends of it
 * are guarded: a write takes only the fields the user set, a read refuses whatever a row of the
 * table would refuse.
 */
test('a written file carries what the user set, not what this profile learned about the feed', () => {
  const file = store.buildFeedsExport([
    {
      id: 'local-id',
      name: 'Example',
      rss_link: 'https://example.com/feed.xml',
      delay_timeout: 30,
      clean_timeout: 1440,
      icon: 'https://example.com/favicon.ico',
      etag: '"abc"',
      lastErrorCode: 'network',
      fetchFailureCount: 3,
    },
    {
      name: 'Sloppy row',
      rss_link: 'https://example.com/other',
      delay_timeout: 0,
      clean_timeout: 'not a number',
    },
  ]);

  assert.equal(file.version, store.FEED_EXPORT_VERSION);
  assert.deepEqual(file.feeds, [
    {
      name: 'Example',
      rss_link: 'https://example.com/feed.xml',
      delay_timeout: 30,
      clean_timeout: 1440,
    },
    {
      /* A period that is a number but too small is clamped to the floor Chrome allows; a value that
       * is no number at all falls back to the default the row of the table would have filled in. */
      name: 'Sloppy row',
      rss_link: 'https://example.com/other',
      delay_timeout: 1,
      clean_timeout: DEFAULT_CLEAN_TIMEOUT,
    },
  ]);
});

test('a file that is not JSON, of another version or with no list is refused whole', () => {
  assert.equal(store.parseFeedsExport('not a file at all').code, 'json');
  assert.equal(store.parseFeedsExport('{"version": 2, "feeds": []}').code, 'version');
  assert.equal(store.parseFeedsExport('{"feeds": []}').code, 'version');
  assert.equal(store.parseFeedsExport('{"version": 1}').code, 'shape');
  assert.equal(store.parseFeedsExport('{"version": 1, "feeds": "Example"}').code, 'shape');
});

test('a row of a file is checked as strictly as a row of the table', () => {
  const { feeds, skipped, code } = store.parseFeedsExport(
    JSON.stringify({
      version: 1,
      feeds: [
        {
          name: ' Good name ',
          rss_link: ' https://example.com/feed.xml ',
          delay_timeout: 45,
          clean_timeout: 60,
        },
        { name: '', rss_link: 'https://example.com/nameless' },
        { name: 'No protocol', rss_link: 'ftp://example.com/feed' },
        { name: 'Zero period', rss_link: 'https://example.com/fast', delay_timeout: 0 },
        { name: 'A repeat of the first', rss_link: 'https://example.com/feed.xml' },
        'not even a row',
      ],
    }),
  );

  assert.equal(code, null);
  assert.equal(skipped, 5);
  /* A row arrives without an `id`: the profile that reads the file gives its own. */
  assert.deepEqual(feeds, [
    {
      name: 'Good name',
      rss_link: 'https://example.com/feed.xml',
      delay_timeout: 45,
      clean_timeout: 60,
    },
  ]);
});

test('import adds the feeds of a file and leaves the configured ones and their headlines alone', async () => {
  const forget = storageMemory();
  try {
    await store.saveFeeds([
      {
        id: 'mine',
        name: 'My name for it',
        rss_link: 'https://example.com/feed.xml',
        delay_timeout: 5,
        clean_timeout: 60,
        icon: 'https://example.com/favicon.ico',
      },
    ]);
    await store.saveItems([
      store.makeItem({ feed: { id: 'mine' }, title: 'Kept', link: 'https://example.com/a' }),
    ]);

    const parsed = store.parseFeedsExport(
      JSON.stringify({
        version: 1,
        feeds: [
          {
            name: 'Their name for it',
            rss_link: 'https://example.com/feed.xml',
            delay_timeout: 30,
            clean_timeout: 1440,
          },
          {
            name: 'New one',
            rss_link: 'https://other.example.com/feed.xml',
            delay_timeout: 15,
            clean_timeout: 90,
          },
        ],
      }),
    );

    const { added, existing } = await store.mergeFeeds(parsed.feeds);
    assert.deepEqual({ added, existing }, { added: 1, existing: 1 });

    const stored = await store.getFeeds();
    assert.equal(stored.length, 2);

    /* A feed that is already here keeps its own name, its own minutes and its icon: the transfer
     * adds feeds, it does not overwrite the ones this profile already cares about. */
    const kept = stored.find((feed) => feed.rss_link === 'https://example.com/feed.xml');
    assert.deepEqual(
      { id: kept.id, name: kept.name, delay_timeout: kept.delay_timeout, icon: kept.icon },
      { id: 'mine', name: 'My name for it', delay_timeout: 5, icon: 'https://example.com/favicon.ico' },
    );

    const arrived = stored.find((feed) => feed.rss_link === 'https://other.example.com/feed.xml');
    assert.equal(arrived.name, 'New one');
    assert.equal(arrived.delay_timeout, 15);
    assert.equal(arrived.clean_timeout, 90);
    assert.ok(arrived.id && arrived.id !== 'mine', 'the new feed gets an id of this profile');

    assert.equal(await store.countItems(), 1, 'import does not throw away stored headlines');
  } finally {
    forget();
  }
});

test('the feeds screen reads and writes the file through the storage the worker reads', () => {
  const feedsJs = fs.readFileSync(new URL('../src/feeds.js', import.meta.url), 'utf8');
  const storageJs = fs.readFileSync(new URL('../src/lib/storage.js', import.meta.url), 'utf8');

  /* The name the screen happens to give the storage module is its own business; what it takes out of
   * it is the contract the worker reads the same table through. */
  const storeAs = feedsJs.match(/import \* as (\w+) from '\.\/lib\/storage\.js'/)?.[1] ?? null;
  assert.ok(storeAs, 'feeds.js does not import the storage module the worker reads');

  for (const name of ['buildFeedsExport', 'parseFeedsExport', 'mergeFeeds', 'FEED_EXPORT_FILE_NAME']) {
    assert.ok(
      new RegExp(`export (async function|const|function) ${name}\\b`).test(storageJs),
      `storage.js does not offer ${name}`,
    );
    assert.ok(
      feedsJs.includes(`${storeAs}.${name}`),
      `feeds.js does not use ${name} from the storage the worker reads`,
    );
  }

  assert.match(storageJs, /export const FEED_EXPORT_VERSION\b/);

  /* A feed is read by nobody until the worker gives it an alarm, so the function that merges the file
   * has to tell the worker the table changed — the same call a saved row makes, whatever it is called. */
  const merged = [...functionsOf(feedsJs)].filter(([, body]) => body.includes(`${storeAs}.mergeFeeds(`));
  assert.equal(merged.length, 1, 'the file of feeds is merged in more than one place');
  const [mergeName, mergeBody] = merged[0] ?? [];
  assert.ok(mergeBody, 'the feeds screen has no import of its own');
  assert.ok(
    mergeBody.includes('notifyBackground()'),
    `${mergeName} merges feeds without telling the worker the table changed`,
  );
});

/* --------------------- the build that fills distributive/ --------------------- */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function shippedFiles() {
  return collectSources().map((file) => path.relative(repoRoot, file).split(path.sep).join('/'));
}

test('the build ships every file the extension is made of and none of the repository', () => {
  const shipped = shippedFiles();
  for (const needed of [
    'manifest.json',
    'LICENSE',
    'src/index.html',
    'src/index.js',
    'src/background.js',
    'src/styles/reader.css',
    'src/media/ceres.mp3',
    'icons/icon16.png',
    '_locales/ru/messages.json',
  ]) {
    assert.ok(shipped.includes(needed), `the build leaves ${needed} out of the folder Chrome loads`);
  }
  for (const file of shipped) {
    assert.ok(
      !file.startsWith('scripts/') && !file.startsWith('examples/') && !file.startsWith('README'),
      `${file} is not part of the extension, yet the build ships it`,
    );
  }
});

test('the build ships every file the manifest names and every signal the storage offers', () => {
  const shipped = shippedFiles();

  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const named = [];
  const walk = (node) => {
    if (typeof node === 'string') {
      if (/\.(js|html|png)$/.test(node)) named.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(manifest);
  assert.ok(named.length > 0, 'the manifest names no file of the extension');
  for (const file of named) {
    assert.ok(shipped.includes(file), `the manifest names ${file}, which the build does not ship`);
  }

  const storage = fs.readFileSync(new URL('../src/lib/storage.js', import.meta.url), 'utf8');
  const sounds = storage.match(/src\/media\/[a-z0-9_]+\.mp3/g) ?? [];
  assert.ok(sounds.length > 0, 'the storage names no signal file');
  for (const file of new Set(sounds)) {
    assert.ok(shipped.includes(file), `the storage offers ${file}, which the build does not ship`);
  }
});

test('the stripped code has nothing left to strip', () => {
  for (const file of collectSources()) {
    const minifier = { '.js': minifyJs, '.mjs': minifyJs, '.css': minifyCss, '.html': minifyHtml }[path.extname(file).toLowerCase()];
    if (!minifier) continue;

    const source = fs.readFileSync(file, 'utf8');
    const once = minifier(source);
    assert.equal(
      minifier(once),
      once,
      `${path.relative(repoRoot, file)} can be stripped a second time, so the first pass broke it`,
    );
  }
});

/* ---------------------------- runner ---------------------------- */

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${error?.message ?? error}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} passed`);
process.exitCode = failures === 0 ? 0 : 1;
