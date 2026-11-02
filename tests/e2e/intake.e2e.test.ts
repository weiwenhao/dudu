// Real scheduled intake, DSH's MCP bridge, assistant tools, tidy and forgetting, in one isolated DSH.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, test } from 'node:test';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
const connectorProgram = fileURLToPath(new URL('./inbox-connector.mjs', import.meta.url));
before(async () => {
  dudu = await startDudu({
    patch: [
      '- insert:', '    - id: e2e-inbox', '      name: "@deepseek-ai/dsh-mcp-client"', '      config:', '        transport: stdio',
      '        serverName: intake', `        command: ${JSON.stringify(process.execPath)}`,
      `        args: [${JSON.stringify(connectorProgram)}]`, '        failOnStartupError: true',
    ].join('\n'),
    model: { replies: [
      { when: (context: any) => context.system.includes('You collect information for dudu'),
        calls: [{ name: 'mcp__intake__list', arguments: {} }],
        then: (results: string[]) => JSON.stringify({ ok: true, content: results.at(-1) ?? '' }) },
      { when: (context: any) => context.system.includes('You are dudu, managing an issue'), say: '{"status":"in_review","summary":"第三条的修改建议已列出。","ask":"确认完成吗？"}' },
      {
        when: (context: any) => context.system.includes('You are the intake step'),
        say: JSON.stringify({ items: [
          { ref: 'mail-1', action: 'new', title: '核对供应商合同', brief: '核对第三条，给出修改建议。', kind: '合同回复', impact: 2, effort: 's', reason: '有明确的修改请求。' },
          { ref: 'mail-2', action: 'new', title: '决定下月是否合作', brief: '决定是否继续合作。', kind: '合作决定', impact: 2, effort: 'm', reason: '需要主人决定。' },
        ] }),
      },
      {
        when: (context: any) => context.system.includes('You are the assignment step') && context.prompt.includes('合同回复'),
        say: '{"agent":"deepseek","access":"read-only","reason":"按合同规则处理。"}',
      },
      { when: (context: any) => context.system.includes('You are the assignment step'), say: '{"agent":null,"access":"read-only","reason":"需要主人决定。"}' },
      { when: 'CHAT-DSH-READ', calls: [{ name: 'mcp__intake__list', arguments: {} }], then: () => '收件箱已读。' },
      { when: (context: any) => context.tools.length === 0, say: '{"changes":[]}' },
      { say: '第三条的修改建议已列出。' },
    ] },
  });
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

async function until<T>(read: () => Promise<T>, check: (value: T) => boolean, timeout = 15_000) {
  const end = Date.now() + timeout;
  let value = await read();
  while (!check(value)) {
    if (Date.now() > end) assert.fail(`Did not reach the expected state: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

test('a saved source prompt is collected through installed DSH tools, then triaged and assigned in its project', { timeout: 150_000 }, async () => {
  const folder = (await dudu.api('assistant/state')).projectFolder;
  await writeFile(join(folder, 'CONNECTORS.md'), `# 连接器

## 测试来信
<!-- id: mail | source: owner -->
使用 intake 收件箱读取需要我处理的来信，保留原始编号和内容。
`);
  await writeFile(join(folder, 'ASSIGN.md'), `# 分配
合同回复 → DeepSeek，在 "${dudu.folder}" 里，只读。其他留给主人。
`);
  const listed = await dudu.api('connectors/list');
  assert.equal(listed.connectors.length, 1);
  assert.equal(Object.hasOwn(listed.connectors[0], 'enabled'), false);
  assert.equal((await dudu.api('dispatch/state')).createdToday, 0);
  const page = await dudu.openPanel();
  const state = await until(() => dudu.api('dispatch/state'), (value: any) => value.createdToday === 2, 90_000);
  const incoming = state.connectors.find((connector: any) => connector.id === 'mail');
  assert.equal(incoming.lastRead.ok, true, dudu.diagnostics());
  assert.equal(incoming.readToday, 2);
  const issues = await until(() => dudu.api('issues/list', { tab: 'active' }), (value: any) => value.items.some((issue: any) => issue.status === 'in_review'), 50_000);
  const assigned = issues.items.find((issue: any) => issue.title === '核对供应商合同');
  const owner = issues.items.find((issue: any) => issue.title === '决定下月是否合作');
  assert.equal(assigned.agent, 'deepseek');
  assert.equal(assigned.project.path, dudu.folder);
  assert.match(assigned.session, /^dsh:/);
  assert.equal(assigned.ask, '确认完成吗？');
  assert.equal(assigned.sourceRef, 'mail:mail-1');
  assert.equal(owner.status, 'todo');
  assert.equal(owner.agent, null);
  assert.equal(owner.ask, '交给谁处理？');
  await page.reload();
  const list = page.getByRole('region', { name: 'Issues', exact: true });
  await list.getByRole('button', { name: '核对供应商合同', exact: true }).waitFor();
  await list.getByRole('button', { name: '决定下月是否合作', exact: true }).waitFor();
  const request = dudu.model.requests.find((request: any) => request.system.includes('You are the intake step'));
  assert.match(request.prompt, /mail-1/);
  assert.equal(request.tools.length, 0);
  const collection = dudu.model.requests.find((request: any) => request.system.includes('You collect information for dudu'));
  assert.ok(collection.tools.includes('mcp__intake__list'));
  await page.close();
});

test('installed DSH tools stay available independently of deleting a saved source prompt', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  const send = async (text: string) => {
    await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await dialog.getByText('收件箱已读。', { exact: true }).last().waitFor();
  };
  await send('CHAT-DSH-READ 读取收件箱');
  const read = dudu.model.requests.find((request: any) => request.prompt.startsWith('CHAT-DSH-READ') && request.toolResults.length > 0);
  assert.ok(read.toolResults.some((value: string) => value.includes('mail-1')));
  assert.ok(!read.tools.includes('connector_inbox_list'));
  assert.equal((await dudu.api('connectors/remove', { id: 'mail' })).outcome, 'success');
  assert.equal((await dudu.api('connectors/list')).connectors.length, 0);
  await send('CHAT-DSH-READ 再读一次');
  await until(async () => dudu.model.requests.filter((request: any) => request.prompt === 'CHAT-DSH-READ 再读一次' && request.toolResults.length > 0), (requests: any) => requests.length > 0);
  await page.close();
});

test('tidy needs its preview token, preserves owner priority, and its changes can be undone on the issue page', async () => {
  const issue = (await dudu.api('issues/add', { fields: { title: '整理验收', brief: '原摘要', priority: 'high' } })).issue;
  const original = dudu.model.replies;
  dudu.model.replies = [{
    when: (context: any) => context.system.includes('Review these open issues'),
    say: JSON.stringify({ changes: [{ id: issue.id, patch: { brief: '整理后的摘要', priority: 'low' }, reason: '补全摘要。' }] }),
  }, ...original];
  try {
    const plan = await dudu.api('issues/tidy');
    assert.equal(plan.preview, true, JSON.stringify(plan));
    assert.equal((await dudu.api('issues/get', { id: issue.id })).issue.brief, '原摘要');
    const applied = await dudu.api('issues/tidy', { token: plan.token });
    assert.equal(applied.outcome, 'success');
    assert.deepEqual(applied.changed, [issue.id]);
    const changed = (await dudu.api('issues/get', { id: issue.id })).issue;
    assert.equal(changed.brief, '整理后的摘要');
    assert.equal(changed.priority, 'high');
    const page = await dudu.openPanel();
    await page.getByRole('region', { name: 'Issues', exact: true }).getByRole('button', { name: '整理验收', exact: true }).click();
    await page.locator('.dudu').getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Undo tidy', exact: true }).click();
    await until(() => dudu.api('issues/get', { id: issue.id }), (value: any) => value.issue.brief === '原摘要');
    assert.equal((await dudu.api('assistant/state')).lastIssueTidy.groupId, null);
    await page.close();
  } finally { dudu.model.replies = original; }
});

test('forgetting an issue previews its scope, Cancel keeps it, and Delete removes local records and search results', async () => {
  const issue = (await dudu.api('issues/add', { fields: { title: '忘记验收', brief: '仅供忘记检查的摘要' } })).issue;
  const page = await dudu.openPanel();
  await page.getByRole('region', { name: 'Issues', exact: true }).getByRole('button', { name: '忘记验收', exact: true }).click();
  const preview = async () => {
    await page.locator('.dudu').getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Forget', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'This will be deleted', exact: true });
    await dialog.getByText('This issue, its activity and local links will be deleted. Source messages and session history stay.', { exact: true }).waitFor();
    return dialog;
  };
  await (await preview()).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await dudu.api('issues/get', { id: issue.id })).outcome, 'success');
  await (await preview()).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('region', { name: 'Dashboard', exact: true }).waitFor();
  assert.equal((await dudu.api('issues/search', { q: '忘记验收' })).total, 0);
  assert.equal((await dudu.api('issues/get', { id: issue.id })).outcome, 'error');
  const exported = JSON.stringify(await dudu.api('issues/export'));
  assert.ok(!exported.includes('忘记验收') && !exported.includes('仅供忘记检查的摘要'));
  await page.close();
});
