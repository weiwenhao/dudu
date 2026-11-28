import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClaudeNormalizer } from '../host/providers/drivers/claude.mjs';
import { CodexNormalizer } from '../host/providers/drivers/codex.mjs';
import { HarnessRun } from '../host/providers/harness-bridge.mjs';
import { createForegroundWatch } from '../host/providers/foreground.mjs';
import { startOarRun } from '../host/providers/oar.mjs';
import { OarResident } from '../host/providers/oar-resident.mjs';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const accepted = { kind: 'accepted' };

function nativeSession() {
  const observers = new Set<(record: any) => void>();
  const inputs: { via: string; text: string; inputId: string; images?: unknown[] }[] = [];
  let seq = 0;
  let nativeKind = 'running';
  let disposed = 0;
  const emit = (events: any[], extra = {}) => {
    for (const event of events) {
      if (event.kind === 'turn_ended') nativeKind = 'idle';
      if (['turn_active', 'text_delta'].includes(event.kind)) nativeKind = 'running';
    }
    const record = { sessionId: 'native-background', agentPath: [], seq: ++seq, kind: 'frame', body: { events }, ...extra };
    for (const observer of observers) observer(record);
  };
  const session = {
    id: 'native-background',
    rawEvents(observer: (record: any) => void) {
      observers.add(observer);
      return () => { observers.delete(observer); };
    },
    status: () => ({ value: { kind: nativeKind } }),
    prompt: async () => accepted,
    steer: async (text: string, options: any) => {
      inputs.push({ via: 'steer', text, ...options });
      return nativeKind === 'running' ? accepted
        : { kind: 'rejected', code: 'no_active_turn', reason: 'no active native turn' };
    },
    deliver: async (text: string, options: any) => {
      inputs.push({ via: 'deliver', text, ...options });
      const landed = nativeKind === 'idle' ? 'prompted' : 'steered';
      emit([{ kind: 'turn_active', inputId: options.inputId },
        { kind: 'user_message', input: text, inputId: options.inputId, evidence: 'acknowledged' }]);
      return { landed, result: accepted };
    },
    abort: async () => accepted,
    dispose: async () => {
      disposed++;
      emit([], { kind: 'request', direction: 'toRuntime', body: { kind: 'dispose' } });
      emit([], { kind: 'response', body: { kind: 'exited', code: 0 } });
    },
  };
  return { session, emit, inputs, get disposed() { return disposed; } };
}

const start = (session: any, options = {}) => startOarRun({
  runtime: { session: async () => session }, installation: { kind: 'available', via: 'bundled' },
  sessionOptions: {}, prompt: 'Start the background task.', name: 'Claude',
  normalizer: new ClaudeNormalizer({ name: 'Claude', login: '' }), queuesSteer: true,
  ...options,
});
function observe(handle: any) {
  const events: any[] = [];
  const done = (async () => { for await (const event of handle.events) events.push(event); })();
  return { events, done };
}
const end = { kind: 'turn_ended', outcome: { kind: 'completed' } };
const shell = { kind: 'task_started', taskId: 'poll', taskType: 'shell', nativeType: 'local_bash', background: true };
const child = { kind: 'task_started', taskId: 'research', taskType: 'agent', background: true };
const say = (text: string) => ({ kind: 'text_delta', text, messageId: 'answer' });

test('stopping the parent retains explicit background agents and their observer across the next input', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const native = nativeSession();
  const records: any[] = [];
  const endings: any[] = [];
  const team = { record: (record: any) => records.push(record), end: async () => { endings.push(true); } };
  const handle = await start(native.session, { observeSubagents: () => team });
  const run = new HarnessRun({ sessionId: 'dsh-background', handle, prompts: [], team });
  t.after(() => run.close());
  native.emit([child, { ...child, taskId: 'second-child' }, say('Research started.'), end]);
  await flush();
  await run.interrupt();
  await run.pump;
  assert.equal(run.turnEnd.error.code, 'ABORTED');
  assert.equal(run.foregroundActive, false);
  assert.equal(handle.backgroundActive, true);
  assert.equal(native.disposed, 0, 'stopping the root must not dispose its running background agent');
  assert.equal(endings.length, 0, 'the native team observer outlives the stopped root');
  native.emit([say('Still working.')], { agentPath: ['delegate'] });
  assert.ok(records.some(record => record.agentPath?.[0] === 'delegate'), 'child output remains observed while the parent is stopped');
  native.emit([], { kind: 'response', sessionId: 'another-child', body: { kind: 'exited', code: 0 } });
  assert.equal(handle.backgroundActive, true, 'a child or foreign exit is not the native root process exiting');

  const next = await start(native.session, {
    previous: handle, prompt: 'Continue the parent.',
    observeSubagents: () => assert.fail('the same process must keep the same team observer'),
  });
  t.after(() => next.close());
  const seen = observe(next);
  assert.strictEqual(next.resident, handle.resident);
  assert.strictEqual(next.team, team);
  assert.equal(native.inputs[0].via, 'deliver');
  native.emit([say('The child finished.')], { agentPath: ['delegate'] });
  native.emit([{ kind: 'task_ended', taskId: child.taskId, status: 'completed' }]);
  await flush();
  assert.equal(next.backgroundActive, true, 'one completed child cannot release another child that still works');
  native.emit([{ kind: 'task_ended', taskId: 'second-child', status: 'completed' }, say('Result received.'), end]);
  await seen.done;
  await next.close();
  assert.equal(seen.events.at(-1).ok, true);
  assert.equal(seen.events.filter(event => event.type === 'text-delta').map(event => event.text).join(''), 'Result received.');
  assert.equal(records.filter(record => record.body?.events?.some((event: any) => event.text === 'The child finished.')).length, 1);
  assert.equal(endings.length, 1);
  assert.equal(native.disposed, 1);
});

test('a stop while the first message of a new process is on its way ends that process: nobody holds it, and it was left running until DSH exited', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const native = nativeSession();
  const controller = new AbortController();
  let taken: (outcome: any) => void = () => {};
  native.session.prompt = () => new Promise((resolve) => { taken = resolve; });
  const starting = start(native.session, { signal: controller.signal });
  starting.catch(() => {});
  await flush();
  controller.abort();
  taken(accepted);
  await assert.rejects(starting, { name: 'AbortError' });
  assert.equal(native.disposed, 1, 'the call that made the process is the one that stops it');
});

test('background agent observation ends at native task or process termination, not parent cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const outcome of ['completed', 'stopped', 'failed', 'exit', 'dispose']) {
    const native = nativeSession();
    const snapshots: any[] = [];
    let ended = 0;
    const handle = await start(native.session, { observeSubagents: () => ({
      record: (record: any, _id: string, tasks: Map<string, any>) => { snapshots.push({ record, tasks }); },
      end: async () => { ended++; },
    }) });
    t.after(() => handle.close());
    const seen = observe(handle);
    native.emit([child, end]);
    await handle.interrupt();
    await seen.done;
    assert.equal(native.disposed, 0);
    assert.equal(ended, 0);
    if (outcome === 'exit') native.emit([], { kind: 'response', body: { kind: 'exited', code: 9 } });
    else if (outcome === 'dispose') await handle.close();
    else {
      native.emit([{ kind: 'task_ended', taskId: child.taskId, status: outcome }]);
      await flush();
      assert.equal(native.disposed, 0, 'the last task notification leaves time for the native follow-up');
      t.mock.timers.tick(5000);
    }
    await flush();
    await handle.close();
    assert.equal(ended, 1);
    assert.equal(native.disposed, 1);
    const last = snapshots.at(-1).tasks.get(child.taskId);
    assert.equal(last.status, outcome === 'exit' ? 'failed' : outcome === 'dispose' ? 'stopped' : outcome);
  }
});

test('foreground, unclassified and ambient agents do not become background work; the idle process stays for the next turn', async t => {
  for (const task of [{ ...child, background: false }, { ...child, background: undefined }, { ...child, ambient: true }]) {
    const native = nativeSession();
    const resident = new OarResident(native.session, {});
    t.after(() => resident.close());
    native.emit([task, end]);
    assert.equal(resident.backgroundActive, false);
    resident.finishTurn();
    await flush();
    // The process is kept between turns and closed only by deep sleep or a close (owner, 2026-11-23); it does not keep the issue awake.
    assert.equal(native.disposed, 0);
    assert.equal(resident.alive, true);
    assert.equal(resident.working, false);
    await resident.close();
    assert.equal(native.disposed, 1);
  }
});

test('background shell and Monitor let DSH commit the answer before their native follow-up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const task of [shell, { ...shell, nativeType: 'local_monitor', ambient: true, background: false }]) {
    const native = nativeSession();
    const handle = await start(native.session);
    t.after(() => handle.close());
    const seen = observe(handle);
    native.emit([task]);
    native.emit([say('Polling.')]);
    native.emit([end]);
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(native.disposed, 0);
    const boundary = seen.events.find(event => event.type === 'step-end');
    assert.equal(boundary?.reason, 'stop');
    assert.ok(boundary.continuation);
    assert.equal(seen.events.some(event => event.type === 'turn-end'), false);

    native.emit([{ kind: 'task_ended', taskId: 'poll', status: 'completed' }]);
    t.mock.timers.tick(4999);
    await flush();
    assert.equal(native.disposed, 0, 'task notification must not close the process before native continuation starts');
    native.emit([{ kind: 'turn_active' }]);
    assert.equal(await boundary.continuation, true);
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(native.disposed, 0, 'a slow native follow-up is not cut off by the idle grace period');
    assert.equal(seen.events.some(event => event.type === 'turn-end'), false);
    native.emit([say('The background task completed.'), end]);
    await seen.done;
    assert.deepEqual(seen.events.filter(event => event.type === 'text-delta' || event.type === 'step-end')
      .map(event => event.text ?? event.type), ['Polling.', 'step-end', 'The background task completed.', 'step-end']);
    assert.equal(seen.events.filter(event => event.type === 'turn-end').length, 1);
    assert.equal(seen.events.at(-1).ok, true);
    await handle.close();
    assert.equal(native.disposed, 1);
  }
});

test('owner input during an idle native background wait uses OAR delivery and keeps its admission receipt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const native = nativeSession();
  const handle = await start(native.session);
  t.after(() => handle.close());
  const seen = observe(handle);
  native.emit([shell, say('Polling.'), end]);
  await flush();
  const receipt: any[] = [];
  const images = [{ mediaType: 'image/png', data: 'aW1hZ2U=' }];
  await handle.pushUserMessage('Check this too.', images, { onInput: async (value: any) => { receipt.push(value); } });
  assert.equal(native.inputs.length, 1);
  assert.equal(native.inputs[0].via, 'deliver', 'steer alone refuses input after the native root answer');
  assert.equal(native.inputs[0].text, 'Check this too.');
  assert.match(native.inputs[0].inputId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(native.inputs[0].images, images);
  assert.deepEqual(receipt.map(value => value.state), ['submitting', 'accepted']);
  assert.ok(receipt.every(value => value.nativeSessionId === native.session.id));
  native.emit([{ kind: 'task_ended', taskId: 'poll', status: 'completed' }, say('Checked.'), end]);
  await seen.done;
  assert.equal(seen.events.at(-1).ok, true);
  assert.equal(seen.events.filter(event => event.type === 'turn-end').length, 1);
});

test('native exit and explicit stop still end a DSH turn held for a background shell', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const stopped of [false, true]) {
    const native = nativeSession();
    const handle = await start(native.session);
    t.after(() => handle.close());
    const seen = observe(handle);
    native.emit([shell, say('Polling.'), end]);
    await flush();
    if (stopped) await handle.interrupt();
    else native.emit([], { kind: 'response', body: { kind: 'exited', code: 9 } });
    await seen.done;
    assert.equal(seen.events.at(-1).ok, false);
    assert.equal(seen.events.at(-1).error.code, stopped ? 'ABORTED' : 'HARNESS_EXITED');
    assert.equal(seen.events.filter(event => event.type === 'turn-end').length, 1);
  }
});

test('a background task with no native continuation ends the turn after the idle grace; the process stays until it is closed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const finalOutput = Promise.withResolvers<void>();
  const native = nativeSession();
  const handle = await start(native.session, {
    onTasks: ({ tasks }: any) => tasks.some((task: any) => task.status === 'completed') ? finalOutput.promise : undefined,
  });
  t.after(() => { finalOutput.resolve(); return handle.close(); });
  const seen = observe(handle);
  native.emit([shell, say('Polling.'), end]);
  native.emit([{ kind: 'task_ended', taskId: 'poll', status: 'completed' }]);
  t.mock.timers.tick(5000);
  await seen.done;
  assert.equal(await seen.events.find(event => event.type === 'step-end')?.continuation, false);
  assert.equal(seen.events.at(-1).ok, true);
  assert.equal(seen.events.filter(event => event.type === 'turn-end').length, 1);
  assert.equal(native.disposed, 0, 'the last output read still owns the native process');
  finalOutput.resolve();
  await flush();
  assert.equal(native.disposed, 0, 'kept for the next turn (owner, 2026-11-23): only deep sleep or a close lets it go');
  assert.equal(handle.backgroundActive, false, 'no work of its own keeps the issue awake');
  await handle.close();
  assert.equal(native.disposed, 1);
});

test('Codex background discovery starts during the first command and observes its real lifetime before the root ends', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  for (const status of ['completed', 'stopped']) {
    const native = nativeSession();
    let queries = 0;
    let running = false;
    let discovered = false;
    const changes: { status: string; at: number }[] = [];
    const session = Object.assign(native.session, {
      backgroundTasks: async () => {
        queries++;
        if (running && !discovered) {
          discovered = true;
          native.emit([{ ...shell, taskId: '43676', nativeType: 'commandExecution', toolCallId: 'command' }]);
        } else if (!running && discovered) {
          discovered = false;
          native.emit([{ kind: 'task_ended', taskId: '43676', status }]);
        }
      },
    });
    const resident = new OarResident(session, {
      onTasks: ({ tasks }: any) => {
        const task = tasks.find((task: any) => task.taskId === '43676');
        if (task && task.status !== changes.at(-1)?.status) changes.push({ status: task.status, at: Date.now() });
      },
    });
    t.after(() => resident.close());
    native.emit([{ kind: 'tool_call_started', callId: 'command', tool: 'commandExecution' }]);
    t.mock.timers.tick(750);
    await flush();
    assert.equal(queries, 1, 'observe commands before any background task or root end has been reported');
    assert.equal(changes.length, 0, 'a command is not itself evidence of a background terminal');
    running = true;
    t.mock.timers.tick(750);
    await flush();
    assert.equal(resident.backgroundActive, true);
    assert.equal(changes[0].status, 'running');
    t.mock.timers.tick(30_000);
    await flush();
    running = false;
    native.emit([{ kind: 'tool_call_ended', callId: 'command', result: 'ok' }]);
    t.mock.timers.tick(750);
    await flush();
    assert.deepEqual(changes.map(change => change.status), ['running', status]);
    assert.ok(changes[1].at - changes[0].at >= 30_000, 'registration precedes the task ending instead of showing a zero-second lifetime');
    assert.equal(resident.backgroundActive, false);
    const settled = queries;
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(queries, settled, 'stop discovery when neither commands nor background work remain');
    await resident.close();
  }
});

test('Codex background discovery ignores foreign and child commands and stops at command end, turn end or exit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const ending of ['command', 'turn', 'exit', 'close']) {
    const native = nativeSession();
    let queries = 0;
    const session = Object.assign(native.session, { backgroundTasks: async () => { queries++; } });
    const resident = new OarResident(session, {});
    t.after(() => resident.close());
    const command = { kind: 'tool_call_started', callId: 'command', tool: 'commandExecution' };
    native.emit([command], { agentPath: ['child'] });
    native.emit([command], { sessionId: 'another-session' });
    native.emit([{ ...command, tool: 'mcpToolCall' }]);
    t.mock.timers.tick(1500);
    await flush();
    assert.equal(queries, 0);
    native.emit([command]);
    t.mock.timers.tick(750);
    await flush();
    assert.equal(queries, 1);
    if (ending === 'command') native.emit([{ kind: 'tool_call_ended', callId: 'command' }]);
    else if (ending === 'turn') native.emit([end]);
    else if (ending === 'exit') native.emit([], { kind: 'response', body: { kind: 'exited', code: 0 } });
    else await resident.close();
    await flush();
    const settled = queries;
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(queries, settled, `stop discovery at ${ending} without manufacturing a background task`);
    await resident.close();
  }
});

test('Codex background discovery catches a fast yield before the first poll', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const native = nativeSession();
  let ready = false;
  const session = Object.assign(native.session, {
    backgroundTasks: async () => {
      if (ready) {
        ready = false;
        native.emit([{ ...shell, nativeType: 'commandExecution', toolCallId: 'command' }]);
      }
    },
  });
  const resident = new OarResident(session, {});
  t.after(() => resident.close());
  native.emit([{ kind: 'tool_call_started', callId: 'command', tool: 'commandExecution' }]);
  ready = true;
  native.emit([{ kind: 'tool_call_ended', callId: 'command' }]);
  await flush();
  assert.equal(resident.backgroundActive, true, 'the terminal must be discovered even when the tool returned before 750 ms');
});

test('a Codex command yields its mirror result to the native background job, and root activity follows native turns', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const native = nativeSession();
  const handle = await start(native.session, { normalizer: new CodexNormalizer({ name: 'ChatGPT', login: '' }) });
  const activity: boolean[] = [];
  const run = new HarnessRun({ sessionId: 'dsh-background', handle, prompts: [],
    onForeground: () => { activity.push(run.foregroundActive); } });
  t.after(() => run.close());
  const command = { id: 'command', type: 'commandExecution', command: 'sleep 60', cwd: '/project', status: 'inProgress' };
  native.emit([{ kind: 'tool_call_started', callId: 'command', tool: 'commandExecution' }], { body: {
    events: [{ kind: 'tool_call_started', callId: 'command', tool: 'commandExecution' }], native: { item: command },
  } });
  let yielded: any;
  const waiting = run.waitTool('command').then((result: any) => { yielded = result; return result; });
  void waiting.catch(() => {});
  await flush();
  assert.equal(yielded, undefined, 'a foreground command has not returned yet');
  native.emit([{ kind: 'tool_call_progress', callId: 'command', outputDelta: 'Started.\n' }]);
  native.emit([{ ...shell, taskId: '93429', nativeType: 'commandExecution', toolCallId: 'command' }]);
  await flush();
  assert.ok(yielded, 'native background discovery must release the mirror before the process exits');
  assert.deepEqual(yielded, {
    type: 'tool-result', id: 'command', output: 'Started.\n', isError: false,
    data: { background: true, processId: '93429' },
  });
  assert.equal(run.foregroundActive, true, 'starting background work does not imply the root stopped thinking');
  native.emit([say('The task is running.'), end]);
  await flush();
  assert.equal(run.foregroundActive, false, 'only the completed native root hides foreground activity');
  assert.equal(run.finished, false);
  assert.equal(native.disposed, 0);
  native.emit([say('Child output.')], { sessionId: 'child' });
  native.emit([say('Nested output.')], { agentPath: ['child'] });
  await flush();
  assert.equal(run.foregroundActive, false, 'a child cannot make the parent look active');
  native.emit([{ kind: 'turn_active' }, say('Checking the result.')]);
  await flush();
  assert.equal(run.foregroundActive, true, 'a real native continuation restores foreground activity');
  native.emit([end]);
  native.emit([{ kind: 'tool_call_ended', callId: 'command', result: 'ok' }], { body: {
    events: [{ kind: 'tool_call_ended', callId: 'command', result: 'ok' }],
    native: { item: { ...command, status: 'completed', aggregatedOutput: 'Started.\nDone.\n', exitCode: 0 } },
  } });
  native.emit([{ kind: 'task_ended', taskId: '93429', status: 'completed' }]);
  t.mock.timers.tick(5000);
  await run.pump;
  assert.equal(run.turnEnd.ok, true);
  assert.strictEqual(await waiting, yielded, 'the later process exit cannot replace the earlier yielded result');
  assert.deepEqual(activity.slice(0, 3), [false, true, false]);
});

test('foreground observation wakes only its session and releases waits on abort, timeout and shutdown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const background = new Set<string>();
  const watch = createForegroundWatch((id: string) => background.has(id));
  t.after(() => watch.close());
  assert.deepEqual(await watch.wait('one'), { backgroundOnly: false });
  let changed = false;
  const waiting = watch.wait('one', { after: false }).then((value: any) => { changed = true; return value; });
  background.add('two');
  watch.changed('two');
  await flush();
  assert.equal(changed, false, 'another session cannot hide this session foreground');
  background.add('one');
  watch.changed('one');
  assert.deepEqual(await waiting, { backgroundOnly: true });
  const resumed = watch.wait('one', { after: true });
  background.delete('one');
  watch.changed('one');
  assert.deepEqual(await resumed, { backgroundOnly: false });
  const controller = new AbortController();
  const aborted = watch.wait('one', { after: false, signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  const heartbeat = watch.wait('one', { after: false });
  t.mock.timers.tick(25_000);
  assert.deepEqual(await heartbeat, { backgroundOnly: false });
  const closing = watch.wait('two', { after: true });
  watch.close();
  assert.deepEqual(await closing, { backgroundOnly: false });
});

test('changed environment variables start a new process for a free conversation; a working one keeps its own until it is free (owner, 2026-11-23)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const natives = [nativeSession(), nativeSession(), nativeSession()];
  const launched: unknown[] = [];
  const runtime = { session: async (_installation: unknown, options: any) => { launched.push(options.env); return natives[launched.length - 1].session; } };
  const team = { record: () => {}, end: async () => {} };
  const go = (env: Record<string, string>, previous?: any) => startOarRun({
    runtime, installation: { kind: 'available', via: 'bundled' }, sessionOptions: { env }, prompt: 'Go.', name: 'Claude',
    normalizer: new ClaudeNormalizer({ name: 'Claude', login: '' }), queuesSteer: true, previous, observeSubagents: () => team,
  });
  const turn = async (handle: any, native: ReturnType<typeof nativeSession>, events: any[]) => {
    const seen = observe(handle);
    native.emit(events);
    await seen.done;
    await handle.close({ preserveBackground: true });
  };

  const first = await go({ HTTPS_PROXY: 'http://a' });
  await turn(first, natives[0], [say('One.'), end]);
  const same = await go({ HTTPS_PROXY: 'http://a' }, first);
  assert.strictEqual(same.resident, first.resident, 'the same variables: the same process');
  await turn(same, natives[0], [say('Two.'), end]);

  const changed = await go({ HTTPS_PROXY: 'http://b' }, same);
  assert.equal(natives[0].disposed, 1, 'a free process with the old variables is closed');
  assert.deepEqual(launched, [{ HTTPS_PROXY: 'http://a' }, { HTTPS_PROXY: 'http://b' }]);
  const run = new HarnessRun({ sessionId: 'dsh-env', handle: changed, prompts: [], team });
  t.after(() => run.close());
  natives[1].emit([child, say('Research started.'), end]);
  await flush();
  await run.interrupt();
  await run.pump;
  assert.equal(changed.backgroundActive, true);

  const busy = await go({ HTTPS_PROXY: 'http://c' }, changed);
  assert.strictEqual(busy.resident, changed.resident, 'a process with work of its own keeps its variables and takes the turn');
  assert.equal(launched.length, 2);
  await turn(busy, natives[1], [{ kind: 'task_ended', taskId: child.taskId, status: 'completed' }, say('Done.'), end]);
  assert.equal(busy.backgroundActive, false);

  const free = await go({ HTTPS_PROXY: 'http://c' }, busy);
  t.after(() => free.close());
  assert.equal(natives[1].disposed, 1, 'once it is free, the next turn starts a process with the new variables');
  assert.deepEqual(launched.at(-1), { HTTPS_PROXY: 'http://c' });
});

// 2026-11-23: with processes kept between turns, switching a Claude conversation to full access failed every later turn with "Could not start Claude: busy"
// (OAR's Claude throws for a new permission mode instead of answering).
test('a changed access mode that the process cannot take starts a new process that resumes the conversation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const natives = [nativeSession(), nativeSession()];
  for (const native of natives) (native.session as any).configure = async () => { throw new Error('busy'); };
  const launched: any[] = [];
  const runtime = { session: async (_installation: unknown, options: any) => { launched.push(options); return natives[launched.length - 1].session; } };
  const go = (permissionMode: string, previous?: any) => startOarRun({
    runtime, installation: { kind: 'available', via: 'bundled' }, sessionOptions: { permissionMode }, prompt: 'Go.', name: 'Claude',
    normalizer: new ClaudeNormalizer({ name: 'Claude', login: '' }), queuesSteer: true, previous,
  });
  const first = await go('default');
  const seen = observe(first);
  natives[0].emit([say('One.'), end]);
  await seen.done;
  await first.close({ preserveBackground: true });

  const full = await go('bypassPermissions', first);
  t.after(() => full.close());
  assert.equal(natives[0].disposed, 1, 'the old process is closed');
  assert.deepEqual(launched.map((options) => options.permissionMode), ['default', 'bypassPermissions'], 'and the turn goes to a new one with the new access (the provider gives it the native id to resume)');
});
