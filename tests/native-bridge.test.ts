import assert from 'node:assert/strict';
import test from 'node:test';
import { contentDigest } from '../host/assistant/sessions/session-state.mjs';
import {
  NATIVE_METHODS,
  createNativeBridge,
  createTypertRpcAdapter,
} from '../host/native-bridge.mjs';

function iterable(frames, delayBeforeDoneMs = 0, keepOpen = false) {
  let disposed = false;
  let finish;
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (disposed) return { done: true };
          if (index < frames.length) return { value: frames[index++], done: false };
          if (delayBeforeDoneMs) {
            await new Promise((resolve) => setTimeout(resolve, delayBeforeDoneMs));
          }
          if (keepOpen && !disposed) return new Promise((resolve) => { finish = resolve; });
          return { done: true };
        },
        async return() {
          return { done: true };
        },
      };
    },
    async dispose() { disposed = true; finish?.({ done: true }); },
  };
}

function eventMessage(id, seq, value) {
  return {
    type: 'event',
    event: {
      type: 'assistant/message',
      seq,
      time: seq,
      surfaceOp: 'append',
      data: { message: { id, content: [{ type: 'text', text: value }] } },
    },
  };
}

function makeHarness({
  snapshot,
  followFrames = [],
  controlFrames = [],
  followDelayMs = 0,
  rows,
  projections,
  scheduleTasks = [],
  responses = {},
  workspaces = { items: [] },
  conversationReads,
  questionBridge,
  sessionActivity,
  acknowledgeRead,
  sessionSearch,
  assistantConversation,
  assistant,
  fileTransfers,
  streams = {},
} = {}) {
  const calls = [];
  const sessionRows = rows ?? [{
    sessionId: 'session-1',
    title: 'Current session',
    status: 'running',
    updatedAt: 123,
  }];
  const rpc = {
    async call(channel, endpoint, ...args) {
      calls.push({ channel, endpoint, args });
      if (responses[endpoint] !== undefined) {
        const reply = responses[endpoint];
        return typeof reply === 'function' ? reply(...args) : reply;
      }
      if (endpoint === 'session/list') return { items: sessionRows };
      if (endpoint === 'session/projections') return { values: projections ?? {} };
      if (endpoint === 'userQuestions/answer') return true;
      if (endpoint === 'pluginManager/listPlugins') {
        return [{
          entryId: 'entry-1',
          moduleName: '@example/dsh-plugin',
          enabled: true,
          meta: { name: 'Example', description: 'Plugin detail' },
        }];
      }
      if (endpoint === 'schedule/catalog') return scheduleTasks;
      if (endpoint === 'workspace/follow') {
        throw new Error('workspace/follow must be opened as a stream');
      }
      return {};
    },
    async open(_channel, endpoint, ...args) {
      if (streams[endpoint]) return streams[endpoint](...args);
      if (endpoint === 'workspace/follow') {
        return iterable([{ type: 'baseline', value: workspaces }]);
      }
      if (endpoint === 'session/follow') {
        return iterable([snapshot, ...followFrames], followDelayMs, true);
      }
      if (endpoint === 'session/control') return iterable(controlFrames, followDelayMs, true);
      throw new Error(`unexpected stream endpoint: ${endpoint}`);
    },
  };
  return { bridge: createNativeBridge({ rpc, conversationReads, fileTransfers, questionBridge, sessionActivity, acknowledgeRead, sessionSearch, assistantConversation, assistant }), calls };
}

test('opening the assistant reuses its scoped session and ignores caller-supplied identities', async () => {
  const id = 'dudu-assistant-existing';
  const { bridge, calls } = makeHarness({
    rows: [{ sessionId: id, title: 'Dudu', providerId: 'deepseek', status: 'idle', updatedAt: 123 }],
    assistantConversation: async () => ({ sessionId: id }),
  });
  const connection = { selectedSessionId: 'previous' };
  const first = await bridge.dispatch('assistant.open', { id: 'some-other-session' }, connection);
  const second = await bridge.dispatch('assistant.open', {}, connection);
  assert.deepEqual([first.id, second.id], [id, id]);
  assert.equal(first.isAssistant, true);
  assert.equal(connection.selectedSessionId, 'previous', 'resolving a delayed request must not switch the watched session');
  assert.equal(calls.some(({ endpoint }) => endpoint === 'session/create'), false);

  const unsupported = makeHarness().bridge;
  await assert.rejects(unsupported.dispatch('assistant.open', {}, {}), { code: 'UNSUPPORTED' });
  const unavailable = makeHarness({ assistantConversation: async () => ({ sessionId: null }) }).bridge;
  await assert.rejects(unavailable.dispatch('assistant.open', {}, {}), { code: 'UPSTREAM_UNAVAILABLE' });
});

test('a message to the assistant goes out as it is: a page that an older phone still sends with it is ignored, not rejected', async () => {
  const { bridge, calls } = makeHarness({
    assistant: { state: () => ({ sessionId: 'dudu-owned' }) },
  });
  await bridge.dispatch('session.send', { id: 'dudu-owned', text: 'with a page of an older phone', assistantContext: { page: 'issue', id: 7 } }, {});
  await bridge.dispatch('session.send', { id: 'dudu-owned', text: 'with a null', assistantContext: null }, {});
  await bridge.dispatch('session.send', { id: 'dudu-owned', text: 'plain' }, {});
  await bridge.dispatch('session.send', { id: 'normal', text: 'ordinary' }, {});
  assert.equal(calls.filter(({ endpoint }) => endpoint === 'session/prompt').length, 4);
});

test('a quick-sheet reply read closes its own source and preserves the main conversation watch and request identities', async () => {
  let closed = 0;
  let opened = 0;
  const data = Buffer.from('reply-image').toString('base64');
  const { bridge } = makeHarness({
    rows: [{ sessionId: 'session-1', title: 'Recipient', status: 'idle', updatedAt: 123, providerId: 'claude' }],
    assistant: {
      state: () => ({ sessionId: 'dudu-owned' }),
      issues: async () => ({ outcome: 'success', issue: { id: 7, session: 'dsh:session-1' } }),
    },
    streams: {
      'session/follow': () => {
        opened++;
        const source = iterable([{
          type: 'snapshot', cursor: 3, hasMore: false, projections: { values: {} },
          records: [
            surface('user/message', 1, 1, { id: 'owner', source: { kind: 'user', rpcId: 'sheet-request' }, content: [
              { type: 'text', text: 'hello' }, { type: 'image', mediaType: 'image/png', data, name: 'reply.png' },
            ] }),
            eventMessage('answer', 2, 'received'),
            surface('user/message', 3, 3, { id: 'file-only', source: { kind: 'user', rpcId: 'file-request' }, content: [
              { type: 'file', name: 'report.txt' },
            ] }),
          ],
        }]);
        return { ...source, dispose: async () => { closed += 1; await source.dispose(); } };
      },
    },
  });
  const connection = { selectedSessionId: 'dudu-owned', nativeWatchID: 'main-watch' };
  const value = await bridge.dispatch('assistant.reply.read', {
    sessionId: 'dudu-owned', id: 7, session: 'dsh:session-1',
  }, connection);
  assert.deepEqual(connection, { selectedSessionId: 'dudu-owned', nativeWatchID: 'main-watch' });
  assert.equal(closed, 1);
  assert.deepEqual(value.acceptedRequestIds, ['sheet-request', 'file-request']);
  assert.deepEqual(value.messages.map((message) => message.text), ['hello', 'received', '']);
  assert.deepEqual(value.messages[0].attachments, [{ kind: 'image', name: 'reply.png', id: 'owner:1', seq: 1 }]);
  assert.deepEqual(value.messages[2].attachments, [{ kind: 'file', name: 'report.txt' }]);
  assert.equal(JSON.stringify(value).includes(data), false, 'snapshots contain references only');
  assert.equal('approvals' in value || 'trace' in value || 'team' in value, false);
  const params = { sessionId: 'dudu-owned', id: 7, session: 'dsh:session-1', attachmentId: 'owner:1' };
  assert.deepEqual(await bridge.dispatch('assistant.reply.image', params, connection), { mediaType: 'image/png', data });
  await assert.rejects(bridge.dispatch('assistant.reply.image', { ...params, session: 'dsh:other' }, connection), { code: 'NOT_FOUND' });
  await assert.rejects(bridge.dispatch('assistant.reply.image', { ...params, attachmentId: '/private/file.png' }, connection), { code: 'NOT_FOUND' });
  assert.equal(closed, opened, 'all short-lived sources close, including failed image reads');
  assert.deepEqual(connection, { selectedSessionId: 'dudu-owned', nativeWatchID: 'main-watch' });
});

test('the phone asks for the quota the way the desktop icon does: the sheet opening is the ask, nothing else is accepted, and what the plugin has kept comes back with the outcome', async () => {
  const asked: unknown[] = [];
  const view = { providers: [{ id: 'claude', agent: 'claude', name: 'Claude', plan: 'Max', windows: [], readAt: 5 }], refreshing: true, readAt: 5 };
  const { bridge } = makeHarness({ assistant: { quota: async (options: unknown) => { asked.push(options); return view; } } });
  assert.deepEqual(await bridge.dispatch('quota.get', { ask: true }, {}), { outcome: 'success', ...view });
  await bridge.dispatch('quota.get', {}, {});
  assert.deepEqual(asked, [{ ask: true }, { ask: false }], 'looking is not asking');
  await assert.rejects(bridge.dispatch('quota.get', { ask: 'yes' }, {}), { code: 'BAD_REQUEST' });
  await assert.rejects(bridge.dispatch('quota.get', { ask: true, source: 'claude' }, {}), { code: 'BAD_REQUEST' }, 'no caller-chosen source');
  await assert.rejects(makeHarness().bridge.dispatch('quota.get', {}, {}), { code: 'UPSTREAM_UNAVAILABLE' });
});

test('assistant model changes use its own selector and reselecting a model preserves its effort', async () => {
  const selections = [];
  const { bridge, calls } = makeHarness({
    assistant: { state: () => ({ sessionId: 'dudu-owned' }), selectModel: (value) => { selections.push(value); } },
    projections: { modelSelection: { next: { provider: 'deepseek', model: 'chat', reasoningEffort: 'max' } } },
    responses: {
      'session/modelCatalog': { groups: [{
        id: 'deepseek', models: [{ id: 'chat', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high' }, { id: 'max' }] } }],
      }] },
    },
  });
  const modelId = 'deepseek:chat';
  await bridge.dispatch('session.configure', { id: 'dudu-owned', modelId }, {});
  await bridge.dispatch('session.configure', { id: 'dudu-owned', modelId, reasoningEffort: 'high' }, {});
  assert.deepEqual(selections, [
    { provider: 'deepseek', model: 'chat', reasoningEffort: 'max' },
    { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' },
  ]);
  assert.equal(calls.some(({ endpoint }) => endpoint === 'session/selectModel'), false);
  await bridge.dispatch('session.configure', { id: 'ordinary', modelId }, {});
  assert.equal(calls.filter(({ endpoint }) => endpoint === 'session/selectModel').length, 1);
});

test('the model catalog retains each configured source when model names and local ids coincide', async () => {
  const { bridge, calls } = makeHarness({
    responses: {
      'session/modelCatalog': { groups: [
        { id: 'deepseek-account', name: 'Account', models: [{ id: 'flash', name: 'Flash' }] },
        { id: 'deepseek-official', name: 'API', models: [{ id: 'flash', name: 'Flash' }] },
      ] },
    },
  });
  const catalog = await bridge.dispatch('catalog.get', {}, {});
  assert.deepEqual(catalog.models.map(({ id, name, sourceID, sourceName }) => ({ id, name, sourceID, sourceName })), [
    { id: 'deepseek-account:flash', name: 'Flash', sourceID: 'deepseek-account', sourceName: 'Account' },
    { id: 'deepseek-official:flash', name: 'Flash', sourceID: 'deepseek-official', sourceName: 'API' },
  ]);
  assert.deepEqual(catalog.providers.map(({ id, modelIds }) => ({ id, modelIds })), [
    { id: 'deepseek', modelIds: ['deepseek-account:flash', 'deepseek-official:flash'] },
  ], 'agent family and configured model source remain distinct');
  await bridge.dispatch('session.configure', { id: 'ordinary', modelId: catalog.models[1].id }, {});
  assert.deepEqual(calls.find(({ endpoint }) => endpoint === 'session/selectModel')?.args[0], {
    sessionId: 'ordinary', provider: 'deepseek-official', model: 'flash',
  });
});

test('Typert adapter uses the owner peer and only invokes named allowlisted endpoints', async () => {
  const peer = { principal: { kind: 'owner' } };
  const invocations = [];
  const streams = [];
  const gateway = {
    async invoke(request) {
      invocations.push(request);
      return { ok: true, value: [] };
    },
    async stream(request) {
      streams.push(request);
      return iterable([]);
    },
  };
  const rpc = createTypertRpcAdapter({ gateway, peer });

  await rpc.call('/api', 'pluginManager/listPlugins');
  await rpc.open('/api', 'session/follow', {
    address: { kind: 'session', sessionId: 'session-1' },
    assistantStream: true,
  });

  assert.deepEqual(invocations[0], {
    namespace: 'pluginManager',
    method: 'listPlugins',
    args: {},
    peer,
    signal: undefined,
  });
  assert.deepEqual(streams[0], {
    namespace: 'session',
    method: 'follow',
    args: {
      request: {
        address: { kind: 'session', sessionId: 'session-1' },
        assistantStream: true,
      },
    },
    peer,
    signal: undefined,
  });
  await rpc.open('/api', 'session/control');
  assert.deepEqual(streams.at(-1), {
    namespace: 'session', method: 'control', args: {}, peer, signal: undefined,
  });
  const attachment = {
    attachmentId: 'opaque-image', mediaType: 'image/png', bytes: 4, width: 1, height: 1,
  };
  await rpc.call('/api', 'session/attachment', { sessionId: 'session-1', attachment });
  assert.deepEqual(invocations.at(-1), {
    namespace: 'session', method: 'attachment',
    args: { request: { sessionId: 'session-1', attachment } }, peer, signal: undefined,
  });
  await rpc.call('/api', 'session/updateQueue', {
    sessionId: 'session-1', itemId: 'queued', action: { kind: 'remove' },
  });
  assert.deepEqual(invocations.at(-1).args, {
    request: { sessionId: 'session-1', itemId: 'queued', action: { kind: 'remove' } },
  });
  await rpc.call('/api', 'skills/list', { sessionId: 'dudu-owned' });
  assert.deepEqual(invocations.at(-1), {
    namespace: 'skills', method: 'list', args: { request: { sessionId: 'dudu-owned' } }, peer, signal: undefined,
  });
  for (const method of ['list', 'follow', 'kill']) {
    const request = { sessionId: 'session-1', ...(method === 'list' ? {} : { jobId: 'job-1' }) };
    if (method === 'kill') await rpc.call('/api', `job/${method}`, request);
    else await rpc.open('/api', `job/${method}`, request);
    assert.deepEqual((method === 'kill' ? invocations : streams).at(-1), {
      namespace: 'job', method, args: { request }, peer, signal: undefined,
    });
  }
  await rpc.call('/api', 'session/state', { sessionId: 'child' });
  assert.deepEqual(invocations.at(-1).args, { request: { sessionId: 'child' } });
  await assert.rejects(rpc.call('/api', 'arbitrary/execute'), { code: 'UNSUPPORTED' });
  assert.throws(() => createTypertRpcAdapter({
    gateway,
    peer: { principal: { kind: 'user' } },
  }), /owner-scoped/);
});

test('Typert diagnostics distinguish invocation, opening and iteration failures while keeping public errors safe', async () => {
  const failures = [];
  const upstream = Object.assign(new Error('private upstream detail'), { code: 'session/not-found' });
  let failOpen = true;
  const rpc = createTypertRpcAdapter({
    peer: { principal: { kind: 'owner' } },
    diagnostics: { failure(value) { failures.push(value); } },
    gateway: {
      async invoke() { throw upstream; },
      async stream() {
        if (failOpen) throw upstream;
        return { async *[Symbol.asyncIterator]() { throw upstream; } };
      },
    },
  });
  await assert.rejects(rpc.call('/api', 'session/list'), { code: 'UPSTREAM_UNAVAILABLE' });
  await assert.rejects(rpc.open('/api', 'session/control'), { code: 'UPSTREAM_UNAVAILABLE' });
  failOpen = false;
  const stream = await rpc.open('/api', 'session/follow', { address: { kind: 'session', sessionId: 's' } });
  await assert.rejects(stream[Symbol.asyncIterator]().next(), (error) => {
    assert.equal(error.code, 'UPSTREAM_UNAVAILABLE');
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
  assert.deepEqual(failures.map(({ endpoint, stage, error }) => [endpoint, stage, error.code]), [
    ['session/list', 'invoke', 'session/not-found'],
    ['session/control', 'open', 'session/not-found'],
    ['session/follow', 'next', 'session/not-found'],
  ]);
});

test('native session search uses DSH content search and returns bounded visible conversation snippets', async () => {
  const { bridge, calls } = makeHarness({
    rows: [
      { sessionId: 'session-1', title: '手机交互', updatedAt: 123 },
      { sessionId: 'blank', title: '新任务', blank: true },
    ],
    responses: {
      'session/search': {
        items: [
          { sessionId: 'session-1', snippet: '长按说话' + '🐋'.repeat(300) },
          { sessionId: 'session-1', snippet: 'duplicate' },
          { sessionId: 'unknown', snippet: 'not visible in the list' },
          { sessionId: 'blank', snippet: 'blank conversations stay hidden' },
        ],
        hasMore: true,
      },
    },
  });
  const result = await bridge.dispatch('session.search', { query: '  长按说话  ' }, {});
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].session.id, 'session-1');
  assert.equal(result.items[0].session.title, '手机交互');
  assert.equal([...result.items[0].snippet].length, 240);
  assert.equal(result.hasMore, true);
  assert.deepEqual(calls.find((call) => call.endpoint === 'session/search')?.args, [{ query: '长按说话' }]);
  assert.equal(calls.some((call) => ['session/follow', 'session/prompt'].includes(call.endpoint)), false);
});

test('native session search rejects blank, oversized and non-text queries before reaching DSH', async () => {
  const { bridge, calls } = makeHarness();
  for (const query of ['', '  ', 'a'.repeat(501), 17, null]) {
    await assert.rejects(bridge.dispatch('session.search', { query }, {}), { code: 'BAD_REQUEST' });
  }
  assert.deepEqual(calls, []);
});

test('watch preserves attempt, revision, index, emits watchId, and streams text/reasoning deltas with tool trace', async () => {
  const snapshot = {
    type: 'snapshot',
    records: [],
    projections: { values: {} },
    assistantStream: {
      revision: 0,
      activeAttempt: {
        attemptId: 'attempt-A',
        nextIndex: 2,
        stream: [
          { index: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
          { index: 1, chunk: { type: 'text-delta', index: 0, text: 'old' } },
        ],
      },
    },
  };
  const frames = [
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt-B', revision: 0, index: 2, chunk: { type: 'text-delta', index: 0, text: 'wrong attempt' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt-A', revision: -1, index: 2, chunk: { type: 'text-delta', index: 0, text: 'old revision' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt-A', revision: 0, index: 2, chunk: { type: 'text-delta', index: 0, text: '-new' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt-A', revision: 0, index: 2, chunk: { type: 'text-delta', index: 0, text: 'duplicate' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt-A', revision: 0, index: 4, chunk: { type: 'text-delta', index: 0, text: 'gap' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt-A', revision: 0, index: 3, chunk: { type: 'block-start', index: 1, blockType: 'reasoning' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt-A', revision: 0, index: 4, chunk: { type: 'reasoning-delta', index: 1, text: 'thinking' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt-A', revision: 0, index: 5, chunk: { type: 'tool-call-delta', index: 2, id: 'tool-1', name: 'search' } } },
  ];
  const { bridge } = makeHarness({ snapshot, followFrames: frames, followDelayMs: 250 });
  const events = [];
  const connection = {
    closed: false,
    watchGeneration: 7,
    setWatch(cancel, generation) {
      this.cancel = cancel;
      return generation === this.watchGeneration;
    },
    sendEvent(topic, params) { events.push({ topic, params }); },
  };
  const initial = await bridge.dispatch('session.watch', {
    id: 'session-1',
    watchId: 'a2f7f43c-b843-4e16-b82f-bbc2e27d82b0',
  }, connection, { watchGeneration: 7 });
  assert.equal(initial.watchId, undefined);

  await new Promise((resolve) => setTimeout(resolve, 150));
  await connection.cancel();
  assert.equal(events.length, 1);
  assert.equal(events[0].topic, 'session.snapshot');
  assert.equal(events[0].params.watchId, 'a2f7f43c-b843-4e16-b82f-bbc2e27d82b0');
  const live = events[0].params.messages.find((message) => message.id === 'live:attempt-A');
  assert.equal(live.text, 'old-new');
  assert.equal(live.reasoning, 'thinking');
  assert.equal(events[0].params.trace.some((entry) => entry.id === 'tool:tool-1'), true);
  await assert.rejects(
    bridge.dispatch('session.watch', { id: 'session-1', watchId: 'not-a-uuid' }, connection, {
      watchGeneration: 8,
    }),
    { code: 'BAD_REQUEST' },
  );
});

test('chat follows human source and append-origin messages without showing injected context or model replacements', async () => {
  const record = (type, seq, data, surfaceOp = 'append') => ({
    type: 'event', event: { type, seq, time: seq, surfaceOp, data },
  });
  const contextText = 'Time sampled while preparing turn 74, step 16';
  const visibleUser = (id, content) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: content }] });
  const { bridge } = makeHarness({
    snapshot: {
      type: 'snapshot', projections: { values: {} },
      records: [
        record('user/message', 1, visibleUser('human-1', 'Continue')),
        record('user/message', 2, {
          ...visibleUser('clock', contextText),
          source: {
            kind: 'time-context', form: 'snapshot',
            sections: [{ name: 'time-context', text: contextText }],
          },
        }),
        record('developer/message', 3, { message: { id: 'developer', content: [{ type: 'text', text: 'Internal instructions' }] } }),
        record('system/message', 4, { message: { id: 'system', content: [{ type: 'text', text: 'System prompt' }] } }),
        record('user/message', 5, {
          ...visibleUser('compact', 'Model summary'), source: { kind: 'compact-checkpoint' },
        }, { op: 'replace', startSeq: 1, endSeq: 4 }),
        eventMessage('reply', 6, 'Visible answer'),
        record('user/message', 7, visibleUser('human-2', contextText)),
        record('assistant/message', 8, {
          message: { id: 'replacement', content: [{ type: 'text', text: 'Replacement answer' }] },
        }, { op: 'replace', startSeq: 6, endSeq: 6 }),
        record('user/message', 9, {
          id: 'tools-changed', source: { kind: 'plugin' },
          content: [
            { type: 'text', text: 'Hidden model context' },
            { type: 'tool-addition', toolName: 'search' },
            { type: 'tool-removal', toolName: 'old-tool' },
          ],
        }),
      ],
    },
  });
  const detail = await bridge.dispatch('session.open', { id: 'session-1' }, {});
  assert.deepEqual(detail.messages.map(({ id, role, text }) => ({ id, role, text })), [
    { id: 'human-1', role: 'user', text: 'Continue' },
    { id: 'reply', role: 'assistant', text: 'Visible answer' },
    { id: 'human-2', role: 'user', text: contextText },
    { id: 'tools-changed', role: 'notice', text: '已添加工具 search\n已移除工具 old-tool\n' },
  ]);
});

test('tool and reasoning process does not consume chat history rows and completed turns retain their final answer', async () => {
  const record = (type, seq, data) => ({
    type: 'event', event: { type, seq, time: seq, surfaceOp: 'append', data },
  });
  const records = [record('user/message', 1, {
    id: 'question', source: { kind: 'user' }, content: [{ type: 'text', text: 'Check the project' }],
  })];
  for (let index = 0; index < 110; index++) {
    records.push(record('assistant/message', 2 + index * 3, {
      turn: 1, step: index + 1,
      message: { id: `call-${index}`, content: [
        { type: 'tool-call', id: `tool-${index}`, name: 'check' },
        { type: 'reasoning', text: 'Internal reasoning' },
      ] },
    }));
    records.push(record('tool/result', 3 + index * 3, {
      turn: 1, step: index + 1,
      message: { id: `result-${index}`, toolCallId: `tool-${index}`, content: [{ type: 'text', text: 'Process output' }] },
    }));
    records.push(record('user/message', 4 + index * 3, {
      id: `injected-${index}`, source: { kind: 'plugin', name: 'context' },
      content: [{ type: 'text', text: 'Internal context' }],
    }));
  }
  records.push(record('assistant/message', 400, {
    turn: 1, step: 111,
    message: { id: 'progress', content: [{ type: 'text', text: 'Checking the result' }] },
  }));
  records.push(record('assistant/message', 401, {
    turn: 1, step: 112,
    message: { id: 'answer', content: [
      { type: 'reasoning', text: 'Answer reasoning' },
      { type: 'text', text: 'The project is ready' },
    ] },
  }));
  records.push(record('turn/end', 402, { turn: 1 }));
  const { bridge } = makeHarness({
    snapshot: { type: 'snapshot', records, projections: { values: {} } },
  });
  const detail = await bridge.dispatch('session.open', { id: 'session-1' }, {});
  assert.deepEqual(detail.messages.map((message) => message.id), ['question', 'answer']);
  assert.equal(detail.messages[1].reasoning, 'Answer reasoning');
  assert.equal(detail.messages[1].process, 'Checking the result');
  assert.equal(detail.session.status, 'idle');
  assert.equal(detail.trace.length, 110);
  assert.ok(detail.trace.every((item) => item.subtitle === '已完成' && !item.enabled));
  assert.ok(detail.messages.every((item) => Object.keys(item).every((key) => !key.startsWith('_'))));
});

test('interrupted turns and a turn ending after a tool step preserve visible assistant progress', async () => {
  const record = (type, seq, data) => ({
    type: 'event', event: { type, seq, time: seq, surfaceOp: 'append', data },
  });
  for (const reason of ['aborted', 'interrupted', 'error', 'interleaved']) {
    const { bridge } = makeHarness({
      snapshot: {
        type: 'snapshot', projections: { values: {} },
        records: [
          record('assistant/message', 1, { turn: 1, step: 1, message: { id: 'first', content: [{ type: 'text', text: 'First update' }] } }),
          ...(reason === 'interleaved' ? [record('user/message', 2, {
            id: 'steering', source: { kind: 'user' }, content: [{ type: 'text', text: 'Please adjust' }],
          })] : []),
          record('assistant/message', 2, { turn: 1, step: 2, message: { id: 'second', content: [{ type: 'text', text: 'Second update' }] } }),
          record('turn/end', 3, { turn: 1, reason: { kind: reason === 'interleaved' ? 'completed' : reason } }),
        ],
      },
    });
    const detail = await bridge.dispatch('session.open', { id: 'session-1' }, {});
    assert.deepEqual(detail.messages.map((message) => message.id),
      reason === 'interleaved' ? ['first', 'steering', 'second'] : ['first', 'second'], reason);
  }
  const { bridge } = makeHarness({
    snapshot: {
      type: 'snapshot', projections: { values: {} },
      records: [
        record('assistant/message', 1, { turn: 2, step: 1, message: { id: 'first', content: [{ type: 'text', text: 'First update' }] } }),
        record('assistant/message', 2, { turn: 2, step: 2, message: { id: 'second', content: [{ type: 'text', text: 'Second update' }] } }),
        record('assistant/message', 3, { turn: 2, step: 3, message: { id: 'call', content: [{ type: 'tool-call', id: 'check', name: 'check' }] } }),
        record('turn/end', 4, { turn: 2, reason: { kind: 'completed' } }),
      ],
    },
  });
  const detail = await bridge.dispatch('session.open', { id: 'session-1' }, {});
  assert.deepEqual(detail.messages.map((message) => message.id), ['first', 'second']);
});

test('stream disposal settles a pending iterator.next before iterator.return', async () => {
  const events = [];
  let pendingNextResolve;
  let pendingReturnResolve;
  let disposed = false;
  const snapshot = { type: 'snapshot', records: [], projections: { values: {} } };
  const rpc = {
    async call(_channel, endpoint) {
      if (endpoint === 'session/list') {
        return { items: [{ sessionId: 'session-1', workspaceId: 'workspace-1' }] };
      }
      throw new Error(`unexpected RPC method: ${endpoint}`);
    },
    async open(_channel, endpoint) {
      if (endpoint === 'session/control') return iterable([], 0, true);
      if (endpoint !== 'session/follow') throw new Error(`unexpected stream endpoint: ${endpoint}`);
      let first = true;
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (first) {
                first = false;
                return Promise.resolve({ value: snapshot, done: false });
              }
              return new Promise((resolve) => { pendingNextResolve = resolve; });
            },
            return() {
              events.push('iterator.return');
              if (!disposed) return new Promise((resolve) => { pendingReturnResolve = resolve; });
              return Promise.resolve({ done: true });
            },
          };
        },
        async dispose() {
          events.push('dispose');
          disposed = true;
          pendingNextResolve?.({ done: true });
          pendingReturnResolve?.({ done: true });
        },
      };
    },
  };
  const bridge = createNativeBridge({ rpc });
  const connection = {
    closed: false,
    watchGeneration: 1,
    setWatch(cancel, generation) {
      this.cancel = cancel;
      return generation === this.watchGeneration;
    },
    sendEvent() {},
  };

  await bridge.dispatch('session.watch', { id: 'session-1' }, connection, { watchGeneration: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof pendingNextResolve, 'function');

  let timer;
  const closed = await Promise.race([
    connection.cancel().then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 250); }),
  ]);
  clearTimeout(timer);
  if (!closed) {
    pendingNextResolve?.({ done: true });
    pendingReturnResolve?.({ done: true });
    await connection.cancel();
  }

  assert.equal(closed, true, 'stream close waited on iterator.return before disposing');
  assert.deepEqual(events.slice(0, 2), ['dispose', 'iterator.return']);
});

function commandHarness(handlers = {}) {
  const calls = [];
  const rpc = {
    async call(channel, endpoint, ...args) {
      calls.push({ channel, endpoint, args });
      if (handlers[endpoint]) return handlers[endpoint](...args);
      return {};
    },
    async open() {
      throw new Error('unexpected stream');
    },
  };
  return { bridge: createNativeBridge({ rpc }), calls };
}

const connection = () => ({ selectedSessionId: 'session-1', stopWatch: async () => {} });

test('phone commands reject anything outside the allowlist and report DSH errors verbatim', async () => {
  const { bridge, calls } = commandHarness({
    'commands/execute': () => ({ commandId: 'c2', result: { kind: 'error', text: 'Compaction cancelled.' } }),
  });

  for (const params of [
    { command: 'export' },
    { command: 'permission', argument: 'full' },
    { command: '/goal' },
    { command: 'goal stop' },
    { command: 7 },
    { command: 'compact', argument: 'now' },
    { command: 'goal', argument: 'x'.repeat(4001) },
    { command: 'goal', argument: 'bad\u0000byte' },
    { command: 'goal', argument: 12 },
  ]) {
    await assert.rejects(
      bridge.dispatch('session.command', params, connection()),
      (error) => ['UNSUPPORTED', 'BAD_REQUEST'].includes(error.code),
      JSON.stringify(params),
    );
  }
  await assert.rejects(
    bridge.dispatch('session.command', { command: 'goal' }, {}),
    { code: 'BAD_REQUEST' },
  );
  assert.deepEqual(calls, []);

  assert.deepEqual(await bridge.dispatch('session.command', { command: 'compact' }, connection()), {
    kind: 'error',
    text: 'Compaction cancelled.',
  });
});

test('file upload stages exact bytes for the session and returns only the opaque receipt', async () => {
  assert.ok(NATIVE_METHODS.includes('file.upload'));
  const data = Buffer.from('hello report').toString('base64');
  const { bridge, calls } = commandHarness({
    'fileUploads/upload': () => ({
      receiptId: 'receipt-1',
      file: { attachmentId: 'a1', name: 'report.txt', bytes: 12 },
    }),
  });

  assert.deepEqual(
    await bridge.dispatch('file.upload', { name: 'dir/report.txt', data }, connection()),
    { receiptId: 'receipt-1', name: 'report.txt', bytes: 12 },
  );
  assert.deepEqual(calls[0].args, ['session-1', { data, name: 'dir_report.txt' }]);

  const bad = [
    { data: '' },
    { data: 'not base64!' },
    { data: Buffer.from('x').toString('base64').slice(0, -1) },
    { data: 12 },
    { data: Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64') },
  ];
  for (const params of bad) {
    await assert.rejects(
      bridge.dispatch('file.upload', { name: 'x', ...params }, connection()),
      { code: 'INVALID_ATTACHMENT' },
      JSON.stringify(params).slice(0, 80),
    );
  }
  await assert.rejects(bridge.dispatch('file.upload', { data }, {}), { code: 'BAD_REQUEST' });
  assert.equal(calls.length, 1);
});

test('binary uploads require the selected session and return only its DSH receipt', async () => {
  let uploaded = 0;
  const { bridge } = makeHarness({ fileTransfers: {
    async upload({ sessionId, name, data }) {
      assert.equal(sessionId, 'session-1');
      assert.equal(name, 'large.mov');
      let bytes = 0;
      for await (const chunk of data) bytes += chunk.length;
      uploaded++;
      return { receiptId: 'source-receipt', file: { attachmentId: 'private', name, bytes } };
    },
  } });
  const conn = { selectedSessionId: 'session-1', closed: false };
  const source = async function* () { yield Buffer.alloc(64 * 1024); };
  await assert.rejects(bridge.uploadFile({ id: 'other' }, source(), conn), { code: 'NOT_FOUND' });
  const result = await bridge.uploadFile({ id: 'session-1', name: 'large.mov' }, source(), conn);
  assert.deepEqual(result, { receiptId: 'source-receipt', name: 'large.mov', bytes: 64 * 1024 });
  conn.closed = true;
  await assert.rejects(bridge.uploadFile({ id: 'session-1' }, source(), conn), { code: 'NOT_FOUND' });
  assert.equal(uploaded, 1);
});

test('native submission receipts preserve the caller request identity and reject malformed identities', async () => {
  const { bridge, calls } = commandHarness();
  const requestId = 'ec1cc965-9896-43b4-995d-65c6d8d53b75';
  assert.deepEqual(await bridge.dispatch('session.send', { text: 'continue', requestId }, connection()), { requestId });
  assert.equal(calls.find((call) => call.endpoint === 'session/prompt').args[0].requestId, requestId);
  const legacy = await bridge.dispatch('session.send', { text: 'continue' }, connection());
  assert.match(legacy.requestId, /^[a-f0-9-]{36}$/i);
  const before = calls.length;
  for (const invalid of ['', 1, 'invalid', `${requestId}\n`]) {
    await assert.rejects(bridge.dispatch('session.send', { text: 'continue', requestId: invalid }, connection()), { code: 'BAD_REQUEST' });
  }
  assert.equal(calls.length, before);
});

function surface(type, seq, time, data, extra = {}) {
  return { type: 'event', event: { type, seq, time, surfaceOp: 'append', data, ...extra } };
}

function attachmentConnection() {
  return {
    closed: false,
    watchGeneration: 1,
    cancel: async () => {},
    setWatch(cancel, generation) {
      this.cancel = cancel;
      return generation === this.watchGeneration;
    },
    async stopWatch() {
      this.watchGeneration += 1;
      await this.cancel();
    },
    sendEvent() {},
  };
}

test('native child history keeps its canonical parent address through watch and pagination', async () => {
  const followRequests = [];
  const childValues = {
    subagent: { mode: 'one-shot' }, modelSelection: { next: { provider: 'claude', model: 'sonnet' } },
    agentTeam: { enabled: true, tasks: [] },
    subagentCatalog: [{ id: 'grandchild', label: 'Nested research', name: 'researcher', mode: 'one-shot' }],
  };
  const snapshot = { type: 'snapshot', cursor: 2, hasMore: true, records: [eventMessage('child-message', 2, 'child reply')], projections: { values: childValues } };
  const { bridge, calls } = makeHarness({
    rows: [
      { sessionId: 'parent', title: 'Parent', updatedAt: 1, running: false },
      { sessionId: 'child', title: 'Child', updatedAt: 2, running: false },
    ],
    responses: {
      'session/projections': ({ sessionId }) => ({ values: sessionId === 'parent'
        ? { subagentCatalog: [{ id: 'child', label: 'Child', mode: 'one-shot' }] } : childValues }),
      'session/page': { records: [eventMessage('older-child-message', 1, 'older reply')], hasMore: false },
    },
    streams: { 'session/follow': (request) => { followRequests.push(request); return iterable([snapshot], 0, true); } },
  });
  const connection = attachmentConnection();
  const descriptor = { parentSessionId: 'parent', mode: 'continuable' };
  try {
    const watched = await bridge.dispatch('session.watch', { id: 'child', subagent: descriptor, transcript: true }, connection, { watchGeneration: 1 });
    assert.deepEqual(watched.session.subagent, { parentSessionId: 'parent', mode: 'one-shot' });
    assert.deepEqual(watched.team, [{ id: 'grandchild', name: 'Nested research', subtitle: '', enabled: true, detail: '' }]);
    const address = { kind: 'subagent', parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot' };
    assert.deepEqual(followRequests[0].address, address);
    await bridge.dispatch('session.page', { id: 'child', throughSeq: 2, beforeSeq: 2 }, connection);
    assert.deepEqual(calls.find(({ endpoint }) => endpoint === 'session/page')?.args[0].address, address);
    const reopened = await bridge.dispatch('session.open', { id: 'child', subagent: descriptor, transcript: true }, connection);
    assert.deepEqual(reopened.session.subagent, watched.session.subagent);
    assert.deepEqual(followRequests[1].address, address);
    await assert.rejects(bridge.dispatch('session.open', { id: 'child', subagent: { parentSessionId: 'wrong' } }, connection), { code: 'NOT_FOUND' });
  } finally { await connection.stopWatch(); }
});

function controlledStream(frames = []) {
  const buffered = [...frames];
  let pending;
  let ended = false;
  let failure;
  let disposals = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (failure) return Promise.reject(failure);
          if (buffered.length) return Promise.resolve({ value: buffered.shift(), done: false });
          if (ended) return Promise.resolve({ done: true });
          return new Promise((resolve, reject) => { pending = { resolve, reject }; });
        },
        async return() { return { done: true }; },
      };
    },
    end() { ended = true; pending?.resolve({ done: true }); },
    fail(error) { failure = error; pending?.reject(error); },
    async dispose() { disposals += 1; this.end(); },
    get disposals() { return disposals; },
  };
}

test('read receipts require the current watch, never acknowledge a preload, and keep the exact delivered stream cut', async () => {
  const message = eventMessage('answer', 4, 'Shown answer');
  const snapshot = {
    type: 'snapshot', cursor: 4, records: [message],
    // A control projection may already know content not present in the follow snapshot.
    projections: { values: { duduSessionActivity: { seq: 9 } } },
    assistantStream: { revision: 0, activeAttempt: {
      attemptId: 'visible-prefix', turn: 2, step: 1, nextIndex: 2,
      stream: [
        { index: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { index: 1, chunk: { type: 'text-delta', index: 0, text: 'Part' } },
      ],
    } },
  };
  const acknowledgements: any[] = [];
  const { bridge } = makeHarness({
    snapshot, acknowledgeRead: async (id, position) => {
      acknowledgements.push({ id, position });
      return { sessionState: 'unread' };
    },
  });
  const connection = attachmentConnection();
  const watchId = '11c03864-12f9-4c40-b449-216b922c643a';
  try {
    const preload = await bridge.dispatch('session.open', { id: 'session-1', transcript: true }, {});
    assert.deepEqual(acknowledgements, []);
    assert.deepEqual(preload.readPosition, { seq: 4, stream: { turn: 2, step: 1, digest: contentDigest([{ type: 'text', text: 'Part' }]) } });
    const detail = await bridge.dispatch('session.watch', { id: 'session-1', watchId, transcript: true }, connection, { watchGeneration: 1 });
    assert.deepEqual(acknowledgements, [], 'watching alone is not reading');
    await assert.rejects(bridge.dispatch('session.read', { id: 'session-1', watchId: 'old', position: detail.readPosition }, connection), { code: 'BAD_REQUEST' });
    await assert.rejects(bridge.dispatch('session.read', { id: 'session-2', watchId, position: detail.readPosition }, connection), { code: 'NOT_FOUND' });
    const read = await bridge.dispatch('session.read', { id: 'session-1', watchId, position: detail.readPosition }, connection);
    assert.deepEqual(read, { sessionState: 'unread' });
    assert.deepEqual(acknowledgements, [{ id: 'session-1', position: detail.readPosition }]);
    await bridge.dispatch('session.unwatch', { watchId }, connection);
    await assert.rejects(bridge.dispatch('session.read', { id: 'session-1', watchId, position: detail.readPosition }, connection), { code: 'NOT_FOUND' });
  } finally { await connection.stopWatch(); }
});

test('ended and failed watch streams notify once, close both streams and release question ownership', async () => {
  for (const source of ['follow', 'control']) {
    for (const outcome of ['end', 'fail']) {
      const follow = controlledStream([{ type: 'snapshot', records: [], projections: { values: {} } }]);
      const control = controlledStream();
      let released = 0;
      const { bridge } = makeHarness({
        streams: { 'session/follow': () => follow, 'session/control': () => control },
        questionBridge: { watch() { return () => { released += 1; }; } },
      });
      const connection = attachmentConnection();
      const events = [];
      connection.sendEvent = (topic, params) => events.push({ topic, params });
      const watchId = 'a2f7f43c-b843-4e16-b82f-bbc2e27d82b0';
      await bridge.dispatch('session.watch', { id: 'session-1', watchId }, connection, { watchGeneration: 1 });
      await new Promise((resolve) => setImmediate(resolve));
      const failing = source === 'follow' ? follow : control;
      if (outcome === 'end') failing.end();
      else failing.fail(new Error('Private upstream detail must not escape'));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(events, [{
        topic: 'session.watch.failed',
        params: { id: 'session-1', watchId, code: 'UPSTREAM_UNAVAILABLE', source },
      }]);
      assert.equal(connection.nativeAttachmentState, undefined);
      assert.equal(follow.disposals, 1);
      assert.equal(control.disposals, 1);
      assert.equal(released, 1);
      await connection.cancel();
      assert.equal(released, 1);
    }
  }
});

test('initial watch failures close the acquired stream and never retain attachment authority', async () => {
  for (const mode of ['reject', 'invalid']) {
    const stream = controlledStream(mode === 'invalid' ? [{ type: 'unexpected' }] : []);
    if (mode === 'reject') stream.fail(new Error('private'));
    const { bridge } = makeHarness({ streams: { 'session/follow': () => stream } });
    const connection = attachmentConnection();
    await assert.rejects(bridge.dispatch('session.watch', { id: 'session-1' }, connection, { watchGeneration: 1 }), { code: 'UPSTREAM_UNAVAILABLE' });
    assert.equal(stream.disposals, 1);
    assert.equal(connection.nativeAttachmentState, undefined);
  }
});

test('workspace and catalog failures and missing newly-created sessions cannot return fabricated success', async () => {
  const workspace = makeHarness({ streams: { 'workspace/follow': () => { throw new Error('broken workspace'); } } });
  await assert.rejects(workspace.bridge.dispatch('session.list', {}, {}), { code: 'UPSTREAM_UNAVAILABLE' });
  const catalog = makeHarness({ responses: { 'agentPresets/list': () => { throw new Error('broken presets'); } } });
  await assert.rejects(catalog.bridge.dispatch('catalog.get', {}, {}), { code: 'UPSTREAM_UNAVAILABLE' });
  const created = makeHarness({ responses: { 'session/create': { sessionId: 'missing' } } });
  await assert.rejects(created.bridge.dispatch('session.create', {}, {}), { code: 'UPSTREAM_UNAVAILABLE' });
});

test('file change counts accompany initial and paged transcripts without opening the file browser', async () => {
  const expected = { total: 9, added: 78, deleted: 12 };
  let summary: typeof expected | undefined = expected;
  const records = [
    surface('turn/start', 1, 100, { turn: 1 }),
    surface('workspace/changes', 2, 150, { turn: 1 }),
    surface('turn/end', 3, 200, { turn: 1, reason: { kind: 'completed' } }),
  ];
  const { bridge } = makeHarness({
    snapshot: { type: 'snapshot', records, cursor: 3, projections: { values: {} } },
    responses: { 'session/page': { records: records.slice(0, 2), hasMore: false } },
    conversationReads: {
      changeCounts(sessionId, seq) {
        assert.equal(sessionId, 'session-1');
        assert.equal(seq, 2);
        return summary;
      },
      read() { assert.fail('Transcript counts must not read full comparisons'); },
    },
  });
  const connection = attachmentConnection();
  try {
    const detail = await bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, connection, { watchGeneration: 1 });
    assert.deepEqual(detail.transcript.turns[0].changesSummary, expected);
    const page = await bridge.dispatch('session.page', { id: 'session-1', beforeSeq: 3, throughSeq: 3 }, connection);
    assert.deepEqual(page.transcript.turns[0].changesSummary, expected);
    const opened = await bridge.dispatch('session.open', { id: 'session-1', transcript: true }, connection);
    assert.deepEqual(opened.transcript.turns[0].changesSummary, expected);
    summary = undefined;
    const expired = await bridge.dispatch('session.page', { id: 'session-1', beforeSeq: 3, throughSeq: 3 }, connection);
    assert.equal(expired.transcript.turns[0].changesSeq, 2);
    assert.equal(Object.hasOwn(expired.transcript.turns[0], 'changesSummary'), false);
  } finally { await bridge.closeConnection(connection); }
});

test('paged conversation features use durable event coordinates and never accept phone-supplied file paths', async () => {
  const fileReads = [];
  const records = [
    surface('user/message', 1, 100, { id: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Write a report' }] }),
    surface('turn/start', 2, 110, { turn: 1 }),
    surface('step/start', 3, 120, { turn: 1, step: 1 }),
    surface('assistant/message', 4, 140, { turn: 1, step: 1, message: { id: 'assistant', content: [
      { type: 'tool-call', id: 'write', name: 'write', argsRaw: '{"file_path":"/workspace/report.md","content":"report"}' },
    ] } }),
    surface('tool/call', 5, 150, { turn: 1, step: 1, callId: 'write', name: 'write', arguments: '{"file_path":"/workspace/report.md","content":"report"}' }),
    surface('tool/result', 6, 160, { turn: 1, step: 1, message: { source: { callId: 'write' }, content: [{ type: 'text', text: 'saved' }] } }),
    surface('workspace/changes', 7, 170, { turn: 1 }),
    surface('deliverables/presented', 8, 180, { turn: 1, files: [{ path: '/workspace/report.md', description: 'Report' }] }),
    surface('step/end', 9, 190, { turn: 1, step: 1 }),
    surface('turn/end', 10, 200, { turn: 1, reason: { kind: 'completed' } }),
  ];
  const { bridge, calls } = makeHarness({
    snapshot: { type: 'snapshot', records: records.slice(-3), cursor: 10, hasMore: true, projections: { values: {} } },
    responses: {
      'session/page': (request) => ({
        records: records.filter((item) => item.event.seq <= request.throughSeq && item.event.seq < request.beforeSeq)
          .slice(-request.maxMessages),
        hasMore: request.maxMessages === 1 && request.beforeSeq > 2,
      }),
      'session/fork': { sessionId: 'branch-1' },
    },
    conversationReads: { async read(kind, coordinates) {
      fileReads.push({ kind, coordinates });
      if (kind === 'file') return { dataBase64: 'b2s=', mediaType: 'text/plain' };
      return { files: [], kind: 'text' };
    } },
  });
  const connection = attachmentConnection();
  const detail = await bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, connection, { watchGeneration: 1 });
  assert.equal(detail.transcript.beforeSeq, 8);
  assert.equal(detail.transcript.hasMore, true);
  const older = await bridge.dispatch('session.page', { id: 'session-1', beforeSeq: 8, throughSeq: 10 }, connection);
  assert.equal(older.transcript.beforeSeq, 1);
  assert.equal(older.transcript.hasMore, false);
  assert.equal(older.transcript.tools.write.seq, 5);
  assert.equal(older.transcript.tools.write.resultSeq, 6);
  assert.equal(connection.nativeAttachmentState.state.historyStart, 8);
  const tool = await bridge.dispatch('session.tool', { id: 'session-1', callId: 'write', seq: 5, resultSeq: 6 }, connection);
  assert.equal(tool.output.text, 'saved');
  await bridge.dispatch('session.changes', { id: 'session-1', seq: 7 }, connection);
  await bridge.dispatch('session.diff', { id: 'session-1', seq: 7, index: 0 }, connection);
  const file = await bridge.dispatch('session.file', {
    id: 'session-1', kind: 'produced', seq: 6, callSeq: 5, path: '/etc/passwd',
  }, connection);
  assert.equal(file.name, 'report.md');
  assert.deepEqual(fileReads, [
    { kind: 'summary', coordinates: { sessionId: 'session-1', seq: 7 } },
    { kind: 'diff', coordinates: { sessionId: 'session-1', seq: 7, index: 0 } },
    { kind: 'file', coordinates: { path: '/workspace/report.md' } },
  ]);
  const measured = await bridge.dispatch('session.performance', { id: 'session-1', turn: 1, seq: 10 }, connection);
  assert.equal(measured.stats.steps, 1);
  assert.equal(measured.stats.llmMs, 20);
  assert.equal(measured.stats.toolMs, 10);
  assert.deepEqual(await bridge.dispatch('session.fork', { id: 'session-1', seq: 1 }, connection), { sessionId: 'branch-1' });
  assert.deepEqual(calls.findLast((call) => call.endpoint === 'session/fork').args, [{ sessionId: 'session-1', atSeq: 1 }]);
  for (const [method, params] of [
    ['session.page', { beforeSeq: 12, throughSeq: 10 }],
    ['session.tool', { seq: 5, resultSeq: 6, callId: 'other' }],
    ['session.changes', { seq: 6 }], ['session.fork', { seq: 6 }],
    ['session.file', { seq: 1, kind: 'presented', index: 0 }],
    ['session.performance', { seq: 10, turn: 2 }],
  ]) await assert.rejects(bridge.dispatch(method, { id: 'session-1', ...params }, connection));
  connection.watchGeneration += 1;
  await assert.rejects(bridge.dispatch('session.file', { id: 'session-1', kind: 'presented', seq: 8, index: 0 }, connection), { code: 'NOT_FOUND' });
});

test('a late history or tool reply cannot cross a watch replacement', async () => {
  let finish;
  const record = surface('tool/call', 1, 100, { callId: 'call', name: 'read', arguments: '{}' });
  const { bridge } = makeHarness({
    snapshot: { type: 'snapshot', records: [record], cursor: 1, projections: { values: {} } },
    responses: { 'session/page': () => new Promise((resolve) => { finish = resolve; }) },
  });
  const connection = attachmentConnection();
  await bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, connection, { watchGeneration: 1 });
  const request = bridge.dispatch('session.tool', { id: 'session-1', seq: 1, callId: 'call' }, connection);
  await new Promise((resolve) => setImmediate(resolve));
  connection.watchGeneration += 1;
  finish({ records: [record] });
  await assert.rejects(request, { code: 'NOT_FOUND' });
});

test('conversation videos use exact user-event ownership and reject a changed watch', async (t) => {
  const file = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'clip.mov', bytes: 3 };
  const dataBase64 = Buffer.from('abc').toString('base64');
  const reads = [];
  let finish;
  let wait = false;
  const payload = { name: file.name, mediaType: 'video/quicktime', dataBase64 };
  const records = [
    surface('user/message', 1, 1000, { id: 'video-user', source: { kind: 'user' }, content: [{ type: 'file', attachment: file }] }),
    surface('user/message', 2, 1001, { id: 'context-file', source: { kind: 'context' }, content: [{ type: 'file', attachment: file }] }),
  ];
  const { bridge } = makeHarness({
    snapshot: { type: 'snapshot', projections: { values: { inbox: { 'next-turn': [
      { id: 'queued-video', source: { kind: 'user' }, content: [{ type: 'file', attachment: file }] },
      { id: 'context-video', source: { kind: 'context' }, content: [{ type: 'file', attachment: file }] },
    ] } } }, records },
    responses: { 'session/page': () => ({ records }) },
    conversationReads: {
      openVideo(coordinates) {
        assert.deepEqual(coordinates, { attachment: file });
        return { bytes: file.bytes, name: file.name, mediaType: payload.mediaType, data: (async function* () {
          yield Buffer.from('a');
          yield Buffer.from('bc');
        })() };
      },
      async read(kind, coordinates) {
        reads.push({ kind, coordinates });
        if (wait) return new Promise((resolve) => { finish = resolve; });
        return payload;
      },
    },
  });
  const connection = attachmentConnection();
  t.after(() => connection.cancel());
  const detail = await bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, connection, { watchGeneration: 1 });
  assert.deepEqual(detail.transcript.entries[0].attachments, [{ kind: 'video', name: 'clip.mov', id: 'video-user:0', seq: 1 }]);
  assert.equal(JSON.stringify(detail).includes(dataBase64), false);
  const params = { id: 'session-1', kind: 'video', attachmentId: 'video-user:0', seq: 1 };
  assert.deepEqual(await bridge.dispatch('session.attachment', params, connection), payload);
  assert.deepEqual(reads, [{ kind: 'video', coordinates: { attachment: file } }]);
  for (const patch of [
    { id: 'session-2' }, { attachmentId: '/private/clip.mov' }, { seq: 2, attachmentId: 'context-file:0' },
  ]) await assert.rejects(bridge.dispatch('session.attachment', { ...params, ...patch }, connection), { code: 'NOT_FOUND' });
  assert.equal(reads.length, 1);
  for (const patch of [{ id: 'other' }, { attachmentId: 'context-file:0', seq: 2 }, { path: '/private/video.mov' }]) {
    await assert.rejects(bridge.openVideo({ id: 'session-1', attachmentId: 'video-user:0', seq: 1, ...patch }, connection),
      { code: Object.hasOwn(patch, 'path') ? 'BAD_REQUEST' : 'NOT_FOUND' });
  }
  const stream = await bridge.openVideo({ id: 'session-1', attachmentId: 'video-user:0', seq: 1 }, connection);
  const iterator = stream.data[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, Buffer.from('a'));
  assert.deepEqual(await bridge.dispatch('session.attachment', {
    id: 'session-1', kind: 'video', attachmentId: 'queue:queued-video:0',
  }, connection), payload);
  await assert.rejects(bridge.dispatch('session.attachment', {
    id: 'session-1', kind: 'video', attachmentId: 'queue:context-video:0',
  }, connection), { code: 'NOT_FOUND' });
  wait = true;
  const pending = bridge.dispatch('session.attachment', params, connection);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finish, 'function');
  connection.watchGeneration++;
  await assert.rejects(iterator.next(), { code: 'NOT_FOUND' });
  finish(payload);
  await assert.rejects(pending, { code: 'NOT_FOUND' });
});

test('conversation images are authenticated watch-scoped references without bytes in snapshots', async () => {
  const data = Buffer.from('private-image').toString('base64');
  const { bridge } = makeHarness({ snapshot: {
    type: 'snapshot', projections: { values: {} }, records: [
      surface('user/message', 1, 1_000, {
        id: 'photo-user', source: { kind: 'user' }, content: [
          { type: 'text', text: 'Inspect the picture' },
          { type: 'image', mediaType: 'image/png', data, name: 'picture.png' },
        ],
      }),
    ],
  } });
  const connection = attachmentConnection();
  const detail = await bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, connection, { watchGeneration: 1 });
  assert.equal(JSON.stringify(detail).includes(data), false);
  assert.deepEqual(detail.transcript.entries[0].attachments, [{ kind: 'image', name: 'picture.png', id: 'photo-user:1', seq: 1 }]);
  assert.deepEqual(await bridge.dispatch('session.attachment', {
    id: 'session-1', attachmentId: 'photo-user:1',
  }, connection), { mediaType: 'image/png', data });
  for (const params of [
    { id: 'session-2', attachmentId: 'photo-user:1' },
    { id: 'session-1', attachmentId: '/etc/passwd' },
    { id: 'session-1', attachmentId: 'https://example.com/private.png' },
    { id: 'session-1', attachmentId: 'photo-user:0' },
  ]) {
    await assert.rejects(bridge.dispatch('session.attachment', params, connection), { code: 'NOT_FOUND' });
  }
  connection.watchGeneration = 2;
  await assert.rejects(bridge.dispatch('session.attachment', { id: 'session-1', attachmentId: 'photo-user:1' }, connection), { code: 'NOT_FOUND' });
  connection.watchGeneration = 1;
  await connection.cancel();
  await assert.rejects(bridge.dispatch('session.attachment', { id: 'session-1', attachmentId: 'photo-user:1' }, connection), { code: 'NOT_FOUND' });
});

test('Markdown images read only persisted assistant destinations and reject a changed watch or invalid file payload', async () => {
  const data = Buffer.from('image-bytes').toString('base64');
  const records = [surface('assistant/message', 1, 1_000, { message: {
    id: 'answer', content: [{ type: 'text', text: '![image](/workspace/picture.png)\n\n[not an image](/private.txt)' }],
  } })];
  let reply = { mediaType: 'image/png', dataBase64: data };
  let duringRead = () => {};
  const reads: unknown[] = [];
  const { bridge } = makeHarness({
    snapshot: { type: 'snapshot', projections: { values: {} }, records },
    responses: { 'session/page': { records } },
    conversationReads: { async read(kind: string, coordinates: unknown) {
      reads.push([kind, coordinates]);
      duringRead();
      return reply;
    } },
  });
  const connection = attachmentConnection();
  try {
    await bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, connection, { watchGeneration: 1 });
    const params = { id: 'session-1', source: '/workspace/picture.png', seq: 1 };
    assert.deepEqual(await bridge.dispatch('session.attachment', params, connection), { mediaType: 'image/png', data });
    for (const source of ['/private.txt', '/etc/passwd', 'https://example.com/image.png']) {
      await assert.rejects(bridge.dispatch('session.attachment', { ...params, source }, connection), { code: 'NOT_FOUND' });
    }
    assert.deepEqual(reads, [['file', { path: '/workspace/picture.png' }]]);
    for (const invalid of [
      { mediaType: 'text/html', dataBase64: data },
      { mediaType: 'image/png', dataBase64: 'not!base64' },
      { mediaType: 'image/png', dataBase64: 'A'.repeat(14 * 1024 * 1024) },
    ]) {
      reply = invalid;
      await assert.rejects(bridge.dispatch('session.attachment', params, connection),
        (error: any) => ['INVALID_ATTACHMENT', 'LIMIT_EXCEEDED'].includes(error.code));
    }
    reply = { mediaType: 'image/png', dataBase64: data };
    duringRead = () => { connection.watchGeneration++; };
    await assert.rejects(bridge.dispatch('session.attachment', params, connection), { code: 'NOT_FOUND' });
  } finally { await connection.cancel(); }
});

test('conversation images reject injected context, external URLs and excessive or invalid data', async () => {
  const data = Buffer.from('image').toString('base64');
  const { bridge } = makeHarness({ snapshot: {
    type: 'snapshot', projections: { values: {} }, records: [
      surface('user/message', 1, 1_000, {
        id: 'context', source: { kind: 'plugin' }, content: [{ type: 'image', mediaType: 'image/png', data }],
      }),
      surface('user/message', 2, 1_100, {
        id: 'bad', source: { kind: 'user' }, content: [
          { type: 'image', mediaType: 'image/svg+xml', data },
          { type: 'image', mediaType: 'image/png', url: 'https://example.com/image.png' },
          { type: 'image', mediaType: 'image/png', data: 'A'.repeat(14 * 1024 * 1024) },
          { type: 'image', mediaType: 'image/png', data: 'not!base64' },
        ],
      }),
    ],
  } });
  const connection = attachmentConnection();
  await bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, connection, { watchGeneration: 1 });
  for (const attachmentId of ['context:0', 'bad:0', 'bad:1', 'bad:2']) {
    await assert.rejects(bridge.dispatch('session.attachment', { id: 'session-1', attachmentId }, connection), { code: 'NOT_FOUND' });
  }
  await assert.rejects(bridge.dispatch('session.attachment', { id: 'session-1', attachmentId: 'bad:3' }, connection), { code: 'INVALID_ATTACHMENT' });
  await connection.cancel();
});

test('queue actions use the exact host operation, reject arbitrary actions and preserve failures', async () => {
  const { bridge, calls } = makeHarness();
  for (const action of ['edit', 'remove', 'steer']) {
    await bridge.dispatch('session.queue.update', { id: 'session-1', itemId: 'queue-1', action, text: 'new text' }, {});
  }
  assert.deepEqual(calls.filter((call) => call.endpoint === 'session/updateQueue').map((call) => call.args[0]), [
    { sessionId: 'session-1', itemId: 'queue-1', action: { kind: 'edit', content: [{ type: 'text', text: 'new text' }] } },
    { sessionId: 'session-1', itemId: 'queue-1', action: { kind: 'remove' } },
    { sessionId: 'session-1', itemId: 'queue-1', action: { kind: 'steer' } },
  ]);
  for (const params of [
    { action: 'execute', text: 'command' }, { action: 'edit', text: ' ' },
    { action: 'edit', text: 'x'.repeat(60_001) },
  ]) {
    await assert.rejects(bridge.dispatch('session.queue.update', { id: 'session-1', itemId: 'queue-1', ...params }, {}), { code: 'BAD_REQUEST' });
  }
  const failing = makeHarness({ responses: { 'session/updateQueue': { ok: false, error: { code: 'session/queue-item-not-found' } } } });
  await assert.rejects(failing.bridge.dispatch('session.queue.update', { id: 'session-1', itemId: 'old', action: 'remove' }, {}), { code: 'UPSTREAM_ERROR' });
});

test('native sidebar and search return cold list hints without waiting for per-session history reads', async () => {
  let release;
  let timer;
  const pending = new Promise((resolve) => { release = resolve; });
  const rows = Array.from({ length: 128 }, (_, index) => ({
    sessionId: `cold-${index}`, updatedAt: index,
    ...(index ? { projections: { kind: 'cached', values: {
      title: `Conversation ${index}`, modelSelection: { next: { provider: 'codex', model: 'gpt' } },
    } } } : {}),
  }));
  const { bridge, calls } = makeHarness({
    rows,
    sessionActivity: () => ({ agent: 'codex', title: 'Indexed conversation', state: 'finished', sessionState: 'unread', lastActivityAt: Date.now() - 60_000 }), // handled a minute ago: a finished run unhandled for 72 hours reads Idle (2026-11-07, 72 hours since 2026-11-14)
    responses: {
      'session/projections': () => pending,
      'session/search': { items: [{ sessionId: 'cold-1', snippet: 'Matching text' }] },
    },
  });
  try {
    const result = await Promise.race([
      bridge.dispatch('session.list', {}, {}),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('List waited for cold histories')), 500); }),
    ]);
    assert.equal(result.length, rows.length);
    assert.equal(result[0].agent, 'codex', 'The activity index covers older rows without model hints.');
    assert.equal(result[0].sessionState, 'unread');
    assert.equal(result[0].title, 'Indexed conversation', 'Use an existing indexed title when DSH has no cached title.');
    assert.equal(result[1].title, 'Conversation 1');
    assert.equal((await bridge.dispatch('session.list', {}, {}))[1].agent, 'codex');
    const search = await bridge.dispatch('session.search', { query: 'Matching' }, {});
    assert.equal(search.items[0].session.title, 'Conversation 1');
    assert.equal(calls.filter((call) => call.endpoint === 'session/projections').length, 0);
  } finally {
    clearTimeout(timer);
    release({ values: {} });
  }
});

test('missing sidebar decoration is bounded, coalesced and reused instead of blocking the list', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const rows = Array.from({ length: 32 }, (_, index) => ({ sessionId: `uncached-${index}`, updatedAt: index }));
  const { bridge, calls } = makeHarness({ rows, responses: { 'session/projections': () => pending } });
  try {
    const started = performance.now();
    const listed = await bridge.dispatch('session.list', {}, {});
    assert.equal(listed.length, rows.length);
    assert.ok(performance.now() - started < 500, 'A pending cold read must not delay the sidebar.');
    assert.equal(calls.filter((call) => call.endpoint === 'session/projections').length, 4);
    await bridge.dispatch('session.list', {}, {});
    assert.equal(calls.filter((call) => call.endpoint === 'session/projections').length, 4, 'Refreshes share the background work.');
    release({ values: { title: { title: 'Loaded title' }, modelSelection: { next: { provider: 'claude', model: 'sonnet' } } } });
    await new Promise((resolve) => setImmediate(resolve));
    const warmed = await bridge.dispatch('session.list', {}, {});
    assert.ok(warmed.every((row) => row.title === 'Loaded title' && row.agent === 'claude'));
    assert.equal(calls.filter((call) => call.endpoint === 'session/projections').length, rows.length);
  } finally {
    release({ values: {} });
    await new Promise((resolve) => setImmediate(resolve));
  }
});

test('a conversation is pinned, unpinned and archived through DSH, validated, and never deleted', async () => {
  const { bridge, calls } = makeHarness();
  await bridge.dispatch('session.pin', { id: 's1', pinned: true }, {});
  await bridge.dispatch('session.pin', { id: 's1', pinned: false }, {});
  await bridge.dispatch('session.archive', { id: 's2' }, {});
  assert.deepEqual(calls.map((call) => [call.endpoint, call.args[0]]), [
    ['workspace/pinSession', { sessionId: 's1' }],
    ['workspace/unpinSession', { sessionId: 's1' }],
    ['workspace/archiveSession', { sessionId: 's2' }],
  ]);
  // The phone cannot add what DSH did not ask for, such as stopping running work.
  await bridge.dispatch('session.archive', { id: 's3', stopActivity: true }, {});
  assert.deepEqual(calls.at(-1)?.args[0], { sessionId: 's3' });

  const before = calls.length;
  for (const [method, params] of [
    ['session.pin', { id: 's1' }],
    ['session.pin', { id: 's1', pinned: 'yes' }],
    ['session.pin', { pinned: true }],
    ['session.pin', { id: '', pinned: true }],
    ['session.archive', {}],
    ['session.archive', { id: 7 }],
  ] as const) {
    await assert.rejects(bridge.dispatch(method, params, {}), { code: 'BAD_REQUEST' }, `${method} ${JSON.stringify(params)}`);
  }
  assert.equal(calls.length, before, 'nothing invalid reaches DSH');
  assert.ok(!NATIVE_METHODS.includes('session.delete'), 'DSH has no session deletion, so the phone has none');
});

test('a line of the group chat is its command in the thread with what it said attached, and the lines the owner hid are left out of 嘟嘟\'s thread only', async () => {
  const line = { v: 1, kind: 'reply', issue: { id: 9, ref: 'DUD-9', title: 'x', agent: 'codex' }, text: '结论', to: 'cmd-at', answer: 'answer', at: 5 };
  const records = [
    surface('command/run', 1, 100, { commandId: 'cmd-say', name: 'dudu-say', args: 'reply abc', source: { kind: 'user' } }),
    surface('command/done', 2, 110, { commandId: 'cmd-say', kind: 'success', text: 'DUD-9: 结论' }),
    surface('command/run', 3, 120, { commandId: 'cmd-card', name: 'dudu-card', args: 'todo', source: { kind: 'user' } }),
    surface('command/done', 4, 130, { commandId: 'cmd-card', kind: 'success' }),
  ];
  const harness = (assistantId: string) => makeHarness({
    snapshot: { type: 'snapshot', records, cursor: 4, hasMore: false, projections: { values: {} } },
    assistant: { state: () => ({ sessionId: assistantId }), groupOf: (id: string) => (id === 'cmd-say' ? line : null), hidden: () => new Set([3]), cardOf: () => null },
  });
  const watch = async (id: string) => (await harness(id).bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, attachmentConnection(), { watchGeneration: 1 })).transcript.entries;
  const mine = await watch('session-1');
  assert.deepEqual(mine.find((entry: any) => entry.commandId === 'cmd-say').group, line);
  assert.equal(mine.some((entry: any) => entry.commandId === 'cmd-card'), false, 'the card that was hidden is not in the thread');
  const another = await watch('some-other-session');
  assert.equal(another.some((entry: any) => entry.commandId === 'cmd-card'), true, 'what is hidden in the assistant\'s thread is not hidden anywhere else');
});

test('group reply deltas publish through the current native watch without adding transcript events, and cancel releases the subscription', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let line: Record<string, unknown> = { v: 1, kind: 'at', issue: { id: 9, ref: 'DUD-9', title: 'x', agent: 'claude' }, text: 'Continue', at: 5 };
  let changed: () => void = () => {};
  let released = false;
  const records = [
    surface('command/run', 1, 100, { commandId: 'cmd-at', name: 'dudu-say', args: 'at abc', source: { kind: 'user' } }),
    surface('command/done', 2, 110, { commandId: 'cmd-at', kind: 'success', text: '@DUD-9 Continue' }),
  ];
  const { bridge } = makeHarness({
    snapshot: { type: 'snapshot', records, cursor: 2, hasMore: false, projections: { values: {} } },
    assistant: {
      state: () => ({ sessionId: 'session-1' }),
      groupOf: (id: string) => id === 'cmd-at' ? line : null,
      onGroupChange: (listener: () => void) => { changed = listener; return () => { released = true; }; },
    },
  });
  const connection = attachmentConnection();
  const events: { topic: string; payload: any }[] = [];
  connection.sendEvent = (topic: string, payload: unknown) => events.push({ topic, payload });
  t.after(() => connection.stopWatch());
  const watchId = '9b7c23d6-8c61-44ac-849b-6300d21ea063';
  const initial = await bridge.dispatch('session.watch', { id: 'session-1', watchId, transcript: true }, connection, { watchGeneration: 1 });
  line = { ...line, liveReply: { text: 'First', at: 120 } };
  changed();
  line = { ...line, liveReply: { text: 'First words', at: 120 } };
  changed();
  t.mock.timers.tick(100);
  assert.equal(events.length, 1, 'text deltas use the existing 100 ms publication throttle');
  assert.equal(events[0].topic, 'session.snapshot');
  const detail = events[0].payload;
  assert.equal(detail.watchId, watchId);
  assert.equal(detail.session.id, initial.session.id);
  assert.equal(detail.transcript.throughSeq, initial.transcript.throughSeq);
  assert.equal(detail.transcript.entries.length, initial.transcript.entries.length);
  assert.deepEqual(detail.transcript.entries[0].group.liveReply, { text: 'First words', at: 120 });
  changed(); // A pending publication is cancelled with its watch.
  await connection.stopWatch();
  assert.equal(released, true);
  changed(); // Even an already queued callback cannot publish on a later watch.
  t.mock.timers.tick(100);
  assert.equal(events.length, 1);
});

test('a quick button\'s card is its command in the thread with what it listed attached; any other command, an unknown card and a failed one stay plain', async () => {
  const card = { v: 1, kind: 'todo', at: 5, total: 1, rows: [{ id: 9, ref: 'DUD-9', title: 'x', agent: 'codex', sessionState: 'unread', status: 'todo', statusType: 'todo', priority: 'none', updatedAt: 1 }] };
  const records = [
    surface('command/run', 1, 100, { commandId: 'cmd-card', name: 'dudu-card', args: 'todo', source: { kind: 'user' } }),
    surface('command/done', 2, 110, { commandId: 'cmd-card', kind: 'success', text: 'DUD-9 x' }),
    surface('command/run', 3, 120, { commandId: 'cmd-gone', name: 'dudu-card', args: 'info', source: { kind: 'user' } }),
    surface('command/done', 4, 130, { commandId: 'cmd-gone', kind: 'success' }),
    surface('command/run', 5, 140, { commandId: 'cmd-bad', name: 'dudu-card', args: 'task', source: { kind: 'user' } }),
    surface('command/done', 6, 150, { commandId: 'cmd-bad', kind: 'error', text: 'unavailable' }),
    surface('command/run', 7, 160, { commandId: 'cmd-other', name: 'compact', source: { kind: 'user' } }),
    surface('command/done', 8, 170, { commandId: 'cmd-other', kind: 'success', text: 'ok' }),
  ];
  const kept = new Map([['cmd-card', card], ['cmd-bad', card], ['cmd-other', card]]);
  const { bridge } = makeHarness({
    snapshot: { type: 'snapshot', records, cursor: 8, hasMore: false, projections: { values: {} } },
    assistant: { cardOf: (id: string) => kept.get(id) ?? null },
  });
  const detail = await bridge.dispatch('session.watch', { id: 'session-1', transcript: true }, attachmentConnection(), { watchGeneration: 1 });
  const byId = Object.fromEntries(detail.transcript.entries.map((entry: any) => [entry.commandId, entry]));
  assert.deepEqual(byId['cmd-card'].card, card);
  assert.equal(byId['cmd-card'].summary, 'DUD-9 x', 'the plain list stays as the summary');
  assert.equal('card' in byId['cmd-gone'], false, 'a card that is no longer known is the plain command');
  assert.equal('card' in byId['cmd-bad'], false, 'a command that failed has no card');
  assert.equal('card' in byId['cmd-other'], false, 'only the card command carries one');
});

// The phone lists agents by the id the plugin names them with (the app draws one it has no special case for under its own name): Pi, and the next harness, are not left out.
test('a session of a harness other than Claude and Codex is told to the phone with its own agent id', async () => {
  const rows = [{ sessionId: 's-pi', updatedAt: 1, projections: { kind: 'cached', values: { title: 'Pi work', modelSelection: { next: { provider: 'pi', model: 'x/y' } } } } }];
  const { bridge } = makeHarness({ rows });
  const [session] = await bridge.dispatch('session.list', {}, {});
  assert.equal(session.agent, 'pi');
});
