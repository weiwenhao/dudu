import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { AsyncQueue, abortReason, deferred } from './async.mjs';
import { assertDirectory, harnessError, manualCompactionError } from './harness-bridge.mjs';
import { inclusiveUsage, usageDelta } from './usage.mjs';
import { OarResident } from './oar-resident.mjs';

// Claude Code and Codex are driven by OAR (@botiverse/oar). OAR starts the installed CLI, speaks its protocol, resumes
// sessions and lists models. What lives here is DSH's side of it: reading OAR's record stream as the steps the bridge
// replays, and the choices OAR leaves to its host (which tools a mode may use, which sandbox a mode gets).

// A harness's models are read from the harness itself: a process of its own, and for most of them a trip to the vendor's servers.
// What was read is served at once and read anew in the background once it is MODEL_TTL old; a harness that could not say is
// asked again after RETRY_MS. Only the very first ask waits, and then at most FIRST_WAIT_MS: DSH's model catalog waits for every
// harness at once, and one that cannot reach its servers takes about 24 s to give up (owner, 2026-11-24: the phone's catalog.get).
const MODEL_TTL = 5 * 60_000;
const RETRY_MS = 60_000;
const FIRST_WAIT_MS = 3_000;
// DSH's client keeps the first model catalog it gets until it hears `llm/models-updated` (or reconnects), so a list that is read after the
// answer it was given (the stand-in served to a first ask that ran out of patience, a new model) has to be announced (owner, 2026-11-24:
// Antigravity's menu stayed on "Default": agy 1.5.16 takes 11 s to list its models). Two lists are the same when their menus would be.
const modelsSignature = (models) => JSON.stringify(models.map((model) => [model.id, model.displayName, model.default === true, model.effortLevels ?? null, model.defaultEffort ?? null, model.resolvedId ?? null]));
// A tool result is kept in DSH's log with the conversation: past this many characters it is cut.
const MAX_OUTPUT = 256 * 1024;
// DSH durably stores the live stream. OAR only needs a bounded raw-payload tail
// while native background work keeps its process resident across turns.
const RETAINED_BYTES = 8 * 1024 * 1024;
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

  /** A native task can return control before its process exits; only runtimes with that evidence provide a result. */
  backgroundResult() { return undefined; }

  /**
   * True for a request of the harness to its host that OAR itself answers (the ACP runtimes' terminal and permission requests, a
   * Qwen permission check): it needs no one, so it does not end the turn. Claude and Codex have no such answer.
   */
  autoAnswered() { return false; }

  /** The turn the normalizer reported as ended continues: the harness took up a message that had been waiting. */
  reopen() { this.#finished = false; }

  feed(record) {
    const events = [];
    if (this.#finished) return events;
    if (record.kind === 'frame') this.#frame(record, events);
    else if (record.kind === 'request' && record.direction === 'toApp' && !this.autoAnswered(record)) this.#unanswerable(record, events);
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
        case 'tool_call_progress': {
          const call = this.#calls.get(event.callId);
          if (call && event.outputDelta) call.output = ((call.output ?? '') + event.outputDelta).slice(0, MAX_OUTPUT + 1);
          break;
        }
        case 'task_started': {
          const call = this.#calls.get(event.toolCallId);
          const result = call?.announced && this.backgroundResult(event, call, record);
          if (result) this.#end({ callId: event.toolCallId }, record, events, result);
          break;
        }
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

  #end(event, record, events, result) {
    const call = this.#calls.get(event.callId);
    if (!call) return;
    // A call that finished without any input after its start (an ACP tool with no arguments) is still a call.
    if (!call.announced) this.#announce(event.callId, this.inputOf({ callId: event.callId }), events, false);
    // A result means the message that made the call is over, even where the harness gave no sign of it.
    if (this.#inStep > 0) this.#closeStep(events);
    result ??= this.resultOf(event, call, record);
    if (typeof result.output === 'string' && result.output.length > MAX_OUTPUT) result.output = `${result.output.slice(0, MAX_OUTPUT)}\n… (output truncated)`;
    events.push({ type: 'tool-result', id: event.callId, ...result });
    this.#calls.delete(event.callId);
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
export async function compactOarSession({ runtime, installation, sessionOptions, name, signal, autoAnswered = () => false }) {
  if (signal?.aborted) throw abortReason(signal);
  let session;
  try { session = await runtime.session(installation, sessionOptions); }
  catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    if (error?.code === 'OAR_PROCESS_RECOVERY') throw harnessError('busy', 'HARNESS_BUSY');
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
      if (record.kind === 'request' && record.direction === 'toApp' && !autoAnswered(record)) {
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
export async function startOarRun({ runtime, installation, sessionOptions, prompt, images, normalizer, name, signal, queuesSteer = false, steering = true, followUpMs = FOLLOW_UP_MS, onRecord, observeSubagents, observedSubagents = [], onInput, onTasks, previous }) {
  if (signal?.aborted) throw signal.reason ?? harnessError('The request was aborted.', 'ABORTED');
  let session;
  let resident = previous?.resident;
  if (resident && (!resident.available || resident.closing)) resident = undefined;
  const reused = Boolean(resident);
  try {
    if (resident) {
      session = resident.session;
      resident.resumeTurn();
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
    if (error?.code === 'OAR_PROCESS_RECOVERY') throw harnessError('busy', 'HARNESS_BUSY');
    throw harnessError(`Could not start ${name}: ${error instanceof Error ? error.message : String(error)}`, 'HARNESS_UNAVAILABLE');
  }

  const events = new AsyncQueue();
  let foreground = true;
  const setForeground = (active) => {
    if (foreground === active) return;
    foreground = active;
    events.push({ type: 'foreground-state', active });
  };
  resident ??= new OarResident(session, {
    normalizer, observedSubagents, onRecord, onTasks, options: sessionOptions, team: observeSubagents?.(), followUpMs,
  });
  const hasWork = () => resident.hasChildren || resident.backgroundActive;
  let finished = false;
  // OAR answers a second `dispose()` at once, without waiting for the process: one disposal is kept, so that whoever
  // asks to close the run waits for the process that the end of the turn already started to stop.
  let disposal;
  const dispose = () => (disposal ??= resident.close());
  if (signal?.aborted) {
    if (reused && resident.retained) resident.finishTurn();
    else await dispose();
    throw abortReason(signal);
  }
  let unsubscribe = () => {};
  let stopping;
  let heldStep;
  let yieldedStep = false;
  const yieldForInput = () => {
    if (finished || !held || foreground || yieldedStep) return;
    // DSH claims next-step input only after the current adapter stream returns. Release this step, while
    // retaining the native turn/process for its background notifications and the next admitted input.
    events.push(heldStep ?? { type: 'step-end', reason: 'stop' });
    heldStep = undefined;
    yieldedStep = true;
  };
  async function close({ preserveBackground = false } = {}) {
    if (!finished) events.push({ type: 'turn-end', ok: false, error: harnessError('The turn was interrupted.', 'ABORTED') });
    finished = true;
    clearTimeout(holdTimer);
    signal?.removeEventListener('abort', onAbort);
    unsubscribe();
    events.close();
    if (preserveBackground && resident.retained) resident.finishTurn();
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
    if (event.ok && heldStep) events.push(heldStep);
    heldStep = undefined;
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
    // Native children and background commands can finish after the root's first answer. Keep both the process and
    // this DSH turn open so the native completion notification can start its follow-up on the same stream.
    if (held && waiting.size === 0 && !hasWork() && !holdTimer) holdTimer = setTimeout(release, followUpMs);
    if (held && hasWork()) { clearTimeout(holdTimer); holdTimer = undefined; }
    // Codex child threads may have an empty agentPath; their own sessionId still keeps their ends and text out of the parent.
    if (record.sessionId !== undefined && record.sessionId !== session.id) return;
    const seen = record.kind === 'frame' && (record.agentPath?.length ?? 0) === 0 ? record.body?.events ?? [] : [];
    const dropped = seen.find((event) => event.kind === 'input_dropped' && forwarded.has(event.inputId));
    if (dropped) {
      finish({ type: 'turn-end', ok: false, error: harnessError(`${name} did not take the message: ${dropped.message || dropped.reason}`, 'HARNESS_REJECTED') });
      return;
    }
    // The harness taking up a message that waited is the turn the held end was waiting for: whatever ended before that was another turn's.
    let taken = false;
    for (const event of seen) if (event.kind === 'user_message' && event.inputId && waiting.delete(event.inputId)) taken = true;
    if (held && (taken || seen.some((event) => ACTIVITY.has(event.kind) || (event.kind === 'turn_ended' && event.outcome?.kind !== 'completed'))
      || (record.kind === 'response' && record.body?.kind === 'exited'))) {
      clearTimeout(holdTimer);
      holdTimer = undefined;
      held = undefined;
      normalizer.reopen();
      setForeground(true);
      if (heldStep) events.push({ type: 'text-delta', text: '\n\n' });
      heldStep = undefined;
    }
    for (const event of normalizer.feed(record)) {
      // A tool-free final step also stops DSH's loop. Defer that boundary together with the root end while
      // native work runs, so DSH keeps its stop control and never reports a completed parent prematurely.
      if (event.type === 'step-end' && event.reason === 'stop' && hasWork()) { heldStep = event; continue; }
      if (event.type !== 'turn-end') { events.push(event); continue; }
      if (event.ok && (waiting.size > 0 || hasWork())) {
        held = event;
        yieldedStep = false;
        if (hasWork()) setForeground(false);
        clearTimeout(holdTimer);
        holdTimer = hasWork() ? undefined : setTimeout(release, followUpMs);
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
  async function deliver(content, options) {
    const delivered = await session.deliver(content, options);
    return delivered.landed === 'rejected'
      ? { kind: 'rejected', code: delivered.code, reason: delivered.reason }
      : delivered.result;
  }
  let outcome;
  try {
    // The prompt can wait behind a turn of the harness's own: a process kept for background work may have opened one, and a process resumed after
    // the last one was cut meets what that one left running (Claude answers the notice of a command that "didn't finish" at once, as a turn with
    // no model call, and only then takes the prompt up). Such a turn's end is not this turn's end: it is held until the harness shows it took the prompt up.
    if (reused || (queuesSteer && sessionOptions?.resume)) waiting.add(inputId);
    outcome = await submit(async () => {
      const options = { inputId, ...(images?.length ? { images } : {}) };
      if (!reused) return session.prompt(prompt, options);
      // A Monitor may have opened a native turn while DSH was idle. OAR owns delivery across that race.
      return deliver(prompt, options);
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
    team: resident.team,
    get backgroundActive() { return resident.retained; },
    nativeSessionId: session.id,
    events: drain(events),
    yieldForInput,
    // A DSH turn held for native background work can have an idle root. OAR owns the prompt/steer race there.
    async pushUserMessage(content, images, { onInput } = {}) {
      const continuing = Boolean(held) || hasWork();
      // Nothing is sent: `false` tells the bridge the message is still its own to send, as the next turn once this one ends.
      if (!continuing && (!steering || typeof session.steer !== 'function')) return false;
      const inputId = randomUUID();
      forwarded.add(inputId);
      if (queuesSteer || continuing) waiting.add(inputId);
      const outcome = await submit(() => {
        const options = { inputId, ...(images?.length ? { images } : {}) };
        return continuing ? deliver(content, options) : session.steer(content, options);
      }, onInput);
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
export function createOarProvider({ id, name, runtime, runtimeFor, installation: installationOf, binaryEnv, tools, fallbackTool, login, normalizer, fallbackModels, scrub, session: sessionFor, before, queuesSteer, steering = true, quota, childUsage, backgroundTasks = true, defaultEnabled = true }) {
  const known = new Set(tools.map((tool) => tool.name));
  const environment = (extra) => ({ ...scrubbedEnvironment(scrub.patterns, scrub), ...extra });

  return {
    id, name, route: id,
    /** Whether the harness is used once it is found, without anyone switching it on in Settings > Providers (providers/index.mjs). */
    defaultEnabled,
    /** The environment the harness runs in (an OAR overlay: `null` removes a name). */
    environment: () => environment(),

    /** What the settings page shows about the harness on this computer: OAR looks where each vendor installs it. */
    async probe({ override } = {}) {
      let snapshot;
      try { snapshot = await (installationOf ?? ((probe) => runtime.installation(probe)))(override ? { env: { [binaryEnv]: override } } : undefined); }
      catch (error) { return { state: 'broken', reason: error instanceof Error ? error.message : String(error) }; }
      if (snapshot.kind === 'available' && snapshot.via === 'executable') {
        return { state: 'ready', path: snapshot.command, version: text(snapshot.version).match(/\d+\.\d+\.\d+\S*/)?.[0] ?? text(snapshot.version), installation: snapshot };
      }
      if (snapshot.kind === 'unsupported') return { state: 'unsupported', reason: snapshot.reason };
      return { state: 'missing', reason: override ? `${override} is not an executable file.` : `${name} was not found.` };
    },

    create({ installation, modelsChanged }) {
      // A harness whose runtime depends on what was found (Pi: the command OAR launches) builds it from the detection.
      const active = runtimeFor ? runtimeFor(installation) : runtime;
      // `loaded` is the last answer: the harness's own list (`read`) or, until it gave one, the list the plugin knows (`fallbackModels`).
      let loaded;
      let loading;
      let generation = 0;
      // The list DSH was last given (`listModels`): a reading that ends with another one says so (`modelsChanged`).
      let handedOut;
      const readModels = () => {
        if (loading) return loading;
        const mine = generation;
        const run = (async () => {
          let models;
          try {
            const listed = await active.listModels(installation, { env: environment(), cwd: homedir(), timeoutMs: 30_000 });
            if (listed.kind === 'ok') models = listed.models.filter((model) => !model.disabled);
          } catch { /* the fallback below */ }
          // Settings changed while it was being read (a proxy, a path): this answer belongs to the old ones.
          if (mine !== generation) return;
          if (models?.length) loaded = { until: Date.now() + MODEL_TTL, models, read: true };
          // A harness that cannot say keeps what it said before.
          else loaded = { until: Date.now() + RETRY_MS, models: loaded?.read ? loaded.models : fallbackModels, read: loaded?.read === true };
          if (handedOut && modelsSignature(handedOut) !== modelsSignature(loaded.models)) {
            handedOut = loaded.models;
            try { modelsChanged?.(); } catch { /* DSH asks again on its own, sooner or later */ }
          }
        })().finally(() => { if (loading === run) loading = undefined; });
        loading = run;
        return run;
      };
      // `toDsh`: the answer goes to DSH, which keeps it (noted at the moment it is given, before a reading that ends right after can be compared with it).
      const load = async ({ toDsh = false } = {}) => {
        const give = (models) => { if (toDsh) handedOut = models; return models; };
        if (loaded && Date.now() < loaded.until) return give(loaded.models);
        const reading = readModels();
        // Stale, or given up on waiting for: say what is known, the new reading is there for the next ask.
        if (loaded) return give(loaded.models);
        // Nothing yet: wait for the first reading, but not all of it.
        let timer;
        const patience = new Promise((resolve) => { timer = setTimeout(resolve, FIRST_WAIT_MS); timer.unref?.(); });
        try { await Promise.race([reading, patience]); } finally { clearTimeout(timer); }
        // Out of patience: the plugin's own list stands in until the reading is done, and asks in the meantime do not wait again.
        loaded ??= { until: 0, models: fallbackModels, read: false };
        return give(loaded.models);
      };
      const optionsFor = async ({ resume, cwd, model, effort, permission, signal, retained }) => {
        if (signal?.aborted) throw abortReason(signal);
        await assertDirectory(cwd);
        if (!retained) await before?.({ resume });
        const specific = sessionFor({ permission, signal });
        return {
          cwd: cwd || homedir(),
          retainedBytes: RETAINED_BYTES,
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
        childUsage,
        configuration: typeof active.configuration === 'function'
          ? (options = {}) => active.configuration(installation, { ...options, env: environment() })
          : undefined,
        knowsTool: (toolName) => known.has(toolName),
        fallbackTool,
        /** What the harness offers may have changed (a new model, a login, a proxy): the list is read anew on the next ask, and until it is there the old one is served. */
        refreshModels() {
          generation += 1;
          loading = undefined;
          if (loaded) loaded = { ...loaded, until: 0 };
        },
        /** Starts reading the models now, in the background, so that the first menu that asks does not wait for them. */
        warmModels() { load().catch(() => {}); },
        /** How much of the account's plan is left, for the provider that can say (`quota({ command, environment, version, signal })`; see `providers/quota/`). */
        ...(typeof quota === 'function' ? { quota } : {}),
        async listModels() {
          const models = await load({ toDsh: true });
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
        async start({ prompt, images, signal, onRecord, observeSubagents, observedSubagents, onInput, onTasks, previous, hostTools, ...options }) {
          const sessionOptions = await optionsFor({ ...options, signal, retained: previous?.backgroundActive });
          // Tools the host serves to this session over MCP, and tools of the harness's own it takes away (providers/cron-tools.mjs). OAR does not remember them: every start gives them again.
          if (hostTools?.mcpServers?.length) sessionOptions.mcpServers = [...(sessionOptions.mcpServers ?? []), ...hostTools.mcpServers];
          if (hostTools?.env) sessionOptions.env = { ...sessionOptions.env, ...hostTools.env };
          if (hostTools?.disallowedTools?.length) sessionOptions.disallowedTools = [...new Set([...(sessionOptions.disallowedTools ?? []), ...hostTools.disallowedTools])];
          if (hostTools?.launchArgs?.length) sessionOptions.launchArgs = [...(sessionOptions.launchArgs ?? []), ...hostTools.launchArgs];
          // Only the harnesses whose OAR session reads background tasks (Claude, Codex) are asked for them.
          // Claude also needs its per-task stop declaration when only subagents are observed, without a job registry.
          if ((onTasks || observeSubagents) && backgroundTasks) sessionOptions.backgroundTasks = true;
          if (id === 'codex' && observedSubagents?.length) sessionOptions.observedSubagents = observedSubagents;
          return startOarRun({
            runtime: active, installation, sessionOptions, prompt, images, normalizer: normalizer({ name, login }),
            name, signal, queuesSteer, steering, onRecord, observeSubagents, observedSubagents, onInput, onTasks, previous,
          });
        },
        async compact(options) {
          const sessionOptions = await optionsFor(options);
          const reading = normalizer({ name, login });
          return compactOarSession({ runtime: active, installation, sessionOptions, name, signal: options.signal, autoAnswered: (record) => reading.autoAnswered(record) });
        },
      };
    },
  };
}
