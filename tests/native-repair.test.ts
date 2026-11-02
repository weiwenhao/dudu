import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLinkStore } from '../host/providers/native/index.mjs';
import { createImportRepair, hasImportedContinuations, hasMissingImportedHead } from '../host/providers/native/repair.mjs';
import { buildSessionEvents } from '../host/providers/native/session-events.mjs';

const history = {
  id: 'native-1', cwd: '/work', createdAt: 1000, title: 'Original',
  turns: [{ prompt: 'Work on this.', at: 1000, endedAt: 5000, steps: [{ at: 5000, blocks: [{ type: 'text', text: 'Done.' }] }], results: new Map() }],
};
const initial = buildSessionEvents({ history, route: 'codex', model: 'gpt-5.5', effort: 'high', sessionId: 'old', title: 'Custom title' });
const continuation = buildSessionEvents({
  history: { ...history, turns: [{ ...history.turns[0], continuation: true }] },
  route: 'codex', model: 'gpt-5.5', sessionId: 'old', configure: false, offset: initial.events.length, turnOffset: 1,
});
const corrupted = [...initial.events, ...continuation.events];

test('only import-only continuation logs are eligible; real requests, user inbox events and another native identity prevent repair', () => {
  assert.equal(hasImportedContinuations(corrupted, 'codex', history.id), true);
  assert.equal(hasImportedContinuations([...corrupted, { type: 'session/end-seed', data: {} }], 'codex', history.id), true);
  assert.equal(hasImportedContinuations(initial.events, 'codex', history.id), false);
  assert.equal(hasImportedContinuations(corrupted, 'codex', 'someone-else'), false);
  for (const type of ['request/header', 'inbox/received', 'future/event']) {
    assert.equal(hasImportedContinuations([...corrupted, { type }], 'codex', history.id), false);
  }
});

function withoutHead(events: any[]) {
  const head = events.find((event) => event.type === 'system/message')!.seq;
  return events.filter((event) => event.seq !== head).map((event, seq) => ({ ...event, seq }));
}

test('a legacy import without a system head is eligible only while it contains no real DSH work', () => {
  const old = withoutHead(initial.events);
  assert.equal(hasMissingImportedHead(old, 'codex', history.id), true);
  assert.equal(hasMissingImportedHead(initial.events, 'codex', history.id), false);
  assert.equal(hasMissingImportedHead(old, 'claude', history.id), false);
  for (const type of ['request/header', 'agent/inbox/spliced', 'developer/message', 'future/event']) {
    assert.equal(hasMissingImportedHead([...old, { type }], 'codex', history.id), false);
  }
  const realSystem = structuredClone(corrupted);
  realSystem.find((event) => event.type === 'system/message')!.data.message.content.push({ type: 'text', text: 'Real runtime instructions' });
  assert.equal(hasImportedContinuations(realSystem, 'codex', history.id), false);
});

async function setup(t: any, options: { rebind?: any; archive?: any; running?: boolean; race?: boolean } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-repair-'));
  const links = await createLinkStore(folder);
  links.record({ route: 'codex', nativeSessionId: history.id, sessionId: 'old' });
  await links.flush();
  t.after(async () => { await links.flush(); await rm(folder, { recursive: true, force: true }); });
  const stored = new Map<string, any>([['old', { header: initial.header, events: [...corrupted] }]]);
  const archived = new Set<string>();
  const attached: string[] = [];
  let reads = 0;
  const repair = createImportRepair({
    links, rebind: options.rebind,
    agents: () => options.running ? { get: () => ({ status: 'running' }) } : undefined,
    controller: () => ({ inspect: async (id: string) => {
      const entry = stored.get(id);
      if (options.race && ++reads === 2) entry.events.push({ type: 'request/header' });
      return { header: entry.header, events: [...entry.events] };
    } }),
    workspaces: () => ({
      create: async () => ({ id: 'workspace', attachSession: async (id: string) => { attached.push(id); } }),
      archiveSession: async (id: string) => { await options.archive?.(id); archived.add(id); },
      unarchiveSession: async (id: string) => { archived.delete(id); },
    }),
    persistence: () => ({
      create: async (header: any) => {
        const entry = { header, events: [] as any[] };
        stored.set(header.id, entry);
        return { append: async (events: any[]) => entry.events.push(...events), flush: async () => {}, close: async () => {} };
      },
    }),
  });
  return { run: () => repair({ sessionId: 'old', history, route: 'codex' }), stored, archived, attached, links, folder };
}

test('rebuilding preserves the old log and selected model, rebinds the issue, and persists one visible native mapping', async (t) => {
  const rebound: any[] = [];
  const w = await setup(t, { rebind: async (...args: any[]) => { rebound.push(args); } });
  w.stored.get('old').events.push({ type: 'permission/preset', data: { preset: 'read-only' } }, { type: 'sandbox/mode', data: { mode: 'read-only' } });
  const before = [...w.stored.get('old').events];
  const result = await w.run();
  assert.ok(result?.repaired);
  assert.deepEqual(rebound, [['old', result.sessionId]]);
  assert.deepEqual(w.stored.get('old').events, before, 'the old append-only log is untouched');
  assert.ok(w.archived.has('old'));
  const events = w.stored.get(result.sessionId).events;
  assert.equal(events.filter((event: any) => event.type === 'turn/start').length, 1);
  assert.deepEqual(events.find((event: any) => event.type === 'model/selection').data, { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' });
  assert.equal(events.find((event: any) => event.type === 'session/title').data.title, 'Custom title');
  assert.deepEqual(events.find((event: any) => event.type === 'permission/preset').data, { preset: 'read-only' });
  assert.deepEqual(events.find((event: any) => event.type === 'sandbox/mode').data, { mode: 'read-only' });
  assert.equal(w.links.get('codex', history.id), result.sessionId);
  assert.equal(w.links.removed('old'), true);
  const restored = await createLinkStore(w.folder);
  assert.equal(restored.get('codex', history.id), result.sessionId);
  assert.equal(restored.hidden('codex', history.id), false);
});

test('a legacy import gains a protected head before it can be continued, retaining the old copy in the archive', async (t) => {
  const w = await setup(t);
  const old = withoutHead(initial.events);
  w.stored.get('old').events = old;
  const result = await w.run();
  assert.ok(result?.repaired);
  assert.ok(w.archived.has('old'));
  assert.deepEqual(w.stored.get('old').events, old);
  const repaired = w.stored.get(result.sessionId).events;
  assert.equal(repaired.find((event: any) => event.surfaceOp)?.type, 'system/message');
  assert.equal(hasMissingImportedHead(repaired, 'codex', history.id), false);
});

test('running work is not repaired; a session changed during the rebuild retains its original identity', async (t) => {
  const busy = await setup(t, { running: true });
  assert.equal(await busy.run(), null);
  assert.equal(busy.stored.size, 1);
  const changed = await setup(t, { race: true });
  assert.equal(await changed.run(), null);
  assert.equal(changed.links.get('codex', history.id), 'old');
  assert.equal(changed.archived.has('old'), false);
  assert.equal(changed.archived.size, 1, 'only the unused rebuilt copy is archived');
});

test('an archival or rebind failure preserves the old mapping and restores visibility', async (t) => {
  for (const options of [
    { archive: async (id: string) => { if (id === 'old') throw new Error('active'); } },
    { rebind: async () => { throw new Error('store failed'); } },
  ]) {
    const w = await setup(t, options);
    await assert.rejects(w.run(), /active|store failed/);
    assert.equal(w.links.get('codex', history.id), 'old');
    assert.equal(w.links.removed('old'), false);
    assert.equal(w.archived.has('old'), false);
    assert.equal(w.archived.size, 1);
  }
});
