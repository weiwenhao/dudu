import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readClaudeTail } from '../host/providers/native/claude-tail.mjs';

// A transcript as Claude Code writes one: a record per line, an assistant message as one record per content block, tool results as
// "user" records, and plenty of bytes that are not conversation. The conversation it holds, in order:
const conversation: Array<[string, string]> = [];
const lines: string[] = [];
let n = 0;
const record = (value: object) => lines.push(JSON.stringify({ uuid: `r${n++}`, timestamp: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...value }));
const say = (role: 'user' | 'assistant', text: string) => {
  conversation.push([role, text]);
  record({ type: 'user', message: { role: 'user', content: text } });
};
for (let turn = 0; turn < 12; turn++) {
  say('user', `第 ${turn} 个问题：${'字'.repeat(7 + turn)}`);
  record({ type: 'attachment', attachment: { filler: 'x'.repeat(300) } });
  // An assistant message in three records (text, a tool call, more text) that must come out as ONE message, and a step with only a call.
  const id = `m${turn}`;
  record({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text: `回答 ${turn} 开头` }] } });
  record({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'tool_use', id: `t${turn}`, name: 'Read', input: { path: 'x' } }] } });
  record({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${turn}`, content: 'y'.repeat(400) }] }, toolUseResult: {} });
  record({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text: `回答 ${turn} 结尾` }] } });
  conversation.push(['assistant', `回答 ${turn} 开头\n回答 ${turn} 结尾`]);
  record({ type: 'assistant', isSidechain: true, message: { id: `s${turn}`, role: 'assistant', content: [{ type: 'text', text: '子智能体的话不算' }] } });
  record({ type: 'user', isMeta: true, message: { role: 'user', content: '系统提醒不算' } });
  record({ type: 'assistant', message: { id: `only-${turn}`, role: 'assistant', content: [{ type: 'tool_use', id: `u${turn}`, name: 'Bash', input: {} }] } });
}

async function pages(file: string, options: { count: number; chunk?: number }) {
  const found: Array<{ role: string; text: string }> = [];
  let before: number | undefined;
  for (let guard = 0; guard < 200; guard++) {
    const page = await readClaudeTail({ file, before, ...options });
    found.unshift(...page.messages);
    if (page.nextCursor === null) return { found, pages: guard + 1 };
    assert.ok(before === undefined || page.nextCursor < before, 'the cursor always moves back');
    before = page.nextCursor;
  }
  throw new Error('paging never ended');
}

test('the end of a transcript is read in pages that add up to the whole conversation, whatever the chunk size', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-tail-'));
  try {
    const file = join(folder, 'session.jsonl');
    await writeFile(file, `${lines.join('\n')}\n`);
    for (const [count, chunk] of [[20, undefined], [5, 64], [3, 97], [7, 1000], [1, 53]] as const) {
      const { found } = await pages(file, { count, chunk });
      assert.deepEqual(found.map((message) => [message.role, message.text]), conversation, `count ${count}, chunk ${chunk}`);
    }
    // The first page is the newest twenty (or fewer), and says there is more before it.
    const first = await readClaudeTail({ file });
    assert.equal(first.messages.length, 20);
    assert.deepEqual(first.messages.map((message) => message.text), conversation.slice(-20).map(([, text]) => text));
    assert.ok(Number.isSafeInteger(first.nextCursor) && (first.nextCursor as number) > 0);
    // A file with fewer messages than a page is one page.
    const small = join(folder, 'small.jsonl');
    await writeFile(small, `${JSON.stringify({ type: 'user', uuid: 'a', message: { role: 'user', content: '只有一句' } })}\n`);
    assert.deepEqual(await readClaudeTail({ file: small }), { messages: [{ role: 'user', text: '只有一句' }], nextCursor: null });
  } finally { await rm(folder, { recursive: true, force: true }); }
});
