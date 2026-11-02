import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectors } from '../host/assistant/connectors/index.mjs';
import { parseSources } from '../host/assistant/connectors/sources.mjs';
import { TEMPLATES } from '../host/assistant/templates.mjs';

function world(t: any, text = '# Sources\n') {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-sources-'));
  const file = join(dir, 'CONNECTORS.md');
  writeFileSync(file, text);
  const sources = createConnectors({ file });
  t.after(async () => { await sources.close(); rmSync(dir, { recursive: true, force: true }); });
  return { ...sources, file, read: () => readFileSync(file, 'utf8') };
}

test('source prompts are immediately available, with no execution or enable surface', async (t) => {
  const w = world(t);
  const added = w.dudu.register({ id: 'mail', name: '来信', prompt: '看飞书里等我回复的消息，保留来源链接。' });
  assert.equal(added.outcome, 'success');
  const listed = w.owner.list();
  assert.equal(listed.connectors.length, 1);
  assert.equal(listed.connectors[0].prompt, '看飞书里等我回复的消息，保留来源链接。');
  for (const field of ['enabled', 'operations', 'config', 'tools']) assert.ok(!(field in listed.connectors[0]));
  assert.deepEqual(Object.keys(w.owner).sort(), ['list', 'remove', 'undo']);
  for (const method of ['call', 'test', 'tick', 'discover', 'enable', 'disable']) assert.equal(w[method as keyof typeof w], undefined);
  assert.equal(w.dudu.register({ name: 'bad', prompt: 'read', command: 'anything' }).outcome, 'needs_clarification');
});

test('the owner prose, fenced examples and other sections survive edits, deletion and undo exactly', async (t) => {
  const before = '\uFEFF# 来源\r\n\r\n主人的介绍。\r\n\r\n~~~markdown\r\n## 这不是来源\r\n~~~\r\n\r\n## 飞书\r\n<!-- id: lark | source: owner -->\r\n看需要我处理的消息。\r\n\r\n### 细节\r\n只看最近一周。\r\n\r\n## 日历\r\n<!-- id: calendar -->\r\n看明天的安排。\r\n';
  const w = world(t, before);
  assert.deepEqual(w.owner.list().connectors.map((s: any) => s.id), ['lark', 'calendar']);
  const deleted = w.owner.remove('lark');
  assert.equal(deleted.outcome, 'success');
  assert.ok(w.read().startsWith(before.slice(0, before.indexOf('## 飞书'))));
  assert.ok(w.read().endsWith(before.slice(before.indexOf('## 日历'))));
  assert.equal(w.owner.undo(deleted.undo).outcome, 'success');
  assert.equal(w.read(), before);
  const update = w.dudu.update('lark', { prompt: '只读项目群里等我的请求。' });
  assert.equal(update.outcome, 'success');
  assert.equal(w.owner.list().connectors[0].source, 'owner');
  assert.equal(w.owner.list().connectors[0].prompt, '只读项目群里等我的请求。');
  assert.equal(w.owner.undo(update.undo).outcome, 'success');
  assert.equal(w.read(), before);
});

test('simple Markdown sources need no metadata; stable ids survive a restart', async (t) => {
  const w = world(t, '# Sources\n\n## 飞书\n读项目群。\n\n## 日历\n看明天。\n');
  const first = w.owner.list().connectors;
  const another = createConnectors({ file: w.file });
  assert.deepEqual(another.owner.list().connectors, first);
  assert.equal(first[0].source, 'owner');
  const added = w.dudu.register({ name: '第三个', prompt: '看待办。' });
  assert.equal(added.outcome, 'success');
  assert.deepEqual(w.owner.list().connectors.slice(0, 2), first);
  await another.close();
});

test('legacy launch blocks and enabled flags are ignored, while their human instructions remain', async (t) => {
  const w = world(t, '# Sources\n\n## 老来信\n<!-- id: old | enabled: false | source: owner -->\n读需要回复的来信。\n\n```json\n{"kind":"cli","command":"do-not-run","allow":["send"]}\n```\n');
  assert.deepEqual(w.owner.list().connectors.map((s: any) => [s.id, s.prompt]), [['old', '读需要回复的来信。']]);
  assert.ok(!JSON.stringify(w.owner.list()).includes('do-not-run'));
  assert.match(w.read(), /do-not-run/, 'reading preserves the original file');
});

test('duplicate ids are diagnosed, examples stay inactive and credentials are redacted or refused', async (t) => {
  assert.equal(parseSources(TEMPLATES['CONNECTORS.md']).entries.length, 0);
  const w = world(t, '# Sources\n\n## One\n<!-- id: same -->\nread one\n\n## Two\n<!-- id: same -->\nread two\n');
  assert.equal(w.owner.list().connectors.length, 1);
  assert.equal(w.owner.list().diagnostics.length, 1);
  assert.equal(w.dudu.register({ name: 'secret', prompt: 'api_key=sk-test-0123456789abcdefghijklmnop' }).outcome, 'needs_clarification');
  for (const prompt of ['# escaped\ntext', '## another\ntext', '']) assert.equal(w.dudu.register({ name: 'bad', prompt }).outcome, 'needs_clarification');
  writeFileSync(w.file, '# Sources\n\n## Mail\nread with token=sk-test-0123456789abcdefghijklmnop\n');
  assert.ok(!JSON.stringify(w.owner.list()).includes('sk-test-'));
});

test('undo never overwrites an intervening owner edit, and closed registries do not mutate files', async (t) => {
  const w = world(t);
  const added = w.dudu.register({ id: 'mail', name: 'Mail', prompt: 'Read incoming requests.' });
  writeFileSync(w.file, w.read() + '\nOwner edit.\n');
  const expected = w.read();
  assert.equal(w.owner.undo(added.undo).outcome, 'needs_clarification');
  assert.equal(w.read(), expected);
  await w.close();
  assert.equal(w.owner.remove('mail').outcome, 'error');
  assert.equal(w.read(), expected);
});
