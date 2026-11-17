// The widgets 嘟嘟 writes for the owner (owner, 2026-11-18: "写小组件就应该让嘟嘟写 … 不需要安装插件"): one ES module per widget in <project folder>/widgets,
// loaded by 嘟嘟's own interface, with no plugin to install. This module is the folder's side: which files there are, their text, and what the
// interface reported when it tried to load them (widgets/status.json, which 嘟嘟 reads with its file tools to see why a widget did not appear).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_BYTES = 256 * 1024;
const SUFFIX = '.mjs';
const STATUS = 'status.json';

/** `folder` is a function so that the folder can move (settings) without the routes being registered again. */
export function createLocalWidgets({ folder }) {
  const dir = () => { const home = folder(); return home ? join(home, 'widgets') : null; };

  /** The widgets in the folder: { name, stamp }, `stamp` changes whenever the file does, so that the interface loads a file again only then. */
  function list() {
    const where = dir();
    if (!where) return { outcome: 'success', widgets: [] };
    let names;
    try { names = readdirSync(where); } catch { return { outcome: 'success', widgets: [] }; }
    const widgets = [];
    for (const file of names.sort()) {
      if (!file.endsWith(SUFFIX)) continue;
      const name = file.slice(0, -SUFFIX.length);
      if (!NAME.test(name)) continue;
      try {
        const info = statSync(join(where, file));
        if (info.isFile() && info.size <= MAX_BYTES) widgets.push({ name, stamp: `${Math.trunc(info.mtimeMs)}-${info.size}` });
      } catch { /* a file that went while listing is not listed */ }
    }
    return { outcome: 'success', widgets };
  }

  /** The text of one widget's file, or null when there is no such widget. */
  function read(name) {
    const where = dir();
    if (!where || typeof name !== 'string' || !NAME.test(name)) return null;
    try {
      const file = join(where, `${name}${SUFFIX}`);
      const info = statSync(file);
      return info.isFile() && info.size <= MAX_BYTES ? readFileSync(file, 'utf8') : null;
    } catch { return null; }
  }

  /** What the interface found when it loaded the widgets: [{ name, ok, error? }]. Written whole, so a widget that was removed leaves no line. */
  function report(entries, now = Date.now()) {
    const where = dir();
    if (!where || !Array.isArray(entries)) return { outcome: 'success' };
    const widgets = {};
    for (const entry of entries.slice(0, 200)) {
      if (typeof entry?.name !== 'string' || !NAME.test(entry.name)) continue;
      widgets[entry.name] = entry.ok === true ? { ok: true } : { ok: false, error: String(entry.error ?? 'It could not be loaded.').slice(0, 2000) };
    }
    try {
      mkdirSync(where, { recursive: true });
      writeFileSync(join(where, STATUS), `${JSON.stringify({ at: new Date(now).toISOString(), widgets }, null, 2)}\n`);
    } catch { /* the status is a convenience: a folder that cannot be written changes nothing for the dashboard */ }
    return { outcome: 'success' };
  }

  return { list, read, report, dir };
}
