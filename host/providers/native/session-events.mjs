import { randomUUID } from 'node:crypto';

// A conversation read from a harness (see history.mjs) as the log DSH keeps for a session: the same events DSH's own
// loop writes while a turn runs, in the same order, so the session opens, renders and resumes like any other.

export const SESSION_FORMAT_VERSION = 4;

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

/** The model stream of an assistant message, in the compact form DSH records: one chunk of text per block. */
function streamOf(blocks, time, replayState, toolCalls) {
  const records = [];
  blocks.forEach((block, index) => {
    records.push({ type: 'chunk', time, chunk: { type: 'block-start', index, blockType: block.type } });
    if (block.type === 'tool-call') {
      records.push({ type: 'tool-call-chunks', time0: time, index, dt: [], id: block.id, name: block.name, args: [block.arguments] });
      records.push({ type: 'chunk', time, chunk: { type: 'block-end', index, block: { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments } } });
    } else {
      records.push({ type: block.type === 'reasoning' ? 'reasoning-chunks' : 'text-chunks', time0: time, index, dt: [], texts: [block.text] });
      records.push({ type: 'chunk', time, chunk: { type: 'block-end', index, block: { type: block.type, text: block.text } } });
    }
  });
  records.push({ type: 'chunk', time, chunk: { type: 'usage', usage: { ...ZERO_USAGE } } });
  records.push({ type: 'chunk', time, chunk: { type: 'finish', reason: { kind: toolCalls ? 'tool-calls' : 'stop' }, replayState } });
  return records;
}

/**
 * The header and events of a DSH session holding `history`. The assistant messages carry the harness's own session id
 * (`replayState`), which is how the next message of the session resumes the same native session.
 */
export function buildSessionEvents({ history, route, model, effort, sessionId, preset = 'standard', title, newId = randomUUID, now = Date.now() }) {
  const events = [];
  let clock = Number.isFinite(history.createdAt) ? history.createdAt : now;
  // Event times never go backwards, whatever order a harness stamped its records in.
  const stamp = (at) => { clock = Math.max(clock + 1, Number.isFinite(at) ? Math.trunc(at) : clock + 1); return clock; };
  const push = (type, data, { at, surfaceOp, sourceEventSeqs } = {}) => {
    const event = { type, seq: events.length, time: stamp(at), data, ...(sourceEventSeqs ? { sourceEventSeqs } : {}), ...(surfaceOp ? { surfaceOp } : {}) };
    events.push(event);
    return event.seq;
  };
  const replayState = { harness: route, nativeSessionId: history.id };

  // What a new session records before anything is said: its access mode and the model it was given.
  push('permission/preset', { preset: 'workspace-write' });
  push('sandbox/mode', { mode: 'workspace-write' });
  push('approval/policy', { policy: 'ask' });
  push('model/selection', { provider: route, model, ...(effort ? { reasoningEffort: effort } : {}) });

  history.turns.forEach((turn, turnIndex) => {
    const number = turnIndex + 1;
    push('turn/start', { turn: number }, { at: turn.at });
    push('step/start', { turn: number, step: 1 });
    push('user/message', { content: [{ type: 'text', text: turn.prompt }], source: { kind: 'user' }, role: 'user', id: newId() }, { surfaceOp: 'append' });
    if (turnIndex === 0) push('session/title', { title: title ?? history.title, messageSeqs: [], source: { kind: 'user' } });
    turn.steps.forEach((step, stepIndex) => {
      const at = step.at ?? turn.at;
      const stepNumber = stepIndex + 1;
      if (stepIndex > 0) push('step/start', { turn: number, step: stepNumber }, { at });
      const calls = step.blocks.filter((block) => block.type === 'tool-call');
      const time = clock + 1;
      push('assistant/message', {
        turn: number, step: stepNumber,
        message: { role: 'assistant', content: step.blocks, source: { kind: 'model', provider: route, model, replayState }, id: newId() },
        stream: streamOf(step.blocks, time, replayState, calls.length > 0),
        usage: { ...ZERO_USAGE },
      }, { at, surfaceOp: 'append' });
      const callSeqs = calls.map((call) => push('tool/call', { turn: number, step: stepNumber, callId: call.id, name: call.name, arguments: call.arguments }));
      calls.forEach((call, index) => {
        const result = turn.results.get(call.id) ?? { output: '', isError: false };
        push('tool/result', {
          turn: number, step: stepNumber,
          message: { role: 'tool', source: { kind: 'tool', callId: call.id }, toolCallId: call.id, content: [{ type: 'text', text: result.output }], isError: result.isError === true, id: newId() },
          meta: { output: result.output, ...(result.data ? { data: result.data } : {}) },
        }, { surfaceOp: 'append', sourceEventSeqs: [callSeqs[index]] });
      });
      push('step/end', { turn: number, step: stepNumber });
    });
    // Something the person said that no answer was recorded for: the step that holds it closes, and the turn ends as a
    // stopped one.
    if (turn.steps.length === 0) push('step/end', { turn: number, step: 1 });
    push('turn/end', { turn: number, reason: turn.steps.length === 0 ? { kind: 'aborted', reason: { kind: 'user' } } : { kind: 'completed' } });
  });

  const header = {
    version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: Number.isFinite(history.createdAt) ? history.createdAt : now,
    cwd: history.cwd, isSeeded: false, delegationDepth: 0, agentPreset: preset,
  };
  return { header, events };
}
