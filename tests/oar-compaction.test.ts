import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeCompaction } from '@dudu/oar-adapter/testing';

const builtin = { name: 'compact', builtin: true };
const commands = [builtin, { name: 'some-skill', builtin: false }];
const changed = (catalog: unknown = commands) => ({ type: 'system', subtype: 'commands_changed', commands: catalog });
const request = { id: 'compact-request' };
const frame = (native: any, events: any[] = []) => ({ body: { native, events } });
const started = frame({ type: 'command_lifecycle', command_uuid: request.id, state: 'started' });
const boundary = frame({ type: 'system', subtype: 'compact_boundary' }, [{ kind: 'compaction_ended', trigger: 'manual' }]);
const finished = frame({ type: 'result', user_message_uuid: request.id, is_error: false });

function setup(catalog: unknown = commands, afterQuery?: (control: any) => void) {
  let control: any;
  const sent: any[] = [];
  const replies: any[] = [];
  control = claudeCompaction({
    write(line: string) {
      const query = JSON.parse(line);
      assert.equal(query.request.subtype, 'initialize');
      control.consume({ type: 'control_response', response: {
        request_id: query.request_id, subtype: 'success', response: { commands: catalog },
      } });
      afterQuery?.(control);
    },
  });
  const operation = control.create((input: any) => { sent.push(input); return { kind: 'accepted' }; });
  return { control, operation, sent, replies, start: () => operation.start(request, (reply: any) => replies.push(reply)) };
}

test('Claude compaction accepts unrelated command refreshes only with a native manual boundary and result', async () => {
  for (const timing of ['before-dispatch', 'before-start', 'during-compaction', 'after-boundary']) {
    const run = setup(commands, timing === 'before-dispatch' ? control => control.consume(changed()) : undefined);
    await run.start();
    assert.deepEqual(run.replies, [{ kind: 'accepted' }], timing);
    assert.deepEqual(run.sent, [request]);
    if (timing === 'before-start') {
      run.control.consume(changed());
      assert.equal(run.operation.observe(frame(changed())), null);
    }
    assert.equal(run.operation.observe(started), null);
    if (timing === 'during-compaction') {
      // Claude pushes the entire catalog when another skill is discovered or reloaded.
      run.control.consume(changed([commands[1], builtin, { name: 'another-skill', builtin: false }]));
      assert.equal(run.operation.observe(frame(changed())), null);
    }
    assert.equal(run.operation.observe(boundary), null, 'the boundary alone does not finish the command');
    if (timing === 'after-boundary') run.control.consume(changed([]));
    assert.deepEqual(run.operation.observe(finished), { kind: 'completed', frame: boundary }, timing);
  }
});

test('Claude compaction still rejects missing or overridden provenance and detects unsafe changes before the boundary', async () => {
  for (const catalog of [null, [], [{ name: 'compact' }], [{ name: 'compact', builtin: false }], [builtin, { name: 'compact', builtin: false }]]) {
    const unverified = setup(catalog);
    await unverified.start();
    assert.equal(unverified.replies[0].kind, 'rejected');
    assert.equal(unverified.sent.length, 0);

    const raced = setup(commands, control => control.consume(changed(catalog)));
    await raced.start();
    assert.equal(raced.replies[0].kind, 'rejected', 'an unsafe push between query and dispatch prevents sending');
    assert.equal(raced.sent.length, 0);

    const running = setup();
    await running.start();
    running.operation.observe(started);
    running.control.consume(changed(catalog));
    // Even a later restoration of builtin compact must not erase a possibly shadowed execution.
    running.control.consume(changed());
    running.operation.observe(boundary);
    assert.equal(running.operation.observe(finished).code, 'command_changed');
  }
});

test('an unchanged Claude command catalog cannot turn native failure or an unconfirmed compaction into success', async () => {
  for (const failure of ['no-boundary', 'auto-boundary', 'no-start', 'native-status', 'result-error']) {
    const run = setup();
    await run.start();
    if (failure !== 'no-start') run.operation.observe(started);
    run.control.consume(changed());
    if (failure === 'auto-boundary') {
      run.operation.observe(frame(boundary.body.native, [{ kind: 'compaction_ended', trigger: 'auto' }]));
    } else if (failure !== 'no-boundary') {
      run.operation.observe(boundary);
    }
    if (failure === 'native-status') {
      run.operation.observe(frame({ type: 'system', subtype: 'status', compact_result: 'failed' }));
    }
    assert.equal(run.operation.observe(frame({ ...finished.body.native, user_message_uuid: 'another-request' })), null);
    const result = run.operation.observe(failure === 'result-error' ? frame({ ...finished.body.native, is_error: true }) : finished);
    assert.equal(result.kind, 'failed');
    assert.equal(result.code, ['native-status', 'result-error'].includes(failure) ? 'native_failed' : 'not_compacted', failure);
  }
});
