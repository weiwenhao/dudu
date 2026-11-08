import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDshSessions } from '../host/assistant/home/dsh-sessions.mjs';
import { createDshContentSearch } from '../host/assistant/home/session-search.mjs';
import { deferred } from '../host/providers/async.mjs';

const phrase = '本轮巡检（北京时间 12:47）正常';
const message = (text: string) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } });

test('new session events refresh the catalog in the background while the existing list remains readable', async () => {
  const started = deferred();
  const next = deferred();
  const listeners: ((session: any, event: any) => void)[] = [];
  let read = () => Promise.resolve({ items: [{ sessionId: 'one', title: 'Saved title', updatedAt: 1 }] });
  const dsh = createDshSessions({
    sessionController: { list: () => read(), inspect: async () => ({ events: [] }) },
    on: (_event: string, handler: any) => { listeners.push(handler); return () => {}; },
  });
  try {
    assert.equal((await dsh.catalog())[0].title, 'Saved title');
    read = () => { started.resolve(); return next.promise; };
    listeners[0]({ id: 'one' }, { type: 'session/title' });
    const cached = dsh.catalog();
    await started.promise;
    next.resolve({ items: [{ sessionId: 'one', title: 'Updated title', updatedAt: 2 }] });
    assert.equal((await cached)[0].title, 'Saved title', 'a new event does not make the ordinary list wait for its replacement');
    assert.equal((await dsh.catalog({ refresh: true }))[0].title, 'Updated title');
    read = () => Promise.reject(new Error('temporary catalog failure'));
    listeners[0]({ id: 'one' }, { type: 'session/title' });
    assert.equal((await dsh.catalog())[0].title, 'Updated title', 'a failed background refresh keeps the usable list');
    await assert.rejects(dsh.catalog({ refresh: true }), /temporary catalog failure/);
  } finally {
    next.resolve({ items: [] });
    await dsh.close();
  }
});

test('query-only DSH reads saved titles, preview, last turn and searchable body without controller inspect', async () => {
  const events = [
    { type: 'session/title', seq: 0, time: 1000, data: { title: 'Saved work' } },
    { type: 'turn/start', seq: 1, time: 1001, data: { turn: 1 } },
    { ...message(phrase), seq: 2, time: 1002 },
    { type: 'turn/end', seq: 3, time: 1003, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const dsh = createDshSessions({
    sessionController: {
      list: async () => ({ items: [{ sessionId: 'one', cwd: '/work', updatedAt: 1003 }] }),
    },
    sessionQuery: { readSession: async () => ({ session: { id: 'one', cwd: '/work' }, events }) },
  });
  try {
    assert.deepEqual(await dsh.title('one'), { title: 'Saved work', seq: 0, at: 1000 });
    assert.match(JSON.stringify(await dsh.read('one')), /本轮巡检/);
    assert.equal((await dsh.lastTurn('one')).last, 'answer');
    await dsh.catalog({ query: phrase, contentIndexOnly: true });
    while (dsh.searchState().running) await new Promise(setImmediate);
    const rows = await dsh.catalog({ query: phrase, contentIndexOnly: true });
    assert.equal(rows.length, 1);
    assert.match(rows[0].evidence.text, /本轮巡检/);
  } finally { await dsh.close(); }
});

test('phone content search uses the shared index even while the host search service is unavailable', async () => {
  let searches = 0;
  const dsh = createDshSessions({ sessionController: {
    list: async () => ({ items: [{ sessionId: 'one', cwd: '/work', updatedAt: 1, title: '历史会话' }] }),
    search: async () => { searches++; throw new Error('session search failed'); },
    inspect: async () => ({ events: [message(phrase)] }),
  } });
  try {
    await dsh.catalog({ query: phrase, contentIndexOnly: true });
    while (dsh.searchState().running) await new Promise(setImmediate);
    const rows = await dsh.catalog({ query: phrase, contentIndexOnly: true });
    assert.equal(rows.length, 1);
    assert.match(rows[0].evidence.text, /本轮巡检/);
    assert.equal(searches, 0);
  } finally { await dsh.close(); }
});

test('a DSH with its query index disabled still searches all original conversation text and reuses unchanged reads', async () => {
  let inspections = 0;
  let searches = 0;
  const events: any[] = [message('x'.repeat(270000) + phrase)];
  const listeners: ((session: any, event: any) => void)[] = [];
  const dsh = createDshSessions({
    sessionController: {
      list: async () => ({ items: [{ sessionId: 'one', cwd: '/work', updatedAt: 1, projections: { values: { title: 'hs 跳板机只读查询' } } }] }),
      search: async () => { searches++; throw new Error('session search is disabled: index openAt "never"'); },
      inspect: async () => { inspections++; return { events }; },
    },
    on: (_event: string, handler: any) => { listeners.push(handler); return () => {}; },
  });
  try {
    await dsh.catalog({ query: phrase });
    while (dsh.searchState().running) await new Promise(setImmediate);
    const rows = await dsh.catalog({ query: phrase });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].evidence.role, 'assistant');
    assert.match(rows[0].evidence.text, /本轮巡检/);
    assert.equal(searches, 1, 'a known disabled index is not retried on every search');
    assert.equal(inspections, 1, 'unchanged sessions are not read again');
    events.push(message('新增的 runner 检查已通过'));
    listeners[0]({ id: 'one' }, message('new'));
    await dsh.catalog({ query: 'runner' });
    while (dsh.searchState().running) await new Promise(setImmediate);
    assert.equal((await dsh.catalog({ query: 'runner' })).length, 1);
    assert.equal(inspections, 2, 'a real new message invalidates its search text');
    assert.equal((await dsh.catalog({ query: '不存在的正文' })).length, 0);
    const preview = await dsh.read('one', { query: phrase });
    assert.ok(preview.messages[preview.matchIndex].text.includes(phrase), 'a content hit beyond the ordinary preview prefix remains readable');
    assert.equal((await dsh.read('one')).messages[0].text.includes(phrase), false, 'the search passage does not replace the ordinary cached prefix');
    assert.equal(inspections, 2, 'previews reuse the ordered text prepared by the same index pass');
  } finally { await dsh.close(); }
});

test('concurrent DSH previews share one cold read and reopen from SQLite without the source', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-dsh-preview-'));
  const file = join(folder, 'search.sqlite');
  const started = deferred();
  const response = deferred();
  let calls = 0;
  let dsh = createDshSessions({
    sessionController: { inspect: () => { calls++; started.resolve(); return response.promise; } },
  }, { cacheFile: file });
  t.after(async () => { await dsh.close(); await rm(folder, { recursive: true, force: true }); });
  const one = dsh.read('one');
  const two = dsh.read('one');
  await started.promise;
  response.resolve({ events: [
    { type: 'user/message', time: 1, data: { content: 'original question' } },
    { ...message('original reply'), time: 2 },
    { type: 'tool/call', data: { secret: 'not conversation' } },
    { type: 'user/message', time: 3, data: { content: 'follow-up' } },
    { ...message('final answer'), time: 4 },
  ] });
  assert.deepEqual((await one).messages, (await two).messages);
  assert.equal(calls, 1);
  await dsh.close();
  dsh = createDshSessions({
    sessionController: { inspect: () => { assert.fail('a persisted preview must not reread DSH'); } },
  }, { cacheFile: file });
  const restored = await dsh.read('one');
  assert.deepEqual(restored.messages.map((m: any) => [m.role, m.text]), [
    ['user', 'original question'], ['assistant', 'original reply'], ['user', 'follow-up'], ['assistant', 'final answer'],
  ]);
  assert.equal(restored.untrusted, true);
});

test('DSH search uses the complete fallback when the official search result cap omits matching sessions', async () => {
  const rows = Array.from({ length: 25 }, (_, n) => ({ sessionId: String(n), cwd: '/work', updatedAt: n + 1 }));
  const dsh = createDshSessions({ sessionController: {
    list: async () => ({ items: rows }),
    search: async () => ({ items: rows.slice(0, 20).map((row) => ({ sessionId: row.sessionId, snippet: phrase })), hasMore: true }),
    inspect: async () => ({ events: [message(phrase)] }),
  } });
  try {
    assert.ok((await dsh.catalog({ query: phrase })).length >= 20);
    while (dsh.searchState().running) await new Promise(setImmediate);
    assert.equal((await dsh.catalog({ query: phrase })).length, 25);
  } finally { await dsh.close(); }
});

test('a search asks the index alone once something is indexed: one conversation that cannot be read does not send every search to DSH\'s slow search', async () => {
  let searches = 0;
  const dsh = createDshSessions({ sessionController: {
    list: async () => ({ items: [{ sessionId: 'huge', cwd: '/a', updatedAt: 1, title: 'Huge' }, { sessionId: 'small', cwd: '/b', updatedAt: 2, title: 'Small' }] }),
    search: async () => { searches++; return { items: [] }; },
    inspect: async (id: string) => { if (id === 'huge') throw new Error('did not answer in time'); return { events: [message(phrase)] }; },
  } });
  try {
    await dsh.catalog({ query: phrase, contentIndexOnly: true });
    while (dsh.searchState().running) await new Promise(setImmediate);
    assert.equal(dsh.searchState().failed, true, 'one cannot be read, so not everything is read');
    const rows = await dsh.catalog({ query: phrase });
    assert.equal(searches, 0, 'and still the search does not go to DSH');
    assert.deepEqual(rows.map((row: { id: string }) => row.id), ['small']);
  } finally { await dsh.close(); }
});

test('failed cold reads are reported and explicit refresh retries them; closing cancels a stalled index', async () => {
  let failed = true;
  let hang = false;
  let signal: AbortSignal | undefined;
  const index = createDshContentSearch({
    controller: () => ({ inspect: async (_id: string, input: AbortSignal) => {
      signal = input;
      if (hang) return new Promise(() => {});
      if (failed) throw new Error('cold store unavailable');
      return { events: [message(phrase)] };
    } }), sessions: () => undefined,
  });
  const rows = [{ id: 'one', updatedAt: 1 }];
  index.update(rows);
  await index.settled();
  assert.equal(index.state().failed, true);
  failed = false;
  index.update(rows, { refresh: true });
  await index.settled();
  assert.equal((await index.find(['本轮巡检'])).size, 1);
  hang = true;
  index.update([{ id: 'two', updatedAt: 2 }]);
  await new Promise(setImmediate);
  await index.close();
  assert.equal(signal?.aborted, true);
  assert.equal(index.state().running, false);
});

test('a failed DSH index stays stopped until explicit refresh and logs the failure once', async () => {
  const warnings: string[] = [];
  let reads = 0;
  let readable = false;
  const real = Date.now;
  const start = real();
  let clock = start;
  Date.now = () => clock;
  try {
    const index = createDshContentSearch({
      controller: () => ({ inspect: async (id: string) => {
        if (id === 'huge') { reads++; if (!readable) throw new Error('did not answer in time'); }
        return { events: [message(phrase)] };
      } }), sessions: () => undefined, log: { warn: (line: string) => warnings.push(line) },
    });
    const rows = [{ id: 'huge', updatedAt: 1 }, { id: 'small', updatedAt: 2 }];
    index.update(rows);
    await index.settled();
    assert.deepEqual([reads, index.state().running, index.state().unsearchable, index.state().done, index.state().total], [1, false, 1, 1, 2], 'the one that cannot be read is counted, the other is searchable');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /DSH session huge: did not answer in time\./, 'the reason is not thrown away');
    // Ordinary rescans never restart the failed read, even after a full day.
    for (const minutes of [0, 5, 11, 120, 24 * 60]) {
      clock = start + minutes * 60_000;
      index.update(rows);
      await index.settled();
    }
    assert.equal(reads, 1, 'elapsed time cannot restart a failed read');
    assert.equal(index.state().running, false, 'and nothing runs meanwhile');
    // a refresh asked for by the person tries it at once, and when it can be read it is no longer counted
    readable = true;
    index.update(rows, { refresh: true });
    await index.settled();
    assert.deepEqual([reads, index.state().unsearchable, index.state().done, index.state().failed], [2, 0, 2, false]);
    assert.equal((await index.find(['本轮巡检'])).size, 2);
    readable = false;
    index.update(rows.map((row) => ({ ...row, updatedAt: 2 })), { refresh: true });
    await index.settled();
    assert.equal(index.state().unsearchable, 0, 'a failed refresh cannot invalidate searchable cached text');
    assert.equal((await index.find(['本轮巡检'])).size, 2);
    await index.close();
  } finally { Date.now = real; }
});
