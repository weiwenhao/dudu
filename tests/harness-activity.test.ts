import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessActivity } from '../host/providers/activity.mjs';

function setup(signal?: AbortSignal) {
  const events: { type: string; data: any }[] = [];
  const activity = createHarnessActivity({
    session: { append: (type: string, data: any) => { events.push({ type, data }); } },
    route: 'codex', nativeSessionId: 'native-compact', signal,
  });
  return { events, activity };
}

test('native compaction uses the existing compact row, without impersonating a user or rewriting messages', () => {
  const { events, activity } = setup();
  activity.update({ type: 'compaction-start' });
  activity.update({ type: 'compaction-start' });
  assert.equal(events.length, 1);
  assert.equal(events[0].data.name, 'compact');
  assert.deepEqual(events[0].data.source, { kind: 'dudu-harness', provider: 'codex', nativeSessionId: 'native-compact' });
  activity.update({ type: 'compaction-end', outcome: 'completed' });
  activity.end({ ok: true });
  assert.deepEqual(events.map(event => event.type), ['command/run', 'command/done']);
  assert.equal(events[0].data.commandId, events[1].data.commandId);
  assert.equal(events[1].data.kind, 'success');
  assert.equal(events[1].data.text, undefined, 'no invented summary, counts or token savings');
});

test('an end-only compaction report creates a completed row without an invented running interval', () => {
  const { events, activity } = setup();
  activity.update({ type: 'compaction-end', outcome: 'completed' });
  assert.deepEqual(events.map(event => event.type), ['command/run', 'command/done']);
  assert.equal(events[1].data.kind, 'success');
});

test('stopping closes an open compact row before the turn can end, and ignores late native reports', () => {
  const controller = new AbortController();
  const { events, activity } = setup(controller.signal);
  activity.update({ type: 'compaction-start' });
  controller.abort(new Error('Stopped by boss'));
  activity.update({ type: 'compaction-end', outcome: 'completed' });
  activity.end({ ok: true });
  assert.equal(events.length, 2);
  assert.equal(events[1].data.kind, 'error');
  assert.equal(events[1].data.text, 'Stopped by boss');
});

test('native failures and process exits close pending compaction, while a cancelled startup publishes nothing', () => {
  for (const error of [undefined, new Error('native failure')]) {
    const { events, activity } = setup();
    activity.update({ type: 'compaction-start' });
    activity.end({ error });
    assert.equal(events[1].data.kind, 'error');
    assert.equal(events[1].data.text, error?.message);
  }
  const cancelled = setup(AbortSignal.abort(new Error('cancelled')));
  cancelled.activity.update({ type: 'compaction-start' });
  assert.deepEqual(cancelled.events, []);
  const failed = setup();
  failed.activity.update({ type: 'compaction-end', outcome: 'failed', reason: 'Compaction refused' });
  assert.equal(failed.events[1].data.text, 'Compaction refused');
  assert.equal(failed.events[1].data.kind, 'error');
});
