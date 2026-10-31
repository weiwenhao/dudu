import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
async function setup(t: { after: (cleanup: () => Promise<void>) => void }, { persistence = true } = {}) {
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
    sources: () => [source], links, claude: { root }, persistence: () => (persistence ? store : undefined), workspaces: () => registry,
  });
  return { service, stored, attached, links, base, root, put, source };
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
  assert.deepEqual(assistant.data.message.source.replayState, { harness: 'claude', nativeSessionId: id(1) });
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
