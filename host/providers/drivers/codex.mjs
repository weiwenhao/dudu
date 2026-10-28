import { spawn } from 'node:child_process';
import { AsyncQueue, deferred } from '../async.mjs';
import { assertDirectory, harnessError } from '../harness-bridge.mjs';
import { CODEX_TOOLS, fallbackSpec } from './codex-tools.mjs';

// Codex is driven through `codex app-server`: newline-delimited JSON-RPC over stdio, the protocol its own
// editor integrations use. The `codex` installed on this computer, with this user's login, provider and config,
// does the work; its threads are real Codex threads that `codex resume` lists.

const MIN_VERSION = '0.136.0';
const text = (value) => (typeof value === 'string' ? value : '');

const TOOL_ITEMS = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch']);

function contentText(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item === 'string') return item;
    if (item?.type === 'text' || item?.type === 'inputText' || item?.type === 'outputText') return text(item.text);
    return item?.type ? `[${item.type}]` : '';
  }).filter(Boolean).join('\n');
}

/** The tool call a Codex item is, as the harness-independent event the bridge replays. */
export function toolCallOf(item) {
  switch (item.type) {
    case 'commandExecution': return { name: 'shell', input: { command: text(item.command), cwd: text(item.cwd) } };
    case 'fileChange': return { name: 'apply_patch', input: { changes: Array.isArray(item.changes) ? item.changes : [] } };
    case 'mcpToolCall': return { name: `mcp__${text(item.server)}__${text(item.tool)}`, input: item.arguments ?? {} };
    case 'dynamicToolCall': return { name: text(item.tool) || 'tool', input: item.arguments ?? {} };
    case 'webSearch': return { name: 'web_search', input: { query: text(item.query) || text(item.action?.query) } };
    default: return undefined;
  }
}

/** The result of a finished Codex tool item. */
export function toolResultOf(item) {
  const failed = ['failed', 'declined'].includes(item.status);
  switch (item.type) {
    case 'commandExecution':
      return { output: text(item.aggregatedOutput), isError: failed, data: { exitCode: item.exitCode ?? undefined, durationMs: item.durationMs ?? undefined } };
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return { output: failed ? `The patch was not applied (${item.status}).` : `Applied ${changes.length} file change${changes.length === 1 ? '' : 's'}: ${changes.map((change) => text(change.path)).join(', ')}`, isError: failed, data: { changes } };
    }
    case 'mcpToolCall': {
      const error = item.error ? text(item.error.message) || JSON.stringify(item.error) : '';
      return { output: error || contentText(item.result?.content) || (item.result?.structuredContent ? JSON.stringify(item.result.structuredContent) : ''), isError: Boolean(error) || failed };
    }
    case 'dynamicToolCall': return { output: contentText(item.contentItems), isError: item.success === false || failed };
    default: return { output: '', isError: false };
  }
}

function usageOf(usage) {
  if (!usage) return undefined;
  const cached = usage.cachedInputTokens ?? 0;
  return {
    inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
    ...(cached ? { cacheReadTokens: cached } : {}),
    ...(usage.reasoningOutputTokens ? { reasoningTokens: usage.reasoningOutputTokens } : {}),
  };
}

/**
 * The app-server's notifications and requests, as the events the bridge replays. Codex reports items, not
 * messages: text and reasoning stream inside the current step, and each tool call closes its step, so a tool's
 * result is waited for by DSH's own loop before the next step starts.
 */
export class CodexNormalizer {
  #step = false;
  #streamed = new Set();
  #usage;
  #lastError;

  /** Returns events for the bridge; `reply` entries are answers the process owner sends straight back. */
  feed(message) {
    const events = [];
    if (message.id !== undefined && message.method) { this.#request(message, events); return events; }
    const params = message.params ?? {};
    switch (message.method) {
      case 'item/agentMessage/delta': this.#delta('text-delta', params, events); break;
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': this.#delta('reasoning-delta', params, events); break;
      case 'item/started': this.#started(params.item, events); break;
      case 'item/completed': this.#completed(params.item, events); break;
      case 'thread/tokenUsage/updated': this.#usage = usageOf(params.tokenUsage?.last ?? params.tokenUsage?.total); break;
      case 'error': if (params.willRetry !== true) this.#lastError = text(params.error?.message); break;
      case 'turn/completed': this.#turnCompleted(params.turn ?? {}, events); break;
      default: break;
    }
    return events;
  }

  #ensureStep(events) {
    if (this.#step) return;
    this.#step = true;
    events.push({ type: 'step-start' });
  }

  #endStep(events, reason) {
    if (!this.#step) return;
    this.#step = false;
    events.push({ type: 'step-end', reason, usage: this.#usage });
  }

  #delta(type, params, events) {
    if (!params.delta) return;
    this.#ensureStep(events);
    this.#streamed.add(params.itemId);
    events.push({ type, text: text(params.delta) });
  }

  #started(item, events) {
    if (!item) return;
    if (item.type === 'agentMessage' || item.type === 'reasoning') { this.#ensureStep(events); return; }
    if (!TOOL_ITEMS.has(item.type)) return;
    this.#ensureStep(events);
    const call = toolCallOf(item);
    events.push({ type: 'tool-call', id: item.id, name: call.name, input: call.input });
    this.#endStep(events, 'tool-calls');
  }

  #completed(item, events) {
    if (!item) return;
    if (item.type === 'agentMessage' && !this.#streamed.has(item.id) && item.text) {
      this.#ensureStep(events);
      events.push({ type: 'text-delta', text: item.text });
    } else if (item.type === 'reasoning' && !this.#streamed.has(item.id)) {
      const summary = (item.summary?.length ? item.summary : item.content) ?? [];
      if (summary.length) { this.#ensureStep(events); events.push({ type: 'reasoning-delta', text: summary.join('\n\n') }); }
    } else if (TOOL_ITEMS.has(item.type)) {
      events.push({ type: 'tool-result', id: item.id, ...toolResultOf(item) });
    }
  }

  #turnCompleted(turn, events) {
    this.#endStep(events, 'stop');
    const usage = this.#usage;
    if (turn.status === 'completed') { events.push({ type: 'turn-end', ok: true, usage }); return; }
    let error;
    if (turn.status === 'interrupted') error = harnessError('The turn was interrupted.', 'ABORTED');
    else {
      const info = turn.error?.codexErrorInfo;
      const unauthorized = JSON.stringify(info ?? '').includes('401') || /not logged in|unauthorized/i.test(text(turn.error?.message));
      const message = text(turn.error?.message) || this.#lastError || 'Codex stopped with an error.';
      error = unauthorized ? harnessError('Codex is not logged in. Run `codex login` in a terminal.', 'AUTH') : harnessError(message, 'HARNESS_FAILED');
    }
    events.push({ type: 'turn-end', ok: false, error, usage });
  }

  #request(message, events) {
    const params = message.params ?? {};
    switch (message.method) {
      case 'item/commandExecution/requestApproval':
        events.push({
          type: 'permission-request', id: message.id, toolCallId: params.itemId, toolName: 'shell',
          input: { command: text(params.command) }, reason: text(params.reason) || text(params.command) || undefined, decisions: params.availableDecisions,
        });
        break;
      case 'item/fileChange/requestApproval':
        events.push({
          type: 'permission-request', id: message.id, toolCallId: params.itemId, toolName: 'apply_patch',
          input: {}, reason: text(params.reason) || 'Apply a change to files.', decisions: ['accept', 'decline', 'cancel'],
        });
        break;
      case 'item/tool/requestUserInput':
        events.push({
          type: 'question-request', id: message.id, toolCallId: params.itemId,
          questions: (Array.isArray(params.questions) ? params.questions : []).map((question) => ({
            question: text(question.question), header: text(question.header) || undefined, ids: question.id,
            options: Array.isArray(question.options) ? question.options.map((option) => ({ label: text(option.label), description: text(option.description) || undefined })) : [],
          })),
          params,
        });
        break;
      // Not offered to a person in this version: permission grants beyond the sandbox, MCP forms and dynamic tools.
      case 'item/permissions/requestApproval': events.push({ type: 'reply', id: message.id, result: { permissions: {}, scope: 'turn' } }); break;
      case 'mcpServer/elicitation/request': events.push({ type: 'reply', id: message.id, result: { action: 'decline', content: null, _meta: null } }); break;
      default: events.push({ type: 'reply', id: message.id, error: { code: -32601, message: `Unsupported request ${message.method}.` } });
    }
  }
}

/** The DSH access mode as Codex's approval and sandbox settings, always explicit: settings stick to a thread. */
export function permissionSettings(permission) {
  switch (permission) {
    case 'danger-full-access': return { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } };
    case 'read-only': return { approvalPolicy: 'on-request', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
    case 'auto': return { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
    default: return { approvalPolicy: 'on-request', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
  }
}

/** Another Codex harness's identity must not leak into the child; the user's own CODEX_HOME must survive. */
export function childEnvironment(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (key !== 'CODEX_HOME' && /^(CODEX_|ORCA_|HERDR_)/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

/** A JSON-RPC client over a child process's stdio. */
class RpcConnection {
  #next = 1;
  #pending = new Map();

  constructor(child, onMessage) {
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== undefined && !message.method) {
          const call = this.#pending.get(message.id);
          this.#pending.delete(message.id);
          if (message.error) call?.reject(Object.assign(new Error(text(message.error.message) || 'Request failed.'), { rpcCode: message.error.code }));
          else call?.resolve(message.result);
        } else onMessage(message);
      }
    });
    child.on('close', () => this.#fail(harnessError('Codex exited.', 'HARNESS_EXITED')));
    // A binary that cannot even start must fail the request waiting for it, not leave it pending forever.
    child.on('error', (error) => this.#fail(harnessError(`Could not start Codex: ${error.message}`, 'HARNESS_UNAVAILABLE')));
  }

  #fail(error) {
    for (const call of this.#pending.values()) call.reject(error);
    this.#pending.clear();
  }

  write(value) { if (this.child.stdin?.writable) this.child.stdin.write(JSON.stringify(value) + '\n'); }
  notify(method, params) { this.write(params === undefined ? { method } : { method, params }); }
  respond(id, result) { this.write({ id, result }); }
  respondError(id, code, message) { this.write({ id, error: { code, message } }); }
  request(method, params) {
    const id = this.#next++;
    const call = deferred();
    this.#pending.set(id, call);
    this.write({ id, method, params });
    return call.promise;
  }
}

const initialize = (rpc) => rpc.request('initialize', {
  clientInfo: { name: 'dudu', title: 'Dudu', version: '0.4.0' }, capabilities: { experimentalApi: true, requestAttestation: false },
}).then(() => rpc.notify('initialized'));

const SERVICE = 'dudu';

/** Start one turn. Resolves once the thread exists and its turn has been accepted. */
export async function startCodex({ path, cwd, resume, prompt, model, effort, permission, signal, env = childEnvironment(), spawnProcess = spawn }) {
  if (signal?.aborted) throw signal.reason ?? harnessError('The request was aborted.', 'ABORTED');
  await assertDirectory(cwd);
  const settings = permissionSettings(permission);
  const child = spawnProcess(path, ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = new AsyncQueue();
  const normalizer = new CodexNormalizer();
  const pending = new Map();   // rpc id -> the request as the bridge saw it
  let finished = false;
  let stderr = '';
  let threadId;
  let turnId;

  const finish = (event) => {
    if (finished) return;
    finished = true;
    events.push(event);
    events.close();
    child.stdin?.end();
  };
  const rpc = new RpcConnection(child, (message) => {
    if (message.method === 'turn/started') turnId = message.params?.turn?.id ?? turnId;
    for (const event of normalizer.feed(message)) {
      if (event.type === 'reply') { if (event.error) rpc.respondError(event.id, event.error.code, event.error.message); else rpc.respond(event.id, event.result); }
      else if (event.type === 'turn-end') finish(event);
      else {
        if (event.type === 'permission-request' || event.type === 'question-request') pending.set(event.id, event);
        if (!finished) events.push(event);
      }
    }
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  child.on('error', (error) => finish({ type: 'turn-end', ok: false, error: harnessError(`Could not start Codex: ${error.message}`, 'HARNESS_UNAVAILABLE') }));
  child.on('close', (code) => {
    const detail = stderr.replace(/\u001b\[[0-9;]*m/g, '').trim().split('\n').slice(-2).join(' ');
    finish({ type: 'turn-end', ok: false, error: harnessError(`Codex exited (${code}) without finishing the turn.${detail ? ` ${detail}` : ''}`, 'HARNESS_EXITED') });
  });
  const abandon = (error) => { child.stdin?.end(); child.kill('SIGTERM'); throw error; };

  try {
    await initialize(rpc);
    const account = await rpc.request('account/read', { refreshToken: false });
    if (account?.account == null && account?.requiresOpenaiAuth) throw harnessError('Codex is not logged in. Run `codex login` in a terminal.', 'AUTH');
    const common = {
      cwd, ...(model && model !== 'default' ? { model } : {}), approvalPolicy: settings.approvalPolicy, sandbox: settings.sandbox,
      ...(settings.approvalsReviewer ? { approvalsReviewer: settings.approvalsReviewer } : {}),
    };
    let started;
    try {
      started = resume
        ? await rpc.request('thread/resume', { threadId: resume, ...common })
        : await rpc.request('thread/start', { ...common, ephemeral: false, serviceName: SERVICE });
    } catch (error) {
      if (/active writer/i.test(error.message)) throw harnessError('This Codex thread is open in another process. Close it there first.', 'HARNESS_BUSY');
      throw error;
    }
    threadId = started.thread.id;
    const turn = await rpc.request('turn/start', {
      threadId, input: [{ type: 'text', text: prompt, text_elements: [] }], summary: 'auto',
      approvalPolicy: settings.approvalPolicy, sandboxPolicy: settings.sandboxPolicy,
      ...(settings.approvalsReviewer ? { approvalsReviewer: settings.approvalsReviewer } : {}),
      ...(model && model !== 'default' ? { model } : {}), ...(effort ? { effort } : {}),
    });
    turnId = turn?.turn?.id ?? turnId;
  } catch (error) {
    abandon(error instanceof Error ? error : harnessError(String(error), 'HARNESS_FAILED'));
  }

  return {
    nativeSessionId: threadId,
    events: { [Symbol.asyncIterator]: async function* () { for (;;) { const next = await events.next(); if (next.done) return; yield next.value; } } },
    pushUserMessage(content) {
      rpc.request('turn/steer', { threadId, expectedTurnId: turnId, input: [{ type: 'text', text: content, text_elements: [] }] }).catch(() => {});
    },
    respondPermission(id, decision) {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      const offered = Array.isArray(request.decisions) ? request.decisions : ['accept', 'decline', 'cancel'];
      const choice = decision.behavior === 'allow' ? 'accept' : (offered.includes('decline') ? 'decline' : 'cancel');
      rpc.respond(id, { decision: choice });
    },
    respondQuestion(id, answer) {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (answer.cancelled || !answer.answers) { rpc.respond(id, { answers: {} }); return; }
      rpc.respond(id, {
        answers: Object.fromEntries(answer.answers.map((item) => [item.question.ids, { answers: [...item.selected, ...(item.custom ? [item.custom] : [])] }])),
      });
    },
    async interrupt() { if (threadId && turnId) rpc.request('turn/interrupt', { threadId, turnId }).catch(() => {}); },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.stdin?.end();
      const exited = new Promise((resolve) => child.once('close', resolve));
      const timer = setTimeout(() => child.kill('SIGTERM'), 3000);
      const killer = setTimeout(() => child.kill('SIGKILL'), 6000);
      try { await exited; } finally { clearTimeout(timer); clearTimeout(killer); }
    },
  };
}

// ---- models ----------------------------------------------------------------------------------------------

/** Ask the installed Codex which models this configuration offers. No model is called. */
export async function listCodexModels(path, { timeout = 20_000, spawnProcess = spawn } = {}) {
  const child = spawnProcess(path, ['app-server'], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] });
  const rpc = new RpcConnection(child, () => {});
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
  try {
    await initialize(rpc);
    const models = [];
    let cursor;
    do {
      const page = await rpc.request('model/list', { includeHidden: false, ...(cursor ? { cursor } : {}) });
      models.push(...(page?.data ?? []));
      cursor = page?.nextCursor ?? undefined;
    } while (cursor);
    return models;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    child.stdin?.end();
    child.kill('SIGTERM');
  }
}

const titleCase = (id) => id[0].toUpperCase() + id.slice(1);

export function createCodexDriver({ path }) {
  let models;
  const load = async () => {
    models ??= (await listCodexModels(path))?.filter((model) => typeof model?.id === 'string') ?? [];
    return models;
  };
  const known = new Set(CODEX_TOOLS.map((tool) => tool.name));
  return {
    id: 'codex', name: 'ChatGPT', route: 'codex', path,
    tools: CODEX_TOOLS,
    knowsTool: (name) => known.has(name),
    fallbackTool: fallbackSpec,
    async listModels() {
      return (await load()).map((model) => ({ provider: 'codex', id: model.id, name: model.displayName || model.id, ...(model.description ? { description: model.description } : {}) }));
    },
    async resolveModel(id) {
      const model = (await load()).find((candidate) => candidate.id === id);
      const efforts = (model?.supportedReasoningEfforts ?? []).map((option) => text(option.reasoningEffort)).filter(Boolean);
      return {
        id, name: model?.displayName || id, ...(model?.description ? { description: model.description } : {}),
        ...(efforts.length ? { reasoning: { efforts: efforts.map((level) => ({ id: level, name: titleCase(level) })), defaultEffort: efforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : efforts[0] } } : {}),
      };
    },
    start: (options) => startCodex({ path, ...options }),
  };
}

export const codexProvider = {
  id: 'codex', name: 'ChatGPT', route: 'codex', binary: 'codex', minVersion: MIN_VERSION,
  create: ({ path }) => createCodexDriver({ path }),
};
