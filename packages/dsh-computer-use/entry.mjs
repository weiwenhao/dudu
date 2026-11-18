// Compatibility entry around the unchanged official 0.2.2-rc.3 PTC implementation.
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import { createRunCodeTool } from './vendor/ptc.ts';
import { PtcCalls } from './vendor/ptc-calls.ts';

const available = (toolSet) => !toolSet || toolSet.allowed.has('cua_run_code');

export function createProgramTransport(ctx, tool, runtime) {
  const tools = new Proxy(ctx.tools, {
    get(target, key) {
      if (key === 'schemas') return (_agent, toolSet) => available(toolSet) ? [projectToolSchema(tool, false)] : [];
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
    get: (name, _agent, toolSet) => name === tool.name && available(toolSet) ? tool : undefined,
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
