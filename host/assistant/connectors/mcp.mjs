// The only file in the plugin that names the MCP SDK (@modelcontextprotocol/sdk), so packaging can bundle it on its own:
// the installed plugin has no node_modules, so scripts/package-desktop.mjs must bundle this file ('assistant/connectors/mcp.mjs'
// in its `bundled` set) and the SDK travels inside it. Everything else (which tools are offered, secrets, caps, framing) is in
// index.mjs, which takes this function as its `mcp` option, so it can be replaced.
//
//   const handle = await openMcp(spec, { connectTimeoutMs, authProvider });
//   spec = { transport: 'stdio', command, args, env, cwd } | { transport: 'http' | 'sse', url, headers }, everything resolved
//   authProvider                        an OAuthClientProvider (connectors/oauth): the transport signs in with the tokens it holds, refreshes them, and fails with
//                                       UnauthorizedError when only the owner can sign in again (the provider never opens a browser by itself)
//   'http' is tried as Streamable HTTP and, when the address answers 404 or 405 (a server of the older kind), as SSE; 'sse' is only SSE.
//   const { auth, problem? } = await probeServer(url)     what an address needs, asked without signing in: 'none' | 'oauth' | 'token'
//   isUnauthorized(error)               true for a failure that is the server asking for a sign-in
//   handle.tools()                      -> [{ name, title, description, inputSchema, readOnly, annotations }]   (readOnly is the server's hint; annotations are as it gave them)
//   handle.call(name, args, { timeoutMs, signal }) -> { isError, content: [blocks], structured }
//   handle.stderr                       the tail of a stdio server's stderr, for error messages
//   handle.closed                       true once the connection is gone, whoever ended it
//   await handle.close()                ends the session and, for stdio, the process
//
// Nothing is logged. The client offers no capabilities (no sampling, no roots, no elicitation), so a server cannot ask
// it for anything.
import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isNeedsSignIn } from './oauth/index.mjs';

// The sign-in (connectors/oauth) is exported from here too: the plugin takes it from this file so that the MCP SDK is in the package once.
export { createOAuth } from './oauth/index.mjs';

const MAX_TOOLS = 500;
const MAX_PAGES = 20;

// The tool's input schema as plain JSON Schema for a model's tool list: the $schema line some servers add is dropped.
function plainSchema(schema) {
  const { $schema: _dropped, ...rest } = schema ?? {};
  return { type: 'object', ...rest };
}

const TRANSPORTS = { stdio: ['stdio'], sse: ['sse'], http: ['http', 'sse'] };

/** Whether a failure is the server saying it wants a sign-in (or a token): the SDK's own error, the sign-in module's, or a plain 401. */
export const isUnauthorized = isNeedsSignIn;

export async function openMcp(spec, options = {}) {
  const kinds = TRANSPORTS[spec.transport];
  if (!kinds) throw new Error(`Unsupported MCP transport: ${spec.transport}`);
  let failure;
  for (const kind of kinds) {
    try {
      return await connectOnce(kind, spec, options);
    } catch (error) {
      failure = error;
      // A server of the older kind answers the address of the newer with 404 or 405: the older is tried. Anything else, a sign-in included, is the answer.
      const status = error?.code ?? error?.status;
      if (!(kind === 'http' && kinds.length > 1 && (status === 404 || status === 405))) throw error;
    }
  }
  throw failure;
}

async function connectOnce(kind, spec, { connectTimeoutMs = 20_000, authProvider, signal } = {}) {
  const client = new Client({ name: 'dudu', version: '1.0.0' }, { capabilities: {} });
  const handle = { closed: false, stderr: '' };
  let transport;
  if (kind === 'stdio') {
    transport = new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env: spec.env, cwd: spec.cwd, stderr: 'pipe' });
    // A server logs to stderr. Reading it keeps the pipe from filling up (which would stop the server) and keeps the
    // log out of this process's own stderr.
    transport.stderr?.on('data', (chunk) => { handle.stderr = (handle.stderr + chunk).slice(-2000); });
  } else {
    const options = { requestInit: { headers: spec.headers }, ...(authProvider ? { authProvider } : {}) };
    transport = kind === 'sse' ? new SSEClientTransport(new URL(spec.url), options) : new StreamableHTTPClientTransport(new URL(spec.url), options);
  }
  client.onclose = () => { handle.closed = true; };
  client.onerror = () => {}; // an error that belongs to a request comes back through that request
  try {
    await client.connect(transport, { timeout: connectTimeoutMs, signal });
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
          inputSchema: plainSchema(tool.inputSchema), readOnly: tool.annotations?.readOnlyHint === true, annotations: tool.annotations ?? {},
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
  handle.server = client.getServerVersion() ?? null; // { name, version, title?, icons? } as the server gave it
  return handle;
}

/**
 * What an address needs, asked once and without signing in: a POST of `initialize`. It answers: 'none' (it let the request in), 'oauth' (401, and its authorization
 * server registers clients by itself: a client metadata document or dynamic registration, so 嘟嘟 can sign in without anything the owner has to make), or 'token'
 * (401 and nothing to sign in with: a token is what it wants; also when it could not be asked, with the `problem`). A server that lets `initialize` in and asks for the
 * login at the first call (Google's Gmail one does) reads as 'none'; the first call that gets a 401 then says so.
 */
export async function probeServer(url, { timeoutMs = 8_000, fetchFn = fetch } = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dudu', version: '1.0.0' } } });
  let response;
  try {
    response = await fetchFn(url, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'timeout' : String(error?.cause?.code ?? error?.message ?? error);
    return { auth: 'token', problem: reason.slice(0, 120) };
  }
  await response.body?.cancel().catch(() => {});
  if (response.ok) return { auth: 'none' };
  if (response.status !== 401 && response.status !== 403) return { auth: 'token', problem: `HTTP ${response.status}` };
  // The discovery asks several addresses one after the other, each as slow as its server (GitHub's authorization server took two minutes to give up): the whole of it
  // has a time of its own, and when it runs out nothing is known, which reads as a token.
  const limited = (input, init) => fetchFn(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init?.signal ? [init.signal] : [])]) });
  try {
    const info = await Promise.race([
      discoverOAuthServerInfo(url, { fetchFn: limited }),
      new Promise((_, reject) => { setTimeout(() => reject(new Error('timeout')), timeoutMs * 2).unref?.(); }),
    ]);
    const metadata = info.authorizationServerMetadata;
    return { auth: metadata && (metadata.registration_endpoint || metadata.client_id_metadata_document_supported === true) ? 'oauth' : 'token' };
  } catch {
    return { auth: 'token' };
  }
}
