// 嘟嘟's dispatch: from what comes in to who does it (docs/assistant.md 1.2, 3.1 "收进来", 3.3).
//
//   const dispatch = createDispatch({ issues, collectors, collect, onCollected, acknowledge, rules, llm, agents, now = Date.now, file, limits });
//
//   issues      createIssues(...): the inbox of collected records lives in it, and the issues that `assign` hands out
//   collectors  createCollectors(...), or a function giving the current registry after a folder move. Dispatch only lists them, each with the
//               connector it reads through (`via`: { id, name, kind, prompt, server } | null).
//   collect     async (collector, { signal, since, submit }) -> { outcome, records }. Reads through an isolated DSH collection session using
//               installed tools and skills (or the one MCP server of an MCP connector); it never executes launch configuration from a registry.
//               The session submits raw records with submit(records); it returns a receipt only after validation and database commit.
//   onCollected (collector, records) -> void. Live notification of successfully stored new/changed records, using the current collector settings.
//   acknowledge (collector, raw, stored, { signal }) -> receipt. Optional source acknowledgement after commit; its failure does not undo storage.
//   rules       () -> { rules: { 'ASSIGN.md': text | null } } (memory.rules; sync or async), read on every call
//   llm         async (messages: [{ role: 'system' | 'user', content }], { signal }) -> string. Used by `assign` only, one call per assignment. Called
//               with an AbortSignal that fires after 60 seconds (and when dispatch is disposed): a model that does not answer by then is given up on
//               whether or not it looks at the signal. Collecting never asks a model (the collection session is the collector's own)
//   agents      () -> [{ id: 'claude' | 'codex' | 'deepseek', name, enabled }] (sync or async): only an enabled one can be chosen
//   file        <state folder>/intake.json (state.mjs): today's counters
//   limits      { collectionsPerRun 5, modelMs 60 000, collectMs 600 000, history 30, historyScan 200 }
//
// Every operation answers { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', message?, next?, ... } and never throws for what a
// person, a connector or the model can cause; only a database failure of the issues store does, and then intake says so as an error.
//
//   intake({ only? })   async. Runs each collector (only = an id or a list of ids) and keeps what it brought in the inbox (issues.inbox), and
//       NOTHING ELSE (owner, 2026-11-05: "去掉嘟嘟的 issue 创建规则，现在他都创建不对，我不需要他创建了", then "只要收集好信息就好了，不需要嘟嘟处理任何东西"): no
//       issue is made, nothing is judged, nothing is put aside, no model is asked. The owner reads the records in the Collector widget and shares them to
//       an issue or a session, or makes an issue of them. Per collector: collect; check and store the records (one row per source id and
//       version, so a record that is stored already is not stored again).
//       One run at a time: a second call while one runs is a no_op.
//       -> { outcome, message, at, created: [], noted: [], collectors: [{ id, name, ok, error?, operations: [{ operation, label, status, ... }] }],
//            skipped: [{ connector, operation, reason }], waiting }
//       (`created` and `noted` are always empty: they stay so that a caller written before intake stopped making issues keeps working.
//       `connector` in a record's own fields is the id of the collector it came from: the name stayed when the two were told apart.)
//       An operation's status is read (records were stored: added, seen, notCollected, dropped), unchanged (nothing new), empty, skipped,
//       deferred or failed (error). waiting is null or { outputs }.
//   assign(issueId)     async. Hands a Todo issue that has no agent to one, only with a selected or rule-specified project:
//       one model call over ASSIGN.md, the issue, the enabled agents and what
//       the agents handled before for the same kind of issue. A chosen agent -> issues.assign (as 嘟嘟, with the reason), always with a fresh
//       session. -> { outcome: 'success', assigned: true, agent, session: null, reused: false, access, requested, allowed,
//       reason, issue }. `access` is for whoever starts the session: what the model asked for, never above what ASSIGN.md allows for this kind
//       (rules.mjs), read-only when it says nothing. No agent (the model is not sure, names one that is not available, or none is enabled) ->
//       { outcome: 'needs_clarification', assigned: false, ask, ... }: the issue stays Todo and its ask is "交给谁处理？". Already assigned, not
//       Todo, finished, unknown -> no_op. A model that fails or answers with something unusable -> error, and nothing changes.
//   state()             async. For the settings page: { outcome, lastRunAt, running, collectors: [{ id, name, lastRead:
//       { at, ok, items, created, error? } | null, readToday, createdToday }], createdToday }. lastRead is the last finished row of collect_runs;
//       items and readToday count the records that were new; the day's counters start again each local day.
//   dispose()           async. Stops what is running (the model call, the collection) and waits for it; later calls are no_ops.
//
// Nothing here logs, and nothing that holds a secret is stored in an issue, in intake.json or in a result.
import { redact } from '../memory/secrets.mjs';
import { normalizeRecords } from '../inbox/records.mjs';
import { checkCollectorResult } from '../inbox/submission.mjs';
import { parseAssign } from './answer.mjs';
import { assignMessages } from './prompts.mjs';
import { allowedAccess, grantAccess, sameKind, sessionOptions } from './rules.mjs';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { createIntakeState } from './state.mjs';
import { WORDS as W } from './words.mjs';

export const LIMITS = Object.freeze({ collectionsPerRun: 5, modelMs: 60_000, collectMs: 600_000, history: 30, historyScan: 200 });

const clip = (text, max) => [...String(text ?? '')].slice(0, max).join('');
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
/** One line without a secret, at most `max` characters. */
const safe = (text, max = 300) => clip(redact(oneLine(clip(text, 4000))), max);
const success = (extra) => ({ outcome: 'success', ...extra });
const noOp = (message, extra) => ({ outcome: 'no_op', message, ...extra });
const isFinished = (status) => status === 'done' || status === 'canceled';

class ModelError extends Error {}
class Stopped extends Error {}

export function createDispatch({ issues, collectors = null, collect = null, onCollected = null, acknowledge = null, rules = null, llm = null, agents = null, now = Date.now, file, limits = {} } = {}) {
  if (!issues || typeof issues.add !== 'function' || !issues.inbox) throw new TypeError('createDispatch needs the issues store, with its inbox.');
  const { inbox } = issues;
  if (typeof file !== 'string' || !file) throw new TypeError('createDispatch needs the file to keep the intake state in (intake.json).');
  const cap = { ...LIMITS, ...limits };
  const state = createIntakeState({ file, now, issues });
  const live = () => (typeof collectors === 'function' ? collectors() : collectors);
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
    return { assign: text('ASSIGN.md') };
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
  // The collectors as their registry resolves them, each with the connector it reads through: read only, the same list whoever asks.
  async function listViews() {
    try {
      const current = live();
      const listed = current?.resolve ? await current.resolve() : await current?.owner?.list?.();
      return listed?.outcome === 'success' ? { views: listed.collectors } : { error: safe(listed?.message ?? W.cannotList) };
    } catch (error) {
      return { error: safe(error?.message ?? W.cannotList) };
    }
  }

  const sourceKey = (view) => JSON.stringify([
    view.prompt ?? view.description, view.connector,
    view.via?.id, view.via?.kind, view.via?.prompt, view.via?.server, view.via?.spec, view.via?.via,
  ]);

  /** A write capability bound to one run or one context request, never an arbitrary collector or row supplied by the model. */
  function submissionFor(view, { signal, runId = null, recordId = null }) {
    let active = true;
    let saved = null;
    let tail = Promise.resolve();
    const submit = (raw) => {
      const job = tail.then(async () => {
        const stopped = () => !active || disposed || signal.aborted;
        if (stopped()) return { ok: false, code: 'collection_stopped' };
        if (saved) return saved.receipt;
        const checked = checkCollectorResult({ ok: true, records: raw });
        if (!checked.ok) return checked;
        const normalized = normalizeRecords(checked.value.records, { now });
        if (normalized.rejected.length || normalized.dropped) return {
          ok: false, code: 'invalid_records',
          errors: normalized.rejected.map(({ index, message }) => ({ path: `records.${index}`, message })),
          dropped: normalized.dropped,
        };
        const current = (await listViews()).views?.find((item) => item.id === view.id);
        if (!current || sourceKey(current) !== sourceKey(view)) return { ok: false, code: 'collector_changed', message: W.readFailed };
        if (stopped()) return { ok: false, code: 'collection_stopped' };

        if (recordId !== null) {
          const target = inbox.get(recordId)?.record;
          // addContext's compatibility matching must not let a tool import another thread into the selected row.
          if (!target || target.connector !== view.id || normalized.records.length !== 1 ||
              normalized.records[0].update || normalized.records[0].sourceId !== target.sourceId) {
            return { ok: false, code: 'wrong_record', message: 'Submit context for the requested source item or thread only.' };
          }
          const result = inbox.addContext(recordId, normalized.records);
          if (result.outcome !== 'success') return { ok: false, code: result.code, message: result.message };
          saved = { result, receipt: { ok: true, recordIds: [recordId], added: result.added } };
          return saved.receipt;
        }

        // ingest is transactional. Nothing is acknowledged or notified until its COMMIT has returned.
        const stored = inbox.ingest(view.id, normalized.records, { runId });
        const fresh = [...stored.added, ...stored.updated];
        const receipt = {
          ok: true, runId, recordIds: [...new Set(fresh.map((record) => record.id))],
          added: stored.added.length, updated: stored.updated.length, seen: stored.seen,
          unmatched: stored.missed, duplicates: normalized.duplicates, truncated: normalized.truncated,
        };
        saved = { stored, normalized, empty: raw.length === 0, receipt };
        if (fresh.length && onCollected) {
          try { onCollected(current, fresh); }
          catch { /* A failed notification does not undo storage. */ }
        }
        if (fresh.length && acknowledge) {
          try { receipt.acknowledgement = await acknowledge(current, checked.value.records, fresh, { signal }); }
          catch { receipt.acknowledgement = { ok: false }; }
        }
        return receipt;
      });
      tail = job.catch(() => {});
      return job;
    };
    return { submit, close: () => { active = false; }, get saved() { return saved; } };
  }

  // One collector: collect it and keep what came back, and nothing else: the owner reads the records in the Collector widget and decides what to do with
  // each. Returns { op, failed?, items, added }.
  async function processCollector(view, run) {
    const op = { operation: 'source', label: safe(view.name, 160) };
    const failed = (error, extra = {}) => ({ op: { ...op, status: 'failed', error, ...extra }, failed: error, items: 0 });
    if (run.collections >= cap.collectionsPerRun) {
      run.waiting.outputs++;
      return { op: { ...op, status: 'deferred', reason: W.callLimit(cap.collectionsPerRun) }, deferred: true };
    }

    const runId = inbox.startRun(view.id, run.at);
    const end = (fields) => inbox.finishRun(runId, fields);
    let read;
    // A collection is a session that works with the owner's own tools (a command-line client, a skill), a step at a time: it is given ten minutes.
    const timeout = AbortSignal.timeout(cap.collectMs);
    const signal = AbortSignal.any([stop.signal, timeout]);
    const submission = submissionFor(view, { signal, runId });
    try {
      if (!collect) throw new Error('The DSH collection service is unavailable.');
      if (!view.via && view.via !== undefined) throw new Error(W.noConnector);
      run.collections++;
      read = await collect(view, { signal, since: inbox.lastGood(view.id)?.startedAt ?? null, submit: submission.submit });
    } catch (error) {
      read = { outcome: 'error', message: timeout.aborted ? W.collectTimeout(Math.round(cap.collectMs / 60_000)) : error?.message };
    } finally {
      submission.close();
    }
    const { saved } = submission;
    const counts = saved ? { added: saved.stored.added.length + saved.stored.updated.length, seen: saved.stored.seen } : {};
    if (disposed) {
      end({ ok: false, ...counts, error: W.disposed });
      throw new Stopped(W.disposed);
    }
    if (read?.outcome !== 'success' || !saved) {
      const error = safe(read?.message ?? W.readFailed, 300);
      // A model that fails after submitting cannot undo the commit. Keep its counts, but do not advance lastGood/since.
      end({ ok: false, ...counts, error });
      return { ...failed(error), items: counts.added ?? 0, added: counts.added ?? 0 };
    }
    const current = (await listViews()).views?.find((item) => item.id === view.id);
    if (!current || sourceKey(current) !== sourceKey(view)) {
      end({ ok: false, ...counts, error: W.readFailed });
      return { ...failed(W.readFailed), items: counts.added ?? 0, added: counts.added ?? 0 };
    }

    const { stored } = saved;
    // A conversation that went on in a row that was waiting is something new as much as a row that is added, and so is a row the collector changed (`update`: an alert that is over).
    const fresh = stored.added.length + stored.updated.length;

    const empty = saved.empty;
    const unchanged = !empty && fresh === 0;
    const summary = {
      status: empty ? 'empty' : unchanged ? 'unchanged' : 'read',
      added: fresh, seen: stored.seen,
      ...(stored.updated.length ? { updated: stored.updated.length } : {}),
      ...(stored.missed ? { unmatched: stored.missed } : {}),
    };
    end({ ok: true, added: fresh, seen: stored.seen, rejected: 0, created: 0, error: null });
    return { op: { ...op, ...summary }, items: fresh, added: fresh };
  }

  /**
   * The owner asked for more of one record's context (the Collector's button): the session of the collector that brought it reads the conversation around it, and what it read is put in that
   * record (inbox.addContext). It is no collection: no run is kept and the time of the last good collection, which the next one reads from, does not move.
   */
  async function complete({ id } = {}) {
    if (disposed) return { outcome: 'error', message: W.disposed };
    if (!collect?.fill) return { outcome: 'error', message: 'The DSH collection service is unavailable.' };
    const got = inbox.get(id);
    if (!got?.record) return { outcome: 'needs_clarification', code: 'unknown_record', message: 'There is no record with that number.' };
    const found = await listViews();
    if (found.error) return { outcome: 'error', message: found.error };
    const view = found.views.find((item) => item.id === got.record.connector);
    if (!view) return { outcome: 'needs_clarification', code: 'no_collector', message: 'The collector that brought this record is no longer saved.' };
    if (!view.via && view.via !== undefined) return { outcome: 'error', message: W.noConnector };
    const timeout = AbortSignal.timeout(cap.collectMs);
    const signal = AbortSignal.any([stop.signal, timeout]);
    const submission = submissionFor(view, { signal, recordId: got.record.id });
    let read;
    try {
      read = await collect.fill(view, got.record, { signal, submit: submission.submit });
    } catch (error) {
      read = { outcome: 'error', message: timeout.aborted ? W.collectTimeout(Math.round(cap.collectMs / 60_000)) : error?.message };
    } finally {
      submission.close();
    }
    if (disposed) return { outcome: 'error', message: W.disposed };
    if (read?.outcome !== 'success') return { outcome: 'error', message: safe(read?.message ?? W.readFailed, 300) };
    return submission.saved?.result ?? { outcome: 'error', message: W.readFailed };
  }

  async function runIntake(only, run) {
    const found = await listViews();
    if (found.error) return { outcome: 'error', message: found.error };
    const chosen = found.views.filter((view) => !only || only.has(view.id));
    if (!chosen.length) return noOp(only ? W.noSuchCollector([...only]) : 'No collectors have been saved.');

    const reports = [];
    const skipped = [];
    const counts = { unchanged: 0, failed: 0, deferred: 0 };
    const data = state.load();

    for (const view of chosen) {
      checkStop();
      const report = { id: view.id, name: view.name, ok: true, operations: [] };
      const result = await processCollector(view, run);
      report.operations.push(result.op);
      if (result.skipped) {
        skipped.push({ connector: view.id, operation: result.op.operation, reason: result.op.reason });
        reports.push(report);
        continue;
      }
      if (result.deferred) {
        counts.deferred++;
        reports.push(report);
        continue;
      }
      run.attempted++;
      run.added += result.added ?? 0;
      if (result.op.status === 'unchanged') counts.unchanged++;
      if (result.failed) {
        counts.failed++;
        report.ok = false;
        report.error = result.failed;
      }
      const day = state.today(run.at);
      const was = day.connectors[view.id] ?? { read: 0, created: 0 };
      day.connectors[view.id] = { read: was.read + result.items, created: was.created };
      state.save();
      reports.push(report);
    }

    if (!run.attempted) return noOp(W.nothingToRead, { skipped, collectors: reports });
    data.lastRunAt = now();
    state.save();
    const waiting = run.waiting.outputs ? { outputs: run.waiting.outputs } : null;
    return success({
      message: W.summary({ added: run.added, ...counts, skipped: skipped.length, waiting }),
      at: run.at, created: [], noted: [], collectors: reports, skipped, waiting,
    });
  }

  async function intake(input) {
    if (disposed) return noOp(W.disposed);
    if (!live()) return noOp(W.noCollectors);
    if (running) return noOp(W.busy);
    const only = input?.only == null ? null : new Set([].concat(input.only).map(String));
    running = true;
    const run = { at: now(), collections: 0, attempted: 0, added: 0, waiting: { outputs: 0 } };
    const job = runIntake(only, run).catch((error) => {
      if (error instanceof Stopped) return noOp(W.disposed);
      // What was done before the failure stays done, and is said.
      return { outcome: 'error', message: W.failed(safe(error?.message, 200)), next: W.tryAgain, created: [], noted: [] };
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

  // Agent experience in this project, one entry per kind and agent, this issue's kind first. Session identities are never offered:
  // each new issue gets its own conversation even when the same agent handled similar work before.
  function historyFor(issue, available) {
    const ids = available.map((agent) => agent.id);
    const page = issues.list({ tab: 'all', filter: { agent: ids }, order: 'updated', limit: cap.historyScan });
    if (page.outcome !== 'success') return [];
    const groups = new Map();
    for (const past of page.items) {
      if (past.id === issue.id || !past.kind || past.project?.path !== issue.project?.path) continue;
      const full = issues.get(past.id, { logLimit: 1 });
      if (full.outcome !== 'success') continue;
      for (const session of full.issue.sessions) {
        const agent = session.agent || past.agent;
        if (!ids.includes(agent)) continue;
        const key = `${past.kind.trim().toLowerCase()}|${agent}`;
        const group = groups.get(key) ?? { kind: past.kind, agent, lastUsedAt: 0, issues: new Set() };
        group.lastUsedAt = Math.max(group.lastUsedAt, session.openedAt, session.closedAt ?? 0);
        group.issues.add(past.id);
        groups.set(key, group);
      }
    }
    const same = (group) => (sameKind(group.kind, issue.kind) ? 0 : 1);
    return [...groups.values()]
      .sort((a, b) => same(a) - same(b) || b.lastUsedAt - a.lastUsedAt)
      .slice(0, cap.history)
      .map((group) => ({ kind: group.kind, agent: group.agent, lastUsedAt: group.lastUsedAt, issues: group.issues.size }));
  }

  const latest = (id) => {
    const got = issues.get(id, { logLimit: 1 });
    return got.outcome === 'success' ? got.issue : null;
  };

  // Nobody is chosen: the issue stays in Todo and asks the owner (3.3).
  function leaveToOwner(issue, why) {
    const reason = safe(why, 500);
    if (!issue.ask) issues.update(issue.id, { ask: W.whoShouldTake }, { actor: 'dudu', reason });
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
    if (available.length) {
      const history = issue.kind ? historyFor(issue, available) : [];
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
    if (!again || again.agent || (again.statusType ?? again.status) !== 'todo' || (again.project?.path ?? null) !== originalProject) return noOp(W.changedMeanwhile(issue.ref), { issue: again ?? issue });
    if (choice.agent === null) return leaveToOwner(again, choice.reason);
    if (!available.some((agent) => agent.id === choice.agent)) return leaveToOwner(again, W.unavailable(safe(choice.agent, 40), choice.reason));

    // History chooses the agent, never its conversation. Ignore session fields from legacy rules or model replies as well.
    const session = null;
    const allowed = allowedAccess(files.assign, again, { fallback: choice.agent === 'claude' ? null : 'read-only' });
    const access = allowed === null ? null : grantAccess(choice.access, allowed);
    const reason = safe(choice.reason, 500);
    const notes = [choice.session ? W.sessionDropped : null, access && W.access(access, choice.access, allowed)].filter(Boolean);
    const assigned = issues.assign(again.id, { agent: choice.agent, session, project: again.project?.path ? again.project : project, actor: 'dudu', reason: [reason, ...notes].filter(Boolean).join(' · ') });
    if (assigned.outcome !== 'success') return { outcome: assigned.outcome, message: safe(assigned.message, 300), issue: assigned.issue ?? again };
    if (again.ask === W.whoShouldTake) issues.update(again.id, { ask: '' }, { actor: 'dudu' });
    return success({
      assigned: true, agent: choice.agent, session, reused: false, access, requested: choice.access, allowed, reason,
      message: W.assigned(again.ref, choice.agent, session, access), issue: latest(again.id) ?? assigned.issue,
    });
  }

  async function assign(rawId) {
    if (disposed) return noOp(W.disposed);
    const got = issues.get(rawId, { logLimit: 1 });
    if (got.outcome !== 'success') return noOp(safe(got.message, 200));
    const { issue } = got;
    if (isFinished(issue.statusType ?? issue.status)) return noOp(W.finished(issue.ref, issue.status), { issue });
    if (issue.agent) return noOp(W.hasAgent(issue.ref, issue.agent), { issue });
    if ((issue.statusType ?? issue.status) !== 'todo') return noOp(W.notTodo(issue.ref, issue.status), { issue });
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

  // --- what the settings page shows
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
      const last = inbox.lastFinished(view.id);
      const counters = today.connectors[view.id];
      return {
        id: view.id, name: view.name,
        lastRead: last ? { at: last.finishedAt ?? last.startedAt, ok: Boolean(last.ok), items: last.added, created: last.created, ...(last.error ? { error: last.error } : {}) } : null,
        readToday: counters?.read ?? 0, createdToday: counters?.created ?? 0,
      };
    });
    const createdToday = Object.values(today.connectors).reduce((sum, entry) => sum + entry.created, 0);
    // `connectors` is the same list under the name widgets read before connectors and collectors were told apart (host/dudu-plugin/widget.d.ts).
    return { outcome: problem ? 'error' : 'success', ...(problem ? { message: problem } : {}), lastRunAt: data.lastRunAt, running, collectors: rows, connectors: rows, createdToday };
  }

  async function dispose() {
    disposed = true;
    stop.abort(new Stopped(W.disposed));
    await Promise.allSettled([...work]);
  }

  return { intake, complete, assign, state: stateOf, dispose };
}
