import { initialTaskState, reduceTaskState } from './oar-runtimes.mjs';

const active = (task) => ['pending', 'running', 'paused'].includes(task.status);
const monitor = (task) => /monitor/i.test(task.nativeType ?? '');
const background = (task) => active(task) && (!task.ambient || monitor(task))
  && (task.taskType === 'agent' ? task.background === true : task.background !== false || monitor(task));

/** The native process may own background work after a DSH turn's stream has ended. */
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
      if (this.backgroundActive || exited) {
        clearTimeout(this.releaseTimer);
        this.releaseTimer = undefined;
      }
      if (this.idle && !this.backgroundActive) this.release({ delay: backgroundBefore && !exited ? followUpMs : 0 });
    });
  }

  get hasChildren() {
    return [...this.state.tasks.values()].some((task) => task.taskType === 'agent' && !task.ambient && active(task));
  }

  get backgroundActive() {
    return this.available && [...this.state.tasks.values()].some(background);
  }

  get retained() {
    return this.available && (this.backgroundActive || this.idle
      && (Boolean(this.releaseTimer) || this.session.status?.().value.kind === 'running'));
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
      if (this.idle && !this.backgroundActive) this.release();
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  finishTurn() {
    this.idle = true;
    if (!this.backgroundActive) this.release();
  }

  resumeTurn() {
    this.idle = false;
    // Keep an already scheduled native follow-up window if configuring/admitting this turn is refused.
    // Its callback checks idle again, so it cannot close a newly admitted foreground turn.
  }

  release({ delay = 0 } = {}) {
    if (this.releaseTimer) return;
    if (delay > 0) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = undefined;
        this.release();
      }, delay);
      return;
    }
    void (async () => {
      // Read final task output before closing the native process that serves it.
      await this.reporting;
      if (this.idle && !this.backgroundActive && this.session.status?.().value.kind !== 'running') await this.close();
    })();
  }

  close() {
    return this.closing ??= (async () => {
      clearInterval(this.timer);
      this.timer = undefined;
      clearTimeout(this.releaseTimer);
      this.releaseTimer = undefined;
      this.available = false;
      // Keep the observer until the actual exit; OAR settles unfinished native tasks as stopped/failed there.
      await this.session.dispose().catch(() => {});
      await this.reporting;
      this.unsubscribe?.();
      await this.team?.end();
    })();
  }
}
