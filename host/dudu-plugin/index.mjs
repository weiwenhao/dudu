import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDuduControl } from './dist/dudu-control.mjs';
import { createTypertRpcAdapter } from './dist/native-bridge.mjs';
import { createTypertPageRpc } from './dist/native-page-rpc.mjs';
import { createDshMobileFrontend } from './dist/dsh-mobile-frontend.mjs';
import { createNativePages } from './dist/native-pages.mjs';
import { createDuduPages } from './dist/phone-pages.mjs';
import { createConversationReads } from './dist/native-conversation-reads.mjs';
import { createNativeFileTransfers } from './dist/native-file-transfers.mjs';
import { createNativeQuestions } from './dist/native-questions.mjs';
import { desktopPackageIdentity, writeDesktopRuntime } from './dist/desktop-runtime.mjs';
import { createNativeDiagnostics } from './dist/native-diagnostics.mjs';
import { createSessionDiagnostics } from './dist/session-diagnostics.mjs';
import { cleanReadSource, createReadLog } from './dist/read-log.mjs';
import { createBoardAnnounce } from './dist/native-board-announce.mjs';
import { createStartupLog } from './dist/startup-log.mjs';
import { createProviders } from './dist/providers/index.mjs';
import { createSessionTools } from './dist/providers/cron-tools.mjs';
import { createLinkStore, createNativeSessions } from './dist/providers/native/index.mjs';
import { createOverview } from './dist/providers/native/overview.mjs';
import { createPluginQuota, handleQuota } from './dist/providers/quota/index.mjs';
import { claudeProvider } from './dist/providers/drivers/claude.mjs';
import { codexProvider } from './dist/providers/drivers/codex.mjs';
import { piProvider } from './dist/providers/drivers/pi.mjs';
import { universalProviders } from './dist/providers/drivers/universal.mjs';
import { isHarness } from './dist/providers/catalog.mjs';
import { permissionOf } from './dist/providers/permission.mjs';
import { createIssues } from './dist/assistant/issues/index.mjs';
import { createIssuesApi, ISSUE_ACTIONS } from './dist/assistant/issues/api.mjs';
import { createIssueAttachmentApi } from './dist/assistant/issues/attachments.mjs';
import { sourceOf } from './dist/assistant/issues/source.mjs';
import { createInboxApi, INBOX_ACTIONS } from './dist/assistant/inbox/api.mjs';
import { AGENTS, createAgentSessions, modelFor } from './dist/assistant/home/agent-sessions.mjs';
import { approvalText, createDshSessions, questionText } from './dist/assistant/home/dsh-sessions.mjs';
import { installSessionHistoryCoalescing } from './dist/session-history-coalescing.mjs';
import { createAssignment } from './dist/assistant/home/assign.mjs';
import { createDispatch } from './dist/assistant/dispatch/index.mjs';
import { createCollectorNotifications } from './dist/assistant/collectors/notifications.mjs';
import { createCollectorAcknowledgements } from './dist/assistant/collectors/acknowledgements.mjs';
import { createDshLlm } from './dist/assistant/dispatch/dsh-llm.mjs';
import { createHandOut } from './dist/assistant/dispatch/hand-out.mjs';
import { createScheduler } from './dist/assistant/schedule/index.mjs';
import { createTasks, TASK_ACTIONS } from './dist/assistant/tasks/index.mjs';
import { createTaskHost } from './dist/assistant/tasks/host.mjs';
import { sessionOptions } from './dist/assistant/dispatch/rules.mjs';
import { createDashboard } from './dist/assistant/dashboard/index.mjs';
import { createDashboardApi, DASHBOARD_ACTIONS } from './dist/assistant/dashboard/api.mjs';
import { GridStackEngine } from './dist/assistant/dashboard/engine.mjs';
import { openAssistant } from './dist/assistant/assistant.mjs';
import { createCards } from './dist/assistant/home/cards.mjs';
import { createGroup } from './dist/assistant/home/group.mjs';
import { createLatest } from './dist/assistant/home/latest.mjs';
import { createChatHome } from './dist/assistant/home/chat-home.mjs';
import { createChatHomeApi } from './dist/assistant/home/chat-home-api.mjs';
import { createConversation } from './dist/assistant/home/conversation.mjs';
import { createAssistantSessionOperations } from './dist/assistant/home/session-operations.mjs';
import { createLocalWidgets } from './dist/assistant/widgets/local.mjs';
import { reminders } from './dist/assistant/home/reminders.mjs';
import { createIssueTidy } from './dist/assistant/issues/tidy.mjs';
import { claudeReader, codexReader, createSessions } from './dist/assistant/sessions/index.mjs';
import { createDeepSleep, withDeepSleep } from './dist/assistant/home/deep-sleep.mjs';
import { createSessionFolding, createSessionInbox } from './dist/assistant/home/inbox.mjs';
import { createSessionCatalog } from './dist/assistant/home/session-catalog.mjs';
import { createSessionTakeover } from './dist/assistant/home/session-takeover.mjs';
import { createSessionTitles } from './dist/assistant/home/session-titles.mjs';
import { createProjects } from './dist/assistant/home/projects.mjs';
import { sessionInfo } from './dist/providers/native/session-info.mjs';
import { createSourceCollector } from './dist/assistant/home/source-collector.mjs';
import { createOAuth } from './dist/assistant/connectors/mcp.mjs';
import { createSessionCleanup } from './dist/assistant/home/session-cleanup.mjs';
import { activityReaderOf, sessionActivityProjection } from './dist/assistant/sessions/activity-projection.mjs';
import { createReadReceipts, validReadPosition } from './dist/assistant/sessions/read-receipts.mjs';
import { createSessionActivity } from './dist/assistant/sessions/session-activity.mjs';
import { harnessTimingProjection } from './dist/providers/stats.mjs';
import { canReadSessionHistory, readSessionHistory } from './dist/dsh-session-history.mjs';

// How long an agent whose turn has ended must be left alone to be in deep sleep: half an hour. A test that cannot wait that long says how long in
// DUDU_DEEP_SLEEP_MS (milliseconds).
const deepSleepAfter = Number(process.env.DUDU_DEEP_SLEEP_MS) > 0 ? Number(process.env.DUDU_DEEP_SLEEP_MS) : undefined;

// Capture the loaded package once, so an old runtime cannot report newly installed files as its own.
const runtimeIdentity = await desktopPackageIdentity(dirname(fileURLToPath(import.meta.url)));
// What 嘟嘟 needs to write a widget travels in this package: the guide next to index.mjs.
const widgetKit = { guide: join(dirname(fileURLToPath(import.meta.url)), 'WIDGETS.md') };


// The routes the plugin registers with DSH, by path: the plugin's own pages in the phone's web view (phone-pages.mjs) ask for a few of them through the same handlers
// the desktop interface does, so there is one set of handlers and not two. The phone's page address, not DSH's, is what reaches them there.
const routes = new Map();
// How this start went (host/startup-log.mjs): set by apply(), so each route is noted when it becomes available and its first answers are timed.
let startupLog = null;
/** A part of a start worth its own line in that log: `run`, timed (what it answers and throws is unchanged). */
async function step(name, run) {
  const log = startupLog;
  if (!log) return run();
  const started = log.now();
  try { return await run(); } finally { log.step(name, started); }
}
function registerRoute(ctx, spec) {
  routes.set(spec.path, spec.fetch);
  const dispose = ctx.connection.fetch.register(startupLog ? { ...spec, fetch: startupLog.wrap(spec.path, spec.fetch) } : spec);
  startupLog?.route(spec.path);
  return () => { routes.delete(spec.path); return dispose?.(); };
}

/** One action of the desktop interface, run for a page of 嘟嘟's own on the phone: the handler's answer, with its status. */
async function runRoute(action, body) {
  const handler = routes.get(`/api/dudu/${action}`);
  if (!handler) return { status: 404, body: { error: 'Not found' } };
  try {
    const response = await handler(new Request(`http://dudu.invalid/api/dudu/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    }));
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } catch {
    return { status: 502, body: { error: 'The plugin could not answer.' } };
  }
}

export const name = 'dudu';
// Every service named here is waited for, `false` or not (docs/dsh-session-control.md, 试错记录 7): a DSH that lacks one does not start the plugin. These are services every
// DSH from 0.2.0 has; what only some DSHs have is read with `ctx.get` or `ctx.inject` and is not named here.
export const inject = {
  connection: true, typertGateway: true, clientModules: true, webServer: true, llm: true, agents: true, sessions: true,
  sessionProjections: false, sessionPersistence: false, workspaceRegistry: false,
  sessionController: false, sessionQuery: false, permissionPresets: false, userQuestions: false, agentDefaultModel: false,
  tools: false, agentPresets: false, loader: false,
  // DSH's own commands: the conversation's Compact is its /compact.
  commands: false, jobs: false,
  // DSH's attachment store: the pictures of a session loaded from Claude Code or Codex are kept there, so DSH's chat shows them.
  attachments: false,
  fileUploads: false,
  // DSH's DeepSeek account, for the balance the Quota widget shows (its service reads the wallet; no credential reaches this plugin).
  deepseekAccount: false,
  // DSH's credential store: where the tokens, keys and the values of environment variables of the connectors are kept (records under `dudu/<id>`). Without it they last until the plugin stops.
  credentials: false,
};

// The two halves do not depend on each other. The phone control needs a DSH new enough to hand out peers (the
// Desktop's); the providers work wherever DSH can route models, such as `dsh web`.
async function startProviders(ctx, folder, assignment) {
  const sessionDiagnostics = createSessionDiagnostics(folder);
  assignment.sessionDiagnostics = sessionDiagnostics;
  const links = await step('providers.links', () => createLinkStore(folder));
  // The cron tools Claude is given in place of its own (providers/cron-tools.mjs): jobs are tasks of Dudu that send their prompt into the conversation that made them. The tasks start after the providers, so they are asked for per call.
  const sessionTools = createSessionTools({
    tasks: () => assignment.tasks,
    question: {
      schema: (agent) => ctx.tools.get('ask_user_question', agent),
      ask: (request) => {
        if (!ctx.tools.get('ask_user_question', request.agent)) throw new Error('Unknown tool: ask_user_question');
        return ctx.userQuestions.ask(request);
      },
    },
    describe: (sessionId) => {
      let workspace;
      try { workspace = ctx.workspaceRegistry?.list().find((item) => item.sessionIds.includes(sessionId)); } catch { workspace = undefined; }
      return workspace ? { project: { id: workspace.id, name: workspace.title, path: workspace.path } } : null;
    },
  });
  const providers = await step('providers.create', () => createProviders({
    folder,
    providers: [claudeProvider, codexProvider, piProvider, ...universalProviders],
    host: {
      sessionTools,
      llm: ctx.llm,
      agents: ctx.agents,
      goals: () => { try { return ctx.get('goals'); } catch { return undefined; } },   // DSH's goal service, when this DSH has it
      jobs: () => ctx.jobs,
      attachments: () => ctx.attachments,
      on: (event, handler) => ctx.on(event, handler),
      emit: (event, ...args) => ctx.emit(event, ...args),
      permissionOf: (agent) => permissionOf(ctx.sessionProjections, agent),
      providerOf: (agent) => {
        let selection;
        try { selection = ctx.sessionProjections?.stateOf(agent.session, 'modelSelection'); }
        catch { /* older hosts may not have this projection */ }
        return selection?.pending?.provider ?? selection?.lastUsed?.provider
          ?? agent.session.requestHeader?.()?.config?.provider ?? agent.options?.provider;
      },
      eventsOf: async (sessionId, signal) => {
        const services = { controller: ctx.get('sessionController'), query: ctx.get('sessionQuery') };
        return canReadSessionHistory(services) ? (await readSessionHistory(services, sessionId, signal)).events : undefined;
      },
      flushSession: (session) => ctx.sessions.flush(session),
      tokenUsageOf: (session) => ctx.sessionProjections?.stateOf(session, 'tokenUsage')?.totals,
      onLink: links.record,
    },
  }));
  // The sessions the harnesses already have, to browse and load into DSH. DSH's own stores are looked up when used.
  const native = createNativeSessions({
    cacheFile: join(folder, 'session-search-native.sqlite'),
    diagnostics: sessionDiagnostics,
    sources: providers.sources, links, persistence: () => ctx.sessionPersistence, workspaces: () => ctx.workspaceRegistry,
    attachments: () => ctx.attachments,
    controller: () => ctx.sessionController, query: () => ctx.sessionQuery, agents: () => ctx.agents,
    rebind: (previousId, sessionId) => assignment.rebindSession?.(previousId, sessionId),
    onHistoryAppended: (sessionId, events) => assignment.sessionHistoryAppended?.(sessionId, events),
  });
  // The issues store opens in startIssues, so it is asked for when a list is read, not now.
  const searchDsh = createDshSessions(ctx, { hidden: links.removed, cacheFile: join(folder, 'session-search-dsh.sqlite'), diagnostics: sessionDiagnostics });
  assignment.historyFacts = searchDsh.historyFacts;
  const catalog = createSessionCatalog({ native, dsh: searchDsh, issues: { findBySession: (key) => assignment.issues?.findBySession(key) } });
  assignment.sessionCatalog = catalog;
  assignment.searchSessions = async (query) => {
    const rows = await searchDsh.catalog({ query, contentIndexOnly: true });
    return {
      items: rows.map((row) => ({ sessionId: row.id, snippet: row.evidence?.text ?? '' })),
      indexing: searchDsh.searchState().running,
    };
  };
  const projects = createProjects({ registry: () => ctx.workspaceRegistry });
  assignment.projects = projects;
  assignment.providers = providers;
  assignment.nativeSessions = native;
  assignment.sources = providers.sources;
  assignment.release = (sessionId) => providers.release(sessionId); // deep sleep lets go of what the harnesses hold for a session whose turn has ended
  assignment.hasActiveWork = providers.hasActiveWork;
  assignment.links = links;
  const overview = createOverview({ sources: providers.sources, links, titleOf: native.titleOf });
  assignment.overview = overview;
  // The subscription quota: read only when a person asks (the panel's icon, the chat's card), from the providers that are found and enabled and from DSH's DeepSeek accounts, kept in quota.db.
  // Each of DSH's services is read when needed: reading one this DSH lacks throws.
  const quota = createPluginQuota({
    file: join(folder, 'quota.db'), providers, log: console,
    dsh: {
      account: () => { try { return ctx.deepseekAccount; } catch { return undefined; } },
      providers: () => { try { return ctx.llm.listConfigurableProviders?.(); } catch { return undefined; } },
      settings: () => { try { return ctx.get('settings'); } catch { return undefined; } },
      credentials: () => optionalService(ctx, 'credentials'),
    },
  });
  assignment.quota = quota;
  const disposers = [
    ...['state', 'refresh', 'save', 'foreground'].map((action) => registerRoute(ctx, {
      path: `/api/dudu/providers/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => providers.handle(action, request),
    })),
    ...['list', 'load', 'read', 'sync'].map((action) => registerRoute(ctx, {
      path: `/api/dudu/sessions/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: async (request) => {
        if (action === 'load' || action === 'sync') return native.handle(action, request);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ outcome: 'error', code: 'invalid_session' }, { status: 400 });
        try {
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
          return Response.json(await catalog[action](body, { signal }), { headers: { 'cache-control': 'no-store' } });
        }
        catch { return Response.json({ error: 'Sessions are unavailable.' }, { status: 503 }); }
      },
    })),
    ...['list', 'create'].map((action) => registerRoute(ctx, {
      path: `/api/dudu/projects/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => projects.handle(action, request),
    })),
    registerRoute(ctx, { path: '/api/dudu/overview/running', methods: ['POST'], requestBody: 'buffered', fetch: (request) => overview.handle('running', request) }),
    registerRoute(ctx, { path: '/api/dudu/quota/get', methods: ['POST'], requestBody: 'buffered', fetch: (request) => handleQuota(quota, request) }),
  ];
  return {
    // Start native teardown as soon as plugin disposal begins; other services
    // can await scans, HTTP connections or output while the writers are exiting.
    stopHarnesses: () => providers.close(),
    async stop() {
      delete assignment.nativeSessions;
      delete assignment.projects;
      delete assignment.providers;
      delete assignment.overview;
      delete assignment.sessionCatalog;
      delete assignment.searchSessions;
      delete assignment.historyFacts;
      delete assignment.sources;
      delete assignment.release;
      delete assignment.hasActiveWork;
      delete assignment.links;
      delete assignment.quota;
      quota.close();
      for (const dispose of disposers) dispose();
      await Promise.all([providers.close(), native.close(), searchDsh.close()]);
      await links.flush();
      await sessionDiagnostics.flush();
      delete assignment.sessionDiagnostics;
    },
  };
}

// The issues of 嘟嘟 (docs/assistant.md): one SQLite file in the plugin's state folder, served to the desktop interface.
// `assignment` is the issues' hooks into the sessions they are given to; startAssignment fills it in once the store is open.
async function startIssues(ctx, folder, assignment = {}) {
  const issues = createIssues({ file: join(folder, 'assistant', 'issues.db'), lifecycleState: (key) => assignment.sessionState?.(key) ?? assignment.snapshots?.stateOf(key) ?? null,
    sessionState: (key) => assignment.sessionStatus?.(key)?.sessionState ?? 'idle', sessionHandledAt: (key) => assignment.sessionHandledAt?.(key) ?? null, deepSleepMs: deepSleepAfter,
    sessionReceivedAt: (key) => assignment.sessionStatus?.(key)?.attention?.messageAt ?? 0,
    sessionPreview: (key) => assignment.sessionStatus?.(key)?.attention?.preview ?? '', // the same line the conversation list shows under a title (the board card's description)
    issuePinned: (id) => assignment.chatHome?.isPinned(`issue:${id}`) === true,
    sessionTurnActive: (key) => key.startsWith('dsh:') && assignment.hasActiveWork?.(key.slice(4)) ? true : assignment.sessionTurnActive?.(key) ?? null,
    deepSleepOn: () => assignment.assistant?.settings?.value('deepSleep') !== false }); // the settings open later (startAssistant): until then, and for a file without the key, it is on
  const attachmentApi = createIssueAttachmentApi({ issues, attachments: () => ctx.attachments });
  const forward = async (issue, text, _entry, attachments = [], { chat = false } = {}) => {
    const current = issues.get(issue.id, { logLimit: 1 }).issue;
    if (!current?.project?.path || current.agent !== issue.agent || current.session !== issue.session) return { outcome: 'needs_clarification' };
    const target = await assignment.loadIssueSession?.(current) ?? current;
    const content = typeof attachments === 'function' ? await attachments(target.session?.replace(/^dsh:/, '')) : attachments;
    // A line written in 嘟嘟's chat comes into that thread as a line of the group, and its answer when it comes (home/group.mjs): what the session does next is watched before the line goes.
    const waiting = chat ? assignment.group?.expect(target.session) ?? null : null;
    let sent;
    try { sent = await (assignment.forward?.(target, text, content) ?? { outcome: 'error' }); }
    catch (error) { if (waiting) assignment.group.cancel(waiting); throw error; }
    if (waiting) {
      if (['success', 'no_op'].includes(sent?.outcome)) {
        const pictures = await keepPictures(content);
        await assignment.group.sent(waiting, { issue: current, text, files: Array.isArray(content) ? content.length : 0, pictures });
      } else assignment.group.cancel(waiting);
    }
    return sent;
  };
  // The pictures sent with a line of 嘟嘟's chat are kept in DSH's store, as an issue's are, so that the thread shows them in the line's own bubble (owner, 2026-11-22:
  // 「把消息和一起发的图片绑定在一个消息框里边」). A DSH that cannot keep them leaves the line as it was: its words, and how many files went with them.
  const keepPictures = async (content) => {
    const images = (Array.isArray(content) ? content : []).filter((part) => part?.type === 'image' && typeof part.data === 'string');
    if (!images.length || !attachmentApi.available()) return [];
    try { return await attachmentApi.saveImages(images.map(({ name, mediaType, data }) => ({ name, mediaType, data: Buffer.from(data, 'base64') }))); }
    catch (error) { console.warn(`[dudu] The pictures of a line to an issue could not be kept: ${error.message}`); return []; }
  };
  const api = createIssuesApi({
    issues,
    onAssign: (issue) => assignment.onAssign?.(issue),
    onReply: async (issue, text) => assignment.onReply?.(await assignment.loadIssueSession?.(issue) ?? issue, text),
    onResume: async (issue) => assignment.onResume?.(await assignment.loadIssueSession?.(issue) ?? issue),
    onChange: (issue) => ['done', 'canceled'].includes(issue.statusType ?? issue.status) ? assignment.closeFor?.(issue) : assignment.onAssign?.(issue),
    onForget: (issue) => assignment.closeFor?.(issue),
    onDelete: (issue) => assignment.deleteSessions?.(issue) ?? Promise.reject(new Error('Session cleanup is unavailable.')),
    onSession: (issue) => sessionInfo({ key: issue.session, links: assignment.links, controller: ctx.sessionController, query: ctx.sessionQuery }),
    onSource: (issue) => sourceOf({ issue, issues, collectors: assignment.assistant?.collectors }),
    onForward: forward,
    onMention: async (issue, message, entry) => {
      if (message.target === 'dudu') {
        if (!assignment.conversation) return { outcome: 'error' };
        return assignment.conversation.issueMessage(issue, message.body, entry,
          (sessionId) => attachmentApi.promptParts(issue, entry, sessionId, ctx.fileUploads));
      }
      return forward(issue, message.body, entry,
        (sessionId) => attachmentApi.promptParts(issue, entry, sessionId, ctx.fileUploads));
    },
  });
  assignment.issues = issues;
  assignment.issuesApi = api;
  assignment.issueAttachments = attachmentApi;
  // What the connectors collected, for the Collector widget: the connectors' names are asked for when a list is read (the project folder can move).
  // Sharing a record to a session is the owner's message to the agent of that issue, through the same door as the one typed on the issue's page.
  const inboxApi = createInboxApi({
    issues, collectors: () => assignment.assistant?.collectors ?? null, forward: (id, text, origin) => api.execute('forward', { id, text, ...origin }),
    // The Collector's button: the collector's session reads the conversation around a record (dispatch starts after the issues, so it is asked for when used).
    fill: (id) => assignment.fillRecord?.(id) ?? { outcome: 'error', message: 'Collection is unavailable.' },
  });
  assignment.inboxApi = inboxApi;
  const disposers = [
    registerRoute(ctx, {
      path: '/api/dudu/issues/attachment-upload', methods: ['POST'], requestBody: 'streaming',
      fetch: (request) => attachmentApi.upload(request),
    }),
    registerRoute(ctx, {
      path: '/api/dudu/issues/attachment', methods: ['GET'], requestBody: 'buffered',
      fetch: (request) => attachmentApi.read(request),
    }),
    ...ISSUE_ACTIONS.map((action) => registerRoute(ctx, {
      path: `/api/dudu/issues/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => api.handle(action, request),
    })),
    ...INBOX_ACTIONS.map((action) => registerRoute(ctx, {
      path: `/api/dudu/inbox/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => inboxApi.handle(action, request),
    })),
  ];
  return async () => {
    delete assignment.issuesApi;
    delete assignment.issueAttachments;
    delete assignment.inboxApi;
    for (const dispose of disposers) dispose();
    issues.close();
  };
}

// --- startAssignment: the sessions the issues are given to (docs/assistant.md 3.3 and 3.4, docs/dsh-session-control.md) ---
// An issue that is given an agent gets a DSH session in its project folder, follows it, and hands what the owner answers to it. Both DSH
// runtimes serve it from the services every plugin can inject: no phone peer is needed.
async function startAssignment(ctx, folder, assignment) {
  if (!assignment.issues) throw new Error('there are no issues');
  let closing = false;
  const activityProjection = activityReaderOf(await step('assignment.projection.activity', () => ctx.sessionProjections?.register(sessionActivityProjection)), ctx.sessionProjections);
  const readReceipts = createReadReceipts({ file: join(folder, 'assistant', 'session-reads.db') });
  await step('assignment.projection.timing', () => ctx.sessionProjections?.register(harnessTimingProjection));
  const dsh = createDshSessions(ctx, {
    historyFacts: assignment.historyFacts,
    hidden: (id) => assignment.links?.removed(id),
    nativeDefaults: async (agent, { cwd, model }) => {
      if (agent !== 'claude') return null;
      const driver = assignment.sources?.().find((source) => source.id === 'claude')?.driver;
      if (!driver?.configuration) return null;
      const configured = await driver.configuration({ cwd, ...(model && model !== 'default' ? { model } : {}) });
      // The DSH workspace envelope no longer removes Bash. Claude's own saved mode evaluates the operation.
      return { model: model ?? configured.model, effort: configured.effort, access: 'workspace-write' };
    },
  });
  const titles = await step('assignment.titles.create', () => createSessionTitles({ issues: assignment.issues, dsh, file: join(folder, 'assistant', 'session-titles.json') }));
  // DSH lists the models of the harnesses the first time it is asked, which takes a moment; the first issue given to an agent need not wait.
  void dsh.models().catch(() => {});
  const agentSessions = createAgentSessions({ dsh });
  const hooks = createAssignment({
    issues: assignment.issues,
    attachmentsOf: (issue, entry, sessionId) => assignment.issueAttachments.promptParts(issue, entry, sessionId, ctx.fileUploads),
    repairDefaults: async (issue) => {
      if (issue.agent !== 'claude' || !issue.session?.startsWith('dsh:')) return;
      const options = sessionOptions(assignment.assistant?.memory?.rules?.()?.rules?.['ASSIGN.md'], issue, { home: homedir(), defaultAccess: null });
      if (options.problem) return;
      const initial = assignment.issues.sessionStart(issue.id, issue.session);
      try { await dsh.repairDefaults(issue.session.slice(4), initial, { access: options.access == null, model: !options.model }); }
      catch (error) { console.warn(`[dudu] Legacy Claude defaults could not be restored: ${error.message}`); }
    },
    agentSessions,
    snapshotOf: (key) => assignment.snapshots?.snapshotOf(key),
    // What ASSIGN.md allows for this kind of issue; full access when it says nothing (3.3, owner 2026-11-09), and for Claude Code its own default.
    accessOf: (issue) => sessionOptions(assignment.assistant?.memory?.rules?.()?.rules?.['ASSIGN.md'], issue, { home: homedir(), defaultAccess: issue.agent === 'claude' ? null : 'danger-full-access' }),
  });
  Object.assign(assignment, { sessions: agentSessions, sessionState: hooks.sessionState, sessionHandledAt: hooks.sessionHandledAt, sessionTurnActive: hooks.sessionTurnActive, onAssign: hooks.onAssign, onReply: hooks.onReply, forward: hooks.forward, onResume: hooks.onResume, start: hooks.start, setAccess: hooks.setAccess, closeFor: hooks.closeFor, restore: hooks.restore });
  assignment.rebindSession = async (previousId, sessionId) => {
    const previous = `dsh:${previousId}`;
    const next = `dsh:${sessionId}`;
    const originals = assignment.issues.sessionOwners(previous).map((id) => assignment.issues.get(id).issue).filter((issue) => issue?.session === previous);
    const changed = [];
    const restore = async () => {
      for (const issue of changed) {
        hooks.forget(issue);
        const result = assignment.issues.update(issue.id, { session: issue.session }, { actor: 'dudu' });
        if (result.issue) await hooks.adopt(result.issue);
      }
    };
    try {
      await sessionActivity.rebind(previousId, sessionId);
      for (const issue of originals) {
        hooks.forget(issue);
        changed.push(issue);
        const result = assignment.issues.update(issue.id, { session: next }, { actor: 'dudu' });
        if (!result.issue) throw new Error(result.message);
        await hooks.adopt(result.issue);
      }
      return restore;
    } catch (error) { await restore(); throw error; }
  };
  assignment.deleteSessions = createSessionCleanup({
    links: assignment.links, issues: assignment.issues, registry: () => ctx.workspaceRegistry, forget: hooks.forget, suspend: hooks.suspend,
  });
  const takeover = createSessionTakeover({
    issues: assignment.issues, catalog: assignment.sessionCatalog, adopt: hooks.adopt,
    stateOf: hooks.sessionState,
    snapshotOf: hooks.snapshotOf,
    read: (key) => {
      const [provider, ...parts] = key.split(':');
      return ['claude', 'codex'].includes(provider) ? assignment.nativeSessions.read({ provider, id: parts.join(':') }) : dsh.read(key);
    },
    llm: (...args) => assignment.llm(...args),
    // A conversation only the harness has goes into DSH when it is taken over: it is then in DSH's list of sessions like any other.
    load: (issue) => assignment.loadSessionOf(issue),
  });
  assignment.takeOverSession = takeover.takeOver;
  const disposeTakeover = registerRoute(ctx, {
    path: '/api/dudu/sessions/takeover', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ outcome: 'error', code: 'invalid_session' }, { status: 400 });
      try { return Response.json(await takeover.takeOver(body), { headers: { 'cache-control': 'no-store' } }); }
      catch { return Response.json({ outcome: 'error', code: 'takeover_failed' }, { headers: { 'cache-control': 'no-store' } }); }
    },
  });
  // Puts the harness session of an issue into DSH and makes the issue name that DSH session: -> { issue, target } (target is what the page
  // opens or lists), or null for a session that is DSH's already.
  assignment.loadSessionOf = async (issue) => {
    const [provider, ...parts] = String(issue.session ?? '').split(':');
    if (!['claude', 'codex'].includes(provider)) return null;
    const loaded = await assignment.nativeSessions.load({ provider, id: parts.join(':') });
    const result = assignment.issues.update(issue.id, { session: `dsh:${loaded.sessionId}` }, { actor: 'dudu' });
    if (!result.issue) throw new Error(result.message);
    await hooks.adopt(result.issue);
    return { issue: result.issue, target: { sessionId: loaded.sessionId, ...(loaded.workspaceId ? { workspaceId: loaded.workspaceId } : {}) } };
  };
  assignment.loadIssueSession = async (issue) => (await assignment.loadSessionOf(issue))?.issue ?? issue;
  const inbox = createSessionInbox({ issues: assignment.issues, adopt: hooks.adopt, observe: hooks.observe, links: assignment.links });
  const readers = {
    claude: claudeReader(),
    codex: codexReader({
      command: () => assignment.sources?.().find((source) => source.id === 'codex')?.command,
      environment: () => assignment.sources?.().find((source) => source.id === 'codex')?.environment?.(),
    }),
    dsh: agentSessions.reader,
  };
  const snapshots = createSessions({
    file: join(folder, 'assistant', 'index', 'sessions.db'), readers, links: assignment.links,
    ignore: (key) => key.startsWith('dsh:dudu-assistant-'),
    // Lifecycle safety keeps managed questions until observed inactive; presentation uses separate read receipts.
    pinned: (key) => (assignment.issues?.sessionOwners(key)?.length ?? 0) > 0,
  });
  assignment.snapshots = snapshots;
  // Which screen made a conversation read, and how, in `diagnostics/reads.jsonl` (read-log.mjs).
  const readLog = createReadLog(folder);
  // A reply or a question nobody has read is shown on a phone that is away, as a notice that also wakes its App to write the board (native-board-announce.mjs).
  const boardAnnounce = createBoardAnnounce({
    announce: (event) => assignment.announcePhones?.(event),
    conversationOf: (sessionId) => {
      if (sessionId === assignment.conversation?.state()?.sessionId) return { id: 'assistant', title: '嘟嘟' };
      const issue = assignment.issues?.findBySession(`dsh:${sessionId}`)?.issue;
      return issue ? { id: `issue:${issue.id}`, title: issue.title } : null;
    },
  });
  const sessionActivity = createSessionActivity({
    readLog,
    onContent: (details) => boardAnnounce.content(details),
    receipts: readReceipts,
    projected: (id) => { const session = ctx.sessions.get(id); return session ? activityProjection?.stateOf(session) : null; },
    readProjection: async (sessionId, signal) => {
      try { return await ctx.sessionQuery.inspectSession(sessionId, (session) => activityProjection.stateOf(session), signal); }
      catch (error) { if (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return null; throw error; }
    },
    listProjections: async (signal) => (await ctx.sessionController.list({}, signal)).items,
    diagnostics: assignment.sessionDiagnostics,
    snapshotOf: hooks.snapshotOf, nativeSnapshotOf: (key) => snapshots.snapshotOf(key), liveOf: (id) => ctx.agents?.get(id),
    // A read or an unread mark that moved something is told to the phones at once (native-board-changes.mjs).
    changed: () => assignment.boardChanged?.(),
  });
  const stopAttention = ctx.on('session/event', (session) => {
    if (!session?.id || !activityProjection) return;
    const attention = activityProjection.stateOf(session);
    sessionActivity.observe(session.id, attention);
    sessionActivity.noteContent(session.id, attention);
    // A turn began or ended, a question or an answer was recorded: the phones read the board again now, not at their next poll.
    assignment.boardSessionChanged?.(session.id, attention);
  }, { global: true });
  // A change of an issue (its title, status, agent), made on the desktop or by Dudu, is one more thing the phones' board shows.
  const stopIssueChanges = assignment.issues?.onChange?.(() => assignment.boardChanged?.());
  assignment.sessionHistoryAppended = (id, events) => {
    // Cold native imports append through persistence, without publishing a live session/event.
    const session = ctx.sessions.get(id);
    assignment.boardChanged?.();
    if (session && activityProjection) { sessionActivity.observe(id, activityProjection.stateOf(session)); return; }
    const attention = events.reduce((state, event) => sessionActivityProjection.apply(state, event), sessionActivity.attentionOf(id));
    // The previous display hint may predate this append. It can update the list, but only a
    // complete fold can certify a read acknowledgement or transfer a receipt to another log.
    if (attention.seq >= 0 || attention.through >= 0) sessionActivity.observe(id, attention, undefined, false);
  };
  const warmActivity = sessionActivity.refresh;
  assignment.sessionStatus = sessionActivity.statusOf;
  const activityOf = (id) => withDeepSleep(sessionActivity.statusOf(`dsh:${id}`), `dsh:${id}`, (key) => assignment.issues?.findBySession(key).issue?.deepSleep === true);
  const acknowledgeRead = sessionActivity.acknowledge;
  assignment.acknowledgeRead = acknowledgeRead;
  assignment.markSessionUnread = sessionActivity.markUnread;
  assignment.warmSessionActivity = warmActivity;
  assignment.sessionActivity = activityOf;
  const observe = (snapshot) => inbox.accept(snapshot).catch((error) => console.warn(`[dudu] A managed issue could not follow its session: ${error.message}`));
  const stopSnapshots = snapshots.onChange(({ to, snapshot }) => {
    if (to != null && snapshot) void observe(snapshot);
  });
  // This part carries on after the phase has ended; the startup log times each of its steps and notes when it is over.
  const startup = step('assignment.titles.restore', () => titles.restore())
    .then(() => { if (!closing) return step('assignment.hooks.restore', () => hooks.restore()); })
    .then(async () => {
      if (closing) return;
      try {
        const assigned = assignment.issues.sessionKeys().filter((key) => key.startsWith('dsh:')).map((key) => key.slice(4));
        await step('assignment.warm', () => warmActivity(assigned));
      }
      catch (error) { if (!closing) console.warn(`[dudu] Session read boundaries could not be loaded: ${error.message}`); }
    })
    .then(() => { if (!closing) return step('assignment.poll', () => snapshots.poll()); })
    .then(() => { if (!closing) return step('assignment.hooks.restore', () => hooks.restore()); })
    .then(() => { if (!closing) return Promise.all(snapshots.snapshots({ state: 'waiting_owner', limit: 500 }).snapshots.map(observe)); })
    .catch((error) => console.warn(`[dudu] The sessions of the open issues could not be followed again: ${error.message}`))
    .finally(() => startupLog?.mark('assignment.restored'));
  const questionStops = [
    ['user-questions/request', (request) => Array.isArray(request.questions) ? questionText(request.questions) : ''],
    ['approval/request', approvalText],
  ].map(([event, text]) => ctx.on(event, async (request, next) => {
    const agent = request?.agent;
    const sessionId = agent?.session?.id;
    if (!sessionId || sessionId.startsWith('dudu-assistant-') || agentSessions.has(`dsh:${sessionId}`)) return next();
    await observe({
      key: `dsh:${sessionId}`, provider: 'dsh', state: 'waiting_owner',
      title: '', cwd: agent.session.header.cwd,
      agent: isHarness(agent.options.provider) ? agent.options.provider : 'deepseek',
      pending: { text: text(request), kind: event === 'approval/request' ? 'approval' : 'question' },
    });
    return next();
  }, { global: true, prepend: true }));
  const folding = createSessionFolding({
    sessions: agentSessions,
    onClose(key) {
      const issue = assignment.issues.findBySession(key).issue;
      if (issue) assignment.issues.log(issue.id, { actor: 'dudu', kind: 'session', text: 'closed the session' });
    },
  });
  // An idle agent that nobody has handled for half an hour is in deep sleep (its issue says so): what is kept for it is let go of. Looked at every
  // minute, or, when a test has shortened the time, every half of it.
  const deepSleep = createDeepSleep({
    sessions: agentSessions, asleep: (key) => assignment.issues.findBySession(key).issue?.deepSleep === true,
    intervalMs: deepSleepAfter ? Math.min(60_000, Math.max(250, deepSleepAfter / 2)) : undefined,
    release: (key) => assignment.release?.(key.slice('dsh:'.length)),
  });
  const disposeSnapshots = registerRoute(ctx, {
    path: '/api/dudu/sessions/snapshots', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let body;
      try { body = await request.json(); } catch { return Response.json({ outcome: 'error', message: 'Invalid JSON.' }, { status: 400 }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ outcome: 'error', message: 'Expected an object.' }, { status: 400 });
      return Response.json(snapshots.snapshots(body), { headers: { 'cache-control': 'no-store' } });
    },
  });
  const disposeActivity = registerRoute(ctx, {
    path: '/api/dudu/sessions/activity', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const body = await request.json().catch(() => null);
      if (!Array.isArray(body?.sessionIds) || body.sessionIds.length > 200 ||
          body.sessionIds.some((id) => typeof id !== 'string' || !id || id.length > 512)) {
        return Response.json({ outcome: 'error', code: 'invalid_session' }, { status: 400 });
      }
      await warmActivity(body.sessionIds);
      const states = Object.fromEntries(body.sessionIds.map((id) => {
        const snapshot = activityOf(id);
        return [id, snapshot ? { state: snapshot.state, sessionState: snapshot.sessionState, lastActivityAt: snapshot.lastActivityAt, provider: snapshot.provider, agent: snapshot.agent, ...(snapshot.deepSleep ? { deepSleep: true } : {}) } : null];
      }));
      return Response.json({ states }, { headers: { 'cache-control': 'no-store' } });
    },
  });
  const disposeRead = registerRoute(ctx, {
    path: '/api/dudu/sessions/mark-read', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.sessionId !== 'string' || !validReadPosition(body.position)) return Response.json({ code: 'invalid_read' }, { status: 400 });
      try {
        // The desktop says which of its panes it was and what the person did (`ui/lib/session-read-receipts.js`); only the log gets it.
        return Response.json(await acknowledgeRead(body.sessionId, body.position, cleanReadSource(body.source, { screen: 'desktop' })), { headers: { 'cache-control': 'no-store' } });
      } catch { return Response.json({ code: 'invalid_read' }, { status: 400 }); }
    },
  });
  return async () => {
    closing = true;
    disposeRead();
    disposeActivity();
    stopAttention();
    stopIssueChanges?.();
    delete assignment.sessionHistoryAppended;
    delete assignment.acknowledgeRead;
    delete assignment.markSessionUnread;
    delete assignment.warmSessionActivity;
    await sessionActivity.close();
    await readLog.flush();
    await folding.close();
    await deepSleep.close();
    for (const stop of questionStops) stop();
    stopSnapshots();
    disposeSnapshots();
    delete assignment.sessionActivity;
    disposeTakeover();
    delete assignment.takeOverSession;
    await takeover.close();
    await startup;
    await titles.close();
    await snapshots.dispose();
    await inbox.close();
    delete assignment.snapshots;
    delete assignment.loadIssueSession;
    for (const hook of ['sessions', 'sessionState', 'sessionHandledAt', 'sessionTurnActive', 'onAssign', 'onReply', 'forward', 'onResume', 'start', 'closeFor', 'restore', 'deleteSessions', 'rebindSession']) delete assignment[hook];
    await hooks.dispose();
    agentSessions.dispose();
    await dsh.close();
    delete assignment.sessionStatus;
    readReceipts.close();
  };
}

// 嘟嘟's own state (docs/assistant.md 2, 3.5, 3.6): the project folder with its Markdown files, the settings, the memory, the
// connectors and the collectors, and the calls the settings page makes on them. A project folder that cannot be opened turns off the memory,
// the connectors and the collectors only (the settings page says why); the rest of the plugin runs.
/** A service DSH may not have: reading it from the context of a plugin that did not inject it throws, so it is null then. */
function optionalService(ctx, name) {
  try { return ctx[name] ?? null; } catch { return null; }
}

/**
 * What mounts one MCP server in DSH, so that its tools are in every session of the owner: DSH's own MCP client, the plugin every DSH has, mounted under this plugin for as long as
 * the server is connected (connectors/publish.mjs). Null when this DSH has none, and then the connectors work for the collections only.
 */
async function mcpMounter(ctx) {
  try {
    const client = await ctx.loader.import('@deepseek-ai/dsh-mcp-client');
    if (typeof client?.apply !== 'function') return null;
    // Not the child itself: it is awaitable, and waiting for it would wait for the server to answer.
    return (config) => { const child = ctx.plugin(client, config); return { dispose: () => child.dispose() }; };
  } catch (error) {
    console.warn(`[dudu] DSH's MCP client could not be loaded, so the connectors are not in its sessions: ${error?.message ?? error}`);
    return null;
  }
}

async function startAssistant(ctx, dshHome, folder, assignment = {}) {
  // The memory asks the model of startDispatch once it is there (the same one DSH has as its default).
  const llm = (messages, options) => (assignment.llm ? assignment.llm(messages, options) : Promise.reject(new Error('There is no model yet.')));
  const assistant = openAssistant({
    dshHome, stateFolder: join(folder, 'assistant'), llm,
    mountMcp: await step('assistant.mcp', () => mcpMounter(ctx)), // what is connected is mounted in DSH, to be in every session
    credentials: optionalService(ctx, 'credentials'), // where the tokens, keys and values of environment variables of the connectors are kept
    createOAuth, // the browser sign-in of the hosted MCP servers
    // A collector that is removed takes with it what it brought and the owner never dealt with (owner, 2026-11-10); what they marked or made an issue of stays.
    onCollectorRemoved: (id) => assignment.issues?.inbox.dropUntouched(id),
    state: () => ({ conversation: assignment.conversation?.state() ?? null, lastIssueTidy: assignment.issueTidy?.state() ?? null, counts: assignment.issues?.counts() ?? null }),
    beforeFolderChange: () => assignment.conversation?.busy ? { outcome: 'needs_clarification', message: 'Wait until the conversation and memory tidy finish.' } : null,
  });
  assignment.assistant = assistant; // startAssignment and startDispatch read the rules and the connectors through it: the folder can move
  assignment.projectFolder = () => assistant.folder;

  for (const problem of assistant.problems) console.warn(`[dudu] The project folder is not available: ${problem}`);
  const disposers = assistant.paths.map((path) => registerRoute(ctx, {
    path: `/api/dudu/${path}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => assistant.handle(path, request),
  }));
  return async () => { delete assignment.assistant; delete assignment.projectFolder; for (const dispose of disposers) dispose(); await assistant.close(); };
}

// --- startDispatch: from what comes in to who does it (docs/assistant.md 1.2, 3.1, 3.3) ---
// Each collector is run at its own pace (every 30 minutes unless it says otherwise), one at a time, the first one a minute after start: what it
// brought is kept in the inbox, and that is all: no issue is made from it and no model is asked (owner, 2026-11-05). The owner reads the records in
// the Collector widget. The inbox is cleared of old text once a day. The settings page reads `dispatch/state`.
const PRUNE_EVERY_MS = 24 * 60 * 60_000;

async function startDispatch(ctx, folder, assignment) {
  if (!assignment.issues) throw new Error('there are no issues');
  const dsh = createDshSessions(ctx, { historyFacts: assignment.historyFacts });
  const llm = createDshLlm(ctx);
  const notifications = createCollectorNotifications();
  assignment.collectorNotifications = notifications;
  assignment.llm = llm;
  assignment.collectSource = createSourceCollector(ctx, {
    folder: () => assignment.assistant?.folder, file: join(folder, 'assistant', 'collect-sessions.json'),
    permission: () => assignment.assistant?.settings?.value('conversation')?.permission, // the permission the owner chose for 嘟嘟's sessions
    connections: () => assignment.assistant?.connections ?? null, // the MCP servers 嘟嘟 has connected itself
  });
  // The collection sessions made before each collector kept one are folded away once, a little after start (they are in DSH's list, not in the file).
  const tidying = setTimeout(() => { assignment.collectSource?.tidy?.().catch(() => {}); }, 30_000);
  tidying.unref?.();
  const dispatch = createDispatch({
    issues: assignment.issues,
    collectors: () => assignment.assistant?.collectors ?? null,
    collect: assignment.collectSource,
    onCollected: notifications.publish,
    acknowledge: createCollectorAcknowledgements(),
    rules: () => assignment.assistant?.memory?.rules?.() ?? { rules: {} },
    llm,
    agents: async () => {
      let catalog = null;
      try { catalog = await dsh.models(); } catch { /* a DSH without the service has no agent to give an issue to */ }
      return Object.entries(AGENTS).map(([id, name]) => ({ id, name, enabled: Boolean(catalog && modelFor(id, catalog)) }));
    },
    file: join(folder, 'assistant', 'intake.json'),
  });
  assignment.dispatch = dispatch;

  const handOut = createHandOut({ dispatch, assignment });
  assignment.handOut = handOut;
  const tidy = createIssueTidy({
    issues: assignment.issues, llm, rules: () => assignment.assistant?.memory?.rules(),
    file: join(folder, 'assistant', 'issue-tidy.json'),
  });
  assignment.issueTidy = tidy;

  // One collection: the collector is read and what it brought is kept in the inbox, and nothing else (owner, 2026-11-05: 嘟嘟 makes no issue from it). The scheduler queues them.
  const collectOne = (id) => dispatch.intake({ only: [id] });
  const scheduler = createScheduler({
    list: () => assignment.assistant?.collectors?.dudu.list().collectors?.map((entry) => ({ id: entry.id, frequency: entry.frequency })) ?? [],
    lastStarted: (id) => assignment.issues.inbox.lastStarted(id),
    run: collectOne,
  });
  assignment.runCollector = (id) => scheduler.runNow(id);
  assignment.fillRecord = (id) => dispatch.complete({ id });
  scheduler.start();
  const prune = () => { try { assignment.issues.inbox.prune(); } catch (error) { console.warn(`[dudu] The inbox could not be cleared: ${error.message}`); } };
  const pruning = setInterval(prune, PRUNE_EVERY_MS);
  pruning.unref?.();
  const prunedFirst = setTimeout(prune, 5 * 60_000);
  prunedFirst.unref?.();

  const disposeRoute = registerRoute(ctx, {
    path: '/api/dudu/dispatch/state', methods: ['POST'], requestBody: 'buffered',
    fetch: async () => Response.json(await dispatch.state(), { headers: { 'cache-control': 'no-store' } }),
  });
  const disposeNotifications = registerRoute(ctx, {
    path: '/api/dudu/inbox/notifications', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const stopped = await request.json().catch(() => null); // `{ epoch, after }`: where the page's last stream stopped
      return notifications.follow(request.signal, stopped && typeof stopped === 'object' && !Array.isArray(stopped) ? stopped : {});
    },
  });
  const disposeTidy = registerRoute(ctx, {
    path: '/api/dudu/issues/tidy', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Expected a JSON object.' }, { status: 400 });
      if (body.trigger === 'dashboard') {
        // Older clients still send this notification. Viewing issues must not run a model or edit them.
        return Response.json({ outcome: 'success' }, { headers: { 'cache-control': 'no-store' } });
      }
      return Response.json(await tidy.run({ token: body.token }), { headers: { 'cache-control': 'no-store' } });
    },
  });
  return async () => {
    clearTimeout(tidying);
    clearTimeout(prunedFirst);
    clearInterval(pruning);
    notifications.close();
    delete assignment.collectorNotifications;
    disposeNotifications();
    disposeRoute();
    disposeTidy();
    const closing = tidy.close();
    const draining = scheduler.dispose(); // no new collection starts; the one running ends when dispatch is told to stop
    await dispatch.dispose();
    await draining;
    await closing;
    await dsh.close();
    delete assignment.llm;
    delete assignment.runCollector;
    delete assignment.fillRecord;
    delete assignment.collectSource;
    delete assignment.dispatch;
    delete assignment.issueTidy;
    delete assignment.handOut;
  };
}

// The dashboard layout (docs/assistant.md 4.1): one small JSON file next to the issues. The engine of the grid library is the one the
// page runs, so a layout the plugin changes is pushed around the same way.
async function startDashboard(ctx, folder, assignment) {
  const dashboard = createDashboard({ file: join(folder, 'assistant', 'dashboard.json'), engine: GridStackEngine });
  assignment.dashboard = dashboard;
  const api = createDashboardApi({ dashboard });
  const disposers = DASHBOARD_ACTIONS.map((action) => registerRoute(ctx, {
    path: `/api/dudu/dashboard/${action}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => api.handle(action, request),
  }));
  return async () => { for (const dispose of disposers) dispose(); delete assignment.dashboard; };
}

async function startTasks(ctx, folder, assignment) {
  if (!assignment.assistant) throw new Error('The assistant services are unavailable.');
  const dsh = createDshSessions(ctx, { historyFacts: assignment.historyFacts });
  const host = createTaskHost({ dsh, registry: ctx.workspaceRegistry, controller: ctx.sessionController, agents: ctx.agents,
    access: () => assignment.assistant.settings.value('conversation').permission,
    // The model the session itself recorded (what its owner or a task selected), as the sessions list reads it; a resumed agent's options are only DSH's default.
    modelOf: (agent) => {
      let saved;
      try { saved = ctx.sessionProjections?.stateOf(agent.session, 'modelSelection'); } catch { saved = undefined; }
      return saved?.next ?? saved?.pending ?? saved?.lastUsed ?? agent?.options;
    },
    // The tasks 嘟嘟 does itself run in conversations of their own that the assistant's conversation makes (it starts after the tasks, so it is asked for when a task needs it).
    dudu: () => assignment.conversation?.taskRuns ?? null });
  let tasks;
  try { tasks = createTasks({ file: join(folder, 'assistant', 'tasks.db'), ...host }); }
  catch (error) { await dsh.close(); throw error; }
  assignment.tasks = tasks;
  const disposers = TASK_ACTIONS.map((action) => registerRoute(ctx, {
    path: `/api/dudu/tasks/${action}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => tasks.handle(action, request),
  }));
  tasks.start();
  return async () => { for (const dispose of disposers) dispose(); await tasks.close(); await dsh.close(); delete assignment.tasks; };
}

async function startConversation(ctx, folder, assignment) {
  if (!assignment.assistant || !assignment.issues || !assignment.dashboard || !ctx.tools) throw new Error('The assistant services are unavailable.');
  // What the quick buttons of the chat send (docs/assistant.md): the lists are read from the same services the pages use, when a card is made (they start after the conversation).
  const dsh = createDshSessions(ctx, { historyFacts: assignment.historyFacts });
  // The latest message of each issue's session, fed by what DSH says of every live session (home/latest.mjs), and the lines of the group chat (home/group.mjs): the owner's @ messages to issues
  // and their answers come into the thread as commands of the conversation.
  // 嘟嘟's own session is kept too: what the owner types to it is what its row in the chat list shows (the `@` lines are the group's: `group.ownLine()`).
  const latest = createLatest({
    file: join(folder, 'assistant', 'latest.json'),
    relevant: (sessionId) => Boolean(assignment.issues?.findBySession(`dsh:${sessionId}`)) || sessionId === assignment.conversation?.state()?.sessionId,
    read: (sessionId, signal) => dsh.latestMessages(sessionId, signal),
  });
  const stopLatest = ctx.on?.('session/event', (session, event) => {
    // What the owner just said is what the chat list shows for that conversation (home/chat-home.mjs, `ownMessages`): the phones read the board again now, not at their next poll.
    if (latest.observe(session?.id, event) === 'me') assignment.boardChanged?.();
  }, { global: true });
  const group = createGroup({
    file: join(folder, 'assistant', 'group.json'),
    sessions: () => assignment.sessions,
    say: (kind, record) => assignment.conversation.say(kind, record),
  });
  // The owner's `@` line to an issue is what they said last to 嘟嘟 (its row in the chat list): the phones read the board again when one comes into the thread.
  const stopGroupBoard = group.onChange((commandId) => { if (group.get(commandId)?.kind === 'at') assignment.boardChanged?.(); });
  const cards = createCards({
    file: join(folder, 'assistant', 'cards.json'),
    issues: () => assignment.issuesApi, inbox: () => assignment.inboxApi, tasks: () => assignment.tasks, quota: () => assignment.quota, latest,
    activity: (id) => assignment.sessionActivity(id), warm: (ids) => assignment.warmSessionActivity(ids),
  });
  const conversation = createConversation({
    ctx, assistant: assignment.assistant, issues: assignment.issues, assignment, dashboard: assignment.dashboard,
    nativeSessions: assignment.nativeSessions, dsh, cards, group,
    widgets: existsSync(widgetKit.guide) ? widgetKit : null,
    tidyIssues: (options) => assignment.issueTidy.run(options),
    file: join(folder, 'assistant', 'conversation.json'),
  });
  assignment.conversation = conversation;
  assignment.cards = cards;
  assignment.group = group;
  assignment.latest = latest;
  const localWidgets = createLocalWidgets({ folder: () => assignment.assistant?.folder });
  const conversationOperations = {
    widgets: () => localWidgets.list(),
    'widget-file': ({ name }) => {
      const text = localWidgets.read(name);
      return text === null ? { outcome: 'error', code: 'not_found' } : { outcome: 'success', name, text };
    },
    'widgets-report': ({ widgets } = {}) => localWidgets.report(widgets),
    conversation: async () => ({ outcome: 'success', ...await conversation.ensure() }),
    'conversation-settings': (body) => conversation.preferences(body),
    'conversation-model': (body) => conversation.selectModel(body),
    compact: () => conversation.requestCompact(),
    card: ({ kind, since } = {}) => conversation.card(kind, since),
    cards: ({ ids } = {}) => conversation.cardsOf(ids),
    hide: ({ seqs } = {}) => group.hide(seqs),
    hidden: () => ({ outcome: 'success', seqs: [...group.hidden()] }),
    reminders: () => ({ outcome: 'success', reminders: reminders(assignment.issues, Date.now()) }),
  };
  assignment.conversationOperations = conversationOperations;
  // The scoped assistant can use the same finite session controls as the native interface.
  // This peer is local to the plugin, never a phone RPC pass-through.
  let sessionPeer;
  let sessionOperations;
  assignment.sessionOperations = {
    models: () => ctx.sessionController.modelCatalog(),
    execute: (action, args) => {
      if (!sessionOperations) {
        sessionPeer = ctx.connection.createPeer({ principal: { kind: 'owner' } });
        sessionOperations = createAssistantSessionOperations({
          rpc: createTypertRpcAdapter({ gateway: ctx.typertGateway, peer: sessionPeer }),
          dsh, controller: ctx.sessionController, questionBridge: assignment.questionBridge,
        });
      }
      return sessionOperations.execute(action, args);
    },
  };
  // Restore our scoped owner before a remembered DSH conversation tab can promote the persisted session.
  // Keep the route available when no model is configured, so choosing one later can retry initialization.
  await step('conversation.ensure', () => conversation.ensure()).catch((error) => console.warn(`[dudu] The assistant conversation could not be opened: ${error.message}`));
  const route = (path, answer) => registerRoute(ctx, {
    path: `/api/dudu/assistant/${path}`, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = await request.json().catch(() => ({}));
        return Response.json(await answer(body), { headers: { 'cache-control': 'no-store' } });
      } catch (error) { return Response.json({ outcome: 'error', message: error.message }, { headers: { 'cache-control': 'no-store' } }); }
    },
  });
  // The widgets 嘟嘟 writes (assistant/widgets/local.mjs): the interface lists the folder, loads each file as a module and reports how that went.
  const disposers = [
    route('widgets', conversationOperations.widgets),
    route('widgets-report', conversationOperations['widgets-report']),
    registerRoute(ctx, {
      path: '/api/dudu/assistant/widget-file', methods: ['GET'], requestBody: 'buffered',
      fetch: async (request) => {
        const text = localWidgets.read(new URL(request.url).searchParams.get('name'));
        return text === null
          ? new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
          : new Response(text, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
      },
    }),
    route('conversation', conversationOperations.conversation),
    route('conversation-settings', conversationOperations['conversation-settings']),
    route('conversation-model', conversationOperations['conversation-model']),
    // The conversation's Compact.
    route('compact', () => conversation.compact()),
    // The quick buttons of the chat: a card is made as a command of the conversation (no model); the page asks for the contents of the ones it has read by their command ids.
    route('card', conversationOperations.card),
    route('cards', conversationOperations.cards),
    // Hiding a line of the thread (the owner's 删除: only what the interface shows; the session's log and what 嘟嘟 was told stay) and which lines are hidden.
    route('hide', conversationOperations.hide),
    route('hidden', conversationOperations.hidden),
    // What dudu says by itself beside the pet; read from the issues, with no model.
    route('reminders', conversationOperations.reminders),
  ];
  return async () => {
    for (const dispose of disposers) dispose();
    stopLatest?.();
    stopGroupBoard();
    group.dispose();
    latest.dispose();
    await conversation.close();
    await sessionPeer?.dispose();
    await dsh.close();
    delete assignment.conversation; delete assignment.cards; delete assignment.group; delete assignment.latest;
    delete assignment.conversationOperations; delete assignment.sessionOperations;
  };
}

function startChatHome(ctx, folder, assignment) {
  const home = createChatHome({
    file: join(folder, 'assistant', 'chat-home.db'),
    issues: (action, body) => step(`home.issues.${action}`, () => assignment.issuesApi?.execute(action, body)),
    assistant: () => assignment.conversation?.state(),
    activity: (id) => assignment.sessionActivity?.(id),
    warm: (ids) => step('home.warm', () => assignment.warmSessionActivity?.(ids)),
    markUnread: (id, source) => assignment.markSessionUnread(id, source),
    acknowledge: (id, position, source) => assignment.acknowledgeRead(id, position, source),
    changed: () => assignment.boardChanged?.(),
    // What the owner said last (home/latest.mjs, home/group.mjs): a list asked with `ownMessages` shows it when it is newer than the agent's last answer.
    mine: (sessionId) => assignment.latest?.mine(sessionId) ?? null,
    assistantLine: () => assignment.group?.ownLine() ?? null,
  });
  const handle = createChatHomeApi(home, (action, body) => assignment.issuesApi.execute(action, body));
  const disposers = [];
  try {
    for (const action of ['list', 'pin']) disposers.push(registerRoute(ctx, {
      path: `/api/dudu/home/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => handle(action, request),
    }));
  } catch (error) {
    for (const dispose of disposers) dispose();
    home.close();
    throw error;
  }
  assignment.chatHome = home;
  return () => {
    for (const dispose of disposers) dispose();
    delete assignment.chatHome;
    home.close();
  };
}

async function startPhoneControl(ctx, config, dshHome, folder, assignment) {
  const diagnostics = createNativeDiagnostics(folder);
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } });
  // DSH 0.2.2's HMR marks its transaction with this AsyncLocalStorage. A server
  // started during a reload inherits that mark in future HTTP requests. Leave
  // only that scope at ingress, as HMR itself does for its config watcher.
  // Older hosts without this transaction scope need no detachment.
  const reloadTransaction = ctx.get('hmr')?.executing;
  let control;
  const questionBridge = assignment.questionBridge;
  const chatHome = assignment.chatHome;
  const disposers = [];
  try {
    const rpc = createTypertRpcAdapter({ gateway: ctx.typertGateway, peer, diagnostics });
    const dshFrontend = createDshMobileFrontend({ clientModules: ctx.clientModules });
    // 嘟嘟's own pages (its settings, in the web view) are served by the plugin itself; every other page is DSH's.
    const duduPages = createDuduPages({ assets: (name) => readFile(new URL(`./dist/phone/${name}`, import.meta.url)), call: runRoute });
    const frontend = {
      document: (descriptor) => (descriptor.kind === 'dudu' ? duduPages.document(descriptor) : dshFrontend.document(descriptor)),
      resource: dshFrontend.resource?.bind(dshFrontend),
    };
    const pageRpc = createTypertPageRpc({
      gateway: ctx.typertGateway,
      peer,
      events: ctx,
      connection: ctx.connection,
      webServer: ctx.webServer,
    });
    const pages = createNativePages({ frontend, pageRpc });
    control = await step('phone.control', () => createDuduControl({
      folder,
      rpc,
      pages,
      runRequest: reloadTransaction ? (operation) => reloadTransaction.exit(operation) : undefined,
      conversationReads: createConversationReads({
        connection: ctx.connection, peer, workspaceChanges: () => ctx.get('workspaceChanges'),
        attachments: () => ctx.attachments,
      }),
      fileTransfers: createNativeFileTransfers({
        uploads: () => ctx.get('fileUploads'), attachments: () => ctx.attachments,
        agent: (id) => ctx.agents.get(id),
      }),
      questionBridge,
      sessionActivity: (id) => assignment.sessionActivity?.(id),
      acknowledgeRead: (id, position, source) => assignment.acknowledgeRead?.(id, position, source),
      sessionSearch: assignment.searchSessions,
      assistantConversation: () => assignment.conversation?.ensure(),
      assistant: {
        state: () => assignment.conversation?.state(),
        selectModel: (selection) => assignment.conversation?.selectModel(selection),
        issues: (action, body) => assignment.issuesApi?.execute(action, body) ?? { outcome: 'error', code: 'unavailable' },
        tasks: (action, body) => assignment.tasks?.execute(action, body) ?? { outcome: 'error', code: 'unavailable' },
        // The quota panel of the phone: what the quota service has kept; `ask` is the sheet being opened.
        quota: (options) => assignment.quota?.request(options),
        // The quick buttons of the chat on the phone: the same card, and the contents of one the thread names.
        card: (kind, since) => assignment.conversation?.card(kind, since) ?? { outcome: 'error', code: 'unavailable' },
        cardOf: (commandId) => assignment.cards?.get(commandId) ?? null,
        todos: (cursor) => assignment.cards?.todos(cursor),
        // The lines of the group chat in the thread, and the ones the owner hid.
        groupOf: (commandId) => assignment.group?.get(commandId) ?? null,
        onGroupChange: (listener) => assignment.group?.onChange(listener),
        hidden: () => assignment.group?.hidden() ?? null,
        hide: (seqs) => assignment.group?.hide(seqs) ?? { outcome: 'error', code: 'unavailable' },
      },
      duduPages,
      foreground: { backgroundOnly: (id) => assignment.providers?.backgroundOnly?.(id) === true, onChange: (listener) => assignment.providers?.onForeground?.(listener) },
      collectorNotifications: assignment.collectorNotifications,
      collectorNotificationsEnabled: () => assignment.assistant?.collectors?.dudu.list().collectors?.some((entry) => entry.notify === true) === true,
      // The phone's board and Collector: the same commands the desktop interface sends, run for the owner (the issues are opened later than this: asked for when used).
      board: {
        home: chatHome,
        getNeedsYouColor: () => assignment.assistant?.settings?.value('needsYouColor'),
        issues: (action, body) => assignment.issuesApi?.execute(action, body) ?? { outcome: 'error', code: 'unavailable' },
        inbox: (action, body) => assignment.inboxApi?.execute(action, body) ?? { outcome: 'error', code: 'unavailable' },
        // The pictures of a new issue made on the phone: kept in DSH's store and given to the issue like the ones pasted into the desktop's dialog.
        pictures: {
          available: () => assignment.issueAttachments?.available() === true,
          save: (images) => assignment.issueAttachments?.saveImages(images) ?? Promise.reject(new Error('Issue attachments are unavailable.')),
          stage: (id, refs) => assignment.issueAttachments.stage(id, refs),
        },
        projects: {
          list: () => assignment.projects?.list() ?? { outcome: 'error', code: 'unavailable' },
          create: (body) => assignment.projects?.create(body) ?? { outcome: 'error', code: 'unavailable' },
        },
      },
      legacyKeyPath: join(dshHome, 'harness-mobile', 'pairing-key'),
      port: config.port ?? 3170,
      host: config.host ?? '0.0.0.0',
    }));
    assignment.boardChanged = control.boardChanged;
    assignment.announcePhones = control.announce;
    assignment.boardSessionChanged = control.boardSessionChanged;
    assignment.phoneOperations = async (action, body) => {
      if (action === 'state') return control.state();
      if (action === 'save') return control.save(body);
      if (action === 'revoke') { await control.devices.revoke(body.id); return control.state(); }
      return { outcome: 'error', code: 'unknown_action' };
    };
    for (const action of ['state', 'save', 'generate', 'revoke', 'nav']) {
      disposers.push(registerRoute(ctx, {
        path: `/api/dudu/${action}`, methods: ['POST'], requestBody: 'buffered',
        fetch: (request) => control.handle(action, request),
      }));
    }
  } catch (error) {
    for (const dispose of disposers) dispose();
    try { await control?.close(); }
    finally { await peer.dispose(); await diagnostics.flush(); }
    throw error;
  }
  try { await writeDesktopRuntime(folder, runtimeIdentity, control.state().port); }
  catch { console.warn('[dudu] Could not save the local runtime receipt.'); }
  console.info(`[dudu] Ready on port ${control.state().port}. Open the 嘟嘟 page, then Settings > 手机控制 to pair.`);
  return async () => {
    delete assignment.phoneOperations;
    delete assignment.boardChanged;
    delete assignment.announcePhones;
    delete assignment.boardSessionChanged;
    for (const dispose of disposers) dispose();
    try { await control.close(); }
    finally { await peer.dispose(); await diagnostics.flush(); }
  };
}

export async function apply(ctx, config = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const folder = join(dshHome, 'dudu');
  ctx.effect(() => installSessionHistoryCoalescing(ctx.sessionQuery, ctx.sessions));

  // How this start goes, in `<folder>/diagnostics/startup.jsonl`: each phase's time, each route when it becomes available, what stops take.
  const startup = createStartupLog(folder, { identity: runtimeIdentity });
  startupLog = startup;
  startup.begin();
  const timed = async (name, run) => {
    const started = startup.now();
    try {
      const value = await run();
      startup.phase(name, started);
      return value;
    } catch (error) {
      startup.phase(name, started, error);
      throw error;
    }
  };
  const stops = [];
  const stopNames = [];
  const keep = (name, stop) => { stops.push(stop); stopNames.push(name); };
  const assignment = {};
  // The same requests serve Desktop, native phones and explicit Dudu session
  // operations. Their lifetime does not depend on phone control being available.
  assignment.questionBridge = createNativeQuestions({
    events: ctx,
    attachWait: (request, signal) => {
      const questions = ctx.get('userQuestions');
      if (typeof questions?.attachWait !== 'function') throw new Error('User question wait service is unavailable.');
      return questions.attachWait(request.agent, request.wait.callId, signal);
    },
  });
  keep('questions', () => assignment.questionBridge.close());
  let providerServices;
  try {
    providerServices = await timed('providers', () => startProviders(ctx, folder, assignment));
    keep('providers', () => providerServices.stop());
    console.info('[dudu] Providers are ready.');
  } catch (error) {
    console.warn(`[dudu] Providers are unavailable: ${error.message}`);
  }

  try {
    keep('issues', await timed('issues', () => startIssues(ctx, folder, assignment)));
    console.info('[dudu] Issues are ready.');
  } catch (error) {
    // A database written by a newer version stays untouched (SCHEMA_TOO_NEW); the rest of the plugin keeps working.
    console.warn(`[dudu] Issues are unavailable: ${error.message}`);
  }

  try {
    keep('assignment', await timed('assignment', () => startAssignment(ctx, folder, assignment)));
    console.info('[dudu] Sessions for issues are ready.');
  } catch (error) {
    console.warn(`[dudu] Sessions for issues are unavailable: ${error.message}`);
  }

  try {
    keep('dashboard', await timed('dashboard', () => startDashboard(ctx, folder, assignment)));
    console.info('[dudu] The dashboard is ready.');
  } catch (error) {
    console.warn(`[dudu] The dashboard is unavailable: ${error.message}`);
  }

  try {
    keep('assistant', await timed('assistant', () => startAssistant(ctx, dshHome, folder, assignment)));
    console.info('[dudu] The project folder, memory and connectors are ready.');
  } catch (error) {
    console.warn(`[dudu] The project folder, memory and connectors are unavailable: ${error.message}`);
  }

  try {
    keep('dispatch', await timed('dispatch', () => startDispatch(ctx, folder, assignment)));
    console.info('[dudu] Reading what comes in is ready.');
  } catch (error) {
    console.warn(`[dudu] Reading what comes in is unavailable: ${error.message}`);
  }

  try {
    keep('tasks', await timed('tasks', () => startTasks(ctx, folder, assignment)));
    console.info('[dudu] Scheduled tasks are ready.');
  } catch (error) {
    console.warn(`[dudu] Scheduled tasks are unavailable: ${error.message}`);
  }

  try {
    keep('conversation', await timed('conversation', () => startConversation(ctx, folder, assignment)));
    console.info('[dudu] The assistant conversation is ready.');
  } catch (error) {
    console.warn(`[dudu] The assistant conversation is unavailable: ${error.message}`);
  }

  try { keep('home', await timed('home', async () => startChatHome(ctx, folder, assignment))); }
  catch (error) { console.error(`[dudu] Conversation home did not start: ${error.message}`); }

  if (typeof ctx.connection.createPeer === 'function') {
    try { keep('phone', await timed('phone', () => startPhoneControl(ctx, config, dshHome, folder, assignment))); }
    catch (error) {
      // The providers keep working; DSH shows why the phone control did not start.
      if (stops.length === 0) throw error;
      console.error(`[dudu] Phone control did not start: ${error.message}`);
    }
  } else {
    console.warn('[dudu] Phone control needs a newer DSH (this one has no connection.createPeer); providers still work.');
  }

  startup.ready();

  ctx.effect(() => async () => {
    const releasing = providerServices?.stopHarnesses();
    // Observe a rejection immediately even if another service takes time to stop.
    releasing?.catch(() => {});
    try {
      for (let index = stops.length - 1; index >= 0; index--) {
        const started = startup.now();
        try { await stops[index](); } finally { startup.stop(stopNames[index], started); }
      }
    } finally {
      await releasing;
      startup.mark('stopped');
      await startup.flush();
      if (startupLog === startup) startupLog = null;
    }
  });
}
