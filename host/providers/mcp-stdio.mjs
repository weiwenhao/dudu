// MCP stdio for ACP harnesses, whose native initialize need not advertise HTTP.
// Both sides use the existing MCP SDK. Only the tools of this session's OAR
// server are exposed; no arbitrary RPC or caller-selected HTTP destination.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function connectStdioHostTools(config, transport = new StdioServerTransport()) {
  const url = new URL(config.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/mcp'
    || url.username || url.password || url.search || url.hash
    || typeof config.headers?.Authorization !== 'string' || !config.headers.Authorization.startsWith('Bearer ')) {
    throw new Error('Invalid session tool connection.');
  }
  const client = new Client({ name: 'dudu', version: '0.1.0' }, { capabilities: {} });
  const server = new Server({ name: 'dudu', version: '0.1.0' }, { capabilities: { tools: {} } });
  const lifetime = new AbortController();
  let closing;
  const close = () => closing ??= Promise.resolve().then(async () => {
    lifetime.abort();
    await Promise.allSettled([client.close(), server.close()]);
  });
  client.onerror = () => {};
  server.onerror = () => {};
  server.onclose = () => { void close(); };
  client.onclose = () => { void close(); };
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: config.headers } }));
    const { tools } = await client.listTools();
    const allowed = new Set(tools.map((tool) => tool.name));
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
      if (!allowed.has(request.params.name)) throw new Error('Unknown session tool.');
      return client.callTool(request.params, undefined, {
        signal: AbortSignal.any([extra.signal, lifetime.signal]),
        // Waiting for a person is not an ordinary 60-second network call.
        timeout: 2_147_483_647,
      });
    });
    await server.connect(transport);
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The entry in the harness's MCP configuration contains only the environment
  // variable's name. Credentials travel in the process environment, never argv
  // or Antigravity's persisted MCP configuration.
  const key = process.argv[2];
  let config;
  try {
    if (!/^DUDU_MCP_[A-F0-9]+_TOKEN$/u.test(key ?? '')) throw new Error();
    config = JSON.parse(process.env[key]);
    delete process.env[key];
    const handle = await connectStdioHostTools(config);
    process.stdin.once('end', () => { void handle.close(); });
    process.once('SIGTERM', () => { void handle.close(); });
    process.once('SIGINT', () => { void handle.close(); });
  } catch {
    console.error('Dudu session tools could not connect.');
    process.exitCode = 1;
  }
}
