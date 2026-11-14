import { AsyncLocalStorage } from 'node:async_hooks';
import { NATIVE_ENGLISH } from './native-strings.mjs';

const scope = new AsyncLocalStorage();
const DEFAULT_LOCALE = 'zh-CN'; // Phones released before language negotiation used Chinese.

export function resolveNativeLocale(header) {
  if (typeof header !== 'string' || header.length > 512) return DEFAULT_LOCALE;
  const choices = header.split(',').slice(0, 16).map((part, index) => {
    const match = /^\s*(en(?:-[a-z0-9]+)*|zh(?:-[a-z0-9]+)*)(?:\s*;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/iu.exec(part);
    return match ? { locale: /^en/iu.test(match[1]) ? 'en' : 'zh-CN', q: Number(match[2] ?? 1), index } : null;
  }).filter((choice) => choice?.q > 0).sort((a, b) => b.q - a.q || a.index - b.index);
  return choices[0]?.locale ?? DEFAULT_LOCALE;
}

export const nativeLocale = () => scope.getStore() ?? DEFAULT_LOCALE;
export const withNativeLocale = (header, operation) => scope.run(resolveNativeLocale(header), operation);

/** Only explicit App-owned copy goes through here. Never walk arbitrary response/user data. */
export function nativeText(source, ...values) {
  const key = Array.isArray(source)
    ? source.reduce((key, part, index) => key + (index ? `{${index - 1}}` : '') + part, '')
    : source;
  let template = nativeLocale() === 'en' ? NATIVE_ENGLISH[key] ?? key : key;
  if (template && typeof template === 'object') {
    const count = Number(values[template.count ?? 0]);
    const form = new Intl.PluralRules(nativeLocale()).select(count);
    template = template[form] ?? template.other;
  }
  // A replacement value may itself contain braces. Do not substitute it a second time.
  return template.replace(/\{(\d+)\}/gu, (match, index) => index < values.length ? String(values[index]) : match);
}

/** Module-level label dictionaries resolve when read, inside the requesting phone's scope. */
export const nativeLabels = (labels) => new Proxy({ ...labels }, {
  get(target, property) {
    const value = Reflect.get(target, property);
    return typeof value === 'string' ? nativeText(value) : value;
  },
  set: () => false,
  defineProperty: () => false,
  deleteProperty: () => false,
});
