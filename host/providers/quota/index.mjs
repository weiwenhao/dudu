import { createKeyResolver, deepseekSources } from './deepseek.mjs';
import { createQuota } from './service.mjs';
import { createQuotaStore } from './store.mjs';

export { createQuota, createQuotaStore };

/**
 * What the quota panel lists (owner, 2026-11-11: "不能写死，要从配置供应商列表里面已开启的读，后续我会接入 pi、grok 等"): each provider that is found and enabled in the providers list and says how
 * its quota is read (`driver.quota`), then DSH's own DeepSeek accounts. A provider that is added later brings its own `quota` and needs nothing here; one that is switched off is not asked.
 */
export function harnessQuotaSources(sources) {
  return sources.filter((source) => typeof source.driver?.quota === 'function').map((source) => ({
    id: source.id, agent: source.id, name: source.name,
    read: (signal) => source.driver.quota({ command: source.command, environment: source.environment, version: source.version, signal }),
  }));
}

/**
 * The quota service of this plugin: its readings are kept in `file`, and its sources are the enabled providers (`providers.sources`) and DSH's DeepSeek wallet and API key.
 * `dsh` hands over what DSH has (each may be missing in a DSH that lacks the service): `{ account, providers, settings, credentials }`.
 */
export function createPluginQuota({ file, providers, dsh, log, fetch }) {
  const deepseek = deepseekSources({
    account: dsh.account, fetch,
    resolveKey: createKeyResolver({ providers: dsh.providers, settings: dsh.settings, credentials: dsh.credentials }),
  });
  return createQuota({ store: createQuotaStore(file), sources: () => [...harnessQuotaSources(providers.sources()), ...deepseek], log });
}

/** The route: `{ ask }` -> what is stored, and a reading is started for the sources the floor lets be asked only when `ask` is true (a person opened the panel). */
export async function handleQuota(quota, request) {
  try {
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    return Response.json(await quota.request({ ask: body?.ask === true }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}
