import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSettings, NATIVE_SETTINGS_METHODS } from '../host/native-settings.mjs';
import { allowedAction, DUDU_PAGE_SECTIONS } from '../host/phone-pages.mjs';

// 嘟嘟's settings, drawn by the phone: the plugin describes a page and does what the app asks, through the actions the web pages were allowed and no others.

const answers: Record<string, unknown> = {
  'assistant/state': { projectFolder: '/Users/x/dudu', isDefault: true, lastIssueTidy: { at: 1_700_000_000_000, groupId: 'g1' } },
  'assistant/settings': { outcome: 'success', settings: { deepSleep: true, pet: {} } },
  'assistant/conversation-settings': {
    outcome: 'success', model: { provider: 'p', model: 'm1', reasoningEffort: 'max' }, settings: { permission: 'read-only' }, permissions: [{ value: 'read-only', name: '只读' }, { value: 'full', name: '完全' }],
    groups: [{ id: 'p', name: 'P', models: [{ id: 'm1', name: 'M1', reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'max', name: 'Max' }], defaultEffort: 'low' } }, { id: 'm2', name: 'M2' }] }],
  },
  'issues/statuses': { outcome: 'success', counts: { todo: 2 }, statuses: [
    { id: 'backlog', category: 'backlog', type: 'backlog', color: null, description: '' }, { id: 'todo', category: 'unstarted', type: 'todo', isDefault: true, description: '' },
    { id: 'in_progress', category: 'started', type: 'in_progress', description: '' }, { id: 'in_review', category: 'started', type: 'in_review', description: '' },
    { id: 'done', category: 'completed', type: 'done', description: '' }, { id: 'canceled', category: 'canceled', type: 'canceled', description: '' },
  ] },
  'connectors/catalog': { outcome: 'success', groups: [{ id: 'web', items: [{ id: 'notion', name: 'Notion', line: 'notion.so' }] }] },
  'connectors/list': { outcome: 'success', connectors: [{ id: 'c1', name: 'Lark', kind: 'mcp', about: { kind: 'remote', host: 'lark.com', tools: 3 }, state: { status: 'needs-auth' } }] },
  'collectors/list': { outcome: 'success', collectors: [{ id: 'k1', name: '飞书', connector: 'c1', prompt: '收消息\n第二行', frequency: '1h' }] },
  'dispatch/state': { outcome: 'success', collectors: [{ id: 'k1', lastRead: { at: 1_700_000_000_000, ok: true, items: 2 } }] },
  'rules/get': { outcome: 'success', projectFolder: '/Users/x/dudu', rules: { 'TRIAGE.md': '规则一', 'ASSIGN.md': null } },
  'memory/records': { outcome: 'success', records: [{ id: 7, text: '喜欢短句', file: 'USER.md', since: '2026-11-01', status: 'active' }] },
  'memory/reviews': { outcome: 'success', reviews: [{ id: 'r1', at: 1_700_000_000_000, summary: { new: 2 } }] },
  'skills/list': { outcome: 'success', skills: [{ name: 'lark-reply', description: '回复' }] },
  'skills/read': { outcome: 'success', text: '正文' },
};

function make() {
  const asked: Array<[string, unknown]> = [];
  const settings = createNativeSettings({
    call: async (action: string, body: unknown) => {
      asked.push([action, body]);
      assert.ok(allowedAction(action), `${action} is on the list of what the pages may ask`);
      return { status: 200, body: answers[action] ?? { outcome: 'success' } };
    },
  });
  return { settings, asked };
}

test('every section of 嘟嘟\'s settings is a page the phone draws, from the actions the web pages were allowed', async () => {
  assert.deepEqual([...NATIVE_SETTINGS_METHODS], ['settings.page', 'settings.act']);
  const { settings, asked } = make();
  for (const section of DUDU_PAGE_SECTIONS) {
    const answer = await settings.dispatch('settings.page', { section });
    assert.equal(answer.outcome, 'success', section);
    assert.ok(answer.page.title && Array.isArray(answer.page.sections) && answer.page.sections.length > 0, section);
  }
  assert.ok(asked.length > DUDU_PAGE_SECTIONS.length);
  const general = (await settings.dispatch('settings.page', { section: 'general' })).page;
  const rows = general.sections.flatMap((one: any) => one.rows);
  assert.deepEqual(rows.find((one: any) => one.id === 'model').options.map((one: any) => one.title), ['M1', 'M2']);
  assert.equal(rows.find((one: any) => one.id === 'deepSleep').on, true);
});

test('what the person changes goes back as the desktop\'s own action, and the page is read again', async () => {
  const { settings, asked } = make();
  const asleep = await settings.dispatch('settings.act', { section: 'general', name: 'deepSleep', value: 'false' });
  assert.equal(asleep.outcome, 'success');
  assert.deepEqual(asked.find(([action, body]) => action === 'assistant/settings' && (body as any).patch)?.[1], { patch: { deepSleep: false } });
  assert.ok(asleep.page.sections.length, 'the page comes back with the answer');
  await settings.dispatch('settings.act', { section: 'general', name: 'conversation', args: { field: 'model' }, value: JSON.stringify(['p', 'm1']) });
  assert.deepEqual(asked.find(([action, body]) => action === 'assistant/conversation-settings' && (body as any).patch)?.[1],
    { patch: { model: { provider: 'p', model: 'm1', reasoningEffort: 'max' } } }, 'reselecting the saved model keeps its saved effort');
  asked.length = 0;
  await settings.dispatch('settings.act', { section: 'statuses', name: 'move', args: { id: 'in_review', direction: -1 } });
  assert.deepEqual(asked.find(([action]) => action === 'issues/status-order')?.[1], { category: 'started', ids: ['in_review', 'in_progress'] });
  asked.length = 0;
  const saved = await settings.dispatch('settings.act', { section: 'collectors', name: 'save', args: { id: 'k1' }, values: { name: ' 飞书 ', connector: 'c1', frequency: '', common: '6h', prompt: '收消息' } });
  assert.equal(saved.back, true);
  assert.deepEqual(asked.find(([action]) => action === 'collectors/update')?.[1], { id: 'k1', name: '飞书', connector: 'c1', frequency: '6h', prompt: '收消息' });
  const removed = await settings.dispatch('settings.act', { section: 'collectors', name: 'remove', args: { id: 'k1' } });
  assert.match(removed.toast.message, /飞书/);
  const skillRemoval = await settings.dispatch('settings.act', { section: 'skills', name: 'remove', args: { name: 'lark-reply' } });
  assert.equal(skillRemoval.back, false, 'removing from the list must refresh that list instead of popping a page that is not open');
  assert.ok(skillRemoval.page);
});

test('a section, an action or a value that is not on the list is refused, and a failure is said in the desktop\'s own words', async () => {
  const { settings, asked } = make();
  assert.equal((await settings.dispatch('settings.page', { section: 'pairing' })).outcome, 'needs_clarification');
  assert.equal((await settings.dispatch('settings.act', { section: 'general', name: 'nonsense' })).outcome, 'error');
  assert.equal((await settings.dispatch('settings.act', { section: 'rules', name: 'save', args: { name: '../../etc/passwd' }, values: { text: 'x' } })).outcome, 'error');
  assert.equal(asked.some(([action]) => action === 'rules/update'), false);
  const broken = createNativeSettings({ call: async () => ({ status: 500, body: {} }) });
  assert.equal((await broken.dispatch('settings.page', { section: 'general' })).message, '这一页没能加载');
  assert.equal((await broken.dispatch('settings.act', { section: 'general', name: 'deepSleep', value: 'true' })).message, '更改没能保存');
});

test('native connector forms recognize without adding, keep secrets out of descriptors, and preserve an unchanged saved address', async () => {
  const asked: Array<[string, any]> = [];
  const settings = createNativeSettings({
    call: async (action: string, body: any) => {
      assert.ok(allowedAction(action));
      asked.push([action, body]);
      const answer = action === 'connectors/recognize' ? { outcome: 'success', kind: 'local', name: 'Sample', count: 1 }
        : action === 'connectors/list' ? { outcome: 'success', connectors: [{ id: 'custom', name: 'Sample', custom: true, text: 'https://sample.invalid/mcp' }] }
        : answers[action] ?? { outcome: 'success' };
      return { status: 200, body: answer };
    },
  });
  const initial = await settings.dispatch('settings.page', { section: 'connectors', target: 'add' });
  assert.equal(initial.page.preview.act.name, 'recognize');
  const draft = 'node /tmp/example.mjs --private pasted-value';
  const recognized = await settings.dispatch('settings.act', { section: 'connectors', target: 'add', name: 'recognize', values: { text: draft } });
  assert.equal(recognized.outcome, 'success');
  assert.ok(recognized.page.sections.flatMap((section: any) => section.rows).some((row: any) => row.kind === 'environment'));
  assert.equal(JSON.stringify(recognized).includes('pasted-value'), false, 'recognition never echoes pasted credential material in a page');
  assert.equal(asked.some(([action]) => action === 'connectors/add'), false);
  await settings.dispatch('settings.act', {
    section: 'connectors', target: 'add', name: 'add',
    values: { text: draft, name: 'Sample', envName0: 'SAMPLE_TOKEN', envValue0: 'test-secret' },
  });
  assert.deepEqual(asked.find(([action]) => action === 'connectors/add')?.[1], {
    text: draft, name: 'Sample', env: { SAMPLE_TOKEN: 'test-secret' },
  });
  await settings.dispatch('settings.act', {
    section: 'connectors', target: 'connector:custom', name: 'update', args: { id: 'custom' },
    values: { name: 'Renamed', text: 'https://sample.invalid/mcp' },
  });
  assert.deepEqual(asked.find(([action]) => action === 'connectors/update')?.[1], { id: 'custom', name: 'Renamed' },
    'a name-only edit must not replace the redacted address and discard its saved secret');
  // A connector is not disconnected without asking (it has no undo since 2026-11-12), and the answer says so to the page.
  const detail = (await settings.dispatch('settings.page', { section: 'connectors', target: 'connector:custom' })).page;
  const disconnect = detail.sections.flatMap((section: any) => section.rows).find((row: any) => row.id === 'disconnect');
  assert.deepEqual(disconnect.button.confirm, { title: '将要删除', message: 'Sample', button: '删除' });
});
