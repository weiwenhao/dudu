// How each Pi tool looks in DSH. The harness runs the tool; DSH only draws it, from the call's input and the result text Pi
// reported, with the cards DSH already has: terminal, diff, read, search.
//
// A mirror tool is registered in the registry of the agent that runs the Pi session, beside DSH's own tools, and DSH's own are named
// `bash`, `read`, `write`, `edit`, `grep`, `glob`. Pi's are called almost the same, so every Pi tool is mirrored under `pi_<name>`:
// the name only identifies the call, the card is drawn from `presentCall` / `presentResult`.

const str = (value) => (typeof value === 'string' ? value : '');
const shorten = (text, limit = 120) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const generic = (title, kind = 'other', extra = {}) => ({ card: 'generic', kind, title: shorten(title), ...extra });

export const MIRROR_PREFIX = 'pi_';
/** The registry name of Pi's tool `native`. */
export const mirrorName = (native) => `${MIRROR_PREFIX}${String(native).replace(/[^A-Za-z0-9_-]/g, '_')}`;
/** What the card calls a mirrored tool: Pi's own name. */
export const nativeName = (mirror) => (String(mirror).startsWith(MIRROR_PREFIX) ? String(mirror).slice(MIRROR_PREFIX.length) : String(mirror));

/**
 * Pi's `read` returns the file text as it is and, when it stopped early, a last paragraph
 * `[24 more lines in file. Use offset=8 to continue.]`. The card shows the lines with their numbers; the paragraph is not file content.
 */
export function readLines(output, offset) {
  const match = String(output).match(/\n\n\[(\d+) more lines? in file[^\]]*\]\s*$/);
  const body = match ? String(output).slice(0, match.index) : String(output);
  if (!body) return { lines: [], rest: 0 };
  const first = Number.isInteger(offset) && offset > 0 ? offset : 1;
  const lines = body.replace(/\n$/, '').split('\n').map((text, index) => ({ number: first + index, text }));
  return { lines, rest: match ? Number(match[1]) : 0 };
}

const pathOf = (args) => str(args.path);

const diffsOf = (args) => {
  const path = pathOf(args);
  if (Array.isArray(args.edits)) return args.edits.map((edit) => ({ path, oldText: str(edit?.oldText), newText: str(edit?.newText) }));
  if (typeof args.content === 'string') return [{ path, oldText: null, newText: args.content }];
  return [{ path, oldText: str(args.oldText), newText: str(args.newText) }];
};

const editCall = (verb) => (args) => {
  const diffs = diffsOf(args);
  return { card: 'diff', title: `${verb} ${diffs[0].path}`, diffs, locations: [{ path: diffs[0].path }] };
};
const editResult = (verb) => (args, outcome) => (outcome.isError
  ? { card: 'generic', title: `${verb} ${diffsOf(args)[0].path}`, content: [{ type: 'text', text: outcome.output }] }
  : { card: 'diff', title: `${verb} ${diffsOf(args)[0].path}`, diffs: diffsOf(args) });

export const PI_TOOLS = [
  {
    name: mirrorName('bash'),
    presentCall: (args) => ({ card: 'terminal', title: shorten(str(args.command) || 'bash', 200) }),
    presentResult: (_args, outcome) => ({ card: 'terminal', output: outcome.output, ...(Number.isInteger(outcome.data?.exitCode) ? { exitCode: outcome.data.exitCode } : {}) }),
  },
  {
    name: mirrorName('read'),
    presentCall: (args) => generic(`Read ${pathOf(args)}`, 'read', { locations: [{ path: pathOf(args), ...(args.offset ? { line: Number(args.offset) } : {}) }] }),
    presentResult: (args, outcome) => {
      const { lines, rest } = readLines(outcome.output, Number(args.offset));
      if (outcome.isError || lines.length === 0) return undefined;
      return { card: 'read', path: pathOf(args), offset: lines[0].number, lines, totalLines: lines.at(-1).number + rest };
    },
  },
  { name: mirrorName('write'), presentCall: editCall('Write'), presentResult: editResult('Write') },
  { name: mirrorName('edit'), presentCall: editCall('Edit'), presentResult: editResult('Edit') },
  { name: mirrorName('grep'), presentCall: (args) => generic(`Search ${str(args.pattern)}${args.path ? ` in ${str(args.path)}` : ''}`, 'search') },
  {
    name: mirrorName('find'),
    presentCall: (args) => generic(`Find ${str(args.pattern)}${args.path ? ` in ${str(args.path)}` : ''}`, 'search'),
    presentResult: (_args, outcome) => {
      const paths = outcome.output.split('\n').map((line) => line.trim()).filter(Boolean);
      return outcome.isError || paths.length === 0 ? undefined : { card: 'search', shape: 'paths', paths: paths.slice(0, 200), truncated: paths.length > 200, total: paths.length };
    },
  },
  { name: mirrorName('ls'), presentCall: (args) => generic(`List ${pathOf(args) || '.'}`, 'read') },
];

/** The card for a tool the catalog does not know: one an extension of the user's Pi adds, say. `name` is the mirror name. */
export function fallbackSpec(name) {
  const label = nativeName(name);
  return {
    name,
    presentCall: (args) => {
      for (const key of ['query', 'command', 'path', 'url', 'name', 'id']) {
        if (typeof args?.[key] === 'string' && args[key]) return generic(`${label}: ${shorten(args[key], 80)}`);
      }
      return generic(label);
    },
  };
}
