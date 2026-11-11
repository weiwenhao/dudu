import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createIssues, SchemaTooNew, STATUSES } from '../host/assistant/issues/index.mjs';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;

// A store in its own temp directory with a clock the test moves and session states it sets.
function store(options: any = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-issues-'));
  const file = join(dir, 'state', 'issues.db');
  const clock = { now: T0 };
  const states = new Map<string, string>();
  const issues = createIssues({ file, now: () => clock.now, sessionState: (key: string) => states.get(key) ?? null, ...options });
  const opened: any[] = [issues];
  const ok = (result: any) => {
    assert.equal(result.outcome, 'success', JSON.stringify(result));
    clock.now += 1000;
    return result;
  };
  return {
    issues, file, dir, clock, states, ok,
    add: (fields: any, meta?: any) => ok(issues.add(fields.agent && fields.project === undefined ? { ...fields, project: { name: 'work', path: '/work' } } : fields, meta)).issue,
    open: (extra: any = {}) => {
      const other = createIssues({ file, now: () => clock.now, ...extra });
      opened.push(other);
      return other;
    },
    cleanup: () => {
      for (const each of opened) each.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const ids = (result: any) => result.items.map((item: any) => item.id);
const sorted = (list: number[]) => [...list].sort((a, b) => a - b);

function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- adding and ids

test('add creates an issue with the documented defaults', (t) => {
  const s = store();
  t.after(s.cleanup);
  const result = s.issues.add({ title: '  回复供应商合同的修改意见  ' });
  assert.equal(result.outcome, 'success');
  assert.equal(typeof result.eventId, 'number');
  assert.deepEqual(result.issue, {
    id: 1, ref: null, title: '回复供应商合同的修改意见', brief: '', status: 'todo', statusType: 'todo', agentState: 'unassigned', labels: [], parent: null, ask: '', priority: 'none',
    impact: null, effort: null, kind: '', project: null, dueAt: null, snoozeUntil: null, agent: null, session: null, outcome: null,
    source: 'owner', sourceRef: '', resolvedAt: null, createdAt: T0, updatedAt: T0,
  });
});

test('add rejects wrong input with needs_clarification and creates nothing', (t) => {
  const s = store();
  t.after(s.cleanup);
  const cases: [any, string][] = [
    [{}, 'title'], [{ title: '   ' }, 'title'], [{ title: 'x'.repeat(301) }, 'title'], [{ title: 5 }, 'title'],
    [{ title: 'x', status: 'weird' }, 'status'], [{ title: 'x', priority: 'p0' }, 'priority'], [{ title: 'x', impact: 4 }, 'impact'],
    [{ title: 'x', impact: 1.5 }, 'impact'], [{ title: 'x', effort: 'xl' }, 'effort'], [{ title: 'x', dueAt: -1 }, 'dueAt'],
    [{ title: 'x', dueAt: 1.5 }, 'dueAt'], [{ title: 'x', dueAt: 'tomorrow' }, 'dueAt'], [{ title: 'x', source: 'moon' }, 'source'],
    [{ title: 'x', project: 'docs' }, 'project'], [{ title: 'x', project: { path: '/p' } }, 'project name'], [{ title: 'x', colour: 'red' }, 'colour'],
    [{ title: 'x', id: 7 }, 'id'], [{ title: 'x', resolvedAt: 1 }, 'resolvedAt'], [null, 'title'], ['text', 'object'], [[], 'object'],
  ];
  for (const [input, mentions] of cases) {
    const result = s.issues.add(input);
    assert.equal(result.outcome, 'needs_clarification', JSON.stringify(input));
    assert.match(result.message, new RegExp(mentions), JSON.stringify(input));
    assert.ok(result.next, JSON.stringify(input));
  }
  assert.equal(s.issues.counts().total, 0);
});

test('internal ids are available before project assignment and never reused', (t) => {
  const s = store();
  t.after(s.cleanup);
  assert.deepEqual([s.add({ title: 'a' }).ref, s.add({ title: 'b' }).ref, s.add({ title: 'c' }).ref], [null, null, null]);
  for (const spelling of [2, '2', '#2', ' 2 ']) assert.equal(s.issues.get(spelling).issue.id, 2, String(spelling));
  for (const bad of ['', 'DUDU-', 'DUDU-0', '2.5', -1, 0, null, undefined, {}, 'DUDU-2; DROP']) {
    assert.equal(s.issues.get(bad).outcome, 'needs_clarification', String(bad));
  }
  const missing = s.issues.get(99);
  assert.equal(missing.outcome, 'error');
  assert.match(missing.message, /99/);
  // A rejected add takes no id, and the id of a row deleted afterwards (the forget path) is never handed out again.
  assert.equal(s.issues.add({ title: '' }).outcome, 'needs_clarification');
  const raw = new DatabaseSync(s.file);
  t.after(() => raw.close());
  assert.throws(() => raw.exec("INSERT INTO issues (title, status, created_at, updated_at) VALUES ('x', 'nonsense', 1, 1)"), /CHECK/);
  raw.exec('DELETE FROM issues WHERE id = 3');
  assert.equal(s.add({ title: 'd' }).id, 4);
});

// --- lists: tabs, order, paging

test('tabs: active is todo, in progress and in review; backlog is backlog; all adds the finished, newest first', (t) => {
  const s = store();
  t.after(s.cleanup);
  s.add({ title: 'a todo' });
  s.add({ title: 'b progress', status: 'in_progress' });
  s.add({ title: 'c review', status: 'in_review', ask: 'Done?' });
  s.add({ title: 'd backlog', status: 'backlog' });
  const e = s.add({ title: 'e done' });
  s.ok(s.issues.complete(e.id, { outcome: 'ok' }));
  const f = s.add({ title: 'f canceled' });
  s.ok(s.issues.cancel(f.id, { reason: 'duplicate' }));

  const active = s.issues.list({});
  assert.equal(active.outcome, 'success');
  assert.deepEqual(ids(active), [1, 2, 3]);
  assert.deepEqual(ids(s.issues.list({ tab: 'active' })), [1, 2, 3]);
  assert.deepEqual(ids(s.issues.list({ tab: 'backlog' })), [4]);
  // Finished issues come last, by when they were resolved, newest first.
  assert.deepEqual(ids(s.issues.list({ tab: 'all' })), [1, 2, 3, 4, 6, 5]);
  assert.deepEqual(ids(s.issues.list({ tab: 'all', completedLast: false })), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([active.total, s.issues.list({ tab: 'backlog' }).total, s.issues.list({ tab: 'all' }).total], [3, 1, 6]);
  assert.deepEqual(active.counts, { status: { todo: 1, in_progress: 1, in_review: 1 }, priority: { none: 3 } });
  assert.deepEqual(s.issues.list({ tab: 'all' }).counts.status, { todo: 1, in_progress: 1, in_review: 1, backlog: 1, done: 1, canceled: 1 });
  assert.equal(active.nextCursor, null);
});

test('cursor paging walks every row once, in the same order as one big page', (t) => {
  const s = store();
  t.after(s.cleanup);
  const priorities = ['none', 'urgent', 'high', 'medium', 'low'];
  for (let i = 0; i < 120; i++) {
    s.add({ title: `issue ${i}`, priority: priorities[i % 5], dueAt: i % 3 === 0 ? null : T0 + (((i * 7) % 11) - 5) * DAY, status: i % 4 === 0 ? 'in_progress' : 'todo' });
  }
  const views: any[] = [{}, { order: 'due' }, { order: 'status' }, { order: 'updated' }, { order: 'created', reverse: true }, { reverse: true }];
  for (const view of views) {
    const whole = s.issues.list({ ...view, limit: 200 });
    assert.equal(whole.items.length, 120);
    assert.equal(whole.nextCursor, null);
    const walked: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: any = s.issues.list({ ...view, limit: 25, cursor });
      assert.equal(page.outcome, 'success', JSON.stringify(view));
      assert.equal(page.total, 120);
      walked.push(...ids(page));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    assert.equal(pages, 5, JSON.stringify(view));
    assert.deepEqual(walked, ids(whole), JSON.stringify(view));
  }
});

// --- filters and facet counts

function filterWorld(s: any) {
  s.states.set('claude:1', 'running');
  s.states.set('codex:1', 'error');
  s.add({ title: 'a', priority: 'high', project: { name: 'docs', path: '/w/docs' }, agent: 'claude', session: 'claude:1', source: 'connector', dueAt: T0 + DAY }); // 1
  s.add({ title: 'b', status: 'in_progress', priority: 'urgent', project: { name: 'infra', path: '/w/infra' }, agent: 'codex', session: 'codex:1', source: 'dudu', dueAt: T0 - DAY }); // 2
  s.add({ title: 'c', status: 'in_review', priority: 'medium', ask: 'Ship it?' }); // 3
  s.add({ title: 'd', status: 'backlog', priority: 'low', project: { name: 'docs', path: '/w/docs' }, source: 'session' }); // 4
  const e = s.add({ title: 'e', project: { name: 'docs', path: '/w/docs' }, agent: 'claude' }); // 5, done at T0 + 5000
  s.ok(s.issues.complete(e.id, { outcome: 'shipped' }));
  s.add({ title: 'f 合同', priority: 'high' }); // 6
}

test('every filter narrows the list, and the total follows', (t) => {
  const s = store();
  t.after(s.cleanup);
  filterWorld(s);
  const expectations: [any, number[]][] = [
    [{ status: ['todo', 'backlog'] }, [1, 4, 6]],
    [{ priority: ['urgent', 'high'] }, [1, 2, 6]],
    [{ project: ['docs'] }, [1, 4, 5]],
    [{ project: [null] }, [3, 6]],
    [{ project: ['infra', null] }, [2, 3, 6]],
    [{ agent: ['claude'] }, [1, 5]],
    [{ agent: [null] }, [3, 4, 6]],
    [{ agent: ['codex', null] }, [2, 3, 4, 6]],
    [{ agentState: ['working'] }, [1]],
    [{ agentState: ['blocked'] }, [2]],
    [{ agentState: ['idle'] }, [5]],
    [{ agentState: ['unassigned'] }, [3, 4, 6]],
    [{ agentState: ['working', 'blocked'] }, [1, 2]],
    [{ hasQuestion: true }, [3]],
    [{ hasQuestion: false }, [1, 2, 4, 5, 6]],
    [{ source: ['connector'] }, [1]],
    [{ source: ['dudu', 'session'] }, [2, 4]],
    [{ source: ['owner'] }, [3, 5, 6]],
    [{ dueFrom: T0 }, [1]],
    [{ dueTo: T0 }, [2]],
    [{ dueFrom: T0 - 2 * DAY, dueTo: T0 + 2 * DAY }, [1, 2]],
    [{ createdFrom: T0 + 2000 }, [3, 4, 5, 6]],
    [{ createdTo: T0 + 1000 }, [1, 2]],
    [{ createdFrom: T0 + 1000, createdTo: T0 + 3000 }, [2, 3, 4]],
    [{ updatedFrom: T0 + 5000 }, [5, 6]],
    [{ updatedTo: T0 + 1000 }, [1, 2]],
    [{ q: '合同' }, [6]],
    [{ q: 'shipped' }, [5]],
    [{ status: ['todo'], project: ['docs'] }, [1]],
    [{ priority: ['high'], agent: ['claude'] }, [1]],
    [{ project: ['docs'], source: ['session'], q: 'd' }, [4]],
    [{ status: [], project: [] }, [1, 2, 3, 4, 5, 6]],
  ];
  for (const [filter, expected] of expectations) {
    const result = s.issues.list({ tab: 'all', completedLast: false, filter });
    assert.equal(result.outcome, 'success', JSON.stringify(filter));
    assert.deepEqual(sorted(ids(result)), expected, JSON.stringify(filter));
    assert.equal(result.total, expected.length, JSON.stringify(filter));
  }
  // The tabs still apply on top of a filter.
  assert.deepEqual(sorted(ids(s.issues.list({ filter: { project: ['docs'] } }))), [1]);
  assert.deepEqual(sorted(ids(s.issues.list({ tab: 'backlog', filter: { project: ['docs'] } }))), [4]);
});

// --- grouping

function groupWorld(s: any) {
  s.states.set('claude:9', 'running');
  s.states.set('codex:9', 'error');
  s.add({ title: 'p1', priority: 'high', project: { name: 'docs', path: '/w/docs' }, agent: 'claude' }); // 1 todo
  s.add({ title: 'p2', status: 'in_progress', priority: 'urgent', project: { name: 'docs', path: '/w/docs' }, agent: 'claude', session: 'claude:9' }); // 2
  s.add({ title: 'p3', priority: 'low', project: { name: 'docs', path: '/w/docs' }, agent: 'codex', session: 'codex:9' }); // 3
  s.add({ title: 'p4', priority: 'medium', project: { name: 'infra', path: '/w/infra' }, agent: 'codex' }); // 4
  s.add({ title: 'p5', status: 'in_review', priority: 'medium', project: { name: 'infra', path: '/w/infra' }, ask: 'Merge?' }); // 5
  s.add({ title: 'p6' }); // 6 todo, no project, no agent
}

test('grouping by status, priority, agent and agent state, in their fixed orders', (t) => {
  const s = store();
  t.after(s.cleanup);
  groupWorld(s);
  s.add({ title: 'later', status: 'backlog' }); // 7
  const done = s.add({ title: 'finished' }); // 8
  s.ok(s.issues.complete(done.id, {}));
  const summary = (group: string, tab = 'active') => s.issues.list({ tab, group }).groups.map((g: any) => [g.key, g.count, ids(g)]);

  assert.deepEqual(summary('status'), [['in_progress', 1, [2]], ['in_review', 1, [5]], ['todo', 4, [1, 4, 3, 6]]]);
  assert.deepEqual(summary('status', 'all'), [['in_progress', 1, [2]], ['in_review', 1, [5]], ['todo', 4, [1, 4, 3, 6]], ['backlog', 1, [7]], ['done', 1, [8]]]);
  assert.deepEqual(summary('priority'), [['urgent', 1, [2]], ['high', 1, [1]], ['medium', 2, [4, 5]], ['low', 1, [3]], ['none', 1, [6]]]);
  assert.deepEqual(summary('agent'), [['claude', 2, [2, 1]], ['codex', 2, [4, 3]], [null, 2, [5, 6]]]);
  // Review questions do not make an idle worker blocked.
  assert.deepEqual(summary('agentState'), [['blocked', 1, [3]], ['working', 1, [2]], ['idle', 2, [1, 4]], ['unassigned', 2, [5, 6]]]);
  s.states.set('codex:finished', 'finished');
  s.add({ title: 'turn finished', agent: 'codex', session: 'codex:finished' }); // 9, workflow still Todo
  assert.deepEqual(summary('agentState'), [['blocked', 2, [3, 9]], ['working', 1, [2]], ['idle', 2, [1, 4]], ['unassigned', 2, [5, 6]]], 'a finished turn is the boss\'s turn, as a question is');
  const nested = s.issues.list({ group: 'status', subGroup: 'agentState' }).groups.find((group: any) => group.key === 'todo');
  assert.deepEqual(nested.groups.map((group: any) => group.key), ['blocked', 'idle', 'unassigned']);
});

// --- agent state and snooze

test('the agent lifecycle follows its session independently of review questions and reminder snoozes', (t) => {
  const s = store();
  t.after(s.cleanup);
  const state = (fields: any) => s.add({ title: 'x', ...fields }).agentState;
  assert.equal(state({}), 'unassigned', 'no agent: unassigned, the state an issue starts in');
  assert.equal(state({ ask: 'Which one?' }), 'unassigned');
  assert.equal(state({ ask: 'Which one?', status: 'in_review' }), 'unassigned');
  assert.equal(state({ ask: 'Which one?', snoozeUntil: T0 + DAY }), 'unassigned');
  assert.equal(state({ ask: 'Which one?', snoozeUntil: T0 - DAY }), 'unassigned');

  for (const [session, agentState] of [['running', 'working'], ['waiting_owner', 'blocked'], ['error', 'blocked'], ['idle', 'idle'], ['finished', 'blocked'], ['mystery', 'idle']]) {
    s.states.set(`claude:${session}`, session);
    assert.equal(state({ agent: 'claude', session: `claude:${session}` }), agentState, session);
  }
  assert.equal(state({ agent: 'claude', session: 'claude:unknown' }), 'idle');
  // Questions and snoozes affect review and reminders, never the worker lifecycle.
  assert.equal(state({ agent: 'claude', ask: 'Which one?', session: 'claude:running' }), 'working');
  assert.equal(state({ agent: 'claude', ask: 'Which one?', snoozeUntil: T0 + DAY, session: 'claude:running' }), 'working');
  assert.equal(state({ agent: 'claude', ask: 'Which one?', snoozeUntil: T0 + DAY, session: 'claude:waiting_owner' }), 'blocked');
  assert.equal(state({ agent: 'claude', snoozeUntil: T0 + DAY, session: 'claude:waiting_owner' }), 'blocked');
  // The state is read when asked: the session changing is seen without touching the issue.
  const watched = s.add({ title: 'watched', agent: 'claude', session: 'claude:live' });
  assert.equal(s.issues.get(watched.id).issue.agentState, 'idle');
  s.states.set('claude:live', 'running');
  assert.equal(s.issues.get(watched.id).issue.agentState, 'working');
  assert.equal(s.issues.list({ filter: { agentState: ['working'] } }).items.some((item: any) => item.id === watched.id), true);
  const before = s.issues.get(watched.id).issue.updatedAt;
  for (const [session, expected] of [['waiting_owner', 'blocked'], ['finished', 'blocked'], ['idle', 'idle']]) {
    s.states.set('claude:live', session);
    const current = s.issues.get(watched.id).issue;
    assert.equal(current.agentState, expected);
    assert.equal(current.updatedAt, before, 'reading lifecycle never rewrites the issue timestamp');
    assert.ok(s.issues.list({ filter: { agentState: [expected] } }).items.some((item: any) => item.id === watched.id));
  }
});

// --- changing issues

test('status moves keep resolvedAt, the ask and the outcome consistent', (t) => {
  const s = store();
  t.after(s.cleanup);
  const raw = new DatabaseSync(s.file);
  t.after(() => raw.close());
  const issue = s.add({ title: 'x', ask: 'Sure?' });
  assert.deepEqual(pick(s.ok(s.issues.update(issue.id, { status: 'in_progress' })).issue), { status: 'in_progress', ask: 'Sure?', resolvedAt: null, outcome: null });
  assert.deepEqual(pick(s.ok(s.issues.update(issue.id, { status: 'in_review' })).issue), { status: 'in_review', ask: 'Sure?', resolvedAt: null, outcome: null });
  const doneAt = s.clock.now;
  assert.deepEqual(pick(s.ok(s.issues.update(issue.id, { status: 'done' })).issue), { status: 'done', ask: '', resolvedAt: doneAt, outcome: null });
  // Reopening clears resolvedAt and the result that belonged to the old status.
  s.ok(s.issues.update(issue.id, { status: 'todo' }));
  s.ok(s.issues.complete(issue.id, { outcome: 'Shipped' }));
  assert.equal(s.issues.get(issue.id).issue.outcome, 'Shipped');
  assert.deepEqual(pick(s.ok(s.issues.update(issue.id, { status: 'in_progress' })).issue), { status: 'in_progress', ask: '', resolvedAt: null, outcome: null });
  // Between the finished statuses the resolution time is the latest one, and a new outcome replaces the old.
  s.ok(s.issues.complete(issue.id, { outcome: 'Shipped' }));
  const canceledAt = s.clock.now;
  assert.deepEqual(pick(s.ok(s.issues.update(issue.id, { status: 'canceled', outcome: 'Not needed' })).issue), { status: 'canceled', ask: '', resolvedAt: canceledAt, outcome: 'Not needed' });
  assert.equal(s.ok(s.issues.update(issue.id, { status: 'done' })).issue.outcome, null);
  // Finishing clears an ask given in the same patch; a finished issue cannot be given one.
  assert.equal(s.add({ title: 'y' }).id, 2);
  assert.equal(s.ok(s.issues.update(2, { status: 'done', ask: 'hm?' })).issue.ask, '');
  const refused = s.issues.update(2, { ask: 'still there?' });
  assert.equal(refused.outcome, 'needs_clarification');
  assert.match(refused.message, /ask/);
  // The database itself agrees: a finished status and a resolution time always come together.
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM issues WHERE (status IN ('done','canceled')) != (resolved_at IS NOT NULL)").get() as any).n, 0);
});

function pick(issue: any) {
  return { status: issue.status, ask: issue.ask, resolvedAt: issue.resolvedAt, outcome: issue.outcome };
}

test('the owner can finish without a word; dudu and agents must say what came of it', (t) => {
  const s = store();
  t.after(s.cleanup);
  const owner = s.add({ title: 'owner' });
  assert.equal(s.ok(s.issues.complete(owner.id)).issue.outcome, null);
  assert.equal(s.issues.complete(owner.id).outcome, 'no_op');

  const other = s.add({ title: 'other' });
  for (const actor of ['dudu', 'claude:abc']) {
    const refused = s.issues.complete(other.id, { actor });
    assert.equal(refused.outcome, 'needs_clarification', actor);
    assert.match(refused.message, /outcome/);
    assert.ok(refused.next);
    assert.equal(s.issues.complete(other.id, { actor, outcome: '   ' }).outcome, 'needs_clarification');
  }
  assert.equal(s.issues.get(other.id).issue.status, 'todo');
  const done = s.ok(s.issues.complete(other.id, { actor: 'dudu', outcome: 'Reply sent to the supplier' })).issue;
  assert.deepEqual([done.status, done.outcome], ['done', 'Reply sent to the supplier']);

  const spare = s.add({ title: 'spare' });
  assert.equal(s.ok(s.issues.cancel(spare.id)).issue.status, 'canceled');
  const dup = s.add({ title: 'dup' });
  assert.equal(s.issues.cancel(dup.id, { actor: 'dudu' }).outcome, 'needs_clarification');
  const canceled = s.ok(s.issues.cancel(dup.id, { actor: 'dudu', reason: 'Same as DUDU-1' })).issue;
  assert.deepEqual([canceled.status, canceled.outcome, canceled.resolvedAt === null], ['canceled', 'Same as DUDU-1', false]);
  const { events } = s.issues.events({ issueId: dup.id });
  assert.deepEqual([events[0].action, events[0].reason, events[0].actor], ['cancel', 'Same as DUDU-1', 'dudu']);
});

test('update edits any field, says no_op when nothing changed, and refuses what it does not know', (t) => {
  const s = store();
  t.after(s.cleanup);
  const issue = s.add({ title: 'old title', project: { name: 'docs', path: '/w/docs' }, impact: 2, effort: 's' });
  const edited = s.ok(s.issues.update(issue.id, {
    title: ' new title ', brief: 'summary', ask: 'q?', priority: 'urgent', impact: null, effort: 'l', kind: 'ops', project: { name: 'infra', path: '/work/infra' },
    dueAt: T0 + DAY, snoozeUntil: T0 + 2 * DAY, agent: 'codex', session: 'codex:1', outcome: 'maybe', source: 'dudu', sourceRef: 'x',
  })).issue;
  assert.deepEqual(edited, {
    id: 1, ref: 'INF-1', title: 'new title', brief: 'summary', status: 'todo', statusType: 'todo', agentState: 'idle', labels: [], parent: null, ask: 'q?', priority: 'urgent', impact: null, effort: 'l',
    kind: 'ops', project: { name: 'infra', path: '/work/infra' }, dueAt: T0 + DAY, snoozeUntil: T0 + 2 * DAY, agent: 'codex', session: 'codex:1', outcome: 'maybe',
    source: 'dudu', sourceRef: 'x', resolvedAt: null, createdAt: T0, updatedAt: T0 + 1000,
  });
  const cleared = s.ok(s.issues.update(issue.id, { dueAt: null, snoozeUntil: null, outcome: '', effort: null })).issue;
  assert.deepEqual([cleared.project, cleared.dueAt, cleared.agent, cleared.session, cleared.outcome, cleared.effort], [{ name: 'infra', path: '/work/infra' }, null, 'codex', 'codex:1', null, null]);

  const same = s.issues.update(issue.id, { title: 'new title', priority: 'urgent' });
  assert.equal(same.outcome, 'no_op');
  assert.equal(same.issue.updatedAt, s.issues.get(issue.id).issue.updatedAt);
  assert.equal(s.issues.update(issue.id, {}).outcome, 'no_op');
  assert.equal(s.issues.update(issue.id, null).outcome, 'no_op');
  for (const [patch, mentions] of [[{ colour: 'red' }, 'colour'], [{ id: 5 }, 'id'], [{ createdAt: 1 }, 'createdAt'], [{ resolvedAt: 1 }, 'resolvedAt'], [{ agentState: 'nonsense' }, 'agentState'],
    [{ title: '' }, 'title'], [{ status: 'finished' }, 'status'], [{ priority: 3 }, 'priority'], [{ impact: 0 }, 'impact'], [{ dueAt: 'soon' }, 'dueAt'], ['status', 'object']] as [any, string][]) {
    const result = s.issues.update(issue.id, patch);
    assert.equal(result.outcome, 'needs_clarification', JSON.stringify(patch));
    assert.match(result.message, new RegExp(mentions));
  }
  assert.equal(s.issues.get(issue.id).issue.updatedAt, T0 + 2000);
  assert.equal(s.issues.update('nope', { kind: 'x' }).outcome, 'needs_clarification');
  assert.equal(s.issues.update(404, { kind: 'x' }).outcome, 'error');
});

test('assign links an agent and a session, remembers every session, and closes the one it replaces', (t) => {
  const s = store();
  t.after(s.cleanup);
  const issue = s.add({ title: 'x', project: { name: 'work', path: '/work' } });
  s.states.set('claude:s1', 'running');
  const first = s.ok(s.issues.assign(issue.id, { agent: 'claude', session: 'claude:s1', reason: 'Best for contracts', actor: 'dudu' }));
  assert.deepEqual([first.issue.agent, first.issue.session, first.issue.agentState], ['claude', 'claude:s1', 'working']);
  assert.equal(s.issues.assign(issue.id, { agent: 'claude', session: 'claude:s1' }).outcome, 'no_op');

  const opened = s.clock.now;
  assert.equal(s.issues.assign(issue.id, { agent: 'codex', session: 'codex:s2' }).outcome, 'needs_clarification');
  s.ok(s.issues.assign(issue.id, { agent: 'claude', session: 'claude:s2' }));
  const { sessions } = s.issues.get(issue.id).issue;
  assert.deepEqual(sessions.map((session: any) => [session.key, session.agent, session.open, session.closeReason, session.state]), [
    ['claude:s2', 'claude', true, null, null],
    ['claude:s1', 'claude', false, 'switch', 'running'],
  ]);
  assert.equal(sessions[1].closedAt, opened);
  assert.equal(sessions[0].openedAt, opened);

  assert.equal(s.issues.assign(issue.id, { agent: 'claude' }).outcome, 'no_op');
  s.ok(s.issues.update(issue.id, { session: null }));
  assert.equal(s.issues.get(issue.id).issue.session, null);
  assert.ok(s.issues.get(issue.id).issue.sessions.every((session: any) => !session.open));
  assert.equal(s.issues.assign(issue.id, { agent: null }).outcome, 'needs_clarification');
  assert.equal(s.issues.get(issue.id).issue.agent, 'claude');
  // Resuming a closed session opens it again as a new entry.
  s.ok(s.issues.assign(issue.id, { agent: 'claude', session: 'claude:s1' }));
  assert.deepEqual(s.issues.get(issue.id).issue.sessions.map((session: any) => [session.key, session.open]), [['claude:s1', true], ['claude:s2', false], ['claude:s1', false]]);

  assert.equal(s.issues.assign(issue.id, {}).outcome, 'needs_clarification');
  assert.equal(s.issues.assign(issue.id, { agent: '' , session: 5 }).outcome, 'needs_clarification');
  assert.equal(s.issues.assign(404, { agent: 'claude' }).outcome, 'error');
  const log = s.issues.get(issue.id).log.filter((entry: any) => entry.kind === 'assign');
  assert.deepEqual([log.at(-1).actor, log.at(-1).text, log.at(-1).data], ['dudu', 'Best for contracts', { agent: 'claude', session: 'claude:s1' }]);
});

// --- events and undo

test('every change leaves an event: who, what was before and after, why, and which batch', (t) => {
  const s = store();
  t.after(s.cleanup);
  const x = s.add({ title: 'x' });
  s.add({ title: 'y' });
  const changed = s.ok(s.issues.update(x.id, { priority: 'high', dueAt: T0 + DAY }, { actor: 'dudu', reason: 'Due Friday per the email', groupId: 'tidy-1' }));
  const { events } = s.issues.events({ issueId: '#1' });
  assert.deepEqual(events, [
    { id: changed.eventId, at: T0 + 2000, actor: 'dudu', action: 'update', issueId: 1, before: { priority: 'none', dueAt: null }, after: { priority: 'high', dueAt: T0 + DAY }, reason: 'Due Friday per the email', groupId: 'tidy-1', undoes: null, undoneBy: null },
    { id: 1, at: T0, actor: 'owner', action: 'add', issueId: 1, before: null, after: null, reason: '', groupId: null, undoes: null, undoneBy: null },
  ]);
  assert.equal(s.issues.events({}).events.length, 3);
  // Newest first, paged by cursor.
  for (let i = 0; i < 5; i++) s.ok(s.issues.update(x.id, { kind: `k${i}` }));
  const walked: number[] = [];
  let cursor: number | null = null;
  do {
    const page: any = s.issues.events({ limit: 3, cursor });
    walked.push(...page.events.map((event: any) => event.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(walked, [8, 7, 6, 5, 4, 3, 2, 1]);
  for (const bad of [{ limit: 0 }, { limit: 501 }, { cursor: 'x' }, { issueId: 'nope' }]) assert.equal(s.issues.events(bad).outcome, 'needs_clarification', JSON.stringify(bad));
  assert.equal(s.issues.events(null).outcome, 'success');
});

test('undo puts back status, resolvedAt, ask and outcome, and says so in its own event', (t) => {
  const s = store();
  t.after(s.cleanup);
  const x = s.add({ title: 'x', status: 'in_review', ask: 'Confirm?' });
  const done = s.ok(s.issues.complete(x.id, { outcome: 'Confirmed' }));
  assert.deepEqual(pick(done.issue), { status: 'done', ask: '', resolvedAt: T0 + 1000, outcome: 'Confirmed' });
  const undone = s.ok(s.issues.undo(done.eventId));
  assert.deepEqual(pick(undone.issue), { status: 'in_review', ask: 'Confirm?', resolvedAt: null, outcome: null });
  assert.deepEqual([undone.skipped, undone.kept], [[], []]);
  const { events } = s.issues.events({ issueId: x.id });
  assert.deepEqual([events[0].action, events[0].undoes, events[1].undoneBy], ['undo', done.eventId, events[0].id]);
  assert.deepEqual(events[0].after, { status: 'in_review', ask: 'Confirm?', resolvedAt: null, outcome: null });
  // The restored question and the status move are both on the log again, the question last.
  assert.deepEqual(s.issues.get(x.id).log.slice(0, 2).map((entry: any) => [entry.kind, entry.text, entry.data]), [
    ['blocked', 'Confirm?', null],
    ['status', '', { from: 'done', to: 'in_review' }],
  ]);
  assert.equal(s.issues.undo(done.eventId).outcome, 'needs_clarification');
});

test('undo never overwrites a later edit: untouched fields come back, the rest are kept and reported', (t) => {
  const s = store();
  t.after(s.cleanup);
  const x = s.add({ title: 'x' });
  const raised = s.ok(s.issues.update(x.id, { priority: 'high' }));
  s.ok(s.issues.update(x.id, { priority: 'low' }));
  const refused = s.issues.undo(raised.eventId);
  assert.equal(refused.outcome, 'no_op');
  assert.deepEqual(refused.skipped, [{ eventId: raised.eventId, issueId: 1, reason: 'it was changed again since' }]);
  assert.equal(s.issues.get(x.id).issue.priority, 'low');

  const both = s.ok(s.issues.update(x.id, { priority: 'urgent', kind: 'ops' }));
  s.ok(s.issues.update(x.id, { kind: 'finance' }));
  const partial = s.ok(s.issues.undo(both.eventId));
  assert.deepEqual([partial.issue.priority, partial.issue.kind], ['low', 'finance']);
  assert.deepEqual(partial.kept, [{ eventId: both.eventId, issueId: 1, fields: ['kind'] }]);
});

// --- search

test('search finds Chinese words, Latin prefixes, briefs and outcomes, best match first', (t) => {
  const s = store();
  t.after(s.cleanup);
  s.add({ title: '回复供应商合同的修改意见' }); // 1
  s.add({ title: '劳务合同审核' }); // 2
  s.add({ title: 'Renew the server certificate', brief: 'It expires next week' }); // 3
  const receipts = s.add({ title: '整理发票' }); // 4
  s.ok(s.issues.complete(receipts.id, { outcome: '已报销' }));
  s.add({ title: '合同', brief: '供应商 asked for changes' }); // 5
  s.add({ title: 'alpha report' }); // 6
  s.add({ title: 'weekly note', brief: 'alpha numbers inside' }); // 7
  s.add({ title: 'same words' }); // 8
  s.add({ title: 'same words' }); // 9

  assert.deepEqual(sorted(ids(s.issues.search('合同'))), [1, 2, 5]);
  assert.equal(s.issues.search('合同').total, 3);
  assert.deepEqual(ids(s.issues.search('cert')), [3]);
  assert.deepEqual(ids(s.issues.search('CERTIFICATE')), [3]);
  assert.deepEqual(ids(s.issues.search('expires')), [3]);
  assert.deepEqual(ids(s.issues.search('报销')), [4]);
  assert.deepEqual(sorted(ids(s.issues.search('供应商'))), [1, 5]);
  assert.deepEqual(ids(s.issues.search('alpha')), [6, 7], 'a title match outranks a match in the brief');
  assert.deepEqual(ids(s.issues.search('same words')), [9, 8], 'equal matches: the more recently updated first');
  assert.deepEqual(ids(s.issues.search('server certificate')), [3]);
  assert.equal(s.issues.search('合同', { limit: 2 }).items.length, 2);
  assert.equal(s.issues.search('合同', { limit: 2 }).total, 3);
  assert.deepEqual(s.issues.search('没有这个词'), { outcome: 'success', items: [], total: 0 });
});

test('search text is only ever words: operators and punctuation do nothing', (t) => {
  const s = store();
  t.after(s.cleanup);
  s.add({ title: 'a' }); // 1
  s.add({ title: 'b' }); // 2
  s.add({ title: 'a or b' }); // 3
  s.add({ title: 'plain words' }); // 4
  assert.deepEqual(ids(s.issues.search('a" OR b*')), [3]);
  for (const hostile of ['title:plain', '-plain', '"', '"unterminated', ')(', '*', '^plain', 'a AND', 'NEAR(a b)', '{x y}', "'; DROP TABLE issues; --", 'x'.repeat(10_000)]) {
    for (const result of [s.issues.search(hostile), s.issues.list({ filter: { q: hostile } })]) {
      assert.ok(['success', 'needs_clarification'].includes(result.outcome), hostile.slice(0, 30));
    }
  }
  for (const nothing of ['', '   ', '!!!', '()*', null, undefined, 5]) assert.equal(s.issues.search(nothing).outcome, 'needs_clarification', String(nothing));
  assert.equal(s.issues.counts().total, 4);
});

// --- counters, facets, the completed-from cut

test('counts() agree with the rows after a long random run of changes, undos included', (t) => {
  const s = store();
  t.after(s.cleanup);
  const raw = new DatabaseSync(s.file);
  t.after(() => raw.close());
  const random = seeded(7);
  const pickOne = (list: any[]) => list[Math.floor(random() * list.length)];
  let created = 0;
  for (let step = 0; step < 500; step++) {
    const roll = random();
    const id = 1 + Math.floor(random() * Math.max(created, 1));
    if (roll < 0.3 || created < 5) {
      const status = pickOne(STATUSES);
      const result = s.issues.add({ title: `issue ${step}`, status, priority: pickOne(['none', 'urgent', 'high', 'medium', 'low']), project: pickOne([null, { name: 'docs', path: '/d' }, { name: 'infra', path: '/i' }]) });
      if (result.outcome === 'success') created++;
    } else if (roll < 0.5) s.issues.update(id, { status: pickOne(STATUSES) });
    else if (roll < 0.62) s.issues.update(id, { priority: pickOne(['none', 'urgent', 'high', 'medium', 'low']) });
    else if (roll < 0.72) s.issues.complete(id, { outcome: 'ok' });
    else if (roll < 0.8) s.issues.cancel(id, { reason: 'no' });
    else if (roll < 0.9) s.issues.undo();
    else s.issues.update(id, { project: pickOne([null, { name: 'docs', path: '/d' }]), agent: pickOne([null, 'claude']) });
    s.clock.now += 1000;
  }
  const byStatus = Object.fromEntries(STATUSES.map((status: string) => [status, 0]));
  const byPriority = Object.fromEntries(['none', 'urgent', 'high', 'medium', 'low'].map((priority) => [priority, 0]));
  for (const row of raw.prepare('SELECT status, priority, COUNT(*) AS n FROM issues GROUP BY status, priority').all() as any[]) {
    byStatus[row.status] += row.n;
    if (row.status !== 'done' && row.status !== 'canceled') byPriority[row.priority] += row.n;
  }
  const counts = s.issues.counts();
  assert.deepEqual(counts.byStatus, byStatus);
  assert.deepEqual(counts.byPriority, byPriority);
  assert.equal(counts.total, created);
  assert.equal(counts.active, byStatus.todo + byStatus.in_progress + byStatus.in_review);
  // The list's counts come from the same table; counting by scanning must give the same numbers.
  const fromTable = s.issues.list({ tab: 'all', limit: 200 });
  const byScan = s.issues.list({ tab: 'all', limit: 200, filter: { createdFrom: 0 } });
  assert.deepEqual(byScan.counts, fromTable.counts);
  assert.equal(byScan.total, created);
  assert.equal(fromTable.total, created);
  for (const tab of ['active', 'backlog']) {
    const viaTable = s.issues.list({ tab, limit: 200 });
    assert.deepEqual(s.issues.list({ tab, limit: 200, filter: { createdFrom: 0 } }).counts, viaTable.counts, tab);
    assert.equal(viaTable.total, viaTable.items.length, tab);
  }
});

// --- list, facets and groups against a plain model, over many random views

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low', 'none'];
const STATUS_ORDER = ['in_progress', 'in_review', 'todo', 'backlog', 'done', 'canceled'];
const AGENT_STATE_ORDER = ['blocked', 'working', 'idle', 'unassigned'];
const SOURCE_ORDER = ['owner', 'dudu', 'connector', 'session'];
const isFinishedStatus = (status: string) => status === 'done' || status === 'canceled';
const compare = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

// The documented rules, written the slow and obvious way.
const model = {
  due: (issue: any) => issue.dueAt ?? Number.MAX_SAFE_INTEGER,
  keys(order: string, issue: any): number[] {
    const priority = PRIORITY_ORDER.indexOf(issue.priority);
    const due = model.due(issue);
    switch (order) {
      case 'priority': return [priority, due, issue.id];
      case 'status': return [STATUS_ORDER.indexOf(issue.status), priority, due, issue.id];
      case 'due': return [due, priority, issue.id];
      case 'updated': return [issue.updatedAt, issue.id];
      default: return [issue.createdAt, issue.id];
    }
  },
  compareKeys(a: number[], b: number[]) {
    for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) return compare(a[n], b[n]);
    return 0;
  },
  inTab: (issue: any, tab: string) => tab === 'all' || (tab === 'active' ? ['todo', 'in_progress', 'in_review'].includes(issue.status) : issue.status === 'backlog'),
  passes(issue: any, view: any, skip?: string) {
    const f = view.filter ?? {};
    const among = (key: string, value: any) => key === skip || !f[key]?.length || f[key].includes(value);
    const within = (value: number | null, from?: number, to?: number) => (from == null && to == null) || (value !== null && (from == null || value >= from) && (to == null || value <= to));
    return model.inTab(issue, view.tab ?? 'active')
      && among('status', issue.status) && among('priority', issue.priority) && among('project', issue.project?.name ?? null) && among('agent', issue.agent)
      && among('agentState', issue.agentState) && among('source', issue.source)
      && within(issue.dueAt, f.dueFrom, f.dueTo) && within(issue.createdAt, f.createdFrom, f.createdTo) && within(issue.updatedAt, f.updatedFrom, f.updatedTo)
      && (f.completedFrom == null || !isFinishedStatus(issue.status) || issue.resolvedAt >= f.completedFrom)
      && (f.q == null || issue.title.split(' ')[1].startsWith(f.q));
  },
  ordered(issues: any[], view: any) {
    const order = view.order ?? 'priority';
    const sign = (order === 'updated' || order === 'created' ? -1 : 1) * (view.reverse ? -1 : 1);
    const byOrder = (a: any, b: any) => sign * model.compareKeys(model.keys(order, a), model.keys(order, b));
    if ((view.tab ?? 'active') === 'all' && (view.completedLast ?? true)) {
      const open = issues.filter((issue) => !isFinishedStatus(issue.status)).sort(byOrder);
      const finished = issues.filter((issue) => isFinishedStatus(issue.status)).sort((a, b) => -model.compareKeys([a.resolvedAt, a.id], [b.resolvedAt, b.id]));
      return [...open, ...finished];
    }
    return [...issues].sort(byOrder);
  },
  tally(issues: any[], pick: (issue: any) => any) {
    const counts = new Map();
    for (const issue of issues) counts.set(pick(issue), (counts.get(pick(issue)) ?? 0) + 1);
    return counts;
  },
  groupKey: (issue: any, group: string) => (group === 'project' ? issue.project?.name ?? null : issue[group]),
  groupOrder(group: string, keys: any[]) {
    const fixed: any = { status: STATUS_ORDER, priority: PRIORITY_ORDER, agentState: AGENT_STATE_ORDER };
    if (fixed[group]) return [...keys].sort((a, b) => fixed[group].indexOf(a) - fixed[group].indexOf(b));
    return [...keys].sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0) || (a ?? '').localeCompare(b ?? ''));
  },
};

test('list, counts, groups and facets agree with a plain model over many random views', (t) => {
  const s = store();
  t.after(s.cleanup);
  const random = seeded(2024);
  const pickOne = (list: any[]) => list[Math.floor(random() * list.length)];
  const subset = (list: any[], most = 3) => list.filter(() => random() < 0.4).slice(0, most);
  s.states.set('claude:run', 'running');
  s.states.set('claude:wait', 'waiting_owner');
  s.states.set('codex:err', 'error');
  s.states.set('codex:done', 'finished');
  for (let i = 0; i < 140; i++) {
    s.clock.now = T0 + Math.floor(random() * 40) * DAY + i * 1000;
    const fields: any = {
      title: `issue ${i}`, status: pickOne(['backlog', 'todo', 'todo', 'in_progress', 'in_review']), priority: pickOne(PRIORITY_ORDER),
      project: pickOne([null, { name: 'docs', path: '/d' }, { name: 'infra', path: '/i' }, { name: 'finance', path: '/f' }]),
      agent: pickOne([null, 'claude', 'codex']), source: pickOne(SOURCE_ORDER), dueAt: random() < 0.5 ? T0 + Math.floor((random() - 0.3) * 30) * DAY : null,
    };
    if (fields.status === 'in_review' && random() < 0.7) fields.ask = 'ok?';
    if (random() < 0.25) {
      fields.agent = pickOne(['claude', 'codex']);
      fields.session = pickOne(fields.agent === 'claude' ? ['claude:run', 'claude:wait', 'claude:old'] : ['codex:err', 'codex:done', 'codex:old']);
    }
    if (!fields.project) fields.agent = null;
    const issue = s.add(fields);
    if (random() < 0.4) {
      s.clock.now += Math.floor(random() * 20) * DAY;
      s.ok(random() < 0.8 ? s.issues.complete(issue.id) : s.issues.cancel(issue.id));
    }
    if (random() < 0.1) s.issues.update(issue.id, { priority: pickOne(PRIORITY_ORDER) }); // may be a no_op
  }
  const everything = s.issues.list({ tab: 'all', completedLast: false, limit: 200 }).items;
  assert.equal(everything.length, 140);
  const times = everything.flatMap((issue: any) => [issue.createdAt, issue.updatedAt, issue.dueAt, issue.resolvedAt]).filter((time: any) => time !== null);
  const someTime = () => pickOne(times);
  const seen = { nonEmpty: 0, narrowed: 0, grouped: 0, cut: 0, hidden: 0, allTab: 0, backlog: 0, mixed: 0, reversed: 0 };

  for (let n = 0; n < 150; n++) {
    const filter: any = {};
    if (random() < 0.3) filter.status = subset(STATUS_ORDER);
    if (random() < 0.3) filter.priority = subset(PRIORITY_ORDER);
    if (random() < 0.3) filter.project = subset(['docs', 'infra', null, 'ghost']);
    if (random() < 0.3) filter.agent = subset(['claude', 'codex', null]);
    if (random() < 0.3) filter.agentState = subset(AGENT_STATE_ORDER);
    if (random() < 0.3) filter.source = subset(SOURCE_ORDER);
    for (const key of ['dueFrom', 'dueTo', 'createdFrom', 'createdTo', 'updatedFrom', 'updatedTo']) if (random() < 0.12) filter[key] = someTime();
    if (random() < 0.3) filter.completedFrom = random() < 0.15 ? Number.MAX_SAFE_INTEGER : someTime();
    if (random() < 0.1) filter.q = pickOne(['1', '2', '12', '9']);
    const view: any = { tab: pickOne(['active', 'backlog', 'all']), filter, order: pickOne(['priority', 'status', 'due', 'updated', 'created']), reverse: random() < 0.3 };
    if (random() < 0.4) view.completedLast = random() < 0.5;
    const label = JSON.stringify(view);

    const expected = model.ordered(everything.filter((issue: any) => model.passes(issue, view)), view);
    seen.nonEmpty += expected.length > 0 ? 1 : 0;
    seen.narrowed += expected.length > 0 && expected.length < everything.filter((issue: any) => model.inTab(issue, view.tab)).length ? 1 : 0;
    seen.cut += filter.completedFrom !== undefined && view.tab === 'all' ? 1 : 0;
    seen.hidden += filter.completedFrom === Number.MAX_SAFE_INTEGER && view.tab === 'all' ? 1 : 0;
    seen.allTab += view.tab === 'all' ? 1 : 0;
    seen.backlog += view.tab === 'backlog' ? 1 : 0;
    seen.mixed += view.tab === 'all' && view.completedLast === false ? 1 : 0;
    seen.reversed += view.reverse ? 1 : 0;
    const whole = s.issues.list({ ...view, limit: 200 });
    assert.equal(whole.outcome, 'success', label);
    assert.deepEqual(ids(whole), expected.map((issue: any) => issue.id), label);
    assert.equal(whole.total, expected.length, label);
    for (const [facet, skip] of [['status', 'status'], ['priority', 'priority']]) {
      const counted = model.tally(everything.filter((issue: any) => model.passes(issue, view, skip)), (issue: any) => issue[facet]);
      assert.deepEqual(whole.counts[facet], Object.fromEntries(counted), `${facet} counts ${label}`);
    }
    const walked: number[] = [];
    let cursor: string | null = null;
    do {
      const page: any = s.issues.list({ ...view, limit: 17, cursor });
      walked.push(...ids(page));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(walked, expected.map((issue: any) => issue.id), `paged ${label}`);

    const facets = s.issues.facets(view).facets;
    for (const [name, pick] of [['project', (issue: any) => issue.project?.name ?? null], ['agent', (issue: any) => issue.agent], ['agentState', (issue: any) => issue.agentState], ['source', (issue: any) => issue.source]] as [string, any][]) {
      const counted = model.tally(everything.filter((issue: any) => model.passes(issue, view, name)), pick);
      for (const selected of filter[name] ?? []) if (!counted.has(selected)) counted.set(selected, 0);
      const fixed: any = { agentState: AGENT_STATE_ORDER, source: SOURCE_ORDER };
      const keys = fixed[name] ? [...counted.keys()].sort((a, b) => fixed[name].indexOf(a) - fixed[name].indexOf(b)) : model.groupOrder(name, [...counted.keys()]);
      assert.deepEqual(facets[name].map((option: any) => [option.key, option.count]), keys.map((key: any) => [key, counted.get(key)]), `facet ${name} ${label}`);
    }

    if (random() < 0.5) {
      const group = pickOne(['status', 'priority', 'project', 'agent', 'agentState']);
      const grouped = s.issues.list({ ...view, group, limit: 200 });
      const parts = model.tally(expected, (issue: any) => model.groupKey(issue, group));
      assert.deepEqual(
        grouped.groups.map((g: any) => [g.key, g.count, ids(g)]),
        model.groupOrder(group, [...parts.keys()]).map((key: any) => [key, parts.get(key), expected.filter((issue: any) => model.groupKey(issue, group) === key).map((issue: any) => issue.id)]),
        `group ${group} ${label}`,
      );
      assert.equal(grouped.total, expected.length, `group total ${label}`);
      seen.grouped++;
    }
  }
  t.diagnostic(JSON.stringify(seen));
  // The views must actually exercise the rules, or agreeing with the model would prove nothing.
  assert.ok(seen.nonEmpty >= 100 && seen.narrowed >= 60 && seen.grouped >= 50 && seen.cut >= 10 && seen.hidden >= 1 && seen.allTab >= 40 && seen.mixed >= 8 && seen.reversed >= 30, JSON.stringify(seen));
});

// --- storage: versions, export, other connections

test('opening creates the schema at the current version, in WAL mode, and keeps the data across a reopen', (t) => {
  const s = store();
  t.after(s.cleanup);
  s.add({ title: 'kept', brief: '合同' });
  s.issues.close();
  const raw = new DatabaseSync(s.file);
  t.after(() => raw.close());
  const version = (raw.prepare('PRAGMA user_version').get() as any).user_version;
  assert.ok(version >= 1);
  assert.equal((raw.prepare('PRAGMA journal_mode').get() as any).journal_mode, 'wal');
  const tables = (raw.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table') AND name NOT LIKE 'issues_fts_%' ORDER BY name").all() as any[]).map((row) => row.name);
  for (const name of ['issues', 'issue_log', 'issue_sessions', 'issue_events', 'issue_counts', 'issues_fts']) assert.ok(tables.includes(name), name);
  const again = s.open();
  assert.equal(again.get(1).issue.title, 'kept');
  assert.equal(again.export().version, version);
  assert.equal(again.search('合同').total, 1);
});

test('a file written by a newer app is refused with SchemaTooNew and left exactly as it was', (t) => {
  const s = store();
  t.after(s.cleanup);
  s.add({ title: 'from the future' });
  s.issues.close();
  const raw = new DatabaseSync(s.file);
  raw.exec('PRAGMA user_version = 99');
  raw.close();
  assert.throws(() => createIssues({ file: s.file }), (error: any) => error instanceof SchemaTooNew && error.code === 'SCHEMA_TOO_NEW' && /newer/.test(error.message) && /99/.test(error.message));
  const after = new DatabaseSync(s.file);
  t.after(() => after.close());
  assert.equal((after.prepare('PRAGMA user_version').get() as any).user_version, 99);
  assert.equal((after.prepare('SELECT COUNT(*) AS n FROM issues').get() as any).n, 1);
});

test('two connections to one file see each other and hand out distinct ids', (t) => {
  const s = store();
  t.after(s.cleanup);
  const other = s.open();
  const created: number[] = [];
  for (let i = 0; i < 6; i++) created.push((i % 2 ? other : s.issues).add({ title: `from ${i % 2 ? 'second' : 'first'} ${i}` }).issue.id);
  assert.deepEqual(created, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(sorted(ids(s.issues.list({}))), created);
  assert.deepEqual(sorted(ids(other.list({}))), created);
  s.ok(other.update(1, { priority: 'urgent' }));
  assert.equal(s.issues.get(1).issue.priority, 'urgent');
  assert.equal(other.search('second').total, 3);
  assert.equal(s.issues.search('second').total, 3);
  // The event table is shared too: one connection can undo what the other did.
  const undone = s.ok(s.issues.undo());
  assert.equal(undone.issue.priority, 'none');
  assert.equal(other.get(1).issue.priority, 'none');
  assert.deepEqual(other.counts(), s.issues.counts());
});
let big: Promise<any> | null = null;

// The 50,000-issue database is built once for the scale tests and removed after the last test of the file.
after(async () => {
  if (!big) return;
  const data = await big;
  data.issues.close();
  rmSync(data.dir, { recursive: true, force: true });
});
