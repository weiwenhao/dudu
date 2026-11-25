// The answers a released phone app decodes, built from a plugin checkout, and the shape of each: every path and type that is in it.
//
// `sampleResponses(root)` builds each answer with the plugin under `root/host`, over small fixed fixtures, so the same cases can be run against the plugin of a released
// app (`scripts/record-app-contract.mjs <old checkout>` writes its shapes into tests/fixtures/app-contract-*-shapes.json) and against the plugin of today
// (tests/native-app-contract.test.ts): whatever the old plugin answered, the new one must still answer, as a superset. Values do not matter, only which keys are there and of what type.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const NOW = new Date(2026, 10, 7, 12).getTime();
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

/** Every `path:type` in a value; the items of an array share one path. */
export function shapeOf(value, path = '', out = new Set()) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (path) out.add(`${path}:${type}`);
  if (Array.isArray(value)) for (const item of value) shapeOf(item, `${path}[]`, out);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) shapeOf(item, path ? `${path}.${key}` : key, out);
  return out;
}

export async function sampleResponses(root) {
  const load = (file) => import(pathToFileURL(join(root, file)).href);
  const [{ createIssues }, { createIssuesApi }, { createInboxApi }, { normalizeRecords }, { createNativeBoard }, { createChatHome }, { createNavigationStore }, { createNativeSettings }] = await Promise.all([
    load('host/assistant/issues/index.mjs'), load('host/assistant/issues/api.mjs'), load('host/assistant/inbox/api.mjs'), load('host/assistant/inbox/records.mjs'),
    load('host/native-board.mjs'), load('host/assistant/home/chat-home.mjs'), load('host/native-navigation.mjs'), load('host/native-settings.mjs'),
  ]);
  const issues = createIssues({ file: ':memory:', now: () => NOW, sessionState: () => 'idle' });
  try {
    const api = createIssuesApi({ issues });
    const ask = (action, body) => api.execute(action, body);
    const collectors = () => ({ resolve: () => ({ outcome: 'success', collectors: [{ id: 'lark', name: '飞书', via: { id: 'lark-cli', via: 'lark' } }] }) });
    const inbox = createInboxApi({ issues, collectors, now: () => NOW, forward: async () => ({ outcome: 'success' }), fill: async () => ({ outcome: 'success', added: 0 }) });
    const home = createChatHome({
      file: ':memory:', issues: ask, assistant: () => ({ sessionId: 'assistant-session' }),
      activity: () => ({ sessionState: 'unread', unread: true, deepSleep: false, attention: { messageAt: NOW - 1000, preview: 'a reply', seq: 3 } }),
      warm: async () => {}, markUnread: async () => {}, acknowledge: async () => {}, now: () => NOW,
    });
    const board = createNativeBoard({
      issues: ask, inbox: (action, body) => inbox.execute(action, body),
      home: { list: (...args) => home.list(...args), pin: (...args) => home.pin(...args), read: (...args) => home.read(...args) }, fail,
    });
    const project = { name: 'Dudu', path: '/project/dudu' };
    const assigned = issues.add({ title: 'Assigned', brief: 'A description', project, agent: 'claude', session: 'dsh:one' }).issue;
    issues.add({ title: 'Waiting', project });
    issues.inbox.ingest('lark', normalizeRecords([{ id: 'r1', title: 'A record', text: 'Its text', from: 'Alice', url: 'https://mail.test/r1' }]).records);
    const record = (await board.dispatch('inbox.list', { tab: 'todo' })).items[0];

    const store = await createNavigationStore({ now: () => NOW });
    await store.ingest({ schemaVersion: 1, sidebar: [{ id: 'insight', title: '上下文洞察', order: 20 }, { id: 'fleet', title: '编队', order: 30 }], views: [], settings: [{ id: 'models', title: '模型', order: 10 }] });

    const data = {
      'issues/statuses': { outcome: 'success', counts: { todo: 2 }, statuses: [
        { id: 'backlog', type: 'backlog', category: 'backlog', name: null, color: '#95a2b3', description: '', isDefault: false, archived: false, position: 0 },
        { id: 'todo', type: 'todo', category: 'unstarted', name: null, color: '#a0a5ad', description: '', isDefault: true, archived: false, position: 1 },
        { id: 'in_progress', type: 'in_progress', category: 'started', name: null, color: '#f2c94c', description: 'Doing', isDefault: false, archived: false, position: 2, iconProgress: 0.5 },
        { id: 'done', type: 'done', category: 'completed', name: null, color: '#5e6ad2', description: '', isDefault: false, archived: false, position: 3 },
        { id: 'canceled', type: 'canceled', category: 'canceled', name: null, color: '#95a2b3', description: '', isDefault: false, archived: false, position: 4 },
      ] },
      'memory/records': { records: [{ id: 1, text: 'A thing remembered', file: 'MEMORY', since: '2026-11-09', status: 'active' }] },
      'memory/reviews': { reviews: [{ id: 1, at: NOW - 60_000, summary: { new: 1 } }] },
      'rules/get': { rules: { 'TRIAGE.md': 'Rules about impact', 'ASSIGN.md': null }, projectFolder: '/project/dudu' },
      'assistant/state': { projectFolder: '/project/dudu', isDefault: true, lastIssueTidy: { at: NOW - 3_600_000 } },
      'assistant/conversation-settings': { groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'v4', name: 'DeepSeek V4', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }] }],
        model: { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' }, permissions: [{ value: 'full', name: 'Full access' }], settings: { permission: 'full' } },
      'assistant/settings': { settings: { deepSleep: true } },
      // The connectors page (added 2026-11-23, before the page's redesign): one of each kind and state an app draws.
      'connectors/catalog': { outcome: 'success', groups: [
        { id: 'here', items: [{ id: 'found-pencil', name: 'pencil', line: 'mcp-server-darwin-arm64', icon: 'pencil', how: 'local' }] },
        { id: 'dev', items: [{ id: 'gitlab', name: 'GitLab', line: '仓库、议题和合并请求', icon: 'gitlab', how: 'oauth' }] },
      ] },
      'connectors/list': { outcome: 'success', connectors: [
        { id: 'notion', name: 'Notion', icon: 'notion', kind: 'mcp', custom: false, busy: false, tools: 77, state: null, about: { kind: 'remote', host: 'mcp.notion.com', tools: 77 } },
        { id: 'github', name: 'GitHub', icon: 'github', kind: 'mcp', custom: false, busy: true, state: { status: 'waiting', code: 'ABCD-1234' }, about: { kind: 'remote', host: 'api.githubcopilot.com' } },
        { id: 'lark', name: '飞书', icon: 'lark', kind: 'prompt', custom: false, busy: false, state: { status: 'needs-login', command: 'lark-cli', login: 'lark-cli auth login', install: 'npm install -g @larksuite/cli' }, about: { kind: 'cli', command: 'lark-cli' } },
        { id: 'sentry', name: 'Sentry', icon: 'sentry', kind: 'mcp', custom: false, busy: false, state: { status: 'error', message: 'timeout' }, about: { kind: 'remote', host: 'mcp.sentry.dev' } },
        { id: 'qq', name: 'QQ 邮箱', icon: null, kind: 'prompt', custom: true, busy: false, text: '用 himalaya 命令行读邮件', state: null, about: { kind: 'sentence', text: '用 himalaya 命令行读邮件' } },
      ] },
    };
    const settings = createNativeSettings({ call: async (action) => ({ status: 200, body: data[action] ?? { outcome: 'success' } }) });
    const page = async (section, target) => (await settings.dispatch('settings.page', { section, ...(target ? { target } : {}) })).page;

    return {
      'board.list (the chat list)': await board.dispatch('board.list', { layout: 'chat', tab: 'all', filterData: true }),
      'issue.get': await board.dispatch('issue.get', { id: assigned.id }),
      'inbox.list': await board.dispatch('inbox.list', { tab: 'todo' }),
      'inbox.get': await board.dispatch('inbox.get', { id: record.id }),
      'navigation.get': store.get(),
      'settings.page (general)': await page('general'),
      'settings.page (statuses)': await page('statuses'),
      'settings.page (status form)': await page('statuses', 'edit:todo'),
      'settings.page (memory)': await page('memory'),
      'settings.page (rules)': await page('rules'),
      'settings.page (connectors)': await page('connectors'),
      'settings.page (connector)': await page('connectors', 'connector:notion'),
      'settings.data (connectors)': await settings.dispatch('settings.data', { section: 'connectors' }).catch(() => null),
      'settings.data (connector)': await settings.dispatch('settings.data', { section: 'connectors', target: 'connector:notion' }).catch(() => null),
    };
  } finally { issues.close(); }
}
