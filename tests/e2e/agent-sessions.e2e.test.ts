// An issue given to an agent, in the real thing: the packaged plugin in `dsh web`, DSH's own loop and sessions, Chrome. Run: npm run test:e2e
//
// The model is the one thing that is not real: a scripted OpenAI-compatible server on a local port (mock-model.mjs), which DSH is told
// to use as its default model. It answers by what the last message says: SLOWME takes a few seconds (so that a turn is seen to
// work), ASKME calls DSH's question tool, FAILME fails with a 400. Everything else is the thing itself: the session DSH makes, its
// sidebar entry, the events its loop sends, the question tool and its answer, and the page.
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => {
  dudu = await startDudu({
    model: {
      replies: [
        { when: 'SLOWME', say: '第 3 条建议接受。', delay: 4000 },
        { when: 'ASKME', ask: { question: 'Accept clause 3 or reject it?', options: ['Accept', 'Reject'] } },
        { when: 'FAILME', fail: { status: 400, message: 'bad request from the mock' } },
        { when: '再试一次', say: '好了，这次做完了。' },
      ],
    },
  });
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

type Issue = { id: number; status: string; ask: string; agent: string | null; session: string | null; agentState: string };
const toast = (page: Page, text: string) => page.getByText(text, { exact: true }).first();
const add = async (fields: Record<string, unknown>) => (await dudu.api('issues/add', { fields })).issue as Issue;
const get = async (id: number) => (await dudu.api('issues/get', { id })).issue as Issue;
const logOf = async (id: number) => (await dudu.api('issues/get', { id, logLimit: 200 })).log as Array<{ kind: string; actor: string; text: string }>;

/** Waits until the issue is as the test says; the sessions work on their own time. */
async function until(id: number, what: string, check: (issue: Issue) => boolean, timeout = 45_000) {
  const started = Date.now();
  let issue = await get(id);
  while (!check(issue)) {
    if (Date.now() - started > timeout) assert.fail(`DUDU-${id} did not ${what} in ${timeout} ms; it is ${JSON.stringify(issue)}`);
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
  const folder = sidebarOf(page).getByRole('treeitem', { name: /home/ }).first();
  await folder.waitFor();
  if ((await folder.getAttribute('aria-expanded')) === 'false') await folder.click();
  return sidebarOf(page).getByText(`DUDU-${id} ${title}`, { exact: true });
}
/** The first message of a session as the model saw it (the requests with tools are the agent's own; the others are DSH's titles). */
async function firstMessageOf(id: number) {
  for (let waited = 0; waited < 20_000; waited += 250) {
    const found = dudu.model.requests.find((request: { tools: string[]; prompt: string }) => request.tools.length > 0 && request.prompt.includes(`# DUDU-${id} `));
    if (found) return found.prompt as string;
    await new Promise((done) => setTimeout(done, 250));
  }
  return '';
}

test('an issue given to DeepSeek from its agent menu gets a session in DSH that works, and ends In Review asking to be confirmed', async () => {
  const issue = await add({ title: '回复供应商合同的修改意见', brief: 'SLOWME：只回答一句话，不要用任何工具。', priority: 'high' });
  const page = await dudu.openPanel();
  await openIssue(page, '回复供应商合同的修改意见');

  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'No agent' }).click();
  await page.getByRole('option', { name: 'DeepSeek' }).click();
  await toast(page, 'Assigned to DeepSeek').waitFor();

  // The turn is on: In Progress, the Working mark on the agent, a session that is DSH's, and the first message written from the issue.
  await page.getByTitle('DeepSeek · Working').first().waitFor({ timeout: 20_000 });
  const working = await get(issue.id);
  assert.equal(working.status, 'in_progress');
  assert.equal(working.agentState, 'working');
  assert.match(working.session ?? '', /^dsh:session-/);
  const message = await firstMessageOf(issue.id);
  assert.match(message, /^嘟嘟把 DUDU-\d+ 交给你/);
  assert.match(message, /# DUDU-\d+ 回复供应商合同的修改意见/);
  assert.match(message, /优先级 High/);
  assert.match(message, /只回答一句话，不要用任何工具/, 'the summary of the issue');
  assert.match(message, /现在是只读模式/, 'read-only unless ASSIGN.md says otherwise');

  // The session is in DSH's sidebar, named for the issue, in the folder it works in.
  await (await sidebarRow(page, issue.id, '回复供应商合同的修改意见')).waitFor();

  // The turn ends with an answer: In Review, the question to confirm, and what the agent said as its own comment.
  const done = await until(issue.id, 'be In Review', inReview);
  assert.equal(done.agentState, 'needs_you');
  await page.getByRole('region', { name: 'Needs you' }).getByText('确认完成吗？').waitFor();
  await page.getByText('第 3 条建议接受。', { exact: true }).waitFor();
  const log = await logOf(issue.id);
  assert.ok(log.some((entry) => entry.kind === 'progress' && entry.actor === 'deepseek' && entry.text === '第 3 条建议接受。'));
  assert.ok(log.some((entry) => entry.kind === 'session' && entry.actor === 'dudu' && entry.text === 'started a session with DeepSeek'));

  // Open session shows that very session in DSH: the first message, the read-only mode it runs in.
  await page.getByRole('button', { name: 'Open session' }).click();
  await page.getByText(`嘟嘟把 DUDU-${issue.id} 交给你`).first().waitFor();
  await page.getByText('Read Only').first().waitFor();
  await page.close();
});

test('a question of the agent is the issue\'s Needs you; the answer given on the page reaches the session, and the turn goes on', async () => {
  const issue = await add({ title: '合同第 3 条', brief: 'ASKME：先问我，再回答。' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const asking = await until(issue.id, 'ask its question', (now) => now.ask.startsWith('Accept clause 3'));
  assert.equal(asking.agentState, 'needs_you');
  assert.equal(asking.status, 'in_progress');
  assert.equal(asking.ask, 'Accept clause 3 or reject it? (Accept / Reject)', 'the question with the choices it offers');

  const page = await dudu.openPanel();
  await openIssue(page, '合同第 3 条');
  const card = page.getByRole('region', { name: 'Needs you' });
  await card.getByText('Accept clause 3 or reject it? (Accept / Reject)').waitFor();
  await page.getByTitle('DeepSeek · Needs you').first().waitFor();
  await card.getByRole('textbox', { name: 'Reply…' }).fill('Accept');
  await page.keyboard.press('Control+Enter');

  // The words went to the agent as the answer of its question tool, not as a new message.
  const finished = await until(issue.id, 'finish after the answer', inReview);
  assert.equal(finished.agentState, 'needs_you');
  const answered = dudu.model.requests.filter((request: { toolResults: string[] }) => request.toolResults.length > 0).at(-1);
  assert.ok(answered, 'the model saw a tool result');
  assert.deepEqual(JSON.parse(answered.toolResults.at(-1)), { answers: [{ id: 'q1', selected: ['Accept'] }] }, 'the choice that was named');
  assert.equal(dudu.model.requests.filter((request: { prompt: string; tools: string[] }) => request.tools.length > 0 && request.prompt.includes('# DUDU-')).every((request: { prompt: string }) => !request.prompt.endsWith('Accept')), true);
  await page.getByText('got your answer:', { exact: false }).first().waitFor();
  const log = await logOf(issue.id);
  assert.ok(log.some((entry) => entry.kind === 'decision' && entry.actor === 'owner' && entry.text === 'Accept'));
  await page.close();
});

test('a turn that fails asks what to do; the reply is a message to the session, and it works again', async () => {
  const issue = await add({ title: '会失败的事', brief: 'FAILME' });
  await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' });
  const failed = await until(issue.id, 'fail', (now) => now.ask.startsWith('出错了'));
  assert.equal(failed.ask, '出错了：400: bad request from the mock。怎么办？');
  assert.equal(failed.status, 'in_progress');
  assert.equal(failed.agentState, 'needs_you');

  const page = await dudu.openPanel();
  await openIssue(page, '会失败的事');
  const card = page.getByRole('region', { name: 'Needs you' });
  await card.getByText('出错了：400: bad request from the mock。怎么办？').waitFor();
  await card.getByRole('textbox', { name: 'Reply…' }).fill('再试一次');
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
  await page.getByText(`嘟嘟把 DUDU-${issue.id} 交给你`).first().waitFor();
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
      when: word,
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

test('a session is read-only; an agent that asks to write is a Needs you on the issue, and "允许" lets that one write happen', async () => {
  const work = await writer('ESCALATE-ALLOW', 'allowed.txt');
  try {
    const asking = await until(work.issue.id, 'ask to write', (now) => now.ask.includes('回复“允许”'));
    assert.equal(asking.agentState, 'needs_you');
    assert.equal(asking.status, 'in_progress');
    assert.match(asking.ask, /^允许本次操作使用 workspace-write 权限：需要写出文件。\n回复“允许”放开这一次，其他回复都不放开。$/, "DSH's own sentence for it, and how to answer");
    assert.equal(await work.exists(), false, 'the first, plain write was refused by the read-only mode, and nothing is written while the owner has not said');

    const page = await dudu.openPanel();
    await openIssue(page, '写文件 allowed.txt');
    const card = page.getByRole('region', { name: 'Needs you' });
    await card.getByText('回复“允许”放开这一次，其他回复都不放开。').waitFor();
    await card.getByRole('textbox', { name: 'Reply…' }).fill('允许');
    await page.keyboard.press('Control+Enter');

    await until(work.issue.id, 'finish after the approval', inReview);
    assert.equal(await readFile(work.path, 'utf8'), 'hello', 'the one operation that was asked about was done');
    const log = await logOf(work.issue.id);
    assert.ok(log.some((entry) => entry.kind === 'progress' && entry.actor === 'deepseek' && /^second write said:/.test(entry.text)));
    await page.close();
  } finally { await work.cleanup(); }
});

test('anything but a yes refuses the write, and the agent is told so', async () => {
  const work = await writer('ESCALATE-DENY', 'refused.txt');
  try {
    await until(work.issue.id, 'ask to write', (now) => now.ask.includes('回复“允许”'));
    const page = await dudu.openPanel();
    await openIssue(page, '写文件 refused.txt');
    const card = page.getByRole('region', { name: 'Needs you' });
    await card.getByRole('textbox', { name: 'Reply…' }).fill('先别写，先给我看看方案');
    await page.keyboard.press('Control+Enter');

    await until(work.issue.id, 'finish after the refusal', inReview);
    assert.equal(await work.exists(), false, 'nothing was written');
    const told = (await logOf(work.issue.id)).find((entry) => entry.kind === 'progress' && entry.actor === 'deepseek');
    assert.match(told?.text ?? '', /^second write said: .*(reject|denied|refus)/i, 'the agent saw that the operation was refused');
    await page.close();
  } finally { await work.cleanup(); }
});
