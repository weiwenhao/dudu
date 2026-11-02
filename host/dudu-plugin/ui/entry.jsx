// What the plugin shell (client.js) gets from the built interface: its stylesheet and the page for the 嘟嘟 panel.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ToastProvider } from './components/toast.jsx';
import { Dashboard } from './dashboard/Dashboard.jsx';
import { IssueDetail } from './issues/IssueDetail.jsx';
import { IssueSessionDialog } from './issues/IssueSessionDialog.jsx';
import { Scope } from './lib/scope.jsx';
import { setWhere, subscribeOpenIssue, takeIssueRequest } from './lib/where.js';
import { SettingsDialog } from './settings/SettingsDialog.jsx';
import { SessionsDialog } from './sessions/SessionsDialog.jsx';
import { ServicesProvider } from './services.jsx';
import { DIRECT_REGISTRY, REGISTRY } from './widgets/index.js';
import { Pet } from './pet/Pet.jsx';
import { createWidgetSource, useWidgetCatalog } from './widgets/catalog.jsx';
import { Button } from './components/button.jsx';
import { T } from './strings.js';
import { getLocale, subscribeLocale } from './lib/locale.mjs';

export { REGISTRY, createWidgetSource };
export { connectLocale, getLocale, intlLocale, subscribeLocale } from './lib/locale.mjs';
export { T } from './strings.js';
export { Button } from './components/button.jsx';
export { Input } from './components/input.jsx';
export { Switch } from './components/switch.jsx';
export { AgentLogo } from './issues/AgentLogo.jsx';

// Replaced by scripts/build-client.mjs with the compiled, `.dudu`-scoped Tailwind output.
export const css = __DUDU_CSS__;

/**
 * The 嘟嘟 panel: the dashboard (widgets on a grid; Issues fills it until it is pulled smaller), and one issue's page in its place
 * when an issue is opened. `request` is the shell's POST helper; `logo` is the 嘟嘟 mark the shell already carries;
 * `actions.openSession({ sessionId, workspaceId })` opens a session in DSH (the shell knows how).
 */
export function Page({ request, logo, actions = {}, renderConversation, petInShell = false, registry = DIRECT_REGISTRY, widgetProblems = [], extraSections = {} }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const [route, setRoute] = useState({ name: 'dashboard' });
  const [settings, setSettings] = useState(false);
  const [sessions, setSessions] = useState(false);
  const [previewIssue, setPreviewIssue] = useState(null);
  const [version, setVersion] = useState(0); // a change made in the settings (a widget switched on or off) reloads the dashboard
  const changed = useCallback(() => {
    setVersion((n) => n + 1);
    window.dispatchEvent(new Event('dudu:settings-changed'));
  }, []);
  // `ids` is the list the person came from; stepping to the next issue passes none and keeps the one already held.
  const openIssue = useCallback((id, ids) => setRoute((current) => ({ name: 'issue', id, ids: ids ?? current.ids ?? [] })), []);
  // The pet beside every DSH page asks what is on this one (for "Context") and for an issue to open (from a reminder).
  useEffect(() => { setWhere(route.name === 'issue' ? { page: 'issue', id: route.id } : { page: 'dashboard' }); }, [route.name, route.id]);
  useEffect(() => () => setWhere(null), []);
  useEffect(() => {
    const take = () => { const id = takeIssueRequest(); if (id != null) openIssue(id); };
    take();
    return subscribeOpenIssue(take);
  }, [openIssue]);
  // The sidebar's row for this page, clicked while the page is showing, is the way back to the dashboard from an issue: DSH selects the
  // panel that is selected already, which changes nothing by itself. (A row is a button named as the page and marked as the current one.)
  useEffect(() => {
    const home = (event) => {
      const row = event.target instanceof Element ? event.target.closest('button[aria-current="page"]') : null;
      if (row?.getAttribute('aria-label') === T.brand) setRoute({ name: 'dashboard' });
    };
    document.addEventListener('click', home);
    return () => document.removeEventListener('click', home);
  }, []);
  // A session the harness has on this computer is loaded into DSH first (unless it already lives there), then opened.
  const openNativeSession = useCallback(async (session) => {
    const target = ['claude', 'codex'].includes(session.provider)
      ? await request('sessions/load', { provider: session.provider, id: session.id })
      : { sessionId: session.dshSessionId ?? session.id, workspaceId: session.workspaceId };
    await actions.openSession?.(target);
  }, [request, actions]);
  // An issue names its session as `claude:<id>`, `codex:<id>` or `dsh:<id>`.
  const resolveIssueSession = useCallback(async (issue) => {
    const [provider, ...rest] = String(issue.session ?? '').split(':');
    const id = rest.join(':');
    if (!id) throw new Error('The issue has no session.');
    const target = await request('issues/resume', { id: issue.id });
    if (target.sessionId && ['success', 'no_op'].includes(target.outcome)) return target;
    if (provider === 'dsh') return { sessionId: id };
    return request('sessions/load', { provider, id });
  }, [request]);
  const openIssueSession = useCallback(async (issue) => {
    await actions.openSession?.(await resolveIssueSession(issue));
  }, [actions, resolveIssueSession]);
  // A session that was just put into DSH is listed in DSH's sidebar, without being opened.
  const addSession = useCallback(async (target) => { await actions.addSession?.(target); }, [actions]);
  const services = useMemo(() => ({
    request, openIssue, openNativeSession, openIssueSession, previewIssueSession: setPreviewIssue, addSession,
  }), [request, openIssue, openNativeSession, openIssueSession, addSession]);
  return (
    <Scope>
      <ToastProvider>
        <ServicesProvider value={services}>
          {route.name === 'issue' ? (
            <IssueDetail request={request} id={route.id} ids={route.ids} logo={logo} onBack={() => setRoute({ name: 'dashboard' })} onOpen={openIssue} openSession={openIssueSession} />
          ) : (
            <Dashboard key={version} request={request} registry={registry} onSettings={() => setSettings(true)} onSessions={() => setSessions(true)} />
          )}
          <SessionsDialog open={sessions} onOpenChange={setSessions} />
          {previewIssue && <IssueSessionDialog key={previewIssue.id} issue={previewIssue} resolveSession={resolveIssueSession}
            actions={actions} renderConversation={renderConversation} onClose={() => setPreviewIssue(null)} />}
        </ServicesProvider>
        <SettingsDialog open={settings} onOpenChange={setSettings} request={request} actions={actions} registry={registry} widgetProblems={widgetProblems} extraSections={extraSections} onChanged={changed} />
        {!petInShell && <Pet request={request} actions={actions} version={version} suppressed={settings || sessions || Boolean(previewIssue)} />}
      </ToastProvider>
    </Scope>
  );
}

export function SlotPage({ widgetSource, renderSlot, request, ...props }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const catalog = useWidgetCatalog(widgetSource, renderSlot);
  const [synced, setSynced] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const widgets = catalog.widgets.filter((widget) => widget.source).map(({ Component: _component, failed: _failed, ...declaration }) => declaration);
    request('dashboard/catalog', { widgets }).then((result) => {
      if (active) setSynced(result.outcome === 'success' ? 'ready' : 'error');
    }).catch(() => { if (active) setSynced('error'); });
    return () => { active = false; };
  }, [catalog, request, attempt]);
  if (synced === 'error') return <Scope><div className="flex h-full flex-col items-center justify-center gap-3" role="alert">
    <span>{T.dashboard.loadFailed}</span>
    <Button onClick={() => setAttempt((value) => value + 1)}>{T.retry}</Button>
  </div></Scope>;
  return synced === 'ready' ? <Page {...props} request={request} registry={catalog.widgets} widgetProblems={catalog.problems} /> : null;
}

export function AssistantOverlay({ request, actions }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const [version, setVersion] = useState(0);
  const [suppressed, setSuppressed] = useState(false);
  useEffect(() => {
    const changed = () => setVersion((n) => n + 1);
    const modal = () => setSuppressed(Boolean(document.querySelector('[aria-modal="true"], [data-dudu-conversation-dialog]')));
    window.addEventListener('dudu:settings-changed', changed);
    const observer = new MutationObserver(modal);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal'] });
    modal();
    return () => { observer.disconnect(); window.removeEventListener('dudu:settings-changed', changed); };
  }, []);
  return <Scope floating><Pet request={request} actions={actions} version={version} suppressed={suppressed} /></Scope>;
}
