// Compatibility entry around the unchanged official 0.2.2-rc.3 PTC implementation.
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import { createRunCodeTool } from './vendor/ptc.ts';
import { PtcCalls } from './vendor/ptc-calls.ts';

export function createProgramTransport(ctx, tool, runtime) {
  // Admission is a host-owned, scope-bound view, not a set of allowed names.
  // Re-resolve the enclosing capability through the public registry so a closed
  // step, another agent, a restriction or an unloaded registration cannot bind CUA.
  const available = (agent, toolSet) => ctx.tools.executable('cua_run_code', agent, toolSet) !== undefined;
  const tools = new Proxy(ctx.tools, {
    get(target, key) {
      if (key === 'schemas') return (agent, toolSet) => available(agent, toolSet) ? [projectToolSchema(tool, false)] : [];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const context = new Proxy(ctx, {
    get(target, key) {
      if (key === 'tools') return tools;
      if (key === 'get') return (name) => name === 'ptcRuntime' ? runtime : target.get(name);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  // The real host pipeline still runs approvals, guards, cancellation, image
  // admission and result observers. Its only binding is the real provider's cua.
  const pipeline = new ToolExecutionPipeline(context, {
    get: (name, agent, toolSet) => name === tool.name && available(agent, toolSet) ? tool : undefined,
  });
  const definition = createRunCodeTool(context, pipeline, {
    maxSubCallsPerMinute: 1024, maxParallelSubCalls: 10,
  }, new PtcCalls(context));
  const description = Object.getOwnPropertyDescriptor(definition, 'description').get;
  const descriptors = Object.getOwnPropertyDescriptors(definition);
  descriptors.name = { ...descriptors.name, value: 'cua_run_code' };
  descriptors.description = {
    enumerable: true,
    get: () => description.call(definition)
      .replace('against the available tools', 'for Computer Use')
      .replace('Call tools as `await tools.name(args)` per the declarations in the system prompt.',
        'Use the initialized `cua` API described in the system prompt. Only Computer Use is bound in this program.'),
  };
  return Object.create(Object.getPrototypeOf(definition), descriptors);
}
