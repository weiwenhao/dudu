import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionEvents } from '../host/providers/native/session-events.mjs';

// The log of a loaded session must be one DSH reads back. DSH checks a stored log as it opens it: events are contiguous, a
// turn holds steps that open and close in order, and a tool result answers a call that came before it. This keeps those
// rules (copied from what DSH's reader enforces) so a change here cannot write a log DSH would refuse as corrupt.
function assertReadableLog(events: any[]) {
  let turn: number | null = null;
  let step: number | null = null;
  let nextTurn = 1;
  let nextStep = 1;
  const calls = new Map<string, number>();
  let lastTime = -Infinity;
  events.forEach((event, index) => {
    assert.equal(event.seq, index, 'events are contiguous from 0');
    assert.ok(event.time >= lastTime, 'time never goes backwards');
    lastTime = event.time;
    const data = event.data;
    switch (event.type) {
      case 'turn/start':
        assert.ok(turn === null && data.turn === nextTurn, 'turn/start opens the expected turn');
        turn = nextTurn++; nextStep = 1; break;
      case 'turn/end':
        assert.ok(turn !== null && data.turn === turn && step === null, 'turn/end matches the open turn with no open step');
        turn = null; break;
      case 'step/start':
        assert.ok(turn !== null && data.turn === turn && step === null && data.step === nextStep, 'step/start opens the next step of the open turn');
        step = nextStep++; break;
      case 'step/end':
        assert.ok(step !== null && data.step === step, 'step/end closes the open step');
        step = null; break;
      case 'tool/call': calls.set(data.callId, event.seq); break;
      case 'tool/result':
        assert.equal(calls.get(data.message.toolCallId), event.sourceEventSeqs?.[0], 'a result names the call it answers');
        break;
      default:
    }
  });
  assert.ok(turn === null && step === null, 'the log ends between turns');
}

const history = (extra: Record<string, unknown> = {}) => ({
  provider: 'claude', id: 'native-1', title: 'A session', cwd: '/work/app', createdAt: 1_790_000_000_000, model: 'claude-x',
  turns: [
    {
      at: 1_790_000_001_000, prompt: 'list the files',
      steps: [
        { at: 1_790_000_002_000, blocks: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'Let me look.' }, { type: 'tool-call', id: 'toolu_1', name: 'Bash', arguments: '{"command":"ls"}' }], calls: [{ id: 'toolu_1' }] },
        { at: 1_790_000_003_000, blocks: [{ type: 'text', text: 'Two files.' }], calls: [] },
      ],
      results: new Map([['toolu_1', { output: 'a\nb', isError: false, data: { exitCode: 0 } }]]),
    },
    { at: 1_790_000_004_000, prompt: 'and then?', steps: [], results: new Map() },
    { at: 1_790_000_005_000, prompt: 'thanks', steps: [{ blocks: [{ type: 'text', text: 'Welcome.' }], calls: [] }], results: new Map() },
  ],
  ...extra,
});

const build = (value = history()) => buildSessionEvents({ history: value, route: 'claude', model: 'default', effort: 'medium', sessionId: 'session-new', newId: (() => { let n = 0; return () => `id-${++n}`; })() });

test('a loaded session is a log DSH reads: contiguous, with turns and steps that open and close', () => {
  const { header, events } = build();
  assertReadableLog(events);
  assert.deepEqual(header, { version: 4, id: 'session-new', createdAt: 1_790_000_000_000, cwd: '/work/app', isSeeded: false, delegationDepth: 0, agentPreset: 'standard' });
  assert.deepEqual(events.slice(0, 4).map((event: any) => event.type), ['permission/preset', 'sandbox/mode', 'approval/policy', 'model/selection']);
  assert.deepEqual(events[3].data, { provider: 'claude', model: 'default', reasoningEffort: 'medium' });
});

test('a message nobody answered becomes a turn the person stopped, so no step is left open', () => {
  const { events } = build();
  const ends = events.filter((event: any) => event.type === 'turn/end').map((event: any) => event.data.reason.kind);
  assert.deepEqual(ends, ['completed', 'aborted', 'completed']);
  assert.deepEqual(events.find((event: any) => event.type === 'turn/end' && event.data.turn === 2).data.reason, { kind: 'aborted', reason: { kind: 'user' } });
});

test('what was said is recorded the way DSH records it, naming the harness session so the next message resumes it', () => {
  const { events } = build();
  const users = events.filter((event: any) => event.type === 'user/message');
  assert.deepEqual(users.map((event: any) => event.data.content[0].text), ['list the files', 'and then?', 'thanks']);
  assert.deepEqual(users[0].data.source, { kind: 'user' });
  assert.equal(users[0].surfaceOp, 'append');
  const assistants = events.filter((event: any) => event.type === 'assistant/message');
  assert.equal(assistants.length, 3);
  for (const event of assistants) {
    assert.deepEqual(event.data.message.source, { kind: 'model', provider: 'claude', model: 'default', replayState: { harness: 'claude', nativeSessionId: 'native-1' } });
    assert.equal(event.surfaceOp, 'append');
  }
  assert.deepEqual(assistants[0].data.message.content.map((block: any) => block.type), ['reasoning', 'text', 'tool-call']);
  const finish = assistants[0].data.stream.at(-1).chunk;
  assert.deepEqual([finish.type, finish.reason.kind, finish.replayState.nativeSessionId], ['finish', 'tool-calls', 'native-1']);
  assert.equal(assistants[1].data.stream.at(-1).chunk.reason.kind, 'stop');
  const title = events.find((event: any) => event.type === 'session/title');
  assert.deepEqual(title.data, { title: 'A session', messageSeqs: [], source: { kind: 'user' } });
});

test('a tool call is followed by its result, which DSH draws from the output and the data', () => {
  const { events } = build();
  const call = events.find((event: any) => event.type === 'tool/call');
  const result = events.find((event: any) => event.type === 'tool/result');
  assert.deepEqual([call.data.callId, call.data.name, call.data.arguments], ['toolu_1', 'Bash', '{"command":"ls"}']);
  assert.ok(result.seq > call.seq);
  assert.deepEqual(result.sourceEventSeqs, [call.seq]);
  assert.deepEqual(result.data.message.content, [{ type: 'text', text: 'a\nb' }]);
  assert.equal(result.data.message.isError, false);
  assert.deepEqual(result.data.meta, { output: 'a\nb', data: { exitCode: 0 } });
});

test('a call whose result was never recorded gets an empty one, and event times only move forward', () => {
  const value = history();
  value.turns[0].results = new Map();
  value.turns[2].at = 1_790_000_000_500; // stamped earlier than what came before it
  const { events } = build(value);
  assertReadableLog(events);
  assert.equal(events.find((event: any) => event.type === 'tool/result').data.message.content[0].text, '');
});

test('the model is chosen by the caller and the title can be overridden', () => {
  const { events } = buildSessionEvents({ history: history(), route: 'codex', model: 'auto/gpt', sessionId: 's', title: 'Custom' });
  assert.deepEqual(events[3].data, { provider: 'codex', model: 'auto/gpt' });
  assert.equal(events.find((event: any) => event.type === 'session/title').data.title, 'Custom');
});
