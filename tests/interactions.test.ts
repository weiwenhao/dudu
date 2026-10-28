import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionHandler, orderedAnswers, permissionDecision, toDshQuestions } from '../host/providers/interactions.mjs';

function fakeRun() {
  const calls: any = { permissions: [], questions: [] };
  return { calls, sessionId: 's1', respondPermission: (id: string, decision: any) => calls.permissions.push({ id, decision }), respondQuestion: (id: string, answer: any) => calls.questions.push({ id, answer }) };
}
const agent = { id: 's1' };
const handler = (services: any, agentOf: any = () => agent) => createInteractionHandler({ services, agentOf });
const signal = () => new AbortController().signal;

test('the harness asks permission through DSH approvals, attached to the tool call', async () => {
  const run = fakeRun();
  const asked: any[] = [];
  const approval = { request: async (request: any) => { asked.push(request); return 'allowed-once'; } };
  await handler({ approval: () => approval })({ type: 'permission-request', id: 'p1', toolCallId: 'c1', toolName: 'Bash', reason: 'Run rm -rf x' }, run, signal());
  assert.equal(asked[0].agent, agent);
  assert.equal(asked[0].callId, 'c1');
  assert.equal(asked[0].toolName, 'Bash');
  assert.equal(asked[0].reason, 'Run rm -rf x');
  assert.deepEqual(run.calls.permissions, [{ id: 'p1', decision: { behavior: 'allow' } }]);
});

test('a refused, withdrawn or unanswerable permission request is denied to the harness', async () => {
  assert.deepEqual(permissionDecision('allowed-once'), { behavior: 'allow' });
  assert.equal(permissionDecision('rejected').message, 'The user rejected this action.');
  assert.equal(permissionDecision('cancelled').behavior, 'deny');
  assert.equal(permissionDecision('unavailable').behavior, 'deny');

  const request = { type: 'permission-request', id: 'p1', toolCallId: 'c1', toolName: 'Bash' };
  const without = fakeRun();
  await handler({})(request, without, signal());   // no approval service at all
  assert.equal(without.calls.permissions[0].decision.behavior, 'deny');

  const gone = fakeRun();
  await handler({ approval: () => ({ request: async () => 'allowed-once' }) }, () => undefined)(request, gone, signal());   // the session's agent is gone
  assert.equal(gone.calls.permissions[0].decision.behavior, 'deny');

  const throwing = fakeRun();
  await handler({ approval: () => ({ request: async () => { throw new Error('no open turn'); } }) })(request, throwing, signal());
  assert.equal(throwing.calls.permissions[0].decision.behavior, 'deny');
});

test('a question is asked through DSH questions and the answers go back in order', async () => {
  const questions = [
    { question: 'Which database?', header: 'DB', options: [{ label: 'Postgres', description: 'sql' }, { label: 'SQLite' }], multiSelect: false },
    { question: 'Anything else?' },
  ];
  assert.deepEqual(toDshQuestions(questions), [
    { id: 'q0', question: 'Which database?', header: 'DB', options: [{ label: 'Postgres', description: 'sql' }, { label: 'SQLite' }] },
    { id: 'q1', question: 'Anything else?' },
  ]);
  const run = fakeRun();
  const asked: any[] = [];
  const service = { ask: async (request: any) => { asked.push(request); return { answers: [{ id: 'q1', selected: [], custom: 'no' }, { id: 'q0', selected: ['SQLite'] }] }; } };
  await handler({ questions: () => service })({ type: 'question-request', id: 'k1', toolCallId: 'c1', questions }, run, signal());
  assert.equal(asked[0].callId, 'c1');
  assert.equal(asked[0].agent, agent);
  assert.deepEqual(run.calls.questions[0].answer.answers, [
    { question: questions[0], selected: ['SQLite'], custom: undefined },
    { question: questions[1], selected: [], custom: 'no' },
  ]);
  assert.deepEqual(orderedAnswers([{ question: 'x' }], { answers: [] }), [{ question: { question: 'x' }, selected: [], custom: undefined }]);
});

test('a question nobody can answer, or that fails, is cancelled for the harness instead of hanging it', async () => {
  const request = { type: 'question-request', id: 'k1', toolCallId: 'c1', questions: [{ question: 'q' }] };
  const none = fakeRun();
  await handler({})(request, none, signal());
  assert.deepEqual(none.calls.questions, [{ id: 'k1', answer: { cancelled: true } }]);
  const failing = fakeRun();
  await handler({ questions: () => ({ ask: async () => { throw new Error('closed'); } }) })(request, failing, signal());
  assert.deepEqual(failing.calls.questions, [{ id: 'k1', answer: { cancelled: true } }]);
});
