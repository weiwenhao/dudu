const readers = new WeakMap();

// Scope preview identity to the connection's request function, not to a mounted widget or dialog.
export function sessionReader(request) {
  if (!readers.has(request)) readers.set(request, ({ provider, id, before, query }, options) => request(
    'sessions/read', { provider, id, ...(before ? { before } : {}), ...(query ? { query } : {}) }, options,
  ));
  return readers.get(request);
}
