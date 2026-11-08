// The one file that names the MCP SDK (host/assistant/connectors/mcp.mjs): it opens a server by address or by command, falls back to the older SSE transport,
// and asks an address what it needs without signing in. Servers here are on 127.0.0.1; nothing leaves the machine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { openMcp, probeServer } from '../host/assistant/connectors/mcp.mjs';

const listen = (handler: (req: IncomingMessage, res: ServerResponse) => void) => new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as any;
    resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }) });
  });
});
const body = (req: IncomingMessage) => new Promise<any>((resolve) => { let data = ''; req.on('data', (chunk) => { data += chunk; }); req.on('end', () => resolve(data ? JSON.parse(data) : undefined)); });

function makeServer() {
  const server = new McpServer({ name: 'stub', version: '1.0.0' });
  server.registerTool('find', { description: 'finds', inputSchema: { q: z.string() }, annotations: { readOnlyHint: true } }, async ({ q }) => ({ content: [{ type: 'text', text: `found ${q}` }] }));
  server.registerTool('make', { description: 'makes', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'made' }] }));
  return server;
}

test('a server on an address is opened as Streamable HTTP: its tools come with what the server says of them, a call returns its content, and the server is named', async (t) => {
  const http = await listen(async (req, res) => {
    if (req.url !== '/mcp' || req.method !== 'POST') { res.writeHead(404).end(); return; }
    const parsed = await body(req);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = makeServer();
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  });
  t.after(http.close);
  const handle = await openMcp({ transport: 'http', url: `${http.url}/mcp` });
  t.after(() => handle.close());
  const tools = await handle.tools();
  assert.deepEqual(tools.map((tool: any) => [tool.name, tool.readOnly]), [['find', true], ['make', false]]);
  const answer = await handle.call('find', { q: 'x' });
  assert.deepEqual([answer.isError, answer.content[0].text], [false, 'found x']);
  assert.equal(handle.server?.name, 'stub');
});

test('an address that answers 404 to the newer transport is opened as SSE; one that is only SSE is not tried the newer way', async (t) => {
  const transports = new Map<string, SSEServerTransport>();
  let posts = 0;
  const http = await listen(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      await makeServer().connect(transport);
    } else if (req.method === 'POST' && url.pathname === '/messages') {
      await transports.get(url.searchParams.get('sessionId') ?? '')?.handlePostMessage(req, res, await body(req));
    } else if (req.method === 'POST') { posts++; res.writeHead(404).end(); } else res.writeHead(404).end();
  });
  t.after(http.close);
  const fallback = await openMcp({ transport: 'http', url: `${http.url}/sse` });
  t.after(() => fallback.close());
  assert.deepEqual((await fallback.tools()).map((tool: any) => tool.name), ['find', 'make']);
  assert.equal(posts, 1, 'the newer way was tried once');
  const only = await openMcp({ transport: 'sse', url: `${http.url}/sse` });
  t.after(() => only.close());
  assert.equal(posts, 1, 'a server that is declared SSE is not asked the newer way');
  await assert.rejects(openMcp({ transport: 'http', url: `${http.url}/nothing` }, { connectTimeoutMs: 2000 }));
});

test('a command is started and spoken to over its standard streams, with the environment it was given; a transport nobody knows is refused', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-mcp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sdk = join(import.meta.dirname, '..', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'server');
  const script = join(dir, 'server.mjs');
  writeFileSync(script, `
    import { McpServer } from ${JSON.stringify(pathToFileURL(join(sdk, 'mcp.js')).href)};
    import { StdioServerTransport } from ${JSON.stringify(pathToFileURL(join(sdk, 'stdio.js')).href)};
    const server = new McpServer({ name: 'by-command', version: '1.0.0' });
    server.registerTool('whoami', { description: 'says what it was given' }, async () => ({ content: [{ type: 'text', text: process.env.DUDU_TEST_VALUE ?? 'nothing' }] }));
    await server.connect(new StdioServerTransport());
  `);
  const handle = await openMcp({ transport: 'stdio', command: process.execPath, args: [script], env: { ...process.env, DUDU_TEST_VALUE: 'given' } });
  t.after(() => handle.close());
  assert.deepEqual((await handle.tools()).map((tool: any) => tool.name), ['whoami']);
  assert.equal((await handle.call('whoami', {})).content[0].text, 'given');
  assert.equal(handle.server?.name, 'by-command');
  await assert.rejects(openMcp({ transport: 'carrier-pigeon', url: 'x' } as any), /Unsupported MCP transport/);
});

test('what an address needs is asked without signing in: nothing, a sign-in that registers clients by itself, or a token', async (t) => {
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)); };
  let base = '';
  const http = await listen((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/open/mcp') json(res, 200, { jsonrpc: '2.0', id: 1, result: {} });
    else if (path === '/oauth/mcp') { res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/oauth/mcp"` }).end(); }
    else if (path === '/.well-known/oauth-protected-resource/oauth/mcp') json(res, 200, { resource: `${base}/oauth/mcp`, authorization_servers: [`${base}/as-open`] });
    else if (path === '/.well-known/oauth-authorization-server/as-open') json(res, 200, { issuer: `${base}/as-open`, authorization_endpoint: `${base}/a`, token_endpoint: `${base}/t`, registration_endpoint: `${base}/r`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] });
    else if (path === '/own/mcp') res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/own/mcp"` }).end();
    else if (path === '/.well-known/oauth-protected-resource/own/mcp') json(res, 200, { resource: `${base}/own/mcp`, authorization_servers: [`${base}/as-closed`] });
    else if (path === '/.well-known/oauth-authorization-server/as-closed') json(res, 200, { issuer: `${base}/as-closed`, authorization_endpoint: `${base}/a`, token_endpoint: `${base}/t`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] });
    else if (path === '/bare/mcp') res.writeHead(401).end();
    else if (path === '/broken/mcp') res.writeHead(500).end();
    else res.writeHead(404).end();
  });
  base = http.url;
  t.after(http.close);
  assert.deepEqual(await probeServer(`${base}/open/mcp`), { auth: 'none' });
  assert.deepEqual(await probeServer(`${base}/oauth/mcp`), { auth: 'oauth' });
  assert.deepEqual(await probeServer(`${base}/own/mcp`), { auth: 'token' }, 'a sign-in that wants a client the owner made is not one 嘟嘟 can do by itself');
  assert.deepEqual(await probeServer(`${base}/bare/mcp`), { auth: 'token' });
  assert.deepEqual(await probeServer(`${base}/broken/mcp`), { auth: 'token', problem: 'HTTP 500' });
  const gone = await probeServer('http://127.0.0.1:9/mcp', { timeoutMs: 1000 });
  assert.equal(gone.auth, 'token');
  assert.ok(gone.problem, 'an address that cannot be reached says why');
});
