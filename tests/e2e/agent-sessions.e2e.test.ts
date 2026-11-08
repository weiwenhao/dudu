// An issue given to an agent, in the real thing: the packaged plugin in `dsh web`, DSH's own loop and sessions, Chrome. Run: npm run test:e2e
//
// The model is the one thing that is not real: a scripted OpenAI-compatible server on a local port (mock-model.mjs), which DSH is told
// to use as its default model. It answers by what the last message says: SLOWME takes a few seconds (so that a turn is seen to
// work), ASKME calls DSH's question tool, FAILME fails with a 400. Everything else is the thing itself: the session DSH makes, its
// sidebar entry, the events its loop sends, the question tool and its answer, and the page.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startDudu, openIssuePage } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
let project: { name: string; path: string };
before(async () => {
  dudu = await startDudu({
    model: {
      replies: [
        { when: 'PARTIALME', say: '只完成一半，还没有检查剩下的文件。' },
        { when: 'WORKFLOW-RESUME', say: '本轮工作结束。', delay: 12_000 },
        { when: 'FINISHME', say: '剩下的文件已处理，检查通过。', delay: 4000 },
        { when: 'SLOWME', say: '第 3 条建议接受。', delay: 4000 },
        { when: 'ASKME', ask: { question: 'Accept clause 3 or reject it?', options: ['Accept', 'Reject'] } },
        { when: 'FAILME', fail: { status: 400, message: 'bad request from the mock' } },
        { when: '再试一次', say: '好了，这次做完了。' },
      ],
    },
  });
  const path = await realpath(dudu.folder);
  project = { name: 'Contract checks', path };
  assert.equal((await dudu.api('projects/create', project)).outcome, 'success');
});
after(async () => {
  try {
    if (dudu) assert.equal(dudu.model.requests.some((request: any) => request.system.includes('You are dudu, managing an issue')), false, 'worker activity never requests an automatic progress summary');
  } finally { await dudu?.stop(); }
});
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

type Issue = { id: number; ref: string | null; title: string; status: string; ask: string; agent: string | null; session: string | null; agentState: string; sessions?: { key: string; state: string }[] };
const toast = (page: Page, text: string) => page.getByText(text, { exact: true }).first();
const add = async (fields: Record<string, unknown>) => (await dudu.api('issues/add', { fields: { project, ...fields } })).issue as Issue;
const get = async (id: number) => (await dudu.api('issues/get', { id })).issue as Issue;
const logOf = async (id: number) => (await dudu.api('issues/get', { id, logLimit: 200 })).log as Array<{ kind: string; actor: string; text: string }>;

/** Waits until the issue is as the test says; the sessions work on their own time. */
async function until(id: number, what: string, check: (issue: Issue) => boolean | Promise<boolean>, timeout = 45_000) {
  const started = Date.now();
  let issue = await get(id);
  while (!await check(issue)) {
    if (Date.now() - started > timeout) assert.fail(`Issue ${id} did not ${what} in ${timeout} ms; it is ${JSON.stringify(issue)}`);
    await new Promise((done) => setTimeout(done, 250));
    issue = await get(id);
  }
  return issue;
}
// A finished run is Blocked (the boss's turn), as a question or a failure is: what says that it finished is the session's own state.
const turnDone = (issue: Issue) => Boolean(issue.session) && issue.agentState === 'blocked' && issue.ask === '' && Boolean(issue.sessions?.some((one) => one.key === issue.session && one.state === 'finished'));

// The right-click menu of a row is the way to the issue's page (the row and its title open its conversation).
const openIssue = (page: Page, title: string) => openIssuePage(page.getByRole('region', { name: 'Issues' }).getByRole('listitem').filter({ hasText: title }));
const sidebarOf = (page: Page) => page.getByRole('tree', { name: 'Sessions' });
/** DSH's sidebar keeps a workspace folded until it is opened (and remembers it, so a folder may be open already); the session of an issue is in the folder it works in. */
async function sidebarRow(page: Page, id: number, title: string) {
  const folder = sidebarOf(page).getByRole('treeitem', { name: /Contract checks/ }).first();
  await folder.waitFor();
  if ((await folder.getAttribute('aria-expanded')) === 'false') await folder.click();
  const issue = await get(id);
  return sidebarOf(page).getByText(`${issue.ref} ${title}`, { exact: true });
}
/** The first message of a session as the model saw it (the requests with tools are the agent's own; the others are DSH's titles). */
async function firstMessageOf(id: number) {
  const issue = await get(id);
  for (let waited = 0; waited < 20_000; waited += 250) {
    const found = dudu.model.requests.find((request: { tools: string[]; prompt: string }) => request.tools.length > 0 && request.prompt.startsWith(issue.title));
    if (found) return found.prompt as string;
    await new Promise((done) => setTimeout(done, 250));
  }
  return '';
}

test('an issue given to DeepSeek keeps its workflow status without generated progress after stops or dashboard visits', async () => {
  const issue = await add({ title: '回复供应商合同的修改意见', brief: 'SLOWME：只回答一句话，不要用任何工具。', priority: 'high', project: null });
  const page = await dudu.openPanel();
  await openIssue(page, '回复供应商合同的修改意见');
  const composer = page.getByRole('textbox', { name: 'Leave a comment…' });
  await composer.fill('@');
  await page.getByRole('option', { name: '@Dudu', exact: true }).waitFor();
  assert.equal(await page.getByRole('listbox', { name: 'Mention', exact: true }).getByRole('option').count(), 1);
  await composer.fill('');

  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'No agent' }).click();
  assert.equal(await page.getByRole('option', { name: 'DeepSeek', exact: true }).count(), 0, 'agents follow project selection');
  await page.getByRole('option', { name: /Contract checks/ }).click();
  await page.getByRole('option', { name: 'DeepSeek' }).click();
  await toast(page, 'Assigned to DeepSeek').waitFor();
  await composer.fill('@');
  await page.getByRole('option', { name: '@DeepSeek', exact: true }).waitFor();
  await page.getByRole('option', { name: '@Dudu', exact: true }).waitFor();
  assert.equal(await page.getByRole('listbox', { name: 'Mention', exact: true }).getByRole('option').count(), 2);
  await composer.fill('');

  // The turn is on: the workflow stays Todo while the Agent state and its Working mark follow the session.
  await page.getByTitle('DeepSeek · Working').first().waitFor({ timeout: 20_000 });
  const spinner = page.getByTitle('DeepSeek · Working').first().locator('[data-agent-activity="working"]');
  assert.equal(await spinner.evaluate((node) => getComputedStyle(node).animationName), 'spin');
  const working = await get(issue.id);
  assert.equal(working.status, 'todo');
  assert.equal(working.agentState, 'working');
  assert.match(working.session ?? '', /^dsh:session-/);
  const message = await firstMessageOf(issue.id);
  assert.equal(message, '回复供应商合同的修改意见\n\nSLOWME：只回答一句话，不要用任何工具。');
  const request = dudu.model.requests.find((request: any) => request.prompt === message && request.tools.length);
  assert.ok(request && !request.tools.some((name: string) => name.startsWith('issues_')), 'the worker gets no issue management tools');

  // The session is in DSH's sidebar, named for the issue, in the folder it works in.
  await (await sidebarRow(page, issue.id, '回复供应商合同的修改意见')).waitFor();

  // Stopping changes Agent state only, without a generated activity comment.
  const done = await until(issue.id, 'finish without moving Todo', turnDone);
  assert.equal(done.status, 'todo');
  assert.equal(done.agentState, 'blocked');
  assert.equal((await get(issue.id)).ask, '', 'no confirmation question is invented');
  const log = await logOf(issue.id);
  assert.equal(log.some((entry) => entry.kind === 'progress'), false);
  assert.equal(await page.locator('[data-issue-discussion]').getByText('第 3 条建议接受。', { exact: true }).count(), 0);
  assert.ok(log.some((entry) => entry.kind === 'session' && entry.actor === 'dudu' && entry.text === 'started a session with DeepSeek'));

  const progressRequests = () => dudu.model.requests.filter((request: any) => request.system.includes('You are dudu, managing an issue')).length;
  const tidies = () => dudu.model.requests.filter((request: any) => request.system.includes('Review these open issues')).length;
  assert.equal(progressRequests(), 0, 'a real stop no longer calls a summary model');
  assert.equal(tidies(), 0, 'dashboard visits and worker events do not automatically tidy issues');
  const before = await dudu.api('issues/events', { issueId: issue.id });
  assert.equal((await dudu.api('issues/tidy', { trigger: 'dashboard' })).outcome, 'success', 'legacy dashboard requests are harmless');
  await page.reload();
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'Todo', exact: true }).waitFor();
  assert.equal((await logOf(issue.id)).some((entry) => entry.kind === 'progress'), false);
  assert.equal(progressRequests(), 0);
  assert.equal(tidies(), 0);
  assert.deepEqual(await dudu.api('issues/events', { issueId: issue.id }), before, 'viewing the dashboard cannot rewrite the issue');

  // Open session shows that very session in DSH: the first message, the read-only mode it runs in.
  await page.locator('.dudu header').getByRole('button', { name: 'Open session', exact: true }).click();
  await page.getByText(message, { exact: true }).first().waitFor();
  await page.getByText('第 3 条建议接受。', { exact: true }).first().waitFor();
  await page.getByText('Read Only').first().waitFor();
  await page.close();
});

test('ASSIGN.md chooses the session folder and model as well as its access mode', async () => {
  const state = await dudu.api('assistant/state');
  const rule = join(state.projectFolder, 'ASSIGN.md');
  const original = await readFile(rule, 'utf8');
  const target = join(dudu.folder, 'rule-project');
  await mkdir(target);
  try {
    await writeFile(rule, `- 规则验收 → DeepSeek，在 "${target}" 里，模型：mock-1，只读\n`);
    const issue = await add({ title: '规则选目录', kind: '规则验收', project: { name: 'rule-project', path: target } });
    await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
    await until(issue.id, 'finish in the rule folder', turnDone);
    const detail = await dudu.api('issues/get', { id: issue.id });
    const started = detail.log.find((entry: any) => entry.kind === 'session' && entry.data?.cwd);
    assert.equal(started.data.cwd, target);
    assert.equal(started.data.model, 'mock-1');
    assert.equal(started.data.access, 'read-only');
  } finally { await writeFile(rule, original); }
});

test('unfinished stopped work keeps Todo through comments and resumed execution', async () => {
  const issue = await add({ title: '分段完成的工作', brief: 'PARTIALME' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const stopped = await until(issue.id, 'stop without generating progress', turnDone);
  assert.equal(stopped.status, 'todo');
  assert.equal(stopped.ask, '', 'stopping does not generate a confirmation question');
  assert.equal((await logOf(issue.id)).some((entry) => entry.kind === 'progress'), false);
  assert.equal((await get(issue.id)).status, 'todo');
  const page = await dudu.openPanel();
  await openIssue(page, issue.title);
  const composer = page.getByRole('textbox', { name: 'Leave a comment…' });
  await composer.fill('这是一条普通留言');
  await page.keyboard.press('Control+Enter');
  await page.getByRole('listitem').getByText('这是一条普通留言', { exact: true }).waitFor();
  assert.equal((await get(issue.id)).status, 'todo');
  await composer.fill('@deepseek SLOWME FINISHME');
  await page.keyboard.press('Control+Enter');
  await until(issue.id, 'resume actual work without moving Todo', (now) => now.status === 'todo' && now.agentState === 'working', 10_000);
  await until(issue.id, 'finish the remaining work', turnDone);
  assert.equal((await logOf(issue.id)).some((entry) => entry.kind === 'progress'), false);
  await page.close();
});

test('Backlog exploration preserves manual status changes through assignment, resume, stop and reload', async () => {
  const reviewsBefore = dudu.model.requests.filter((request: any) => request.system.includes('You are dudu, managing an issue')).length;
  const issue = await add({ title: 'Backlog exploration', brief: 'PARTIALME', status: 'backlog' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  await until(issue.id, 'finish the first exploration', turnDone);
  assert.equal((await get(issue.id)).status, 'backlog');
  const page = await dudu.openPanel();
  await page.getByRole('tab', { name: 'Backlog', exact: true }).click();
  await openIssue(page, issue.title);
  let properties = page.getByRole('complementary', { name: 'Properties' });
  await properties.getByRole('button', { name: 'Backlog', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Leave a comment…' }).fill('@deepseek WORKFLOW-RESUME');
  await page.keyboard.press('Control+Enter');
  await until(issue.id, 'resume exploration inside Backlog', (now) => now.status === 'backlog' && now.agentState === 'working', 10_000);
  const workerRequests = () => dudu.model.requests.filter((request: any) => request.prompt === 'WORKFLOW-RESUME' && request.tools.length).length;
  await until(issue.id, 'reach the worker model', () => workerRequests() === 1, 10_000);
  await properties.getByRole('button', { name: 'Backlog', exact: true }).click();
  await page.getByRole('option', { name: /^In Review/ }).click();
  const working = await get(issue.id);
  assert.equal(working.status, 'in_review', 'a manual workflow choice is retained while the worker is active');
  assert.equal(working.agentState, 'working');
  assert.equal(workerRequests(), 1, 'a manual status change sends no further work');
  await page.reload();
  properties = page.getByRole('complementary', { name: 'Properties' });
  await properties.getByRole('button', { name: 'In Review', exact: true }).waitFor();
  await until(issue.id, 'finish with the chosen status', turnDone);
  assert.equal((await get(issue.id)).status, 'in_review');
  await properties.getByRole('button', { name: 'In Review', exact: true }).waitFor();
  const changes = (await logOf(issue.id)).filter((entry) => entry.kind === 'status');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].actor, 'owner', 'assignment and worker transitions write no automatic workflow history');
  assert.equal(dudu.model.requests.filter((request: any) => request.system.includes('You are dudu, managing an issue')).length, reviewsBefore, 'workflow changes never request a model review');
  await page.close();
});

test('@dudu uses the durable assistant conversation and replies on the issue without assigning a worker', async () => {
  const issue = await add({ title: '只问嘟嘟的工作', project: null });
  const before = dudu.model.replies;
  dudu.model.replies = [{
    when: 'ISSUE-DUDU-CONTEXT',
    calls: [{ name: 'issues_get', arguments: { id: issue.id } }],
    then: (results: string[]) => `已经读到这条事项：${JSON.parse(results[0]).issue.title}`,
  }, ...before];
  try {
    const page = await dudu.openPanel();
    await openIssue(page, issue.title);
    await page.getByRole('textbox', { name: 'Leave a comment…' }).fill('@dudu ISSUE-DUDU-CONTEXT 请看这条事项');
    await page.keyboard.press('Control+Enter');
    await page.getByText(`已经读到这条事项：${issue.title}`, { exact: true }).waitFor({ timeout: 30_000 });
    assert.equal((await get(issue.id)).agent, null);
    const { sessionId } = (await dudu.api('assistant/state')).conversation;
    assert.match(sessionId, /^dudu-assistant-/);
    assert.ok((await logOf(issue.id)).some((entry) => entry.actor === 'dudu' && entry.kind === 'note'));
    await page.close();
  } finally { dudu.model.replies = before; }
});

test('a question preserves Todo after an @ message; the explicit reply API answers the tool and the queued message follows it', async () => {
  const issue = await add({ title: '合同第 3 条', brief: 'ASKME：先问我，再回答。' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const asking = await until(issue.id, 'ask its question', (now) => now.ask.startsWith('Accept clause 3'));
  assert.equal(asking.agentState, 'blocked');
  assert.equal(asking.status, 'todo');
  assert.equal(asking.ask, 'Accept clause 3 or reject it? (Accept / Reject)', 'the question with the choices it offers');

  const page = await dudu.openPanel();
  await openIssue(page, '合同第 3 条');
  const card = page.getByRole('region', { name: 'Todo', exact: true });
  await card.getByText('Accept clause 3 or reject it? (Accept / Reject)').waitFor();
  await card.getByText('DeepSeek', { exact: true }).waitFor();
  const avatar = page.getByTitle('DeepSeek · Needs you').first();
  await avatar.waitFor();
  assert.equal(await avatar.locator(':scope > span[data-agent-activity="blocked"].bg-destructive').count(), 1, 'a worker that asked keeps its activity mark: red');
  assert.equal(await page.locator('.dudu textarea').count(), 1);
  await page.getByRole('textbox', { name: 'Leave a comment…' }).fill('@deepseek A separate follow-up.');
  await page.keyboard.press('Control+Enter');
  await page.getByRole('listitem').getByText('@deepseek A separate follow-up.', { exact: true }).waitFor();
  assert.equal((await get(issue.id)).ask, asking.ask, '@ only queues the message; it does not interpret a tool answer');
  assert.equal((await get(issue.id)).status, 'todo', 'queued messages do not move the workflow');
  await dudu.api('issues/reply', { id: issue.id, text: 'Accept' });

  // A dedicated answer still reaches DSH's question tool; the @ message stays a separate user turn.
  const finished = await until(issue.id, 'finish after the answer', turnDone);
  assert.equal(finished.agentState, 'blocked');
  const answered = dudu.model.requests.filter((request: { toolResults: string[] }) => request.toolResults.length > 0).at(-1);
  assert.ok(answered, 'the model saw a tool result');
  assert.deepEqual(JSON.parse(answered.toolResults.at(-1)), { answers: [{ id: 'q1', selected: ['Accept'] }] }, 'the choice that was named');
  assert.equal(dudu.model.requests.filter((request: any) => request.prompt.startsWith(issue.title) && request.tools.length).length, 2, 'one worker turn and its tool result, without a second Accept prompt');
  assert.ok(dudu.model.requests.some((request: any) => request.prompt === 'A separate follow-up.' && request.tools.length), 'the original @ message follows the tool answer unchanged');
  const log = await logOf(issue.id);
  assert.ok(log.some((entry) => entry.kind === 'note' && entry.actor === 'owner' && entry.text === '@deepseek A separate follow-up.'));
  await page.close();
});

test('a session opened directly in DSH never becomes an issue merely because its worker asks a question', async () => {
  const before = (await dudu.api('issues/counts')).total;
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  const composer = page.locator('[contenteditable="true"]').last();
  await composer.waitFor();
  await composer.fill('ASKME UNBOUND：合同第 3 条');
  await page.keyboard.press('Enter');
  await page.getByText('Accept clause 3 or reject it?', { exact: true }).first().waitFor({ timeout: 30_000 });
  assert.equal((await dudu.api('issues/counts')).total, before, 'the question waterfall does not enroll unowned work');
  const all = await dudu.api('issues/list', { tab: 'all', filter: { source: ['session'] } });
  assert.equal(all.items.some((item: any) => item.title.includes('UNBOUND') || item.ask.startsWith('Accept clause 3')), false);
  await page.close();
});

test('a failed turn preserves Todo without generated progress; an @ message resumes work', async () => {
  const issue = await add({ title: '会失败的事', brief: 'FAILME' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const failed = await until(issue.id, 'fail', (now) => now.agentState === 'blocked');
  assert.equal(failed.ask, '');
  assert.equal(failed.status, 'todo');
  assert.equal(failed.agentState, 'blocked');

  const page = await dudu.openPanel();
  await openIssue(page, '会失败的事');
  assert.equal((await logOf(issue.id)).some((entry) => entry.kind === 'progress'), false);
  await page.getByRole('textbox', { name: 'Leave a comment…' }).fill('@deepseek 再试一次');
  await page.keyboard.press('Control+Enter');

  const done = await until(issue.id, 'finish the second turn', turnDone);
  assert.equal(done.agentState, 'blocked');
  const last = dudu.model.requests.filter((request: { tools: string[] }) => request.tools.length > 0).at(-1);
  assert.equal(last.prompt, '再试一次', 'the words arrived as a message of the owner');
  assert.equal((await logOf(issue.id)).some((entry) => entry.kind === 'progress'), false);
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'DeepSeek · Open session', exact: true }).click();
  await page.getByRole('dialog').getByText('好了，这次做完了。', { exact: true }).waitFor({ timeout: 30_000 });
  await page.close();
});

test('a session folded away in DSH\'s sidebar is put back by Open session and activity follows later messages', async () => {
  const issue = await add({ title: '收起再打开', brief: '只回答 ok，不要用任何工具。' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  await until(issue.id, 'finish the turn', turnDone);
  const title = '收起再打开';

  const page = await dudu.openPanel();
  const row = await sidebarRow(page, issue.id, title);
  await row.waitFor();
  await row.hover();
  await sidebarOf(page).getByRole('button', { name: 'Archive session' }).click();
  await row.waitFor({ state: 'detached' });

  // Open session puts it back (it was folded away, not deleted) and shows it, with what it said before.
  await openIssue(page, title);
  await page.getByRole('button', { name: 'Open session' }).click();
  await page.getByText('收起再打开 只回答 ok，不要用任何工具。', { exact: true }).first().waitFor();
  await (await sidebarRow(page, issue.id, title)).waitFor();
  const log = await logOf(issue.id);
  assert.ok(log.some((entry) => entry.kind === 'session' && entry.actor === 'dudu' && entry.text === 'resumed the session'), 'and the log says so');

  // The owner speaks to the agent in DSH's own window: the issue follows the session, wherever the words come from.
  const composer = page.locator('[contenteditable="true"]').last();
  await composer.click();
  await composer.fill('SLOWME 再核对一遍');
  await page.keyboard.press('Enter');
  const again = await until(issue.id, 'work again', (now) => now.agentState === 'working' && now.status === 'todo');
  assert.equal(again.ask, '', 'resumed work has no pending question');
  await until(issue.id, 'finish another turn', turnDone);
  await page.close();
});

/** An issue whose project is a folder of its own, and a model that tries to write a file there: first plainly, then asking for a wider mode. */
async function writer(word: string, file: string) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'dudu-e2e-project-')));
  const path = join(folder, file);
  const before = dudu.model.replies;
  dudu.model.replies = [
    {
      when: (context: any) => context.prompt.includes(word),
      calls: [
        { name: 'write', arguments: { file_path: path, content: 'hello' } },
        { name: 'write', arguments: { file_path: path, content: 'hello', sandbox_permissions: 'workspace-write', justification: '需要写出文件。' } },
      ],
      then: (results: string[]) => `second write said: ${results[1]}`,
    },
    ...before,
  ];
  const issue = await add({ title: `写文件 ${file}`, brief: `${word}：把 hello 写进 ${file}。`, project: { name: 'tmp', path: folder } });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const exists = () => access(path).then(() => true, () => false);
  const cleanup = async () => { dudu.model.replies = before; await rm(folder, { recursive: true, force: true }); };
  return { issue, path, exists, cleanup };
}

test('a session is read-only; a write approval preserves Todo, and an explicit approval reply permits one write', async () => {
  const work = await writer('ESCALATE-ALLOW', 'allowed.txt');
  try {
    const asking = await until(work.issue.id, 'ask to write', (now) => now.ask.includes('回复“允许”'));
    assert.equal(asking.agentState, 'blocked');
    assert.equal(asking.status, 'todo');
    assert.match(asking.ask, /^允许本次操作使用 workspace-write 权限：需要写出文件。\n回复“允许”放开这一次，其他回复都不放开。$/, "DSH's own sentence for it, and how to answer");
    assert.equal(await work.exists(), false, 'the first, plain write was refused by the read-only mode, and nothing is written while the owner has not said');

    const page = await dudu.openPanel();
    await openIssue(page, '写文件 allowed.txt');
    const card = page.getByRole('region', { name: 'Todo', exact: true });
    await card.getByText('回复“允许”放开这一次，其他回复都不放开。').waitFor();
    await dudu.api('issues/reply', { id: work.issue.id, text: '允许' });

    await until(work.issue.id, 'finish after the approval', turnDone);
    assert.equal(await readFile(work.path, 'utf8'), 'hello', 'the one operation that was asked about was done');
    assert.equal((await logOf(work.issue.id)).some((entry) => entry.kind === 'progress'), false);
    await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'DeepSeek · Open session', exact: true }).click();
    await page.getByRole('dialog').getByText(/^second write said:/).waitFor();
    await page.close();
  } finally { await work.cleanup(); }
});

test('an explicit reply other than yes refuses the write, and the agent is told so', async () => {
  const work = await writer('ESCALATE-DENY', 'refused.txt');
  try {
    await until(work.issue.id, 'ask to write', (now) => now.ask.includes('回复“允许”'));
    const page = await dudu.openPanel();
    await openIssue(page, '写文件 refused.txt');
    await dudu.api('issues/reply', { id: work.issue.id, text: '先别写，先给我看看方案' });

    await until(work.issue.id, 'finish after the refusal', turnDone);
    assert.equal(await work.exists(), false, 'nothing was written');
    assert.equal((await logOf(work.issue.id)).some((entry) => entry.kind === 'progress'), false);
    await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'DeepSeek · Open session', exact: true }).click();
    await page.getByRole('dialog').getByText(/^second write said: .*(reject|denied|refus)/i).waitFor();
    await page.close();
  } finally { await work.cleanup(); }
});

test('an explicit current grant changes the same stopped session from read-only to workspace write and permits its next write', async () => {
  const project = { name: 'Access checks', path: await realpath(dudu.folder) };
  const chat = async (page: Page, text: string, answer: string) => {
    const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
    await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await dialog.getByText(answer, { exact: true }).waitFor({ timeout: 30_000 });
  };
  assert.equal((await dudu.api('projects/create', project)).outcome, 'success');
  const { issue: made } = await dudu.api('issues/add', { fields: { title: '验证开发权限', kind: '开发', project } });
  await dudu.api('issues/assign', { id: made.id, agent: 'deepseek' });
  let issue;
  for (let attempt = 0; attempt < 100; attempt++) {
    issue = (await dudu.api('issues/get', { id: made.id })).issue;
    if (issue.session && issue.agentState !== 'working') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(issue?.session && issue.agentState !== 'working');
  const session = issue.session;
  const path = join(project.path, 'access-check.txt');
  const grant = '允许这个会话可以改工作区里的文件。';
  const before = dudu.model.replies;
  dudu.model.replies = [{
    when: 'CHAT-ACCESS-BLOCKED',
    calls: [{ name: 'sessions_set_access', arguments: { session, access: 'workspace-write', approval: grant } }],
    then: (results: string[]) => `权限检查：${JSON.parse(results.at(-1)!).outcome}`,
  }, {
    when: (context: any) => context.prompt === grant && context.tools.includes('sessions_set_access'),
    calls: [{ name: 'sessions_set_access', arguments: { session, access: 'workspace-write', approval: grant } }],
    then: (results: string[]) => `权限检查：${JSON.parse(results.at(-1)!).outcome}`,
  }, {
    when: (context: any) => context.prompt === 'CHAT-WRITE-NOW' && context.tools.includes('sessions_send'),
    calls: [{ name: 'sessions_send', arguments: { session, text: 'WRITE-AFTER-GRANT' } }], then: () => '已交给会话。',
  }, {
    when: 'WRITE-AFTER-GRANT',
    calls: [{ name: 'write', arguments: { file_path: path, content: 'workspace write verified' } }], then: () => '写入完成。',
  }, ...before];
  try {
    const page = await dudu.openPanel();
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await chat(page, 'CHAT-ACCESS-BLOCKED', '权限检查：needs_clarification');
    await chat(page, grant, '权限检查：success');
    assert.equal((await dudu.api('issues/get', { id: made.id })).issue.session, session);
    assert.equal(await access(path).then(() => true, () => false), false, 'setting access sends no work');
    await chat(page, 'CHAT-WRITE-NOW', '已交给会话。');
    for (let attempt = 0; attempt < 100 && !await access(path).then(() => true, () => false); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await readFile(path, 'utf8'), 'workspace write verified');
    await page.close();
  } finally { dudu.model.replies = before; }
});
