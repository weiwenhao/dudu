/**
 * Capture only the original provider's raw registration. The provider keeps
 * its actual context, services, native helper and authorization owner.
 */
export function captureComputerUseProvider(ctx) {
  let tool = null;
  let prompt = null;
  let initializationPrompt = false;
  const methods = (service, overrides) => new Proxy(service, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const tools = methods(ctx.tools, { register: (definition) => {
    if (definition.name !== 'cua' || tool) throw new Error('Unsupported Computer Use provider registration.');
    tool = definition;
  } });
  const systemPrompt = methods(ctx.systemPrompt, { section: (section) => {
    if (section.name !== 'computer-use:dsh-cua' || prompt) throw new Error('Unsupported Computer Use provider prompt.');
    prompt = section;
  } });
  const context = methods(ctx, {
    tools, systemPrompt,
    get: (name) => initializationPrompt && name === 'ptcRuntime' ? { retainsState: true } : ctx.get(name),
    on: (name, listener, ...options) => ctx.on(name, name === 'tools/execute'
      // The released macOS provider's held-key owner recognizes run_code.
      // Translate only its observer; the real execution and all other policy,
      // guards and logs keep the standalone capability's name and token.
      ? (exec, next) => listener(exec.name === 'cua_run_code' ? { ...exec, name: 'run_code' } : exec, next)
      : listener, ...options),
  });
  return {
    context,
    registrations() {
      if (!tool || !prompt || typeof prompt.text !== 'function') throw new Error('The installed Computer Use provider has no supported raw registration.');
      let text;
      initializationPrompt = true;
      try { text = prompt.text(); } finally { initializationPrompt = false; }
      const match = text.match(/\n\nPersistent PTC initialization:\s*```ts\n([\s\S]*?)\n```/);
      if (!match) throw new Error('The installed Computer Use provider has no supported facade initialization.');
      return {
        tool, prompt,
        programPrompt: { ...prompt, text: text.slice(0, match.index), interpolate: false },
        initialization: match[1],
      };
    },
  };
}
