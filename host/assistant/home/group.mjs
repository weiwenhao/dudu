// 嘟嘟's conversation as a group chat with a boundary (owner, 2026-11-10: "将嘟嘟会话框的展现形式展现成群聊一样的方式，嘟嘟能看到他当前会话内的所有上下文，但是其他会话 … 他们看不到"; docs/assistant.md 4.1).
//
// Four things come into the thread besides what the owner and 嘟嘟 say: the owner's `@ISSUE …` line (`at`), the answer of that issue's agent to it (`reply`: the last message of the turn the line
// started, or its question when the turn stops to ask), a silent mark that the answer will not come (`end`: the turn failed or was stopped, or said nothing), and the result of a scheduled task that
// 嘟嘟 did (`task`: its last message, or why the run failed; the run itself happened in a conversation of its own, task-session.mjs). Each one is a command of the
// conversation that the plugin runs without the model, `/dudu-say <kind> <id>`, exactly as a card is (cards.mjs): its two ordinary session events are the entry's place in the thread, and what it
// says is kept here under the command's id, so that both ends can ask for it. The agent of an issue is never told of any of this: it gets the owner's line, as it always did, and sees nothing else.
//
// 嘟嘟 reads none of these events (the model never reads a command's), so `material()` hands it the latest of them in its system prompt: it sees the whole group, the agents see their own lines.
// Nothing here talks to a model, and an agent that is not asked says nothing in the thread.
//
// The owner can hide a line of the thread (a message of theirs, of 嘟嘟, a card, a line of the group): hiding is only about what the interface shows. DSH's session log only grows, and 嘟嘟 still has
// what it was told (the owner, 2026-11-10: "删除只是在会话界面删除这个消息，实际是没有删除"). The hidden ones are named by the sequence number of their event.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SAY_COMMAND = 'dudu-say';
export const SAY_KINDS = Object.freeze(['at', 'reply', 'end', 'task']);
const VERSION = 1;
const KEEP = 500;
const MAX_TEXT = 6000;
const MAX_HIDDEN = 5000;
const MATERIAL_LINES = 12;
const MATERIAL_TEXT = 800;
/** A scheduled task's result is 嘟嘟's own earlier message, and the owner goes on from a part of it ("第 3 条展开说说"): it is cut later than an agent's answer. */
const MATERIAL_TASK_TEXT = 2000;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clip = (value, max) => {
  const flat = String(value ?? '').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** What a line of the group says of its issue: who it is (the ID is the name, the agent's logo the picture, the title the signature). */
export function briefIssue(issue) {
  return {
    id: Number.isSafeInteger(issue?.id) ? issue.id : null,
    ref: typeof issue?.ref === 'string' && issue.ref ? issue.ref : null,
    title: clip(issue?.title, 200),
    agent: typeof issue?.agent === 'string' ? issue.agent : null,
  };
}
const nameOf = (issue) => issue?.ref ?? (issue?.id != null ? `#${issue.id}` : '');

/** The line of a scheduled task's result: who it is (the task's id and title), what it says (its last message, or why the run failed: `ok` false) and when. */
export function taskLine({ task, text, ok = true, at }) {
  return { v: VERSION, kind: 'task', task: { id: String(task?.id ?? ''), title: clip(task?.title, 200) }, text: clip(text, MAX_TEXT), ok: ok !== false, at };
}

/** The line as plain text, for what DSH's own chat shows under `/dudu-say`. */
export function sayText(record) {
  if (record?.kind === 'at') return `@${nameOf(record.issue)} ${record.text ?? ''}`.trim();
  if (record?.kind === 'reply') return `${nameOf(record.issue)}: ${record.text ?? ''}`.trim();
  if (record?.kind === 'task') return `${record.task?.title ?? ''}: ${record.text ?? ''}`.trim();
  return '';
}

/**
 * `sessions` is agent-sessions.mjs (`onChange`): the answer of an agent is waited for there, in what DSH says of its session. `say(kind, record)` makes the entry in the thread and answers with the
 * id of its command (conversation.mjs). Both come later than this module (the conversation is opened after the services), so they are plain functions asked for when used.
 */
export function createGroup({ file = null, sessions = () => null, say = async () => { throw new Error('The group is not open.'); }, now = Date.now, log = console } = {}) {
  const kept = new Map();
  let hidden = new Set();
  if (file && existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      if (stored?.version === VERSION) {
        if (Array.isArray(stored.entries)) for (const [id, line] of stored.entries) if (typeof id === 'string' && isRecord(line) && SAY_KINDS.includes(line.kind)) kept.set(id, line);
        if (Array.isArray(stored.hidden)) hidden = new Set(stored.hidden.filter(Number.isSafeInteger).slice(-MAX_HIDDEN));
      }
    } catch { /* an unreadable file is a memory that is gone: the thread's lines then show as plain commands, and nothing else depends on it */ }
  }
  const pending = new Map();
  const waits = new Map();
  let unsubscribe = null;

  function save() {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ version: VERSION, entries: [...kept], hidden: [...hidden] })}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) { log.warn?.(`[dudu] The group chat could not be saved: ${error.message}`); }
  }

  // --- the lines -------------------------------------------------------------------------------------------------------------------------
  /** A line waits here, by an id that rides in the command's input, until the command runs and takes it. */
  function pend(record) {
    const id = randomUUID();
    pending.set(id, record);
    while (pending.size > 64) pending.delete(pending.keys().next().value);
    return id;
  }
  const take = (id) => { const record = pending.get(id); pending.delete(id); return record ?? null; };

  function put(commandId, record) {
    if (typeof commandId !== 'string' || !commandId) throw new Error('A line needs the command that made it.');
    kept.delete(commandId);
    kept.set(commandId, record);
    while (kept.size > KEEP) kept.delete(kept.keys().next().value);
    save();
  }
  const get = (commandId) => (typeof commandId === 'string' ? kept.get(commandId) ?? null : null);

  /** The command as DSH registers it (on the conversation's agent: conversation.mjs): it takes the line that waits under the id it was given and keeps it under its own. */
  function command() {
    return {
      name: SAY_COMMAND, description: 'A line of the group chat of this conversation: the owner\'s @ message to an issue, its answer, or the result of a scheduled task', input: { hint: SAY_KINDS.join(' | ') },
      handler: async ({ commandId, rawInput }) => {
        const [kind, id] = String(rawInput ?? '').trim().split(/\s+/u);
        const line = SAY_KINDS.includes(kind) && id ? take(id) : null;
        if (!line || line.kind !== kind) return { kind: 'error', text: 'That line is not waiting.' };
        put(commandId, line);
        const said = sayText(line);
        return said ? { kind: 'success', text: said.slice(0, MAX_TEXT) } : { kind: 'success' };
      },
    };
  }

  // --- waiting for the answer -------------------------------------------------------------------------------------------------------------
  const outcomeOf = (change) => {
    const snapshot = change.snapshot ?? {};
    if (change.to === 'finished') {
      const text = clip(snapshot.ending, MAX_TEXT);
      return text ? { kind: 'reply', text, answer: 'answer' } : { kind: 'end' };
    }
    if (change.to === 'waiting_owner') {
      const text = clip(snapshot.pending?.text, MAX_TEXT);
      return text ? { kind: 'reply', text, answer: 'question' } : { kind: 'end' };
    }
    return { kind: 'end' };
  };

  async function finish(wait) {
    waits.delete(wait.token);
    const outcome = wait.outcome ?? { kind: 'end' };
    try {
      if (outcome.kind === 'reply') await say('reply', { v: VERSION, kind: 'reply', issue: wait.issue, text: outcome.text, to: wait.atId, answer: outcome.answer, at: now() });
      else await say('end', { v: VERSION, kind: 'end', issue: wait.issue, to: wait.atId, at: now() });
    } catch (error) { log.warn?.(`[dudu] The answer of an issue could not be put in the group chat: ${error.message}`); }
  }

  function advance(change) {
    for (const wait of [...waits.values()]) {
      if (wait.key !== change.key || wait.outcome) continue;
      // The turn of our line is the first one that starts after it was sent (one that was running then is the line before ours: it is not the answer).
      if (!wait.started) { if (change.to === 'running' && change.from !== 'running') wait.started = true; continue; }
      if (change.to === 'running') continue;
      wait.outcome = outcomeOf(change);
      if (wait.atId) void finish(wait); // else `sent` is still making the entry for the line, and finishes after it
    }
  }
  try { unsubscribe = sessions()?.onChange?.(advance) ?? null; } catch { unsubscribe = null; }
  const hear = () => {
    // The agent sessions may start after this module: join them the first time a line is sent.
    if (unsubscribe) return;
    try { unsubscribe = sessions()?.onChange?.(advance) ?? null; } catch { unsubscribe = null; }
  };

  return {
    command, pend, take, put, get,
    many(ids) {
      const found = {};
      for (const id of Array.isArray(ids) ? ids.slice(0, 100) : []) { const line = get(id); if (line) found[id] = line; }
      return found;
    },

    /** Before the owner's line is delivered to the session `key`: what that session does next is to be watched from now on. */
    expect(key) {
      hear();
      const token = Symbol('say');
      waits.set(token, { token, key, started: false, outcome: null, atId: null, issue: null });
      return token;
    },
    /** The line was not delivered. */
    cancel(token) { waits.delete(token); },
    /** The line was delivered: it comes into the thread (its tick), and its answer when it comes. */
    async sent(token, { issue, text, files = 0 }) {
      const wait = waits.get(token);
      if (!wait) return null;
      wait.issue = briefIssue(issue);
      try {
        wait.atId = await say('at', { v: VERSION, kind: 'at', issue: wait.issue, text: clip(text, MAX_TEXT), files: Number.isSafeInteger(files) && files > 0 ? files : 0, at: now() });
      } catch (error) {
        waits.delete(token);
        log.warn?.(`[dudu] The line to an issue could not be put in the group chat: ${error.message}`);
        return null;
      }
      if (wait.outcome) await finish(wait);
      return wait.atId;
    },
    /** A restart forgot who was being waited for: nothing to do, a line that never gets its answer shows no waiting after a while (the interface says how long). */
    waiting: () => waits.size,

    /**
     * What 嘟嘟's prompt shows of the group: the latest lines, oldest first, each cut short. Empty when there are none. A scheduled task's result is there too, so that the owner can go on from it
     * ("第 3 条展开说说"): it is 嘟嘟's own earlier words, from a run that happened in a conversation of its own.
     */
    material(limit = MATERIAL_LINES) {
      const lines = [...kept.values()].filter((line) => line.kind === 'at' || line.kind === 'reply' || line.kind === 'task').sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-limit);
      return lines.map((line) => ({
        at: Number.isFinite(line.at) ? new Date(line.at).toISOString() : null,
        from: line.kind === 'at' ? 'owner' : line.kind === 'task' ? `scheduled task "${line.task?.title ?? ''}" (done by you in a conversation of its own)` : nameOf(line.issue),
        to: line.kind === 'at' ? nameOf(line.issue) : 'owner',
        text: clip(line.text, line.kind === 'task' ? MATERIAL_TASK_TEXT : MATERIAL_TEXT),
        ...(line.kind === 'reply' && line.answer === 'question' ? { asksTheOwner: true } : {}),
        ...(line.kind === 'task' && line.ok === false ? { failed: true } : {}),
      }));
    },

    hide(seqs) {
      const added = (Array.isArray(seqs) ? seqs : []).filter(Number.isSafeInteger).slice(0, 200);
      if (!added.length) return { outcome: 'needs_clarification', code: 'invalid_message' };
      for (const seq of added) hidden.add(seq);
      if (hidden.size > MAX_HIDDEN) hidden = new Set([...hidden].slice(-MAX_HIDDEN));
      save();
      return { outcome: 'success', hidden: [...hidden] };
    },
    hidden: () => hidden,
    dispose() { try { unsubscribe?.(); } catch { /* gone already */ } unsubscribe = null; waits.clear(); },
  };
}
