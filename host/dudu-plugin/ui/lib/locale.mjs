// DSH owns the preference. This store mirrors its resolved locale, including "follow browser".
let active = 'en';
const listeners = new Set();

export const getLocale = () => active;
export const intlLocale = () => active === 'zh' ? 'zh-CN' : 'en-US';
export const subscribeLocale = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

export function setLocale(value) {
  const next = /^zh(?:-|$)/i.test(value ?? '') ? 'zh' : 'en';
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener();
}

export function connectLocale(service) {
  const update = () => setLocale(service.getLocale().active);
  update();
  return service.subscribe(update);
}

// Namespace identities stay stable: modules may keep T.settings.general without freezing its language.
export function localized(en, zh) {
  const namespaces = {};
  return new Proxy(en, {
    get(target, key) {
      const value = target[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return namespaces[key] ??= localized(value, zh?.[key] ?? {});
      }
      return active === 'zh' ? (zh?.[key] ?? value) : value;
    },
  });
}

export const formatDateTime = (value, options) => new Date(value).toLocaleString(intlLocale(), options);
