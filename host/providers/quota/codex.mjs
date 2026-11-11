import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { quotaFetch } from './system-proxy.mjs';

// A ChatGPT account's allowance as magpie reads it (owner, 2026-11-11: "codex/deepseek 也是参考 magpie"): no process, one HTTPS call to the ChatGPT backend's usage endpoint with the
// access token Codex keeps in its own sign-in file. The token is only READ: it is never refreshed or written back (an expired one is a sign-in that has ended; Codex renews it as it
// runs), never logged, and goes nowhere but the one URL below.

export const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const EXPIRY_SLACK = 30_000;
const clamp = (value) => Math.min(1, Math.max(0, value));
const titleCase = (value) => { const text = String(value ?? '').replaceAll('_', ' ').trim(); return text ? text[0].toUpperCase() + text.slice(1) : ''; };

/** What a JWT says in its payload, or nothing when it is not one. */
function claims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

/** Where Codex keeps its sign-in: `$CODEX_HOME/auth.json`, else `~/.codex/auth.json`. */
export const codexAuthFile = (environment = {}, base = process.env) => join(environment.CODEX_HOME ?? base.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');

/**
 * When the paid time of the plan ends (ms), as the sign-in's tokens say it (`chatgpt_subscription_active_until`): nothing when they do not say, and nothing when the time is gone by (a token that
 * has not been refreshed since says nothing of now). No request: the tokens are read anyway.
 */
export function paidUntil(tokens, now = Date.now()) {
  for (const token of [tokens?.id_token, tokens?.access_token]) {
    const at = Date.parse(claims(token)['https://api.openai.com/auth']?.chatgpt_subscription_active_until);
    if (Number.isFinite(at) && at > now) return at;
  }
  return undefined;
}

/** One window of the answer, by how long it is: 300 minutes is "5 小时", a week "每周". */
function windowOf(raw, key, now) {
  if (!raw || !Number.isFinite(raw.used_percent)) return undefined;
  const minutes = Number(raw.limit_window_seconds) / 60;
  const label = minutes === 300 ? '5 小时' : minutes === 10080 ? '每周'
    : minutes > 0 && minutes % 1440 === 0 ? `${minutes / 1440} 天` : minutes > 0 ? `${Math.round(minutes / 60)} 小时` : key;
  const resetsAt = Number.isFinite(raw.reset_at) && raw.reset_at > 0 ? raw.reset_at * 1000
    : Number.isFinite(raw.reset_after_seconds) && raw.reset_after_seconds >= 0 ? now + raw.reset_after_seconds * 1000 : undefined;
  return { key, label, used: clamp(raw.used_percent / 100), ...(resetsAt === undefined ? {} : { resetsAt }), core: minutes === 300 || minutes === 10080 };
}

/** The reading an answer of the usage endpoint makes. */
export function codexReading(answer, now = Date.now()) {
  const limits = answer?.rate_limit ?? {};
  const windows = [windowOf(limits.primary_window, 'primary', now), windowOf(limits.secondary_window, 'secondary', now)].filter(Boolean);
  if (!windows.length) throw new Error('The ChatGPT usage answer has no window.');
  const plan = titleCase(answer.plan_type);
  return { state: 'ok', ...(plan ? { plan } : {}), windows };
}

/**
 * What a ChatGPT account has left: `{ state: 'ok', plan, windows }`, `{ state: 'login' }` when the sign-in is gone or its token has run out, an error when the answer did not come.
 */
export async function readCodexQuota({ environment, version, signal, authFile = codexAuthFile(environment?.()), fetch: send = quotaFetch, now = Date.now, timeoutMs = 20_000 } = {}) {
  let auth;
  try { auth = JSON.parse(await readFile(authFile, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return { state: 'login' }; throw error; }
  const tokens = auth?.tokens ?? {};
  const token = typeof tokens.access_token === 'string' ? tokens.access_token : '';
  if (!token) return { state: 'login' }; // an API-key sign-in has no plan to read
  const expires = claims(token).exp;
  if (typeof expires === 'number' && expires * 1000 <= now() + EXPIRY_SLACK) return { state: 'login' };
  const account = tokens.account_id ?? claims(tokens.id_token)['https://api.openai.com/auth']?.chatgpt_account_id ?? claims(token)['https://api.openai.com/auth']?.chatgpt_account_id;
  const response = await send(USAGE_URL, {
    headers: {
      authorization: `Bearer ${token}`, accept: 'application/json', originator: 'codex_cli_rs', 'user-agent': `codex_cli_rs/${version || '0.0.0'}`,
      ...(typeof account === 'string' && account ? { 'chatgpt-account-id': account } : {}),
    },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 401 || response.status === 403) return { state: 'login' };
  if (!response.ok) throw new Error(`The ChatGPT usage endpoint answered ${response.status}.`);
  const reading = codexReading(await response.json(), now());
  const until = paidUntil(tokens, now());
  return until === undefined ? reading : { ...reading, until };
}
