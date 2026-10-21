// Unit tests for the pure helpers shared by the service worker and the extension pages.
//
//   node scripts/test.mjs
//
// Only the chrome-free logic is covered (src/lib/util.js, src/lib/storage.js, src/lib/i18n.js, the
// decoding rules of src/lib/encoding.js, the JSON Feed parsing of src/lib/rss.js), plus the guards
// that read the pages themselves. The chrome.*-dependent code and the XML parsing are exercised in
// the browser.

import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as alarmsLib from '../src/lib/alarms.js';
import * as encoding from '../src/lib/encoding.js';
import * as favicon from '../src/lib/favicon.js';
import * as i18n from '../src/lib/i18n.js';
import { SCREENS } from '../src/lib/nav.js';
import * as rss from '../src/lib/rss.js';
import * as store from '../src/lib/storage.js';
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
     * of every feed before it. */
    const candidates = [];
    for (let f = 0; f < feeds; f += 1) {
      const feed = { id: `f${f}`, name: `Feed ${f}`, rss_link: `https://a.b/${f}/rss` };
      for (let i = 0; i < MAX_ITEMS_PER_FEED; i += 1) {
        candidates.push(store.makeItem({
          feed,
          title: `news ${f}-${i}`,
          link: `https://a.b/${f}/news/${i}`,
          pubDate: new Date(Date.now() - (f * MAX_ITEMS_PER_FEED + i) * DAY).toUTCString(),
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

  assert.ok(html.includes('id="btn-load"'), 'the middle column head has no button that reads feeds');
  assert.ok(
    page.includes("document.getElementById('btn-load')"),
    'the page does not know the button the markup declares',
  );
  assert.ok(
    page.includes('els.load.addEventListener'),
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

  const sentinel = page.match(/const ALL_FEEDS_ID = '([^']+)';/);
  assert.ok(sentinel, 'the reader names no selection that stands for every feed');
  const allId = sentinel[1];
  /* A stored feed id is a UUID, or `id-<base36>-<base36>` when the generator is missing
   * (`lib/util.js` -> `newId`): a sentinel built that way could be mistaken for a real feed. */
  assert.ok(
    !/^[0-9a-z-]+$/i.test(allId),
    `the sentinel ${allId} is a name a generated feed id could also carry`,
  );

  const row = page.slice(page.indexOf('function renderAllFeedsRow'), page.indexOf('function renderFeeds'));
  assert.ok(row.length > 0, 'the left column builds no row above its feeds');
  assert.ok(row.includes("t('reader.feeds.all')"), 'that row is drawn without a caption');
  assert.ok(row.includes('selectFeed(ALL_FEEDS_ID)'), 'a click on that row selects nothing');

  const list = page.slice(page.indexOf('function renderFeeds'), page.indexOf('function renderHeadlines'));
  assert.ok(
    list.includes('renderAllFeedsRow()') &&
      list.indexOf('renderAllFeedsRow()') < list.indexOf('for (const feed of state.feeds)'),
    'the row is drawn among the feeds instead of over them',
  );

  /* The middle column follows the selection: the all-selection is the stored list itself, which
   * `renderAll()` has already put newest first. */
  const picked = page.slice(page.indexOf('function inSelection'), page.indexOf('function renderTotal'));
  assert.ok(picked.includes('isAllFeeds()'), 'the all-selection picks no headlines of every feed');
  assert.ok(picked.includes('state.items.filter(inSelection)'), 'the all-selection is not the sorted storage');

  const init = page.slice(page.indexOf('async function init'));
  assert.ok(init.includes('selectFeed(ALL_FEEDS_ID)'), 'the reader does not open on the all-feeds row');
  assert.ok(!init.includes('selectFeed(state.feeds[0].id)'), 'the reader still opens on its first feed');

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
  assert.ok(page.includes('els.headlineSearch.value = state.query'), 'the field is left empty of what it filtered by');

  assert.ok(dictionary.includes("querySelectorAll('[data-i18n-placeholder]')"), 'a placeholder no dictionary re-applies stays in one language');
  assert.ok(css.includes('.panel-search'), 'the search field the markup declares is not styled');

  assert.ok(page.includes("document.addEventListener('keydown'"), 'the reader answers to no keys');
  for (const key of ["'ArrowDown'", "'ArrowUp'", "'/'", "'Enter'", "'Escape'"]) {
    assert.ok(page.includes(`case ${key}:`) || page.includes(`${key} &&`), `no key handler for ${key}`);
  }
  assert.ok(page.includes('isTypingTarget'), 'the keys are taken from the field being typed in');

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
  assert.ok(page.includes('els.keysButton.addEventListener'), 'the button of the key list answers to no click');

  /* A window that holds the keyboard: `showModal`, the neighbours hidden while it stands, and the
   * same `?` that opened it closing it again. */
  assert.ok(page.includes('els.keysHelp.showModal()'), 'the key list is no modal, so Esc and the tab order are its own problem');
  assert.ok(page.includes("addEventListener('close'"), 'nothing puts back what opening the list took from the rest of the screen');
  assert.ok(page.includes("els.header.setAttribute('aria-hidden', 'true')"), 'a tab can walk out of the list into the screen behind it');
  assert.ok(page.includes("els.header.removeAttribute('aria-hidden')"), 'the screen behind the list stays voiceless once the list is gone');
  assert.ok(page.includes('els.keysHelp.addEventListener'), 'a click beside the list closes nothing');
  assert.ok(page.includes("case '?':"), 'no key opens the list the reader carries');
  assert.ok(page.includes('if (els.keysHelp.open)'), 'the keys of the reader keep working through the list that explains them');

  /* Every key the page really answers to stands in the table, and the table adds none it does not answer to. */
  const handled = new Set([
    ...page.matchAll(/^ {4}case '([^']+)':$/gm),
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
    'reader.keys.delete',
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
  assert.ok(page.includes('function renderStartCard()'), 'nothing decides when the card stands in for the list');
  assert.ok(page.includes('const noFeeds = renderStartCard();'), 'the middle column is drawn without asking whether feeds exist');
  assert.ok(
    page.includes('els.headlinesEmpty.hidden = items.length > 0 || noFeeds;'),
    'the empty-list line keeps speaking over the card of a first run',
  );

  /* A search field and two icons that act on an empty selection would only look usable. */
  for (const control of ['headlineSearch', 'load', 'clear']) {
    assert.ok(
      page.includes(`els.${control}.hidden = noFeeds;`),
      `the ${control} control of an empty reader is left standing as if it had something to do`,
    );
  }
  assert.ok(
    page.includes('if (els.headlineSearch.hidden) break;'),
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
  assert.ok(
    page.includes('els.openFeeds.addEventListener'),
    'the card the markup declares has no answer to its own button',
  );
  assert.ok(
    page.includes('window.location.assign(pageUrl(SETTINGS_PAGE))'),
    'the card of a first run leads nowhere',
  );

  /* The right panel says the same as the middle one instead of asking for a headline no feed has. */
  assert.equal(
    page.split("showPlaceholder(t('reader.start.contentHint'))").length - 1,
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
  assert.ok(
    feedsJs.includes('(await store.getFeeds()).length === 0 && !(await store.getFirstFeedDone())'),
    'the first row of an empty table is not told apart from the rows after it',
  );
  assert.ok(
    feedsJs.includes("setTransferStatus(t('feeds.status.firstFeed'), 'ok')"),
    'a first feed leaves no word about the table it just entered',
  );
  assert.ok(
    feedsJs.includes('if (firstFeed && loaded?.ok && !loaded.busy)'),
    'the confirmation promises headlines a feed that failed never brought',
  );
  assert.ok(
    feedsJs.indexOf('await store.setFirstFeedDone();') < feedsJs.indexOf("setTransferStatus(t('feeds.status.firstFeed')"),
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
 * from a line no eye sees, the two lists name themselves and the row among them that is chosen, the row
 * a keyboard opens takes the focus and is drawn with a cursor, and the spinning glyph is a decoration a
 * reader who asks for no motion never gets. Markup, script, stylesheet and the seven dictionaries are
 * kept in step here.
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
  assert.ok(page.includes('function announce('), 'nobody writes to the line the markup declares');
  assert.ok(page.includes('function refreshOutcome('), 'noone gathers what a load ended with');
  assert.equal(
    page.split('announce(refreshOutcome(response));').length - 1,
    3,
    'a load is announced by only some of the buttons that can start one',
  );
  assert.ok(
    page.includes("announce(t('reader.announce.deleted')"),
    'a deleted headline is said to nobody who cannot see the panels',
  );
  assert.ok(
    page.includes("announce(t('reader.announce.cleared'"),
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
  assert.ok(
    html.includes('id="headline-list" role="listbox"'),
    'the middle column declares a list of rows instead of a list of choices',
  );
  assert.ok(page.includes("li.setAttribute('role', 'option')"), 'a headline row is no option of that listbox');
  assert.ok(
    page.includes("li.setAttribute('aria-selected'"),
    'the open headline is not named among the options it belongs to',
  );
  assert.equal(
    page.split("setAttribute('aria-current', 'true')").length - 1,
    2,
    'the chosen feed row is named for a feed but not for the all-feeds row',
  );

  /* A cursor the keyboard moves is a cursor an eye can find. */
  assert.ok(
    page.includes('{ followFocus = false }'),
    'opening a headline with the keyboard is no different from opening it with a mouse',
  );
  assert.ok(
    page.includes('openItem(visible[next], { followFocus: true })'),
    'the arrows leave the focus where it already stood',
  );
  assert.ok(
    page.includes("els.headlineList.querySelector('.list-item.selected > button')?.focus()"),
    'the row the keyboard opens never takes the focus',
  );
  assert.ok(
    css.includes('.list-item > button:focus-visible'),
    'a row reached with the keyboard is drawn exactly like a row reached with the mouse',
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
    assert.ok(page.includes('function announce('), `nothing writes to the live line of the ${screen} screen`);
  }

  /* Both screens speak from the place that already writes the words an eye sees. */
  const feedsStatus = feedsJs.slice(
    feedsJs.indexOf('function setStatus('),
    feedsJs.indexOf('function showFieldErrors('),
  );
  assert.ok(feedsStatus.includes('announce(message);'), 'a feed row answers to an eye only');

  const transfer = feedsJs.slice(
    feedsJs.indexOf('function setTransferStatus('),
    feedsJs.indexOf('async function exportFeeds('),
  );
  assert.ok(transfer.includes('announce(message);'), 'a transfer of the whole table is said to nobody who cannot see it');

  const settingsStatus = settingsJs.slice(
    settingsJs.indexOf('function setStatus('),
    settingsJs.indexOf('function describeTtl('),
  );
  assert.ok(
    settingsStatus.includes("if (kind === 'ok' || kind === 'error') announce(message);"),
    'the settings screen says nothing out loud about what «Записать» wrote',
  );
  assert.ok(
    settingsJs.includes("setStatus(t('settings.status.pending'), 'pending')"),
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

      for (const used of source.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))) {
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

/**
 * The worker writes that schedule from the alarm it is answering, not from a formula it guesses:
 * the next check of a feed is the next period of the alarm that just ran, so the reader can name it
 * the moment the headlines come in.
 */
test('an automatic read records the next alarm of its own alarm', () => {
  const worker = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
  const alarm = worker.match(/chrome\.alarms\.onAlarm\.addListener\([\s\S]*?\n\}\);/);
  assert.ok(alarm, 'the worker answers its alarms');
  assert.match(
    alarm[0],
    /nextAlarmAt: alarmDueAt\(alarm, Date\.now\(\), alarmPeriodMinutes\(feed\.delay_timeout\)\)/,
    'the read does not say when it will happen next',
  );

  const ingest = worker.match(/async function ingestFeed\([\s\S]*?\n  return result;\r?\n\}/);
  assert.match(ingest[0], /readFeedOnce\(feed, \{ nextAlarmAt \}\)/, 'the schedule stops on the way to the diagnosis');

  const read = worker.match(/async function readFeedOnce\([\s\S]*?\n  return result;\r?\n\}/);
  for (const health of read[0].matchAll(/reportFeedHealth\(feed\.id, \{[^}]*\}\)/g)) {
    assert.match(health[0], /nextAlarmAt/, `the diagnosis written here names no next check: ${health[0]}`);
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

test('the id a feed states makes the whole trip: parse — record — next poll', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const rssJs = read('src/lib/rss.js');
  const worker = read('src/background.js');

  const entryLoop = rssJs.match(/for \(const node of [\s\S]*?return \{ feedTitle, entries \}/);
  assert.ok(entryLoop, 'the loop that turns a feed node into an entry');
  const loop = entryLoop[0];

  assert.ok(
    /newestFirst\(nodes, entryDate\)\.slice\(0, MAX_ENTRIES\)/.test(loop),
    'the cut is made after the nodes are ordered by their date, so a feed that lists its news oldest '
      + 'first loses its oldest news and not the fresh ones `storage.capPerFeed` would have kept',
  );
  assert.ok(
    /pubDate: entryDate\(node\)/.test(loop),
    'the date the loop ordered the nodes by is the date the entry carries on to the record',
  );
  assert.ok(/entryIdentity\(node\)/.test(loop), 'the guid and the Atom <id> are read off the node');
  assert.ok(
    /identity\.guidIsLink \? identity\.guid : ''/.test(loop),
    'only a guid that says it is an address may stand in for a missing link',
  );
  assert.ok(
    /sourceIdentity\(\{ \.\.\.identity/.test(loop),
    'the pure rule decides what those fields mean',
  );
  assert.ok(
    /const key = `\$\{sourceIdType\}:\$\{sourceId\}`;\s*\n\s*if \(seen\.has\(key\)\)/.test(loop),
    'two nodes the feed calls the same news are one entry',
  );
  assert.ok(
    /sourceId,\s*\n\s*sourceIdType,/.test(loop),
    'the entry carries the identity to the record that stores it',
  );

  assert.ok(
    /sourceId: entry\.sourceId,\s*\n\s*sourceIdType: entry\.sourceIdType,/.test(worker),
    'the worker hands the identity to `store.makeItem`, where `uid` is built on it',
  );

  const storageJs = read('src/lib/storage.js');
  assert.ok(
    /const shelf = identityIndex\(items, SHELF_KEYS\)/.test(storageJs),
    'a stored headline is recognised by its identity, not only by the uid of the address it had',
  );
  assert.ok(
    /const match = indexOf\(candidate, shelf, SHELF_KEYS\)/.test(storageJs),
    'and by the address it had when the storage has nothing but that address to say: a feed that '
      + 'started stating a `<guid>` describes the headlines it already shipped',
  );
  assert.ok(
    /readIdentity\(record\)/.test(storageJs),
    'a read marker is matched the same way a candidate is',
  );
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
 * A validator is worth nothing if it never reaches the request that is made in another part of the
 * extension. This guard follows the keys over that route: the worker hands them to the offscreen
 * document, the document hands them to `fetchFeed`, and what comes back is written to storage.
 */
test('the validators make the whole trip: storage — worker — offscreen document — request', () => {
  const worker = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
  const offscreen = fs.readFileSync(new URL('../src/offscreen.js', import.meta.url), 'utf8');

  const readCall = worker.match(/async function readFeed\(feed, validators = \{\}\)[\s\S]*?\n}/);
  assert.ok(readCall, 'the worker reads a feed through the offscreen document');
  assert.match(readCall[0], /url: feed\.rss_link/);
  assert.match(readCall[0], /etag: validators\.etag/, 'the stored key is handed to the document');
  assert.match(readCall[0], /lastModified: validators\.lastModified/);

  const fetchMessage = offscreen.match(/message\?\.type === MSG_FETCH_FEED[\s\S]*?\n  \}/);
  assert.ok(fetchMessage, 'the document answers the read request');
  assert.match(
    fetchMessage[0],
    /fetchFeed\(message\.url,\s*\{[^}]*etag: message\.etag[^}]*lastModified: message\.lastModified/s,
    'the document does not drop the keys on its way to the request',
  );

  const ingest = worker.match(/async function readFeedOnce\([\s\S]*?\n  \} catch \(error\)/);
  assert.ok(ingest, 'the worker writes one feed read to storage');
  assert.match(
    ingest[0],
    /store\.rememberFeedValidators\(feed\.id,\s*\{[^}]*etag: fetched\.etag[^}]*lastModified: fetched\.lastModified/s,
    'what the answer gave back is written back to storage',
  );

  /* A 304 only makes sense while the reader still holds what the keys describe: with the feed's
   * headlines purged by `clean_timeout`, asking politely would leave the reader empty. */
  assert.match(
    ingest[0],
    /held\.some\(\(item\) => item\.feedId === feed\.id\)\s*\?\s*\{ etag: feed\.etag, lastModified: feed\.lastModified \}\s*:\s*\{\}/,
    'a feed whose headlines are gone is asked for plainly, not with keys that answer 304',
  );

  const unchanged = ingest[0].match(/if \(fetched\.notModified\) \{[\s\S]*?\n\s+\} else \{/);
  assert.ok(unchanged, 'a 304 has its own branch apart from a feed that came through');
  assert.ok(!/addItems|makeItem/.test(unchanged[0]), 'a 304 writes no headlines');

  const feedsScreen = fs.readFileSync(new URL('../src/feeds.js', import.meta.url), 'utf8');
  assert.match(
    feedsScreen,
    /response\.notModified/,
    'the feed screen says «unchanged» rather than «0 headlines read»',
  );

  const shelf = ingest[0].match(
    /try \{\r?\n      await store\.rememberFeedValidators\([\s\S]*?\n    \} catch \(shelfError\) \{([\s\S]*?)\r?\n    \}/,
  );
  assert.ok(shelf, 'the headlines the feed just sent are written in a scope of their own');
  assert.match(
    shelf[1],
    /reportFeedHealth\(feed\.id, \{ ok: true[^}]*nextAlarmAt[^}]*\}\)/,
    'a shelf that failed is recorded as the feed having answered',
  );
  assert.match(shelf[1], /throw storageFailure\(feed, shelfError\)/, "the fault is named as the reader's own");
  assert.ok(
    !/reportFeedHealth\(feed\.id, \{ ok: false/.test(shelf[1]),
    'a healthy feed is not diagnosed because the reader could not write',
  );
});

/**
 * Two failures can end a read, and only one of them belongs to the feed: a dead address, a 500, a
 * body that is not a feed diagnoses the feed and pauses it; a helper page the reader could not open
 * diagnoses nothing, because the feed never had the chance to refuse. The worker cannot be imported
 * here, so the guard reads the shape of the catch, which is where the two are told apart.
 */
test('a read that the reader itself could not finish leaves the feed healthy', () => {
  const worker = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

  const read = worker.match(/async function readFeedOnce\([\s\S]*?\n  return result;\r?\n\}/);
  assert.ok(read, 'the worker reads one feed at a time');

  const diagnosis = read[0].match(/\r?\n  \} catch \(error\) \{([\s\S]*?)\r?\n  \}/);
  assert.ok(diagnosis, 'one catch closes the read of a feed');

  assert.match(
    diagnosis[1],
    /if \(!\(error instanceof FeedError\)\) \{[\s\S]*?reportFeedHealth\(feed\.id, \{ ok: true[^}]*nextAlarmAt[^}]*\}\);[\s\S]*?throw error;/,
    'a failure of the reader is not written as a refusal of the feed',
  );
  const ownFault = diagnosis[1].match(/if \(!\(error instanceof FeedError\)\) \{([\s\S]*?)\r?\n    \}/);
  assert.ok(ownFault, 'the catch tells a failure of the reader from a refusal of the feed');
  assert.ok(
    !/forgetValidators/.test(ownFault[1]),
    'the keys the feed gave are not thrown away over a failure of the reader',
  );
  assert.match(
    diagnosis[1],
    /forgetValidators\(feed, error\);[\s\S]*?reportFeedHealth\(feed\.id, \{ ok: false, error, time: startedAt, nextAlarmAt \}\)/,
    'a feed that refused keeps its diagnosis, its streak and its pause',
  );

  assert.match(
    worker,
    /code: 'storageUnavailable'/,
    'the fault of the shelf carries a key every language can translate',
  );
});

/* --------------------- fetch timeouts & feed pause --------------------- */

test('every request the reader waits for is waited for only so long', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  for (const file of ['src/lib/rss.js', 'src/lib/extract.js', 'src/lib/favicon.js']) {
    const source = read(file);
    const count = (re) => [...source.matchAll(re)].length;
    const requests = count(/await fetch\(/g);

    assert.ok(requests > 0, `${file} makes no request, so nothing here was checked`);
    assert.equal(
      count(/new AbortController\(/g),
      requests,
      `${file} starts a request nobody can interrupt`,
    );
    assert.equal(
      count(/signal: controller\.signal/g),
      requests,
      `${file} sends a request its controller does not cover`,
    );
    assert.equal(
      count(/clearTimeout\(timer\)/g),
      requests,
      `${file} starts a timer it never cancels — one per request, not one per response`,
    );
  }

  assert.ok(
    FEED_FETCH_TIMEOUT_MS >= 10_000 && FEED_FETCH_TIMEOUT_MS <= 20_000,
    'a feed read is waited for between 10 and 20 seconds',
  );
  assert.ok(
    ARTICLE_FETCH_TIMEOUT_MS >= 10_000 && ARTICLE_FETCH_TIMEOUT_MS <= 15_000,
    'a page — an icon, an article — is waited for between 10 and 15 seconds',
  );
});

test('an automatic read waits out the pause of a failing feed, a read by hand does not', () => {
  const worker = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

  const alarm = worker.match(/chrome\.alarms\.onAlarm\.addListener\([\s\S]*?\n\}\);/);
  assert.ok(alarm, 'the worker answers no alarm');
  assert.match(
    alarm[0],
    /const paused = feedPauseRemaining\(feed\)/,
    'an automatic read does not ask how much of the pause is left',
  );
  assert.ok(
    alarm[0].indexOf('feedPauseRemaining(feed)') < alarm[0].indexOf('ingestFeed(feed'),
    'the pause is asked about before the feed is read, not after',
  );

  /* A read by hand is an explicit order: a feed in its pause is read all the same. */
  for (const name of ['MSG_REFRESH_FEED', 'MSG_REFRESH_ALL_FEEDS']) {
    const handler = worker.match(new RegExp(`message\\?\\.type === ${name}[\\s\\S]*?\\n  \\}`));
    assert.ok(handler, `the worker answers ${name}`);
    assert.ok(
      !/feedPauseRemaining|nextRetryAt/.test(handler[0]),
      `${name} refuses a read the user asked for by hand`,
    );
  }
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
 * The lock only works if the worker actually uses it: an alarm and a read by hand are two
 * independent paths to the same address, and the fast guard against them lives in the worker itself.
 */
test('one feed is read once, whoever asked for the read', () => {
  const worker = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

  const ingest = worker.match(/async function ingestFeed\([\s\S]*?\r?\n  return result;\r?\n\}/);
  assert.ok(ingest, 'the worker reads one feed and writes its headlines');
  assert.match(
    ingest[0],
    /const held = await holdFeedRead\(feed\.id\)/,
    'the read asks for the feed before it asks the address',
  );
  assert.match(ingest[0], /await held\.read/, 'a second request joins the read in progress instead of fetching again');
  const join = ingest[0].match(/if \(held\?\.read\)[\s\S]*?\r?\n  \}/);
  assert.ok(join, 'a request can join a read of its own worker');
  assert.match(join[0], /return result;/, 'the joined request answers with the real numbers of that read');
  assert.ok(!join[0].includes('busy'), 'a joined read is not a placeholder answer');
  assert.match(ingest[0], /return lockedFeedResult\(\)/, 'a read from another context is skipped, not fetched again');
  assert.match(
    ingest[0],
    /}\s*finally\s*\{\s*await releaseFeedRead\(feed\.id\);\s*\}/,
    'the feed is given back even when its read failed',
  );

  const hold = worker.match(/async function holdFeedRead\([\s\S]*?\r?\n  return null;\r?\n\}/);
  assert.ok(hold, 'the worker has a guard against reading one feed twice');
  assert.ok(
    hold[0].indexOf('readingFeedIds.get(feedId)') < hold[0].indexOf('store.tryLockFeed(feedId)'),
    'the local guard answers before the storage is asked — two requests cannot race over the ticket',
  );
  assert.match(hold[0], /store\.tryLockFeed\(feedId\)/, 'the hold survives a worker that falls asleep');
  const localHit = hold[0].slice(hold[0].indexOf('const running'), hold[0].indexOf('await store.tryLockFeed'));
  assert.ok(
    !/await/.test(localHit),
    'a feed this worker is already reading is refused without waiting for the storage',
  );

  const alarm = worker.match(/chrome\.alarms\.onAlarm\.addListener\([\s\S]*?\n\}\);/);
  assert.ok(alarm, 'the worker answers no alarm');
  assert.match(alarm[0], /if \(result\.busy\) return;/, 'the alarm of a feed being read already stands down');

  for (const name of ['MSG_REFRESH_FEED', 'MSG_REFRESH_ALL_FEEDS']) {
    const handler = worker.match(new RegExp(`message\\?\\.type === ${name}[\\s\\S]*?\n  \}`));
    assert.ok(handler, `the worker answers ${name}`);
    assert.match(handler[0], /ingestFeed\(feed/, `${name} reads the feed through the same guard`);
  }
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

  for (const name of ['buildFeedsExport', 'parseFeedsExport', 'mergeFeeds', 'FEED_EXPORT_FILE_NAME']) {
    assert.ok(
      new RegExp(`export (async function|const|function) ${name}\\b`).test(storageJs),
      `storage.js does not offer ${name}`,
    );
    assert.ok(feedsJs.includes(`store.${name}`), `feeds.js does not use store.${name}`);
  }

  assert.match(storageJs, /export const FEED_EXPORT_VERSION\b/);

  /* A feed is read by nobody until the worker gives it an alarm, so an import has to tell the worker
   * the table changed — the same call a saved row makes. */
  const start = feedsJs.indexOf('async function importFeeds');
  const importBody = feedsJs.slice(start, feedsJs.indexOf('els.export.addEventListener', start));
  assert.ok(importBody.length > 0, 'the feeds screen has no import of its own');
  assert.match(importBody, /notifyBackground\(\)/);
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
