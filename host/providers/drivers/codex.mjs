import { harnessError } from '../harness-bridge.mjs';
import { OarNormalizer, createOarProvider } from '../oar.mjs';
import { codexRuntime, recoverOwnedProcess } from '../oar-runtimes.mjs';
import { readCodexQuota } from '../quota/codex.mjs';
import { CODEX_TOOLS, fallbackSpec } from './codex-tools.mjs';

// Codex through OAR, which drives `codex app-server`. The `codex` installed on this computer, with this user's login,
// provider and config, does the work, and its threads are real Codex threads that `codex resume` lists.

const text = (value) => (typeof value === 'string' ? value : '');

function contentText(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item === 'string') return item;
    if (item?.type === 'text' || item?.type === 'inputText' || item?.type === 'outputText') return text(item.text);
    return item?.type ? `[${item.type}]` : '';
  }).filter(Boolean).join('\n');
}

/** The tool call a Codex item is, as the event the bridge replays. Items that are not tool calls give nothing. */
export function toolCallOf(item) {
  switch (item?.type) {
    case 'commandExecution': return { name: 'shell', input: { command: text(item.command), cwd: text(item.cwd) } };
    case 'fileChange': return { name: 'apply_patch', input: { changes: Array.isArray(item.changes) ? item.changes : [] } };
    case 'mcpToolCall': return { name: `mcp__${text(item.server)}__${text(item.tool)}`, input: item.arguments ?? {} };
    case 'dynamicToolCall': return { name: text(item.tool) || 'tool', input: item.arguments ?? {} };
    case 'webSearch': return { name: 'web_search', input: { query: text(item.query) || text(item.action?.query) } };
    default: return undefined;
  }
}

/** The result of a finished Codex tool item. */
export function toolResultOf(item) {
  const failed = ['failed', 'declined'].includes(item?.status);
  switch (item?.type) {
    case 'commandExecution':
      return { output: text(item.aggregatedOutput), isError: failed, data: { exitCode: item.exitCode ?? undefined, durationMs: item.durationMs ?? undefined } };
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return { output: failed ? `The patch was not applied (${item.status}).` : `Applied ${changes.length} file change${changes.length === 1 ? '' : 's'}: ${changes.map((change) => text(change.path)).join(', ')}`, isError: failed, data: { changes } };
    }
    case 'mcpToolCall': {
      const error = item.error ? text(item.error.message) || JSON.stringify(item.error) : '';
      return { output: error || contentText(item.result?.content) || (item.result?.structuredContent ? JSON.stringify(item.result.structuredContent) : ''), isError: Boolean(error) || failed };
    }
    case 'dynamicToolCall': return { output: contentText(item.contentItems), isError: item.success === false || failed };
    default: return { output: '', isError: false };
  }
}

/**
 * Codex reports items, not messages: text and reasoning stream inside the current step, and each tool call closes its
 * step, so DSH's own loop waits for a tool's result before the next step starts. OAR names a tool by its item type; the
 * item itself, which the record keeps as the app-server sent it, says which MCP tool it is and what it was given.
 */
export class CodexNormalizer extends OarNormalizer {
  started(event, record) {
    return toolCallOf(record.body?.native?.item);
  }

  resultOf(event, call, record) {
    return toolResultOf(record.body?.native?.item);
  }

  backgroundResult(event, call) {
    if (event.taskType !== 'shell' || event.nativeType !== 'commandExecution'
      || event.background !== true || call.name !== 'shell') return;
    // This is a yielded call, not a successful process exit. Its real outcome/output stays in the linked DSH job.
    return { output: call.output ?? '', isError: false, data: { background: true, processId: event.taskId } };
  }
}

/** The DSH access mode as Codex's sandbox. Nobody can answer an approval, so what the sandbox forbids stays forbidden. */
export function sandboxOf(permission) {
  switch (permission) {
    case 'danger-full-access': return 'danger-full-access';
    case 'read-only': return 'read-only';
    default: return 'workspace-write';
  }
}

export function createCodexProvider({ runtime = codexRuntime } = {}) {
  return createOarProvider({
    id: 'codex', name: 'ChatGPT', runtime, binaryEnv: 'OAR_CODEX_BIN',
    tools: CODEX_TOOLS, fallbackTool: fallbackSpec,
    login: 'Run `codex login` in a terminal.',
    normalizer: (options) => new CodexNormalizer(options),
    fallbackModels: [{ id: 'default', displayName: 'Default' }],
    // Another Codex harness's identity must not leak into the child; the user's own CODEX_HOME must survive.
    scrub: { patterns: [/^(CODEX_|ORCA_|HERDR_)/], keep: ['CODEX_HOME'] },
    // How much of the ChatGPT plan is left (see the Claude provider).
    quota: readCodexQuota,
    // OAR sets the sandbox for the whole app-server with its own `-c`; a later one for the same key wins.
    session: ({ permission }) => ({ launchArgs: ['-c', `sandbox_mode="${sandboxOf(permission)}"`] }),
    // Codex's app-server refuses a second writer on its own ("thread/resume failed: ... already has an active writer"), so unlike
    // Claude there is no registry of other processes to check here; what this recovers is a process dudu itself left behind from an
    // earlier attempt (2026-11-21: a failed resume left its app-server running, and the next attempt collided with it).
    before: async ({ resume }) => {
      if (!resume) return;
      try { await recoverOwnedProcess(`codex:${resume}`); }
      catch (error) {
        console.warn('[dudu] Codex process recovery failed', error.code ?? error.message);
        throw harnessError('busy', 'HARNESS_BUSY');
      }
    },
  });
}

export const codexProvider = createCodexProvider();
