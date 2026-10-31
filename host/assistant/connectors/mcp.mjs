// The only file in the plugin that names the MCP SDK (@modelcontextprotocol/sdk), so packaging can bundle it on its own:
// the installed plugin has no node_modules, so scripts/package-desktop.mjs must bundle this file ('assistant/connectors/mcp.mjs'
// in its `bundled` set) and the SDK travels inside it. Everything else (which tools are offered, secrets, caps, framing) is in
// index.mjs, which takes this function as its `mcp` option, so it can be replaced.
//
//   const handle = await openMcp(spec, { connectTimeoutMs });
//   spec = { transport: 'stdio', command, args, env, cwd } | { transport: 'http', url, headers }, everything resolved
//   handle.tools()                      -> [{ name, title, description, inputSchema, readOnly }]   (readOnly is the server's hint)
//   handle.call(name, args, { timeoutMs, signal }) -> { isError, content: [blocks], structured }
//   handle.stderr                       the tail of a stdio server's stderr, for error messages
//   handle.closed                       true once the connection is gone, whoever ended it
//   await handle.close()                ends the session and, for stdio, the process
//
// Nothing is logged. The client offers no capabilities (no sampling, no roots, no elicitation), so a server cannot ask
// it for anything. Sign-in (OAuth) is not handled: a server that wants one answers 401 and the call fails.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MAX_TOOLS = 500;
const MAX_PAGES = 20;

// The tool's input schema as plain JSON Schema for a model's tool list: the $schema line some servers add is dropped.
function plainSchema(schema) {
  const { $schema: _dropped, ...rest } = schema ?? {};
  return { type: 'object', ...rest };
}

export async function openMcp(spec, { connectTimeoutMs = 20_000 } = {}) {
  const client = new Client({ name: 'dudu', version: '1.0.0' }, { capabilities: {} });
  const handle = { closed: false, stderr: '' };
  let transport;
  if (spec.transport === 'stdio') {
    transport = new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env: spec.env, cwd: spec.cwd, stderr: 'pipe' });
    // A server logs to stderr. Reading it keeps the pipe from filling up (which would stop the server) and keeps the
    // log out of this process's own stderr.
    transport.stderr?.on('data', (chunk) => { handle.stderr = (handle.stderr + chunk).slice(-2000); });
  } else if (spec.transport === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers: spec.headers } });
  } else {
    throw new Error(`Unsupported MCP transport: ${spec.transport}`);
  }
  client.onclose = () => { handle.closed = true; };
  client.onerror = () => {}; // an error that belongs to a request comes back through that request
  try {
    await client.connect(transport, { timeout: connectTimeoutMs });
  } catch (error) {
    handle.closed = true;
    await client.close().catch(() => {});
    error.stderr = handle.stderr;
    throw error;
  }

  handle.tools = async ({ timeoutMs } = {}) => {
    const out = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES && out.length < MAX_TOOLS; page++) {
      const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: timeoutMs });
      for (const tool of result.tools) {
        out.push({
          name: tool.name, title: tool.title ?? tool.annotations?.title ?? '', description: tool.description ?? '',
          inputSchema: plainSchema(tool.inputSchema), readOnly: tool.annotations?.readOnlyHint === true,
        });
      }
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return out.slice(0, MAX_TOOLS);
  };

  handle.call = async (name, args, { timeoutMs, signal } = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs, signal });
    return { isError: result.isError === true, content: result.content ?? [], structured: result.structuredContent };
  };

  handle.close = async () => {
    handle.closed = true;
    await client.close().catch(() => {});
  };
  return handle;
}
