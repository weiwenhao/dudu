// A scheduled task done by 嘟嘟 (owner, 2026-11-11: 嘟嘟 is one more choice in a task's 供应商 list, "按你的建议来").
//
// The run does NOT happen in the main conversation: that one is perpetual (about 37万 tokens by 2026-11-10, no automatic compaction), so a task that ran there would fill it. Each run is a DSH session of its
// own that has 嘟嘟's identity, memory, issue summary, connectors and tools but not the chat; the main conversation takes in only the result, one line of the group chat (group.mjs `task`), and
// from there the owner goes on ("第 3 条展开说说": 嘟嘟 sees the latest lines, `group.material()`).
//
//   每次新建对话 (target `new`)  a session for each run; the last RECENT runs' sessions are kept as they are (the run list opens one), older ones are folded away.
//   新建对话并复用 (target `reuse`) the task's own session, used again until it has served MAX_RUNS runs (a conversation is read whole every time, so it cannot grow for ever; the collectors' rule,
//                                 source-collector.mjs), or until a run goes wrong: then another takes over and the old one is folded away.
// The engine (tasks/index.mjs) records DELIVERY only: `deliver` resolves when the prompt is accepted; what follows (waiting for the turn, reading its end, putting the result in the chat, folding away)
// is `follow`, and no run of a task starts while the one before it is still followed.
//
// The session's id starts with `dudu-assistant-` like the main conversation's and the collectors', so that lists of sessions leave it out. DSH has no way to delete a session, only to fold it away.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { useNativeTools as mountNativeTools } from '../../dsh-tools.mjs';
import { availableModel, pickModel } from '../dispatch/dsh-llm.mjs';
import { modelFor } from './agent-sessions.mjs';
import { taskLine } from './group.mjs';
import { conversationToolNames, isConversationTool } from './native-tools.mjs';
import { isHarness } from '../../providers/catalog.mjs';

export const TASK_PREFIX = 'dudu-assistant-task-';
export const MAX_RUNS = 24;
export const RECENT = 20;
/** A run that has not ended after this long is stopped and reported as failed. */
export const RUN_LIMIT_MS = 30 * 60_000;
const STOP_WAIT_MS = 5_000;
const FAILURE_CHARS = 300;
/** What a run answers when there is nothing to tell the owner: nothing is put in the chat. */
export const SILENT = /^[\s`"'*]*\[SILENT\][\s`"'*.。]*$/i;

const textOf = (content) => typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter((part) => part?.type === 'text').map((part) => part.text).join('\n');
const reject = (code) => { throw Object.assign(new Error(code), { code, beforeSend: true }); };
const oneLine = (value, max) => { const flat = String(value ?? '').replace(/\s+/gu, ' ').trim(); return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`; };

function readState(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    const tasks = {};
    for (const [id, entry] of Object.entries(value?.tasks ?? {})) {
      if (!id) continue;
      tasks[id] = {
        sessionId: typeof entry?.sessionId === 'string' && entry.sessionId.startsWith(TASK_PREFIX) ? entry.sessionId : null,
        runs: Number.isSafeInteger(entry?.runs) && entry.runs >= 0 ? entry.runs : 0,
        recent: (Array.isArray(entry?.recent) ? entry.recent : []).filter((item) => typeof item === 'string' && item.startsWith(TASK_PREFIX)),
      };
    }
    return { tasks };
  } catch { return { tasks: {} }; }
}

/**
 * `tools(task)` are the definitions of the tools a run has (conversation.mjs: the assistant's own, and the 待办 card); `context(task, run)` is the text of the run's system prompt;
 * `say(kind, record)` puts a line in the main conversation (conversation.mjs). `file` remembers which session a task keeps and which ones a task has made (nothing is remembered without it).
 */
export function createTaskSessions({ ctx, assistant, tools, context, say, file = null, now = Date.now, warn = console.warn, limitMs = RUN_LIMIT_MS, maxRuns = MAX_RUNS, recent = RECENT }) {
  const state = file ? readState(file) : { tasks: {} };
  const inflight = new Map(); // task id -> the run being followed
  const active = new Map(); // session id -> its agent handle, for close()
  let closed = false;
  const optional = (name) => { try { return ctx[name]; } catch { return undefined; } };

  function save() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: 1, tasks: state.tasks })}\n`, { mode: 0o600 });
    renameSync(temp, file);
  }
  const entryOf = (task) => (state.tasks[task.id] ??= { sessionId: null, runs: 0, recent: [] });

  /** The model of a run: the task's own (a model of a conversation route, never Claude Code or Codex), else the one 嘟嘟's conversation has chosen in the settings, else DSH's own. */
  function chosen(catalog, task) {
    if (task.model) return availableModel(catalog, modelFor('deepseek', catalog, task.model));
    return pickModel(catalog, assistant.settings.value('conversation').model);
  }
  const permissionOf = () => {
    const wanted = String(assistant.settings.value('conversation').permission ?? '');
    const offered = (optional('permissionPresets')?.catalog?.()?.defaultOptions ?? []).map((option) => option?.value);
    return wanted && offered.includes(wanted) ? wanted : null;
  };

  /** Folds the session away in DSH's lists (it keeps its log); never fails a run. */
  async function fold(sessionId) {
    try { await optional('workspaceRegistry')?.archiveSession?.(sessionId, { stopActivity: true }); }
    catch (error) { warn(`[dudu] A conversation of a scheduled task could not be put away: ${error?.message ?? error}`); }
  }
  async function stored(sessionId) {
    const persistence = optional('sessionPersistence');
    if (!persistence?.stat) return false;
    try { return Boolean(await persistence.stat(sessionId)); }
    catch (error) {
      if (error?.name === 'SessionPersistenceNotFoundError') return false;
      throw error;
    }
  }

  /** What the agent of a run is made of: the assistant's tools (not the ones that change the owner's tasks), its prompt, a conversation model, and no approvals (nobody is there to give one). */
  function setupFor(task, run, model, created) {
    return async (agentCtx, agent) => {
      if (ctx.agentPresets?.mount) {
        const previous = ctx.sessionProjections?.stateOf(agent.session, 'agentPreset');
        const preset = await ctx.agentPresets.mount(agentCtx, previous);
        if (ctx.sessionProjections?.stateOf(agent.session, 'agentPreset') !== preset.id) agent.session.append('agent-preset/selected', { agentPreset: preset.id });
      }
      if (!agentCtx.tools?.restrict || !agentCtx.tools?.guard || !agentCtx.systemPrompt?.suppressRuntimeContext) throw new Error('This DSH cannot scope the tools and context of a scheduled task.');
      await mountNativeTools(ctx, agentCtx);
      let lift = null;
      let allowed = null;
      const limit = () => {
        const names = conversationToolNames(ctx.tools, agent);
        const key = names.join('\n');
        if (key === allowed) return;
        const before = allowed;
        allowed = key;
        try {
          const next = agentCtx.tools.restrict({ allow: names });
          lift?.();
          lift = next;
        } catch (error) { allowed = before; throw error; }
      };
      limit();
      agentCtx.on('tools/change', () => {
        try { limit(); } catch (error) { warn(`[dudu] The tools of a scheduled task could not be updated: ${error?.message ?? error}`); }
      });
      // A run that reads untrusted pages must not be able to make more tasks, or change the ones there are.
      const definitions = tools(task).filter((tool) => !tool.name.startsWith('tasks_'));
      for (const tool of definitions) agentCtx.tools.register(tool);
      const owned = new Set(definitions.map((tool) => tool.name));
      const nativeSchemas = (who = agent, toolSet) => (ctx.tools?.schemas?.(who, toolSet) ?? []).filter((tool) => isConversationTool(tool.name));
      agentCtx.tools.guard((exec) => owned.has(exec.name) || nativeSchemas(exec.agent, exec.toolSet).some((tool) => tool.name === exec.name)
        ? undefined : 'That tool is not available to a scheduled task of dudu.');
      agentCtx.systemPrompt.suppressRuntimeContext();
      agentCtx.systemPrompt.variable('cwd', () => assistant.folder ?? '');
      agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const text = await context(task, run);
        const assembly = await next();
        return { ...assembly, sections: [{ name: 'dudu:context', text, interpolate: false }], contexts: [] };
      }, { prepend: true });
      agentCtx.on('agent/request', async (_request, next) => {
        const config = await next();
        if (isHarness(config.provider)) throw new Error('A scheduled task of dudu needs a conversation model.');
        return { ...config, cwd: assistant.folder };
      });
      agentCtx.on('approval/request', () => 'rejected');
      if (created) {
        const permission = permissionOf();
        if (permission) ctx.permissionPresets.set(agent.session, permission);
      }
      const projection = ctx.sessionProjections?.stateOf(agent.session, 'modelSelection');
      const selected = projection?.pending ?? projection?.lastUsed;
      if (!selected || selected.provider !== model.provider || selected.model !== model.model || selected.reasoningEffort !== model.reasoningEffort) agent.session.append('model/selection', model);
    };
  }

  /** The agent of this run: the task's own session again (新建对话并复用, while it has runs left), else a new one. */
  async function open(task, run, model) {
    const reuse = task.target?.mode !== 'new';
    const entry = entryOf(task);
    let sessionId = null;
    if (reuse) {
      // `task.sessionId` is the engine's binding: it forgets it when the task's provider, model or target changes, and then the old session is not used again.
      const bound = typeof task.sessionId === 'string' && task.sessionId.startsWith(TASK_PREFIX) ? task.sessionId : null;
      if (entry.sessionId && entry.sessionId !== bound) { await fold(entry.sessionId); entry.sessionId = null; entry.runs = 0; }
      if (bound && entry.sessionId !== bound) { entry.sessionId = bound; entry.runs = 0; }
      if (bound && entry.runs >= maxRuns) { await fold(bound); entry.sessionId = null; entry.runs = 0; }
      else sessionId = bound;
    }
    if (sessionId && await stored(sessionId)) {
      try {
        return { handle: await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: model, setup: setupFor(task, run, model, false) }), sessionId, created: false, reuse, entry };
      } catch (error) {
        // A session that cannot be opened again (it was removed, or it is damaged) is replaced; it is not worth failing the run for.
        warn(`[dudu] The conversation of a scheduled task could not be opened again, another one starts: ${error?.message ?? error}`);
        await fold(sessionId);
        entry.sessionId = null;
        entry.runs = 0;
      }
    }
    sessionId = `${TASK_PREFIX}${randomUUID()}`;
    if (reuse) { entry.sessionId = sessionId; entry.runs = 0; }
    save(); // before the session exists: a session that is not in this file is one nobody keeps
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: assistant.folder }, agentOptions: model, setup: setupFor(task, run, model, true) });
    return { handle, sessionId, created: true, reuse, entry };
  }

  async function post(task, text, ok) {
    try { await say('task', taskLine({ task, text, ok, at: now() })); }
    catch (error) { warn(`[dudu] The result of a scheduled task could not be put in the chat: ${error?.message ?? error}`); }
  }

  /** Waits for the turn of a run, reads how it ended, puts the result in the chat (nothing when the run has nothing to tell, or when the plugin is shutting down), and lets go of the session. */
  async function follow({ task, handle, sessionId, before, reuse, entry }) {
    const session = handle.agent.session;
    let failure = null;
    let timer;
    const expired = new Promise((resolve) => { timer = setTimeout(() => resolve('expired'), limitMs); timer.unref?.(); });
    try {
      const ended = await Promise.race([handle.agent.whenIdle().then(() => 'idle'), expired]);
      if (ended === 'expired') {
        await ctx.sessionController.cancel({ sessionId }).catch(() => {});
        await Promise.race([handle.agent.whenIdle().catch(() => {}), new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref?.())]);
        failure = `The run took longer than ${Math.round(limitMs / 60_000)} minutes and was stopped.`;
      }
    } catch (error) { failure = oneLine(error?.message ?? error, FAILURE_CHARS) || 'The run failed.'; }
    finally { clearTimeout(timer); }

    let answer = '';
    if (!failure) {
      try {
        const events = session.snapshotEvents().filter((event) => !(event.seq < before));
        const end = events.filter((event) => event.type === 'turn/end').at(-1);
        const kind = end?.data?.reason?.kind;
        if (!end) failure = 'The run ended without an answer.';
        else if (kind !== 'completed' && kind !== 'max-tokens') failure = oneLine(end.data?.reason?.error?.message ?? 'The run did not complete.', FAILURE_CHARS);
        answer = events.filter((event) => event.type === 'assistant/message').map((event) => textOf(event.data?.message?.content ?? event.data?.content).trim()).filter(Boolean).at(-1) ?? '';
      } catch (error) { failure = oneLine(error?.message ?? error, FAILURE_CHARS) || 'The run failed.'; }
    }

    active.delete(sessionId);
    await handle.dispose().catch(() => {});
    if (reuse) {
      // A conversation that went wrong is not used again: the next run starts another.
      if (entry.sessionId === sessionId) entry.runs = failure ? maxRuns : entry.runs + 1;
    } else {
      entry.recent = [...entry.recent.filter((id) => id !== sessionId), sessionId];
      while (entry.recent.length > recent) await fold(entry.recent.shift());
    }
    save();

    if (closed) return;
    if (failure) await post(task, failure, false);
    else if (answer && !SILENT.test(answer)) await post(task, answer, true);
  }

  return {
    /** Whether 嘟嘟 can run a task now: the DSH has a conversation model. */
    async available() {
      try { return Boolean(pickModel(await ctx.sessionController.modelCatalog())); } catch { return false; }
    },
    async validate(task) {
      if (task.target?.mode === 'existing') reject('invalid_session');
      if (!chosen(await ctx.sessionController.modelCatalog(), task)) reject('provider_unavailable');
    },
    /** The engine's `deliver` for a task of 嘟嘟 (tasks/host.mjs): resolves once the prompt is accepted; the rest happens in the background (`follow`). */
    async deliver(task, run, checkpoint) {
      if (closed) reject('unavailable');
      // No run of a task starts while the one before it is still being followed (the engine keeps the task busy meanwhile, so the next ones wait behind this).
      await inflight.get(task.id)?.catch(() => {});
      if (closed) reject('unavailable');
      let opened = null;
      try {
        const model = chosen(await ctx.sessionController.modelCatalog(), task) ?? reject('provider_unavailable');
        opened = await open(task, run, model);
        await checkpoint(opened.sessionId, { provider: model.provider, model: model.model, ...(opened.created && permissionOf() ? { access: permissionOf() } : {}) });
      } catch (error) {
        if (opened) {
          await opened.handle.dispose().catch(() => {});
          if (opened.created) await fold(opened.sessionId);
        }
        error.beforeSend = true;
        throw error;
      }
      const { handle, sessionId } = opened;
      active.set(sessionId, handle);
      const before = handle.agent.session.seq; // what this run says starts here; a reused conversation holds the earlier runs too
      try {
        // Any exception from here on could mean the prompt was accepted: the engine keeps the run uncertain and never sends it again.
        await ctx.sessionController.prompt({ sessionId, requestId: `dudu-task-${run.id}`, mode: 'queue', content: [{ type: 'text', text: task.prompt }] }, new AbortController().signal);
      } catch (error) {
        active.delete(sessionId);
        await handle.dispose().catch(() => {});
        throw error;
      }
      const work = follow({ task, handle, sessionId, before, reuse: opened.reuse, entry: opened.entry })
        .catch((error) => warn(`[dudu] A scheduled task of dudu ended badly: ${error?.message ?? error}`))
        .finally(() => { if (inflight.get(task.id) === work) inflight.delete(task.id); });
      inflight.set(task.id, work);
      return { sessionId, workspaceId: null };
    },
    /** Resolves when no run is being followed (what the engine's `idle()` is for deliveries). */
    async idle() { await Promise.allSettled([...inflight.values()]); },
    /** Stops the runs in flight (their turns are cancelled, nothing is said in the chat for them) and waits for them to let go. */
    async close() {
      closed = true;
      await Promise.all([...active.keys()].map((sessionId) => ctx.sessionController.cancel({ sessionId }).catch(() => {})));
      await Promise.allSettled([...inflight.values()]);
    },
  };
}
