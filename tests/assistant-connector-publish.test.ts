// What a connected MCP connector gives DSH (host/assistant/connectors/publish.mjs): the name of the server, what DSH's MCP client is mounted with, the renewing of a sign-in's
// token (the server is mounted again with the new one), and letting go. DSH's MCP client, the sign-in and the clock are fakes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPublisher } from '../host/assistant/connectors/publish.mjs';

const LEAD = 5 * 60_000;

function world(extra: any = {}) {
  const mounted = new Map<string, any>();
  const ended: string[] = [];
  const mounts: any[] = [];
  const mount = extra.mount === null ? undefined : async (config: any) => {
    if (extra.refuse?.(config)) throw new Error(extra.refuse(config));
    mounts.push(config);
    mounted.set(config.serverName, config);
    return { dispose: () => { mounted.delete(config.serverName); ended.push(config.serverName); } };
  };
  // the clock: a timer is a callback and the time it was asked for
  const timers: { fn: () => void; wait: number; live: boolean }[] = [];
  const setTimer = (fn: () => void, wait: number) => { const timer = { fn, wait, live: true, unref() {} }; timers.push(timer); return timer; };
  const clearTimer = (timer: any) => { if (timer) timer.live = false; };
  const live = () => timers.filter((timer) => timer.live);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const fire = async () => { const [timer] = live(); assert.ok(timer, 'there is a timer'); timer.live = false; timer.fn(); await tick(); await tick(); };

  // the sign-in: what status says, and what the token is each time it is asked for
  const asked: any[] = [];
  const answers: any[] = extra.tokens ?? [];
  const oauth = extra.oauth === null ? null : {
    status: async () => extra.status ?? 'signed-in',
    providerFor: (id: string, url: string, options: any) => ({
      tokens: async () => { asked.push([id, url, options]); const next = answers.length > 1 ? answers.shift() : answers[0]; if (next instanceof Error) throw next; return next; },
    }),
  };
  const warnings: string[] = [];
  const lost: any[] = [];
  const publisher = createPublisher({ mount, oauth, setTimer, clearTimer, warn: (text: string) => warnings.push(text), onLost: (...args: any[]) => lost.push(args) });
  return { publisher, mounted, mounts, ended, live, fire, tick, asked, warnings, lost };
}

const remote = { url: 'https://mcp.example.com/mcp' };
const tokens = (access: string, seconds = 3600) => ({ access_token: access, token_type: 'Bearer', expires_in: seconds });

test('a server with a token of its own is mounted with it, as DSH\'s MCP client wants it, and is not renewed', async () => {
  const w = world();
  const result = await w.publisher.publish({ id: 'stand-in', name: 'Stand-in', spec: remote, secret: { token: 'tok-1' } });
  assert.deepEqual(result, { ok: true, server: 'stand-in' });
  const config = w.mounted.get('stand-in');
  assert.deepEqual([config.transport, config.url, config.failOnStartupError], ['streamable-http', remote.url, false]);
  assert.deepEqual(config.headers, { Authorization: 'Bearer tok-1' });
  assert.equal(w.publisher.has('stand-in'), true);
  assert.deepEqual(w.publisher.published(), [{ id: 'stand-in', server: 'stand-in' }]);
  assert.equal(w.live().length, 0, 'a token that is not a sign-in is not renewed');
});

test('a sign-in gives its access token, which is renewed five minutes before it ends: the server is mounted again with the new one', async () => {
  const w = world({ tokens: [tokens('acc-1'), tokens('acc-2')] });
  const result = await w.publisher.publish({ id: 'notion', name: 'Notion', spec: { url: 'https://mcp.notion.com/mcp' }, secret: {} });
  assert.deepEqual(result, { ok: true, server: 'notion' });
  assert.deepEqual(w.mounted.get('notion').headers, { Authorization: 'Bearer acc-1' });
  assert.deepEqual(w.asked[0], ['notion', 'https://mcp.notion.com/mcp', { refreshLeadMs: LEAD }], 'the sign-in is asked to renew five minutes early');
  assert.equal(w.live().length, 1);
  assert.equal(w.live()[0].wait, 3600_000 - LEAD + 2_000);

  await w.fire();
  assert.deepEqual(w.mounted.get('notion').headers, { Authorization: 'Bearer acc-2' });
  assert.deepEqual(w.ended, ['notion'], 'the old connection was ended');
  assert.equal(w.mounted.size, 1);
  assert.equal(w.live().length, 1, 'and the next renewal is waiting');
});

test('a grant the server dropped takes the server out of DSH again, and says so', async () => {
  const w = world({ tokens: [tokens('acc-1'), undefined] });
  await w.publisher.publish({ id: 'notion', name: 'Notion', spec: remote, secret: {} });
  await w.fire();
  assert.equal(w.mounted.size, 0);
  assert.deepEqual(w.ended, ['notion']);
  assert.equal(w.publisher.has('notion'), false);
  assert.deepEqual(w.lost, [['notion', 'needs-auth']]);
  assert.equal(w.live().length, 0);
});

test('a server DSH will not mount is not given and nothing stays of it, and what it said is not the secret', async () => {
  const w = world({ refuse: (config: any) => (config.serverName === 'notion' ? 'MCP server name "notion" is already taken' : ''), status: 'none' });
  const result = await w.publisher.publish({ id: 'notion', name: 'Notion', spec: remote, secret: { token: 'tok-secret' } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /already taken/);
  assert.equal(w.publisher.has('notion'), false);
  assert.ok(![result.reason, ...w.warnings].join(' ').includes('tok-secret'));

  // one that was given and cannot be mounted again with its new token is not in DSH any more, and the record goes with it
  await w.publisher.publish({ id: 'ok', name: 'Ok', spec: remote, secret: { token: 'one' } });
  const refused = world({ refuse: (config: any) => (config.headers?.Authorization === 'Bearer two' ? 'boom' : ''), status: 'none' });
  await refused.publisher.publish({ id: 'ok', name: 'Ok', spec: remote, secret: { token: 'one' } });
  assert.equal((await refused.publisher.publish({ id: 'ok', name: 'Ok', spec: remote, secret: { token: 'two' } })).ok, false);
  assert.equal(refused.publisher.has('ok'), false);
  assert.equal(refused.mounted.size, 0);
});

test('letting go takes the server and its timer', async () => {
  const w = world({ tokens: [tokens('acc-1')] });
  await w.publisher.publish({ id: 'notion', name: 'Notion', spec: remote, secret: {} });
  await w.publisher.publish({ id: 'plain', name: 'Plain', spec: remote, secret: { token: 'tok' } });
  await w.publisher.withdraw('notion');
  assert.deepEqual([...w.mounted.keys()], ['plain']);
  assert.equal(w.live().length, 0);
  await w.publisher.withdraw('notion'); // twice is nothing
  assert.deepEqual(w.ended, ['notion']);
});

test('one connector is done one thing at a time: a new publish waits for the one before it', async () => {
  const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  const slow = createPublisher({
    mount: async (config: any) => {
      const name = config.headers.Authorization;
      order.push(`start ${name}`);
      if (first) { first = false; await held; }
      order.push(`end ${name}`);
      return { dispose: () => { order.push(`dispose ${name}`); } };
    },
    oauth: null,
  });
  const one = slow.publish({ id: 'x', name: 'X', spec: remote, secret: { token: 'a' } });
  const two = slow.publish({ id: 'x', name: 'X', spec: remote, secret: { token: 'b' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start Bearer a'], 'the second waits for the first');
  release();
  await Promise.all([one, two]);
  assert.deepEqual(order, ['start Bearer a', 'end Bearer a', 'dispose Bearer a', 'start Bearer b', 'end Bearer b']);
});
