import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptPageResult,
  acceptPageUplink,
  allowPageCall,
  initializePagePolicy,
  isDuplexStream,
  pageStreamItem,
} from '../host/native-page-policy.mjs';

const parentSession = 'session-parent';
const thirdPartyMarketReads = [
  'dshMarket/registry',
  'dshMarket/installed',
  'dshMarket/status',
  'dshMarket/updates',
  'dshMarket/bundleOrder',
  'dshMarket/presets',
  'dshMarket/snapshots',
  'dshMarket/hostRecovery',
];
const sessionAddress = (sessionId = parentSession) => ({ kind: 'session', sessionId });
const pageFor = (kind, sessionId = parentSession) => {
  const page = { kind, sessionId };
  initializePagePolicy(page);
  return page;
};
const invoke = (page, endpoint, args) => allowPageCall(page, endpoint, args, false);
const stream = (page, endpoint, args) => allowPageCall(page, endpoint, args, true);

test('session read and follow calls require named, identity-scoped request objects', () => {
  const page = pageFor('trace');
  assert.equal(invoke(page, 'session/projections', {
    request: { sessionId: parentSession },
  }), true);
  assert.equal(invoke(page, 'session/page', {
    request: {
      address: sessionAddress(),
      throughSeq: 12,
      beforeSeq: 8,
      maxMessages: 50,
      turnWindow: { minMessages: 10, minTurns: 1 },
    },
  }), true);
  // The captured dsh-context Wt reader requests this exact one-past cursor.
  assert.equal(invoke(page, 'session/page', {
    request: {
      address: sessionAddress(),
      throughSeq: 12,
      beforeSeq: 13,
    },
  }), true);
  assert.equal(stream(page, 'session/follow', {
    request: {
      address: sessionAddress(),
      assistantStream: true,
      maxMessages: 50,
      turnWindow: { minMessages: 10, minTurns: 1 },
    },
  }), true);

  for (const request of [
    { address: sessionAddress('session-other'), throughSeq: 12 },
    { address: { kind: 'session', sessionId: parentSession, path: '/tmp' }, throughSeq: 12 },
    { address: sessionAddress(), throughSeq: 12, beforeSeq: 14 },
    { address: sessionAddress(), throughSeq: 12, extra: true },
  ]) {
    assert.equal(invoke(page, 'session/page', { request }), false);
  }
  assert.equal(invoke(page, 'session/page', [{
    address: sessionAddress(), throughSeq: 12,
  }]), false);
  assert.equal(stream(page, 'session/follow', {
    request: { address: sessionAddress(), assistantStream: false },
  }), false);
  assert.equal(invoke(page, 'session/projections', {
    request: { sessionId: 'session-other' },
  }), false);
  assert.equal(invoke(pageFor('plugins'), 'session/page', {
    request: { address: sessionAddress(), throughSeq: 1 },
  }), false);
});

test('team pages can address only subagents learned from the parent session', () => {
  const page = pageFor('team');
  const request = (childSessionId, parentSessionId = parentSession, mode = 'continuable') => ({
    request: {
      address: { kind: 'subagent', parentSessionId, childSessionId, mode },
      throughSeq: 5,
    },
  });

  assert.equal(invoke(page, 'session/page', request('child-1')), false);
  acceptPageResult(page, 'session/projections', {
    ok: true,
    value: {
      values: {
        agentTeam: { members: [{ id: 'child-1', name: 'Allowed' }] },
        subagentCatalog: [{ id: 'child-2', name: 'Also allowed' }],
      },
    },
  });
  assert.equal(invoke(page, 'session/page', request('child-1')), true);
  assert.equal(invoke(page, 'session/page', request('child-2')), true);
  assert.equal(invoke(page, 'session/page', request('child-1', 'session-other')), false);
  assert.equal(invoke(page, 'session/page', request('child-1', parentSession, 'invalid')), false);
  assert.equal(invoke(pageFor('trace'), 'session/page', request('child-1')), false);
});

test('dsh-context reads are page-kind and session scoped with fixed arguments', () => {
  const context = pageFor('context');
  assert.equal(invoke(context, 'dshContext/detail', { sessionId: parentSession }), true);
  assert.equal(invoke(context, 'dshContext/skills', { sessionId: parentSession }), true);
  assert.equal(invoke(context, 'dshContext/detail', { sessionId: 'session-other' }), false);
  assert.equal(invoke(context, 'dshContext/skills', {
    sessionId: parentSession,
    cwd: '/tmp',
  }), false);
  assert.equal(invoke(context, 'dshContext/fleet', { sessionId: parentSession }), false);

  const team = pageFor('team');
  acceptPageResult(team, 'session/projections', {
    ok: true,
    value: { values: { subagentCatalog: [{ id: 'child-1', name: 'Allowed' }] } },
  });
  assert.equal(invoke(team, 'dshContext/detail', { sessionId: 'child-1' }), true);
  assert.equal(invoke(team, 'dshContext/skills', { sessionId: parentSession }), true);
  assert.equal(invoke(team, 'dshContext/fleet', { sessionId: parentSession }), true);
  assert.equal(invoke(team, 'dshContext/fleet', { sessionId: 'child-1', full: true }), true);
  assert.equal(invoke(team, 'dshContext/fleet', { sessionId: 'child-1', full: 'yes' }), false);
  assert.equal(invoke(team, 'dshContext/fleet', { sessionId: 'session-other' }), false);
  assert.equal(invoke(team, 'dshContext/fleet', {
    sessionId: parentSession,
    url: 'https://example.com',
  }), false);
  assert.equal(invoke(pageFor('trace'), 'dshContext/detail', { sessionId: parentSession }), false);
  assert.equal(invoke(pageFor('plugins'), 'dshContext/skills', { sessionId: parentSession }), false);
});

test('configuration writes are limited to namespaces learned from describe', () => {
  const page = pageFor('settings');
  const write = {
    ns: 'model',
    patch: { selectedModel: 'model-safe' },
    expectedRevision: 4,
  };
  assert.equal(invoke(page, 'settings/update', write), false);
  acceptPageResult(page, 'settings/describe', {
    ok: true,
    value: { namespaces: [{ ns: 'model' }] },
  });
  assert.equal(invoke(page, 'settings/update', write), true);
  assert.equal(invoke(page, 'settings/update', {
    ...write, ns: 'unseen-namespace',
  }), false);
  assert.equal(invoke(page, 'settings/update', {
    ...write, expectedRevision: -1,
  }), false);
  assert.equal(invoke(pageFor('trace'), 'settings/update', write), false);

  const mutate = {
    ns: 'model',
    ops: [{ op: 'set', path: ['selectedModel'], value: 'model-safe' }],
  };
  assert.equal(invoke(page, 'settings/mutate', mutate), true);
  assert.equal(invoke(page, 'settings/mutate', {
    ...mutate, ops: [{ op: 'set', path: ['__proto__', 'polluted'], value: true }],
  }), false);
  assert.equal(invoke(page, 'settings/mutate', {
    ...mutate, ops: [{ op: 'delete', path: ['selectedModel'] }],
  }), false);
});

test('plugin controls require a matching item from the page inventory', () => {
  const page = pageFor('plugins');
  assert.equal(invoke(page, 'pluginManager/setPluginEnabled', {
    id: 'plugin-known', enabled: false,
  }), false);
  acceptPageResult(page, 'pluginManager/listPlugins', {
    ok: true,
    value: { plugins: [{ entryId: 'plugin-known' }] },
  });
  assert.equal(invoke(page, 'pluginManager/setPluginEnabled', {
    id: 'plugin-known', enabled: false,
  }), true);
  assert.equal(invoke(page, 'pluginManager/setPluginEnabled', {
    id: 'plugin-other', enabled: false,
  }), false);

  assert.equal(invoke(page, 'pluginManager/removeBundle', { name: 'bundle-known' }), false);
  acceptPageResult(page, 'pluginManager/listBundles', {
    ok: true,
    value: { bundles: [{ name: 'bundle-known' }] },
  });
  assert.equal(invoke(page, 'pluginManager/removeBundle', { name: 'bundle-known' }), true);
  assert.equal(invoke(page, 'pluginManager/removeBundle', { name: 'bundle-other' }), false);
});

test('credentials and market calls require described references and schema-valid queries', () => {
  const page = pageFor('plugins');
  assert.equal(invoke(page, 'credentials/set', { ref: 'provider/key', value: 'secret' }), false);
  assert.equal(invoke(page, 'credentials/describe', { refs: ['provider/key'] }), true);
  assert.equal(invoke(page, 'credentials/set', { ref: 'provider/key', value: 'secret' }), false);

  acceptPageResult(page, 'credentials/describe', {
    ok: false,
    error: { code: 'gateway/unavailable' },
  }, { refs: ['provider/key'] });
  assert.equal(invoke(page, 'credentials/unset', { ref: 'provider/key' }), false);

  acceptPageResult(page, 'credentials/describe', {
    ok: true,
    value: {
      'provider/key': null,
      'provider/unrequested': false,
    },
  }, { refs: ['provider/key'] });
  assert.equal(invoke(page, 'credentials/set', { ref: 'provider/key', value: 'secret' }), true);
  assert.equal(invoke(page, 'credentials/unset', { ref: 'provider/unrequested' }), false);
  assert.equal(invoke(page, 'credentials/unset', { ref: 'unlisted/key' }), false);

  const marketUrl = 'https://market.example/index.json';
  const marketQuery = {
    text: 'tool',
    category: 'coding',
    labels: ['mobile', 'assistant'],
    sort: { kind: 'published', direction: 'desc' },
    offset: 100,
    limit: 50,
    refresh: false,
    fetchedAt: 1720000000000,
  };
  assert.equal(invoke(page, 'pluginMarket/search', { url: marketUrl, query: marketQuery }), false);
  acceptPageResult(page, 'pluginMarket/listIndexes', {
    ok: true,
    value: { indexes: [{ url: marketUrl }] },
  });
  assert.equal(invoke(page, 'pluginMarket/search', { url: marketUrl, query: marketQuery }), true);
  for (const sort of [
    { kind: 'index' },
    { kind: 'relevance' },
    { kind: 'published', direction: 'asc' },
    { kind: 'key', id: 'rating', direction: 'desc' },
  ]) {
    assert.equal(invoke(page, 'pluginMarket/search', {
      url: marketUrl,
      query: { sort, offset: 0, limit: 1 },
    }), true);
  }
  for (const query of [
    'tool',
    { ...marketQuery, unknown: true },
    { ...marketQuery, sort: { kind: 'newest' } },
    { ...marketQuery, sort: { kind: 'key', id: 'rating', direction: 'sideways' } },
    { ...marketQuery, sort: { kind: 'index', direction: 'asc' } },
    { ...marketQuery, offset: -1 },
    { ...marketQuery, offset: 1.5 },
    { ...marketQuery, offset: Number.MAX_SAFE_INTEGER + 1 },
    { ...marketQuery, limit: 0 },
    { ...marketQuery, limit: 101 },
    { ...marketQuery, labels: ['valid', 3] },
    { ...marketQuery, refresh: 'true' },
    { ...marketQuery, fetchedAt: '1720000000000' },
  ]) {
    assert.equal(invoke(page, 'pluginMarket/search', { url: marketUrl, query }), false);
  }
  assert.equal(invoke(page, 'pluginMarket/search', {
    url: 'https://unlisted.example/index.json',
    query: marketQuery,
  }), false);
  assert.equal(invoke(page, 'pluginMarket/setIndexes', {
    urls: ['http://market.example/index.json'],
  }), false);
});

test('agent preset document reads accept only bounded schema strings', () => {
  const page = pageFor('plugins');
  assert.equal(invoke(page, 'agentPresets/read', { agentPreset: 'preset:default' }), true);
  assert.equal(invoke(page, 'agentPresets/read', { agentPreset: '' }), true);
  assert.equal(invoke(page, 'agentPresets/read', { agentPreset: 123 }), false);
  assert.equal(invoke(page, 'agentPresets/read', {
    agentPreset: 'x'.repeat(513),
  }), false);
  assert.equal(invoke(page, 'agentPresets/read', {
    agentPreset: 'preset:default',
    path: '/tmp/other',
  }), false);
});

test('third-party market methods are fixed empty-argument reads on config pages only', () => {
  for (const endpoint of thirdPartyMarketReads) {
    for (const kind of ['settings', 'plugins']) {
      assert.equal(invoke(pageFor(kind), endpoint, {}), true);
      assert.equal(stream(pageFor(kind), endpoint, {}), false);
      for (const key of ['url', 'path', 'header', 'headers', 'body']) {
        assert.equal(invoke(pageFor(kind), endpoint, { [key]: 'https://example.com' }), false);
      }
    }
    for (const kind of ['trace', 'context', 'team', 'tools', 'other']) {
      assert.equal(invoke(pageFor(kind), endpoint, {}), false);
    }
  }
});

test('events stay session scoped and unsupported RPC routes remain unavailable', () => {
  const page = pageFor('trace');
  const foreign = {
    type: 'emit',
    event: 'api-session/activity',
    args: [{ sessionId: 'session-other' }],
  };
  const local = {
    type: 'emit',
    event: 'api-session/activity',
    args: [{ sessionId: parentSession }],
  };
  assert.equal(pageStreamItem(page, '$events', foreign), undefined);
  assert.deepEqual(pageStreamItem(page, '$events', local), local);
  assert.equal(pageStreamItem(page, '$events', {
    type: 'emit',
    event: 'api-session/activity',
    args: [],
  }), undefined);
  assert.equal(pageStreamItem(page, '$events', {
    type: 'emit',
    event: 'api-session/future',
    args: [{ sessionId: parentSession }],
  }), undefined);
  const ready = { type: 'ready', clientId: 'bootstrap', host: { home: '/private/home' } };
  assert.deepEqual(pageStreamItem(page, '$events', ready), ready);
  assert.equal(pageStreamItem(page, '$events', {
    type: 'emit',
    event: 'plugin-manager/changed',
    args: [],
  }), undefined);

  const pluginsPage = pageFor('plugins', undefined);
  const pluginChanged = { type: 'emit', event: 'plugin-manager/changed', args: [] };
  assert.deepEqual(pageStreamItem(pluginsPage, '$events', pluginChanged), pluginChanged);
  const settingsChanged = { type: 'emit', event: 'settings/document-updated', args: [] };
  assert.deepEqual(pageStreamItem(pluginsPage, '$events', settingsChanged), settingsChanged);
  assert.equal(pageStreamItem(pluginsPage, '$events', local), undefined);
  assert.equal(pageStreamItem(pluginsPage, '$events', {
    type: 'emit',
    event: 'schedule/changed',
    args: [],
  }), undefined);
  assert.deepEqual(pageStreamItem(pageFor('settings', undefined), '$events', settingsChanged), settingsChanged);
  assert.equal(pageStreamItem(pageFor('tools'), '$events', settingsChanged), undefined);

  assert.equal(invoke(page, 'commands/execute', { line: 'anything' }), false);
  assert.equal(invoke(page, 'session/create', { request: {} }), false);
  assert.equal(stream(page, 'arbitrary/subscribe', {}), false);
});

test('panels, views and docks added by plugins read through the same allowlist and write nothing', () => {
  const session = (kind: string) => {
    const page: Record<string, unknown> = { kind, sessionId: 'session-1' };
    initializePagePolicy(page);
    return page;
  };

  for (const kind of ['view', 'dock']) {
    const page = session(kind);
    assert.equal(allowPageCall(page, 'session/projections', { request: { sessionId: 'session-1' } }), true, kind);
    assert.equal(allowPageCall(page, 'session/projections', { request: { sessionId: 'other' } }), false, kind);
    assert.deepEqual(pageStreamItem(page, '$events', {
      type: 'emit', event: 'api-session/status', args: ['session-1'],
    }), { type: 'emit', event: 'api-session/status', args: ['session-1'] }, kind);
    assert.equal(pageStreamItem(page, '$events', { type: 'emit', event: 'api-session/status', args: ['other'] }), undefined, kind);
  }

  const panel: Record<string, unknown> = { kind: 'panel' };
  initializePagePolicy(panel);
  for (const write of [
    ['pluginManager/setPluginEnabled', { id: 'x', enabled: false }],
    ['credentials/set', { ref: 'r', value: 'v' }],
    ['settings/mutate', { ns: 'n', ops: [{ op: 'unset', path: ['a'] }] }],
  ] as const) {
    assert.equal(allowPageCall(panel, write[0], write[1]), false, write[0]);
  }
  assert.ok(pageStreamItem(panel, '$events', { type: 'emit', event: 'schedule/changed', args: [] }));
  assert.equal(pageStreamItem(panel, '$events', { type: 'emit', event: 'credentials/record-updated', args: [] }), undefined);
});

// ---- Terminals ---------------------------------------------------------------------------------

const terminalId = 'terminal-one';
const dockPage = (sessionId = parentSession) => pageFor('dock', sessionId);
const create = (page, request, agentId = parentSession) => invoke(page, 'terminal/create', { agentId, request });

test('terminal calls exist only on a dock page, for that page\'s own conversation', () => {
  const calls = [
    ['terminal/environment', { agentId: parentSession }],
    ['terminal/shells', { agentId: parentSession }],
    ['terminal/list', { sessionId: parentSession }],
  ];
  const dock = dockPage();
  for (const [endpoint, args] of calls) assert.equal(invoke(dock, endpoint, args), true, endpoint);
  for (const kind of ['plugins', 'settings', 'trace', 'context', 'team', 'view', 'panel', 'tools']) {
    const page = pageFor(kind);
    for (const [endpoint, args] of calls) assert.equal(invoke(page, endpoint, args), false, `${kind} ${endpoint}`);
  }
  for (const [endpoint, args] of calls) {
    const key = Object.keys(args)[0];
    assert.equal(invoke(dock, endpoint, { [key]: 'another-session' }), false, `${endpoint} for another conversation`);
    assert.equal(invoke(dock, endpoint, { ...args, extra: 1 }), false, `${endpoint} with an extra argument`);
    assert.equal(invoke(dock, endpoint, {}), false, `${endpoint} without arguments`);
  }
  assert.equal(invoke(pageFor('dock', undefined), 'terminal/list', { sessionId: undefined }), false);
  // They are neither reads nor writes of the generic allowlists, and they are not streams.
  assert.equal(stream(dock, 'terminal/list', { sessionId: parentSession }), false);
  assert.equal(invoke(dock, 'terminal/attach', { agentId: parentSession, id: terminalId }), false);
  assert.equal(invoke(dock, 'terminal/retain', { sessionId: parentSession, id: terminalId }), false);
});

test('a terminal is created with a chosen id, a shell the desktop offered, and sane dimensions', () => {
  const page = dockPage();
  assert.equal(create(page, { id: terminalId, cols: 80, rows: 24 }), true);
  // A shell must come from the desktop's own list for this page.
  assert.equal(create(page, { id: 'terminal-two', cols: 80, rows: 24, shellPath: '/bin/zsh' }), false);
  acceptPageResult(page, 'terminal/shells', { ok: true, value: [{ path: '/bin/zsh', args: [], name: 'zsh' }] });
  assert.equal(create(page, { id: 'terminal-two', cols: 80, rows: 24, shellPath: '/bin/zsh' }), true);
  assert.equal(create(page, { id: 'terminal-three', cols: 80, rows: 24, shellPath: '/bin/sh' }), false);

  for (const request of [
    { id: 'bad id', cols: 80, rows: 24 },
    { id: '../escape', cols: 80, rows: 24 },
    { id: '', cols: 80, rows: 24 },
    { id: 'x'.repeat(129), cols: 80, rows: 24 },
    { id: 'terminal-four', cols: 1, rows: 24 },
    { id: 'terminal-four', cols: 501, rows: 24 },
    { id: 'terminal-four', cols: 80, rows: 0 },
    { id: 'terminal-four', cols: 80, rows: 201 },
    { id: 'terminal-four', cols: 80.5, rows: 24 },
    { id: 'terminal-four', cols: 80, rows: 24, cwd: '/' },
    { id: 'terminal-four', cols: 80, rows: 24, args: ['-c', 'x'] },
    { id: 'terminal-four', cols: 80 },
  ]) {
    assert.equal(create(page, request), false, JSON.stringify(request));
  }
  assert.equal(create(page, { id: 'terminal-five', cols: 80, rows: 24 }, 'another-session'), false);
});

test('a terminal is named by a well-formed id inside the page\'s own conversation', () => {
  const page = dockPage();
  const attach = { agentId: parentSession, id: terminalId };
  // The id was saved by the page's own storage on an earlier visit, so only its shape is checked.
  assert.equal(stream(page, 'terminal/attach', attach), true);
  assert.equal(invoke(page, 'terminal/rename', { ...attach, title: 'build' }), true);
  assert.equal(invoke(page, 'terminal/close', attach), true);
  assert.equal(stream(page, 'terminal/retain', { sessionId: parentSession, id: terminalId }), true);

  for (const id of ['', 'bad id', '../escape', 'a/b', 'x'.repeat(129), 'bad\nid', 7, null, undefined]) {
    assert.equal(stream(page, 'terminal/attach', { agentId: parentSession, id }), false, `attach ${String(id)}`);
    assert.equal(invoke(page, 'terminal/close', { agentId: parentSession, id }), false, `close ${String(id)}`);
    assert.equal(invoke(page, 'terminal/rename', { agentId: parentSession, id, title: 'x' }), false, `rename ${String(id)}`);
    assert.equal(stream(page, 'terminal/retain', { sessionId: parentSession, id }), false, `retain ${String(id)}`);
  }

  // Input, renaming and closing never reach into another conversation.
  assert.equal(stream(page, 'terminal/attach', { agentId: 'another-session', id: terminalId }), false);
  assert.equal(invoke(page, 'terminal/close', { agentId: 'another-session', id: terminalId }), false);
  assert.equal(invoke(page, 'terminal/rename', { agentId: 'another-session', id: terminalId, title: 'x' }), false);
  assert.equal(stream(page, 'terminal/attach', { ...attach, extra: true }), false);
  assert.equal(invoke(page, 'terminal/attach', attach), false, 'attach is a stream');
  assert.equal(invoke(page, 'terminal/rename', { ...attach, title: '' }), false);
  assert.equal(invoke(page, 'terminal/rename', { ...attach, title: 'x'.repeat(121) }), false);
  assert.equal(invoke(page, 'terminal/rename', { ...attach, title: 'bad\ntitle' }), false);
  assert.equal(stream(page, 'terminal/attach', { agentId: parentSession }), false);
  assert.equal(stream(page, 'terminal/attach', { id: terminalId }), false);
});

test('holding a saved terminal open is the one terminal call that may name another conversation', () => {
  // DSH's page holds every terminal tab it has saved, including those of conversations not on screen.
  const page = dockPage();
  assert.equal(stream(page, 'terminal/retain', { sessionId: 'saved-session', id: terminalId }), true);
  assert.equal(stream(page, 'terminal/retain', { sessionId: '', id: terminalId }), false);
  assert.equal(stream(page, 'terminal/retain', { sessionId: 'x'.repeat(257), id: terminalId }), false);
  assert.equal(stream(page, 'terminal/retain', { sessionId: 'bad\nsession', id: terminalId }), false);
  assert.equal(stream(page, 'terminal/retain', { sessionId: 'saved-session', id: terminalId, extra: 1 }), false);
  // Anywhere but a dock page there is nothing to hold.
  assert.equal(stream(pageFor('trace'), 'terminal/retain', { sessionId: 'saved-session', id: terminalId }), false);
  assert.equal(stream(pageFor('plugins'), 'terminal/retain', { sessionId: 'saved-session', id: terminalId }), false);
});

test('terminal input is a write or a resize and nothing else', () => {
  const page = dockPage();
  assert.equal(isDuplexStream('terminal/attach'), true);
  assert.equal(isDuplexStream('terminal/retain'), false);
  assert.equal(isDuplexStream('session/follow'), false);
  const accept = (item, endpoint = 'terminal/attach', target = page) => acceptPageUplink(target, endpoint, item);

  assert.equal(accept({ type: 'write', sequence: 1, data: 'ls -la\r' }), true);
  assert.equal(accept({ type: 'write', sequence: 2, data: '\u0003' }), true, 'control characters are keystrokes');
  assert.equal(accept({ type: 'write', sequence: 3, data: '\u001b[A' }), true);
  assert.equal(accept({ type: 'resize', sequence: 4, cols: 120, rows: 40 }), true);
  assert.equal(accept({ type: 'write', sequence: 5, data: 'x'.repeat(64 * 1024) }), true);
  assert.equal(accept({ type: 'write', sequence: 5, data: 'x'.repeat(64 * 1024 + 1) }), false);
  assert.equal(accept({ type: 'write', sequence: 5, data: '界'.repeat(21846) }), false, 'counted in bytes');

  for (const item of [
    undefined, null, 'ls', 1, [], {},
    { type: 'write', sequence: 1 },
    { type: 'write', sequence: 1, data: 7 },
    { type: 'write', sequence: 0, data: 'x' },
    { type: 'write', sequence: -1, data: 'x' },
    { type: 'write', sequence: '1', data: 'x' },
    { type: 'write', sequence: 1.5, data: 'x' },
    { type: 'write', sequence: 1, data: 'x', cwd: '/' },
    { type: 'resize', sequence: 1, cols: 80 },
    { type: 'resize', sequence: 1, cols: 80, rows: 24, data: 'x' },
    { type: 'resize', sequence: 1, cols: 1, rows: 24 },
    { type: 'exec', sequence: 1, data: 'x' },
    { sequence: 1, data: 'x' },
  ]) {
    assert.equal(accept(item), false, JSON.stringify(item));
  }
  assert.equal(accept({ type: 'write', sequence: 1, data: 'x' }, 'terminal/retain'), false);
  assert.equal(accept({ type: 'write', sequence: 1, data: 'x' }, 'session/follow'), false);
  assert.equal(accept({ type: 'write', sequence: 1, data: 'x' }, 'terminal/attach', pageFor('trace')), false);
});
