// 嘟嘟's conversation as a group chat, in the real thing: the packaged plugin in `dsh web` on its own home, DSH's own loop and sessions, Chrome. Run: npm run test:e2e -- tests/e2e/group-chat.e2e.test.ts
//
// Only the model is scripted (mock-model.mjs). An issue given to DeepSeek has a real session; the owner writes `@REF …` in the pet's box; the line must come into the thread (no tick under it since 2026-11-11), the issue's agent
// must get exactly the owner's words (and nothing of the group), its answer must come back as a bubble of the issue after the dots, 嘟嘟 must see the group in its system prompt, a line can be answered
// (回复 fills the box) and hidden (删除: it stays hidden after a reload, the session log is not touched), and 定时任务 goes to its page. Set DUDU_E2E_SHOTS=<folder> to keep a picture of each step.
import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import type { Locator, Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
let project: { name: string; path: string };
const problems: string[] = [];
const ANSWER = '结论：先用 SQLite 存，文件做备份。\n\n1. 单文件，好备份\n2. 向量库：要另起服务，第二期再说';
// A long message of an agent with a table in it (the owner's real one ran on whole in the row, 2026-11-10): the row shows two lines of it, and the opened row shows it as it is.
const LONG = `当前结论：有试点价值，但尚未通过接入嘟嘟的完整质量验证，暂不建议直接替换现有记忆系统。之前的适配判断主要基于架构，实际效果还没有验证出来。\n\n| 评估项 | 当前结果 | 意味着什么 |\n|---|---|---|\n| 架构适配 | 分层记忆、事实提炼、场景记忆与嘟嘟的需求相符 | 值得进一步试验 |\n| 嘟嘟现有记忆 | 五项关键回归全部通过 | 新方案接入后必须保住这些能力 |\n| 腾讯正常部署效果 | 未测 | 还不能判断召回质量是否优于嘟嘟 |\n\n${'其中最需要关注的是两件事：记忆质量是否真的提升，要用同一组对话比较同义表达、跨会话问题、新事实覆盖旧事实。'.repeat(8)}`;

before(async () => {
  dudu = await startDudu({
    model: {
      replies: [
        // 嘟嘟 sees the group: the model says so only when its system prompt carries the section and what the issue answered.
        { when: (context: any) => context.prompt.includes('GROUP-ASK') && context.system.includes('Group chat (material)') && context.system.includes('SQLite'), say: 'GROUP-MATERIAL-SEEN' },
        { when: 'GROUP-ANSWER', say: ANSWER, delay: 3500 },
        { when: 'LONG-REPLY', say: LONG },
      ],
    },
  });
  const path = await realpath(dudu.folder);
  project = { name: 'Contract checks', path };
  assert.equal((await dudu.api('projects/create', project)).outcome, 'success');
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

type Issue = { id: number; ref: string; title: string; session: string | null; agentState: string; ask: string; sessions?: { key: string; state: string }[] };
const get = async (id: number) => (await dudu.api('issues/get', { id })).issue as Issue;
const turnDone = (issue: Issue) => Boolean(issue.session) && issue.agentState === 'blocked' && issue.ask === '' && Boolean(issue.sessions?.some((one) => one.key === issue.session && one.state === 'finished'));

/** An issue in Todo given to DeepSeek, waited for until its first turn is over (a line written to an agent that is already working is another story). */
async function issueWithAgent(title: string, brief = 'Say received.') {
  const { issue } = await dudu.api('issues/add', { fields: { project, title, brief, status: 'todo' } });
  assert.equal((await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' })).outcome, 'success');
  const started = Date.now();
  let now = await get(issue.id);
  while (!turnDone(now)) {
    if (Date.now() - started > 60_000) assert.fail(`${title} did not finish its first turn: ${JSON.stringify(now)}`);
    await new Promise((done) => setTimeout(done, 250));
    now = await get(issue.id);
  }
  return now;
}

const watch = (page: Page) => {
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  // A failed request is named by its path (the console only says "Failed to load resource").
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(`console: ${message.text()}`); });
  page.on('response', (response) => { if (response.status() >= 400) problems.push(`http ${response.status()}: ${new URL(response.url()).pathname}`); });
  return page;
};
const shot = async (target: Locator | Page, name: string) => {
  const folder = process.env.DUDU_E2E_SHOTS;
  if (!folder) return;
  await mkdir(folder, { recursive: true });
  await target.screenshot({ path: join(folder, `group-${name}.png`) });
};

test('an @ line comes into the thread, the answer comes back to it, 嘟嘟 sees the group, and a line can be answered and hidden', async () => {
  const first = await issueWithAgent('记忆系统调研', 'LONG-REPLY please');
  const second = await issueWithAgent('Write the quick cards');
  const page = watch(await dudu.openPanel());
  const open = async () => {
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
    await dialog.waitFor();
    return dialog;
  };
  let dialog = await open();
  const box = () => dialog.getByRole('textbox', { name: 'Message', exact: true });
  const menu = (name: string) => page.getByRole('menuitem', { name, exact: true });
  assert.deepEqual(await dialog.locator('.dudu-pet-quick button').allInnerTexts(), ['Todo', 'Collector', 'Tasks']);

  // 待办 is a card whose rows carry each issue's latest message (what DSH said of its session, kept by the plugin), and a row opens downward to it.
  await dialog.getByRole('button', { name: 'Todo', exact: true }).click();
  const card = dialog.locator('[data-quick-card="todo"]').first();
  await card.waitFor();
  const rows = card.locator('[data-card-issue]');
  assert.equal(await rows.count(), 2);
  const row = card.locator(`[data-card-issue="${first.id}"]`);
  assert.match(await row.innerText(), new RegExp(`${first.ref}[\\s\\S]*记忆系统调研`), 'the ID and the title as its signature');
  assert.match(await card.locator(`[data-card-issue="${second.id}"]`).innerText(), /ok/, 'the latest message of its session');
  // A long message is two lines under the title, not the whole of it (a row that ran on looked as if it were open and could not be read).
  assert.match(await row.innerText(), /当前结论：有试点价值/);
  assert.equal(await row.getByRole('button').first().getAttribute('aria-expanded'), 'false');
  assert.equal(await row.locator('[data-todo-latest]').count(), 0);
  assert.ok((await row.locator('.line-clamp-2').boundingBox())!.height <= 36, 'two lines of 17 px at most');
  assert.ok((await card.boundingBox())!.height < 300, 'the card is as tall as its rows, not as the messages');
  assert.doesNotMatch(await row.locator('.line-clamp-2').innerText(), /\|/, 'the bars of the table are not in the snippet');
  await shot(dialog, '1-todo-card');
  await row.getByRole('button').first().click();
  assert.equal(await row.getByRole('button').first().getAttribute('aria-expanded'), 'true');
  await row.locator('[data-todo-latest]').waitFor();
  assert.equal(await row.locator('[data-todo-latest] table').count(), 1, 'the opened row shows the message as it is, the table a table');
  await shot(dialog, '2-todo-row-open');
  // 回复 on the opened row: the issue's @ is in the box, its title after it in grey.
  await row.getByRole('button', { name: 'Reply', exact: true }).click();
  assert.equal(await box().inputValue(), `@${first.ref} `);
  assert.equal(await dialog.locator('.dudu-pet-hint').innerText(), first.title);
  await shot(dialog, '3-reply-from-row');
  await box().fill('');

  // The owner's line to an issue comes into the thread (and has no tick under it: owner, 2026-11-11); its agent gets exactly the words (nothing of the group); the answer comes back as the issue's bubble after the dots.
  const words = 'GROUP-ANSWER 记忆系统调研有结论了吗';
  await box().fill(`@${first.ref} ${words}`);
  await box().press('Enter');
  const at = dialog.locator(`[data-group-at="${first.ref}"]`);
  await at.waitFor();
  assert.match(await at.innerText(), /记忆系统调研有结论了吗/);
  assert.equal(await at.locator('.dudu-pet-tick').count(), 0, 'no tick under the owner\'s line');
  const waiting = dialog.locator(`[data-group-waiting="${first.ref}"]`);
  await waiting.waitFor();
  await shot(dialog, '4-waiting');
  const guest = dialog.locator(`[data-group-issue="${first.ref}"]`);
  await guest.waitFor({ timeout: 30_000 });
  assert.equal(await waiting.count(), 0, 'the dots are gone once the answer is there');
  assert.match(await guest.innerText(), /结论：先用 SQLite/);
  assert.equal(await guest.locator('ol li').count(), 2, 'the answer is shown as markdown');
  assert.match(await guest.locator('.dudu-pet-guest-label').innerText(), new RegExp(`${first.ref}[\\s\\S]*记忆系统调研`), 'its ID, when, and the title as the signature');
  assert.ok(await guest.locator('svg[data-agent-logo]').count() > 0, 'the agent\'s logo is its picture');
  await shot(dialog, '5-answer');
  const asked = dudu.model!.requests.filter((request: any) => request.prompt.includes('GROUP-ANSWER'));
  assert.ok(asked.length > 0 && asked.every((request: any) => request.prompt === words), 'the agent got exactly the owner\'s words');
  assert.ok(asked.every((request: any) => !/Group chat/.test(request.system)), 'and nothing of the group');

  // 嘟嘟 sees all of it: a plain message to it is answered with the group in its system prompt.
  await box().fill('GROUP-ASK what was asked of the issues?');
  await box().press('Enter');
  await dialog.getByText('GROUP-MATERIAL-SEEN', { exact: true }).waitFor({ timeout: 30_000 });
  await shot(dialog, '6-dudu-sees');

  // The right-click menu of the answer: copy, reply, delete. 回复 puts the issue's @ in the box; a letter takes the grey title away.
  await guest.click({ button: 'right' });
  await menu('Copy').waitFor();
  await menu('Reply').waitFor();
  await menu('Delete').waitFor();
  await shot(page, '7-menu');
  await menu('Reply').click();
  assert.equal(await box().inputValue(), `@${first.ref} `);
  await dialog.locator('.dudu-pet-hint').waitFor();
  await box().pressSequentially('x');
  assert.equal(await dialog.locator('.dudu-pet-hint').count(), 0);
  await box().fill('');

  // 删除 hides the owner's line from the thread only: it stays hidden after a reload, the answer stays, and the session still has what was said.
  await at.click({ button: 'right' });
  await menu('Delete').click();
  assert.equal(await at.count(), 0);
  assert.equal((await dudu.api('assistant/hidden')).seqs.length, 1);
  await page.reload();
  dialog = await open();
  await dialog.locator(`[data-group-issue="${first.ref}"]`).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-group-at]').length === 0);
  assert.equal(await dialog.locator(`[data-group-issue="${first.ref}"]`).count(), 1);
  assert.ok(asked.length > 0, 'the session kept the owner\'s words');
  assert.equal((await get(second.id)).session !== null, true);
  await shot(dialog, '8-after-delete-reload');

  // 定时任务 has no card: it goes to its page and the conversation closes behind it.
  await dialog.getByRole('button', { name: 'Tasks', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('dialog', { name: 'Tasks', exact: true }).waitFor();
  await shot(page, '9-tasks-page');
  // The page publishes the phone's navigation to a route that a DSH without the phone's control does not have (0.2.0-rc.2 answers 404; the page ignores it): not this feature's.
  assert.deepEqual(problems.filter((problem) => problem !== 'http 404: /api/dudu/nav'), [], 'the page raised no error');
});
