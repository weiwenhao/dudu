// Command-line connectors (docs/assistant.md 3.1): { kind: 'cli', command, allow: [templates] }.
//
// Only an operation that matches an `allow` template runs. A template is the words that follow the command, with
// {placeholders} for the values the model supplies: "calendar +agenda --start {date}". The model never writes a command
// line; it picks an operation and gives values. Each value becomes part of one argv element, the program is started
// with child_process.execFile (no shell, so quotes, `;`, `$()` and backticks are just characters), and a value that
// would be read as an option, or that holds a control character, is refused. The run has a timeout and an output cap,
// and the program's output is returned as data (index.mjs frames it).
import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { TEXT } from './text.mjs';

export class TemplateError extends Error {}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]{0,29})\}/;
export const MAX_VALUE = 500;

// "calendar +agenda --start {date}" -> { text, tokens, names }. A token is a list of parts: text, or { name }.
export function compileTemplate(source) {
  const text = String(source).trim();
  if (!text) throw new TemplateError(TEXT.template.empty);
  if (text.length > 500) throw new TemplateError(TEXT.template.tooLong);
  const words = [];
  let word = null;
  let quote = null;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      word ??= '';
    } else if (/\s/.test(char)) {
      if (word !== null) words.push(word);
      word = null;
    } else {
      word = (word ?? '') + char;
    }
  }
  if (quote) throw new TemplateError(TEXT.template.unclosedQuote);
  if (word !== null) words.push(word);
  if (!words.length) throw new TemplateError(TEXT.template.empty);
  if (words.length > 40) throw new TemplateError(TEXT.template.tooMany);
  const tokens = words.map((piece) => piece.split(new RegExp(PLACEHOLDER, 'g')).map((part, i) => (i % 2 ? { name: part } : part)).filter((part) => part !== ''));
  // A placeholder in the first word would let the model choose the subcommand, which is what the allow list is for.
  if (tokens[0].some((part) => typeof part !== 'string')) throw new TemplateError(TEXT.template.firstWord);
  const names = [...new Set(tokens.flat().filter((part) => typeof part !== 'string').map((part) => part.name))];
  return { text, tokens, names };
}

// The entries of `allow` as objects: a string is { run }.
export const allowEntries = (config) => (config.allow ?? []).map((entry) => (typeof entry === 'string' ? { run: entry } : entry));

// "calendar +agenda --start {date}" -> calendar_agenda: the fixed words that are not options.
function baseName(compiled) {
  const words = compiled.tokens.filter((parts) => parts.every((part) => typeof part === 'string')).map((parts) => parts.join('')).filter((piece) => !piece.startsWith('-'));
  return words.join('_').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 29).replace(/_+$/, '') || 'run';
}

// The operations of a connector, in the order of its allow list. Names are stable for a given list and unique inside it.
export function cliOperations(config) {
  const used = new Set();
  return allowEntries(config).map((entry) => {
    const compiled = compileTemplate(entry.run);
    const base = entry.name ?? baseName(compiled);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base.slice(0, 29 - String(n).length - 1)}_${n}`;
    used.add(name);
    return { name, template: compiled.text, compiled, readOnly: entry.readOnly === true, description: entry.description ?? '' };
  });
}

export const inputSchemaOf = (compiled) => ({
  type: 'object',
  properties: Object.fromEntries(compiled.names.map((name) => [name, { type: 'string', maxLength: MAX_VALUE }])),
  required: [...compiled.names],
  additionalProperties: false,
});

// The values the model gave -> the argv of the run, or the list of what is wrong.
export function buildArgv(compiled, args) {
  const problems = [];
  const given = args == null ? {} : args;
  if (typeof given !== 'object' || Array.isArray(given)) return { problems: [TEXT.msg.argObject] };
  for (const key of Object.keys(given)) if (!compiled.names.includes(key)) problems.push(TEXT.msg.argUnknown(key));
  const values = {};
  for (const name of compiled.names) {
    const value = given[name];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) problems.push(TEXT.msg.argMissing(name));
    else if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) problems.push(TEXT.msg.argType(name));
    else if (String(value).length > MAX_VALUE) problems.push(TEXT.msg.argLong(name, MAX_VALUE));
    else if (/[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(String(value))) problems.push(TEXT.msg.argControl(name));
    else values[name] = String(value);
  }
  if (problems.length) return { problems };
  const argv = compiled.tokens.map((parts) => parts.map((part) => (typeof part === 'string' ? part : values[part.name])).join(''));
  // A value that is a whole word of its own and starts with "-" would be taken for an option of the program.
  for (const [i, parts] of compiled.tokens.entries()) {
    if (parts.length === 1 && typeof parts[0] !== 'string' && argv[i].startsWith('-')) problems.push(TEXT.msg.argDash(parts[0].name));
  }
  return problems.length ? { problems } : { argv };
}

// --- finding and running the program

// What a program gets of this process's environment: enough to run and to reach the network through a proxy, none of
// the rest (DSH's own environment holds API keys that no connector should see). The connector's own `env` is added on top.
const KEEP = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LANGUAGE', 'TZ', 'TMPDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'SSL_CERT_FILE',
  'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']);

export function baseEnv(env) {
  const out = { NO_COLOR: '1' };
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string' && (KEEP.has(key) || key.startsWith('LC_'))) out[key] = value;
  return out;
}

// The file a command name stands for, looked up on this PATH only (never relative to the working directory).
export function which(command, env = process.env) {
  const executable = (file) => {
    try {
      if (!statSync(file).isFile()) return false;
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (isAbsolute(command)) return executable(command) ? command : null;
  if (/[\\/]/.test(command)) return null;
  const extensions = process.platform === 'win32' ? ['', ...String(env.PATHEXT ?? '.EXE;.CMD').split(';')] : [''];
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    for (const extension of extensions) if (executable(join(dir, command + extension))) return join(dir, command + extension);
  }
  return null;
}

// The default process runner: execFile, argv only, no shell. stdin is closed at once so a program that waits for input
// ends instead of hanging until the timeout. Resolves with what happened and never rejects.
export function runProcess(file, args, { cwd, env, timeoutMs = 30_000, maxBytes = 1_048_576, signal } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const done = (error, stdout = '', stderr = '') => {
      const result = { code: 0, signal: null, stdout, stderr, timedOut: false, truncated: false, failed: null };
      if (error) {
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          result.truncated = true;
          result.code = null;
        } else if (error.killed || error.signal || error.name === 'AbortError') {
          result.code = null;
          result.signal = error.signal ?? 'SIGTERM';
          result.timedOut = Boolean(error.killed) && Date.now() - started >= timeoutMs - 50;
        } else if (typeof error.code === 'number') {
          result.code = error.code;
        } else {
          result.code = null;
          result.failed = error.code ?? 'EFAILED';
        }
      }
      resolve(result);
    };
    try {
      const child = execFile(file, args, { cwd, env, timeout: timeoutMs, maxBuffer: maxBytes, killSignal: 'SIGKILL', windowsHide: true, encoding: 'utf8', signal }, done);
      child.stdin?.on('error', () => {});
      child.stdin?.end();
    } catch (error) {
      done(error);
    }
  });
}
