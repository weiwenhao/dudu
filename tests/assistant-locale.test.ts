import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { connectLocale, getLocale, intlLocale, setLocale, subscribeLocale } from '../host/dudu-plugin/ui/lib/locale.mjs';
import { diagnostic, DICTIONARIES, T } from '../host/dudu-plugin/ui/strings.js';
import { dueInfo } from '../host/dudu-plugin/ui/issues/due.js';
import { actorName, describe, storedSystemText, when } from '../host/dudu-plugin/ui/issues/activity.js';
import { flatten } from '../host/dudu-plugin/ui/issues/flatten.js';
import { localizedWidget } from '../host/dudu-plugin/ui/widgets/localized.js';
import { TEXT as CONNECTOR_TEXT } from '../host/assistant/connectors/text.mjs';

afterEach(() => setLocale('en'));

test('DSH resolved snapshots control the language, update existing namespaces and release their subscription', () => {
  let snapshot = { active: 'zh', revision: 1 };
  let listener: (() => void) | undefined;
  let disposed = false;
  const general = T.settings.general;
  const values: string[] = [];
  const stop = subscribeLocale(() => values.push(getLocale()));
  const disconnect = connectLocale({
    getLocale: () => snapshot,
    subscribe: (next: () => void) => { listener = next; return () => { disposed = true; }; },
  });
  assert.equal(T.brand, '嘟嘟');
  assert.equal(general.folder, '项目文件夹');
  assert.equal(intlLocale(), 'zh-CN');
  snapshot = { active: 'en', revision: 2 };
  listener!();
  assert.equal(general.folder, 'Project folder');
  assert.equal(T.brand, 'Dudu');
  listener!();
  assert.deepEqual(values, ['zh', 'en']);
  disconnect();
  stop();
  assert.equal(disposed, true);
});

test('cached groups and built-in widget metadata change language without changing their identity or content', () => {
  const title = '合同续费';
  const entries = flatten([{ key: 'todo', count: 1, items: [{ id: 1, title }] }], { collapsed: new Set(), group: 'status' });
  const widget = localizedWidget({ id: 'issues', label: 'Issues', description: 'Every issue' });
  assert.equal(entries[0].label, 'Todo');
  assert.equal(T.dashboard.actionResized('Issues', 'fill', 6), '「Issues」resized to full width × 6');
  setLocale('zh-CN');
  assert.equal(entries[0].label, '待办');
  assert.equal(T.dashboard.actionResized('事项', 'fill', 6), '已将「事项」调整为全宽 × 6');
  assert.equal(widget.label, '看板');
  assert.equal(entries[1].issue.title, title);
  assert.equal(actorName('dudu'), '嘟嘟');
  setLocale('en');
  assert.equal(entries[0].label, 'Todo');
  assert.equal(widget.label, 'Issues');
  assert.equal(actorName('dudu'), 'Dudu');
  const thirdParty = { id: 'example.weather', label: 'Weather' };
  assert.equal(localizedWidget(thirdParty), thirdParty);
});

test('relative times and calendar dates follow the selected UI language', () => {
  const now = new Date(2026, 9, 31, 12).getTime();
  const tomorrow = new Date(2026, 10, 1, 12).getTime();
  assert.equal(when(now - 120000, now), '2m ago');
  assert.equal(when(0, now), '—');
  assert.equal(when(undefined, now), '—');
  assert.equal(when(NaN, now), '—');
  assert.equal(dueInfo(tomorrow, now)?.text, 'Nov 1');
  setLocale('zh');
  assert.equal(when(now - 120000, now), '2 分钟前');
  assert.equal(when(null, now), '—');
  assert.equal(dueInfo(tomorrow, now)?.text, '11月1日');
  assert.equal(dueInfo(tomorrow, now)?.hint, '11月1日 · 1 天后');
});

test('known diagnostics and stored session activity follow the language; external content stays verbatim', () => {
  const entry = { kind: 'session', text: 'started a session with Claude' };
  assert.equal(describe(entry).sentence, 'started a session with Claude');
  setLocale('zh');
  assert.equal(describe(entry).sentence, '与 Claude 开始了会话');
  assert.equal(describe({ kind: 'session', text: 'resumed the session' }).sentence, '恢复了会话');
  assert.equal(diagnostic('It has no id.'), '缺少编号。');
  assert.equal(diagnostic('Use a full path.'), '填写完整路径。');
  assert.equal(diagnostic('custom connector output'), 'custom connector output');
  assert.equal(diagnostic('constructor'), 'constructor');
  setLocale('en');
  assert.equal(diagnostic("嘟嘟 can't write to that folder."), "Dudu can't write to that folder.");
});

test('boss is the human identity in both languages and Dudu is capitalized across English controls', () => {
  for (const locale of ['en', 'zh']) {
    setLocale(locale);
    assert.equal(actorName('owner'), 'boss');
    assert.equal(T.source.owner, 'boss');
    assert.equal(T.detail.duduMention, 'Dudu');
    assert.ok(T.connectorDiagnostics.config.ownerOnly('command').includes('boss'));
    assert.ok(T.connectorDiagnostics.runtime.notDudu('mail').includes('boss'));
  }
  setLocale('en');
  assert.equal(T.brand, 'Dudu');
  assert.equal(T.source.dudu, 'Dudu');
  assert.equal(T.pet.conversation, 'Dudu');
  assert.equal(T.dashboard.menu, 'Dudu menu');
  assert.equal(T.settings.title, 'Dudu settings');
});

test('fixed stored dudu questions and dispatch prefixes follow the UI language without translating owner content', () => {
  const question = { actor: 'dudu', kind: 'blocked', text: '出错了：ECONNRESET。怎么办？' };
  assert.equal(storedSystemText(question), 'Something went wrong: ECONNRESET. What should we do?');
  assert.equal(storedSystemText({ ...question, actor: 'owner' }), question.text);
  assert.equal(storedSystemText({ ...question, text: '需要你确认具体范围。' }), '需要你确认具体范围。');
  setLocale('zh');
  assert.equal(storedSystemText(question), question.text);
  assert.equal(describe({ actor: 'dudu', kind: 'note', text: 'No agent chosen: 项目不明' }).comment, '还没分配智能体：项目不明');
  assert.equal(describe({ actor: 'dudu', kind: 'assign', text: '按规则 · access: read-only' }).detail, '按规则 · 访问模式: read-only');
});

test('connector validation follows the locale, including field values, nested allow errors and JSON locations', () => {
  for (const group of ['skipped', 'config', 'template'] as const) {
    for (const [key, value] of Object.entries(CONNECTOR_TEXT[group])) {
      const args = typeof value === 'function' ? Array.from({ length: value.length }, (_, index) => `field_${index}`) : [];
      const english = typeof value === 'function' ? value(...args) : value;
      assert.equal(diagnostic(english), english, `${group}.${key} in English`);
      setLocale('zh');
      const translated = DICTIONARIES.zh.connectorDiagnostics[group][key];
      assert.equal(diagnostic(english), typeof translated === 'function' ? translated(...args) : translated, `${group}.${key} in Chinese`);
      setLocale('en');
    }
  }
  setLocale('zh');
  assert.equal(diagnostic('allow[2] readOnly must be true or false.'), 'allow[2]：readOnly 须为 true 或 false。');
  assert.equal(diagnostic('The json block is not valid JSON (line 3, column 8).'), 'json 代码块格式无效（第 3 行，第 8 列）。');
  assert.equal(diagnostic('The json block is not valid JSON (at position 12).'), 'json 代码块格式无效（位置 12）。');
  assert.equal(diagnostic('Unknown field "自定义.name".'), '未知字段“自定义.name”。');
  assert.equal(diagnostic('The entry "mail" on line 15 cannot be used: transport must be stdio or http.'), '第 15 行的条目“mail”无法使用：transport 须为 stdio 或 http。');
  assert.equal(diagnostic('The program "lark-cli" was not found; check that it is installed and on PATH.'), '找不到程序“lark-cli”，请检查是否已安装并在 PATH 中。');
  assert.equal(diagnostic('Could not connect: ECONNREFUSED'), '无法连接：ECONNREFUSED');
  assert.equal(diagnostic('An external program said something else.'), 'An external program said something else.');
});

test('every built-in fixed label has an explicit Chinese translation', () => {
  const missing: string[] = [];
  function compare(en: Record<string, any>, zh: Record<string, any>, prefix = '') {
    for (const key of Object.keys(en)) {
      const path = `${prefix}${key}`;
      if (!Object.hasOwn(zh, key)) missing.push(path);
      else if (en[key] && typeof en[key] === 'object') compare(en[key], zh[key], `${path}.`);
    }
  }
  compare(DICTIONARIES.en, DICTIONARIES.zh);
  // Names and notation are shared; define them explicitly rather than silently falling back to English.
  assert.deepEqual(missing, []);
});
