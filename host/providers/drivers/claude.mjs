import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { harnessError } from '../harness-bridge.mjs';
import { OarNormalizer, createOarProvider } from '../oar.mjs';
import { claudeRuntime } from '../oar-runtimes.mjs';
import { readClaudeQuota } from '../quota/claude.mjs';
import { CLAUDE_TOOLS, fallbackSpec } from './claude-tools.mjs';
import { createClaudeChildUsageReader } from '../native/claude-child-usage.mjs';

// Claude Code through OAR. The `claude` installed on this computer, with this user's login, settings, skills and MCP
// servers, does the work, and its sessions are ordinary ones that `claude --resume` lists.

/**
 * The entrypoint a session records. OAR starts Claude in print mode, which records `sdk-cli`, and a session with that
 * entrypoint is left out of the terminal's `claude --resume` list. Any other name keeps it there.
 */
export const ENTRYPOINT = 'dudu';

/** Tools that run commands or change files: what a read-only session may not use. */
export const WRITING_TOOLS = ['Bash', 'BashOutput', 'KillShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'];

/** OAR has no way to answer a question the harness asks its host, so the model is not offered one to ask. */
const UNANSWERABLE_TOOLS = ['AskUserQuestion'];

export class ClaudeNormalizer extends OarNormalizer {
  /** Claude streams each assistant message between `message_start` and `message_stop`. */
  isMessageEnd(record) {
    return record.body?.type === 'stream_event' && record.body.native?.event?.type === 'message_stop';
  }
}

/** Claude Code has no session lock; two processes would both append to the transcript. Its live registry tells. */
export async function openElsewhere(sessionId, { directory = join(homedir(), '.claude', 'sessions'), alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } } } = {}) {
  let names;
  try { names = await readdir(directory); } catch { return undefined; }
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    try {
      const entry = JSON.parse(await readFile(join(directory, name), 'utf8'));
      if (entry.sessionId === sessionId && Number.isInteger(entry.pid) && alive(entry.pid)) return entry;
    } catch { /* a registry file being written or removed */ }
  }
  return undefined;
}

const FALLBACK_MODELS = ['default', 'opus', 'sonnet', 'haiku'].map((id) => ({
  id, displayName: id === 'default' ? 'Default' : id[0].toUpperCase() + id.slice(1), effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
}));

export function createClaudeProvider({ runtime = claudeRuntime, registry } = {}) {
  return createOarProvider({
    id: 'claude', name: 'Claude', runtime, binaryEnv: 'OAR_CLAUDE_BIN',
    tools: CLAUDE_TOOLS, fallbackTool: fallbackSpec,
    login: 'Run `claude` in a terminal and sign in.',
    normalizer: (options) => new ClaudeNormalizer(options),
    childUsage: createClaudeChildUsageReader,
    fallbackModels: FALLBACK_MODELS,
    // The child must not believe it runs inside another harness. OAR already drops Claude's own markers.
    scrub: { patterns: [/^(ORCA_|HERDR_)/] },
    // How much of the account's plan is left (the quota panel asks only the providers that are found and enabled, and only when a person asks).
    quota: readClaudeQuota,
    // Use native permission evaluation; an explicit read-only envelope also removes writing tools.
    session: ({ permission, signal }) => ({
      ...(signal ? { openSignal: signal } : {}),
      env: { CLAUDE_CODE_ENTRYPOINT: ENTRYPOINT },
      permissionMode: permission === 'danger-full-access' ? 'bypassPermissions' : permission === 'read-only' ? 'dontAsk' : permission === 'auto' ? 'auto' : 'inherit',
      disallowedTools: [...(permission === 'read-only' ? WRITING_TOOLS : []), ...UNANSWERABLE_TOOLS],
    }),
    // Claude takes a message written during its turn into a queue: it answers it with a turn of its own after this one.
    queuesSteer: true,
    before: async ({ resume }) => {
      if (!resume) return;
      const other = await openElsewhere(resume, registry);
      if (other) throw harnessError(`This Claude Code session is open in another process (pid ${other.pid}). Close it there first.`, 'HARNESS_BUSY');
    },
  });
}

export const claudeProvider = createClaudeProvider();
