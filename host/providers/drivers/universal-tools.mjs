// How the tools of the harnesses that share one driver (Grok, Kimi, OpenCode, Antigravity, CodeBuddy, Devin, Factory, Qwen, Qoder) look in
// DSH. The harness runs the tool; DSH only draws it, with the cards DSH already has (terminal, diff, search, generic), and with the words
// the Claude and Pi drivers use for the same things.
//
// Each of these harnesses names its tools its own way (`run_terminal_command`, `Bash`, `run_shell_command`, `edit_file`...), and the names
// are the vendor's to change. So the mirror tool is not the vendor's tool: it is one of the kinds of action OAR's `classifyTool` knows
// (run a command, read a file, edit a file, search, search the web, fetch a page, run a subagent, call an MCP tool, anything else), named
// `<id>_<kind>`, and the call's input is the canonical one `canonicalInput` builds from whatever the vendor sent. The vendor's own tool
// name and input stay in the call (`tool`, `input`).

const str = (value) => (typeof value === 'string' ? value : '');
const shorten = (text, limit = 120) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const generic = (title, kind = 'other', extra = {}) => ({ card: 'generic', kind, title: shorten(title), ...extra });
const first = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
};

export const KINDS = Object.freeze(['run_command', 'read_file', 'edit_file', 'search', 'web', 'fetch', 'subagent', 'mcp', 'other']);

/** The registry name of a harness's tool of `kind`. */
export const mirrorName = (id, kind) => `${id}_${kind}`;
/** The kind in a mirror name of harness `id`; 'other' for anything else. */
export const kindOfMirror = (id, name) => {
  const kind = String(name).startsWith(`${id}_`) ? String(name).slice(id.length + 1) : '';
  return KINDS.includes(kind) ? kind : 'other';
};

// What an ACP tool call's own `kind` says when the tool's name is one nobody mapped.
const ACP_KINDS = { execute: 'run_command', read: 'read_file', edit: 'edit_file', delete: 'edit_file', move: 'edit_file', search: 'search', fetch: 'fetch' };

// Names no table of OAR's lists yet (Devin, Factory, and the tools a vendor added since). A pattern is only the last resort.
const BY_NAME = [
  ['mcp', /^mcp[_-]/i],
  ['subagent', /^(task|agent|subagent|spawn_?agent)$/i],
  ['run_command', /^(bash|shell|powershell|execute|exec|terminal|run_?command|run_?shell_?command|run_?terminal_?command|local_?shell)$/i],
  ['edit_file', /^(edit|write|multi_?edit|apply_?patch|search_?replace|str_?replace|replace|create|create_?file|write_?file|edit_?file|update_?file|patch|delete_?file)$/i],
  ['read_file', /^(read|read_?file|read_?many_?files|view|view_?file|cat|open_?file|ls|list|list_?dir|list_?directory)$/i],
  ['search', /^(grep|glob|find|search|grep_?search|file_?search|codebase_?search|ripgrep|rg|find_?files)$/i],
  ['web', /^(web_?search|google_?web_?search|internet_?search)$/i],
  ['fetch', /^(web_?fetch|fetch|fetch_?url|http_?get)$/i],
];

/** The kind of action a tool call is: OAR's own classification first, then the ACP call's `kind`, then the tool's name. */
export function kindOf(classified, tool, acpKind) {
  if (classified && classified !== 'other' && KINDS.includes(classified)) return classified;
  if (ACP_KINDS[acpKind]) return ACP_KINDS[acpKind];
  for (const [kind, pattern] of BY_NAME) if (pattern.test(tool)) return kind;
  return 'other';
}

/** The old and new text an edit tool carries, whatever the vendor calls them: `[{ oldText, newText }]`, or nothing when the call has no text. */
function editsOf(raw) {
  const pair = (item) => {
    const oldText = first(item, ['old_string', 'oldString', 'old_str', 'old_text', 'oldText', 'search', 'old']);
    const newText = first(item, ['new_string', 'newString', 'new_str', 'new_text', 'newText', 'replace', 'replacement', 'new']);
    return oldText || newText ? { oldText: oldText || null, newText } : undefined;
  };
  if (Array.isArray(raw.edits)) {
    const edits = raw.edits.map(pair).filter(Boolean);
    if (edits.length) return edits;
  }
  const edit = pair(raw);
  if (edit) return [edit];
  const written = first(raw, ['content', 'file_text', 'fileText', 'text', 'new_source', 'file_content', 'contents', 'CodeContent']);
  return written ? [{ oldText: null, newText: written }] : [];
}

/**
 * The input DSH keeps for a call: the same shape for every vendor, so the cards need to know none of them. `classified` is OAR's
 * `classifyTool` answer for the call (its detail, paths, command and description are read from the vendor's own fields), `raw` the
 * vendor's input as an object.
 */
export function canonicalInput({ kind, tool, raw, classified = {} }) {
  const path = classified.paths?.[0] ?? first(raw, ['path', 'file_path', 'filePath', 'file', 'target_file', 'Path', 'AbsolutePath', 'TargetFile']);
  const base = { kind, tool, input: raw };
  switch (kind) {
    case 'run_command': {
      const command = classified.command ?? first(raw, ['command', 'cmd', 'CommandLine', 'script']);
      const description = classified.description ?? first(raw, ['description', 'toolSummary', 'explanation']);
      const cwd = first(raw, ['cwd', 'workdir', 'current_dir', 'Cwd']);
      return { ...base, ...(command ? { command } : {}), ...(description ? { description } : {}), ...(cwd ? { cwd } : {}) };
    }
    case 'read_file': {
      const offset = Number(raw.offset ?? raw.line ?? raw.start_line ?? raw.startLine ?? raw.StartLine);
      return { ...base, path, ...(Number.isInteger(offset) && offset > 0 ? { offset } : {}) };
    }
    case 'edit_file': return { ...base, path, edits: editsOf(raw) };
    case 'search': {
      const pattern = first(raw, ['pattern', 'query', 'regex', 'glob', 'search', 'Query', 'Pattern']);
      const where = path || first(raw, ['directory', 'dir', 'cwd']);
      return { ...base, ...(pattern ? { pattern } : {}), ...(where ? { path: where } : {}) };
    }
    case 'web': return { ...base, query: first(raw, ['query', 'q', 'search', 'prompt']) };
    case 'fetch': return { ...base, url: first(raw, ['url', 'uri', 'Url']) };
    case 'subagent': return { ...base, description: classified.description ?? first(raw, ['description', 'prompt', 'task', 'subagent_type']) };
    default: return { ...base, detail: classified.detail ?? first(raw, ['query', 'command', 'path', 'file_path', 'url', 'name', 'id']) };
  }
}

const mcpLabel = (tool) => {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (match) return `${match[1]}: ${match[2]}`;
  return tool.replace(/^mcp[_-]/i, '');
};

const diffsOf = (args) => (args.edits ?? []).map((edit) => ({ path: str(args.path), oldText: edit.oldText, newText: edit.newText }));
const editCall = (args) => {
  const diffs = diffsOf(args);
  const path = str(args.path);
  if (!diffs.length) return generic(`Edit ${path || str(args.tool)}`, 'edit', path ? { locations: [{ path }] } : {});
  return { card: 'diff', title: `${diffs[0].oldText === null ? 'Write' : 'Edit'} ${path}`, diffs, locations: [{ path }] };
};
const editResult = (args, outcome) => {
  const diffs = diffsOf(args);
  const path = str(args.path);
  if (outcome.isError) return { card: 'generic', title: `${diffs[0]?.oldText === null ? 'Write' : 'Edit'} ${path || str(args.tool)}`, content: [{ type: 'text', text: outcome.output }] };
  return diffs.length ? { card: 'diff', title: `${diffs[0].oldText === null ? 'Write' : 'Edit'} ${path}`, diffs } : undefined;
};

/** The tool of one kind, as a harness's catalog lists it. `id` is the harness. */
export function toolSpec(id, kind) {
  const name = mirrorName(id, kind);
  switch (kind) {
    case 'run_command':
      return {
        name,
        presentCall: (args) => ({ card: 'terminal', title: shorten(str(args.command) || str(args.tool) || 'command', 200), ...(args.description ? { description: str(args.description) } : {}), ...(args.cwd ? { cwd: str(args.cwd) } : {}) }),
        presentResult: (_args, outcome) => ({ card: 'terminal', output: outcome.output, ...(Number.isInteger(outcome.data?.exitCode) ? { exitCode: outcome.data.exitCode } : {}) }),
      };
    case 'read_file':
      return { name, presentCall: (args) => generic(`Read ${str(args.path) || str(args.tool)}`, 'read', args.path ? { locations: [{ path: str(args.path), ...(args.offset ? { line: Number(args.offset) } : {}) }] } : {}) };
    case 'edit_file': return { name, presentCall: editCall, presentResult: editResult };
    case 'search':
      return { name, presentCall: (args) => generic(`Search ${str(args.pattern) || str(args.tool)}${args.path ? ` in ${str(args.path)}` : ''}`, 'search') };
    case 'web': return { name, presentCall: (args) => generic(`Search the web: ${str(args.query)}`, 'search') };
    case 'fetch': return { name, presentCall: (args) => generic(`Fetch ${str(args.url)}`, 'fetch') };
    case 'subagent': return { name, presentCall: (args) => generic(`Subagent: ${str(args.description) || str(args.tool)}`, 'other') };
    case 'mcp': return { name, presentCall: (args) => generic(mcpLabel(str(args.tool)), 'other') };
    default:
      return { name, presentCall: (args) => generic(`${str(args.tool) || 'tool'}${args.detail && args.detail !== args.tool ? `: ${shorten(str(args.detail), 80)}` : ''}`, 'other') };
  }
}

/** Every tool of harness `id`: the same nine for each. */
export const toolSpecs = (id) => KINDS.map((kind) => toolSpec(id, kind));

/** A name the catalog does not list gets the plain card of its kind (`other` when the name is not one of the harness's). */
export const fallbackSpecOf = (id) => (name) => ({ ...toolSpec(id, kindOfMirror(id, name)), name });
