import { captureComputerUseProvider } from './provider-context.mjs';
import { createComputerUseProgram } from './engine.mjs';
import { installComputerUseRegistration } from './registration.mjs';

export const name = 'dudu-computer-use-compat';
export const inject = ['computerUse', 'tools', 'systemPrompt', 'subprocess', 'agents', 'loader'];

/** The main Dudu bundle mounts this adapter around the installed native provider. */
export async function apply(ctx) {
  const entry = ctx.get('configEditor')?.entries().find((item) => item.options.id === 'cua');
  if (entry?.options.name !== '@deepseek-ai/dsh-experimental-cua-macos') {
    throw new Error('The Computer Use compatibility bundle requires DSH’s built-in macOS provider.');
  }
  const [provider, shared, loader] = await Promise.all([
    ctx.loader.import('@deepseek-ai/dsh-experimental-cua-macos'),
    ctx.loader.import('@deepseek-ai/dsh-cua'),
    ctx.loader.import('@deepseek-ai/cordis-plugin-loader'),
  ]);
  const config = provider.Config(loader.interpolate(ctx, entry.options.config ?? {}));
  // Once DSH ships its own standalone program registration, delegate completely.
  if (typeof shared.CuaPrograms === 'function') return provider.apply(ctx, config);
  const captured = captureComputerUseProvider(ctx);
  await provider.apply(captured.context, { ...config, agentPreset: false });
  await installComputerUseRegistration(ctx, {
    ...captured.registrations(), agentPreset: config.agentPreset, createProgram: createComputerUseProgram,
  });
}
