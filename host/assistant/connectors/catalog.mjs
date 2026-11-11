// The catalog the connectors page ships with (catalog-data.mjs; docs/assistant.md 3.1, 目录): the services dudu knows how to connect, each with an icon key, one line and how
// it connects. This file reads it, checks it (a bad item is a bug of ours, so it stops the load with the reason), and says which items are still to connect.
//
//   const catalog = loadCatalog()                    -> { groups, items: [item], here: [item], byId(id) }
//   item = { id, name, group, icon, line, how: 'oauth' | 'device' | 'open' | 'cli', url?, clientId?, scope?, deviceUrl?, tokenUrl?, command?, status?, ready?, login?, install?, prompt? }
//   how  oauth    a hosted MCP server that signs the owner in in the browser        (url)
//        device   a hosted MCP server whose authorization server cannot register a client by itself, so dudu has a client of its own: the owner is given a code to
//                 enter on the service's page (RFC 8628, device.mjs)  (url, clientId, scope, deviceUrl, tokenUrl). An item whose `clientId` is empty is not offered at all:
//                 the client is registered with the service by the owner of the project, and until it is there is nothing to sign in with
//        open     a hosted MCP server that needs no sign-in                         (url)
//        cli      a command-line tool the owner signs in to by itself; connecting checks that it is there and, when `status` (the words after the command) is given, that it
//                 exits 0 and, when `ready` { path, equals } is given, that its JSON output has that value at that path; `login` and `install` are what to tell the owner (a command to run, or the address of the page to get it from)
import shipped from './catalog-data.mjs';

const HOWS = ['oauth', 'device', 'open', 'cli'];
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function check(item, groups, seen) {
  const where = `catalog item ${item?.id ?? '?'}`;
  const bad = (why) => { throw new Error(`${where}: ${why}`); };
  if (!ID.test(item.id ?? '')) bad('the id must be lowercase letters, digits, dash or underscore');
  if (seen.has(item.id)) bad('the id is there twice');
  seen.add(item.id);
  if (typeof item.name !== 'string' || !item.name.trim()) bad('it needs a name');
  if (typeof item.line !== 'string' || !item.line.trim()) bad('it needs a line');
  if (!HOWS.includes(item.how)) bad(`how must be one of ${HOWS.join(', ')}`);
  if (groups && !groups.includes(item.group)) bad(`the group must be one of ${groups.join(', ')}`);
  if (item.how === 'oauth' || item.how === 'open' || item.how === 'device') {
    let url;
    try { url = new URL(item.url); } catch { bad('it needs an address'); }
    if (url.protocol !== 'https:') bad('the address must be https');
    if (item.how === 'device') {
      if (typeof item.clientId !== 'string') bad('it needs a clientId (empty until the client is registered)');
      if (typeof item.scope !== 'string') bad('it needs a scope');
      for (const key of ['deviceUrl', 'tokenUrl']) {
        let address;
        try { address = new URL(item[key]); } catch { bad(`${key} must be an address`); }
        if (address.protocol !== 'https:') bad(`${key} must be https`);
      }
    }
  } else {
    if (typeof item.command !== 'string' || !item.command.trim() || /\s/.test(item.command)) bad('it needs the name of a command');
    if (typeof item.prompt !== 'string' || !item.prompt.trim()) bad('it needs the sentence that says how to read it');
    if (item.status !== undefined && !(Array.isArray(item.status) && item.status.every((word) => typeof word === 'string'))) bad('status is the words after the command');
    if (item.ready !== undefined && !(typeof item.ready?.path === 'string' && 'equals' in item.ready && item.status)) bad('ready needs a status command and { path, equals }');
  }
}

/** The catalog from `data` (the one that ships by default). */
export function loadCatalog(data = shipped) {
  const seen = new Set();
  for (const item of data.items) check(item, data.groups, seen);
  for (const item of data.here ?? []) check({ group: 'here', ...item }, ['here'], seen);
  // What cannot be signed in to yet (no client registered) is not in the catalog.
  const items = data.items.filter((item) => item.how !== 'device' || item.clientId);
  const all = [...items, ...(data.here ?? [])];
  return { groups: data.groups, items, here: data.here ?? [], byId: (id) => all.find((item) => item.id === id) ?? null };
}
