// The logic of the Desktop's search page (host/dudu-plugin/ui/search/search-model.js): what it remembers, the 常用 list, the marked words, the groups of an answer and the filters it applies itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FREQUENT_MAX, HISTORY_KEY, HISTORY_MAX, OPENED_KEY, OPENED_MAX, answerState, distinct, filterSessions, filterTasks, frequent, groupsOf, inboxArguments, isUnfiltered, markParts,
  noteOpened, readHistory, readOpened, recordTab, saveHistory, searchWords, withWord,
} from '../host/dudu-plugin/ui/search/search-model.js';

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
};
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('the words searched for: newest first, none twice, at most twelve, and a blocked storage only forgets', () => {
  assert.deepEqual(withWord(['b', 'a'], '  a '), ['a', 'b']);
  assert.deepEqual(withWord(['a'], '   '), ['a']);
  const many = Array.from({ length: 20 }, (_, index) => `w${index}`).reduce(withWord, [] as string[]);
  assert.equal(many.length, HISTORY_MAX);
  assert.equal(many[0], 'w19');
  const store = memory();
  saveHistory(['预发布', 'Cart-512'], store);
  assert.deepEqual(readHistory(store), ['预发布', 'Cart-512']);
  assert.deepEqual(readHistory(memory({ [HISTORY_KEY]: '{"not":"a list"}' })), []);
  assert.deepEqual(readHistory(memory({ [HISTORY_KEY]: JSON.stringify(['ok', 3, '', '  ', 'fine']) })), ['ok', 'fine']);
  assert.deepEqual(readHistory(broken), []);
  assert.doesNotThrow(() => saveHistory(['x'], broken));
});

test('the 常用 list is every conversation, the one opened last first, the never opened after them in the order of the list', () => {
  const store = memory();
  noteOpened('issue:3', 1000, store);
  noteOpened('assistant', 3000, store);
  noteOpened('issue:3', 2000, store);
  assert.deepEqual(readOpened(store), { 'issue:3': 2000, assistant: 3000 });
  const entries = ['issue:1', 'issue:2', 'issue:3', 'assistant', 'issue:5', 'issue:6', 'issue:7', 'issue:8'].map((id) => ({ id }));
  assert.deepEqual(frequent(entries, readOpened(store)).map((entry) => entry.id), ['assistant', 'issue:3', 'issue:1', 'issue:2', 'issue:5', 'issue:6']);
  assert.equal(frequent(entries, {}).length, FREQUENT_MAX);
  // Many times are kept down to the newest; junk in the storage is no time.
  for (let index = 0; index < OPENED_MAX + 20; index++) noteOpened(`issue:${index}`, 10_000 + index, store);
  assert.equal(Object.keys(readOpened(store)).length, OPENED_MAX);
  assert.equal(readOpened(store)[`issue:${OPENED_MAX + 19}`], 10_000 + OPENED_MAX + 19);
  assert.deepEqual(readOpened(memory({ [OPENED_KEY]: JSON.stringify({ a: 5, b: 'x', c: null }) })), { a: 5 });
  assert.deepEqual(readOpened(broken), {});
  assert.doesNotThrow(() => noteOpened('issue:1', 1, broken));
});

test('the words of a query mark a text wherever they are, whatever their case, and a mark in a word never cuts another word', () => {
  assert.deepEqual(searchWords('  预发布  CI '), ['预发布', 'CI']);
  assert.deepEqual(searchWords('ab abc'), ['abc', 'ab']);
  assert.deepEqual(markParts('Cart-512 预发布环境，预发布库', ['预发布']).map((part) => [part.text, part.hit]), [
    ['Cart-512 ', false], ['预发布', true], ['环境，', false], ['预发布', true], ['库', false],
  ]);
  assert.deepEqual(markParts('CI runner and ci', ['ci']).filter((part) => part.hit).map((part) => part.text), ['CI', 'ci']);
  assert.deepEqual(markParts('a.b (x) a.b', ['a.b', '(x)']).filter((part) => part.hit).map((part) => part.text), ['a.b', '(x)', 'a.b'], 'the words are text, not patterns');
  assert.deepEqual(markParts('plain', []), [{ text: 'plain', hit: false }]);
  assert.deepEqual(markParts('', ['x']), [{ text: '', hit: false }]);
});

const NOW = new Date(2026, 10, 27, 12).getTime();
const HOUR = 3_600_000;
const entry = (id: string, agent: string | null, project: any, receivedAt: number) => ({ id, receivedAt, issue: { agent, project } });

test('the conversations are filtered by agent, project and the time of their newest message; the tasks by status and agent', () => {
  const entries = [
    entry('issue:1', 'claude', { name: 'dudu', path: '/p/dudu' }, NOW - HOUR),
    entry('issue:2', 'codex', 'dudu', NOW - 3 * 24 * HOUR),
    entry('issue:3', null, null, NOW - 40 * 24 * HOUR),
    { id: 'assistant', receivedAt: NOW - 2 * HOUR },
  ];
  const ids = (filter: any) => filterSessions(entries, filter, NOW).map((one) => one.id);
  assert.deepEqual(ids({}), ['issue:1', 'issue:2', 'issue:3', 'assistant']);
  assert.deepEqual(ids({ agent: ['claude', 'dudu'] }), ['issue:1', 'assistant'], '嘟嘟 has no issue and is the agent dudu');
  assert.deepEqual(ids({ agent: [null] }), ['issue:3'], 'an issue nobody was given');
  assert.deepEqual(ids({ project: ['dudu'] }), ['issue:1', 'issue:2'], 'a project is named by the phone\'s string or the desktop\'s object');
  assert.deepEqual(ids({ updated: ['day'] }), ['issue:1', 'assistant']);
  assert.deepEqual(ids({ updated: ['week'] }), ['issue:1', 'issue:2', 'assistant']);
  assert.deepEqual(ids({ agent: ['claude'], updated: ['month'] }), ['issue:1']);
  const tasks = [{ id: 'a', status: 'active', agent: 'dudu' }, { id: 'b', status: 'paused', agent: 'claude' }, { id: 'c', status: 'ended', agent: 'claude' }];
  assert.deepEqual(filterTasks(tasks, { status: ['paused', 'ended'] }).map((task) => task.id), ['b', 'c']);
  assert.deepEqual(filterTasks(tasks, { agent: ['claude'], status: ['ended'] }).map((task) => task.id), ['c']);
  assert.deepEqual(filterTasks(tasks, {}).length, 3);
  assert.deepEqual(distinct(entries, (one: any) => one.issue?.agent ?? 'x'), ['x', 'claude', 'codex'], 'the commonest first, else in order of appearance');
  assert.deepEqual(distinct([{ a: 'z' }, { a: 'y' }, { a: 'y' }], (one: any) => one.a), ['y', 'z']);
  assert.equal(isUnfiltered({ agent: [], project: undefined }), true);
  assert.equal(isUnfiltered({ agent: ['claude'] }), false);
});

test('the inbox filter says one state and the collectors to the plugin; an answer is shown by its places, or says error or empty', () => {
  assert.deepEqual(inboxArguments({ state: ['done'], connector: ['lark', 'mail'] }), { state: 'done', connector: ['lark', 'mail'] });
  assert.deepEqual(inboxArguments({ state: [], connector: [] }), {});
  assert.equal(recordTab({ issue: null, done: false }), 'todo');
  assert.equal(recordTab({ issue: null, done: true }), 'done');
  assert.equal(recordTab({ issue: { id: 1 }, done: false }), 'done');
  const rows = (n: number) => Array.from({ length: n }, (_, index) => ({ id: index }));
  const answer = { sessions: { total: 6, items: rows(6) }, inbox: { total: 0, items: [] }, tasks: { total: 2, items: rows(2) } };
  assert.deepEqual(groupsOf(answer).map((group) => [group.place, group.total, group.items.length]), [['sessions', 6, 3], ['tasks', 2, 2]], 'a place with no row is not shown; three rows at most, the total says how many there are');
  assert.equal(answerState(answer), 'rows');
  assert.equal(answerState({ sessions: { total: 0, items: [] }, inbox: { total: 0, items: [] }, tasks: { total: 0, items: [] } }), 'empty');
  assert.equal(answerState({ sessions: { failed: true, items: [] }, inbox: { failed: true, items: [] }, tasks: { failed: true, items: [] } }), 'error');
  assert.equal(answerState({ sessions: { failed: true, items: [] }, inbox: { total: 0, items: [] }, tasks: { total: 0, items: [] } }), 'empty', 'one place that failed is not an error while the others answered');
  assert.equal(answerState({ tasks: { total: 1, items: rows(1) } }, ['tasks']), 'rows');
  assert.equal(answerState(null), 'error');
});
