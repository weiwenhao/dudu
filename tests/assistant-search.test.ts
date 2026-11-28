// The search page's one request (host/assistant/home/search.mjs): the conversations by title and by text, the collected records over the real inbox, the tasks by name, a place that fails
// without taking the others down, and the phone's method refusing a badly formed request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInboxApi, snippetOf } from '../host/assistant/inbox/api.mjs';
import { normalizeRecords } from '../host/assistant/inbox/records.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { cleanLine, createSearch, createSearchApi } from '../host/assistant/home/search.mjs';
import { createNativeBoard } from '../host/native-board.mjs';

const NOW = new Date(2026, 10, 27, 12).getTime();
const fail = (code: string) => { throw Object.assign(new Error(code), { code }); };
const entry = (n: number, title: string, extra: any = {}) => ({
  id: `issue:${n}`, title, sessionId: `s${n}`, issue: { id: n, ref: `DUDU-${n}`, title, project: { name: 'dudu', path: '/p' } }, preview: '', receivedAt: 1000 - n, sessionState: 'idle', unread: false, pinned: false, ...extra,
});
const LIST = [entry(1, 'CI runner 容量'), entry(2, '预发布环境故障'), entry(3, 'UI 设计'), { ...entry(0, '嘟嘟'), id: 'assistant', issue: undefined, sessionId: 'dudu-assistant' }];

function search(over: any = {}) {
  const asked: any = { conversations: [], inbox: [] };
  const sources = {
    conversations: async (row: any, options: any) => { asked.conversations.push(options); return { conversations: LIST.map((item) => ({ ...item, ...(item.issue ? { issue: row(item.issue) } : {}) })) }; },
    sessions: async () => ({ items: [], indexing: false }),
    inbox: (options: any) => { asked.inbox.push(options); return { outcome: 'success', total: 0, items: [] }; },
    tasks: async () => ({ outcome: 'success', tasks: [] }),
    ...over,
  };
  return { asked, search: createSearch(sources) };
}
const titles = (group: any) => group.items.map((item: any) => item.title);

test('a conversation is found by its title, its issue number or its project, and by its text, with a line of that text', async () => {
  const { search: find } = search({
    sessions: async (query: string) => ({ items: query === '预发布' ? [{ sessionId: 's3', snippet: '预发布前先把设计稿对一遍' }, { sessionId: 's2', snippet: '预发布失败了' }, { sessionId: 'gone', snippet: '预发布' }] : [], indexing: true }),
  });
  const answer: any = await find.query({ q: '预发布' });
  // The title match comes first and carries the text's line too; a text-only hit follows; a hit on a session that is no conversation of the list is left out.
  assert.deepEqual(titles(answer.sessions), ['预发布环境故障', 'UI 设计']);
  assert.equal(answer.sessions.items[0].snippet, '预发布失败了');
  assert.equal(answer.sessions.items[1].snippet, '预发布前先把设计稿对一遍');
  assert.equal(answer.sessions.total, 2);
  assert.equal(answer.sessions.indexing, true);
  assert.deepEqual(titles((await find.query({ q: 'dudu-3' })).sessions), ['UI 设计']);
  assert.equal((await find.query({ q: 'DUDU' })).sessions.total, 3, 'the project name matches too; 嘟嘟 has neither');
  assert.deepEqual(titles((await find.query({ q: '嘟嘟' })).sessions), ['嘟嘟']);
});

test('a place alone with nothing typed answers its newest rows; nothing typed and no place is a question back', async () => {
  const { search: find } = search();
  const all: any = await find.query({ scope: 'sessions', limit: 2 });
  assert.deepEqual(Object.keys(all).sort(), ['outcome', 'q', 'sessions']);
  assert.equal(all.sessions.total, 4);
  assert.equal(all.sessions.items.length, 2);
  assert.equal(all.sessions.facets, undefined, 'older clients keep the original response');
  assert.equal((await find.query({ q: '  ' })).code, 'empty_query');
  assert.equal((await find.query({ q: 'x', scope: 'files' })).outcome, 'needs_clarification');
  assert.equal((await find.query({ q: 'x'.repeat(201) })).outcome, 'needs_clarification');
});

test('desktop and phones can filter past the first 100 title and task matches, including a conversation matched by its text', async () => {
  const at = Date.now();
  const listed = Array.from({ length: 101 }, (_, index) => {
    const featured = index === 100;
    const row = entry(index + 1, featured ? 'Release checklist' : `Deploy ${index + 1}`);
    return {
      ...row, receivedAt: at - index,
      issue: { ...row.issue, agent: featured ? 'codex' : 'claude', project: { name: featured ? 'Mobile' : 'Desktop' } },
    };
  });
  const tasks = listed.map((row, index) => ({
    id: String(index + 1), title: `Deploy ${index + 1}`, agent: row.issue.agent, status: index < 100 ? 'active' : 'paused',
  }));
  const { search: find } = search({
    conversations: async (row: any) => ({ conversations: listed.map((entry) => ({ ...entry, issue: row(entry.issue) })) }),
    sessions: async () => ({ items: [{ sessionId: 's101', snippet: 'Deploy before lunch' }] }),
    tasks: async () => ({ outcome: 'success', tasks: [...tasks, { id: 'hidden', title: 'Deploy', agent: 'pi', status: 'paused', origin: 'session' }] }),
  });
  const desktop = createSearchApi(find);
  const board = createNativeBoard({ search: find, fail } as any);
  const ui = [
    async (params: object) => {
      const response = await desktop(new Request('http://localhost/api/dudu/search/query', { method: 'POST', body: JSON.stringify(params) }));
      assert.equal(response.status, 200);
      return response.json();
    },
    (params: object) => board.dispatch('search.query', params, { client: { capabilities: ['search.filters'] } }),
  ];
  for (const query of ui) {
    const sessions = { q: 'deploy', scope: 'sessions', limit: 100 };
    const unfiltered = (await query({ ...sessions, filters: {} })).sessions;
    assert.equal(unfiltered.total, 101);
    assert.equal(unfiltered.items.length, 100);
    assert.deepEqual(unfiltered.facets.agent.at(-1), { key: 'codex', count: 1 });
    assert.deepEqual(unfiltered.facets.project.at(-1), { key: 'Mobile', count: 1 });
    const filtered = (await query({ ...sessions, filters: { agent: ['codex'], project: ['Mobile'], updated: ['day'] } })).sessions;
    assert.equal(filtered.total, 1);
    assert.deepEqual(filtered.items.map((item: any) => [item.id, item.snippet]), [['issue:101', 'Deploy before lunch']]);

    const unfilteredTasks = (await query({ q: '', scope: 'tasks', filters: {}, limit: 100 })).tasks;
    assert.equal(unfilteredTasks.items.length, 100);
    assert.deepEqual(unfilteredTasks.facets.agent, [{ key: 'claude', count: 100 }, { key: 'codex', count: 1 }]);
    const filteredTasks = (await query({ q: 'deploy', scope: 'tasks', filters: { status: ['paused'], agent: ['codex'] }, limit: 100 })).tasks;
    assert.equal(filteredTasks.total, 1);
    assert.deepEqual(filteredTasks.items.map((item: any) => item.id), ['101']);
  }
  const baseline = await board.dispatch('search.query', { q: 'deploy', scope: 'sessions', filters: { agent: ['codex'] } });
  assert.equal(baseline.sessions.total, 101);
  assert.equal(baseline.sessions.facets, undefined);
});

test('a place that cannot be asked is marked and the others are still answered; a content index that fails leaves the title matches', async () => {
  const { search: find } = search({
    sessions: async () => { throw new Error('index is busy'); },
    inbox: () => { throw new Error('inbox is down'); },
    tasks: async () => ({ outcome: 'success', tasks: [{ id: 'a', title: '预发布检查' }, { id: 'b', title: '周报' }, { id: 'c', title: '预发布提醒', origin: 'session' }] }),
  });
  const answer: any = await find.query({ q: '预发布' });
  assert.deepEqual(titles(answer.sessions), ['预发布环境故障']);
  assert.equal(answer.sessions.partial, true);
  assert.deepEqual(answer.inbox, { failed: true, total: 0, items: [] });
  assert.deepEqual(titles(answer.tasks), ['预发布检查']);
  const broken: any = await search({ conversations: async () => { throw new Error('down'); } }).search.query({ q: '预发布' });
  assert.equal(broken.sessions.failed, true);
});

test('the board row and the owner-messages switch are the caller\'s: the phone gets compact rows, the Desktop whole issues', async () => {
  const { search: find, asked } = search({ row: (issue: any) => ({ ref: issue.ref }) });
  assert.deepEqual((await find.query({ q: 'CI' })).sessions.items[0].issue, { ref: 'DUDU-1' });
  assert.equal((await find.query({ q: 'CI' }, { row: (issue: any) => issue, ownMessages: false })).sessions.items[0].issue.project.name, 'dudu');
  assert.deepEqual(asked.conversations, [{ ownMessages: true }, { ownMessages: false }]);
});

function inboxWorld(t: any) {
  const issues = createIssues({ file: ':memory:', now: () => NOW });
  t.after(() => issues.close());
  const collectors = () => ({ resolve: () => ({ outcome: 'success', collectors: [{ id: 'lark', name: '飞书', via: { id: 'lark-cli', via: 'lark' } }, { id: 'mail', name: '邮箱', via: null }] }) });
  const api = createInboxApi({ issues, collectors, now: () => NOW });
  const ingest = (connector: string, list: any[]) => issues.inbox.ingest(connector, normalizeRecords(list).records).added;
  return { api, ingest };
}

test('the inbox range finds records in Chinese, by state and by collector, with a line of the text when only the text matched', async (t) => {
  const { api, ingest } = inboxWorld(t);
  const [a] = ingest('lark', [{ id: 'a', title: '预发布环境故障', text: '预发布的数据库连不上', from: 'Alice', at: NOW - 3000 }]);
  const [b] = ingest('mail', [{ id: 'b', title: '周会纪要', text: '本周的重点是把预发布流程走通，其余按计划进行。', from: 'Bob', at: NOW - 2000 }]);
  ingest('lark', [{ id: 'c', title: '报销单', text: '请在周五前提交', from: 'Carol', at: NOW - 1000 }]);
  api.execute('done', { id: b.id });
  const found: any = api.search({ q: '预发布' });
  assert.equal(found.total, 2);
  assert.deepEqual(found.items.map((card: any) => card.title), ['周会纪要', '预发布环境故障'], 'newest first');
  assert.equal(found.items[0].connectorName, '邮箱');
  assert.match(found.items[0].snippet, /预发布流程走通/);
  assert.equal(found.items[1].snippet, undefined, 'the title already shows the word');
  assert.deepEqual(api.search({ q: '预发布', state: 'todo' }).items.map((card: any) => card.id), [a.id]);
  assert.deepEqual(api.search({ q: '预发布', state: 'done' }).items.map((card: any) => card.id), [b.id]);
  assert.deepEqual(api.search({ q: '预发布', connector: ['mail'] }).items.map((card: any) => card.id), [b.id]);
  assert.equal(api.search({ q: '预发布', limit: 1 }).items.length, 1);
  assert.equal(api.search({ q: '预发布', limit: 1 }).total, 2, 'the total is how many matched, not how many came back');
  // Nothing typed: the newest records of both tabs, narrowed by the same filters.
  assert.equal(api.search({}).total, 3);
  assert.deepEqual(api.search({ state: 'done' }).items.map((card: any) => card.id), [b.id]);
  assert.deepEqual(api.search({ connector: ['lark'] }).items.map((card: any) => card.title), ['报销单', '预发布环境故障']);
  assert.equal(api.search({ q: '!!!' }).total, 0, 'a query with no word in it finds nothing, as it finds no conversation or task');
});

test('the line shown under a result is cut around the first word the text holds', () => {
  const text = `${'前文'.repeat(40)}预发布出了问题${'后文'.repeat(60)}`;
  const line = snippetOf(text, '无关的标题', ['预发布']);
  assert.ok(line.startsWith('…') && line.endsWith('…') && line.includes('预发布出了问题'));
  assert.ok([...line].length <= 108);
  assert.equal(snippetOf(text, '预发布出了问题', ['预发布']), '');
  assert.equal(snippetOf('没有这个词', '标题', ['预发布']), '');
  assert.equal(snippetOf('😀😀 deploy failed', '', ['deploy']), '😀😀 deploy failed');
});

test('the phone asks for a search with checked fields, and the owner-messages switch follows what the app declared', async () => {
  const seen: any[] = [];
  const board = createNativeBoard({ search: { query: async (body: any, options: any) => { seen.push([body, options.ownMessages]); return { outcome: 'success', q: body.q }; } }, fail } as any);
  const call = (params: any, client?: any) => board.dispatch('search.query', params, { client });
  assert.equal((await call({ q: '预发布', scope: 'inbox', state: 'todo', connector: ['lark'], limit: 5 }, { capabilities: ['board.latest'] }) as any).q, '预发布');
  await call({ q: '', scope: 'tasks' });
  assert.deepEqual(seen, [[{ q: '预发布', scope: 'inbox', state: 'todo', connector: ['lark'], limit: 5 }, true], [{ q: '', scope: 'tasks' }, false]]);
  for (const bad of [{}, { q: 3 }, { q: '' }, { q: 'x'.repeat(201) }, { q: 'x', scope: 'files' }, { q: 'x', state: 'new' }, { q: 'x', connector: 'lark' }, { q: 'x', limit: 0 }, { q: 'x', limit: 101 },
    { q: 'x', filters: {} }, { q: 'x', scope: 'tasks', filters: { project: ['Mobile'] } }, { q: 'x', scope: 'sessions', filters: { updated: ['unknown'] } }]) {
    await assert.rejects(() => call(bad, { capabilities: ['search.filters'] }), { code: 'BAD_REQUEST' }, JSON.stringify(bad));
  }
  await assert.rejects(() => createNativeBoard({ fail } as any).dispatch('search.query', { q: 'x' }), { code: 'UPSTREAM_UNAVAILABLE' });
});

test('a line of text is cut of the reminders DSH writes into a turn, and a hit that was only in one is no hit', async () => {
  assert.equal(cleanLine('<system-reminder>别人的 预发布 提示</system-reminder> 我们的预发布环境 ok', ['预发布']), '我们的预发布环境 ok');
  assert.equal(cleanLine('…前文 <system-reminder>预发布 的提示', ['预发布']), '', 'an unclosed reminder runs to the end, and the word was in it');
  assert.equal(cleanLine('没有提示的 预发布', ['预发布']), '没有提示的 预发布');
  const { search: find } = search({
    sessions: async () => ({ items: [{ sessionId: 's3', snippet: '<system-reminder>预发布 只在提示里</system-reminder>' }, { sessionId: 's2', snippet: '<system-reminder>x</system-reminder> 预发布失败了' }], indexing: false }),
  });
  const answer: any = await find.query({ q: '预发布', scope: 'sessions' });
  assert.deepEqual(titles(answer.sessions), ['预发布环境故障']);
  assert.equal(answer.sessions.items[0].snippet, '预发布失败了');
}
);
