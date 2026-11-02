import { T } from '../strings.js';
import { AGENT_NAMES } from './model.js';
import { intlLocale } from '../lib/locale.mjs';

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayName = { format: (ms) => new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric' }).format(ms) };
const dayYear = { format: (ms) => new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric', year: 'numeric' }).format(ms) };
const startOfDay = (ms) => { const date = new Date(ms); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** When something happened, as the Activity of an issue writes it: "12m ago", "Yesterday 17:40", "Oct 30 09:05". */
export function when(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return T.activity.unknownTime;
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

export const actorName = (actor) => (actor === 'owner' ? T.activity.you : actor === 'dudu' ? T.brand : (AGENT_NAMES[actor] ?? actor));
export const isDiscussion = (entry) => ['note', 'progress', 'decision', 'result', 'blocked'].includes(entry.kind) && Boolean(entry.text?.trim());
const agentName = (agent) => AGENT_NAMES[agent] ?? agent;
const dueText = (ms) => dayYear.format(ms);

/** Translate only the fixed templates written by dudu; conversation content stays verbatim. */
export function storedSystemText(entry) {
  const text = entry?.text ?? '';
  if (entry?.actor !== 'dudu') return text;
  const A = T.activity;
  if (entry.kind === 'blocked') {
    if (text === '交给谁处理？') return A.whoShouldTake;
    const failed = /^出错了：([^]*?)。怎么办？$/.exec(text);
    if (failed) return A.failed(failed[1] === '没有说明原因' ? A.noReason : failed[1]);
    const start = /^没能开始：([^]*?)。要换个智能体，还是稍后再试？$/.exec(text);
    if (start) return A.notStarted(start[1]);
    if (text.startsWith('回复没能发给会话：')) return A.notDelivered(text.slice('回复没能发给会话：'.length));
  }
  if (entry.kind === 'note' && text.startsWith('No agent chosen: ')) return A.notAssigned(text.slice('No agent chosen: '.length));
  if (entry.kind === 'assign') {
    return text.replace('the session it named was not offered, so a new one starts', A.sessionDropped)
      .replace(/access: ([\w-]+)(?: \(asked for ([\w-]+); ASSIGN\.md allows ([\w-]+)\))?/g,
        (_, access, requested, allowed) => `${A.access}: ${access}${requested ? ` (${A.requestedAccess} ${requested}; ${A.allowedAccess} ${allowed})` : ''}`);
  }
  if (entry.kind === 'priority' && entry.data?.asked === 'urgent') {
    return text.replace('Urgent needs a rule in TRIAGE.md; the priority comes from impact and effort.', A.urgentNeedsRule);
  }
  return text;
}

/**
 * One line of the log as a sentence. The store keeps what happened as data (kind, from/to, a reason), never as display
 * text, so the words are written here. `comment` entries (notes, progress, decisions, results) carry their own text.
 */
export function describe(entry) {
  const { kind, data } = entry;
  const text = storedSystemText(entry);
  const A = T.activity;
  if (data?.deliveryError) return { sentence: A.commented, comment: T.detail.messageErrors.delivery_failed };
  switch (kind) {
    case 'source': return { sentence: data?.source === 'owner' ? A.created : (data?.source === 'session' ? A.createdFromSession : A.createdFromMessage), detail: text };
    case 'status': return { sentence: A.status(T.status[data?.from] ?? data?.from, T.status[data?.to] ?? data?.to), detail: text };
    case 'priority': return { sentence: A.priority(T.priority[data?.to] ?? data?.to), detail: text };
    case 'due': return { sentence: data?.to == null ? A.dueRemoved : A.due(dueText(data.to)), detail: text };
    case 'assign': return { sentence: data?.agent ? A.assigned(agentName(data.agent)) : A.unassigned, detail: text };
    case 'blocked': return { sentence: A.asked, detail: text };
    case 'session': {
      const started = /^started a session with (.+)$/.exec(text ?? '');
      const sentence = started ? A.sessionStarted(started[1])
        : text === 'closed the session' ? A.sessionClosed
          : text === 'resumed the session' ? A.sessionResumed : text || A.session;
      return { sentence, detail: '' };
    }
    default: return { sentence: A.commented, comment: text }; // note, progress, decision, result
  }
}
