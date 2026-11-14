// A goal of DSH (`/goal`) in a session that a harness runs. DSH's goal driver writes each round as a user message of the source "goal"; the harness takes it
// as it takes anything a person writes. Its model has no DSH tools, so it cannot call update_goal: it says in its last lines whether the goal is done, and the
// bridge, which sees the end of the round, does what update_goal would have done.

/** Added to the round that goes to a harness (the round's own text speaks of DSH's goal tools). */
export const GOAL_ROUND_NOTE = 'This session cannot call DSH\'s goal tools. When the whole objective is achieved and checked, end your reply with a line that says only GOAL_COMPLETE. '
  + 'If you cannot go on without the person, end your reply with a line that starts with GOAL_BLOCKED: and says why. Otherwise end as usual: the next round follows.';

/** What the end of a round says of the goal: its last lines hold `GOAL_COMPLETE` or `GOAL_BLOCKED: why`. */
export function goalReportOf(text) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean).slice(-4).reverse();
  for (const line of lines) {
    if (line === 'GOAL_COMPLETE') return { kind: 'complete' };
    const blocked = /^GOAL_BLOCKED:\s*(.+)$/.exec(line);
    if (blocked) return { kind: 'blocked', message: blocked[1].trim().slice(0, 500) };
  }
  return undefined;
}

/** Complete or block the goal of `agent` as the round said, if that round's goal is still the active one. -> whether the goal was changed. */
export function reportGoal({ goals, agent, round, report, log = console }) {
  if (!goals || !agent || !report) return false;
  try {
    const view = goals.get(agent);
    if (!view || view.id !== round?.goalId || view.phase !== 'active') return false;
    const ref = { id: view.id, revision: view.revision };
    if (report.kind === 'complete') goals.complete(agent, ref);
    else goals.block(agent, ref, { code: 'model-reported', message: report.message || 'The agent could not go on.' });
    return true;
  } catch (error) {
    log.warn?.(`[dudu] A goal could not be updated: ${error.message}`);
    return false;
  }
}
