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
    deliver: (id: string, url: string) => (extra.deliver ? extra.deliver(id, url) : false),
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

test('a server found in another tool wears the logo its name says, as the connector made from it will, and a plain one the sign of its kind', async (t) => {
  const w = world(t, { here: async () => [
    { id: 'here-a', key: 'a', name: 'notion', spec: { transport: 'http', url: 'https://mcp.notion.com/mcp' }, line: 'mcp.notion.com' },
    { id: 'here-b', key: 'b', name: 'drawio', spec: { transport: 'stdio', command: 'npx' }, line: 'npx' },
    { id: 'here-c', key: 'c', name: 'internal', spec: { transport: 'http', url: 'https://mcp.example/mcp' }, line: 'mcp.example' },
  ] });
  const view = await w.connections.catalogView();
  const here = view.groups.find((group: any) => group.id === 'here').items;
  assert.deepEqual(here.map((item: any) => [item.name, item.icon]), [['notion', 'notion'], ['drawio', 'terminal'], ['internal', 'plug']]);
});

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

// A first connection that does not work leaves nothing behind (owner, 2026-11-23, after GitLab and Sentry had stayed red for days): the item is to connect again, and what
// came of it is told to the page that tried it. One that was connected before keeps asking.
test('a first connection that is cancelled, times out or is refused leaves nothing behind and says once what came of it; one connected before keeps asking', async (t) => {
  const refused = world(t, { authorize: async () => ({ ok: false, reason: 'cancelled' }) });
  await refused.connections.connect('notion');
  await refused.connections.idle();
  assert.deepEqual([refused.state.get('notion'), refused.connections.list().connectors.length], [null, 0]);
  assert.doesNotMatch(refused.read(), /notion/);
  assert.deepEqual(refused.connections.list().attempts.map((attempt: any) => [attempt.id, attempt.from, attempt.status]), [['notion', 'notion', 'needs-auth']]);
  assert.ok((await refused.connections.catalogView()).groups.some((group: any) => group.items.some((item: any) => item.id === 'notion')), 'the item is to connect again');
  const late = world(t, { authorize: async () => ({ ok: false, reason: 'timeout', message: 'x' }) });
  await late.connections.connect('linear');
  await late.connections.idle();
  assert.deepEqual(late.connections.list().attempts.map((attempt: any) => [attempt.status, attempt.message]), [['error', 'timeout']]);
  const waiting = world(t, { authorize: (_id: string, _url: string, { signal }: any) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' }))) });
  await waiting.connections.connect('sentry');
  assert.equal(waiting.state.get('sentry')?.status, 'waiting');
  assert.deepEqual((await waiting.connections.catalogView()).trying?.map((item: any) => [item.id, item.group, item.connector]), [['sentry', 'dev', 'sentry']], 'a page finds the item being tried where it is');
  await waiting.connections.cancel('sentry');
  await waiting.connections.idle();
  assert.deepEqual([waiting.state.get('sentry'), waiting.calls.cancelled], [null, ['sentry']]);
  assert.equal((await waiting.connections.retry('nothing')).outcome, 'needs_clarification');
  let refuse = false;
  const kept: any = world(t, { authorize: async () => { if (refuse) return { ok: false, reason: 'cancelled' }; kept.signIn(true); return { ok: true }; } });
  await kept.connections.connect('notion');
  await kept.connections.idle();
  assert.equal(kept.state.get('notion')?.status, 'connected');
  refuse = true;
  kept.signIn(false);
  await kept.connections.retry('notion');
  await kept.connections.idle();
  assert.equal(kept.state.get('notion')?.status, 'needs-auth', 'a connector that was connected before is not let go of');
});

test('one made before (2026-11-23) whose sign-in failed and that holds no sign-in at all is let go of when the plugin starts; one that holds one stays', async (t) => {
  const first: any = world(t, { authorize: async () => ({ ok: false, reason: 'timeout', message: 'x' }) });
  // as the plugin of before left them: an entry from the catalog, in error, with no mark of a first connection
  first.connectors.owner.add({ id: 'gitlab', name: 'GitLab', kind: 'mcp', spec: { url: 'https://gitlab.com/api/v4/mcp' }, via: 'gitlab' });
  first.connectors.owner.add({ id: 'sentry', name: 'Sentry', kind: 'mcp', spec: { url: 'https://mcp.sentry.dev/mcp' }, via: 'sentry' });
  first.state.set('gitlab', { status: 'error', message: 'timeout' });
  first.state.set('sentry', { status: 'error', message: 'down' });
  const again = createConnections({ connectors: first.connectors, state: first.state, secrets: { read: async () => undefined, modify: async () => {}, remove: async () => {} },
    oauth: { providerFor: () => ({}), authorize: async () => ({ ok: true }), cancel: () => {}, forget: async () => {}, status: async (id: string) => (id === 'sentry' ? 'signed-in' : 'none') },
    here: async () => [], warn: () => {} });
  t.after(() => again.close());
  await again.idle();
  assert.deepEqual(again.list().connectors.map((entry: any) => entry.id), ['sentry']);
});

// The phone signs in on the phone (owner, 2026-11-23: 「在手机上点，就在手机上连接吧」): it is given the page, its browser view stops at the redirect, and the address comes back.
test('a sign-in on the phone: the page goes to the phone and not to this computer\'s browser, the address it stopped at connects it; one it gives up leaves nothing', async (t) => {
  const box: any = {};
  const w: any = world(t, {
    deliver: (_id: string, url: string) => box.deliver?.(url) ?? false,
    authorize: (id: string, _url: string, options: any) => {
      w.calls.authorized.push([id, options.elsewhere]);
      return new Promise((resolve) => {
        box.deliver = (url: string) => { if (!url.includes('state=ok')) return false; w.signIn(true); resolve({ ok: true }); return true; };
        options.signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' }));
        options.onUrl('https://linear.example/authorize?state=ok');
      });
    },
  });
  assert.deepEqual(await w.connections.signIn('linear'), { outcome: 'success', id: 'linear', url: 'https://linear.example/authorize?state=ok' });
  assert.deepEqual(w.calls.authorized, [['linear', true]]);
  assert.equal((await w.connections.finishSignIn('linear', 'http://127.0.0.1:3171/oauth/callback?code=c&state=forged')).outcome, 'needs_clarification');
  const done = await w.connections.finishSignIn('linear', 'http://127.0.0.1:3171/oauth/callback?code=c&state=ok');
  assert.deepEqual([done.outcome, done.status, done.tools], ['success', 'connected', 2]);
  assert.equal(w.connections.list().connectors[0].fresh, undefined, 'connected: a connector like any other');

  const given: any = world(t, { authorize: (_id: string, _url: string, options: any) => new Promise((resolve) => { options.signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' })); options.onUrl('https://sentry.example/authorize'); }) });
  assert.equal((await given.connections.signIn('sentry')).url, 'https://sentry.example/authorize');
  await given.connections.cancel('sentry');
  await given.connections.idle();
  assert.deepEqual([given.connections.list().connectors.length, given.state.get('sentry')], [0, null]);
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
  assert.equal(w.state.get('notion'), null, 'a first connection that was not signed in to is let go of');
  assert.deepEqual(publisher.calls.publish, [], 'nothing was given');
  assert.deepEqual(publisher.calls.withdraw, ['notion'].slice(0, 0), 'a sign-in that was cancelled leaves what was given as it is');

  const failing = fakePublisher();
  const e = world(t, { publisher: failing, open: async () => { throw Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }); } });
  await e.connections.connect('notion');
  await e.connections.idle();
  assert.equal(e.connections.list().attempts[0]?.status, 'error');
  assert.deepEqual(failing.calls.withdraw, [], 'a server that could not be reached is not taken back from DSH: it was not given');

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
  assert.deepEqual(w.connections.list().connectors[0].state, { status: 'waiting', code: 'ABCD-1234', url: 'https://login.example/device', fresh: true }, 'the row carries the code the owner types in the browser, and where');
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
  // A first connection: what came of it is told once, and nothing is kept (above).
  const attempt = (w: any) => { const found = w.connections.list().attempts[0]; return [found?.status, found?.message]; };
  const denied = await outcome({ requestCode: code, waitForToken: async () => ({ ok: false, reason: 'denied', message: 'x' }) });
  assert.deepEqual(attempt(denied), ['needs-auth', undefined]);
  assert.equal(denied.store.get('github'), undefined);
  const expired = await outcome({ requestCode: code, waitForToken: async () => ({ ok: false, reason: 'expired', message: 'x' }) });
  assert.deepEqual(attempt(expired), ['error', 'timeout']);
  const down = await outcome({ requestCode: async () => ({ ok: false, reason: 'failed', message: 'device_flow_disabled' }), waitForToken: async () => { throw new Error('not reached'); } });
  assert.deepEqual(attempt(down), ['error', 'device_flow_disabled']);
  const waiting = world(t, { catalog, device: { requestCode: code, waitForToken: ({ signal }: any) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled', message: 'x' }))) } });
  await waiting.connections.connect('github');
  for (let n = 0; n < 20 && waiting.state.get('github')?.code === undefined; n++) await new Promise((resolve) => setImmediate(resolve));
  await waiting.connections.cancel('github');
  await waiting.connections.idle();
  assert.equal(waiting.state.get('github'), null);
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
