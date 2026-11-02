// The model function on DSH's model service: which model it picks, how the answer is put together, and how a failure reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDshLlm, pickModel } from '../host/assistant/dispatch/dsh-llm.mjs';

const catalog = {
  default: { provider: 'deepseek-official', model: 'deepseek-flash' },
  groups: [{ id: 'claude', models: [{ id: 'opus' }] }, { id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }],
};

const fake = (chunks: any[], seen: any[] = []) => ({
  sessionController: { modelCatalog: async () => catalog },
  llm: { async *stream(options: any) { seen.push(options); for (const chunk of chunks) yield chunk; } },
});

test('the default model is used when it is a plain model, else the first model of a route that is', () => {
  assert.deepEqual(pickModel(catalog), { provider: 'deepseek-official', model: 'deepseek-flash' });
  assert.deepEqual(pickModel({ ...catalog, default: { provider: 'claude', model: 'opus' } }), { provider: 'deepseek-official', model: 'deepseek-flash' });
  assert.equal(pickModel({ default: { provider: 'codex', model: 'x' }, groups: [{ id: 'codex', models: [{ id: 'x' }] }] }), null);
  assert.equal(pickModel(undefined), null);
});

test('the system messages become the system prompt, the rest are user inputs, and the text deltas are the answer', async () => {
  const seen: any[] = [];
  const llm = createDshLlm(fake([
    { type: 'text-delta', index: 0, text: '{"items":' },
    { type: 'text-delta', index: 0, text: '[]}' },
    { type: 'finish', reason: { kind: 'stop' } },
  ], seen));
  const signal = new AbortController().signal;
  const answer = await llm([{ role: 'system', content: 'rules' }, { role: 'user', content: 'what came in' }], { signal });
  assert.equal(answer, '{"items":[]}');
  assert.equal(seen[0].provider, 'deepseek-official');
  assert.ok(seen[0].system.startsWith('rules\n\n'));
  assert.match(seen[0].system, /Your English name is Dudu/);
  assert.match(seen[0].system, /named boss, always lowercase/);
  assert.match(seen[0].system, /Keep quoted messages, source content and protocol identifiers verbatim/);
  assert.deepEqual(seen[0].messages, [{ role: 'user', content: [{ type: 'text', text: 'what came in' }] }]);
  assert.equal(seen[0].signal, signal);
});

test('a failed or stopped call throws what DSH said, and a DSH without a model or a service says so', async () => {
  const failed = createDshLlm(fake([{ type: 'finish', reason: { kind: 'error', failure: { message: '400: bad key' } } }]));
  await assert.rejects(failed([{ role: 'user', content: 'x' }]), /400: bad key/);
  const stopped = createDshLlm(fake([{ type: 'finish', reason: { kind: 'aborted' } }]));
  await assert.rejects(stopped([{ role: 'user', content: 'x' }]), /was stopped/);

  const noModel = createDshLlm({ ...fake([]), sessionController: { modelCatalog: async () => ({ default: null, groups: [] }) } });
  await assert.rejects(noModel([{ role: 'user', content: 'x' }]), /no model to ask/);
  const noService = createDshLlm({});
  await assert.rejects(noService([{ role: 'user', content: 'x' }]), /no sessionController service/);
});
