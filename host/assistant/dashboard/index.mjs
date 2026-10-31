// The dashboard layout of 嘟嘟 (dashboard.json), see docs/assistant.md 4.1 "存放、谁能改" and 5.
//
//   const dashboard = createDashboard({ file, engine, now = Date.now });
//
// `engine` is the GridStackEngine class (engine.mjs, bundled by the packaging script); the rules of layout.mjs run on it, so the plugin
// process pushes widgets the way the page does. The file is read on first use. No file means the default layout, which is not written
// until the first change; a file that cannot be used (not JSON, not { v: 1, widgets: [...] }, unreadable) is renamed to
// `dashboard.json.bad-<ms timestamp>` next to it, so nothing the owner had is lost, and the default layout is used (`recovered` says
// so). A file that parses is never rejected: bad widgets in it are corrected in memory (unknown types are kept, see layout.mjs) and
// the corrected layout is written with the next change.
//
// Every call answers { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', layout, undo, ... } and never throws for a
// wrong value; `layout` is always the layout now in force, `undo` is { label, at } for the change undo() would take back, or null.
//
//   get()                  -> { layout, widgets (the built-in declarations), undo, recovered: { reason, file } | null }
//   set(layout, { type })  the page's whole layout, normalised with the rules of layout.mjs and returned corrected; `type` is the widget
//                          that was dragged, resized, added or removed (it names the change when several widgets moved)
//   add / move / resize / remove (request)   by widget type, see layout.mjs; `columns` on add is the page's column count
//   name                   on any call that changes something (and in set's options): the display name of a widget this build has no
//                          declaration for (one a plugin brings), which the undo label uses instead of its id
//   reset()                back to the default layout
//   undo()                 takes back the last change, once; the layout it restores is written. Only the last change is kept, and only
//                          in memory: a restart of the plugin forgets it
//
// A change that fails to save (the folder is not writable) is an `error`, and nothing changes. Each successful change leaves one undo
// entry. A call that changes nothing (`no_op`) leaves the entry that was there. One dashboard owns its file: a second one made on the
// same file does not see the first one's changes.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { add, changeBetween, defaultLayout, move, normalize, remove, reset, resize, VERSION } from './layout.mjs';
import { BUILT_IN_WIDGETS, FILL } from './widgets.mjs';

// The words of the undo bar. "Removed", "Moved" and "resized" are the examples in docs/assistant.md 4.1 (which writes the name in 「」;
// the quote marks here are the English ones). The rest is NEW wording for the owner to review.
const LABELS = {
  add: (name) => `Added “${name}”`, // NEW
  remove: (name) => `Removed “${name}”`,
  move: (name) => `Moved “${name}”`,
  resize: (name, w, h) => (w === FILL ? `“${name}” resized to full width × ${h}` : `“${name}” resized to ${w}×${h}`), // the full-width form is NEW
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
    if (!isObject(data) || data.v !== VERSION || !Array.isArray(data.widgets)) return setAside(`The file is not a version ${VERSION} layout.`);
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

  const undoInfo = () => (last ? { label: last.label, at: last.at } : null);

  function reply({ outcome, message, next, corrections }, extra = {}) {
    return {
      outcome, layout: structuredClone(current()), undo: undoInfo(), ...extra,
      ...(message ? { message } : {}), ...(next ? { next } : {}), ...(corrections ? { corrections } : {}),
    };
  }

  // A result from layout.mjs: a success is saved and becomes the layout and the one undo entry; anything else is passed on.
  // `name` is the page's name for a widget the dashboard has no declaration for.
  function commit(result, name) {
    if (result.outcome !== 'success') return reply(result);
    const { kind, type, w, h } = result.change;
    const label = LABELS[kind](names.get(type) ?? nameOf(name) ?? type, w, h);
    const before = current();
    try {
      save(result.layout);
    } catch (error) {
      return reply({ outcome: 'error', message: `The layout could not be saved: ${error.message}`, next: 'Check that the folder can be written, then call again.' });
    }
    layout = result.layout;
    last = { label, before, at: now() };
    return reply(result);
  }

  return {
    get() {
      current(); // the first read may set a bad file aside, which `recovered` then tells
      return reply({ outcome: 'success' }, { widgets: structuredClone(BUILT_IN_WIDGETS), recovered });
    },
    set(input, options) {
      if (!isObject(input) || input.v !== VERSION || !Array.isArray(input.widgets)) {
        return reply({ outcome: 'needs_clarification', message: `The layout must be { v: ${VERSION}, widgets: [...] }.`, next: 'Send the whole layout, as get returns it.' });
      }
      const { layout: next, corrections } = normalize(input, context);
      const change = changeBetween(current(), next, options?.type);
      if (!change) return reply({ outcome: 'no_op', message: 'Nothing changed.', corrections });
      return commit({ outcome: 'success', layout: next, change, corrections }, options?.name);
    },
    add: (request) => commit(add(current(), request, context), request?.name),
    move: (request) => commit(move(current(), request, context), request?.name),
    resize: (request) => commit(resize(current(), request, context), request?.name),
    remove: (request) => commit(remove(current(), request, context), request?.name),
    reset: () => commit(reset(current())),
    undo() {
      const entry = last;
      if (!entry) return reply({ outcome: 'no_op', message: 'There is nothing to undo.' });
      try {
        save(entry.before);
      } catch (error) {
        return reply({ outcome: 'error', message: `The layout could not be saved: ${error.message}`, next: 'Check that the folder can be written, then call again.' });
      }
      layout = entry.before;
      last = null;
      return reply({ outcome: 'success' }, { undone: { label: entry.label } });
    },
  };
}
