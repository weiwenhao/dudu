const HARNESS = new Set(['claude', 'codex']);
export const providerFamily = (provider) => HARNESS.has(provider) ? provider : 'deepseek';
const groupRank = (group) => group.id === 'deepseek-account' ? 0 : group.id === 'deepseek-official' ? 1 : 2;

/** DSH's registered models, grouped the same way as the desktop provider selector. */
export function sessionProviders(catalog) {
  const groups = (catalog?.groups ?? []).filter((group) => typeof group.id === 'string' && group.models?.length);
  const providers = [];
  const deepseek = groups.filter((group) => !HARNESS.has(group.id));
  if (deepseek.length) providers.push({ id: 'deepseek', name: 'DeepSeek', groups: deepseek });
  for (const group of groups) if (HARNESS.has(group.id)) providers.push({ id: group.id, name: group.name || (group.id === 'codex' ? 'ChatGPT' : 'Claude'), groups: [group] });
  return providers;
}

export function providerDefault(provider, catalog) {
  const fallback = catalog?.default;
  const groups = [...provider.groups].sort((a, b) => groupRank(a) - groupRank(b));
  if (fallback && providerFamily(fallback.provider) === provider.id
    && groups.some((group) => group.id === fallback.provider && group.models.some((model) => model.id === fallback.model))) return fallback;
  const group = groups[0];
  const model = group.models[0];
  return { provider: group.id, model: model.id, ...(model.reasoning?.defaultEffort ? { reasoningEffort: model.reasoning.defaultEffort } : {}) };
}
