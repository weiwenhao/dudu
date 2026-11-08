import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectors } from '../host/assistant/connectors/index.mjs';
import { parseSources } from '../host/assistant/connectors/sources.mjs';
import { TEMPLATES } from '../host/assistant/templates.mjs';

function world(t: any, text = '# Connectors\n', options: any = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-connectors-'));
  const file = join(dir, 'CONNECTORS.md');
  writeFileSync(file, text);
  const connectors = createConnectors({ file, ...options });
  t.after(async () => { await connectors.close(); rmSync(dir, { recursive: true, force: true }); });
  return { ...connectors, file, read: () => readFileSync(file, 'utf8') };
}

test('a connector is a Prompt or an MCP server, saved with its kind, and has no schedule, no notes and no switch', async (t) => {
  const w = world(t);
  const prompt = w.dudu.register({ id: 'lark', name: '飞书', prompt: '用 lark CLI 读，我已经登录好了。' });
  const mcp = w.owner.add({ id: 'notion', name: 'Notion', kind: 'mcp', spec: { url: 'https://mcp.notion.com/mcp' }, via: 'notion' });
  const local = w.owner.add({ id: 'pencil', name: 'Pencil', kind: 'mcp', spec: { command: '/Applications/Pencil.app/mcp-server', args: ['--stdio'], env: ['PENCIL_KEY'] } });
  assert.deepEqual([prompt.outcome, mcp.outcome, local.outcome], ['success', 'success', 'success']);
  assert.deepEqual(w.owner.list().connectors, [
    { id: 'lark', name: '飞书', kind: 'prompt', prompt: '用 lark CLI 读，我已经登录好了。', server: '', spec: null, via: '', legacy: false, source: 'dudu' },
    { id: 'notion', name: 'Notion', kind: 'mcp', prompt: '', server: '', spec: { url: 'https://mcp.notion.com/mcp' }, via: 'notion', legacy: false, source: 'owner' },
    { id: 'pencil', name: 'Pencil', kind: 'mcp', prompt: '', server: '', spec: { command: '/Applications/Pencil.app/mcp-server', args: ['--stdio'], env: ['PENCIL_KEY'] }, via: '', legacy: false, source: 'owner' },
  ]);
  const text = w.read();
  assert.match(text, /## 飞书\n<!-- id: lark \| source: dudu \| kind: prompt -->\n\n用 lark CLI 读，我已经登录好了。\n/);
  assert.match(text, /## Notion\n<!-- id: notion \| source: owner \| kind: mcp \| via: notion -->\n\n```json\n\{"url":"https:\/\/mcp\.notion\.com\/mcp"\}\n```\n/);
  assert.deepEqual(Object.keys(w.owner).sort(), ['add', 'list', 'remove', 'undo', 'update'], 'the owner can read, add, edit, remove and undo; there is no switch and no way to run anything');
  for (const method of ['call', 'test', 'tick', 'discover', 'enable', 'disable', 'notes']) assert.equal(w[method as keyof typeof w], undefined);
  for (const extra of [{ command: 'anything' }, { frequency: '15m' }, { notes: 'x' }]) {
    assert.equal(w.dudu.register({ name: 'bad', prompt: 'read', ...extra }).outcome, 'needs_clarification', JSON.stringify(extra));
  }
});

test('what a connector must say depends on its kind; a prompt is never cleared, but one that was never written may stay empty', async (t) => {
  const w = world(t);
  const refuse = (result: any, matches: RegExp) => { assert.equal(result.outcome, 'needs_clarification', JSON.stringify(result)); assert.match(result.message, matches); };
  refuse(w.owner.add({ name: 'a', kind: 'mcp' }), /address or the command/);
  refuse(w.owner.add({ name: 'a', kind: 'mcp', server: 'notion' }), /address or a command now/);
  refuse(w.owner.add({ name: 'a', kind: 'mcp', spec: { url: 'not an address' } }), /whole address/);
  refuse(w.owner.add({ name: 'a', kind: 'mcp', spec: { url: 'http://example.com/mcp' } }), /over https/);
  refuse(w.owner.add({ name: 'a', kind: 'mcp', spec: { url: 'https://user:pw@example.com/mcp' } }), /not in the address/);
  refuse(w.owner.add({ name: 'a', kind: 'mcp', spec: { url: 'https://example.com/mcp?token=sk-test-0123456789abcdefghijklmnop' } }), /not in the address/);
  refuse(w.owner.add({ name: 'a', kind: 'mcp', spec: { command: 'npx', env: ['bad name'] } }), /environment variable/);
  refuse(w.owner.add({ name: 'a', kind: 'mcp', spec: { command: 'npx', args: ['--key=sk-test-0123456789abcdefghijklmnop'] } }), /not in the command/);
  assert.equal(w.owner.add({ id: 'dev', name: 'Dev', kind: 'mcp', spec: { url: 'http://localhost:3000/mcp' } }).outcome, 'success', 'a server on this computer may be reached without https');
  assert.equal(w.owner.remove('dev').outcome, 'success');
  const secret = w.owner.add({ id: 'zap', name: 'Zap', kind: 'mcp', spec: { url: 'https://example.com/mcp?key=abc123', secretUrl: true } });
  assert.deepEqual(secret.connector.spec, { url: 'https://example.com/mcp', secretUrl: true }, 'an address that holds a secret is kept whole elsewhere; the file keeps only where it is');
  assert.ok(!w.read().includes('abc123'));
  assert.equal(w.owner.remove('zap').outcome, 'success');
  refuse(w.owner.add({ name: 'a', kind: 'other', prompt: 'read' }), /Prompt or an MCP server/);
  refuse(w.owner.add({ name: 'a', kind: 'prompt' }), /how to reach the service/);
  refuse(w.owner.add({ name: 'a', prompt: '   ' }), /how to reach the service/);
  assert.equal(w.read(), '# Connectors\n', 'nothing was written');

  const made = w.owner.add({ id: 'lark', name: '飞书', prompt: '用 lark CLI 读。' });
  refuse(w.owner.update('lark', { prompt: '' }), /how to reach the service/);
  assert.equal(w.owner.update('lark', { kind: 'mcp' }).outcome, 'needs_clarification', 'a Prompt connector turned into an MCP one needs its address or command');
  const toMcp = w.owner.update('lark', { kind: 'mcp', spec: { command: 'npx', args: ['-y', 'lark-mcp'] } });
  assert.equal(toMcp.outcome, 'success');
  assert.deepEqual([toMcp.connector.kind, toMcp.connector.prompt, toMcp.connector.spec], ['mcp', '', { command: 'npx', args: ['-y', 'lark-mcp'], env: [] }]);
  const back = w.owner.update('lark', { kind: 'prompt', prompt: '用 lark CLI 读。' });
  assert.equal(back.outcome, 'success');
  assert.equal(made.outcome, 'success');

  // An entry that came out of the split has no prompt yet; it can be renamed, and its prompt written later.
  writeFileSync(w.file, `${w.read()}\n## 老的\n<!-- id: old | source: owner | kind: prompt -->\n`);
  assert.equal(w.owner.list().connectors.find((item: any) => item.id === 'old').prompt, '');
  assert.equal(w.owner.update('old', { name: '老的邮件' }).outcome, 'success', 'renamed without a prompt');
  assert.equal(w.owner.update('old', { prompt: '用邮件工具读。' }).outcome, 'success');
});

test('a connector that collectors read through is not removed, and the answer names them', async (t) => {
  const users = new Map<string, string[]>([['lark', ['飞书 @我', '告警群']]]);
  const w = world(t, '# Connectors\n', { inUse: (id: string) => users.get(id) ?? [] });
  w.owner.add({ id: 'lark', name: '飞书', prompt: '用 lark CLI 读。' });
  w.owner.add({ id: 'spare', name: '备用', prompt: '没人用。' });
  const kept = w.read();
  const refused: any = w.owner.remove('lark');
  assert.equal(refused.outcome, 'needs_clarification');
  assert.equal(refused.code, 'in_use');
  assert.deepEqual(refused.collectors, ['飞书 @我', '告警群']);
  assert.equal(w.read(), kept, 'nothing was written');
  const removed: any = w.owner.remove('spare');
  assert.equal(removed.outcome, 'success');
  assert.equal(w.owner.undo(removed.undo).outcome, 'success');
  assert.equal(w.read(), kept);
  users.delete('lark');
  assert.equal(w.owner.remove('lark').outcome, 'success', 'once nothing reads through it, it goes');
  assert.equal(w.owner.remove('lark').outcome, 'no_op');
});

test('the owner prose, fenced examples and other sections survive edits, deletion and undo exactly', async (t) => {
  const before = '﻿# 来源\r\n\r\n主人的介绍。\r\n\r\n~~~markdown\r\n## 这不是来源\r\n~~~\r\n\r\n## 飞书\r\n<!-- id: lark | source: owner | kind: prompt -->\r\n看需要我处理的消息。\r\n\r\n### 细节\r\n只看最近一周。\r\n\r\n## 日历\r\n<!-- id: calendar | kind: prompt -->\r\n看明天的安排。\r\n';
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

test('simple Markdown entries need no metadata; stable ids survive a restart; an entry that does not say its kind is a Prompt', async (t) => {
  const w = world(t, '# Sources\n\n## 飞书\n读项目群。\n\n## 日历\n看明天。\n');
  const first = w.owner.list().connectors;
  const another = createConnectors({ file: w.file });
  assert.deepEqual(another.owner.list().connectors, first);
  assert.deepEqual([first[0].source, first[0].kind, first[0].prompt], ['owner', 'prompt', '读项目群。']);
  const added = w.dudu.register({ name: '第三个', prompt: '看待办。' });
  assert.equal(added.outcome, 'success');
  assert.match(added.connector.id, /^connector-[0-9a-f]{12}$/);
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
  assert.equal(parseSources(TEMPLATES['COLLECTORS.md']).entries.length, 0);
  const w = world(t, '# Sources\n\n## One\n<!-- id: same -->\nread one\n\n## Two\n<!-- id: same -->\nread two\n');
  assert.equal(w.owner.list().connectors.length, 1);
  assert.equal(w.owner.list().diagnostics.length, 1);
  assert.equal(w.dudu.register({ name: 'secret', prompt: 'api_key=sk-test-0123456789abcdefghijklmnop' }).outcome, 'needs_clarification');
  for (const prompt of ['# escaped\ntext', '## another\ntext', '']) assert.equal(w.dudu.register({ name: 'bad', prompt }).outcome, 'needs_clarification');
  writeFileSync(w.file, '# Sources\n\n## Mail\nread with token=sk-test-0123456789abcdefghijklmnop\n');
  assert.ok(!JSON.stringify(w.owner.list()).includes('sk-test-'));
});

test('an MCP entry says how to reach its server in a json block, and an entry from before has none and is told apart', async (t) => {
  const w = world(t);
  writeFileSync(w.file, [
    '# Connectors', '', '## Old', '<!-- id: old | source: owner | kind: mcp | server: notion -->', '',
    '## Linear', '<!-- id: linear | source: owner | kind: mcp | via: linear -->', '', '```json', '{"url":"https://mcp.linear.app/mcp"}', '```', '',
    '## Broken', '<!-- id: broken | source: owner | kind: mcp -->', '', '```json', '{not json', '```', '',
  ].join('\n'));
  const list = w.owner.list().connectors.map(({ id, spec, via, legacy, server }: any) => ({ id, spec, via, legacy, server }));
  assert.deepEqual(list, [
    { id: 'old', spec: null, via: '', legacy: true, server: 'notion' },
    { id: 'linear', spec: { url: 'https://mcp.linear.app/mcp' }, via: 'linear', legacy: false, server: '' },
    { id: 'broken', spec: null, via: '', legacy: true, server: '' },
  ]);
  assert.equal(w.owner.update('old', { name: 'New name' }).outcome, 'needs_clarification', 'an entry from before is only removed and made again');
  assert.equal(w.owner.remove('old').outcome, 'success');
});

test('the entry reader says what a metadata line holds: kind, server, connector and frequency, whatever order they come in', () => {
  const parsed = parseSources([
    '## A', '<!-- id: a | source: dudu | kind: mcp | server: notion -->', '',
    '## B', '<!-- id: b | connector: a | every: 15m | source: owner -->', 'what to collect', '',
    '## C', '<!-- id: c | cron: 0 9-18 * * 1-5 | kind: prompt -->', 'x', '',
    '## D', '<!-- id: d -->', 'y',
  ].join('\n'));
  const pick = ({ id, source, kind, kinded, server, connector, frequency }: any) => ({ id, source, kind, kinded, server, connector, frequency });
  assert.deepEqual(parsed.entries.map(pick), [
    { id: 'a', source: 'dudu', kind: 'mcp', kinded: true, server: 'notion', connector: '', frequency: null },
    { id: 'b', source: 'owner', kind: 'prompt', kinded: false, server: '', connector: 'a', frequency: '15m' },
    { id: 'c', source: 'owner', kind: 'prompt', kinded: true, server: '', connector: '', frequency: '0 9-18 * * 1-5' },
    { id: 'd', source: 'owner', kind: 'prompt', kinded: false, server: '', connector: '', frequency: null },
  ]);
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

test('the owner types a connector into the settings page: it is saved as theirs, edited in place, and refused with a reason when it cannot be a section', async (t) => {
  const before = '# 来源\n\n主人的介绍。\n\n## 日历\n<!-- id: calendar | source: dudu | kind: prompt -->\n看明天的安排。\n';
  const w = world(t, before);
  const added = w.owner.add({ name: '飞书', prompt: '用 lark CLI 读，我已经登录好了。\n\n### 细节\n只看最近一周。' });
  assert.equal(added.outcome, 'success');
  assert.equal(added.connector.source, 'owner');
  assert.ok(w.read().startsWith(before), 'what was there stays exactly as it was');
  const [calendar, lark] = w.owner.list().connectors;
  assert.deepEqual([calendar.source, lark.source, lark.name], ['dudu', 'owner', '飞书']);
  assert.equal(lark.prompt, '用 lark CLI 读，我已经登录好了。\n\n### 细节\n只看最近一周。', 'a sub-heading of three # is part of the prompt');
  assert.match(w.read(), /<!-- id: connector-[0-9a-f]{12} \| source: owner \| kind: prompt -->/);

  // An edit changes the name and the prompt of that entry only, and keeps who wrote it; it is the owner's to make on any entry.
  const edited = w.owner.update(lark.id, { name: '飞书消息', prompt: '只读项目群里等我的请求。' });
  assert.equal(edited.outcome, 'success');
  assert.deepEqual([edited.connector.name, edited.connector.prompt, edited.connector.source], ['飞书消息', '只读项目群里等我的请求。', 'owner']);
  const handed = w.owner.update('calendar', { prompt: '看本周的安排。' });
  assert.equal(handed.outcome, 'success');
  assert.equal(w.owner.list().connectors[0].source, 'dudu', 'whose it was does not change when it is edited');
  assert.equal(w.owner.update(lark.id, { name: '飞书消息', prompt: '只读项目群里等我的请求。' }).outcome, 'no_op', 'saving what is already there changes nothing');
  assert.equal(w.owner.undo(edited.undo).outcome, 'needs_clarification', 'an undo does not undo past a later edit');
  assert.equal(w.owner.undo(handed.undo).outcome, 'success');

  // What cannot be saved says why (the page shows the reason in the owner's language), and nothing is written.
  const text = w.read();
  const refuse = (result: any, matches: RegExp) => { assert.equal(result.outcome, 'needs_clarification'); assert.match(result.message, matches); assert.equal(w.read(), text); };
  refuse(w.owner.add({ name: '', prompt: '看邮件。' }), /short name/);
  refuse(w.owner.add({ name: '很长'.repeat(101), prompt: '看邮件。' }), /short name/);
  refuse(w.owner.add({ name: 'a<b', prompt: '看邮件。' }), /short name/);
  refuse(w.owner.add({ name: '邮件', prompt: '   ' }), /prompt/);
  refuse(w.owner.add({ name: '邮件', prompt: '第一行\n# 标题\n第三行' }), /cannot start with #/);
  refuse(w.owner.add({ name: '邮件', prompt: '## 标题' }), /cannot start with #/);
  refuse(w.owner.add({ name: '邮件', prompt: 'api_key=sk-test-0123456789abcdefghijklmnop' }), /credentials/);
  refuse(w.owner.add({ name: '邮件', prompt: '看邮件。', command: 'anything' }), /only has a name and a prompt or an MCP server/);
  refuse(w.owner.update(lark.id, { prompt: '# 标题' }), /cannot start with #/);
  refuse(w.owner.update('nothing-here', { prompt: '看邮件。' }), /no longer exists/);
  assert.equal(w.owner.update(lark.id, { name: '' }).outcome, 'needs_clarification', 'a name cannot be emptied');
});
