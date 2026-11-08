// Due dates stay on a local calendar day. Relative day/week input uses calendar arithmetic across DST.
export const atNoon = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime();
const addDays = (now, days) => {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return atNoon(date);
};

export function duePresets(now = Date.now()) {
  const day = new Date(now).getDay();
  return [
    { id: 'tomorrow', at: addDays(now, 1) },
    { id: 'weekEnd', at: addDays(now, (5 - day + 7) % 7) },
    { id: 'oneWeek', at: addDays(now, 7) },
  ];
}

export function dueInputValue(at) {
  if (at == null) return '';
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const checkedDate = (year, month, day) => {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : null;
};
const nextDate = (month, day, now) => {
  const current = new Date(now).getFullYear();
  for (let year = current; year <= current + 8; year++) {
    const date = checkedDate(year, month, day);
    if (date != null && date >= atNoon(new Date(now))) return date;
  }
  return null;
};

/** Deterministic date entry: relative days/weeks/hours, ISO, numeric month/day, and English or Chinese month/day. */
export function parseDueInput(input, now = Date.now()) {
  const value = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value) return null;
  if (/^(today|今天|今日)$/.test(value)) return addDays(now, 0);
  if (/^(tomorrow|明天|明日)$/.test(value)) return addDays(now, 1);
  if (/^(day after tomorrow|后天)$/.test(value)) return addDays(now, 2);
  if (/^(in (?:one|a) week|next week|一周后|下周)$/.test(value)) return addDays(now, 7);
  const relative = /^(?:in\s+)?(\d+)\s*(h(?:ours?)?|d(?:ays?)?|w(?:eeks?)?|小时|天|日|周|星期)(?:\s*(?:后|from now))?$/.exec(value);
  if (relative) {
    const count = Number(relative[1]);
    if (count > 87600) return null;
    const unit = relative[2];
    if (/^(h|小时)/.test(unit)) return atNoon(new Date(now + count * 3600000));
    return addDays(now, count * (/^(w|周|星期)/.test(unit) ? 7 : 1));
  }
  const full = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(value);
  if (full) return checkedDate(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = /^(\d{1,2})[-/月](\d{1,2})日?$/.exec(value);
  if (short) return nextDate(Number(short[1]), Number(short[2]), now);
  const forward = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(value);
  const reverse = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:,?\s+(\d{4}))?$/.exec(value);
  if (forward || reverse) {
    const name = forward?.[1] ?? reverse[2];
    const month = MONTHS.findIndex((month) => name === month || name === month.slice(0, 3) || (month === 'september' && name === 'sept')) + 1;
    const day = Number(forward?.[2] ?? reverse[1]);
    const year = forward?.[3] ?? reverse?.[3];
    if (!month) return null;
    return year ? checkedDate(Number(year), month, day) : nextDate(month, day, now);
  }
  return null;
}
