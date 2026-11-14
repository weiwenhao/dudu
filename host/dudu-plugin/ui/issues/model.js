// The fixed vocabularies of an issue, in the order Linear shows them.
export const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
export const PRIORITY_ORDER = ['none', 'urgent', 'high', 'medium', 'low'];
export const AGENT_STATE_ORDER = ['blocked', 'working', 'idle', 'unassigned'];

// How the agents are named and lettered on avatars; an agent not listed shows its own id and first letter.
export const AGENT_NAMES = { claude: 'Claude', codex: 'ChatGPT', pi: 'Pi', deepseek: 'DeepSeek' };
export const AGENT_LETTERS = { claude: 'C', codex: 'G', pi: 'P', deepseek: 'D' };
// The agents that are harnesses found on this computer (host/providers/catalog.mjs says the same); DeepSeek is DSH's own.
export const HARNESS_AGENTS = ['claude', 'codex', 'pi'];

/**
 * The agents to offer for an issue. A harness (Claude, ChatGPT, Pi) is an agent while it is found on this computer and switched on in
 * Settings > Providers (`providers`: what the plugin says of them); DeepSeek is DSH's own and always one. Until the providers have been read, or when
 * they cannot be, every agent is offered, so that a failed read never takes the choice away. `keep` is an agent already chosen: it stays in the list.
 */
export function agentIds(providers, keep) {
  const all = Object.keys(AGENT_NAMES);
  if (!Array.isArray(providers)) return all;
  const usable = new Set(providers.filter((provider) => provider.enabled !== false && provider.state === 'ready').map((provider) => provider.id));
  return all.filter((id) => !HARNESS_AGENTS.includes(id) || usable.has(id) || id === keep);
}

/** The fields a new issue gets when it is added from a group bar or a board column: the group's own value. */
export function presetOf(field, key) {
  if (field === 'status' || field === 'priority') return { [field]: key };
  if (field === 'agent') return { agent: key };
  if (field === 'project' && key != null) return { project: { name: key, path: null } };
  return {};
}

/** Every issue id of a grouped list, in the order shown (groups, then sub-groups, then rows). */
export const leafIds = (groups) => groups.flatMap((group) => (group.groups ? leafIds(group.groups) : group.items.map((issue) => issue.id)));
