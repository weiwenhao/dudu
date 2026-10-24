import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conversationState, deliveredPath, firstToken, mutationPath, performanceEvent, questionsFrom,
  recordConversationEvent, textPage, toolPayload, turnPerformance, validateAnswers,
} from '../host/native-conversation.mjs';
import { createConversationReads } from '../host/native-conversation-reads.mjs';

const event = (type, seq, data = {}, time = seq * 100) => ({ type, seq, data, time, surfaceOp: 'append' });

test('generic questions preserve option metadata and validate one complete answer batch', () => {
  const call = {
    callId: 'questions', state: 'continued', questions: [
      { id: 'single', question: 'Theme?', options: [{ label: 'Light', description: 'Day' }, { label: 'Dark' }] },
      { id: 'multi', question: 'Targets?', multiSelect: true, options: [{ label: 'iOS' }, { label: 'Mac' }] },
      { id: 'text', question: 'Name?' },
    ],
  };
  assert.equal(questionsFrom({ userQuestions: { active: [call] } }, 'session', () => false)[0].questions[0].options[0].description, 'Day');
  assert.deepEqual(questionsFrom({ userQuestions: { active: [call] } }, 'session', () => true), []);
  const answers = [
    { id: 'single', selected: ['Light'] }, { id: 'multi', selected: ['iOS', 'Mac'], custom: 'Linux' },
    { id: 'text', selected: [], custom: 'Project' },
  ];
  assert.deepEqual(validateAnswers(call, answers), { answers });
  assert.doesNotThrow(() => validateAnswers(call, call.questions.map(({ id }) => ({ id, selected: [] }))));
  for (const invalid of [
    [answers[0]], [answers[0], answers[0], answers[2]],
    [{ ...answers[0], selected: ['Light', 'Dark'] }, ...answers.slice(1)],
    [answers[0], { ...answers[1], selected: ['iOS', 'iOS'] }, answers[2]],
    [answers[0], answers[1], { ...answers[2], custom: 'x'.repeat(60_001) }],
    [answers[0], { ...answers[1], selected: ['unknown'] }, answers[2]],
  ]) assert.throws(() => validateAnswers(call, invalid));
  assert.throws(() => validateAnswers(undefined, answers), { code: 'STALE_APPROVAL' });
});

test('file references require successful mutating calls; metadata cannot turn a read into a file grant', () => {
  const call = event('tool/call', 2, { callId: 'write', turn: 1, name: 'write', arguments: '{"file_path":"report.md","content":"ok"}' });
  const result = event('tool/result', 3, { turn: 1, message: { source: { callId: 'write' }, content: [] }, meta: { path: '/workspace/report.md' } });
  assert.equal(deliveredPath(result, call, { kind: 'produced' }, '/other'), '/workspace/report.md');
  assert.equal(deliveredPath({ ...result, data: { ...result.data, meta: undefined } }, call, { kind: 'produced' }, '/workspace'), '/workspace/report.md');
  for (const invalidCall of [
    { ...call, data: { ...call.data, name: 'read' } },
    { ...call, data: { ...call.data, callId: 'other' } },
  ]) assert.throws(() => deliveredPath(result, invalidCall, { kind: 'produced' }, '/workspace'), { code: 'NOT_FOUND' });
  const failed = { ...result, data: { ...result.data, message: { ...result.data.message, isError: true } } };
  assert.throws(() => deliveredPath(failed, call, { kind: 'produced' }, '/workspace'), { code: 'NOT_FOUND' });
  assert.equal(mutationPath('str_replace_editor', { command: 'insert', path: '/a', insert_line: -1, new_str: 'x' }), undefined);
  assert.equal(mutationPath('edit', { file_path: '/a', old_string: 'a', new_string: 'b', replace_all: 2 }), undefined);
  const state = conversationState();
  [call, result, result].forEach((item) => recordConversationEvent(state, item));
  assert.equal(state.turns.get(1).files.length, 1);
  assert.equal(state.turns.get(1).stats.toolMs, 100);
  assert.equal(state.tools.get('write').resultSeq, 3);
});

test('retry chains and persistent errors keep producer state and exact details', () => {
  const state = conversationState();
  [
    event('llm/retry', 1, { turn: 2, retryId: 'chain', retry: 1, mode: 'normal', maxRetries: 3, delayMs: 900, failure: { message: 'upstream 502', code: 'HTTP_502' } }),
    event('llm/retry-started', 2, { turn: 2, retryId: 'chain', retry: 1 }),
    event('llm/retry', 3, { turn: 2, retryId: 'chain', retry: 2, delayMs: 1500, failure: { message: 'second' } }),
    event('turn/end', 4, { turn: 2, reason: { kind: 'error', error: { message: 'model refused', code: 'AUTH' } } }),
    event('turn/end', 5, { turn: 3, reason: { kind: 'max-tokens' } }),
  ].forEach((item) => recordConversationEvent(state, item));
  const notices = state.turns.get(2).notices;
  assert.equal(notices[0].state, 'started');
  assert.equal(notices[1].state, 'cancelled');
  assert.equal(notices[2].message, 'model refused');
  assert.equal(state.turns.get(3).notices[0].kind, 'max-tokens');
});

test('tool detail pages round-trip every character, nontext block, and image reference', () => {
  const input = '{"body":"' + 'x'.repeat(31990) + '🙂'.repeat(100) + '"}';
  const output = 'x'.repeat(31999) + '🙂'.repeat(100);
  const call = event('tool/call', 1, { callId: 'a', name: 'write', arguments: input });
  const result = event('tool/result', 2, {
    message: { source: { callId: 'a' }, content: [
      { type: 'text', text: output },
      { type: 'image', encoding: 'base64', mediaType: 'image/png', data: 'AAAA' },
      { type: 'custom', payload: { unabridged: true } },
    ] }, meta: { detail: 'm'.repeat(33000) },
  });
  const first = toolPayload(call, result, { callId: 'a' });
  assert.deepEqual(first.images, [{ kind: 'image', name: '图片', id: 'tool:a:1', seq: 2 }]);
  assert.equal(first.output.text.length, 31999);
  const next = toolPayload(call, result, { callId: 'a', inputOffset: first.input.nextOffset, outputOffset: first.output.nextOffset });
  assert.equal(first.input.text + next.input.text, input);
  assert.ok((first.output.text + next.output.text).startsWith(output));
  assert.ok(next.output.text.includes('unabridged'));
  assert.ok(!next.output.text.includes('AAAA'));
  assert.throws(() => textPage('🙂', 1), { code: 'BAD_REQUEST' });
  assert.throws(() => textPage('x', -1), { code: 'BAD_REQUEST' });
  assert.throws(() => toolPayload(call, result, { callId: 'wrong' }), { code: 'NOT_FOUND' });
});

test('performance reconstructs packed-token times and full-turn metrics without inventing incomplete token usage', () => {
  assert.equal(firstToken([{ type: 'text-chunks', time0: 100, texts: ['', '', 'Hi'], dt: [10, 15] }]), 125);
  assert.equal(firstToken([{ type: 'tool-call-chunks', time0: 200, name: 'read', args: [''], dt: [] }]), 200);
  const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0, totalTokens: 35 };
  const records = [
    event('turn/start', 1, { turn: 1 }, 100),
    event('step/start', 2, { turn: 1, step: 1 }, 200),
    event('assistant/message', 3, { turn: 1, step: 1, usage, stream: [{ type: 'text-chunks', time0: 250, texts: ['Hello'], dt: [] }] }, 400),
    event('tool/call', 4, { turn: 1, callId: 'read' }, 450),
    event('tool/result', 5, { turn: 1, message: { source: { callId: 'read' } } }, 600),
    event('step/end', 6, { turn: 1, step: 1 }, 650),
    event('turn/end', 7, { turn: 1, reason: { kind: 'completed' } }, 700),
  ].map(performanceEvent);
  const measured = turnPerformance(records, 1);
  assert.deepEqual(measured.stats, { steps: 1, turns: 1, llmMs: 200, toolMs: 150, ttftMs: 50, ttftSteps: 1, decodeMs: 150, decodeTokens: 20 });
  assert.equal(measured.usage.uncachedInputTokens, 10);
  assert.equal(measured.usage.totalTokens, 35);
  assert.deepEqual(turnPerformance(records.slice(1), 1).usage, {});
  assert.deepEqual(turnPerformance(records.slice(0, -1), 1).usage, {});
});

test('conversation reader permits only fixed owner-scoped routes and bounded responses', async () => {
  const calls = [];
  const peer = { principal: { kind: 'owner' } };
  const connection = { createSharedFetchHandler(prefix) {
    assert.equal(prefix, '/api');
    return { async fetch(request, actualPeer) {
      calls.push(request);
      assert.equal(actualPeer, peer);
      return Response.json({ files: [] });
    } };
  } };
  assert.throws(() => createConversationReads({ connection, peer: { principal: { kind: 'guest' } } }));
  const reads = createConversationReads({ connection, peer });
  assert.deepEqual(await reads.read('summary', { sessionId: 'a&b', seq: 5 }), { files: [] });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/api/changes.summary');
  assert.equal(url.searchParams.get('sessionId'), 'a&b');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.get('authorization'), null);
  for (const [kind, coordinates] of [
    ['proxy', { url: 'http://example.com' }], ['file', { path: '/tmp/a', headers: {} }],
    ['file', { path: '../secret' }], ['diff', { sessionId: 's', seq: 2, index: -1 }],
    ['summary', { sessionId: 's' }],
  ]) await assert.rejects(reads.read(kind, coordinates));
  assert.equal(calls.length, 1);
  const large = createConversationReads({ peer, connection: { createSharedFetchHandler: () => ({
    fetch: async () => new Response(new Uint8Array(16 * 1024 * 1024 + 1)),
  }) } });
  await assert.rejects(large.read('file', { path: '/tmp/a' }), { code: 'LIMIT_EXCEEDED' });
});

test('conversation reader times out uncooperative fetches and cancels late bodies', async () => {
  let finish;
  let cancelled = false;
  const reads = createConversationReads({
    peer: { principal: { kind: 'owner' } }, timeoutMs: 10,
    connection: { createSharedFetchHandler: () => ({ fetch: () => new Promise((resolve) => { finish = resolve; }) }) },
  });
  await assert.rejects(reads.read('file', { path: '/tmp/a' }), { code: 'UPSTREAM_UNAVAILABLE' });
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('conversation reader distinguishes missing resources from HTTP failures and malformed success bodies', async () => {
  for (const [status, code] of [[404, 'NOT_FOUND'], [413, 'LIMIT_EXCEEDED'], [401, 'UPSTREAM_UNAVAILABLE'], [502, 'UPSTREAM_UNAVAILABLE'], [500, 'UPSTREAM_UNAVAILABLE']]) {
    const reads = createConversationReads({
      peer: { principal: { kind: 'owner' } },
      connection: { createSharedFetchHandler: () => ({ fetch: async () => new Response('failure', { status }) }) },
    });
    await assert.rejects(reads.read('summary', { sessionId: 'session', seq: 1 }), { code });
  }
  const reads = createConversationReads({
    peer: { principal: { kind: 'owner' } },
    connection: { createSharedFetchHandler: () => ({ fetch: async () => new Response('invalid JSON') }) },
  });
  await assert.rejects(reads.read('summary', { sessionId: 'session', seq: 1 }), SyntaxError);
});
