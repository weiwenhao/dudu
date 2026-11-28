// The model function of 嘟嘟's dispatch and memory, on DSH's own model service (ctx.llm): one call, the whole answer as text.
//
//   const llm = createDshLlm(ctx);
//   await llm([{ role: 'system', content }, { role: 'user', content }], { signal }) -> string
//
// It is the one place that streams a model call (dispatch/index.mjs and memory/ only know "messages in, text out"). The model is the one
// DSH has as its default, unless that is Claude Code or Codex: those are harnesses that run a whole session, not a place to ask one
// question, so then the first model of another route is used. A DSH that has none says so, and the callers do not do the step.
import { PERSONAL_IDENTITY } from '../identity.mjs';
import { HARNESS_IDS } from '../../providers/catalog.mjs';

const HARNESS = new Set(HARNESS_IDS);

/** The route and model for a one-shot call: DSH's default when it is a plain model, else the first model of a route that is. */
export function availableModel(catalog, wanted) {
  if (!wanted?.provider || !wanted.model || HARNESS.has(wanted.provider)) return null;
  const model = catalog?.groups?.find((group) => group.id === wanted.provider)?.models?.find((model) => model.id === wanted.model);
  if (!model) return null;
  const efforts = model.reasoning?.efforts ?? [];
  const effort = efforts.some((item) => item.id === wanted.reasoningEffort) ? wanted.reasoningEffort : model.reasoning?.defaultEffort;
  return { provider: wanted.provider, model: wanted.model, ...(effort ? { reasoningEffort: effort } : {}) };
}

export function pickModel(catalog, preferred) {
  const wanted = availableModel(catalog, preferred) ?? availableModel(catalog, catalog?.default);
  if (wanted) return wanted;
  for (const group of catalog?.groups ?? []) {
    const model = group?.models?.[0]?.id;
    if (group?.id && model && !HARNESS.has(group.id)) return availableModel(catalog, { provider: group.id, model });
  }
  return null;
}

const textOf = (content) => (typeof content === 'string' ? content : String(content ?? ''));

/**
 * The models DSH has on its plain routes (DeepSeek's): all that 嘟嘟's own work chooses from, in the shape of DSH's catalog. DSH's `modelCatalog()` asks every route, the harnesses too (Claude,
 * Codex, Antigravity...): each answer is a process that may be started for nothing, for Antigravity a conversation left in its own store, and one that cannot reach its servers takes 24 s
 * and holds the whole answer back. So what 嘟嘟 asks for itself it asks of the plain routes only (owner, 2026-11-27: 「嘟嘟自己的查询模型列表的时候只问 deepseek 那几家」). A DSH that cannot be
 * asked route by route gives its catalog, without the harnesses.
 */
export async function duduCatalog(ctx) {
  const read = (name) => { try { return ctx[name]; } catch { return undefined; } }; // reading a service the plugin did not ask for throws
  const llm = read('llm');
  if (typeof llm?.listProviders !== 'function' || typeof llm?.listModels !== 'function' || typeof llm?.resolveModelInfo !== 'function') {
    const controller = read('sessionController');
    if (!controller) throw new Error('This DSH has no sessionController service.');
    const catalog = await controller.modelCatalog();
    return { ...catalog, groups: (catalog?.groups ?? []).filter((group) => !HARNESS.has(group?.id)) };
  }
  const groups = [];
  for (const provider of llm.listProviders().filter((candidate) => !HARNESS.has(candidate.id))) {
    try {
      const models = await llm.listModels(provider.id);
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await llm.resolveModelInfo(provider.id, model.id);
        return {
          id: model.id, name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(resolved?.reasoning === undefined ? {} : {
            reasoning: {
              efforts: resolved.reasoning.efforts.map((effort) => ({ id: effort.id, name: effort.name, ...(effort.description === undefined ? {} : { description: effort.description }) })),
              ...(resolved.reasoning.defaultEffort === undefined ? {} : { defaultEffort: resolved.reasoning.defaultEffort }),
            },
          }),
          ...(model.badge === undefined ? {} : { badge: model.badge }),
        };
      }));
      if (entries.length) groups.push({ id: provider.id, name: provider.name, models: entries });
    } catch { /* a route that cannot say is left out, as DSH's own catalog leaves it */ }
  }
  const selection = read('agentDefaultModel')?.currentSelection?.();
  return { ...(selection ? { default: { ...selection } } : {}), routableProviders: groups.map((group) => group.id), groups, failures: [] };
}

export function createDshLlm(ctx) {
  const service = (name) => {
    let found;
    try { found = ctx[name]; } catch { found = undefined; } // reading a service the plugin did not ask for throws
    if (!found) throw new Error(`This DSH has no ${name} service.`);
    return found;
  };

  return async function llm(messages, { signal } = {}) {
    const picked = pickModel(await duduCatalog(ctx));
    if (!picked) throw new Error('This DSH has no model to ask.');
    const system = [...messages.filter((message) => message.role === 'system').map((message) => textOf(message.content)), PERSONAL_IDENTITY].join('\n\n');
    const asked = messages.filter((message) => message.role !== 'system').map((message) => ({ role: 'user', content: [{ type: 'text', text: textOf(message.content) }] }));
    let text = '';
    for await (const chunk of service('llm').stream({ ...picked, messages: asked, ...(system ? { system } : {}), signal })) {
      if (chunk.type === 'text-delta') text += chunk.text;
      else if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        throw new Error(chunk.reason.failure?.message ?? `The model call ${chunk.reason.kind === 'aborted' ? 'was stopped' : 'failed'}.`);
      }
    }
    return text;
  };
}
