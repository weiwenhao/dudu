// What the plugin shell (client.js) gets from the built interface: its stylesheet and the page for the 嘟嘟 panel.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ToastProvider } from './components/toast.jsx';
import { Dashboard } from './dashboard/Dashboard.jsx';
import { IssueDetail } from './issues/IssueDetail.jsx';
import { IssueSessionDialog } from './issues/IssueSessionDialog.jsx';
import { Scope } from './lib/scope.jsx';
import { subscribeOpenIssue, takeIssueRequest } from './lib/open-issue.js';
import { SettingsDialog } from './settings/SettingsDialog.jsx';
import { SessionsDialog } from './sessions/SessionsDialog.jsx';
import { TasksDialog } from './tasks/TasksDialog.jsx';
import { subscribeTaskRequest, takeTaskRequest } from './tasks/navigation.js';
import { ServicesProvider } from './services.jsx';
import { DIRECT_REGISTRY, REGISTRY } from './widgets/index.js';
import { warmSessions } from './widgets/data.jsx';
import { Pet } from './pet/Pet.jsx';
import { beginPetInteraction, petOwnsOverlay } from './pet/overlays.js';
import { createWidgetSource, isBuiltInWidget, useWidgetCatalog } from './widgets/catalog.jsx';
import { createLocalWidgets } from './widgets/local.js';
import { Button } from './components/button.jsx';
import { T } from './strings.js';
import { getLocale, subscribeLocale } from './lib/locale.mjs';
import { requestDashboard, usePageHistory } from './lib/use-page-history.js';
import { receiveStatuses, subscribeWorkflow, workflowRevision } from './issues/workflow.js';
import { NeedsYouColorProvider } from './issues/NeedsYouColor.jsx';
import { resolveIssueSession as resolveSessionTarget } from './issues/session.js';

export { REGISTRY, createLocalWidgets, createWidgetSource };
export { connectLocale, getLocale, intlLocale, subscribeLocale } from './lib/locale.mjs';
export { T } from './strings.js';
export { AgentLogo } from './issues/AgentLogo.jsx';
export { SidebarAgent } from './sessions/SidebarAgent.jsx';
export { createSidebarActivity } from './sessions/sidebar-state.js';
export { installChatAutoHistory } from './lib/auto-chat-history.js';
export { installSessionHistoryCache } from './lib/session-history-cache.js';
export { createConversationFinder } from './lib/conversation-find.js';
export { installEmbeddedSessionSurface } from './lib/embedded-session-surface.js';
export { installSessionReadReceipts } from './lib/session-read-receipts.js';
export { installSessionActivityUpdates } from './lib/session-activity-updates.js';
export { installHarnessStats } from './lib/harness-stats.js';
export { installHarnessForeground } from './lib/harness-foreground.js';
export { installCollectorNotifications } from './collector/notifications.js';
export { installIssueHeader, ISSUE_HEADER_SLOT } from './lib/session-header.jsx';
export { SessionTasksAction } from './tasks/SessionTasks.jsx';
export { createSessionTasks } from './tasks/session-tasks-store.js';
export { navigationLabelTranslations } from './lib/navigation-labels.mjs';
export function openDashboard() { takeIssueRequest(); requestDashboard(); }

// Replaced by scripts/build-client.mjs with the compiled, `.dudu`-scoped Tailwind output.
export const css = __DUDU_CSS__;

const notifySettingsChanged = () => window.dispatchEvent(new Event('dudu:settings-changed'));

/**
 * The 嘟嘟 panel: the dashboard (widgets on a grid; Issues fills it until it is pulled smaller), and one issue's page in its place
 * when an issue is opened. `request` is the shell's POST helper; `logo` is the 嘟嘟 mark the shell already carries;
 * `actions.openSession({ sessionId, workspaceId })` opens a session in DSH (the shell knows how).
 */
export function Page({ request, logo, actions = {}, renderConversation, renderSessionHeader, renderPermission, petInShell = false, registry = DIRECT_REGISTRY }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  useSyncExternalStore(subscribeWorkflow, workflowRevision);
  useEffect(() => {
    let active = true;
    request('issues/statuses').then((value) => { if (active) receiveStatuses(value.statuses); }).catch(() => {});
    return () => { active = false; };
  }, [request]);
  // The sessions list is read once, a little after the page is up, so that the session window does not open on a "loading" (it brings it up to date when it opens).
  useEffect(() => {
    let stop = () => {};
    const timer = setTimeout(() => { stop = warmSessions(request); }, 3000);
    return () => { clearTimeout(timer); stop(); };
  }, [request]);
  const { route, openIssue, backToDashboard } = usePageHistory();
  const [settings, setSettings] = useState(false);
  const [sessions, setSessions] = useState(false);
  const [tasks, setTasks] = useState(false);
  useEffect(() => {
    const take = () => { const id = takeTaskRequest(); if (id) { requestDashboard(); setTasks(id); } };
    take();
    return subscribeTaskRequest(take);
  }, []);
  const [previewIssue, setPreviewIssue] = useState(null);
  const [version, setVersion] = useState(0); // settings changes refresh the dashboard and pet
  useEffect(() => {
    const changed = () => setVersion((n) => n + 1);
    window.addEventListener('dudu:settings-changed', changed);
    return () => window.removeEventListener('dudu:settings-changed', changed);
  }, []);
  // The pet beside every DSH page asks for an issue to open (from a reminder).
  useEffect(() => {
    const take = () => { const id = takeIssueRequest(); if (id != null) openIssue(id); };
    take();
    return subscribeOpenIssue(take);
  }, [openIssue]);
  // A session the harness has on this computer is loaded into DSH first (unless it already lives there), then opened.
  const openNativeSession = useCallback(async (session) => {
    const target = ['claude', 'codex'].includes(session.provider)
      ? await request('sessions/load', { provider: session.provider, id: session.id })
      : { sessionId: session.dshSessionId ?? session.id, workspaceId: session.workspaceId };
    await actions.openSession?.(target);
  }, [request, actions]);
  // An issue names its session as `claude:<id>`, `codex:<id>` or `dsh:<id>`.
  const resolveIssueSession = useCallback((issue, options) => resolveSessionTarget(request, actions, issue, options), [request, actions]);
  const openIssueSession = useCallback(async (issue) => {
    await actions.openSession?.(await resolveIssueSession(issue));
  }, [actions, resolveIssueSession]);
  // A session that was just put into DSH is listed in DSH's sidebar, without being opened.
  const addSession = useCallback(async (target) => { await actions.addSession?.(target); }, [actions]);
  const services = useMemo(() => ({
    request, openIssue, openNativeSession, openIssueSession, previewIssueSession: setPreviewIssue, addSession, pickProjectDirectory: actions.pickProjectDirectory,
    conversation: { actions, resolveIssueSession, renderConversation, renderSessionHeader },
  }), [request, openIssue, openNativeSession, openIssueSession, addSession, actions, resolveIssueSession, renderConversation, renderSessionHeader]);
  return (
    <Scope>
      <ToastProvider>
        <NeedsYouColorProvider request={request}><ServicesProvider value={services}>
          {route.name === 'issue' ? (
            <IssueDetail request={request} id={route.id} ids={route.ids} logo={logo} onBack={backToDashboard} onOpen={openIssue} openSession={openIssueSession} previewSession={setPreviewIssue} />
          ) : (
            <Dashboard key={version} request={request} registry={registry} onSettings={() => setSettings(true)} onSessions={() => setSessions(true)} onTasks={() => setTasks(true)} />
          )}
          <SessionsDialog open={sessions} onOpenChange={setSessions} />
          <TasksDialog open={Boolean(tasks)} initialTaskId={typeof tasks === 'string' ? tasks : null} onOpenChange={setTasks} onConversation={async () => {
            const conversation = await request('assistant/conversation');
            await actions.openSession?.({ sessionId: conversation.sessionId });
          }} />
          {previewIssue && <IssueSessionDialog key={previewIssue.id} issue={previewIssue} resolveSession={resolveIssueSession}
            actions={actions} renderConversation={renderConversation} renderSessionHeader={renderSessionHeader} onClose={() => setPreviewIssue(null)} />}
        </ServicesProvider></NeedsYouColorProvider>
        <SettingsDialog open={settings} onOpenChange={setSettings} request={request} actions={actions} onChanged={notifySettingsChanged} />
        {!petInShell && <Pet request={request} actions={actions} renderPermission={renderPermission} version={version} suppressed={settings || sessions || tasks || Boolean(previewIssue)} onSettings={() => setSettings(true)} />}
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
    const widgets = catalog.widgets.filter((widget) => !isBuiltInWidget(widget.id)).map(({ Component: _component, failed: _failed, ...declaration }) => declaration);
    request('dashboard/catalog', { widgets }).then((result) => {
      if (active) setSynced(result.outcome === 'success' ? 'ready' : 'error');
    }).catch(() => { if (active) setSynced('error'); });
    return () => { active = false; };
  }, [catalog, request, attempt]);
  if (synced === 'error') return <Scope><div className="flex h-full flex-col items-center justify-center gap-3" role="alert">
    <span>{T.dashboard.loadFailed}</span>
    <Button onClick={() => setAttempt((value) => value + 1)}>{T.retry}</Button>
  </div></Scope>;
  return synced === 'ready' ? <Page {...props} request={request} registry={catalog.widgets} /> : null;
}

export function AssistantOverlay({ request, actions, renderPermission }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const [settings, setSettings] = useState(false);
  const [version, setVersion] = useState(0);
  const [suppressed, setSuppressed] = useState(false);
  useEffect(() => {
    const changed = () => setVersion((n) => n + 1);
    const modal = () => {
      for (const menu of document.querySelectorAll('[role="menu"]')) petOwnsOverlay(menu);
      // A dialog that is kept in the page but not shown (display: none) takes nothing from the pet: it has no boxes to draw, so it is not an open dialog.
      setSuppressed([...document.querySelectorAll('[aria-modal="true"], [data-dudu-conversation-dialog]')].some((element) => !petOwnsOverlay(element) && element.getClientRects().length > 0));
    };
    document.addEventListener('pointerdown', beginPetInteraction, true);
    document.addEventListener('keydown', beginPetInteraction, true);
    window.addEventListener('dudu:settings-changed', changed);
    const observer = new MutationObserver(modal);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal'] });
    modal();
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', beginPetInteraction, true);
      document.removeEventListener('keydown', beginPetInteraction, true);
      window.removeEventListener('dudu:settings-changed', changed);
    };
  }, []);
  return <Scope floating>
    <Pet request={request} actions={actions} renderPermission={renderPermission} version={version} suppressed={settings || suppressed} onSettings={() => setSettings(true)} />
    <SettingsDialog open={settings} onOpenChange={setSettings} request={request} actions={actions} onChanged={notifySettingsChanged} />
  </Scope>;
}
