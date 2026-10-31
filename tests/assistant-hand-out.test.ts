// What happens to an issue dispatch has given to an agent: a fresh session, or the one that handled this kind of issue before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandOut } from '../host/assistant/dispatch/hand-out.mjs';

const issue = { id: 7, title: '续费服务器', agent: 'claude' };

function world(assigned: any) {
  const calls: any[] = [];
  const handOut = createHandOut({
    dispatch: { assign: async (id: number) => { calls.push(['assign', id]); return assigned; } },
    issues: { get: (id: number) => { calls.push(['get', id]); return { outcome: 'success', issue, log: [{ text: 'b' }, { text: 'a' }] }; } },
    assignment: {
      start: async (given: any, options: any) => { calls.push(['start', given.id, options]); },
      restore: async () => { calls.push(['restore']); },
      onReply: async (given: any, text: string) => { calls.push(['reply', given.id, text]); },
    },
    firstMessage: ({ issue: given, log, access }: any) => `${given.title}|${log.map((entry: any) => entry.text).join('')}|${access}`,
  });
  return { calls, handOut };
}

test('an issue given to an agent with a fresh session starts it, with the access dispatch granted', async () => {
  const { calls, handOut } = world({ assigned: true, reused: false, access: 'workspace-write', issue });
  await handOut(7);
  assert.deepEqual(calls, [['assign', 7], ['start', 7, { access: 'workspace-write' }]]);
});

test('an issue given to the session that handled this kind before follows that session and tells it, oldest log line first', async () => {
  const { calls, handOut } = world({ assigned: true, reused: true, access: 'read-only', issue });
  await handOut(7);
  assert.deepEqual(calls, [['assign', 7], ['get', 7], ['restore'], ['reply', 7, '续费服务器|ab|read-only']]);
});

test('an issue that was given to no one starts nothing', async () => {
  const { calls, handOut } = world({ outcome: 'needs_clarification', assigned: false });
  await handOut(7);
  assert.deepEqual(calls, [['assign', 7]]);
});
