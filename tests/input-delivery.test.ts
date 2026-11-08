import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyzeRequest, createHarnessAdapter, HarnessBridge, harnessError } from '../host/providers/harness-bridge.mjs';
import { admittedLink, createInputDelivery, createInputJournal, INPUT_DELIVERY, undeliveredInputs, withInputDeliveries } from '../host/providers/input-delivery.mjs';
import { AsyncQueue } from '../host/providers/async.mjs';

const user = (id: string, text: string, extra: any[] = []) => ({
  id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }, ...extra],
});
const prompt = (message: any) => message.role === 'user' && message.source?.kind === 'user';
const receipt = (messageIds: string[], state: string, provider = 'claude', nativeSessionId = 'native-1') => ({
  type: INPUT_DELIVERY, data: { version: 1, provider, messageIds, state, nativeSessionId, attemptId: 'attempt' },
});
function turn(n: number, messages: any[], records: any[] = [], reason: any = { kind: 'completed' }, provider = 'claude') {
  return [
    { type: 'turn/start', data: { turn: n } },
    { type: 'request/header', data: { header: { config: { provider } } } },
    ...messages.map(data => ({ type: 'user/message', data })),
    ...records,
    { type: 'turn/end', data: { turn: n, reason } },
  ];
}
const unavailable = { kind: 'error', error: { code: 'HARNESS_UNAVAILABLE' } };

test('unaccepted inputs survive repeated startup failures in original order with their attachments', () => {
  const image = { type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/png' } };
  const first = user('u1', 'Plan the DELs.', [image]);
  const second = user('u2', 'Include the two completed DELs.');
  const latest = user('u3', '继续');
  const events = [
    ...turn(1, [first], [receipt(['u1'], 'preparing'), receipt(['u1'], 'undelivered')], unavailable),
    ...turn(2, [second], [receipt(['u1', 'u2'], 'preparing'), receipt(['u1', 'u2'], 'undelivered')], unavailable),
    ...turn(3, [latest]).slice(0, -1),
  ];
  const request = analyzeRequest([first, second, latest], 'claude', events);
  assert.deepEqual(request.prompts, [first, second, latest]);
  assert.equal(request.promptText, 'Plan the DELs.\n\nInclude the two completed DELs.\n\n继续');
  assert.equal(request.prompts[0].content[1], image);
  assert.deepEqual(analyzeRequest([latest], 'claude', events).prompts, [first, second, latest],
    'the durable original input is recovered even if a host omits failed messages from model history');
});

test('historical startup failures are recovered only when their provider and pre-submission failure are known', () => {
  const first = user('u1', 'Original task.');
  for (const provider of ['claude', 'codex']) {
    assert.deepEqual(undeliveredInputs(turn(1, [first], [], unavailable, provider), provider, prompt), [first]);
    assert.deepEqual(undeliveredInputs(turn(1, [first], [], unavailable, 'other'), provider, prompt), []);
    for (const code of ['HARNESS_FAILED', 'HARNESS_REJECTED', 'UNKNOWN', 'HARNESS_EXITED']) {
      assert.deepEqual(undeliveredInputs(turn(1, [first], [], { kind: 'error', error: { code } }, provider), provider, prompt), []);
    }
    assert.deepEqual(undeliveredInputs(turn(1, [first], [{ type: 'tool/call', data: {} }], unavailable, provider), provider, prompt), []);
  }
  const unchangedHeader = [
    ...turn(1, [user('before', 'Earlier task.')]),
    ...turn(2, [first], [], unavailable).filter(event => event.type !== 'request/header'),
  ];
  assert.deepEqual(undeliveredInputs(unchangedHeader, 'claude', prompt), [first],
    'DSH need not repeat an unchanged request header each turn');
});

test('accepted and uncertain inputs are not replayed, including a failure before any assistant output', () => {
  const original = user('u1', 'Do the work.');
  for (const state of ['submitting', 'accepted']) {
    const events = turn(1, [original], [receipt(['u1'], 'preparing'), receipt(['u1'], state)], unavailable);
    assert.deepEqual(undeliveredInputs(events, 'claude', prompt), []);
  }
  const old = turn(1, [original], [], unavailable);
  for (const next of [
    turn(2, [user('u2', 'An intervening task.')]),
    turn(2, [user('u2', 'An ambiguous retry.')], [receipt(['u1', 'u2'], 'submitting')], unavailable),
    turn(2, [user('u2', 'Switch provider.')], [], unavailable, 'codex'),
  ]) assert.deepEqual(undeliveredInputs([...old, ...next], 'claude', prompt), [],
    'old instructions must not run unexpectedly after an intervening task or provider switch');
});

test('explicit stop discards pending recovery even when opening had not yet submitted any input', () => {
  const original = user('u1', 'Cancelled work.');
  const failed = turn(1, [original], [receipt(['u1'], 'undelivered')], unavailable);
  const stopped = turn(2, [user('u2', 'Retry.')], [receipt(['u1', 'u2'], 'preparing')], {
    kind: 'aborted', reason: { kind: 'user' },
  });
  assert.deepEqual(undeliveredInputs([...failed, ...stopped], 'claude', prompt), []);
});

test('native identity is retained before output and preserves previously observed child identities', () => {
  const previous = { harness: 'claude', nativeSessionId: 'native-1', nativeSubagents: [{ taskId: 'child-1' }] };
  assert.deepEqual(admittedLink([receipt(['u1'], 'accepted')], 'claude', previous), previous);
  assert.equal(admittedLink([receipt(['u1'], 'submitting')], 'claude', undefined), undefined);
  assert.equal(admittedLink([receipt(['u1'], 'accepted', 'codex')], 'claude', undefined), undefined);
  assert.deepEqual(admittedLink([receipt(['u1'], 'accepted', 'claude', 'native-2')], 'claude', previous),
    { harness: 'claude', nativeSessionId: 'native-2' });
  const imported = (id: string, nativeSubagents?: any[]) => ({
    type: 'assistant/message', data: { message: { source: { provider: 'claude', replayState: {
      harness: 'claude', nativeSessionId: id, ...(nativeSubagents ? { nativeSubagents } : {}),
    } } } },
  });
  assert.deepEqual(admittedLink([imported('native-1', previous.nativeSubagents), imported('native-1')], 'claude'), previous,
    'native sync must not erase child lineage from an earlier observation of the same native session');
  assert.deepEqual(admittedLink([imported('native-2')], 'claude', previous), { harness: 'claude', nativeSessionId: 'native-2' });
});

test('only unsubmitted steering is carried after an otherwise accepted turn', () => {
  const first = user('u1', 'Task.');
  const second = user('u2', 'Steering that was refused.');
  const third = user('u3', 'Input after the final adapter step.');
  const events = turn(1, [first, second, third], [
    receipt(['u1'], 'accepted'), receipt(['u2'], 'submitting'), receipt(['u2'], 'undelivered'),
  ]);
  assert.deepEqual(undeliveredInputs(events, 'claude', prompt), [second, third]);
  events.push(...turn(2, [user('u4', 'Continue.')], [receipt(['u2', 'u3', 'u4'], 'accepted')]));
  assert.deepEqual(undeliveredInputs(events, 'claude', prompt), [], 'recovery is consumed by admission, not by model success');
});

test('the delivery journal flushes intent before submission and never makes an uncertain write retryable', async () => {
  const first = user('u1', 'Original task.');
  const events = turn(1, [first]).slice(0, -1);
  const entries: any[] = [];
  const order: string[] = [];
  const session = { snapshotEvents: () => events, get seq() { return events.length; } };
  const delivery = createInputDelivery({
    session, flushSession: async () => { order.push('flush'); }, provider: 'claude', prompts: [first],
    write: async (entry: any) => { entries.push(entry); order.push(entry.state); },
  });
  await delivery.prepare();
  await delivery.record({ state: 'submitting', nativeSessionId: 'native-1' });
  await delivery.failed();
  assert.deepEqual(entries.map(entry => entry.state), ['preparing', 'submitting']);
  await delivery.accepted('native-1');
  await delivery.accepted('native-1');
  assert.equal(entries.length, 3);
  assert.deepEqual(order, ['flush', 'preparing', 'submitting', 'accepted']);
  assert.equal(new Set(entries.map(entry => entry.attemptId)).size, 1);
  assert.deepEqual(entries[0].messageIds, ['u1']);
  assert.equal(entries[0].turn, 1);
  assert.equal(entries[0].afterSeq, events.length - 1);
  assert.equal(events.some(event => event.type === INPUT_DELIVERY), false, 'private receipts never enter the DSH log');
  assert.equal(JSON.stringify(entries).includes('Original task.'), false, 'receipts refer to existing messages, not another copy of private content');
});

test('private receipts survive journal recreation, serialize writes and isolate providers and sessions', async context => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-input-journal-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const journal = createInputJournal(join(folder, 'receipts'));
  const entry = { version: 1, provider: 'claude', attemptId: 'a1', messageIds: ['u1'], state: 'preparing', turn: 1, afterSeq: 2 };
  await Promise.all([
    journal.record('claude', 'session-1', entry),
    journal.record('claude', 'session-1', { ...entry, state: 'submitting' }),
    journal.record('claude', 'session-1', { ...entry, attemptId: 'a2', messageIds: ['u2'] }),
    journal.record('claude', 'session-1', { ...entry, state: 'accepted', nativeSessionId: 'native-1' }),
    journal.record('codex', 'session-1', { ...entry, provider: 'codex' }),
  ]);
  const restored = createInputJournal(join(folder, 'receipts'));
  const entries = await restored.read('claude', 'session-1');
  assert.equal(entries.length, 2);
  assert.equal(entries.find((item: any) => item.attemptId === 'a1').state, 'accepted');
  assert.equal(entries.find((item: any) => item.attemptId === 'a2').state, 'preparing');
  assert.equal((await restored.read('codex', 'session-1'))[0].provider, 'codex');
  assert.deepEqual(await restored.read('claude', 'session-2'), []);
  entries[0].messageIds.push('mutated');
  assert.equal(JSON.stringify(await restored.read('claude', 'session-1')).includes('mutated'), false);
  const files = await readdir(join(folder, 'receipts'));
  assert.equal(files.length, 2);
  for (const file of files) {
    assert.match(file, /^[a-f0-9]{64}\.json$/);
    assert.equal((await stat(join(folder, 'receipts', file))).mode & 0o777, 0o600);
    assert.ok(Array.isArray(JSON.parse(await readFile(join(folder, 'receipts', file), 'utf8'))));
  }
  assert.equal((await stat(join(folder, 'receipts'))).mode & 0o777, 0o700);
});

test('failed journal reads and writes do not cache phantom admission or prevent a later durable retry', async context => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-input-journal-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'receipts');
  await writeFile(path, 'block directory access');
  const journal = createInputJournal(path);
  const entry = { version: 1, provider: 'claude', attemptId: 'a1', messageIds: ['u1'], state: 'preparing', turn: 1, afterSeq: 2 };
  await assert.rejects(journal.read('claude', 's1'), { code: 'ENOTDIR' });
  await assert.rejects(journal.record('claude', 's1', entry), { code: 'ENOTDIR' });
  await rm(path);
  await journal.record('claude', 's1', entry);
  await rm(path, { recursive: true });
  await writeFile(path, 'block write');
  await assert.rejects(journal.record('claude', 's1', { ...entry, state: 'accepted' }));
  assert.deepEqual(await journal.read('claude', 's1'), [entry]);
  await rm(path);
  await journal.record('claude', 's1', { ...entry, state: 'submitting' });
  assert.equal((await createInputJournal(path).read('claude', 's1'))[0].state, 'submitting');
  assert.equal((await readdir(path)).length, 1, 'failed writes leave no temporary receipt');
});

test('private receipts join only their owning turn without mutating DSH history or replaying an admitted retry', () => {
  const first = user('u1', 'Original.');
  const second = user('u2', '继续');
  const events = [...turn(1, [first], [], unavailable), ...turn(2, [second])];
  const entries = [
    { ...receipt(['u1'], 'undelivered').data, turn: 1, afterSeq: 200 },
    { ...receipt(['u1', 'u2'], 'accepted').data, attemptId: 'retry', turn: 2, afterSeq: 6 },
    { ...receipt(['missing'], 'undelivered').data, attemptId: 'unrelated', turn: 99, afterSeq: 0 },
  ];
  const joined = withInputDeliveries(events, entries);
  assert.equal(joined.filter((event: any) => event.type === INPUT_DELIVERY).length, 2);
  assert.deepEqual(undeliveredInputs(joined, 'claude', prompt), []);
  assert.equal(events.some(event => event.type === INPUT_DELIVERY), false);
  assert.equal('seq' in events[0], false);
  assert.equal(admittedLink(joined, 'claude')?.nativeSessionId, 'native-1');
});

test('a late native acknowledgement remains attached to its original input turn', async () => {
  const events = turn(1, [user('u1', 'Task.')]).slice(0, -1);
  const entries: any[] = [];
  const delivery = createInputDelivery({
    session: { snapshotEvents: () => events, get seq() { return events.length; } },
    provider: 'claude', prompts: [user('u1', 'Task.')], write: async (entry: any) => { entries.push(entry); },
  });
  await delivery.prepare();
  events.push(...turn(2, [user('u2', 'New task.')]));
  await delivery.accepted('native-1');
  assert.deepEqual(entries.map(entry => entry.turn), [1, 1]);
});

test('the bridge recovers input after failed opening across recreation and records admission without assistant text', async context => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-input-bridge-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const first = user('u1', 'Complete instruction.');
  const second = user('u2', '继续');
  const events = turn(1, [first]).slice(0, -1);
  const session = {
    header: { cwd: '/project' },
    snapshotEvents: () => events, get seq() { return events.length; },
  };
  let attempt = 0;
  const inputs: any[] = [];
  const output = new AsyncQueue();
  const admitted = Promise.withResolvers<void>();
  const driver = {
    id: 'claude', name: 'Claude', route: 'claude',
    async start(options: any) {
      inputs.push(options);
      if (attempt++ === 0) throw harnessError('Could not start Claude: initialize timed out', 'HARNESS_UNAVAILABLE');
      await options.onInput({ state: 'submitting', nativeSessionId: options.resume ?? 'native-new' });
      await options.onInput({ state: 'accepted', nativeSessionId: options.resume ?? 'native-new' });
      admitted.resolve();
      return {
        nativeSessionId: options.resume ?? 'native-new',
        events: { async *[Symbol.asyncIterator]() { for (;;) { const next = await output.next(); if (next.done) return; yield next.value; } } },
        async close() { output.close(); },
      };
    },
  };
  const bridge = () => new HarnessBridge({
    driver, agentOf: () => ({ session }), eventsOf: async () => events, flushSession: async () => {},
    inputJournal: createInputJournal(folder),
  });
  const read = async (adapter: any, messages: any[]) => {
    const chunks = [];
    for await (const chunk of adapter.stream({ sessionId: 's1', messages })) chunks.push(chunk);
    return chunks;
  };
  const failed = await read(createHarnessAdapter(bridge()), [first]);
  assert.equal(failed.at(-1).reason.failure.code, 'HARNESS_UNAVAILABLE');
  assert.equal(inputs.length, 1, 'there is no automatic retry');
  events.push({ type: 'turn/end', data: { turn: 1, reason: unavailable } }, ...turn(2, [second]).slice(0, -1));
  const restored = bridge();
  context.after(() => restored.dispose());
  const next = read(createHarnessAdapter(restored), [first, second]);
  await admitted.promise;
  assert.equal(inputs[1].prompt, 'Complete instruction.\n\n继续');
  output.push({ type: 'turn-end', ok: false, error: harnessError('Model failed.', 'HARNESS_FAILED') });
  assert.equal((await next).at(-1).reason.failure.code, 'HARNESS_FAILED');
  events.push({ type: 'turn/end', data: { turn: 2, reason: { kind: 'error', error: { code: 'HARNESS_FAILED' } } } });
  const history = await restored.historyOf('s1');
  assert.deepEqual(undeliveredInputs(history, 'claude', prompt), []);
  assert.equal(admittedLink(history, 'claude', undefined)?.nativeSessionId, 'native-new');
  assert.equal(events.some(event => event.type === INPUT_DELIVERY), false);
});
