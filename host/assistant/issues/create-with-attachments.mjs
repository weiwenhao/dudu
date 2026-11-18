/** Keep creation attachments before assignment, so the first turn cannot start with text alone. */
export async function createWithAttachments({ fields, add, prepare, assign }) {
  const made = await add(prepare ? { ...fields, agent: null } : fields);
  if (made?.outcome !== 'success' || !made.issue || !prepare) return made;
  try {
    const saved = await prepare(made.issue);
    if (!['success', 'no_op'].includes(saved?.outcome)) throw new Error('Attachment preparation failed.');
  } catch {
    // The issue is saved, as before, but incomplete attachments must never start a worker.
    return { ...made, attachmentsFailed: true };
  }
  if (!fields.agent) return made;
  const assigned = await assign(made.issue.id, fields.agent);
  return { ...assigned, issue: assigned?.issue ?? made.issue };
}
