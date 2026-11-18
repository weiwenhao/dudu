import { createEngine, imports } from '../../packages/dsh-computer-use/.generated/engine.mjs';

/** The native provider's facade is initialized in a separate, host-owned PTC environment. */
export async function createComputerUseProgram(ctx, tool, initialization) {
  const dependencies = Object.fromEntries(await Promise.all(imports.map(async (name) => [name, await ctx.loader.import(name)])));
  const engine = createEngine(dependencies);
  const original = ctx.get('ptcRuntime');
  if (!original || original.language !== 'typescript') throw new Error('The Computer Use compatibility adapter requires DSH’s TypeScript PTC runtime.');
  const owner = {};
  const lifetime = new AbortController();
  const runtime = new Proxy(original, {
    get(target, key) {
      if (key === 'resolve') return (request) => target.resolve({
        ...request,
        program: `${initialization}\n${request.program}`,
        signal: AbortSignal.any([request.signal, lifetime.signal]),
        ...(request.stateOwner === undefined ? {} : { stateOwner: owner }),
      });
      if (key === 'release') return () => target.release(owner);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  ctx.effect(() => async () => {
    lifetime.abort(new Error('Computer Use program scope disposed'));
    await original.release(owner);
  }, 'dudu.computer-use.environment');
  return engine.createProgramTransport(ctx, tool, runtime);
}
