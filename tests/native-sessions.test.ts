import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLinkStore, createNativeSessions, metadataWeight, termsOf } from '../host/providers/native/index.mjs';

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
async function setup(t: { after: (cleanup: () => Promise<void>) => void }, { persistence = true, now }: { persistence?: boolean; now?: () => number } = {}) {
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
    sources: () => [source], links, claude: { root }, persistence: () => (persistence ? store : undefined), workspaces: () => registry, ...(now ? { now } : {}),
  });
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
  const { service, stored, put } = await setup(t);
  const original = [user('a', null, 'sync this'), reply('b', 'a', 'm1', 'first answer')];
  await put(5, original);
  const first = await service.load({ provider: 'claude', id: id(5) });
  await put(5, [...original, user('c', 'b', 'continue'), reply('d', 'c', 'm2', 'new TUI answer')]);
  const updated = await service.load({ provider: 'claude', id: id(5) });
  assert.equal(updated.sessionId, first.sessionId);
  assert.equal(updated.updated, true);
  const entry = stored.get(first.sessionId)!;
  assert.equal(entry.events.filter((event: any) => event.type === 'user/message').length, 2);
  assert.ok(JSON.stringify(entry.events).includes('new TUI answer'));
  const length = entry.events.length;
  await service.load({ provider: 'claude', id: id(5) });
  assert.equal(entry.events.length, length);
  assert.ok(entry.events.every((event: any, index: number) => event.seq === index));
});

test('opening restores a missing native link from durable identity and synchronizes the same DSH session', async (t) => {
  const { service, stored, links, root, put, source, store, registry } = await setup(t);
  const original = [user('u1', null, 'first'), reply('a1', 'u1', 'm1', 'first answer')];
  await put(5, original);
  const { sessionId } = await service.load({ provider: 'claude', id: id(5) });
  links.forget('claude', id(5));
  await put(5, [...original, user('u2', 'a1', 'second'), reply('a2', 'u2', 'm2', 'external answer')]);
  const restored = createNativeSessions({
    sources: () => [source], links, claude: { root }, persistence: () => store, workspaces: () => registry,
    controller: () => ({ inspect: async (target: string) => stored.get(target) }),
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
