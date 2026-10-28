// Mirror tools: what DSH's loop executes for a tool call the harness has made. They do no work of their own.
// They wait for the harness's result, hand its permission and question requests to DSH's own approval and
// question services, and let the harness's tool look like any other tool call in DSH's transcript.

const SPEC_OPEN = {};   // no declared parameters: an open object, so whatever the harness passes is accepted

const OUTPUT = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: { output: { type: 'string', required: true }, data: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: value.output }],
  // Structured data for the cards travels as JSON text; the card reads it back as `meta.data`.
  presentationMeta: (_args, value) => ({ output: value.output, ...(value.data ? { data: JSON.parse(value.data) } : {}) }),
};

const deny = (message) => ({ behavior: 'deny', message });

export function permissionDecision(outcome) {
  if (outcome === 'allowed-once') return { behavior: 'allow' };
  return deny(outcome === 'rejected' ? 'The user rejected this action.' : 'No one answered this request.');
}

/**
 * The questions of one harness request as DSH's question service asks them, and the way back: DSH answers per
 * question id, the harness wants its own shape, which each harness builds from the ordered answers.
 */
export function toDshQuestions(questions) {
  return questions.map((question, index) => ({
    id: `q${index}`,
    question: question.question,
    ...(question.header ? { header: question.header } : {}),
    ...(question.detail ? { detail: question.detail } : {}),
    ...(question.options?.length ? { options: question.options.map((option) => ({ label: option.label, ...(option.description ? { description: option.description } : {}) })) } : {}),
    ...(question.multiSelect ? { multiSelect: true } : {}),
  }));
}

export function orderedAnswers(questions, answer) {
  return questions.map((question, index) => {
    const item = answer.answers.find((candidate) => candidate.id === `q${index}`);
    return { question, selected: item?.selected ?? [], custom: item?.custom };
  });
}

function interactionHandler({ services, exec }) {
  return async (request, run) => {
    if (request.type === 'question-request') {
      const questions = services.questions?.();
      if (!questions) { run.respondQuestion(request.id, { cancelled: true }); return; }
      try {
        const answer = await questions.ask({ agent: exec.agent, callId: exec.callId, questions: toDshQuestions(request.questions), signal: exec.signal });
        run.respondQuestion(request.id, { answers: orderedAnswers(request.questions, answer) });
      } catch (error) {
        if (exec.signal?.aborted) throw error;
        run.respondQuestion(request.id, { cancelled: true });
      }
      return;
    }
    const approval = services.approval?.();
    if (!approval) { run.respondPermission(request.id, deny('Approvals are unavailable.')); return; }
    let outcome;
    try {
      outcome = await approval.request({
        agent: exec.agent, toolName: request.toolName, callId: exec.callId, signal: exec.signal,
        reason: request.reason ?? `${request.toolName} needs permission.`,
      });
    } catch (error) {
      if (exec.signal?.aborted) throw error;
      outcome = 'unavailable';
    }
    run.respondPermission(request.id, permissionDecision(outcome));
  };
}

/** One mirror tool for one harness tool; `spec` comes from the harness's tool catalog. */
export function createMirrorTool({ defineTool, bridge, services, spec }) {
  const outcomeOf = (result) => ({ output: String(result.meta?.output ?? ''), data: result.meta?.data, isError: result.isError === true });
  return defineTool({
    name: spec.name,
    description: spec.description ?? `${bridge.driver.name} tool ${spec.name}, run by the harness itself.`,
    parameters: SPEC_OPEN,
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const run = bridge.runOf(exec.agent?.id);
      if (!run) throw new Error('The harness is not running this turn.');
      const outcome = await run.waitTool(exec.callId, { signal: exec.signal, onInteraction: interactionHandler({ services, exec }) });
      if (outcome.isError) throw new Error(outcome.output || 'The tool failed.');
      return { output: outcome.output ?? '', ...(outcome.data === undefined ? {} : { data: JSON.stringify(outcome.data) }) };
    },
    ...(spec.presentCall ? { presentCall: (args) => spec.presentCall(args) } : {}),
    ...(spec.presentResult ? { presentResult: (args, result) => spec.presentResult(args, outcomeOf(result)) } : {}),
  });
}

/** Every mirror tool of one harness, for registering in one agent's scope. */
export function createMirrorTools({ defineTool, bridge, services }) {
  return (bridge.driver.tools ?? []).map((spec) => createMirrorTool({ defineTool, bridge, services, spec }));
}
