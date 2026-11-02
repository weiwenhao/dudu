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
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
let project: { name: string; path: string };
before(async () => {
  dudu = await startDudu({
    model: {
      replies: [
        { when: (context: any) => context.system.includes('You are dudu, managing an issue'), say: (context: any) => {
          const { evidence } = JSON.parse(context.prompt);
          const last = evidence.messages.filter((message: any) => message.role === 'assistant').at(-1)?.text ?? '';
          const partial = /只完成一半/.test(last);
          return JSON.stringify({ summary: last || '本轮未完成。', ask: partial ? '' : evidence.state === 'error' ? '是否重试？' : '确认完成吗？' });
        } },
        { when: 'PARTIALME', say: '只完成一半，还没有检查剩下的文件。' },
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
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

type Issue = { id: number; ref: string | null; title: string; status: string; ask: string; agent: string | null; session: string | null; agentState: string; sessions?: { key: string; state: string }[] };
const toast = (page: Page, text: string) => page.getByText(text, { exact: true }).first();
const add = async (fields: Record<string, unknown>) => (await dudu.api('issues/add', { fields: { project, ...fields } })).issue as Issue;
const get = async (id: number) => (await dudu.api('issues/get', { id })).issue as Issue;
const logOf = async (id: number) => (await dudu.api('issues/get', { id, logLimit: 200 })).log as Array<{ kind: string; actor: string; text: string }>;

/** Waits until the issue is as the test says; the sessions work on their own time. */
async function until(id: number, what: string, check: (issue: Issue) => boolean, timeout = 45_000) {
  const started = Date.now();
  let issue = await get(id);
  while (!check(issue)) {
    if (Date.now() - started > timeout) assert.fail(`Issue ${id} did not ${what} in ${timeout} ms; it is ${JSON.stringify(issue)}`);
    await new Promise((done) => setTimeout(done, 250));
    issue = await get(id);
  }
  return issue;
}
const inReview = (issue: Issue) => issue.status === 'in_review' && issue.ask === '确认完成吗？';

const openIssue = (page: Page, title: string) => page.getByRole('region', { name: 'Issues' }).getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: title, exact: true }).click();
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

test('an issue given to DeepSeek from its agent menu gets a session in DSH that works, and ends In Review asking to be confirmed', async () => {
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

  // The turn is on: In Progress, the Working mark on the agent, a session that is DSH's, and the first message written from the issue.
  await page.getByTitle('DeepSeek · Working').first().waitFor({ timeout: 20_000 });
  const working = await get(issue.id);
  assert.equal(working.status, 'in_progress');
  assert.equal(working.agentState, 'working');
  assert.match(working.session ?? '', /^dsh:session-/);
  const message = await firstMessageOf(issue.id);
  assert.equal(message, '回复供应商合同的修改意见\n\nSLOWME：只回答一句话，不要用任何工具。');
  const request = dudu.model.requests.find((request: any) => request.prompt === message && request.tools.length);
  assert.ok(request && !request.tools.some((name: string) => name.startsWith('issues_')), 'the worker gets no issue management tools');

  // The session is in DSH's sidebar, named for the issue, in the folder it works in.
  await (await sidebarRow(page, issue.id, '回复供应商合同的修改意见')).waitFor();

  // The turn ends with an answer: In Review, the question to confirm, and what the agent said as its own comment.
  const done = await until(issue.id, 'be In Review', inReview);
  assert.equal(done.agentState, 'needs_you');
  await page.getByRole('region', { name: 'In Review', exact: true }).getByText('确认完成吗？').waitFor();
  await page.getByText('第 3 条建议接受。', { exact: true }).waitFor();
  const log = await logOf(issue.id);
  assert.ok(log.some((entry) => entry.kind === 'progress' && entry.actor === 'dudu' && entry.text === '第 3 条建议接受。'));
  assert.ok(log.some((entry) => entry.kind === 'session' && entry.actor === 'dudu' && entry.text === 'started a session with DeepSeek'));

  // Open session shows that very session in DSH: the first message, the read-only mode it runs in.
  await page.getByRole('button', { name: 'Open session' }).click();
  await page.getByText(message, { exact: true }).first().waitFor();
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
    await until(issue.id, 'finish in the rule folder', inReview);
    const detail = await dudu.api('issues/get', { id: issue.id });
    const started = detail.log.find((entry: any) => entry.kind === 'session' && entry.data?.cwd);
    assert.equal(started.data.cwd, target);
    assert.equal(started.data.model, 'mock-1');
    assert.equal(started.data.access, 'read-only');
  } finally { await writeFile(rule, original); }
});

test('unfinished stopped work enters In Review immediately, comments leave it there, and @ resumes real work', async () => {
  const issue = await add({ title: '分段完成的工作', brief: 'PARTIALME' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const stopped = await until(issue.id, 'stop In Review before a model summary', (now) => now.status === 'in_review');
  assert.equal(stopped.ask, '', 'In Review does not require a confirmation question');
  const deadline = Date.now() + 45_000;
  while (!(await logOf(issue.id)).some((entry) => entry.kind === 'progress')) {
    assert.ok(Date.now() < deadline, 'dudu reviews a stopped worker after debounce');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal((await get(issue.id)).status, 'in_review');
  const page = await dudu.openPanel();
  await openIssue(page, issue.title);
  const composer = page.getByRole('textbox', { name: 'Leave a comment…' });
  await composer.fill('这是一条普通留言');
  await page.keyboard.press('Control+Enter');
  await page.getByRole('listitem').getByText('这是一条普通留言', { exact: true }).waitFor();
  assert.equal((await get(issue.id)).status, 'in_review');
  await composer.fill('@deepseek SLOWME FINISHME');
  await page.keyboard.press('Control+Enter');
  await until(issue.id, 'resume actual work In Progress', (now) => now.status === 'in_progress' && now.agentState === 'working', 10_000);
  await until(issue.id, 'be reviewed after the remaining work', inReview);
  assert.ok((await logOf(issue.id)).filter((entry) => entry.kind === 'progress').every((entry) => entry.actor === 'dudu'));
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

test('a question stays In Review after an @ message; the explicit reply API answers the tool and the queued message follows it', async () => {
  const issue = await add({ title: '合同第 3 条', brief: 'ASKME：先问我，再回答。' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const asking = await until(issue.id, 'ask its question', (now) => now.ask.startsWith('Accept clause 3'));
  assert.equal(asking.agentState, 'needs_you');
  assert.equal(asking.status, 'in_review');
  assert.equal(asking.ask, 'Accept clause 3 or reject it? (Accept / Reject)', 'the question with the choices it offers');

  const page = await dudu.openPanel();
  await openIssue(page, '合同第 3 条');
  const card = page.getByRole('region', { name: 'In Review', exact: true });
  await card.getByText('Accept clause 3 or reject it? (Accept / Reject)').waitFor();
  await card.getByText('DeepSeek', { exact: true }).waitFor();
  const avatar = page.getByTitle('DeepSeek · In Review').first();
  await avatar.waitFor();
  assert.equal(await avatar.locator(':scope > span').count(), 1, 'no separate Needs you dot');
  assert.equal(await page.locator('.dudu textarea').count(), 1);
  await page.getByRole('textbox', { name: 'Leave a comment…' }).fill('@deepseek A separate follow-up.');
  await page.keyboard.press('Control+Enter');
  await page.getByRole('listitem').getByText('@deepseek A separate follow-up.', { exact: true }).waitFor();
  assert.equal((await get(issue.id)).ask, asking.ask, '@ only queues the message; it does not interpret a tool answer');
  assert.equal((await get(issue.id)).status, 'in_review', 'queued messages do not pretend the blocked worker resumed');
  await dudu.api('issues/reply', { id: issue.id, text: 'Accept' });

  // A dedicated answer still reaches DSH's question tool; the @ message stays a separate user turn.
  const finished = await until(issue.id, 'finish after the answer', inReview);
  assert.equal(finished.agentState, 'needs_you');
  const answered = dudu.model.requests.filter((request: { toolResults: string[] }) => request.toolResults.length > 0).at(-1);
  assert.ok(answered, 'the model saw a tool result');
  assert.deepEqual(JSON.parse(answered.toolResults.at(-1)), { answers: [{ id: 'q1', selected: ['Accept'] }] }, 'the choice that was named');
  assert.equal(dudu.model.requests.filter((request: any) => request.prompt.startsWith(issue.title) && request.tools.length).length, 2, 'one worker turn and its tool result, without a second Accept prompt');
  assert.ok(dudu.model.requests.some((request: any) => request.prompt === 'A separate follow-up.' && request.tools.length), 'the original @ message follows the tool answer unchanged');
  const log = await logOf(issue.id);
  assert.ok(log.some((entry) => entry.kind === 'note' && entry.actor === 'owner' && entry.text === '@deepseek A separate follow-up.'));
  await page.close();
});

test('a session the owner opens becomes one issue when it asks; an explicit reply resumes it without dudu reviewing imported work', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  const composer = page.locator('[contenteditable="true"]').last();
  await composer.waitFor();
  await composer.fill('ASKME UNBOUND：合同第 3 条');
  await page.keyboard.press('Enter');
  let issue: Issue | undefined;
  const started = Date.now();
  while (!issue) {
    const result = await dudu.api('issues/list', { tab: 'active', filter: { source: ['session'] } });
    issue = result.items.find((item: any) => item.ask.startsWith('Accept clause 3'));
    if (Date.now() - started > 30_000) assert.fail('The unassigned DSH question did not become an issue.');
    if (!issue) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(issue.agentState, 'needs_you');
  assert.equal(issue.status, 'in_review');
  assert.equal(issue.agent, 'deepseek');
  const linked = issue.session;
  await page.getByRole('button', { name: 'Dudu', exact: true }).first().click();
  await openIssue(page, 'Accept clause 3 or reject it? (Accept / Reject)');
  await dudu.api('issues/reply', { id: issue.id, text: 'Accept' });
  await until(issue.id, 'finish after the owner answered', (now) =>
    now.status === 'in_review' && now.ask === '' && now.sessions?.some((session) => session.key === now.session && session.state === 'finished') === true);
  assert.ok(!(await logOf(issue.id)).some((entry) => entry.kind === 'progress'), 'dudu does not review a conversation the owner already had');
  const all = await dudu.api('issues/list', { tab: 'all', filter: { source: ['session'] } });
  assert.equal(all.items.filter((item: any) => item.session === linked).length, 1);
  await dudu.api('issues/complete', { id: issue.id, outcome: 'Checked' });
  const entries = await logOf(issue.id);
  assert.ok(entries.some((entry) => entry.kind === 'session' && entry.text === 'closed the session'));
  await page.close();
});

test('a turn that fails asks what to do; the reply is a message to the session, and it works again', async () => {
  const issue = await add({ title: '会失败的事', brief: 'FAILME' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const failed = await until(issue.id, 'fail', (now) => now.ask.startsWith('出错了'));
  assert.equal(failed.ask, '出错了：400: bad request from the mock。怎么办？');
  assert.equal(failed.status, 'in_review');
  assert.equal(failed.agentState, 'needs_you');

  const page = await dudu.openPanel();
  await openIssue(page, '会失败的事');
  const card = page.getByRole('region', { name: 'In Review', exact: true });
  await card.getByText('Something went wrong: 400: bad request from the mock. What should we do?').waitFor();
  await page.getByRole('textbox', { name: 'Leave a comment…' }).fill('@deepseek 再试一次');
  await page.keyboard.press('Control+Enter');

  const done = await until(issue.id, 'finish the second turn', inReview);
  assert.equal(done.agentState, 'needs_you');
  const last = dudu.model.requests.filter((request: { tools: string[] }) => request.tools.length > 0).at(-1);
  assert.equal(last.prompt, '再试一次', 'the words arrived as a message of the owner');
  await page.getByText('好了，这次做完了。', { exact: true }).waitFor();
  await page.close();
});

test('a session folded away in DSH\'s sidebar is put back by Open session, and what is said in DSH moves the issue too', async () => {
  const issue = await add({ title: '收起再打开', brief: '只回答 ok，不要用任何工具。' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  await until(issue.id, 'be In Review', inReview);
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
  const again = await until(issue.id, 'work again', (now) => now.agentState === 'working' && now.status === 'in_progress');
  assert.equal(again.ask, '', 'the question to confirm goes while the agent works');
  await until(issue.id, 'be In Review again', inReview);
  await page.close();
});

/** An issue whose project is a folder of its own, and a model that tries to write a file there: first plainly, then asking for a wider mode. */
async function writer(word: string, file: string) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'dudu-e2e-project-')));
  const path = join(folder, file);
  const before = dudu.model.replies;
  dudu.model.replies = [
    {
      when: (context: any) => context.prompt.includes(word) && !context.system.includes('You are dudu, managing an issue'),
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

test('a session is read-only; a write approval waits In Review, and an explicit approval reply permits one write', async () => {
  const work = await writer('ESCALATE-ALLOW', 'allowed.txt');
  try {
    const asking = await until(work.issue.id, 'ask to write', (now) => now.ask.includes('回复“允许”'));
    assert.equal(asking.agentState, 'needs_you');
    assert.equal(asking.status, 'in_review');
    assert.match(asking.ask, /^允许本次操作使用 workspace-write 权限：需要写出文件。\n回复“允许”放开这一次，其他回复都不放开。$/, "DSH's own sentence for it, and how to answer");
    assert.equal(await work.exists(), false, 'the first, plain write was refused by the read-only mode, and nothing is written while the owner has not said');

    const page = await dudu.openPanel();
    await openIssue(page, '写文件 allowed.txt');
    const card = page.getByRole('region', { name: 'In Review', exact: true });
    await card.getByText('回复“允许”放开这一次，其他回复都不放开。').waitFor();
    await dudu.api('issues/reply', { id: work.issue.id, text: '允许' });

    await until(work.issue.id, 'finish after the approval', inReview);
    assert.equal(await readFile(work.path, 'utf8'), 'hello', 'the one operation that was asked about was done');
    const log = await logOf(work.issue.id);
    assert.ok(log.some((entry) => entry.kind === 'progress' && entry.actor === 'dudu' && /^second write said:/.test(entry.text)));
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

    await until(work.issue.id, 'finish after the refusal', inReview);
    assert.equal(await work.exists(), false, 'nothing was written');
    const told = (await logOf(work.issue.id)).find((entry) => entry.kind === 'progress' && entry.actor === 'dudu');
    assert.match(told?.text ?? '', /^second write said: .*(reject|denied|refus)/i, 'the agent saw that the operation was refused');
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
