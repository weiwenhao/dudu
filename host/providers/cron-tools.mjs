// Claude Code's cron tools, kept by Dudu instead (owner, 2026-11-17: "我希望让 claude 无感知的替换 croncreate").
//
// Claude Code's own CronCreate, CronDelete and CronList keep a job in the memory of one Claude process: it is gone when the session ends, it expires after 7 days and it only fires while that session is open. In the Claude
// sessions this plugin starts those three are denied (`disallowedTools`) and a server of this plugin, served over MCP by OAR (`serveMcpTools`: http on 127.0.0.1, a bearer token, the handlers run here), offers tools of the same
// names, parameters and words. Claude sees them as `mcp__dudu__CronCreate` and so on (an MCP tool always carries the name of its server) and uses them like the originals. A job is a task of Dudu (assistant/tasks): when its time
// comes its prompt is sent into the conversation that made it (`target: { mode: 'existing' }`, the way the owner sends a message), it is kept on disk, survives the session and a restart of Dudu, never expires, and is in the
// window of the tasks, where the owner can see, pause and delete it. The model of such a task is left empty on purpose: the prompt goes in on whatever model the conversation is on (assistant/tasks/host.mjs).
//
// One served set for each conversation: its handlers must know which conversation is asking, and a handler is not told that. A set lives until the conversation's agent is gone or the plugin stops; it is given to OAR
// with every start (OAR does not remember it) and stays the same between starts, so that a process that is still alive sees the same options.
import { cronProblem, nextCron } from '../assistant/schedule/cron.mjs';
import { serveMcpTools } from './oar-runtimes.mjs';

/** The name of the server: Claude sees `mcp__dudu__CronCreate`. */
export const SERVER = 'dudu';
/** Claude Code's own tools these replace; they are denied in the sessions that have the replacements. */
export const NATIVE = Object.freeze(['CronCreate', 'CronDelete', 'CronList']);

const CREATE = `Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.

Uses standard 5-field cron in the user's local timezone: minute hour day-of-month month day-of-week. "0 9 * * *" means 9am local — no timezone conversion needed.

## One-shot tasks (recurring: false)

For "remind me at X" or "at <time>, do Y" requests — fire once, then end.
Pin minute/hour/day-of-month/month to specific values:
  "remind me at 2:30pm today to check the deploy" → cron: "30 14 <today_dom> <today_month> *", recurring: false
  "tomorrow morning, run the smoke test" → cron: "57 8 <tomorrow_dom> <tomorrow_month> *", recurring: false

## Recurring jobs (recurring: true, the default)

For "every N minutes" / "every hour" / "weekdays at 9am" requests:
  "*/5 * * * *" (every 5 min), "0 * * * *" (hourly), "0 9 * * 1-5" (weekdays at 9am local)

## Where it runs

The job is kept by Dudu on this computer, not in this session: it survives this session ending and Dudu restarting, it does not expire, and the user sees it in Dudu's task list, where they can pause or delete it. The prompt is sent into this same conversation each time the job fires, as if the user had typed it; if the conversation is busy, it waits for the turn to end. Jobs fire while the Dudu desktop app is running.

The result gives the job's ID (pass it to CronDelete) and its next run time: when you tell the user when a job will run, give that time.

## Not for live watching

CronCreate re-runs a prompt at fixed wall-clock times. To watch a log file, process, or command output and be notified the moment something changes, use the Monitor tool instead.`;

const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });
const oneLine = (value, max) => { const flat = String(value ?? '').replace(/\s+/gu, ' ').trim(); return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`; };
const titleOf = (prompt) => oneLine(String(prompt).split('\n').find((line) => line.trim()), 80) || 'Scheduled prompt';

/** The date and the time of day of a moment in a time zone, the way a once-only task is written. */
export function localParts(at, timeZone) {
  const read = (options) => new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', ...options }).format(at);
  return { date: read({ year: 'numeric', month: '2-digit', day: '2-digit' }), time: read({ hour: '2-digit', minute: '2-digit' }) };
}
const stamp = (at, timeZone) => { if (!Number.isFinite(at)) return 'never'; const { date, time } = localParts(at, timeZone); return `${date} ${time} (${timeZone})`; };

/**
 * What a job is as a task: `recurring` (the default) is a cron schedule in the computer's time zone; `recurring: false` fires once at the next time the expression names (the pinned minute, hour, day and month of a
 * reminder), which a task writes as a date and a time. -> { schedule } or { problem }.
 */
export function scheduleOf({ cron, recurring = true }, { timeZone, now = Date.now() }) {
  if (typeof cron !== 'string') return { problem: 'cron must be a string of five fields.' };
  const problem = cronProblem(cron);
  if (problem) return { problem };
  const expression = cron.trim().replace(/\s+/g, ' ');
  if (recurring !== false) return { schedule: { kind: 'cron', timezone: timeZone, expression } };
  const at = nextCron(expression, now, timeZone);
  if (at == null) return { problem: 'That time never comes.' };
  return { schedule: { kind: 'once', timezone: timeZone, ...localParts(at, timeZone) } };
}

const whenOf = (schedule) => (schedule.kind === 'once' ? `once ${schedule.date} ${schedule.time}` : schedule.expression);

/**
 * `tasks()` is the task service (it starts after the providers, so it is asked for when a call comes); `describe(sessionId)` -> `{ project }` (the workspace DSH keeps the conversation in) or null; `serve` is OAR's
 * `serveMcpTools`. `routes` are the harnesses that get the tools: only Claude has tools of its own to replace.
 */
export function createSessionTools({ tasks, describe, serve = serveMcpTools, timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now, routes = ['claude'], log = console }) {
  const served = new Map(); // DSH session id -> a promise of what `serve` gave

  function toolsFor(sessionId, route) {
    const service = () => tasks() ?? null;
    const mine = (task) => task?.target?.mode === 'existing' && task.target.sessionId === sessionId;
    return [
      {
        name: 'CronCreate', description: CREATE,
        inputSchema: {
          type: 'object', additionalProperties: false, required: ['cron', 'prompt'],
          properties: {
            cron: { type: 'string', description: 'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).' },
            prompt: { type: 'string', description: 'The prompt to enqueue at each fire time.' },
            recurring: { type: 'boolean', description: 'true (default) = fire on every cron match until deleted. false = fire once at the next match, then end. Use false for "remind me at X" one-shot requests with pinned minute/hour/dom/month.' },
            durable: { type: 'boolean', description: 'Has no effect: jobs are always kept by Dudu.' },
          },
        },
        async handler({ cron, prompt, recurring }) {
          if (typeof prompt !== 'string' || !prompt.trim()) return text('prompt must say what to send when the job fires.', true);
          const zone = timeZone();
          const made = scheduleOf({ cron, recurring }, { timeZone: zone, now: now() });
          if (made.problem) return text(made.problem, true);
          const place = describe(sessionId);
          if (!place?.project) return text('This conversation is not in a workspace Dudu knows, so a job cannot be kept for it.', true);
          const service_ = service();
          if (!service_) return text("Dudu's tasks are not available right now.", true);
          // No model: the prompt goes in on the model the conversation has, now and after the owner changes it.
          const result = await service_.execute('create', { fields: { title: titleOf(prompt), prompt, agent: route, model: null, project: place.project, target: { mode: 'existing', sessionId }, schedule: made.schedule } });
          if (result?.outcome !== 'success') return text(`The job could not be scheduled (${result?.code ?? 'unavailable'}).`, true);
          const task = result.task;
          return text(`Scheduled ${made.schedule.kind === 'once' ? 'one-shot' : 'recurring'} job ${task.id}: ${whenOf(made.schedule)}. Next run: ${stamp(task.nextRunAt, zone)}. Dudu keeps it, also after this session ends; its prompt is sent into this conversation.`);
        },
      },
      {
        name: 'CronDelete', description: 'Cancel a cron job previously scheduled with CronCreate.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', description: 'Job ID returned by CronCreate.' } } },
        async handler({ id }) {
          const service_ = service();
          if (!service_) return text("Dudu's tasks are not available right now.", true);
          const found = typeof id === 'string' ? await service_.execute('get', { id }) : null;
          if (found?.outcome !== 'success' || !mine(found.task)) return text(`There is no job ${typeof id === 'string' ? id : ''} in this conversation.`, true);
          const result = await service_.execute('delete', { id, revision: found.task.revision });
          return result?.outcome === 'success' ? text(`Cancelled job ${id}.`) : text(`The job could not be cancelled (${result?.code ?? 'unavailable'}).`, true);
        },
      },
      {
        name: 'CronList', description: 'List all cron jobs scheduled via CronCreate in this conversation.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        async handler() {
          const zone = timeZone();
          const listed = await service()?.execute('list', {});
          const jobs = (listed?.tasks ?? []).filter((task) => mine(task) && task.status !== 'ended').sort((a, b) => a.createdAt - b.createdAt);
          if (!jobs.length) return text('No scheduled jobs.');
          return text(jobs.map((task) => `${task.id} | ${whenOf(task.schedule)} (${task.schedule.kind === 'once' ? 'one-shot' : 'recurring'}${task.status === 'paused' ? ', paused' : ''}) | next run: ${task.status === 'active' ? stamp(task.nextRunAt, zone) : '—'} | ${oneLine(task.prompt, 120)}`).join('\n'));
        },
      },
    ];
  }

  return {
    /**
     * What a start of this conversation's session is given: the server of the tools (`mcpServers`), the tools of Claude's it replaces (`disallowedTools`) and Claude's flag that allows the new ones (`launchArgs`: a
     * session whose permission is not wide open would refuse them, "it requires approval, and this session has no approval surface": the owner gives the tools every permission there is); null when this harness has none
     * to replace, or when the tools cannot be served (the session then runs as it always did, with Claude's own).
     */
    async forSession(sessionId, route) {
      if (!routes.includes(route) || typeof sessionId !== 'string' || !sessionId || sessionId.startsWith('dudu-assistant-')) return null;
      let entry = served.get(sessionId);
      if (!entry) {
        entry = Promise.resolve().then(() => serve({ name: SERVER, tools: toolsFor(sessionId, route) }));
        served.set(sessionId, entry);
      }
      try {
        const { server } = await entry;
        return { mcpServers: [server], disallowedTools: [...NATIVE], launchArgs: ['--allowedTools', NATIVE.map((name) => `mcp__${SERVER}__${name}`).join(',')] };
      } catch (error) {
        served.delete(sessionId);
        log.warn?.(`[dudu] Could not serve the cron tools to a Claude session: ${error?.message ?? error}`);
        return null;
      }
    },
    /** The conversation's agent is gone: its server stops. */
    async forget(sessionId) {
      const entry = served.get(sessionId);
      served.delete(sessionId);
      const set = await entry?.catch(() => null);
      await set?.close().catch(() => {});
    },
    async close() { await Promise.all([...served.keys()].map((sessionId) => this.forget(sessionId))); },
  };
}
