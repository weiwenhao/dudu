import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// DeepSeek is paid from the account's wallet (DSH's "DeepSeek Account"), not from a plan with usage windows, so its row of the Quota
// widget is the balance DSH's own account page shows. DSH's account service reads it: the plugin never sees the account's credentials.
// A DeepSeek API key has no balance in DSH, so nothing is shown for one.

const SYMBOLS = { CNY: '¥', USD: '$' };

/**
 * A wallet's decimal string as DSH's account page writes it: "¥12.34", rounded down to the cent, "<¥0.01" below a cent, thousands
 * grouped. Null for text that is not a number. The digits are handled as text, so a cent is never lost to floating point.
 */
export function formatMoney(amount, currency) {
  const symbol = SYMBOLS[currency] ?? '';
  const match = /^(-?)(\d*)\.?(\d*)(?:e([+-]?\d{1,2}))?$/i.exec(String(amount ?? '').trim());
  if (!match || !(match[2] || match[3])) return null;
  const [, sign, whole, fraction, exponent] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent ?? 0); // where the decimal point falls in `digits`
  const integer = (point <= 0 ? '0' : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point)).replace(/^0+(?=\d)/, '');
  const decimals = point <= 0 ? '0'.repeat(-point) + digits : point >= digits.length ? '' : digits.slice(point);
  const cents = decimals.padEnd(2, '0').slice(0, 2);
  if (!/[1-9]/.test(digits)) return `${symbol}0.00`;
  if (integer === '0' && cents === '00') return sign ? `-${symbol}0.01` : `<${symbol}0.01`;
  return `${sign}${symbol}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

/**
 * The DeepSeek row: the balance of each wallet ("¥12.34", one amount per currency), "—" (`unavailable`) when it could not be read, and
 * nothing (`hidden`) without an account to read it for.
 */
export function balanceView({ signedIn, balance } = {}) {
  const base = { id: 'deepseek', name: 'DeepSeek', kind: 'balance', plan: '', limited: false, windows: [] };
  if (!signedIn) return { ...base, state: 'hidden' };
  const amounts = balance?.status === 'ready'
    ? (balance.value ?? []).map((wallet) => ({ currency: wallet.currency, text: formatMoney(wallet.balance, wallet.currency) })).filter((amount) => amount.text)
    : [];
  return amounts.length ? { ...base, state: 'ok', balance: amounts } : { ...base, state: 'unavailable' };
}

/** DSH's own version, which its account calls carry as the client's: the package that started this process, or nothing. */
export async function dshVersion(entry = process.argv[1]) {
  let directory = dirname(String(entry ?? ''));
  for (let step = 0; step < 6; step++) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (/^@deepseek-ai\/dsh(?:-|$)/.test(manifest.name ?? '') && typeof manifest.version === 'string') return manifest.version;
    } catch { /* no manifest here */ }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/**
 * Reads the balance through DSH's account service (`ctx.deepseekAccount`; `account()` hands it over, or nothing when this DSH has none).
 * The account is looked at first: without a stored sign-in there is nothing to read.
 */
export function createAccountBalance({ account, version = dshVersion, locale = Intl.DateTimeFormat().resolvedOptions().locale }) {
  let known;
  return async function readBalance() {
    const service = account();
    if (!service) return balanceView({ signedIn: false });
    let signedIn = false;
    try { signedIn = (await service.getState())?.status === 'credential-stored'; } catch { /* the account cannot be asked: no row */ }
    if (!signedIn) return balanceView({ signedIn: false });
    try {
      known ??= Promise.resolve(version()).then((value) => value || '0.0.0');
      const client = { version: await known, locale, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 };
      return balanceView({ signedIn: true, balance: await service.getBalance(client) });
    } catch { return balanceView({ signedIn: true }); }
  };
}
