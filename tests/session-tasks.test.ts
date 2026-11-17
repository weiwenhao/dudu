import assert from 'node:assert/strict';
import test from 'node:test';
import { belongsTo, headerCount, sessionTasks } from '../host/dudu-plugin/ui/tasks/session-tasks.js';

// Which scheduled tasks a conversation's header lists (owner, 2026-11-17, "那没问题"): every task whose prompts go into it, whoever made it.

const task = (id: string, target: object, extra: object = {}) => ({ id, status: 'active', target, sessionId: null, nextRunAt: 100, createdAt: 1, updatedAt: 1, ...extra });

test('a task belongs to the conversation it names or keeps, and to none when it makes a new one each run', () => {
  assert.equal(belongsTo(task('a', { mode: 'existing', sessionId: 's1' }), 's1'), true);
  assert.equal(belongsTo(task('a', { mode: 'existing', sessionId: 's2' }), 's1'), false);
  assert.equal(belongsTo(task('b', { mode: 'reuse' }, { sessionId: 's1' }), 's1'), true, 'the conversation a reusing task has made and keeps');
  assert.equal(belongsTo(task('b', { mode: 'reuse' }), 's1'), false, 'it has not made one yet');
  assert.equal(belongsTo(task('c', { mode: 'new' }, { sessionId: 's1' }), 's1'), false, 'the latest of many conversations is not its place');
  assert.equal(belongsTo(task('d', undefined as never), 's1'), false);
  assert.equal(belongsTo(task('e', { mode: 'existing', sessionId: '' }), ''), false);
});

test('the conversation\'s tasks come by status, the newest made first as the tasks window has them; the header counts the ones that are on, else the paused, and ended ones alone bring nothing', () => {
  const tasks = [
    task('first', { mode: 'existing', sessionId: 's1' }, { createdAt: 10, nextRunAt: 300 }),
    task('second', { mode: 'existing', sessionId: 's1' }, { createdAt: 20, nextRunAt: 200 }),
    task('old', { mode: 'existing', sessionId: 's1' }, { status: 'paused', createdAt: 5 }),
    task('new', { mode: 'existing', sessionId: 's1' }, { status: 'paused', createdAt: 9 }),
    task('done', { mode: 'existing', sessionId: 's1' }, { status: 'ended', nextRunAt: null }),
    task('other', { mode: 'existing', sessionId: 's2' }),
  ];
  const mine = sessionTasks(tasks, 's1');
  assert.deepEqual(mine.active.map((item) => item.id), ['second', 'first'], 'not by the next run: a row must stay where it is');
  assert.deepEqual(mine.paused.map((item) => item.id), ['new', 'old']);
  assert.deepEqual(mine.ended.map((item) => item.id), ['done']);
  assert.equal(headerCount(mine), 2);
  assert.equal(headerCount({ ...mine, active: [] }), 2, 'nothing on: the paused ones are counted');
  assert.equal(headerCount({ active: [], paused: [], ended: mine.ended }), 0);
  assert.deepEqual(sessionTasks(undefined, 's1'), { active: [], paused: [], ended: [] });
});
