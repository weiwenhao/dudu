import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeAssistant } from '../host/native-assistant.mjs';

function harness(overrides = {}, readSession?) {
  const calls = [];
  const assistant = {
    state: () => ({ sessionId: 'dudu-owned' }),
    issues: async (action, body) => {
      calls.push([action, body]);
      if (action === 'recipients') return { outcome: 'success', items: [{
        id: 7, ref: 'DUD-7', title: 'Routing', agent: 'codex', session: 'dsh:agent',
        project: { name: 'dudu', path: '/private/project', key: 'DUD' },
      }] };
      if (action === 'resume') return { outcome: 'success', sessionId: 'agent', issue: { session: 'dsh:agent' } };
      return { outcome: 'success', issue: { id: 7, ref: 'DUD-7', title: 'Routing' } };
    },
    ...overrides,
  };
  const bridge = createNativeAssistant({
    assistant,
    remote: { call: async (endpoint, ...args) => {
      calls.push([endpoint, ...args]);
      return endpoint === 'skills/list' ? { skills: [
        { name: 'visible', description: 'DSH skill' }, { name: 'hidden', userInvocable: false },
      ] } : { receiptId: 'target-receipt' };
    } },
    fail: (code) => { throw Object.assign(new Error(code), { code }); },
    attachments: (items) => (items ?? []).map((item) => ({ type: 'image', ...item })),
    fileBytes: (data) => Buffer.from(data ?? '', 'base64'),
    readSession,
  });
  return { bridge, calls };
}

test('assistant completions are scoped to the fixed session and use DSH skills and issue metadata', async () => {
  const { bridge, calls } = harness();
  await assert.rejects(bridge.dispatch('assistant.skills', { sessionId: 'other' }), { code: 'NOT_FOUND' });
  const skills = await bridge.dispatch('assistant.skills', { sessionId: 'dudu-owned' });
  assert.deepEqual(skills, { skills: [{ name: 'visible', description: 'DSH skill' }] });
  const result = await bridge.dispatch('assistant.recipients', { sessionId: 'dudu-owned', q: 'DUD' });
  assert.deepEqual(result.items[0].project, { name: 'dudu' });
  assert.equal(calls.some(([method]) => method === 'session/prompt'), false);
});

test('quick-sheet lists are read-only, bounded to the assistant, and pass their paging cursor without a card command', async () => {
  const reads: unknown[] = [];
  const { bridge, calls } = harness({ todos: async (cursor) => {
    reads.push(cursor);
    return { rows: [{ id: 7, title: 'Waiting' }], total: 31, nextCursor: cursor ? null : 'page-2' };
  } });
  await assert.rejects(bridge.dispatch('assistant.todos', { sessionId: 'other' }), { code: 'NOT_FOUND' });
  await assert.rejects(bridge.dispatch('assistant.todos', { sessionId: 'dudu-owned', cursor: {} }), { code: 'BAD_REQUEST' });
  assert.equal((await bridge.dispatch('assistant.todos', { sessionId: 'dudu-owned' })).nextCursor, 'page-2');
  assert.equal((await bridge.dispatch('assistant.todos', { sessionId: 'dudu-owned', cursor: 'page-2' })).nextCursor, null);
  assert.deepEqual(reads, [undefined, 'page-2']);
  assert.deepEqual(calls, [], 'a read executes no DSH command, prompt or issue mutation');
});

test('expanded todo reads cannot replace the recipient or expose unrelated detail', async () => {
  const reads: string[] = [];
  const { bridge, calls } = harness({ issues: async (action, body) => {
    calls.push([action, body]);
    if (action === 'get') return { outcome: 'success', issue: { id: 7, session: 'dsh:agent' } };
    return { outcome: 'success' };
  } }, async (id) => {
    reads.push(id);
    return {
      session: { id }, messages: [{ id: 'u', role: 'user', text: 'hello' }, { id: 'a', role: 'assistant', text: 'answer' }, { id: 't', role: 'tool', text: 'private' }],
      queuedMessages: [], approvals: ['private'], trace: ['private'],
    };
  });
  const params = { sessionId: 'dudu-owned', id: 7, session: 'dsh:agent' };
  await assert.rejects(bridge.dispatch('assistant.reply.read', { ...params, session: 'dsh:elsewhere' }), { code: 'NOT_FOUND' });
  await assert.rejects(bridge.dispatch('assistant.reply.read', { ...params, sessionId: 'elsewhere' }), { code: 'NOT_FOUND' });
  assert.deepEqual(reads, []);
  assert.deepEqual(await bridge.dispatch('assistant.reply.read', params), {
    session: { id: 'agent' }, messages: [{ id: 'u', role: 'user', text: 'hello' }, { id: 'a', role: 'assistant', text: 'answer' }], queuedMessages: [], acceptedRequestIds: [], canceledRequestIds: [],
  });
  assert.deepEqual(reads, ['agent']);
  await assert.rejects(bridge.dispatch('assistant.reply', {
    sessionId: 'dudu-owned', id: '#7', session: 'dsh:agent', text: 'hello', requestId: 'no-direct-reply',
  }), { code: 'METHOD_NOT_ALLOWED' });
  assert.equal(calls.some(([action]) => ['forward', 'resume', 'session/prompt'].includes(action)), false);
});

test('assistant forwarding stages files on the recipient and deduplicates an outstanding delivery', async () => {
  const { bridge, calls } = harness();
  const params = {
    sessionId: 'dudu-owned', id: 'DUD-7', session: 'dsh:agent', text: 'Read /skill and ask @Claude\nKeep this line.',
    requestId: 'delivery-1', attachments: [{ mediaType: 'image/png', data: 'image' }],
    files: [{ name: 'notes.txt', data: Buffer.from('notes').toString('base64') }],
  };
  const [first, second] = await Promise.all([
    bridge.dispatch('assistant.forward', params), bridge.dispatch('assistant.forward', params),
  ]);
  assert.deepEqual(first, second);
  const forwards = calls.filter(([method]) => method === 'forward');
  assert.equal(forwards.length, 1);
  assert.equal(forwards[0][1].text, params.text);
  assert.deepEqual(forwards[0][1].attachments.at(-1), { type: 'file', receiptId: 'target-receipt' });
  assert.deepEqual(calls.find(([method]) => method === 'fileUploads/upload').slice(1), ['agent', params.files[0]]);
  await assert.rejects(bridge.dispatch('assistant.forward', { ...params, text: 'changed' }), { code: 'BAD_REQUEST' });
});

test('changed recipients are rejected before staging, and a saved failed note can be retried by its entry', async () => {
  const { bridge, calls } = harness();
  const stale = await bridge.dispatch('assistant.forward', {
    sessionId: 'dudu-owned', id: 'DUD-7', session: 'dsh:old-agent', text: 'hello', requestId: 'stale',
    files: [{ name: 'notes.txt', data: 'bm90ZXM=' }],
  });
  assert.equal(stale.code, 'recipient_unavailable');
  assert.equal(calls.some(([method]) => ['forward', 'fileUploads/upload'].includes(method)), false);

  const delivered = [];
  const retry = harness({ issues: async (action, body) => {
    delivered.push([action, body]);
    return body.retryEntry === 9 ? { outcome: 'success', entry: { id: 9 } }
      : { outcome: 'error', saved: true, code: 'delivery_failed', entry: { id: 9 } };
  } }).bridge;
  const message = { sessionId: 'dudu-owned', id: '#7', text: 'hello', requestId: 'first' };
  assert.equal((await retry.dispatch('assistant.forward', message)).entryId, 9);
  assert.equal((await retry.dispatch('assistant.forward', { ...message, requestId: 'retry', retryEntry: 9 })).outcome, 'success');
  assert.equal(delivered[1][1].retryEntry, 9);
});

test('a quick button asks for a card by its kind, on the fixed session only, and the answer is the command id alone', async () => {
  const asked: string[] = [];
  const sinces: unknown[] = [];
  const { bridge } = harness({ card: async (kind: string, since?: string) => { asked.push(kind); sinces.push(since); return since === 'same' ? { outcome: 'success', commandId: since, unchanged: true } : { outcome: 'success', commandId: 'cmd-1', secret: 'not for the phone' }; } });
  await assert.rejects(bridge.dispatch('assistant.card', { sessionId: 'other', kind: 'todo' }), { code: 'NOT_FOUND' });
  for (const kind of ['everything', undefined, 7, '']) await assert.rejects(bridge.dispatch('assistant.card', { sessionId: 'dudu-owned', kind }), { code: 'BAD_REQUEST' });
  assert.deepEqual(asked, [], 'nothing invalid reaches the host');
  for (const kind of ['todo', 'info', 'task']) assert.deepEqual(await bridge.dispatch('assistant.card', { sessionId: 'dudu-owned', kind }), { outcome: 'success', commandId: 'cmd-1' });
  assert.deepEqual(asked, ['todo', 'info', 'task']);
  // The card the phone sees at the end of its thread goes to the host, which says when a new one would only repeat it; nothing else of the host's answer goes back.
  assert.deepEqual(await bridge.dispatch('assistant.card', { sessionId: 'dudu-owned', kind: 'todo', since: 'cmd-1' }), { outcome: 'success', commandId: 'cmd-1' });
  assert.deepEqual(await bridge.dispatch('assistant.card', { sessionId: 'dudu-owned', kind: 'todo', since: 'same' }), { outcome: 'success', commandId: 'same', unchanged: true });
  assert.deepEqual(sinces, [undefined, undefined, undefined, 'cmd-1', 'same']);
  for (const since of ['', 7, 'x'.repeat(129), {}]) await assert.rejects(bridge.dispatch('assistant.card', { sessionId: 'dudu-owned', kind: 'todo', since }), { code: 'BAD_REQUEST' });
  assert.equal(asked.length, 5, 'a bad `since` reaches nothing');
  const failing = harness({ card: async () => ({ outcome: 'error', code: 'unavailable', message: 'a long message with paths' }) }).bridge;
  assert.deepEqual(await failing.dispatch('assistant.card', { sessionId: 'dudu-owned', kind: 'todo' }), { outcome: 'error', code: 'unavailable' });
  await assert.rejects(harness().bridge.dispatch('assistant.card', { sessionId: 'dudu-owned', kind: 'todo' }), { code: 'UNSUPPORTED' }, 'a plugin that cannot make cards says so');
});

test('a line written in the chat says so when it is forwarded, and hiding takes whole sequence numbers of the fixed session only', async () => {
  const hidden: number[][] = [];
  const { bridge, calls } = harness({ hide: (seqs: number[]) => { hidden.push(seqs); return { outcome: 'success' }; } });
  await bridge.dispatch('assistant.forward', { sessionId: 'dudu-owned', id: 'DUD-7', text: '结论了吗', requestId: 'r-1' });
  assert.equal((calls.find(([action]) => action === 'forward') as any)[1].chat, true, 'the plugin makes the line a line of the thread');
  assert.deepEqual(await bridge.dispatch('assistant.hide', { sessionId: 'dudu-owned', seqs: [3, 8] }), { outcome: 'success' });
  assert.deepEqual(hidden, [[3, 8]]);
  for (const params of [{ sessionId: 'other', seqs: [1] }, { sessionId: 'dudu-owned', seqs: [] }, { sessionId: 'dudu-owned', seqs: ['3'] }, { sessionId: 'dudu-owned', seqs: [1.5] }, { sessionId: 'dudu-owned' }]) {
    await assert.rejects(bridge.dispatch('assistant.hide', params), (error: any) => ['NOT_FOUND', 'BAD_REQUEST'].includes(error.code), JSON.stringify(params));
  }
  assert.equal(hidden.length, 1);
});

