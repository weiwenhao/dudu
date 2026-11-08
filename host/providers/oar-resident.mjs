import { initialTaskState, reduceTaskState } from './oar-runtimes.mjs';

const active = (task) => ['pending', 'running', 'paused'].includes(task.status);
const monitor = (task) => /monitor/i.test(task.nativeType ?? '');

/** The native process may own background work after a DSH turn's stream has ended. */
export class OarResident {
  constructor(session, { normalizer, observedSubagents = [], onTasks, options }) {
    this.session = session;
    this.normalizer = normalizer;
    this.options = options;
    this.onTasks = onTasks;
    this.state = initialTaskState(session.id);
    this.state.tasks = new Map(observedSubagents.map((task) => [task.taskId, { ...task, taskType: 'agent', status: 'stopped' }]));
    this.available = true;
    this.idle = false;
    const dormant = new Set(observedSubagents.map((task) => task.taskId));
    this.unsubscribe = session.rawEvents((record) => {
      this.seq = record.seq;
      for (const event of record.kind === 'frame' ? record.body?.events ?? [] : []) {
        if (!['task_started', 'task_updated', 'task_ended'].includes(event.kind) || !dormant.delete(event.taskId)) continue;
        if (event.kind === 'task_started') {
          const tasks = new Map(this.state.tasks);
          tasks.delete(event.taskId);
          this.state = { ...this.state, tasks };
        }
      }
      const before = this.state.tasks;
      this.state = reduceTaskState(this.state, { ...record, sessionId: record.sessionId ?? session.id, agentPath: record.agentPath ?? [] });
      if (record.kind === 'response' && record.body?.kind === 'exited') this.available = false;
      if (before !== this.state.tasks || record.kind === 'frame' && record.body?.events?.some((event) => event.kind === 'tool_call_progress')) this.report(record);
      if (this.backgroundActive && !this.timer) this.timer = setInterval(() => { void this.refresh(); }, 750);
      if (this.idle && !this.backgroundActive) this.release();
    });
  }

  get hasChildren() {
    return [...this.state.tasks.values()].some((task) => task.taskType === 'agent' && !task.ambient && active(task));
  }

  get backgroundActive() {
    return this.available && [...this.state.tasks.values()].some((task) => active(task) && task.taskType !== 'agent'
      && (!task.ambient || monitor(task)) && (task.background !== false || monitor(task)));
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

  release() {
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
      this.available = false;
      // Keep the observer until the actual exit; OAR settles unfinished native tasks as stopped/failed there.
      await this.session.dispose().catch(() => {});
      await this.reporting;
      this.unsubscribe?.();
    })();
  }
}
