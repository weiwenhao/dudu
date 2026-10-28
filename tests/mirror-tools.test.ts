import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorTool, orderedAnswers, permissionDecision, toDshQuestions } from '../host/providers/mirror-tools.mjs';

// The real defineTool validates and wraps; for these tests the definition itself is what matters.
const defineTool = (definition: any) => definition;

function fakeRun() {
  const calls: any = { permissions: [], questions: [] };
  const interactions: any[] = [];
  return {
    calls, interactions,
    respondPermission: (id: string, decision: any) => calls.permissions.push({ id, decision }),
    respondQuestion: (id: string, answer: any) => calls.questions.push({ id, answer }),
    async waitTool(_callId: string, options: any) {
      for (const interaction of interactions) await options.onInteraction(interaction, this);
      return this.outcome;
    },
    outcome: { type: 'tool-result', id: 'c1', output: 'done', isError: false } as any,
  };
}

function setup(run: any, services: any = {}) {
  const bridge = { driver: { name: 'Fake Harness' }, runOf: (id: string) => (id === 's1' ? run : undefined) };
  const spec = {
    name: 'Bash',
    presentCall: (args: any) => ({ card: 'terminal', title: args.command }),
    presentResult: (_args: any, outcome: any) => ({ card: 'terminal', output: outcome.output, exitCode: outcome.data?.exitCode }),
  };
  return createMirrorTool({ defineTool, bridge, services, spec }) as any;
}

const exec = (extra: any = {}) => ({ agent: { id: 's1' }, callId: 'c1', signal: new AbortController().signal, ...extra });

test('a mirror tool returns what the harness reported, with structured data kept for its card', async () => {
  const run = fakeRun();
  run.outcome = { output: 'a.txt', isError: false, data: { exitCode: 0 } };
  const tool = setup(run);
  const value = await tool.execute({ command: 'ls' }, exec());
  assert.deepEqual(value, { output: 'a.txt', data: '{"exitCode":0}' });
  assert.deepEqual(tool.output.presentationMeta({}, value), { output: 'a.txt', data: { exitCode: 0 } });
  assert.deepEqual(tool.output.render({}, value), [{ type: 'text', text: 'a.txt' }]);
  assert.deepEqual(tool.presentCall({ command: 'ls' }), { card: 'terminal', title: 'ls' });
  assert.deepEqual(tool.presentResult({}, { isError: false, meta: { output: 'a.txt', data: { exitCode: 0 } } }), { card: 'terminal', output: 'a.txt', exitCode: 0 });
});

test('a failed harness tool fails the DSH tool call with the harness message', async () => {
  const run = fakeRun();
  run.outcome = { output: 'File not found', isError: true };
  await assert.rejects(setup(run).execute({}, exec()), /File not found/);
});

test('a mirror tool outside a running harness turn fails clearly', async () => {
  await assert.rejects(setup(fakeRun()).execute({}, exec({ agent: { id: 'other' } })), /not running this turn/);
});

test('the harness asks permission through DSH approvals, attached to the tool call', async () => {
  const run = fakeRun();
  run.interactions.push({ type: 'permission-request', id: 'p1', toolName: 'Bash', reason: 'Run rm -rf x' });
  const asked: any[] = [];
  const approval = { request: async (request: any) => { asked.push(request); return 'allowed-once'; } };
  await setup(run, { approval: () => approval }).execute({}, exec());
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

  const run = fakeRun();
  run.interactions.push({ type: 'permission-request', id: 'p1', toolName: 'Bash' });
  await setup(run, {}).execute({}, exec());   // no approval service at all
  assert.equal(run.calls.permissions[0].decision.behavior, 'deny');

  const throwing = fakeRun();
  throwing.interactions.push({ type: 'permission-request', id: 'p1', toolName: 'Bash' });
  await setup(throwing, { approval: () => ({ request: async () => { throw new Error('no open turn'); } }) }).execute({}, exec());
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
  run.interactions.push({ type: 'question-request', id: 'k1', questions });
  const asked: any[] = [];
  const service = { ask: async (request: any) => { asked.push(request); return { answers: [{ id: 'q1', selected: [], custom: 'no' }, { id: 'q0', selected: ['SQLite'] }] }; } };
  await setup(run, { questions: () => service }).execute({}, exec());
  assert.equal(asked[0].callId, 'c1');
  assert.deepEqual(run.calls.questions[0].answer.answers, [
    { question: questions[0], selected: ['SQLite'], custom: undefined },
    { question: questions[1], selected: [], custom: 'no' },
  ]);
  assert.deepEqual(orderedAnswers([{ question: 'x' }], { answers: [] }), [{ question: { question: 'x' }, selected: [], custom: undefined }]);
});

test('an unanswerable question is cancelled for the harness instead of hanging it', async () => {
  const run = fakeRun();
  run.interactions.push({ type: 'question-request', id: 'k1', questions: [{ question: 'q' }] });
  await setup(run, {}).execute({}, exec());
  assert.deepEqual(run.calls.questions, [{ id: 'k1', answer: { cancelled: true } }]);
});

test('stopping the turn while a decision is pending stops the wait instead of denying in the dark', async () => {
  const run = fakeRun();
  run.interactions.push({ type: 'permission-request', id: 'p1', toolName: 'Bash' });
  const controller = new AbortController();
  const approval = { request: async () => { controller.abort(); throw new Error('aborted'); } };
  await assert.rejects(setup(run, { approval: () => approval }).execute({}, exec({ signal: controller.signal })), /aborted/);
  assert.equal(run.calls.permissions.length, 0);
});
