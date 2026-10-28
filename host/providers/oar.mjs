import { homedir } from 'node:os';
import { AsyncQueue } from './async.mjs';
import { assertDirectory, harnessError } from './harness-bridge.mjs';

// Claude Code and Codex are driven by OAR (@botiverse/oar). OAR starts the installed CLI, speaks its protocol, resumes
// sessions and lists models. What lives here is DSH's side of it: reading OAR's record stream as the steps the bridge
// replays, and the choices OAR leaves to its host (which tools a mode may use, which sandbox a mode gets).

const MODEL_TTL = 5 * 60_000;
const FALLBACK_TTL = 30_000;

const text = (value) => (typeof value === 'string' ? value : '');
const titleCase = (id) => id[0].toUpperCase() + id.slice(1);

/** Names in `base` that match a pattern and must not reach the harness, as an OAR environment overlay (null removes). */
export function scrubbedEnvironment(patterns, { keep = [], base = process.env } = {}) {
  const overlay = {};
  for (const name of Object.keys(base)) {
    if (patterns.some((pattern) => pattern.test(name)) && !keep.includes(name)) overlay[name] = null;
  }
  return overlay;
}

/** A tool's input arrives from OAR as JSON text; DSH wants an object. */
export function parseInput(value) {
  if (value === undefined || value === null) return {};
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return { _unparsed: value }; }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
}

/** What DSH shows of a tool result: OAR's output parts as text. */
export function contentText(parts) {
  return (Array.isArray(parts) ? parts : []).map((part) => {
    if (part?.type === 'text') return text(part.text);
    if (part?.type === 'image') return '[image]';
    return part?.value === undefined ? '' : JSON.stringify(part.value);
  }).filter(Boolean).join('\n');
}

/** A turn that did not complete, as the error DSH shows. */
export function failureOf(outcome, { name, login }) {
  if (outcome.kind === 'aborted') return harnessError('The turn was interrupted.', 'ABORTED');
  if (outcome.failure === 'auth') return Object.assign(harnessError(`${name} is not logged in. ${login}`, 'AUTH'), { failure: 'auth' });
  return Object.assign(harnessError(text(outcome.reason) || `${name} stopped with an error.`, 'HARNESS_FAILED'), { failure: outcome.failure });
}

/**
 * OAR's records as the events the bridge replays: steps of text, reasoning and tool calls, the results of the calls,
 * and the end of the turn. A step is one assistant message. Subclasses say how a harness delimits one and how its
 * tool calls and results are named; what is common lives here.
 */
export class OarNormalizer {
  #open = false;
  #calls = new Map();    // callId -> { name }, for the calls announced to the bridge
  #inStep = 0;
  #finished = false;

  constructor({ name, login }) {
    this.name = name;
    this.login = login;
  }

  /** True for the record that ends one assistant message. Without one, a tool result ends the step it follows. */
  isMessageEnd() { return false; }

  /** The call a started tool is: `{ name }` when its input follows, `{ name, input }` when it is complete, nothing to skip it. */
  started(event) { return { name: text(event.tool) || 'unknown', ...(event.input === undefined ? {} : { input: parseInput(event.input) }) }; }

  /** The input of a call whose start had none. */
  inputOf(event) { return parseInput(event.input); }

  /** The result of a call the bridge knows. */
  resultOf(event) { return { output: contentText(event.content), isError: event.result === 'failed', ...(Number.isInteger(event.exitCode) ? { data: { exitCode: event.exitCode } } : {}) }; }

  feed(record) {
    const events = [];
    if (this.#finished) return events;
    if (record.kind === 'frame') this.#frame(record, events);
    else if (record.kind === 'request' && record.direction === 'toApp') this.#unanswerable(record, events);
    else if (record.kind === 'response' && record.body?.kind === 'exited') this.#exited(record.body, events);
    return events;
  }

  #frame(record, events) {
    if ((record.agentPath?.length ?? 0) > 0) return;   // a subagent's work is shown through its own call
    for (const event of record.body?.events ?? []) {
      switch (event.kind) {
        case 'text_delta': if (event.text) { this.#open = true; events.push({ type: 'text-delta', text: event.text }); } break;
        case 'reasoning':
          if (event.content?.kind === 'text' && event.content.text) { this.#open = true; events.push({ type: 'reasoning-delta', text: event.content.text }); }
          break;
        case 'tool_call_started': this.#start(event, record, events); break;
        case 'tool_call_input': this.#input(event, events); break;
        case 'tool_call_ended': this.#end(event, record, events); break;
        case 'turn_ended': this.#turnEnded(event, events); break;
        default: break;
      }
      if (this.#finished) return;
    }
    if (this.isMessageEnd(record)) this.#closeStep(events);
  }

  #start(event, record, events) {
    const call = this.started(event, record);
    if (!call) return;
    this.#calls.set(event.callId, { name: call.name, announced: false });
    if (call.input !== undefined) this.#announce(event.callId, call.input, events, true);
  }

  #input(event, events) {
    const call = this.#calls.get(event.callId);
    if (!call || call.announced) return;
    this.#announce(event.callId, this.inputOf(event), events, false);
  }

  /** `closes`: the call is complete the moment it starts, so no more can follow it in the same message. */
  #announce(callId, input, events, closes) {
    const call = this.#calls.get(callId);
    call.announced = true;
    this.#open = true;
    this.#inStep++;
    events.push({ type: 'tool-call', id: callId, name: call.name, input });
    if (closes) this.#closeStep(events);
  }

  #end(event, record, events) {
    const call = this.#calls.get(event.callId);
    if (!call?.announced) return;
    // A result means the message that made the call is over, even where the harness gave no sign of it.
    if (this.#inStep > 0) this.#closeStep(events);
    events.push({ type: 'tool-result', id: event.callId, ...this.resultOf(event, call, record) });
  }

  #closeStep(events) {
    if (!this.#open) return;
    events.push({ type: 'step-end', reason: this.#inStep > 0 ? 'tool-calls' : 'stop' });
    this.#open = false;
    this.#inStep = 0;
  }

  #turnEnded(event, events) {
    this.#closeStep(events);
    const { outcome } = event;
    this.#finished = true;
    events.push(outcome?.kind === 'completed'
      ? { type: 'turn-end', ok: true }
      : { type: 'turn-end', ok: false, error: failureOf(outcome ?? { kind: 'failed', failure: 'unknown' }, this) });
  }

  /** Nobody answers what the harness asks of its host: OAR has no reply channel, and a harness left waiting never finishes. */
  #unanswerable(record, events) {
    this.#closeStep(events);
    this.#finished = true;
    events.push({
      type: 'turn-end', ok: false,
      error: harnessError(`${this.name} asked for something DSH cannot answer here (${text(record.body?.type) || 'a request'}).`, 'HARNESS_UNSUPPORTED'),
    });
  }

  #exited(body, events) {
    this.#closeStep(events);
    this.#finished = true;
    events.push({ type: 'turn-end', ok: false, error: harnessError(`${this.name} exited (${body.code ?? 'no code'}) before the turn finished.`, 'HARNESS_EXITED') });
  }
}

async function* drain(queue) {
  for (;;) {
    const next = await queue.next();
    if (next.done) return;
    yield next.value;
  }
}

/** One OAR session for one DSH turn. Resolves once the prompt is accepted. */
export async function startOarRun({ runtime, installation, sessionOptions, prompt, normalizer, name, signal }) {
  if (signal?.aborted) throw signal.reason ?? harnessError('The request was aborted.', 'ABORTED');
  let session;
  try { session = await runtime.session(installation, sessionOptions); }
  catch (error) { throw harnessError(`Could not start ${name}: ${error instanceof Error ? error.message : String(error)}`, 'HARNESS_UNAVAILABLE'); }

  const events = new AsyncQueue();
  let finished = false;
  const release = () => { void session.dispose().catch(() => {}); };
  const finish = (event) => {
    if (finished) return;
    finished = true;
    events.push(event);
    events.close();
    // After the observer returns: the session is still reading the frame this record came from.
    queueMicrotask(release);
  };
  const unsubscribe = session.rawEvents((record) => {
    if (finished) return;
    for (const event of normalizer.feed(record)) {
      if (event.type === 'turn-end') finish(event);
      else events.push(event);
    }
  });

  let outcome;
  try { outcome = await session.prompt(prompt); }
  catch (error) { outcome = { kind: 'rejected', reason: error instanceof Error ? error.message : String(error) }; }
  if (outcome.kind === 'rejected') {
    finished = true;
    unsubscribe();
    await session.dispose().catch(() => {});
    throw harnessError(`${name} did not take the message: ${outcome.reason}`, 'HARNESS_REJECTED');
  }

  return {
    nativeSessionId: session.id,
    events: drain(events),
    // Real steering where the harness takes it; OAR reports whether it did, and a miss means the turn had just ended.
    async pushUserMessage(content) { if (typeof session.steer === 'function') await session.steer(content).catch(() => {}); },
    async interrupt() { await session.abort().catch(() => {}); },
    async close() {
      finished = true;
      unsubscribe();
      events.close();
      await session.dispose().catch(() => {});
    },
  };
}

/**
 * A harness provider on an OAR runtime. `session` returns what is specific to the harness in the options of one OAR
 * session (environment, tool limits, launch arguments) from the DSH access mode.
 */
export function createOarProvider({ id, name, runtime, binaryEnv, tools, fallbackTool, login, normalizer, fallbackModels, scrub, session: sessionFor, before }) {
  const known = new Set(tools.map((tool) => tool.name));
  const environment = (extra) => ({ ...scrubbedEnvironment(scrub.patterns, scrub), ...extra });

  return {
    id, name, route: id,

    /** What the settings page shows about the harness on this computer: OAR looks where each vendor installs it. */
    async probe({ override } = {}) {
      let snapshot;
      try { snapshot = await runtime.installation(override ? { env: { [binaryEnv]: override } } : undefined); }
      catch (error) { return { state: 'broken', reason: error instanceof Error ? error.message : String(error) }; }
      if (snapshot.kind === 'available' && snapshot.via === 'executable') {
        return { state: 'ready', path: snapshot.command, version: text(snapshot.version).match(/\d+\.\d+\.\d+\S*/)?.[0] ?? text(snapshot.version), installation: snapshot };
      }
      if (snapshot.kind === 'unsupported') return { state: 'unsupported', reason: snapshot.reason };
      return { state: 'missing', reason: override ? `${override} is not an executable file.` : `${name} was not found.` };
    },

    create({ installation }) {
      let loaded;
      const load = async () => {
        if (loaded && Date.now() < loaded.until) return loaded.models;
        let models;
        try {
          const listed = await runtime.listModels(installation, { env: environment(), cwd: homedir(), timeoutMs: 30_000 });
          if (listed.kind === 'ok') models = listed.models.filter((model) => !model.disabled);
        } catch { /* the fallback below */ }
        loaded = models?.length ? { until: Date.now() + MODEL_TTL, models } : { until: Date.now() + FALLBACK_TTL, models: fallbackModels };
        return loaded.models;
      };
      return {
        id, name, route: id, tools,
        knowsTool: (toolName) => known.has(toolName),
        fallbackTool,
        refreshModels() { loaded = undefined; },
        async listModels() {
          return (await load()).map((model) => ({ provider: id, id: model.id, name: model.displayName || model.id }));
        },
        async resolveModel(modelId) {
          const model = (await load()).find((candidate) => candidate.id === modelId);
          const levels = Array.isArray(model?.effortLevels) ? model.effortLevels : [];
          return {
            id: modelId, name: model?.displayName || modelId,
            ...(levels.length ? {
              reasoning: {
                efforts: levels.map((level) => ({ id: level, name: titleCase(level) })),
                defaultEffort: model.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : levels.includes('medium') ? 'medium' : levels[0],
              },
            } : {}),
          };
        },
        async start({ resume, prompt, cwd, model, effort, permission, signal }) {
          if (signal?.aborted) throw signal.reason ?? harnessError('The request was aborted.', 'ABORTED');
          await assertDirectory(cwd);
          await before?.({ resume });
          const specific = sessionFor({ permission });
          const sessionOptions = {
            cwd: cwd || homedir(),
            // `default` is the picker's name for "whatever the account's default is": no model is asked for.
            ...(model && model !== 'default' ? { model } : {}),
            ...(effort ? { effort } : {}),
            ...(resume ? { resume } : {}),
            ...specific,
            env: environment(specific.env),
          };
          return startOarRun({ runtime, installation, sessionOptions, prompt, normalizer: normalizer({ name, login }), name, signal });
        },
      };
    },
  };
}
