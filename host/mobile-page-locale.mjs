/** Used only in the phone's isolated DSH document. DSH's LocaleRuntime accepts no
 * settings host; its official native bootstrap then supplies the page's language.
 */
export function mobileLocaleContext(ctx) {
  const forms = new Proxy(Object.create(null), {
    get(_target, key) {
      if (key === 'get') return (namespace, ...args) => namespace === 'locale'
        ? undefined : ctx.configForms.get(namespace, ...args);
      const value = Reflect.get(ctx.configForms, key, ctx.configForms);
      return typeof value === 'function' ? value.bind(ctx.configForms) : value;
    },
  });
  return new Proxy(Object.create(null), {
    get(_target, key) {
      if (key === 'configForms') return forms;
      const value = Reflect.get(ctx, key, ctx);
      return typeof value === 'function' ? value.bind(ctx) : value;
    },
  });
}
