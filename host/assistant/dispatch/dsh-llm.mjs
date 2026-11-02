// The model function of 嘟嘟's dispatch and memory, on DSH's own model service (ctx.llm): one call, the whole answer as text.
//
//   const llm = createDshLlm(ctx);
//   await llm([{ role: 'system', content }, { role: 'user', content }], { signal }) -> string
//
// It is the one place that streams a model call (dispatch/index.mjs and memory/ only know "messages in, text out"). The model is the one
// DSH has as its default, unless that is Claude Code or Codex: those are harnesses that run a whole session, not a place to ask one
// question, so then the first model of another route is used. A DSH that has none says so, and the callers do not do the step.
import { PERSONAL_IDENTITY } from '../identity.mjs';

const HARNESS = new Set(['claude', 'codex']);

/** The route and model for a one-shot call: DSH's default when it is a plain model, else the first model of a route that is. */
export function pickModel(catalog) {
  const wanted = catalog?.default;
  if (wanted?.provider && wanted?.model && !HARNESS.has(wanted.provider)) return { provider: wanted.provider, model: wanted.model };
  for (const group of catalog?.groups ?? []) {
    const model = group?.models?.[0]?.id;
    if (group?.id && model && !HARNESS.has(group.id)) return { provider: group.id, model };
  }
  return null;
}

const textOf = (content) => (typeof content === 'string' ? content : String(content ?? ''));

export function createDshLlm(ctx) {
  const service = (name) => {
    let found;
    try { found = ctx[name]; } catch { found = undefined; } // reading a service the plugin did not ask for throws
    if (!found) throw new Error(`This DSH has no ${name} service.`);
    return found;
  };

  return async function llm(messages, { signal } = {}) {
    const picked = pickModel(await service('sessionController').modelCatalog());
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
