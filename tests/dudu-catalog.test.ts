import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duduCatalog } from '../host/assistant/dispatch/dsh-llm.mjs';

// 嘟嘟's own lookups of models (owner, 2026-11-27: 「嘟嘟自己的查询模型列表的时候只问 deepseek 那几家」): DSH's `modelCatalog()` asks every route, the harnesses too, and for Antigravity that is a
// conversation left in its own store each time. What 嘟嘟 asks for itself goes to the plain routes only.

const PROVIDERS = [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'claude', name: 'Claude' }, { id: 'codex', name: 'ChatGPT' }, { id: 'antigravity', name: 'Antigravity' }];

function dsh() {
  const asked: string[] = [];
  const llm = {
    listProviders: () => PROVIDERS,
    listModels: async (provider: string) => { asked.push(provider); return [{ id: 'deepseek-flash', name: 'DeepSeek Flash', provider }]; },
    resolveModelInfo: async (provider: string, model: string) => { asked.push(`${provider}/${model}`); return { reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high' } }; },
  };
  return { ctx: { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'claude', model: 'default' }) } }, asked };
}

test('only the plain routes are asked, and the catalog has the shape of DSH\'s', async () => {
  const { ctx, asked } = dsh();
  const catalog = await duduCatalog(ctx);
  assert.deepEqual(asked, ['deepseek-official', 'deepseek-official/deepseek-flash'], 'no harness was asked about its models');
  assert.deepEqual(catalog.groups.map((group: any) => group.id), ['deepseek-official']);
  assert.deepEqual(catalog.groups[0].models[0], { id: 'deepseek-flash', name: 'DeepSeek Flash', reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high' } });
  assert.deepEqual(catalog.default, { provider: 'claude', model: 'default' }, 'DSH\'s own default is passed on; choosing among the plain models is the caller\'s');
});

test('a route that cannot say is left out, and a DSH that cannot be asked route by route gives its catalog without the harnesses', async () => {
  const { ctx } = dsh();
  ctx.llm.listModels = async (provider: string) => { if (provider === 'deepseek-official') throw new Error('offline'); return []; };
  assert.deepEqual((await duduCatalog(ctx)).groups, []);
  const old = { sessionController: { modelCatalog: async () => ({ default: { provider: 'claude', model: 'default' }, groups: [{ id: 'claude', models: [{ id: 'default' }] }, { id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }] }) } };
  const catalog = await duduCatalog(old);
  assert.deepEqual(catalog.groups.map((group: any) => group.id), ['deepseek-official']);
});
