import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OarNormalizer, createOarProvider, parseInput } from '../oar.mjs';
import { executableInstallation } from '../oar-runtimes.mjs';
import { PI_TOOLS, fallbackSpec, mirrorName } from './pi-tools.mjs';

// Pi through OAR, which starts the installed `pi` in its RPC mode. The `pi` on this computer, with this user's models, login,
// extensions and settings (~/.pi/agent), does the work, and its sessions are ordinary Pi sessions that `pi --resume` lists.
//
// OAR needs Pi's SDK in the host process as well (it reads the catalog and the session files with it), so the SDK travels in a bundle
// of its own (oar-pi.mjs) that this driver imports when a Pi session first opens or the models are first listed. A computer without Pi
// never loads it. Finding the executable and reading its version needs none of it.

/** The Pi tools that run commands or change files: what a read-only session may not use. */
export const PI_WRITING_TOOLS = ['bash', 'edit', 'write'];

/** OAR starts the executable in RPC mode only from this version on (its own check, verified on Pi 1.4.0 and 1.5.x). */
export const PI_MINIMUM_VERSION = '1.4.0';

const text = (value) => (typeof value === 'string' ? value : '');
const BUNDLED = Object.freeze({ kind: 'available', via: 'bundled' });

/** [major, minor, patch] of a plain `1.4.0`; nothing for anything else (a pre-release is not covered by what OAR verified). */
const versionParts = (version) => /^(\d+)\.(\d+)\.(\d+)$/.exec(text(version).trim())?.slice(1).map(Number);
export function versionAtLeast(version, minimum = PI_MINIMUM_VERSION) {
  const have = versionParts(version);
  const need = versionParts(minimum);
  if (!have || !need) return false;
  for (let index = 0; index < 3; index += 1) if (have[index] !== need[index]) return have[index] > need[index];
  return true;
}

/**
 * Where an npm-installed `pi` lands when the process's PATH does not list it: npm's own prefix, Homebrew, Bun, Volta, pnpm, the
 * install script's folder and every Node version nvm has. A GUI process's PATH can miss all of them.
 */
export function piExecutableCandidates(home = homedir(), exists = (folder) => { try { return readdirSync(folder); } catch { return []; } }) {
  const folders = [
    join(home, '.npm-global', 'bin'), join(home, '.local', 'bin'), join(home, '.bun', 'bin'), join(home, '.volta', 'bin'),
    join(home, 'Library', 'pnpm'), join(home, '.local', 'share', 'pnpm'), '/opt/homebrew/bin', '/usr/local/bin',
  ];
  const nvm = join(home, '.nvm', 'versions', 'node');
  for (const version of exists(nvm).sort().reverse()) folders.push(join(nvm, version, 'bin'));
  return folders.map((folder) => join(folder, 'pi'));
}

/** What the settings page shows: `executableInstallation` (OAR's own probe: override, PATH, candidates, `--version`), and the version floor. */
export function createPiInstallation({ probe = executableInstallation('OAR_PI_BIN', 'pi', () => piExecutableCandidates()) } = {}) {
  return async (options) => {
    const snapshot = await probe(options);
    if (snapshot.kind === 'available' && snapshot.via === 'executable' && !versionAtLeast(snapshot.version)) {
      return {
        kind: 'unsupported',
        reason: snapshot.version ? `Pi ${PI_MINIMUM_VERSION} or newer is needed (found ${snapshot.version}).` : `Pi ${PI_MINIMUM_VERSION} or newer is needed (the version could not be read).`,
      };
    }
    return snapshot;
  };
}

/**
 * The runtime OAR drives the found executable with. Opened on first use from the Pi bundle; every call hands OAR the one installation
 * its Pi runtime accepts (its own SDK catalog), while the command it starts is the one found on this computer.
 */
export function piRuntimeFor(installation, load = () => import('../oar-pi.mjs')) {
  let loaded;
  const runtime = () => (loaded ??= load().then(({ createPiRuntime }) => createPiRuntime({ execution: 'subprocess', command: installation.command })));
  return {
    id: 'pi',
    listModels: async (_installation, options) => (await runtime()).listModels(BUNDLED, options),
    session: async (_installation, options) => (await runtime()).session(BUNDLED, options),
  };
}

/**
 * Pi reports a message, then runs its tool calls one by one, naming each with its complete input: a call closes its step and the
 * result comes back before the next message, as in Codex. Tools are mirrored under `pi_<name>` (see pi-tools.mjs).
 */
export class PiNormalizer extends OarNormalizer {
  started(event) {
    return { name: mirrorName(text(event.tool) || 'unknown'), ...(event.input === undefined ? {} : { input: parseInput(event.input) }) };
  }
}

/** Pi has no sandbox and no approvals: a read-only session simply has no tool that could write. */
export const piSession = ({ permission }) => ({ ...(permission === 'read-only' ? { disallowedTools: PI_WRITING_TOOLS } : {}) });

export function createPiProvider({ load } = {}) {
  return createOarProvider({
    id: 'pi', name: 'Pi', binaryEnv: 'OAR_PI_BIN',
    installation: createPiInstallation(),
    runtimeFor: (installation) => piRuntimeFor(installation, load),
    tools: PI_TOOLS, fallbackTool: fallbackSpec,
    login: 'Run `pi` in a terminal and sign in with /login.',
    normalizer: (options) => new PiNormalizer(options),
    fallbackModels: [{ id: 'default', displayName: 'Default' }],
    // Another harness's identity must not leak into the child. Pi's own variables (PI_CODING_AGENT_DIR, PI_OFFLINE…) must survive.
    scrub: { patterns: [/^(ORCA_|HERDR_)/] },
    session: piSession,
    // Pi's OAR session has no native background tasks to observe.
    backgroundTasks: false,
  });
}

export const piProvider = createPiProvider();
