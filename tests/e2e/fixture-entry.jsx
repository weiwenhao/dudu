// The page the fixture serves: the real interface of the plugin on real React, in a plain document, asking its plugin through a
// function the test provides (window.__request) instead of through DSH. Built by fixture.mjs.
import { createRoot } from 'react-dom/client';
import { css, Page } from '../../host/dudu-plugin/ui/entry.jsx';
import { Scope } from '../../host/dudu-plugin/ui/lib/scope.jsx';
import { ServicesProvider } from '../../host/dudu-plugin/ui/services.jsx';
import { REGISTRY } from '../../host/dudu-plugin/ui/widgets/index.js';
import { WidgetData } from '../../host/dudu-plugin/ui/widgets/data.jsx';

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
const root = document.getElementById('root');
const request = (action, body) => window.__request(action, body ?? {});
const query = new URLSearchParams(location.search);
const preview = REGISTRY.find((widget) => widget.id === query.get('widget'));
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
if (dark) {
  document.body.setAttribute('data-ds-dark-theme', '');
  document.documentElement.style.setProperty('--dsw-alias-bg-base', '#17191d');
  document.documentElement.style.setProperty('--dsw-alias-bg-layer-1', '#17191d');
  document.documentElement.style.setProperty('--dsw-alias-label-primary', '#eeeff2');
  document.documentElement.style.setProperty('--dsw-alias-label-secondary', '#a3a6ae');
}
// A model directory like DSH's, in the page (a function cannot cross from the test): `window.__selected` holds what was chosen, in order.
const efforts = ['Low', 'Medium', 'High', 'Max'].map((name) => ({ id: name.toLowerCase(), name }));
const reasoning = { efforts, defaultEffort: 'high' };
let modelState = {
  current: { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' }, status: 'idle', error: null,
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash', name: 'DeepSeek-V4.1-Flash', reasoning }, { id: 'pro', name: 'DeepSeek-V4.1-Pro', reasoning }] },
    { id: 'openai', name: 'OpenAI', models: [{ id: 'sol', name: 'GPT-6.1 Sol' }] },
  ],
};
const modelWatchers = new Set();
const modelDirectory = {
  store: { subscribe: (watch) => { modelWatchers.add(watch); return () => modelWatchers.delete(watch); }, getSnapshot: () => modelState },
  load: async () => {},
  select: async (selection) => {
    window.__selected = [...(window.__selected ?? []), selection];
    modelState = { ...modelState, current: selection };
    for (const watch of modelWatchers) watch();
    return { ok: true };
  },
};
let page = <Page request={request} logo="" actions={{
  conversationModels: async () => ({ directory: modelDirectory, release() {} }),
  // What the box sends: pictures and files in the order they were picked ({ kind, name, ... }; a file's bytes stay in the page, only its size is reported).
  sendConversation: (sessionId, text, attachments = []) => window.__sent({ sessionId, text, attachments: attachments.map((item) => (item.kind === 'file'
    ? { kind: 'file', name: item.name, size: item.file.size } : { kind: 'image', mediaType: item.mediaType, name: item.name })) }),
  // The conversation's stored messages, as the test put them in `window.__records`.
  readConversation: async () => ({ records: window.__records ?? [], hasMore: false }),
  openSession: (target) => window.__opened(target),
  addSession: (target) => window.__added(target),
  voiceCatalog: () => window.__voiceCatalog(),
}} />;
if (preview) {
  const size = { cols: Number(query.get('cols')), rows: Number(query.get('rows')) };
  // The cells of the dashboard are half what they were (twenty columns): the same widget keeps its size in pixels with twice the cells.
  Object.assign(size, { width: size.cols * 56 - 12, height: size.rows * 56 - 12 });
  Object.assign(root.style, { width: `${size.width}px`, height: `${size.height}px`, inset: '0 auto auto 0' });
  page = <Scope><ServicesProvider value={{ request, openIssue() {}, openNativeSession() {}, openIssueSession() {} }}>
    <WidgetData Component={preview.Component} size={size} editing={false} />
  </ServicesProvider></Scope>;
}
createRoot(root).render(page);
