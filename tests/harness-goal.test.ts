import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeRequest } from '../host/providers/harness-bridge.mjs';
import { GOAL_ROUND_NOTE, goalReportOf, reportGoal } from '../host/providers/goal.mjs';

// A goal of DSH in a session a harness runs: its model cannot call update_goal, so the end of the round says what happened.
test('the last lines of a round say whether the goal is done or blocked', () => {
  assert.deepEqual(goalReportOf('All done.\n\nGOAL_COMPLETE\n'), { kind: 'complete' });
  assert.deepEqual(goalReportOf('I cannot go on.\nGOAL_BLOCKED: the vault needs a password'), { kind: 'blocked', message: 'the vault needs a password' });
  assert.equal(goalReportOf('Not yet.'), undefined);
  assert.equal(goalReportOf('I will end with GOAL_COMPLETE once it is true.'), undefined, 'the word inside a sentence is not a report');
  assert.equal(goalReportOf(`GOAL_COMPLETE\n${'later\n'.repeat(6)}`), undefined, 'only the last lines count');
  assert.match(GOAL_ROUND_NOTE, /GOAL_COMPLETE/);
});

test('a report completes or blocks only the active goal that the round belongs to', () => {
  const calls: any[] = [];
  const goals = (view: any) => ({ get: () => view, complete: (_agent: any, ref: any) => calls.push(['complete', ref]), block: (_agent: any, ref: any, reason: any) => calls.push(['block', ref, reason]) });
  const agent = {};
  const active = { id: 'g1', revision: 4, phase: 'active' };
  assert.equal(reportGoal({ goals: goals(active), agent, round: { goalId: 'g1' }, report: { kind: 'complete' } }), true);
  assert.equal(reportGoal({ goals: goals(active), agent, round: { goalId: 'g1' }, report: { kind: 'blocked', message: 'needs a key' } }), true);
  assert.deepEqual(calls, [['complete', { id: 'g1', revision: 4 }], ['block', { id: 'g1', revision: 4 }, { code: 'model-reported', message: 'needs a key' }]]);
  calls.length = 0;
  assert.equal(reportGoal({ goals: goals({ ...active, phase: 'paused' }), agent, round: { goalId: 'g1' }, report: { kind: 'complete' } }), false, 'a paused goal is left as it is');
  assert.equal(reportGoal({ goals: goals(active), agent, round: { goalId: 'older' }, report: { kind: 'complete' } }), false, 'a round of another goal');
  assert.equal(reportGoal({ goals: goals(undefined), agent, round: { goalId: 'g1' }, report: { kind: 'complete' } }), false);
  assert.equal(reportGoal({ goals: undefined, agent, round: { goalId: 'g1' }, report: { kind: 'complete' } }), false, 'a DSH without the goal service');
  assert.equal(reportGoal({ goals: goals(active), agent, round: { goalId: 'g1' }, report: undefined }), false, 'a round that said nothing');
  assert.deepEqual(calls, []);
});

test('a round of a goal reaches the harness as a prompt, the attachment note of round 0 does not', () => {
  const user = (id: string, source: any) => ({ id, role: 'user', source, content: [{ type: 'text', text: id }] });
  const messages = [user('person', { kind: 'user' }), user('round-0', { kind: 'goal', round: 0 }), user('round-1', { kind: 'goal', round: 1 }), user('note', { kind: 'time-context' })];
  assert.deepEqual(analyzeRequest(messages as any, 'pi', undefined).prompts.map((message: any) => message.id), ['person', 'round-1']);
});

test('a goal round that never reached the harness is not carried into the next message of the person', () => {
  const user = (id: string, source: any) => ({ id, role: 'user', source, content: [{ type: 'text', text: id }] });
  const round = user('round-1', { kind: 'goal', round: 1, goalId: 'g' });
  const person = user('person', { kind: 'user' });
  const events = [
    { type: 'model/selection', data: { provider: 'pi' } },
    { type: 'turn/start', data: {} }, { type: 'user/message', data: round },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'HARNESS_UNAVAILABLE' } } } },
    { type: 'turn/start', data: {} }, { type: 'user/message', data: person },
  ];
  assert.deepEqual(analyzeRequest([round, person] as any, 'pi', events as any).prompts.map((message: any) => message.id), ['person']);
  const earlier = { ...round, source: { kind: 'user' } };
  assert.deepEqual(analyzeRequest([earlier, person] as any, 'pi', [events[0], events[1], { type: 'user/message', data: earlier }, events[3], events[4], events[5]] as any).prompts.map((message: any) => message.id), ['round-1', 'person'], 'a message a person wrote is carried, as before');
});
