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
  assert.deepEqual([...NATIVE_SETTINGS_METHODS], ['settings.page', 'settings.act', 'settings.data']);
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
  assert.deepEqual(recognized.recognized, { kind: 'local', name: 'Sample', count: 1 }, 'an app that draws the add page itself builds it from the values');
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

// A phone that declares `settings.rich` (native-client.mjs) is drawn the pages as the owner designed them on 2026-11-21; every other phone is answered as the released apps know it.
const rich = { client: { platform: 'ios', version: '0.1.0', build: '144', capabilities: ['settings.rich'] } };
const rowsOf = (answer: any) => answer.page.sections.flatMap((one: any) => one.rows);

test('a phone that declared settings.rich gets long-press menus and the drawn 状态 page, any other phone the swipes it knows', async () => {
  const { settings, asked } = make();
  const old = rowsOf(await settings.dispatch('settings.page', { section: 'statuses' }));
  assert.ok(old.some((one: any) => one.swipe), 'the released apps swipe');
  assert.ok(!old.some((one: any) => one.menu || one.kind === 'group' || one.status || one.tag), 'and are not given anything they cannot draw');
  assert.deepEqual(old.find((one: any) => one.id === 'in_progress').swipe.map((one: any) => one.title), ['设为默认', '下移', '删除']);

  const page = await settings.dispatch('settings.page', { section: 'statuses' }, rich);
  const rows = rowsOf(page);
  assert.equal(page.page.sections.length, 1, 'one card');
  assert.deepEqual(rows.filter((one: any) => one.kind === 'group').map((one: any) => one.title), ['待规划', '未开始', '已开始', '已完成', '已取消']);
  assert.equal(rows.find((one: any) => one.id === 'group-started').add.to.target, 'add:started');
  const started = rows.find((one: any) => one.id === 'in_progress');
  assert.ok(!started.swipe);
  assert.deepEqual(started.menu.map((one: any) => [one.title, one.enabled ?? true]), [['编辑', true], ['设为默认', true], ['上移', false], ['下移', true], ['删除', true]], 'the first one cannot move up: grey, not missing');
  assert.equal(started.menu[0].to.target, 'edit:in_progress');
  assert.equal(rows.find((one: any) => one.id === 'todo').tag, '· 默认');
  assert.equal(rows.find((one: any) => one.id === 'todo').subtitle, '2 条事项');

  // What a tap on a row of the menu does comes back drawn for the same phone, not in the old shape.
  const after = await settings.dispatch('settings.act', { section: 'statuses', name: 'move', args: { id: 'in_review', direction: -1 } }, rich);
  assert.ok(rowsOf(after).some((one: any) => one.kind === 'group'));

  // The form: a tile, the progress of a started status as icons, the colour as dots; the progress is saved only when the phone sends it.
  const form = (await settings.dispatch('settings.page', { section: 'statuses', target: 'edit:in_progress' }, rich)).page.sections;
  assert.equal(form[0].rows[0].kind, 'statusPreview');
  assert.deepEqual(form.flatMap((one: any) => one.rows).filter((one: any) => one.kind === 'choice').map((one: any) => [one.id, one.style]), [['progress', 'icons'], ['color', 'swatches']]);
  assert.deepEqual(form.flatMap((one: any) => one.rows).find((one: any) => one.id === 'progress').options.map((one: any) => one.id), ['0', '0.25', '0.5', '0.75', '1']);
  assert.ok(!(await settings.dispatch('settings.page', { section: 'statuses', target: 'edit:todo' }, rich)).page.sections.flatMap((one: any) => one.rows).some((one: any) => one.id === 'progress'), 'only a started status has one');
  asked.length = 0;
  await settings.dispatch('settings.act', { section: 'statuses', name: 'save', args: { id: 'in_progress' }, values: { name: '处理中', description: '', color: '#f2c94c', progress: '0.75' } }, rich);
  assert.deepEqual((asked.find(([action]) => action === 'issues/status-update')?.[1] as any).patch, { name: '处理中', description: '', color: '#f2c94c', iconProgress: 0.75 });
  asked.length = 0;
  await settings.dispatch('settings.act', { section: 'statuses', name: 'save', args: { id: 'in_progress' }, values: { name: '处理中', description: '', color: '#f2c94c' } });
  assert.ok(!('iconProgress' in (asked.find(([action]) => action === 'issues/status-update')?.[1] as any).patch), 'a phone that sends no progress changes none');
});

test('the delete of a memory, a collector and a skill is a long press, and on the page of a memory and a collector too', async () => {
  const { settings } = make();
  const titles = async (section: string, id: string, context?: unknown) => {
    const row = rowsOf(await settings.dispatch('settings.page', { section }, context)).find((one: any) => one.id === id);
    return (row.menu ?? row.swipe).map((one: any) => one.title);
  };
  assert.deepEqual(await titles('memory', '7'), ['忘记'], 'swiped by the released apps');
  assert.deepEqual(await titles('memory', '7', rich), ['编辑', '忘记']);
  assert.deepEqual(await titles('collectors', 'k1', rich), ['编辑', '删除']);
  assert.deepEqual(await titles('skills', 'lark-reply', rich), ['删除']);

  const memory = (await settings.dispatch('settings.page', { section: 'memory', target: 'edit:7' })).page.sections;
  const forget = memory.flatMap((one: any) => one.rows).find((one: any) => one.id === 'forget');
  assert.equal(forget.tone, 'bad');
  assert.equal(forget.button.act.name, 'forget');
  assert.match(forget.button.confirm.message, /喜欢短句\n会删除本地记忆/);
  assert.match(memory.find((one: any) => one.footer).footer, /DSH 来源消息和模型历史会保留/);
  assert.ok(rowsOf(await settings.dispatch('settings.page', { section: 'collectors', target: 'edit:k1' })).some((one: any) => one.id === 'remove' && one.tone === 'bad'));
  assert.equal((await settings.dispatch('settings.act', { section: 'memory', target: 'edit:7', name: 'forget', args: { id: 7 } })).back, true, 'from its own page: back to the list');
  assert.equal((await settings.dispatch('settings.act', { section: 'collectors', target: 'edit:k1', name: 'remove', args: { id: 'k1' } })).back, true);
  assert.equal((await settings.dispatch('settings.act', { section: 'memory', name: 'forget', args: { id: 7 } })).back, undefined, 'from the list: the list is read again');
});

test('a connector that waits for the browser says where to go, and its page has a card for each thing to do', async () => {
  const waiting = createNativeSettings({ call: async (action: string) => ({ status: 200, body: action === 'connectors/list'
    ? { outcome: 'success', connectors: [{ id: 'g1', name: 'GitLab', state: { status: 'waiting' }, about: { kind: 'remote', host: 'gitlab.com' } }] } : { outcome: 'success', groups: [] } }) });
  const list = rowsOf(await waiting.dispatch('settings.page', { section: 'connectors' })).find((one: any) => one.id === 'g1');
  assert.deepEqual([list.detail, list.tone], ['请在电脑上授权', 'warn']);
  assert.deepEqual(list.swipe.map((one: any) => one.title), ['取消'], 'the released apps swipe the one thing to do');
  assert.deepEqual((await waiting.dispatch('settings.page', { section: 'connectors' }, rich)).page.sections.flatMap((one: any) => one.rows).find((one: any) => one.id === 'g1').menu.map((one: any) => one.title), ['取消', '断开']);
  const sections = (await waiting.dispatch('settings.page', { section: 'connectors', target: 'connector:g1' })).page.sections;
  assert.deepEqual(sections.map((one: any) => one.rows.map((row: any) => row.id)), [['about'], ['verb'], ['disconnect']]);
  assert.match(sections[0].footer, /授权页面已在电脑的浏览器里打开/);
});

test('a connector that has not connected is listed among the available ones, not among the connected', async () => {
  const settings = createNativeSettings({ call: async (action: string) => ({ status: 200, body: action === 'connectors/list'
    ? { outcome: 'success', connectors: [
      { id: 'n1', name: 'Notion', state: undefined, about: { kind: 'remote', host: 'mcp.notion.com' } },
      { id: 'g1', name: 'GitLab', state: { status: 'error', message: 'timeout' }, about: { kind: 'remote', host: 'gitlab.com' } },
      { id: 's1', name: 'Sentry', state: { status: 'waiting' }, about: { kind: 'remote', host: 'mcp.sentry.dev' } }] }
    : { outcome: 'success', groups: [] } }) });
  const sections = (await settings.dispatch('settings.page', { section: 'connectors' })).page.sections;
  const idsUnder = (header: string) => sections.find((one: any) => one.header === header)?.rows.map((row: any) => row.id);
  assert.deepEqual(idsUnder('已连接'), ['n1']);
  assert.deepEqual(idsUnder('可用'), ['g1', 's1']);
});

test('settings.data hands an app the values of every page: the same page comes out of nothing but them, and nothing a page never reads leaves the plugin', async () => {
  // Answers richer than the others, with fields no page reads (the plugin's own state folder, a secret, a rule file of nobody's page).
  const full: Record<string, any> = {
    ...answers,
    'assistant/state': { ...(answers['assistant/state'] as object), stateFolder: '/Users/x/.dsh/dudu/state', problems: ['p'] },
    'issues/statuses': { outcome: 'success', counts: { todo: 2, in_progress: 1 }, statuses: [
      { id: 'backlog', category: 'backlog', type: 'backlog', color: null, description: '' }, { id: 'todo', name: '待办', category: 'unstarted', type: 'todo', isDefault: true, description: '先做' },
      { id: 'in_progress', category: 'started', type: 'in_progress', color: '#f2c94c', iconProgress: 0.75, description: '' }, { id: 'in_review', category: 'started', type: 'in_review', description: '' },
      { id: 'done', category: 'completed', type: 'done', description: '' }, { id: 'canceled', category: 'canceled', type: 'canceled', description: '' }, { id: 'old', category: 'unstarted', archived: true, description: '' },
    ] },
    'connectors/list': { outcome: 'success', connectors: [
      { id: 'c1', name: 'Lark', icon: 'lark', kind: 'mcp', busy: true, about: { kind: 'remote', host: 'lark.com', tools: 3 }, state: { status: 'waiting', code: 'ABCD' }, usedBy: [{ id: 'k1', name: '飞书' }], env: { API_TOKEN: 'secret-token' } },
      { id: 'c2', name: 'Mine', icon: 'mine', kind: 'prompt', custom: true, text: 'read it with the cli', about: { kind: 'sentence', text: 'read it with the cli' }, state: { status: 'needs-login', command: 'cli', login: 'cli login' } },
      { id: 'c3', name: 'Tool', kind: 'mcp', about: { kind: 'local', command: '/usr/bin/tool', tools: 2 }, state: { status: 'missing', command: 'tool', install: 'brew install tool' } },
    ] },
    'collectors/list': { outcome: 'success', collectors: [{ id: 'k1', name: '飞书', connector: 'c1', prompt: '收消息\n第二行', frequency: '1h', notify: true, connectorName: 'Lark', connectorKind: 'mcp' }] },
    'rules/get': { outcome: 'success', projectFolder: '/Users/x/dudu', rules: { 'TRIAGE.md': '规则一', 'ASSIGN.md': null, 'OTHER.md': 'nobody draws this' } },
    'memory/records': { outcome: 'success', records: [{ id: 7, text: '喜欢短句', file: 'USER.md', since: '2026-11-01', status: 'superseded', embedding: [0.1] }] },
  };
  const over = (source: Record<string, any>) => createNativeSettings({ call: async (action: string) => ({ status: 200, body: source[action] ?? { outcome: 'success' } }) });
  const pages = [
    { section: 'general' }, { section: 'statuses' }, { section: 'statuses', target: 'edit:in_progress' }, { section: 'statuses', target: 'add:started' },
    { section: 'connectors' }, { section: 'connectors', target: 'connector:c1' }, { section: 'connectors', target: 'connector:c2' }, { section: 'connectors', target: 'connector:c3' }, { section: 'connectors', target: 'add' },
    { section: 'collectors' }, { section: 'collectors', target: 'edit:k1' }, { section: 'collectors', target: 'add' },
    { section: 'rules' }, { section: 'rules', target: 'edit:TRIAGE.md' }, { section: 'memory' }, { section: 'memory', target: 'edit:7' },
    { section: 'skills' }, { section: 'skills', target: 'skill:lark-reply' },
  ];
  const all: unknown[] = [];
  for (const params of pages) {
    const whole = await over(full).dispatch('settings.page', params, rich);
    const answer = await over(full).dispatch('settings.data', params);
    assert.equal(answer.outcome, 'success', JSON.stringify(params));
    all.push(answer.data);
    // A plugin that has only these values to read from builds the very page the descriptor is: a page whose field was cut would differ or fail.
    const replayed = createNativeSettings({ call: async (action: string) => (Object.hasOwn(answer.data, action) ? { status: 200, body: answer.data[action] } : { status: 404, body: {} }) });
    assert.deepEqual(await replayed.dispatch('settings.page', params, rich), whole, JSON.stringify(params));
  }
  const leaked = JSON.stringify(all);
  // `usedBy` (the collectors that read through a connector) is read by a connector's page since 2026-11-23 (its 收集器 row): no longer on this list.
  for (const never of ['secret-token', '.dsh/dudu/state', 'OTHER.md', 'connectorName', 'embedding']) assert.equal(leaked.includes(never), false, never);

  // The collectors' run state is a bonus: without it the list is the same page, and `{}` is what the app reads.
  const noRuns = createNativeSettings({ call: async (action: string) => (action === 'dispatch/state' ? { status: 500, body: {} } : { status: 200, body: full[action] ?? { outcome: 'success' } }) });
  assert.deepEqual((await noRuns.dispatch('settings.data', { section: 'collectors' })).data['dispatch/state'], {});
  assert.deepEqual((await over(full).dispatch('settings.data', { section: 'connectors', target: 'add' })).data, {}, 'the add page is made of nothing but what the person types');
  assert.equal((await over(full).dispatch('settings.data', { section: 'pairing' })).outcome, 'needs_clarification');
  const broken = createNativeSettings({ call: async () => ({ status: 500, body: {} }) });
  assert.equal((await broken.dispatch('settings.data', { section: 'general' })).message, '这一页没能加载');
});
