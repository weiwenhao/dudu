// How each Claude Code tool looks in DSH. The harness runs the tool; DSH only draws it, from the call's
// input and the result text the harness reported, with the cards DSH already has: terminal, diff, read, search.

const str = (value) => (typeof value === 'string' ? value : '');
const shorten = (text, limit = 120) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const generic = (title, kind = 'other', extra = {}) => ({ card: 'generic', kind, title: shorten(title), ...extra });

/** `cat -n` style lines (`   12→text`) back into numbered lines. */
export function numberedLines(output) {
  const lines = [];
  for (const raw of String(output).split('\n')) {
    const match = raw.match(/^\s*(\d+)[→\t](.*)$/);
    if (match) lines.push({ number: Number(match[1]), text: match[2] });
  }
  return lines;
}

const diffsOf = (args) => {
  const path = str(args.file_path) || str(args.notebook_path);
  if (Array.isArray(args.edits)) {
    return args.edits.map((edit) => ({ path, oldText: str(edit.old_string), newText: str(edit.new_string) }));
  }
  if (typeof args.content === 'string') return [{ path, oldText: null, newText: args.content }];
  if (typeof args.new_source === 'string') return [{ path, oldText: null, newText: args.new_source }];
  return [{ path, oldText: str(args.old_string), newText: str(args.new_string) }];
};

const editCall = (verb) => (args) => {
  const diffs = diffsOf(args);
  return { card: 'diff', title: `${verb} ${diffs[0].path}`, diffs, locations: [{ path: diffs[0].path }] };
};
const editResult = (verb) => (args, outcome) => (outcome.isError
  ? { card: 'generic', title: `${verb} ${diffsOf(args)[0].path}`, content: [{ type: 'text', text: outcome.output }] }
  : { card: 'diff', title: `${verb} ${diffsOf(args)[0].path}`, diffs: diffsOf(args) });

export const CLAUDE_TOOLS = [
  {
    name: 'Bash',
    presentCall: (args) => ({ card: 'terminal', title: shorten(str(args.command) || 'Bash', 200), ...(args.description ? { description: str(args.description) } : {}) }),
    presentResult: (_args, outcome) => {
      const stdout = str(outcome.data?.stdout);
      const stderr = str(outcome.data?.stderr);
      return { card: 'terminal', output: [stdout, stderr].filter(Boolean).join('\n') || outcome.output };
    },
  },
  { name: 'BashOutput', presentCall: (args) => generic(`Output of ${str(args.bash_id) || 'background command'}`, 'execute') },
  { name: 'KillShell', presentCall: (args) => generic(`Stop ${str(args.shell_id) || 'background command'}`, 'execute') },
  {
    name: 'Read',
    presentCall: (args) => generic(`Read ${str(args.file_path)}`, 'read', { locations: [{ path: str(args.file_path), ...(args.offset ? { line: Number(args.offset) } : {}) }] }),
    presentResult: (args, outcome) => {
      const lines = numberedLines(outcome.output);
      if (outcome.isError || lines.length === 0) return undefined;
      return { card: 'read', path: str(args.file_path), offset: lines[0].number, lines, totalLines: lines.at(-1).number };
    },
  },
  { name: 'Write', presentCall: editCall('Write'), presentResult: editResult('Write') },
  { name: 'Edit', presentCall: editCall('Edit'), presentResult: editResult('Edit') },
  { name: 'MultiEdit', presentCall: editCall('Edit'), presentResult: editResult('Edit') },
  { name: 'NotebookEdit', presentCall: editCall('Edit'), presentResult: editResult('Edit') },
  {
    name: 'Glob',
    presentCall: (args) => generic(`Find ${str(args.pattern)}`, 'search'),
    presentResult: (_args, outcome) => {
      const paths = outcome.output.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('/') || line.includes('/'));
      return outcome.isError || paths.length === 0 ? undefined : { card: 'search', shape: 'paths', paths: paths.slice(0, 200), truncated: paths.length > 200, total: paths.length };
    },
  },
  { name: 'Grep', presentCall: (args) => generic(`Search ${str(args.pattern)}${args.path ? ` in ${str(args.path)}` : ''}`, 'search') },
  { name: 'WebFetch', presentCall: (args) => generic(`Fetch ${str(args.url)}`, 'fetch') },
  { name: 'WebSearch', presentCall: (args) => generic(`Search the web: ${str(args.query)}`, 'search') },
  {
    name: 'TodoWrite',
    presentCall: (args) => generic(`Update the task list (${Array.isArray(args.todos) ? args.todos.length : 0})`, 'other', {
      content: [{ type: 'text', text: (Array.isArray(args.todos) ? args.todos : []).map((todo) => `- [${todo.status === 'completed' ? 'x' : ' '}] ${str(todo.content)}`).join('\n') }],
    }),
  },
  { name: 'Task', presentCall: (args) => generic(`Subagent: ${str(args.description) || str(args.subagent_type)}`, 'other') },
  { name: 'Agent', presentCall: (args) => generic(`Subagent: ${str(args.description) || str(args.subagent_type)}`, 'other') },
  { name: 'Skill', presentCall: (args) => generic(`Skill ${str(args.skill) || str(args.name)}`, 'other') },
  { name: 'SlashCommand', presentCall: (args) => generic(`Command ${str(args.command)}`, 'other') },
  { name: 'ExitPlanMode', presentCall: () => generic('Plan ready for review', 'other', { content: [] }) },
  { name: 'AskUserQuestion', presentCall: (args) => generic(`Ask: ${str(args.questions?.[0]?.question)}`, 'other') },
  { name: 'ListMcpResources', presentCall: () => generic('List MCP resources', 'other') },
  { name: 'ReadMcpResource', presentCall: (args) => generic(`Read MCP resource ${str(args.uri)}`, 'read') },
];

/** The card for a tool the catalog does not know, such as one from an MCP server. */
export function fallbackSpec(name) {
  return { name, presentCall: (args) => generic(`${name}${salient(args)}`, 'other') };
}

function salient(args) {
  for (const key of ['query', 'command', 'path', 'file_path', 'url', 'name', 'id']) {
    if (typeof args?.[key] === 'string' && args[key]) return `: ${shorten(args[key], 80)}`;
  }
  return '';
}
