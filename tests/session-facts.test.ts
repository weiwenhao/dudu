import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionFacts, sessionFacts } from '../host/assistant/home/session-facts.mjs';
import { createCachedContentIndex } from '../host/providers/native/cached-content-index.mjs';

const header = { id: 'one', version: 4, cwd: '/work', createdAt: 1 };
const message = (type: string, seq: number, text: string) => ({
  type, seq, time: seq + 1, data: { message: { content: [{ type: 'text', text }], source: { kind: type === 'user/message' ? 'user' : 'model' } } },
});
const savedEvents = [
  { type: 'session/title', seq: 0, time: 1, data: { title: 'Saved work' } },
  { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
  message('user/message', 2, 'Question'),
  message('assistant/message', 3, 'Answer'),
  { type: 'tool/result', seq: 4, data: { message: { content: [{ type: 'text', text: 'large tool output'.repeat(100_000) }] } } },
  { type: 'turn/end', seq: 5, time: 6, data: { reason: { kind: 'completed' } } },
];

test('small session facts exclude tool payloads and never inherit an earlier turn ending', () => {
  assert.deepEqual(sessionFacts(savedEvents), {
    title: { title: 'Saved work', seq: 0, at: 1 },
    lastTurn: { last: 'answer', at: 6, ending: 'Answer' },
    latest: { me: { text: 'Question', at: 3 }, agent: { text: 'Answer', at: 4 } },
  });
  const open = [...savedEvents, { type: 'turn/start', seq: 6, time: 7 }, message('user/message', 7, 'Next question')];
  assert.deepEqual(sessionFacts(open).lastTurn, { last: 'aborted', at: 7 });
  assert.equal(sessionFacts([...open, { type: 'turn/end', seq: 8, time: 9, data: { reason: { kind: 'error', error: { message: 'failed' } } } }]).lastTurn.error, 'failed');
  assert.deepEqual(sessionFacts([]), { title: null, lastTurn: { last: null, at: null }, latest: {} });
});

test('exact session facts survive restart, share one cold read, and invalidate on either revision or lifecycle changes', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-session-facts-'));
  const file = join(folder, 'search.sqlite');
  const journal = join(folder, 'session.jsonl');
  await writeFile(journal, 'source revision 1');
  let revision = 'r1';
  let currentHeader = header;
  let events = savedEvents;
  let reads = 0;
  let cache = createCachedContentIndex({ file });
  const storage = {
    stat: async () => ({ header: currentHeader, revision, location: { kind: 'jsonl', path: journal } }),
  };
  const create = () => createSessionFacts({
    cache, live: () => undefined,
    persistence: () => storage,
    read: async () => { reads++; return { header: currentHeader, events, source: 'prepared', revision }; },
  });
  let facts = create();
  t.after(async () => { await facts.close(); await cache.close(); await rm(folder, { recursive: true, force: true }); });
  const first = await Promise.all([facts.read('one'), facts.read('one'), facts.read('one')]);
  assert.equal(reads, 1, 'title, last turn and last messages use one immutable source cut');
  assert.deepEqual(first[0], first[2]);
  assert.ok(JSON.stringify(first[0]).length < 1024, 'the metadata does not retain tool output');
  await facts.close();
  await cache.close();
  revision = 'new-service-token';
  cache = createCachedContentIndex({ file });
  facts = create();
  assert.deepEqual(await facts.read('one'), first[0]);
  assert.equal(reads, 1, 'a restart uses physical identity, without comparing opaque tokens across service instances');
  revision = 'r2';
  await writeFile(journal, 'source revision 2');
  events = [...events, { type: 'session/title', seq: 6, time: 7, data: { title: 'Renamed' } }];
  assert.equal((await facts.read('one')).title.title, 'Renamed');
  assert.equal(reads, 2);
  currentHeader = { ...header, createdAt: 900 };
  assert.equal((await facts.read('one')).title.title, 'Renamed');
  assert.equal(reads, 3, 'a reused id must not reuse a different journal lifecycle');
  const cached = await cache.metadata('session-facts:v1:one');
  await cache.saveMetadata('session-facts:v1:one', { ...cached, facts: { ...cached.facts, lastTurn: { last: 'invalid', at: 0 } } });
  await facts.close();
  facts = create();
  assert.equal((await facts.read('one')).lastTurn.last, 'answer');
  assert.equal(reads, 4, 'malformed derived metadata cannot become execution state');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('a live Session supersedes disk facts, advances with its cursor, and a cancelled observer cannot cancel another reader', async () => {
  const cache = createCachedContentIndex();
  let source: any = undefined;
  let reads = 0;
  let wait: Promise<any> | undefined;
  const facts = createSessionFacts({
    cache, live: () => source,
    persistence: () => ({ stat: async () => ({ header, revision: 'disk' }) }),
    read: async () => {
      reads++;
      if (wait) return wait;
      return { header, events: savedEvents, source: source ? 'live' : 'prepared', revision: 'disk' };
    },
  });
  try {
    await facts.read('one');
    source = { seq: 6 };
    await facts.read('one');
    await facts.read('one');
    assert.equal(reads, 2, 'live reads have their own cursor-based cache');
    source.seq++;
    const pending = Promise.withResolvers<any>();
    wait = pending.promise;
    const abort = new AbortController();
    const cancelled = facts.read('one', abort.signal);
    const other = facts.read('one');
    abort.abort(new Error('closed preview'));
    await assert.rejects(cancelled, /closed preview/);
    pending.resolve({ header, source: 'live', events: [...savedEvents, message('assistant/message', 6, 'New answer')] });
    assert.equal((await other).latest.agent.text, 'New answer');
    assert.equal(reads, 3);
  } finally { await facts.close(); await cache.close(); }
});

test('a journal that changes during reading or has no exact revision never becomes a durable facts entry', async () => {
  const cache = createCachedContentIndex();
  let reads = 0;
  let exact = false;
  const facts = createSessionFacts({
    cache, live: () => undefined,
    persistence: () => ({ stat: async () => ({ header, revision: 'r2' }) }),
    read: async () => { reads++; return { header, events: savedEvents, ...(exact ? { source: 'prepared', revision: 'r1' } : {}) }; },
  });
  try {
    await facts.read('one');
    exact = true;
    await facts.read('one');
    await facts.read('one');
    assert.equal(reads, 3);
    assert.equal(await cache.metadata('session-facts:v1:one'), null);
  } finally { await facts.close(); await cache.close(); }
});
