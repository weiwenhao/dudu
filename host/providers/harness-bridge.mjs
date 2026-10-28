import { stat } from 'node:fs/promises';
import { AsyncQueue, abortReason, deferred } from './async.mjs';

// An external harness (Claude Code, Codex) runs a turn with its own loop, tools and permissions. DSH's loop
// still drives the conversation step by step: each DSH step replays one assistant message of the harness, and
// every tool call of that message comes back as a call of a mirror tool that only waits for the harness's own
// result. DSH therefore records and renders the turn natively, and the harness's own session store stays the
// authority a terminal can resume.

// The harness manages its own context, so DSH must never decide the history is too long and compact it.
export const CONTEXT_WINDOW = 10_000_000;

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((block) => block?.type === 'text').map((block) => block.text).join('');
const hasToolCalls = (message) => (Array.isArray(message.content) ? message.content : []).some((block) => block?.type === 'tool-call');
const isPrompt = (message) => message.role === 'user' && message.source?.kind === 'user';

export function harnessError(message, code) {
  return Object.assign(new Error(message), { code });
}

/** spawn blames the executable when the working directory is missing; say what is really wrong. */
export async function assertDirectory(cwd) {
  if (!cwd) return;
  let ok = false;
  try { ok = (await stat(cwd)).isDirectory(); } catch { /* reported below */ }
  if (!ok) throw harnessError(`The session's folder is not available: ${cwd}`, 'HARNESS_BAD_CWD');
}

/**
 * What a request is: the start of a turn, or another step of one the harness is already running.
 * A turn ends with an assistant message that calls no tool, so everything after the last such message
 * belongs to the current turn. Prompts typed by the user are its opener and, after it, steering.
 */
export function analyzeRequest(messages, route) {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && !hasToolCalls(messages[i])) { start = i + 1; break; }
  }
  const segment = messages.slice(start);
  const prompts = segment.filter(isPrompt);
  let link;
  for (let i = messages.length - 1; i >= 0; i--) {
    const source = messages[i].source;
    if (messages[i].role === 'assistant' && source?.provider === route && typeof source.replayState?.nativeSessionId === 'string') {
      link = source.replayState;
      break;
    }
  }
  return {
    continuing: segment.some((message) => message.role === 'assistant'),
    prompts,
    promptText: prompts.map((message) => textOf(message.content)).filter(Boolean).join('\n\n'),
    link,
  };
}

/**
 * One harness process for one DSH turn, and the pump that keeps reading it between DSH's steps.
 * The harness runs its tools while it streams, so a tool's result can arrive long before DSH's loop starts the mirror
 * tool that waits for it: results are kept as they come.
 */
export class HarnessRun {
  #tools = new Map();

  constructor({ sessionId, handle, prompts }) {
    this.sessionId = sessionId;
    this.handle = handle;
    this.nativeSessionId = handle.nativeSessionId;
    this.steps = new AsyncQueue();
    this.forwarded = new Set(prompts.map((message) => message.id));
    this.finished = false;
    this.turnEnd = undefined;
    this.pump = this.#pump();
  }

  async #pump() {
    try {
      for await (const event of this.handle.events) this.#route(event);
      this.#end({ type: 'turn-end', ok: false, error: harnessError('The harness ended without finishing the turn.', 'HARNESS_EXITED') });
    } catch (error) {
      this.#end({ type: 'turn-end', ok: false, error });
    }
  }

  #route(event) {
    switch (event.type) {
      case 'tool-result': this.#tool(event.id).resolve(event); break;
      case 'turn-end': this.#end(event); break;
      default: this.steps.push(event);
    }
  }

  #end(event) {
    if (this.finished) return;
    this.finished = true;
    this.turnEnd = event;
    this.steps.push(event);
    this.steps.close();
    for (const call of this.#tools.values()) call.reject(harnessError('The harness ended before the tool finished.', 'HARNESS_EXITED'));
  }

  #tool(callId) {
    let call = this.#tools.get(callId);
    if (!call) {
      call = deferred();
      this.#tools.set(callId, call);
      if (this.finished) call.reject(harnessError('The harness ended before the tool finished.', 'HARNESS_EXITED'));
    }
    return call;
  }

  /** The result of one tool call, once the harness reports it. Stopping the wait does not stop the harness. */
  waitTool(callId, { signal } = {}) {
    const result = this.#tool(callId).promise;
    if (!signal) return result;
    if (signal.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      result.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  pushUserMessage(text) { void this.handle.pushUserMessage?.(text); }

  async interrupt() {
    if (!this.finished) await this.handle.interrupt?.();
  }

  async close() {
    await this.handle.close?.();
    await this.pump.catch(() => {});
  }
}

/** The runs of one harness, one per DSH session. */
export class HarnessBridge {
  #runs = new Map();

  constructor({ driver, agentOf = () => undefined, permissionOf = () => undefined }) {
    this.driver = driver;
    this.agentOf = agentOf;
    this.permissionOf = permissionOf;
    // Set by the owner of the agents: registers a mirror tool for a tool name the harness's catalog does not list.
    this.onUnknownTool = undefined;
  }

  get route() { return this.driver.route; }

  runOf(sessionId) { return this.#runs.get(sessionId); }

  async begin(sessionId, { prompts, promptText, link, model, effort, signal }) {
    await this.#runs.get(sessionId)?.close();
    const agent = this.agentOf(sessionId);
    const handle = await this.driver.start({
      sessionId, agent, prompt: promptText, resume: link?.nativeSessionId, cwd: agent?.session?.header?.cwd,
      model, effort, permission: this.permissionOf(agent), signal,
    });
    const run = new HarnessRun({ sessionId, handle, prompts });
    this.#runs.set(sessionId, run);
    return run;
  }

  async close(sessionId) {
    await this.#runs.get(sessionId)?.close();
    this.#runs.delete(sessionId);
  }

  async dispose() {
    await Promise.all([...this.#runs.keys()].map((sessionId) => this.close(sessionId)));
  }
}

function usageOf(usage = {}) {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
  };
}

/**
 * Titles come from the first prompt as typed; starting a harness for a title would spend a turn on it. DSH asks for
 * a title with the person's messages inside an instruction, as a JSON array of `{ seq, text }`; a request that
 * carries the text on its own is read as it is.
 */
export function titleOf(messages) {
  const request = [...messages].reverse().find((message) => message.role === 'user' && textOf(message.content).trim());
  const body = textOf(request?.content);
  let prompts = [];
  const array = body.match(/\[[\s\S]*\]\s*$/);
  if (array) {
    try { prompts = JSON.parse(array[0]).map((item) => String(item?.text ?? '')).filter((text) => text.trim()); } catch { /* plain text */ }
  }
  const line = (prompts[0] ?? body).replace(/\s+/g, ' ').trim();
  const limit = /[\u3400-\u9fff]/.test(line) ? 24 : 60;
  const characters = [...line];
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : line || 'New session';
}

/** The LLM adapter DSH's loop talks to; `stream()` replays one assistant message of the harness per call. */
export function createHarnessAdapter(bridge) {
  const { driver } = bridge;

  async function* single(text) {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }

  async function* step(run, signal) {
    let index = 0;
    let open;
    let calls = 0;
    const closeOpen = function* () {
      if (!open) return;
      yield { type: 'block-end', index: open.index, block: { type: open.type, text: open.text } };
      open = undefined;
    };
    try {
      for (;;) {
        const { value: event, done } = await run.steps.next(signal);
        if (done) throw harnessError('The harness ended without finishing the turn.', 'HARNESS_EXITED');
        if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
          const type = event.type === 'text-delta' ? 'text' : 'reasoning';
          if (open?.type !== type) {
            yield* closeOpen();
            open = { type, index: index++, text: '' };
            yield { type: 'block-start', index: open.index, blockType: type };
          }
          open.text += event.text;
          yield { type: event.type, index: open.index, text: event.text };
        } else if (event.type === 'tool-call') {
          yield* closeOpen();
          if (driver.knowsTool && !driver.knowsTool(event.name)) bridge.onUnknownTool?.(run.sessionId, event.name);
          const at = index++;
          const args = JSON.stringify(event.input ?? {});
          calls++;
          yield { type: 'block-start', index: at, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index: at, id: event.id, name: event.name, argumentsDelta: args };
          yield { type: 'block-end', index: at, block: { type: 'tool-call', id: event.id, name: event.name, arguments: args } };
        } else if (event.type === 'step-end' || event.type === 'turn-end') {
          yield* closeOpen();
          if (event.type === 'turn-end' && event.ok === false) {
            throw event.error instanceof Error ? event.error : harnessError(String(event.error ?? 'The harness failed.'), 'HARNESS_FAILED');
          }
          yield { type: 'usage', usage: usageOf(event.usage) };
          yield {
            type: 'finish',
            reason: { kind: calls > 0 ? 'tool-calls' : 'stop' },
            replayState: { harness: driver.id, nativeSessionId: run.nativeSessionId },
          };
          return;
        }
      }
    } catch (error) {
      if (signal?.aborted) await run.interrupt();
      throw error;
    }
  }

  return {
    providerInfo(provider) { return { id: provider, name: driver.name }; },
    providerRetryPolicy() { return undefined; },
    imageRequestPricing() { return undefined; },
    listModels() { return driver.listModels(); },
    resolveModel(provider, model) {
      return driver.resolveModel(model).then((info) => ({ context: { contextWindow: CONTEXT_WINDOW }, ...info, provider }));
    },
    async prepareCall(provider, model, signal) {
      return { model: await this.resolveModel(provider, model, signal), stream: (options) => this.stream(options) };
    },

    async *stream(options) {
      const { signal } = options;
      if (options.purpose) {
        yield* single(options.purpose === 'session-title' ? titleOf(options.messages) : '');
        return;
      }
      const request = analyzeRequest(options.messages, bridge.route);
      let run = bridge.runOf(options.sessionId);
      if (request.continuing && !run) {
        throw harnessError('The harness is no longer running this turn. Send the message again.', 'HARNESS_LOST');
      }
      if (!request.continuing) {
        if (!request.promptText.trim()) throw harnessError('There is nothing to send to the harness.', 'HARNESS_NO_PROMPT');
        run = await bridge.begin(options.sessionId, { ...request, model: options.model, effort: options.reasoningEffort, signal });
      } else {
        // Input typed while the harness works reaches DSH as steering; hand each message over once.
        for (const prompt of request.prompts) {
          if (run.forwarded.has(prompt.id)) continue;
          run.forwarded.add(prompt.id);
          run.pushUserMessage(textOf(prompt.content));
        }
      }
      yield* step(run, signal);
    },
  };
}
