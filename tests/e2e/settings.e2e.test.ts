// 嘟嘟's settings window in the real thing: the project folder the plugin made, the connectors of its CONNECTORS.md (a real program
// behind one), the rules, the memory the owner can read and forget from, the skills, the widgets switch, and the issues export.
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
let folder: string;
before(async () => {
  dudu = await startDudu();
  folder = join(dudu.home, 'dudu', 'home');
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

const settings = async (page: Page, section?: string) => {
  await page.getByRole('region', { name: 'Dashboard' }).getByRole('button', { name: 'Settings' }).click(); // DSH has a Settings of its own
  const window = page.getByRole('dialog');
  await window.getByRole('heading', { name: 'Settings' }).waitFor();
  if (section) await window.getByRole('button', { name: section, exact: true }).click();
  return window;
};

test('the project folder is made on the first start with the seven files, and General shows it and moves it', async () => {
  const names = (await readdir(folder)).sort();
  assert.deepEqual(names.filter((name) => name.endsWith('.md')), ['AGENTS.md', 'ASSIGN.md', 'CONNECTORS.md', 'MEMORY.md', 'SOUL.md', 'TRIAGE.md', 'USER.md']);
  assert.match(await readFile(join(folder, 'AGENTS.md'), 'utf8'), /^<!-- dudu-home -->/);

  const page = await dudu.openPanel();
  const window = await settings(page);
  await window.getByText(folder).waitFor();
  await window.getByText('Default', { exact: true }).waitFor();

  // A folder that is someone else's is refused with the reason; a new one is accepted and the files move into it.
  await mkdir(join(dudu.folder, 'others'), { recursive: true });
  await writeFile(join(dudu.folder, 'others', 'notes.txt'), 'not ours');
  await window.getByRole('button', { name: 'Change…' }).click();
  await window.getByRole('textbox', { name: 'Folder path' }).fill(join(dudu.folder, 'others'));
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await window.getByRole('alert').filter({ hasText: 'already has other files' }).waitFor();

  const target = join(dudu.folder, 'moved-home');
  await window.getByRole('textbox', { name: 'Folder path' }).fill(target);
  await window.getByLabel('Move the files into it').click();
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await window.getByText(target).waitFor();
  assert.equal((await dudu.api('assistant/state')).projectFolder, target);
  assert.ok((await readdir(target)).includes('AGENTS.md'), 'the files went with it');
  assert.equal((await dudu.api('assistant/state')).isDefault, false);
  // Back to the default for the tests that follow.
  await window.getByRole('button', { name: 'Change…' }).click();
  await window.getByRole('textbox', { name: 'Folder path' }).fill(folder);
  await window.getByLabel('Move the files into it').click();
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await window.getByText('Default', { exact: true }).waitFor();
  await page.close();
});

test('Connectors: every one starts off, only the switch turns it on, a test runs a real program, and Remove can be undone', async () => {
  const program = join(dudu.folder, 'demo-cli');
  await writeFile(program, '#!/bin/sh\necho "hi from the demo connector"\n');
  await chmod(program, 0o755);
  await writeFile(join(folder, 'CONNECTORS.md'), `# 连接器

## 示例读取器
<!-- id: demo | enabled: false | source: owner | since: 2026-10-31 -->
读一行字。

\`\`\`json
{ "kind": "cli", "command": ${JSON.stringify(program)}, "allow": [{ "run": "hello", "readOnly": true }, "change"] }
\`\`\`

## 写坏的
<!-- id: broken | enabled: false -->
\`\`\`json
{ "kind": "cli"
\`\`\`
`);
  const page = await dudu.openPanel();
  const window = await settings(page, 'Connectors');
  const row = window.getByRole('listitem').filter({ hasText: '示例读取器' });
  await row.waitFor();
  const turnOn = window.getByRole('switch', { name: 'Turn on 示例读取器' });
  assert.equal(await turnOn.getAttribute('aria-checked'), 'false');
  await window.getByText('Skipped entries').waitFor();
  await window.getByText(/Line \d+: .*not valid JSON/).waitFor();

  // Open it: what it may do, read or write; nothing is on until the owner says so.
  await row.getByRole('button', { name: 'Details of 示例读取器' }).click();
  await row.getByText('hello', { exact: true }).waitFor();
  assert.equal(await row.getByText('Read', { exact: true }).count(), 1);
  assert.equal(await row.getByText('Write', { exact: true }).count(), 1);
  await turnOn.click();
  await window.getByRole('switch', { name: 'Turn on 示例读取器' }).and(window.locator('[aria-checked=true]')).waitFor();
  assert.match(await readFile(join(folder, 'CONNECTORS.md'), 'utf8'), /id: demo \| enabled: true/);
  assert.match(await readFile(join(folder, 'CONNECTORS.md'), 'utf8'), /## 写坏的/, 'what the owner wrote and the plugin could not read is still in the file');

  await row.getByRole('button', { name: 'Test' }).click();
  await row.getByText(/^OK · /).waitFor();
  await row.getByRole('button', { name: 'Remove' }).click();
  await row.waitFor({ state: 'detached' });
  await window.getByText('Removed 示例读取器').waitFor();
  await window.getByRole('button', { name: 'Undo' }).click();
  await window.getByRole('listitem').filter({ hasText: '示例读取器' }).waitFor();
  await page.close();
});

test('Rules shows the two rule files and Skills the skills; the owner reads and deletes a skill', async () => {
  await mkdir(join(folder, 'skills', '读飞书'), { recursive: true });
  await writeFile(join(folder, 'skills', '读飞书', 'SKILL.md'), '---\nname: 读飞书\ndescription: 怎么读飞书的日程\n---\n先问日程，再问任务。\n');
  const page = await dudu.openPanel();
  let window = await settings(page, 'Rules');
  await window.getByText('TRIAGE.md', { exact: true }).waitFor();
  await window.getByText('重要又简单的先做', { exact: false }).waitFor();
  await window.getByText('ASSIGN.md', { exact: true }).waitFor();

  await window.getByRole('button', { name: 'Skills', exact: true }).click();
  await window.getByRole('button', { name: /读飞书/ }).click();
  await window.getByText('先问日程，再问任务。').waitFor();
  await window.getByRole('button', { name: 'Delete' }).click();
  await window.getByText('No skills yet').waitFor();
  await page.close();
});

test('Memory lists what is remembered; Forget shows what would go and only then deletes', async () => {
  await writeFile(join(folder, 'MEMORY.md'), `# 记住的事

<!-- m1 | 2026-10-29 | active | owner -->
合同类的回复先抄送法务。

<!-- m2 | 2026-10-30 | active | owner -->
周四前处理服务器续费。
`);
  const page = await dudu.openPanel();
  const window = await settings(page, 'Memory');
  await window.getByText('合同类的回复先抄送法务。').waitFor();
  await window.getByRole('searchbox', { name: 'Search records' }).fill('续费');
  await window.getByText('合同类的回复先抄送法务。').waitFor({ state: 'detached' });
  await window.getByText('周四前处理服务器续费。').waitFor();

  await window.getByRole('button', { name: /^Forget: 周四前处理服务器续费/ }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'This will be deleted' });
  await confirm.getByText('周四前处理服务器续费。').waitFor();
  assert.match(await readFile(join(folder, 'MEMORY.md'), 'utf8'), /周四前处理服务器续费/, 'the preview deletes nothing');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await window.getByText('周四前处理服务器续费。').waitFor({ state: 'detached' });
  assert.doesNotMatch(await readFile(join(folder, 'MEMORY.md'), 'utf8'), /周四前处理服务器续费/);
  await page.close();
});

test('Widgets: the switch puts a widget on the dashboard and takes it off; General exports the issues', async () => {
  await dudu.api('dashboard/reset');
  await dudu.api('issues/add', { fields: { title: '导出这一件', status: 'todo' } });
  const page = await dudu.openPanel();
  const window = await settings(page, 'Widgets');
  const quota = window.getByRole('switch', { name: 'Put Quota on the dashboard' });
  assert.equal(await quota.getAttribute('aria-checked'), 'false');
  await quota.click();
  await window.getByRole('switch', { name: 'Put Quota on the dashboard' }).and(window.locator('[aria-checked=true]')).waitFor();
  assert.ok((await dudu.api('dashboard/get')).layout.widgets.some((item: { type: string }) => item.type === 'quota'));
  await page.keyboard.press('Escape'); // closing the window: the dashboard behind it shows the change
  await page.getByRole('region', { name: 'Quota' }).waitFor();

  const again = await settings(page, 'General');
  const [download] = await Promise.all([page.waitForEvent('download'), again.getByRole('button', { name: 'Export issues' }).click()]);
  assert.match(download.suggestedFilename(), /^dudu-issues-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await readFile((await download.path()) as string, 'utf8'));
  assert.ok(exported.issues.some((issue: { title: string }) => issue.title === '导出这一件'));
  await page.close();
});
