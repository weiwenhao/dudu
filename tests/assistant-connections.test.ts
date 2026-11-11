// The connections of the connectors page (host/assistant/connectors/connections.mjs): what can be connected, what a click does, what is kept where, and what a
// collection is given. Everything outside it is a fake here: the server, the sign-in, the command line, the credential store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog } from '../host/assistant/connectors/catalog.mjs';
import { createConnections } from '../host/assistant/connectors/connections.mjs';
import { createConnectors } from '../host/assistant/connectors/index.mjs';
import { createState } from '../host/assistant/connectors/state.mjs';

const unauthorized = () => Object.assign(new Error('Unauthorized'), { code: 401 });

function world(t: any, extra: any = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-connections-'));
  const file = join(dir, 'CONNECTORS.md');
  const store = new Map<string, any>();
  const secrets = {
    read: async (id: string) => store.get(id),
    modify: async (id: string, fn: (record: any) => any) => { const next = fn(store.get(id)); if (next !== undefined) store.set(id, next); },
    remove: async (id: string) => { store.delete(id); },
  };
  const calls: any = { opened: [], authorized: [], forgotten: [], cancelled: [], ran: [], probed: [] };
  let signedIn = false;
  const tools = [
    { name: 'search', description: 'finds', inputSchema: { type: 'object' }, readOnly: true, annotations: { readOnlyHint: true } },
    { name: 'create-pages', description: 'makes', inputSchema: { type: 'object' }, readOnly: false, annotations: {} },
  ];
  const open = extra.open ?? (async (spec: any, options: any) => {
    calls.opened.push({ spec, hadProvider: Boolean(options?.authProvider) });
    if (spec.transport !== 'stdio' && !spec.headers?.Authorization && !signedIn && !/docs\.example|\/open\//.test(spec.url)) throw unauthorized();
    return { tools: async () => tools, call: async (name: string, args: any) => ({ isError: false, content: [{ type: 'text', text: `${name}:${JSON.stringify(args)}` }] }), close: async () => {} };
  });
  const oauth = extra.oauth === null ? null : {
    providerFor: (id: string) => ({ id }),
    authorize: extra.authorize ?? (async (id: string, url: string, options: any) => { calls.authorized.push([id, url, options.displayName]); signedIn = true; return { ok: true }; }),
    cancel: (id: string) => { calls.cancelled.push(id); },
    forget: async (id: string) => { calls.forgotten.push(id); },
  };
  const connectors = createConnectors({ file, inUse: extra.inUse });
  const state = createState({ file: join(dir, 'connectors-state.json') });
  const connections = createConnections({
    connectors, state, secrets, oauth, open, ...(extra.catalog ? { catalog: extra.catalog } : {}),
    ...(extra.publisher ? { publisher: extra.publisher } : {}), warn: extra.warn ?? (() => {}),
    ...(extra.device ? { device: extra.device } : {}), ...(extra.openUrl ? { openUrl: extra.openUrl } : {}),
    probe: extra.probe ?? (async (url: string) => { calls.probed.push(url); return { auth: 'oauth' }; }),
    run: extra.run ?? (async (file: string, args: string[]) => { calls.ran.push([file, ...args]); return { code: 0, stdout: '{}', stderr: '', failed: null }; }),
    which: extra.which ?? ((command: string) => `/usr/bin/${command}`),
    here: extra.here ?? (async () => []),
  });
  t.after(async () => { await connections.close(); await connectors.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, file, connectors, state, store, calls, connections, read: () => readFileSync(file, 'utf8'), signIn: (value = true) => { signedIn = value; } };
}

test('connecting a hosted server that signs in: it is at once a connector that waits, the browser sign-in is asked for once, and then it is connected with its tools counted', async (t) => {
  const w = world(t);
  const answer = await w.connections.connect('notion');
  assert.deepEqual(answer, { outcome: 'success', id: 'notion' });
  assert.deepEqual(w.state.get('notion')?.status, 'waiting', 'it answers before the owner has signed in');
  assert.equal(w.connections.list().connectors[0].busy, true, 'and says that it is still being made, so that the page keeps reading');
  await w.connections.idle();
  assert.deepEqual(w.calls.authorized, [['notion', 'https://mcp.notion.com/mcp', 'Notion']]);
  assert.equal(w.calls.opened[0].hadProvider, true, 'the transport signs in with what is stored');
  assert.match(w.read(), /## Notion\n<!-- id: notion \| source: owner \| kind: mcp \| via: notion -->\n\n```json\n\{"url":"https:\/\/mcp\.notion\.com\/mcp"\}\n```/);
  const row = w.connections.list().connectors[0];
  assert.deepEqual([row.id, row.icon, row.kind, row.custom, row.about, row.state], ['notion', 'notion', 'mcp', false, { kind: 'remote', host: 'mcp.notion.com', tools: 2 }, null]);
  assert.deepEqual([row.line, row.text, row.busy], ['页面、数据库和评论', undefined, false], 'one made from the catalog has its line, and no box to edit');
});

test('a sign-in that is cancelled, times out or is refused leaves the connector asking for it again, and cancel stops one that waits', async (t) => {
  const refused = world(t, { authorize: async () => ({ ok: false, reason: 'cancelled' }) });
  await refused.connections.connect('notion');
  await refused.connections.idle();
  assert.equal(refused.state.get('notion')?.status, 'needs-auth');
  const late = world(t, { authorize: async () => ({ ok: false, reason: 'timeout', message: 'x' }) });
  await late.connections.connect('linear');
  await late.connections.idle();
  assert.deepEqual([late.state.get('linear')?.status, late.state.get('linear')?.message], ['error', 'timeout']);
  const waiting = world(t, { authorize: (_id: string, _url: string, { signal }: any) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' }))) });
  await waiting.connections.connect('sentry');
  assert.equal(waiting.state.get('sentry')?.status, 'waiting');
  waiting.connections.cancel('sentry');
  await waiting.connections.idle();
  assert.deepEqual([waiting.state.get('sentry')?.status, waiting.calls.cancelled], ['needs-auth', ['sentry']]);
  assert.equal((await waiting.connections.retry('nothing')).outcome, 'needs_clarification');
});

test('disconnecting removes the entry, the secrets, the sign-in and the state; one that collectors read through stays', async (t) => {
  const w = world(t, { inUse: (id: string) => (id === 'linear' ? ['Linear 事项'] : []) });
  await w.connections.connect('notion');
  await w.connections.connect('linear');
  await w.connections.idle();
  await (w.store.set('notion', { token: 'x' }), Promise.resolve());
  const refused: any = await w.connections.remove('linear');
  assert.deepEqual([refused.outcome, refused.code, refused.collectors], ['needs_clarification', 'in_use', ['Linear 事项']]);
  assert.equal(w.state.get('linear')?.status, 'connected');
  const gone: any = await w.connections.remove('notion');
  assert.equal(gone.outcome, 'success');
  assert.deepEqual([w.store.has('notion'), w.state.get('notion'), w.calls.forgotten], [false, null, ['notion']]);
  assert.ok(!w.read().includes('## Notion'));
  assert.equal(typeof gone.undo, 'string', 'the entry can be brought back');
});

// What is connected is given to DSH (publish.mjs is tested on its own): when, with what, and when it is taken back.
function fakePublisher(answer: any = { ok: true }) {
  const calls: any = { publish: [], withdraw: [], closed: 0 };
  const there = new Set<string>();
  return {
    calls,
    publish: async (item: any) => { calls.publish.push(item); const result = typeof answer === 'function' ? answer(item) : answer; if (result.ok) there.add(item.id); return result; },
    withdraw: async (id: string) => { calls.withdraw.push(id); there.delete(id); },
    has: (id: string) => there.has(id),
    close: async () => { calls.closed++; },
  };
}

test('a connection that works is given to DSH with what it is and its secrets, and the list says it is in the sessions', async (t) => {
  const publisher = fakePublisher();
  const w = world(t, { publisher });
  await w.connections.connect('notion');
  await w.connections.idle();
  assert.deepEqual(publisher.calls.publish.map((item: any) => [item.id, item.name, item.spec, item.secret]), [['notion', 'Notion', { url: 'https://mcp.notion.com/mcp' }, {}]]);
  assert.equal(w.connections.list().connectors.find((item: any) => item.id === 'notion').inSessions, true);

  await w.connections.add({ text: 'https://example.test/mcp', token: 'tok', name: 'Srv' });
  await w.connections.idle();
  assert.deepEqual(publisher.calls.publish.at(-1).secret, { token: 'tok' }, 'the token a connector holds goes with it, to be put in DSH\'s credentials');
  await w.connections.update({ id: 'srv', token: 'tok-2' });
  await w.connections.idle();
  assert.deepEqual(publisher.calls.publish.at(-1).secret, { token: 'tok-2' }, 'a new token is given again');
});

test('a connection that does not work is not given: the one that needs a sign-in is taken back, one that only failed is left where it is, and a prompt has no tools', async (t) => {
  const publisher = fakePublisher();
  const w = world(t, { publisher, authorize: async () => ({ ok: false, reason: 'cancelled', message: 'cancelled' }) });
  await w.connections.connect('notion');
  await w.connections.idle();
  assert.equal(w.state.get('notion').status, 'needs-auth');
  assert.deepEqual(publisher.calls.publish, [], 'nothing was given');
  assert.deepEqual(publisher.calls.withdraw, ['notion'].slice(0, 0), 'a sign-in that was cancelled leaves what was given as it is');

  const failing = fakePublisher();
  const e = world(t, { publisher: failing, open: async () => { throw Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }); } });
  await e.connections.connect('notion');
  await e.connections.idle();
  assert.equal(e.state.get('notion').status, 'error');
  assert.deepEqual(failing.calls.withdraw, [], 'a server that could not be reached for a moment stays in DSH, which reconnects by itself');

  const prompt = fakePublisher();
  const m = world(t, { publisher: prompt });
  await m.connections.add({ text: '用 gws 读邮件', name: 'Mail' });
  assert.deepEqual(prompt.calls.publish, []);
});

test('disconnecting takes the connector out of DSH first; closing lets all of it go', async (t) => {
  const publisher = fakePublisher();
  const w = world(t, { publisher });
  await w.connections.connect('notion');
  await w.connections.idle();
  await w.connections.remove('notion');
  assert.deepEqual(publisher.calls.withdraw, ['notion']);
  assert.equal(w.connections.list().connectors.length, 0);
  await w.connections.close();
  assert.equal(publisher.calls.closed, 1);
});

// GitHub: its authorization server registers no client, so dudu signs in with a code the owner enters on GitHub's page (device.mjs, RFC 8628), and the token is kept in
// the credential store like one pasted by hand. The read-only address is the one connected.
test('a server signed in to by a device code: the code is on the row while it waits, the browser is sent to the page for it, the token goes to the store only, and the connector connects with it', async (t) => {
  const catalog = loadCatalog({ groups: ['dev'], items: [{ id: 'github', name: 'GitHub', group: 'dev', icon: 'github', line: 'x', how: 'device', url: 'https://mcp.example/readonly', clientId: 'client-1', scope: 'repo', deviceUrl: 'https://login.example/device/code', tokenUrl: 'https://login.example/token' }] });
  const seen: any = { asked: [], opened: [] };
  let release: (value: any) => void = () => {};
  const device = {
    requestCode: async (options: any) => { seen.asked.push(options); return { ok: true, userCode: 'ABCD-1234', verificationUri: 'https://login.example/device', deviceCode: 'dev-1', interval: 5, expiresIn: 900 }; },
    waitForToken: (options: any) => { seen.waited = options; return new Promise((resolve) => { release = resolve; }); },
  };
  const w = world(t, { catalog, device, openUrl: async (url: string) => { seen.opened.push(url); } });
  assert.deepEqual(await w.connections.connect('github'), { outcome: 'success', id: 'github' });
  for (let n = 0; n < 20 && !seen.waited; n++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([seen.asked[0].clientId, seen.asked[0].scope, seen.opened], ['client-1', 'repo', ['https://login.example/device']]);
  assert.deepEqual([w.state.get('github')?.status, w.state.get('github')?.code], ['waiting', 'ABCD-1234']);
  assert.deepEqual(w.connections.list().connectors[0].state, { status: 'waiting', code: 'ABCD-1234' }, 'the row carries the code the owner types in the browser');
  release({ ok: true, token: 'gho_secret', scope: 'repo' });
  await w.connections.idle();
  assert.equal(w.state.get('github')?.status, 'connected');
  assert.deepEqual(w.store.get('github'), { token: 'gho_secret' });
  assert.equal(w.calls.opened.at(-1).spec.headers.Authorization, 'Bearer gho_secret', 'the server is opened with that token');
  assert.ok(!w.read().includes('gho_secret') && !JSON.stringify(w.connections.list()).includes('gho_secret'), 'and it is in neither the file nor the list');
  // Connected already: another click only looks, and asks for no new code.
  await w.connections.retry('github');
  await w.connections.idle();
  assert.equal(seen.asked.length, 1);
});

test('a device sign-in that is not approved asks again; a code that ran out or a server that did not answer is an error; cancel ends the wait; a token the server refuses is replaced', async (t) => {
  const catalog = loadCatalog({ groups: ['dev'], items: [{ id: 'github', name: 'GitHub', group: 'dev', icon: 'github', line: 'x', how: 'device', url: 'https://mcp.example/readonly', clientId: 'c', scope: 'repo', deviceUrl: 'https://login.example/device/code', tokenUrl: 'https://login.example/token' }] });
  const code = async () => ({ ok: true, userCode: 'AAAA-1111', verificationUri: 'https://login.example/device', deviceCode: 'd', interval: 5, expiresIn: 900 });
  const outcome = async (device: any) => {
    const w = world(t, { catalog, device, openUrl: async () => { throw new Error('no browser'); } });
    await w.connections.connect('github');
    await w.connections.idle();
    return w;
  };
  const denied = await outcome({ requestCode: code, waitForToken: async () => ({ ok: false, reason: 'denied', message: 'x' }) });
  assert.equal(denied.state.get('github')?.status, 'needs-auth');
  assert.equal(denied.store.get('github'), undefined);
  const expired = await outcome({ requestCode: code, waitForToken: async () => ({ ok: false, reason: 'expired', message: 'x' }) });
  assert.deepEqual([expired.state.get('github')?.status, expired.state.get('github')?.message], ['error', 'timeout']);
  const down = await outcome({ requestCode: async () => ({ ok: false, reason: 'failed', message: 'device_flow_disabled' }), waitForToken: async () => { throw new Error('not reached'); } });
  assert.deepEqual([down.state.get('github')?.status, down.state.get('github')?.message], ['error', 'device_flow_disabled']);
  const waiting = world(t, { catalog, device: { requestCode: code, waitForToken: ({ signal }: any) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled', message: 'x' }))) } });
  await waiting.connections.connect('github');
  for (let n = 0; n < 20 && waiting.state.get('github')?.code === undefined; n++) await new Promise((resolve) => setImmediate(resolve));
  waiting.connections.cancel('github');
  await waiting.connections.idle();
  assert.equal(waiting.state.get('github')?.status, 'needs-auth');
  // A kept token that the server no longer takes is not shown as an error to read: a new code is asked for.
  const stale = world(t, { catalog, device: { requestCode: code, waitForToken: async () => ({ ok: true, token: 'fresh', scope: '' }) },
    open: async (spec: any) => {
      if (spec.headers?.Authorization === 'Bearer old') throw unauthorized();
      return { tools: async () => [], call: async () => ({}), close: async () => {} };
    } });
  await stale.connections.connect('github');
  await stale.connections.idle();
  stale.store.set('github', { token: 'old' });
  await stale.connections.retry('github');
  await stale.connections.idle();
  assert.deepEqual([stale.state.get('github')?.status, stale.store.get('github')], ['connected', { token: 'fresh' }]);
});
