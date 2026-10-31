import { T } from '../strings.js';
import { AGENT_NAMES } from './model.js';

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayName = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const startOfDay = (ms) => { const date = new Date(ms); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** When something happened, as the Activity of an issue writes it: "12m ago", "Yesterday 17:40", "Oct 30 09:05". */
export function when(ms, now = Date.now()) {
  const minutes = Math.floor((now - ms) / 60000);
  if (minutes < 1) return T.activity.justNow;
  if (minutes < 60) return T.activity.minutesAgo(minutes);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
  const time = clock.format(ms);
  if (days === 0) return T.activity.hoursAgo(Math.floor(minutes / 60));
  if (days === 1) return `${T.activity.yesterday} ${time}`;
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return `${(sameYear ? dayName : dayYear).format(ms)} ${time}`;
}

export const actorName = (actor) => (actor === 'owner' ? T.activity.you : actor === 'dudu' ? '嘟嘟' : (AGENT_NAMES[actor] ?? actor));
const agentName = (agent) => AGENT_NAMES[agent] ?? agent;
const dueText = (ms) => dayYear.format(ms);

/**
 * One line of the log as a sentence. The store keeps what happened as data (kind, from/to, a reason), never as display
 * text, so the words are written here. `comment` entries (notes, progress, decisions, results) carry their own text.
 */
export function describe(entry) {
  const { kind, data, text } = entry;
  const A = T.activity;
  switch (kind) {
    case 'source': return { sentence: data?.source === 'owner' ? A.created : (data?.source === 'session' ? A.createdFromSession : A.createdFromMessage), detail: text };
    case 'status': return { sentence: A.status(T.status[data?.from] ?? data?.from, T.status[data?.to] ?? data?.to), detail: text };
    case 'priority': return { sentence: A.priority(T.priority[data?.to] ?? data?.to), detail: text };
    case 'due': return { sentence: data?.to == null ? A.dueRemoved : A.due(dueText(data.to)), detail: text };
    case 'assign': return { sentence: data?.agent ? A.assigned(agentName(data.agent)) : A.unassigned, detail: text };
    case 'blocked': return { sentence: A.asked, detail: text };
    case 'session': return { sentence: text || A.session, detail: '' };
    default: return { sentence: A.commented, comment: text }; // note, progress, decision, result
  }
}
