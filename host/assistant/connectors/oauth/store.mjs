// What is kept for one connector's sign-in, and the wrappers that make the injected store safe to call from the MCP SDK.
//
// One JSON object per connector id (DSH's credential records in the plugin; a Map in the tests):
//   { v: 1, serverUrl, issuer, discovery, client, tokens, updatedAt }
//   discovery  the authorization server found for serverUrl (so a refresh needs no discovery), with when it was fetched
//   client     the registration (DCR or CIMD), with the redirect URL it was made for: a client is reused only for that one
//   tokens     the SDK's token fields plus obtainedAt and expiresAt (ms), stamped with the issuer they came from
// The code verifier and state of a sign-in that is still waiting are not kept: the loopback listener that could finish it
// cannot outlive the process, so a copy on disk could only be stale.

const VERSION = 1;
const EARLY_MS = 30_000;
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

// DSH's credential records refuse `undefined` (they must survive a JSON round trip), and the SDK's objects carry some.
export function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

export function sameServer(a, b) {
  try { return new URL(a).href === new URL(b).href; } catch { return a === b; }
}

// A record this version wrote, for this server. Anything else reads as "nothing stored".
function mine(record, serverUrl) {
  if (!record || typeof record !== 'object' || record.v !== VERSION) return undefined;
  return serverUrl === undefined || sameServer(record.serverUrl, serverUrl) ? record : undefined;
}

// The SDK stores through the functions built on this, and a throw there is not an error to it: in the refresh it is caught
// and taken for "refreshing did not work", which starts a new sign-in. So none of these throws.
export function guard(store) {
  return {
    async read(id, serverUrl) {
      try { return mine(await store.read(id), serverUrl); } catch { return undefined; }
    },
    // fn(record) may be async and may return undefined to leave the record as it is. Resolves { ok } or { ok: false, error }.
    async modify(id, fn) {
      try {
        await store.modify(id, async (record) => {
          const next = await fn(mine(record));
          return next === undefined ? undefined : jsonSafe({ v: VERSION, ...next });
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    },
    async remove(id) {
      try { await store.remove(id); return { ok: true }; } catch (error) { return { ok: false, error }; }
    },
  };
}

// The tokens as kept: what the server sent (no id_token: nothing here reads it), when, and until when. A server that
// sends no new refresh token keeps the old one.
export function stampTokens(raw, { issuer, now, previous }) {
  const refresh = raw.refresh_token ?? previous?.refresh_token;
  const scope = raw.scope ?? previous?.scope;
  const seconds = Number(raw.expires_in);
  return {
    access_token: raw.access_token,
    token_type: raw.token_type ?? 'Bearer',
    ...(refresh ? { refresh_token: refresh } : {}),
    ...(scope ? { scope } : {}),
    issuer: raw.issuer ?? issuer,
    obtainedAt: now,
    ...(seconds > 0 ? { expiresAt: now + seconds * 1000 } : {}),
  };
}

// Due for a refresh 30 seconds before it ends (`early` says another time), or half way for a token that lives less than twice that (or it would be
// refreshed on every call).
export function expiring(tokens, now, early = EARLY_MS) {
  if (!tokens?.expiresAt) return false;
  const lifetime = tokens.obtainedAt === undefined ? Infinity : tokens.expiresAt - tokens.obtainedAt;
  return tokens.expiresAt - now <= Math.min(early, lifetime / 2);
}

// What the SDK is shown: its own token shape, with the time left rather than the time it was issued with.
export function publicTokens(tokens, now) {
  const { expiresAt, obtainedAt: _obtained, ...rest } = tokens;
  return { ...rest, ...(expiresAt ? { expires_in: Math.max(0, Math.round((expiresAt - now) / 1000)) } : {}) };
}

// The stored tokens, or the ones a server sent that the store would not take (`unsaved`), whichever is newer. The unsaved
// ones are always later than what they could not replace, so a tie (same millisecond) is theirs.
export function newest(stored, unsaved) {
  if (!stored || !unsaved) return stored ?? unsaved;
  return (unsaved.obtainedAt ?? 0) >= (stored.obtainedAt ?? 0) ? unsaved : stored;
}

// Signed in = there is something to send, or something to get it with.
export function signedIn(tokens, now) {
  if (!tokens?.access_token) return false;
  return !tokens.expiresAt || tokens.expiresAt > now || Boolean(tokens.refresh_token);
}

export function freshDiscovery(discovery, now) {
  return discovery && discovery.fetchedAt > now - DISCOVERY_TTL_MS ? discovery : undefined;
}
