// Gives the connected MCP connectors to DSH, so that their tools are in every session of the owner and not only in a collection of 嘟嘟 (docs/assistant.md 3.1,
// "连上之后"). It is what a DSH plugin that mounts one MCP server does (dsh-notion-mcp, for one), done by the connector itself: the sign-in, keeping the token fresh and
// letting go are 嘟嘟's, and no other plugin is needed.
//
// DSH's own MCP client (`@deepseek-ai/dsh-mcp-client`, in every DSH) is a plugin that runs one server: it connects, lists and calls the tools (as `mcp__<name>__<tool>`),
// reconnects, shows images and asks the permission DSH asks. Mounting it is `mount(config)`, which hands back what ends it; the plugin gives this file that function. The
// client of this DSH does not take its secrets from the credential store, so the config holds them (it lives in memory and is never written): a token that changes means
// the server is mounted again with the new one.
//
//   const publisher = createPublisher({ mount, oauth, warn, onLost, setTimer, clearTimer });
//   await publisher.publish({ id, name, spec, secret })   -> { ok: true, server } | { ok: false, reason }     `spec` and `secret` as the connection has them (connections.mjs):
//                                                           { url, secretUrl? } | { command, args, env: [names] }, and { token?, env?, url? } from the credential store
//   await publisher.withdraw(id)                          the server leaves DSH
//   publisher.has(id) / publisher.published()             what DSH has been given
//   await publisher.close()                               all of it withdrawn (the folder in use changes, or the plugin stops)
//
// `mount(config) -> { dispose() }` (it may be async and throw), or none: an old DSH or one that cannot mount it gets nothing given (`reason` is 'no-mount'). `oauth` is the
// sign-in of oauth/ (`status`, `providerFor`): the access token of a connector that is signed in is renewed five minutes before it ends, and the server mounted again with the
// new one. A token that cannot be renewed any more (the server dropped the grant) takes the server out of DSH and says so through `onLost(id, 'needs-auth')`.
import { createHash } from 'node:crypto';

const LEAD_MS = 5 * 60_000; // the token is renewed this long before it ends: a failed renewal has time to be tried again, and the server is out of DSH for a moment only
const MIN_WAIT_MS = 15_000; // a token is looked at no more often than this
const MAX_WAIT_MS = 6 * 3_600_000; // a timer is not left for longer
const RETRY_MS = [60_000, 120_000, 300_000]; // after a renewal that failed for another reason than the grant being gone
const START_MS = { remote: 30_000, local: 60_000 }; // what DSH gives one connection attempt (a command that is fetched the first time takes a while)

/** The name the server has in DSH, and so the start of the names of its tools (mcp__<name>__<tool>): the connector's id, within what DSH takes ([A-Za-z0-9_-], 32 at most). */
export function serverName(id) {
  const clean = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
  return clean.length <= 32 ? clean : `${clean.slice(0, 23)}_${createHash('sha256').update(String(id)).digest('hex').slice(0, 8)}`;
}

/** What DSH's MCP client is given for one connector. `access` is the access token of a sign-in (a token of the connector's own wins). */
function configFor(id, spec, secret, access) {
  const base = { serverName: serverName(id), failOnStartupError: false, toolCallTimeoutMs: 60_000 };
  if (spec.command) {
    const env = {};
    for (const name of spec.env ?? []) {
      const value = secret?.env?.[name];
      if (value !== undefined && value !== '') env[name] = String(value);
    }
    return { ...base, transport: 'stdio', command: spec.command, args: spec.args ?? [], ...(Object.keys(env).length ? { env } : {}), startupTimeoutMs: START_MS.local };
  }
  const url = spec.secretUrl ? secret?.url : spec.url;
  if (!url) throw new Error('The address is no longer in the credential store.');
  const bearer = secret?.token || access;
  return { ...base, transport: 'streamable-http', url, ...(bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {}), startupTimeoutMs: START_MS.remote };
}

export function createPublisher({ mount, oauth = null, warn = () => {}, onLost = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const given = new Map(); // id -> { server, signature, child, spec, secret, provider?, timer?, tries }
  const retries = new Map(); // id -> { item, tries, timer }: a publish that failed (the network was not there yet at the start, DSH would not mount) and is tried again
  const queues = new Map(); // id -> the last thing asked for this connector: one at a time for one connector
  let closed = false;

  const serial = (id, work) => {
    const run = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(id, run.catch(() => {}));
    return run;
  };

  async function end(child) {
    try { await child?.dispose?.(); } catch (error) { warn(`[dudu] A connector could not be taken out of DSH: ${error?.message ?? error}`); }
  }

  function forget(id) {
    const retry = retries.get(id);
    if (retry) { clearTimer(retry.timer); retries.delete(id); }
  }

  /** What is given for one connector, undone: the timer and the server in DSH (and a publish that was to be tried again). */
  async function release(id) {
    forget(id);
    const held = given.get(id);
    if (!held) return;
    given.delete(id);
    clearTimer(held.timer);
    await end(held.child);
  }

  /** Looks at the token again when it is due: expiresIn is what is left of it, in ms (not known for a token that does not end). */
  function arm(id, expiresIn) {
    const held = given.get(id);
    if (!held?.provider || closed) return;
    if (expiresIn === undefined) { clearTimer(held.timer); held.timer = undefined; return; }
    schedule(id, Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, expiresIn - LEAD_MS + 2_000)));
  }

  function schedule(id, wait) {
    const held = given.get(id);
    if (!held || closed) return;
    clearTimer(held.timer);
    held.timer = setTimer(() => { void renew(id); }, wait);
    held.timer?.unref?.();
  }

  /** Mounts the server with this config in place of what DSH has now (the same config changes nothing). Throws when DSH will not. */
  async function remount(id, held, config) {
    const signature = JSON.stringify(config);
    if (held?.signature === signature) return held;
    if (held) { clearTimer(held.timer); await end(held.child); }
    const child = await mount(config);
    return { ...(held ?? {}), server: config.serverName, signature, child };
  }

  const renew = (id) => serial(id, async () => {
    const held = given.get(id);
    if (!held?.provider || closed) return;
    try {
      const tokens = await held.provider.tokens(); // renews it when it is due (LEAD_MS before its end)
      if (!tokens?.access_token) { await release(id); onLost(id, 'needs-auth'); return; }
      const next = await remount(id, held, configFor(id, held.spec, held.secret, tokens.access_token));
      given.set(id, next);
      next.tries = 0;
      arm(id, tokens.expires_in === undefined ? undefined : tokens.expires_in * 1000);
    } catch (error) {
      held.tries += 1;
      warn(`[dudu] The sign-in of ${id} could not be renewed (it is tried again): ${error?.message ?? error}`);
      schedule(id, RETRY_MS[Math.min(held.tries - 1, RETRY_MS.length - 1)]);
    }
  });

  function publish({ id, name, spec, secret }) {
    return serial(id, async () => {
      if (closed) return { ok: false, reason: 'closed' };
      if (typeof mount !== 'function') return { ok: false, reason: 'no-mount' };
      if (!spec || (!spec.url && !spec.command)) return { ok: false, reason: 'The connector has no server.' };
      try {
        // The sign-in of an address that has no token of its own: the access token it holds now (a server that wants none has none).
        let provider;
        let access;
        let expiresIn; // what is left of the access token, in ms (not known for a token that does not end)
        if (spec.url && !secret?.token && oauth && await oauth.status(id) === 'signed-in') {
          provider = oauth.providerFor(id, spec.secretUrl ? secret?.url : spec.url, { refreshLeadMs: LEAD_MS });
          const tokens = await provider.tokens();
          access = tokens?.access_token;
          if (!access) { await release(id); return { ok: false, reason: 'needs-auth' }; }
          if (tokens.expires_in !== undefined) expiresIn = tokens.expires_in * 1000;
        }
        const held = await remount(id, given.get(id), configFor(id, spec, secret, access));
        given.set(id, Object.assign(held, { spec, secret: secret ?? {}, provider, tries: 0 }));
        forget(id);
        arm(id, expiresIn);
        return { ok: true, server: held.server };
      } catch (error) {
        // A server that was given and could not be mounted again is not in DSH any more: what is kept of it goes (and what is left of it is ended). It is tried again later:
        // the machine may have no network yet when the plugin starts, and the token cannot be renewed without it.
        const tried = retries.get(id)?.tries ?? 0; // release forgets the trying: the number of times is kept for the next wait
        await release(id);
        again({ id, name, spec, secret }, tried);
        return { ok: false, reason: String(error?.message ?? error).split('\n')[0].slice(0, 200) };
      }
    });
  }

  function again(item, tried) {
    if (closed) return;
    const tries = tried + 1;
    clearTimer(retries.get(item.id)?.timer);
    const timer = setTimer(() => { void publish(item).then((result) => { if (!result.ok && result.reason !== 'closed') warn(`[dudu] ${item.name} is still not in DSH's sessions: ${result.reason}`); }); }, RETRY_MS[Math.min(tries - 1, RETRY_MS.length - 1)]);
    timer?.unref?.();
    retries.set(item.id, { item, tries, timer });
  }

  return {
    publish,
    withdraw: (id) => serial(id, () => release(id)),
    has: (id) => given.has(id),
    published: () => [...given].map(([id, held]) => ({ id, server: held.server })),
    async close() {
      closed = true;
      for (const id of [...retries.keys()]) forget(id);
      for (const held of given.values()) clearTimer(held.timer);
      await Promise.allSettled([...queues.values()]);
      for (const id of [...given.keys()]) await release(id);
    },
  };
}
