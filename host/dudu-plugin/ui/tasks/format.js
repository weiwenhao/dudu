import { AGENT_NAMES } from '../issues/model.js';
import { formatDateTime, getLocale, intlLocale } from '../lib/locale.mjs';
import { T } from '../strings.js';

// Who does a scheduled task: one of the agents of the issues, or 嘟嘟 itself (agent `dudu`). 嘟嘟 is a provider of a task only: AGENT_NAMES and the agent lists of the issues stay what an issue can be given to.
export const DUDU = 'dudu';
/** The name of the provider of a task; `fallback` is the name the plugin sent for a provider this page does not know. */
export const taskAgentName = (id, fallback) => (id === DUDU ? T.brand : (AGENT_NAMES[id] ?? fallback ?? id));

/**
 * Where a task may run. 嘟嘟 works in its own folder, so a task of its own has no existing conversation to take over: a new conversation every time (its default, the first), or one that is made once and kept (owner,
 * 2026-11-11: the drawing `.local/designs/scheduled-tasks-fresh-session-2026-11-11/form.png`). The agents of the issues keep the three choices in the order the window always had.
 */
export const targetModes = (agent) => (agent === DUDU ? ['new', 'reuse'] : ['reuse', 'new', 'existing']);

/** The workspace and the place a task has when its provider is chosen. A task of 嘟嘟 has no workspace; the others start in the first one the plugin lists, in a conversation that is made once and reused. */
export const providerDefaults = (agent, options = {}) => (agent === DUDU ? { project: null, target: { mode: 'new' } } : { project: options.projects?.[0] ?? null, target: { mode: 'reuse' } });

/**
 * The draft after another provider is chosen in the form. Between Claude, ChatGPT and DeepSeek only the model starts over (the workspace and the place stay as they were chosen, as they always did). To or from 嘟嘟
 * the workspace and the place go back to the new provider's own default, so that a place it cannot have (已有会话) or a workspace it does not have never stays. Choosing the provider the draft has changes nothing.
 */
export function chooseProvider(draft, agent, options = {}) {
  if (agent === draft.agent) return draft;
  const crossing = agent === DUDU || draft.agent === DUDU;
  return { ...draft, agent, model: null, ...(crossing ? providerDefaults(agent, options) : {}) };
}

/**
 * The draft after a conversation is chosen to run in (owner, 2026-11-17, from the picker's design: 供应商, 模型 and 关联工作区 follow the conversation): its agent, its model and its workspace become the task's and the
 * place is that conversation, so the three can never disagree with it (the plugin refuses a conversation on another model than the task's). `session` is a row of `sessions/list` asked with `inDsh`. The draft keeps
 * its keys in their order: the window compares drafts as text.
 */
export function followSession(draft, session, options = {}) {
  const project = options.projects?.find((item) => item.id === session.workspaceId) ?? (session.project?.path ? { id: session.workspaceId, name: session.project.name, path: session.project.path } : draft.project);
  return { ...draft, agent: session.agent, model: session.model ?? null, project, target: { mode: 'existing', sessionId: session.dshSessionId ?? session.id } };
}

/**
 * Whether a task can be sent into this conversation: it is in a workspace DSH has, and its provider and model are ones the plugin can run (otherwise saving would be refused). Until the plugin has said what it can run,
 * every conversation can be chosen and the plugin has the last word.
 */
export function canRunIn(session, options = {}) {
  if (!session.workspaceId) return false;
  if (!options.providers) return true;
  const provider = options.providers.find((item) => item.id === session.agent);
  return Boolean(provider && provider.available !== false && (!session.model || (provider.models ?? []).includes(session.model)));
}

/** What a line of a task in 嘟嘟's conversation says under its header: the result of the run, or, for a run that failed, the word for it and the reason (the plugin's own text, which may be English). */
export function taskText(line) {
  const text = String(line?.text ?? '').trim();
  if (line?.ok !== false) return text;
  return text ? `${T.tasks.runFailed}${getLocale() === 'zh' ? '：' : ': '}${text}` : T.tasks.runFailed;
}

export const weekday = (day) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 8 + day)));
export const stamp = (at, timezone) => at ? formatDateTime(at, { timeZone: timezone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—';
export function timezoneLabel(zone) {
  const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value?.replace(/^GMT/, 'UTC');
  return offset ? `${zone} · ${offset}` : zone;
}
export function scheduleLabel(schedule) {
  const base = T.tasks.kinds[schedule.kind];
  if (schedule.kind === 'interval') return `${base} ${schedule.minutes}${T.pet.duration.minute}`;
  if (schedule.kind === 'cron') return schedule.expression;
  const days = schedule.kind === 'weekly' ? new Intl.ListFormat(intlLocale(), { style: 'short', type: 'conjunction' }).format((schedule.weekdays ?? []).map(weekday)) : '';
  return [base, schedule.date, schedule.kind === 'monthly' ? schedule.day : '', days, schedule.time].filter(Boolean).join(' ');
}
