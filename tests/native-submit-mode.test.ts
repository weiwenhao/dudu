import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSY_ENTER_ENTRY, busyEnterOf, createSubmitMode, submitModeOf } from '../host/native-submit-mode.mjs';

const settings = (busyEnter: unknown, ns = BUSY_ENTER_ENTRY) => ({ describe: () => [{ ns: 'llm-deepseek', value: {} }, { ns, value: { busyEnter } }] });

// DSH's own rule for a plain Enter (submission-policy.ts): a conversation that does not run takes a normal message; one that runs takes it the way the owner chose.
test('only a running conversation is steered, and only when the owner chose steer', () => {
  assert.equal(submitModeOf({ running: true, busyEnter: 'steer' }), 'steer');
  assert.equal(submitModeOf({ running: true, busyEnter: 'queue' }), 'queue');
  assert.equal(submitModeOf({ running: false, busyEnter: 'steer' }), 'queue');
  assert.equal(submitModeOf({ running: undefined, busyEnter: 'steer' }), 'queue');
});

test('the owner\'s choice is read from the conversation entry of DSH; whatever cannot be read is DSH\'s default, queue', () => {
  assert.equal(busyEnterOf(settings('steer')), 'steer');
  assert.equal(busyEnterOf(settings('queue')), 'queue');
  assert.equal(busyEnterOf(settings('later')), 'queue');
  assert.equal(busyEnterOf(settings('steer', 'ui-something-else')), 'queue');
  assert.equal(busyEnterOf(null), 'queue');
  assert.equal(busyEnterOf(undefined), 'queue');
  assert.equal(busyEnterOf({ describe: () => { throw new Error('no settings yet'); } }), 'queue');
  assert.equal(busyEnterOf({}), 'queue', 'an older DSH whose service has no describe');
});

// Owner, 2026-11-28: the phone's message to a conversation held open for a background command stayed in the queue for good; his Desktop (steer) went in at once.
test('a message to a conversation that runs follows the owner\'s choice, and an idle one does not even read it', () => {
  let reads = 0;
  const service = { describe: () => { reads++; return settings('steer').describe(); } };
  const running = new Set(['held']);
  const mode = createSubmitMode({ running: (id: string) => running.has(id), settings: () => service });
  assert.equal(mode.modeOf('held'), 'steer');
  assert.equal(reads, 1);
  assert.equal(mode.modeOf('idle'), 'queue');
  assert.equal(reads, 1, 'an idle conversation takes a normal message and costs no read');

  const chosenQueue = createSubmitMode({ running: () => true, settings: () => settings('queue') });
  assert.equal(chosenQueue.modeOf('held'), 'queue');
  const noService = createSubmitMode({ running: () => true, settings: () => undefined });
  assert.equal(noService.modeOf('held'), 'queue');
  const failing = createSubmitMode({ running: () => { throw new Error('agent gone'); }, settings: () => settings('steer') });
  assert.equal(failing.modeOf('held'), 'queue');
  const brokenSettings = createSubmitMode({ running: () => true, settings: () => { throw new Error('no such service'); } });
  assert.equal(brokenSettings.modeOf('held'), 'queue');
});
