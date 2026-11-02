import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssueTidy, createIssueTidyScheduler } from '../host/assistant/issues/tidy.mjs';
import { setTimeout as wait } from 'node:timers/promises';
import { createIdleTidy } from '../host/assistant/home/tidy.mjs';

function world(t: any, answer = { changes: [] } as any) {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-tidy-'));
  const issues = createIssues({ file: ':memory:' });
  const issue = issues.add({ title: '合同续费', brief: '等确认' }).issue;
  let calls = 0;
  const rules = { rules: { 'TRIAGE.md': '按影响和工作量判断。' } };
  const tidy = createIssueTidy({
    issues, rules: () => rules, file: join(folder, 'tidy.json'),
    llm: async () => { calls++; return JSON.stringify(answer); },
  });
  t.after(async () => { await tidy.close(); issues.close(); rmSync(folder, { recursive: true, force: true }); });
  return { issues, issue, tidy, answer, rules, calls: () => calls };
}

test('issue tidy previews without writing, applies once as dudu, and undoes the group', async (t) => {
  const w = world(t, { changes: [{ id: 1, patch: { brief: '等法务确认' }, reason: '法务还没回' }] });
  const plan = await w.tidy.run();
  assert.equal(plan.preview, true);
  assert.equal(w.issues.get(1).issue.brief, '等确认');
  const applied = await w.tidy.run({ token: plan.token });
  assert.deepEqual(applied.changed, [1]);
  assert.equal(w.issues.get(1).issue.brief, '等法务确认');
  assert.equal(w.issues.events({ issueId: 1 }).events[0].actor, 'dudu');
  assert.equal((await w.tidy.run({ token: plan.token })).outcome, 'needs_clarification');
  assert.equal(w.tidy.undo().outcome, 'success');
  assert.equal(w.issues.get(1).issue.brief, '等确认');
  await w.tidy.run({ automatic: true });
  assert.equal(w.calls(), 1, 'undo is respected until the input changes');
});

test('the owner can edit while a tidy preview waits; the edited issue is skipped', async (t) => {
  const w = world(t, { changes: [{ id: 1, patch: { brief: '模型的摘要' } }] });
  const plan = await w.tidy.run();
  w.issues.update(1, { brief: '我的摘要' });
  assert.deepEqual((await w.tidy.run({ token: plan.token })).skipped, [1]);
  assert.equal(w.issues.get(1).issue.brief, '我的摘要');
});

test('new rules invalidate a preview, and a model cannot rewrite agents, state or an issue it was not shown', async (t) => {
  const w = world(t, { changes: [{ id: 1, patch: { priority: 'high' } }] });
  const plan = await w.tidy.run();
  w.rules.rules['TRIAGE.md'] = '有新规则。';
  assert.equal((await w.tidy.run({ token: plan.token })).outcome, 'needs_clarification');
  w.answer.changes = [{ id: 1, patch: { status: 'done' } }];
  assert.equal((await w.tidy.run()).outcome, 'error');
  assert.equal(w.issues.get(1).issue.status, 'todo');
  w.answer.changes = [{ id: 999, patch: { brief: '别的 issue' } }];
  assert.equal((await w.tidy.run()).outcome, 'error');
});

test('an automatic tidy does not call a model again for its own edits or unchanged input', async (t) => {
  const w = world(t, { changes: [{ id: 1, patch: { brief: '等法务确认' } }] });
  await w.tidy.run({ automatic: true });
  assert.equal((await w.tidy.run({ automatic: true })).outcome, 'no_op');
  assert.equal(w.calls(), 1);
  w.issues.log(1, { kind: 'note', text: '法务已回' });
  w.answer.changes = [];
  await w.tidy.run({ automatic: true });
  await w.tidy.run({ automatic: true });
  assert.equal(w.calls(), 2);
});

test('a tidy preserves owner priority and refuses an invalid patch before changing any issue', async (t) => {
  const w = world(t, { changes: [{ id: 1, patch: { priority: 'low', brief: '摘要更新' } }] });
  w.issues.update(1, { priority: 'high' });
  await w.tidy.run({ automatic: true });
  assert.equal(w.issues.get(1).issue.priority, 'high');
  assert.equal(w.issues.get(1).issue.brief, '摘要更新');
  w.issues.log(1, { text: '又有变化', kind: 'note' });
  w.answer.changes = [{ id: 1, patch: { brief: '不该写入' } }, { id: 1, patch: { dueAt: 'tomorrow' } }];
  assert.equal((await w.tidy.run({ automatic: true })).outcome, 'error');
  assert.equal(w.issues.get(1).issue.brief, '摘要更新');
});

test('priority chosen when the owner creates an issue is preserved too', async (t) => {
  const w = world(t, { changes: [{ id: 2, patch: { priority: 'low' } }] });
  w.issues.add({ title: 'Owner priority', priority: 'high' });
  await w.tidy.run({ automatic: true });
  assert.equal(w.issues.get(2).issue.priority, 'high');
});

test('changed issues are reviewed in bounded batches without starving those beyond the first fifty', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-tidy-batches-'));
  const issues = createIssues({ file: ':memory:' });
  const batches: any[][] = [];
  const tidy = createIssueTidy({
    issues, rules: () => ({ rules: {} }), file: join(folder, 'tidy.json'),
    llm: async (messages: any[]) => { batches.push(JSON.parse(messages[1].content)); return '{"changes":[]}'; },
  });
  t.after(async () => { await tidy.close(); issues.close(); rmSync(folder, { recursive: true, force: true }); });
  for (let n = 0; n < 65; n++) issues.add({ title: `Issue ${n}` });
  await tidy.run({ automatic: true });
  await tidy.run({ automatic: true });
  assert.deepEqual(batches.map((batch) => batch.length), [50, 15]);
  assert.equal(new Set(batches.flat().map((item: any) => item.id)).size, 65);
  assert.equal((await tidy.run({ automatic: true })).outcome, 'no_op');
  issues.log(1, { kind: 'note', text: 'A new reply' });
  await tidy.run({ automatic: true });
  assert.deepEqual(batches[2].map((item: any) => item.id), [1]);
  assert.equal(batches[2][0].title, 'Issue 0');
});

test('automatic tidy coalesces events, waits while busy and throttles dashboard visits', async () => {
  let calls = 0;
  let busy = true;
  let now = 0;
  const scheduler = createIssueTidyScheduler({
    busy: () => busy, now: () => now, debounceMs: 5, openMs: 100,
    tidy: { run: async () => { calls++; }, state: () => null, close: async () => {} },
  });
  try {
    scheduler.changed();
    scheduler.changed();
    await wait(20);
    assert.equal(calls, 0);
    busy = false;
    await wait(20);
    assert.equal(calls, 1);
    scheduler.opened();
    await wait(20);
    scheduler.opened();
    await wait(20);
    assert.equal(calls, 2);
    now = 101;
    scheduler.opened();
    await wait(20);
    assert.equal(calls, 3);
  } finally { await scheduler.close(); }
});

test('memory tidy waits for idle conversation work and serializes one batch; a turn arriving during it is retained', async () => {
  let at = 0;
  let busy = false;
  let calls = 0;
  let release: (result: any) => void = () => {};
  const idle = createIdleTidy({
    now: () => at, idleMs: 10, everyMs: 0, busy: () => busy,
    memory: () => ({ tidy: () => { calls++; return new Promise((resolve) => { release = resolve; }); } }),
  });
  await idle.tick();
  assert.equal(calls, 0, 'startup alone does not cost a model call');
  idle.touch();
  at = 20;
  busy = true;
  await idle.tick();
  assert.equal(calls, 0);
  busy = false;
  const first = idle.tick();
  await Promise.resolve();
  await idle.tick();
  assert.equal(calls, 1);
  idle.touch();
  release({ outcome: 'success' });
  await first;
  at = 40;
  const second = idle.tick();
  await Promise.resolve();
  assert.equal(calls, 2);
  release({ outcome: 'success' });
  await second;
  await idle.tick();
  assert.equal(calls, 2);
  await idle.close();
});
