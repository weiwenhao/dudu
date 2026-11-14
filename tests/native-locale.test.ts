import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { nativeLabels, nativeLocale, nativeText, resolveNativeLocale, withNativeLocale } from '../host/native-locale.mjs';
import { mobileLocaleContext } from '../host/mobile-page-locale.mjs';
import { createNativeSettings } from '../host/native-settings.mjs';
import { createNavigationStore } from '../host/native-navigation.mjs';
import { navigationLabelTranslations } from '../host/dudu-plugin/ui/lib/navigation-labels.mjs';
import { createNativeServer } from '../host/native-server.mjs';
import { createNativePages } from '../host/native-pages.mjs';
import { createWebPageHttp } from '../host/web-page-http.mjs';
import { createPairingStore } from '../host/pairing-devices.mjs';

test('phone language negotiation is bounded, weighted and backward compatible', () => {
  for (const value of [undefined, '', 'fr', '*', 'en;q=0', 'en;q=2', 'en;q=0,zh;q=0', 'en'.repeat(300)]) {
    assert.equal(resolveNativeLocale(value), 'zh-CN');
  }
  assert.equal(resolveNativeLocale('en-AU'), 'en');
  assert.equal(resolveNativeLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(resolveNativeLocale('fr, zh;q=0.4,en-GB;q=0.9'), 'en');
  assert.equal(resolveNativeLocale('en;q=0.8,zh;q=0.8'), 'en');
  assert.equal(resolveNativeLocale('en;q=0,zh-CN;q=1'), 'zh-CN');
});

test('overlapping phone scopes preserve literal user content and restore their caller', async () => {
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const labels = nativeLabels({ failure: '请求参数不正确。' });
  const english = withNativeLocale('en', async () => {
    const before = nativeLocale();
    ready.resolve();
    await release.promise;
    const content = '{1} $& <script>用户原文</script>';
    return { before, after: nativeLocale(), message: nativeText`已删除 ${content}`, label: labels.failure };
  });
  await ready.promise;
  const chinese = await withNativeLocale('zh', async () => {
    release.resolve();
    await Promise.resolve();
    return { language: nativeLocale(), label: labels.failure };
  });
  const value = await english;
  assert.deepEqual([value.before, value.after, chinese.language, nativeLocale()], ['en', 'en', 'zh-CN', 'zh-CN']);
  assert.ok(value.message.includes('{1} $& <script>用户原文</script>'));
  assert.notEqual(value.label, chinese.label);
});

test('localized settings never translate or persist collector names, prompts or custom statuses', async () => {
  const saved = [];
  const source = { name: '删除', connector: 'c1', frequency: '1h', prompt: '状态 {0}\n原始 Prompt' };
  const answers = {
    'collectors/list': { collectors: [{ id: 'r1', ...source }] },
    'connectors/list': { connectors: [{ id: 'c1', name: '连接器', kind: 'prompt' }] },
    'issues/statuses': { statuses: [{ id: 'custom', category: 'started', name: '需要你', description: '自定义描述' }] },
  };
  const settings = createNativeSettings({ call: async (action, body) => {
    saved.push([action, body]);
    return { status: 200, body: answers[action] ?? { outcome: 'success' } };
  } });
  await withNativeLocale('en', async () => {
    const form = (await settings.dispatch('settings.page', { section: 'collectors', target: 'edit:r1' })).page;
    const fields = form.sections.flatMap((section) => section.rows);
    assert.equal(fields.find((row) => row.key === 'name').value, source.name);
    assert.equal(fields.find((row) => row.key === 'prompt').value, source.prompt);
    const status = (await settings.dispatch('settings.page', { section: 'statuses', target: 'edit:custom' })).page;
    assert.equal(status.title, '需要你');
    await settings.dispatch('settings.act', { section: 'collectors', name: 'save', args: { id: 'r1' }, values: source });
  });
  assert.deepEqual(saved.find(([action]) => action === 'collectors/update')?.[1], { id: 'r1', ...source });
});

test('navigation projects registered translations without mutating source labels or inventing plugin titles', async () => {
  const store = await createNavigationStore({ now: () => 123 });
  const dictionaries = new Map([['example', new Map([
    ['zh', { nav: '测试入口' }], ['en', { nav: 'Test entry' }],
  ])]]);
  const locale = { dicts: dictionaries, getLocale: () => ({ active: 'zh' }) };
  const titles = navigationLabelTranslations(locale, { locale: 'example', label: () => '测试入口' }, '测试入口');
  await store.ingest({ schemaVersion: 1, sidebar: [
    { id: 'example', title: '测试入口', titles },
    { id: 'custom', title: '用户自己的标题' },
  ] });
  const before = store.get();
  const english = withNativeLocale('en', () => store.get());
  assert.equal(english.sidebar.find((row) => row.id === 'example').title, 'Test entry');
  assert.equal(english.sidebar.find((row) => row.id === 'custom').title, '用户自己的标题');
  assert.deepEqual(store.get(), before);
  assert.equal(navigationLabelTranslations(locale, { locale: 'example', label: '测试入口' }, '测试入口'), undefined);
});

test('embedded DSH locale reads and changes cannot reach the desktop language preference', () => {
  const reads = [];
  const desktopScope = { value: { preference: 'zh' } };
  const ctx = {
    configForms: { get(namespace) { reads.push(namespace); return desktopScope; } },
    provide() { assert.equal(this, ctx); },
  };
  const isolated = mobileLocaleContext(ctx);
  assert.equal(isolated.configForms.get('locale'), undefined);
  isolated.provide();
  assert.equal(isolated.configForms.get('models'), desktopScope);
  assert.deepEqual(reads, ['models']);
  assert.deepEqual(desktopScope.value, { preference: 'zh' });
});

test('authenticated API and page sessions keep phone languages isolated on a shared connection', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-locales-'));
  const pairingStore = await createPairingStore({ folder });
  const languages = [];
  const pages = createNativePages({
    frontend: { document: async (descriptor) => {
      languages.push(descriptor.locale);
      return { html: '<!doctype html><html></html>', resource: async () => ({}) };
    } },
    pageRpc: { invoke: async () => ({}), open: async () => ({}) },
  });
  const handler = createWebPageHttp({
    pages, pairingStore,
    duduPages: {
      allowed: (action) => action === 'assistant/settings',
      call: async (_action, body) => ({ status: 200, body: { language: nativeLocale(), body } }),
    },
  });
  const server = await createNativeServer({
    host: '127.0.0.1', port: 0, pairingStore, computer: { id: 'test', name: 'test' },
    dispatch: async (_method, params) => {
      const language = nativeLocale();
      await Promise.resolve();
      return { language, after: nativeLocale(), params };
    },
    httpHandler: handler.handle,
  });
  t.after(async () => {
    await handler.close();
    await server.close();
    await pairingStore.close();
    await rm(folder, { recursive: true, force: true });
  });
  const code = await pairingStore.issue({ address: server.address, name: 'test' });
  const token = new URL(code.url).searchParams.get('pair');
  const post = async (path, body, language, cookie?, status = 200) => {
    const response = await fetch(`${server.address}${path}`, {
      method: 'POST', headers: {
        'content-type': 'application/json', 'accept-language': language,
        ...(cookie ? { cookie: `dsbot_ui=${cookie}`, 'x-dsbot-page': '1' } : { authorization: `Bearer ${token}` }),
      }, body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
    return response.json();
  };
  await post('/dsbot/api/v1/connect', {}, 'en');
  const input = { title: '原文 {0}' };
  const results = await Promise.all(['en', 'zh'].map((language) =>
    post('/dsbot/api/v1/request', { id: randomUUID(), method: 'session.list', params: input }, language)));
  assert.deepEqual(results.map((row) => row.result), [
    { language: 'en', after: 'en', params: input }, { language: 'zh-CN', after: 'zh-CN', params: input },
  ]);
  const errors = await Promise.all(['en', 'zh'].map((language) =>
    post('/dsbot/api/v1/request', { id: randomUUID(), method: 'arbitrary.rpc', params: {} }, language)));
  assert.equal(errors[0].error.code, errors[1].error.code);
  assert.notEqual(errors[0].error.message, errors[1].error.message);
  const english = await post('/dsbot/web/open', { page: 'dudu', target: 'general' }, 'en');
  const chinese = await post('/dsbot/web/open', { page: 'dudu', target: 'general' }, 'zh');
  assert.deepEqual(languages, ['en', 'zh-CN']);
  const pageErrors = [];
  for (const [page, header, expected] of [[english, 'zh', 'en'], [chinese, 'en', 'zh-CN']]) {
    const result = await post(`${page.path}api/dudu/assistant/settings`, input, header, page.cookie);
    assert.deepEqual(result, { language: expected, body: input });
    const errors = await Promise.all(['en', 'zh'].map((language) =>
      post(`${page.path}api/dudu/not-allowed`, input, language, page.cookie, 404)));
    assert.deepEqual(errors[0], errors[1]);
    pageErrors.push(errors[0].error.message);
  }
  assert.notEqual(pageErrors[0], pageErrors[1]);
});
