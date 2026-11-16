import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDsbotControl } from '../host/dsbot-control.mjs';
import { createNativeBridge } from '../host/native-bridge.mjs';
import {
  createNavigationStore,
  NAVIGATION_SCHEMA_VERSION,
  sanitizeIcon,
  sanitizeSnapshot,
} from '../host/native-navigation.mjs';

const icon = {
  viewBox: [0, 0, 16, 16],
  nodes: [
    { tag: 'path', d: 'M6 8.25C7.5 8.25 8.75 7 8.75 5.5Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
    { tag: 'circle', cx: 8, cy: 8, r: 3, fill: 'currentColor', stroke: 'none' },
  ],
};

/** What DSH reported: the list without what 嘟嘟 adds itself (ids that start with `dudu.`). */
const reported = (items: any[]) => items.filter((item) => !item.id.startsWith('dudu.'));

const snapshot = {
  schemaVersion: NAVIGATION_SCHEMA_VERSION,
  sidebar: [
    { id: 'schedules', title: '自动化任务', order: 10, source: '@deepseek-ai/dsh-client-ui-schedule', icon },
    { id: 'plugins', title: '插件', order: 0 },
    { id: 'insight', title: '上下文洞察', order: 20, source: 'example-insight' },
    // The desktop's page for browsing the harnesses' sessions: the phone has no such page, so it is not offered.
    { id: 'dudu', title: '嘟嘟', order: 20, source: 'dudu' },
  ],
  views: [
    { id: 'trajectory', title: '轨迹', order: 10 },
    { id: 'chat', title: '对话', order: 0 },
    { id: 'context', title: '上下文', order: 20 },
    { id: 'fleet', title: '编队', order: 30 },
    { id: 'notes', title: '笔记', order: 40, source: 'example-notes' },
  ],
  dock: [
    { kind: 'files', entryId: 'workspace', commandId: 'workspace.files', title: '工作区文件', order: 10 },
    { kind: 'terminal', entryId: 'new', title: '新建终端', order: 20 },
    { kind: 'browser', entryId: 'new', commandId: 'browser.new', title: '浏览器', order: 30 },
    { kind: 'dsh-context', entryId: 'open', title: '上下文', order: 15 },
    { kind: 'example-board', entryId: 'open', title: '看板', order: 40 },
  ],
  settings: [
    { id: 'models', title: '模型', order: 10, icon },
    { id: 'dudu-mobile-control', title: '手机控制', order: 50 },
    { id: 'dsbot-mobile-control', title: '手机控制', order: 51 },
    { id: 'dudu-providers', title: '供应商', order: 51 },
    { id: 'general', title: '通用设置', order: 5 },
    { id: 'account', title: '账号', order: 0 },
  ],
};

test('the snapshot is validated, ordered and routed: known entries open natively or in their page, new ones in a generic page', () => {
  const lists = sanitizeSnapshot(snapshot);
  assert.ok(lists);
  assert.equal(Object.hasOwn(lists, 'dock'), false);
  assert.equal(Object.hasOwn(lists, 'dockTabs'), false);

  assert.deepEqual(lists.sidebar.map((item) => [item.id, item.open]), [
    ['plugins', { web: { page: 'plugins' } }],
    ['schedules', { web: { page: 'panel', target: 'schedules' } }],
    ['insight', { web: { page: 'panel', target: 'insight' } }],
  ]);
  assert.equal(lists.sidebar[1].source, '@deepseek-ai/dsh-client-ui-schedule');
  assert.deepEqual(lists.sidebar[1].icon, icon);

  assert.deepEqual(lists.views.map((item) => [item.id, item.open]), [
    ['chat', { native: 'chat' }],
    ['trajectory', { web: { page: 'trace', target: 'trajectory' } }],
    ['context', { web: { page: 'context', target: 'context' } }],
    ['fleet', { web: { page: 'team', target: 'fleet' } }],
    ['notes', { web: { page: 'view', target: 'notes' } }],
  ]);

  // The pairing page configures the desktop and general settings are its appearance and shortcuts:
  // neither means anything on the phone.
  assert.deepEqual(lists.settings.map((item) => [item.id, item.open]), [
    ['account', { web: { page: 'settings', target: 'account' } }],
    ['models', { web: { page: 'settings', target: 'models' } }],
  ]);
});

test('a tab is recognised by its title when the plugin names its id differently', () => {
  const lists = sanitizeSnapshot({
    schemaVersion: 1,
    views: [
      { id: 'abc', title: '上下文' },
      { id: 'def', title: '编队' },
      { id: 'ghi', title: 'Team' },
    ],
  });
  assert.deepEqual(lists?.views.map((item) => item.open), [
    { web: { page: 'context', target: 'abc' } },
    { web: { page: 'team', target: 'def' } },
    { web: { page: 'team', target: 'ghi' } },
  ]);
});

test('bad items, ids and titles are dropped and duplicates keep the first', () => {
  const lists = sanitizeSnapshot({
    schemaVersion: 1,
    sidebar: [
      { id: 'ok', title: '  一   二\n三  ', order: 1 },
      { id: 'ok', title: 'again', order: 2 },
      { id: 'bad id!', title: 'x' },
      { id: 'untitled', title: '   ' },
      { id: '', title: 'x' },
      'not an object',
      { id: 'long', title: 'x'.repeat(200), order: 5 },
    ],
  });
  assert.deepEqual(lists?.sidebar.map((item) => [item.id, item.title.length > 0 && item.title.length <= 80]), [
    ['ok', true],
    ['long', true],
  ]);
  assert.equal(lists?.sidebar[0].title, '一 二 三');
});

test('lists are capped, and a different schema version is rejected', () => {
  const many = Array.from({ length: 200 }, (_, index) => ({ id: `p${index}`, title: `P${index}` }));
  assert.equal(sanitizeSnapshot({ schemaVersion: 1, sidebar: many })?.sidebar.length, 64);
  assert.equal(sanitizeSnapshot({ schemaVersion: 2, sidebar: many }), undefined);
  assert.equal(sanitizeSnapshot(null), undefined);
  assert.equal(sanitizeSnapshot([]), undefined);
});

test('an icon is plain, bounded data; anything that could carry markup or odd geometry is refused', () => {
  assert.deepEqual(sanitizeIcon(icon), icon);

  const withNode = (node: Record<string, unknown>) => sanitizeIcon({ viewBox: [0, 0, 16, 16], nodes: [node] });
  assert.equal(withNode({ tag: 'script', d: 'x' }), undefined);
  assert.equal(withNode({ tag: 'image', href: 'https://example.com/a.png' }), undefined);
  assert.equal(withNode({ tag: 'path', d: 'M0 0 <script>' }), undefined);
  assert.equal(withNode({ tag: 'path', d: 'M0 0'.repeat(2000) }), undefined);
  assert.equal(withNode({ tag: 'path' }), undefined);
  assert.equal(withNode({ tag: 'path', d: 'M0 0', fill: 'url(#x)' }), undefined);
  assert.equal(withNode({ tag: 'path', d: 'M0 0', stroke: 'var(--x)' }), undefined);
  assert.equal(withNode({ tag: 'circle', cx: 1, cy: 1, r: Number.POSITIVE_INFINITY }), undefined);
  assert.equal(withNode({ tag: 'circle', cx: 1, cy: 1, r: 1e9 }), undefined);
  assert.equal(withNode({ tag: 'path', d: 'M0 0', strokeLinecap: 'weird' }), undefined);
  assert.equal(withNode({ tag: 'path', d: 'M0 0', matrix: [1, 0, 0] }), undefined);
  assert.ok(withNode({ tag: 'path', d: 'M0 0L1 1', fill: '#abc', stroke: '#112233', matrix: [1, 0, 0, 1, 2, 3] }));

  assert.equal(sanitizeIcon({ viewBox: [0, 0, 0, 16], nodes: icon.nodes }), undefined);
  assert.equal(sanitizeIcon({ viewBox: [0, 0, 5000, 16], nodes: icon.nodes }), undefined);
  assert.equal(sanitizeIcon({ viewBox: [0, 0, 16], nodes: icon.nodes }), undefined);
  assert.equal(sanitizeIcon({ viewBox: [0, 0, 16, 16], nodes: [] }), undefined);
  assert.equal(sanitizeIcon({
    viewBox: [0, 0, 16, 16], nodes: Array.from({ length: 49 }, () => ({ tag: 'path', d: 'M0 0' })),
  }), undefined);
  assert.equal(sanitizeIcon('<svg/>'), undefined);

  // A rejected icon costs the item its glyph, never the item.
  const lists = sanitizeSnapshot({
    schemaVersion: 1,
    sidebar: [{ id: 'a', title: 'A', icon: { viewBox: [0, 0, 16, 16], nodes: [{ tag: 'script' }] } }],
  });
  assert.equal(lists?.sidebar.length, 1);
  assert.equal(lists?.sidebar[0].icon, undefined);
});

/** The start of a PNG of the given size: the signature and the IHDR chunk, which is what the host reads. */
function png(width = 64, height = 64, signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name = 'IHDR') {
  const bytes = Buffer.alloc(45);
  Buffer.from(signature).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write(name, 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

test('an icon the browser drew is a small real PNG, and nothing else passes as one', () => {
  const picture = { viewBox: [0, 0, 64, 64], nodes: [], png: png(), width: 64, height: 64 };
  assert.deepEqual(sanitizeIcon(picture), picture);
  // The size comes from the picture itself, not from what the sender says.
  assert.deepEqual(sanitizeIcon({ viewBox: [0, 0, 64, 64], png: png(48, 32), width: 1, height: 1 }),
    { viewBox: [0, 0, 64, 64], nodes: [], png: png(48, 32), width: 48, height: 32 });

  for (const [what, value] of Object.entries({
    'not a string': { viewBox: [0, 0, 64, 64], png: 5 },
    'empty': { viewBox: [0, 0, 64, 64], png: '' },
    'too short': { viewBox: [0, 0, 64, 64], png: 'iVBORw0KGgo=' },
    'not base64': { viewBox: [0, 0, 64, 64], png: `${png()}!!!` },
    'a data url': { viewBox: [0, 0, 64, 64], png: `data:image/png;base64,${png()}` },
    'markup': { viewBox: [0, 0, 64, 64], png: Buffer.from('<svg onload="x()"></svg>'.padEnd(40, ' ')).toString('base64') },
    'a jpeg': { viewBox: [0, 0, 64, 64], png: png(64, 64, [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]) },
    'no header chunk': { viewBox: [0, 0, 64, 64], png: png(64, 64, undefined, 'IDAT') },
    'too large a side': { viewBox: [0, 0, 64, 64], png: png(4096, 64) },
    'too small a side': { viewBox: [0, 0, 64, 64], png: png(2, 64) },
    'too many bytes': { viewBox: [0, 0, 64, 64], png: Buffer.concat([Buffer.from(png(), 'base64'), Buffer.alloc(13 * 1024)]).toString('base64') },
    'a bad box': { viewBox: [0, 0, 0, 64], png: png() },
  })) {
    assert.equal(sanitizeIcon(value), undefined, what);
  }

  // A picture beside shapes is still one picture: shapes alongside it are not trusted or kept.
  const mixed = sanitizeIcon({ viewBox: [0, 0, 64, 64], png: png(), nodes: [{ tag: 'script' }] });
  assert.deepEqual(mixed?.nodes, []);

  // It survives the whole snapshot and the store, and a bad one costs the item its glyph only.
  const lists = sanitizeSnapshot({
    schemaVersion: 1,
    sidebar: [
      { id: 'drawn', title: 'Drawn', icon: picture },
      { id: 'forged', title: 'Forged', icon: { viewBox: [0, 0, 64, 64], png: 'AAAA'.repeat(20) } },
    ],
  });
  assert.equal(lists?.sidebar[0].icon?.png, picture.png);
  assert.equal(lists?.sidebar[1].icon, undefined);
  assert.equal(lists?.sidebar.length, 2);
});

test('the store starts empty, keeps lists a snapshot leaves out, clears ones it sends empty, and ignores repeats', async () => {
  let clock = 1000;
  const store = await createNavigationStore({ now: () => clock });
  const empty = store.get();
  assert.deepEqual([empty.available, empty.updatedAt, empty.views], [false, 0, []]);
  assert.deepEqual(reported(empty.sidebar), [], 'nothing of DSH\'s yet');
  assert.deepEqual(reported(empty.settings), []);

  assert.equal(await store.ingest(snapshot), true);
  const first = store.get();
  assert.equal(first.available, true);
  assert.equal(first.updatedAt, 1000);
  assert.equal(reported(first.sidebar).length, 3);

  clock = 2000;
  assert.equal(await store.ingest(snapshot), false, 'an identical snapshot changes nothing');
  assert.equal(store.get().updatedAt, 1000);

  assert.equal(await store.ingest({ schemaVersion: 1, views: [] }), true);
  const second = store.get();
  assert.equal(second.updatedAt, 2000);
  assert.deepEqual(second.views, []);
  assert.equal(reported(second.sidebar).length, 3, 'a list that is absent stays as it was');
  assert.equal(reported(second.settings).length, 2);

  await assert.rejects(store.ingest({ schemaVersion: 7 }), /Unsupported navigation snapshot/);
  await store.close();
});

test('an entry that later arrives without its icon keeps the one it had, and a new icon replaces it', async () => {
  const picture = {
    viewBox: [0, 0, 64, 64], nodes: [], width: 64, height: 64,
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 64, 0, 0, 0, 64, 8, 6, 0, 0, 0, 0xaa, 0xbb, 0xcc, 0xdd, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]).toString('base64'),
  };
  const store = await createNavigationStore({ now: () => 1 });
  await store.ingest({ schemaVersion: 1, sidebar: [{ id: 'insight', title: '上下文洞察', icon: picture }, { id: 'plugins', title: '插件' }] });
  assert.equal(store.get().sidebar.find((item: any) => item.id === 'insight').icon.png, picture.png);

  // The same entries, reported while DSH's window could not draw the picture.
  assert.equal(await store.ingest({ schemaVersion: 1, sidebar: [{ id: 'insight', title: '上下文洞察' }, { id: 'plugins', title: '插件' }] }), false);
  assert.equal(store.get().sidebar.find((item: any) => item.id === 'insight').icon.png, picture.png);
  assert.equal(store.get().sidebar.find((item: any) => item.id === 'plugins').icon, undefined, 'an entry that never had one gets none');

  // An entry that goes away takes its icon with it; one that comes back without it starts without.
  await store.ingest({ schemaVersion: 1, sidebar: [{ id: 'plugins', title: '插件' }] });
  await store.ingest({ schemaVersion: 1, sidebar: [{ id: 'insight', title: '上下文洞察' }, { id: 'plugins', title: '插件' }] });
  assert.equal(store.get().sidebar.find((item: any) => item.id === 'insight').icon, undefined);
  await store.close();
});

test('the snapshot survives a restart and is routed again by the running plugin', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-navigation-'));
  t.after(() => rm(folder, { recursive: true, force: true }));

  const store = await createNavigationStore({ folder, now: () => 5000 });
  await store.ingest(snapshot);
  await store.close();

  const stored = JSON.parse(await readFile(join(folder, 'navigation.json'), 'utf8'));
  assert.equal(stored.updatedAt, 5000);
  // Hand-edit the stored routes: a restart must recompute them rather than trust the file.
  stored.sidebar[0].open = { web: { page: 'panel', target: 'tampered' } };
  await writeFile(join(folder, 'navigation.json'), JSON.stringify(stored));

  const reopened = await createNavigationStore({ folder });
  const restored = reopened.get();
  assert.equal(restored.available, true);
  assert.equal(restored.updatedAt, 5000);
  assert.deepEqual(reported(restored.sidebar)[0].open, { web: { page: 'plugins' } });
  await reopened.close();
});

test('an unreadable snapshot file is ignored rather than breaking the plugin', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-navigation-bad-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'navigation.json'), '{"updatedAt": 1, "sidebar": "nope"');
  const store = await createNavigationStore({ folder });
  assert.equal(store.get().available, false);
  await store.close();
});

test('the phone asks for navigation through the native API and gets an empty answer from a plugin that has none', async () => {
  const rpc = { async call() { return {}; }, async open() { throw new Error('no streams'); } };
  const store = await createNavigationStore({ now: () => 9 });
  await store.ingest(snapshot);

  const withStore = createNativeBridge({ rpc, navigation: store });
  const reply = await withStore.dispatch('navigation.get', {}, {});
  assert.equal(reply.available, true);
  assert.deepEqual(reply.views.map((item: { id: string }) => item.id), ['chat', 'trajectory', 'context', 'fleet', 'notes']);

  const without = createNativeBridge({ rpc });
  assert.deepEqual(await without.dispatch('navigation.get', {}, {}), {
    schemaVersion: 1, available: false, updatedAt: 0, sidebar: [], views: [], settings: [],
  });
});

test('DSH reports its navigation to the plugin, which keeps only a bounded, validated copy', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-navigation-control-'));
  const control = await createDsbotControl({
    folder, host: '127.0.0.1', port: 0, dispatch: async () => ({}), resolveLanAddress: () => '127.0.0.1',
  });
  t.after(async () => {
    try { await control.close(); } finally { await rm(folder, { recursive: true, force: true }); }
  });
  const post = (body: string) => control.handle('nav', new Request('http://localhost/api/dsbot/nav', { method: 'POST', body }));

  const accepted = await post(JSON.stringify(snapshot));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { changed: true });
  assert.equal(reported(control.navigation.get().sidebar).length, 3);

  const repeated = await post(JSON.stringify(snapshot));
  assert.deepEqual(await repeated.json(), { changed: false });

  const wrongVersion = await post(JSON.stringify({ schemaVersion: 9 }));
  assert.equal(wrongVersion.status, 400);
  const notJSON = await post('not json');
  assert.equal(notJSON.status, 400);
  const huge = await post(JSON.stringify({ schemaVersion: 1, sidebar: [{ id: 'a', title: 'x'.repeat(600 * 1024) }] }));
  assert.equal(huge.status, 400);
  assert.equal(reported(control.navigation.get().sidebar).length, 3, 'rejected input leaves the snapshot alone');
});

test('the plugin adds native primary routes and grouped settings ahead of registry entries', async () => {
  const store = await createNavigationStore({ now: () => 1 });
  await store.ingest(snapshot);
  const { sidebar, settings } = store.get();
  assert.deepEqual(sidebar.filter((item: any) => item.group === 'primary').map((item: any) => [item.id, item.open.native]), [
    ['dudu.board', 'board'], ['dudu.collector', 'collector'], ['dudu.tasks', 'schedule'],
  ]);
  assert.deepEqual(sidebar.slice(3).map((item: any) => item.id), ['plugins', 'schedules', 'insight']);
  // Dudu's tasks stay native; DSH's schedule panel uses DSH's actual UI.
  assert.deepEqual(sidebar.find((item: any) => item.id === 'dudu.tasks')?.open, { native: 'schedule', target: 'dudu-tasks' });
  assert.deepEqual(sidebar.find((item: any) => item.id === 'schedules')?.open, { web: { page: 'panel', target: 'schedules' } });
  assert.ok(sidebar.slice(0, 3).every((item: any) => sanitizeIcon(item.icon) !== undefined), 'native route icons pass the same validation as registry icons');
  const own = settings.filter((item: any) => item.group === 'dudu');
  assert.deepEqual(own.map((item: any) => item.id), ['dudu.general', 'dudu.statuses', 'dudu.connectors', 'dudu.collectors', 'dudu.rules', 'dudu.memory', 'dudu.skills', 'dudu.dsh']);
  assert.deepEqual(own.slice(0, 7).map((item: any) => item.open), ['general', 'statuses', 'connectors', 'collectors', 'rules', 'memory', 'skills'].map((section) => ({
    native: 'dudu-settings', target: section, web: { page: 'dudu', target: section },
  })));
  assert.deepEqual(own[7].open, { native: 'dsh-settings' });
  assert.ok(own.every((item: any) => sanitizeIcon(item.icon) !== undefined), 'every icon is drawable');
  assert.ok(settings.slice(0, own.length).every((item: any) => item.group === 'dudu'), 'ahead of DSH\'s');
  assert.ok(reported(settings).every((item: any) => item.group === undefined), 'what DSH reports has no group');
  await store.close();
});
