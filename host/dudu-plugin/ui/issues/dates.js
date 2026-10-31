// The Dates part of the filter: three fields (Due date, Created, Updated), each with a few ready-made ranges, one ticked at a time.
// The view keeps the choice by name ({ due: ['overdue'] }); the request to the store carries the range it means.
const DAY = 86400000;
const HOUR = 3600000;

export const DATE_FIELDS = {
  due: ['overdue', 'today', 'next7', 'next30'],
  created: ['day', 'week', 'month'],
  updated: ['day', 'week', 'month'],
};
const SPAN = { day: DAY, week: 7 * DAY, month: 30 * DAY };
const startOfDay = (time) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };

/**
 * The store's range for a ticked option. A due date is a day (noon local time), so its ranges follow the local calendar; "past
 * week" and the like count back from the hour, so the request, and with it the list, does not change on every render.
 */
export function dateRange(field, option, now = Date.now()) {
  if (field === 'due') {
    const today = startOfDay(now);
    if (option === 'overdue') return { dueTo: today - 1 };
    if (option === 'today') return { dueFrom: today, dueTo: today + DAY - 1 };
    if (option === 'next7') return { dueFrom: today, dueTo: today + 7 * DAY - 1 };
    if (option === 'next30') return { dueFrom: today, dueTo: today + 30 * DAY - 1 };
    return {};
  }
  const from = Math.floor(now / HOUR) * HOUR - (SPAN[option] ?? 0);
  return field === 'created' ? { createdFrom: from } : { updatedFrom: from };
}

/** Splits a view's filter into what the store reads as it is, and the date choices turned into ranges. */
export function storeFilter(filter, now = Date.now()) {
  const out = {};
  for (const [key, values] of Object.entries(filter)) {
    if (DATE_FIELDS[key]) Object.assign(out, dateRange(key, values?.[0], now));
    else out[key] = values;
  }
  return out;
}
