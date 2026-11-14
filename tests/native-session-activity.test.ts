import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSessionActivity } from '../host/native-session-activity.mjs';

const limit = 64 * 1024;
const job = (overrides = {}) => ({
  id: 'job-1', label: 'monitor', owner: 'parent', status: 'running', startedAt: 1000,
  output: { earliest: 0, total: 0 }, ...overrides,
});

function harness({ projections = {}, rows = {}, states = {}, jobs = [], outputFrames = [] } = {}) {
  const calls = [];
  const streams = [];
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const activity = createNativeSessionActivity({
    fail,
    rowOf: async (id) => rows[id],
    summaryOf: (row) => ({
      id: row.sessionId, title: row.title ?? row.sessionId, updatedAt: 0,
      status: row.running || row.status === 'running' ? 'running' : 'idle',
    }),
    streamHandle: (stream) => stream,
    remote: {
      async call(endpoint, request) {
        calls.push({ endpoint, request });
        if (endpoint === 'session/projections') return { values: projections[request.sessionId] ?? {} };
        if (endpoint === 'session/state') return states[request.sessionId];
        if (endpoint === 'job/kill') return { outcome: 'stopping' };
        assert.fail(`Unexpected call: ${endpoint}`);
      },
      async open(endpoint, request, signal) {
        calls.push({ endpoint, request });
        const frames = endpoint === 'job/list' ? [{ type: 'rows', jobs }] : outputFrames;
        const stream = {
          endpoint, reads: 0, closed: 0, signal,
          async next() {
            const value = frames[this.reads++];
            assert.notEqual(value, undefined, 'A snapshot read must not wait for future output');
            if (value instanceof Error) throw value;
            return { value, done: false };
          },
          async close() { this.closed++; },
        };
        streams.push(stream);
        return stream;
      },
    },
  });
  return { activity, calls, streams };
}

test('team deduplicates the authoritative child catalogs and reads unlisted children without starting agents', async () => {
  const { activity, calls } = harness({
    rows: { parent: { sessionId: 'parent', title: 'Parent', running: false } },
    states: { child: { running: true }, finished: { running: false } },
    projections: {
      parent: {
        agentTeam: { members: [
          { id: 'child', name: 'worker', phase: 'active' },
          { id: 'unavailable', name: 'failed worker', phase: 'failed' },
        ] },
        subagentCatalog: [
          { id: 'child', label: 'Research', mode: 'one-shot' },
          { id: 'finished', label: 'Completed work', mode: 'one-shot' },
          { id: 'external', label: 'External', mode: 'external' },
        ],
      },
      child: { subagent: { mode: 'one-shot' }, modelSelection: { lastUsed: { provider: 'codex', model: 'gpt' } } },
      finished: { subagentTiming: { lastTurnCompleted: true } },
    },
  });
  const { members } = await activity.dispatch('session.team', { id: 'parent' });
  assert.deepEqual(members.map(({ id, state, canOpen }) => ({ id, state, canOpen })), [
    { id: 'parent', state: 'idle', canOpen: false },
    { id: 'child', state: 'working', canOpen: true },
    { id: 'unavailable', state: 'failed', canOpen: false },
    { id: 'finished', state: 'completed', canOpen: true },
    { id: 'external', state: 'idle', canOpen: false },
  ]);
  assert.equal(members[1].name, 'Research');
  assert.equal(members[1].modelId, 'codex:gpt');
  assert.deepEqual(members[1].session.subagent, { parentSessionId: 'parent', mode: 'one-shot' });
  assert.deepEqual(calls.filter(({ endpoint }) => endpoint === 'session/state').map(({ request }) => request.sessionId), ['child', 'finished']);
  assert.equal(calls.some(({ endpoint }) => /prompt|create|resume/u.test(endpoint)), false);
});

test('child addressing comes from its real parent and mode, never from the phone', async () => {
  const { activity } = harness({
    states: { child: { running: true } },
    projections: {
      parent: { subagentCatalog: [{ id: 'child', mode: 'one-shot' }, { id: 'external', mode: 'external' }] },
      child: { subagent: { mode: 'one-shot' } },
    },
  });
  const resolved = await activity.resolveChild('child', { parentSessionId: 'parent', mode: 'continuable' });
  assert.deepEqual(resolved.address, { kind: 'subagent', parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot' });
  const childTeam = await activity.dispatch('session.team', { id: 'child', subagent: { parentSessionId: 'parent', mode: 'continuable' } });
  assert.equal(childTeam.members[0].state, 'working', 'An unlisted child keeps its real running state in its own team sheet');
  for (const [id, descriptor, code] of [
    ['child', { parentSessionId: 'other', mode: 'one-shot' }, 'NOT_FOUND'],
    ['external', { parentSessionId: 'parent', mode: 'one-shot' }, 'UNSUPPORTED'],
    ['child', { parentSessionId: 'parent', path: '/tmp/session' }, 'BAD_REQUEST'],
    ['child', { parentSessionId: 'child' }, 'BAD_REQUEST'],
  ]) {
    await assert.rejects(activity.resolveChild(id, descriptor), { code });
  }
});

test('current named child catalogs support nested navigation without a legacy Team roster', async () => {
  const { activity, calls } = harness({
    rows: { parent: { sessionId: 'parent', running: false } },
    states: { child: { running: true }, nested: { running: false } },
    projections: {
      parent: {
        agentTeam: { enabled: true, tasks: [] },
        subagentCatalog: [{ id: 'child', name: 'reviewer', label: 'Review', mode: 'continuable' }],
      },
      child: {
        subagent: { mode: 'continuable' },
        subagentCatalog: [{ id: 'nested', name: 'checker', label: 'Check', mode: 'one-shot' }],
      },
      nested: { subagent: { mode: 'one-shot' }, subagentTiming: { lastTurnCompleted: true } },
    },
  });
  const root = await activity.dispatch('session.team', { id: 'parent' });
  assert.deepEqual(root.members.map(({ id }) => id), ['parent', 'child']);
  const nested = await activity.dispatch('session.team', { id: 'child', subagent: { parentSessionId: 'parent' } });
  assert.deepEqual(nested.members.map(({ id }) => id), ['child', 'nested']);
  assert.equal(nested.members[1].state, 'completed');
  assert.deepEqual(nested.members[1].session.subagent, { parentSessionId: 'child', mode: 'one-shot' });
  await assert.rejects(activity.resolveChild('nested', { parentSessionId: 'parent' }), { code: 'NOT_FOUND' });
  assert.equal(calls.some(({ endpoint }) => /prompt|create|resume/u.test(endpoint)), false);
});

test('job lists, output and stopping are fenced to the session-visible roster and expose only native DTOs', async () => {
  const visible = job();
  const { activity, calls, streams } = harness({
    jobs: [visible, job({ id: 'shared', owner: undefined }), job({ id: 'foreign', owner: 'other' })],
    outputFrames: [{ type: 'opened', job: visible, from: 0 }],
  });
  const list = await activity.dispatch('session.jobs', { id: 'parent' });
  assert.deepEqual(list.jobs.map(({ id }) => id), ['job-1', 'shared']);
  assert.equal(Object.hasOwn(list.jobs[0], 'owner'), false);
  assert.equal(Object.hasOwn(list.jobs[0], 'output'), false);
  assert.deepEqual(await activity.dispatch('session.job.output', { id: 'parent', jobId: 'job-1' }), {
    job: { id: 'job-1', title: 'monitor', status: 'running', startedAt: 1000 }, text: '',
  });
  await activity.dispatch('session.job.stop', { id: 'parent', jobId: 'job-1' });
  assert.deepEqual(calls.find(({ endpoint }) => endpoint === 'job/kill')?.request, { sessionId: 'parent', jobId: 'job-1' });
  for (const method of ['session.job.output', 'session.job.stop']) {
    await assert.rejects(activity.dispatch(method, { id: 'parent', jobId: 'foreign' }), { code: 'NOT_FOUND' });
    await assert.rejects(activity.dispatch(method, { id: 'parent', jobId: 'job-1', owner: 'other' }), { code: 'BAD_REQUEST' });
  }
  assert.equal(calls.filter(({ endpoint }) => endpoint === 'job/kill').length, 1);
  assert.equal(calls.filter(({ endpoint }) => endpoint === 'job/follow').length, 1);
  assert.ok(streams.every(({ closed, signal }) => closed === 1 && signal.aborted));
});

test('job output drains only its opening snapshot, retains the tail and never consumes the agent cursor', async () => {
  const raw = 'prefix'.repeat(limit) + '\u001b[31mlatest\u001b[0m';
  const visible = job({ output: { earliest: 0, total: raw.length } });
  const { activity, calls, streams } = harness({
    jobs: [visible],
    outputFrames: [
      { type: 'opened', job: visible, from: raw.length - limit },
      { type: 'output', chunks: [{ at: 0, text: raw }], next: raw.length },
      new Error('Must not read live output after the snapshot boundary'),
    ],
  });
  const result = await activity.dispatch('session.job.output', { id: 'parent', jobId: visible.id });
  assert.equal(result.text.endsWith('latest'), true);
  assert.equal(result.text.includes('\u001b'), false);
  assert.ok(result.text.length <= limit);
  assert.deepEqual(calls.map(({ endpoint }) => endpoint), ['job/list', 'job/follow']);
  assert.deepEqual(calls[1].request, { sessionId: 'parent', jobId: visible.id, from: raw.length - limit });
  assert.equal(streams[1].reads, 2);
  assert.ok(streams.every(({ closed, signal }) => closed === 1 && signal.aborted));
});

test('malformed or failed job streams release observations instead of keeping a phone read alive', async () => {
  const visible = job({ output: { earliest: 0, total: 12 } });
  for (const frame of [
    new Error('observer failed'),
    { type: 'output', chunks: [], next: 0 },
    { type: 'output', chunks: [{ at: 0 }], next: 12 },
  ]) {
    const { activity, streams } = harness({
      jobs: [visible],
      outputFrames: [{ type: 'opened', job: visible, from: 0 }, frame],
    });
    await assert.rejects(activity.dispatch('session.job.output', { id: 'parent', jobId: visible.id }));
    assert.ok(streams.every(({ closed, signal }) => closed === 1 && signal.aborted));
  }
});
