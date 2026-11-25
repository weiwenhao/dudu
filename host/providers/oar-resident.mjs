import { initialTaskState, reduceTaskState } from './oar-runtimes.mjs';

const active = (task) => ['pending', 'running', 'paused'].includes(task.status);
const monitor = (task) => /monitor/i.test(task.nativeType ?? '');
const background = (task) => active(task) && (!task.ambient || monitor(task))
  && (task.taskType === 'agent' ? task.background === true : task.background !== false || monitor(task));

/**
 * The native process of one conversation. It is kept between turns, and is closed only by deep sleep (`HarnessBridge.release`), the plugin's own
 * close or its own exit (owner, 2026-11-23: 「在进行中的会话应该是一直保持的才对，只有进入深度睡眠的会话才会关闭会话进程」); it used to close as soon as a turn ended with no
 * background work. It may own background work after a DSH turn's stream has ended.
 */
export class OarResident {
  constructor(session, { normalizer, observedSubagents = [], onRecord, onTasks, options, team, followUpMs = 5000 }) {
    this.session = session;
    this.normalizer = normalizer;
    this.options = options;
    this.onRecord = onRecord;
    this.onTasks = onTasks;
    this.team = team;
    this.state = initialTaskState(session.id);
    this.state.tasks = new Map(observedSubagents.map((task) => [task.taskId, { ...task, taskType: 'agent', status: 'stopped' }]));
    this.available = true;
    this.idle = false;
    const dormant = new Set(observedSubagents.map((task) => task.taskId));
    const commands = new Set();
    this.unsubscribe = session.rawEvents((record) => {
      const backgroundBefore = this.backgroundActive;
      this.seq = record.seq;
      const events = record.kind === 'frame' ? record.body?.events ?? [] : [];
      // Codex announces commands before they yield a background terminal. Observe the native list during that
      // interval too: waiting for the first known task would postpone discovery until the root turn ended.
      let commandEnded = false;
      if (session.backgroundTasks && (record.sessionId === undefined || record.sessionId === session.id)
        && (record.agentPath?.length ?? 0) === 0) {
        for (const event of events) {
          if (event.kind === 'tool_call_started' && event.tool === 'commandExecution') commands.add(event.callId);
          if (event.kind === 'tool_call_ended' && commands.delete(event.callId)) commandEnded = true;
          if (event.kind === 'turn_ended') commands.clear();
        }
      }
      for (const event of events) {
        if (!['task_started', 'task_updated', 'task_ended'].includes(event.kind) || !dormant.delete(event.taskId)) continue;
        if (event.kind === 'task_started') {
          const tasks = new Map(this.state.tasks);
          tasks.delete(event.taskId);
          this.state = { ...this.state, tasks };
        }
      }
      const before = this.state.tasks;
      this.state = reduceTaskState(this.state, { ...record, sessionId: record.sessionId ?? session.id, agentPath: record.agentPath ?? [] });
      const exited = record.kind === 'response' && record.body?.kind === 'exited'
        && (record.sessionId === undefined || record.sessionId === session.id) && (record.agentPath?.length ?? 0) === 0;
      if (exited) this.available = false;
      // A native child's output belongs to the process, not to whichever parent turn is currently reading.
      this.onRecord?.(record, session.id);
      this.team?.record(record, session.id, this.state.tasks);
      if (before !== this.state.tasks || events.some((event) => event.kind === 'tool_call_progress')) this.report(record);
      // Child lifecycle/output is pushed natively. Only commands and non-agent background output need polling.
      const polling = this.available && (commands.size > 0
        || [...this.state.tasks.values()].some((task) => task.taskType !== 'agent' && background(task)));
      if (polling && !this.timer) this.timer = setInterval(() => { void this.refresh(); }, 750);
      if (!polling && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      // A fast yield may precede the first poll. Check once at the tool boundary before stopping discovery.
      if (commandEnded) void this.refresh();
      // Background work that just ended may get its native follow-up (the harness reads the result and answers on its own) a few seconds
      // later: until then the process still counts as working, so that no deep sleep or replacement cuts that answer off.
      if (this.backgroundActive || exited) this.endFollowUp();
      else if (backgroundBefore && this.idle) this.beginFollowUp(followUpMs);
    });
  }

  get hasChildren() {
    return [...this.state.tasks.values()].some((task) => task.taskType === 'agent' && !task.ambient && active(task));
  }

  get backgroundActive() {
    return this.available && [...this.state.tasks.values()].some(background);
  }

  /** The process is there to take the next turn. */
  get alive() {
    return this.available && !this.closing;
  }

  /** The process still works on its own: background work, its follow-up window, or a native turn that runs on after DSH's turn ended. It keeps an idle issue awake (deep sleep waits for it). */
  get working() {
    return this.available && (this.backgroundActive || Boolean(this.followUp) || this.idle && this.session.status?.().value.kind === 'running');
  }

  beginFollowUp(delay) {
    if (this.followUp || !(delay > 0)) return;
    this.followUp = setTimeout(() => { this.followUp = undefined; }, delay);
  }

  endFollowUp() {
    clearTimeout(this.followUp);
    this.followUp = undefined;
  }

  report(record) {
    // Observers own only projections/output. They cannot submit a prompt or keep a finished root turn open.
    try { this.reporting = Promise.resolve(this.onTasks?.({ record, tasks: [...this.state.tasks.values()], session: this.session })).catch(() => {}); }
    catch { /* projection failures never interrupt native execution */ }
  }

  async refresh() {
    if (!this.available || this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try { await this.session.backgroundTasks?.(); } catch { /* a later native report remains authoritative */ }
      this.report();
      await this.reporting;
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  /** DSH's turn ended: the process stays, idle, for the next one. */
  finishTurn() {
    this.idle = true;
  }

  resumeTurn() {
    this.idle = false;
  }

  close() {
    return this.closing ??= (async () => {
      clearInterval(this.timer);
      this.timer = undefined;
      this.endFollowUp();
      this.available = false;
      // Keep the observer until the actual exit; OAR settles unfinished native tasks as stopped/failed there.
      await this.session.dispose().catch(() => {});
      await this.reporting;
      this.unsubscribe?.();
      await this.team?.end();
    })();
  }
}
