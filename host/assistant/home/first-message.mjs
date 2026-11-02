/** The worker gets the task itself. Workflow, source records and permissions stay with dudu and DSH. */
export function firstMessage({ issue } = {}) {
  return [issue.title?.trim(), issue.brief?.trim()].filter(Boolean).join('\n\n');
}
