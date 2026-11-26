// A narrow adapter to public DSH session services. No dependency on DSH's timer plugin or harness protocols.
import { stat } from 'node:fs/promises';
import { pickModel } from '../dispatch/dsh-llm.mjs';
import { modelFor, AGENTS, ACCESS_MODES } from '../home/agent-sessions.mjs';
import { withAbort } from '../../providers/async.mjs';
import { isHarness } from '../../providers/catalog.mjs';

const reject = (code) => { throw Object.assign(new Error(code), { code, beforeSend: true }); };
// The task window has always listed these, greyed when they cannot be used. Every other harness is listed only while it can be used:
// a row for each tool a person does not have would be nine greyed rows.
const LISTED_WHEN_UNAVAILABLE = new Set(['claude', 'codex', 'pi', 'deepseek']);
/**
 * `modelOf(agent)` is the model a session is on. DSH resumes a session that is not loaded with its DEFAULT options (`agent.options`), not the model the session itself
 * recorded, so for a conversation that was set to another model those options say the wrong thing (the first timed run, which made the session and chose its model, was
 * delivered; every later one found "another model" and failed before sending, for an hour, 2026-11-10). The plugin passes the reading of the session's own record.
 * `dudu()` is the runner of the tasks 嘟嘟 does itself (home/task-session.mjs) or null while the conversation is not there: such a task needs no workspace and no session of DSH's to start with, its
 * runner makes the conversation of each run.
 */
export function createTaskHost({ dsh, registry, controller, agents, access = () => 'danger-full-access', modelOf = (agent) => agent?.options, dudu = () => null }) {
  const projects = () => registry.list().map((item) => ({ id: item.id, name: item.title, path: item.path }));
  const read = (promise) => withAbort(promise, AbortSignal.timeout(12_000));
  const chosen = async (task) => modelFor(task.agent, await read(dsh.models()), task.model ?? undefined) ?? reject('provider_unavailable');
  async function workspace(task) {
    const project = projects().find((item) => item.path === task.project.path);
    if (!project || !(await stat(project.path).catch(() => null))?.isDirectory()) reject('invalid_project');
    return project;
  }
  async function existing(task, id) {
    const project = await workspace(task);
    if (!registry.list().find((item) => item.id === project.id)?.sessionIds.includes(id) || id.startsWith('dudu-assistant-')) reject('invalid_session');
    let agent = agents.get(id);
    if (!agent) {
      const resolved = await controller.resolveAgent(id);
      if (resolved?.error) reject('invalid_session');
      agent = resolved?.agent ?? resolved;
    }
    const catalog = await read(dsh.models());
    const model = modelFor(task.agent, catalog, task.model ?? undefined) ?? reject('provider_unavailable');
    // Existing conversations keep their model and permissions. A timer never changes a busy conversation's configuration.
    const current = modelOf(agent);
    // A task that goes into an existing conversation and names no model of its own (the cron tools Claude is given make such tasks, providers/cron-tools.mjs) goes in on the model the conversation has: asking for the
    // provider's default would refuse it whenever the conversation is on another model, which the owner changes at will. A model of the task's own is still checked.
    if (task.model == null && task.target?.mode === 'existing') {
      const own = current?.model ? modelFor(task.agent, catalog, current.model) : null;
      if (own && own.provider === current.provider) return { project, model: own };
    }
    if (current?.provider !== model.provider || current?.model !== model.model) reject('session_model_mismatch');
    return { project, model };
  }
  return {
    /**
     * Whether the conversation a task names is certainly not there any more: no workspace of DSH's registry lists it. The registry is built from DSH's stored sessions before it starts, `list()` reads memory, a live
     * conversation is in it and an archived one keeps its place, so a conversation that is not listed has been deleted (a failing registry says nothing: not gone). Asked before a firing, never a reason for a run.
     */
    gone(task) {
      if (task?.target?.mode !== 'existing') return false;
      try { return !registry.list().some((entry) => entry.sessionIds.includes(task.target.sessionId)); } catch { return false; }
    },
    async options({ includeSessions = true } = {}) {
      // Opening the editor needs no conversation scan. Load those only for an explicit existing target.
      const [catalog, listed] = await Promise.all([read(dsh.models()), includeSessions ? read(dsh.list()) : []]);
      const providers = Object.entries(AGENTS).map(([id, name]) => {
        const selected = modelFor(id, catalog);
        const groups = catalog.groups.filter((group) => id === 'deepseek' ? !isHarness(group.id) : group.id === id);
        return { id, name, available: Boolean(selected), models: [...new Set(groups.flatMap((group) => group.models.map((model) => model.id)))] };
      }).filter((provider) => provider.available || LISTED_WHEN_UNAVAILABLE.has(provider.id));
      // 嘟嘟 itself comes first: it can use the models of the conversation routes (never Claude Code or Codex), as its own conversation does.
      const own = catalog.groups.filter((group) => !isHarness(group.id));
      providers.unshift({ id: 'dudu', name: '嘟嘟', available: Boolean(dudu()) && Boolean(pickModel(catalog)), models: [...new Set(own.flatMap((group) => group.models.map((model) => model.id)))] });
      const workspaces = projects();
      const sessions = listed.filter((item) => {
        const id = item.sessionId ?? item.id;
        return id && !id.startsWith('dudu-assistant-') && registry.list().some((entry) => entry.sessionIds.includes(id));
      }).map((item) => {
        const id = item.sessionId ?? item.id;
        const projected = item.projections?.values?.title;
        const title = typeof projected === 'string' ? projected : projected?.title ?? item.title;
        const values = item.projections?.values ?? {};
        // The session's own provider/model, read the same way a resumed task reads it (see `modelOf`'s comment above): what a
        // picked session is already on, so choosing one here can set the task's provider/model to match instead of leaving a
        // mismatch for `validate`'s `session_model_mismatch` to reject later.
        const selection = values.modelSelection?.next ?? values.modelSelection?.pending ?? values.modelSelection?.lastUsed ?? agents.get(id)?.options;
        return {
          id, title: title || id, workspaceId: registry.list().find((entry) => entry.sessionIds.includes(id))?.id,
          agent: isHarness(selection?.provider) ? selection.provider : 'deepseek',
          ...(typeof selection?.model === 'string' && selection.model ? { model: selection.model } : {}),
          updatedAt: item.updatedAt ?? 0,
        };
      });
      return { providers, projects: workspaces, sessions, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    },
    async validate(task) {
      if (task.agent === 'dudu') { await (dudu() ?? reject('provider_unavailable')).validate(task); return; }
      await workspace(task);
      await chosen(task);
      if (task.target.mode === 'existing') await existing(task, task.target.sessionId);
    },
    async deliver(task, run, checkpoint) {
      if (task.agent === 'dudu') return (dudu() ?? reject('provider_unavailable')).deliver(task, run, checkpoint);
      let sessionId = task.target.mode === 'existing' ? task.target.sessionId : task.target.mode === 'reuse' ? task.sessionId : null;
      let created = false;
      let workspaceId;
      let permission;
      try {
        await workspace(task);
        let model = await chosen(task);
        if (sessionId) {
          // The conversation's own model when the task names none (see `existing`): that is what the record keeps.
          ({ model } = await existing(task, sessionId));
          await dsh.unarchive(sessionId);
        } else {
          ({ sessionId } = await dsh.createSession({ cwd: task.project.path, title: task.title, workspaceTitle: task.project.name }));
          created = true;
          await dsh.selectModel(sessionId, model);
          permission = access();
          if (!ACCESS_MODES.includes(permission)) reject('invalid_access');
          await dsh.setAccess(sessionId, permission);
        }
        workspaceId = await dsh.workspaceOf(sessionId);
        await checkpoint(sessionId, { provider: model.provider, model: model.model, workspaceId, ...(created ? { access: permission } : {}) });
      } catch (error) {
        if (created) await dsh.archive(sessionId, { stop: false }).catch(() => {});
        error.beforeSend = true;
        throw error;
      }
      // Any exception from this point could mean the prompt was accepted. The engine keeps it uncertain, without retrying it.
      await dsh.prompt(sessionId, task.prompt, { requestId: `dudu-task-${run.id}` });
      return { sessionId, workspaceId };
    },
  };
}
