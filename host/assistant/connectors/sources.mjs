import { createHash } from 'node:crypto';
import { redact } from '../memory/secrets.mjs';

/** Read prompt sections, preserving original ranges so edits leave the owner's other text alone. */
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
    entries.push({ id, name: redact(heading.name), description: redact(description), prompt: redact(description), source: /\bsource:\s*dudu\b/.test(meta?.[2] ?? '') ? 'dudu' : 'owner', start: heading.start, end, line: heading.start + 1 });
  }
  return { eol, lines, entries, diagnostics };
}
