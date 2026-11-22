// What a phone app tells the plugin about itself when it connects (owner, 2026-11-21).
//
// The plugin installs as the newest version while an iPhone app waits days for review, so the plugin has to keep answering every app that is out there. It cannot tell the old
// apps apart: they say nothing. So the rule is, a phone that declares nothing is answered exactly as before (the shapes of App Store build 143, API v1), and only an app that
// declares it understands more is given more. `understands(client, 'name')` is the one question to ask before giving a new shape; see AGENTS.md, "Compatibility with released apps".
//
//   POST /api/v1/connect { app?: { platform: 'ios' | 'android', version: '0.1.1', build: '150' }, capabilities?: ['settings-ui-2', ...] }
//
// Everything is bounded and optional: an old app sends no body at all, a newer one may send fields this plugin does not know, and nothing here can fail a connection.

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/u;
const BUILD = /^[0-9]{1,9}$/u;
const CAPABILITY = /^[a-z0-9][a-z0-9._-]{0,47}$/u;
const MAX_CAPABILITIES = 32;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** `{ platform, version?, build?, capabilities }` from what the phone said; `platform` falls back to what the request headers said. Never throws. */
export function cleanClient(body, platform = null) {
  const app = isRecord(body) && isRecord(body.app) ? body.app : {};
  const declared = ['ios', 'android'].includes(app.platform) ? app.platform : platform;
  const version = typeof app.version === 'string' && VERSION.test(app.version) ? app.version : undefined;
  const build = ['string', 'number'].includes(typeof app.build) && BUILD.test(String(app.build)) ? String(app.build) : undefined;
  const asked = isRecord(body) && Array.isArray(body.capabilities) ? body.capabilities : [];
  const capabilities = [...new Set(asked.filter((name) => typeof name === 'string' && CAPABILITY.test(name)))].sort().slice(0, MAX_CAPABILITIES);
  return { platform: declared, ...(version ? { version } : {}), ...(build ? { build } : {}), capabilities };
}

/** Whether this phone said it understands `capability`. A phone that declared nothing never does: it is the baseline. */
export const understands = (client, capability) => Boolean(client?.capabilities?.includes(capability));
