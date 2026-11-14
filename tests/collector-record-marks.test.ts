import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRecordMarks, createRecordMarks } from '../host/dudu-plugin/ui/collector/record-marks.js';

const NOW = Date.UTC(2026, 10, 10, 12);
const row = (id: number, extra: any = {}) => ({ id, connector: 'mail', connectorName: 'Mail', at: NOW - id, done: false, ignored: false, issue: null, ...extra });
const page = (items: any[], nextCursor: string | null = null) => ({ items, nextCursor });
const shown = (marks: any, value: any, tab = 'todo', filter = {}) => applyRecordMarks(value, marks.getSnapshot(), { tab, filter }, NOW).items;

test('a mark updates before saving, survives an older read, and a restore survives the read started before it', () => {
  const marks = createRecordMarks();
  const a = row(1);
  const beforeClick = marks.beforeRead();
  const change = marks.begin('inbox/done', [a])!;
  assert.deepEqual(shown(marks, page([a])), [], 'the click removes the row without a response');
  assert.equal(shown(marks, page([]), 'done')[0].done, true);
  assert.equal(marks.begin('inbox/delete', change.records), null, 'do not send overlapping marks for the same row');
  const whileSaving = marks.beforeRead();
  change.settle(true, { ...a, done: true });
  marks.acceptRead(beforeClick);
  marks.acceptRead(whileSaving);
  assert.deepEqual(shown(marks, page([a])), [], 'a response already on its way cannot put the row back');

  const afterSave = marks.beforeRead();
  const restoring = marks.begin('inbox/restore', change.records)!;
  assert.deepEqual(shown(marks, page([])), [a], 'a restore puts the row back before its save');
  marks.acceptRead(afterSave);
  assert.deepEqual(shown(marks, page([])), [a], 'the first save\'s refresh does not erase the restore');
  restoring.settle(true, a);
  marks.acceptRead(marks.beforeRead());
  assert.equal(marks.getSnapshot().size, 0, 'a read after saving reconciles the overlay');
});

test('failed marks restore just their own rows, preserving another click and newly collected rows', () => {
  const marks = createRecordMarks();
  const [a, b, c] = [row(1), row(2), row(3)];
  const first = marks.begin('inbox/done', [a])!;
  const second = marks.begin('inbox/ignore', [b])!;
  first.settle(false);
  assert.deepEqual(shown(marks, page([b, c])), [a, c]);
  second.settle(true);
  const deleting = marks.begin('inbox/delete', [a, c])!;
  deleting.settle(true, a); // The public card intentionally has no deleted flag.
  for (const tab of ['todo', 'done', 'ignored']) assert.deepEqual(shown(marks, page([a, c]), tab).filter((record: any) => record.id !== b.id), []);
  const restoring = marks.begin('inbox/restore', deleting.records)!;
  assert.deepEqual(shown(marks, page([])), [a, c]);
  restoring.settle(false);
  assert.deepEqual(shown(marks, page([])), [], 'a failed restore leaves the deleted state');
});

test('optimistic moves respect the active tab, filters and loaded page, including deletion from ignored', () => {
  const marks = createRecordMarks();
  const ignored = row(1, { ignored: true });
  const deleted = marks.begin('inbox/delete', [ignored])!;
  deleted.settle(true);
  const restore = marks.begin('inbox/restore', deleted.records)!;
  assert.deepEqual(shown(marks, page([]), 'ignored'), [ignored]);
  assert.deepEqual(shown(marks, page([])), []);
  assert.deepEqual(shown(marks, page([]), 'ignored', { connector: ['lark'] }), []);
  restore.settle(true);
  const old = row(4, { at: NOW - 40 * 86_400_000 });
  marks.begin('inbox/done', [old]);
  assert.deepEqual(shown(marks, page([]), 'done', { date: ['month'] }), []);
  assert.deepEqual(shown(marks, page([row(3, { done: true })], 'next'), 'done').map((item: any) => item.id), [3], 'an older moved row stays beyond the loaded page');
});
