import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acknowledgementTargets, createCollectorAcknowledgements } from '../host/assistant/collectors/acknowledgements.mjs';
import { normalizeRecords } from '../host/assistant/inbox/records.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { checkCollectorResult } from '../host/assistant/inbox/submission.mjs';

const collector = { id: 'mentions', via: { kind: 'prompt', via: 'lark', prompt: '用 lark-cli 读取。' } };
const message = (id: string, extra: any = {}) => ({
  id, kind: 'message', title: '发布确认', from: 'Alice', text: '请确认。', at: '2026-11-19T23:15:00+08:00', thread: 'omt_one', acknowledge: true, ...extra,
});
const stored = (raw: any[]) => normalizeRecords(raw).records.map((row: any, id: number) => ({ ...row, id, connector: collector.id }));

test('GET targets only the primary Lark messages present in committed rows, never context or another service', () => {
  const raw = [
    message('om_primary', { context: [{ from: 'B', text: 'om_context' }] }),
    message('om_primary'),
    message('om_elsewhere', { thread: 'omt_another' }),
    message('om_changed', { update: true, title: '改标题' }),
    message('om_invalid; touch /tmp/never'),
  ];
  const rows = stored(raw.slice(0, 2));
  assert.deepEqual(acknowledgementTargets(collector, raw, rows), ['om_primary']);
  assert.deepEqual(acknowledgementTargets({ ...collector, id: 'other' }, raw, rows), []);
  assert.deepEqual(acknowledgementTargets({ ...collector, via: { kind: 'prompt', via: 'google', prompt: 'read google' } }, raw, rows), []);
  assert.deepEqual(acknowledgementTargets({ ...collector, via: { kind: 'mcp', via: 'lark', prompt: '' } }, raw, rows), [], 'never use a different MCP identity via the local CLI');
  assert.deepEqual(acknowledgementTargets(collector, raw, [{ ...rows[0], text: 'different material' }]), []);
});

test('GET is made only for what the collector\'s prompt asked to answer: the session marks the record, an unmarked or refused one is left alone', () => {
  const raw = [
    message('om_asked'),
    message('om_refused', { acknowledge: false, text: '另一条', thread: 'omt_refused' }),
    message('om_unmarked', { acknowledge: undefined, text: '又一条', thread: 'omt_unmarked' }),
  ];
  assert.deepEqual(acknowledgementTargets(collector, raw, stored(raw)), ['om_asked']);
  assert.equal(checkCollectorResult({ ok: true, records: [{ id: 'om_asked', kind: 'message', acknowledge: true }] }).ok, true, 'the schema the session sees has the switch');
  assert.equal(checkCollectorResult({ ok: true, records: [{ id: 'om_asked', acknowledge: 'yes' }] }).ok, false, 'only a boolean is a switch');
});

test('GET uses the existing user login and a fixed argv command; a reaction failure is reported without changing committed records', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  t.after(() => issues.close());
  const raw = [message('om_good'), message('om_denied', { text: '另一个请求', thread: 'omt_two' })];
  const rows = issues.inbox.ingest(collector.id, normalizeRecords(raw).records).added;
  const calls: any[] = [];
  const warnings: string[] = [];
  const acknowledge = createCollectorAcknowledgements({
    env: { PATH: '/bin', HOME: '/owner', DSH_API_KEY: 'private' },
    which: (name: string) => { assert.equal(name, 'lark-cli'); return '/bin/lark-cli'; },
    warn: (text: string) => warnings.push(text),
    run: async (file: string, args: string[], opts: any) => {
      calls.push({ file, args, opts });
      assert.ok(rows.every((row: any) => issues.inbox.get(row.id).record), 'remote write happens after storage');
      const id = JSON.parse(args[args.indexOf('--params') + 1]).message_id;
      return id === 'om_good'
        ? { code: 0, stdout: JSON.stringify({ ok: true, identity: 'user', data: { reaction_id: 'reaction_1', reaction_type: { emoji_type: 'Get' } } }), stderr: '' }
        : { code: 1, stdout: '', stderr: JSON.stringify({ ok: false, error: { subtype: 'missing_scope', message: 'private error material' } }) };
    },
  });
  const receipt = await acknowledge(collector, raw, rows);
  assert.deepEqual(receipt, {
    ok: false, emoji: 'Get', added: [{ messageId: 'om_good', reactionId: 'reaction_1' }],
    failed: [{ messageId: 'om_denied', code: 'missing_scope' }],
  });
  assert.equal(calls.length, 2, 'no automatic retry');
  for (const { args, opts } of calls) {
    assert.deepEqual(args.slice(0, 7), ['im', 'reactions', 'create', '--as', 'user', '--format', 'json']);
    assert.deepEqual(JSON.parse(args[args.indexOf('--data') + 1]), { reaction_type: { emoji_type: 'Get' } });
    assert.equal(opts.env.DSH_API_KEY, undefined);
  }
  assert.equal(issues.inbox.list({}).items.length, 2);
  assert.ok(!JSON.stringify({ warnings, receipt }).includes('private error material'));
});
