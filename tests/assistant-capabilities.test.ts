import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openAssistant } from '../host/assistant/assistant.mjs';
import { ASSISTANT_REQUESTS } from '../host/assistant/contract.mjs';
import { DASHBOARD_ACTIONS } from '../host/assistant/dashboard/api.mjs';
import { assistantTools } from '../host/assistant/home/tools.mjs';
import { createInboxApi, INBOX_ACTIONS } from '../host/assistant/inbox/api.mjs';
import { normalizeRecords } from '../host/assistant/inbox/records.mjs';
import { createIssuesApi, ISSUE_ACTIONS } from '../host/assistant/issues/api.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssueAttachmentApi } from '../host/assistant/issues/attachments.mjs';
import { createAssistantSessionOperations } from '../host/assistant/home/session-operations.mjs';
import { createNativeQuestions } from '../host/native-questions.mjs';
import { TASK_ACTIONS } from '../host/assistant/tasks/contract.mjs';

function world(t: any, options: any = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-capabilities-'));
  const issues = createIssues({ file: ':memory:' });
  const assistant = openAssistant({
    dshHome: folder, stateFolder: join(folder, 'state'), env: { DUDU_ALLOW_TEMP_HOME: '1' },
    connectionDeps: { here: async () => [] },
  });
  t.after(async () => { await assistant.close(); issues.close(); rmSync(folder, { recursive: true, force: true }); });
  const deliveries: any[] = [];
  let accepted = false;
  const issueApi = createIssuesApi({
    issues, onForward: async (...args: any[]) => { deliveries.push(args); return { outcome: accepted ? 'success' : 'error' }; },
  });
  const inboxApi = createInboxApi({
    issues, forward: (id: number, text: string, origin: any) => issueApi.execute('forward', { id, text, ...origin }),
  });
  const assignment: any = { issuesApi: issueApi, inboxApi };
  const dsh: any = {};
  const tools = assistantTools({ assistant, issues, assignment, dashboard: {}, dsh, ...options });
  const call = async (name: string, args: any, exec?: any) => JSON.parse(await tools.find((tool: any) => tool.name === name).execute(args, exec));
  const execute = (operation: string, args = {}, exec?: any) => call('dudu_execute', { operation, arguments: args }, exec);
  const ingest = (id: string, extra = {}) => issues.inbox.ingest('feed', normalizeRecords([{
    id, title: '发布故障', text: '原始记录', from: 'Alice', url: 'https://source.test/thread', ...extra,
  }]).records).added[0];
  return { folder, issues, assistant, assignment, dsh, deliveries, execute, call, ingest, accept: () => { accepted = true; } };
}

test('all product command contracts are discoverable with schemas, including settings previously withheld from Dudu', async (t) => {
  const { assistant, call, execute, issues } = world(t);
  assert.deepEqual(assistant.paths.sort(), Object.keys(ASSISTANT_REQUESTS).sort(), 'a new settings action must join the shared contract');
  const catalog = await call('dudu_capabilities', {});
  const operations = new Set(catalog.operations.map((entry: any) => entry.operation));
  for (const [prefix, actions] of [
    ['issues', ISSUE_ACTIONS], ['inbox', INBOX_ACTIONS], ['tasks', TASK_ACTIONS], ['dashboard', DASHBOARD_ACTIONS],
    ['', assistant.paths],
  ] as Array<[string, string[]]>) {
    for (const action of actions) {
      const operation = prefix ? `${prefix}/${action}` : action;
      assert.ok(operations.has(operation), operation);
      const found = await call('dudu_capabilities', { operation });
      assert.equal(found.parameters.type, 'object', `${operation} needs an executable schema`);
    }
  }
  for (const operation of ['home/pin', 'home/read', 'inbox/read', 'projects/create', 'providers/save', 'sessions/model', 'sessions/queue',
    'sessions/team', 'sessions/jobs', 'sessions/job-stop', 'sessions/catalog', 'sessions/answer', 'sessions/fork',
    'assistant/conversation-settings', 'issues/attachment-upload', 'phone/revoke']) assert.ok(operations.has(operation), operation);

  const status = await execute('issues/status-add', { fields: { name: '排期', category: 'unstarted' } });
  assert.equal(status.outcome, 'success');
  assert.ok(issues.statuses().statuses.some((item: any) => item.name === '排期'));
  const label = await execute('issues/label-add', { fields: { name: '发布' } });
  assert.equal((await execute('issues/label-update', { id: label.label.id, patch: { name: '发布检查' } })).outcome, 'success');
});

test('Dudu marks only the explicitly named inbox revision read through the interface handler', async (t) => {
  const { execute, ingest, issues } = world(t);
  const record = ingest('read-receipt');
  const full = await execute('inbox/get', { id: record.id });
  assert.equal(issues.inbox.get(record.id).record.unread, true, 'an agent fetching a record is not the owner reading it');
  const answer = await execute('inbox/read', { id: record.id, revision: full.record.revision });
  assert.equal(answer.unreadCount, 0);
  assert.equal(issues.inbox.get(record.id).record.doneAt, null);
  assert.equal(issues.inbox.get(record.id).record.unread, false);
  assert.equal((await execute('inbox/read', { id: record.id, revision: full.record.revision + 1 })).code, 'invalid_request');
});

test('Dudu inbox forwarding uses the UI service, preserves provenance and handles only after accepted delivery', async (t) => {
  const { issues, call, execute, ingest, accept, deliveries } = world(t);
  const record = ingest('source-message-247', { text: '请核对线上故障', context: [{ from: 'Bob', text: '刚刚发布过' }] });
  const issue = issues.add({ title: '排查', agent: 'claude', session: 'dsh:work', project: { name: 'App', path: '/work/app' } }).issue;
  const share = { id: record.ref, issue: issue.id, to: 'session' };
  assert.equal((await call('inbox_share', share)).outcome, 'error');
  assert.equal(issues.inbox.get(record.id).record.issueId, null, 'a rejected send never moves the record');
  assert.equal((await call('inbox_list', {})).items.length, 1);
  accept();
  assert.equal((await execute('inbox/share', share)).outcome, 'success');
  const sent = deliveries.at(-1);
  assert.match(sent[1], new RegExp(record.ref));
  assert.match(sent[1], /source-message-247/);
  assert.match(sent[1], /https:\/\/source\.test\/thread/);
  assert.match(sent[1], /刚刚发布过/);
  const entry = issues.get(issue.id).log.find((item: any) => item.data?.records);
  assert.deepEqual(entry.data.records, [{ id: record.id, ref: record.ref, sourceRef: 'feed:source-message-247', url: record.url }]);
  assert.equal(issues.inbox.get(record.id).record.issueId, issue.id);
  assert.equal((await call('inbox_list', {})).items.length, 0);
  assert.equal((await call('inbox_list', { tab: 'done' })).items[0].id, record.id);
});

test('short connector and collector tools use the same live services as Settings', async (t) => {
  const { assistant, call, execute } = world(t);
  const added = await call('connector_register', { name: '邮件', text: '用已登录的邮件 CLI 读取消息。' });
  assert.equal(added.outcome, 'success');
  let listed = await assistant.execute('connectors/list', {});
  assert.equal(typeof added.id, 'string', 'return the connection service result, not a registry-only entry');
  assert.equal(listed.connectors[0].state, null);
  const id = added.id;
  assert.equal((await call('connector_update', { id, name: '邮件通知' })).outcome, 'success');
  const collector = await call('collector_register', { name: '邮件收集', connector: id, prompt: '收集新邮件', notify: true });
  assert.equal(collector.outcome, 'success');
  assert.equal((await call('collector_update', { id: collector.collector.id, notify: false })).outcome, 'success');
  assert.equal((await assistant.execute('collectors/list', {})).collectors[0].notify, false);
  assert.equal((await call('connector_remove', { id })).outcome, 'needs_clarification', 'a collector retains its connector');
  assert.equal((await execute('connectors/update', { id, env: { TOKEN: 'ignored' } })).code, 'invalid_arguments', 'the catalog must not advertise unsupported update fields');
  assert.equal((await call('collector_remove', { id: collector.collector.id })).outcome, 'success');
  assert.equal((await call('connector_remove', { id })).outcome, 'success');
  listed = await assistant.execute('connectors/list', {});
  assert.deepEqual(listed.connectors, []);
});

test('record edits update search atomically without changing source identity, deduplication, marks or issue association', async (t) => {
  const { issues, execute, call, ingest } = world(t);
  const record = ingest('message');
  await execute('inbox/done', { id: record.id });
  assert.equal((await call('inbox_update', { id: record.ref, patch: { title: '已恢复', text: '服务恢复正常' } })).outcome, 'success');
  const after = issues.inbox.get(record.id).record;
  for (const key of ['id', 'connector', 'sourceId', 'version', 'url', 'issueId']) assert.equal(after[key], record[key], key);
  assert.notEqual(after.doneAt, null);
  assert.equal(issues.inbox.search('恢复正常')[0].id, record.id);
  assert.equal(issues.inbox.search('原始记录').length, 0);
  assert.equal((await execute('inbox/update', { id: record.id, patch: { title: '已恢复' } })).outcome, 'no_op');
  assert.equal((await execute('inbox/update', { id: record.id, patch: { sourceId: 'replacement' } })).code, 'invalid_arguments');
  await execute('inbox/restore', { id: record.id });
  assert.equal((await call('inbox_list', {})).items[0].title, '已恢复');
});

test('the broad operation entry cannot bypass session identity, delete previews, argument validation or scheduled-task isolation', async (t) => {
  const { issues, execute, call, assignment, dsh } = world(t);
  const issue = issues.add({ title: '保留历史', session: 'dsh:original' }).issue;
  assert.equal((await execute('issues/update', { id: issue.id, patch: { session: 'dsh:other' } })).outcome, 'needs_clarification');
  assert.equal(issues.get(issue.id).issue.session, 'dsh:original');
  assert.equal((await execute('issues/delete', { id: issue.id, token: 'invented' })).outcome, 'needs_clarification');
  assert.ok(issues.get(issue.id).issue);
  assert.equal((await execute('issues/status-add', { fields: { name: 'x', category: 'unstarted' }, actor: 'owner' })).code, 'invalid_arguments');
  for (const operation of ['../../settings', 'session/arbitrary-rpc', 'inbox/ignore', 'tools/tasks_create']) assert.equal((await execute(operation)).code, 'unknown_operation');
  let changed = false;
  assignment.tasks = { execute: () => { changed = true; } };
  const task = { agent: { session: { id: 'dudu-assistant-task-example' } } };
  assert.equal((await execute('tasks/delete', { id: 'task', revision: 1 }, task)).code, 'not_allowed_in_task');
  assert.equal(changed, false);
  const catalog = await call('dudu_capabilities', {}, task);
  assert.equal(catalog.operations.some((entry: any) => entry.operation.startsWith('tasks/')), false);

  const permissions: any[] = [];
  dsh.setAccess = (...args: any[]) => { permissions.push(args); };
  assignment.conversationOperations = { 'conversation-settings': (...args: any[]) => { permissions.push(args); return { outcome: 'success' }; } };
  const patch = { patch: { permission: 'danger-full-access' } };
  assert.equal((await execute('assistant/conversation-settings', patch)).code, 'explicit_access_required');
  assert.equal((await execute('sessions/access', { session: 'dsh:unassigned', access: 'danger-full-access', approval: 'yes' })).code, 'explicit_access_required');
  assert.deepEqual(permissions, []);
  const approval = '允许把这个会话的权限设为完全访问';
  const exec = { agent: { session: { snapshotEvents: () => [{ type: 'user/message', seq: 3, data: { source: { kind: 'user' }, content: approval } }] } } };
  assert.equal((await execute('sessions/access', { session: 'dsh:unassigned', access: 'danger-full-access', approval }, exec)).outcome, 'success');
  assert.deepEqual(permissions, [['unassigned', 'danger-full-access']]);
  assert.equal((await execute('assistant/conversation-settings', { ...patch, approval }, exec)).outcome, 'success');
  assert.deepEqual(permissions[1], [patch], 'the approval is checked internally, not sent as a setting');
});

test('issue attachment tools reuse the UI handler, enforce local-file permissions and keep references owned by their issue', async (t) => {
  let permission = 'read-only';
  const { folder, issues, assignment, execute } = world(t, { permissionOf: () => permission });
  const issue = issues.add({ title: 'With attachments' }).issue;
  const other = issues.add({ title: 'Other issue' }).issue;
  const path = join(folder, 'report.txt');
  writeFileSync(path, '真实附件');
  const stored = new Map();
  assignment.issueAttachments = createIssueAttachmentApi({ issues, attachments: () => ({
    async saveFileStream({ data, name }: any) {
      const parts = [];
      for await (const part of data) parts.push(part);
      const body = Buffer.concat(parts);
      const ref = { attachmentId: 'test-file', bytes: body.length, name };
      stored.set(ref.attachmentId, body);
      return ref;
    },
    async *readFileStream(ref: any) { yield stored.get(ref.attachmentId); },
  }) });
  assert.equal((await execute('issues/attachment-upload', { id: issue.id, path })).code, 'local_file_requires_full_access');
  assert.equal(stored.size, 0);
  permission = 'danger-full-access';
  const added = await execute('issues/attachment-upload', { id: issue.id, path });
  assert.equal(added.outcome, 'success', JSON.stringify(added));
  assert.equal((await execute('issues/attachment', { id: issue.id, key: added.item.id })).text, '真实附件');
  assert.equal((await execute('issues/attachment', { id: other.id, key: added.item.id })).outcome, 'error');
  const attachment = { attachmentId: 'attached-image', bytes: 8, name: 'reference.png', mediaType: 'image/png' };
  const exec = { agent: { session: { snapshotEvents: () => [{ type: 'user/message', data: { content: [{ type: 'image', attachment }] } }] } } };
  permission = 'read-only';
  const reused = await execute('issues/attachment-upload', { id: issue.id, name: 'reference.png' }, exec);
  assert.deepEqual(reused.item.attachment, attachment, 'existing conversation attachments require no arbitrary filesystem access');
  assert.equal((await execute('issues/attachment-upload', { id: issue.id, name: 'invented.png' }, exec)).code, 'attachment_not_in_conversation');
  assert.equal(issues.get(issue.id).log.some((item: any) => item.data?.attachments), false, 'staging alone never sends or starts work');
});

test('session controls use the native UI request contracts and validate actual catalogs and questions', async () => {
  const calls: any[] = [];
  const models = { groups: [{ id: 'configured', models: [{ id: 'model', reasoning: { efforts: [{ id: 'high' }] } }] }] };
  const session = createAssistantSessionOperations({
    dsh: { selectModel: async (...args: any[]) => { calls.push(['model', ...args]); } },
    controller: { modelCatalog: async () => models },
    rpc: { async call(path: string, endpoint: string, ...args: any[]) {
      assert.equal(path, '/api');
      calls.push([endpoint, ...args]);
      const value = endpoint === 'agentPresets/list' ? { presets: [{ id: 'standard' }, { id: 'broken', broken: 'missing' }] }
        : endpoint === 'permissionPresets/catalog' ? { options: [{ value: 'read-only' }] }
          : endpoint === 'session/projections' ? { values: { userQuestions: { active: [{ callId: 'q', questions: [{ id: 'a', question: 'Continue?', options: [{ label: 'Yes' }] }] }] } } }
            : endpoint === 'userQuestions/answer' ? true
              : endpoint === 'session/fork' ? { sessionId: 'fork' } : {};
      return { ok: true, value };
    } },
  });
  assert.equal((await session.execute('catalog', {})).presets.length, 1);
  assert.equal((await session.execute('preset', { session: 'dsh:work', preset: 'broken' })).code, 'invalid_preset');
  await session.execute('preset', { session: 'dsh:work', preset: 'standard' });
  assert.deepEqual(calls.at(-1), ['agentPresets/select', 'work', 'standard']);
  assert.equal((await session.execute('model', { session: 'dsh:work', provider: 'configured', model: 'model', reasoningEffort: 'invented' })).code, 'invalid_model');
  await session.execute('model', { session: 'dsh:work', provider: 'configured', model: 'model', reasoningEffort: 'high' });
  assert.equal(calls.at(-1)[0], 'model');
  await session.execute('queue', { session: 'dsh:work', itemId: 'queued', action: 'edit', text: 'next' });
  assert.deepEqual(calls.at(-1), ['session/updateQueue', { sessionId: 'work', itemId: 'queued', action: { kind: 'edit', content: [{ type: 'text', text: 'next' }] } }]);
  await session.execute('pin', { session: 'dsh:work', pinned: true });
  assert.deepEqual(calls.at(-1), ['workspace/pinSession', { sessionId: 'work' }]);
  assert.equal((await session.execute('fork', { session: 'dsh:work', sourceEventSeq: 9 })).sessionId, 'fork');
  const answers = [{ id: 'a', selected: ['Yes'] }];
  assert.equal((await session.execute('answer', { session: 'dsh:work', callId: 'q', answers })).outcome, 'success');
  assert.deepEqual(calls.at(-1), ['userQuestions/answer', 'work', 'q', { answers }]);
  await assert.rejects(session.execute('answer', { session: 'dsh:work', callId: 'stale', answers }), { code: 'STALE_APPROVAL' });
  const count = calls.length;
  assert.equal((await session.execute('queue', { session: 'dsh:dudu-assistant-own', action: 'remove', itemId: 'x' })).code, 'invalid_session');
  assert.equal(calls.length, count);
});

test('explicit Dudu session operations list and answer a blocking harness question even without a phone watching', async () => {
  let invoke;
  const questions = createNativeQuestions({ events: { on(_name, listener) { invoke = listener; return () => {}; } } });
  const lifetime = new AbortController();
  const pending = invoke({
    agent: { session: { id: 'work' } }, signal: lifetime.signal, wait: { callId: 'live' },
    questions: [{ id: 'a', question: 'Continue?', options: [{ label: 'Yes' }] }],
  }, () => new Promise(() => {}));
  const session = createAssistantSessionOperations({
    rpc: { async call(_path, endpoint) { assert.equal(endpoint, 'session/projections'); return { values: {} }; } },
    questionBridge: questions,
  });
  try {
    const listed = await session.execute('questions', { session: 'dsh:work' });
    assert.equal(listed.questions[0].callId, 'live');
    assert.deepEqual((await session.execute('questions', { session: 'dsh:other' })).questions, []);
    const answers = [{ id: 'a', selected: ['Yes'] }];
    assert.equal((await session.execute('answer', { session: 'dsh:work', callId: 'live', answers })).outcome, 'success');
    assert.deepEqual(await pending, { answers });
  } finally { lifetime.abort(); questions.close(); }
});
