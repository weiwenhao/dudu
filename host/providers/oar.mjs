import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { AsyncQueue, abortReason, deferred } from './async.mjs';
import { assertDirectory, harnessError, manualCompactionError } from './harness-bridge.mjs';
import { inclusiveUsage, usageDelta } from './usage.mjs';
import { OarResident } from './oar-resident.mjs';

// Claude Code and Codex are driven by OAR (@botiverse/oar). OAR starts the installed CLI, speaks its protocol, resumes
// sessions and lists models. What lives here is DSH's side of it: reading OAR's record stream as the steps the bridge
// replays, and the choices OAR leaves to its host (which tools a mode may use, which sandbox a mode gets).

const MODEL_TTL = 5 * 60_000;
const FALLBACK_TTL = 30_000;
// A tool result is kept in DSH's log with the conversation: past this many characters it is cut.
const MAX_OUTPUT = 256 * 1024;
// How long a turn that has ended waits for the follow-up the harness still owes a message it took in the meantime.
const FOLLOW_UP_MS = 5000;
// What shows the harness doing something again after its turn has ended.
const ACTIVITY = new Set(['turn_active', 'turn_started', 'text_delta', 'reasoning', 'tool_call_started', 'compaction_started']);

const text = (value) => (typeof value === 'string' ? value : '');
const titleCase = (id) => id[0].toUpperCase() + id.slice(1);

/** `claude-opus-5-5` -> 'Opus 5.5', `claude-sonnet-5` -> 'Sonnet 5', `claude-haiku-4-5-20251001` -> 'Haiku 4.5'; '' for anything else. */
const resolvedName = (resolved) => {
  const match = /^claude-([a-z]+)-(\d+(?:-\d{1,2})?)(?:-\d{8})?$/.exec(text(resolved));
  return match ? `${titleCase(match[1])} ${match[2].replace('-', '.')}` : '';
};

/**
 * What the menu calls a model: the harness's own name when it says which version it is (`Opus 5.5`); an alias such as `Opus` or `Default`
 * is followed by what it means today, so that what is chosen is what runs. The harness's name for a model is kept as it is otherwise.
 */
export function modelName(model) {
  const name = model.displayName || model.id;
  const meant = resolvedName(model.resolvedId);
  if (!meant || /\d/.test(name) || name.includes(meant)) return name;
  return model.id === 'default' ? `${name} · ${meant}` : meant;
}

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
  #usage;

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

  /** The turn the normalizer reported as ended continues: the harness took up a message that had been waiting. */
  reopen() { this.#finished = false; }

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
    // Some runtimes put usage after turn_ended in the same frame. Read it before the terminal boundary.
    for (const event of record.body?.events ?? []) {
      if (event.kind !== 'usage') continue;
      const usage = inclusiveUsage(event.usage?.total ?? event.usage?.tokens);
      if (!usage) continue;
      const delta = usageDelta(usage, this.#usage);
      this.#usage = usage;
      if (Object.values(delta).some((value) => value > 0)) events.push({ type: 'usage', usage: delta });
    }
    for (const event of record.body?.events ?? []) {
      switch (event.kind) {
        case 'text_delta': if (event.text) { this.#open = true; events.push({ type: 'text-delta', text: event.text }); } break;
        case 'reasoning':
          if (event.content?.kind === 'text' && event.content.text) { this.#open = true; events.push({ type: 'reasoning-delta', text: event.content.text }); }
          break;
        case 'tool_call_started': this.#start(event, record, events); break;
        case 'tool_call_input': this.#input(event, events); break;
        case 'tool_call_ended': this.#end(event, record, events); break;
        case 'compaction_started': events.push({ type: 'compaction-start' }); break;
        case 'compaction_ended': events.push({ type: 'compaction-end', outcome: event.outcome, ...(event.reason ? { reason: event.reason } : {}) }); break;
        case 'turn_ended': this.#turnEnded(event, events); break;
        default: break;
      }
      if (this.#finished) return;
    }
    if (this.isMessageEnd(record) && this.#inStep > 0) this.#closeStep(events);
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
    const result = this.resultOf(event, call, record);
    if (typeof result.output === 'string' && result.output.length > MAX_OUTPUT) result.output = `${result.output.slice(0, MAX_OUTPUT)}\n… (output truncated)`;
    events.push({ type: 'tool-result', id: event.callId, ...result });
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

/** OAR verifies native compaction completion; keep the writer until its process has actually closed. */
export async function compactOarSession({ runtime, installation, sessionOptions, name, signal }) {
  if (signal?.aborted) throw abortReason(signal);
  let session;
  try { session = await runtime.session(installation, sessionOptions); }
  catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    throw harnessError(`Could not start ${name}: ${error instanceof Error ? error.message : String(error)}`, 'HARNESS_UNAVAILABLE');
  }
  let unsubscribe = () => {};
  let stopping;
  const stop = () => (stopping ??= session.abort().catch(() => {}));
  const interrupted = deferred();
  let requested = false;
  let nativeFailure;
  const onAbort = () => { void stop(); interrupted.reject(abortReason(signal)); };
  try {
    if (signal?.aborted) throw abortReason(signal);
    if (typeof session.compact !== 'function') throw manualCompactionError(name);
    unsubscribe = session.rawEvents((record) => {
      if (!requested || record.sessionId !== session.id || (record.agentPath?.length ?? 0) > 0) return;
      if (record.kind === 'request' && record.direction === 'toApp') {
        interrupted.reject(harnessError(`${name} asked for something DSH cannot answer here (${text(record.body?.type) || 'a request'}).`, 'HARNESS_UNSUPPORTED'));
      }
      if (record.kind === 'frame') {
        // The official outcome can use a generic reason while the root's native
        // result still carries the provider's diagnosis. Keep that existing detail.
        const failed = record.body?.events?.find((event) => event.kind === 'turn_ended' && event.outcome?.kind === 'failed');
        const result = record.body?.native?.type === 'result' ? text(record.body.native.result).trim() : '';
        if (failed?.outcome.reason || result) nativeFailure = failed?.outcome.reason || result;
      }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) throw abortReason(signal);
    requested = true;
    const outcome = await Promise.race([session.compact({ signal }), interrupted.promise]);
    if (signal?.aborted) throw abortReason(signal);
    if (outcome.kind === 'completed') return;
    if (outcome.kind === 'aborted') throw failureOf(outcome, { name, login: '' });
    const code = outcome.kind === 'rejected' ? 'HARNESS_REJECTED'
      : outcome.kind === 'unconfirmed' && ['runtime_exited', 'session_released'].includes(outcome.code) ? 'HARNESS_EXITED'
        : 'HARNESS_FAILED';
    const reason = outcome.kind === 'failed' && ['native_failed', 'not_compacted'].includes(outcome.code)
      ? nativeFailure || outcome.reason : outcome.reason;
    throw harnessError(reason || `${name} ended without reporting native compaction.`, code);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await stopping;
    unsubscribe();
    await session.dispose();
  }
}

/** One DSH turn on an OAR session, retaining native processes that still own background work. */
export async function startOarRun({ runtime, installation, sessionOptions, prompt, images, normalizer, name, signal, queuesSteer = false, followUpMs = FOLLOW_UP_MS, onRecord, observedSubagents = [], onInput, onTasks, previous }) {
  if (signal?.aborted) throw signal.reason ?? harnessError('The request was aborted.', 'ABORTED');
  let session;
  let resident = previous?.resident;
  if (resident && (!resident.available || resident.closing)) resident = undefined;
  const reused = Boolean(resident);
  try {
    if (resident) {
      session = resident.session;
      resident.idle = false;
      // No process replacement while it owns background commands. Apply the next turn's native settings in place.
      const settings = ({ resume: _resume, openSignal: _signal, observedSubagents: _children, ...value }) => value;
      if (JSON.stringify(settings(resident.options)) !== JSON.stringify(settings(sessionOptions))) {
        if (!session.configure) throw harnessError('busy', 'HARNESS_BUSY');
        const configured = await session.configure(sessionOptions);
        if (configured.kind === 'rejected') throw harnessError(configured.reason, 'HARNESS_REJECTED');
        resident.options = sessionOptions;
      }
      normalizer = resident.normalizer;
      normalizer.reopen();
    } else session = await runtime.session(installation, sessionOptions);
  }
  catch (error) {
    resident?.finishTurn();
    if (signal?.aborted) throw abortReason(signal);
    throw harnessError(`Could not start ${name}: ${error instanceof Error ? error.message : String(error)}`, 'HARNESS_UNAVAILABLE');
  }

  const events = new AsyncQueue();
  resident ??= new OarResident(session, { normalizer, observedSubagents, onTasks, options: sessionOptions });
  const hasChildren = () => resident.hasChildren;
  let finished = false;
  // OAR answers a second `dispose()` at once, without waiting for the process: one disposal is kept, so that whoever
  // asks to close the run waits for the process that the end of the turn already started to stop.
  let disposal;
  const dispose = () => (disposal ??= resident.close());
  if (signal?.aborted) {
    if (reused && resident.backgroundActive) resident.finishTurn();
    else await dispose();
    throw abortReason(signal);
  }
  let unsubscribe = () => {};
  let stopping;
  let childStep;
  async function close({ preserveBackground = false } = {}) {
    if (!finished) events.push({ type: 'turn-end', ok: false, error: harnessError('The turn was interrupted.', 'ABORTED') });
    finished = true;
    clearTimeout(holdTimer);
    signal?.removeEventListener('abort', onAbort);
    unsubscribe();
    events.close();
    if (preserveBackground && resident.backgroundActive) resident.finishTurn();
    else await dispose();
  }
  function interrupt() {
    return stopping ??= (async () => {
      if (!finished) await session.abort().catch(() => {});
      await close({ preserveBackground: true });
    })();
  }
  function onAbort() { void interrupt(); }
  const finish = (event) => {
    if (finished) return;
    finished = true;
    clearTimeout(holdTimer);
    signal?.removeEventListener('abort', onAbort);
    if (event.ok && childStep) events.push(childStep);
    childStep = undefined;
    events.push(event);
    events.close();
    // After the observer returns: the session is still reading the frame this record came from.
    queueMicrotask(() => { unsubscribe(); resident.finishTurn(); });
  };
  // A message written while the harness works is either taken into the turn or, for a harness whose input is a queue,
  // answered by a turn of its own once this one ends. Such a message is tracked until the harness shows it picked it up.
  const waiting = new Set();
  const forwarded = new Set();
  let held;
  let holdTimer;
  const release = () => { clearTimeout(holdTimer); const event = held; held = undefined; if (event) finish(event); };
  const read = (record) => {
    if (finished) return;
    onRecord?.(record, session.id);
    // Keep the native writer alive for delegated work after the root's first answer. The next native root turn
    // resumes the same DSH turn; a quiet root is released only after its last actual child settles.
    if (held && waiting.size === 0 && !hasChildren() && !holdTimer) holdTimer = setTimeout(release, followUpMs);
    if (held && hasChildren()) { clearTimeout(holdTimer); holdTimer = undefined; }
    // Codex child threads may have an empty agentPath; their own sessionId still keeps their ends and text out of the parent.
    if (record.sessionId !== undefined && record.sessionId !== session.id) return;
    const seen = record.kind === 'frame' && (record.agentPath?.length ?? 0) === 0 ? record.body?.events ?? [] : [];
    const dropped = seen.find((event) => event.kind === 'input_dropped' && forwarded.has(event.inputId));
    if (dropped) {
      finish({ type: 'turn-end', ok: false, error: harnessError(`${name} did not take the message: ${dropped.message || dropped.reason}`, 'HARNESS_REJECTED') });
      return;
    }
    for (const event of seen) if (event.kind === 'user_message' && event.inputId) waiting.delete(event.inputId);
    if (held && (seen.some((event) => ACTIVITY.has(event.kind) || (event.kind === 'turn_ended' && event.outcome?.kind !== 'completed'))
      || (record.kind === 'response' && record.body?.kind === 'exited'))) {
      clearTimeout(holdTimer);
      holdTimer = undefined;
      held = undefined;
      normalizer.reopen();
      if (childStep) events.push({ type: 'text-delta', text: '\n\n' });
      childStep = undefined;
    }
    for (const event of normalizer.feed(record)) {
      // A tool-free final step also stops DSH's loop. Defer that boundary together with the root end while
      // native research runs, so DSH keeps its stop control and never reports a completed parent prematurely.
      if (event.type === 'step-end' && event.reason === 'stop' && hasChildren()) { childStep = event; continue; }
      if (event.type !== 'turn-end') { events.push(event); continue; }
      if (event.ok && (waiting.size > 0 || hasChildren())) {
        held = event;
        clearTimeout(holdTimer);
        holdTimer = hasChildren() ? undefined : setTimeout(release, followUpMs);
      }
      else finish(event);
    }
  };
  const pending = [];
  let reading = false;
  const drainRecords = async () => {
    reading = true;
    try {
      while (pending.length) {
        const { record, rootEnd } = pending.shift();
        if (rootEnd) await resident.refresh();
        read(record);
      }
    } finally { reading = false; }
  };
  unsubscribe = session.rawEvents((record) => {
    const rootEnd = record.kind === 'frame' && (record.sessionId === undefined || record.sessionId === session.id)
      && (record.agentPath?.length ?? 0) === 0 && record.body?.events?.some((event) => event.kind === 'turn_ended');
    if (reading || rootEnd && session.backgroundTasks) {
      pending.push({ record, rootEnd });
      if (!reading) void drainRecords();
    } else read(record);
  }, reused ? { sessionId: session.id, afterSeq: resident.seq } : undefined);
  // DSH uses the same signal for the whole turn, including its mirror-tool waits between model streams.
  if (!finished) signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    await interrupt();
    throw abortReason(signal);
  }

  const inputId = randomUUID();
  forwarded.add(inputId);
  async function submit(send, receipt) {
    await receipt?.({ state: 'submitting', nativeSessionId: session.id });
    signal?.throwIfAborted();
    let outcome;
    try { outcome = await send(); }
    catch (error) { outcome = { kind: 'rejected', reason: error instanceof Error ? error.message : String(error) }; }
    await receipt?.({
      state: outcome?.kind === 'accepted' ? 'accepted'
        : outcome?.kind === 'rejected' && outcome.code && outcome.code !== 'error' ? 'undelivered' : 'submitting',
      nativeSessionId: session.id,
    });
    return outcome;
  }
  let outcome;
  try {
    if (reused) waiting.add(inputId);
    outcome = await submit(async () => {
      const options = { inputId, ...(images?.length ? { images } : {}) };
      if (!reused) return session.prompt(prompt, options);
      // A Monitor may have opened a native turn while DSH was idle. OAR owns delivery across that race.
      const delivered = await session.deliver(prompt, options);
      return delivered.landed === 'rejected'
        ? { kind: 'rejected', code: delivered.code, reason: delivered.reason }
        : delivered.result;
    }, onInput);
  }
  catch (error) { await interrupt(); throw error; }
  if (signal?.aborted) {
    await interrupt();
    throw abortReason(signal);
  }
  if (outcome.kind === 'rejected') {
    waiting.delete(inputId);
    await close({ preserveBackground: reused });
    throw harnessError(`${name} did not take the message: ${outcome.reason}`, 'HARNESS_REJECTED');
  }

  return {
    resident,
    get backgroundActive() { return resident.backgroundActive; },
    nativeSessionId: session.id,
    events: drain(events),
    // Real steering where the harness takes it; OAR reports whether it did, and a miss means the turn had just ended.
    async pushUserMessage(content, images, { onInput } = {}) {
      if (typeof session.steer !== 'function') return;
      const inputId = randomUUID();
      forwarded.add(inputId);
      if (queuesSteer) waiting.add(inputId);
      const outcome = await submit(() => session.steer(content, { inputId, ...(images?.length ? { images } : {}) }), onInput);
      if (!outcome || outcome.kind === 'rejected') waiting.delete(inputId);
      if (outcome?.kind === 'rejected') {
        throw Object.assign(harnessError(`${name} did not take the message: ${outcome.reason}`, 'HARNESS_REJECTED'), {
          inputRefusal: outcome.code,
        });
      }
    },
    interrupt,
    close,
  };
}

/**
 * A harness provider on an OAR runtime. `session` returns what is specific to the harness in the options of one OAR
 * session (environment, tool limits, launch arguments) from the DSH access mode.
 */
export function createOarProvider({ id, name, runtime, binaryEnv, tools, fallbackTool, login, normalizer, fallbackModels, scrub, session: sessionFor, before, queuesSteer }) {
  const known = new Set(tools.map((tool) => tool.name));
  const environment = (extra) => ({ ...scrubbedEnvironment(scrub.patterns, scrub), ...extra });

  return {
    id, name, route: id,
    /** The environment the harness runs in (an OAR overlay: `null` removes a name). */
    environment: () => environment(),

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
      const optionsFor = async ({ resume, cwd, model, effort, permission, signal, retained }) => {
        if (signal?.aborted) throw abortReason(signal);
        await assertDirectory(cwd);
        if (!retained) await before?.({ resume });
        const specific = sessionFor({ permission, signal });
        return {
          cwd: cwd || homedir(),
          ...(model && model !== 'default' ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...(resume ? { resume } : {}),
          ...specific,
          env: environment(specific.env),
        };
      };
      return {
        id, name, route: id, tools,
        normalizer: () => normalizer({ name, login }),
        configuration: typeof runtime.configuration === 'function'
          ? (options = {}) => runtime.configuration(installation, { ...options, env: environment() })
          : undefined,
        knowsTool: (toolName) => known.has(toolName),
        fallbackTool,
        refreshModels() { loaded = undefined; },
        /** How much of the account's plan is used, asked of the harness itself (OAR starts it for the question). */
        accountUsage(extra) {
          if (typeof runtime.accountUsage !== 'function') return Promise.resolve({ kind: 'unsupported' });
          // `extra` adds to the overlay (`null` removes a name): the plan's usage read without an API key in the environment, say.
          return runtime.accountUsage(installation, { env: environment(extra), timeoutMs: 30_000 });
        },
        async listModels() {
          const models = await load();
          // The harness's own default comes first: a provider's first model is what the provider chip selects.
          return [...models.filter((model) => model.default), ...models.filter((model) => !model.default)]
            .map((model) => ({ provider: id, id: model.id, name: modelName(model), ...(model.resolvedId ? { resolvedId: model.resolvedId } : {}) }));
        },
        async resolveModel(modelId) {
          const model = (await load()).find((candidate) => candidate.id === modelId);
          const levels = Array.isArray(model?.effortLevels) ? model.effortLevels : [];
          return {
            id: modelId, name: model ? modelName(model) : modelId,
            ...(levels.length ? {
              reasoning: {
                efforts: levels.map((level) => ({ id: level, name: titleCase(level) })),
                defaultEffort: model.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : levels.includes('medium') ? 'medium' : levels[0],
              },
            } : {}),
          };
        },
        async start({ prompt, images, signal, onRecord, observedSubagents, onInput, onTasks, previous, ...options }) {
          const sessionOptions = await optionsFor({ ...options, signal, retained: previous?.backgroundActive });
          if (onTasks) sessionOptions.backgroundTasks = true;
          if (id === 'codex' && observedSubagents?.length) sessionOptions.observedSubagents = observedSubagents;
          return startOarRun({
            runtime, installation, sessionOptions, prompt, images, normalizer: normalizer({ name, login }),
            name, signal, queuesSteer, onRecord, observedSubagents, onInput, onTasks, previous,
          });
        },
        async compact(options) {
          const sessionOptions = await optionsFor(options);
          return compactOarSession({ runtime, installation, sessionOptions, name, signal: options.signal });
        },
      };
    },
  };
}
