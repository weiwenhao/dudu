// What the box of "add a custom connector" took the pasted text for (docs/assistant.md 3.1, "添加自定义连接器"): one or more MCP servers, remote (an address) or
// local (a command), or a sentence that says how to read the service (a command-line connector). Nothing is run and nothing is stored here: it reads text, and for a
// single address it asks the server (`probe`, injected) what it needs.
//
//   recognize(text, { probe?, exists? }) -> Promise<{
//     kind: 'remote' | 'local' | 'sentence' | null,     null: nothing was written
//     name,                                              the name to start with (from the address, the command, or the server's own name); '' for a sentence
//     entries: [{ name, spec }],                         every server found; empty for a sentence
//     count,                                             how many servers (a pasted mcp.json can hold several)
//     auth?: 'none' | 'oauth' | 'token',                 only for one address, once `probe` has answered; 'token' also when it could not tell
//     env: [name],                                       names of environment variables / headers the pasted text brings (their values are for the credential store)
//     secretInUrl: boolean,                              the address itself holds a secret: it is kept whole in the credential store and only its host is shown
//     problem?: string }>
//   spec: { transport: 'http' | 'sse' | 'stdio', url, headers } | { transport: 'stdio', command, args, env }
//
// A command is only taken for a local server when the pasted text says so by its shape (`npx`, `uvx`, `bunx`, `node`, `docker`, `claude mcp add ...`, an mcp.json),
// or its first word is the path of a program that is there. Anything else, including a command that is not one of those, is a sentence: pasting a command never
// runs it, and it is never started before it is saved.
import { statSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute } from 'node:path';
import { findSecret } from '../memory/secrets.mjs';
import { parseMcpImport, tokenize } from './paste.mjs';

/** The transport word of a pasted entry as dudu names it. */
function transportOf(config) {
  const word = String(config.transport ?? '').toLowerCase();
  if (typeof config.url === 'string') return word === 'sse' ? 'sse' : 'http';
  return 'stdio';
}

/** A name that can stand as a connector's id and be told apart: letters, digits, dash, underscore. */
export const slug = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 32);

function specOf(config) {
  const transport = transportOf(config);
  if (transport === 'stdio') {
    const env = config.env && typeof config.env === 'object' && !Array.isArray(config.env) ? { ...config.env } : {};
    return { transport, command: String(config.command), args: Array.isArray(config.args) ? config.args.map(String) : [], env };
  }
  const headers = config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers) ? { ...config.headers } : {};
  return { transport, url: String(config.url), headers };
}

/** The path of a program the first word names, expanded: `/Applications/Pencil.app/...` or `~/bin/x`; null when it is not an existing, executable file. */
function programAt(word, exists) {
  const path = word.startsWith('~/') ? `${homedir()}${word.slice(1)}` : word;
  if (!isAbsolute(path)) return null;
  try {
    if (exists) return exists(path) ? path : null;
    if (!statSync(path).isFile()) return null;
    accessSync(path, constants.X_OK);
    return path;
  } catch {
    return null;
  }
}

/** A name for a program that is not one of the launchers: the app it sits in (`Pencil` for `/Applications/Pencil.app/...`), else its file name. */
function nameOfProgram(path) {
  const app = path.match(/\/([^/]+)\.app\//);
  return slug(app ? app[1] : basename(path)) || 'server';
}

export async function recognize(text, { probe, exists } = {}) {
  const raw = typeof text === 'string' ? text.trim() : '';
  const none = { kind: null, name: '', entries: [], count: 0, env: [], secretInUrl: false };
  if (!raw) return none;

  let found = parseMcpImport(raw);
  if (!found) {
    // A line that starts with the path of a program that is there: a local server, the rest are its arguments.
    const tokens = !raw.includes('\n') ? tokenize(raw) : null;
    const path = tokens?.length ? programAt(tokens[0], exists) : null;
    if (path) found = [{ name: nameOfProgram(path), config: { command: path, args: tokens.slice(1) } }];
  }
  if (!found) return { ...none, kind: 'sentence', count: 0 };

  // `npx -y @drawio/mcp` is named `mcp` by the parser: a name that says nothing is the package's scope instead (`drawio`).
  const named = (name, config) => {
    const scope = (Array.isArray(config.args) ? config.args : []).map((arg) => String(arg).match(/^@([^/@]+)\//)?.[1]).find(Boolean);
    return slug(['mcp', 'server'].includes(name) && scope ? scope : name) || 'server';
  };
  const entries = found.map(({ name, config }) => ({ name: named(name, config), spec: specOf(config) }));
  const first = entries[0].spec;
  const kind = first.transport === 'stdio' ? 'local' : 'remote';
  const env = [...new Set(entries.flatMap(({ spec }) => Object.keys(spec.env ?? spec.headers ?? {})))];
  const secretInUrl = entries.some(({ spec }) => spec.url && (Boolean(findSecret(spec.url)) || /[?&](?:key|token|api[_-]?key|access[_-]?token|secret|auth)=/i.test(spec.url)));
  const out = { kind, name: entries[0].name, entries, count: entries.length, env, secretInUrl };

  // Only one address is asked about: the answer decides what the form still needs (nothing, a browser sign-in, or a token). Not being able to tell is not a refusal.
  if (kind === 'remote' && entries.length === 1 && probe) {
    try {
      const answer = await probe(first.url, first);
      if (answer?.auth) out.auth = answer.auth;
      if (answer?.problem) out.problem = answer.problem;
    } catch (error) {
      out.problem = String(error?.message ?? error).slice(0, 200);
    }
    out.auth ??= 'token';
  }
  return out;
}
