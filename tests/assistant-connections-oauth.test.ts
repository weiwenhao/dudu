// The whole way of a hosted server that signs in, without the network: an address is added, the box asks the server what it needs, the browser sign-in is done, the tools are
// counted, and a collection is given a live connection that calls a tool. Real: the connections, the sign-in (connectors/oauth), the MCP client and the credential records' contract.
// Stand-ins: the server and its authorization server (the MCP SDK's own demo ones, on 127.0.0.1) and the browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import * as z from 'zod/v4';
import { DemoInMemoryAuthProvider } from '@modelcontextprotocol/sdk/examples/server/demoInMemoryOAuthProvider.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createOAuthMetadata, getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createConnections } from '../host/assistant/connectors/connections.mjs';
import { createConnectors } from '../host/assistant/connectors/index.mjs';
import { createOAuth } from '../host/assistant/connectors/mcp.mjs';
import { createPublisher } from '../host/assistant/connectors/publish.mjs';
import { createState } from '../host/assistant/connectors/state.mjs';

const listen = (server: any) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const closeServer = (server: any) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });

test('an address is added, signed in to in the browser, counted, and then read through by a collection', async (t) => {
  // the servers
  const auth = new DemoInMemoryAuthProvider();
  const asServer = createServer();
  const rsServer = createServer();
  const asUrl = new URL(`http://127.0.0.1:${await listen(asServer)}`);
  const mcpUrl = `http://127.0.0.1:${await listen(rsServer)}/mcp`;
  const metadata = createOAuthMetadata({ provider: auth, issuerUrl: asUrl, scopesSupported: ['mcp:tools'] });
  const as = express();
  as.use(mcpAuthRouter({ provider: auth, issuerUrl: asUrl, scopesSupported: ['mcp:tools'], authorizationOptions: { rateLimit: false }, tokenOptions: { rateLimit: false }, clientRegistrationOptions: { rateLimit: false } }));
  asServer.on('request', as);
  const verifier = { verifyAccessToken: async (token: string) => { try { return await auth.verifyAccessToken(token); } catch (error: any) { throw new InvalidTokenError(error.message); } } };
  const rs = express();
  rs.use(mcpAuthMetadataRouter({ oauthMetadata: metadata, resourceServerUrl: new URL(mcpUrl), scopesSupported: ['mcp:tools'], resourceName: 'stub' }));
  rs.use('/mcp', express.json(), requireBearerAuth({ verifier, requiredScopes: ['mcp:tools'], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(mcpUrl)) }), async (req: any, res: any) => {
    const server = new McpServer({ name: 'stub', version: '1' });
    server.registerTool('search', { description: 'finds', inputSchema: { q: z.string() }, annotations: { readOnlyHint: true } }, async ({ q }: any) => ({ content: [{ type: 'text', text: `found ${q}` }] }));
    server.registerTool('create-page', { description: 'makes', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'made' }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  rsServer.on('request', rs);
  t.after(async () => { await closeServer(asServer); await closeServer(rsServer); });

  // the plugin's side
  const dir = mkdtempSync(join(tmpdir(), 'dudu-connections-oauth-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const records = new Map<string, any>();
  const store = (prefix: string) => ({
    read: async (id: string) => records.get(prefix + id),
    modify: async (id: string, fn: any) => { const next = await fn(records.get(prefix + id)); if (next !== undefined) records.set(prefix + id, JSON.parse(JSON.stringify(next))); },
    remove: async (id: string) => { records.delete(prefix + id); },
  });
  // the browser: it follows the authorization URL, which redirects to the loopback listener of the sign-in
  const visited: string[] = [];
  const openUrl = async (url: string) => {
    visited.push(url);
    void (async () => {
      const answer = await fetch(url, { redirect: 'manual' });
      await fetch(answer.headers.get('location')!);
    })();
  };
  const connectors = createConnectors({ file: join(dir, 'CONNECTORS.md') });
  // what DSH is given: its MCP client is a stand-in that keeps the config it was mounted with
  const oauth = createOAuth({ store: store('oauth-'), openUrl, ports: [], timeoutMs: 8000 });
  const mounted = new Map<string, any>();
  const publisher = createPublisher({
    mount: async (config: any) => { mounted.set(config.serverName, config); return { dispose: () => { mounted.delete(config.serverName); } }; },
    oauth, setTimer: () => ({ unref() {} }), clearTimer: () => {},
  });
  const connections = createConnections({
    connectors, state: createState({ file: join(dir, 'state.json') }), secrets: store('connector-'), oauth, publisher, here: async () => [],
  });
  t.after(async () => { await connections.close(); await connectors.close(); });

  // the box asks the server what it needs, and the address is added
  assert.equal((await connections.recognize(mcpUrl)).auth, 'oauth');
  const added: any = await connections.add({ text: mcpUrl, name: 'Stub' });
  assert.deepEqual([added.outcome, added.id], ['success', 'stub']);
  assert.equal(connections.list().connectors[0].state?.status, 'waiting', 'it answers before the sign-in is done');
  await connections.idle();

  // signed in: the browser was sent once, the tools are counted, nothing says it needs anything, and the tokens are in the store, not in the file
  assert.equal(visited.length, 1);
  const row = connections.list().connectors[0];
  assert.deepEqual([row.state, row.about, row.busy], [null, { kind: 'remote', host: new URL(mcpUrl).host, tools: 2 }, false]);
  assert.ok(records.has('oauth-stub'), 'the tokens are kept in the credential store');
  assert.ok(!JSON.stringify([...records.values()]).includes(dir), 'and the file of the connectors has none of it');

  // DSH is given the server with the access token the sign-in got: the server takes that very token
  const accepted = async (header: string) => (await fetch(mcpUrl, {
    method: 'POST', headers: { authorization: header, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh', version: '1' } } }),
  })).status === 200;
  const first = mounted.get('stub');
  assert.deepEqual([first.serverName, first.transport, first.url], ['stub', 'streamable-http', mcpUrl]);
  assert.equal(first.headers.Authorization, `Bearer ${records.get('oauth-stub').tokens.access_token}`);
  assert.equal(await accepted(first.headers.Authorization), true, 'the server takes what DSH is given');
  assert.equal(await accepted('Bearer nothing'), false);
  assert.equal(connections.list().connectors[0].inSessions, true);
  // (the renewal is tested with the sign-in module's own authorization server in assistant-connector-oauth.test.ts: the SDK's demo one gives no refresh token)

  // a collection is given a live connection: both tools come with what the server said of them, and a call goes through with the stored token
  const link = await connections.session('stub');
  assert.deepEqual(link.tools.map((tool: any) => [tool.name, tool.annotations.readOnlyHint]), [['search', true], ['create-page', undefined]]);
  assert.equal((await link.call('search', { q: 'x' })).content[0].text, 'found x');
  await link.close();
  assert.equal(visited.length, 1, 'no second sign-in: the live connection used what was stored');

  // disconnecting takes the tokens with it, and the server out of DSH
  assert.equal((await connections.remove('stub')).outcome, 'success');
  assert.deepEqual([records.has('oauth-stub'), connections.list().connectors.length], [false, 0]);
  assert.deepEqual([...mounted.keys()], []);
});
