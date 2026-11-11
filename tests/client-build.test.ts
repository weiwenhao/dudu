import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { buildClient, scopeCss } from '../scripts/build-client.mjs';

const require = createRequire(import.meta.url);

test('the interface CSS is scoped under .dudu and carries no cascade layers', async () => {
  const css: string = await scopeCss([
    '@layer utilities{.p-2{padding:8px}@media (min-width:1px){.m-1{margin:4px}}}',
    ':root{--x:1}*{margin:0}*::before{margin:0}button,input{color:red}',
    'body[data-ds-dark-theme] .dudu{--y:2}@keyframes spin{from{opacity:0}to{opacity:1}}',
  ].join(''));
  assert.ok(!css.includes('@layer'), 'layers must be unwrapped so DSH\'s unlayered CSS cannot beat ours');
  assert.match(css, /\.dudu \.p-2\{/);
  assert.match(css, /\.dudu \.m-1\{/);
  assert.match(css, /\.dudu\{--x:1\}/, ':root becomes the container itself');
  assert.match(css, /\.dudu \*\{/);
  assert.match(css, /\.dudu \*::before\{/);
  assert.match(css, /\.dudu button,\s*\.dudu input\{/);
  assert.match(css, /body\[data-ds-dark-theme\] \.dudu\{--y:2\}/, 'the dark-mode rule is already scoped by hand and must not be prefixed again');
  assert.ok(!css.includes('.dudu .dudu'), 'nothing is prefixed twice');
  assert.match(css, /@keyframes spin\{from\{opacity:0\}to\{opacity:1\}\}/, 'keyframe selectors are not selectors');
});

test('the built client gives the 嘟嘟 panel the interface and needs only what every DSH provides', async () => {
  const built = await buildClient();
  // DSH's loader hands the shell a `require` that knows its seed table: react, react-dom and DSH's own packages. Anything else
  // the interface asks for (it once asked for @tanstack/react-virtual, which only newer DSH builds seed) fails to load there.
  const seeds: Record<string, unknown> = {
    react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-dom': require('react-dom'), 'react-dom/client': require('react-dom/client'),
    '@deepseek-ai/dsh-client-ui-primitives': { Button: 'button', Input: 'input' },
  };
  const asked: string[] = [];
  const loaded: Array<{ id: string; factory: (require: (name: string) => unknown) => { name: string; apply: (ctx: unknown) => void } }> = [];
  const styles: string[] = [];
  const sandbox: Record<string, unknown> = {
    window: { __ModuleLoader__: { load: (module: never) => loaded.push(module) } },
    document: { baseURI: 'https://dsh.invalid/', documentElement: { style: {}, dataset: { platform: 'darwin' } }, createElement: () => ({ remove() {} }), head: { appendChild: (style: { textContent: string }) => styles.push(style.textContent) }, addEventListener() {}, removeEventListener() {} },
    console, clearTimeout, clearInterval, URL,
    // The grid library reads the browser's identity when it loads.
    navigator: { userAgent: 'node', platform: 'node' },
    // The shell's own timers (navigation reporting retries) must not keep the test process alive.
    setTimeout: (work: () => void, delay?: number) => setTimeout(work, delay).unref(),
    setInterval: (work: () => void, delay?: number) => setInterval(work, delay).unref(),
  };
  vm.runInNewContext(built.text, sandbox);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'dudu');
  const plugin = loaded[0].factory((name) => {
    asked.push(name);
    if (!(name in seeds)) throw new Error(`require("${name}") is not in DSH's seed table`);
    return seeds[name];
  });
  assert.equal(plugin.name, 'dudu');
  assert.deepEqual(asked.filter((name) => !(name in seeds)), []);

  // Apply the shell the way DSH does and look at what the panel registers in the `main` slot.
  let main: (() => { type: unknown; props: { request: unknown; logo?: string; actions?: { openSession?: (target: unknown) => Promise<void>; pickProjectDirectory?: () => Promise<string | null> } } }) | undefined;
  const disposers: Array<() => void> = [];
  const nativeCalls: string[] = [];
  const opened: string[] = [];
  let restored = false;
  let directoryPicks = 0;
  const nativeLeading = {
    registrant: 'dsh-sidebar', locale: 'sidebar',
    inject: { toggleSidebar: () => nativeCalls.push('sidebar'), startSession: () => nativeCalls.push('session') },
    component: (props: Record<string, unknown>) => require('react').createElement('host-controls', props),
  };
  const registrations: Array<{ options: Record<string, any>; component: any }> = [];
  const ctx: Record<string, unknown> = {
    locale: { getLocale: () => ({ active: 'en' }), subscribe: () => () => {} },
    effect: (work: () => unknown) => { const dispose = work(); if (typeof dispose === 'function') disposers.push(dispose as () => void); },
    slots: {
      inject: (_name: string, work: () => unknown) => { const dispose = work(); if (typeof dispose === 'function') disposers.push(dispose as () => void); return dispose; },
      register: (options: { name: string }, component: typeof main) => {
        const entry = { options, component };
        registrations.push(entry);
        if (options.name === 'main') main = component;
        return () => { const index = registrations.indexOf(entry); if (index >= 0) registrations.splice(index, 1); };
      },
      entries: (name: string) => name === 'shell.leading' ? [nativeLeading] : [], entriesOfSlot: () => [], subscribe: () => () => {},
    },
    plugin: (child: { name?: string; apply: (ctx: unknown) => void }) => {
      if (child.name === 'dudu-sessions') child.apply({
        ...ctx,
        sessions: { list: { getSnapshot: () => ({ ids: ['cached'], byId: { cached: { id: 'cached' } } }) } },
        layout: { selectPanel() {} },
        uiWorkspace: {
          openSession: (id: string) => { assert.ok(restored, 'cached history does not lift the archived-session gate'); opened.push(id); },
          pickDirectory: async () => { directoryPicks++; return '/work/picked'; },
        },
      });
    },
    modelDirectories: {},
  };
  try {
    plugin.apply(ctx);
    assert.ok(main, 'the panel registered a main page');
    const page = main();
    assert.equal(typeof page.type, 'function', 'with the interface built in, the panel shows it, not the old overview');
    assert.equal(typeof page.props.request, 'function', 'the interface posts through the shell\'s own request helper');
    assert.match(String((page.props as { logo?: string }).logo), /^data:image\/png;base64,/, 'and draws the mark the shell already carries');
    assert.equal(typeof page.props.actions?.openSession, 'function', 'and can open a session in DSH through the shell');
    assert.equal(await page.props.actions?.pickProjectDirectory?.(), '/work/picked', 'project creation uses the host directory picker');
    assert.equal(directoryPicks, 1);
    const requests: string[] = [];
    sandbox.fetch = async (path: string, options: { body: string }) => {
      assert.equal(path, '/api/dudu/issues/resume');
      assert.deepEqual(JSON.parse(options.body), { session: 'dsh:cached' });
      requests.push(path);
      restored = true;
      return { ok: true, json: async () => ({ outcome: 'no_op', sessionId: 'cached', workspaceId: 'workspace' }) };
    };
    await page.props.actions?.openSession?.({ sessionId: 'cached' });
    assert.equal(requests.length, 1);
    assert.deepEqual(opened, ['cached']);
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ outcome: 'error', message: 'Restore refused' }) });
    await assert.rejects(page.props.actions!.openSession!({ sessionId: 'cached' }), /Restore refused/);
    assert.deepEqual(opened, ['cached'], 'a refused restore never opens a composer that cannot send');
    assert.ok(styles.some((css) => css.includes('.dudu ')), 'the interface\'s stylesheet is injected');
    // shell.leading is single: the plugin must keep the host's component, injection and locale when composing Home with the native controls.
    const leading = registrations.find(({ options }) => options.name === 'shell.leading');
    assert.ok(leading);
    const nativeSlot = Object.keys(leading.options.children)[0];
    const cloned = registrations.find(({ options }) => options.name === nativeSlot);
    assert.ok(cloned);
    assert.equal(cloned.component, nativeLeading.component);
    assert.equal(cloned.options.inject, nativeLeading.inject);
    assert.equal(cloned.options.locale, nativeLeading.locale);
    const native = cloned.component(cloned.options.inject);
    const frame = leading.component({ renderSlot: (name: string) => { assert.equal(name, nativeSlot); return native; } });
    assert.equal(frame.props.children[0], native, 'Home composes with the host controls instead of discarding them');
    native.props.toggleSidebar();
    native.props.startSession();
    assert.deepEqual(nativeCalls, ['sidebar', 'session']);
  } finally {
    for (const dispose of disposers) dispose();
  }
});
