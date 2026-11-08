import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssuesApi } from '../host/assistant/issues/api.mjs';
import { issueMessage } from '../host/assistant/issues/message.mjs';

const ref = { attachmentId: 'sha256:test', bytes: 12, name: 'notes.txt' };

test('issue attachments bind atomically to one comment, remain scoped to the issue and are removed with it', (t) => {
  const issues = createIssues({ file: ':memory:' });
  t.after(() => issues.close());
  const one = issues.add({ title: 'One' }).issue;
  const two = issues.add({ title: 'Two' }).issue;
  const first = issues.stageAttachment(one.id, 'file', ref).item;
  const other = issues.stageAttachment(two.id, 'file', ref).item;
  assert.equal(issues.log(one.id, { kind: 'note', text: 'Bad binding', attachmentIds: [first.id, other.id] }).outcome, 'needs_clarification');
  assert.equal(issues.get(one.id).log.some((entry: any) => entry.text === 'Bad binding'), false);
  assert.equal(issues.attachment(two.id, first.id).outcome, 'error');
  const committed = issues.log(one.id, { kind: 'note', text: '', attachmentIds: [first.id], requestId: 'first' });
  assert.equal(committed.outcome, 'success', JSON.stringify(committed));
  assert.deepEqual(committed.entry.data.attachments, [first]);
  assert.equal(issues.log(one.id, { kind: 'note', text: 'Reuse', attachmentIds: [first.id] }).outcome, 'needs_clarification');
  assert.equal(issues.export().attachments.length, 1, 'an unbound draft is not part of the issue export');
  const preview = issues.forget(one.id);
  assert.equal(issues.forget(one.id, { token: preview.token }).forgotten, true);
  assert.equal(issues.attachment(one.id, first.id).outcome, 'error');
  assert.equal(issues.attachment(two.id, other.id).outcome, 'success');
});

test('attachment submissions are idempotent and cannot change the contents of a completed request', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  t.after(() => issues.close());
  const issue = issues.add({ title: 'Retry attachment' }).issue;
  const { item } = issues.stageAttachment(issue.id, 'file', ref);
  let deliveries = 0;
  const api = createIssuesApi({ issues, onMention: (_issue: any, _message: any, entry: any) => {
    deliveries++;
    assert.deepEqual(entry.data.attachments, [item]);
    return { outcome: 'success' };
  } });
  const send = async (body: any) => (await api.handle('message', new Request('http://local/', { method: 'POST', body: JSON.stringify(body) }))).json();
  const body = { id: issue.id, text: '@dudu', attachmentIds: [item.id], requestId: 'same-request' };
  const sent = await send(body);
  assert.equal(sent.outcome, 'success', JSON.stringify(sent));
  const again = await send(body);
  assert.equal(again.outcome, 'no_op');
  assert.equal(again.entry.id, sent.entry.id);
  assert.equal(deliveries, 1);
  assert.equal((await send({ ...body, text: '@dudu Different words' })).outcome, 'needs_clarification');
  assert.equal((await send({ ...body, attachmentIds: [] })).outcome, 'needs_clarification');
  assert.equal(issues.get(issue.id).log.filter((entry: any) => entry.kind === 'note').length, 1);
});

test('attachment-only comments and mentions are accepted only with completed uploads', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  t.after(() => issues.close());
  assert.equal(issueMessage('', null, { hasAttachments: true }).text, '');
  assert.deepEqual(issueMessage('@DeepSeek', 'deepseek', { hasAttachments: true }), { text: '@DeepSeek', body: '', target: 'deepseek' });
  assert.equal(issueMessage('@dudu').error, 'empty_request');
  const issue = issues.add({ title: 'No agent required' }).issue;
  const api = createIssuesApi({ issues });
  const send = async (body: any) => (await api.handle('message', new Request('http://local/', { method: 'POST', body: JSON.stringify(body) }))).json();
  const { item } = issues.stageAttachment(issue.id, 'file', ref);
  assert.equal((await send({ id: issue.id, text: '', attachmentIds: [item.id, item.id] })).outcome, 'needs_clarification');
  assert.equal((await send({ id: issue.id, text: '', attachmentIds: ['not-uploaded'] })).outcome, 'needs_clarification');
  assert.equal((await send({ id: issue.id, text: '', attachments: [{ type: 'file', attachment: ref }] })).outcome, 'needs_clarification');
  assert.equal((await send({ id: issue.id, text: '', attachmentIds: [item.id] })).outcome, 'success');
  assert.equal(issues.get(issue.id).issue.session, null);
});
