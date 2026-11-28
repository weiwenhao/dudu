// The scheduled tasks of one conversation (owner, 2026-11-17: "现在 Agent 自己创建的定时任务，在 Agent 的对话窗口上没有体现出来…"; design `.local/designs/session-schedules-2026-11-17/`).
//
// A task belongs to a conversation when its prompts go into it: a task on 「已有会话」 names it, a task that keeps one conversation (「新建对话并复用」) has made it and keeps it (`task.sessionId`).
// A task that makes a new conversation on every run belongs to none: its `sessionId` is only the latest of them. The Agent's own (CronCreate) and the ones made in the tasks window are both there (owner, 2026-11-17:
// "那没问题"). A task records where it was made from (`origin`); the ones a conversation made with its cron tools are in its list but not in the tasks window (owner, 2026-11-26: "MCP dudu 调用创建的，我不希望出现在这个
// 定时任务列表里"), which is `inTasksWindow`.

/** Whether the tasks window lists it: not one a conversation made for itself with its cron tools (a task made before `origin` was recorded has none, and is listed). */
export const inTasksWindow = (task) => task?.origin !== 'session';

export function belongsTo(task, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId || !task?.target) return false;
  if (task.target.mode === 'existing') return task.target.sessionId === sessionId;
  if (task.target.mode === 'reuse') return task.sessionId === sessionId;
  return false;
}

/** The conversation's tasks by status, each the newest made first as the tasks window lists them (a row must not move under the pointer when a task's next run changes). */
export function sessionTasks(tasks, sessionId) {
  const newest = (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0);
  const mine = (tasks ?? []).filter((task) => belongsTo(task, sessionId)).sort(newest);
  const of = (status) => mine.filter((task) => task.status === status);
  return { active: of('active'), paused: of('paused'), ended: of('ended') };
}

/** The number in the header, as DSH's own jobs control counts: the ones that are on, or, when none is, the ones that can be seen (paused). 0: the control is not there (ended tasks alone do not bring it). */
export const headerCount = ({ active, paused }) => (active.length > 0 ? active.length : paused.length);
