import * as React from 'react';
import { validatePluginWidget } from '../../../assistant/dashboard/widgets.mjs';
import * as widgetUi from '../../widget-ui.mjs';
import { defineWidget } from '../../widget.mjs';

// The widgets 嘟嘟 writes (assistant/widgets/local.mjs): one ES module per file in <project folder>/widgets. A file default-exports a function that gets
// { React, h, defineWidget, Frame, Row, Empty, Badge, WidgetNumber, ProgressBar } and returns what defineWidget returns. It is loaded here, in 嘟嘟's own
// interface, and registered into the same `dudu.widget` slot that the built-in widgets and a plugin's widgets use, so the add list, the board, the
// error boundary and the layout treat it like any other. No plugin is installed. The id is made from the file name, so a file cannot clash with another.
const API = Object.freeze({ React, h: React.createElement, defineWidget, ...widgetUi });
const POLL_MS = 5000;

/**
 * `list()` -> { widgets: [{ name, stamp }] }, `report(entries)` tells the host how loading went (it writes widgets/status.json for 嘟嘟),
 * `fileUrl(name, stamp)` is the address of a file's text, `slots` is the client's slot registry. `importer` is the module loader (a test passes its own).
 */
export function createLocalWidgets({ slots, list, report, fileUrl, importer = (url) => import(url), api = API }) {
  const live = new Map(); // name -> { stamp, dispose }
  const failed = new Map(); // name -> { stamp, error }
  let closed = false;
  let running = Promise.resolve();
  let timer = null;
  let reported = '';

  async function load(name, stamp) {
    const module = await importer(fileUrl(name, stamp));
    if (typeof module?.default !== 'function') throw new Error('The file must export a function by default: export default ({ h, defineWidget, Frame }) => defineWidget(declaration, Component).');
    const made = module.default(api);
    const declaration = made?.duduWidget;
    if (typeof made !== 'function' || !declaration) throw new Error('The function must return what defineWidget returns.');
    // The id comes from the file name and the interface version is ours; what the file leaves out gets its default.
    const widget = defineWidget({ ...declaration, id: `local.${name}`, widgetApi: 1, needs: declaration.needs ?? [], description: declaration.description ?? '' }, made);
    const checked = validatePluginWidget(widget.duduWidget);
    if (!checked.ok) throw new Error(checked.reason);
    return widget;
  }

  function publish() {
    const entries = [...live.keys()].map((name) => ({ name, ok: true }))
      .concat([...failed].map(([name, entry]) => ({ name, ok: false, error: entry.error })));
    const key = JSON.stringify(entries);
    if (key === reported) return;
    reported = key;
    Promise.resolve(report(entries)).catch(() => { reported = ''; });
  }

  async function run() {
    let found;
    try { found = (await list())?.widgets ?? []; } catch { return; } // a listing that failed changes nothing
    if (closed) return;
    const wanted = new Map(found.map((entry) => [entry.name, entry.stamp]));
    for (const [name, entry] of live) if (wanted.get(name) !== entry.stamp) { entry.dispose(); live.delete(name); }
    for (const [name, entry] of failed) if (wanted.get(name) !== entry.stamp) failed.delete(name);
    for (const [name, stamp] of wanted) {
      if (live.has(name) || failed.has(name)) continue;
      try {
        const widget = await load(name, stamp);
        if (closed) return;
        const { id, label } = widget.duduWidget;
        live.set(name, { stamp, dispose: slots.register({ name: 'dudu.widget', id, label }, widget) });
      } catch (error) {
        failed.set(name, { stamp, error: String(error?.message ?? error) });
      }
    }
    publish();
  }

  /** Looks at the folder after the look in progress, one at a time; resolves when that is done. `run` never rejects. */
  function sync() {
    if (closed) return running;
    running = running.then(run);
    return running;
  }

  return {
    sync,
    start() {
      void sync();
      timer = setInterval(() => { void sync(); }, POLL_MS);
    },
    close() {
      closed = true;
      clearInterval(timer);
      for (const entry of live.values()) entry.dispose();
      live.clear();
      failed.clear();
    },
  };
}
