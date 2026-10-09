// Per-feed polling alarms plus a periodic cleanup sweep.
// Alarms survive service-worker restarts, which is what MV3 needs for "delay_timeout".

import { getFeeds } from './storage.js';
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
 * Make the set of scheduled alarms match the set of configured feeds.
 * Existing alarms with the right period are left alone so their timers keep running.
 */
export async function syncAlarms() {
  const feeds = await getFeeds();

  const desired = new Map();
  for (const feed of feeds) {
    desired.set(feedAlarmName(feed.id), { periodInMinutes: alarmPeriodMinutes(feed.delay_timeout) });
  }
  desired.set(CLEANUP_ALARM_NAME, { periodInMinutes: CLEANUP_PERIOD_MINUTES });

  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    const isOurs = alarm.name === CLEANUP_ALARM_NAME || alarm.name.startsWith(ALARM_PREFIX);
    if (!isOurs) continue;

    const wanted = desired.get(alarm.name);
    if (!wanted || wanted.periodInMinutes !== alarm.periodInMinutes) {
      await chrome.alarms.clear(alarm.name);
    } else {
      desired.delete(alarm.name);
    }
  }

  for (const [name, properties] of desired) {
    chrome.alarms.create(name, properties);
  }
}
