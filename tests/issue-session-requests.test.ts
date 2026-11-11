import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIssueSession, watchIssueSession } from '../host/dudu-plugin/ui/issues/session.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('issue resume failures never open a cached id or fall through to a native load', async () => {
  for (const session of ['dsh:old', 'claude:native', 'codex:native']) {
    for (const reply of [
      { outcome: 'error', message: 'Restore refused', sessionId: 'must-not-open' },
      { outcome: 'needs_clarification', message: 'Restore refused' },
      { outcome: 'success' },
      { outcome: 'no_op' },
    ]) {
      const calls: string[] = [];
      const request = async (action: string) => { calls.push(action); return reply; };
      await assert.rejects(resolveIssueSession(request, { preparedSession: () => 'must-not-open' }, { id: 4, session }));
      assert.deepEqual(calls, ['issues/resume']);
    }
    const failure = new Error('Disconnected');
    await assert.rejects(resolveIssueSession(async () => { throw failure; }, {}, { id: 4, session }), (error) => error === failure);
  }
});

test('cached issue history still restores the session before each opening', async () => {
  for (const outcome of ['success', 'no_op']) {
    const target = { outcome, sessionId: 'current', workspaceId: 'workspace' };
    const controller = new AbortController();
    const request = async (action: string, body: unknown, options: any) => {
      assert.equal(action, 'issues/resume');
      assert.deepEqual(body, { id: 4 });
      assert.equal(options.signal, controller.signal);
      return target;
    };
    assert.equal(await resolveIssueSession(request, {}, { id: 4, session: 'claude:native' }, { signal: controller.signal }), target);
  }
  let archived = true;
  let resumes = 0;
  const target = { outcome: 'success', sessionId: 'existing', workspaceId: 'workspace' };
  const request = async (action: string, body: unknown) => {
    assert.equal(action, 'issues/resume');
    assert.deepEqual(body, { id: 4 });
    resumes++;
    archived = false;
    return target;
  };
  const actions = { preparedSession: () => 'existing' };
  for (let opening = 0; opening < 2; opening++) {
    archived = true; // Completing an issue archives its session without evicting readable history.
    assert.equal(await resolveIssueSession(request, actions, { id: 4, session: 'dsh:existing' }), target);
    assert.equal(archived, false, 'DSH must lift its archived-session gate before the composer is shown');
  }
  assert.equal(resumes, 2);
});

test('failed session metadata reads stop, including a failure after a successful pending read', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const failure = new Error('Not found');
  for (const answer of [
    async () => ({ outcome: 'needs_clarification', code: 'not_found' }),
    async () => ({ outcome: 'error' }),
    async () => { throw failure; },
  ]) {
    for (const pendingFirst of [false, true]) {
      let reads = 0;
      const received: unknown[] = [];
      const stop = watchIssueSession(async () => {
        reads++;
        return pendingFirst && reads === 1 ? { outcome: 'success', command: null } : answer();
      }, { id: 4, agent: 'claude' }, (value: unknown) => received.push(value));
      try {
        await flush();
        t.mock.timers.tick(5000);
        await flush();
        t.mock.timers.tick(60_000);
        await flush();
        assert.equal(reads, pendingFirst ? 2 : 1);
        assert.equal(received.length, pendingFirst ? 1 : 0);
      } finally { stop(); }
    }
  }
});

test('a successful pending identity is checked again, while closing ignores an in-flight answer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 0;
  const received: any[] = [];
  const stop = watchIssueSession(async () => ({ outcome: 'success', command: ++reads === 1 ? null : 'claude --resume native' }),
    { id: 4, agent: 'claude' }, (value: unknown) => received.push(value));
  try {
    await flush();
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(received.at(-1).command, 'claude --resume native');
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(reads, 2);
  } finally { stop(); }

  let finish: (value: unknown) => void = () => {};
  const closed: unknown[] = [];
  const close = watchIssueSession(() => new Promise((resolve) => { finish = resolve; }), { id: 4, agent: 'codex' }, (value: unknown) => closed.push(value));
  close();
  finish({ outcome: 'success', command: null });
  await flush();
  assert.deepEqual(closed, []);
});
