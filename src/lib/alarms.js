// Per-feed polling alarms plus a periodic cleanup sweep.
// Alarms survive service-worker restarts, which is what MV3 needs for "delay_timeout".

import { getFeeds, recordFeedAlarmTimes } from './storage.js';
import {
  ALARM_PREFIX,
  CLEANUP_ALARM_NAME,
  CLEANUP_PERIOD_MINUTES,
  alarmPeriodMinutes,
} from './util.js';

export function feedAlarmName(feedId) {
  return `${ALARM_PREFIX}${feedId}`;
}

export function feedIdFromAlarm(alarmName) {
  if (!alarmName?.startsWith(ALARM_PREFIX)) return null;
  return alarmName.slice(ALARM_PREFIX.length);
}

/**
 * Когда будильник ленты сработает в следующий раз.
 *
 * Chrome называет этот момент сам — `scheduledTime` (и `nextFireAt` там, где его ещё отдают),
 * но срок, который уже прошёл, описывает срабатывание, отработавшее или задержанное сном
 * устройства: для ленты он ничего не обещает, кроме следующего периода после него. Когда Chrome
 * срока не назвал вовсе, остаётся то, ради чего будильник заводился: один период от сейчас.
 * @param {{ periodInMinutes?: number, scheduledTime?: number, nextFireAt?: string }} alarm
 * @param {number} soon - момент, от которого считается срок, когда названного нет
 * @param {number} periodMinutes - период, с которым этот будильник заведён
 */
export function alarmDueAt(alarm, soon, periodMinutes) {
  const period = Number(alarm?.periodInMinutes) || periodMinutes;
  const stated = [alarm?.nextFireAt, alarm?.scheduledTime]
    .map((value) => (typeof value === 'string' ? Date.parse(value) : Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0);

  const pending = stated.filter((value) => value > soon).sort((a, b) => a - b)[0];
  if (pending) return pending;
  if (stated.length > 0) return Math.max(...stated) + period * 60000;
  return soon + period * 60000;
}

/**
 * Make the set of scheduled alarms match the set of configured feeds.
 * Existing alarms with the right period are left alone so their timers keep running.
 * Along the way the moment Chrome really means to wake each feed is written into its row
 * (`storage.recordFeedAlarmTimes`): that is what the reader names as the next automatic check,
 * instead of guessing it from when this feed was last read.
 */
export async function syncAlarms() {
  const feeds = await getFeeds();

  const desired = new Map();
  for (const feed of feeds) {
    desired.set(feedAlarmName(feed.id), { periodInMinutes: alarmPeriodMinutes(feed.delay_timeout) });
  }
  desired.set(CLEANUP_ALARM_NAME, { periodInMinutes: CLEANUP_PERIOD_MINUTES });

  const soon = Date.now();
  /* `dueAt` only ever carries an answer a real alarm gave: an alarm Chrome already had answers for
   * itself below, and an alarm this sync creates answers for itself after it exists (see the read
   * back at the end). A moment counted from `soon` would be an approximation of the alarm's own —
   * and the next sync would rewrite it. */
  const dueAt = new Map();
  const created = [];

  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    const isOurs = alarm.name === CLEANUP_ALARM_NAME || alarm.name.startsWith(ALARM_PREFIX);
    if (!isOurs) continue;

    const wanted = desired.get(alarm.name);
    if (!wanted || wanted.periodInMinutes !== alarm.periodInMinutes) {
      await chrome.alarms.clear(alarm.name);
    } else {
      desired.delete(alarm.name);
      if (alarm.name !== CLEANUP_ALARM_NAME) {
        dueAt.set(alarm.name, alarmDueAt(alarm, soon, wanted.periodInMinutes));
      }
    }
  }

  for (const [name, properties] of desired) {
    await chrome.alarms.create(name, properties);
    if (name !== CLEANUP_ALARM_NAME) created.push(name);
  }

  /* A new alarm is scheduled from the moment of its creation, which this function cannot name from
   * `soon`: only the alarm itself, read back once it exists, names the millisecond Chrome will wake
   * it at. Before Chrome 111 `create()` answers no promise, so an alarm that has not shown up yet
   * gets the one period this function did have to guess. */
  if (created.length > 0) {
    const now = Date.now();
    const named = new Set();
    for (const alarm of await chrome.alarms.getAll()) {
      if (!created.includes(alarm.name)) continue;
      dueAt.set(alarm.name, alarmDueAt(alarm, now, alarm.periodInMinutes));
      named.add(alarm.name);
    }
    for (const name of created) {
      if (named.has(name)) continue;
      dueAt.set(name, now + desired.get(name).periodInMinutes * 60000);
    }
  }

  const times = new Map();
  for (const feed of feeds) {
    const at = dueAt.get(feedAlarmName(feed.id));
    if (at) times.set(feed.id, at);
  }
  await recordFeedAlarmTimes(times);
}
