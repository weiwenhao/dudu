import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAssistant } from '../host/assistant/assistant.mjs';
import { createCollectors } from '../host/assistant/collectors/index.mjs';
import { splitLegacySources } from '../host/assistant/collectors/migrate.mjs';
import { createConnectors } from '../host/assistant/connectors/index.mjs';
import { parseSources } from '../host/assistant/connectors/sources.mjs';
import { TEMPLATES } from '../host/assistant/templates.mjs';

// The connector and the collector are told apart: a collector reads through one connector, and keeps what to collect and how often.

function world(t: any, { collectors: collectorsText = '# 收集器\n', connectors: connectorsText = '# 连接器\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-collectors-'));
  writeFileSync(join(dir, 'CONNECTORS.md'), connectorsText);
  writeFileSync(join(dir, 'COLLECTORS.md'), collectorsText);
  const connectors = createConnectors({
    file: join(dir, 'CONNECTORS.md'),
    inUse: (id: string) => ((collectors.owner.list() as any).collectors ?? []).filter((item: any) => item.connector === id).map((item: any) => item.name),
  });
  const collectors = createCollectors({ file: join(dir, 'COLLECTORS.md'), connectors: () => connectors });
  t.after(async () => { await collectors.close(); await connectors.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, connectors, collectors, file: join(dir, 'COLLECTORS.md'), read: () => readFileSync(join(dir, 'COLLECTORS.md'), 'utf8') };
}

test('a collector is a name, a connector, what to collect and how often', (t) => {
  const w = world(t);
  w.connectors.owner.add({ id: 'lark', name: '飞书', prompt: '用 lark CLI 读。' });
  w.connectors.owner.add({ id: 'notion', name: 'Notion', kind: 'mcp', spec: { url: 'https://mcp.notion.com/mcp' } });
  const added: any = w.collectors.owner.add({ id: 'at-me', name: '飞书 @我', connector: 'lark', prompt: '收集 @ 我的消息。', frequency: '15m' });
  assert.equal(added.outcome, 'success');
  const mine: any = w.collectors.dudu.register({ id: 'alerts', name: '告警群', connector: 'lark', prompt: '看 Platform Alerts 里没恢复的告警。' });
  assert.deepEqual(w.collectors.owner.list(), {
    outcome: 'success', diagnostics: [], collectors: [
      { id: 'at-me', name: '飞书 @我', connector: 'lark', prompt: '收集 @ 我的消息。', frequency: '15m', source: 'owner' },
      { id: 'alerts', name: '告警群', connector: 'lark', prompt: '看 Platform Alerts 里没恢复的告警。', frequency: null, source: 'dudu' },
    ],
  });
  assert.equal(mine.outcome, 'success');
  assert.match(w.read(), /## 飞书 @我\n<!-- id: at-me \| source: owner \| connector: lark \| every: 15m -->\n\n收集 @ 我的消息。\n/);
  assert.deepEqual(Object.keys(w.collectors.owner).sort(), ['add', 'list', 'remove', 'undo', 'update']);
  assert.deepEqual(Object.keys(w.collectors).sort(), ['close', 'dudu', 'owner', 'resolve']);

  // what a collection needs: the collector with the connector it reads through
  const resolved: any = w.collectors.resolve();
  assert.deepEqual(resolved.collectors.map((item: any) => [item.id, item.via.id, item.via.kind]), [['at-me', 'lark', 'prompt'], ['alerts', 'lark', 'prompt']]);
  w.collectors.owner.update('alerts', { connector: 'notion' });
  assert.deepEqual((w.collectors.resolve() as any).collectors.map((item: any) => [item.id, item.via.name]), [['at-me', '飞书'], ['alerts', 'Notion']]);
  writeFileSync(w.file, `${w.read()}\n## 孤儿\n<!-- id: orphan | connector: gone -->\n没有连接器的收集器。\n`);
  assert.equal((w.collectors.resolve() as any).collectors.find((item: any) => item.id === 'orphan').via, null, 'a collector whose connector is gone says so, and is not hidden');
});

test('what cannot be saved says why: the connector has to exist, the text has to be there, the frequency has to be one that runs', (t) => {
  const w = world(t);
  w.connectors.owner.add({ id: 'lark', name: '飞书', prompt: '用 lark CLI 读。' });
  let before = w.read();
  const refuse = (result: any, matches: RegExp) => { assert.equal(result.outcome, 'needs_clarification', JSON.stringify(result)); assert.match(result.message, matches); assert.equal(w.read(), before); };
  refuse(w.collectors.owner.add({ name: '', connector: 'lark', prompt: '收集' }), /short name/);
  refuse(w.collectors.owner.add({ name: 'a<b', connector: 'lark', prompt: '收集' }), /short name/);
  refuse(w.collectors.owner.add({ name: '甲', prompt: '收集' }), /Choose a connector/);
  refuse(w.collectors.owner.add({ name: '甲', connector: 'nothing', prompt: '收集' }), /existing connector/);
  refuse(w.collectors.owner.add({ name: '甲', connector: 'lark', prompt: '  ' }), /what to collect/);
  refuse(w.collectors.owner.add({ name: '甲', connector: 'lark', prompt: '第一行\n# 标题' }), /cannot start with #/);
  refuse(w.collectors.owner.add({ name: '甲', connector: 'lark', prompt: 'token sk-test-0123456789abcdefghijklmnop' }), /credentials/);
  refuse(w.collectors.owner.add({ name: '甲', connector: 'lark', prompt: '收集', frequency: '3m' }), /5 minutes/);
  refuse(w.collectors.owner.add({ name: '甲', connector: 'lark', prompt: '收集', frequency: 'whenever' }), /how often/);
  refuse(w.collectors.owner.add({ name: '甲', connector: 'lark', prompt: '收集', command: 'anything' }), /only has a name, a connector/);
  const made: any = w.collectors.owner.add({ id: 'a', name: '甲', connector: 'lark', prompt: '收集' });
  assert.equal(made.outcome, 'success');
  before = w.read();
  refuse(w.collectors.owner.add({ id: 'a', name: '乙', connector: 'lark', prompt: '收集' }), /already exists/);
  const saved = w.read();
  assert.equal(w.collectors.owner.update('a', { connector: 'nothing' }).outcome, 'needs_clarification');
  assert.equal(w.collectors.owner.update('nothing-here', { name: 'x' }).outcome, 'needs_clarification');
  assert.equal(w.collectors.owner.update('a', { name: '甲' }).outcome, 'no_op', 'saving what is already there changes nothing');
  assert.equal(w.read(), saved);
  // a frequency the file already holds that cannot be read does not stop the owner renaming the collector
  writeFileSync(w.file, w.read().replace('connector: lark -->', 'connector: lark | every: 1m -->'));
  assert.equal(w.collectors.owner.update('a', { name: '甲甲' }).outcome, 'success');
});

test('removing, undoing and the owner\'s own text in the file: nothing but the entry changes, and an undo never overwrites a later edit', (t) => {
  const prose = '# 收集器\n\n主人的介绍。\n\n~~~markdown\n## 这不是收集器\n~~~\n\n';
  const w = world(t, { collectors: `${prose}## 飞书\n<!-- id: lark | connector: acc -->\n看需要我处理的消息。\n\n### 细节\n只看最近一周。\n\n## 日历\n<!-- id: cal | connector: acc -->\n看明天的安排。\n` });
  w.connectors.owner.add({ id: 'acc', name: '工具', prompt: '用已有的工具读。' });
  const before = w.read();
  assert.deepEqual((w.collectors.owner.list() as any).collectors.map((item: any) => item.id), ['lark', 'cal']);
  const removed: any = w.collectors.owner.remove('lark');
  assert.equal(removed.outcome, 'success');
  assert.ok(w.read().startsWith(prose) && w.read().endsWith(before.slice(before.indexOf('## 日历'))));
  assert.equal(w.collectors.owner.undo(removed.undo).outcome, 'success');
  assert.equal(w.read(), before);
  const edited: any = w.collectors.owner.update('cal', { prompt: '看后天的安排。' });
  writeFileSync(w.file, `${w.read()}\n主人又写了一行。\n`);
  assert.equal(w.collectors.owner.undo(edited.undo).outcome, 'needs_clarification');
  assert.match(w.read(), /主人又写了一行。/);
  assert.equal(w.collectors.owner.remove('nothing').outcome, 'no_op');
});

// ---------------------------------------------------------------- the split of an old registry

const OLD = [
  '# 连接器', '',
  '连接器是你告诉嘟嘟去哪里、收集什么的 Prompt。每个来源写一个二级标题，下面直接写收集要求。嘟嘟用已有的工具和技能去读，不用另配启动方式或开启开关。', '',
  '格式示例（缩进的部分不会被读取）：', '',
  '    ## 飞书', '    看飞书里需要我处理的消息，记下来源链接、发消息的人和截止日期。', '',
  '## lark', '<!-- id: source-4476e95c3387 | source: owner | every: 15m -->', '',
  '我是 Devops, 收集 lark 中的消息，尤其是与我相关或者是 at 我的。', '用 lark CLI（命令是 lark-cli，我已经登录好了）读，按 lark-im 技能里的办法来。', '',
  '## 告警', '<!-- id: alerts | source: dudu | cron: 0 9-18 * * 1-5 -->', '看告警群。', '',
].join('\n');

function oldFolder(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-split-'));
  writeFileSync(join(dir, 'CONNECTORS.md'), OLD);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('an old entry, which said where, what and how often, becomes a collector with the same id and a connector with the same id', (t) => {
  const dir = oldFolder(t);
  assert.deepEqual(splitLegacySources({ folder: dir }), { migrated: 2 });
  const collectors = parseSources(readFileSync(join(dir, 'COLLECTORS.md'), 'utf8')).entries;
  assert.deepEqual(collectors.map((e: any) => [e.id, e.name, e.connector, e.frequency, e.source]), [
    ['source-4476e95c3387', 'lark', 'source-4476e95c3387', '15m', 'owner'],
    ['alerts', '告警', 'alerts', '0 9-18 * * 1-5', 'dudu'],
  ], 'the collector keeps the id, so its records, runs, issues and session stay its own');
  assert.equal(collectors[0].prompt, '我是 Devops, 收集 lark 中的消息，尤其是与我相关或者是 at 我的。\n用 lark CLI（命令是 lark-cli，我已经登录好了）读，按 lark-im 技能里的办法来。');
  const connectors = parseSources(readFileSync(join(dir, 'CONNECTORS.md'), 'utf8')).entries;
  assert.deepEqual(connectors.map((e: any) => [e.id, e.name, e.kinded, e.kind, e.prompt, e.source]), [
    ['source-4476e95c3387', 'lark', true, 'prompt', '', 'owner'],
    ['alerts', '告警', true, 'prompt', '', 'dudu'],
  ], 'the connector has the same words as a name and nothing to say yet');
  // the file begins with the new explanation, and the old file is kept
  assert.ok(readFileSync(join(dir, 'CONNECTORS.md'), 'utf8').startsWith(TEMPLATES['CONNECTORS.md']));
  assert.equal(readFileSync(join(dir, 'CONNECTORS.before-collectors.md'), 'utf8'), OLD);
  assert.ok(readFileSync(join(dir, 'COLLECTORS.md'), 'utf8').startsWith(TEMPLATES['COLLECTORS.md']));
  // and the registries read it as it is: every collector reads through its connector
  const connectorsRegistry = createConnectors({ file: join(dir, 'CONNECTORS.md') });
  const collectorsRegistry = createCollectors({ file: join(dir, 'COLLECTORS.md'), connectors: () => connectorsRegistry });
  assert.deepEqual((collectorsRegistry.resolve() as any).collectors.map((e: any) => [e.id, e.via?.id]), [['source-4476e95c3387', 'source-4476e95c3387'], ['alerts', 'alerts']]);
});

test('the split runs once: a second look changes nothing, a file already in the new form is untouched, and a run that stopped halfway is finished', (t) => {
  const dir = oldFolder(t);
  splitLegacySources({ folder: dir });
  const files = ['CONNECTORS.md', 'COLLECTORS.md'].map((name) => readFileSync(join(dir, name), 'utf8'));
  assert.deepEqual(splitLegacySources({ folder: dir }), { migrated: 0 });
  assert.deepEqual(['CONNECTORS.md', 'COLLECTORS.md'].map((name) => readFileSync(join(dir, name), 'utf8')), files);

  // COLLECTORS.md written, CONNECTORS.md not yet (the old file is back): the collectors are not added twice
  writeFileSync(join(dir, 'CONNECTORS.md'), OLD);
  assert.deepEqual(splitLegacySources({ folder: dir }), { migrated: 2 });
  assert.equal(readFileSync(join(dir, 'COLLECTORS.md'), 'utf8'), files[1], 'the collectors were already there');
  assert.deepEqual(parseSources(readFileSync(join(dir, 'CONNECTORS.md'), 'utf8')).entries.map((e: any) => e.kinded), [true, true]);

  // a connectors file the owner wrote in the new form is not touched, and neither are the entries of a file with no entries at all
  const fresh = mkdtempSync(join(tmpdir(), 'dudu-split-fresh-'));
  t.after(() => rmSync(fresh, { recursive: true, force: true }));
  writeFileSync(join(fresh, 'CONNECTORS.md'), `${TEMPLATES['CONNECTORS.md']}\n## 飞书\n<!-- id: lark | kind: prompt -->\n用 lark CLI 读。\n`);
  const text = readFileSync(join(fresh, 'CONNECTORS.md'), 'utf8');
  assert.deepEqual(splitLegacySources({ folder: fresh }), { migrated: 0 });
  assert.equal(readFileSync(join(fresh, 'CONNECTORS.md'), 'utf8'), text);
  assert.equal(existsSync(join(fresh, 'COLLECTORS.md')), false);
  assert.deepEqual(splitLegacySources({ folder: join(fresh, 'missing') }), { migrated: 0 });
});

test('a file the owner changed keeps their words: only the entries are replaced, and their own intro stays', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-split-prose-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const text = '# 我的来源\r\n\r\n这是我自己写的说明。\r\n\r\n## 邮件\r\n<!-- id: mail | source: owner | every: 30m -->\r\n读我的收件箱。\r\n\r\n### 细节\r\n只看今天。\r\n';
  writeFileSync(join(dir, 'CONNECTORS.md'), text);
  writeFileSync(join(dir, 'COLLECTORS.md'), TEMPLATES['COLLECTORS.md']);
  assert.deepEqual(splitLegacySources({ folder: dir }), { migrated: 1 });
  const connectors = readFileSync(join(dir, 'CONNECTORS.md'), 'utf8');
  assert.ok(connectors.startsWith('# 我的来源\r\n\r\n这是我自己写的说明。\r\n\r\n## 邮件\r\n<!-- id: mail | source: owner | kind: prompt -->'), 'their intro stays, and so do their line endings');
  const [mail] = parseSources(readFileSync(join(dir, 'COLLECTORS.md'), 'utf8')).entries;
  assert.deepEqual([mail.id, mail.connector, mail.frequency, mail.prompt], ['mail', 'mail', '30m', '读我的收件箱。\n\n### 细节\n只看今天。']);
});

// ---------------------------------------------------------------- the settings page's calls

test('the page asks for the connectors and the collectors through the assistant: who reads through what, MCP servers, and a folder in the old form is split on opening', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-collectors-call-'));
  const home = join(dir, 'dudu', 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'AGENTS.md'), `${TEMPLATES['AGENTS.md']}`);
  writeFileSync(join(home, 'CONNECTORS.md'), OLD);
  const assistant = openAssistant({
    dshHome: dir, stateFolder: join(dir, 'state'), env: { DUDU_ALLOW_TEMP_HOME: '1' },
    connectionDeps: { probe: async () => ({ auth: 'oauth' }), open: async () => { throw Object.assign(new Error('Unauthorized'), { code: 401 }); }, here: async () => [] },
  });
  t.after(async () => { await assistant.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(assistant.folder, home);
  const call = async (name: string, body: object = {}) => (await assistant.handle(name, new Request('http://page.test/', { method: 'POST', body: JSON.stringify(body) }))).json();
  for (const path of ['connectors/catalog', 'connectors/list', 'connectors/connect', 'connectors/authorize', 'connectors/retry', 'connectors/cancel', 'connectors/recognize', 'connectors/add', 'connectors/update', 'connectors/remove', 'connectors/undo', 'collectors/list', 'collectors/add', 'collectors/update', 'collectors/remove', 'collectors/undo']) assert.ok(assistant.paths.includes(path), path);

  // opened, the old folder was split: the collector has the old id, and says which connector it reads through
  const collectors = await call('collectors/list');
  assert.deepEqual(collectors.collectors.map((item: any) => [item.id, item.connector, item.connectorName, item.connectorKind, item.frequency]), [
    ['source-4476e95c3387', 'source-4476e95c3387', 'lark', 'prompt', '15m'],
    ['alerts', 'alerts', '告警', 'prompt', '0 9-18 * * 1-5'],
  ]);
  const connectors = await call('connectors/list');
  assert.deepEqual(connectors.connectors.map((item: any) => [item.id, item.kind, item.usedBy.map((user: any) => user.name)]), [['source-4476e95c3387', 'prompt', ['lark']], ['alerts', 'prompt', ['告警']]]);

  // the connector gets its words; a hosted server is added by its address and waits for the sign-in; the catalog offers what is left
  assert.equal((await call('connectors/update', { id: 'source-4476e95c3387', name: '飞书', text: '用 lark CLI 读，我已经登录好了。' })).outcome, 'success');
  const notion = await call('connectors/add', { text: 'https://mcp.notion.com/mcp', name: 'Notion' });
  assert.deepEqual([notion.outcome, notion.id], ['success', 'notion']);
  assert.equal((await call('connectors/add', { text: '' })).outcome, 'needs_clarification');
  assert.equal((await call('connectors/recognize', { text: 'https://mcp.linear.app/mcp' })).auth, 'oauth');
  const offered = (await call('connectors/catalog')).groups.flatMap((group: any) => group.items.map((item: any) => item.id));
  assert.ok(offered.includes('linear') && !offered.includes('notion'), 'what is connected is not offered again');

  // a collector is added with its connector, changed, and the connector it reads through cannot be removed under it
  const added = await call('collectors/add', { name: 'Notion 评论', connector: notion.id, prompt: '看我被 @ 的评论。', frequency: '1h' });
  assert.equal(added.outcome, 'success');
  assert.equal((await call('collectors/add', { name: '无', connector: 'nothing', prompt: '看。' })).outcome, 'needs_clarification');
  const refused = await call('connectors/remove', { id: notion.id });
  assert.deepEqual([refused.outcome, refused.code, refused.collectors], ['needs_clarification', 'in_use', ['Notion 评论']]);
  assert.equal((await call('collectors/update', { id: added.collector.id, name: 'Notion 评论', connector: notion.id, prompt: '看我被 @ 的评论和指给我的页面。', frequency: '2h' })).outcome, 'success');
  const again = (await call('collectors/list')).collectors.find((item: any) => item.id === added.collector.id);
  assert.deepEqual([again.prompt, again.frequency], ['看我被 @ 的评论和指给我的页面。', '2h']);
  assert.equal(Object.hasOwn(again, 'notes'), false, 'a collector has no notes: what it is told is what the owner wrote');
  assert.equal((await call('collectors/remove', { id: added.collector.id })).outcome, 'success');
  assert.equal((await call('connectors/remove', { id: notion.id })).outcome, 'success', 'once nothing reads through it, it goes');
  assert.equal((await call('collectors/list', {})).collectors.length, 2);
  assert.deepEqual(assistant.connectors && Object.keys(assistant.connectors.owner).sort(), ['add', 'list', 'remove', 'undo', 'update']);
  assert.ok(assistant.collectors);
});
