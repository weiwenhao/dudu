import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLinkStore, createNativeSessions, metadataWeight, termsOf } from '../host/providers/native/index.mjs';
import { createSessionCatalog } from '../host/assistant/home/session-catalog.mjs';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let clock = Date.parse('2026-10-01T10:00:00.000Z');
const stamp = () => new Date((clock += 1000)).toISOString();
const user = (uuid: string, parentUuid: string | null, text: string, cwd: string | null = '/work/app') => ({
  parentUuid, isSidechain: false, type: 'user', message: { role: 'user', content: text }, uuid, timestamp: stamp(),
  entrypoint: 'cli', ...(cwd ? { cwd } : {}), gitBranch: 'main',
});
const reply = (uuid: string, parentUuid: string, messageId: string, text: string) => ({
  parentUuid, isSidechain: false, type: 'assistant', uuid, timestamp: stamp(),
  message: { role: 'assistant', id: messageId, model: 'claude-sonnet-5-5', content: [{ type: 'text', text }] },
});
const lines = (records: unknown[]) => records.map((record) => `${JSON.stringify(record)}\n`).join('');

// Three Claude sessions on disk, a DSH store that remembers what is written to it, and a workspace registry.
async function setup(t: { after: (cleanup: () => Promise<void>) => void }, { persistence = true, now, cached = false, codex, onHistoryAppended }: { persistence?: boolean; now?: () => number; cached?: boolean; codex?: any; onHistoryAppended?: (id: string, events: any[]) => void } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'dudu-native-'));
  const root = join(base, 'projects');
  await mkdir(join(root, 'app'), { recursive: true });
  const put = (n: number, records: unknown[]) => writeFile(join(root, 'app', `${id(n)}.jsonl`), lines(records));
  await put(1, [user('a', null, 'fix the failing build'), reply('b', 'a', 'm1', 'The zebra in the config was wrong.'), { type: 'ai-title', aiTitle: 'Build repair' }]);
  await put(2, [user('a', null, 'explain quokkas to me'), reply('b', 'a', 'm1', 'They are small marsupials.')]);
  await put(3, [user('a', null, 'a session in a folder that is gone', '/work/missing'), reply('b', 'a', 'm1', 'Nothing here.')]);
  const stored = new Map<string, { header: any; events: any[] }>();
  const attached: string[] = [];
  const store = {
    stat: async (sessionId: string) => (stored.has(sessionId) ? { header: stored.get(sessionId)!.header } : undefined),
    create: async (header: any) => {
      const entry = { header, events: [] as any[] };
      stored.set(header.id, entry);
      return { append: async (events: any[]) => { entry.events.push(...events); }, flush: async () => {}, close: async () => {} };
    },
    open: async (sessionId: string) => {
      const entry = stored.get(sessionId)!;
      return { read: async () => ({ events: [...entry.events] }), append: async (events: any[]) => { entry.events.push(...events); }, flush: async () => {}, close: async () => {} };
    },
  };
  const registry = {
    create: async (path: string) => {
      if (path.includes('missing')) throw new Error('ENOENT: no such directory');
      return { id: 'ws-1', path, attachSession: async (sessionId: string) => { attached.push(sessionId); } };
    },
  };
  const links = await createLinkStore(join(base, 'state'));
  t.after(async () => { await links.flush(); await rm(base, { recursive: true, force: true }); });
  const driver = {
    listModels: async () => [{ provider: 'claude', id: 'default', name: 'Default' }, { provider: 'claude', id: 'claude-sonnet-5-5', name: 'Sonnet' }],
    resolveModel: async () => ({ reasoning: { defaultEffort: 'medium' } }),
  };
  const source = { id: 'claude', name: 'Claude', route: 'claude', driver };
  const service = createNativeSessions({
    onHistoryAppended,
    sources: () => (codex ? [source, codex] : [source]), links, claude: { root }, persistence: () => (persistence ? store : undefined), workspaces: () => registry, ...(now ? { now } : {}),
    ...(cached ? { cacheFile: join(base, 'state', 'search.sqlite') } : {}),
  });
  t.after(async () => { await service.close(); });
  return { service, stored, attached, links, base, root, put, source, store, registry };
}

test('the sessions of a harness are listed newest first, with what shows them apart', async (t) => {
  const { service } = await setup(t);
  const result = await service.list();
  assert.equal(result.total, 3);
  assert.deepEqual(result.providers, [{ id: 'claude', name: 'Claude', count: 3 }]);
  const build = result.sessions.find((session: any) => session.id === id(1));
  assert.deepEqual([build.key, build.provider, build.title, build.cwd, build.branch], [`claude:${id(1)}`, 'claude', 'Build repair', '/work/app', 'main']);
  assert.equal(build.preview, 'fix the failing build');
  assert.equal('file' in build, false, 'where a transcript lives on disk stays on the host');
  assert.ok(result.sessions.every((session: any, index: number, all: any[]) => index === 0 || all[index - 1].updatedAt >= session.updatedAt));
  assert.deepEqual((await service.list({ provider: 'codex' })).sessions, []);
  assert.equal((await service.list({ limit: 2 })).sessions.length, 2);
});

test('list, preview, import and synchronization preserve the native file and its recorded activity time', async (t) => {
  const { service, root } = await setup(t);
  const file = join(root, 'app', `${id(1)}.jsonl`);
  const original = await readFile(file);
  const records = original.toString().trim().split('\n').map((line) => JSON.parse(line));
  const recordedAt = Date.parse(records.findLast((record) => record.type === 'assistant').timestamp);
  await utimes(file, new Date(), new Date());
  const before = await stat(file);
  const loaded = await service.load({ provider: 'claude', id: id(1) });
  for (let check = 0; check < 3; check++) {
    const listing = await service.list({ refresh: true });
    const row = listing.sessions.find((session: any) => session.id === id(1));
    assert.equal(row.updatedAt, recordedAt);
    assert.equal('mtimeMs' in row, false);
    assert.equal((await service.describe({ provider: 'claude', id: id(1) })).updatedAt, recordedAt);
    await service.read({ provider: 'claude', id: id(1) });
    assert.deepEqual((await service.sync({ sessionIds: [loaded.sessionId], fresh: true })).updated, []);
  }
  await service.settled();
  assert.deepEqual(await readFile(file), original);
  const after = await stat(file);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});

test('reading native history returns bounded conversation text without tool output or reasoning', async (t) => {
  const { service, put } = await setup(t);
  const records: unknown[] = [];
  for (let n = 0; n < 15; n++) {
    records.push(user(`u${n}`, null, `prompt ${n}`));
    const message = reply(`a${n}`, `u${n}`, `m${n}`, `${n}:${'x'.repeat(5000)}`);
    message.message.content.push({ type: 'thinking', thinking: 'private reasoning' } as any);
    message.message.content.push({ type: 'tool_use', id: `t${n}`, name: 'Bash', input: { command: 'sensitive command' } } as any);
    records.push(message);
  }
  await put(4, records);
  const result = await service.read({ provider: 'claude', id: id(4) });
  assert.equal(result.untrusted, true);
  assert.equal(result.messages.length, 20);
  assert.equal(result.messages[0].text, 'prompt 5');
  assert.ok(result.messages.every((message: any) => message.text.length <= 4000));
  assert.ok(!JSON.stringify(result).match(/private reasoning|sensitive command/));
});

test('a search needs every word, and a word in the title says more than one in the first prompt', async (t) => {
  const { service } = await setup(t);
  assert.deepEqual((await service.list({ query: 'build' })).sessions.map((session: any) => session.id), [id(1)]);
  assert.deepEqual((await service.list({ query: 'BUILD repair' })).sessions.map((session: any) => session.id), [id(1)], 'case does not matter');
  assert.deepEqual((await service.list({ query: 'build quokkas' })).sessions, [], 'every word has to be found');
  assert.deepEqual((await service.list({ query: 'app' })).sessions.length, 2, 'the folder is searched too: two sessions ran in /work/app');
  assert.ok(metadataWeight({ title: 'build', preview: '' }, 'build') > metadataWeight({ title: '', preview: 'build' }, 'build'));
  assert.deepEqual(termsOf('  Foo   BAR '), ['foo', 'bar']);
});

test('a search also looks inside the conversations, shows where, and says while they are still being read', async (t) => {
  const { service } = await setup(t);
  const first = await service.list({ query: 'zebra' });
  assert.equal(first.indexing.running, true, 'the conversations are read in the background after the first look');
  await service.settled();
  const result = await service.list({ query: 'zebra' });
  assert.equal(result.indexing.running, false);
  assert.deepEqual(result.sessions.map((session: any) => session.id), [id(1)]);
  assert.equal(result.sessions[0].evidence.role, 'assistant');
  assert.match(result.sessions[0].evidence.text, /The zebra in the config was wrong/);
  assert.equal((await service.list({ query: 'marsupials' })).sessions[0].evidence.role, 'assistant');
  assert.equal((await service.list({ query: 'build' })).sessions[0].evidence, undefined, 'a word the title already shows needs no excerpt');
  assert.deepEqual((await service.list({ query: 'nothing-like-this' })).sessions, []);
});

test('body search finds the owners exact phrase deep in a long message and refresh reindexes newly written conversation text', async (t) => {
  const { service, put } = await setup(t);
  const phrase = '本轮巡检（北京时间 12:47）正常';
  await put(4, [
    user('u', null, 'hs 跳板机只读查询'),
    reply('a', 'u', 'm', `${'x'.repeat(270_000)}\n智能体：${phrase}，没有发群。`),
    { type: 'progress', payload: 'y'.repeat(3_000_000) },
  ]);
  await service.list();
  await service.settled();
  let result = await service.list({ query: phrase });
  assert.deepEqual(result.sessions.map((session: any) => session.id), [id(4)]);
  assert.match(result.sessions[0].evidence.text, /本轮巡检/);
  await put(4, [user('u', null, 'hs 跳板机只读查询'), reply('a', 'u', 'm', `${phrase}。补充：已核对 runner 状态。`)]);
  await service.list({ query: '已核对 runner', refresh: true });
  await service.settled();
  result = await service.list({ query: '已核对 runner' });
  assert.deepEqual(result.sessions.map((session: any) => session.id), [id(4)]);
});

test('cached search and paginated Claude preview locate the owners exact phrase instead of redshift', async (t) => {
  const { service, put, stored } = await setup(t, { cached: true });
  const query = 'Hi Shreyas, the read-only MySQL';
  const records: unknown[] = [
    user('u0', null, 'Use redshift.'),
    reply('a0', 'u0', 'm0', `${'x'.repeat(7000)}\n${query} access is set up.`),
  ];
  for (let n = 1; n <= 15; n++) records.push(user(`u${n}`, `a${n - 1}`, `Later question ${n}`), reply(`a${n}`, `u${n}`, `m${n}`, `Later answer ${n}`));
  await put(4, records);
  await service.list();
  await service.settled();
  const found = await service.list({ query });
  assert.deepEqual(found.sessions.map((session: any) => session.id), [id(4)]);
  assert.equal(found.sessions[0].evidence.role, 'assistant');
  assert.ok(found.sessions[0].evidence.text.includes(query));
  assert.equal((await service.read({ provider: 'claude', id: id(4) })).messages.some((message: any) => message.text.includes(query)), false);
  const catalog = createSessionCatalog({ native: service, dsh: {} });
  const preview = await catalog.read({ provider: 'claude', id: id(4), query });
  assert.ok(preview.messages[preview.matchIndex].text.includes(query));
  assert.ok(preview.messages.every((message: any) => message.text.length <= 4000));
  assert.equal(stored.size, 0, 'searching and reading never import or start the conversation');
});

test('native session list and full conversation search survive restart from disk and changed files update incrementally', async t => {
  const { service, base, links, root, source, store, registry, put } = await setup(t, { cached: true });
  await service.list();
  await service.settled();
  await service.close();
  let forbidSources = false;
  const restored = createNativeSessions({
    sources: () => { assert.equal(forbidSources, false, 'a cached preview must not consult the harness'); return [source]; }, links, claude: { root }, persistence: () => store, workspaces: () => registry,
    cacheFile: join(base, 'state', 'search.sqlite'),
  });
  t.after(() => restored.close());
  const found = await restored.list({ query: 'zebra' });
  assert.equal(found.indexing.running, false, 'the first search after restart uses the complete disk index');
  assert.equal(found.sessions[0].id, id(1));
  assert.match(found.sessions[0].evidence.text, /zebra/);
  await restored.settled();
  forbidSources = true;
  const preview = await restored.read({ provider: 'claude', id: id(1) });
  assert.deepEqual(preview.messages.map((m: any) => [m.role, m.text]), [
    ['user', 'fix the failing build'], ['assistant', 'The zebra in the config was wrong.'],
  ]);
  forbidSources = false;
  await put(2, [user('a', null, 'explain quokkas to me'), reply('b', 'a', 'm1', 'The new cached phrase is capybara.')]);
  await restored.list({ refresh: true });
  await restored.settled();
  assert.equal((await restored.list({ query: 'capybara' })).sessions[0].id, id(2));
  assert.match(JSON.stringify(await restored.read({ provider: 'claude', id: id(2) })), /capybara/);
  assert.equal((await restored.list({ query: 'zebra' })).sessions[0].id, id(1), 'unchanged cached text stays searchable');
});

test('loading writes a session DSH can open, in the session\'s own folder, and remembers where it went', async (t) => {
  const { service, stored, attached, links } = await setup(t);
  const result = await service.load({ provider: 'claude', id: id(1) });
  assert.deepEqual([result.reused, result.workspaceId, result.title], [false, 'ws-1', 'Build repair']);
  const entry = stored.get(result.sessionId)!;
  assert.equal(entry.header.cwd, '/work/app');
  assert.equal(entry.header.version, 4);
  const selection = entry.events.find((event: any) => event.type === 'model/selection');
  assert.deepEqual(selection.data, { provider: 'claude', model: 'claude-sonnet-5-5', reasoningEffort: 'medium' }, 'the model the conversation used, when the harness offers it');
  const assistant = entry.events.find((event: any) => event.type === 'assistant/message');
  assert.deepEqual(assistant.data.message.source.replayState, { harness: 'claude', nativeSessionId: id(1), nativeTurnId: 'a' });
  assert.deepEqual(attached, [result.sessionId]);
  assert.equal(links.get('claude', id(1)), result.sessionId);
  assert.equal((await service.list()).sessions.find((session: any) => session.id === id(1)).dshSessionId, result.sessionId);
});

test('loading a session twice opens the one that is there, even when both clicks arrive together', async (t) => {
  const { service, stored } = await setup(t);
  const [one, two] = await Promise.all([service.load({ provider: 'claude', id: id(2) }), service.load({ provider: 'claude', id: id(2) })]);
  assert.equal(one.sessionId, two.sessionId);
  assert.equal(stored.size, 1);
  const again = await service.load({ provider: 'claude', id: id(2) });
  assert.deepEqual([again.sessionId, again.reused], [one.sessionId, true]);
  assert.equal(stored.size, 1);
});

test('loading again reads TUI changes immediately into the same DSH session, without duplicating them', async (t) => {
  const published: { id: string; events: any[] }[] = [];
  const { service, stored, put } = await setup(t, { onHistoryAppended: (id, events) => { published.push({ id, events }); } });
  const original = [user('a', null, 'sync this'), reply('b', 'a', 'm1', 'first answer')];
  await put(5, original);
  const first = await service.load({ provider: 'claude', id: id(5) });
  assert.equal(published.length, 1, 'initial import publishes its committed incoming boundary');
  await put(5, [...original, user('c', 'b', 'continue'), reply('d', 'c', 'm2', 'new TUI answer')]);
  const updated = await service.load({ provider: 'claude', id: id(5) });
  assert.equal(updated.sessionId, first.sessionId);
  assert.equal(updated.updated, true);
  assert.equal(published.length, 2, 'a cold append updates session attention without a live event');
  assert.equal(published[1].id, first.sessionId);
  assert.ok(JSON.stringify(published[1].events).includes('new TUI answer'));
  const entry = stored.get(first.sessionId)!;
  assert.equal(entry.events.filter((event: any) => event.type === 'user/message').length, 2);
  assert.ok(JSON.stringify(entry.events).includes('new TUI answer'));
  const length = entry.events.length;
  await service.load({ provider: 'claude', id: id(5) });
  assert.equal(published.length, 2, 'an unchanged sync does not manufacture new attention');
  assert.equal(entry.events.length, length);
  assert.ok(entry.events.every((event: any, index: number) => event.seq === index));
});

for (const api of ['legacy', 'query']) test(`opening restores a missing native link from durable identity and synchronizes the same DSH session (${api})`, async (t) => {
  const { service, stored, links, root, put, source, store, registry } = await setup(t);
  const original = [user('u1', null, 'first'), reply('a1', 'u1', 'm1', 'first answer')];
  await put(5, original);
  const { sessionId } = await service.load({ provider: 'claude', id: id(5) });
  links.forget('claude', id(5));
  await put(5, [...original, user('u2', 'a1', 'second'), reply('a2', 'u2', 'm2', 'external answer')]);
  const restored = createNativeSessions({
    sources: () => [source], links, claude: { root }, persistence: () => store, workspaces: () => registry,
    ...(api === 'query'
      ? { query: () => ({ readSession: async (target: string) => ({ session: stored.get(target)?.header, events: stored.get(target)?.events }) }) }
      : { controller: () => ({ inspect: async (target: string) => stored.get(target) }) }),
  });
  assert.deepEqual(await restored.sync({ sessionIds: [sessionId] }), { updated: [] });
  assert.deepEqual(await restored.sync({ sessionIds: [sessionId], recover: true }), { updated: [sessionId] });
  assert.equal(links.get('claude', id(5)), sessionId);
  assert.equal(stored.size, 1);
  assert.equal(stored.get(sessionId)!.events.filter((event: any) => event.type === 'user/message').length, 2);
  assert.deepEqual(await restored.sync({ sessionIds: [sessionId], recover: true }), { updated: [] });
});

test('automatic link recovery respects explicit deletions and a newer import of the same conversation', async (t) => {
  const { service, stored, links, root, source, store, registry } = await setup(t);
  const { sessionId } = await service.load({ provider: 'claude', id: id(1) });
  const events = stored.get(sessionId)!.events;
  let inspected = 0;
  const restored = createNativeSessions({
    sources: () => [source], links, claude: { root }, persistence: () => store, workspaces: () => registry,
    controller: () => ({ inspect: async () => { inspected++; return { events }; } }),
  });
  assert.deepEqual(await restored.sync({ sessionIds: ['older-copy'], recover: true }), { updated: [] });
  assert.equal(links.get('claude', id(1)), sessionId, 'a historical copy cannot steal a newer link');
  await links.retire({ sessionId, provider: 'claude', id: id(1) });
  inspected = 0;
  assert.deepEqual(await restored.sync({ sessionIds: [sessionId], recover: true }), { updated: [] });
  assert.equal(inspected, 0, 'deleted sessions are not reopened for recovery');
  assert.equal(links.get('claude', id(1)), undefined);
  assert.deepEqual(await restored.sync({ sessionIds: ['another-copy'], recover: true }), { updated: [] });
  assert.equal(links.get('claude', id(1)), undefined, 'a duplicate cannot resurrect explicitly deleted native work');
});

test('a link to a DSH session that no longer exists is dropped, and the session can be loaded again', async (t) => {
  const { service, stored, links } = await setup(t);
  const first = await service.load({ provider: 'claude', id: id(2) });
  stored.delete(first.sessionId);
  const shown = (await service.list()).sessions.find((session: any) => session.id === id(2));
  assert.equal(shown.dshSessionId, undefined);
  assert.equal(links.get('claude', id(2)), undefined);
  const second = await service.load({ provider: 'claude', id: id(2) });
  assert.notEqual(second.sessionId, first.sessionId);
});

test('removing an issue keeps its native history browsable and an explicit import creates a fresh DSH copy', async (t) => {
  const { service, stored, links, base } = await setup(t);
  const first = await service.load({ provider: 'claude', id: id(1) });
  await links.retire({ provider: 'dsh', id: first.sessionId, sessionId: first.sessionId });
  const listed = (await service.list({ refresh: true })).sessions.find((session: any) => session.id === id(1));
  assert.ok(listed);
  assert.equal(listed.dshSessionId, undefined);
  assert.equal((await service.describe({ provider: 'claude', id: id(1) })).id, id(1));
  assert.equal((await service.read({ provider: 'claude', id: id(1) })).outcome, 'success');
  const second = await service.load({ provider: 'claude', id: id(1) });
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(stored.size, 2);
  assert.equal(links.get('claude', id(1)), second.sessionId);
  assert.equal(links.removed(first.sessionId), true);
  assert.equal(links.removed(second.sessionId), false);
  assert.equal(links.hidden('claude', id(1)), true, 'import alone does not re-enable automatic issue creation');
  links.record({ route: 'claude', nativeSessionId: id(1), sessionId: first.sessionId });
  assert.equal(links.get('claude', id(1)), second.sessionId, 'a late archived event cannot replace the new link');
  await links.flush();
  const reopened = await createLinkStore(join(base, 'state'));
  assert.equal(reopened.get('claude', id(1)), second.sessionId);
  assert.equal(reopened.hidden('claude', id(1)), true);
  assert.equal(reopened.removed(first.sessionId), true);
});

test('loading says plainly why it cannot', async (t) => {
  const { service, put } = await setup(t);
  await assert.rejects(service.load({ provider: 'claude', id: id(3) }), /folder is not available: \/work\/missing/);
  await put(4, [user('a', null, 'no folder recorded', null), reply('b', 'a', 'm1', 'ok')]);
  await assert.rejects(service.load({ provider: 'claude', id: id(4) }), /does not say which folder/);
  await assert.rejects(service.load({ provider: 'claude', id: id(99) }), /no longer on this computer/);
  await assert.rejects(service.load({ provider: 'codex', id: 'x' }), /not available/);
  const bare = await setup(t, { persistence: false });
  await assert.rejects(bare.service.load({ provider: 'claude', id: id(1) }), /cannot store a loaded session/);
});

test('the HTTP face answers JSON actions and turns a failure into a plain error', async (t) => {
  const { service } = await setup(t);
  const post = (action: string, body: unknown) => service.handle(action, new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }));
  const listed = await post('list', { query: 'build' });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).sessions.length, 1);
  const failed = await post('load', { provider: 'claude', id: id(99) });
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /no longer on this computer/);
  assert.equal((await post('unknown', {})).status, 404);
});

test('which DSH session holds a native one is kept across restarts, privately', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'dudu-links-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const store = await createLinkStore(join(base, 'state'));
  store.record({ route: 'codex', nativeSessionId: 'thread-1', sessionId: 'session-1' });
  store.record({ route: 'codex', nativeSessionId: undefined, sessionId: 'session-2' });
  await store.flush();
  const reopened = await createLinkStore(join(base, 'state'));
  assert.equal(reopened.get('codex', 'thread-1'), 'session-1');
  assert.equal(reopened.get('codex', 'thread-2'), undefined);
  assert.equal(JSON.parse(await readFile(join(base, 'state', 'links.json'), 'utf8'))['codex:thread-1'].sessionId, 'session-1');
  assert.equal((await stat(join(base, 'state', 'links.json'))).mode & 0o777, 0o600);
  reopened.forget('codex', 'thread-1');
  await reopened.flush();
  assert.equal((await createLinkStore(join(base, 'state'))).get('codex', 'thread-1'), undefined);
  await writeFile(join(base, 'state', 'links.json'), '[1,2');
  assert.equal((await createLinkStore(join(base, 'state'))).get('codex', 'thread-1'), undefined, 'an unreadable file starts again instead of failing');
});

test('a conversation that keeps changing is read again for the search only once in a while, not each time it changes', async (t) => {
  let clock = Date.now();
  const { service, put } = await setup(t, { now: () => clock });
  await service.list();
  await service.settled();
  assert.equal((await service.list({ query: 'giraffe' })).sessions.length, 0);
  // The session is worked in: it changes, and the list is asked for again after the listing's own time to live.
  await put(1, [user('a', null, 'fix the failing build'), reply('b', 'a', 'm1', 'The zebra in the config was wrong.'), reply('c', 'b', 'm2', 'A giraffe in the lockfile too.'), { type: 'ai-title', aiTitle: 'Build repair' }]);
  clock += 30_000;
  await service.list();
  await service.settled();
  assert.equal((await service.list({ query: 'giraffe' })).sessions.length, 0, 'a big transcript is not read again seconds after it was');
  clock += 6 * 60_000;
  await service.list();
  await service.settled();
  assert.deepEqual((await service.list({ query: 'giraffe' })).sessions.map((session: any) => session.id), [id(1)], 'it is, once the wait is over');
});

test('a loaded session starts on the model the conversation really used, found by the alias that means it', async (t) => {
  const { service, stored, source, put } = await setup(t);
  (source.driver as any).listModels = async () => [
    { provider: 'claude', id: 'default', name: 'Default (recommended)', resolvedId: 'claude-sonnet-5-5' },
    { provider: 'claude', id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5' },
    { provider: 'claude', id: 'sonnet', name: 'Sonnet 5.5', resolvedId: 'claude-sonnet-5-5' },
  ];
  const withModel = (model: string) => reply('b', 'a', 'm1', 'done');
  const record = (model: string) => ({ ...withModel(model), message: { ...withModel(model).message, model } });
  await put(1, [user('a', null, 'fix the failing build'), record('claude-opus-5-5')]);
  const opus = stored.get((await service.load({ provider: 'claude', id: id(1) })).sessionId)!;
  assert.equal(opus.events.find((event: any) => event.type === 'model/selection').data.model, 'opus');
  await put(2, [user('a', null, 'explain quokkas to me'), record('claude-sonnet-5-5')]);
  const sonnet = stored.get((await service.load({ provider: 'claude', id: id(2) })).sessionId)!;
  assert.equal(sonnet.events.find((event: any) => event.type === 'model/selection').data.model, 'sonnet', 'the alias that is a choice, not default');
});

// Failed reads cannot restart on a clock or a list poll. Compressed rollouts are valid, and failed refreshes keep searchable text.
test('a failed Codex index stays stopped across rescans until an explicit refresh', async (t) => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (line: string) => { warnings.push(String(line)); };
  t.after(() => { console.warn = warn; });
  let answers = false;
  let starts = 0;
  let missingFile: string;
  let compressedFile: string;
  let missingReads = 0;
  let compressedReads = 0;
  let revision = 0;
  const thread = (threadId: string) => ({ id: threadId, preview: `preview ${threadId}`, name: null, cwd: '/work/app', ephemeral: false, parentThreadId: null, source: 'vscode', createdAt: 1_790_000_000, updatedAt: 1_790_000_100 + revision, model: 'gpt-x', gitInfo: null, path: threadId === 'missing' ? missingFile : threadId === 'compressed' ? compressedFile : null });
  const spawnProcess = () => {
    starts++;
    const child: any = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); };
    let buffer = '';
    child.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (message.id === undefined) continue;
        if (message.method === 'thread/read' && message.params.threadId === 'missing') missingReads++;
        if (message.method === 'thread/read' && message.params.threadId === 'compressed') compressedReads++;
        const result = message.method === 'thread/list' ? { data: [thread('big'), thread('missing'), thread('compressed')], nextCursor: null }
          : message.method === 'thread/read' ? (answers || message.params.threadId === 'compressed' ? { thread: { ...thread(message.params.threadId), turns: [{ id: 'turn', items: [{ type: 'agentMessage', text: 'retained searchable words' }] }] } } : new Error('rollout is too large'))
            : {};
        child.stdout.write(`${JSON.stringify(result instanceof Error ? { id: message.id, error: { message: result.message } } : { id: message.id, result })}\n`);
      }
    });
    return child;
  };
  let clock = Date.now();
  const { service, base } = await setup(t, { now: () => clock, codex: { id: 'codex', name: 'Codex', command: 'codex', spawnProcess } });
  missingFile = join(base, 'missing-rollout.jsonl');
  compressedFile = join(base, 'compressed-rollout.jsonl');
  const { zstdCompressSync } = await import('node:zlib');
  await writeFile(compressedFile + '.zst', zstdCompressSync('compressed transcript'));
  const reads = () => starts;
  await service.list();
  await service.settled();
  let list = await service.list();
  assert.deepEqual([list.indexing.running, list.indexing.unsearchable], [false, 2], 'both failed transcripts are counted');
  assert.equal(missingReads, 0, 'a missing rollout is rejected before any app-server read');
  assert.equal(compressedReads, 1, 'a .jsonl.zst sibling is read by the official app-server');
  assert.equal((await service.read({ provider: 'codex', id: 'compressed' })).messages[0].text, 'retained searchable words');
  assert.equal(compressedReads, 1, 'the ordered preview reuses its indexed text');
  assert.equal(list.unavailable, undefined, 'and that does not make the list "unavailable"');
  assert.equal(warnings.filter((line) => /codex:big/.test(line) && /rollout is too large/.test(line)).length, 1, 'the reason is logged, once');
  const after = reads();
  // listed again and again (every 15 seconds): no process is started for it
  for (let step = 0; step < 4; step++) { clock += 20_000; await service.list(); await service.settled(); }
  const listsOnly = reads() - after;
  assert.ok(listsOnly <= 4, 'only the listings start a process');
  assert.equal(warnings.filter((line) => /codex:big/.test(line)).length, 1, 'not tried, so not reported again');
  assert.equal((await service.list()).indexing.running, false);
  for (const elapsed of [11 * 60_000, 2 * 60 * 60_000, 24 * 60 * 60_000]) {
    clock += elapsed;
    await service.list();
    await service.settled();
  }
  assert.equal(warnings.filter((line) => /codex:big/.test(line)).length, 1, 'elapsed time cannot restart a failed read');
  answers = true;
  await writeFile(missingFile, 'restored');
  await service.list({ refresh: true });
  await service.settled();
  list = await service.list();
  assert.equal(list.indexing.unsearchable, 0, 'a refresh tried it at once, and it could be read');
  assert.equal(missingReads, 1, 'an explicit refresh can read a restored transcript');
  assert.equal((await service.list({ query: 'preview big' })).sessions.length, 1);
  answers = false;
  revision++;
  clock += 6 * 60_000;
  await service.list({ refresh: true });
  await service.settled();
  assert.equal((await service.list()).indexing.unsearchable, 0, 'a failed refresh does not make cached searchable text unavailable');
  assert.equal((await service.list({ query: 'retained searchable words', provider: 'codex' })).sessions.length, 3);
  void reads;
});

// The panel asks every five seconds, for the conversation that is open, whether the terminal has written anything new (`sessions/sync`). Reading the transcript is what
// costs: a conversation of 659 MB took five seconds of DSH's main thread a time, again and again for the whole of a turn, so that a message from the phone waited
// 3.9 seconds for DSH (owner, 2026-11-07: "why does it keep spinning"). A working agent is not even asked, and a put-off transcript is not read again for a minute.
test('the synchronization does not read the transcript of a session whose agent works, nor try a put-off one again for a minute', async (t) => {
  let time = Date.parse('2026-11-07T06:00:00.000Z');
  const { service, links, root, source, store, registry } = await setup(t, { now: () => time });
  const loaded = await service.load({ provider: 'claude', id: id(1) });
  const file = join(root, 'app', `${id(1)}.jsonl`);
  // The agent of the session as DSH has it: `status` is looked at once by the question whether it works and once more when the synchronization is really tried
  // (this stand-in cannot hold the session, so that the update is put off).
  let state = 'running';
  let looked = 0;
  const agent: Record<string, unknown> = { get status() { looked += 1; return state; } };
  const synchronizer = createNativeSessions({
    sources: () => [source], links, claude: { root }, persistence: () => store, workspaces: () => registry, now: () => time, agents: () => new Map([[loaded.sessionId, agent]]),
  });
  t.after(async () => { await synchronizer.close(); });
  await synchronizer.list();
  await synchronizer.settled(); // its own listing and its search index are read before anything is counted
  const reads: string[] = [];
  const original = fs.createReadStream;
  fs.createReadStream = ((path: unknown, ...rest: unknown[]) => { reads.push(String(path)); return (original as (...args: unknown[]) => unknown)(path, ...rest); }) as typeof fs.createReadStream;
  syncBuiltinESMExports();
  t.after(() => { fs.createReadStream = original; syncBuiltinESMExports(); });
  const transcriptReads = () => reads.filter((path) => path.endsWith(`${id(1)}.jsonl`)).length;
  let turns = 2;
  const picture = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } };
  const grow = async () => {
    turns += 1;
    // (the conversation of the owner has pictures in hundreds of turns: read once for its words and once more for them)
    const asked = { ...user(`u${turns}`, 'b', `question ${turns}`), message: { role: 'user', content: [{ type: 'text', text: `question ${turns}` }, picture] } };
    await writeFile(file, (await readFile(file, 'utf8')) + lines([asked, reply(`r${turns}`, `u${turns}`, `m${turns}`, `answer ${turns}`)]));
    await utimes(file, new Date(time), new Date(time)); // (the stamp moves with the size and the time)
  };
  const ask = async (extra: Record<string, unknown> = {}) => synchronizer.sync({ sessionIds: [loaded.sessionId], ...extra });
  const lookedAtBy = async (extra: Record<string, unknown> = {}) => { const before = looked; await ask(extra); return looked - before; };

  // The agent works and the transcript grows: it is asked about again and again, and nothing is read.
  for (let step = 0; step < 4; step++) { await grow(); time += 1000; assert.deepEqual(await ask(), { updated: [] }); }
  assert.equal(transcriptReads(), 0, 'a working agent: the transcript was not read');
  assert.deepEqual(await ask({ fresh: true }), { updated: [] });
  assert.equal(transcriptReads(), 0, 'not even when it is asked for at once: the answer would be the same');

  // The agent is idle, but this DSH cannot be synchronized into (the stand-in cannot hold the session): the transcript is read (once for its words, once for its
  // pictures) and the synchronization is tried once, and waiting does not change it, so it is not tried again for ten minutes.
  state = 'idle';
  await grow(); time += 1000;
  assert.equal(await lookedAtBy(), 2, 'tried: the agent was asked about twice (is it working, then the synchronization itself)');
  const first = transcriptReads();
  assert.ok(first >= 2, `the transcript was read, for its words and for its pictures (${first})`);
  for (let step = 0; step < 5; step++) { time += 5000; assert.equal(await lookedAtBy(), 1, 'put off: only asked whether it works'); }
  time += 40_000;
  assert.equal(await lookedAtBy(), 1, 'a minute on it is still not tried: this DSH cannot be synchronized into');
  assert.equal(transcriptReads(), first, 'and not read again');
  // Somebody asks for it at once, or the transcript grew: read.
  await ask({ fresh: true });
  assert.ok(transcriptReads() > first, 'asked for at once, it is read');
  const second = transcriptReads();
  await grow(); time += 1000;
  assert.equal(await lookedAtBy(), 2, 'a transcript that grew is tried at once, not held back');
  assert.ok(transcriptReads() > second, 'and read');
  // Ten minutes on, an unchanged transcript is tried again, and read again (what was read has been kept for two).
  const third = transcriptReads();
  time += 601_000;
  assert.equal(await lookedAtBy(), 2, 'ten minutes later it is tried again');
  assert.ok(transcriptReads() > third, 'and what was read is gone: the unchanged transcript is read again');

  // A put-off that is only for the moment (the session is being held by something else) is tried again after a minute.
  Object.assign(agent, { runMaintenance: () => undefined, phase: { kind: 'maintenance' } });
  await grow(); time += 1000;
  assert.equal(await lookedAtBy(), 2, 'a changed transcript is tried once');
  time += 30_000;
  assert.equal(await lookedAtBy(), 1, 'not within the minute');
  time += 31_000;
  assert.equal(await lookedAtBy(), 2, 'and a minute later it is');
});
