// The versions of an issue's description (Linear's "description history"), read from what the store already keeps: every change of the description is an event with the
// text before and after. `events` is what `issues/events` returns for the issue, newest first.

/**
 * The versions, newest first: `{ id, at, actor, brief }`. The newest is what the description is now; the last is how it was written. An issue whose description was never
 * changed has no history (its one version is the one on the page).
 */
export function descriptionVersions(events, issue) {
  const changes = events.filter((event) => event.before && event.after && 'brief' in event.before && 'brief' in event.after);
  if (!changes.length) return [];
  const versions = changes.map((event) => ({ id: event.id, at: event.at, actor: event.actor, brief: event.after.brief ?? '' }));
  const added = events.find((event) => event.action === 'add');
  versions.push({ id: 'first', at: issue.createdAt, actor: added?.actor ?? 'owner', brief: changes.at(-1).before.brief ?? '' });
  return versions;
}
