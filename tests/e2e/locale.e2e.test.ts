import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => {
  dudu = await startDudu({ model: true });
  await writeFile(join(dudu.home, 'dudu/home/CONNECTORS.md'), '# 连接器\n\n## 飞书来源\n<!-- id: lark -->\n从飞书里收集未完成的事项。\n');
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

async function language(page: Page, from: 'en' | 'zh', to: 'en' | 'zh') {
  const account = page.getByRole('button', { name: from === 'en' ? 'Account menu' : '账号菜单', exact: true });
  if (await account.count()) {
    await account.click();
    await page.getByRole('menu').getByText(from === 'en' ? 'Settings' : '设置', { exact: true }).click();
  } else {
    const name = from === 'en' ? 'Settings' : '设置';
    await page.getByRole('button', { name, exact: true }).filter({ hasText: name }).click();
  }
  const settings = page.getByRole('dialog', { name: from === 'en' ? 'Settings' : '设置', exact: true });
  await settings.getByRole('button', { name: from === 'en' ? 'English' : '中文', exact: true }).click();
  await page.getByRole('menuitem', { name: to === 'en' ? 'English' : '中文', exact: true }).click();
  await page.getByRole('dialog', { name: to === 'en' ? 'Settings' : '设置', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: to === 'en' ? 'Settings' : '设置', exact: true }).waitFor({ state: 'hidden' });
}

test('DSH language changes the sidebar, dashboard, menus and settings live and preserves the chat draft', async () => {
  const page = await dudu.openPanel();
  const corner = await page.getByRole('button', { name: 'Display options', exact: true }).evaluate((element) => getComputedStyle(element).getPropertyValue('corner-shape'));
  assert.ok(['round', 'superellipse(1)'].includes(corner), `Circular controls must keep round corners, got ${corner}.`);
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Dudu', exact: true }).getByRole('textbox', { name: 'Message', exact: true }).fill('保留 draft 123');
  await language(page, 'en', 'zh');
  await page.getByRole('button', { name: '嘟嘟', exact: true }).waitFor();
  await page.getByRole('button', { name: '展开对话', exact: true }).click();
  const chat = page.getByRole('dialog', { name: '嘟嘟', exact: true });
  assert.equal(await chat.getByRole('textbox', { name: '发消息', exact: true }).inputValue(), '保留 draft 123');
  await chat.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('region', { name: '仪表盘', exact: true }).waitFor();
  await page.getByRole('heading', { name: '看板', exact: true }).waitFor();
  await page.getByRole('tab', { name: '进行中', exact: true }).waitFor();
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  for (const label of ['状态', '智能体', '优先级', '日期']) await page.getByRole('dialog').getByText(label, { exact: true }).waitFor();
  assert.equal(await page.getByRole('listbox', { name: '候选项', exact: true }).count(), 2);
  await page.keyboard.press('Escape');
  await page.getByRole('toolbar', { name: '嘟嘟菜单', exact: true }).getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '嘟嘟设置', exact: true });
  for (const label of ['通用', '连接器', '规则', '记忆', '技能', '小组件', '手机控制', '供应商']) await settings.getByRole('button', { name: label, exact: true }).waitFor();
  await settings.getByRole('button', { name: '小组件', exact: true }).click();
  await settings.getByText('各智能体的订阅用量', { exact: true }).waitFor();
  await settings.getByRole('button', { name: '连接器', exact: true }).click();
  await settings.getByText('从飞书里收集未完成的事项。', { exact: true }).waitFor();
  assert.equal(await settings.getByRole('switch').count(), 0, 'source prompts have no enable switches');
  await settings.getByRole('button', { name: '供应商', exact: true }).click();
  await settings.getByText('可执行文件路径', { exact: true }).first().waitFor();
  const phoneResponse = page.waitForResponse((response) => response.url().endsWith('/api/dudu/state'));
  await settings.getByRole('button', { name: '手机控制', exact: true }).click();
  if ((await phoneResponse).ok()) await settings.getByText('电脑名称', { exact: true }).waitFor();
  else await settings.getByText('连接暂时不可用。', { exact: true }).waitFor(); // Older DSH has no phone-control peer API.
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await language(page, 'zh', 'en');
  await page.getByRole('button', { name: 'Dudu', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Issues', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Active', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Dudu', exact: true }).getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '保留 draft 123');
});

test('issue route, content and cached group labels survive a language change; date picker follows it too', async () => {
  const { issue } = await dudu.api('issues/add', { fields: { title: '合同续费 keep content', status: 'todo' } });
  const page = await dudu.openPanel({ views: { active: { group: 'status' } } });
  await page.getByRole('button', { name: '合同续费 keep content', exact: true }).click();
  await page.getByRole('textbox', { name: 'Leave a comment…', exact: true }).fill('未发送的评论 draft');
  await language(page, 'en', 'zh');
  assert.equal(await page.getByRole('textbox', { name: '添加评论…', exact: true }).inputValue(), '未发送的评论 draft');
  assert.equal(await page.getByRole('button', { name: '未命名', exact: true }).innerText(), '合同续费 keep content');
  await page.getByRole('button', { name: '无截止日期', exact: true }).click();
  await page.getByRole('button', { name: '前往下个月', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回看板', exact: true }).click();
  await page.getByRole('heading', { name: '待办', exact: true }).waitFor();
  await language(page, 'zh', 'en');
  await page.getByRole('heading', { name: 'Todo', exact: true }).waitFor();
  assert.equal((await dudu.api('issues/get', { id: issue.id })).issue.title, '合同续费 keep content');
});
