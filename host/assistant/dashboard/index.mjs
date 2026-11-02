// The dashboard layout of 嘟嘟 (dashboard.json), see docs/assistant.md 4.1 "存放、谁能改" and 5.
//
//   const dashboard = createDashboard({ file, engine, now = Date.now });
//
// `engine` is the GridStackEngine class (engine.mjs, bundled by the packaging script); the rules of layout.mjs run on it, so the plugin
// process pushes widgets the way the page does. The file is read on first use. No file means the default layout, which is not written
// until the first change; a file that cannot be used (not JSON, not { v: 3, widgets: [...] } or the older { v: 1, ... } or { v: 2, ... }, unreadable)
// is renamed to `dashboard.json.bad-<ms timestamp>` next to it, so nothing the owner had is lost, and the default layout is used (`recovered`
// says so). A file that parses is never rejected: bad widgets in it are corrected in memory (unknown types are kept, see layout.mjs) and
// the corrected layout is written with the next change. A file of version 1 (the grid of ten columns) or 2 (twenty) is read as version 3
// (fifteen), every cell count scaled (layout.mjs `migrate`), and is rewritten as version 3 with the next change.
//
// Every call answers { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', layout, undo, ... } and never throws for a
// wrong value; `layout` is always the layout now in force, `undo` is { label, at } for the change undo() would take back, or null.
//
//   get({ rows }?)         -> { layout, widgets (the built-in declarations), undo, recovered: { reason, file } | null }; with `rows` the layout
//                          is the one the page sees (what fills counts those rows, what that gets in the way of is below it); it is not stored
//   set(layout, { type, rows })  the page's whole layout, normalised with the rules of layout.mjs and returned corrected; `type` is the widget
//                          that was dragged, resized, added or removed (it names the change when several widgets moved); `rows` is how many
//                          rows the window shows, which a widget that fills its height counts (FILL_ROWS when the caller does not say)
//   add / move / resize / remove (request)   by widget type, see layout.mjs; `columns` on add is the page's column count (not used: the
//                          grid has one fixed width); `rows` on add, move and resize is the same as in set
//   name                   on any call that changes something (and in set's options): the display name of a widget this build has no
//                          declaration for (one a plugin brings), which the undo label uses instead of its id
//   reset({ rows }?)       back to the default layout
//   undo({ rows }?)        takes back the last change, once; the layout it restores is written. Only the last change is kept, and only
//                          in memory: a restart of the plugin forgets it
//
// A change that fails to save (the folder is not writable) is an `error`, and nothing changes. Each successful change leaves one undo
// entry. A call that changes nothing (`no_op`) leaves the entry that was there. One dashboard owns its file: a second one made on the
// same file does not see the first one's changes.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { add, changeBetween, defaultLayout, move, normalize, READABLE_VERSIONS, remove, reset, resize, VERSION } from './layout.mjs';
import { BUILT_IN_WIDGETS, FILL, validatePluginWidget } from './widgets.mjs';

// The words of the undo bar, written as the design draws them (Removed「Stuck」: the name in 「」, no space); "Added", "Restored default",
// "Changed layout" and the full-width form are not in the design and are NEW wording.
const LABELS = {
  add: (name) => `Added「${name}」`, // NEW
  remove: (name) => `Removed「${name}」`,
  move: (name) => `Moved「${name}」`,
  resize: (name, w, h) => (w === FILL || h === FILL ? `「${name}」resized to ${w === FILL ? 'full width' : w} × ${h === FILL ? 'full height' : h}` : `「${name}」resized to ${w}×${h}`), // the full-width and full-height forms are NEW
  reset: () => 'Restored default', // NEW
  many: () => 'Changed layout', // NEW
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nameOf = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined);

// One widget per line: short enough to read and to diff.
const serialize = ({ v, widgets }) => `{\n  "v": ${v},\n  "widgets": [${widgets.map((item) => `\n    ${JSON.stringify(item)}`).join(',')}${widgets.length ? '\n  ' : ''}]\n}\n`;

export function createDashboard({ file, engine, now = Date.now }) {
  if (typeof file !== 'string' || !file) throw new TypeError('createDashboard needs the file to keep the layout in.');
  if (typeof engine !== 'function') throw new TypeError('createDashboard needs the GridStackEngine class as `engine` (see engine.mjs).');
  const context = { known: BUILT_IN_WIDGETS, engine };
  const names = new Map(BUILT_IN_WIDGETS.map((widget) => [widget.id, widget.label]));
  let layout = null;
  let recovered = null;
  let last = null; // the one change undo() can take back: { label, before, at }

  function setAside(reason) {
    const stamp = now();
    let target = `${file}.bad-${stamp}`;
    for (let n = 1; existsSync(target); n++) target = `${file}.bad-${stamp}-${n}`;
    try {
      renameSync(file, target);
    } catch {
      target = null; // it could not be moved either; the next save replaces it
    }
    recovered = { reason, file: target };
    return defaultLayout();
  }

  function readLayout() {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      return error.code === 'ENOENT' ? defaultLayout() : setAside(`The file could not be read (${error.code ?? error.message}).`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return setAside('The file is not valid JSON.');
    }
    if (!isObject(data) || !READABLE_VERSIONS.includes(data.v) || !Array.isArray(data.widgets)) return setAside(`The file is not a layout of version 1, 2 or ${VERSION}.`);
    return normalize(data, context).layout;
  }

  const current = () => (layout ??= readLayout());

  // Write to a temporary file in the same folder, then rename it over the real one: a crash leaves the old file or the new one.
  function save(next) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, serialize(next), { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  const undoInfo = () => (last ? { label: last.label, at: last.at, change: last.change } : null);

  // The layout as the page whose window shows `rows` rows sees it (what fills counts them, and what that gets in the way of goes below it);
  // nothing is stored. Asked without rows, it is the layout as it is kept.
  const viewOf = (rows) => (rows === undefined ? current() : normalize(current(), { ...context, rows }).layout);

  function reply({ outcome, message, next, corrections }, extra = {}, rows) {
    return {
      outcome, layout: structuredClone(viewOf(rows)), undo: undoInfo(), ...extra,
      ...(message ? { message } : {}), ...(next ? { next } : {}), ...(corrections ? { corrections } : {}),
    };
  }

  // A result from layout.mjs: a success is saved and becomes the layout and the one undo entry; anything else is passed on.
  // `name` is the page's name for a widget the dashboard has no declaration for.
  function commit(result, name, rows) {
    if (result.outcome !== 'success') return reply(result, {}, rows);
    const { kind, type, w, h } = result.change;
    const label = LABELS[kind](names.get(type) ?? nameOf(name) ?? type, w, h);
    const before = current();
    try {
      save(result.layout);
    } catch (error) {
      return reply({ outcome: 'error', message: `The layout could not be saved: ${error.message}`, next: 'Check that the folder can be written, then call again.' }, {}, rows);
    }
    layout = result.layout;
    last = { label, before, at: now(), change: result.change };
    return reply(result, {}, rows);
  }

  return {
    get(request) {
      current(); // the first read may set a bad file aside, which `recovered` then tells
      return reply({ outcome: 'success' }, { widgets: structuredClone(context.known), recovered }, request?.rows);
    },
    catalog(widgets) {
      if (!Array.isArray(widgets) || widgets.length > 200) return reply({ outcome: 'needs_clarification', message: 'Expected up to 200 widget declarations.' });
      const extra = [];
      const seen = new Set();
      for (const widget of widgets) {
        const checked = validatePluginWidget(widget);
        if (!checked.ok || seen.has(widget.id)) return reply({ outcome: 'needs_clarification', message: checked.reason ?? 'A widget id occurs twice.' });
        seen.add(widget.id);
        extra.push({
          id: widget.id, label: widget.label, description: widget.description ?? '',
          min: { w: widget.min.w, h: widget.min.h }, size: { w: widget.size.w, h: widget.size.h },
          needs: [...widget.needs ?? []], widgetApi: widget.widgetApi,
        });
      }
      context.known = [...BUILT_IN_WIDGETS, ...extra];
      names.clear();
      for (const widget of context.known) names.set(widget.id, widget.label);
      return reply({ outcome: 'success' });
    },
    set(input, options) {
      // A page of an older build still sends version 1 (ten columns) or 2 (twenty): it is read the way a file of that version is.
      if (!isObject(input) || !READABLE_VERSIONS.includes(input.v) || !Array.isArray(input.widgets)) {
        return reply({ outcome: 'needs_clarification', message: `The layout must be { v: ${VERSION}, widgets: [...] }.`, next: 'Send the whole layout, as get returns it.' }, {}, options?.rows);
      }
      const { layout: next, corrections } = normalize(input, { ...context, rows: options?.rows });
      const change = changeBetween(current(), next, options?.type);
      if (!change) return reply({ outcome: 'no_op', message: 'Nothing changed.', corrections }, {}, options?.rows);
      return commit({ outcome: 'success', layout: next, change, corrections }, options?.name, options?.rows);
    },
    add: (request) => commit(add(current(), request, { ...context, rows: request?.rows }), request?.name, request?.rows),
    move: (request) => commit(move(current(), request, { ...context, rows: request?.rows }), request?.name, request?.rows),
    resize: (request) => commit(resize(current(), request, { ...context, rows: request?.rows }), request?.name, request?.rows),
    remove: (request) => commit(remove(current(), request, context), request?.name, request?.rows),
    reset: (request) => commit(reset(current()), undefined, request?.rows),
    undo(request) {
      const entry = last;
      if (!entry) return reply({ outcome: 'no_op', message: 'There is nothing to undo.' }, {}, request?.rows);
      try {
        save(entry.before);
      } catch (error) {
        return reply({ outcome: 'error', message: `The layout could not be saved: ${error.message}`, next: 'Check that the folder can be written, then call again.' }, {}, request?.rows);
      }
      layout = entry.before;
      last = null;
      return reply({ outcome: 'success' }, { undone: { label: entry.label } }, request?.rows);
    },
  };
}
