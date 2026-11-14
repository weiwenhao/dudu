import { createHash } from 'node:crypto';
import { redact } from '../memory/secrets.mjs';

/**
 * Read prompt sections, preserving original ranges so edits leave the owner's other text alone. The same reader serves CONNECTORS.md and
 * COLLECTORS.md: a section is `## name`, a metadata comment (`<!-- id: x | source: owner | kind: mcp | server: notion | connector: lark | every: 15m -->`)
 * and the text under it. Each entry carries what either file may say: kind ('prompt' or 'mcp'; `kinded` is false for an entry that does not say,
 * which is how an entry written before connectors and collectors were told apart is recognised), server, connector (the id a collector reads
 * through), frequency, and the collector's notification opt-in.
 */
export function parseSources(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const headings = [];
  let fence = null;
  let comment = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    if (comment) { if (line.includes('-->')) comment = false; continue; }
    if (/^\s*<!--/.test(line)) { comment = !line.includes('-->'); continue; }
    const heading = /^ {0,3}(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (heading) headings.push({ start: index, level: heading[1].length, name: heading[2] });
  }
  const entries = [];
  const diagnostics = [];
  const ids = new Set();
  for (let n = 0; n < headings.length; n++) {
    const heading = headings[n];
    if (heading.level !== 2) continue;
    const end = headings[n + 1]?.start ?? lines.length;
    const body = lines.slice(heading.start + 1, end).join('\n');
    const meta = /<!--\s*id:\s*([a-z0-9][a-z0-9_-]{0,39})(?:\s*\|([^]*?))?\s*-->/i.exec(body);
    const id = meta?.[1] ?? `source-${createHash('sha256').update(heading.name).digest('hex').slice(0, 12)}`;
    if (ids.has(id)) { diagnostics.push({ line: heading.start + 1, reason: 'Duplicate source id.' }); continue; }
    ids.add(id);
    // Previous launch specifications are reference data; none of their configuration is executed.
    let description = body.replace(/<!--[^]*?-->/g, '').replace(/(^|\n) {0,3}(`{3,}|~{3,})json[^\n]*\n[^]*?\n {0,3}\2[ \t]*(?=\n|$)/gi, '$1').trim();
    if (!description) {
      const old = /```json\s*\n([^]*?)\n\s*```/i.exec(body);
      try {
        const config = JSON.parse(old?.[1] ?? '{}');
        const tool = config.command ?? config.server ?? config.from?.server;
        if (typeof tool === 'string') description = `${heading.name}: ${tool}`;
      } catch { /* A broken launch specification is never run. */ }
    }
    // How often it is collected: `every: 15m` or `cron: 0 9-18 * * 1-5`, written after the id and the source. Whether it can be read is the
    // scheduler's business (a bad one is collected at the default rate); here it is only text.
    const pairs = new Map();
    for (const part of (meta?.[2] ?? '').split('|')) {
      const pair = /^\s*([a-z][a-z0-9_-]*)\s*:\s*([^]*?)\s*$/i.exec(part);
      if (pair && !pairs.has(pair[1].toLowerCase())) pairs.set(pair[1].toLowerCase(), pair[2]);
    }
    const frequency = pairs.get('every') || pairs.get('cron') || null;
    // An MCP connector says how to reach its server in a fenced json block under the heading: { url } or { command, args, env: [names] } (docs/assistant.md 3.1).
    // It holds no secret: values live in the credential store. The block is read only for `kind: mcp`; for any other entry it stays reference data.
    let spec = null;
    if (pairs.get('kind') === 'mcp') {
      const block = /(^|\n) {0,3}(`{3,}|~{3,})json[^\n]*\n([^]*?)\n {0,3}\2[ \t]*(?=\n|$)/i.exec(body);
      try {
        const parsed = block ? JSON.parse(block[3]) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (typeof parsed.url === 'string' || typeof parsed.command === 'string')) spec = parsed;
      } catch { /* a spec that cannot be read is no spec: the entry is shown as one that must be added again */ }
    }
    entries.push({
      id, name: redact(heading.name), description: redact(description), prompt: redact(description), source: pairs.get('source') === 'dudu' ? 'dudu' : 'owner', frequency,
      notify: pairs.get('notify') === 'true',
      kinded: pairs.has('kind'), kind: pairs.get('kind') === 'mcp' ? 'mcp' : 'prompt', server: pairs.get('server') ?? '', connector: pairs.get('connector') ?? '',
      via: pairs.get('via') ?? '', spec,
      start: heading.start, end, line: heading.start + 1,
    });
  }
  return { eol, lines, entries, diagnostics };
}
