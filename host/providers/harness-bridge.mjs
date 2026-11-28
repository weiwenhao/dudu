import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { AsyncQueue, abortReason, deferred, withAbort } from './async.mjs';
import { createHarnessActivity } from './activity.mjs';
import { goalReportOf } from './goal.mjs';
import { admittedLink, createInputDelivery, undeliveredInputs, withInputDeliveries } from './input-delivery.mjs';

// An external harness (Claude Code, Codex) runs a turn with its own loop, tools and permissions. DSH's loop
// still drives the conversation step by step: each DSH step replays one assistant message of the harness, and
// every tool call of that message comes back as a call of a mirror tool that only waits for the harness's own
// result. DSH therefore records and renders the turn natively, and the harness's own session store stays the
// authority a terminal can resume.

// DSH's replay is display history, not the context sent to the native harness.
// This host requires a positive integer capacity and has no adapter opt-out for
// automatic compaction. Use the largest safe integer as a host-only sentinel:
// even a 10M placeholder eventually made long conversations fail model switches.
// Real limits and automatic compaction remain owned by the native harness.
export const CONTEXT_WINDOW = Number.MAX_SAFE_INTEGER;

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((block) => block?.type === 'text').map((block) => block.text).join('');
const hasToolCalls = (message) => (Array.isArray(message.content) ? message.content : []).some((block) => block?.type === 'tool-call');
/** A round of the goal a person set (DSH's goal driver writes them as messages of its own source), see goal.mjs. */
const isGoalRound = (message) => message.role === 'user' && message.source?.kind === 'goal' && message.source.round > 0;
// What a harness is given: what a person wrote, and the rounds of their goal.
const isPrompt = (message) => message.role === 'user' && (message.source?.kind === 'user' || isGoalRound(message));

export class HarnessFailure extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function harnessError(message, code) {
  return new HarnessFailure(message, code);
}

export function manualCompactionError(name) {
  return harnessError(`Manual compaction is not available for ${name} through OAR; native automatic compaction remains enabled.`, 'HARNESS_UNSUPPORTED');
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
 * DSH's turn/start boundary separates new input from a stopped tool-ended turn. Without a host history reader,
 * older runtimes fall back to the last assistant message without tools. User prompts open a turn or steer it.
 */
export function analyzeRequest(messages, route, events, promptFilter = isPrompt) {
  const boundary = events?.findLastIndex((event) => event.type === 'turn/start') ?? -1;
  let prompts;
  let continuing;
  if (boundary >= 0) {
    const current = events.slice(boundary + 1);
    const ids = new Set(current.filter((event) => event.type === 'user/message').map((event) => event.data.id));
    // What an earlier turn failed to hand over is carried to this one, but not a goal round: it is DSH's own, and the next one is written when the agent is idle.
    const pending = undeliveredInputs(events.slice(0, boundary), route, (message) => promptFilter(message) && !isGoalRound(message));
    prompts = [...new Map([...pending, ...messages.filter((message) => promptFilter(message) && ids.has(message.id))]
      .map((message) => [message.id, message])).values()];
    continuing = current.some((event) => event.type === 'assistant/message');
  } else {
    let start = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && !hasToolCalls(messages[i])) { start = i + 1; break; }
    }
    const segment = messages.slice(start);
    prompts = segment.filter(promptFilter);
    continuing = segment.some((message) => message.role === 'assistant');
  }
  let link;
  for (let i = messages.length - 1; i >= 0; i--) {
    const source = messages[i].source;
    if (messages[i].role === 'assistant' && source?.provider === route && typeof source.replayState?.nativeSessionId === 'string') {
      link = source.replayState;
      break;
    }
  }
  return {
    continuing,
    prompts,
    promptText: prompts.map((message) => textOf(message.content)).filter(Boolean).join('\n\n'),
    link: admittedLink(events, route, link),
  };
}

/**
 * One DSH turn and the pump that keeps reading its native stream between DSH's steps.
 * The harness runs its tools while it streams, so a tool's result can arrive long before DSH's loop starts the mirror
 * tool that waits for it: results are kept as they come.
 */
export class HarnessRun {
  #tools = new Map();

  constructor({ sessionId, handle, prompts, activity, team, onForeground }) {
    this.sessionId = sessionId;
    this.handle = handle;
    this.nativeSessionId = handle.nativeSessionId;
    this.steps = new AsyncQueue();
    this.forwarded = new Set(prompts.map((message) => message.id));
    this.finished = false;
    this.startedAt = Date.now();
    this.finishedAt = null; // when the turn ended: deep sleep counts its wait from here
    this.turnEnd = undefined;
    this.activity = activity;
    this.team = team;
    this.foregroundActive = true;
    this.onForeground = onForeground;
    this.pump = this.#pump();
  }

  async #pump() {
    try {
      for await (const event of this.handle.events) this.#route(event);
      this.#end({ type: 'turn-end', ok: false, error: harnessError('The harness ended without finishing the turn.', 'HARNESS_EXITED') });
    } catch (error) {
      this.#end({ type: 'turn-end', ok: false, error });
    } finally {
      // OAR's team observes the native process across stopped/replaced parent turns.
      // A view without that lifetime (the one-shot mirror) still ends with its own stream.
      if (!this.handle.team) await this.team?.end(this.turnEnd);
    }
  }

  #route(event) {
    switch (event.type) {
      case 'tool-result': this.#tool(event.id).resolve(event); break;
      case 'compaction-start':
      case 'compaction-end': this.activity?.update(event); break;
      case 'foreground-state':
        this.foregroundActive = event.active;
        this.onForeground?.();
        break;
      case 'turn-end': this.#end(event); break;
      default: this.steps.push(event);
    }
  }

  #end(event) {
    if (this.finished) return;
    this.finished = true;
    this.finishedAt = Date.now();
    this.foregroundActive = false;
    this.onForeground?.();
    this.turnEnd = event;
    this.activity?.end(event);
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

  pushUserMessage(text, images, options) { return this.handle.pushUserMessage?.(text, images, options); }

  async interrupt() {
    if (!this.finished) await this.handle.interrupt?.();
  }

  async close(options) {
    this.activity?.end();
    await this.handle.close?.(options);
    await this.pump.catch(() => {});
  }
}

/** The runs of one harness, one per DSH session. */
export class HarnessBridge {
  #runs = new Map();
  #compactions = new Map();
  #lifetime = new AbortController();
  #opening = new Set();
  #disposal;

  constructor({ driver, agentOf = () => undefined, permissionOf = () => undefined, onLink, inputOf, eventsOf, flushSession, inputJournal, onForeground }) {
    this.driver = driver;
    this.agentOf = agentOf;
    this.permissionOf = permissionOf;
    // Told which DSH session runs which native session, so the sessions list can say where a session already is.
    this.onLink = onLink;
    this.inputOf = inputOf ?? (async (messages) => ({ prompt: messages.map((message) => textOf(message.content)).filter(Boolean).join('\n\n') }));
    this.eventsOf = eventsOf;
    this.flushSession = flushSession;
    this.inputJournal = inputJournal;
    this.onForeground = onForeground;
    // Set by the owner of the agents: registers a mirror tool for a tool name the harness's catalog does not list.
    this.onUnknownTool = undefined;
    // Set by the owner: `(sessionId, { agent, signal }) -> { mcpServers, env,
    // disallowedTools, launchArgs } | null`. Tools keep the current run's exact
    // owner and cancellation; launch settings stay stable for retained processes.
    this.toolsOf = undefined;
  }

  get route() { return this.driver.route; }

  runOf(sessionId) { return this.#runs.get(sessionId); }

  /** Live native work, including retained background tasks and compaction, keeps an idle issue awake. */
  hasActiveWork(sessionId) {
    const run = this.#runs.get(sessionId);
    return this.#compactions.has(sessionId) || Boolean(run && (!run.finished || run.handle.backgroundActive));
  }

  yieldForInput(sessionId) {
    const run = this.#runs.get(sessionId);
    if (!run || !this.agentOf(sessionId)?.inbox?.nextStep?.length) return;
    run.inputReady?.resolve();
    if (!run.finished && !run.foregroundActive) run.handle.yieldForInput?.();
  }

  /** DSH has committed the reply. Wait here for native output or for DSH to admit human input. */
  async waitForBackground(agent, signal) {
    const run = this.#runs.get(agent.id);
    const step = run?.backgroundStep;
    if (!step) return;
    try {
      while (!agent.inbox.nextStep.length) {
        run.inputReady = deferred();
        const resume = await withAbort(Promise.race([step.continuation, run.inputReady.promise]), signal);
        signal.throwIfAborted();
        if (resume === undefined) continue; // an inbox entry may have been removed before DSH claimed it
        if (this.#lifetime.signal.aborted) return;
        if (!resume) {
          run.backgroundStep = undefined;
          if (step.goal) await this.onGoalReport?.(agent.id, step.goal.round.source, goalReportOf(step.goal.text));
        } else if (!agent.inbox.nextStep.length) {
          // DSH consumes a runtime-context entry when assembling the step, without adding an empty
          // user message to the transcript. The adapter drains the native follow-up without sending a prompt.
          agent.inject({ id: randomUUID(), role: 'user', source: { kind: 'runtime-context' }, content: [] });
        }
        return;
      }
    } catch (error) {
      if (signal.aborted) {
        run.backgroundStep = undefined;
        await run.interrupt();
      }
      throw error;
    } finally {
      run.inputReady = undefined;
    }
  }

  async historyOf(sessionId, signal) {
    const events = await this.eventsOf?.(sessionId, signal);
    return withInputDeliveries(events, await this.inputJournal?.read(this.route, sessionId) ?? []);
  }

  deliveryOf(sessionId, prompts) {
    return createInputDelivery({
      session: this.agentOf(sessionId)?.session, flushSession: this.flushSession, provider: this.route, prompts,
      write: this.inputJournal ? (entry) => this.inputJournal.record(this.route, sessionId, entry) : undefined,
    });
  }

  /**
   * The runs whose turn has ended and that are still kept: with their process while it lives, and with what they kept of the turn. Deep sleep lets go of them (`release`), after the same
   * waits for an issue's agent and for any other conversation. A run with background work or a compaction is listed too; `release` leaves it alone.
   */
  heldRuns() {
    return [...this.#runs].filter(([, run]) => run.finished).map(([sessionId, run]) => ({ route: this.route, sessionId, finishedAt: run.finishedAt }));
  }

  /** The runs that are working now, for the overview. */
  activeRuns() {
    return [...this.#runs].filter(([, run]) => !run.finished).map(([sessionId, run]) => ({
      route: this.route, sessionId, nativeSessionId: run.nativeSessionId, startedAt: run.startedAt, cwd: this.agentOf(sessionId)?.session?.header?.cwd,
    }));
  }

  begin(sessionId, options) {
    const opening = this.#begin(sessionId, options);
    this.#opening.add(opening);
    opening.then(() => this.#opening.delete(opening), () => this.#opening.delete(opening));
    return opening;
  }

  async #begin(sessionId, { prompts, link, model, effort, signal }) {
    signal = AbortSignal.any([this.#lifetime.signal, ...(signal ? [signal] : [])]);
    signal.throwIfAborted();
    const previous = this.#runs.get(sessionId);
    // The conversation's process is kept from turn to turn; only deep sleep (`release`) or a close lets it go.
    const retained = previous?.finished && previous.handle.alive ? previous.handle : undefined;
    await previous?.close({ preserveBackground: Boolean(retained) });
    const observedSubagents = await previous?.team?.checkpoint() ?? link?.nativeSubagents;
    const agent = this.agentOf(sessionId);
    const delivery = this.deliveryOf(sessionId, prompts);
    let team;
    let handle;
    try {
      await delivery.prepare();
      const input = await this.inputOf(prompts, { signal });
      // Tools the host serves must never keep a conversation from starting.
      const hostTools = await Promise.resolve(this.toolsOf?.(sessionId, { agent, signal })).catch(() => null);
      handle = await this.driver.start({
        sessionId, agent, ...input, resume: link?.nativeSessionId, cwd: agent?.session?.header?.cwd,
        model, effort, permission: this.permissionOf(agent), signal,
        observeSubagents: this.teams ? () => (team = this.teams.observe(agent, observedSubagents)) : undefined,
        observedSubagents, onInput: delivery.record, previous: retained,
        onTasks: this.jobs?.observe(agent), hostTools,
      });
      team = handle.team ?? team;
      signal.throwIfAborted();
      await delivery.accepted(handle.nativeSessionId);
      signal.throwIfAborted();
    } catch (error) {
      await handle?.close?.({ preserveBackground: Boolean(retained) && !this.#lifetime.signal.aborted });
      await delivery.failed(signal);
      if (!handle?.team) await team?.end({ ok: false, error });
      throw error;
    }
    const activity = createHarnessActivity({ session: agent?.session, route: this.route, nativeSessionId: handle.nativeSessionId, signal });
    const run = new HarnessRun({ sessionId, handle, prompts, activity, team, onForeground: () => this.onForeground?.(sessionId) });
    this.#runs.set(sessionId, run);
    try { this.onLink?.({ route: this.route, nativeSessionId: handle.nativeSessionId, sessionId }); } catch { /* bookkeeping only */ }
    return run;
  }

  async forward(sessionId, run, prompt, signal) {
    const delivery = this.deliveryOf(sessionId, [prompt]);
    try {
      await delivery.prepare();
      const input = await this.inputOf([prompt], { signal });
      const taken = await run.pushUserMessage(input.prompt, input.images, { onInput: delivery.record });
      // The harness cannot take a message while it works (no steering): nothing was sent, so it is not marked forwarded and the next
      // turn, which starts when this one ends, carries it.
      if (taken === false) { await delivery.failed(signal); return false; }
      await delivery.accepted(run.nativeSessionId);
      run.forwarded.add(prompt.id);
      return true;
    } catch (error) {
      await delivery.failed(signal);
      throw error;
    }
  }

  async close(sessionId) {
    const compacting = this.#compactions.get(sessionId);
    if (compacting) {
      compacting.controller.abort();
      await compacting.promise.catch(() => {});
    }
    await this.#runs.get(sessionId)?.close();
    this.#runs.delete(sessionId);
  }

  /**
   * Releases completed runs and their cached mirror results. A native process that still owns background tasks,
   * an active turn or a compaction is retained. The next turn resumes its native identity as usual.
   */
  async release(sessionId) {
    const run = this.#runs.get(sessionId);
    if (!run?.finished || run.handle.backgroundActive || this.#compactions.has(sessionId)) return false;
    this.#runs.delete(sessionId);
    await run.close();
    return true;
  }

  async compact(sessionId, { signal } = {}) {
    if (!this.driver.compact) throw manualCompactionError(this.driver.name);
    signal = AbortSignal.any([this.#lifetime.signal, ...(signal ? [signal] : [])]);
    signal.throwIfAborted();
    const run = this.#runs.get(sessionId);
    if ((run && (!run.finished || run.handle.backgroundActive)) || this.#compactions.has(sessionId)) throw harnessError('busy', 'HARNESS_BUSY');
    const events = await this.historyOf(sessionId, signal);
    const nativeSessionId = run?.nativeSessionId ?? admittedLink(events, this.route)?.nativeSessionId;
    if (!nativeSessionId) return false;
    await this.close(sessionId);
    signal.throwIfAborted();
    const agent = this.agentOf(sessionId);
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => this.driver.compact({
      resume: nativeSessionId, cwd: agent?.session?.header?.cwd,
      permission: this.permissionOf(agent), signal: AbortSignal.any([signal, controller.signal]),
    }));
    this.#compactions.set(sessionId, { controller, promise });
    try { await promise; return true; }
    finally { this.#compactions.delete(sessionId); }
  }

  dispose() {
    return this.#disposal ??= (async () => {
      this.#lifetime.abort();
      await Promise.all([
        ...[...this.#opening].map((opening) => opening.catch(() => {})),
        ...[...new Set([...this.#runs.keys(), ...this.#compactions.keys()])].map((sessionId) => this.close(sessionId)),
      ]);
    })();
  }
}

function usageOf(usage = {}) {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
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

  async function* step(run, signal, resumePending, goalRound) {
    const previousGoal = run.backgroundStep?.goal;
    run.backgroundStep = undefined;
    let finalText = previousGoal && previousGoal.round.id === goalRound?.id ? `${previousGoal.text}\n\n` : '';
    let index = 0;
    let open;
    let calls = 0;
    let usage;
    let hasText = false;
    let separatesNextAnswer = false;
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
          const text = type === 'text' && separatesNextAnswer ? `\n\n${event.text}` : event.text;
          if (type === 'text') {
            hasText = true;
            separatesNextAnswer = false;
            finalText += text;
          }
          open.text += text;
          yield { type: event.type, index: open.index, text };
        } else if (event.type === 'tool-call') {
          yield* closeOpen();
          if (driver.knowsTool && !driver.knowsTool(event.name)) bridge.onUnknownTool?.(run.sessionId, event.name);
          const at = index++;
          const args = JSON.stringify(event.input ?? {});
          calls++;
          yield { type: 'block-start', index: at, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index: at, id: event.id, name: event.name, argumentsDelta: args };
          yield { type: 'block-end', index: at, block: { type: 'tool-call', id: event.id, name: event.name, arguments: args } };
        } else if (event.type === 'usage') {
          usage ??= {};
          for (const [key, value] of Object.entries(event.usage)) usage[key] = (usage[key] ?? 0) + value;
        } else if (event.type === 'step-end' || event.type === 'turn-end') {
          yield* closeOpen();
          if (event.type === 'turn-end' && event.ok === false) {
            if (usage || event.usage) yield { type: 'usage', usage: usageOf(usage ?? event.usage) };
            throw event.error instanceof Error ? event.error : harnessError(String(event.error ?? 'The harness failed.'), 'HARNESS_FAILED');
          }
          // DSH can admit input after the native turn ends, before it consumes the final answer.
          // Drain old tool steps first; only the tool-free boundary can hand over to a resumed writer.
          if (calls === 0 && !event.continuation && run.finished && run.turnEnd?.ok && event.reason !== 'tool-calls') {
            const next = await resumePending?.(run);
            if (next) {
              run = next;
              separatesNextAnswer = hasText;
              continue;
            }
          }
          if (usage || event.usage) yield { type: 'usage', usage: usageOf(usage ?? event.usage) };
          // The end of a goal round: the harness cannot call update_goal, so what it says of the goal is done here, before DSH sees the agent idle and starts another round.
          const goal = goalRound && calls === 0 ? { round: goalRound, text: finalText } : undefined;
          if (event.continuation) run.backgroundStep = { continuation: event.continuation, goal, signal };
          else if (goal) await bridge.onGoalReport?.(run.sessionId, goal.round.source, goalReportOf(goal.text));
          const nativeSubagents = await run.team?.checkpoint();
          yield {
            type: 'finish',
            reason: { kind: calls > 0 ? 'tool-calls' : 'stop' },
            replayState: {
              harness: driver.id, nativeSessionId: run.nativeSessionId,
              ...(nativeSubagents?.length ? { nativeSubagents } : {}),
            },
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
      return driver.resolveModel(model).then((info) => ({ ...info, provider, context: { contextWindow: CONTEXT_WINDOW } }));
    },
    async prepareCall(provider, model, signal) {
      return { model: await this.resolveModel(provider, model, signal), stream: (options) => this.stream(options) };
    },

    async *stream(options) {
      const { signal } = options;
      try {
        if (options.purpose) {
          if (options.purpose === 'compaction') throw manualCompactionError(driver.name);
          yield* single(options.purpose === 'session-title' ? titleOf(options.messages) : '');
          return;
        }
        bridge.beforeStep?.(options.sessionId);
        const events = await bridge.historyOf(options.sessionId, signal);
        const request = analyzeRequest(options.messages, bridge.route, events, bridge.isPrompt);
        let run = bridge.runOf(options.sessionId);
        const continuing = request.continuing || (signal !== undefined && signal === run?.backgroundStep?.signal);
        if (continuing && !run) {
          throw harnessError('The harness is no longer running this turn. Send the message again.', 'HARNESS_LOST');
        }
        if (!continuing) {
          if (!request.promptText.trim() && !request.prompts.some((message) => message.content.some((block) => block.type === 'image'))) throw harnessError('There is nothing to send to the harness.', 'HARNESS_NO_PROMPT');
          run = await bridge.begin(options.sessionId, { ...request, model: options.model, effort: options.reasoningEffort, signal });
        } else {
          // Input typed while the harness works reaches DSH as steering; hand each message over once.
          for (const prompt of request.prompts) {
            if (run.forwarded.has(prompt.id)) continue;
            if (run.finished) break;
            try { await bridge.forward(options.sessionId, run, prompt, signal); }
            catch (error) {
              // Only an explicit refusal before submission can be handed over. Ambiguous writes stay failures.
              if (error instanceof HarnessFailure && error.code === 'HARNESS_REJECTED'
                && ['disposed', 'runtime_exited', 'no_active_turn'].includes(error.inputRefusal)
                && run.finished && run.turnEnd?.ok && !signal?.aborted) break;
              throw error;
            }
          }
        }
        const goalRound = request.prompts.find(isGoalRound);
        yield* step(run, signal, async (completed) => {
          const prompts = request.prompts.filter((prompt) => !completed.forwarded.has(prompt.id));
          if (!prompts.length) return;
          const nativeSubagents = await completed.team?.checkpoint();
          const next = await bridge.begin(options.sessionId, {
            prompts,
            link: {
              ...request.link, nativeSessionId: completed.nativeSessionId,
              ...(nativeSubagents?.length ? { nativeSubagents } : {}),
            },
            model: options.model, effort: options.reasoningEffort, signal,
          });
          for (const id of completed.forwarded) next.forwarded.add(id);
          return next;
        }, goalRound);
      } catch (error) {
        if (!(error instanceof HarnessFailure)) throw error;
        // DSH discards codes on foreign Error classes. Its stream protocol carries our known failures without
        // importing or bundling a second copy of the host's error class.
        yield {
          type: 'finish',
          reason: {
            kind: signal?.aborted || error.code === 'ABORTED' ? 'aborted' : 'error',
            failure: { code: error.code, message: error.message },
          },
        };
      }
    },
  };
}
