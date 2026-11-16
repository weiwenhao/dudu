// The quick buttons of 嘟嘟's chat and the card they send, in the real DSH: the command that makes a card must register under the agent's own context (a first version read DSH's
// `commands` from it and was refused), the 待办 card is what needs the owner (the board's 需要你: agents that finished and wait; not the status Todo, owner 2026-11-10: "待办应该就是需要我这一栏的东西"),
// a card stays in the thread across a reload with the rows it had, a row opens downward to its latest message, the buttons stay while something is written, and the two that have no card go to
// their pages. Only the model is scripted, and it is never asked.
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
let project: { name: string; path: string };
before(async () => {
  dudu = await startDudu({ model: true });
  project = { name: 'Contract checks', path: await realpath(dudu.folder) };
  assert.equal((await dudu.api('projects/create', project)).outcome, 'success');
});
after(async () => { await dudu?.stop(); });

type Issue = { id: number; sessionState: string; ask: string; session: string | null; sessions?: { key: string; state: string }[] };
/** An issue given to DeepSeek, waited for until its first turn is over: its agent then waits for the owner (Needs you). */
async function waitingForYou(title: string) {
  const { issue } = await dudu.api('issues/add', { fields: { project, title, brief: 'Say received.', status: 'todo' } });
  assert.equal((await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' })).outcome, 'success');
  const started = Date.now();
  for (;;) {
    const now = (await dudu.api('issues/get', { id: issue.id })).issue as Issue;
    if (now.session && now.sessionState === 'unread' && now.ask === '' && now.sessions?.some((one) => one.key === now.session && one.state === 'finished')) return now;
    if (Date.now() - started > 60_000) assert.fail(`${title} did not finish its first turn: ${JSON.stringify(now)}`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

test('a button sends its card; the card is what needs the owner and keeps its rows across a reload, a row opens to its latest message, the buttons stay while a message is written, and 定时任务 goes to its page', async () => {
  const page = await dudu.openPanel();
  const open = async () => {
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
    await dialog.waitFor();
    return dialog;
  };
  let dialog = await open();
  const chip = (name: string) => dialog.getByRole('button', { name, exact: true });
  const card = (kind: string) => dialog.locator(`[data-quick-card="${kind}"]`);
  assert.deepEqual(await dialog.locator('.dudu-pet-quick button').allInnerTexts(), ['Todo', 'Collector', 'Tasks'], 'three buttons: 额度 has a card but no button, 嘟嘟 sends it when it is asked');

  // A list that was read and is empty is an empty card, never "could not look".
  await chip('Todo').click();
  await card('todo').first().waitFor();
  assert.match(await card('todo').first().innerText(), /No issues/);

  // The card is the list of that moment: issues that come to need the owner later are on the next card, not on this one. 待办 is what waits for the owner (three agents that finished), not the status
  // Todo: an issue in Todo that nobody works on, and one in progress that no agent was given, are not on it.
  const titles = ['记忆系统调研', 'Write the quick cards', '周报整理'];
  for (const title of titles) await waitingForYou(title);
  await dudu.api('issues/add', { fields: { title: '状态是待办但不在等我', status: 'todo' } });
  await dudu.api('issues/add', { fields: { title: '处理中但没有智能体', status: 'in_progress' } });
  await chip('Todo').click();
  await card('todo').nth(1).waitFor();
  assert.equal(await card('todo').nth(1).locator('[data-card-issue]').count(), 3);
  assert.equal(await card('todo').first().locator('[data-card-issue]').count(), 0);
  assert.equal(await card('todo').nth(1).getByText('状态是待办但不在等我').count(), 0, 'the status Todo is not what 待办 lists');

  // A row opens downward to the latest message of its session.
  const row = card('todo').nth(1).locator('[data-card-issue]').filter({ hasText: '周报整理' });
  await row.getByRole('button').first().click();
  assert.equal(await row.getByRole('button').first().getAttribute('aria-expanded'), 'true');
  await row.locator('[data-todo-latest]').waitFor();

  // The cards are events of the thread and their rows are kept by the plugin: a reload brings back both, each with its own rows.
  await page.reload();
  dialog = await open();
  await card('todo').nth(1).waitFor();
  assert.deepEqual(await dialog.locator('[data-quick-card]').evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('data-quick-card'), node.querySelectorAll('li').length])),
    [['todo', 0], ['todo', 3]]);

  // Writing does not take the buttons away (owner, 2026-11-10: they used to, and the thread jumped).
  const message = dialog.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('hello');
  assert.equal(await dialog.locator('.dudu-pet-quick').count(), 1);
  await message.fill('');
  assert.equal(await dialog.locator('.dudu-pet-quick').count(), 1);

  // 信息 and 定时任务 make no card: 定时任务 goes to the tasks window and the conversation closes behind it (信息 goes to the dashboard the same way).
  await chip('Tasks').click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('dialog', { name: 'Tasks', exact: true }).waitFor();
  await page.close();
});
