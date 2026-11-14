// brandOf says which service a name is about, so that a connector or a record can wear that service's logo. The one that went wrong (owner, 2026-11-12): a connector
// named "QQ 邮箱" wore the chat app's penguin, because the word QQ is in it. QQ's mailbox is a service of its own, with no logo here: the avatar is the name's first letter.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brandOf } from '../host/assistant/connectors/brands.mjs';

test("QQ's mailbox is not taken for the QQ chat app, and a name that is QQ itself still is", () => {
  for (const name of ['QQ 邮箱', 'QQ邮箱', '我的 qq 邮件', 'QQ Mail', 'qq-mail', 'qqmail']) assert.equal(brandOf(name), null, name);
  for (const name of ['QQ', 'QQ 消息', '腾讯QQ']) assert.equal(brandOf(name), 'qq', name);
  assert.equal(brandOf('qqq'), null);
  // the first text that names a service decides, so the id behind the name does not make it another one
  assert.equal(brandOf('QQ 邮箱', 'slack-notifier'), null);
  // the others are as they were
  assert.equal(brandOf('飞书 @我'), 'lark');
  assert.equal(brandOf('Gmail'), 'gmail');
  assert.equal(brandOf('我的收件箱'), null);
});

test('a name that says two services is about the one it says first, and the other apps of a maker are not its chat', () => {
  assert.equal(brandOf('Notion 同步到 Slack'), 'notion');
  assert.equal(brandOf('Slack 通知转 Notion'), 'slack');
  assert.equal(brandOf('GitHub 通知转飞书'), 'github');
  // a tie, or one that contains the other, goes by the table: WeCom before WeChat
  assert.equal(brandOf('WeChat Work'), 'wecom');
  assert.equal(brandOf('企业微信'), 'wecom');
  assert.equal(brandOf('微信'), 'wechat');
  for (const name of ['QQ 音乐', 'QQ 浏览器', 'QQ 空间', '微信读书', 'weread']) assert.equal(brandOf(name), null, name);
});
