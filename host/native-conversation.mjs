import { basename, isAbsolute, resolve } from 'node:path';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value) => typeof value === 'string' ? value : '';
const number = (value) => Number.isFinite(value) && value >= 0 ? value : undefined;
const callID = (data) => string(data?.message?.toolCallId ?? data?.message?.source?.callId ?? data?.callId);

export class ConversationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new ConversationError(code); };

export function conversationState() {
  return { tools: new Map(), turns: new Map(), step: undefined, cursor: -1 };
}

function turnData(state, turn) {
  if (!Number.isSafeInteger(turn)) return undefined;
  if (!state.turns.has(turn)) state.turns.set(turn, { files: [], notices: [], stats: { steps: 0 } });
  while (state.turns.size > 200) state.turns.delete(state.turns.keys().next().value);
  return state.turns.get(turn);
}

function numericUsage(usage) {
  if (!record(usage)) return {};
  const result = {};
  for (const [key, value] of Object.entries(usage)) {
    if (number(value) !== undefined) result[key] = value;
    else if (record(value)) {
      for (const [detail, amount] of Object.entries(value)) {
        if (number(amount) !== undefined) result[`${key}.${detail}`] = amount;
      }
    }
  }
  return result;
}

function addMetrics(target, source) {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}

export function mutationPath(name, raw) {
  let args;
  try { args = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return undefined; }
  if (!record(args)) return undefined;
  let target;
  if (name === 'write' && typeof args.content === 'string') target = args.file_path;
  if (name === 'edit' && typeof args.old_string === 'string' && args.old_string.length
    && typeof args.new_string === 'string' && args.new_string !== args.old_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')) target = args.file_path;
  if (name === 'str_replace_editor') {
    if (args.command === 'create' && typeof args.file_text === 'string'
      || args.command === 'str_replace' && typeof args.old_str === 'string' && args.old_str.length
        && (args.new_str === undefined || typeof args.new_str === 'string')
      || args.command === 'insert' && Number.isSafeInteger(args.insert_line) && args.insert_line >= 0
        && typeof args.new_str === 'string') {
      target = args.path;
    }
  }
  return typeof target === 'string' && target.trim() ? target : undefined;
}

function failure(error) {
  if (typeof error === 'string') return { message: error };
  return {
    message: string(error?.message),
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
  };
}

export function firstToken(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (const item of stream) {
    if (item?.type === 'chunk') {
      const chunk = item.chunk;
      if (Number.isFinite(item.time) && (['text-delta', 'reasoning-delta'].includes(chunk?.type) && string(chunk.text)
        || chunk?.type === 'tool-call-delta' && (string(chunk.argumentsDelta) || chunk.name !== undefined))) return item.time;
    } else if (Number.isFinite(item?.time0)) {
      if (item.type === 'tool-call-chunks' && item.name !== undefined) return item.time0;
      const fragments = item.type === 'tool-call-chunks' ? item.args : item.texts;
      if (!Array.isArray(fragments)) continue;
      let time = item.time0;
      for (let index = 0; index < fragments.length; index += 1) {
        if (index > 0) time += item.dt?.[index - 1] ?? 0;
        if (string(fragments[index])) return time;
      }
    }
  }
  return undefined;
}

export function recordConversationEvent(state, event) {
  const data = event?.data ?? {};
  state.cursor = Math.max(state.cursor, Number.isSafeInteger(event?.seq) ? event.seq : -1);
  const turn = turnData(state, data.turn);
  if (turn) turn.lastSeq = event.seq;
  if (event.type === 'step/start') state.step = { turn: data.turn, step: data.step, start: event.time };
  if (event.type === 'assistant/attempt' && state.step?.turn === data.turn && state.step.step === data.step) {
    state.step.first ??= firstToken(data.stream);
  }
  if (event.type === 'step/end' && turn) {
    turn.stats.steps += 1;
    turn.stats.turns = 1;
    state.step = undefined;
  }
  if (event.type === 'assistant/message' && turn) {
    turn.usage ??= {};
    addMetrics(turn.usage, numericUsage(data.usage));
    const step = state.step;
    if (step?.turn === data.turn && step.step === data.step) {
      const first = step.first ?? firstToken(data.stream);
      addMetrics(turn.stats, { llmMs: Math.max(0, event.time - step.start) });
      if (first !== undefined) {
        addMetrics(turn.stats, { ttftMs: Math.max(0, first - step.start), ttftSteps: 1 });
        if (number(data.usage?.outputTokens) !== undefined) {
          addMetrics(turn.stats, { decodeMs: Math.max(0, event.time - first), decodeTokens: data.usage.outputTokens });
        }
      }
      state.step = undefined;
    }
  }
  if (event.type === 'tool/call' && callID(data)) {
    const previous = state.tools.get(callID(data)) ?? {};
    state.tools.set(callID(data), {
      ...previous, id: callID(data), name: data.name, seq: event.seq, time: event.time,
      turn: data.turn, path: mutationPath(data.name, data.arguments),
    });
    while (state.tools.size > 1000) state.tools.delete(state.tools.keys().next().value);
  }
  if (event.type === 'tool/result' && event.surfaceOp === 'append' && callID(data)) {
    const tool = state.tools.get(callID(data)) ?? { id: callID(data) };
    tool.resultSeq = event.seq;
    tool.status = data.message?.isError === true ? 'error' : 'done';
    state.tools.set(tool.id, tool);
    if (turn && Number.isFinite(tool.time)) {
      addMetrics(turn.stats, { toolMs: Math.max(0, event.time - tool.time) });
      tool.time = undefined;
    }
    let path = tool.path;
    if (path && record(data.meta) && Object.hasOwn(data.meta, 'path')) {
      path = isAbsolute(string(data.meta.path)) ? data.meta.path : isAbsolute(string(path)) ? path : undefined;
    }
    if (turn && tool.status === 'done' && path && !turn.files.some((file) => file.path === path)) {
      turn.files.push({
        id: `produced:${event.seq}`, kind: 'produced', seq: event.seq, callSeq: tool.seq,
        path, name: basename(path),
      });
    }
  }
  if (event.type === 'deliverables/presented' && turn && Array.isArray(data.files)) {
    data.files.forEach((file, index) => {
      if (typeof file?.path !== 'string' || !file.path.trim()) return;
      turn.files.push({
        id: `presented:${event.seq}:${index}`, kind: 'presented', seq: event.seq, index,
        path: file.path, name: basename(file.path),
        ...(typeof file.description === 'string' ? { description: file.description } : {}),
      });
    });
  }
  if (event.type === 'workspace/changes' && turn) turn.changesSeq = event.seq;
  if (event.type === 'llm/retry' && turn) {
    turn.notices.push({
      id: `retry:${data.retryId ?? event.seq}:${data.retry}`, kind: 'retry',
      seq: event.seq, time: event.time, retryId: string(data.retryId),
      retry: data.retry, maximum: data.mode === 'normal' ? data.maxRetries : undefined,
      delayMs: data.delayMs, state: 'scheduled', ...failure(data.failure ?? data.error),
    });
  }
  if (event.type === 'llm/retry-started' && turn) {
    const notice = turn.notices.find((item) => item.retryId === data.retryId && item.retry === data.retry);
    if (notice) notice.state = 'started';
  }
  if (event.type === 'turn/end' && turn) {
    for (const notice of turn.notices) if (notice.state === 'scheduled') notice.state = 'cancelled';
    const reason = data.reason ?? {};
    if (reason.kind === 'error' || reason.kind === 'interrupted'
      || reason.kind === 'aborted' && reason.reason?.kind === 'hook' && reason.reason.reason === 'deepseek-account/signed-out') {
      const error = reason.kind === 'interrupted'
        ? { message: 'The DSH process exited before this turn finished.', code: 'INTERRUPTED' }
        : reason.kind === 'aborted'
          ? { message: 'Stopped because you signed out of DeepSeek.', code: 'ACCOUNT_SIGNED_OUT' } : reason.error;
      turn.notices.push({ id: `error:${event.seq}`, kind: 'error', seq: event.seq, ...failure(error) });
    }
    if (reason.kind === 'max-tokens') turn.notices.push({ id: `limit:${event.seq}`, kind: 'max-tokens', seq: event.seq, message: '' });
  }
}

export function questionsFrom(values, sessionId, isPlan) {
  const active = values.userQuestions?.active;
  if (!Array.isArray(active)) return [];
  return active.filter((call) => !isPlan(call) && validQuestionCall(call)).map((call) => ({
    id: call.callId, sessionId, state: call.state ?? 'open',
    questions: call.questions.map((question) => ({
      id: question.id, question: question.question,
      ...(typeof question.header === 'string' ? { header: question.header } : {}),
      ...(typeof question.detail === 'string' ? { detail: question.detail } : {}),
      multiSelect: question.multiSelect === true,
      options: (question.options ?? []).map((option) => ({
        label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}),
      })),
    })),
  }));
}

function validQuestionCall(call) {
  return typeof call?.callId === 'string' && Array.isArray(call.questions) && call.questions.length > 0
    && call.questions.every((question) => typeof question?.id === 'string' && typeof question.question === 'string'
      && (question.options === undefined || Array.isArray(question.options)
        && question.options.every((option) => typeof option?.label === 'string')));
}

export function validateAnswers(call, answers) {
  if (!validQuestionCall(call) || !Array.isArray(answers) || answers.length !== call.questions.length) fail('STALE_APPROVAL');
  const ids = new Set();
  for (const answer of answers) {
    if (!record(answer) || ids.has(answer.id)) fail('BAD_REQUEST');
    ids.add(answer.id);
    const question = call.questions.find((item) => item.id === answer.id);
    if (!question || !Array.isArray(answer.selected) || new Set(answer.selected).size !== answer.selected.length
      || answer.selected.some((label) => !(question.options ?? []).some((option) => option.label === label))
      || !question.multiSelect && answer.selected.length > 1
      || answer.custom !== undefined && (typeof answer.custom !== 'string' || answer.custom.length > 60_000)
      || Object.keys(answer).some((key) => !['id', 'selected', 'custom'].includes(key))) fail('BAD_REQUEST');
  }
  return { answers };
}

export function sessionPerformance(values) {
  return { stats: numericUsage(values.sessionStats), usage: numericUsage(values.tokenUsage) };
}

export function toolReference(state, id) {
  const tool = state.tools.get(id);
  return tool ? {
    ...(Number.isSafeInteger(tool.seq) ? { seq: tool.seq } : {}),
    ...(Number.isSafeInteger(tool.resultSeq) ? { resultSeq: tool.resultSeq } : {}),
    ...(tool.status ? { status: tool.status } : {}),
  } : {};
}

export function textPage(value, offset = 0, length = 32_000) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length) fail('BAD_REQUEST');
  let end = Math.min(value.length, offset + length);
  if (end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1])) end -= 1;
  if (offset > 0 && /[\uDC00-\uDFFF]/u.test(value[offset])) fail('BAD_REQUEST');
  return { text: value.slice(offset, end), offset, total: value.length, ...(end < value.length ? { nextOffset: end } : {}) };
}

export function toolPayload(call, result, params) {
  const id = string(call?.data?.callId);
  if (call?.type !== 'tool/call' || !id || id !== params.callId) fail('NOT_FOUND');
  if (result && (result.type !== 'tool/result' || callID(result.data) !== id)) fail('NOT_FOUND');
  const input = typeof call.data.arguments === 'string' ? call.data.arguments : JSON.stringify(call.data.arguments ?? {});
  const rawContent = result?.data?.message?.content ?? [];
  const content = Array.isArray(rawContent) ? rawContent : [rawContent];
  const images = [];
  const output = content.map((block, index) => {
    if (block?.type === 'image' && typeof block.data === 'string'
      && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(block.mediaType)) {
      images.push({ kind: 'image', name: block.name ?? '图片', id: `tool:${id}:${index}`, seq: result.seq });
      return { ...block, data: undefined };
    }
    return block;
  });
  const outputText = output.map((block) => typeof block?.text === 'string' ? block.text : JSON.stringify(block, null, 2)).join('\n');
  const metadata = result?.data?.meta === undefined ? '' : JSON.stringify(result.data.meta, null, 2);
  return {
    id, name: string(call.data.name), status: result ? result.data.message?.isError ? 'error' : 'done' : 'running',
    input: textPage(input, params.inputOffset ?? 0), output: textPage(outputText, params.outputOffset ?? 0),
    metadata: textPage(metadata, params.metadataOffset ?? 0), images,
  };
}

export function deliveredPath(event, call, params, cwd) {
  let target;
  if (params.kind === 'presented' && event?.type === 'deliverables/presented'
    && Number.isSafeInteger(params.index) && params.index >= 0) target = event.data?.files?.[params.index]?.path;
  if (params.kind === 'produced' && event?.type === 'tool/result' && event.surfaceOp === 'append'
    && event.data?.message?.isError !== true && call?.type === 'tool/call' && callID(event.data) === callID(call.data)) {
    target = mutationPath(call.data.name, call.data.arguments);
    if (target && record(event.data.meta) && Object.hasOwn(event.data.meta, 'path')) {
      target = isAbsolute(string(event.data.meta.path)) ? event.data.meta.path
        : isAbsolute(string(target)) ? target : undefined;
    }
  }
  if (typeof target !== 'string' || !target || target.includes('\0')) fail('NOT_FOUND');
  if (isAbsolute(target)) return target;
  if (!isAbsolute(string(cwd))) fail('NOT_FOUND');
  return resolve(cwd, target);
}

function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  return stream.findLast((item) => item?.type === 'chunk' && item.chunk?.type === 'usage')?.chunk.usage;
}

export function performanceEvent(event) {
  const data = event.data ?? {};
  const first = firstToken(data.stream);
  const usage = data.usage ?? streamUsage(data.stream);
  return {
    type: event.type, seq: event.seq, time: event.time, surfaceOp: event.surfaceOp,
    data: {
      turn: data.turn, step: data.step, callId: data.callId, usage,
      reason: data.reason,
      message: { source: { callId: callID(data) } },
      ...(first === undefined ? {} : { stream: [{ type: 'chunk', time: first, chunk: { type: 'text-delta', text: ' ' } }] }),
    },
  };
}

function normalizedUsage(sample) {
  if (!record(sample)) return undefined;
  const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'];
  for (const key of keys) if (sample[key] !== undefined && (!Number.isSafeInteger(sample[key]) || sample[key] < 0)) return undefined;
  if (sample.inputTokens === undefined || sample.outputTokens === undefined
    || (sample.reasoningTokens ?? 0) > sample.outputTokens) return undefined;
  const prompt = sample.inputTokens + (sample.cacheReadTokens ?? 0) + (sample.cacheWriteTokens ?? 0);
  const total = sample.totalTokens ?? (sample.cacheReadTokens !== undefined && sample.cacheWriteTokens !== undefined
    ? prompt + sample.outputTokens : undefined);
  if (!Number.isSafeInteger(total) || total < prompt + sample.outputTokens
    || sample.cacheReadTokens !== undefined && sample.cacheWriteTokens !== undefined && total !== prompt + sample.outputTokens) return undefined;
  return { ...numericUsage(sample), uncachedInputTokens: sample.inputTokens, totalTokens: total };
}

export function turnPerformance(events, turn) {
  const state = conversationState();
  const attempts = [];
  let phase = 'idle';
  let step;
  let started = false;
  let ended = false;
  let exact = true;
  for (const event of events) {
    if (event.data?.turn !== turn) continue;
    recordConversationEvent(state, event);
    const type = event.type;
    if (type === 'turn/start') { if (started) exact = false; started = true; }
    else if (!started || ended) exact = false;
    if (type === 'step/start') {
      if (phase !== 'idle') exact = false;
      step = event.data.step;
      phase = 'open';
    } else if (['assistant/message', 'assistant/attempt'].includes(type)) {
      if (phase !== 'open' || step !== event.data.step) exact = false;
      const usage = normalizedUsage(event.data.usage ?? streamUsage(event.data.stream));
      if (!usage) exact = false;
      else attempts.push(usage);
      phase = type === 'assistant/message' ? 'message' : 'attempt';
    } else if (type === 'llm/retry') {
      if (phase !== 'attempt' && phase !== 'open') exact = false;
      if (phase === 'open') exact = false;
      phase = 'retry';
    } else if (type === 'llm/retry-started') {
      if (phase !== 'retry' || step !== event.data.step) exact = false;
      phase = 'open';
    } else if (type === 'step/end') {
      if (!['message', 'attempt', 'retry'].includes(phase)) exact = false;
      phase = 'idle';
    } else if (type === 'turn/end') {
      if (phase !== 'idle') exact = false;
      ended = true;
    }
  }
  const usage = {};
  if (exact && started && ended && attempts.length) {
    for (const key of ['uncachedInputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
      if (attempts.every((attempt) => attempt[key] !== undefined)) {
        const sum = attempts.reduce((total, attempt) => total + attempt[key], 0);
        if (Number.isSafeInteger(sum)) usage[key] = sum;
      }
    }
  }
  return { stats: state.turns.get(turn)?.stats ?? {}, usage };
}
