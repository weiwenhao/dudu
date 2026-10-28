// The access mode a session is in, as the harness drivers name it. DSH keeps it in the session's log as a preset
// name plus the sandbox and approval settings it set; the settings are what execution follows, so they win.

export function permissionOfState(state) {
  if (!state) return undefined;
  if (state.preset === 'auto') return 'auto';
  if (state.sandbox === 'danger-full-access') return 'danger-full-access';
  if (state.sandbox === 'read-only') return 'read-only';
  if (state.sandbox === 'workspace-write') return 'workspace-write';
  return state.preset ?? undefined;
}

export function permissionOf(projections, agent) {
  try { return permissionOfState(projections?.stateOf(agent.session, 'permissions')); }
  catch { return undefined; }
}
