// How Codex's tool items look in DSH. Codex runs them; DSH only draws them, from the item the app-server reports.

const str = (value) => (typeof value === 'string' ? value : '');
const shorten = (text, limit = 120) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const PRESENT = { add: 'Add', delete: 'Delete', update: 'Edit' };
const PAST = { add: 'Added', delete: 'Deleted', update: 'Edited' };

const changesOf = (args) => (Array.isArray(args.changes) ? args.changes : []);
const verbOf = (change) => PRESENT[change?.kind?.type] ?? 'Edit';
const pastOf = (change) => PAST[change?.kind?.type] ?? 'Edited';

/** Codex reports each changed file as a unified diff; DSH shows it as it is, one fenced block per file. */
function patchText(changes) {
  return changes.map((change) => `${verbOf(change)} ${str(change.path)}\n\`\`\`diff\n${str(change.diff)}\n\`\`\``).join('\n\n');
}

export const CODEX_TOOLS = [
  {
    name: 'shell',
    presentCall: (args) => ({ card: 'terminal', title: shorten(str(args.command) || 'shell', 200), ...(args.cwd ? { cwd: str(args.cwd) } : {}) }),
    presentResult: (_args, outcome) => ({ card: 'terminal', output: outcome.output, ...(Number.isInteger(outcome.data?.exitCode) ? { exitCode: outcome.data.exitCode } : {}) }),
  },
  {
    name: 'apply_patch',
    presentCall: (args) => {
      const changes = changesOf(args);
      const first = str(changes[0]?.path);
      return {
        card: 'generic', kind: 'edit', title: changes.length > 1 ? `Edit ${changes.length} files` : `${verbOf(changes[0])} ${first}`,
        content: [{ type: 'text', text: patchText(changes) }], locations: changes.map((change) => ({ path: str(change.path) })),
      };
    },
    presentResult: (args, outcome) => {
      const changes = changesOf(args);
      return {
        card: 'generic',
        title: outcome.isError ? 'The edit was not applied' : changes.length > 1 ? `Edited ${changes.length} files` : `${pastOf(changes[0])} ${str(changes[0]?.path)}`,
        content: [{ type: 'text', text: outcome.isError ? outcome.output : patchText(changes) }],
      };
    },
  },
  { name: 'web_search', presentCall: (args) => ({ card: 'generic', kind: 'search', title: shorten(`Search the web: ${str(args.query)}`) }) },
  { name: 'update_plan', presentCall: () => ({ card: 'generic', kind: 'other', title: 'Update the plan' }) },
];

export function fallbackSpec(name) {
  const label = name.startsWith('mcp__') ? name.slice(5).replace('__', ': ') : name;
  return {
    name,
    presentCall: (args) => {
      for (const key of ['query', 'command', 'path', 'url', 'name', 'id']) {
        if (typeof args?.[key] === 'string' && args[key]) return { card: 'generic', kind: 'other', title: shorten(`${label}: ${args[key]}`) };
      }
      return { card: 'generic', kind: 'other', title: shorten(label) };
    },
  };
}
