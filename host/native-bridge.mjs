import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createNativeBoard, NATIVE_BOARD_METHODS } from './native-board.mjs';
import { createNativeSettings, NATIVE_SETTINGS_METHODS } from './native-settings.mjs';
import { createNativeFiles } from './native-files.mjs';
import { createNativePages, NATIVE_PAGE_METHODS } from './native-pages.mjs';
import { imageFromBlock, MAX_IMAGE_BYTES } from './native-images.mjs';
import { markdownImagePath } from './native-markdown-images.mjs';
import { mapLimit } from './providers/async.mjs';
import { providerDefault, providerFamily, sessionProviders } from './providers/catalog.mjs';
import { agentMarkForActivity, stateOfMark } from './assistant/sessions/work-state.mjs';
import { CARD_COMMAND } from './assistant/home/cards.mjs';
import { SAY_COMMAND } from './assistant/home/group.mjs';
import { createNativeAssistant, NATIVE_ASSISTANT_METHODS } from './native-assistant.mjs';
import { NATIVE_TASK_METHODS } from './assistant/tasks/contract.mjs';
import { AGENTS } from './assistant/home/agent-sessions.mjs';
import {
  conversationState, deliveredPath, questionsFrom, recordConversationEvent, sessionPerformance,
  performanceEvent, toolPayload, toolReference, turnPerformance, validateAnswers,
} from './native-conversation.mjs';

const MAX_IMAGES = 3;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 400;
const MAX_ENTRY_TEXT = 60_000;
const MAX_COMPACTION_SUMMARY = 20_000;
const TOOL_DETAIL_MAX = 160;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_COMMAND_ARGUMENT_CHARS = 4000;
const MAX_MESSAGE_BYTES = 28 * 1024 * 1024;
const MAX_MESSAGES = 100;
const MAX_HISTORY_CHARS = 250_000;
const MAX_TRACE = 200;
const MAX_STREAM_CHARS = 200_000;
const MAX_STREAM_BLOCKS = 128;
const MAX_WINDOW_CHARS = 100_000;
const SESSION_ROWS_CACHE_MS = 1_000;
const WORKSPACE_CACHE_MS = 5_000;
const WATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EFFORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export const NATIVE_METHODS = Object.freeze([
  'workspace.list',
  'session.list',
  'session.search',
  'session.create',
  'session.open',
  'session.watch',
  'session.attachment',
  'session.unwatch',
  'session.send',
  'session.queue.update',
  'session.page',
  'session.tool',
  'session.changes',
  'session.diff',
  'session.file',
  'session.fork',
  'session.performance',
  'question.answer',
  'session.stop',
  'session.rename',
  'session.unarchive',
  'session.pin',
  'session.archive',
  'workspace.rename',
  'workspace.delete',
  'session.configure',
  'session.command',
  'file.upload',
  'files.list',
  'files.read',
  'catalog.get',
  'navigation.get',
  'assistant.open',
  ...NATIVE_ASSISTANT_METHODS,
  ...NATIVE_TASK_METHODS,
  // The subscription quota the plugin has kept: `{ ask }` (the phone's sheet opening is the ask, as the desktop icon's click is) -> `{ outcome, providers, refreshing, readAt }`.
  'quota.get',
  'plugins.list',
  'schedule.list',
  'approval.respond',
  ...NATIVE_PAGE_METHODS,
  ...NATIVE_BOARD_METHODS,
  ...NATIVE_SETTINGS_METHODS,
]);

const GATEWAY_ENDPOINTS = new Set([
  'session/list',
  'session/search',
  'session/create',
  'session/follow',
  'session/control',
  'session/cancel',
  'session/projections',
  'session/attachment',
  'session/prompt',
  'session/updateQueue',
  'session/page',
  'session/fork',
  'session/rename',
  'session/selectModel',
  'session/modelCatalog',
  'workspace/follow',
  'workspace/rename',
  'workspace/delete',
  'workspace/unarchiveSession',
  'workspace/archiveSession',
  'workspace/pinSession',
  'workspace/unpinSession',
  'permissionPresets/catalog',
  'agentPresets/list',
  'agentPresets/select',
  'userQuestions/answer',
  'commands/execute',
  'fileUploads/upload',
  'skills/list',
  'pluginManager/listPlugins',
  'schedule/catalog',
]);

const REQUEST_ARGUMENTS = new Map([
  ['skills/list', 'request'],
  ['session/search', 'request'],
  ['session/create', 'request'],
  ['session/follow', 'request'],
  ['session/cancel', 'request'],
  ['session/projections', 'request'],
  ['session/attachment', 'request'],
  ['session/prompt', 'request'],
  ['session/updateQueue', 'request'],
  ['session/page', 'request'],
  ['session/fork', 'request'],
  ['session/rename', 'request'],
  ['session/selectModel', 'request'],
  ['workspace/rename', 'request'],
  ['workspace/delete', 'request'],
  ['workspace/unarchiveSession', 'request'],
  ['workspace/archiveSession', 'request'],
  ['workspace/pinSession', 'request'],
  ['workspace/unpinSession', 'request'],
]);

function typertArguments(endpoint, values) {
  if (!GATEWAY_ENDPOINTS.has(endpoint)) throw new NativeBridgeError('UNSUPPORTED');
  if (REQUEST_ARGUMENTS.has(endpoint)) {
    if (!isRecord(values[0])) fail('BAD_REQUEST');
    return { [REQUEST_ARGUMENTS.get(endpoint)]: values[0] };
  }
  switch (endpoint) {
    case 'session/list':
      if (values.length > 1 || (values[0] !== undefined && !isRecord(values[0]))) fail('BAD_REQUEST');
      return { _request: values[0] ?? {} };
    case 'userQuestions/answer':
      if (values.length !== 3 || typeof values[0] !== 'string'
        || typeof values[1] !== 'string' || !isRecord(values[2])) fail('BAD_REQUEST');
      return { agentId: values[0], callId: values[1], answer: values[2] };
    case 'fileUploads/upload':
      if (values.length !== 2 || typeof values[0] !== 'string' || !values[0]
        || !isRecord(values[1]) || typeof values[1].data !== 'string') fail('BAD_REQUEST');
      return { agentId: values[0], request: values[1] };
    case 'commands/execute':
      if (values.length !== 1 || !isRecord(values[0])
        || typeof values[0].agentId !== 'string' || typeof values[0].line !== 'string'
        || !Array.isArray(values[0].submittedAttachments)) fail('BAD_REQUEST');
      return values[0];
    case 'agentPresets/select':
      if (values.length !== 2 || typeof values[0] !== 'string' || !values[0]
        || typeof values[1] !== 'string' || !PRESET_ID.test(values[1])) fail('BAD_REQUEST');
      return { agentId: values[0], agentPreset: values[1] };
    case 'workspace/follow':
    case 'session/control':
    case 'session/modelCatalog':
    case 'permissionPresets/catalog':
    case 'agentPresets/list':
    case 'pluginManager/listPlugins':
    case 'schedule/catalog':
      if (values.length !== 0) fail('BAD_REQUEST');
      return {};
    default:
      throw new NativeBridgeError('UNSUPPORTED');
  }
}

export function createTypertRpcAdapter({ gateway, peer, diagnostics }) {
  if (!gateway || typeof gateway.invoke !== 'function' || typeof gateway.stream !== 'function'
    || !peer || peer.principal?.kind !== 'owner') {
    throw new TypeError('Native bridge requires the owner-scoped Typert Gateway.');
  }
  const request = async (mode, channel, endpoint, values) => {
    if (channel !== '/api' || typeof endpoint !== 'string' || !GATEWAY_ENDPOINTS.has(endpoint)) {
      throw new NativeBridgeError('UNSUPPORTED');
    }
    const [namespace, method] = endpoint.split('/');
    let signal;
    if (values.at(-1) instanceof AbortSignal) signal = values.pop();
    const call = { namespace, method, args: typertArguments(endpoint, values), peer, signal };
    try {
      if (mode !== 'stream') return await gateway.invoke(call);
      const source = await gateway.stream(call);
      return {
        dispose: () => source.dispose?.(),
        async *[Symbol.asyncIterator]() {
          try { yield* source; }
          catch (error) {
            if (!signal?.aborted) diagnostics?.failure({ endpoint, stage: 'next', error });
            throw safeCallError();
          }
        },
      };
    } catch (error) {
      if (!signal?.aborted) diagnostics?.failure({ endpoint, stage: mode === 'stream' ? 'open' : 'invoke', error });
      throw safeCallError();
    }
  };
  return Object.freeze({
    call(channel, endpoint, ...values) {
      return request('call', channel, endpoint, values);
    },
    open(channel, endpoint, ...values) {
      return request('stream', channel, endpoint, values);
    },
  });
}

const SAFE_ERRORS = Object.freeze({
  BAD_REQUEST: '请求参数不正确。',
  NOT_FOUND: '找不到请求的会话或项目。',
  UNSUPPORTED: '此操作暂不受支持。',
  PERMISSION_UNSUPPORTED: '当前桌面服务不支持从手机修改权限预设。',
  INVALID_ATTACHMENT: '图片格式或大小不符合要求。',
  LIMIT_EXCEEDED: '请求内容过大。',
  STALE_APPROVAL: '此审批已失效或无法由手机处理。',
  UPSTREAM_ERROR: '桌面服务拒绝了此操作。',
  UPSTREAM_UNAVAILABLE: '桌面服务暂时无法完成此操作。',
});

export class NativeBridgeError extends Error {
  constructor(code, message = SAFE_ERRORS[code] ?? SAFE_ERRORS.UPSTREAM_UNAVAILABLE) {
    super(message);
    this.name = 'NativeBridgeError';
    this.code = code;
    this.publicMessage = SAFE_ERRORS[code] ?? SAFE_ERRORS.UPSTREAM_UNAVAILABLE;
  }
}

const fail = (code) => { throw new NativeBridgeError(code); };
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 200_000) => typeof value === 'string' ? value.slice(0, max) : '';

function unwrap(result) {
  if (isRecord(result) && typeof result.ok === 'boolean') {
    if (!result.ok) fail('UPSTREAM_ERROR');
    return result.value;
  }
  return result;
}

function safeCallError() {
  return new NativeBridgeError('UPSTREAM_UNAVAILABLE');
}

function createRemote(rpc) {
  if (!rpc || typeof rpc.call !== 'function' || typeof rpc.open !== 'function') {
    throw new TypeError('Native bridge requires the authenticated DSH Remote RPC client.');
  }
  return {
    async call(endpoint, ...args) {
      try { return unwrap(await rpc.call('/api', endpoint, ...args)); }
      catch (error) {
        if (error instanceof NativeBridgeError) throw error;
        throw safeCallError();
      }
    },
    async open(endpoint, ...args) {
      try { return unwrap(await rpc.open('/api', endpoint, ...args)); }
      catch (error) {
        if (error instanceof NativeBridgeError) throw error;
        throw safeCallError();
      }
    },
  };
}

function streamHandle(stream) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw new NativeBridgeError('UPSTREAM_UNAVAILABLE');
  }
  const iterator = stream[Symbol.asyncIterator]();
  let closed = false;
  return {
    next: () => iterator.next(),
    async close() {
      if (closed) return;
      closed = true;
      // Dispose the upstream stream first so a pending iterator.next() can settle.
      try { await stream.dispose?.(); } catch { /* Cancellation is best effort. */ }
      try { await iterator.return?.(); } catch { /* Cancellation is best effort. */ }
    },
  };
}

function projectionsFrom(value) {
  const values = {};
  const add = (candidate) => {
    if (isRecord(candidate?.values)) Object.assign(values, candidate.values);
  };
  if (Array.isArray(value)) value.forEach(add);
  else add(value);
  return values;
}

function summaryFrom(row) {
  const values = row?.projections?.values ?? {};
  const title = typeof values.title === 'string' ? values.title : values.title?.title;
  const questionCount = values.userQuestions?.active?.length ?? 0;
  const provider = (values.modelSelection?.next ?? values.modelSelection?.lastUsed)?.provider ?? row?.providerId;
  const indexed = row?.agentActivity;
  const agent = provider ? providerFamily(provider) : indexed?.agent ?? row?.agent ?? (indexed?.provider === 'dsh' ? 'deepseek' : indexed?.provider);
  const pending = questionCount > 0 || row?.status === 'waiting' || row?.pendingInteraction
    || approvalsFrom(values, row?.sessionId ?? row?.id).length > 0;
  return {
    id: text(row?.sessionId ?? row?.id, 256),
    ...(row?.isAssistant === true ? { isAssistant: true } : {}),
    title: text(title ?? row?.title, 300) || text(indexed?.title, 300) || '新对话',
    ...(typeof row?.workspaceId === 'string' ? { workspaceId: row.workspaceId } : {}),
    ...(typeof row?.workspaceName === 'string' ? { workspaceName: row.workspaceName } : {}),
    updatedAt: Number.isFinite(row?.updatedAt) ? row.updatedAt : 0,
    status: row?.running || row?.status === 'running' ? 'running'
      : questionCount > 0 || row?.status === 'waiting' ? 'waiting' : 'idle',
    ...(provider ? { providerId: provider } : {}),
    ...(['claude', 'codex', 'deepseek'].includes(agent) ? (() => {
      const live = { running: row?.running || row?.status === 'running', pendingInteraction: pending };
      // An agent in deep sleep is told to the phone with its mark as it is (owner, 2026-11-07): the phone draws the crescent over the corner, unless the session is alive again,
      // and it is the mark's own again when the agent wakes.
      const asleep = indexed?.deepSleep === true && !live.running && !live.pendingInteraction;
      const mark = agentMarkForActivity(live, values.duduAgentActivity, indexed);
      // A finished run is the state "blocked" too (the boss's turn), told from a question or a failure by the avatar's mark: a check, not red.
      return { agent, agentState: stateOfMark(mark), ...(mark === 'done' ? { agentFinished: true } : {}), ...(asleep ? { deepSleep: true } : {}) };
    })() : {}),
    // DSH reuses a blank session when a new task starts in the same workspace.
    ...(row?.blank === true && values.sessionListMetadata?.blank !== false ? { blank: true } : {}),
    // The archive and pin sets are DSH's, not the phone's.
    ...(row?.archived === true ? { archived: true } : {}),
    ...(row?.pinned === true ? { pinned: true, pinRank: Number.isSafeInteger(row.pinRank) ? row.pinRank : 0 } : {}),
  };
}

function messageFromEvent(event, sessionId) {
  if (!isRecord(event) || !isRecord(event.data) || event.surfaceOp !== 'append') return undefined;
  const data = event.data;
  let message;
  let role;
  if (event.type === 'user/message') {
    if (data.source?.kind === 'user') {
      message = data;
      role = 'user';
    } else {
      const changes = Array.isArray(data.content) ? data.content.flatMap((block) => {
        const name = text(block?.toolName, 200).trim();
        if (!name || !['tool-addition', 'tool-removal'].includes(block?.type)) return [];
        return [{ type: 'text', text: `${block.type === 'tool-addition' ? '已添加工具' : '已移除工具'} ${name}\n` }];
      }) : [];
      if (!changes.length) return undefined;
      message = { ...data, content: changes };
      role = 'notice';
    }
  } else if (event.type === 'assistant/message') {
    message = data.message;
    role = 'assistant';
  } else if (event.type === 'tool/result') {
    message = data.message;
    role = 'tool';
  } else {
    return undefined;
  }
  if (!isRecord(message)) return undefined;
  const content = message.content ?? data.content;
  const textParts = [];
  const reasoningParts = [];
  const toolCalls = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') textParts.push(block.text);
      else if (block.type === 'image') textParts.push('[图片]');
      else if (block.type === 'tool-result' && typeof block.text === 'string') textParts.push(block.text);
      else if (block.type === 'reasoning' && typeof block.text === 'string') reasoningParts.push(block.text);
      else if (block.type === 'tool-call') {
        toolCalls.push({
          id: text(block.id, 256),
          name: text(block.name, 200),
          detail: toolDetail(block.arguments ?? block.input, block.name),
        });
      }
    }
  }
  const toolName = text(message.source?.name ?? data.source?.name, 200);
  const result = {
    id: text(message.id, 256) || `${sessionId}:${event.seq ?? randomUUID()}`,
    role,
    text: text(textParts.join(''), MAX_WINDOW_CHARS),
    ...(reasoningParts.length ? { reasoning: text(reasoningParts.join(''), MAX_WINDOW_CHARS) } : {}),
    ...(role === 'assistant' ? { status: 'complete' } : {}),
    ...(role === 'tool' && toolName ? { toolName } : {}),
  };
  return {
    ...result,
    _seq: Number.isFinite(event.seq) ? event.seq : undefined,
    _turn: Number.isSafeInteger(data.turn) ? data.turn : undefined,
    _step: Number.isSafeInteger(data.step) ? data.step : undefined,
    _hasToolCalls: toolCalls.length > 0,
    _toolCalls: toolCalls,
    _calls: toolCalls,
    _toolCallId: text(message.toolCallId, 256),
    _toolError: message.isError === true,
  };
}

// ---- Transcript entries -------------------------------------------------------------------
// The phone rebuilds the official chat layout (turns, process groups, commands, triggers) from
// these compact entries, the same way DSH's own client folds surface events into nodes.

// Tool name -> activity kind, mirroring DSH's chat process grouping.
function toolActivity(name) {
  const value = typeof name === 'string' ? name : '';
  if (value === 'read') return 'read';
  if (value === 'read_image') return 'readImage';
  if (value === 'grep' || value === 'glob' || value.endsWith('_inspect')) return 'search';
  if (value === 'write') return 'write';
  if (value === 'edit' || value === 'apply_patch') return 'edit';
  if (['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(value) || value.startsWith('terminal_')) {
    return 'commands';
  }
  if (value === 'run_code') return 'code';
  if (value === 'web_search') return 'webSearch';
  if (value === 'web_fetch') return 'webFetch';
  if (value === 'subagent' || value.startsWith('subagent_')) return 'subagents';
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(value)) return 'plan';
  if (value === 'ask_user_question' || value === 'request_user_input') return 'questions';
  return 'tools';
}

const TOOL_DETAIL_KEYS = [
  'title', 'description', 'objective', 'task', 'task_name', 'name', 'question', 'questions',
  'prompt', 'message', 'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'uri',
  'file_path', 'path', 'target', 'action', 'status',
];

function oneLine(value) {
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  const chars = [...normalized];
  return chars.length <= TOOL_DETAIL_MAX ? normalized : `${chars.slice(0, TOOL_DETAIL_MAX - 1).join('').trimEnd()}…`;
}

function detailValue(value) {
  if (typeof value === 'string') return oneLine(value);
  if (Array.isArray(value) && value.length && value.every((item) => typeof item === 'string')) {
    return oneLine(value.join(', '));
  }
  return '';
}

function questionsDetail(value) {
  if (!Array.isArray(value)) return '';
  for (const item of value) {
    if (isRecord(item)) {
      const detail = detailValue(item.question);
      if (detail) return detail;
    }
  }
  return '';
}

// One-line task detail from a tool call's JSON arguments; tolerates arguments still streaming in.
function toolDetail(argumentsValue, name) {
  let parsed;
  if (isRecord(argumentsValue)) parsed = argumentsValue;
  else if (typeof argumentsValue === 'string' && argumentsValue) {
    try {
      const value = JSON.parse(argumentsValue);
      if (isRecord(value)) parsed = value;
    } catch {
      parsed = undefined;
    }
  }
  if (parsed) {
    for (const key of TOOL_DETAIL_KEYS) {
      if (!(key in parsed)) continue;
      const detail = key === 'questions' ? questionsDetail(parsed[key]) : detailValue(parsed[key]);
      if (detail) return detail;
    }
    return oneLine(name ?? '');
  }
  if (typeof argumentsValue === 'string' && argumentsValue) {
    // Partial JSON: read the first detail key whose string has started.
    for (const key of TOOL_DETAIL_KEYS) {
      const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(argumentsValue);
      if (match) {
        const raw = match[1].replace(/\\n/g, ' ').replace(/\\(["\\/])/g, '$1');
        if (raw.trim()) return oneLine(raw);
      }
    }
  }
  return '';
}

function triggerKind(source) {
  const kind = text(source?.kind, 64);
  if (!kind) return undefined;
  if (kind === 'webhook') return text(source?.provider, 32) === 'github' ? 'github' : 'webhook';
  return kind;
}

function turnOutcome(reason) {
  switch (reason) {
    case 'aborted': return 'stopped';
    case 'interrupted': return 'interrupted';
    case 'error': return 'failed';
    default: return 'done';
  }
}

function userAttachments(content, state, messageId, seq) {
  if (!Array.isArray(content)) return [];
  const result = [];
  for (const [index, block] of content.entries()) {
    if (!isRecord(block)) continue;
    if (block.type === 'image') {
      const attachment = { kind: 'image', name: text(block.attachment?.name ?? block.name, 160) || '图片' };
      const image = imageFromBlock(block);
      if (image) {
        attachment.id = `${messageId}:${index}`;
        if (Number.isSafeInteger(seq)) attachment.seq = seq;
        state.imageChars -= state.images.get(attachment.id)?.data?.length ?? 0;
        state.images.set(attachment.id, image);
        state.imageChars += image.data?.length ?? 0;
        while (state.images.size > MAX_ENTRIES || state.imageChars > Math.ceil(MAX_TOTAL_IMAGE_BYTES / 3) * 4) {
          const oldest = state.images.keys().next().value;
          state.imageChars -= state.images.get(oldest).data?.length ?? 0;
          state.images.delete(oldest);
        }
      }
      result.push(attachment);
    }
    else if (block.type === 'file') result.push({ kind: 'file', name: text(block.name ?? block.fileName, 160) || '文件' });
  }
  return result.slice(0, 12);
}

function entryWeight(entry) {
  return (entry.text?.length ?? 0) + (entry.reasoning?.length ?? 0)
    + (entry.compaction?.summary?.length ?? 0) + (entry.type === 'compaction' ? entry.summary?.length ?? 0 : 0);
}

// Entries change after they are pushed (a command gains its result, a compaction its summary), so
// the size budget is recomputed instead of tracked incrementally.
function trimEntries(state) {
  let chars = state.entries.reduce((sum, item) => sum + entryWeight(item), 0);
  while (state.entries.length > 1 && (state.entries.length > MAX_ENTRIES || chars > MAX_HISTORY_CHARS)) {
    chars -= entryWeight(state.entries.shift());
    state.historyTrimmed = true;
  }
  state.entryChars = chars;
}

function pushEntry(state, entry) {
  state.entries.push(entry);
  trimEntries(state);
}

function recordInboxClaim(state, event) {
  const splice = event.data;
  if (!['next-turn', 'next-step'].includes(splice?.target)) return;
  const previous = state.inboxClaims[splice.target];
  const pending = [...previous.pending];
  const inserted = Array.isArray(splice.inserted) ? splice.inserted : [];
  const removed = pending.splice(splice.start, splice.removedCount ?? 0, ...inserted);
  if (splice.outcome === 'canceled') {
    for (const message of removed) {
      if (message.source?.kind === 'user' && typeof message.source.rpcId === 'string') {
        state.canceledRequestIds.add(message.source.rpcId);
      }
    }
    while (state.canceledRequestIds.size > 100) {
      state.canceledRequestIds.delete(state.canceledRequestIds.values().next().value);
    }
  }
  const entered = removed.length > 0 && splice.outcome !== 'canceled';
  state.inboxClaims[splice.target] = {
    pending,
    claimed: entered ? new Set(removed.map((message) => message.id))
      : new Set([...previous.claimed].filter((id) => !inserted.some((message) => message.id === id))),
    seq: entered ? event.seq : previous.seq,
    human: entered ? removed.some((message) => message.source?.kind === 'user') : previous.human,
  };
}

function wakesTurn(state, id) {
  const nextTurn = state.inboxClaims['next-turn'];
  const nextStep = state.inboxClaims['next-step'];
  return nextTurn.claimed.has(id)
    || (state.activeStep === 1 && nextStep.seq > state.turnStartSeq
      && nextTurn.seq < state.turnStartSeq && !nextStep.human && nextStep.claimed.has(id));
}

function recordTranscriptEvent(state, event, message, sessionId) {
  const type = event?.type;
  const data = isRecord(event?.data) ? event.data : {};
  const time = Number.isFinite(event?.time) ? event.time : undefined;
  const seq = Number.isFinite(event?.seq) ? event.seq : undefined;
  const extra = state.conversation.turns.get(data.turn);
  if (['llm/retry', 'turn/end', 'workspace/changes', 'deliverables/presented'].includes(type) && extra
    && (extra.notices.length || extra.files.length || extra.changesSeq !== undefined)
    && !state.entries.some((entry) => entry.turn === data.turn && ['assistant', 'turn-marker'].includes(entry.type))) {
    pushEntry(state, { type: 'turn-marker', id: `turn-marker:${data.turn}`, turn: data.turn, seq, time });
  }
  if (type === 'agent/inbox/spliced') {
    recordInboxClaim(state, event);
    return;
  }
  if (type === 'turn/start' && Number.isSafeInteger(data.turn)) {
    state.turnStartSeq = seq ?? -1;
    state.activeStep = 1;
    state.turnTimes.set(data.turn, { start: time });
    return;
  }
  if (type === 'step/start') state.activeStep = data.step;
  if (type === 'turn/end' && Number.isSafeInteger(data.turn)) {
    const turn = state.turnTimes.get(data.turn) ?? {};
    state.turnTimes.set(data.turn, { ...turn, end: time, outcome: turnOutcome(data.reason?.kind) });
    return;
  }
  if (type === 'tool/result' && event.surfaceOp === 'append') {
    const callId = text(data.message?.toolCallId ?? data.message?.source?.callId, 256);
    if (callId) state.callResults.set(callId, data.message?.isError === true ? 'error' : 'done');
    return;
  }
  if (type === 'command/run') {
    if (data.name === 'permission') return;
    const commandId = text(data.commandId, 128);
    if (!commandId) return;
    pushEntry(state, {
      type: 'command', id: `command:${commandId}`, commandId, seq, time,
      name: text(data.name, 80),
      ...(data.source?.kind === 'dudu-harness' ? { source: 'dudu-harness' } : {}),
    });
    return;
  }
  if (type === 'command/done') {
    const entry = state.entries.findLast((item) => item.type === 'command' && item.commandId === text(data.commandId, 128));
    if (entry) {
      entry.outcome = data.kind === 'error' ? 'error' : 'success';
      if (typeof data.text === 'string') entry.summary = text(data.text, 2000);
    }
    return;
  }
  if (type === 'compaction/summary') {
    const items = Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : undefined;
    const tokens = Number.isSafeInteger(data.shadowedTokenCount) ? data.shadowedTokenCount : undefined;
    // The summary the model keeps instead of the folded history; DSH shows it when the row is opened.
    const summaryText = Array.isArray(data.summary)
      ? data.summary.map((block) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .join('').trim()
      : '';
    const summary = summaryText ? text(summaryText, MAX_COMPACTION_SUMMARY) : undefined;
    const commandId = text(data.sourceCommandId, 128);
    const owner = commandId
      ? state.entries.findLast((item) => item.type === 'command' && item.commandId === commandId)
      : undefined;
    if (owner) {
      owner.compaction = {
        ...(items !== undefined ? { items } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        ...(summary ? { summary } : {}),
      };
      trimEntries(state);
    } else {
      pushEntry(state, {
        type: 'compaction', id: `compaction:${text(data.compactionId, 128) || seq}`, seq, time,
        ...(items !== undefined ? { items } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        ...(summary ? { summary } : {}),
      });
    }
    return;
  }
  if (event.surfaceOp !== 'append') return;
  if (type === 'user/message') {
    if (data.source?.kind === 'user') {
      if (!message) return;
      const attachments = userAttachments(data.content, state, message.id, seq);
      // Attachments are listed separately; the legacy "[图片]" placeholder stays out of the bubble.
      const body = Array.isArray(data.content)
        ? data.content.filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text).join('') : message.text;
      pushEntry(state, {
        type: 'user', id: message.id, seq, time, text: text(body, MAX_ENTRY_TEXT),
        ...(typeof data.source.rpcId === 'string' ? { requestId: data.source.rpcId } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
    } else {
      const kind = triggerKind(data.source);
      if (kind && wakesTurn(state, data.id)) {
        const body = Array.isArray(data.content)
          ? data.content.filter((block) => block?.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text).join('\n') : '';
        pushEntry(state, {
          type: 'trigger', id: text(data.id, 256) || `trigger:${seq}`, seq, time, source: kind,
          text: text(body, 4000),
        });
      }
    }
    return;
  }
  if (type === 'assistant/message') {
    if (!message) return;
    const calls = (message._calls ?? []).map((call) => ({
      id: call.id, name: call.name, activity: toolActivity(call.name), detail: call.detail,
    }));
    pushEntry(state, {
      type: 'assistant', id: message.id, seq, time,
      ...(Number.isSafeInteger(message._turn) ? { turn: message._turn } : {}),
      ...(Number.isSafeInteger(message._step) ? { step: message._step } : {}),
      ...(message.text ? { text: text(message.text, MAX_ENTRY_TEXT) } : {}),
      ...(message.reasoning ? { reasoning: text(message.reasoning, MAX_ENTRY_TEXT) } : {}),
      ...(calls.length ? { calls } : {}),
      ...(Number.isFinite(data.usage?.totalTokens) ? { usage: Math.max(0, Math.round(data.usage.totalTokens)) } : {}),
    });
  }
}

function addTrace(state, item) {
  if (!item.id || !item.name) return;
  const index = state.trace.findIndex((entry) => entry.id === item.id);
  if (index >= 0) state.trace[index] = { ...state.trace[index], ...item };
  else state.trace.push(item);
  if (state.trace.length > MAX_TRACE) state.trace.splice(0, state.trace.length - MAX_TRACE);
}

function messageChars(message) {
  return (message.text?.length ?? 0) + (message.reasoning?.length ?? 0);
}

function trimHistoryToBudget(state) {
  let excess = state.historyChars - MAX_HISTORY_CHARS;
  for (const message of state.messages) {
    if (excess <= 0) break;
    const textLength = message.text?.length ?? 0;
    const fromText = Math.min(excess, textLength);
    if (fromText) {
      message.text = message.text.slice(fromText);
      state.historyChars -= fromText;
      excess -= fromText;
    }
    const reasoningLength = message.reasoning?.length ?? 0;
    const fromReasoning = Math.min(excess, reasoningLength);
    if (fromReasoning) {
      message.reasoning = message.reasoning.slice(fromReasoning);
      state.historyChars -= fromReasoning;
      excess -= fromReasoning;
    }
  }
}

function appendEvent(state, event, sessionId) {
  recordConversationEvent(state.conversation, event);
  const turn = event?.data?.turn;
  const step = event?.data?.step;
  if (Number.isSafeInteger(turn) && Number.isSafeInteger(step)) {
    state.turnSteps.set(turn, Math.max(state.turnSteps.get(turn) ?? 0, step));
    if (state.turnSteps.size > MAX_MESSAGES) {
      const oldest = state.turnSteps.keys().next().value;
      state.turnSteps.delete(oldest);
      state.completedTurns.delete(oldest);
    }
  }
  const message = messageFromEvent(event, sessionId);
  recordTranscriptEvent(state, event, message, sessionId);
  if (message) {
    for (const call of message._toolCalls) {
      addTrace(state, { id: `tool:${call.id}`, name: call.name, subtitle: '工具调用', enabled: true });
    }
    if (message.role === 'tool' && message._toolCallId) {
      const existing = state.trace.find((entry) => entry.id === `tool:${message._toolCallId}`);
      if (existing) {
        addTrace(state, {
          ...existing,
          subtitle: message._toolError ? '执行失败' : '已完成',
          enabled: false,
        });
      }
    }
    delete message._toolCalls;
    delete message._calls;
    delete message._toolCallId;
    delete message._toolError;
    // Chat follows human append events; model replacements and tool details belong to other views.
    if (message.role !== 'tool' && message.text.trim()) {
      state.messages.push(message);
      state.historyChars += messageChars(message);
    }
    if (state.messages.length > MAX_MESSAGES) {
      const removed = state.messages.splice(0, state.messages.length - MAX_MESSAGES);
      state.historyChars -= removed.reduce((total, item) => total + messageChars(item), 0);
    }
    trimHistoryToBudget(state);
  }
  if (event?.type === 'turn/start') {
    state.summary.status = 'running';
    state.completedTurns.delete(turn);
  }
  else if (event?.type === 'turn/end') {
    state.summary.status = 'idle';
    if (Number.isSafeInteger(turn) && state.turnSteps.has(turn)
      && !['aborted', 'interrupted', 'error'].includes(event.data?.reason?.kind)) {
      state.completedTurns.add(turn);
    }
  }
}

function publicMessages(messages, state) {
  const hidden = new Set();
  const processByAnswer = new Map();
  for (const turn of state.completedTurns) {
    const answer = messages.findLast((item) => item.role === 'assistant' && item._turn === turn);
    if (!answer || answer._hasToolCalls || answer._step !== state.turnSteps.get(turn)) continue;
    const earlier = messages.filter((item) => item.role === 'assistant' && item._turn === turn
      && Number.isSafeInteger(item._step) && item._step < answer._step);
    if (!earlier.length) continue;
    const start = messages.indexOf(earlier[0]);
    const end = messages.indexOf(answer);
    if (messages.slice(start + 1, end).some((item) => item.role === 'user')) continue;
    for (const item of earlier) hidden.add(item);
    processByAnswer.set(answer, text(earlier.map((item) =>
      [item.reasoning, item.text].filter(Boolean).join('\n\n')).join('\n\n---\n\n'), MAX_WINDOW_CHARS));
  }
  return messages.filter((message) => !hidden.has(message)).slice(-MAX_MESSAGES)
    .map((item) => {
      const { _seq, _turn, _step, _hasToolCalls, ...message } = item;
      const process = processByAnswer.get(item);
      return { ...message, ...(process ? { process } : {}) };
    });
}

function contextFrom(values) {
  const entries = [];
  const current = values.contextTimeline?.current;
  if (isRecord(current)) {
    for (const key of ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool']) {
      const count = current[key];
      if (Number.isFinite(count) && count > 0) {
        entries.push({
          id: `context:${key}`,
          name: `${key[0].toUpperCase()}${key.slice(1)} context`,
          detail: `${Math.round(count)} tokens`,
        });
      }
    }
  }
  const headers = values.contextHeaders?.headers;
  if (Array.isArray(headers)) {
    const names = headers.flatMap((header) => Array.isArray(header?.tools) ? header.tools : [])
      .map((tool) => text(tool?.name ?? tool, 160)).filter(Boolean);
    for (const [index, name] of [...new Set(names)].slice(0, 50).entries()) {
      entries.push({ id: `context:tool:${index}`, name, subtitle: '当前工具上下文' });
    }
  }
  return entries.slice(0, 100);
}

function approvablePlanReview(call) {
  if (!isRecord(call) || typeof call.callId !== 'string' || !call.callId
    || call.callId.length > 512 || !Array.isArray(call.questions) || call.questions.length !== 1) {
    return undefined;
  }
  const question = call.questions[0];
  const approve = question?.intent?.approve;
  if (!isRecord(question) || typeof question.id !== 'string' || !question.id
    || typeof question.question !== 'string' || !question.question.trim()
    || question.intent?.kind !== 'plan-review' || typeof approve !== 'string'
    || !Array.isArray(question.options)
    || !question.options.some((option) => option?.label === approve)) {
    return undefined;
  }
  return question;
}

function approvalsFrom(values, sessionId) {
  const active = values.userQuestions?.active;
  if (!Array.isArray(active) || !sessionId) return [];
  return active.flatMap((call) => {
    const question = approvablePlanReview(call);
    if (!question) return [];
    return [{
      id: call.callId,
      sessionId,
      title: text(question.question, 2000),
      ...(typeof question.detail === 'string' && question.detail
        ? { detail: text(question.detail, 20_000) } : {}),
    }];
  });
}

function goalFrom(values) {
  const goal = values.goal?.goal;
  if (!isRecord(goal) || !['active', 'paused', 'blocked'].includes(goal.phase)) return undefined;
  const objective = text(goal.objective, 4000);
  if (!objective) return undefined;
  return {
    id: text(goal.id, 128),
    phase: goal.phase,
    objective,
    ...(goal.phase === 'blocked' && typeof goal.blockedReason?.message === 'string'
      ? { blocked: text(goal.blockedReason.message, 500) } : {}),
  };
}

const TODO_STATUSES = new Set(['completed', 'in_progress', 'pending']);
const MAX_TODOS = 100;

/**
 * The conversation's task list: DSH's `todos` projection, which its own "任务" panel above the composer shows.
 * Each item is its text and one of three states. A list that is absent or empty is no list.
 */
function todosFrom(values) {
  if (!Array.isArray(values.todos)) return undefined;
  const items = values.todos.flatMap((item) => {
    const content = isRecord(item) ? text(item.content, 500).trim() : '';
    if (!content) return [];
    return [{ content, status: TODO_STATUSES.has(item.status) ? item.status : 'pending' }];
  }).slice(0, MAX_TODOS);
  return items.length ? items : undefined;
}

function planModeFrom(values) {
  const plan = values.plan;
  if (!isRecord(plan)) return false;
  return plan.pending ? !plan.active : plan.active === true;
}

function liveStep(state) {
  const live = state.live;
  if (!live) return undefined;
  const blocks = [...live.blocks.values()];
  const reasoning = blocks.filter((block) => block.type === 'reasoning').map((block) => block.text).join('');
  const body = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('');
  const calls = blocks.filter((block) => block.type === 'tool-call' && block.id && block.name).map((block) => ({
    id: block.id,
    name: block.name,
    activity: toolActivity(block.name),
    detail: toolDetail(block.argsRaw, block.name),
    ...(state.callResults.has(block.id) ? { status: state.callResults.get(block.id) } : {}),
  }));
  if (!reasoning && !body && !calls.length) return undefined;
  return {
    id: `live:${live.attemptId}`,
    ...(body ? { text: text(body, MAX_STREAM_CHARS) } : {}),
    ...(reasoning ? { reasoning: text(reasoning, MAX_STREAM_CHARS) } : {}),
    ...(calls.length ? { calls } : {}),
  };
}

// The contents of a card of 嘟嘟's chat, by the id of the command that made it (set when the bridge is made; nothing when the plugin has none). The lines of the group chat are kept the same way,
// and the lines the owner hid (by the sequence number of their event) are left out of the thread of that conversation.
let cardOf = () => null;
let groupOf = () => null;
let hiddenOf = () => null;
let assistantId = () => null;

function transcriptFrom(state, changeCounts) {
  const hidden = state.summary?.id && state.summary.id === assistantId() ? hiddenOf() : null;
  const shown = hidden?.size ? state.entries.filter((entry) => !(Number.isSafeInteger(entry.seq) && hidden.has(entry.seq))) : state.entries;
  const entries = shown.map((entry) => {
    // A line of the group chat (the owner's @ message to an issue, its answer) is its command's pair of events too, with what it said that moment.
    if (entry.type === 'command' && entry.name === SAY_COMMAND && entry.outcome === 'success') {
      const group = groupOf(entry.commandId);
      return group ? { ...entry, group } : entry;
    }
    // A quick button's card is its command's pair of events, with what it listed that moment; a card that is no longer known stays the plain command.
    if (entry.type === 'command' && entry.name === CARD_COMMAND && entry.outcome === 'success') {
      const card = cardOf(entry.commandId);
      return card ? { ...entry, card } : entry;
    }
    if (entry.type !== 'assistant' || !entry.calls) return entry;
    return {
      ...entry,
      calls: entry.calls.map((call) => ({
        ...call, ...toolReference(state.conversation, call.id),
        status: state.callResults.get(call.id) ?? 'running',
      })),
    };
  });
  const turns = [...state.turnTimes].map(([turn, info]) => ({
    turn,
    ...(Number.isFinite(info.start) ? { start: info.start } : {}),
    ...(Number.isFinite(info.end) ? { end: info.end } : {}),
    ...(info.outcome ? { outcome: info.outcome } : {}),
    ...state.conversation.turns.get(turn),
  })).slice(-MAX_MESSAGES);
  const live = liveStep(state);
  for (const [turn, extra] of state.conversation.turns) {
    if (!turns.some((item) => item.turn === turn)) turns.push({ turn, ...extra });
  }
  for (const turn of turns) {
    if (!Number.isSafeInteger(turn.changesSeq)) continue;
    const summary = changeCounts?.(state.summary.id, turn.changesSeq);
    if (summary) turn.changesSummary = summary;
  }
  const beforeSeq = state.historyTrimmed
    ? entries.find((entry) => Number.isSafeInteger(entry.seq))?.seq ?? state.historyStart
    : state.historyStart;
  return {
    entries, turns, ...(live ? { live } : {}),
    // The host has accepted these inputs for the next step, but has not appended user/message yet.
    // Keep them separate from durable entries, as DSH's PendingSteeringBubble does.
    pendingInputs: queueFrom(state.values, 'next-step').filter((message) =>
      (state.values.inbox?.['next-step'] ?? []).some((item) => item.id === message.id && item.source?.kind === 'user')
      && !entries.some((entry) => entry.type === 'user' && entry.id === message.id)),
    tools: Object.fromEntries([...state.conversation.tools.keys()].map((id) => [id, toolReference(state.conversation, id)])),
    beforeSeq, throughSeq: state.conversation.cursor,
    hasMore: beforeSeq > 0 && (state.hasMore || state.historyTrimmed),
  };
}

function queueFrom(values, lane = 'next-turn') {
  const pending = values.inbox?.[lane];
  if (!Array.isArray(pending)) return [];
  return pending.flatMap((message) => {
    if (typeof message?.id !== 'string' || !Array.isArray(message.content)) return [];
    const body = message.content.filter((block) => block?.type === 'text')
      .map((block) => typeof block.text === 'string' ? block.text : '').join('');
    const attachments = message.content.flatMap((block, index) => {
      if (!['image', 'file'].includes(block?.type)) return [];
      const image = imageFromBlock(block);
      return [{
        kind: block.type,
        name: text(block.attachment?.name ?? block.name, 160) || (block.type === 'image' ? '图片' : '文件'),
        ...(image ? { id: `queue:${message.id}:${index}` } : {}),
      }];
    });
    return [{
      id: text(message.id, 256), text: text(body, MAX_ENTRY_TEXT),
      ...(message.source?.kind === 'user' && typeof message.source.rpcId === 'string'
        ? { requestId: message.source.rpcId } : {}),
      editable: body.length <= MAX_ENTRY_TEXT
        && message.content.every((block) => block?.type === 'text' && typeof block.text === 'string'),
      ...(attachments.length ? { attachments: attachments.slice(0, 12) } : {}),
    }];
  }).slice(0, 100);
}

function detailFrom(state, { transcript = false, changeCounts } = {}) {
  const values = state.values;
  const summary = summaryFrom({ ...state.summary, projections: { values } });
  const model = values.modelSelection?.next ?? values.modelSelection?.lastUsed;
  const permission = values.permissions?.currentValue;
  const team = values.agentTeam?.members;
  const messages = [...state.messages];
  const live = state.live;
  if (live) {
    const blocks = [...live.blocks.values()];
    const liveText = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('');
    const reasoning = blocks.filter((block) => block.type === 'reasoning').map((block) => block.text).join('');
    if (liveText || reasoning) {
      messages.push({
        id: `live:${live.attemptId}`,
        role: 'assistant',
        text: text(liveText, MAX_STREAM_CHARS),
        ...(reasoning ? { reasoning: text(reasoning, MAX_STREAM_CHARS) } : {}),
        status: live.status ?? 'streaming',
      });
    }
  }
  return {
    session: summary,
    messages: transcript ? [] : publicMessages(messages, state),
    ...(transcript ? { transcript: transcriptFrom(state, changeCounts) } : {}),
    ...(goalFrom(values) ? { goal: goalFrom(values) } : {}),
    ...(todosFrom(values) ? { todos: todosFrom(values) } : {}),
    queuedMessages: queueFrom(values),
    canceledRequestIds: [...state.canceledRequestIds],
    questions: questionsFrom(values, state.summary.id, approvablePlanReview),
    planMode: planModeFrom(values),
    ...(model?.provider && model?.model ? { modelId: `${model.provider}:${model.model}` } : {}),
    ...(typeof model?.reasoningEffort === 'string' ? { reasoningEffort: model.reasoningEffort } : {}),
    ...(typeof values.agentPreset === 'string' ? { agentPreset: values.agentPreset } : {}),
    ...(typeof permission === 'string' ? { permissionId: permission } : {}),
    context: contextFrom(values),
    trace: state.trace.slice(-MAX_TRACE),
    approvals: approvalsFrom(values, state.summary.id),
    team: Array.isArray(team) ? team.map((member) => ({
      id: text(member.id, 256),
      name: text(member.name, 200),
      subtitle: text(member.role, 100),
      enabled: member.phase === 'active',
      detail: text(member.phase, 100),
    })) : [],
  };
}

function emptySessionState(summary) {
  return {
    summary, messages: [], historyChars: 0, values: {}, trace: [], live: undefined,
    turnSteps: new Map(), completedTurns: new Set(),
    entries: [], entryChars: 0, turnTimes: new Map(), callResults: new Map(),
    images: new Map(), imageChars: 0,
    canceledRequestIds: new Set(),
    inboxClaims: {
      'next-turn': { pending: [], claimed: new Set(), seq: -1, human: false },
      'next-step': { pending: [], claimed: new Set(), seq: -1, human: false },
    },
    turnStartSeq: -1, activeStep: undefined,
    projectionSeqs: new Map(), conversation: conversationState(),
    historyStart: 0, hasMore: false, historyTrimmed: false,
  };
}

function traceToolBlock(state, block) {
  if (block?.type !== 'tool-call') return;
  addTrace(state, {
    id: `tool:${text(block.id, 256)}`,
    name: text(block.name, 200),
    subtitle: '工具调用',
    enabled: true,
  });
}

function appendStreamText(state, block, value) {
  if (typeof value !== 'string' || !value) return;
  const remaining = MAX_STREAM_CHARS - state.live.totalChars;
  if (remaining <= 0) return;
  const addition = value.slice(0, remaining);
  block.text += addition;
  state.live.totalChars += addition.length;
}

function replaceStreamText(state, block, value) {
  const previousLength = block.text.length;
  const room = Math.max(0, MAX_STREAM_CHARS - (state.live.totalChars - previousLength));
  block.text = text(value, room);
  state.live.totalChars += block.text.length - previousLength;
}

function applyCompactChunk(state, chunkRecord) {
  if (!isRecord(chunkRecord)) return;
  const chunk = isRecord(chunkRecord.chunk) ? chunkRecord.chunk : chunkRecord;
  const type = chunk.type;
  const index = Number.isFinite(chunk.index) ? chunk.index
    : Number.isFinite(chunkRecord.index) ? chunkRecord.index : 0;
  if (type === 'block-start') {
    if (state.live.blocks.size >= MAX_STREAM_BLOCKS && !state.live.blocks.has(index)) {
      const oldest = state.live.blocks.keys().next().value;
      const removed = state.live.blocks.get(oldest);
      state.live.totalChars -= removed?.text.length ?? 0;
      state.live.blocks.delete(oldest);
    }
    state.live.blocks.set(index, { type: text(chunk.blockType, 80), text: '' });
    return;
  }
  let block = state.live.blocks.get(index);
  if (!block) {
    if (state.live.blocks.size >= MAX_STREAM_BLOCKS) return;
    block = { type: type?.startsWith('reasoning') ? 'reasoning' : 'text', text: '' };
    state.live.blocks.set(index, block);
  }
  if (type === 'reasoning-chunks' || type === 'text-chunks'
    || type === 'reasoning-delta' || type === 'text-delta') {
    block.type = type.startsWith('reasoning') ? 'reasoning' : 'text';
    if (Array.isArray(chunk.texts)) {
      for (const part of chunk.texts) appendStreamText(state, block, part);
    } else appendStreamText(state, block, chunk.text);
    return;
  }
  if (type === 'tool-call-delta') {
    block.type = 'tool-call';
    block.id = text(chunk.id, 256) || block.id;
    block.name = text(chunk.name, 200) || block.name;
    if (typeof chunk.argumentsDelta === 'string' && (block.argsRaw?.length ?? 0) < 8192) {
      block.argsRaw = `${block.argsRaw ?? ''}${chunk.argumentsDelta}`.slice(0, 8192);
    }
    traceToolBlock(state, { type: 'tool-call', id: block.id, name: block.name });
    return;
  }
  if (type === 'block-end' && isRecord(chunk.block)) {
    block.type = text(chunk.block.type, 80) || block.type;
    if (typeof chunk.block.text === 'string') replaceStreamText(state, block, chunk.block.text);
    traceToolBlock(state, {
      ...chunk.block,
      id: chunk.block.id ?? block.id,
      name: chunk.block.name ?? block.name,
    });
  }
}

function installSnapshot(state, snapshot, sessionId) {
  state.messages = [];
  state.historyChars = 0;
  state.turnSteps.clear();
  state.completedTurns.clear();
  state.entries = [];
  state.images.clear();
  state.imageChars = 0;
  state.entryChars = 0;
  state.turnTimes.clear();
  state.callResults.clear();
  state.conversation = conversationState();
  state.conversation.cursor = snapshot.cursor ?? -1;
  state.historyStart = snapshot.records?.find((record) => Number.isSafeInteger(record?.event?.seq))?.event.seq ?? 0;
  state.hasMore = snapshot.hasMore === true;
  state.historyTrimmed = false;
  state.inboxClaims = emptySessionState({}).inboxClaims;
  state.turnStartSeq = -1;
  state.activeStep = undefined;
  const previousValues = state.values;
  state.values = projectionsFrom(snapshot.projections);
  const asOfSeq = Number.isFinite(snapshot.projections?.asOfSeq) ? snapshot.projections.asOfSeq : -1;
  for (const [key, seq] of state.projectionSeqs) {
    if (seq <= asOfSeq) continue;
    if (Object.hasOwn(previousValues, key)) state.values[key] = previousValues[key];
    else delete state.values[key];
  }
  for (const key of new Set([...Object.keys(state.values), ...state.projectionSeqs.keys()])) {
    state.projectionSeqs.set(key, Math.max(asOfSeq, state.projectionSeqs.get(key) ?? -1));
  }
  state.trace = [];
  state.live = undefined;
  for (const record of snapshot.records ?? []) {
    if (record?.type === 'event') appendEvent(state, record.event, sessionId);
  }
  for (const target of ['next-turn', 'next-step']) {
    const pending = state.values.inbox?.[target];
    if (Array.isArray(pending)) state.inboxClaims[target].pending = [...pending];
  }
  const active = snapshot.assistantStream?.activeAttempt;
  if (isRecord(active) && typeof active.attemptId === 'string') {
    state.live = {
      attemptId: active.attemptId,
      revision: Number.isFinite(snapshot.assistantStream?.revision) ? snapshot.assistantStream.revision : 0,
      nextIndex: Number.isFinite(active.nextIndex) ? active.nextIndex : 0,
      totalChars: 0,
      blocks: new Map(),
    };
    for (const compact of (active.stream ?? []).slice(-4096)) applyCompactChunk(state, compact);
  }
}

function applyProjection(state, key, value, seq) {
  if (typeof key !== 'string' || !Number.isFinite(seq)
    || seq <= (state.projectionSeqs.get(key) ?? -1)) return false;
  state.projectionSeqs.set(key, seq);
  state.values[key] = value;
  return true;
}

function applyControlFrame(state, frame, sessionId) {
  if (frame?.type === 'baseline') {
    const baseline = frame.value?.projections?.[sessionId];
    if (!isRecord(baseline?.values) || !Number.isFinite(baseline.asOfSeq)) return false;
    let changed = false;
    for (const key of Object.keys(state.values)) {
      if (!Object.hasOwn(baseline.values, key) && baseline.asOfSeq >= (state.projectionSeqs.get(key) ?? -1)) {
        delete state.values[key];
        state.projectionSeqs.set(key, baseline.asOfSeq);
        changed = true;
      }
    }
    for (const [key, value] of Object.entries(baseline.values)) {
      if (applyProjection(state, key, value, baseline.asOfSeq)) changed = true;
    }
    return changed;
  } else if (frame?.type === 'projection' && frame.sessionId === sessionId) {
    return applyProjection(state, frame.key, frame.value, frame.seq);
  }
  return false;
}

function applyFollowFrame(state, frame, sessionId) {
  if (frame?.type === 'snapshot') {
    installSnapshot(state, frame, sessionId);
  } else if (frame?.type === 'event') {
    appendEvent(state, frame.event, sessionId);
    if (frame.event?.type === 'agent/inbox/spliced') {
      const splice = frame.event.data;
      if (['next-turn', 'next-step'].includes(splice.target)
        && frame.event.seq > (state.projectionSeqs.get('inbox') ?? -1)) {
        const pending = [...(state.values.inbox?.[splice.target] ?? [])];
        pending.splice(splice.start, splice.removedCount ?? 0, ...(splice.inserted ?? []));
        applyProjection(state, 'inbox', { ...state.values.inbox, [splice.target]: pending }, frame.event.seq);
      }
    }
    if (frame.event?.type === 'assistant/message' && frame.event.surfaceOp === 'append') state.live = undefined;
  } else if (frame?.type === 'assistant-stream' && isRecord(frame.frame)) {
    const item = frame.frame;
    if (item.type === 'start') {
      state.live = {
        attemptId: text(item.attemptId, 256),
        revision: Number.isFinite(item.revision) ? item.revision : 0,
        nextIndex: 0,
        totalChars: 0,
        blocks: new Map(),
      };
    } else if (item.type === 'chunk' && state.live?.attemptId === item.attemptId) {
      if (!Number.isFinite(item.index) || item.index < state.live.nextIndex
        || item.revision < state.live.revision || item.index !== state.live.nextIndex) return;
      state.live.revision = item.revision;
      applyCompactChunk(state, { index: item.index, chunk: item.chunk });
      state.live.nextIndex++;
    } else if (item.type === 'end' && state.live?.attemptId === item.attemptId
      && item.outcome?.kind === 'abandoned') {
      state.live = undefined;
    } else if (item.type === 'end' && state.live?.attemptId === item.attemptId
      && item.outcome?.kind === 'committed') {
      state.live.status = 'complete';
    }
  }
}

function firstSessionFrame(frame) {
  if (!isRecord(frame) || frame.type !== 'snapshot') throw new NativeBridgeError('UPSTREAM_UNAVAILABLE');
  return frame;
}

function sessionAddress(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) fail('BAD_REQUEST');
  return { kind: 'session', sessionId };
}

function normalizeWorkspace(row) {
  return {
    id: text(row?.workspaceId ?? row?.id, 256),
    name: text(row?.title ?? row?.name, 300) || 'Workspace',
    ...(typeof row?.path === 'string' ? { path: row.path } : {}),
  };
}

function layoutFrom(value) {
  const placed = new Map();
  for (const item of value?.items ?? []) {
    const workspace = normalizeWorkspace(item);
    if (!workspace.id || !Array.isArray(item?.sessionIds)) continue;
    for (const sessionId of item.sessionIds) {
      if (typeof sessionId === 'string' && !placed.has(sessionId)) {
        placed.set(sessionId, { workspaceId: workspace.id, workspaceName: workspace.name });
      }
    }
  }
  const strings = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []);
  return {
    archived: new Set(strings(value?.archivedSessionIds)),
    pinned: strings(value?.pinnedSessionIds),
    placed,
  };
}

function arrayValue(result, key) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.[key])) return result[key];
  return [];
}

function libraryEntry(row, idField = 'id') {
  const id = text(row?.[idField] ?? row?.id ?? row?.name, 512);
  const name = text(row?.name ?? row?.title ?? row?.id, 300);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    ...(typeof row?.subtitle === 'string' ? { subtitle: text(row.subtitle, 500) } : {}),
    ...(typeof row?.enabled === 'boolean' ? { enabled: row.enabled } : {}),
    ...(typeof row?.detail === 'string' ? { detail: text(row.detail, 4000) } : {}),
  };
}

function librarySchedule(task) {
  const kind = text(task?.kind, 16);
  if (!['after', 'at', 'every', 'daily', 'weekly', 'cron'].includes(kind)) return undefined;
  const sessionId = text(task.sessionId, 256);
  if (!sessionId) return undefined;

  const rule = { kind };
  if (kind === 'after' && Number.isSafeInteger(task.afterSeconds) && task.afterSeconds > 0) {
    rule.afterSeconds = task.afterSeconds;
  } else if (kind === 'every' && Number.isSafeInteger(task.everySeconds) && task.everySeconds >= 60) {
    rule.everySeconds = task.everySeconds;
  } else if (['daily', 'weekly'].includes(kind)) {
    const time = text(task.time, 32);
    const timeZone = text(task.timeZone, 128);
    if (time) rule.time = time;
    if (timeZone) rule.timeZone = timeZone;
    if (kind === 'weekly' && Array.isArray(task.weekdays)) {
      const weekdays = [...new Set(task.weekdays.filter((day) =>
        Number.isSafeInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
      if (weekdays.length) rule.weekdays = weekdays;
    }
  } else if (kind === 'cron') {
    const expression = text(task.expression, 120);
    const timeZone = text(task.timeZone, 128);
    if (expression) rule.expression = expression;
    if (timeZone) rule.timeZone = timeZone;
  }

  const lastDelivery = isRecord(task.lastDelivery)
    ? {
      ...(text(task.lastDelivery.scheduledAt, 64)
        ? { scheduledAt: text(task.lastDelivery.scheduledAt, 64) } : {}),
      ...(text(task.lastDelivery.deliveredAt, 64)
        ? { deliveredAt: text(task.lastDelivery.deliveredAt, 64) } : {}),
      ...(text(task.lastDelivery.messageId, 256)
        ? { messageId: text(task.lastDelivery.messageId, 256) } : {}),
    }
    : undefined;

  return {
    sessionId,
    rule,
    ...(lastDelivery && Object.keys(lastDelivery).length ? { lastDelivery } : {}),
  };
}

// Canonical base64 only: the same bytes must come back out of a decode/encode round trip.
// The alphabet check is a flat character class; a nested-group regex overflows V8's stack on
// multi-megabyte strings.
function decodeBase64(value, maxBytes) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maxBytes / 3) * 4
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    fail('INVALID_ATTACHMENT');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length > maxBytes) fail('INVALID_ATTACHMENT');
  return bytes;
}

function displayName(value, fallback) {
  const name = typeof value === 'string' ? value.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 160) : '';
  return name || fallback;
}

// Receipts are opaque DSH authorities minted by `file.upload`; accept any printable token.
const RECEIPT_TOKEN = /^[\x21-\x7e]{1,512}$/;

function validateAttachments(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_IMAGES + MAX_FILES) fail('INVALID_ATTACHMENT');
  let totalBytes = 0;
  let images = 0;
  let files = 0;
  const attachments = [];
  for (const item of input) {
    if (!isRecord(item)) fail('INVALID_ATTACHMENT');
    if (item.receiptId !== undefined) {
      if (typeof item.receiptId !== 'string' || !RECEIPT_TOKEN.test(item.receiptId)) {
        fail('INVALID_ATTACHMENT');
      }
      files += 1;
      if (files > MAX_FILES) fail('INVALID_ATTACHMENT');
      attachments.push({ type: 'file', receiptId: item.receiptId });
      continue;
    }
    if (typeof item.dataBase64 !== 'string'
      || typeof item.mimeType !== 'string'
      || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.mimeType)) {
      fail('INVALID_ATTACHMENT');
    }
    images += 1;
    if (images > MAX_IMAGES) fail('INVALID_ATTACHMENT');
    const bytes = decodeBase64(item.dataBase64, MAX_IMAGE_BYTES);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) fail('LIMIT_EXCEEDED');
    attachments.push({
      type: 'image',
      mediaType: item.mimeType,
      data: item.dataBase64,
      ...(typeof item.name === 'string' && item.name.trim()
        ? { name: item.name.replace(/[\\/]/g, '_').slice(0, 160) } : {}),
    });
  }
  return attachments;
}

// Phone-initiated DSH commands are an explicit allowlist, never a pass-through of arbitrary lines.
const SESSION_COMMANDS = Object.freeze(['goal', 'plan', 'compact']);

function commandLine(command, argument) {
  if (typeof command !== 'string' || !SESSION_COMMANDS.includes(command)) fail('UNSUPPORTED');
  if (argument !== undefined && typeof argument !== 'string') fail('BAD_REQUEST');
  const rest = (argument ?? '').trim();
  if (rest.length > MAX_COMMAND_ARGUMENT_CHARS
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(rest)) fail('BAD_REQUEST');
  if (command === 'compact' && rest) fail('BAD_REQUEST');
  return rest ? `/${command} ${rest}` : `/${command}`;
}

function commandOutcome(result) {
  const outcome = isRecord(result) ? result.result : undefined;
  if (!isRecord(outcome) || !['success', 'error'].includes(outcome.kind) || typeof outcome.text !== 'string') {
    fail('UPSTREAM_UNAVAILABLE');
  }
  return { kind: outcome.kind, text: text(outcome.text, 4000) };
}

function modelId(provider, model) {
  return `${provider}:${model}`;
}

function mapEfforts(model) {
  const efforts = (Array.isArray(model?.reasoning?.efforts) ? model.reasoning.efforts : [])
    .filter((effort) => isRecord(effort) && typeof effort.id === 'string' && EFFORT_ID.test(effort.id))
    .map((effort) => ({ id: effort.id, name: text(effort.name, 64) || effort.id }));
  if (efforts.length === 0) return {};
  const fallback = model.reasoning.defaultEffort;
  return {
    efforts,
    ...(typeof fallback === 'string' && efforts.some((effort) => effort.id === fallback)
      ? { defaultEffort: fallback } : {}),
  };
}

function mapModelCatalog(result) {
  const models = [];
  for (const group of result?.groups ?? []) {
    for (const model of group.models ?? []) {
      if (typeof group.id !== 'string' || typeof model.id !== 'string') continue;
      models.push({
        id: modelId(group.id, model.id),
        name: text(model.name, 300) || model.id,
        sourceID: group.id,
        sourceName: text(group.name, 300) || group.id,
        ...mapEfforts(model),
      });
    }
  }
  return models;
}

/** Agent presets ("modes" in DSH): the roster minus any that cannot compose a session. */
function mapPresets(result) {
  return arrayValue(result, 'presets').filter((preset) => isRecord(preset)
    && typeof preset.id === 'string' && PRESET_ID.test(preset.id) && typeof preset.broken !== 'string')
    .map((preset) => ({
      id: preset.id,
      name: text(preset.name, 120) || preset.id,
      ...(typeof preset.description === 'string' && preset.description
        ? { description: text(preset.description, 400) } : {}),
      isDefault: preset.isDefault === true,
    }));
}

export function createNativeBridge({ rpc, pages, navigation, conversationReads, questionBridge, sessionActivity, sessionSearch, assistantConversation, assistant, board, duduPages }) {
  const remote = createRemote(rpc);
  cardOf = typeof assistant?.cardOf === 'function' ? (commandId) => assistant.cardOf(commandId) : () => null;
  groupOf = typeof assistant?.groupOf === 'function' ? (commandId) => assistant.groupOf(commandId) : () => null;
  hiddenOf = typeof assistant?.hidden === 'function' ? () => assistant.hidden() : () => null;
  assistantId = typeof assistant?.state === 'function' ? () => assistant.state()?.sessionId ?? null : () => null;
  const assistantBridge = createNativeAssistant({
    assistant, remote, fail, attachments: validateAttachments,
    fileBytes: (data) => decodeBase64(data, MAX_FILE_BYTES),
  });
  let sessionRowsCache;
  let sessionRowsCacheAt = 0;
  let sessionRowsFlight;
  let workspaceCache = [];
  let workspaceCacheAt = 0;
  let workspaceFlight;
  // Which workspace holds each session and where, plus the archive and pin sets (all from DSH).
  let workspaceLayout = { archived: new Set(), pinned: [], placed: new Map() };
  const presentationCache = new Map();
  const presentationFlights = new Map();
  let presentationListFlight;

  const presentationSignature = (row) => JSON.stringify([row.updatedAt, row.running, row.status]);
  const cachedPresentation = (row) => {
    const cached = presentationCache.get(row.sessionId ?? row.id);
    return cached?.signature === presentationSignature(row)
      && (!cached.failed || Date.now() - cached.at < 30_000) ? cached : undefined;
  };

  function hasPresentation(row) {
    const values = row.projections?.values ?? {};
    const indexed = sessionActivity?.(row.sessionId ?? row.id);
    const title = typeof values.title === 'string' ? values.title : values.title?.title;
    return Boolean((title || row.title || indexed?.title)
      && ((values.modelSelection?.next ?? values.modelSelection?.lastUsed)?.provider
        || row.providerId || row.agent || indexed?.agent || indexed?.provider));
  }

  function presentedRow(row) {
    return {
      ...row,
      ...(assistantBridge.isSession(row.sessionId ?? row.id) ? { isAssistant: true } : {}),
      projections: { values: { ...presentationCache.get(row.sessionId ?? row.id)?.values, ...row.projections?.values } },
      agentActivity: sessionActivity?.(row.sessionId ?? row.id),
    };
  }

  async function presentationRow(row) {
    const id = row.sessionId ?? row.id;
    if (!hasPresentation(row) && !cachedPresentation(row)) {
      let pending = presentationFlights.get(id);
      if (!pending) {
        const signature = presentationSignature(row);
        pending = (async () => {
          const abort = new AbortController();
          let timer;
          try {
            const projection = await Promise.race([
              remote.call('session/projections', { sessionId: id }, abort.signal).catch(() => undefined),
              new Promise((done) => {
                timer = setTimeout(() => { abort.abort(); done(undefined); }, 2_000);
                timer.unref?.();
              }),
            ]);
            presentationCache.set(id, {
              signature, at: Date.now(), failed: !projection,
              values: projection?.values ?? presentationCache.get(id)?.values ?? {},
            });
          } finally {
            clearTimeout(timer);
            presentationFlights.delete(id);
          }
        })();
        presentationFlights.set(id, pending);
      }
      await pending;
    }
    return presentedRow(row);
  }

  function requestSessionRows() {
    const pending = remote.call('session/list', {}).then((result) => {
      const rows = arrayValue(result, 'items').filter(isRecord);
      sessionRowsCache = rows;
      sessionRowsCacheAt = Date.now();
      return rows;
    });
    const tracked = pending.finally(() => {
      if (sessionRowsFlight === tracked) sessionRowsFlight = undefined;
    });
    sessionRowsFlight = tracked;
    return tracked;
  }

  async function loadSessionRows({ fresh = false } = {}) {
    if (!fresh && sessionRowsCache
      && Date.now() - sessionRowsCacheAt < SESSION_ROWS_CACHE_MS) return sessionRowsCache;
    if (!fresh && sessionRowsFlight) return sessionRowsFlight;
    return requestSessionRows();
  }

  async function loadWorkspaces() {
    if (workspaceCacheAt && Date.now() - workspaceCacheAt < WORKSPACE_CACHE_MS) {
      return workspaceCache;
    }
    if (workspaceFlight) return workspaceFlight;

    const pending = (async () => {
      const stream = streamHandle(await remote.open('workspace/follow', AbortSignal.timeout(30_000)));
      try {
        const first = await stream.next();
        const frame = first?.value;
        if (first?.done || frame?.type !== 'baseline') {
          throw new NativeBridgeError('UPSTREAM_UNAVAILABLE');
        }
        workspaceCache = (frame.value?.items ?? []).map(normalizeWorkspace).filter((item) => item.id);
        workspaceLayout = layoutFrom(frame.value);
        workspaceCacheAt = Date.now();
        return workspaceCache;
      } finally {
        await stream.close();
      }
    })();
    const tracked = pending.finally(() => {
      if (workspaceFlight === tracked) workspaceFlight = undefined;
    });
    workspaceFlight = tracked;
    return tracked;
  }

  /** A change made here must show on the next read, not after the cache expires. */
  function forgetWorkspaces() {
    workspaceCacheAt = 0;
    sessionRowsCacheAt = 0;
  }

  function withWorkspace(row, workspaces) {
    if (typeof row.workspaceId === 'string') return row;
    const cwd = row.cwd ?? row.projections?.values?.workingDirectory;
    if (typeof cwd !== 'string' || !cwd) return row;
    const target = resolve(cwd);
    const match = workspaces.filter((workspace) => {
      if (!workspace.path) return false;
      const base = resolve(workspace.path);
      const pathFromBase = relative(base, target);
      return pathFromBase === '' || (pathFromBase !== '..'
        && !pathFromBase.startsWith(`..${sep}`) && !isAbsolute(pathFromBase));
    }).sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0))[0];
    return match ? { ...row, workspaceId: match.id, workspaceName: match.name } : row;
  }

  function enrichSessionRow(row) {
    const id = row.sessionId ?? row.id;
    const layout = workspaceLayout;
    const placed = layout.placed.get(id);
    // Membership is DSH's own accounting; the working directory is only a fallback for rows without it.
    let next = placed
      ? { ...row, workspaceId: placed.workspaceId, workspaceName: placed.workspaceName }
      : row;
    if (!placed && typeof next.workspaceId !== 'string') {
      const cwd = row.cwd ?? row.projections?.values?.workingDirectory;
      if (typeof cwd === 'string' && cwd) next = withWorkspace(row, workspaceCache);
    }
    if (layout.archived.has(id)) next = { ...next, archived: true };
    const rank = layout.pinned.indexOf(id);
    if (rank >= 0) next = { ...next, pinned: true, pinRank: rank };
    return next;
  }

  async function findSessionRow(sessionId, { fresh = false, enrich = true } = {}) {
    const rows = await loadSessionRows({ fresh });
    const row = rows.find((item) => (item.sessionId ?? item.id) === sessionId);
    return row && enrich ? enrichSessionRow(row) : row;
  }

  const files = createNativeFiles({
    getSessionRow(sessionId) {
      return findSessionRow(sessionId, { enrich: false });
    },
  });
  const pageBridge = pages ?? createNativePages({ rpc, files });
  // The board and the Collector: the plugin's own issues and inbox, asked through the commands the desktop interface sends (`board` gives the two).
  const boardBridge = createNativeBoard({ issues: board?.issues, inbox: board?.inbox, projects: board?.projects, getNeedsYouColor: board?.getNeedsYouColor, fail });
  // 嘟嘟's own settings, drawn by the app: the pages the web view used to show, asked through the same list of actions (phone-pages.mjs).
  const settingsBridge = createNativeSettings({ call: (action, body) => (duduPages?.allowed(action) ? duduPages.call(action, body) : { status: 404, body: {} }) });

  async function sessionRows() {
    const rows = await loadSessionRows();
    const known = new Set(rows.map((row) => row.sessionId ?? row.id));
    for (const id of presentationCache.keys()) if (!known.has(id)) presentationCache.delete(id);
    // DSH's list carries available cached hints. Only genuinely missing titles/providers need a
    // cold read; a missing optional duduAgentActivity must not reopen every history on every poll.
    const missing = rows.filter((row) => !hasPresentation(row) && !cachedPresentation(row));
    if (!presentationListFlight && missing.length) {
      const pending = mapLimit(missing, 4, presentationRow).finally(() => {
        if (presentationListFlight === pending) presentationListFlight = undefined;
      });
      presentationListFlight = pending;
    }
    if (presentationListFlight) {
      let timer;
      try {
        await Promise.race([
          presentationListFlight,
          new Promise((done) => { timer = setTimeout(done, 100); }),
        ]);
      } finally { clearTimeout(timer); }
    }
    return rows.map((row) => enrichSessionRow(presentedRow(row)));
  }

  async function sessionSummary(sessionId) {
    const row = await findSessionRow(sessionId);
    if (!row) fail('NOT_FOUND');
    return summaryFrom(await presentationRow(row));
  }

  function invalidateListForState(sessionId, state) {
    const row = sessionRowsCache?.find((item) => (item.sessionId ?? item.id) === sessionId);
    if (!row) return;
    const values = row.projections?.values ?? {};
    const changed = ['title', 'modelSelection', 'sessionListMetadata', 'duduAgentActivity'].some((key) =>
      Object.hasOwn(state.values, key) && JSON.stringify(values[key]) !== JSON.stringify(state.values[key]));
    if (changed || state.summary.status !== (row.running || row.status === 'running' ? 'running' : row.status ?? 'idle')) {
      sessionRowsCacheAt = 0;
    }
  }

  async function readSessionDetail(sessionId, options = {}) {
    const address = sessionAddress(sessionId);
    const summary = await sessionSummary(sessionId);
    const stream = streamHandle(await remote.open('session/follow', {
      address,
      assistantStream: true,
      maxMessages: MAX_MESSAGES,
      turnWindow: { minMessages: 50, minTurns: 2 },
    }, AbortSignal.timeout(30_000)));
    try {
      const first = await stream.next();
      if (first.done) throw new NativeBridgeError('UPSTREAM_UNAVAILABLE');
      const snapshot = firstSessionFrame(first.value);
      const state = emptySessionState(summary);
      installSnapshot(state, snapshot, sessionId);
      invalidateListForState(sessionId, state);
      return detailFrom(state, { ...options, changeCounts: conversationReads?.changeCounts });
    } finally {
      await stream.close();
    }
  }

  async function watchSession(params, connection, watchGeneration) {
    const options = { transcript: params.transcript === true, changeCounts: conversationReads?.changeCounts };
    const sessionId = params.id;
    const watchId = params.watchId;
    if (watchId !== undefined && (typeof watchId !== 'string' || !WATCH_ID.test(watchId))) {
      fail('BAD_REQUEST');
    }
    const address = sessionAddress(sessionId);
    if (connection.closed || watchGeneration !== connection.watchGeneration) fail('UPSTREAM_UNAVAILABLE');
    connection.nativeWatchID = watchId;
    const summary = await sessionSummary(sessionId);
    const abort = new AbortController();
    const stream = streamHandle(await remote.open('session/follow', {
      address,
      assistantStream: true,
      maxMessages: MAX_MESSAGES,
      turnWindow: { minMessages: 50, minTurns: 2 },
    }, abort.signal));
    const state = emptySessionState(summary);
    let publishTimer;
    let controlStream;
    let releaseQuestionWatch;
    let cancelled = false;
    let cancellation;
    const isActive = () => !cancelled && !connection.closed && watchGeneration === connection.watchGeneration;
    const cancel = () => {
      if (cancelled) return cancellation;
      cancelled = true;
      releaseQuestionWatch?.();
      if (connection.nativeAttachmentState?.state === state) connection.nativeAttachmentState = undefined;
      clearTimeout(publishTimer);
      abort.abort();
      cancellation = Promise.all([stream.close(), controlStream?.close()]);
      return cancellation;
    };
    try {
      if (!connection.setWatch(cancel, watchGeneration)) fail('UPSTREAM_UNAVAILABLE');
      const first = await stream.next();
      if (first.done || !isActive()) fail('UPSTREAM_UNAVAILABLE');
      installSnapshot(state, firstSessionFrame(first.value), sessionId);
      invalidateListForState(sessionId, state);
      connection.selectedSessionId = sessionId;
      connection.nativeAttachmentState = { sessionId, state, watchGeneration };
      releaseQuestionWatch = questionBridge?.watch(sessionId, (error) => {
        queueMicrotask(() => { void failWatch(error, 'questions'); });
      });
    } catch (error) {
      await cancel();
      throw error instanceof NativeBridgeError ? error : safeCallError();
    }
    async function failWatch(error, source) {
      if (isActive()) {
        connection.sendEvent('session.watch.failed', {
          id: sessionId, ...(watchId ? { watchId } : {}),
          code: error instanceof NativeBridgeError ? error.code : 'UPSTREAM_UNAVAILABLE', source,
        });
      }
      await cancel();
    }
    const schedulePublish = () => {
      if (publishTimer || !isActive()) return;
      publishTimer = setTimeout(() => {
        publishTimer = undefined;
        if (isActive()) {
          try {
            invalidateListForState(sessionId, state);
            const detail = detailFrom(state, options);
            connection.sendEvent('session.snapshot', watchId ? { ...detail, watchId } : detail);
          } catch (error) {
            void failWatch(error, 'snapshot');
          }
        }
      }, 100);
      publishTimer.unref?.();
    };
    void (async () => {
      try {
        const control = streamHandle(await remote.open('session/control', abort.signal));
        controlStream = control;
        if (!isActive()) {
          await control.close();
          return;
        }
        while (isActive()) {
          const next = await control.next();
          if (!isActive()) return;
          if (next.done) fail('UPSTREAM_UNAVAILABLE');
          if (applyControlFrame(state, next.value, sessionId)) schedulePublish();
        }
      } catch (error) {
        await failWatch(error, 'control');
      }
    })();
    void (async () => {
      try {
        while (isActive()) {
          const next = await stream.next();
          if (!isActive()) return;
          if (next.done) fail('UPSTREAM_UNAVAILABLE');
          applyFollowFrame(state, next.value, sessionId);
          schedulePublish();
        }
      } catch (error) {
        await failWatch(error, 'follow');
      }
    })();
    return detailFrom(state, options);
  }

  async function readSessionImage(sessionId, attachmentId) {
    const stream = streamHandle(await remote.open('session/follow', {
      address: sessionAddress(sessionId), maxMessages: MAX_MESSAGES,
      turnWindow: { minMessages: 50, minTurns: 2 },
    }, AbortSignal.timeout(30_000)));
    try {
      const first = await stream.next();
      if (first.done) fail('NOT_FOUND');
      const snapshot = firstSessionFrame(first.value);
      for (const record of snapshot.records ?? []) {
        const event = record?.event;
        if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') continue;
        const message = messageFromEvent(event, sessionId);
        if (!message || !Array.isArray(event.data.content)) continue;
        for (const [index, block] of event.data.content.entries()) {
          if (`${message.id}:${index}` === attachmentId) return imageFromBlock(block);
        }
      }
      return undefined;
    } finally {
      await stream.close();
    }
  }

  async function workspaceList() { return loadWorkspaces(); }

  async function permissionsFor(sessionId, id, decision) {
    if (typeof sessionId !== 'string' || typeof id !== 'string'
      || !['allow', 'deny'].includes(decision)) fail('BAD_REQUEST');
    const projection = await remote.call('session/projections', { sessionId });
    const active = projection?.values?.userQuestions?.active ?? [];
    const pending = active.find((item) => item.callId === id && approvablePlanReview(item));
    const question = pending && approvablePlanReview(pending);
    if (!question) fail('STALE_APPROVAL');
    const selected = decision === 'allow' ? [question.intent.approve] : [];
    const answers = [{ id: question.id, selected }];
    if (questionBridge?.answer(sessionId, id, answers)) return true;
    const accepted = await remote.call('userQuestions/answer', sessionId, id, { answers });
    if (accepted !== true) fail('STALE_APPROVAL');
    return true;
  }

  function watchedSession(connection, sessionId) {
    const watched = connection.nativeAttachmentState;
    if (!watched || connection.closed || watched.sessionId !== sessionId
      || connection.selectedSessionId !== sessionId || watched.watchGeneration !== connection.watchGeneration) fail('NOT_FOUND');
    return watched;
  }

  function stillWatched(connection, watched) {
    if (watchedSession(connection, watched.sessionId) !== watched) fail('NOT_FOUND');
  }

  async function eventAt(watched, seq) {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > watched.state.conversation.cursor) fail('BAD_REQUEST');
    const page = await remote.call('session/page', {
      address: sessionAddress(watched.sessionId), throughSeq: seq, beforeSeq: seq + 1, maxMessages: 1,
    });
    const event = page?.records?.find((record) => record.type === 'event' && record.event?.seq === seq)?.event;
    if (!event) fail('NOT_FOUND');
    return event;
  }

  async function readConversation(kind, params) {
    if (!conversationReads) fail('UNSUPPORTED');
    try { return await conversationReads.read(kind, params); }
    catch (error) {
      if (['BAD_REQUEST', 'NOT_FOUND', 'LIMIT_EXCEEDED', 'UNSUPPORTED'].includes(error?.code)) fail(error.code);
      throw safeCallError();
    }
  }

  async function selectionFor(params, sessionId) {
    if (params.modelId !== undefined && typeof params.modelId !== 'string') fail('BAD_REQUEST');
    if (params.reasoningEffort !== undefined
      && (typeof params.reasoningEffort !== 'string' || !EFFORT_ID.test(params.reasoningEffort))) fail('BAD_REQUEST');
    const catalog = await remote.call('session/modelCatalog');
    let wanted = params.modelId;
    let current;
    if (wanted === undefined || assistantBridge.isSession(sessionId)) {
      const projection = await remote.call('session/projections', { sessionId });
      const saved = projection?.values?.modelSelection;
      current = saved?.next ?? saved?.lastUsed;
      if (wanted === undefined && typeof current?.provider === 'string' && typeof current?.model === 'string') {
        wanted = modelId(current.provider, current.model);
      }
    }
    for (const group of catalog?.groups ?? []) {
      const model = (group.models ?? []).find((entry) => modelId(group.id, entry.id) === wanted);
      if (!model) continue;
      const levels = mapEfforts(model);
      let effort = levels.defaultEffort;
      if (assistantBridge.isSession(sessionId) && current?.provider === group.id && current?.model === model.id
        && (levels.efforts ?? []).some((level) => level.id === current.reasoningEffort)) effort = current.reasoningEffort;
      if (params.reasoningEffort !== undefined) {
        if (!(levels.efforts ?? []).some((level) => level.id === params.reasoningEffort)) fail('BAD_REQUEST');
        effort = params.reasoningEffort;
      }
      return { provider: group.id, model: model.id, ...(effort ? { reasoningEffort: effort } : {}) };
    }
    fail('BAD_REQUEST');
  }

  return {
    async closeConnection(connection) {
      await pageBridge.closeConnection(connection);
    },
    async dispatch(method, params, connection, { watchGeneration } = {}) {
      if (!NATIVE_METHODS.includes(method)) fail('UNSUPPORTED');
      if (!isRecord(params)) fail('BAD_REQUEST');
      if (NATIVE_PAGE_METHODS.includes(method)) {
        return pageBridge.dispatch(method, params, connection);
      }
      if (NATIVE_BOARD_METHODS.includes(method)) return boardBridge.dispatch(method, params);
      if (NATIVE_SETTINGS_METHODS.includes(method)) return settingsBridge.dispatch(method, params ?? {});
      if (NATIVE_ASSISTANT_METHODS.includes(method)) return assistantBridge.dispatch(method, params ?? {});
      if (NATIVE_TASK_METHODS.includes(method)) {
        if (typeof assistant?.tasks !== 'function') fail('UPSTREAM_UNAVAILABLE');
        return assistant.tasks(method.slice('tasks.'.length), params);
      }
      switch (method) {
        case 'quota.get': {
          if (typeof assistant?.quota !== 'function') fail('UPSTREAM_UNAVAILABLE');
          if (Object.keys(params).some((key) => key !== 'ask') || (params.ask !== undefined && typeof params.ask !== 'boolean')) fail('BAD_REQUEST');
          const view = await assistant.quota({ ask: params.ask === true });
          if (!view || !Array.isArray(view.providers)) fail('UPSTREAM_UNAVAILABLE');
          return { outcome: 'success', ...view };
        }
        case 'assistant.open': {
          if (typeof assistantConversation !== 'function') fail('UNSUPPORTED');
          // The plugin owns the assistant identity and setup. Never create a generic conversation
          // here or accept a caller-supplied session id in place of its scoped, persistent session.
          const conversation = await assistantConversation();
          const id = text(conversation?.sessionId, 256);
          if (!id) fail('UPSTREAM_UNAVAILABLE');
          const found = await findSessionRow(id, { fresh: true });
          if (!found) fail('NOT_FOUND');
          // Resolve only: the phone may have left the drawer while this was pending. Its
          // ordinary session/watch flow selects the session if it still intends to open it.
          return { ...summaryFrom(await presentationRow(found)), isAssistant: true };
        }
        case 'workspace.list':
          return workspaceList();
        case 'session.list':
          await Promise.all([loadWorkspaces(), loadSessionRows()]);
          return (await sessionRows()).map(summaryFrom).filter((item) => item.id);
        case 'session.search': {
          if (typeof params.query !== 'string') fail('BAD_REQUEST');
          const query = params.query.trim();
          if (!query || query.length > 500) fail('BAD_REQUEST');
          const result = sessionSearch
            ? await sessionSearch(query)
            : await remote.call('session/search', { query });
          const summaries = new Map((await sessionRows()).map(summaryFrom)
            .filter((item) => item.id && !item.blank).map((item) => [item.id, item]));
          const items = [];
          const seen = new Set();
          const hits = arrayValue(result, 'items');
          for (const hit of hits.slice(0, 20)) {
            const session = summaries.get(hit?.sessionId);
            if (!session || seen.has(session.id) || typeof hit.snippet !== 'string') continue;
            seen.add(session.id);
            items.push({ session, snippet: [...hit.snippet].slice(0, 240).join('') });
          }
          return {
            items, hasMore: result?.hasMore === true || hits.length > 20,
            ...(typeof result?.indexing === 'boolean' ? { indexing: result.indexing } : {}),
          };
        }
        case 'workspace.rename': {
          const id = text(params.id, 256);
          const title = text(params.title, 300).trim();
          if (!id || !title) fail('BAD_REQUEST');
          await remote.call('workspace/rename', { workspaceId: id, title });
          forgetWorkspaces();
          return {};
        }
        case 'workspace.delete': {
          // DSH forgets the registration only: the directory and its sessions stay.
          const id = text(params.id, 256);
          if (!id) fail('BAD_REQUEST');
          await remote.call('workspace/delete', { workspaceId: id });
          forgetWorkspaces();
          return {};
        }
        case 'session.pin': {
          const id = text(params.id, 256);
          if (!id || typeof params.pinned !== 'boolean') fail('BAD_REQUEST');
          await remote.call(params.pinned ? 'workspace/pinSession' : 'workspace/unpinSession', { sessionId: id });
          forgetWorkspaces();
          return {};
        }
        case 'session.archive': {
          // DSH never deletes a session; archiving hides it and is undone with session.unarchive. A session
          // with running work is refused by DSH, which asks on the desktop before stopping it.
          const id = text(params.id, 256);
          if (!id) fail('BAD_REQUEST');
          await remote.call('workspace/archiveSession', { sessionId: id });
          forgetWorkspaces();
          return {};
        }
        case 'session.unarchive': {
          const id = text(params.id, 256);
          if (!id) fail('BAD_REQUEST');
          await remote.call('workspace/unarchiveSession', { sessionId: id });
          forgetWorkspaces();
          return {};
        }
        case 'session.create': {
          if (params.workspaceId !== undefined && (typeof params.workspaceId !== 'string' || !params.workspaceId)) {
            fail('BAD_REQUEST');
          }
          if (params.agentPreset !== undefined
            && (typeof params.agentPreset !== 'string' || !PRESET_ID.test(params.agentPreset))) {
            fail('BAD_REQUEST');
          }
          // A blank session of the same workspace can be reused instead of leaving another empty row.
          if (params.reuse !== undefined && (typeof params.reuse !== 'string' || !params.reuse
            || params.reuse.length > 256)) {
            fail('BAD_REQUEST');
          }
          const selection = params.modelId !== undefined ? await selectionFor(params) : null;
          const result = await remote.call('session/create', {
            ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
            ...(params.agentPreset ? { agentPreset: params.agentPreset } : {}),
            ...(params.reuse ? { sessionId: params.reuse } : {}),
          });
          const id = text(result?.sessionId, 256);
          if (!id) throw new NativeBridgeError('UPSTREAM_UNAVAILABLE');
          if (selection) await remote.call('session/selectModel', { sessionId: id, ...selection });
          presentationCache.delete(id);
          connection.selectedSessionId = id;
          const found = await findSessionRow(id, { fresh: true });
          if (!found) fail('UPSTREAM_UNAVAILABLE');
          return summaryFrom(await presentationRow(found));
        }
        case 'session.open':
          connection.selectedSessionId = params.id;
          return readSessionDetail(params.id, { transcript: params.transcript === true });
        case 'session.page': {
          const watched = watchedSession(connection, params.id);
          const throughSeq = params.throughSeq ?? watched.state.conversation.cursor;
          if (!Number.isSafeInteger(throughSeq) || throughSeq < 0 || throughSeq > watched.state.conversation.cursor
            || !Number.isSafeInteger(params.beforeSeq) || params.beforeSeq < 1 || params.beforeSeq > throughSeq + 1) fail('BAD_REQUEST');
          const page = await remote.call('session/page', {
            address: sessionAddress(params.id), throughSeq, beforeSeq: params.beforeSeq, maxMessages: 50,
            turnWindow: { minMessages: 25, minTurns: 2 },
          });
          stillWatched(connection, watched);
          const state = emptySessionState(watched.state.summary);
          installSnapshot(state, { ...page, cursor: throughSeq }, params.id);
          return { transcript: transcriptFrom(state, conversationReads?.changeCounts) };
        }
        case 'session.tool': {
          const watched = watchedSession(connection, params.id);
          const [call, result] = await Promise.all([
            eventAt(watched, params.seq),
            params.resultSeq === undefined ? undefined : eventAt(watched, params.resultSeq),
          ]);
          stillWatched(connection, watched);
          return toolPayload(call, result, params);
        }
        case 'session.changes':
        case 'session.diff': {
          const watched = watchedSession(connection, params.id);
          const event = await eventAt(watched, params.seq);
          if (event.type !== 'workspace/changes') fail('NOT_FOUND');
          const coordinates = { sessionId: params.id, seq: params.seq };
          if (method === 'session.diff') {
            if (!Number.isSafeInteger(params.index) || params.index < 0) fail('BAD_REQUEST');
            coordinates.index = params.index;
          }
          const result = await readConversation(method === 'session.diff' ? 'diff' : 'summary', coordinates);
          stillWatched(connection, watched);
          return result;
        }
        case 'session.file': {
          const watched = watchedSession(connection, params.id);
          const [event, call, row] = await Promise.all([
            eventAt(watched, params.seq),
            params.kind === 'produced' ? eventAt(watched, params.callSeq) : undefined,
            findSessionRow(params.id),
          ]);
          const path = deliveredPath(event, call, params, row?.cwd ?? watched.state.values.workingDirectory);
          stillWatched(connection, watched);
          const result = await readConversation('file', { path });
          stillWatched(connection, watched);
          return { ...result, name: path.split(/[\\/]/u).at(-1) };
        }
        case 'session.fork': {
          const watched = watchedSession(connection, params.id);
          const event = await eventAt(watched, params.seq);
          if (event.surfaceOp !== 'append' || !['assistant/message', 'user/message'].includes(event.type)
            || event.type === 'user/message' && event.data?.source?.kind !== 'user') fail('BAD_REQUEST');
          stillWatched(connection, watched);
          const result = await remote.call('session/fork', { sessionId: params.id, atSeq: params.seq });
          forgetWorkspaces();
          return result;
        }
        case 'session.performance': {
          const watched = watchedSession(connection, params.id);
          if (params.turn !== undefined) {
            if (!Number.isSafeInteger(params.turn) || params.turn < 0) fail('BAD_REQUEST');
            const anchor = await eventAt(watched, params.seq);
            if (anchor.data?.turn !== params.turn) fail('NOT_FOUND');
            const events = [];
            let beforeSeq = params.seq + 1;
            for (let count = 0; count < 200; count += 1) {
              stillWatched(connection, watched);
              const page = await remote.call('session/page', {
                address: sessionAddress(params.id), throughSeq: params.seq, beforeSeq, maxMessages: 50,
              });
              stillWatched(connection, watched);
              const records = (page?.records ?? []).filter((item) => item.type === 'event'
                && Number.isSafeInteger(item.event?.seq) && item.event.seq < beforeSeq && item.event.seq <= params.seq);
              if (!records.length) fail('NOT_FOUND');
              const local = records.map((item) => item.event).filter((event) => event.data?.turn === params.turn);
              events.push(...local.map(performanceEvent));
              if (events.length > 50_000) fail('LIMIT_EXCEEDED');
              if (local.some((event) => event.type === 'turn/start')) {
                return turnPerformance(events.sort((left, right) => left.seq - right.seq), params.turn);
              }
              beforeSeq = Math.min(...records.map((item) => item.event.seq));
              if (!page.hasMore || beforeSeq <= 0) fail('NOT_FOUND');
            }
            fail('LIMIT_EXCEEDED');
          }
          const projection = await remote.call('session/projections', { sessionId: params.id });
          stillWatched(connection, watched);
          return sessionPerformance(projection?.values ?? {});
        }
        case 'question.answer': {
          const watched = watchedSession(connection, params.id);
          const projection = await remote.call('session/projections', { sessionId: params.id });
          const active = projection?.values?.userQuestions?.active ?? [];
          const pending = active.find((call) => call.callId === params.callId);
          const answer = validateAnswers(pending, params.answers);
          stillWatched(connection, watched);
          if (questionBridge?.answer(params.id, params.callId, answer.answers)) return true;
          const accepted = await remote.call('userQuestions/answer', params.id, params.callId, answer);
          if (accepted !== true) fail('STALE_APPROVAL');
          return true;
        }
        case 'session.watch':
          return watchSession(params, connection, watchGeneration);
        case 'session.unwatch':
          if (typeof params.watchId !== 'string' || !WATCH_ID.test(params.watchId)) fail('BAD_REQUEST');
          if (params.watchId !== connection.nativeWatchID) return {};
          connection.nativeWatchID = undefined;
          await connection.stopWatch();
          return {};
        case 'files.list':
          return files.list(params);
        case 'files.read':
          return files.read(params);
        case 'session.send': {
          const sessionId = text(params.id ?? connection.selectedSessionId, 256);
          if (!sessionId) fail('BAD_REQUEST');
          if (params.requestId !== undefined
            && (typeof params.requestId !== 'string' || !WATCH_ID.test(params.requestId))) fail('BAD_REQUEST');
          const attachments = validateAttachments(params.attachments);
          const message = typeof params.text === 'string' ? params.text : '';
          if (!message.trim() && attachments.length === 0) fail('BAD_REQUEST');
          const content = [];
          if (message) content.push({ type: 'text', text: message.slice(0, 100_000) });
          content.push(...attachments);
          const request = {
            requestId: params.requestId ?? randomUUID(),
            sessionId,
            mode: 'queue',
            content,
          };
          if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_MESSAGE_BYTES) fail('LIMIT_EXCEEDED');
          // Ordinary native messages share the scoped assistant too. Clear a stale desktop page
          // unless the phone explicitly chose to attach its own page to this message.
          if (assistantBridge.isSession(sessionId)) await assistantBridge.context(sessionId, params.assistantContext);
          await remote.call('session/prompt', request);
          return { requestId: request.requestId };
        }
        case 'session.stop': {
          const sessionId = text(params.id ?? connection.selectedSessionId, 256);
          if (!sessionId) fail('BAD_REQUEST');
          await remote.call('session/cancel', { sessionId });
          return {};
        }
        case 'session.queue.update': {
          const sessionId = text(params.id, 256);
          const itemId = text(params.itemId, 256);
          if (!sessionId || !itemId || !['edit', 'remove', 'steer'].includes(params.action)) fail('BAD_REQUEST');
          const action = { kind: params.action };
          if (action.kind === 'edit') {
            if (typeof params.text !== 'string' || !params.text.trim() || params.text.length > MAX_ENTRY_TEXT) {
              fail('BAD_REQUEST');
            }
            action.content = [{ type: 'text', text: params.text }];
          }
          await remote.call('session/updateQueue', { sessionId, itemId, action });
          return {};
        }
        case 'session.rename': {
          const sessionId = text(params.id, 256);
          const title = text(params.title, 300).trim();
          if (!sessionId || !title) fail('BAD_REQUEST');
          await remote.call('session/rename', { sessionId, title });
          return {};
        }
        case 'session.configure': {
          const sessionId = text(params.id, 256);
          if (!sessionId) fail('BAD_REQUEST');
          if (params.modelId !== undefined || params.reasoningEffort !== undefined) {
            const selection = await selectionFor(params, sessionId);
            if (assistantBridge.isSession(sessionId)) {
              if (typeof assistant.selectModel !== 'function') fail('UNSUPPORTED');
              await assistant.selectModel(selection);
            } else await remote.call('session/selectModel', { sessionId, ...selection });
            presentationCache.delete(sessionId);
          }
          if (params.agentPreset !== undefined) {
            if (typeof params.agentPreset !== 'string' || !PRESET_ID.test(params.agentPreset)) fail('BAD_REQUEST');
            const roster = mapPresets(await remote.call('agentPresets/list'));
            if (!roster.some((preset) => preset.id === params.agentPreset)) fail('BAD_REQUEST');
            await remote.call('agentPresets/select', sessionId, params.agentPreset);
          }
          if (params.permissionId !== undefined) {
            if (typeof params.permissionId !== 'string') fail('BAD_REQUEST');
            const catalog = await remote.call('permissionPresets/catalog');
            const preset = (catalog?.options ?? []).find((item) => item.value === params.permissionId);
            if (!preset || typeof preset.value !== 'string' || /[\r\n]/.test(preset.value)) {
              fail('BAD_REQUEST');
            }
            const outcome = commandOutcome(await remote.call('commands/execute', {
              agentId: sessionId,
              line: `/permission ${preset.value}`,
              submittedAttachments: [],
            }));
            if (outcome.kind === 'error') fail('UPSTREAM_ERROR');
          }
          return {};
        }
        case 'session.attachment': {
          const sessionId = text(params.id, 256);
          if (params.source !== undefined) {
            const watched = watchedSession(connection, sessionId);
            const [event, row] = await Promise.all([eventAt(watched, params.seq), findSessionRow(sessionId)]);
            const path = markdownImagePath(event, params.source, row?.cwd ?? watched.state.values.workingDirectory, (commandId) => groupOf(commandId));
            stillWatched(connection, watched);
            const file = await readConversation('file', { path });
            stillWatched(connection, watched);
            const mediaType = file.mediaType?.split(';')[0].trim().toLowerCase();
            if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) fail('INVALID_ATTACHMENT');
            decodeBase64(file.dataBase64, MAX_IMAGE_BYTES);
            return { mediaType, data: file.dataBase64 };
          }
          const attachmentId = text(params.attachmentId, 512);
          const watched = connection.nativeAttachmentState;
          if (!sessionId || !attachmentId || connection.closed || !watched || watched.sessionId !== sessionId
            || connection.selectedSessionId !== sessionId
            || watched.watchGeneration !== connection.watchGeneration) fail('NOT_FOUND');
          let image = watched.state.images.get(attachmentId);
          if (!image && attachmentId.startsWith('queue:')) {
            const inbox = watched.state.values.inbox;
            for (const message of [...(inbox?.['next-turn'] ?? []), ...(inbox?.['next-step'] ?? [])]) {
              for (const [index, block] of (message.content ?? []).entries()) {
                if (`queue:${message.id}:${index}` === attachmentId) image = imageFromBlock(block);
              }
            }
          } else if (!image && params.seq !== undefined) {
            const event = await eventAt(watched, params.seq);
            const content = event.type === 'user/message' && event.data?.source?.kind === 'user'
              ? event.data.content : event.type === 'tool/result' ? event.data?.message?.content : [];
            const id = event.type === 'user/message' ? messageFromEvent(event, sessionId)?.id
              : `tool:${event.data?.message?.toolCallId ?? event.data?.message?.source?.callId}`;
            for (const [index, block] of (content ?? []).entries()) {
              if (`${id}:${index}` === attachmentId) image = imageFromBlock(block);
            }
          } else if (!image) image = await readSessionImage(sessionId, attachmentId);
          stillWatched(connection, watched);
          if (!image) fail('NOT_FOUND');
          if (image.attachment) {
            const stored = await remote.call('session/attachment', {
              sessionId, attachment: image.attachment,
            }, AbortSignal.timeout(30_000));
            stillWatched(connection, watched);
            if (stored?.attachment?.attachmentId !== image.attachment.attachmentId
              || stored.attachment.mediaType !== image.mediaType) fail('INVALID_ATTACHMENT');
            image = { mediaType: stored.attachment.mediaType, data: stored.data };
          }
          decodeBase64(image.data, MAX_IMAGE_BYTES);
          return image;
        }
        case 'session.command': {
          const sessionId = text(params.id ?? connection.selectedSessionId, 256);
          if (!sessionId) fail('BAD_REQUEST');
          const line = commandLine(params.command, params.argument);
          return commandOutcome(await remote.call('commands/execute', {
            agentId: sessionId,
            line,
            submittedAttachments: [],
          }));
        }
        case 'file.upload': {
          const sessionId = text(params.id ?? connection.selectedSessionId, 256);
          if (!sessionId) fail('BAD_REQUEST');
          const bytes = decodeBase64(params.data, MAX_FILE_BYTES);
          if (bytes.length === 0) fail('INVALID_ATTACHMENT');
          const name = displayName(params.name, 'file');
          const result = await remote.call('fileUploads/upload', sessionId, {
            data: params.data,
            name,
          });
          const receiptId = typeof result?.receiptId === 'string' ? result.receiptId : '';
          if (!RECEIPT_TOKEN.test(receiptId)) throw new NativeBridgeError('UPSTREAM_UNAVAILABLE');
          const stored = isRecord(result.file) ? result.file : {};
          return {
            receiptId,
            name: displayName(stored.name, name),
            bytes: Number.isSafeInteger(stored.bytes) && stored.bytes >= 0 ? stored.bytes : bytes.length,
          };
        }
        case 'navigation.get':
          return navigation?.get() ?? {
            schemaVersion: 1, available: false, updatedAt: 0, sidebar: [], views: [], settings: [],
          };
        case 'catalog.get': {
          const [modelsResult, permissionsResult, presetsResult] = await Promise.all([
            remote.call('session/modelCatalog'),
            remote.call('permissionPresets/catalog'),
            remote.call('agentPresets/list'),
          ]);
          return {
            models: mapModelCatalog(modelsResult),
            providers: sessionProviders(modelsResult).map((provider, index) => {
              const selection = providerDefault(provider, modelsResult);
              return {
                id: provider.id, name: provider.name,
                isDefault: modelsResult?.default?.provider
                  ? providerFamily(modelsResult.default.provider) === provider.id : index === 0,
                modelIds: provider.groups.flatMap((group) => group.models.map((model) => modelId(group.id, model.id))),
                defaultModelId: modelId(selection.provider, selection.model),
              };
            }),
            permissions: (permissionsResult?.options ?? []).map((item) => ({
              id: text(item.value, 300), name: text(item.name, 300),
            })).filter((item) => item.id && item.name),
            presets: mapPresets(presetsResult),
          };
        }
        case 'plugins.list': {
          const result = await remote.call('pluginManager/listPlugins');
          return arrayValue(result, 'plugins').map((item) => {
            const meta = isRecord(item.meta) ? item.meta : {};
            const id = text(item.entryId, 512);
            const moduleName = text(item.moduleName, 300);
            if (!id || !moduleName) return undefined;
            const name = text(meta.name ?? meta.title, 300) || moduleName;
            const detail = text(meta.description ?? item.readOnlyReason ?? item.fiberPhase, 4000);
            return {
              id,
              name,
              subtitle: moduleName,
              enabled: item.enabled === true,
              ...(detail ? { detail } : {}),
            };
          }).filter(Boolean);
        }
        case 'schedule.list': {
          // The current App can show our timers in its existing native schedule list. It needs no DSH schedule plugin for them.
          const own = typeof assistant?.tasks === 'function' ? await assistant.tasks('list', {}) : null;
          const ownRows = own?.outcome === 'success' ? own.tasks.map((task) => ({
            id: `dudu:${task.id}`, name: task.title, enabled: task.status === 'active', detail: text(`${task.agent === 'dudu' ? '嘟嘟' : AGENTS[task.agent] ?? task.agent} · ${task.schedule.timezone}\n${task.prompt}`, 4000),
            subtitle: task.status === 'active' && task.nextRunAt ? new Date(task.nextRunAt).toISOString() : task.status,
            ...((task.sessionId || task.target.sessionId) ? { schedule: { sessionId: task.sessionId || task.target.sessionId, rule: {
              kind: ({ interval: 'every', once: 'at', workdays: 'weekly', monthly: 'cron' })[task.schedule.kind] ?? task.schedule.kind,
              time: task.schedule.time, timeZone: task.schedule.timezone,
              expression: task.schedule.kind === 'monthly' ? `${Number(task.schedule.time.split(':')[1])} ${Number(task.schedule.time.split(':')[0])} ${task.schedule.day} * *` : task.schedule.expression,
              ...(task.schedule.kind === 'interval' ? { everySeconds: task.schedule.minutes * 60 } : {}),
              ...(task.schedule.kind === 'workdays' ? { weekdays: [1, 2, 3, 4, 5] } : task.schedule.kind === 'weekly' ? { weekdays: task.schedule.weekdays.map((day) => day || 7) } : {}),
            } } } : {}),
          })) : [];
          let result;
          try { result = await remote.call('schedule/catalog'); }
          catch (error) { if (own?.outcome === 'success') return ownRows; throw error; }
          return [...ownRows, ...arrayValue(result, 'tasks').map((task) => {
            const schedule = librarySchedule(task);
            return {
              id: text(task.id, 256),
              name: text(task.title, 300),
              ...(typeof task.scheduledAt === 'string' ? { subtitle: text(task.scheduledAt, 100) } : {}),
              enabled: task.status === 'active',
              detail: text(task.prompt, 4000),
              ...(schedule ? { schedule } : {}),
            };
          }).filter((item) => item.id && item.name)];
        }
        case 'approval.respond':
          return permissionsFor(params.sessionId, params.id, params.decision);
        default:
          fail('UNSUPPORTED');
      }
    },
  };
}
