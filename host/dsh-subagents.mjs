/** Current children come from DSH's subagent catalog; older hosts also publish a Team roster. */
export function sessionChildren(values = {}) {
  const children = new Map();
  for (const member of Array.isArray(values?.agentTeam?.members) ? values.agentTeam.members : []) {
    if (typeof member?.id === 'string' && member.id) children.set(member.id, { ...member });
  }
  for (const child of Array.isArray(values?.subagentCatalog) ? values.subagentCatalog : []) {
    if (typeof child?.id === 'string' && child.id) children.set(child.id, { ...children.get(child.id), ...child });
  }
  return [...children.values()];
}
