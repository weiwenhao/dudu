import { harnessError } from '../harness-bridge.mjs';
import { OarNormalizer, createOarProvider, parseInput } from '../oar.mjs';
import {
  antigravityRuntime, classifyTool, codebuddyRuntime, devinRuntime, factoryRuntime, grokRuntime, kimiRuntime, opencodeRuntime, qoderRuntime, qwenRuntime,
} from '../oar-runtimes.mjs';
import { canonicalInput, fallbackSpecOf, kindOf, mirrorName, toolSpecs } from './universal-tools.mjs';

// Grok, Kimi, OpenCode, Antigravity, CodeBuddy, Devin, Factory, Qwen and Qoder through OAR. They differ in how OAR reaches them (the first
// six over ACP, Qwen and Qoder over stream-json, Factory over droid's own protocol) and in what they call their tools, and not in what DSH
// needs of them, so one driver serves all nine: OAR starts the installed command, reads its protocol and resumes its sessions, and this
// reads OAR's records, which are the same for every runtime, as the steps the bridge replays.
//
// What they share, and where Claude, Codex and Pi differ:
//   * Nobody answers their requests. OAR answers a runtime's permission and terminal requests itself (they are not a reason to end the turn).
//   * No sandbox and no way to deny a tool that OAR's channel could verify, so the access mode `read-only` cannot be kept: a session in it is
//     refused instead of running with a write access the person asked it not to have. The other modes run as the harness runs.
//   * A message written while the harness works waits for the next turn (`steering: false`): a steer that misses the turn runs as the
//     harness's own turn, which DSH would not wait for.
//   * No DSH-created background tasks, subagents or goals. OAR's native child reports still pass through the shared
//     team observer; OpenCode 2.3+ explicitly marks its children as background. Task reports without that flag do not
//     establish independent background execution. These runtimes do not support our native terminal-output extension.

const text = (value) => (typeof value === 'string' ? value : '');

/** What each harness is: its OAR runtime, the variable that names its executable, and what to do when it is not signed in. */
export const UNIVERSAL_HARNESSES = Object.freeze([
  { id: 'grok', name: 'Grok', runtime: grokRuntime, binaryEnv: 'OAR_GROK_BIN', login: 'Run `grok login` in a terminal.' },
  { id: 'kimi', name: 'Kimi', runtime: kimiRuntime, binaryEnv: 'OAR_KIMI_BIN', login: 'Run `kimi login` in a terminal.' },
  { id: 'opencode', name: 'OpenCode', runtime: opencodeRuntime, binaryEnv: 'OAR_OPENCODE_BIN', login: 'Run `opencode auth login` in a terminal.' },
  { id: 'antigravity', name: 'Antigravity', runtime: antigravityRuntime, binaryEnv: 'OAR_ANTIGRAVITY_BIN', login: 'Run `agy` in a terminal and sign in.' },
  { id: 'codebuddy', name: 'CodeBuddy', runtime: codebuddyRuntime, binaryEnv: 'OAR_CODEBUDDY_BIN', login: 'Run `codebuddy` in a terminal and sign in.' },
  { id: 'devin', name: 'Devin', runtime: devinRuntime, binaryEnv: 'OAR_DEVIN_BIN', login: 'Run `devin auth login` in a terminal.' },
  { id: 'factory', name: 'Factory', runtime: factoryRuntime, binaryEnv: 'OAR_FACTORY_BIN', login: 'Run `droid` in a terminal and sign in.' },
  { id: 'qwen', name: 'Qwen', runtime: qwenRuntime, binaryEnv: 'OAR_QWEN_BIN', login: 'Run `qwen` in a terminal and sign in.' },
  { id: 'qoder', name: 'Qoder', runtime: qoderRuntime, binaryEnv: 'OAR_QODER_BIN', login: 'Run `qodercli login` in a terminal.' },
]);

/** The ACP tool call's own category (`execute`, `read`, `edit`...), which the opening frame carries beside the title. */
const acpKindOf = (record) => text(record?.body?.native?.update?.kind);

/** Whether the input a call starts with is all of it. ACP agents often open a call with the arguments still to come (`{cwd}` only, nothing). */
function complete(kind, raw, classified) {
  switch (kind) {
    case 'run_command': return Boolean(classified.command || text(raw.command) || text(raw.cmd) || text(raw.CommandLine));
    case 'read_file': case 'edit_file': return Boolean(classified.paths?.length || canonicalInput({ kind, tool: '', raw }).path);
    case 'search': return Boolean(canonicalInput({ kind, tool: '', raw }).pattern);
    case 'web': return Boolean(canonicalInput({ kind, tool: '', raw }).query);
    case 'fetch': return Boolean(canonicalInput({ kind, tool: '', raw }).url);
    case 'mcp': return true;
    default: return Object.keys(raw).length > 0;
  }
}

/**
 * OAR's records of any of these harnesses as steps. A step ends with the result of the call that closes it (no message boundary is
 * reported), and every call is named for what it does, not for what the vendor calls it (universal-tools.mjs).
 */
export class UniversalNormalizer extends OarNormalizer {
  #calls = new Map();   // callId -> { tool, kind }

  constructor({ id, name, login, classify = classifyTool }) {
    super({ name, login });
    this.id = id;
    this.classify = classify;
  }

  autoAnswered() { return true; }

  #classified(tool, input) {
    try { return this.classify(this.id, tool, input === undefined ? undefined : typeof input === 'string' ? input : JSON.stringify(input)) ?? {}; }
    catch { return {}; }
  }

  started(event, record) {
    const tool = text(event.tool) || 'unknown';
    const classified = this.#classified(tool, event.input);
    const kind = kindOf(classified.kind, tool, acpKindOf(record));
    this.#calls.set(event.callId, { tool, kind });
    const name = mirrorName(this.id, kind);
    if (event.input === undefined) return { name };
    const raw = parseInput(event.input);
    return complete(kind, raw, classified) ? { name, input: canonicalInput({ kind, tool, raw, classified }) } : { name };
  }

  inputOf(event) {
    const { tool, kind } = this.#calls.get(event.callId) ?? { tool: 'unknown', kind: 'other' };
    return canonicalInput({ kind, tool, raw: parseInput(event.input), classified: this.#classified(tool, event.input) });
  }

  resultOf(event, call, record) {
    this.#calls.delete(event.callId);
    return super.resultOf(event, call, record);
  }
}

/** Neither a sandbox nor a verified tool denial is reachable through OAR for these harnesses, so a read-only session cannot be kept read-only. */
export const universalSession = ({ name }) => ({ permission }) => {
  if (permission === 'read-only') throw harnessError(`${name} cannot be kept read-only. Choose another access mode to use it.`, 'HARNESS_UNSUPPORTED');
  return {};
};

export function createUniversalProvider({ id, name, runtime, binaryEnv, login }) {
  return createOarProvider({
    id, name, runtime, binaryEnv, login,
    tools: toolSpecs(id), fallbackTool: fallbackSpecOf(id),
    normalizer: (options) => new UniversalNormalizer({ id, ...options }),
    fallbackModels: [{ id: 'default', displayName: 'Default' }],
    // Another harness's identity must not leak into the child.
    scrub: { patterns: [/^(ORCA_|HERDR_)/] },
    session: universalSession({ name }),
    steering: false,
    backgroundTasks: false,
    // Off until switched on in Settings > Providers (owner, 2026-11-19: "默认关闭"): few people use any one of these, and one that happens
    // to be installed must not appear among the agents by itself.
    defaultEnabled: false,
  });
}

export const universalProviders = UNIVERSAL_HARNESSES.map(createUniversalProvider);
