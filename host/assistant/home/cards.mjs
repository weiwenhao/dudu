// The cards the quick buttons of 嘟嘟's chat send (owner, 2026-11-10: 待办 / 信息 / 定时任务 above the input, "点击后直接通过聊天窗口发卡片过来，点击卡片中的具体条目再做跳转，信息和定时任务不需要跳转").
//
// A card is made without the model. A command of the conversation, `/dudu-card <kind>` (registered on that conversation's agent, home/conversation.mjs), builds the rows here from the stores the
// pages already read, keeps them under the command's id, and leaves the command's own two ordinary session events (`command/run`, `command/done`) as the card's place in the thread: they have
// a sequence number, they page, they sync to the phone and they survive a restart like every other event, and DSH's own chat shows them as the command with a readable list as its result.
// The rows are a snapshot of the moment of the tap. Both ends look a card up by that id: the desktop through `assistant/cards`, the phone's bridge when it builds the transcript.
//
// The rows have the shape the app already draws: a todo is the phone board's own row (native-board.mjs `boardRow`), a piece of information is the inbox's own card, a task is what the
// tasks service lists (its schedule as it stores it: each end writes the rule in its own words), and the quota is what the quota panel shows (`quota.request`: each agent's plan and windows, DeepSeek's wallet and key).
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { boardRow } from '../../native-board.mjs';
import { issueSessionId, listAllIssues } from './issue-list.mjs';

export const CARD_COMMAND = 'dudu-card';
export const CARD_KINDS = Object.freeze(['todo', 'info', 'task', 'quota']);
const VERSION = 1;
const MAX_TODO = 30;
const MAX_INFO = 30;
const MAX_TASKS = 50;
const KEEP = 100;
const MAX_TEXT = 4000;

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The schedule as the tasks service stores it, without anything it does not name. */
function scheduleOf(schedule) {
  if (!isRecord(schedule)) return null;
  const out = {};
  for (const key of ['kind', 'time', 'timezone', 'date', 'expression']) if (typeof schedule[key] === 'string') out[key] = text(schedule[key], 200);
  if (Number.isSafeInteger(schedule.day)) out.day = schedule.day;
  if (Number.isFinite(schedule.minutes)) out.minutes = schedule.minutes;
  if (Array.isArray(schedule.weekdays)) out.weekdays = schedule.weekdays.filter((day) => Number.isSafeInteger(day)).slice(0, 7);
  return out;
}

/**
 * `issues`, `inbox` and `tasks` each answer with the service that runs the desktop interface's commands (`execute(action, body)`) or with nothing yet: they are asked for when a card is made,
 * because the plugin starts them after the conversation.
 */
export function createCards({ file, issues = () => null, inbox = () => null, tasks = () => null, quota = () => null, activity, warm, latest = null, now = Date.now }) {
  const kept = new Map();
  if (file && existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      if (stored?.version === VERSION && Array.isArray(stored.cards)) {
        for (const [id, card] of stored.cards) if (typeof id === 'string' && isRecord(card) && CARD_KINDS.includes(card.kind)) kept.set(id, card);
      }
    } catch { /* an unreadable file is a memory that is gone: cards are snapshots, nothing else depends on them */ }
  }

  function save() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: VERSION, cards: [...kept] })}\n`, { mode: 0o600 });
    renameSync(temp, file);
  }

  const ask = async (service, action, body) => {
    const answer = await service()?.execute(action, body);
    if (answer?.outcome !== 'success') throw new Error('The list is unavailable.');
    return answer;
  };

  /**
   * The phone's 待办 lists unread issue conversations across workflows (owner, 2026-11-16).
   * Refresh cached display activity before filtering; work can coexist with unread content. This is
   * read-only and uses the homepage's completed-message order, never partial generation time.
   */
  async function todo(cursor) {
    let before;
    if (cursor != null) {
      try { before = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { /* rejected below */ }
      if (!Array.isArray(before) || before.length !== 2 || !Number.isFinite(before[0]) || before[0] < 0
        || !Number.isSafeInteger(before[1]) || before[1] < 1) throw new TypeError('Invalid todo cursor');
    }
    const all = await listAllIssues((action, body) => ask(issues, action, body));
    await warm([...new Set(all.map(issueSessionId).filter(Boolean))]);
    const unread = all.flatMap((item) => {
      const sessionId = issueSessionId(item);
      const state = sessionId ? activity(sessionId) : null;
      return state?.unread === true ? [{ item, sessionId, state, at: state.attention?.messageAt ?? 0 }] : [];
    }).sort((a, b) => b.at - a.at || a.item.id - b.item.id);
    const page = unread.filter(({ at, item }) => !before || at < before[0] || (at === before[0] && item.id > before[1]));
    const items = page.slice(0, MAX_TODO);
    await latest?.ensure(items.map(({ sessionId }) => sessionId));
    const rows = items.map(({ item, sessionId, state }) => {
      const row = boardRow({ ...item, sessionState: state.sessionState });
      const said = latest?.get(sessionId);
      return said ? { ...row, latest: { who: said.who, text: said.text, at: said.at } } : row;
    });
    const last = items.at(-1);
    return {
      total: unread.length, rows,
      ...(page.length > MAX_TODO ? { nextCursor: Buffer.from(JSON.stringify([last.at, last.item.id])).toString('base64url') } : {}),
    };
  }

  /** The records still to be handled, as the Collector lists them. */
  async function info() {
    const answer = await ask(inbox, 'list', { tab: 'todo', limit: MAX_INFO });
    const rows = (answer.items ?? []).slice(0, MAX_INFO).map((item) => ({
      id: item.id, ref: item.ref ?? null, connector: text(item.connector, 100), connectorName: text(item.connectorName, 100), connectorIcon: item.connectorIcon ?? null,
      title: text(item.title, 300), from: item.from ? text(item.from, 200) : null, at: Number.isFinite(item.at) ? item.at : null,
    }));
    const counted = Array.isArray(answer.facets?.connector) ? answer.facets.connector.reduce((sum, entry) => sum + (Number.isSafeInteger(entry.count) ? entry.count : 0), 0) : 0;
    return { total: Math.max(counted, rows.length), rows };
  }

  /** The tasks that are on or paused (a one-time task that has run is over), the next to run first. */
  async function task() {
    const answer = await ask(tasks, 'list', {});
    const open = (answer.tasks ?? []).filter((one) => one.status === 'active' || one.status === 'paused');
    const rank = (one) => (one.status === 'active' ? 0 : 1);
    open.sort((a, b) => rank(a) - rank(b) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const rows = open.slice(0, MAX_TASKS).map((one) => ({
      id: text(one.id, 100), title: text(one.title, 300), agent: typeof one.agent === 'string' ? one.agent : null, status: one.status,
      nextRunAt: one.status === 'active' && Number.isFinite(one.nextRunAt) ? one.nextRunAt : null, schedule: scheduleOf(one.schedule),
    }));
    return { total: open.length, rows };
  }

  /**
   * The subscription quota (owner, 2026-11-11: "问问 嘟嘟当前的订阅额度，嘟嘟回复一个卡片"): what the quota panel shows, as the quota service has it (`quota.request`: a person asked, so a source not read in the last fifteen
   * minutes is read now and the card waits for it): each agent with its plan (and when the plan's paid time ends, `until`) and its windows (how much is used, when it starts over), a DeepSeek wallet or key as its
   * balance, and when the oldest of the readings was taken (`readAt`, the panel's "更新于"). A source whose sign-in is gone or that has nothing to read is not in the list (the service leaves it out). The windows are
   * the plugin's own names ("5 小时", "每周"): both ends write them in their words.
   */
  async function quotaCard() {
    const service = quota();
    const answer = service ? await service.request({ ask: true, wait: true }) : null;
    if (!Array.isArray(answer?.providers)) throw new Error('The quota is unavailable.');
    const rows = answer.providers.filter((provider) => isRecord(provider)).slice(0, 8).map((provider) => ({
      id: text(provider.id, 40), agent: text(provider.agent ?? provider.id, 40), name: text(provider.name, 60), ...(provider.kind === 'balance' ? { kind: 'balance' } : {}), state: 'ok', plan: text(provider.plan, 40), limited: false,
      windows: (Array.isArray(provider.windows) ? provider.windows : []).slice(0, 4).map((window) => ({
        key: text(String(window.key ?? ''), 40), label: text(window.label, 40), used: Math.min(1, Math.max(0, Number(window.used) || 0)),
        ...(Number.isFinite(window.resetsAt) ? { resetsAt: window.resetsAt } : {}), core: window.core === true,
      })),
      ...(Number.isFinite(provider.until) ? { until: provider.until } : {}),
      ...(Array.isArray(provider.balance) ? { balance: provider.balance.slice(0, 4).map((amount) => ({ text: text(amount?.text, 40) })).filter((amount) => amount.text) } : {}),
    }));
    return { total: rows.length, ...(Number.isFinite(answer.readAt) ? { readAt: answer.readAt } : {}), rows };
  }

  /** What a card of this kind lists now. Throws when the list cannot be read: an empty card must never mean "could not look". */
  async function build(kind) {
    if (!CARD_KINDS.includes(kind)) throw new Error('Unknown card.');
    const body = await ({ todo, info, task, quota: quotaCard }[kind])();
    return { v: VERSION, kind, at: now(), ...body };
  }

  function put(commandId, card) {
    if (typeof commandId !== 'string' || !commandId) throw new Error('A card needs the command that made it.');
    kept.delete(commandId);
    kept.set(commandId, card);
    while (kept.size > KEEP) kept.delete(kept.keys().next().value);
    save();
  }

  const get = (commandId) => (typeof commandId === 'string' ? kept.get(commandId) ?? null : null);

  /**
   * Whether a card of this kind made now would only repeat the one that the command `since` made (owner, 2026-11-10: "连点就发一张，如果都一样的话，就去个重"): the same list, row for row, and the
   * same total. The client names `since` only when that card is the newest of its kind and nothing but cards follows it in the thread, so a card made after a conversation is always made.
   * A list that cannot be read is not a repeat: the command then says why.
   */
  async function repeats(kind, since) {
    const earlier = get(since);
    if (!earlier || earlier.kind !== kind) return false;
    try {
      const now = await build(kind);
      return earlier.total === now.total && JSON.stringify(earlier.rows) === JSON.stringify(now.rows);
    } catch { return false; }
  }

  return {
    build, put, get, repeats,
    // The phone's sheet reads the same list without executing a command or keeping a card in the thread.
    todos: todo,
    /** Several at once, by command id, for a page that has just read some of the thread: the ones that are known. */
    many(ids) {
      const found = {};
      for (const id of Array.isArray(ids) ? ids.slice(0, 100) : []) { const card = get(id); if (card) found[id] = card; }
      return found;
    },
  };
}

/**
 * The command as DSH registers it (on the conversation's agent: home/conversation.mjs): it builds the card, keeps it under the command's id and answers with the list. A list that cannot be read
 * is an error, never an empty card.
 */
export function cardCommand(cards) {
  return {
    name: CARD_COMMAND, description: 'Show one of the quick lists of the chat as a card: todo, info, task or quota', input: { hint: CARD_KINDS.join(' | ') },
    handler: async ({ commandId, rawInput }) => {
      const kind = String(rawInput ?? '').trim();
      if (!CARD_KINDS.includes(kind)) return { kind: 'error', text: `Choose ${CARD_KINDS.join(', ')}.` };
      try {
        const card = await cards.build(kind);
        cards.put(commandId, card);
        const list = cardText(card);
        return list ? { kind: 'success', text: list } : { kind: 'success' };
      } catch (error) { return { kind: 'error', text: error?.message || 'The card could not be made.' }; }
    },
  };
}

/**
 * The card as a plain list, for what DSH's own chat shows under `/dudu-card <kind>`: no words of the interface in it (they are the pages' and the app's, in their language), only what the
 * rows say. An empty card has nothing to list.
 */
export function cardText(card) {
  const lines = (card?.rows ?? []).map((row) => {
    if (card.kind === 'todo') return [row.ref ?? `#${row.id}`, row.title].filter(Boolean).join(' ');
    if (card.kind === 'info') return [row.title, row.from].filter(Boolean).join(' · ');
    if (card.kind === 'quota') return `${[row.name, row.plan].filter(Boolean).join(' ')}: ${row.kind === 'balance' ? (row.balance ?? []).map((amount) => amount.text).join(' + ') || '—' : (row.windows ?? []).map((window) => `${window.label} ${Math.max(0, 100 - Math.round(window.used * 100))}%`).join(', ') || '—'}`;
    return `${row.status === 'paused' ? '⏸ ' : ''}${row.title}`;
  });
  return lines.join('\n').slice(0, MAX_TEXT);
}
