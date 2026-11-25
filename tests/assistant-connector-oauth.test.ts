// Sign-in for remote MCP servers: host/assistant/connectors/oauth/. Run alone:
//   node --experimental-strip-types --test tests/assistant-connector-oauth.test.ts
// The authorization server is the MCP SDK's own (its router and demo provider, with refresh tokens added), the resource
// server is an SDK McpServer behind its bearer middleware, the browser is a fetch of the URL that was to be opened. All of
// it on 127.0.0.1; nothing leaves the machine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import express from 'express';
import * as z from 'zod/v4';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DemoInMemoryAuthProvider } from '@modelcontextprotocol/sdk/examples/server/demoInMemoryOAuthProvider.js';
import { InvalidClientError, InvalidGrantError, InvalidTokenError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createOAuthMetadata, getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createOAuth, isNeedsSignIn } from '../host/assistant/connectors/oauth/index.mjs';

const OK = (name: string) => `已连接 ${name}。可以回到嘟嘟了。`;
const FAILED = (name: string) => `没有连上 ${name}。回到嘟嘟，再点一次“授权”。`;

// The same check DSH's credential records make: a payload must survive a JSON round trip, so no `undefined`.
function assertJson(value: any, where = 'record') {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value), `${where} holds a non-finite number`); return; }
  assert.ok(value && typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype), `${where} holds a value JSON cannot represent`);
  for (const [key, nested] of Object.entries(value)) assertJson(nested, `${where}.${key}`);
}

// A store with DSH's contract: async, modify exclusive (one at a time, as across processes), undefined leaves the record.
function memoryStore() {
  const records = new Map<string, string>();
  let lock: Promise<unknown> = Promise.resolve();
  const store: any = {
    writes: 0, failWrites: false, failLock: false, failReads: false, parallel: false,
    async read(id: string) {
      if (store.failReads) throw new Error('the store cannot be read');
      return records.has(id) ? JSON.parse(records.get(id)!) : undefined;
    },
    modify(id: string, fn: any) {
      const run = (store.parallel ? Promise.resolve() : lock).then(async () => {
        if (store.failLock) throw new Error('timed out waiting for the writer lock');
        const next = await fn(records.has(id) ? JSON.parse(records.get(id)!) : undefined);
        if (next === undefined) return;
        assertJson(next);
        if (store.failWrites) throw new Error('the store cannot be written');
        store.writes++;
        records.set(id, JSON.stringify(next));
      });
      if (!store.parallel) lock = run.catch(() => {});
      return run;
    },
    async remove(id: string) {
      if (store.failWrites) throw new Error('the store cannot be written');
      records.delete(id);
    },
    peek: (id: string) => (records.has(id) ? JSON.parse(records.get(id)!) : undefined),
    poke: (id: string, record: any) => { records.set(id, JSON.stringify(record)); },
  };
  return store;
}

// The SDK's demo provider, with what a real server has and the demo leaves out: refresh tokens that rotate (using an old
// one is an error), a lifetime to choose, the `iss` of RFC 9207, and switches to make a step fail.
class TestAuth extends (DemoInMemoryAuthProvider as any) {
  lifetime = 3600;
  iss: string | undefined;
  denyWith: string | undefined;
  rejectCodes = false;
  refreshMode: 'ok' | 'invalid_grant' | 'invalid_client' | 'server_error' = 'ok';
  rotate = true; // false: a refresh answers without a new refresh token, and the old one stays good
  issueRefresh = true; // false: tokens with no refresh token at all
  gate: Promise<void> | undefined;
  refreshGate: Promise<void> | undefined;
  registrations: any[] = [];
  authorizations: any[] = [];
  codeExchanges: any[] = [];
  refreshes: any[] = [];
  refreshTokens = new Map<string, any>();

  async authorize(client: any, params: any, res: any) {
    this.authorizations.push({ client: client.client_id, ...params });
    const code = randomUUID();
    const search = new URLSearchParams(this.denyWith ? { error: this.denyWith } : { code });
    if (params.state !== undefined) search.set('state', params.state);
    if (this.iss !== undefined) search.set('iss', this.iss);
    (this as any).codes.set(code, { client, params });
    const target = new URL(params.redirectUri);
    target.search = search.toString();
    res.redirect(target.toString());
  }

  issue(clientId: string, scopes: string[], resource: any) {
    const access = randomUUID();
    const refresh = randomUUID();
    (this as any).tokens.set(access, { token: access, clientId, scopes, expiresAt: Date.now() + this.lifetime * 1000, resource, type: 'access' });
    if (!this.issueRefresh) return { access_token: access, token_type: 'bearer', expires_in: this.lifetime, scope: scopes.join(' ') };
    this.refreshTokens.set(refresh, { clientId, scopes, resource });
    return { access_token: access, token_type: 'bearer', expires_in: this.lifetime, refresh_token: refresh, scope: scopes.join(' ') };
  }

  async exchangeAuthorizationCode(client: any, code: string, _verifier: any, redirectUri: any, resource: any) {
    await this.gate;
    this.codeExchanges.push({ client: client.client_id, code, resource: resource?.href, redirectUri });
    const data = (this as any).codes.get(code);
    if (this.rejectCodes || !data) throw new InvalidGrantError('the code was not accepted');
    (this as any).codes.delete(code);
    return this.issue(client.client_id, data.params.scopes ?? [], data.params.resource);
  }

  async exchangeRefreshToken(client: any, refreshToken: string, _scopes: any, resource: any) {
    this.refreshes.push({ client: client.client_id, refreshToken, resource: resource?.href });
    await this.refreshGate;
    if (this.refreshMode === 'server_error') throw new ServerError('the server is having a bad day');
    if (this.refreshMode === 'invalid_client') throw new InvalidClientError('the client is not known here any more');
    const known = this.refreshTokens.get(refreshToken);
    if (this.refreshMode === 'invalid_grant' || !known || known.clientId !== client.client_id) throw new InvalidGrantError('the refresh token is not valid');
    if (!this.rotate) {
      const { refresh_token: _kept, ...withoutNewRefreshToken } = this.issue(client.client_id, known.scopes, known.resource);
      return withoutNewRefreshToken;
    }
    this.refreshTokens.delete(refreshToken);
    return this.issue(client.client_id, known.scopes, known.resource);
  }
  revokeAccessTokens() { (this as any).tokens.clear(); }
  revokeRefreshTokens() { this.refreshTokens.clear(); }
}

const listen = async (server: any) => { await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); return server.address().port as number; };
const closeServer = (server: any) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });

async function world(t: any, options: any = {}) {
  const auth = new TestAuth();
  const asServer = createServer();
  const rsServer = createServer();
  const asUrl = new URL(`http://127.0.0.1:${await listen(asServer)}`);
  const mcpUrl = `http://127.0.0.1:${await listen(rsServer)}/mcp`;
  const state: any = { metadata: {}, unauthenticated: 0, metadataRequests: 0, tokenRequests: 0 };
  // CIMD: the server knows the client by the URL of its document.
  const metadata: any = createOAuthMetadata({ provider: auth, issuerUrl: asUrl, scopesSupported: ['mcp:tools'] });
  const registerClient = auth.clientsStore.registerClient.bind(auth.clientsStore);
  auth.clientsStore.registerClient = async (info: any) => { auth.registrations.push(info); return registerClient(info); };

  const as = express();
  as.get('/.well-known/oauth-authorization-server', (_req: any, res: any) => { state.metadataRequests++; res.json({ ...metadata, ...state.metadata }); });
  as.use('/token', async (_req: any, _res: any, next: any) => { state.tokenRequests++; await auth.gate; next(); });
  as.use(mcpAuthRouter({
    provider: auth, issuerUrl: asUrl, scopesSupported: ['mcp:tools'],
    authorizationOptions: { rateLimit: false }, tokenOptions: { rateLimit: false }, clientRegistrationOptions: { rateLimit: false },
  }));
  asServer.on('request', as);

  const sseUrl = mcpUrl.replace(/\/mcp$/, '/sse');
  const verifier = { verifyAccessToken: async (token: string) => { try { return await auth.verifyAccessToken(token); } catch (error: any) { throw new InvalidTokenError(error.message); } } };
  // The demo's verifier throws a plain Error for a token it does not know, which the middleware answers with 500, not 401.
  const bearer = (url: string) => requireBearerAuth({ verifier, requiredScopes: ['mcp:tools'], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(url)) });
  const echoServer = () => {
    const server = new McpServer({ name: 'test', version: '1' });
    server.registerTool('echo', { description: 'echo', inputSchema: { text: z.string() } }, async ({ text }: any) => ({ content: [{ type: 'text', text }] }));
    return server;
  };
  const rs = express();
  rs.use(mcpAuthMetadataRouter({ oauthMetadata: metadata, resourceServerUrl: new URL(mcpUrl), scopesSupported: ['mcp:tools'], resourceName: 'test' }));
  rs.use(mcpAuthMetadataRouter({ oauthMetadata: metadata, resourceServerUrl: new URL(sseUrl), scopesSupported: ['mcp:tools'], resourceName: 'test (SSE)' }));
  const handle = async (req: any, res: any) => {
    if (req.method !== 'POST') { res.status(405).set('Allow', 'POST').end(); return; }
    const server = echoServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
  rs.use('/mcp', express.json(), (req: any, _res: any, next: any) => { if (!req.headers.authorization) state.unauthenticated++; next(); }, bearer(mcpUrl), handle);
  // The same server whose 401 does not say where its metadata is (Atlassian's is like that): found by its well-known address.
  const bareUrl = mcpUrl.replace(/\/mcp$/, '/bare');
  rs.use(mcpAuthMetadataRouter({ oauthMetadata: metadata, resourceServerUrl: new URL(bareUrl), scopesSupported: ['mcp:tools'], resourceName: 'test (bare)' }));
  rs.use('/bare', express.json(), requireBearerAuth({ verifier, requiredScopes: ['mcp:tools'] }), handle);
  // The older transport: a stream to GET and an endpoint to POST to.
  const streams = new Map<string, any>();
  rs.get('/sse', bearer(sseUrl), async (_req: any, res: any) => {
    const transport = new SSEServerTransport('/messages', res);
    streams.set(transport.sessionId, transport);
    res.on('close', () => streams.delete(transport.sessionId));
    await echoServer().connect(transport);
  });
  rs.post('/sse', bearer(sseUrl), (_req: any, res: any) => { res.status(404).end(); });
  rs.post('/messages', bearer(sseUrl), express.json(), async (req: any, res: any) => {
    const transport = streams.get(String(req.query.sessionId));
    if (!transport) { res.status(400).end(); return; }
    await transport.handlePostMessage(req, res, req.body);
  });
  rsServer.on('request', rs);
  t.after(async () => { await closeServer(asServer); await closeServer(rsServer); });

  // The browser: what openUrl was given, in order, and a way to wait for the next one.
  const urls: string[] = [];
  const waiting: any[] = [];
  let opens = 0;
  const openUrl = (url: string) => { opens++; const next = waiting.shift(); if (next) next(url); else urls.push(url); };
  const nextUrl = () => (urls.length ? Promise.resolve(urls.shift()!) : new Promise<string>((resolve) => waiting.push(resolve)));
  const store = options.store ?? memoryStore();
  const clock = { t: Date.now() };
  const make = (extra: any = {}) => createOAuth({ store, openUrl, now: () => clock.t, ports: [], timeoutMs: 8000, ...options.oauth, ...extra });
  return { auth, asUrl, mcpUrl, sseUrl, bareUrl, store, clock, state, metadata: state.metadata, make, oauth: make(), nextUrl, openUrl, opens: () => opens };
}

// What the user's browser does with the authorization URL: the server redirects to the loopback callback, which is then fetched.
async function visit(url: string, tamper?: (callback: URL) => void) {
  const answer = await fetch(url, { redirect: 'manual' });
  assert.equal(answer.status, 302, 'the authorization server redirects the browser');
  const callback = new URL(answer.headers.get('location')!);
  tamper?.(callback);
  const response = await fetch(callback);
  return { status: response.status, html: await response.text(), headers: response.headers, callback };
}

// authorize() and the browser together. Resolves with the result and the page the browser was left on (when it got there).
async function signIn(w: any, id = 'notion', { tamper, options, oauth = w.oauth, serverUrl = w.mcpUrl }: any = {}) {
  const flow = oauth.authorize(id, serverUrl, { displayName: 'Notion', ...options });
  const first: any = await Promise.race([w.nextUrl(), flow]);
  if (typeof first !== 'string') return { result: first };
  const page = await visit(first, tamper);
  return { result: await flow, page, url: first };
}

async function callTool(w: any, id = 'notion', oauth = w.oauth, options?: any, url = w.mcpUrl) {
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { authProvider: oauth.providerFor(id, url, options) }));
    return await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
  } finally { await client.close().catch(() => {}); }
}
const echoed = { content: [{ type: 'text', text: 'hi' }] };

const listening = (port: number) => new Promise<boolean>((resolve) => {
  const socket = connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
const portOf = (url: string) => Number(new URL(new URL(url).searchParams.get('redirect_uri')!).port);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('the first sign-in registers a client and keeps the tokens; a transport given providerFor then calls a tool', async (t) => {
  const w = await world(t);
  assert.equal(await w.oauth.status('notion'), 'none');
  const { result, page, url } = await signIn(w);
  assert.deepEqual(result, { ok: true });
  assert.equal(page.status, 200);
  assert.match(page.html, new RegExp(OK('Notion')));
  assert.equal(await w.oauth.status('notion'), 'signed-in');

  // The authorization request: PKCE, the loopback redirect, the scope from the server's 401, the resource, a state of 256 bits.
  const asked = new URL(url).searchParams;
  assert.equal(asked.get('response_type'), 'code');
  assert.equal(asked.get('code_challenge_method'), 'S256');
  assert.equal(asked.get('scope'), 'mcp:tools');
  assert.equal(asked.get('resource'), w.mcpUrl);
  assert.match(asked.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
  assert.ok(asked.get('state')!.length >= 43);
  assert.equal(w.auth.registrations.length, 1);
  assert.equal(w.auth.registrations[0].token_endpoint_auth_method, 'none', 'a public client');
  assert.equal(w.auth.registrations[0].client_name, 'dudu');
  assert.deepEqual(w.auth.codeExchanges.map((exchange: any) => exchange.resource), [w.mcpUrl]);

  // One object, plain JSON (the store checked), with what refresh and the next sign-in need.
  const record = w.store.peek('notion');
  assert.equal(record.v, 1);
  assert.equal(record.serverUrl, w.mcpUrl);
  assert.equal(record.client.redirectUrl, asked.get('redirect_uri'));
  assert.equal(record.tokens.issuer, record.discovery.authorizationServerUrl);
  assert.ok(record.tokens.refresh_token && record.tokens.expiresAt > w.clock.t);
  assert.equal(record.discovery.authorizationServerMetadata.token_endpoint, `${w.asUrl.origin}/token`);

  const result2: any = await callTool(w);
  assert.deepEqual(result2.content, [{ type: 'text', text: 'hi' }]);
  assert.equal(w.opens(), 1, 'the sign-in opened the browser once; the call opened nothing');
  assert.equal(w.auth.registrations.length, 1);
});

test('a wrong state is refused and the real callback still works; a forged error cannot end the sign-in', async (t) => {
  const w = await world(t);
  const flow = w.oauth.authorize('notion', w.mcpUrl, { displayName: 'Notion' });
  const url = await w.nextUrl();
  const asked = new URL(url).searchParams;
  const callback = new URL(asked.get('redirect_uri')!);
  const get = async (params: Record<string, string>) => {
    const target = new URL(callback);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    const response = await fetch(target);
    return { status: response.status, text: await response.text() };
  };
  assert.equal((await get({ code: 'forged', state: 'not-the-state' })).status, 400);
  assert.equal((await get({ error: 'access_denied', state: 'not-the-state' })).status, 400, 'a forged ?error= does not cancel the sign-in');
  assert.equal((await get({ code: 'forged' })).status, 400, 'no state at all');
  assert.equal((await get({ code: 'a', state: asked.get('state')!.slice(0, -1) })).status, 400, 'close is not exact');
  const twice = new URL(callback);
  twice.search = `code=x&state=${asked.get('state')}&state=${asked.get('state')}`;
  assert.equal((await fetch(twice)).status, 400, 'a state sent twice');
  assert.equal(await Promise.race([flow, sleep(200).then(() => 'waiting')]), 'waiting', 'still waiting after all of that');
  assert.equal(await w.oauth.status('notion'), 'waiting');
  const page = await visit(url);
  assert.equal(page.status, 200);
  assert.deepEqual(await flow, { ok: true });
  assert.equal(w.auth.codeExchanges.length, 1, 'only the real code was ever sent to the server');
});

// The phone's sign-in (2026-11-23): the page is given to the phone and not opened here; the phone's browser view stops at the redirect and the App hands the address over.
test('a sign-in on the phone: the browser here is not opened, a forged address is refused, the real one signs in', async (t) => {
  const w = await world(t);
  let page = '';
  const flow = w.oauth.authorize('notion', w.mcpUrl, { displayName: 'Notion', elsewhere: true, onUrl: (url: string) => { page = url; } });
  for (let n = 0; n < 200 && !page; n++) await sleep(10);
  assert.ok(page, 'the phone was given the page');
  assert.equal(w.opens(), 0, 'nothing was opened on this computer');
  const answer = await fetch(page, { redirect: 'manual' });
  const callback = new URL(answer.headers.get('location')!);
  const forged = new URL(callback);
  forged.searchParams.set('state', 'not-the-state');
  assert.equal(w.oauth.deliver('notion', forged.href), false);
  const elsewhere = new URL(callback);
  elsewhere.host = 'evil.example';
  assert.equal(w.oauth.deliver('notion', elsewhere.href), false, 'only this sign-in\'s own address');
  assert.equal(w.oauth.deliver('linear', callback.href), false, 'only to the sign-in it belongs to');
  assert.equal(w.oauth.deliver('notion', callback.href), true);
  assert.deepEqual(await flow, { ok: true });
  assert.equal(await w.oauth.status('notion'), 'signed-in');
  assert.equal(w.oauth.deliver('notion', callback.href), false, 'and once only');
});

test('RFC 9207: the iss of the answer must be the authorization server, when it is there and when the server promises it', async (t) => {
  const w = await world(t);
  const metadataIssuer = new URL(w.asUrl).href; // what the server's metadata calls itself: with the trailing slash

  // Not promised, not sent: fine (most servers today).
  assert.deepEqual((await signIn(w, 'a')).result, { ok: true });

  // Promised, sent, equal: fine; the slash does not matter either way.
  w.metadata.authorization_response_iss_parameter_supported = true;
  w.auth.iss = metadataIssuer;
  assert.deepEqual((await signIn(w, 'b')).result, { ok: true });
  w.auth.iss = metadataIssuer.slice(0, -1);
  assert.deepEqual((await signIn(w, 'c')).result, { ok: true }, 'no trailing slash');

  // Sent but another server's: refused, nothing kept, the browser is told, and the old state of the connector stays.
  w.auth.iss = 'https://evil.example';
  const before = w.store.writes;
  const wrong: any = await signIn(w, 'd');
  assert.equal(wrong.result.ok, false);
  assert.equal(wrong.result.reason, 'failed');
  assert.match(wrong.result.message, /RFC 9207/);
  assert.equal(wrong.page.status, 400);
  assert.ok(wrong.page.html.includes(FAILED('Notion')));
  assert.equal(w.store.peek('d'), undefined);
  assert.equal(w.store.writes, before);
  assert.equal(w.auth.codeExchanges.length, 3, 'the code was never sent on');

  // Promised, not sent: refused. Not promised, sent and wrong: refused too (the answer is not from who we asked).
  w.auth.iss = undefined;
  assert.equal((await signIn(w, 'e')).result.ok, false);
  w.metadata.authorization_response_iss_parameter_supported = false;
  w.auth.iss = 'https://evil.example';
  assert.equal((await signIn(w, 'f')).result.ok, false);
  // An error answer carrying a foreign iss is not believed to be a refusal by the user.
  w.auth.denyWith = 'access_denied';
  const foreign: any = (await signIn(w, 'g')).result;
  assert.equal(foreign.reason, 'failed');
  // iss sent twice is never right.
  w.auth.denyWith = undefined;
  w.auth.iss = undefined;
  const twice: any = await signIn(w, 'h', { tamper: (callback: URL) => { callback.searchParams.append('iss', metadataIssuer); callback.searchParams.append('iss', metadataIssuer); } });
  assert.equal(twice.result.ok, false);
});

test('the listener is closed once the sign-in is over: after success, after failure, after a timeout and after a cancel', async (t) => {
  const w = await world(t);
  // success
  const ok: any = await signIn(w, 'a');
  assert.equal(ok.result.ok, true);
  assert.equal(await listening(portOf(ok.url)), false, 'after success');
  // failure (the server refuses the code)
  w.auth.rejectCodes = true;
  const failed: any = await signIn(w, 'b');
  assert.equal(failed.result.ok, false);
  assert.equal(await listening(portOf(failed.url)), false, 'after failure');
  w.auth.rejectCodes = false;
  // failure before the browser was sent anywhere: the server is not reachable
  const unreachable = createOAuth({ store: memoryStore(), openUrl: () => {}, ports: [], timeoutMs: 1000 });
  assert.equal((await unreachable.authorize('x', 'http://127.0.0.1:1/mcp')).reason, 'failed');
  // timeout
  const slow = w.make({ timeoutMs: 150 });
  const flow = slow.authorize('c', w.mcpUrl);
  const url = await w.nextUrl();
  assert.equal(await listening(portOf(url)), true, 'while waiting');
  assert.deepEqual({ ...(await flow), message: undefined }, { ok: false, reason: 'timeout', message: undefined });
  assert.equal(await listening(portOf(url)), false, 'after a timeout');
  assert.equal(await w.oauth.status('c'), 'none');
  // cancel
  const waiting = w.oauth.authorize('d', w.mcpUrl);
  const urlD = await w.nextUrl();
  assert.equal(await w.oauth.status('d'), 'waiting');
  assert.equal(w.oauth.cancel('d'), true);
  assert.equal((await waiting).reason, 'cancelled');
  assert.equal(await listening(portOf(urlD)), false, 'after a cancel');
  assert.equal(w.oauth.cancel('d'), false, 'nothing left to cancel');
  assert.equal(await w.oauth.status('d'), 'none');
});

test('tokens are refreshed 30 seconds before they end, not before, with the stored refresh token and the sign-in\'s resource', async (t) => {
  const w = await world(t);
  await signIn(w);
  const before = w.store.peek('notion');
  const provider = w.oauth.providerFor('notion', w.mcpUrl);
  const first: any = await provider.tokens();
  assert.equal(first.access_token, before.tokens.access_token);
  assert.equal(first.expires_in, 3600);
  assert.equal(first.refresh_token, before.tokens.refresh_token);

  w.clock.t += 3600_000 - 31_000;
  assert.equal((await provider.tokens() as any).access_token, first.access_token, '31 seconds left: nothing to do');
  assert.equal(w.auth.refreshes.length, 0);

  w.clock.t += 2_000;
  const second: any = await provider.tokens();
  assert.notEqual(second.access_token, first.access_token, '29 seconds left: refreshed');
  assert.equal(w.auth.refreshes.length, 1);
  assert.equal(w.auth.refreshes[0].refreshToken, before.tokens.refresh_token);
  assert.equal(w.auth.refreshes[0].resource, w.mcpUrl);
  assert.equal(second.expires_in, 3600);
  const after = w.store.peek('notion');
  assert.equal(after.tokens.access_token, second.access_token);
  assert.notEqual(after.tokens.refresh_token, before.tokens.refresh_token, 'the rotated refresh token is what is kept');
  assert.equal(after.tokens.issuer, before.tokens.issuer);
  assert.deepEqual(after.client, before.client);
  assert.deepEqual((await callTool(w) as any).content, echoed.content);
  assert.equal(w.auth.refreshes.length, 1, 'and not again until the new one gets close');
  assert.equal(w.opens(), 1);
});

test('two refreshes at once are one request: within a process, and across two processes that share the store', async (t) => {
  const w = await world(t);
  await signIn(w);
  w.clock.t += 3600_000 - 10_000;
  let release: any;
  w.auth.refreshGate = new Promise((resolve) => { release = resolve; });
  const other = w.make(); // another process: its own memory, the same credential store
  const providers = [w.oauth.providerFor('notion', w.mcpUrl), w.oauth.providerFor('notion', w.mcpUrl), other.providerFor('notion', w.mcpUrl)];
  const all = Promise.all([...providers, providers[0]].map((provider) => provider.tokens()));
  await sleep(250);
  assert.equal(w.auth.refreshes.length, 1, 'one request is waiting at the server');
  release();
  const got: any[] = await all;
  assert.equal(w.auth.refreshes.length, 1, 'and it stayed one');
  assert.equal(new Set(got.map((tokens) => tokens.access_token)).size, 1);
  assert.equal(got[0].access_token, w.store.peek('notion').tokens.access_token);
});

test('a failed re-authorization, in any way it can fail, leaves the old tokens working and writes nothing', async (t) => {
  const w = await world(t);
  await signIn(w);
  const kept = w.store.peek('notion');
  const writes = w.store.writes;

  w.auth.rejectCodes = true;
  const refused: any = await signIn(w);
  assert.equal(refused.result.reason, 'failed');
  w.auth.rejectCodes = false;
  w.auth.denyWith = 'access_denied';
  assert.equal((await signIn(w) as any).result.reason, 'denied');
  w.auth.denyWith = undefined;
  const waiting = w.make({ timeoutMs: 100 }).authorize('notion', w.mcpUrl);
  await w.nextUrl();
  assert.equal((await waiting).reason, 'timeout');

  assert.deepEqual(w.store.peek('notion'), kept);
  assert.equal(w.store.writes, writes);
  assert.equal(await w.oauth.status('notion'), 'signed-in');
  assert.deepEqual((await callTool(w) as any).content, echoed.content);
  // and a sign-in that works replaces them
  assert.deepEqual((await signIn(w)).result, { ok: true });
  assert.notEqual(w.store.peek('notion').tokens.access_token, kept.tokens.access_token);
});

test('use without the user never opens a browser, never registers a client and writes nothing; what it needs the user for is a recognizable error', async (t) => {
  const w = await world(t);
  const error: any = await callTool(w).then(() => undefined, (failure) => failure);
  assert.ok(isNeedsSignIn(error), `${error}`);
  assert.equal(error.code, 'needs_sign_in');
  assert.equal(error.status, 401, 'for a caller whose own copy of the SDK cannot tell this class by instanceof');
  assert.equal(w.opens(), 0);
  assert.equal(w.auth.registrations.length, 0);
  assert.equal(w.store.writes, 0);
  assert.equal(w.state.unauthenticated, 1, 'one unauthenticated request, and no discovery or registration after it');

  // A connector that was signed in and lost its tokens: the same.
  await signIn(w);
  const record = w.store.peek('notion');
  delete record.tokens;
  w.store.poke('notion', record);
  const lost: any = await callTool(w).then(() => undefined, (failure) => failure);
  assert.ok(isNeedsSignIn(lost));
  assert.equal(w.opens(), 1, 'only the sign-in opened one');
  assert.equal(w.auth.registrations.length, 1);

  // Tokens kept for another server address are not used for this one.
  w.store.poke('notion', { ...record, tokens: { access_token: 'x', token_type: 'Bearer' }, serverUrl: 'https://elsewhere.example/mcp' });
  assert.equal(await w.oauth.providerFor('notion', w.mcpUrl).tokens(), undefined);

  assert.ok(isNeedsSignIn(Object.assign(new Error('x'), { code: 401 })));
  assert.ok(isNeedsSignIn(new (class UnauthorizedError extends Error {})()), 'by name: it may come from another copy of the SDK');
  assert.equal(isNeedsSignIn(new Error('network')), false);
  assert.equal(isNeedsSignIn(undefined), false);
});

test('a token the server refuses before it ends is refreshed on the 401 path, with the newest refresh token in the store', async (t) => {
  const w = await world(t);
  await signIn(w);
  const before = w.store.peek('notion');
  w.auth.revokeAccessTokens(); // the server forgot it: the clock says it is fine
  assert.deepEqual((await callTool(w) as any).content, echoed.content);
  assert.equal(w.auth.refreshes.length, 1);
  assert.equal(w.auth.refreshes[0].refreshToken, before.tokens.refresh_token);
  assert.equal(w.auth.refreshes[0].resource, w.mcpUrl);
  const after = w.store.peek('notion');
  assert.notEqual(after.tokens.access_token, before.tokens.access_token);
  assert.notEqual(after.tokens.refresh_token, before.tokens.refresh_token);
  assert.equal(after.tokens.issuer, before.tokens.issuer, 'the SDK\'s issuer stamp is kept');
  assert.equal(w.opens(), 1);

  // Another process rotated the refresh token while this one was about to use the old one: the newest is what is sent.
  const provider = w.oauth.providerFor('notion', w.mcpUrl);
  await provider.tokens(); // this process has now seen the current one
  const rotated = { ...after, tokens: { ...after.tokens, refresh_token: 'rotated-by-another-process', access_token: 'another' } };
  w.auth.refreshTokens.set('rotated-by-another-process', { clientId: after.client.client_id, scopes: ['mcp:tools'], resource: undefined });
  w.store.poke('notion', rotated);
  w.auth.revokeAccessTokens();
  assert.deepEqual((await callTool(w) as any).content, echoed.content);
  assert.equal(w.auth.refreshes.at(-1).refreshToken, 'rotated-by-another-process');
});

test('a refresh token the server rejects ends the sign-in (needs sign-in, tokens dropped, registration kept); a server that is only down does not', async (t) => {
  // On the 401 path.
  const w = await world(t);
  await signIn(w);
  w.auth.revokeAccessTokens();
  w.auth.revokeRefreshTokens();
  const error: any = await callTool(w).then(() => undefined, (failure) => failure);
  assert.ok(isNeedsSignIn(error), `${error}`);
  assert.equal(w.store.peek('notion').tokens, undefined);
  assert.ok(w.store.peek('notion').client);
  assert.equal(await w.oauth.status('notion'), 'none');
  assert.equal(w.opens(), 1);
  assert.equal(w.auth.registrations.length, 1);
  const refreshes = w.auth.refreshes.length;
  assert.ok(isNeedsSignIn(await callTool(w).then(() => undefined, (failure) => failure)));
  assert.equal(w.auth.refreshes.length, refreshes, 'nothing to refresh with: no request');

  // On our own refresh, near the end of the token.
  const v = await world(t);
  await signIn(v);
  v.clock.t += 3600_000 - 10_000;
  v.auth.refreshMode = 'invalid_grant';
  assert.equal(await v.oauth.providerFor('notion', v.mcpUrl).tokens(), undefined);
  assert.equal(v.store.peek('notion').tokens, undefined);
  assert.ok(v.store.peek('notion').client);
  assert.equal(await v.oauth.status('notion'), 'none');

  // A server that fails: the sign-in stays, and the error is the real one, not "sign in again".
  const x = await world(t);
  await signIn(x);
  const kept = x.store.peek('notion');
  const provider = x.oauth.providerFor('notion', x.mcpUrl);
  x.clock.t += 3600_000 - 10_000;
  x.auth.refreshMode = 'server_error';
  assert.equal((await provider.tokens() as any).access_token, kept.tokens.access_token, 'still valid for 10 seconds: used');
  assert.equal(x.auth.refreshes.length, 1);
  x.clock.t += 20_000;
  const down: any = await provider.tokens().then(() => undefined, (failure) => failure);
  assert.match(down.message, /bad day/);
  assert.equal(isNeedsSignIn(down), false);
  assert.deepEqual(x.store.peek('notion'), kept);
  assert.equal(await x.oauth.status('notion'), 'signed-in');
  x.auth.refreshMode = 'ok';
  assert.notEqual((await provider.tokens() as any).access_token, kept.tokens.access_token, 'and it recovers');
});

test('what cannot be signed in to is refused as a value, before anything is sent: no id, no URL, a plain-http address that is not this machine', async (t) => {
  const w = await world(t);
  const sent: string[] = [];
  const watched = w.make({ fetch: (url: any, init: any) => { sent.push(String(url)); return fetch(url, init); } });
  const cases: [string, string, RegExp][] = [
    ['', w.mcpUrl, /id/], ['x', 'not a url', /not a URL/], ['x', 'http://example.com/mcp', /https/],
    ['x', 'ftp://example.com/mcp', /https/], ['x', 'file:///etc/passwd', /https/],
  ];
  for (const [id, url, message] of cases) {
    const result: any = await watched.authorize(id, url);
    assert.equal(result.ok, false, `${id} ${url}`);
    assert.equal(result.reason, 'failed');
    assert.match(result.message, message);
  }
  assert.deepEqual(sent, []);
  assert.equal(w.opens(), 0);
});

test('an authorization endpoint that is not http or https is never opened', async (t) => {
  const w = await world(t);
  w.metadata.authorization_endpoint = 'myapp://authorize';
  const result: any = await w.oauth.authorize('notion', w.mcpUrl);
  assert.equal(result.reason, 'failed');
  assert.match(result.message, /only http and https/);
  assert.equal(w.opens(), 0);
});
