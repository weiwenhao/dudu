// The issues and the sessions they are given to (docs/assistant.md 3.2 "状态跟着会话走", 3.3 "分配之后", 3.4): an issue that is given an
// agent gets a session in its project folder, with a first message written from the issue and its log; from then on the issue follows
// the session, and what the owner answers on the issue's page reaches the session. It never imports DSH: the sessions are
// ./agent-sessions.mjs's, the issues are host/assistant/issues/'s.
//
//   const assignment = createAssignment({ issues, agentSessions, defaultCwd, material?, accessOf?, waitMs = 8000, log });
//
//   defaultCwd()      -> the folder for an issue that has no project of its own (嘟嘟's, 3.2 "Project"); may be async
//   material(issue)   -> { from, text } | null   the original words of what the issue came from, to be attached as material
//   accessOf(issue)   -> { access?, model?, cwd? }   what ASSIGN.md says for this issue; with nothing said the session is read-only (3.3)
//
//   sessionState(key)        for createIssues({ sessionState })
//   onAssign(issue)          for createIssuesApi({ onAssign }): starts the session of an issue that was just given an agent
//   onReply(issue, text)     for createIssuesApi({ onReply }): hands the owner's answer to the issue's session
//   onResume(issue)          for createIssuesApi({ onResume }): puts a closed session back in DSH's sidebar
//   start(issue, { access?, model?, cwd? })   the same as onAssign, for whoever decides the access (the dispatch of 3.3); -> the result
//   closeFor(issue)          closes the session of an issue that is Done or Canceled (once it does not work any more)
//   restore()                after a restart: follows the sessions of the issues that are open (their state is read from DSH); -> how many
//   dispose()
//
// What the session does to the issue, as the session's state changes (the issue's `ask` is the card the page shows, and its agent state
// is derived from it and from the session's state by the store):
//
//   running        In Progress; the question that was open is gone
//   waiting_owner  the question of the agent is the issue's ask
//   finished       the last words of the agent are written to the log as its comment; In Review, ask "确认完成吗？"
//   error          the issue's ask says what failed and asks what to do
//   idle           nothing: the turn was stopped, the issue stays as it is
//
// A Done or Canceled issue is left as it is, and its session is closed once it has stopped. Everything done here is written as 嘟嘟,
// so that Undo and the log say who did it.
import { setTimeout as sleep } from 'node:timers/promises';
import { AGENTS } from './agent-sessions.mjs';
import { firstMessage } from './first-message.mjs';

// NEW wording. `ask` is shown on the issue's page as a card to answer ("确认完成吗？" is the doc's own, 3.2); the sentences of the session
// log are shown in Activity after "嘟嘟", in English like the rest of the Activity's words.
export const WORDS = Object.freeze({
  confirm: '确认完成吗？',
  failed: (reason) => `出错了：${reason || '没有说明原因'}。怎么办？`,
  notStarted: (reason) => `没能开始：${reason}。要换个智能体，还是稍后再试？`,
  notDelivered: (reason) => `回复没能发给会话：${reason}`,
  started: (agent) => `started a session with ${agent}`,
  closed: 'closed the session',
  resumed: 'resumed the session',
});

const ENDING_CHARS = 4000;
const EARLY_KEPT = 100;
const finished = (issue) => issue.status === 'done' || issue.status === 'canceled';
const cut = (text, max) => { const characters = [...String(text ?? '').trim()]; return characters.length <= max ? characters.join('') : `${characters.slice(0, max - 1).join('')}…`; };

export function createAssignment({ issues, agentSessions, defaultCwd, material, accessOf = () => ({}), waitMs = 8000, log = console } = {}) {
  if (!issues || !agentSessions) throw new TypeError('createAssignment needs the issues and the sessions.');
  const bySession = new Map();   // session key -> issue id
  const early = new Map();       // session key -> the last change heard before the issue knew the session (a turn that ended at once)
  const tails = new Map();       // issue id -> the work in line for it: one thing at a time per issue

  const serialized = (id, work) => {
    const run = (tails.get(id) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => {});
    tails.set(id, tail);
    tail.then(() => { if (tails.get(id) === tail) tails.delete(id); });
    return run;
  };
  const note = (id, text, data) => issues.log(id, { kind: 'session', text, data, actor: 'dudu' });
  const guard = (what, work) => Promise.resolve().then(work).catch((error) => { log.warn?.(`[dudu] ${what}: ${error.message}`); });

  // --- the session changes, the issue follows ---------------------------------------------------------------------------
  async function reflect(id, key, change) {
    const got = issues.get(id, { logLimit: 1 });
    if (got.outcome !== 'success') return;
    const { issue } = got;
    if (issue.session !== key) return; // the issue has another session now
    const { to: state, snapshot } = change;
    if (finished(issue)) {
      // Done is the owner's word: a session that still works is not interrupted, and is put away once it has stopped.
      if (state !== 'running' && state !== 'waiting_owner') await closeFor(issue);
      return;
    }
    let patch;
    switch (state) {
      case 'running': patch = { status: 'in_progress', ask: '' }; break;
      case 'waiting_owner': patch = { status: 'in_progress', ask: snapshot.pending?.text ?? '' }; break;
      case 'finished':
        if (snapshot.ending) issues.log(id, { kind: 'progress', text: cut(snapshot.ending, ENDING_CHARS), actor: issue.agent ?? 'agent' });
        patch = { status: 'in_review', ask: WORDS.confirm };
        break;
      case 'error': patch = { status: 'in_progress', ask: WORDS.failed(snapshot.error) }; break;
      default: return; // idle: the turn was stopped; the issue is as the owner left it
    }
    const changed = Object.fromEntries(Object.entries(patch).filter(([field, value]) => issue[field] !== value));
    if (Object.keys(changed).length) issues.update(id, changed, { actor: 'dudu' });
  }

  const unsubscribe = agentSessions.onChange((change) => {
    const id = bySession.get(change.key);
    if (id === undefined) {
      // A session is announced from its own start, a moment before the issue is told which session it has.
      if (early.size >= EARLY_KEPT) early.delete(early.keys().next().value);
      early.set(change.key, change);
      return;
    }
    serialized(id, () => guard('An issue could not follow its session', () => reflect(id, change.key, change)));
  });

  // --- giving an issue to an agent ------------------------------------------------------------------------------------------
  const refuse = (issue, message, extra) => {
    issues.update(issue.id, { ask: WORDS.notStarted(message) }, { actor: 'dudu' });
    return { outcome: 'error', message, ...(extra?.next ? { next: extra.next } : {}), issue };
  };

  async function begin(id, options) {
    const got = issues.get(id, { logLimit: 200 });
    if (got.outcome !== 'success') return got;
    const { issue } = got;
    const agent = issue.agent;
    if (!AGENTS[agent]) return { outcome: 'no_op', message: 'The issue has no agent that works in sessions.', issue };
    if (finished(issue)) return { outcome: 'no_op', message: `A ${issue.status} issue does not start a session.`, issue };
    if (issue.session) return { outcome: 'no_op', message: 'The issue has a session already.', issue };

    const said = { ...accessOf(issue), ...options };
    const access = said.access ?? 'read-only';
    let cwd;
    try { cwd = said.cwd ?? issue.project?.path ?? await defaultCwd?.(); } catch (error) { return refuse(issue, error.message); }
    if (!cwd) return refuse(issue, '这个 issue 没有项目目录');
    let original = null;
    try { original = (await material?.(issue)) ?? null; } catch { /* the first message goes without it */ }

    const text = firstMessage({ issue, log: [...got.log].reverse(), access, material: original });
    const started = await agentSessions.start({ issue, agent, firstMessage: text, cwd, access, model: said.model });
    if (started.outcome !== 'success') return refuse(issue, started.message, started);

    // Another agent, a session of its own or Done may have come while it started: then this one is not wanted.
    const again = issues.get(id, { logLimit: 1 });
    if (again.outcome !== 'success' || again.issue.agent !== agent || again.issue.session || finished(again.issue)) {
      await agentSessions.close(started.key, { stop: true });
      return { outcome: 'no_op', message: 'The issue changed while its session started.', ...(again.issue ? { issue: again.issue } : {}) };
    }
    bySession.set(started.key, id);
    const bound = issues.update(id, { session: started.key, status: 'in_progress', ask: '' }, { actor: 'dudu' });
    note(id, WORDS.started(AGENTS[agent]), { key: started.key, agent, provider: started.provider, model: started.model, access, cwd });
    closeOthers(id, started.key);
    const heard = early.get(started.key);
    if (heard) { early.delete(started.key); await reflect(id, started.key, heard); }
    return { outcome: 'success', key: started.key, issue: bound.issue ?? again.issue };
  }

  // The sessions an issue had before are put away: it has one session at a time (3.3).
  function closeOthers(id, keep) {
    for (const [key, owner] of [...bySession]) {
      if (owner !== id || key === keep) continue;
      bySession.delete(key);
      guard('A session could not be closed', async () => {
        const result = await agentSessions.close(key, { stop: true });
        if (result.outcome === 'success') note(id, WORDS.closed, { key });
      });
    }
  }

  const start = (issue, options = {}) => serialized(issue.id, () => begin(issue.id, options));

  async function onAssign(issue) {
    if (!issue) return;
    if (!AGENTS[issue.agent]) { closeOthers(issue.id, null); return; } // the agent was taken away: its session goes with it
    const work = guard('A session could not be started', () => start(issue));
    // The page waits for this answer; a DSH that is slow to start a session does not hold it for long, the start goes on.
    await Promise.race([work, sleep(waitMs, undefined, { ref: false })]);
  }

  async function onReply(issue, text) {
    const key = issue?.session;
    if (!key) return; // nothing to hand it to: it is in the log, which is what the owner asked for
    const sent = await agentSessions.send(key, text);
    if (sent.outcome !== 'success') {
      issues.update(issue.id, { ask: WORDS.notDelivered(sent.message) }, { actor: 'dudu' });
      return;
    }
    if (sent.resumed) note(issue.id, WORDS.resumed, { key }); // it had been folded away in the sidebar
  }

  async function onResume(issue) {
    if (!issue?.session) return { outcome: 'no_op', message: 'The issue has no session.', next: 'Give the issue an agent first.' };
    const result = await agentSessions.resume(issue.session);
    // The page may open a session without saying which issue holds it; the issue is the one that was given this session.
    const id = issue.id ?? bySession.get(issue.session);
    if (result.outcome === 'success' && id != null) note(id, WORDS.resumed, { key: issue.session });
    return result;
  }

  async function closeFor(issue) {
    const key = issue?.session;
    if (!key || !agentSessions.has(key)) return { outcome: 'no_op', message: 'The issue has no session to close.' };
    const result = await agentSessions.close(key);
    if (result.outcome === 'success') note(issue.id, WORDS.closed, { key });
    return result;
  }

  // The issues that are open and have a session of DSH's: followed again, with the state DSH stored of it as the baseline.
  async function restore() {
    let followed = 0;
    for (const tab of ['active', 'backlog']) {
      let cursor;
      do {
        const page = issues.list({ tab, limit: 200, ...(cursor ? { cursor } : {}) });
        if (page.outcome !== 'success') break;
        for (const issue of page.items) {
          if (!AGENTS[issue.agent] || !/^dsh:./.test(issue.session ?? '')) continue;
          bySession.set(issue.session, issue.id);
          await agentSessions.adopt(issue.session, { agent: issue.agent, cwd: issue.project?.path ?? null });
          followed++;
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    return followed;
  }

  return {
    sessionState: (key) => agentSessions.stateOf(key),
    onAssign, onReply, onResume, start, closeFor, restore,
    dispose() { unsubscribe(); bySession.clear(); early.clear(); },
  };
}
