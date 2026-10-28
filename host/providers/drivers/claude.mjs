import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AsyncQueue } from '../async.mjs';
import { assertDirectory, harnessError } from '../harness-bridge.mjs';
import { CLAUDE_TOOLS, fallbackSpec } from './claude-tools.mjs';

// Claude Code is driven over its own stdio protocol: `claude --output-format stream-json --input-format
// stream-json --permission-prompt-tool stdio`. It is the protocol the Agent SDK speaks, and it needs neither the
// SDK nor a second copy of the CLI: the `claude` installed on this computer, with this user's login, settings,
// skills and MCP servers, does the work.

/** Hidden from `claude --resume` are sessions whose entrypoint says they were programmatic (sdk-cli, sdk-ts, sdk-py). */
export const ENTRYPOINT = 'dudu';
const MAX_DATA_BYTES = 256 * 1024;

const text = (value) => (typeof value === 'string' ? value : '');

function blocksText(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).map((block) => (block?.type === 'text' ? text(block.text) : block?.type === 'image' ? '[image]' : '')).join('');
}

function usageOf(usage = {}) {
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: (usage.input_tokens ?? 0) + read + write,
    outputTokens: usage.output_tokens ?? 0,
    ...(read ? { cacheReadTokens: read } : {}),
    ...(write ? { cacheWriteTokens: write } : {}),
  };
}

function compact(value) {
  if (value === undefined || value === null) return undefined;
  const json = JSON.stringify(value);
  return json.length > MAX_DATA_BYTES ? undefined : value;
}

/**
 * Claude's stdout, message by message, as the harness-independent events the bridge replays: steps with text,
 * reasoning and tool calls, tool results that arrive later, permission and question requests, and the end of the turn.
 */
export class ClaudeNormalizer {
  #blocks = new Map();
  #usage = {};
  #stopReason;
  #inputs = new Map();
  #authFailed = false;

  feed(message) {
    const events = [];
    const nested = message.parent_tool_use_id != null;   // frames of a subagent are shown through its own Task call
    switch (message.type) {
      case 'stream_event': if (!nested) this.#stream(message.event, events); break;
      case 'assistant': if (message.error === 'authentication_failed') this.#authFailed = true; break;
      case 'user': if (!nested) this.#results(message, events); break;
      case 'control_request': this.#control(message, events); break;
      case 'result': this.#result(message, events); break;
      default: break;
    }
    return events;
  }

  #stream(event, events) {
    switch (event?.type) {
      case 'message_start':
        this.#blocks.clear();
        this.#stopReason = undefined;
        this.#usage = event.message?.usage ?? {};
        events.push({ type: 'step-start' });
        break;
      case 'content_block_start': {
        const block = event.content_block ?? {};
        this.#blocks.set(event.index, { type: block.type, id: block.id, name: block.name, json: '' });
        if (block.type === 'text' && block.text) events.push({ type: 'text-delta', text: block.text });
        break;
      }
      case 'content_block_delta': {
        const delta = event.delta ?? {};
        const block = this.#blocks.get(event.index);
        if (delta.type === 'text_delta') events.push({ type: 'text-delta', text: text(delta.text) });
        else if (delta.type === 'thinking_delta') events.push({ type: 'reasoning-delta', text: text(delta.thinking) });
        else if (delta.type === 'input_json_delta' && block) block.json += text(delta.partial_json);
        break;
      }
      case 'content_block_stop': {
        const block = this.#blocks.get(event.index);
        if (block?.type !== 'tool_use') break;
        let input = {};
        try { input = block.json ? JSON.parse(block.json) : {}; } catch { input = { _unparsed: block.json }; }
        this.#inputs.set(block.id, input);
        events.push({ type: 'tool-call', id: block.id, name: block.name, input });
        break;
      }
      case 'message_delta':
        this.#stopReason = event.delta?.stop_reason ?? this.#stopReason;
        this.#usage = { ...this.#usage, ...(event.usage ?? {}) };
        break;
      case 'message_stop':
        events.push({ type: 'step-end', reason: this.#stopReason === 'tool_use' ? 'tool-calls' : 'stop', usage: usageOf(this.#usage) });
        break;
      default: break;
    }
  }

  #results(message, events) {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block?.type !== 'tool_result') continue;
      events.push({
        type: 'tool-result', id: block.tool_use_id, output: blocksText(block.content), isError: block.is_error === true,
        data: compact(message.tool_use_result && typeof message.tool_use_result === 'object' ? message.tool_use_result : undefined),
      });
    }
  }

  #control(message, events) {
    const request = message.request;
    if (request?.subtype !== 'can_use_tool') return;
    const input = request.input ?? {};
    const toolCallId = request.tool_use_id;
    if (request.tool_name === 'AskUserQuestion') {
      events.push({
        type: 'question-request', id: message.request_id, toolCallId,
        questions: (Array.isArray(input.questions) ? input.questions : []).map((question) => ({
          question: text(question.question), header: text(question.header) || undefined,
          options: Array.isArray(question.options) ? question.options.map((option) => ({ label: text(option.label), description: text(option.description) || undefined })) : [],
          multiSelect: question.multiSelect === true,
        })),
        input,
      });
      return;
    }
    // The plan itself is in the ExitPlanMode call that was just streamed; the permission request carries an empty input.
    const plan = request.tool_name === 'ExitPlanMode' ? text(this.#inputs.get(toolCallId)?.plan) : '';
    events.push({
      type: 'permission-request', id: message.request_id, toolCallId, toolName: request.display_name || request.tool_name, input,
      reason: plan || text(request.description) || text(request.title) || text(request.decision_reason) || undefined,
    });
  }

  #result(message, events) {
    const usage = usageOf(message.usage);
    if (!message.is_error) {
      events.push({ type: 'turn-end', ok: true, usage, costUsd: message.total_cost_usd });
      return;
    }
    const detail = text(message.result) || (Array.isArray(message.errors) ? message.errors.join('\n') : '') || 'Claude Code stopped with an error.';
    let error;
    if (this.#authFailed) error = harnessError('Claude Code is not logged in. Run `claude` in a terminal and sign in.', 'AUTH');
    else if (message.subtype === 'error_during_execution' && message.terminal_reason === 'aborted_tools') error = harnessError('The turn was interrupted.', 'ABORTED');
    else error = harnessError(detail, 'HARNESS_FAILED');
    events.push({ type: 'turn-end', ok: false, error, usage });
  }
}

/** The DSH access mode as Claude Code's permission flags. Always explicit: the user's own default may be `auto`. */
export function permissionArgs(permission) {
  switch (permission) {
    case 'danger-full-access': return ['--dangerously-skip-permissions'];
    case 'read-only': return ['--permission-mode', 'plan'];
    case 'auto': return ['--permission-mode', 'auto'];
    default: return ['--permission-mode', 'default'];
  }
}

/** The child must not believe it runs inside another harness, and must not hide its sessions from the terminal. */
export function childEnvironment(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (/^(CLAUDE_CODE_|CLAUDECODE|ORCA_|HERDR_)/.test(key)) continue;
    env[key] = value;
  }
  env.CLAUDE_CODE_ENTRYPOINT = ENTRYPOINT;
  return env;
}

/** Claude Code has no session lock; two processes would both append to the transcript. Its live registry tells. */
export async function openElsewhere(sessionId, { directory = join(homedir(), '.claude', 'sessions'), alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } } } = {}) {
  let names;
  try { names = await readdir(directory); } catch { return undefined; }
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    try {
      const entry = JSON.parse(await readFile(join(directory, name), 'utf8'));
      if (entry.sessionId === sessionId && Number.isInteger(entry.pid) && alive(entry.pid)) return entry;
    } catch { /* a registry file being written or removed */ }
  }
  return undefined;
}

const encode = (value) => JSON.stringify(value) + '\n';

/** Start one turn. Resolves once the process is running and the prompt is sent. */
export async function startClaude({ path, cwd, resume, prompt, model, effort, permission, signal, env = childEnvironment(), spawnProcess = spawn, registry }) {
  if (signal?.aborted) throw signal.reason ?? harnessError('The request was aborted.', 'ABORTED');
  await assertDirectory(cwd);
  if (resume) {
    const other = await openElsewhere(resume, registry);
    if (other) throw harnessError(`This Claude Code session is open in another process (pid ${other.pid}). Close it there first.`, 'HARNESS_BUSY');
  }
  const nativeSessionId = resume ?? randomUUID();
  const args = [
    '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--include-partial-messages',
    '--permission-prompt-tool', 'stdio', ...permissionArgs(permission),
    // `default` is the picker's name for "whatever the account's default is": the flag is left out.
    ...(model && model !== 'default' ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
    resume ? `--resume=${resume}` : `--session-id=${nativeSessionId}`,
  ];
  const child = spawnProcess(path, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const normalizer = new ClaudeNormalizer();
  const events = new AsyncQueue();
  const pending = new Map();   // request id -> { toolUseId, input }
  let finished = false;
  let stderr = '';
  let buffer = '';

  const write = (value) => { if (child.stdin?.writable) child.stdin.write(encode(value)); };
  const finish = (event) => {
    if (finished) return;
    finished = true;
    events.push(event);
    events.close();
    child.stdin?.end();   // the process exits when its input ends
  };

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
      if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
        pending.set(message.request_id, { toolUseId: message.request.tool_use_id, input: message.request.input ?? {} });
      }
      if (message.type === 'control_cancel_request') pending.delete(message.request_id);
      for (const event of normalizer.feed(message)) {
        if (event.type === 'turn-end') finish(event);
        else if (!finished) events.push(event);
      }
    }
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  child.on('error', (error) => finish({ type: 'turn-end', ok: false, error: harnessError(`Could not start Claude Code: ${error.message}`, 'HARNESS_UNAVAILABLE') }));
  child.on('close', (code) => {
    const detail = stderr.trim().split('\n').slice(-3).join(' ');
    finish({ type: 'turn-end', ok: false, error: harnessError(`Claude Code exited (${code}) without finishing the turn.${detail ? ` ${detail}` : ''}`, 'HARNESS_EXITED') });
  });

  write({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null });

  return {
    nativeSessionId,
    events: { [Symbol.asyncIterator]: async function* () { for (;;) { const next = await events.next(); if (next.done) return; yield next.value; } } },
    pushUserMessage(content) { write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }); },
    respondPermission(id, decision) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      write({
        type: 'control_response',
        response: {
          subtype: 'success', request_id: id,
          response: decision.behavior === 'allow'
            ? { behavior: 'allow', updatedInput: entry.input, toolUseID: entry.toolUseId }
            : { behavior: 'deny', message: decision.message ?? 'The user did not allow this.', toolUseID: entry.toolUseId },
        },
      });
    },
    respondQuestion(id, answer) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      const response = answer.cancelled || !answer.answers
        ? { behavior: 'deny', message: 'The user did not answer the question.', toolUseID: entry.toolUseId }
        : {
          behavior: 'allow', toolUseID: entry.toolUseId,
          updatedInput: {
            ...entry.input,
            answers: Object.fromEntries(answer.answers.map((item) => [item.question.question, [...item.selected, ...(item.custom ? [item.custom] : [])].join(', ')])),
          },
        };
      write({ type: 'control_response', response: { subtype: 'success', request_id: id, response } });
    },
    async interrupt() { write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } }); },
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

const FALLBACK_MODELS = ['default', 'opus', 'sonnet', 'haiku'].map((value) => ({
  value, displayName: value === 'default' ? 'Default' : value[0].toUpperCase() + value.slice(1), supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
}));

/** Ask the installed CLI which models this account can use. No hooks run and no model is called. */
export async function listClaudeModels(path, { timeout = 20_000, spawnProcess = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnProcess(path, ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--settings', '{"disableAllHooks":true}'], { env: childEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] });
    const id = randomUUID();
    let buffer = '';
    const done = (models) => { clearTimeout(timer); child.stdin?.end(); child.kill('SIGTERM'); resolve(models); };
    const timer = setTimeout(() => done(undefined), timeout);
    child.on('error', () => done(undefined));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === 'control_response' && message.response?.request_id === id) done(message.response.response?.models);
        } catch { /* not a response */ }
      }
    });
    child.stdin.write(encode({ type: 'control_request', request_id: id, request: { subtype: 'list_models' } }));
  });
}

const titleCase = (id) => id[0].toUpperCase() + id.slice(1);

export function createClaudeDriver({ path }) {
  let models;
  const load = async () => {
    models ??= (await listClaudeModels(path))?.filter((model) => typeof model?.value === 'string') ?? FALLBACK_MODELS;
    return models;
  };
  const known = new Set(CLAUDE_TOOLS.map((tool) => tool.name));
  return {
    id: 'claude', name: 'Claude', route: 'claude', path,
    tools: CLAUDE_TOOLS,
    knowsTool: (name) => known.has(name),
    fallbackTool: fallbackSpec,
    async listModels() {
      return (await load()).map((model) => ({ provider: 'claude', id: model.value, name: model.displayName || model.value, ...(model.description ? { description: model.description } : {}) }));
    },
    async resolveModel(id) {
      const model = (await load()).find((candidate) => candidate.value === id);
      return {
        id, name: model?.displayName || id, ...(model?.description ? { description: model.description } : {}),
        ...(model?.supportsEffort === false || !model?.supportedEffortLevels?.length ? {} : {
          reasoning: { efforts: model.supportedEffortLevels.map((level) => ({ id: level, name: titleCase(level) })), defaultEffort: model.supportedEffortLevels.includes('medium') ? 'medium' : model.supportedEffortLevels[0] },
        }),
      };
    },
    start: (options) => startClaude({ path, ...options }),
  };
}

export const claudeProvider = {
  id: 'claude', name: 'Claude', route: 'claude', binary: 'claude', minVersion: '2.1.0',
  create: ({ path }) => createClaudeDriver({ path }),
};
