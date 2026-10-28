import { execFile } from 'node:child_process';
import { access, constants, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

// A desktop app started from the Dock or Finder does not inherit the PATH of a terminal, and that is where
// `claude` and `codex` live. So after the inherited PATH, the usual install directories are looked at, and
// last the PATH a login shell would build.

const run = (file, args, { timeout = 5000, env } = {}) => new Promise((resolve) => {
  execFile(file, args, { timeout, env: env ?? process.env, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error });
  });
});

async function isExecutable(path) {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch { return false; }
}

export const SYSTEM_DIRECTORIES = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

/** Directories where a user-level CLI usually lands, in the order a terminal would most likely find it. */
export async function commonDirectories(home = homedir(), system = SYSTEM_DIRECTORIES) {
  const fixed = [
    join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'), join(home, '.cargo', 'bin'), join(home, 'bin'),
  ];
  // nvm keeps one bin directory per node version; the newest is the one a fresh shell would pick up.
  try {
    const versions = (await readdir(join(home, '.nvm', 'versions', 'node'))).sort().reverse();
    for (const version of versions) fixed.push(join(home, '.nvm', 'versions', 'node', version, 'bin'));
  } catch { /* no nvm */ }
  return [...fixed, ...system];
}

/** The PATH a login shell builds. The shell is asked for it once and never to run anything else. */
export async function loginShellPath({ shell = process.env.SHELL || '/bin/zsh', timeout = 4000 } = {}) {
  const marker = '__DUDU_PATH__';
  const result = await run(shell, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], { timeout });
  const match = result.stdout.match(new RegExp(`${marker}(.*?)${marker}`, 's'));
  return match ? match[1].split(delimiter).filter(Boolean) : [];
}

/**
 * Find an executable by name. `override` (a path the user configured) wins; then the inherited PATH, the
 * usual directories and finally a login shell's PATH. Nothing is spawned unless the cheaper places miss.
 */
export async function findExecutable(name, { override, env = process.env, home = homedir(), systemDirectories, shellPath = loginShellPath } = {}) {
  if (override) return (await isExecutable(override)) ? { path: override, source: 'configured' } : undefined;
  const inherited = (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const [source, directories] of [['path', inherited], ['common', await commonDirectories(home, systemDirectories)]]) {
    for (const directory of directories) {
      const candidate = join(directory, name);
      if (await isExecutable(candidate)) return { path: candidate, source };
    }
  }
  for (const directory of await shellPath()) {
    const candidate = join(directory, name);
    if (await isExecutable(candidate)) return { path: candidate, source: 'login-shell' };
  }
  return undefined;
}

export function parseVersion(text) {
  const match = String(text).match(/(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? { text: match[0], parts: [Number(match[1]), Number(match[2]), Number(match[3])] } : undefined;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** `<bin> --version`, with a deadline; a hung CLI must not stall DSH. */
export async function probeVersion(path, { timeout = 6000 } = {}) {
  const result = await run(path, ['--version'], { timeout });
  return result.ok ? parseVersion(result.stdout || result.stderr) : undefined;
}

/**
 * What the settings page and the provider chip need to know about one harness.
 * `state` is `ready`, `outdated`, `missing` or `broken`; `reason` names what to fix in the user's words of the CLI.
 */
export async function detectHarness({ name, minVersion, override, env, home, systemDirectories, shellPath }) {
  const found = await findExecutable(name, { override, env, home, systemDirectories, shellPath });
  if (!found) return { name, state: 'missing', reason: override ? `${override} is not an executable file.` : `${name} was not found.` };
  const version = await probeVersion(found.path);
  if (!version) return { name, state: 'broken', path: found.path, source: found.source, reason: `${name} did not report a version.` };
  if (minVersion && compareVersions(version.parts, minVersion.split('.').map(Number)) < 0) {
    return { name, state: 'outdated', path: found.path, source: found.source, version: version.text, reason: `${name} ${version.text} is older than ${minVersion}.` };
  }
  return { name, state: 'ready', path: found.path, source: found.source, version: version.text };
}
