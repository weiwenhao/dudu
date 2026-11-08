import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeAssistant } from '../host/native-assistant.mjs';

function harness(overrides = {}) {
  const calls = [];
  const assistant = {
    state: () => ({ sessionId: 'dudu-owned' }),
    context: (where) => { calls.push(['context', where]); return { outcome: 'success' }; },
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
  await assert.rejects(bridge.context('other', null), { code: 'NOT_FOUND' });
  await bridge.context('dudu-owned', { page: 'issue', id: 7 });
  await bridge.context('dudu-owned', null);
  assert.deepEqual(calls.slice(-2), [['context', { page: 'issue', id: 7 }], ['context', null]]);
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
