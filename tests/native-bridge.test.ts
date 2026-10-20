import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NATIVE_METHODS,
  createNativeBridge,
  createTypertRpcAdapter,
} from '../host/native-bridge.mjs';

function iterable(frames, delayBeforeDoneMs = 0) {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < frames.length) return { value: frames[index++], done: false };
          if (delayBeforeDoneMs) {
            await new Promise((resolve) => setTimeout(resolve, delayBeforeDoneMs));
          }
          return { done: true };
        },
        async return() {
          return { done: true };
        },
      };
    },
    async dispose() {},
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
  followDelayMs = 0,
  rows,
  projections,
  scheduleTasks = [],
  responses = {},
  workspaces = { items: [] },
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
    async open(_channel, endpoint) {
      if (endpoint === 'workspace/follow') {
        return iterable([{ type: 'baseline', value: workspaces }]);
      }
      if (endpoint === 'session/follow') {
        return iterable([snapshot, ...followFrames], followDelayMs);
      }
      throw new Error(`unexpected stream endpoint: ${endpoint}`);
    },
  };
  return { bridge: createNativeBridge({ rpc }), calls };
}

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
  await assert.rejects(rpc.call('/api', 'arbitrary/execute'), { code: 'UNSUPPORTED' });
  assert.throws(() => createTypertRpcAdapter({
    gateway,
    peer: { principal: { kind: 'user' } },
  }), /owner-scoped/);
});

test('native bridge no longer exposes a separate skill catalog endpoint', async () => {
  const { bridge, calls } = makeHarness();

  assert.equal(NATIVE_METHODS.includes('skills.list'), false);
  await assert.rejects(
    bridge.dispatch('skills.list', { sessionId: 'session-1' }, {}),
    { code: 'UNSUPPORTED' },
  );
  assert.deepEqual(calls, []);
});

test('session details retain running status, cap history and live text, and expose only approvable plan review', async () => {
  const activeQuestions = [
    {
      callId: 'approve-call',
      questions: [{
        id: 'approve-question',
        question: 'Review this plan?',
        detail: 'Plan details',
        options: [{ label: 'Approve' }, { label: 'Decline' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    },
    {
      callId: 'generic-call',
      questions: [{
        id: 'generic-question',
        question: 'Choose one',
        options: [{ label: 'Yes' }],
      }],
    },
    {
      callId: 'multi-call',
      questions: [
        { id: 'q1', question: 'One', intent: { kind: 'plan-review', approve: 'Approve' } },
        { id: 'q2', question: 'Two', intent: { kind: 'plan-review', approve: 'Approve' } },
      ],
    },
    {
      callId: 'invalid-plan-call',
      questions: [{
        id: 'invalid-plan-question',
        question: 'Malformed plan',
        options: [{ label: 'Decline' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    },
  ];
  const snapshot = {
    type: 'snapshot',
    records: Array.from({ length: 6 }, (_, index) => eventMessage(
      `message-${index + 1}`,
      index + 1,
      String.fromCharCode(65 + index).repeat(100_000),
    )),
    projections: {
      values: {
        userQuestions: { active: activeQuestions, settled: [] },
        contextTimeline: { current: { system: 12, tools: 4 } },
        contextHeaders: { headers: [{ tools: [{ name: 'search' }] }] },
      },
    },
    assistantStream: {
      revision: 0,
      activeAttempt: {
        attemptId: 'attempt-1',
        nextIndex: 4,
        stream: [
          { index: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
          { index: 1, chunk: { type: 'text-delta', index: 0, text: 'L'.repeat(100_000) } },
          { index: 2, chunk: { type: 'text-delta', index: 0, text: 'M'.repeat(120_000) } },
          { index: 3, chunk: { type: 'reasoning-delta', index: 1, text: 'R'.repeat(100_000) } },
        ],
      },
    },
  };
  const { bridge, calls } = makeHarness({
    snapshot,
    projections: { userQuestions: { active: activeQuestions, settled: [] } },
  });
  const detail = await bridge.dispatch('session.open', { id: 'session-1' }, {});

  const history = detail.messages.filter((message) => !message.id.startsWith('live:'));
  const historyChars = history.reduce(
    (total, message) => total + message.text.length + (message.reasoning?.length ?? 0),
    0,
  );
  const live = detail.messages.find((message) => message.id.startsWith('live:'));
  const liveChars = live.text.length + (live.reasoning?.length ?? 0);
  assert.equal(detail.session.status, 'running');
  assert.equal(historyChars, 250_000);
  assert.equal(liveChars, 200_000);
  assert.equal(history.find((message) => message.id === 'message-4').text, 'D'.repeat(50_000));
  assert.equal(history.find((message) => message.id === 'message-6').text, 'F'.repeat(100_000));
  assert.deepEqual(detail.approvals, [{
    id: 'approve-call',
    sessionId: 'session-1',
    title: 'Review this plan?',
    detail: 'Plan details',
  }]);
  assert.deepEqual(detail.context.map((entry) => entry.id), [
    'context:system',
    'context:tools',
    'context:tool:0',
  ]);

  await bridge.dispatch('approval.respond', {
    sessionId: 'session-1', id: 'approve-call', decision: 'allow',
  }, {});
  const answer = calls.find((call) => call.endpoint === 'userQuestions/answer');
  assert.deepEqual(answer.args, [
    'session-1',
    'approve-call',
    { answers: [{ id: 'approve-question', selected: ['Approve'] }] },
  ]);
  await assert.rejects(
    bridge.dispatch('approval.respond', {
      sessionId: 'session-1', id: 'generic-call', decision: 'allow',
    }, {}),
    { code: 'STALE_APPROVAL' },
  );
  assert.equal(calls.filter((call) => call.endpoint === 'userQuestions/answer').length, 1);
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

test('plugin entries use entryId and moduleName from the live Host inventory', async () => {
  const { bridge } = makeHarness({ snapshot: { type: 'snapshot', records: [], projections: { values: {} } } });
  const plugins = await bridge.dispatch('plugins.list', {}, {});
  assert.deepEqual(plugins, [{
    id: 'entry-1',
    name: 'Example',
    subtitle: '@example/dsh-plugin',
    enabled: true,
    detail: 'Plugin detail',
  }]);
});

test('schedule entries preserve bounded rule, owning session, and latest delivery metadata', async () => {
  const { bridge } = makeHarness({
    scheduleTasks: [{
      id: 'schedule-1',
      kind: 'weekly',
      title: 'Weekly review',
      prompt: 'Review open project work.',
      scheduledAt: '2026-10-20T01:00:00.000Z',
      status: 'active',
      sessionId: 'session-1',
      time: '09:00:00.000',
      timeZone: 'Asia/Shanghai',
      weekdays: [1, 3, 3, 8],
      lastDelivery: {
        scheduledAt: '2026-10-19T01:00:00.000Z',
        deliveredAt: '2026-10-19T01:00:02.000Z',
        messageId: 'message-9',
      },
      deliveryHistory: { records: [{ prompt: 'must not cross bridge' }] },
    }],
  });

  const schedules = await bridge.dispatch('schedule.list', {}, {});

  assert.deepEqual(schedules, [{
    id: 'schedule-1',
    name: 'Weekly review',
    subtitle: '2026-10-20T01:00:00.000Z',
    enabled: true,
    detail: 'Review open project work.',
    schedule: {
      sessionId: 'session-1',
      rule: {
        kind: 'weekly',
        time: '09:00:00.000',
        timeZone: 'Asia/Shanghai',
        weekdays: [1, 3],
      },
      lastDelivery: {
        scheduledAt: '2026-10-19T01:00:00.000Z',
        deliveredAt: '2026-10-19T01:00:02.000Z',
        messageId: 'message-9',
      },
    },
  }]);
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

test('session listing and selection do not wait for a workspace baseline', async () => {
  let releaseWorkspace;
  let workspaceStarted;
  const workspaceStartedPromise = new Promise((resolve) => { workspaceStarted = resolve; });
  const workspaceBaseline = new Promise((resolve) => { releaseWorkspace = resolve; });
  let sessionListCalls = 0;
  const snapshot = { type: 'snapshot', records: [], projections: { values: {} } };
  const rpc = {
    async call(_channel, endpoint) {
      if (endpoint === 'session/list') {
        sessionListCalls += 1;
        return { items: [{ sessionId: 'session-1', cwd: '/tmp/project' }] };
      }
      throw new Error(`unexpected RPC method: ${endpoint}`);
    },
    async open(_channel, endpoint) {
      if (endpoint === 'workspace/follow') {
        workspaceStarted();
        let first = true;
        return {
          [Symbol.asyncIterator]() {
            return {
              next() {
                if (!first) return Promise.resolve({ done: true });
                first = false;
                return workspaceBaseline.then((value) => ({ value, done: false }));
              },
              async return() { return { done: true }; },
            };
          },
          async dispose() {},
        };
      }
      if (endpoint === 'session/follow') {
        let first = true;
        return {
          [Symbol.asyncIterator]() {
            return {
              next() {
                if (!first) return Promise.resolve({ done: true });
                first = false;
                return Promise.resolve({ value: snapshot, done: false });
              },
              async return() { return { done: true }; },
            };
          },
          async dispose() {},
        };
      }
      throw new Error(`unexpected stream endpoint: ${endpoint}`);
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
  const beforeDeadline = async (promise) => {
    let timer;
    const timeout = Symbol('timeout');
    const result = await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(timeout), 500); }),
    ]);
    clearTimeout(timer);
    assert.notEqual(result, timeout, 'operation waited for the workspace baseline');
    return result;
  };

  try {
    const sessions = await beforeDeadline(bridge.dispatch('session.list', {}, {}));
    await workspaceStartedPromise;
    assert.equal(sessions[0].id, 'session-1');

    const detail = await beforeDeadline(bridge.dispatch('session.watch', {
      id: 'session-1',
    }, connection, { watchGeneration: 1 }));
    assert.equal(detail.session.id, 'session-1');
    assert.equal(sessionListCalls, 1, 'selection reuses the recent DSH session rows');

    await connection.cancel();
  } finally {
    releaseWorkspace({
      type: 'baseline',
      value: { items: [{ workspaceId: 'workspace-1', title: 'Project', path: '/tmp/project' }] },
    });
    await bridge.dispatch('workspace.list', {}, {}).catch(() => {});
  }
  const regrouped = await bridge.dispatch('session.list', {}, {});
  assert.equal(regrouped[0].workspaceName, 'Project');
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

test('phone commands are an explicit goal/plan/compact allowlist run through the DSH executor', async () => {
  assert.ok(NATIVE_METHODS.includes('session.command'));
  const { bridge, calls } = commandHarness({
    'commands/execute': () => ({ commandId: 'c1', result: { kind: 'success', text: 'Plan mode on.' } }),
  });

  assert.deepEqual(await bridge.dispatch('session.command', { command: 'plan' }, connection()), {
    kind: 'success',
    text: 'Plan mode on.',
  });
  await bridge.dispatch('session.command', { id: 'session-2', command: 'plan', argument: ' off ' }, connection());
  await bridge.dispatch('session.command', { command: 'goal', argument: 'edit ship the release' }, connection());
  await bridge.dispatch('session.command', { command: 'goal' }, connection());
  await bridge.dispatch('session.command', { command: 'compact' }, connection());

  assert.deepEqual(calls.map((call) => call.args[0]), [
    { agentId: 'session-1', line: '/plan', submittedAttachments: [] },
    { agentId: 'session-2', line: '/plan off', submittedAttachments: [] },
    { agentId: 'session-1', line: '/goal edit ship the release', submittedAttachments: [] },
    { agentId: 'session-1', line: '/goal', submittedAttachments: [] },
    { agentId: 'session-1', line: '/compact', submittedAttachments: [] },
  ]);
});

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

test('file upload without a usable receipt fails safely', async () => {
  const data = Buffer.from('x').toString('base64');
  const { bridge } = commandHarness({ 'fileUploads/upload': () => ({ file: {} }) });
  await assert.rejects(
    bridge.dispatch('file.upload', { name: 'x', data }, connection()),
    { code: 'UPSTREAM_UNAVAILABLE' },
  );
});

test('prompts carry staged file receipts next to text and images', async () => {
  const { bridge, calls } = commandHarness();
  const image = Buffer.from('png-bytes').toString('base64');

  await bridge.dispatch('session.send', {
    text: 'look',
    attachments: [
      { dataBase64: image, mimeType: 'image/png', name: 'a.png' },
      { receiptId: 'receipt-1', name: 'report.txt' },
    ],
  }, connection());

  const prompt = calls.find((call) => call.endpoint === 'session/prompt').args[0];
  assert.deepEqual(prompt.content, [
    { type: 'text', text: 'look' },
    { type: 'image', mediaType: 'image/png', data: image, name: 'a.png' },
    { type: 'file', receiptId: 'receipt-1' },
  ]);

  await bridge.dispatch('session.send', {
    attachments: [{ receiptId: 'receipt-2' }],
  }, connection());
  const second = calls.filter((call) => call.endpoint === 'session/prompt').at(-1).args[0];
  assert.deepEqual(second.content, [{ type: 'file', receiptId: 'receipt-2' }]);

  for (const attachments of [
    [{ receiptId: 'has space' }],
    [{ receiptId: '' }],
    [{ receiptId: 7 }],
    Array.from({ length: 6 }, (_, index) => ({ receiptId: `r${index}` })),
    Array.from({ length: 4 }, () => ({ dataBase64: image, mimeType: 'image/png' })),
  ]) {
    await assert.rejects(
      bridge.dispatch('session.send', { text: 'x', attachments }, connection()),
      { code: 'INVALID_ATTACHMENT' },
    );
  }
});

test('Typert adapter maps file uploads to the agent scope and the encoded request body', async () => {
  const peer = { principal: { kind: 'owner' } };
  const invocations = [];
  const gateway = {
    async invoke(request) {
      invocations.push(request);
      return { ok: true, value: {} };
    },
    async stream() { return iterable([]); },
  };
  const rpc = createTypertRpcAdapter({ gateway, peer });

  await rpc.call('/api', 'fileUploads/upload', 'session-1', { data: 'AAAA', name: 'a.bin' });
  assert.deepEqual(invocations[0], {
    namespace: 'fileUploads',
    method: 'upload',
    args: { agentId: 'session-1', request: { data: 'AAAA', name: 'a.bin' } },
    peer,
    signal: undefined,
  });
  await assert.rejects(rpc.call('/api', 'fileUploads/upload', 'session-1'), { code: 'BAD_REQUEST' });
  await assert.rejects(rpc.call('/api', 'fileUploads/upload', '', { data: 'AAAA' }), { code: 'BAD_REQUEST' });
});

function surface(type, seq, time, data, extra = {}) {
  return { type: 'event', event: { type, seq, time, surfaceOp: 'append', data, ...extra } };
}

test('transcript mode returns structured entries, turn timing, goal and plan state instead of messages', async () => {
  const records = [
    surface('user/message', 1, 1_000, {
      id: 'u1',
      content: [{ type: 'text', text: 'who uses memory?' }, { type: 'image', name: 'shot.png' }],
      source: { kind: 'user' },
    }),
    { type: 'event', event: { type: 'turn/start', seq: 2, time: 1_100, data: { turn: 1 } } },
    surface('assistant/message', 3, 2_000, {
      turn: 1,
      step: 1,
      usage: { totalTokens: 1200 },
      message: {
        id: 'a1',
        content: [
          { type: 'reasoning', text: 'The user asks about memory.\nSecond line.' },
          { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"ps aux","description":"List top memory processes"}' },
          { type: 'tool-call', id: 'call-2', name: 'read', arguments: '{"path":"/tmp/report.txt"}' },
        ],
      },
    }),
    surface('tool/result', 4, 2_100, {
      turn: 1,
      step: 1,
      message: { toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: 'ok' }] },
    }),
    surface('tool/result', 5, 2_200, {
      turn: 1,
      step: 1,
      message: { toolCallId: 'call-2', isError: true, content: [{ type: 'text', text: 'denied' }] },
    }),
    surface('assistant/message', 6, 3_000, {
      turn: 1,
      step: 2,
      usage: { totalTokens: 800 },
      message: { id: 'a2', content: [{ type: 'text', text: 'Here is the answer.' }] },
    }),
    { type: 'event', event: { type: 'turn/end', seq: 7, time: 45_100, data: { turn: 1, reason: { kind: 'completed' } } } },
    { type: 'event', event: { type: 'command/run', seq: 8, time: 46_000, data: { commandId: 'cmd-1', name: 'compact' } } },
    { type: 'event', event: { type: 'compaction/summary', seq: 9, time: 46_100, data: {
      sourceCommandId: 'cmd-1', shadowedSeqs: [1, 2, 3], shadowedTokenCount: 4200,
      summary: [{ type: 'text', text: '## Summary\n' }, { type: 'image', name: 'skipped' }, { type: 'text', text: 'Kept the plan.\n' }],
    } } },
    { type: 'event', event: { type: 'command/done', seq: 10, time: 46_200, data: { commandId: 'cmd-1', kind: 'success', text: 'Compacted 3 history items (~4200 tokens).' } } },
    surface('user/message', 11, 47_000, {
      id: 'g1', content: [{ type: 'text', text: 'Keep working on the goal.' }], source: { kind: 'goal' },
    }),
    surface('user/message', 12, 47_500, {
      id: 'ctx', content: [{ type: 'text', text: 'injected' }], source: { kind: 'context-injection' },
    }),
  ];
  const snapshot = {
    type: 'snapshot',
    records,
    projections: {
      values: {
        goal: { goal: { id: 'goal-1', phase: 'active', objective: 'Ship the release', revision: 2 } },
        plan: { active: false, pending: true },
      },
    },
  };
  const { bridge } = makeHarness({ snapshot });
  const detail = await bridge.dispatch('session.open', { id: 'session-1', transcript: true }, {});

  assert.deepEqual(detail.messages, []);
  assert.deepEqual(detail.goal, { id: 'goal-1', phase: 'active', objective: 'Ship the release' });
  assert.equal(detail.planMode, true);
  const { entries, turns } = detail.transcript;
  assert.deepEqual(turns, [{ turn: 1, start: 1_100, end: 45_100, outcome: 'done' }]);
  assert.deepEqual(entries.map((entry) => [entry.type, entry.id]), [
    ['user', 'u1'],
    ['assistant', 'a1'],
    ['assistant', 'a2'],
    ['command', 'command:cmd-1'],
    ['trigger', 'g1'],
  ]);
  assert.deepEqual(entries[0], {
    type: 'user', id: 'u1', seq: 1, time: 1_000, text: 'who uses memory?',
    attachments: [{ kind: 'image', name: 'shot.png' }],
  });
  assert.deepEqual(entries[1].calls, [
    { id: 'call-1', name: 'bash', activity: 'commands', detail: 'List top memory processes', status: 'done' },
    { id: 'call-2', name: 'read', activity: 'read', detail: '/tmp/report.txt', status: 'error' },
  ]);
  assert.equal(entries[1].reasoning, 'The user asks about memory.\nSecond line.');
  assert.equal(entries[1].usage, 1200);
  assert.equal(entries[2].text, 'Here is the answer.');
  assert.deepEqual(
    { ...entries[3], seq: undefined },
    {
      type: 'command', id: 'command:cmd-1', commandId: 'cmd-1', seq: undefined, time: 46_000,
      name: 'compact', outcome: 'success', summary: 'Compacted 3 history items (~4200 tokens).',
      compaction: { items: 3, tokens: 4200, summary: '## Summary\nKept the plan.' },
    },
  );
  assert.deepEqual(entries[4], {
    type: 'trigger', id: 'g1', seq: 11, time: 47_000, source: 'goal', text: 'Keep working on the goal.',
  });
});

test("the conversation's task list is DSH's todos projection, cleaned and bounded", async () => {
  const open = async (todos: unknown) => {
    const { bridge } = makeHarness({ snapshot: { type: 'snapshot', records: [], projections: { values: { todos } } } });
    return bridge.dispatch('session.open', { id: 'session-1' }, {});
  };

  const detail = await open([
    { content: '  补通用奖励/弹窗预检识别  ', status: 'in_progress', activeForm: 'ignored' },
    { content: '只用大目标跑 campaign 验证弹窗处理', status: 'pending' },
    { content: '观察 26/50 是否变化', status: 'completed' },
    { content: '状态不明的一项', status: 'weird' },
    { content: '   ', status: 'pending' },
    { status: 'pending' },
    'not an item',
    null,
  ]);
  assert.deepEqual(detail.todos, [
    { content: '补通用奖励/弹窗预检识别', status: 'in_progress' },
    { content: '只用大目标跑 campaign 验证弹窗处理', status: 'pending' },
    { content: '观察 26/50 是否变化', status: 'completed' },
    { content: '状态不明的一项', status: 'pending' },
  ], 'an unknown state is pending, and an item with no text is not an item');

  // No list, an empty list and something that is not a list all mean the panel is absent.
  for (const value of [undefined, [], 'todo', { content: 'x' }, [{ status: 'pending' }]]) {
    assert.equal('todos' in await open(value), false, JSON.stringify(value));
  }

  const long = await open(Array.from({ length: 150 }, (_, index) => ({ content: `任务 ${index}`.padEnd(900, '字'), status: 'pending' })));
  assert.equal(long.todos.length, 100);
  assert.equal(long.todos[0].content.length, 500);
});

test('compaction summaries are capped, attach to their command, and stand alone for automatic compaction', async () => {
  const records = [
    { type: 'event', event: { type: 'command/run', seq: 1, time: 1_000, data: { commandId: 'c1', name: 'compact' } } },
    { type: 'event', event: { type: 'compaction/summary', seq: 2, time: 1_100, data: {
      sourceCommandId: 'c1', shadowedSeqs: [1], shadowedTokenCount: 10,
      summary: [{ type: 'text', text: 'x'.repeat(50_000) }],
    } } },
    { type: 'event', event: { type: 'command/done', seq: 3, time: 1_200, data: { commandId: 'c1', kind: 'success', text: 'Compacted 1 history item (~10 tokens).' } } },
    // Automatic compaction has no command: it becomes its own entry, and an empty summary adds nothing.
    { type: 'event', event: { type: 'compaction/summary', seq: 4, time: 2_000, data: {
      compactionId: 'auto-1', shadowedSeqs: [1, 2], shadowedTokenCount: 20, summary: [{ type: 'text', text: 'Auto summary.' }],
    } } },
    { type: 'event', event: { type: 'compaction/summary', seq: 5, time: 3_000, data: {
      compactionId: 'auto-2', shadowedSeqs: [3], shadowedTokenCount: 5, summary: [{ type: 'text', text: '  \n ' }],
    } } },
  ];
  const { bridge } = makeHarness({ snapshot: { type: 'snapshot', records, projections: { values: {} } } });
  const detail = await bridge.dispatch('session.open', { id: 'session-1', transcript: true }, {});
  const [command, auto, empty] = detail.transcript.entries;

  assert.equal(command.compaction.summary.length, 20_000);
  assert.equal(command.compaction.items, 1);
  assert.equal(auto.type, 'compaction');
  assert.equal(auto.id, 'compaction:auto-1');
  assert.equal(auto.summary, 'Auto summary.');
  assert.equal(auto.items, 2);
  assert.equal(empty.summary, undefined);
});

test('compaction summaries count toward the transcript size budget', async () => {
  const records = [];
  for (let index = 0; index < 20; index += 1) {
    records.push({ type: 'event', event: { type: 'compaction/summary', seq: index + 1, time: index, data: {
      compactionId: `auto-${index}`, shadowedSeqs: [index], shadowedTokenCount: index,
      summary: [{ type: 'text', text: 'y'.repeat(20_000) }],
    } } });
  }
  const { bridge } = makeHarness({ snapshot: { type: 'snapshot', records, projections: { values: {} } } });
  const detail = await bridge.dispatch('session.open', { id: 'session-1', transcript: true }, {});
  const total = detail.transcript.entries.reduce((sum, entry) => sum + (entry.summary?.length ?? 0), 0);

  assert.ok(total <= 250_000, `kept ${total} summary characters`);
  assert.ok(detail.transcript.entries.length < 20, 'the oldest compactions are dropped first');
  assert.equal(detail.transcript.entries.at(-1).id, 'compaction:auto-19');
});

const MODEL_CATALOG = {
  groups: [
    {
      id: 'deepseek',
      models: [
        {
          id: 'v4-flash',
          name: 'DeepSeek-V4.1-Flash',
          reasoning: {
            defaultEffort: 'high',
            efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }, { id: 'bad id!', name: 'Skipped' }],
          },
        },
        { id: 'plain', name: 'Plain model' },
      ],
    },
  ],
};

const PRESET_ROSTER = {
  presets: [
    { id: 'standard', isDefault: true, name: '标准模式', description: '处理代码、文件和资料。' },
    { id: 'minimal', isDefault: false },
    { id: 'cordis', isDefault: false, name: '创造模式', broken: 'plugin failed to load' },
    { id: 'bad id!', isDefault: false, name: 'Skipped' },
  ],
};

test('catalog.get lists reasoning efforts per model and the usable agent presets', async () => {
  const { bridge } = makeHarness({
    responses: {
      'session/modelCatalog': MODEL_CATALOG,
      'permissionPresets/catalog': { options: [{ value: 'read-only', name: 'read-only' }] },
      'agentPresets/list': PRESET_ROSTER,
    },
  });
  const catalog = await bridge.dispatch('catalog.get', {}, {});

  assert.deepEqual(catalog.models, [
    {
      id: 'deepseek:v4-flash',
      name: 'DeepSeek-V4.1-Flash',
      efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
      defaultEffort: 'high',
    },
    { id: 'deepseek:plain', name: 'Plain model' },
  ]);
  assert.deepEqual(catalog.permissions, [{ id: 'read-only', name: 'read-only' }]);
  assert.deepEqual(catalog.presets, [
    { id: 'standard', name: '标准模式', description: '处理代码、文件和资料。', isDefault: true },
    { id: 'minimal', name: 'minimal', isDefault: false },
  ]);
});

test('catalog.get still works on a host without the agent preset registry', async () => {
  const { bridge } = makeHarness({
    responses: {
      'session/modelCatalog': MODEL_CATALOG,
      'permissionPresets/catalog': { options: [] },
      'agentPresets/list': () => { throw new Error('unknown method'); },
    },
  });
  const catalog = await bridge.dispatch('catalog.get', {}, {});

  assert.deepEqual(catalog.presets, []);
  assert.equal(catalog.models.length, 2);
});

test('session.configure changes only the reasoning effort of the model already in use', async () => {
  const { bridge, calls } = makeHarness({
    responses: {
      'session/modelCatalog': MODEL_CATALOG,
      'session/projections': { values: { modelSelection: { next: { provider: 'deepseek', model: 'v4-flash', reasoningEffort: 'high' } } } },
    },
  });
  await bridge.dispatch('session.configure', { id: 'session-1', reasoningEffort: 'max' }, {});

  const selection = calls.find((call) => call.endpoint === 'session/selectModel');
  assert.deepEqual(selection.args[0], {
    sessionId: 'session-1', provider: 'deepseek', model: 'v4-flash', reasoningEffort: 'max',
  });
  await assert.rejects(
    bridge.dispatch('session.configure', { id: 'session-1', reasoningEffort: 'turbo' }, {}),
    { code: 'BAD_REQUEST' },
  );
  await assert.rejects(
    bridge.dispatch('session.configure', { id: 'session-1', reasoningEffort: 7 }, {}),
    { code: 'BAD_REQUEST' },
  );
  assert.equal(calls.filter((call) => call.endpoint === 'session/selectModel').length, 1);
});

test('session.configure picks the default effort when only the model changes and rejects efforts of another model', async () => {
  const { bridge, calls } = makeHarness({ responses: { 'session/modelCatalog': MODEL_CATALOG } });
  await bridge.dispatch('session.configure', { id: 'session-1', modelId: 'deepseek:v4-flash' }, {});
  await bridge.dispatch('session.configure', { id: 'session-1', modelId: 'deepseek:plain' }, {});

  const selections = calls.filter((call) => call.endpoint === 'session/selectModel').map((call) => call.args[0]);
  assert.deepEqual(selections, [
    { sessionId: 'session-1', provider: 'deepseek', model: 'v4-flash', reasoningEffort: 'high' },
    { sessionId: 'session-1', provider: 'deepseek', model: 'plain' },
  ]);
  await assert.rejects(
    bridge.dispatch('session.configure', { id: 'session-1', modelId: 'deepseek:plain', reasoningEffort: 'high' }, {}),
    { code: 'BAD_REQUEST' },
  );
});

test('session.configure selects an agent preset only from the host roster', async () => {
  const { bridge, calls } = makeHarness({ responses: { 'agentPresets/list': PRESET_ROSTER } });
  await bridge.dispatch('session.configure', { id: 'session-1', agentPreset: 'minimal' }, {});

  const select = calls.find((call) => call.endpoint === 'agentPresets/select');
  assert.deepEqual(select.args, ['session-1', 'minimal']);
  for (const agentPreset of ['cordis', 'missing', 'bad id!', 5]) {
    await assert.rejects(
      bridge.dispatch('session.configure', { id: 'session-1', agentPreset }, {}),
      { code: 'BAD_REQUEST' },
      `rejects ${agentPreset}`,
    );
  }
  assert.equal(calls.filter((call) => call.endpoint === 'agentPresets/select').length, 1);
});

test('session.create forwards the workspace, agent preset and blank session to reuse', async () => {
  const { bridge, calls } = makeHarness({
    responses: {
      'session/create': { sessionId: 'blank-1', agentPreset: 'minimal' },
      'session/list': { items: [{ sessionId: 'blank-1', title: '', workspaceId: 'w1', workspaceName: 'harness' }] },
    },
  });
  const connection = {};
  const summary = await bridge.dispatch('session.create', {
    workspaceId: 'w1', agentPreset: 'minimal', reuse: 'blank-1',
  }, connection);

  assert.deepEqual(calls.find((call) => call.endpoint === 'session/create').args[0], {
    workspaceId: 'w1', agentPreset: 'minimal', sessionId: 'blank-1',
  });
  assert.equal(summary.id, 'blank-1');
  assert.equal(summary.workspaceId, 'w1');
  assert.equal(connection.selectedSessionId, 'blank-1');
  for (const params of [{ agentPreset: 'bad id!' }, { agentPreset: 3 }, { reuse: '' }, { reuse: 4 }, { workspaceId: '' }]) {
    await assert.rejects(bridge.dispatch('session.create', params, {}), { code: 'BAD_REQUEST' });
  }
});

test('session detail reports the reasoning effort and agent preset in use', async () => {
  const snapshot = {
    type: 'snapshot',
    records: [],
    projections: {
      values: {
        modelSelection: { next: { provider: 'deepseek', model: 'v4-flash', reasoningEffort: 'max' } },
        agentPreset: 'minimal',
      },
    },
  };
  const { bridge } = makeHarness({ snapshot });
  const detail = await bridge.dispatch('session.open', { id: 'session-1' }, {});

  assert.equal(detail.modelId, 'deepseek:v4-flash');
  assert.equal(detail.reasoningEffort, 'max');
  assert.equal(detail.agentPreset, 'minimal');
});

test('Typert adapter maps the agent preset endpoints to the agent scope', async () => {
  const peer = { principal: { kind: 'owner' } };
  const invocations = [];
  const gateway = {
    async invoke(request) { invocations.push(request); return { ok: true, value: {} }; },
    async stream() { return iterable([]); },
  };
  const rpc = createTypertRpcAdapter({ gateway, peer });

  await rpc.call('/api', 'agentPresets/list');
  await rpc.call('/api', 'agentPresets/select', 'session-1', 'minimal');
  assert.deepEqual(invocations.map((call) => [call.namespace, call.method, call.args]), [
    ['agentPresets', 'list', {}],
    ['agentPresets', 'select', { agentId: 'session-1', agentPreset: 'minimal' }],
  ]);
  await assert.rejects(rpc.call('/api', 'agentPresets/select', 'session-1'), { code: 'BAD_REQUEST' });
  await assert.rejects(rpc.call('/api', 'agentPresets/select', '', 'minimal'), { code: 'BAD_REQUEST' });
  await assert.rejects(rpc.call('/api', 'agentPresets/select', 'session-1', 'bad id!'), { code: 'BAD_REQUEST' });
  await assert.rejects(rpc.call('/api', 'agentPresets/list', 'extra'), { code: 'BAD_REQUEST' });
});

test('legacy messages stay untouched when the app does not ask for the transcript', async () => {
  const snapshot = {
    type: 'snapshot',
    records: [eventMessage('m1', 1, 'hello')],
    projections: { values: { goal: { goal: { id: 'g', phase: 'complete', objective: 'done' } } } },
  };
  const { bridge } = makeHarness({ snapshot });
  const detail = await bridge.dispatch('session.open', { id: 'session-1' }, {});
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.transcript, undefined);
  assert.equal(detail.goal, undefined);
  assert.equal(detail.planMode, false);
});

test('live tool calls expose their running detail from streaming arguments', async () => {
  const snapshot = {
    type: 'snapshot',
    records: [],
    projections: { values: {} },
    assistantStream: {
      revision: 0,
      activeAttempt: {
        attemptId: 'attempt-1',
        nextIndex: 4,
        stream: [
          { index: 0, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
          { index: 1, chunk: { type: 'tool-call-delta', index: 0, id: 'live-call', name: 'bash', argumentsDelta: '{"descri' } },
          { index: 2, chunk: { type: 'tool-call-delta', index: 0, id: 'live-call', argumentsDelta: 'ption":"Update transport test' } },
          { index: 3, chunk: { type: 'block-start', index: 1, blockType: 'reasoning' } },
        ],
      },
    },
  };
  const { bridge } = makeHarness({ snapshot });
  const detail = await bridge.dispatch('session.open', { id: 'session-1', transcript: true }, {});
  assert.deepEqual(detail.transcript.live.calls, [{
    id: 'live-call', name: 'bash', activity: 'commands', detail: 'Update transport test',
  }]);
});

test('session.list places sessions by DSH membership and carries the archive and pin DSH keeps', async () => {
  const { bridge } = makeHarness({
    rows: [
      { sessionId: 'a', title: 'A', cwd: '/elsewhere', updatedAt: 3 },
      { sessionId: 'b', title: 'B', updatedAt: 2 },
      { sessionId: 'c', title: 'C', blank: true, updatedAt: 1 },
      { sessionId: 'd', title: 'D', updatedAt: 4 },
      { sessionId: 'e', title: 'E', cwd: '/p/one/sub', updatedAt: 5 },
    ],
    workspaces: {
      items: [
        { workspaceId: 'w1', title: '一', path: '/p/one', sessionIds: ['b', 'a'] },
        { workspaceId: 'w2', title: '二', path: '/p/two', sessionIds: ['d'] },
      ],
      archivedSessionIds: ['d'],
      pinnedSessionIds: ['a', 'b'],
    },
  });
  const rows = await bridge.dispatch('session.list', {}, {});
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  // Membership wins over the working directory ("a" lives elsewhere but DSH accounts it to 一).
  assert.deepEqual([byId.a.workspaceId, byId.a.workspaceName], ['w1', '一']);
  assert.equal(byId.b.workspaceId, 'w1');
  assert.equal(byId.a.order, undefined, 'DSH keeps no order the phone could use');
  // Pins are ranked most recent first; archived sessions are marked, not removed.
  assert.deepEqual([byId.a.pinned, byId.a.pinRank, byId.b.pinRank], [true, 0, 1]);
  assert.deepEqual([byId.d.workspaceId, byId.d.archived], ['w2', true]);
  assert.equal(byId.b.archived, undefined);
  assert.equal(byId.c.pinned, undefined);
  // An empty conversation is flagged so the phone can hide it, as DSH does.
  assert.equal(byId.c.blank, true);
  assert.equal(byId.c.workspaceId, undefined);
  // A session no workspace accounts for falls back to the directory it runs in.
  assert.equal(byId.e.workspaceId, 'w1');
});

test('renaming or deleting a workspace and unarchiving a session go through DSH and are validated', async () => {
  const { bridge, calls } = makeHarness();
  await bridge.dispatch('workspace.rename', { id: 'w1', title: '  新名称  ' }, {});
  await bridge.dispatch('workspace.delete', { id: 'w1' }, {});
  await bridge.dispatch('session.unarchive', { id: 's1' }, {});
  assert.deepEqual(calls.map((call) => [call.endpoint, call.args[0]]), [
    ['workspace/rename', { workspaceId: 'w1', title: '新名称' }],
    ['workspace/delete', { workspaceId: 'w1' }],
    ['workspace/unarchiveSession', { sessionId: 's1' }],
  ]);

  const before = calls.length;
  for (const [method, params] of [
    ['workspace.rename', { id: 'w1', title: '   ' }],
    ['workspace.rename', { title: 'x' }],
    ['workspace.delete', {}],
    ['session.unarchive', { id: 7 }],
  ] as const) {
    await assert.rejects(bridge.dispatch(method, params, {}), { code: 'BAD_REQUEST' }, method);
  }
  assert.equal(calls.length, before, 'nothing invalid reaches DSH');
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

test('Typert adapter names the workspace requests the gateway expects', async () => {
  const peer = { principal: { kind: 'owner' } };
  const invocations = [];
  const gateway = {
    async invoke(request) { invocations.push(request); return { ok: true, value: {} }; },
    async stream() { return iterable([]); },
  };
  const rpc = createTypertRpcAdapter({ gateway, peer });
  await rpc.call('/api', 'workspace/rename', { workspaceId: 'w', title: 't' });
  await rpc.call('/api', 'workspace/delete', { workspaceId: 'w' });
  await rpc.call('/api', 'workspace/unarchiveSession', { sessionId: 's' });
  await rpc.call('/api', 'workspace/archiveSession', { sessionId: 's' });
  await rpc.call('/api', 'workspace/pinSession', { sessionId: 's' });
  await rpc.call('/api', 'workspace/unpinSession', { sessionId: 's' });
  assert.deepEqual(invocations.map((item) => [item.namespace, item.method, item.args]), [
    ['workspace', 'rename', { request: { workspaceId: 'w', title: 't' } }],
    ['workspace', 'delete', { request: { workspaceId: 'w' } }],
    ['workspace', 'unarchiveSession', { request: { sessionId: 's' } }],
    ['workspace', 'archiveSession', { request: { sessionId: 's' } }],
    ['workspace', 'pinSession', { request: { sessionId: 's' } }],
    ['workspace', 'unpinSession', { request: { sessionId: 's' } }],
  ]);
  await assert.rejects(rpc.call('/api', 'workspace/insertBefore', { workspaceId: 'w' }), { code: 'UNSUPPORTED' });
});
