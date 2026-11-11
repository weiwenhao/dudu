import { createAccountBalance, formatMoney } from '../native/balance.mjs';
import { quotaFetch } from './system-proxy.mjs';

// DeepSeek has two things to read (owner, 2026-11-11: "deepseek 的账号和 api key 的余额都显示吧"): the wallet of DSH's DeepSeek account, which DSH's own account service reads (no credential
// reaches this plugin), and the balance of an API key, read as magpie reads it: `GET https://api.deepseek.com/user/balance` with the key. Both are balances, not allowances.

export const BALANCE_URL = 'https://api.deepseek.com/user/balance';

/** The wallet of the signed-in DeepSeek account: `{ state: 'ok', plan: 'Account', kind: 'balance', balance }`; `none` without an account; an error when it could not be read. */
export function createAccountReader({ account }) {
  const read = createAccountBalance({ account });
  return async () => {
    const row = await read();
    if (row.state === 'hidden') return { state: 'none' };
    if (row.state !== 'ok') throw new Error('The DeepSeek account balance could not be read.');
    return { state: 'ok', plan: 'Account', kind: 'balance', balance: row.balance.map(({ text }) => ({ text })) };
  };
}

/**
 * The DeepSeek API key DSH keeps, found as DSH's own code finds a provider's key: the provider's settings profile names the credential (`apiKeyEnv`) and the credential store holds it.
 * The key is read when a reading needs it, kept nowhere, and sent to api.deepseek.com only. Nothing when this DSH has no such provider, setting or store.
 */
export function createKeyResolver({ providers, settings, credentials, provider = 'deepseek-official' }) {
  return async () => {
    const store = credentials(); const config = settings(); const list = providers();
    if (!store || !config || !list) return undefined;
    const entry = list.find((item) => item.provider === provider);
    if (!entry) return undefined;
    let profile = config.describe({ redactSecrets: true }).find((namespace) => namespace.ns === entry.settingsNs)?.value;
    for (const key of entry.settingsPath ?? []) profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined;
    const ref = typeof profile === 'object' && profile !== null ? Reflect.get(profile, 'apiKeyEnv') : undefined;
    if (typeof ref !== 'string' || !ref) return undefined;
    const hit = await store.resolve(ref);
    return typeof hit?.value === 'string' && hit.value ? hit.value : undefined;
  };
}

/** The balance of an API key: `{ state: 'ok', plan: 'API', kind: 'balance', balance }`; `none` without a key; `login` when DeepSeek refuses it; an error when the answer did not come. */
export function createKeyReader({ resolveKey, fetch: send = quotaFetch, timeoutMs = 20_000 }) {
  return async ({ signal } = {}) => {
    const key = await resolveKey();
    if (!key) return { state: 'none' };
    const response = await send(BALANCE_URL, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 || response.status === 403) return { state: 'login' };
    if (!response.ok) throw new Error(`DeepSeek's balance endpoint answered ${response.status}.`);
    const body = await response.json();
    const amounts = (Array.isArray(body?.balance_infos) ? body.balance_infos : [])
      .map((info) => ({ text: formatMoney(info?.total_balance, info?.currency) })).filter((amount) => amount.text);
    if (!amounts.length) throw new Error("DeepSeek's balance answer has no amount.");
    return { state: 'ok', plan: 'API', kind: 'balance', balance: amounts };
  };
}

/** The two DeepSeek sources of the quota list. They are always listed and say `none` when there is nothing to read, so that a key added later is found without a restart. */
export function deepseekSources({ account, resolveKey, fetch: send }) {
  const readAccount = createAccountReader({ account });
  const readKey = createKeyReader({ resolveKey, fetch: send });
  return [
    { id: 'deepseek-account', agent: 'deepseek', name: 'DeepSeek', read: () => readAccount() },
    { id: 'deepseek-key', agent: 'deepseek', name: 'DeepSeek', read: (signal) => readKey({ signal }) },
  ];
}
