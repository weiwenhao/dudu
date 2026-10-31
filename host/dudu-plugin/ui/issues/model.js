// The fixed vocabularies of an issue, in the order Linear shows them.
export const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
export const PRIORITY_ORDER = ['none', 'urgent', 'high', 'medium', 'low'];
export const AGENT_STATE_ORDER = ['working', 'needs_you', 'stuck', 'idle'];

// How the agents are named and lettered on avatars; an agent not listed shows its own id and first letter.
export const AGENT_NAMES = { claude: 'Claude', codex: 'ChatGPT', deepseek: 'DeepSeek' };
export const AGENT_LETTERS = { claude: 'C', codex: 'G', deepseek: 'D' };
