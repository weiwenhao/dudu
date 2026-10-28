// Mirror tools: what DSH's loop executes for a tool call the harness has made. They do no work of their own.
// They wait for the harness's result and let the harness's tool look like any other tool call in DSH's transcript.
// What the harness asks on the way (permission, questions) is answered by the run, as it arrives.

// Plain JSON Schema, the form DSH's registry stores, built here instead of through DSH's defineTool: the plugin
// is installed beside DSH's own packages, and a second copy of them must not decide what a definition looks like.
// No declared parameters: an open object, so whatever the harness passes is accepted.
const PARAMETERS = { type: 'object', properties: {} };

const OUTPUT = {
  schema: {
    type: 'object', additionalProperties: false, required: ['output'],
    properties: { output: { type: 'string' }, data: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: value.output }],
  // Structured data for the cards travels as JSON text; the card reads it back as `meta.data`.
  presentationMeta: (_args, value) => ({ output: value.output, ...(value.data ? { data: JSON.parse(value.data) } : {}) }),
};

/** One mirror tool for one harness tool; `spec` comes from the harness's tool catalog. */
export function createMirrorTool({ bridge, spec }) {
  const outcomeOf = (result) => ({ output: String(result.meta?.output ?? ''), data: result.meta?.data, isError: result.isError === true });
  return {
    name: spec.name,
    description: spec.description ?? `${bridge.driver.name} tool ${spec.name}, run by the harness itself.`,
    parameters: PARAMETERS,
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const run = bridge.runOf(exec.agent?.id);
      if (!run) throw new Error('The harness is not running this turn.');
      const outcome = await run.waitTool(exec.callId, { signal: exec.signal });
      if (outcome.isError) throw new Error(outcome.output || 'The tool failed.');
      return { output: outcome.output ?? '', ...(outcome.data === undefined ? {} : { data: JSON.stringify(outcome.data) }) };
    },
    ...(spec.presentCall ? { presentCall: (args) => spec.presentCall(args) } : {}),
    ...(spec.presentResult ? { presentResult: (args, result) => spec.presentResult(args, outcomeOf(result)) } : {}),
  };
}

/** Every mirror tool of one harness, for registering in one agent's scope. */
export function createMirrorTools({ bridge }) {
  return (bridge.driver.tools ?? []).map((spec) => createMirrorTool({ bridge, spec }));
}
