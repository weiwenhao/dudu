import assert from 'node:assert/strict';
import test from 'node:test';
import { installEmbeddedSessionSurface } from '../host/dudu-plugin/ui/lib/embedded-session-surface.js';

function host() {
  let mounted: string | undefined;
  const listeners = new Set<() => void>();
  const opened: string[] = [];
  const navigation: unknown[] = [];
  const commands: any[] = [];
  const openTab = function (kind: string) { commands.push([mounted, 'tab', kind]); };
  const sidebar = {
    mounted: { getSnapshot: () => mounted, subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); } },
    openResource(address: string, options: unknown) { commands.push([mounted, 'resource', address, options]); },
    openTab,
  };
  const set = (id?: string) => { mounted = id; for (const listener of listeners) listener(); };
  const bridge = installEmbeddedSessionSurface({ sidebar, openSession: async (id: string, options: unknown) => { opened.push(id); navigation.push(options); set(id); } });
  return { sidebar, opened, navigation, commands, set, bridge, openTab };
}

test('embedded sidebar actions open their owning native Session and run only after its committed surface; native actions remain direct', async () => {
  const h = host();
  const first = h.bridge.mount('split-session');
  const dialog = h.bridge.mount('dialog-session');
  first.activate();
  h.sidebar.openResource('dsh-resource://file/path', { params: { line: 17 } });
  assert.deepEqual(h.opened, ['split-session']);
  assert.deepEqual(h.navigation, [{ returnToDudu: true }], 'opening a native preview keeps its return address, just like the expand action');
  assert.deepEqual(h.commands, [], 'a selected id alone does not prove the sidebar store has mounted');
  h.bridge.committed('dialog-session');
  await Promise.resolve();
  assert.deepEqual(h.commands, []);
  h.bridge.committed('split-session');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.commands, [['split-session', 'resource', 'dsh-resource://file/path', { params: { line: 17 } }]]);
  h.sidebar.openTab('files');
  assert.equal(h.opened.length, 1);
  assert.deepEqual(h.commands.at(-1), ['split-session', 'tab', 'files']);
  h.set();
  h.sidebar.openTab('review');
  assert.deepEqual(h.navigation, [{ returnToDudu: true }, { returnToDudu: true }], 'page previews use the same return contract as file resources');
  h.bridge.committed('split-session');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.commands.at(-1), ['split-session', 'tab', 'review']);
  first.release();
  dialog.release();
  h.bridge.dispose();
});

test('navigation to another Session or plugin teardown cancels delayed commands instead of opening a file in the wrong Session', async () => {
  const h = host();
  h.bridge.mount('issue-session');
  h.sidebar.openTab('terminal');
  h.set('other-session');
  h.bridge.committed('issue-session');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.commands, []);
  h.set();
  h.sidebar.openTab('terminal');
  h.bridge.dispose();
  h.bridge.committed('issue-session');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.commands, []);
  assert.equal(h.sidebar.openTab, h.openTab, 'the original method is restored on unload');
});
