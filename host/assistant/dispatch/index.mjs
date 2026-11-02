// 嘟嘟's dispatch: from what comes in to who does it (docs/assistant.md 1.2 steps 1-3, 3.1 "收进来", 3.2, 3.3).
//
//   const dispatch = createDispatch({ issues, connectors, collect, rules, llm, agents, now = Date.now, file, limits });
//
//   issues      createIssues(...): the only thing dispatch writes, besides its own file
//   connectors  createConnectors(...), or a function giving the current registry after a folder move. Dispatch only lists saved source prompts.
//   collect     async (source, { signal, since }) -> { outcome, content, chars? }. Reads through an isolated DSH collection session using
//               installed tools and skills; it never executes launch configuration from the source registry.
//   rules       () -> { rules: { 'TRIAGE.md': text | null, 'ASSIGN.md': text | null } } (memory.rules; sync or async), read on every call
//   llm         async (messages: [{ role: 'system' | 'user', content }], { signal }) -> string. The only way a model is used, one call per changed
//               output and one per assignment. Called with an AbortSignal that fires after 60 seconds (and when dispatch is disposed): a model
//               that does not answer by then is given up on whether or not it looks at the signal
//   agents      () -> [{ id: 'claude' | 'codex' | 'deepseek', name, enabled }] (sync or async): only an enabled one can be chosen
//   file        <state folder>/intake.json (state.mjs): what was read, what became an issue, today's counters
//   limits      { newPerRun 20, callsPerRun 5, modelMs 60 000, outputChars 12 000, openIssues 50, history 30, historyScan 200, tries 3 }
//
// Every operation answers { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', message?, next?, ... } and never throws for what a
// person, a connector or the model can cause; only a database failure of the issues store does, and then intake says so as an error.
//
//   intake({ only? })   async. Reads each saved prompt (only = an id or a list of ids) and turns what the owner has to deal with into issues.
//       Each source is collected once per run; unchanged output needs no triage call. A changed output is one model call:
//       the output (secrets blanked, capped) as marked
//       material, with the open issues, under TRIAGE.md; the answer is read strictly (answer.mjs). Then, per item:
//         new     -> an issue (Todo, source connector, sourceRef "<connector>:<ref>"), written as 嘟嘟, with the log of where it came from, why
//                    this priority and why this due date; never twice for the same "<connector>:<ref>"
//         update  -> a `note` in the log of that open issue (nothing else of it changes, not its priority and not its ask)
//         ignore  -> nothing
//       The priority is the model's if it gave one (Urgent only when TRIAGE.md has a rule for it), else the table of rules.mjs from impact and
//       effort. Everything the model wrote that goes into an issue passes the secrets redactor first.
//       At most 20 new issues and 5 model calls in a run: the rest waits for the next run and the result says so. One run at a time: a second
//       call while one runs is a no_op. An output whose answer was not usable (or only partly) is not marked as dealt with, so the next run asks
//       again; the same output answered unusably 3 times is let go.
//       -> { outcome, message, at, calls, created: [{ id, ref, title, connector, sourceRef, priority }], noted: [{ id, ref, connector, session, agent }],
//            connectors: [{ id, name, ok, error?, operations: [{ operation, label, status, ... }] }], skipped: [{ connector, operation, reason }], waiting }
//       An operation's status is read (a model call was made: items, created, noted, ignored, duplicates, deferred, rejected), unchanged, empty,
//       skipped, deferred or failed (error). waiting is null or { outputs, items }: what the next run still has to do.
//   assign(issueId)     async. Hands a Todo issue that has no agent to one, only with a selected or rule-specified project:
//       one model call over ASSIGN.md, the issue, the enabled agents and what
//       the agents handled before for the same kind of issue. A chosen agent -> issues.assign (as 嘟嘟, with the reason); the session only when
//       it is one that history offered and is free. -> { outcome: 'success', assigned: true, agent, session, reused, access, requested, allowed,
//       reason, issue }. `access` is for whoever starts the session: what the model asked for, never above what ASSIGN.md allows for this kind
//       (rules.mjs), read-only when it says nothing. No agent (the model is not sure, names one that is not available, or none is enabled) ->
//       { outcome: 'needs_clarification', assigned: false, ask, ... }: the issue stays Todo and its ask is "交给谁处理？". Already assigned, not
//       Todo, finished, unknown -> no_op. A model that fails or answers with something unusable -> error, and nothing changes.
//   state()             async. For the Inputs widget: { outcome, lastRunAt, running, connectors: [{ id, name, lastRead:
//       { at, ok, items, created, error? } | null, readToday, createdToday }], createdToday }. items and readToday count what the model found
//       in outputs that changed; the day's counters start again each local day.
//   dispose()           async. Stops what is running (the model call, the connector read) and waits for it; later calls are no_ops.
//
// Nothing here logs, and nothing that holds a secret is stored in an issue, in intake.json or in a result.
import { createHash } from 'node:crypto';
import { redact, findSecret } from '../memory/secrets.mjs';
import { parseAssign, parseTriage } from './answer.mjs';
import { assignMessages, triageMessages } from './prompts.mjs';
import { allowedAccess, grantAccess, sameKind, sessionOptions, tablePriority, urgentAllowed } from './rules.mjs';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { createIntakeState } from './state.mjs';
import { WORDS as W } from './words.mjs';

export const LIMITS = Object.freeze({ newPerRun: 20, callsPerRun: 5, modelMs: 60_000, outputChars: 12_000, openIssues: 50, history: 30, historyScan: 200, tries: 3 });

const OPEN = ['backlog', 'todo', 'in_progress', 'in_review'];
const BUSY_SESSION = ['running', 'waiting_owner', 'error'];

const clip = (text, max) => [...String(text ?? '')].slice(0, max).join('');
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
/** One line without a secret, at most `max` characters. */
const safe = (text, max = 300) => clip(redact(oneLine(clip(text, 4000))), max);
/** Text without a secret that keeps its line breaks. */
const safeText = (text, max) => clip(redact(String(text ?? '')), max);
const fingerprint = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const success = (extra) => ({ outcome: 'success', ...extra });
const noOp = (message, extra) => ({ outcome: 'no_op', message, ...extra });
const isFinished = (status) => status === 'done' || status === 'canceled';

// What a ref becomes when it holds a secret (a link with a token in it): a stand-in that is the same every time, so that it still tells
// messages apart. Blanking it would make every such message the same message.
const refOf = (ref) => (findSecret(ref) ? `ref-${fingerprint(ref).slice(0, 16)}` : ref);

class ModelError extends Error {}
class Stopped extends Error {}

export function createDispatch({ issues, connectors = null, collect = null, rules = null, llm = null, agents = null, now = Date.now, file, limits = {} } = {}) {
  if (!issues || typeof issues.add !== 'function') throw new TypeError('createDispatch needs the issues store.');
  if (typeof file !== 'string' || !file) throw new TypeError('createDispatch needs the file to keep the intake state in (intake.json).');
  const cap = { ...LIMITS, ...limits };
  const state = createIntakeState({ file, now, issues });
  const live = () => (typeof connectors === 'function' ? connectors() : connectors);
  const stop = new AbortController();
  const work = new Set(); // what is in flight, for dispose
  const assigning = new Set(); // issue ids
  let running = false;
  let disposed = false;

  const checkStop = () => {
    if (disposed) throw new Stopped(W.disposed);
  };
  const needsModel = (what) => ({ outcome: 'needs_clarification', message: W.needsModel(what), next: W.giveModel });

  // --- the model: one call, given up on after modelMs or when dispose says so
  async function ask(messages) {
    const timeout = AbortSignal.timeout(cap.modelMs);
    const signal = AbortSignal.any([stop.signal, timeout]);
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new ModelError(timeout.aborted ? W.modelTimeout(Number((cap.modelMs / 1000).toFixed(1))) : W.disposed));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(() => llm(messages, { signal })), aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
  const modelFailure = (error) => (error instanceof ModelError ? error.message : W.modelFailed(safe(error?.message, 160)));

  // --- the owner's rules and the agents
  async function readRules() {
    let got = null;
    try {
      got = typeof rules === 'function' ? await rules() : rules;
    } catch { /* no rules is how a missing file reads */ }
    const files = got?.rules ?? got ?? {};
    const text = (name) => (typeof files?.[name] === 'string' ? files[name] : null);
    return { triage: text('TRIAGE.md'), assign: text('ASSIGN.md') };
  }

  async function availableAgents() {
    let list = [];
    try {
      list = typeof agents === 'function' ? await agents() : agents;
    } catch { /* none */ }
    return (Array.isArray(list) ? list : [])
      .filter((agent) => agent && typeof agent.id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/i.test(agent.id) && agent.enabled === true)
      .map((agent) => ({ id: agent.id.toLowerCase(), name: oneLine(agent.name || agent.id).slice(0, 60) }));
  }

  // --- intake
  // The registry as the connectors library lists it: read only, the same list whoever asks.
  async function listViews() {
    try {
      const current = live();
      const listed = current?.dudu?.list ? await current.dudu.list() : await current?.owner?.list?.();
      return listed?.outcome === 'success' ? { views: listed.connectors } : { error: safe(listed?.message ?? W.cannotList) };
    } catch (error) {
      return { error: safe(error?.message ?? W.cannotList) };
    }
  }

  async function listConnectors() {
    const listed = await listViews();
    return listed.error ? listed : { views: listed.views };
  }

  const openIssues = () => {
    const page = issues.list({ tab: 'all', filter: { status: OPEN }, order: 'updated', limit: cap.openIssues });
    return page.outcome === 'success' ? page.items : [];
  };

  // The priority: the model's if it gave one, the table's otherwise. Urgent only where TRIAGE.md has a rule for it.
  function choosePriority(item, triage) {
    const table = tablePriority(item.impact, item.effort);
    if (item.priority === null || (item.priority === 'urgent' && !urgentAllowed(triage))) {
      return { priority: table ?? 'none', by: table ? 'table' : 'none', demoted: item.priority === 'urgent' };
    }
    return { priority: item.priority, by: 'model' };
  }

  function createIssue(view, entry, item, run) {
    const ref = refOf(item.ref);
    const refKey = `${view.id}:${ref}`;
    const chosen = choosePriority(item, run.triage);
    const added = issues.add({
      title: safe(item.title, 300), brief: safeText(item.brief, 4000), status: 'todo', priority: chosen.priority, impact: item.impact, effort: item.effort,
      kind: safe(item.kind, 100), project: item.project ? { name: safe(item.project, 200), path: null } : null, dueAt: item.dueAt,
      source: 'connector', sourceRef: refKey,
    }, { actor: 'dudu', reason: W.source(safe(view.name, 100), safe(entry.label, 160), safe(ref, 300)) });
    if (added.outcome !== 'success') return { problem: safe(added.message, 200) };
    const { issue } = added;
    const data = state.load();
    data.refs[refKey] = issue.id;
    state.save(); // at once: an issue that is not in the file would be made again by the next run
    const why = safe(item.reason, 500);
    issues.log(issue.id, {
      kind: 'priority', text: chosen.demoted ? `${why} ${W.urgentNeedsRule}` : why, actor: 'dudu',
      data: { from: 'none', to: chosen.priority, impact: item.impact, effort: item.effort, by: chosen.by, ...(chosen.demoted ? { asked: 'urgent' } : {}) },
    });
    if (item.dueAt != null) issues.log(issue.id, { kind: 'due', text: safe(item.dueReason || item.reason, 500), data: { from: null, to: item.dueAt }, actor: 'dudu' });
    return { created: { id: issue.id, ref: issue.ref, title: issue.title, connector: view.id, sourceRef: refKey, priority: chosen.priority } };
  }

  // What the model said of a message that has an open issue: one note in that issue's log, once.
  function noteIssue(view, item) {
    const got = issues.get(item.issueId, { logLimit: 30 });
    if (got.outcome !== 'success' || isFinished(got.issue.status)) return { problem: W.notOpen(item.issueId) };
    const refKey = `${view.id}:${refOf(item.ref)}`;
    const text = safeText(`${safe(view.name, 100)}: ${item.brief || item.title || item.reason}`, 4000);
    const digest = fingerprint(text).slice(0, 12);
    if (got.log.some((entry) => entry.kind === 'note' && entry.data?.ref === refKey && entry.data?.digest === digest)) return { duplicate: true };
    issues.log(item.issueId, { kind: 'note', text, data: { source: 'connector', ref: refKey, digest, reason: safe(item.reason, 500) }, actor: 'dudu' });
    return { noted: { id: got.issue.id, ref: got.issue.ref, connector: view.id, session: got.issue.session, agent: got.issue.agent } };
  }

  function applyItems(view, entry, parsed, run) {
    const done = {
      items: parsed.items.length + parsed.rejected.length, created: [], noted: [], ignored: 0, duplicates: 0, deferred: 0,
      rejected: parsed.rejected.map(({ index, ref, message }) => ({ index, ref: safe(ref, 40), message: safe(message, 200) })),
    };
    const data = state.load();
    for (const item of parsed.items) {
      checkStop();
      if (item.action === 'ignore') {
        done.ignored++;
      } else if (item.action === 'update') {
        const result = noteIssue(view, item);
        if (result.noted) done.noted.push(result.noted);
        else if (result.duplicate) done.duplicates++;
        else done.rejected.push({ index: item.index, ref: safe(item.ref, 40), message: result.problem });
      } else if (Object.hasOwn(data.refs, `${view.id}:${refOf(item.ref)}`)) {
        done.duplicates++;
      } else if (run.created.length >= cap.newPerRun) {
        done.deferred++;
        run.waiting.items++;
      } else {
        const result = createIssue(view, entry, item, run);
        if (result.created) {
          done.created.push(result.created);
          run.created.push(result.created);
        } else {
          done.rejected.push({ index: item.index, ref: safe(item.ref, 40), message: result.problem });
        }
      }
    }
    return done;
  }

  // An answer that was not usable counts against the output; after `tries` of them it is let go, so that a model that cannot answer
  // for one output is not paid for again and again.
  function countUnusable(key, hash, at) {
    const data = state.load();
    const n = (data.tries[key]?.hash === hash ? data.tries[key].n : 0) + 1;
    if (n >= cap.tries) {
      data.outputs[key] = { hash, at };
      delete data.tries[key];
      return true;
    }
    data.tries[key] = { hash, n };
    return false;
  }

  // One output of one operation: read it, and if it changed, ask the model and act on the answer. Returns { op, failed?, items, created }.
  async function processOutput(view, entry, run) {
    const op = { operation: entry.name, label: safe(entry.label, 160) };
    const failed = (error) => ({ op: { ...op, status: 'failed', error }, failed: error, items: 0, created: 0 });
    if (run.calls >= cap.callsPerRun || run.collections >= cap.callsPerRun) {
      run.waiting.outputs++;
      return { op: { ...op, status: 'deferred', reason: W.callLimit(cap.callsPerRun) }, deferred: true };
    }

    let read;
    try {
      if (!collect) throw new Error('The DSH collection service is unavailable.');
      run.collections++;
      const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(cap.modelMs * 2)]);
      read = await collect(view, { signal, since: state.load().reads[view.id]?.at });
    } catch (error) {
      read = { outcome: 'error', message: error?.message };
    }
    checkStop();
    if (read?.outcome !== 'success') return failed(safe(read?.message ?? W.readFailed, 300));
    const current = (await listViews()).views?.find((item) => item.id === view.id);
    if (!current || (current.prompt ?? current.description) !== (view.prompt ?? view.description)) return { op: { ...op, status: 'skipped' }, skipped: true };

    const key = `${view.id}/${entry.name}`;
    const content = clip(redact(String(read.content ?? '')), cap.outputChars);
    const hash = fingerprint(JSON.stringify([content, read.chars ?? null]));
    const data = state.load();
    const result = (extra) => ({ items: 0, created: 0, ...extra });
    if (data.outputs[key]?.hash === hash) return result({ op: { ...op, status: 'unchanged' } });
    if (!content.trim()) {
      data.outputs[key] = { hash, at: run.at };
      delete data.tries[key];
      state.save();
      return result({ op: { ...op, status: 'empty' } });
    }
    if (run.calls >= cap.callsPerRun) {
      run.waiting.outputs++;
      return result({ op: { ...op, status: 'deferred', reason: W.callLimit(cap.callsPerRun) }, deferred: true });
    }

    run.calls++;
    const open = openIssues();
    const messages = triageMessages({
      triage: run.triage, now: run.at, connector: view, operation: entry.label, output: content,
      openIssues: open.map(({ id, status, title, kind, sourceRef }) => ({ id, status, title, kind, ref: sourceRef })),
    });
    let reply;
    try {
      reply = await ask(messages);
    } catch (error) {
      if (stop.signal.aborted) throw new Stopped(W.disposed);
      return failed(modelFailure(error));
    }
    const parsed = parseTriage(reply, { openIds: new Set(open.map((issue) => issue.id)), now: run.at });
    if (!parsed.ok) {
      const letGo = countUnusable(key, hash, run.at);
      state.save();
      const error = W.unusable(parsed.message);
      return { op: { ...op, status: 'failed', error, ...(letGo ? { letGo: true } : {}) }, failed: error, items: 0, created: 0 };
    }

    const done = applyItems(view, entry, parsed, run);
    const problem = done.rejected.length > 0;
    let letGo = false;
    if (done.deferred === 0 && !problem) {
      data.outputs[key] = { hash, at: run.at };
      delete data.tries[key];
    } else if (problem) {
      letGo = countUnusable(key, hash, run.at);
    }
    state.save();
    const summary = { status: 'read', items: done.items, created: done.created.map((issue) => issue.id), noted: done.noted.map((issue) => issue.id), ignored: done.ignored, duplicates: done.duplicates, deferred: done.deferred, rejected: done.rejected, ...(letGo ? { letGo: true } : {}) };
    return {
      op: { ...op, ...summary }, items: done.items, created: done.created.length, noted: done.noted,
      failed: problem ? W.someUnusable(done.rejected.length) : null,
    };
  }

  async function runIntake(only, run) {
    const found = await listConnectors();
    if (found.error) return { outcome: 'error', message: found.error };
    const chosen = found.views.filter((view) => !only || only.has(view.id));
    if (!chosen.length) return noOp(only ? W.noSuchConnector([...only]) : 'No source prompts have been saved.');

    run.triage = (await readRules()).triage;
    const reports = [];
    const skipped = [];
    const counts = { unchanged: 0, failed: 0, deferred: 0 };
    const data = state.load();

    for (const view of chosen) {
      checkStop();
      const report = { id: view.id, name: view.name, ok: true, operations: [] };
      const sum = { attempted: 0, items: 0, created: 0, error: null };
      const operations = [{ name: 'source', label: view.name }];
      if (!operations.length && view.error) { // a server that cannot be reached is a read that failed: nobody would notice otherwise
        sum.attempted++;
        sum.error = safe(view.error, 300);
      }
      for (const entry of operations) {
        checkStop();
        const result = await processOutput(view, entry, run);
        report.operations.push(result.op);
        if (result.skipped) {
          skipped.push({ connector: view.id, operation: entry.name, reason: result.op.reason });
          continue;
        }
        if (result.deferred) {
          counts.deferred++;
          continue;
        }
        sum.attempted++;
        sum.items += result.items;
        sum.created += result.created;
        run.noted.push(...(result.noted ?? []));
        if (result.op.status === 'unchanged') counts.unchanged++;
        if (result.failed) {
          counts.failed++;
          sum.error ??= result.failed;
        }
      }
      if (sum.error) {
        report.ok = false;
        report.error = sum.error;
      }
      if (sum.attempted) {
        run.attempted += sum.attempted;
        data.reads[view.id] = { at: now(), ok: !sum.error, items: sum.items, created: sum.created, ...(sum.error ? { error: sum.error } : {}) };
        const day = state.today(run.at);
        const was = day.connectors[view.id] ?? { read: 0, created: 0 };
        day.connectors[view.id] = { read: was.read + sum.items, created: was.created + sum.created };
        state.save();
      }
      reports.push(report);
    }

    if (!run.attempted) return noOp(W.nothingToRead, { skipped, connectors: reports });
    data.lastRunAt = now();
    state.save();
    const waiting = run.waiting.outputs || run.waiting.items ? { ...run.waiting } : null;
    return success({
      message: W.summary({ created: run.created.length, noted: run.noted.length, ...counts, skipped: skipped.length, waiting }),
      at: run.at, calls: run.calls, created: run.created, noted: run.noted, connectors: reports, skipped, waiting,
    });
  }

  async function intake(input) {
    if (disposed) return noOp(W.disposed);
    if (typeof llm !== 'function') return needsModel('Intake');
    if (!live()) return noOp(W.noConnectors);
    if (running) return noOp(W.busy);
    const only = input?.only == null ? null : new Set([].concat(input.only).map(String));
    running = true;
    const run = { at: now(), calls: 0, collections: 0, attempted: 0, created: [], noted: [], waiting: { outputs: 0, items: 0 }, triage: null };
    const job = runIntake(only, run).catch((error) => {
      if (error instanceof Stopped) return noOp(W.disposed);
      // What was done before the failure stays done, and is said.
      return { outcome: 'error', message: W.failed(safe(error?.message, 200)), next: W.tryAgain, created: run.created, noted: run.noted };
    });
    work.add(job);
    try {
      return await job;
    } finally {
      work.delete(job);
      running = false;
    }
  }

  // --- assignment

  // What the agents handled before, for the kinds of issue they handled: one entry per kind, agent and session, the sessions that can take
  // another issue now (not the session of an issue that is open, not one that is working, waiting for the owner or failed), the kind of
  // this issue first.
  function historyFor(issue, available) {
    const ids = available.map((agent) => agent.id);
    const page = issues.list({ tab: 'all', filter: { agent: ids }, order: 'updated', limit: cap.historyScan });
    if (page.outcome !== 'success') return [];
    const held = new Set(page.items.filter((past) => !isFinished(past.status) && past.session).map((past) => past.session));
    const groups = new Map();
    for (const past of page.items) {
      if (past.id === issue.id || !past.kind || past.project?.path !== issue.project?.path) continue;
      const full = issues.get(past.id, { logLimit: 1 });
      if (full.outcome !== 'success') continue;
      for (const session of full.issue.sessions) {
        const agent = session.agent || past.agent;
        if (!ids.includes(agent)) continue;
        const key = `${past.kind.trim().toLowerCase()}|${agent}|${session.key}`;
        const group = groups.get(key) ?? { kind: past.kind, agent, session: session.key, lastUsedAt: 0, issues: new Set(), busy: held.has(session.key) };
        group.lastUsedAt = Math.max(group.lastUsedAt, session.openedAt, session.closedAt ?? 0);
        group.issues.add(past.id);
        group.busy ||= BUSY_SESSION.includes(session.state);
        groups.set(key, group);
      }
    }
    const same = (group) => (sameKind(group.kind, issue.kind) ? 0 : 1);
    return [...groups.values()].filter((group) => !group.busy)
      .sort((a, b) => same(a) - same(b) || b.lastUsedAt - a.lastUsedAt)
      .slice(0, cap.history)
      .map((group) => ({ kind: group.kind, agent: group.agent, session: group.session, lastUsedAt: group.lastUsedAt, issues: group.issues.size }));
  }

  const latest = (id) => {
    const got = issues.get(id, { logLimit: 1 });
    return got.outcome === 'success' ? got.issue : null;
  };

  // Nobody is chosen: the issue stays in Todo and asks the owner (3.3).
  function leaveToOwner(issue, why) {
    const reason = safe(why, 500);
    if (!issue.ask) issues.update(issue.id, { ask: W.whoShouldTake }, { actor: 'dudu', reason });
    if (issue.ask !== W.whoShouldTake) issues.log(issue.id, { kind: 'note', text: W.notAssigned(reason), actor: 'dudu' });
    return {
      outcome: 'needs_clarification', assigned: false, ask: issue.ask || W.whoShouldTake, reason, message: W.notAssignedMessage(issue.ref, reason),
      next: W.ownerDecides, issue: latest(issue.id) ?? issue,
    };
  }

  async function decide(issue) {
    const originalProject = issue.project?.path ?? null;
    const available = await availableAgents();
    const files = await readRules();
    const options = sessionOptions(files.assign, issue, { home: homedir() });
    const project = issue.project?.path ? issue.project : options.cwd ? { name: basename(options.cwd), path: options.cwd } : null;
    if (options.problem || !project) return leaveToOwner(issue, options.problem ?? '请先选择项目，再分配智能体。');
    issue = { ...issue, project };
    let choice = { agent: null, session: null, access: null, reason: W.noAgentOn };
    let history = [];
    if (available.length) {
      history = issue.kind ? historyFor(issue, available) : [];
      let reply;
      try {
        reply = await ask(assignMessages({ assign: files.assign, issue, agents: available, history }));
      } catch (error) {
        if (stop.signal.aborted) throw new Stopped(W.disposed);
        return { outcome: 'error', message: modelFailure(error), next: W.untouched, issue };
      }
      choice = parseAssign(reply);
      if (!choice.ok) return { outcome: 'error', message: W.unusable(choice.message), next: W.untouched, issue };
    }

    const again = latest(issue.id); // the owner may have given it to someone while the model thought
    if (!again || again.agent || again.status !== 'todo' || (again.project?.path ?? null) !== originalProject) return noOp(W.changedMeanwhile(issue.ref), { issue: again ?? issue });
    if (choice.agent === null) return leaveToOwner(again, choice.reason);
    if (!available.some((agent) => agent.id === choice.agent)) return leaveToOwner(again, W.unavailable(safe(choice.agent, 40), choice.reason));

    // A session is continued only if history offered it for this agent; anything else the model wrote is a new session.
    const offered = choice.session ? history.find((entry) => entry.session === choice.session && entry.agent === choice.agent) : null;
    const session = offered ? offered.session : null;
    const allowed = allowedAccess(files.assign, again);
    const access = grantAccess(choice.access, allowed);
    const reason = safe(choice.reason, 500);
    const notes = [choice.session && !offered ? W.sessionDropped : null, W.access(access, choice.access, allowed)].filter(Boolean);
    const assigned = issues.assign(again.id, { agent: choice.agent, session, project: again.project?.path ? again.project : project, actor: 'dudu', reason: `${reason} · ${notes.join(' · ')}` });
    if (assigned.outcome !== 'success') return { outcome: assigned.outcome, message: safe(assigned.message, 300), issue: assigned.issue ?? again };
    if (again.ask === W.whoShouldTake) issues.update(again.id, { ask: '' }, { actor: 'dudu' });
    return success({
      assigned: true, agent: choice.agent, session, reused: session !== null, access, requested: choice.access, allowed, reason,
      message: W.assigned(again.ref, choice.agent, session, access), issue: latest(again.id) ?? assigned.issue,
    });
  }

  async function assign(rawId) {
    if (disposed) return noOp(W.disposed);
    const got = issues.get(rawId, { logLimit: 1 });
    if (got.outcome !== 'success') return noOp(safe(got.message, 200));
    const { issue } = got;
    if (isFinished(issue.status)) return noOp(W.finished(issue.ref, issue.status), { issue });
    if (issue.agent) return noOp(W.hasAgent(issue.ref, issue.agent), { issue });
    if (issue.status !== 'todo') return noOp(W.notTodo(issue.ref, issue.status), { issue });
    if (typeof llm !== 'function') return needsModel('Assigning');
    if (assigning.has(issue.id)) return noOp(W.assigning(issue.ref), { issue });
    assigning.add(issue.id);
    const job = decide(issue).catch((error) => {
      if (error instanceof Stopped) return noOp(W.disposed, { issue });
      return { outcome: 'error', message: W.failed(safe(error?.message, 200)), next: W.tryAgain, issue };
    });
    work.add(job);
    try {
      return await job;
    } finally {
      work.delete(job);
      assigning.delete(issue.id);
    }
  }

  // --- what the Inputs widget shows
  async function stateOf() {
    const data = state.load();
    const today = state.peekToday(now());
    let views = [];
    let problem = null;
    if (live()) {
      const listed = await listViews();
      if (listed.error) problem = listed.error;
      else views = listed.views;
    }
    const rows = views.map((view) => {
      const last = data.reads[view.id];
      const counters = today.connectors[view.id];
      return {
        id: view.id, name: view.name,
        lastRead: last ? { at: last.at, ok: last.ok, items: last.items, created: last.created, ...(last.error ? { error: last.error } : {}) } : null,
        readToday: counters?.read ?? 0, createdToday: counters?.created ?? 0,
      };
    });
    const createdToday = Object.values(today.connectors).reduce((sum, entry) => sum + entry.created, 0);
    return { outcome: problem ? 'error' : 'success', ...(problem ? { message: problem } : {}), lastRunAt: data.lastRunAt, running, connectors: rows, createdToday };
  }

  async function dispose() {
    disposed = true;
    stop.abort(new Stopped(W.disposed));
    await Promise.allSettled([...work]);
  }

  return { intake, assign, state: stateOf, dispose };
}
