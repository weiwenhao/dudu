// What a harness asks while it works, put to the person through DSH's own approval and question services.
// The harness can ask while it is still streaming the message that holds the tool call, long before DSH's loop
// starts the mirror tool, so a run answers these as they arrive and never waits for a tool to start.

const deny = (message) => ({ behavior: 'deny', message });

export function permissionDecision(outcome) {
  if (outcome === 'allowed-once') return { behavior: 'allow' };
  return deny(outcome === 'rejected' ? 'The user rejected this action.' : 'No one answered this request.');
}

/** A harness's questions as DSH's question service asks them. DSH answers per question id; the harness wants its own shape. */
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

/** DSH's answers back in the order of the harness's questions, each next to the question it answers. */
export function orderedAnswers(questions, answer) {
  return questions.map((question, index) => {
    const item = answer.answers.find((candidate) => candidate.id === `q${index}`);
    return { question, selected: item?.selected ?? [], custom: item?.custom };
  });
}

/**
 * The handler a run calls for each request of its harness. `services` are resolved lazily: a DSH without a
 * question service still runs, and its harness is told that nobody can answer.
 */
export function createInteractionHandler({ services, agentOf }) {
  return async (request, run, signal) => {
    const agent = agentOf(run.sessionId);
    if (request.type === 'question-request') {
      const questions = services.questions?.();
      if (!questions || !agent) { run.respondQuestion(request.id, { cancelled: true }); return; }
      try {
        const answer = await questions.ask({ agent, callId: request.toolCallId, questions: toDshQuestions(request.questions), signal });
        run.respondQuestion(request.id, { answers: orderedAnswers(request.questions, answer) });
      } catch {
        run.respondQuestion(request.id, { cancelled: true });
      }
      return;
    }
    const approval = services.approval?.();
    if (!approval || !agent) { run.respondPermission(request.id, deny('Approvals are unavailable.')); return; }
    let outcome;
    try {
      outcome = await approval.request({
        agent, toolName: request.toolName, callId: request.toolCallId, signal,
        reason: request.reason ?? `${request.toolName} needs permission.`,
      });
    } catch {
      outcome = 'unavailable';
    }
    run.respondPermission(request.id, permissionDecision(outcome));
  };
}
