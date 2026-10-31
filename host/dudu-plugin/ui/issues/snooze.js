// Where "Snooze" can put a question: later today, tomorrow morning, Monday morning. Local time; an option already past is left out.
const HOUR = 3600000;

export function snoozeOptions(now = Date.now()) {
  const at = (days, hour) => { const date = new Date(now); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date.getTime(); };
  const untilMonday = ((8 - new Date(now).getDay()) % 7) || 7;
  const evening = at(0, 18);
  return [
    ...(evening - now > HOUR ? [{ id: 'laterToday', until: evening }] : []),
    { id: 'tomorrow', until: at(1, 9) },
    { id: 'nextWeek', until: at(untilMonday, 9) },
  ];
}
