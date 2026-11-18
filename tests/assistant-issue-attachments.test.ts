import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssuesApi } from '../host/assistant/issues/api.mjs';
import { issueMessage } from '../host/assistant/issues/message.mjs';
import { createIssueAttachmentApi } from '../host/assistant/issues/attachments.mjs';
import { createWithAttachments } from '../host/assistant/issues/create-with-attachments.mjs';
import { createAssignment } from '../host/assistant/home/assign.mjs';
import { createAgentSessions } from '../host/assistant/home/agent-sessions.mjs';
import { fakeDsh } from './fake-dsh.mjs';

const ref = { attachmentId: 'sha256:test', bytes: 12, name: 'notes.txt' };

function sessionWorld(t: any) {
  const fake = fakeDsh();
  const issues = createIssues({ file: ':memory:' });
  const sessions = createAgentSessions({ dsh: fake.dsh });
  let imageUnavailable = false;
  const attachments = createIssueAttachmentApi({ issues, attachments: () => ({
    async readImage() {
      if (imageUnavailable) throw new Error('Image unavailable.');
      return { data: Buffer.from('picture') };
    },
    async *readFileStream() { yield Buffer.from('notes'); },
  }) });
  const uploads: any[] = [];
  const assignment = createAssignment({
    issues, agentSessions: sessions,
    attachmentsOf: (issue: any, entry: any, sessionId: string) => attachments.promptParts(issue, entry, sessionId, {
      async uploadStream({ data, ...options }: any) {
        const chunks = [];
        for await (const chunk of data) chunks.push(chunk);
        uploads.push({ ...options, text: Buffer.concat(chunks).toString() });
        return { receiptId: `receipt:${options.sessionId}` };
      },
    }),
  });
  const api = createIssuesApi({ issues, onAssign: (issue: any) => assignment.start(issue) });
  t.after(async () => { await assignment.dispose(); sessions.dispose(); issues.close(); });
  const fields = { title: '检查这张图', brief: '请看图片和文件。', project: { name: 'docs', path: '/work/docs' }, agent: 'claude' };
  const image = { attachmentId: 'sha256:image', bytes: 7, mediaType: 'image/png', name: 'picture.png' };
  return { ...fake, issues, api, assignment, fields, image, uploads, loseImage: () => { imageUnavailable = true; } };
}

test('creation attachments are saved before assignment and accompany the first prompt, without a second text-only turn', async (t) => {
  const w = sessionWorld(t);
  let body: any;
  const made = await createWithAttachments({
    fields: w.fields,
    add: (fields: any) => w.api.execute('add', { fields }),
    prepare: (issue: any) => {
      assert.equal(w.ofKind('createSession').length, 0, 'uploading cannot race a running worker');
      assert.equal(issue.agent, null);
      const file = w.issues.stageAttachment(issue.id, 'file', ref).item;
      const image = w.issues.stageAttachment(issue.id, 'image', w.image).item;
      body = { id: issue.id, text: '', attachmentIds: [file.id, image.id], initial: true, requestId: 'creation' };
      return w.api.execute('message', body);
    },
    assign: (id: number, agent: string) => w.api.execute('assign', { id, agent }),
  });
  assert.equal(made.outcome, 'success', JSON.stringify(made));
  assert.deepEqual(w.ofKind('prompt').map((call: any) => call.slice(1)), [[
    's1', '检查这张图\n\n请看图片和文件。',
    { attachments: [
      { type: 'file', receiptId: 'receipt:s1' },
      { type: 'image', mediaType: 'image/png', data: Buffer.from('picture').toString('base64'), name: 'picture.png' },
    ] },
  ]]);
  assert.deepEqual(w.uploads, [{ sessionId: 's1', name: 'notes.txt', text: 'notes' }]);
  const current = w.issues.get(made.issue.id).issue;
  assert.equal(current.session, 'dsh:s1');
  assert.equal((await w.api.execute('message', body)).outcome, 'no_op', 'a completed creation remains idempotent after session start');
  assert.equal((await w.api.execute('message', { ...body, initial: false })).outcome, 'needs_clarification');
  assert.equal((await w.assignment.start(current)).outcome, 'no_op');
  assert.equal(w.ofKind('prompt').length, 1, 'neither retry nor reopen duplicates the initial message');
});

test('an unassigned issue retains its creation pictures for later assignment and does not forward ordinary comments', async (t) => {
  const w = sessionWorld(t);
  const made = await createWithAttachments({
    fields: { ...w.fields, agent: null },
    add: (fields: any) => w.api.execute('add', { fields }),
    prepare: (issue: any) => {
      const image = w.issues.stageAttachment(issue.id, 'image', w.image).item;
      return w.api.execute('message', { id: issue.id, text: '', initial: true, attachmentIds: [image.id] });
    },
    assign: () => { throw new Error('No agent was chosen.'); },
  });
  assert.equal(made.outcome, 'success');
  assert.equal(w.ofKind('prompt').length, 0);
  const ordinary = w.issues.stageAttachment(made.issue.id, 'file', ref).item;
  await w.api.execute('message', { id: made.issue.id, text: '只留在事项里的讨论', attachmentIds: [ordinary.id] });
  const assigned = await w.api.execute('assign', { id: made.issue.id, agent: 'codex' });
  assert.equal(assigned.outcome, 'success');
  assert.deepEqual(w.ofKind('prompt')[0][3].attachments, [
    { type: 'image', mediaType: 'image/png', data: Buffer.from('picture').toString('base64'), name: 'picture.png' },
  ]);
  assert.deepEqual(w.uploads, []);
  assert.equal(w.issues.initialAttachments(made.issue.id).items.length, 1);
});

test('an upload or stored-image failure preserves the issue attachments and never starts a text-only turn', async (t) => {
  const w = sessionWorld(t);
  const failed = await createWithAttachments({
    fields: w.fields,
    add: (fields: any) => w.api.execute('add', { fields }),
    prepare: () => { throw new Error('Upload failed.'); },
    assign: () => { throw new Error('Incomplete attachments must not assign.'); },
  });
  assert.equal(failed.attachmentsFailed, true);
  assert.equal(w.issues.get(failed.issue.id).issue.agent, null);
  assert.equal(w.ofKind('createSession').length, 0);

  const issue = w.issues.add({ ...w.fields, agent: null }).issue;
  const image = w.issues.stageAttachment(issue.id, 'image', w.image).item;
  await w.api.execute('message', { id: issue.id, text: '', initial: true, attachmentIds: [image.id] });
  w.loseImage();
  await w.api.execute('assign', { id: issue.id, agent: 'claude' });
  assert.equal(w.ofKind('prompt').length, 0, 'an unreadable picture cannot silently disappear from the first prompt');
  assert.deepEqual(w.ofKind('archive')[0].slice(1), ['s1', { stop: true }]);
  assert.equal(w.issues.get(issue.id).issue.session, null);
  assert.equal(w.issues.attachment(issue.id, image.id).outcome, 'success', 'the saved reference remains available for repair');
});

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
