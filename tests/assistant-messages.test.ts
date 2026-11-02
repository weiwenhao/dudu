import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssuesApi } from '../host/assistant/issues/api.mjs';
import { issueMessage } from '../host/assistant/issues/message.mjs';

test('plain comments, addresses and code examples do not send work; explicit mentions name one recipient', () => {
  for (const text of ['普通留言', 'mail@claude.com', 'mail@ChatGPT.com', '`@claude run`', '`@ChatGPT run`', '```\n@dudu change status\n```']) assert.equal(issueMessage(text).target, null, text);
  assert.deepEqual(issueMessage('@Claude 看第三条', 'claude'), { target: 'claude', text: '@Claude 看第三条', body: '看第三条' });
  assert.equal(issueMessage('这个请 @dudu 看一下').target, 'dudu');
  assert.equal(issueMessage('@嘟嘟 看一下').target, 'dudu');
  assert.equal(issueMessage('@agent 接着做', 'codex').target, 'codex');
  for (const [text, error] of [['@agent 接着做', 'choose_agent'], ['@claude @dudu 做', 'multiple_targets'], ['@dudu', 'empty_request'], ['@codex 做', 'recipient_unavailable'], ['', 'invalid_message']]) {
    assert.equal(issueMessage(text).error, error);
  }
  assert.equal(issueMessage('@claude 做', 'codex').error, 'recipient_unavailable');
  assert.equal(issueMessage('@dudu 做', 'codex').target, 'dudu');
});

test('display names and legacy aliases route to the assigned agent without changing the forwarded words', () => {
  for (const [agent, aliases] of [
    ['claude', ['Claude', 'claude', 'CLAUDE']],
    ['codex', ['ChatGPT', 'chatgpt', 'CHATGPT', 'Codex', 'codex']],
    ['deepseek', ['DeepSeek', 'deepseek', 'DEEPSEEK']],
  ] as const) {
    for (const alias of aliases) {
      const text = `@${alias} 继续处理，不加任何上下文。`;
      assert.deepEqual(issueMessage(text, agent), { target: agent, text, body: '继续处理，不加任何上下文。' });
    }
  }
  assert.equal(issueMessage('@Dudu 看一下').target, 'dudu');
  assert.equal(issueMessage('@ChatGPT @codex 继续', 'codex').target, 'codex', 'two aliases name the same recipient');
  assert.equal(issueMessage('@ChatGPT 做', 'claude').error, 'recipient_unavailable');
  assert.equal(issueMessage('@ChatGPT @Claude 做', 'codex').error, 'multiple_targets');
  assert.equal(issueMessage('@ChatGPT', 'codex').error, 'empty_request');
});

test('the unified message API saves plain comments without clearing questions or calling an agent', async () => {
  const issues = createIssues({ file: ':memory:' });
  const delivered: any[] = [];
  const api = createIssuesApi({ issues, onMention: (...args: any[]) => { delivered.push(args); return { outcome: 'success' }; } });
  const post = async (body: any) => (await api.handle('message', new Request('http://local/', { method: 'POST', body: JSON.stringify(body) }))).json();
  try {
    const issue = issues.add({ title: '合同', ask: '第三条接受吗？' }).issue;
    assert.equal((await post({ id: issue.id, text: '这是我加的备注。' })).outcome, 'success');
    assert.equal(delivered.length, 0);
    assert.equal(issues.get(issue.id).issue.ask, '第三条接受吗？');
    assert.equal((await post({ id: issue.id, text: '@claude 接受第三条' })).code, 'recipient_unavailable');
    assert.equal(delivered.length, 0);
    assert.equal((await post({ id: issue.id, text: '@dudu 先整理一下上下文' })).outcome, 'success');
    assert.equal(delivered[0][1].target, 'dudu');
    issues.update(issue.id, { project: { name: 'docs', path: '/work/docs' } });
    issues.assign(issue.id, { agent: 'codex' });
    assert.equal((await post({ id: issue.id, text: '@ChatGPT 接着处理' })).outcome, 'success');
    assert.equal(delivered[1][1].target, 'codex');
    assert.equal(delivered[1][1].body, '接着处理');
    assert.equal(issues.get(issue.id).log[0].text, '@ChatGPT 接着处理');
    assert.equal(issues.get(issue.id).log.filter((e: any) => e.kind === 'note').length, 3);
  } finally { issues.close(); }
});

test('delivery errors tell the composer its comment is already saved and do not masquerade as success', async () => {
  const issues = createIssues({ file: ':memory:' });
  const api = createIssuesApi({ issues, onMention: () => { throw new Error('offline'); } });
  try {
    const issue = issues.add({ title: '合同' }).issue;
    const result = await (await api.handle('message', new Request('http://local/', { method: 'POST', body: JSON.stringify({ id: issue.id, text: '@dudu 看一下' }) }))).json();
    assert.equal(result.outcome, 'error');
    assert.equal(result.saved, true);
    assert.equal(result.code, 'delivery_failed');
    assert.equal(issues.get(issue.id).log[0].text, '@dudu 看一下');
  } finally { issues.close(); }
});

test('project references survive sorting and restart; clearing a project hides its reference and reservations are never reused', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-numbering-'));
  const file = join(folder, 'issues.db');
  let issues = createIssues({ file });
  try {
    const one = issues.add({ title: 'first' }).issue;
    const two = issues.add({ title: 'second' }).issue;
    issues.update(one.id, { priority: 'urgent', project: { name: 'new', path: '/work/new' } });
    assert.equal(issues.get(one.id).issue.ref, 'NEW-1');
    for (const query of ['NEW-1', 'new-1', '#1']) {
      assert.equal(issues.search(query).items[0].id, one.id);
      assert.equal(issues.list({ tab: 'all', filter: { q: query } }).items[0].id, one.id);
    }
    const token = issues.forget(one.id).token;
    assert.equal(issues.forget(one.id, { token }).forgotten, true);
    issues.close();
    issues = createIssues({ file });
    assert.equal(issues.get(two.id).issue.ref, null);
    assert.equal(issues.add({ title: 'third', project: { name: 'new', path: '/work/new' } }).issue.ref, 'NEW-2');
    assert.equal(issues.search('NEW-1').total, 0);
  } finally { issues.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('agents require absolute project folders; an assigned agent and project are immutable', () => {
  const issues = createIssues({ file: ':memory:' });
  try {
    const issue = issues.add({ title: 'work' }).issue;
    assert.equal(issues.assign(issue.id, { agent: 'claude' }).outcome, 'needs_clarification');
    const assigned = issues.assign(issue.id, { agent: 'claude', project: { name: 'one', path: '/work/one' }, session: 'dsh:one' });
    assert.equal(assigned.outcome, 'success');
    const moved = issues.update(issue.id, { project: { name: 'two', path: '/work/two' } });
    assert.equal(moved.outcome, 'needs_clarification');
    assert.equal(issues.update(issue.id, { project: null }).outcome, 'needs_clarification');
    assert.equal(issues.assign(issue.id, { agent: 'codex' }).outcome, 'needs_clarification');
    assert.equal(issues.assign(issue.id, { agent: null }).outcome, 'needs_clarification');
    assert.equal(issues.get(issue.id).issue.session, 'dsh:one');
    assert.equal(issues.get(issue.id).issue.project.path, '/work/one');
  } finally { issues.close(); }
});
