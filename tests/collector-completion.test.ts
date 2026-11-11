import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionStep, GIVE_UP } from '../host/dudu-plugin/ui/collector/completion.js';

const read = (record: any) => ({ outcome: 'success', record: { id: 1, completing: false, completeError: null, ...record } });

test('a completion is waited for while it runs and ends at the first reading that says so', () => {
  assert.equal(completionStep(read({ completing: true }), 3_000), 'wait');
  assert.equal(completionStep(read({ completing: true, completeError: 'The last one failed.' }), 3_000), 'wait', 'a failure kept from the last completion does not end this one');
  assert.equal(completionStep(read({}), 3_000), 'done');
  assert.equal(completionStep(read({ completeError: 'The session could not be reached.' }), 3_000), 'failed');
});

test('a reading that does not come is asked for again, and the wait is given up after four minutes', () => {
  assert.equal(completionStep(null, 3_000), 'wait');
  assert.equal(completionStep({ outcome: 'needs_clarification', code: 'unknown_record' }, 3_000), 'wait');
  assert.equal(completionStep(read({ completing: true }), GIVE_UP), 'failed');
  assert.equal(completionStep(null, GIVE_UP), 'failed');
  assert.equal(completionStep(read({}), GIVE_UP + 60_000), 'done', 'a reading that says it is over is believed even when it comes late');
});
