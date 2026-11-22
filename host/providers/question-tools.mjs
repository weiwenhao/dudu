import { randomUUID } from 'node:crypto';
import { validateAnswers } from '../native-conversation.mjs';

// The existing DSH ask_user_question contract. The host supplies its actual question
// schema; the handler always uses a blocking request so the answer goes back to the
// native tool call, rather than becoming an unrelated DSH user message after a timeout.
export const QUESTION_TOOL = 'ask_user_question';
const DESCRIPTION = 'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding.';
const bad = () => { throw new Error('Invalid ask_user_question arguments.'); };
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const word = (value, max = 60_000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Validate untrusted MCP arguments before calling the same DSH service as its own tool. */
export function questionInput(input) {
  if (!record(input) || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 100) bad();
  const ids = new Set();
  return input.questions.map((item) => {
    if (!record(item) || !word(item.id, 512) || ids.has(item.id) || !word(item.question)
      || item.header !== undefined && !word(item.header, 2000)
      || item.multi_select !== undefined && typeof item.multi_select !== 'boolean') bad();
    ids.add(item.id);
    let options;
    if (item.options !== undefined) {
      if (!Array.isArray(item.options) || item.options.length > 100) bad();
      const labels = new Set();
      options = item.options.map((option) => {
        if (!record(option) || !word(option.label, 2000) || labels.has(option.label)
          || option.description !== undefined && (typeof option.description !== 'string' || option.description.length > 60_000)) bad();
        labels.add(option.label);
        return { label: option.label, ...(option.description === undefined ? {} : { description: option.description }) };
      });
    }
    // Agent, session, signal, wait and presentation intents come only from the
    // host. A native process cannot turn a question into an approval request.
    return {
      id: item.id, question: item.question,
      ...(item.header === undefined ? {} : { header: item.header }),
      ...(options === undefined ? {} : { options }),
      ...(item.multi_select === undefined ? {} : { multiSelect: item.multi_select }),
    };
  });
}

export function createQuestionTool({ schema, ask, owner, lifetime }) {
  const questions = schema?.parameters?.properties?.questions;
  if (!questions || typeof ask !== 'function') return null;
  return {
    name: QUESTION_TOOL, description: DESCRIPTION,
    inputSchema: { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async handler(input, { signal }) {
      const current = owner();
      if (!current?.agent || !current.signal) throw new Error('The harness is not running this turn.');
      signal = AbortSignal.any([lifetime, current.signal, signal]);
      signal.throwIfAborted();
      const request = {
        agent: current.agent, signal, wait: { callId: randomUUID() },
        questions: questionInput(input),
      };
      const answer = await ask(request);
      signal.throwIfAborted();
      // Preserve IDs, selected labels, custom text and explicit skips. An empty
      // or incomplete batch is never invented on cancellation or tool failure.
      return JSON.stringify(validateAnswers({ callId: request.wait.callId, questions: request.questions }, answer?.answers));
    },
  };
}
