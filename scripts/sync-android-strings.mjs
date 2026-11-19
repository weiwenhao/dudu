import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DICTIONARIES } from '../host/dudu-plugin/ui/strings.js';

const root = new URL('../', import.meta.url);
const native = JSON.parse(await readFile(new URL('native/ios/Dudu/Resources/Localizable.xcstrings', root), 'utf8')).strings;
const keys = {
  app_name: '嘟嘟', dudu: '嘟嘟', active: '进行中', backlog: '待规划', all: '全部事项',
  cancel: '取消', close: '关闭', back: '返回', retry: '重试', connect: '添加并连接',
  computers: '电脑连接', pairing_link: '配对链接', invalid_link: '配对链接无效',
  connection_failed: '无法连接，请检查电脑和网络',
  auth_failed: '配对已失效，请生成新配对码', identity_mismatch: '配对信息与电脑不匹配，请重新配对',
  protocol_error: '电脑返回了无法识别的数据。', new_issue: '新建事项', create: '创建事项',
  issue_title: '事项标题', description: '添加描述…', project: '项目', no_project: '无项目',
  agent: '智能体', unassigned: '未分配', status: '状态', priority: '优先级',
  none: '无优先级', urgent: '紧急', high: '高', medium: '中', low: '低',
  quota: '额度', empty_quota: '暂无用量', pin: '置顶', unpin: '取消置顶',
  mark_unread: '标为未读', clear_unread: '清除未读', delete: '删除',
  delete_title: '删除“{0} {1}”？',
  delete_body: '将删除这条事项、活动和本地关联。来源消息和会话历史会保留。',
  send_failed: '回复没能发给会话：连接暂时不可用。',
  send: '发送', message: '发消息', empty: '暂无会话', more: '更多',
  yesterday: '昨天', image: '图片', save: '保存',
};
for (const [status, label] of Object.entries(DICTIONARIES.zh.status)) keys[`workflow_${status}`] = label;
const pending = { mark_unread: 'Mark as unread', clear_unread: 'Clear unread' };
const findHost = (zh, en, target) => {
  for (const key of Object.keys(zh)) {
    if (zh[key] === target && typeof en[key] === 'string') return en[key];
    if (zh[key] && typeof zh[key] === 'object') {
      const found = findHost(zh[key], en[key] ?? {}, target);
      if (found) return found;
    }
  }
};
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll("'", "\\'").replaceAll('"', '\\"')
  .replaceAll(/\{(\d+)\}/g, (_, n) => `%${Number(n) + 1}$s`);
const en = {};
for (const [key, text] of Object.entries(keys)) {
  en[key] = (key.startsWith('workflow_') ? DICTIONARIES.en.status[key.slice(9)] : null)
    ?? native[text]?.localizations?.en?.stringUnit?.value
    ?? findHost(DICTIONARIES.zh, DICTIONARIES.en, text) ?? pending[key];
  if (!en[key]) throw new Error(`No existing translation for ${key}: ${text}`);
}
for (const [locale, words] of [['values', en], ['values-zh-rCN', keys]]) {
  const directory = new URL(`native/android/app/src/main/res/${locale}/`, root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('strings.xml', directory), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    + Object.entries(words).map(([key, text]) => `    <string name="${key}">${escape(text)}</string>`).join('\n')
    + '\n</resources>\n');
}
await writeFile(new URL('native/android/wording-sources.json', root),
  JSON.stringify({ native: 'native/ios/Dudu/Resources/Localizable.xcstrings',
    desktop: 'host/dudu-plugin/ui/strings.js', chinese: keys,
    englishAwaitingOwnerReview: pending }, null, 2) + '\n');
console.log(`Synced ${Object.keys(keys).length} existing labels; two English menu translations remain for review.`);
