import { randomUUID } from 'node:crypto';
import { userContent } from './images.mjs';

// A conversation read from a harness (see history.mjs) as the log DSH keeps for a session: the same events DSH's own
// loop writes while a turn runs, in the same order, so the session opens, renders and resumes like any other.

export const SESSION_FORMAT_VERSION = 4;

/** Native histories have final blocks, not token arrival times. Do not fabricate throughput from their import time. */
function streamOf(blocks, time, replayState, toolCalls, usage) {
  const records = [];
  blocks.forEach((block, index) => {
    records.push({ type: 'chunk', time, chunk: { type: 'block-start', index, blockType: block.type } });
    if (block.type === 'tool-call') {
      records.push({ type: 'chunk', time, chunk: { type: 'block-end', index, block: { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments } } });
    } else {
      records.push({ type: 'chunk', time, chunk: { type: 'block-end', index, block: { type: block.type, text: block.text } } });
    }
  });
  if (usage) records.push({ type: 'chunk', time, chunk: { type: 'usage', usage } });
  records.push({ type: 'chunk', time, chunk: { type: 'finish', reason: { kind: toolCalls ? 'tool-calls' : 'stop' }, replayState } });
  return records;
}

/**
 * The header and events of a DSH session holding `history`. The assistant messages carry the harness's own session id
 * (`replayState`), which is how the next message of the session resumes the same native session.
 */
export function buildSessionEvents({ history, route, model, effort, sessionId, preset = 'standard', title, newId = randomUUID, now = Date.now(), offset = 0, turnOffset = 0, after = 0, configure = true, reserveHead = configure, resume }) {
  const events = [];
  let clock = Math.max(after, Number.isFinite(history.createdAt) ? history.createdAt : now);
  // Event times never go backwards, whatever order a harness stamped its records in.
  const stamp = (at) => { clock = Math.max(clock, Number.isFinite(at) ? Math.trunc(at) : clock); return clock; };
  const push = (type, data, { at, surfaceOp, sourceEventSeqs } = {}) => {
    const event = { type, seq: offset + events.length, time: stamp(at), data, ...(sourceEventSeqs ? { sourceEventSeqs } : {}), ...(surfaceOp ? { surfaceOp } : {}) };
    events.push(event);
    return event.seq;
  };
  const replayState = { harness: route, nativeSessionId: history.id };

  // What a new session records before anything is said: its access mode and the model it was given.
  if (configure) {
    push('permission/preset', { preset: 'workspace-write' });
    push('sandbox/mode', { mode: 'workspace-write' });
    push('approval/policy', { policy: 'ask' });
    push('model/selection', { provider: route, model, ...(effort ? { reasoningEffort: effort } : {}) });
  }

  history.turns.forEach((turn, turnIndex) => {
    const continuing = turnIndex === 0 && resume;
    const number = turnOffset + turnIndex + (resume ? 0 : 1);
    const firstStep = continuing ? resume.step + 1 : 1;
    const state = { ...replayState, ...(turn.id ? { nativeTurnId: turn.id } : {}), ...(turn.complete === false ? { nativeComplete: false } : {}) };
    const input = (value) => push('user/message', {
      content: userContent(value), source: { kind: 'user' }, role: 'user',
      id: value.id ? `dudu-native:${route}:${history.id}:${value.id}` : newId(),
    }, { surfaceOp: 'append', at: value.at });
    if (!continuing) push('turn/start', { turn: number }, { at: turn.at });
    if (!continuing || turn.steps.length) push('step/start', { turn: number, step: firstStep });
    // DSH protects the first surface node for its system prompt. An empty head lets the live loop replace it on resume.
    if (reserveHead && turnIndex === 0) push('system/message', {
      turn: number, step: firstStep,
      message: { id: newId(), role: 'system', source: { kind: 'system-prompt' }, content: [] },
    }, { surfaceOp: 'append' });
    // What the person said: their words, and the pictures that were stored in DSH's attachment store (`{ type: 'image', attachment }`, as
    // DSH writes a picture pasted into its composer), in the order they were sent.
    if (!turn.continuation) input(turn);
    if ((configure || reserveHead) && turnIndex === 0) push('session/title', { title: title ?? history.title, messageSeqs: [], source: { kind: 'user' } });
    turn.steps.forEach((step, stepIndex) => {
      const at = step.at ?? (stepIndex === turn.steps.length - 1 ? turn.endedAt : null) ?? turn.at;
      const stepNumber = firstStep + stepIndex;
      if (stepIndex > 0) push('step/start', { turn: number, step: stepNumber });
      if (step.input) input(step.input);
      const calls = step.blocks.filter((block) => block.type === 'tool-call');
      const time = Math.max(clock, Number.isFinite(at) ? at : clock);
      if (step.blocks.length) push('assistant/message', {
        turn: number, step: stepNumber,
        message: { role: 'assistant', content: step.blocks, source: { kind: 'model', provider: route, model, replayState: state }, id: newId() },
        stream: streamOf(step.blocks, time, state, calls.length > 0, step.usage),
        ...(step.usage ? { usage: step.usage } : {}),
      }, { at, surfaceOp: 'append' });
      const callSeqs = calls.map((call) => push('tool/call', { turn: number, step: stepNumber, callId: call.id, name: call.name, arguments: call.arguments }));
      calls.forEach((call, index) => {
        const result = turn.results.get(call.id) ?? { output: '', isError: false };
        push('tool/result', {
          turn: number, step: stepNumber,
          message: { role: 'tool', source: { kind: 'tool', callId: call.id }, toolCallId: call.id, content: [{ type: 'text', text: result.output }], isError: result.isError === true, id: newId() },
          meta: { output: result.output, ...(result.data ? { data: result.data } : {}) },
        }, { at: result.at, surfaceOp: 'append', sourceEventSeqs: [callSeqs[index]] });
      });
      push('step/end', { turn: number, step: stepNumber });
    });
    // Something the person said that no answer was recorded for: the step that holds it closes, and the turn ends as a
    // stopped one.
    if (turn.steps.length === 0 && !continuing) push('step/end', { turn: number, step: firstStep });
    if (turn.complete !== false) push('turn/end', { turn: number, reason: turn.steps.length === 0 && !turn.continuation || turn.interrupted ? { kind: 'aborted', reason: { kind: 'user' } } : { kind: 'completed' } }, { at: turn.endedAt });
  });

  const header = {
    version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: Number.isFinite(history.createdAt) ? history.createdAt : now,
    cwd: history.cwd, isSeeded: false, delegationDepth: 0, agentPreset: preset,
  };
  return { header, events };
}
