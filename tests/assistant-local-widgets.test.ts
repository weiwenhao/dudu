import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalWidgets as createFolder, MAX_BYTES } from '../host/assistant/widgets/local.mjs';
import { createLocalWidgets as createLoader } from '../host/dudu-plugin/ui/widgets/local.js';

function folder(t: test.TestContext) {
  const home = mkdtempSync(join(tmpdir(), 'dudu-widgets-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'widgets'));
  return home;
}

test('only well-named module files of a sane size in widgets/ are widgets, and only those can be read', (t) => {
  const home = folder(t);
  const widgets = join(home, 'widgets');
  writeFileSync(join(widgets, 'clock.mjs'), 'export default () => 1;');
  writeFileSync(join(widgets, 'Bad Name.mjs'), 'x');
  writeFileSync(join(widgets, 'notes.txt'), 'x');
  writeFileSync(join(widgets, 'big.mjs'), 'x'.repeat(MAX_BYTES + 1));
  mkdirSync(join(widgets, 'folder.mjs'));
  writeFileSync(join(home, 'secret.mjs'), 'secret');
  const local = createFolder({ folder: () => home });
  assert.deepEqual(local.list().widgets.map((widget: { name: string }) => widget.name), ['clock']);
  assert.equal(local.read('clock'), 'export default () => 1;');
  for (const name of ['../secret', '..%2Fsecret', 'big', 'folder', 'Bad Name', 'notes', '', null, undefined, 7]) assert.equal(local.read(name as never), null);
  assert.deepEqual(createFolder({ folder: () => null }).list().widgets, []);
});

test('the stamp follows the file, and the status file keeps one line per widget the interface named', (t) => {
  const home = folder(t);
  const file = join(home, 'widgets', 'clock.mjs');
  const local = createFolder({ folder: () => home });
  writeFileSync(file, 'one');
  const first = local.list().widgets[0].stamp;
  writeFileSync(file, 'one two');
  assert.notEqual(local.list().widgets[0].stamp, first);
  local.report([{ name: 'clock', ok: true }, { name: 'broken', ok: false, error: 'It threw.' }, { name: '../evil', ok: true }], 0);
  const status = JSON.parse(readFileSync(join(home, 'widgets', 'status.json'), 'utf8'));
  assert.deepEqual(status.widgets, { clock: { ok: true }, broken: { ok: false, error: 'It threw.' } });
});

test('the interface registers the files as widgets, replaces one when its file changes, drops it when the file goes, and reports what failed', async () => {
  const registered = new Map<string, { options: { id: string; label: string }; component: { duduWidget: { widgetApi: number } } }>();
  const slots = { register: (options: { id: string; label: string }, component: never) => { registered.set(options.id, { options, component }); return () => { registered.delete(options.id); }; } };
  const good = (api: { defineWidget: (declaration: object, component: unknown) => unknown }) => api.defineWidget({ label: 'Clock', min: { w: 3, h: 2 }, size: { w: 4, h: 3 } }, function Clock() { return null; });
  const files: Record<string, { stamp: string; module: object }> = {
    clock: { stamp: '1', module: { default: good } },
    broken: { stamp: '1', module: { default: () => 'not a widget' } },
    empty: { stamp: '1', module: {} },
    tiny: { stamp: '1', module: { default: (api: { defineWidget: (declaration: object, component: unknown) => unknown }) => api.defineWidget({ label: 'Tiny' }, () => null) } },
  };
  const reports: Array<Array<{ name: string; ok: boolean; error?: string }>> = [];
  const imported: string[] = [];
  const local = createLoader({
    slots, list: async () => ({ widgets: Object.entries(files).map(([name, file]) => ({ name, stamp: file.stamp })) }),
    report: async (entries: never) => { reports.push(entries); },
    fileUrl: (name: string, stamp: string) => `${name}@${stamp}`,
    importer: async (url: string) => { imported.push(url); return files[url.split('@')[0]].module; },
  });
  await local.sync();
  assert.deepEqual([...registered.keys()], ['local.clock']);
  assert.equal(registered.get('local.clock')?.options.label, 'Clock');
  assert.equal(registered.get('local.clock')?.component.duduWidget.widgetApi, 1);
  assert.deepEqual(reports.at(-1)?.filter((entry) => !entry.ok).map((entry) => entry.name).sort(), ['broken', 'empty', 'tiny']);
  assert.ok(reports.at(-1)?.every((entry) => entry.ok || entry.error));

  // Nothing changed: no file is imported again, a failed one included, and nothing is reported twice.
  const loads = imported.length;
  await local.sync();
  assert.equal(imported.length, loads);
  assert.equal(reports.length, 1);

  // A file that changes is loaded again and takes the place of the old one.
  const before = registered.get('local.clock')?.component;
  files.clock = { stamp: '2', module: { default: good } };
  await local.sync();
  assert.notEqual(registered.get('local.clock')?.component, before);

  // A file that goes takes its widget with it; closing takes the rest.
  delete files.clock;
  await local.sync();
  assert.equal(registered.has('local.clock'), false);
  files.later = { stamp: '1', module: { default: good } };
  await local.sync();
  assert.equal(registered.has('local.later'), true);
  local.close();
  assert.equal(registered.size, 0);
});
