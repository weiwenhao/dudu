import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexLegacyTaskViews, foldCodexNotification, initialCodexProjection } from '@dudu/oar-adapter/testing';

const spawn = (status = 'completed', extra = {}) => ({
  type: 'collabAgentToolCall', id: 'spawn-call', tool: 'spawnAgent', status,
  senderThreadId: 'root', receiverThreadIds: ['child'], prompt: 'Inspect the parser.',
  agentsStates: { child: { status: 'pendingInit', message: null } }, ...extra,
});
const frameEvents = (result: any) => result.commands.filter((command: any) => command.kind === 'frame').flatMap((command: any) => command.body.events);
const opened = () => foldCodexNotification(initialCodexProjection('root'), 'item/completed', { threadId: 'root', item: spawn() });

test('Codex v1 spawn completion establishes a running child, without declaring the research completed', () => {
  const progress = foldCodexNotification(initialCodexProjection('root'), 'item/started', { threadId: 'root', item: spawn('inProgress') });
  assert.equal(frameEvents(progress).length, 0);
  const result = opened();
  assert.deepEqual(frameEvents(result).filter((event: any) => event.kind.startsWith('task_')), [{
    kind: 'task_started', taskId: 'child', taskType: 'agent', nativeType: 'collabAgentToolCall',
    childSessionId: 'child', background: true, toolCallId: 'spawn-call', description: 'Inspect the parser.',
  }]);
  assert.equal(result.state.subagents.get('child')?.parent, 'root');
});

test('native child turn completion reports its actual outcome on its own thread', () => {
  for (const [native, status] of [['completed', 'completed'], ['interrupted', 'stopped'], ['failed', 'failed']]) {
    const start = opened();
    const active = foldCodexNotification(start.state, 'turn/started', { threadId: 'child', turnId: 'child-turn' });
    assert.ok(frameEvents(active).some((event: any) => event.kind === 'task_updated' && event.taskId === 'child' && event.status === 'running'));
    const end = foldCodexNotification(active.state, 'turn/completed', { threadId: 'child', turn: { id: 'child-turn', status: native } });
    assert.ok(frameEvents(end).some((event: any) => event.kind === 'task_ended' && event.taskId === 'child' && event.status === status));
    assert.equal(end.commands.find((command: any) => command.kind === 'frame')?.sessionId, 'child');
  }
});

test('a v1 resumed child becomes running again, while peer messages cannot manufacture children', () => {
  const state = opened().state;
  const own = foldCodexNotification(state, 'item/completed', {
    threadId: 'root', item: spawn('completed', { tool: 'sendInput', agentsStates: { child: { status: 'running' } } }),
  });
  assert.deepEqual(frameEvents(own).filter((event: any) => event.kind.startsWith('task_')), [{ kind: 'task_updated', taskId: 'child', status: 'running' }]);
  const resumedIdle = foldCodexNotification(state, 'item/completed', {
    threadId: 'root', item: spawn('completed', { tool: 'resumeAgent', agentsStates: { child: { status: 'pendingInit' } } }),
  });
  assert.equal(frameEvents(resumedIdle).some((event: any) => event.kind.startsWith('task_')), false, 'opening an idle child is not new work');
  const peer = foldCodexNotification(state, 'item/completed', {
    threadId: 'sibling', item: spawn('completed', { senderThreadId: 'sibling', tool: 'sendInput' }),
  });
  assert.equal(frameEvents(peer).some((event: any) => event.kind.startsWith('task_')), false);
  const failed = foldCodexNotification(initialCodexProjection('root'), 'item/completed', {
    threadId: 'root', item: spawn('failed'),
  });
  assert.equal(frameEvents(failed).some((event: any) => event.kind.startsWith('task_')), false);
  assert.equal(failed.state.subagents.size, 0);
});

test('v1 task snapshots keep failed and interrupted outcomes and native summaries', () => {
  for (const [native, status] of [['errored', 'failed'], ['interrupted', 'stopped'], ['completed', 'completed']]) {
    const events = codexLegacyTaskViews(spawn('completed', {
      tool: 'wait', agentsStates: { child: { status: native, message: 'Native result.' } },
    }), () => true);
    assert.deepEqual(events, [{ kind: 'task_ended', taskId: 'child', status, summary: 'Native result.' }]);
  }
});

test('Codex v2 remains attributed and siblings cannot reopen one another as child tasks', () => {
  const start = foldCodexNotification(initialCodexProjection('root'), 'item/completed', {
    threadId: 'root', item: { type: 'subAgentActivity', id: 'v2', kind: 'started', agentThreadId: 'child', agentPath: '/root/research' },
  });
  assert.equal(frameEvents(start).filter((event: any) => event.kind === 'task_started').length, 1);
  const sibling = foldCodexNotification(start.state, 'item/completed', {
    threadId: 'sibling', item: { type: 'subAgentActivity', kind: 'interacted', agentThreadId: 'child', agentPath: '/root/research' },
  });
  assert.equal(frameEvents(sibling).some((event: any) => event.kind === 'task_updated'), false);
});

test('resuming an observed Codex parent retains child ownership without inventing current activity', () => {
  const state = initialCodexProjection('root', 'thread/resume', [
    { sessionId: 'root', taskId: 'child', childSessionId: 'child', agentPath: [] },
    { sessionId: 'other-root', taskId: 'stranger', childSessionId: 'stranger', agentPath: [] },
  ]);
  assert.equal(state.subagents.size, 1);
  assert.equal(state.subagents.get('child')?.parent, 'root');
  const active = foldCodexNotification(state, 'turn/started', { threadId: 'child', turnId: 'new-turn' });
  assert.ok(frameEvents(active).some((event: any) => event.kind === 'task_updated' && event.taskId === 'child' && event.status === 'running'));
  const peer = foldCodexNotification(state, 'item/completed', {
    threadId: 'sibling', item: spawn('completed', { senderThreadId: 'sibling', tool: 'sendInput' }),
  });
  assert.equal(frameEvents(peer).some((event: any) => event.kind.startsWith('task_')), false);
});
