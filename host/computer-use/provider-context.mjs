// Transport-only passages from the released provider; keep the API and consent
// guidance intact while adapting it to the standalone, CUA-only program.
const initializationGuidance = 'In persistent PTC, use the host-provided bridge initialization once and retain the returned objects; cua comes from that bridge and is not a preinstalled global.';
const standaloneGuidance = 'For Computer Use, call cua_run_code with code (the body of an async TypeScript function) and description. The host initializes cua before every call; use its documented methods directly without importing or initializing it yourself. Only Computer Use is bound in this program. Use the ordinary native tools outside it for shell and files.';
const treeStorageGuidance = 'In persistent PTC, capture a large tree with const tree = await win.getAccessibilityTree({ emit: false }). Filter its lines in memory, or save it with await tools.write({ file_path: path, content: tree }) to a new workspace file. Search its contents with tools.grep({ path, pattern }) and use tools.read around a matching line. Print only the matches you need. Use element ids from the file only while that observation is current.';
const standaloneTreeGuidance = 'In cua_run_code, capture a large tree with const tree = await win.getAccessibilityTree({ emit: false }). Filter its lines in memory and print only the matches you need. Use element ids only while that observation is current.';

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
      // Preserve the provider's API and consent rules, adapting only transport
      // instructions that assumed a general PTC preset and its file bindings.
      const programText = text.slice(0, match.index)
        .replace(initializationGuidance, standaloneGuidance)
        .replace(treeStorageGuidance, standaloneTreeGuidance)
        .replace(/\brun_code\b/g, 'cua_run_code');
      return {
        tool, prompt,
        programPrompt: { ...prompt, text: programText, interpolate: false },
        initialization: match[1],
      };
    },
  };
}
