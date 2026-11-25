// Sign-in for remote MCP servers (OAuth in the user's browser), on the MCP SDK's own auth() (discovery, registration by DCR
// or CIMD, PKCE, refresh): this is the glue that SDK leaves out.
//
// Lifted from Cline: sdk/packages/core/src/extensions/mcp/oauth.ts, authorizeMcpServerOAuth (commit
//   d3ecc4890e8f9bcb77182b96c77fa90575e8e145, 2026-11-04; Copyright 2026 Cline Bot Inc., Apache License, Version 2.0,
//   http://www.apache.org/licenses/LICENSE-2.0; the license text is in Cline's repository): start the loopback listener, let
//   the SDK build the authorization URL, open it, wait for the callback, exchange the code. Changed: it does not connect a
//   client to provoke the 401 (an unauthenticated initialize reads the challenge: the scope and where the server's
//   metadata is); the state is checked by the listener before anything is accepted and RFC 9207's `iss` is checked here
//   (the SDK checks neither); nothing is written until the code was exchanged; the browser's page waits for that; and
//   the result is a value, never a throw. Hardened after opencode (packages/core/src/mcp/oauth.ts, dev 6bd47192, MIT,
//   Copyright (c) 2025 opencode): the challenge probe, `iss`, and registering again when the redirect URL changed.
// The other pieces: callback.mjs (the listener), provider.mjs (what the SDK is given), store.mjs (what is kept).
// This file and provider.mjs import the MCP SDK; callback.mjs and store.mjs do not.
//
// Exports: createOAuth, isNeedsSignIn, NEEDS_SIGN_IN, DEFAULT_PORTS, CALLBACK_PATH.
//   const oauth = createOAuth({ store, openUrl, now, timeoutMs, fetch, clientName, ports, clientMetadataUrl, requestTimeoutMs, openTimeoutMs });
//   clientMetadataUrl: the https address of the plugin's client metadata document; without it CIMD is not used and a client is registered (DCR).
//   store = { read(id), modify(id, fn(record | undefined) -> record | undefined, may be async), remove(id) }, async; modify runs
//     fn exclusively (also across processes) and leaves the record alone when fn returns undefined. The records are plain JSON.
//   openUrl(url) opens the browser; it may be async and may fail (the flow goes on, see onUrl).
//
//   oauth.providerFor(id, serverUrl, options?)   -> OAuthClientProvider for `{ authProvider }` of a StreamableHTTP or SSE
//       transport, for use without the user: tokens are read and refreshed (30 s early), and what needs the user ends in an
//       UnauthorizedError whose `code` is 'needs_sign_in' (isNeedsSignIn(error) tells it from other errors) instead of a
//       browser or a registration.
//   await oauth.authorize(id, serverUrl, { signal, onUrl, displayName, ...options })
//       -> { ok: true } | { ok: false, reason: 'timeout' | 'cancelled' | 'denied' | 'failed', message }   never throws.
//       `message` is for logs, in English; the words the user reads belong to the caller. onUrl(url) is called when the browser
//       could not be opened, so that the interface can show the link. A new authorize for an id replaces a running one.
//       `elsewhere: true`: the sign-in page is opened somewhere else (the phone, 2026-11-23): the browser here is not opened, onUrl(url) gets the link, and the redirect
//       comes back through deliver() instead of the browser's request to the listener (it may still come that way too).
//   oauth.deliver(id, url) -> true when it was the redirect the sign-in of `id` waits for
//   oauth.cancel(id) -> true when a sign-in was waiting
//   await oauth.forget(id) -> { ok: true } | { ok: false, message }   removes everything kept, and stops a sign-in that is waiting
//   await oauth.status(id) -> 'none' | 'waiting' | 'signed-in'   one store read, no network
//
// options (from the catalog entry; give the same ones to providerFor and authorize):
//   scope             overrides the scope from the server's 401 and metadata
//   authorizeParams   extra query parameters on the authorization URL; Google wants { access_type: 'offline', prompt: 'consent' }
//   resource: false   leave out RFC 8707's `resource` parameter, which some servers (Microsoft Entra) refuse
//   refreshLeadMs     (providerFor only) how long before its end a token is renewed: 30 s unless given; whoever keeps a token somewhere else (publish.mjs) renews it earlier
// Not here: clients the user registered by hand (client id and secret).
import { randomBytes } from 'node:crypto';
import { UnauthorizedError, auth, extractWWWAuthenticateParams } from '@modelcontextprotocol/sdk/client/auth.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { CALLBACK_PATH, failText, okText, renderPage, startCallback } from './callback.mjs';
import { NEEDS_SIGN_IN, backgroundProvider, interactiveProvider } from './provider.mjs';
import { guard, newest, signedIn, stampTokens } from './store.mjs';

// Next to the plugin's own port (3170). The redirect URL is registered with the server, so a fixed one is reused:
// http://127.0.0.1:<port><CALLBACK_PATH> for these ports (a client metadata document, for CIMD, lists them).
export const DEFAULT_PORTS = [3171, 3172, 3173, 3174];
export { CALLBACK_PATH, NEEDS_SIGN_IN };

// Whatever a transport or client throws for "this server wants a sign-in": the SDK's UnauthorizedError (also from another
// copy of the SDK, hence the name), ours, or an HTTP 401 on a transport.
export function isNeedsSignIn(error) {
  return Boolean(error) && (error.code === NEEDS_SIGN_IN || error.code === 401 || error.status === 401 || error instanceof UnauthorizedError || error.constructor?.name === 'UnauthorizedError');
}

const trimSlash = (url) => String(url).replace(/\/$/, '');

// RFC 9207: the redirect says which authorization server it comes from. Compared with the issuer in the server's metadata
// and with the address discovery used (a trailing slash is not a difference). Required when the metadata promises it.
function issuerProblem(iss, discovery) {
  const metadata = discovery?.authorizationServerMetadata;
  if (iss === undefined) return metadata?.authorization_response_iss_parameter_supported === true ? 'The authorization server did not send its issuer (RFC 9207).' : undefined;
  const known = [metadata?.issuer, discovery?.authorizationServerUrl].filter(Boolean).map(trimSlash);
  return iss !== null && known.includes(trimSlash(iss)) ? undefined : 'The answer came from a different authorization server (RFC 9207).';
}

function inputProblem(id, serverUrl) {
  if (typeof id !== 'string' || !id) return 'A connector id is needed.';
  let url;
  try { url = new URL(serverUrl); } catch { return 'The server address is not a URL.'; }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? undefined : 'The server address must be https.';
}

const within = (ms, promise) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(false); });
});

export function createOAuth({
  store, openUrl, now = Date.now, timeoutMs = 600_000, fetch = globalThis.fetch, clientName = 'dudu',
  ports = DEFAULT_PORTS, clientMetadataUrl, requestTimeoutMs = 10_000, openTimeoutMs = 5000,
}) {
  if (typeof store?.read !== 'function' || typeof store.modify !== 'function' || typeof store.remove !== 'function') throw new TypeError('createOAuth needs a store with read, modify and remove.');
  const ctx = {
    store: guard(store), now, fetch, clientName, clientMetadataUrl,
    refreshing: new Map(), // id -> the refresh in flight
    unsaved: new Map(), // id -> tokens a server sent that the store would not take: used from memory, written when it can
    distrust: new Set(), // ids whose last sign-in with a saved registration did not work: the next registers again
    // Every request made here has a time limit (the refresh holds the store's lock while it waits), and can be cut short.
    timed: (signal) => (url, init) => fetch(url, { ...init, signal: AbortSignal.any([init?.signal, signal, AbortSignal.timeout(requestTimeoutMs)].filter(Boolean)) }),
  };
  const flows = new Map(); // id -> { controller, quiet } of the sign-in that is waiting; quiet: it was replaced or forgotten, not given up
  const end = (id, { quiet }) => {
    const flow = flows.get(id);
    if (flow) { flow.quiet ||= quiet; flow.controller.abort(); }
    return Boolean(flow);
  };

  // What the server's 401 to an unauthenticated initialize says: the scope it wants and where its metadata is.
  async function probe(serverUrl, fetchFn, signal) {
    try {
      const response = await fetchFn(serverUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: clientName, version: '1' } } }),
      });
      const found = response.status === 401 ? extractWWWAuthenticateParams(response) : {};
      await response.body?.cancel().catch(() => {});
      return found;
    } catch (error) {
      if (signal.aborted) throw error;
      return {}; // discovery can still find the metadata by its well-known address
    }
  }

  async function authorize(id, serverUrl, { signal, onUrl, displayName, elsewhere = false, ...options } = {}) {
    const problem = inputProblem(id, serverUrl);
    if (problem) return { ok: false, reason: 'failed', message: problem };
    const name = displayName || id;
    end(id, { quiet: true }); // a second click replaces the first sign-in
    const flow = { controller: new AbortController(), quiet: false };
    flows.set(id, flow);
    const cancelled = () => flow.controller.abort();
    if (signal?.aborted) cancelled(); else signal?.addEventListener('abort', cancelled, { once: true });
    let listener;
    let usedSaved = false;
    try {
      const state = randomBytes(32).toString('base64url');
      listener = await startCallback({ ports, state });
      flow.listener = listener;
      const fetchFn = ctx.timed(flow.controller.signal);
      const challenge = await probe(serverUrl, fetchFn, flow.controller.signal);
      const saved = ctx.distrust.has(id) ? undefined : await ctx.store.read(id, serverUrl);
      const sign = interactiveProvider(ctx, { id, serverUrl, redirectUrl: listener.redirectUrl, state, saved, options });
      usedSaved = sign.usedSaved;
      const request = { serverUrl, scope: options.scope ?? challenge.scope, resourceMetadataUrl: challenge.resourceMetadataUrl, fetchFn };
      if (await auth(sign.provider, request) !== 'REDIRECT' || !sign.staged.url) throw new Error('The server did not ask for a sign-in.');

      // A browser that cannot be opened is not a failed sign-in: the interface gets the link.
      const url = sign.staged.url.href;
      if (elsewhere || !(openUrl && await within(openTimeoutMs, Promise.resolve().then(() => openUrl(url))) !== false)) {
        try { Promise.resolve(onUrl?.(url)).catch(() => {}); } catch { /* the caller's callback is not ours to fail on */ }
      }
      const got = await listener.wait({ timeoutMs, signal: flow.controller.signal });

      // The browser's request is held open from here on; every way out below answers it, and only after the last step.
      try {
        // An error answer may not come from the server we asked either (RFC 9207 §2.4), so an `iss` that is there is checked first.
        const wrong = got.error && got.iss === undefined ? undefined : issuerProblem(got.iss, sign.staged.discovery);
        if (wrong) throw new Error(wrong);
        if (got.error) {
          throw Object.assign(new Error(`The server answered: ${got.error}${got.errorDescription ? ` (${got.errorDescription})` : ''}.`), { code: got.error === 'access_denied' ? 'denied' : 'failed' });
        }
        await auth(sign.provider, { ...request, authorizationCode: got.code });
        const tokens = sign.staged.tokens;
        if (!tokens?.access_token) throw new Error('The server sent no access token.');
        if (flow.controller.signal.aborted) throw Object.assign(new Error('The sign-in was cancelled.'), { code: 'cancelled' });
        const at = ctx.now();
        const written = await ctx.store.modify(id, () => ({
          serverUrl, issuer: tokens.issuer, updatedAt: at, client: sign.client(),
          discovery: { ...sign.staged.discovery, fetchedAt: at }, tokens: stampTokens(tokens, { issuer: sign.staged.discovery?.authorizationServerUrl, now: at }),
        }));
        if (!written.ok) throw written.error;
      } catch (error) {
        await listener.finish(renderPage(failText(name), 400));
        throw error;
      }
      ctx.unsaved.delete(id);
      ctx.distrust.delete(id);
      await listener.finish(renderPage(okText(name), 200));
      return { ok: true };
    } catch (error) {
      if (usedSaved && !flow.quiet) ctx.distrust.add(id);
      if (flow.controller.signal.aborted || error?.code === 'cancelled') return { ok: false, reason: 'cancelled', message: 'The sign-in was cancelled.' };
      const reason = error?.code === 'timeout' || error?.code === 'denied' ? error.code : 'failed';
      return { ok: false, reason, message: String(error?.message ?? error) };
    } finally {
      signal?.removeEventListener('abort', cancelled);
      if (flows.get(id) === flow) flows.delete(id);
      await listener?.close();
    }
  }

  return {
    providerFor: (id, serverUrl, options) => backgroundProvider(ctx, id, serverUrl, options),
    authorize,
    deliver: (id, url) => Boolean(flows.get(id)?.listener?.deliver(url)),
    cancel: (id) => end(id, { quiet: false }),
    async forget(id) {
      end(id, { quiet: true }); // or it would write the record again when it ends
      ctx.unsaved.delete(id);
      ctx.distrust.delete(id);
      const removed = await ctx.store.remove(id);
      return removed.ok ? { ok: true } : { ok: false, message: String(removed.error?.message ?? removed.error) };
    },
    async status(id) {
      if (flows.has(id)) return 'waiting';
      const record = await ctx.store.read(id);
      return signedIn(newest(record?.tokens, ctx.unsaved.get(id)), ctx.now()) ? 'signed-in' : 'none';
    },
  };
}
