// The fixed vocabularies of an issue, in the order Linear shows them.
export const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
export const PRIORITY_ORDER = ['none', 'urgent', 'high', 'medium', 'low'];
export const AGENT_STATE_ORDER = ['working', 'blocked', 'idle', 'unassigned'];

// How the agents are named and lettered on avatars; an agent not listed shows its own id and first letter.
export const AGENT_NAMES = { claude: 'Claude', codex: 'ChatGPT', deepseek: 'DeepSeek' };
export const AGENT_LETTERS = { claude: 'C', codex: 'G', deepseek: 'D' };

/** The fields a new issue gets when it is added from a group bar or a board column: the group's own value. */
export function presetOf(field, key) {
  if (field === 'status' || field === 'priority') return { [field]: key };
  if (field === 'agent') return { agent: key };
  if (field === 'project' && key != null) return { project: { name: key, path: null } };
  return {};
}

/** Every issue id of a grouped list, in the order shown (groups, then sub-groups, then rows). */
export const leafIds = (groups) => groups.flatMap((group) => (group.groups ? leafIds(group.groups) : group.items.map((issue) => issue.id)));
