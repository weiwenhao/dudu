import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CARD_COMMAND, cardCommand, cardText, createCards } from '../host/assistant/home/cards.mjs';

// The cards of the quick buttons of 嘟嘟's chat: what each lists, that a list that cannot be read is an error and never an empty card, and that a card is kept under its command's id across a restart.

const issue = (id: number, over: Record<string, unknown> = {}) => ({
  id, ref: `DUD-${id}`, title: `事项 ${id}`, agent: 'codex', agentState: 'blocked', status: 'todo', statusType: 'todo', priority: 'none', updatedAt: 1000 + id,
  project: { name: 'dudu' }, session: id === 9 ? 'dsh:abc' : null, brief: 'never sent', ...over,
});

function services(over: Record<string, unknown> = {}) {
  const asked: [string, string, unknown][] = [];
  const make = (name: string, answers: Record<string, unknown>) => () => ({ execute: async (action: string, body: unknown) => { asked.push([name, action, body]); return answers[action] ?? { outcome: 'error' }; } });
  return {
    asked,
    issues: make('issues', { list: { outcome: 'success', total: 8, items: [issue(9), issue(10)] } }),
    inbox: make('inbox', { list: { outcome: 'success', items: [
      { id: 3, ref: 'r3', connector: 'c1', connectorName: 'Lark', connectorIcon: 'lark', title: '私聊', from: 'Zhoukai Lin', at: 5, url: 'https://x', verdict: null },
      { id: 2, connector: 'c1', connectorName: 'Lark', title: 'Project Channel', at: null },
    ], facets: { connector: [{ key: 'c1', name: 'Lark', count: 4 }, { key: 'c2', name: 'Mail', count: 1 }] } } }),
    tasks: make('tasks', { list: { outcome: 'success', tasks: [
      { id: 'late', title: '周报整理', agent: 'codex', status: 'active', nextRunAt: 300, createdAt: 3, schedule: { kind: 'weekly', time: '18:00', timezone: 'Asia/Shanghai', weekdays: [5], junk: 1 }, prompt: 'never sent' },
      { id: 'soon', title: '每日项目摘要', agent: 'deepseek', status: 'active', nextRunAt: 100, createdAt: 1, schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' } },
      { id: 'off', title: '依赖更新检查', agent: 'codex', status: 'paused', nextRunAt: 50, createdAt: 2, schedule: { kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai', weekdays: [1] } },
      { id: 'done', title: '提醒一次', agent: 'codex', status: 'ended', schedule: { kind: 'once', date: '2026-11-01', time: '09:00', timezone: 'Asia/Shanghai' } },
    ] } }),
    ...over,
  };
}

const folder = () => mkdtempSync(join(tmpdir(), 'dudu-cards-'));

test('a todo card lists the issues that need the owner (the board\'s 需要你, in its default scope) as the board\'s own rows, with the real total, and nothing of their descriptions', async () => {
  const s = services();
  const cards = createCards({ ...s, now: () => 7 });
  const card = await cards.build('todo');
  assert.deepEqual(s.asked[0], ['issues', 'list', { tab: 'active', filter: { agentState: ['blocked'] }, order: 'priority', limit: 30 }], 'the 需要你 group of the 进行中 scope, in the board\'s order, not the status Todo');
  assert.deepEqual([card.kind, card.at, card.total, card.rows.length], ['todo', 7, 8, 2]);
  assert.deepEqual(card.rows[0], { id: 9, ref: 'DUD-9', title: '事项 9', agent: 'codex', agentState: 'blocked', status: 'todo', statusType: 'todo', priority: 'none', project: 'dudu', updatedAt: 1009, sessionId: 'abc' });
  assert.equal(JSON.stringify(card).includes('never sent'), false);
});

test('a todo row carries the latest message of its session, and the sessions with nothing kept are read first', async () => {
  const asked: string[][] = [];
  const latest = { ensure: async (ids: string[]) => { asked.push(ids); }, get: (id: string) => (id === 'abc' ? { who: 'agent', text: '结论：先用 SQLite', at: 9 } : null) };
  const card = await createCards({ ...services(), latest, now: () => 7 }).build('todo');
  assert.deepEqual(asked, [['abc']]);
  assert.deepEqual(card.rows[0].latest, { who: 'agent', text: '结论：先用 SQLite', at: 9 });
  assert.equal('latest' in card.rows[1], false);
});

test('an information card lists the records still to handle, and counts them from the collectors\' own totals', async () => {
  const cards = createCards(services());
  const card = await cards.build('info');
  assert.equal(card.total, 5);
  assert.deepEqual(card.rows[0], { id: 3, ref: 'r3', connector: 'c1', connectorName: 'Lark', connectorIcon: 'lark', title: '私聊', from: 'Zhoukai Lin', at: 5 });
  assert.deepEqual([card.rows[1].from, card.rows[1].at, card.rows[1].connectorIcon], [null, null, null]);
});

test('a task card lists the tasks that are on or paused, the next to run first, with the schedule as stored and none of the prompt', async () => {
  const card = await createCards(services()).build('task');
  assert.deepEqual(card.rows.map((row: any) => [row.id, row.status, row.nextRunAt]), [['soon', 'active', 100], ['late', 'active', 300], ['off', 'paused', null]]);
  assert.equal(card.total, 3);
  assert.deepEqual(card.rows[1].schedule, { kind: 'weekly', time: '18:00', timezone: 'Asia/Shanghai', weekdays: [5] });
  assert.equal(JSON.stringify(card).includes('never sent'), false);
});

test('a list that cannot be read is an error: an empty card must never mean "could not look"', async () => {
  const s = services({ inbox: () => null, tasks: () => ({ execute: async () => ({ outcome: 'error', code: 'unavailable' }) }) });
  const cards = createCards(s);
  await assert.rejects(cards.build('info'), /unavailable/);
  await assert.rejects(cards.build('task'), /unavailable/);
  await assert.rejects(cards.build('nonsense'), /Unknown card/);
  const empty = createCards({ ...services({ issues: () => ({ execute: async () => ({ outcome: 'success', items: [], total: 0 }) }) }), now: () => 5 });
  assert.deepEqual(await empty.build('todo'), { v: 1, kind: 'todo', at: 5, total: 0, rows: [] }, 'a list that was read and is empty is an empty card');
});

test('a card is kept under its command\'s id across a restart, the oldest go beyond a hundred, and an unreadable file is simply no cards', async () => {
  const dir = folder();
  try {
    const file = join(dir, 'assistant', 'cards.json');
    const first = createCards({ ...services(), file });
    for (let n = 0; n < 105; n++) first.put(`cmd-${n}`, { v: 1, kind: 'todo', at: n, total: 0, rows: [] });
    const again = createCards({ file });
    assert.equal(again.get('cmd-0'), null);
    assert.equal(again.get('cmd-4'), null);
    assert.equal(again.get('cmd-5').at, 5);
    assert.deepEqual(Object.keys(again.many(['cmd-104', 'cmd-1', 'cmd-103', 5 as any])), ['cmd-104', 'cmd-103']);
    assert.throws(() => again.put('', { v: 1, kind: 'todo', at: 1, total: 0, rows: [] }), /command/);
    writeFileSync(file, '{not json');
    assert.equal(createCards({ file }).get('cmd-104'), null);
    assert.equal(readFileSync(file, 'utf8'), '{not json', 'reading a bad file does not rewrite it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the command builds the card, keeps it under its own id and answers with a plain list; a bad kind or an unreadable list is its error', async () => {
  const cards = createCards(services());
  const command = cardCommand(cards);
  assert.equal(command.name, CARD_COMMAND);
  const done = await command.handler({ commandId: 'cmd-a-1', rawInput: ' todo ' });
  assert.deepEqual(done, { kind: 'success', text: 'DUD-9 事项 9\nDUD-10 事项 10' });
  assert.equal(cards.get('cmd-a-1')!.kind, 'todo');
  assert.equal((await command.handler({ commandId: 'cmd-a-2', rawInput: 'task' })).text, '每日项目摘要\n周报整理\n⏸ 依赖更新检查');
  assert.equal((await command.handler({ commandId: 'cmd-a-3', rawInput: 'info' })).text, '私聊 · Zhoukai Lin\nProject Channel');
  assert.equal((await command.handler({ commandId: 'cmd-a-4', rawInput: 'everything' })).kind, 'error');
  const broken = cardCommand(createCards(services({ tasks: () => null })));
  const failed = await broken.handler({ commandId: 'cmd-b-1', rawInput: 'task' });
  assert.equal(failed.kind, 'error');
  assert.ok(failed.text.length > 0);
  const empty = cardCommand(createCards(services({ issues: () => ({ execute: async () => ({ outcome: 'success', items: [] }) }) })));
  assert.deepEqual(await empty.handler({ commandId: 'cmd-c-1', rawInput: 'todo' }), { kind: 'success' }, 'an empty list has no text to show');
  assert.equal(cardText({ kind: 'todo', rows: [] }), '');
});

test('a card repeats the one before it only when the list is the same row for row and in total; anything else is made, and a list that cannot be read is no repeat', async () => {
  const first = createCards({ ...services(), now: () => 1 });
  first.put('earlier', await first.build('todo'));
  assert.equal(await first.repeats('todo', 'earlier'), true, 'the same list again');
  assert.equal(await first.repeats('info', 'earlier'), false, 'a card of another kind is no repeat');
  assert.equal(await first.repeats('todo', 'unknown'), false);
  assert.equal(await first.repeats('todo', undefined as any), false);
  const listing = (items: unknown[], total = 8) => createCards({ ...services({ issues: () => ({ execute: async () => ({ outcome: 'success', total, items }) }) }), now: () => 2 });
  for (const [what, later] of [
    ['a row that is another issue', listing([issue(9), issue(11)])],
    ['a row that was touched since', listing([issue(9, { updatedAt: 5000 }), issue(10)])],
    ['the same rows of a longer list', listing([issue(9), issue(10)], 9)],
    ['one row fewer', listing([issue(9)])],
  ] as const) {
    later.put('earlier', await first.build('todo'));
    assert.equal(await later.repeats('todo', 'earlier'), false, what);
  }
  const broken = createCards({ ...services({ issues: () => null }) });
  broken.put('earlier', await first.build('todo'));
  assert.equal(await broken.repeats('todo', 'earlier'), false, 'the command says why it cannot be made');
});

test('a quota card is what the quota panel shows: each agent with its plan (and when it ends) and windows, a wallet or key as its amount, the time of the reading, asked for now and waited for; an unreadable quota is an error', async () => {
  const asked: unknown[] = [];
  const view = { providers: [
    { id: 'claude', agent: 'claude', name: 'Claude', plan: 'Max', until: 9000, windows: [{ key: 'five_hour', label: '5 小时', used: 0.74, resetsAt: 1000, core: true }, { key: 'seven_day', label: '每周', used: 0.31, core: true, junk: 1 }], never: 'sent', readAt: 5 },
    { id: 'deepseek-account', agent: 'deepseek', name: 'DeepSeek', kind: 'balance', plan: 'Account', windows: [], balance: [{ currency: 'CNY', text: '¥12.34' }], readAt: 5 },
  ], refreshing: false, readAt: 5 };
  const cards = createCards({ quota: () => ({ request: async (options: unknown) => { asked.push(options); return view; } }), now: () => 7 });
  const card = await cards.build('quota');
  assert.deepEqual(asked, [{ ask: true, wait: true }], 'a person asked: a source not read in the last fifteen minutes is read now, and the card waits for it');
  assert.deepEqual([card.kind, card.at, card.total, card.readAt], ['quota', 7, 2, 5], 'the card says when the oldest reading was taken, as the panel does');
  assert.deepEqual(card.rows[0], { id: 'claude', agent: 'claude', name: 'Claude', state: 'ok', plan: 'Max', limited: false, until: 9000, windows: [{ key: 'five_hour', label: '5 小时', used: 0.74, resetsAt: 1000, core: true }, { key: 'seven_day', label: '每周', used: 0.31, core: true }] });
  assert.deepEqual([card.rows[1].agent, card.rows[1].plan, card.rows[1].balance], ['deepseek', 'Account', [{ text: '¥12.34' }]], 'two DeepSeek rows are told apart by their id, and wear one logo');
  assert.equal('until' in card.rows[1], false, 'a plan that does not say when it ends has no time');
  assert.equal(JSON.stringify(card).includes('sent'), false);
  assert.equal(cardText(card), 'Claude Max: 5 小时 26%, 每周 69%\nDeepSeek Account: ¥12.34');
  // a quota that cannot be read is an error, never an empty card
  await assert.rejects(createCards({ quota: () => null }).build('quota'), /unavailable/);
  await assert.rejects(createCards({ quota: () => ({ request: async () => ({ error: 'x' }) }) }).build('quota'), /unavailable/);
});
