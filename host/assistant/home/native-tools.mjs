// Inherit the host's actual standard-session tool scope. A second hand-maintained
// list silently loses capabilities whenever DSH adds a tool. DSH still enforces
// the session's sandbox and approvals; private PTC transports stay private.
// Computer Use is not supported (owner, 2026-11-25): a host's cua tools are never offered to the conversation.
const PRIVATE = new Set(['cua', 'cua_run_code', 'run_code']);
// Unattended task runs keep their previous scope; this release fixes the owner's interactive conversation.
const SCHEDULED_NATIVE = new Set([
  'skill', 'web_search', 'web_fetch', 'bash', 'pwsh',
  'read', 'read_image', 'glob', 'grep', 'write', 'edit', 'apply_patch', 'str_replace_editor',
  'job_output', 'job_list', 'job_kill',
  'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list',
]);

export const isConversationTool = (name, { scheduled = false } = {}) =>
  typeof name === 'string' && !PRIVATE.has(name)
  && (!scheduled || name.startsWith('mcp__') || SCHEDULED_NATIVE.has(name));

/** Names restrict() may accept, before this agent's existing restriction has hidden them. */
export function conversationToolNames(tools, agent, options) {
  // DSH 0.2.2 mounts shell, files and skills on the preset's parent scope. The global
  // schemas() view omits them, while schemas(agent) is already masked by our previous
  // restriction. The registry exposes the inherited, pre-restriction names for exactly
  // this purpose; own registrations must stay out because restrict() rejects them.
  const inherited = tools.view?.(agent)?.restrictableNames;
  const names = inherited ?? (tools.schemas?.() ?? []).map((tool) => tool.name);
  return [...names].filter((name) => isConversationTool(name, options)).sort();
}
