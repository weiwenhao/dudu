// The rules that turn what a reader saw of a session into its state (docs/assistant.md 3.4: "状态由规则判定，不调用模型").
// Pure: no I/O, no clock of its own, no model. `judge(provider, facts, { now })` answers { state, stateSince, pending }.
//
//   state     'running' | 'waiting_owner' | 'finished' | 'idle' | 'error'
//   stateSince  ms since when the session has been in that state, from the source's own timestamps (null when it has none)
//   pending   { kind: 'question' | 'approval', text } while the session waits for the owner, else null
//
// What each reader gives (all times are ms UTC):
//   claude  { process, tail, dsh?, updatedAt }
//           process  the live process in Claude Code's registry, or null: { status: 'busy' | 'shell' | 'idle' | 'waiting',
//                    since, waitingFor?, needs? }. The registry has four statuses, not two: `shell` is an idle prompt with a
//                    background shell still running (Claude's own UI calls it working), `waiting` is a dialog the owner must answer.
//           tail     the end of the transcript, from readers.mjs: { last, at, turnEnded, ending, question, tool }
//                    last: 'none' | 'answer' | 'ask' | 'tool_call' | 'tool_result' | 'prompt' | 'partial' | 'interrupted' |
//                    'compacted' | 'error'; ending is the last words of the assistant's last message
//   codex   { turn, updatedAt, dsh? }   turn: { status: 'completed' | 'interrupted' | 'failed' | 'inProgress', startedAt,
//                    completedAt, question, ending }, the last turn of the thread (a fresh app-server has nothing loaded, so
//                    the thread's own status is always notLoaded and is not used)
//   dsh     { dsh, updatedAt }          dsh: { running, since, pending, last: 'answer' | 'error' | 'aborted', at } as DSH says it
// A DSH session that Claude or Codex drives is one session: its DSH facts come in as `dsh` of the native one.
//
// Two rules go beyond the doc, because real transcripts needed them (about one session in ten ends in a question, and most of those
// were left weeks ago; some end because the process was killed in the middle of a turn):
//   - A question or an error read from the transcript of a session whose process is gone is only news for `staleMs` (default
//     7 days); after that it is an old, abandoned session and reads `idle`. A live process, a registry `waiting` and what DSH
//     itself says are never aged: they are facts, not a reading of old text.
//   - A session whose process is gone in the middle of a turn (the last record is a prompt nothing answered, a tool call, a
//     tool result, or a message cut off) never finished: that is `error`, as a failed turn is.
import { oneLine } from '../../providers/native/text.mjs';

export const SESSION_STATES = Object.freeze(['running', 'waiting_owner', 'finished', 'idle', 'error']);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const RULE_DEFAULTS = Object.freeze({
  staleMs: 7 * DAY,
  // Codex keeps no process registry: a turn it says is in progress counts as running while its thread was written to this recently.
  runningFreshMs: 10 * MINUTE,
});
export const EXCERPT_CHARS = 300;
// What the rules need of the end of a message, and no more.
export const ENDING_CHARS = 1500;

// The characters a message may close with after its last question mark: brackets, quotes, markdown emphasis.
const CLOSERS = /[\s)\]}>"'`*_~”’」』»]+$/u;

/** The question a message ends with (its last paragraph, cut to `limit` characters from the end), or null when it does not end in one. */
export function endsInQuestion(text, limit = EXCERPT_CHARS) {
  const body = String(text ?? '').replace(CLOSERS, '');
  if (!/[?？]$/u.test(body)) return null;
  const flat = body.split(/\n\s*\n/).at(-1).replace(/\s+/g, ' ').trim();
  const characters = [...flat];
  return characters.length <= limit ? flat : `…${characters.slice(-(limit - 1)).join('')}`;
}

const first = (...values) => values.find((value) => Number.isFinite(value)) ?? null;
const running = (since) => ({ state: 'running', stateSince: since, pending: null });
const waiting = (since, pending) => ({ state: 'waiting_owner', stateSince: since, pending });
const finished = (since) => ({ state: 'finished', stateSince: since, pending: null });
const idle = (since) => ({ state: 'idle', stateSince: since, pending: null });
const failed = (since) => ({ state: 'error', stateSince: since, pending: null });

const pendingOf = (pending) => ({ kind: pending?.kind === 'approval' ? 'approval' : 'question', text: oneLine(pending?.text ?? '', EXCERPT_CHARS) });

// Claude: a prompt, a tool call or a tool result is the middle of a turn; the turn is over only once the assistant answered.
const MID_TURN = new Set(['prompt', 'tool_call', 'tool_result', 'partial']);
const NO_TAIL = Object.freeze({ last: 'none', at: null, turnEnded: false, ending: '', question: '', tool: '' });

function claude({ process: live = null, tail, dsh = null, updatedAt }, { now, staleMs }) {
  const t = tail ?? NO_TAIL;
  const when = first(t.at, updatedAt);
  // A process that is alive keeps what it says current; for a session that has no process, only a recent transcript does.
  const current = Boolean(live) || when === null || now - when <= staleMs;
  const asked = endsInQuestion(t.ending);

  // What DSH knows of its own loop is exact, and an unanswered question blocks the loop that is otherwise "running".
  if (dsh?.pending) return waiting(first(dsh.pending.since, dsh.since, dsh.at, t.at), pendingOf(dsh.pending));
  if (live?.status === 'waiting') {
    const kind = t.question || live.waitingFor === 'input needed' ? 'question' : 'approval';
    return waiting(first(live.since, t.at), { kind, text: oneLine(t.question || (t.last === 'tool_call' && t.tool) || live.needs || live.waitingFor || '', EXCERPT_CHARS) });
  }
  if (live && (live.status === 'busy' || live.status === 'shell')) return running(first(live.since, t.at));
  if (dsh?.running) return running(first(dsh.since, t.at, updatedAt));

  // Nothing is going on in the process, so what the transcript ends with says what the session waits for.
  if (t.last === 'ask' && current) return waiting(t.at, { kind: 'question', text: oneLine(t.question, EXCERPT_CHARS) });
  if (t.last === 'answer' && asked) return current ? waiting(t.at, { kind: 'question', text: asked }) : idle(t.at);
  if (t.last === 'error' && current) return failed(t.at);
  if (!live && MID_TURN.has(t.last) && current) return failed(t.at);
  if (!live && t.last === 'answer') return finished(t.at);
  return idle(first(live?.since, t.at, updatedAt));
}

function codex({ turn = null, updatedAt, dsh = null }, { now, staleMs, runningFreshMs }) {
  const at = first(turn?.completedAt, turn?.startedAt, updatedAt);
  const current = at === null || now - at <= staleMs;
  if (dsh?.pending) return waiting(first(dsh.pending.since, dsh.since, dsh.at, at), pendingOf(dsh.pending));
  if (dsh?.running) return running(first(dsh.since, turn?.startedAt, updatedAt));
  if (turn?.status === 'inProgress' && Number.isFinite(updatedAt) && now - updatedAt <= runningFreshMs) return running(first(turn.startedAt, updatedAt));
  if (turn?.question && current) return waiting(at, { kind: 'question', text: oneLine(turn.question, EXCERPT_CHARS) });
  if (turn?.status === 'completed') {
    const asked = endsInQuestion(turn.ending);
    if (asked) return current ? waiting(at, { kind: 'question', text: asked }) : idle(at);
    return finished(at);
  }
  if (turn?.status === 'failed' && current) return failed(at);
  return idle(at);
}

function dshOwn({ dsh = null, updatedAt }, { now, staleMs }) {
  if (!dsh) return idle(updatedAt ?? null);
  if (dsh.pending) return waiting(first(dsh.pending.since, dsh.since, dsh.at), pendingOf(dsh.pending));
  if (dsh.running) return running(first(dsh.since, dsh.at, updatedAt));
  const at = first(dsh.at, updatedAt);
  if (dsh.last === 'error' && (at === null || now - at <= staleMs)) return failed(at);
  if (dsh.last === 'answer') return finished(at);
  return idle(at);
}

const RULES = { claude, codex, dsh: dshOwn };

/** The state of one session from what its reader saw; `now` is ms UTC, `staleMs` and `runningFreshMs` override RULE_DEFAULTS. */
export function judge(provider, facts, { now = Date.now(), ...options } = {}) {
  const rule = RULES[provider];
  if (!rule) throw new TypeError(`No state rules for provider "${provider}".`);
  return rule(facts ?? {}, { ...RULE_DEFAULTS, ...options, now });
}
