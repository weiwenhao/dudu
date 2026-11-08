// The two OAuthClientProviders the MCP SDK works with: one for a sign-in the user asked for (interactiveProvider), one for
// every other use (backgroundProvider). Both are built on a context `ctx` made in index.mjs:
//   { store (guarded), now, fetch, timed(), clientName, clientMetadataUrl, refreshing, unsaved, distrust }
//
// Lifted from Cline: sdk/packages/core/src/extensions/mcp/oauth.ts, createMcpOAuthProviderContext (commit
//   d3ecc4890e8f9bcb77182b96c77fa90575e8e145, 2026-11-04; Copyright 2026 Cline Bot Inc., Apache License, Version 2.0,
//   http://www.apache.org/licenses/LICENSE-2.0; the license text is in Cline's repository): the provider's shape, what each
//   method hands the SDK, and the five scopes of invalidateCredentials. Changed: the three functions that read and wrote
//   Cline's settings file are the injected store; a sign-in stages everything in memory and index.mjs writes it once, after
//   the code was exchanged (so a failed sign-in cannot touch what works); background use is a second provider that never
//   registers a client and never opens a browser; the refresh is single-flight and runs inside the store's exclusive modify.
// Hardened after opencode: packages/core/src/mcp/oauth.ts on branch dev (commit 6bd47192ac97527e9fdc5e64c36fd4730aec2acd, MIT,
//   Copyright (c) 2025 opencode): invalidate only the credential that was presented, no registering from the background, only
//   http(s) authorization URLs, CIMD only when the server takes public clients; and from its v1.19.5 McpOAuthPendingProvider:
//   stage, then commit.
import { UnauthorizedError, discoverOAuthServerInfo, refreshAuthorization, selectResourceURL } from '@modelcontextprotocol/sdk/client/auth.js';
import { expiring, freshDiscovery, newest, publicTokens, sameServer, stampTokens } from './store.mjs';

export const NEEDS_SIGN_IN = 'needs_sign_in';
// `status: 401` as well as the code: a caller that bundles its own copy of the SDK cannot tell this class from its own
// UnauthorizedError by instanceof, and checks for a 401 instead.
export const needsSignIn = (id) => Object.assign(new UnauthorizedError(`${id} needs a sign-in.`), { code: NEEDS_SIGN_IN, status: 401 });

// Query parameters the flow sets itself: a value from outside that disagrees with the real one is an opaque error at the server.
const OWN_PARAMS = new Set(['state', 'code_challenge', 'code_challenge_method', 'client_id', 'redirect_uri', 'response_type']);

const alive = (tokens, now) => tokens && (!tokens.expiresAt || tokens.expiresAt > now) ? tokens : undefined;

// A token request the server answers with "this grant is bad" cannot be retried; the network, a 5xx or a rate limit can.
// (By the OAuth error code, not by class: the class may come from another copy of the SDK.)
function verdict(error) {
  const code = error?.errorCode;
  if (code === 'invalid_grant') return 'tokens';
  return code === 'invalid_client' || code === 'unauthorized_client' ? 'client' : undefined;
}

// RFC 8707: what the SDK sends. A few servers refuse the parameter (options.resource === false).
async function resourceFor(serverUrl, discovery, options) {
  const metadata = discovery?.resourceMetadata;
  if (options.resource === false || !metadata) return undefined;
  await selectResourceURL(serverUrl, {}, metadata); // throws when the metadata is about another server
  return metadata.resource;
}

async function discover(ctx, record, serverUrl) {
  const known = freshDiscovery(record?.discovery, ctx.now());
  if (known) return known;
  const info = await discoverOAuthServerInfo(serverUrl, { fetchFn: ctx.timed(), resourceMetadataUrl: record?.discovery?.resourceMetadataUrl && new URL(record.discovery.resourceMetadataUrl) });
  return {
    authorizationServerUrl: String(info.authorizationServerUrl), authorizationServerMetadata: info.authorizationServerMetadata,
    resourceMetadata: info.resourceMetadata, resourceMetadataUrl: record?.discovery?.resourceMetadataUrl, fetchedAt: ctx.now(),
  };
}

// One refresh per connector at a time in this process, and inside the store's exclusive modify, so that another process
// that got there first has its tokens adopted instead of its refresh token spent twice (servers rotate them: the second
// use is an error, or worse, a revoked family). Resolves { tokens } (usable now), { tokens, error } (the refresh failed
// but the current token still has time) or { error }; { } when there is nothing to use.
function refresh(ctx, id, serverUrl, options) {
  let run = ctx.refreshing.get(id);
  if (!run) {
    run = refreshExclusive(ctx, id, serverUrl, options).finally(() => ctx.refreshing.delete(id));
    ctx.refreshing.set(id, run);
  }
  return run;
}

async function refreshExclusive(ctx, id, serverUrl, options) {
  const before = await ctx.store.read(id, serverUrl);
  let discovery;
  try {
    discovery = await discover(ctx, before, serverUrl);
  } catch (error) {
    return { error, tokens: alive(newest(before?.tokens, ctx.unsaved.get(id)), ctx.now()) };
  }
  let outcome = {};
  let stored = false; // the store holds the newest tokens there are once this is over (so the copy in memory can go)
  const written = await ctx.store.modify(id, async (record) => {
    if (!record || !sameServer(record.serverUrl, serverUrl)) return undefined;
    const now = ctx.now();
    const base = newest(record.tokens, ctx.unsaved.get(id)); // a refresh whose write failed is newer than the stored one
    if (!base) return undefined;
    stored = base === record.tokens;
    if (!expiring(base, now, options.refreshLeadMs)) { outcome = { tokens: base }; stored = true; return base === record.tokens ? undefined : { ...record, tokens: base }; }
    if (!base.refresh_token || !record.client) { outcome = { tokens: alive(base, now) }; return undefined; }
    try {
      const raw = await refreshAuthorization(discovery.authorizationServerUrl, {
        metadata: discovery.authorizationServerMetadata, clientInformation: record.client, refreshToken: base.refresh_token,
        resource: await resourceFor(serverUrl, discovery, options), fetchFn: ctx.timed(),
      });
      const tokens = stampTokens(raw, { issuer: base.issuer ?? discovery.authorizationServerUrl, now, previous: base });
      outcome = { tokens };
      stored = true;
      return { ...record, tokens, discovery, updatedAt: now };
    } catch (error) {
      const gone = verdict(error);
      if (!gone) { outcome = { tokens: alive(base, now), error }; return undefined; }
      // The server says the grant is dead, and nobody else can have refreshed it: we hold the lock.
      stored = true;
      const { tokens: _dead, client, ...rest } = record;
      return { ...rest, ...(gone === 'client' ? {} : { client }), updatedAt: now };
    }
  });
  if (!written.ok) {
    // The server may have rotated the refresh token although it could not be written down: keep what it sent in memory.
    if (outcome.tokens && !outcome.error) ctx.unsaved.set(id, outcome.tokens);
    return outcome.tokens ? outcome : { error: written.error };
  }
  if (stored) ctx.unsaved.delete(id);
  return outcome;
}

// The provider for background use: reading, refreshing and what the SDK does after a 401. It never registers a client
// (no saveClientInformation) and never opens a browser. Its redirectUrl is empty, which the SDK takes for a non-interactive
// grant: it then never starts an authorization but asks prepareTokenRequest for the token request. That request is the
// refresh. What cannot be done from here ends in an UnauthorizedError (code 'needs_sign_in').
export function backgroundProvider(ctx, id, serverUrl, options = {}) {
  let presented; // the credential this provider last handed out; invalidateCredentials only drops that one
  let presentedClient;
  const read = () => ctx.store.read(id, serverUrl);
  const give = (tokens) => { presented = tokens.refresh_token ?? tokens.access_token; return publicTokens(tokens, ctx.now()); };
  const provider = {
    get redirectUrl() { return undefined; },
    get clientMetadata() { return { client_name: ctx.clientName, redirect_uris: [] }; },
    async tokens() {
      const record = await read();
      const tokens = newest(record?.tokens, ctx.unsaved.get(id));
      if (!tokens) return undefined;
      if (!expiring(tokens, ctx.now(), options.refreshLeadMs) && tokens === record?.tokens) return give(tokens);
      const done = await refresh(ctx, id, serverUrl, options);
      if (done.tokens) return give(done.tokens);
      if (done.error) throw done.error; // the network, not the sign-in: the caller should see that, not "sign in again"
      return undefined;
    },
    // The SDK's own refresh (after a 401 it did not expect) lands here. A server that sends no new refresh token keeps the old one.
    async saveTokens(tokens) {
      const now = ctx.now();
      const before = await read();
      const stamped = stampTokens(tokens, { issuer: tokens.issuer, now, previous: newest(before?.tokens, ctx.unsaved.get(id)) });
      const written = await ctx.store.modify(id, (record) => (record && sameServer(record.serverUrl, serverUrl) ? { ...record, tokens: stamped, updatedAt: now } : undefined));
      if (written.ok) ctx.unsaved.delete(id); else ctx.unsaved.set(id, stamped);
    },
    async clientInformation() {
      const record = await read();
      if (!record?.client) throw needsSignIn(id);
      presentedClient = record.client.client_id;
      return record.client;
    },
    // Called first by every auth(): a connector that was never signed in (or whose grant was dropped) stops here, before discovery.
    async discoveryState() {
      const record = await read();
      if (!record?.client || !(record.tokens || ctx.unsaved.has(id))) throw needsSignIn(id);
      const found = freshDiscovery(record.discovery, ctx.now());
      return found && {
        authorizationServerUrl: found.authorizationServerUrl, authorizationServerMetadata: found.authorizationServerMetadata,
        resourceMetadata: found.resourceMetadata, resourceMetadataUrl: found.resourceMetadataUrl,
      };
    },
    async saveDiscoveryState(state) {
      const now = ctx.now();
      await ctx.store.modify(id, (record) => (record && sameServer(record.serverUrl, serverUrl)
        ? { ...record, discovery: { ...state, fetchedAt: now } } : undefined));
    },
    // The 401 path: the server refused the access token, so the one thing to do is the refresh grant, with the newest
    // refresh token there is (another process may have rotated it since this one read it).
    async prepareTokenRequest() {
      const record = await read();
      const tokens = newest(record?.tokens, ctx.unsaved.get(id));
      if (!tokens?.refresh_token) throw needsSignIn(id);
      presented = tokens.refresh_token;
      return new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    },
    // Only what this provider presented is dropped: if another process has rotated the token since, the new one is good.
    async invalidateCredentials(scope) {
      if (scope === 'verifier') return;
      await ctx.store.modify(id, (record) => {
        if (!record || !sameServer(record.serverUrl, serverUrl)) return undefined;
        if (scope === 'discovery') { const { discovery: _old, ...rest } = record; return rest; }
        const next = { ...record };
        const stale = presented !== undefined && (record.tokens?.refresh_token ?? record.tokens?.access_token) === presented;
        if ((scope === 'tokens' || scope === 'all') && stale) delete next.tokens;
        if ((scope === 'client' || scope === 'all') && presentedClient !== undefined && record.client?.client_id === presentedClient) delete next.client;
        return next;
      });
    },
    async redirectToAuthorization() { throw needsSignIn(id); },
    async saveCodeVerifier() {},
    async codeVerifier() { throw needsSignIn(id); },
  };
  if (options.resource === false) provider.validateResourceURL = async () => undefined;
  return provider;
}

// A saved registration is reused only for the redirect URL it was made for (a server refuses another), and only while it
// is valid. A CIMD one has no redirect list of its own: it stands for as long as the document's URL is the same.
function reusableClient(saved, serverUrl, redirectUrl, cimdUrl, now) {
  const client = saved?.client;
  if (!client || !sameServer(saved.serverUrl, serverUrl)) return undefined;
  if (client.client_secret_expires_at && client.client_secret_expires_at * 1000 <= now) return undefined;
  if (client.cimd) return client.client_id === cimdUrl ? client : undefined;
  return [client.redirectUrl, ...(client.redirect_uris ?? [])].includes(redirectUrl) ? client : undefined;
}

// The provider for a sign-in the user asked for. It keeps what the SDK hands it in `staged` and writes nothing; the caller
// commits `staged` after the code was exchanged. tokens() is empty so that the SDK goes straight to a new authorization
// instead of refreshing what is stored: the user is signing in because that does not work.
export function interactiveProvider(ctx, { id, serverUrl, redirectUrl, state, saved, options = {} }) {
  const staged = {};
  let reusable = reusableClient(saved, serverUrl, redirectUrl, ctx.clientMetadataUrl, ctx.now());
  const usedSaved = reusable !== undefined;
  const provider = {
    redirectUrl,
    // CIMD: the server must advertise it and accept public clients (our document lists no secret).
    get clientMetadataUrl() {
      const methods = staged.discovery?.authorizationServerMetadata?.token_endpoint_auth_methods_supported;
      return ctx.clientMetadataUrl && methods?.includes('none') ? ctx.clientMetadataUrl : undefined;
    },
    get clientMetadata() {
      return {
        client_name: ctx.clientName, redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'], token_endpoint_auth_method: 'none',
      };
    },
    state: () => state,
    clientInformation: () => staged.client ?? reusable,
    saveClientInformation: (info) => {
      staged.client = { ...info, redirectUrl, ...(info.client_id === ctx.clientMetadataUrl ? { cimd: true } : {}) };
    },
    tokens: () => undefined,
    saveTokens: (tokens) => { staged.tokens = tokens; },
    saveCodeVerifier: (verifier) => { staged.verifier = verifier; },
    codeVerifier: () => {
      if (!staged.verifier) throw new Error(`No code verifier for ${id}.`);
      return staged.verifier;
    },
    saveDiscoveryState: (discovery) => { staged.discovery = discovery; },
    discoveryState: () => staged.discovery,
    redirectToAuthorization: (url) => {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`The authorization URL is ${url.protocol}; only http and https are opened.`);
      for (const [key, value] of Object.entries(options.authorizeParams ?? {})) {
        if (OWN_PARAMS.has(key)) throw new Error(`The authorization parameter ${key} is set by the sign-in itself.`);
        url.searchParams.set(key, String(value));
      }
      staged.url = url;
    },
    // Only what was staged: a failed sign-in must not reach what is stored.
    invalidateCredentials: (scope) => {
      if (scope === 'all' || scope === 'client') { staged.client = undefined; reusable = undefined; }
      if (scope === 'all' || scope === 'tokens') staged.tokens = undefined;
      if (scope === 'all' || scope === 'discovery') staged.discovery = undefined;
      if (scope === 'all' || scope === 'verifier') staged.verifier = undefined;
    },
  };
  if (options.resource === false) provider.validateResourceURL = async () => undefined;
  return { provider, staged, usedSaved, client: () => staged.client ?? reusable };
}
