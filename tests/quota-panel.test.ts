import assert from 'node:assert/strict';
import test from 'node:test';
import { blockOf, panelOf, rowOf, termOf, updatedText } from '../host/dudu-plugin/ui/quota/panel-model.mjs';

// The panel behind the header icon: one block for each source the quota service lists (whatever it is called), one row for each of its windows.

const NOW = Date.UTC(2026, 10, 11, 7, 12);
const window = (key: string, label: string, used: number, extra: Record<string, unknown> = {}) => ({ key, label, used, core: true, resetsAt: NOW + 3_600_000, ...extra });

test('a row says what is left, colours the number as it runs low, and a used-up window says when it starts over instead', () => {
  const row = rowOf(window('five_hour', '5 小时', 0.21));
  assert.deepEqual([row.left, row.level, row.out], [79, '', false]);
  assert.equal(row.figure.slice(...(row.number as [number, number])), '79%', 'the number is told apart in the words, whichever order the language puts it in');
  assert.ok(row.reset.length > 0);
  assert.equal(rowOf(window('five_hour', '5 小时', 0.74)).level, 'warn');
  assert.equal(rowOf(window('five_hour', '5 小时', 0.92)).level, 'hot');
  const out = rowOf(window('five_hour', '5 小时', 1));
  assert.deepEqual([out.out, out.left, out.reset], [true, 0, '']);
  assert.ok(out.phrase.length > 0, 'the phrase carries the time');
  assert.equal(rowOf(window('five_hour', '5 小时', 1, { resetsAt: undefined })).phrase, '', 'with no time to tell, the figure says 0');
  assert.equal(rowOf(window('x', 'Weekly', 0.5, { resetsAt: undefined })).reset, '');
});

test('the panel lists what the service lists, a block for a balance has its amount, a block with nothing to say is left out, and the time is the oldest reading\'s', () => {
  const view = {
    refreshing: true, readAt: NOW,
    providers: [
      { id: 'claude', agent: 'claude', name: 'Claude', plan: 'Max', windows: [window('five_hour', '5 小时', 0.2), window('seven_day', '每周', 0.3)], readAt: NOW },
      { id: 'pi', agent: 'pi', name: 'Pi', plan: '', windows: [window('x', '5 小时', 0.4)], readAt: NOW },
      { id: 'deepseek-key', agent: 'deepseek', name: 'DeepSeek', plan: 'API', kind: 'balance', windows: [], balance: [{ text: '$0.00' }, { text: '¥12.34' }], readAt: NOW },
      { id: 'zero', agent: 'deepseek', name: 'DeepSeek', plan: 'Account', kind: 'balance', windows: [], balance: [{ text: '¥0.00' }], readAt: NOW },
      { id: 'empty', agent: 'empty', name: 'Empty', plan: '', windows: [], readAt: NOW },
    ],
  };
  const panel = panelOf(view)!;
  assert.deepEqual(panel.blocks.map((block: any) => [block.key, block.agent, block.rows.length, block.amount]), [['claude', 'claude', 2, ''], ['pi', 'pi', 1, ''], ['deepseek-key', 'deepseek', 0, '¥12.34']],
    'an agent that is added later is a block like the others; two DeepSeek sources would be told apart by their ids');
  assert.deepEqual([panel.refreshing, panel.readAt], [true, NOW]);
  assert.equal(panelOf(null), null, 'nothing is known before the first answer');
  assert.deepEqual(panelOf({ providers: [], refreshing: false, readAt: null }), { blocks: [], readAt: null, refreshing: false });
  assert.equal(updatedText(null), '');
  assert.ok(updatedText(NOW).length > 0);
});

test('a plan that says when it ends has it after its name (the month and day, the full time as its tooltip), and a plan that does not says nothing', () => {
  const until = Date.UTC(2026, 10, 24, 14, 2, 23);
  const term = termOf(until)!;
  assert.match(term.text, /24/);
  assert.ok(term.title.length > term.text.length, 'the tooltip carries the whole time');
  assert.equal(termOf(undefined), null);
  assert.equal(blockOf({ id: 'codex', agent: 'codex', name: 'ChatGPT', plan: 'Team', windows: [], until }).term?.text, term.text);
  assert.equal(blockOf({ id: 'claude', agent: 'claude', name: 'Claude', plan: 'Team', windows: [] }).term, null);
});

