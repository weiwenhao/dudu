import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDsbotControl } from './dist/dsbot-control.mjs';
import { createTypertRpcAdapter } from './dist/native-bridge.mjs';
import { createTypertPageRpc } from './dist/native-page-rpc.mjs';
import { createDshMobileFrontend } from './dist/dsh-mobile-frontend.mjs';
import { createNativePages } from './dist/native-pages.mjs';
import { createConversationReads } from './dist/native-conversation-reads.mjs';
import { createNativeQuestions } from './dist/native-questions.mjs';
import { desktopPackageIdentity, writeDesktopRuntime } from './dist/desktop-runtime.mjs';
import { createNativeDiagnostics } from './dist/native-diagnostics.mjs';
import { migrateLegacyState } from './dist/legacy-state.mjs';
import { createProviders } from './dist/providers/index.mjs';
import { createLinkStore, createNativeSessions } from './dist/providers/native/index.mjs';
import { createOverview } from './dist/providers/native/overview.mjs';
import { createAccountBalance } from './dist/providers/native/balance.mjs';
import { claudeProvider } from './dist/providers/drivers/claude.mjs';
import { codexProvider } from './dist/providers/drivers/codex.mjs';
import { permissionOf } from './dist/providers/permission.mjs';
import { createIssues } from './dist/assistant/issues/index.mjs';
import { createIssuesApi, ISSUE_ACTIONS } from './dist/assistant/issues/api.mjs';
import { AGENTS, createAgentSessions, modelFor } from './dist/assistant/home/agent-sessions.mjs';
import { approvalText, createDshSessions, questionText } from './dist/assistant/home/dsh-sessions.mjs';
import { createAssignment } from './dist/assistant/home/assign.mjs';
import { firstMessage } from './dist/assistant/home/first-message.mjs';
import { createDispatch } from './dist/assistant/dispatch/index.mjs';
import { createDshLlm } from './dist/assistant/dispatch/dsh-llm.mjs';
import { createHandOut } from './dist/assistant/dispatch/hand-out.mjs';
import { sessionOptions } from './dist/assistant/dispatch/rules.mjs';
import { createDashboard } from './dist/assistant/dashboard/index.mjs';
import { createDashboardApi, DASHBOARD_ACTIONS } from './dist/assistant/dashboard/api.mjs';
import { GridStackEngine } from './dist/assistant/dashboard/engine.mjs';
import { openAssistant } from './dist/assistant/assistant.mjs';
import { createConversation } from './dist/assistant/home/conversation.mjs';
import { reminders } from './dist/assistant/home/reminders.mjs';
import { createIssueTidy, createIssueTidyScheduler } from './dist/assistant/issues/tidy.mjs';
import { claudeReader, codexReader, createSessions } from './dist/assistant/sessions/index.mjs';
import { createSessionFolding, createSessionInbox } from './dist/assistant/home/inbox.mjs';
import { createSessionCatalog } from './dist/assistant/home/session-catalog.mjs';
import { createSessionTakeover } from './dist/assistant/home/session-takeover.mjs';
import { createProjects } from './dist/assistant/home/projects.mjs';
import { sessionInfo } from './dist/providers/native/session-info.mjs';
import { createSourceCollector } from './dist/assistant/home/source-collector.mjs';
import { createSessionCleanup } from './dist/assistant/home/session-cleanup.mjs';

// Capture the loaded package once, so an old runtime cannot report newly installed files as its own.
const runtimeIdentity = await desktopPackageIdentity(dirname(fileURLToPath(import.meta.url)));

export const name = 'dudu';
// Services every DSH has are required. The access mode a session is in is only read to scope what a harness may do,
// so a DSH without it still runs the plugin; so does one without what the sessions of issues use (docs/dsh-session-control.md).
export const inject = {
  connection: true, typertGateway: true, clientModules: true, webServer: true, llm: true, agents: true,
  sessionProjections: false, sessionPersistence: false, workspaceRegistry: false,
  sessionController: false, permissionPresets: false, userQuestions: false, agentDefaultModel: false,
  tools: false,
  // DSH's own commands: the conversation's Compact is its /compact.
  commands: false,
  // DSH's attachment store: the pictures of a session loaded from Claude Code or Codex are kept there, so DSH's chat shows them.
  attachments: false,
  // DSH's DeepSeek account, for the balance the Quota widget shows (its service reads the wallet; no credential reaches this plugin).
  deepseekAccount: false,
};

// The two halves do not depend on each other. The phone control needs a DSH new enough to hand out peers (the
// Desktop's); the providers work wherever DSH can route models, such as `dsh web`.
async function startProviders(ctx, folder, assignment) {
  const links = await createLinkStore(folder);
  const providers = await createProviders({
    folder,
    providers: [claudeProvider, codexProvider],
    host: {
      llm: ctx.llm,
      agents: ctx.agents,
      attachments: () => ctx.attachments,
      on: (event, handler) => ctx.on(event, handler),
      permissionOf: (agent) => permissionOf(ctx.sessionProjections, agent),
      providerOf: (agent) => {
        let selection;
        try { selection = ctx.sessionProjections?.stateOf(agent.session, 'modelSelection'); }
        catch { /* older hosts may not have this projection */ }
        return selection?.pending?.provider ?? selection?.lastUsed?.provider
          ?? agent.session.requestHeader?.()?.config?.provider ?? agent.options?.provider;
      },
      eventsOf: async (sessionId, signal) => (await ctx.get('sessionController')?.inspect(sessionId, signal))?.events,
      onLink: links.record,
    },
  });
  // The sessions the harnesses already have, to browse and load into DSH. DSH's own stores are looked up when used.
  const native = createNativeSessions({
    sources: providers.sources, links, persistence: () => ctx.sessionPersistence, workspaces: () => ctx.workspaceRegistry,
    attachments: () => ctx.attachments,
    controller: () => ctx.sessionController, agents: () => ctx.agents,
    rebind: (previousId, sessionId) => assignment.rebindSession?.(previousId, sessionId),
  });
  // The issues store opens in startIssues, so it is asked for when a list is read, not now.
  const catalog = createSessionCatalog({ native, dsh: createDshSessions(ctx, { hidden: links.removed }), issues: { findBySession: (key) => assignment.issues?.findBySession(key) } });
  assignment.sessionCatalog = catalog;
  const projects = createProjects({ registry: () => ctx.workspaceRegistry });
  assignment.nativeSessions = native;
  assignment.sources = providers.sources;
  assignment.links = links;
  const overview = createOverview({
    sources: providers.sources, links, titleOf: native.titleOf,
    balance: createAccountBalance({ account: () => { try { return ctx.deepseekAccount; } catch { return undefined; } } }), // reading a service this DSH lacks throws
  });
  const disposers = [
    ...['state', 'refresh', 'save'].map((action) => ctx.connection.fetch.register({
      path: `/api/dudu/providers/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => providers.handle(action, request),
    })),
    ...['list', 'load', 'read', 'sync'].map((action) => ctx.connection.fetch.register({
      path: `/api/dudu/sessions/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: async (request) => {
        if (action === 'load' || action === 'sync') return native.handle(action, request);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ outcome: 'error', code: 'invalid_session' }, { status: 400 });
        try { return Response.json(await catalog[action](body), { headers: { 'cache-control': 'no-store' } }); }
        catch { return Response.json({ error: 'Sessions are unavailable.' }, { status: 503 }); }
      },
    })),
    ...['list', 'create'].map((action) => ctx.connection.fetch.register({
      path: `/api/dudu/projects/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => projects.handle(action, request),
    })),
    ...['usage', 'running'].map((action) => ctx.connection.fetch.register({
      path: `/api/dudu/overview/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => overview.handle(action, request),
    })),
  ];
  return async () => {
    delete assignment.nativeSessions;
    delete assignment.sessionCatalog;
    delete assignment.sources;
    delete assignment.links;
    for (const dispose of disposers) dispose();
    await providers.close();
    await links.flush();
  };
}

// The issues of 嘟嘟 (docs/assistant.md): one SQLite file in the plugin's state folder, served to the desktop interface.
// `assignment` is the issues' hooks into the sessions they are given to; startAssignment fills it in once the store is open.
async function startIssues(ctx, folder, assignment = {}) {
  const issues = createIssues({ file: join(folder, 'assistant', 'issues.db'), sessionState: (key) => assignment.sessionState?.(key) ?? assignment.snapshots?.stateOf(key) ?? null });
  const api = createIssuesApi({
    issues,
    onAssign: (issue) => assignment.onAssign?.(issue),
    onReply: async (issue, text) => assignment.onReply?.(await assignment.loadIssueSession?.(issue) ?? issue, text),
    onResume: async (issue) => assignment.onResume?.(await assignment.loadIssueSession?.(issue) ?? issue),
    onChange: (issue) => ['done', 'canceled'].includes(issue.status) ? assignment.closeFor?.(issue) : assignment.onAssign?.(issue),
    onForget: (issue) => assignment.closeFor?.(issue),
    onDelete: (issue) => assignment.deleteSessions?.(issue) ?? Promise.reject(new Error('Session cleanup is unavailable.')),
    onSession: (issue) => sessionInfo({ key: issue.session, links: assignment.links, controller: ctx.sessionController }),
    onMention: async (issue, message, entry) => {
      if (message.target === 'dudu') {
        if (!assignment.conversation) return { outcome: 'error' };
        return assignment.conversation.issueMessage(issue, message.body, entry);
      }
      const current = issues.get(issue.id, { logLimit: 1 }).issue;
      if (!current?.project?.path) return { outcome: 'needs_clarification' };
      if (current.agent !== message.target || !current.session) return { outcome: 'needs_clarification' };
      return assignment.forward?.(await assignment.loadIssueSession?.(current) ?? current, message.body) ?? { outcome: 'error' };
    },
  });
  assignment.issues = issues;
  const disposers = ISSUE_ACTIONS.map((action) => ctx.connection.fetch.register({
    path: `/api/dudu/issues/${action}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => api.handle(action, request),
  }));
  return async () => {
    for (const dispose of disposers) dispose();
    issues.close();
  };
}

// --- startAssignment: the sessions the issues are given to (docs/assistant.md 3.3 and 3.4, docs/dsh-session-control.md) ---
// An issue that is given an agent gets a DSH session in its project folder, follows it, and hands what the owner answers to it. Both DSH
// runtimes serve it from the services every plugin can inject: no phone peer is needed.
async function startAssignment(ctx, folder, assignment) {
  if (!assignment.issues) throw new Error('there are no issues');
  const dsh = createDshSessions(ctx, { hidden: (id) => assignment.links?.removed(id) });
  // DSH lists the models of the harnesses the first time it is asked, which takes a moment; the first issue given to an agent need not wait.
  void dsh.models().catch(() => {});
  const agentSessions = createAgentSessions({ dsh });
  const hooks = createAssignment({
    issues: assignment.issues,
    agentSessions,
    snapshotOf: (key) => assignment.snapshots?.snapshotOf(key),
    read: (key) => {
      const [provider, ...parts] = key.split(':');
      return ['claude', 'codex'].includes(provider)
        ? assignment.nativeSessions.read({ provider, id: parts.join(':') })
        : dsh.read(key);
    },
    llm: (...args) => {
      if (!assignment.llm) throw new Error('The assistant model is unavailable.');
      return assignment.llm(...args);
    },
    // What ASSIGN.md allows for this kind of issue; read-only when it says nothing (3.3).
    accessOf: (issue) => sessionOptions(assignment.assistant?.memory?.rules?.()?.rules?.['ASSIGN.md'], issue, { home: homedir() }),
  });
  Object.assign(assignment, { sessions: agentSessions, sessionState: hooks.sessionState, onAssign: hooks.onAssign, onReply: hooks.onReply, forward: hooks.forward, onResume: hooks.onResume, start: hooks.start, setAccess: hooks.setAccess, closeFor: hooks.closeFor, restore: hooks.restore });
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
    stateOf: (key) => key.startsWith('dsh:') && dsh.isRunning(key.slice(4)) ? 'running' : agentSessions.stateOf(key) ?? assignment.snapshots?.stateOf(key),
    snapshotOf: (key) => agentSessions.snapshotOf(key) ?? assignment.snapshots?.snapshotOf(key),
    read: (key) => {
      const [provider, ...parts] = key.split(':');
      return ['claude', 'codex'].includes(provider) ? assignment.nativeSessions.read({ provider, id: parts.join(':') }) : dsh.read(key);
    },
    llm: (...args) => assignment.llm(...args),
    // A conversation only the harness has goes into DSH when it is taken over: it is then in DSH's list of sessions like any other.
    load: (issue) => assignment.loadSessionOf(issue),
  });
  assignment.takeOverSession = takeover.takeOver;
  const disposeTakeover = ctx.connection.fetch.register({
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
  });
  assignment.snapshots = snapshots;
  const observe = (snapshot) => inbox.accept(snapshot).catch((error) => console.warn(`[dudu] A waiting session could not become an issue: ${error.message}`));
  const stopSnapshots = snapshots.onChange(({ to, snapshot }) => {
    if (to != null && snapshot) void observe(snapshot);
    assignment.sessionChanged?.();
  });
  const startup = hooks.restore()
    .then(() => snapshots.poll())
    .then(() => hooks.restore())
    .then(() => Promise.all(snapshots.snapshots({ state: 'waiting_owner', limit: 500 }).snapshots.map(observe)))
    .catch((error) => console.warn(`[dudu] The sessions of the open issues could not be followed again: ${error.message}`));
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
      agent: ['claude', 'codex'].includes(agent.options.provider) ? agent.options.provider : 'deepseek',
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
  const disposeSnapshots = ctx.connection.fetch.register({
    path: '/api/dudu/sessions/snapshots', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let body;
      try { body = await request.json(); } catch { return Response.json({ outcome: 'error', message: 'Invalid JSON.' }, { status: 400 }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ outcome: 'error', message: 'Expected an object.' }, { status: 400 });
      return Response.json(snapshots.snapshots(body), { headers: { 'cache-control': 'no-store' } });
    },
  });
  return async () => {
    await folding.close();
    for (const stop of questionStops) stop();
    stopSnapshots();
    disposeSnapshots();
    disposeTakeover();
    delete assignment.takeOverSession;
    await takeover.close();
    await startup;
    await snapshots.dispose();
    await inbox.close();
    delete assignment.snapshots;
    delete assignment.loadIssueSession;
    for (const hook of ['sessions', 'sessionState', 'onAssign', 'onReply', 'forward', 'onResume', 'start', 'closeFor', 'restore', 'deleteSessions', 'rebindSession']) delete assignment[hook];
    await hooks.dispose();
    agentSessions.dispose();
  };
}

// 嘟嘟's own state (docs/assistant.md 2, 3.5, 3.6): the project folder with its Markdown files, the settings, the memory and the
// connectors, and the calls the settings page makes on them. A project folder that cannot be opened turns off the memory and the
// connectors only (the settings page says why); the rest of the plugin runs.
async function startAssistant(ctx, dshHome, folder, assignment = {}) {
  // The memory asks the model of startDispatch once it is there (the same one DSH has as its default).
  const llm = (messages, options) => (assignment.llm ? assignment.llm(messages, options) : Promise.reject(new Error('There is no model yet.')));
  const assistant = openAssistant({
    dshHome, stateFolder: join(folder, 'assistant'), llm,
    dsh: {
      tools: () => assignment.conversation?.dshConnectors.tools() ?? [],
      call: (...args) => assignment.conversation?.dshConnectors.call(...args),
    },
    state: () => ({ conversation: assignment.conversation?.state() ?? null, lastIssueTidy: assignment.issueTidy?.state() ?? null, counts: assignment.issues?.counts() ?? null }),
    beforeFolderChange: () => assignment.conversation?.busy ? { outcome: 'needs_clarification', message: 'Wait until the conversation and memory tidy finish.' } : null,
  });
  assignment.assistant = assistant; // startAssignment and startDispatch read the rules and the connectors through it: the folder can move
  assignment.projectFolder = () => assistant.folder;
  for (const problem of assistant.problems) console.warn(`[dudu] The project folder is not available: ${problem}`);
  const disposers = assistant.paths.map((path) => ctx.connection.fetch.register({
    path: `/api/dudu/${path}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => assistant.handle(path, request),
  }));
  return async () => { delete assignment.assistant; delete assignment.projectFolder; for (const dispose of disposers) dispose(); await assistant.close(); };
}

// --- startDispatch: from what comes in to who does it (docs/assistant.md 1.2, 3.1 "收进来", 3.3) ---
// Every half hour the enabled connectors are read (only read operations), what is new becomes issues, and each new issue is handed to an
// agent by ASSIGN.md, or left in Todo with the question "交给谁处理？". The first round is a minute after start. A round that has nothing
// to read costs no model call. The Inputs widget reads `dispatch/state`.
const INTAKE_FIRST_MS = 60_000;
const INTAKE_EVERY_MS = 30 * 60_000;

async function startDispatch(ctx, folder, assignment) {
  if (!assignment.issues) throw new Error('there are no issues');
  const dsh = createDshSessions(ctx);
  const llm = createDshLlm(ctx);
  assignment.llm = llm;
  assignment.collectSource = createSourceCollector(ctx, { folder: () => assignment.assistant?.folder });
  const dispatch = createDispatch({
    issues: assignment.issues,
    connectors: () => assignment.assistant?.connectors ?? null,
    collect: assignment.collectSource,
    rules: () => assignment.assistant?.memory?.rules?.() ?? { rules: {} },
    llm,
    agents: async () => {
      let catalog = null;
      try { catalog = await dsh.models(); } catch { /* a DSH without the service has no agent to give an issue to */ }
      return Object.entries(AGENTS).map(([id, name]) => ({ id, name, enabled: Boolean(catalog && modelFor(id, catalog)) }));
    },
    file: join(folder, 'assistant', 'intake.json'),
  });

  const handOut = createHandOut({ dispatch, issues: assignment.issues, assignment, firstMessage });
  assignment.handOut = handOut;
  const tidy = createIssueTidy({
    issues: assignment.issues, llm, rules: () => assignment.assistant?.memory?.rules(),
    file: join(folder, 'assistant', 'issue-tidy.json'),
  });
  assignment.issueTidy = tidy;
  const scheduler = createIssueTidyScheduler({ tidy, busy: () => Boolean(assignment.conversation?.busy) });
  assignment.sessionChanged = scheduler.changed;
  const changed = (sessionId) => { if (sessionId && !sessionId.startsWith('dudu-assistant-')) scheduler.changed(); };
  const eventStops = [
    ctx.on('api-session/status', (sessionId) => changed(sessionId)),
    ctx.on('session/event', (session, event) => { if (event.type === 'turn/end') changed(session?.id); }),
  ];

  let round = null;
  const intake = () => {
    round ??= (async () => {
      const run = await dispatch.intake();
      for (const made of run.created ?? []) await handOut(made.id).catch((error) => console.warn(`[dudu] ${made.ref ?? made.id} could not be handed out: ${error.message}`));
      scheduler.intake();
    })().catch((error) => console.warn(`[dudu] Reading what came in failed: ${error.message}`)).finally(() => { round = null; });
    return round;
  };
  const first = setTimeout(() => { void intake(); }, INTAKE_FIRST_MS);
  const every = setInterval(() => { void intake(); }, INTAKE_EVERY_MS);
  first.unref?.();
  every.unref?.();

  const disposeRoute = ctx.connection.fetch.register({
    path: '/api/dudu/dispatch/state', methods: ['POST'], requestBody: 'buffered',
    fetch: async () => Response.json(await dispatch.state(), { headers: { 'cache-control': 'no-store' } }),
  });
  const disposeTidy = ['tidy', 'tidy-undo'].map((action) => ctx.connection.fetch.register({
    path: `/api/dudu/issues/${action}`, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Expected a JSON object.' }, { status: 400 });
      if (action === 'tidy' && body.trigger === 'dashboard') {
        scheduler.opened();
        return Response.json({ outcome: 'success' }, { headers: { 'cache-control': 'no-store' } });
      }
      return Response.json(action === 'tidy-undo' ? tidy.undo() : await tidy.run({ token: body.token }), { headers: { 'cache-control': 'no-store' } });
    },
  }));
  return async () => {
    clearTimeout(first);
    clearInterval(every);
    for (const stop of eventStops) stop();
    disposeRoute();
    for (const dispose of disposeTidy) dispose();
    const closing = scheduler.close();
    delete assignment.sessionChanged;
    await dispatch.dispose();
    await round;
    await closing;
    delete assignment.llm;
    delete assignment.collectSource;
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
  const disposers = DASHBOARD_ACTIONS.map((action) => ctx.connection.fetch.register({
    path: `/api/dudu/dashboard/${action}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => api.handle(action, request),
  }));
  return async () => { for (const dispose of disposers) dispose(); delete assignment.dashboard; };
}

async function startConversation(ctx, folder, assignment) {
  if (!assignment.assistant || !assignment.issues || !assignment.dashboard || !ctx.tools) throw new Error('The assistant services are unavailable.');
  const conversation = createConversation({
    ctx, assistant: assignment.assistant, issues: assignment.issues, assignment, dashboard: assignment.dashboard,
    nativeSessions: assignment.nativeSessions, dsh: createDshSessions(ctx),
    tidyIssues: (options) => assignment.issueTidy.run(options),
    file: join(folder, 'assistant', 'conversation.json'),
  });
  assignment.conversation = conversation;
  // Restore our scoped owner before a remembered DSH conversation tab can promote the persisted session.
  // Keep the route available when no model is configured, so choosing one later can retry initialization.
  await conversation.ensure().catch((error) => console.warn(`[dudu] The assistant conversation could not be opened: ${error.message}`));
  const route = (path, answer) => ctx.connection.fetch.register({
    path: `/api/dudu/assistant/${path}`, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = await request.json().catch(() => ({}));
        return Response.json(await answer(body), { headers: { 'cache-control': 'no-store' } });
      } catch (error) { return Response.json({ outcome: 'error', message: error.message }, { headers: { 'cache-control': 'no-store' } }); }
    },
  });
  const disposers = [
    route('conversation', async () => ({ outcome: 'success', ...await conversation.ensure() })),
    // Where the owner is, sent with each message when they chose to attach it; and the conversation's Compact.
    route('context', ({ where } = {}) => conversation.setContext(where)),
    route('compact', () => conversation.compact()),
    // What dudu says by itself beside the pet; read from the issues, with no model.
    route('reminders', () => ({ outcome: 'success', reminders: reminders(assignment.issues, Date.now()) })),
  ];
  return async () => { for (const dispose of disposers) dispose(); await conversation.close(); delete assignment.conversation; };
}

async function startPhoneControl(ctx, config, dshHome, folder) {
  const diagnostics = createNativeDiagnostics(folder);
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } });
  let control;
  let questionBridge;
  const disposers = [];
  try {
    const rpc = createTypertRpcAdapter({ gateway: ctx.typertGateway, peer, diagnostics });
    const frontend = createDshMobileFrontend({ clientModules: ctx.clientModules });
    const pageRpc = createTypertPageRpc({
      gateway: ctx.typertGateway,
      peer,
      events: ctx,
      connection: ctx.connection,
      webServer: ctx.webServer,
    });
    const pages = createNativePages({ frontend, pageRpc });
    questionBridge = createNativeQuestions({
      events: ctx,
      attachWait: (request, signal) => {
        const questions = ctx.get('userQuestions');
        if (typeof questions?.attachWait !== 'function') throw new Error('User question wait service is unavailable.');
        return questions.attachWait(request.agent, request.wait.callId, signal);
      },
    });
    control = await createDsbotControl({
      folder,
      rpc,
      pages,
      conversationReads: createConversationReads({ connection: ctx.connection, peer }),
      questionBridge,
      legacyKeyPath: join(dshHome, 'harness-mobile', 'pairing-key'),
      port: config.port ?? 3170,
      host: config.host ?? '0.0.0.0',
    });
    for (const action of ['state', 'save', 'generate', 'revoke', 'nav']) {
      disposers.push(ctx.connection.fetch.register({
        path: `/api/dudu/${action}`, methods: ['POST'], requestBody: 'buffered',
        fetch: (request) => control.handle(action, request),
      }));
    }
  } catch (error) {
    questionBridge?.close();
    for (const dispose of disposers) dispose();
    try { await control?.close(); }
    finally { await peer.dispose(); await diagnostics.flush(); }
    throw error;
  }
  try { await writeDesktopRuntime(folder, runtimeIdentity, control.state().port); }
  catch { console.warn('[dudu] Could not save the local runtime receipt.'); }
  console.info(`[dudu] Ready on port ${control.state().port}. Open Settings > 手机控制 to pair.`);
  return async () => {
    questionBridge.close();
    for (const dispose of disposers) dispose();
    try { await control.close(); }
    finally { await peer.dispose(); await diagnostics.flush(); }
  };
}

export async function apply(ctx, config = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const folder = join(dshHome, 'dudu');
  // Paired phones were stored by the plugin's former name; carry them over before anything reads the folder.
  await migrateLegacyState({ dshHome });

  const stops = [];
  const assignment = {};
  try {
    stops.push(await startProviders(ctx, folder, assignment));
    console.info('[dudu] Providers are ready.');
  } catch (error) {
    console.warn(`[dudu] Providers are unavailable: ${error.message}`);
  }

  try {
    stops.push(await startIssues(ctx, folder, assignment));
    console.info('[dudu] Issues are ready.');
  } catch (error) {
    // A database written by a newer version stays untouched (SCHEMA_TOO_NEW); the rest of the plugin keeps working.
    console.warn(`[dudu] Issues are unavailable: ${error.message}`);
  }

  try {
    stops.push(await startAssignment(ctx, folder, assignment));
    console.info('[dudu] Sessions for issues are ready.');
  } catch (error) {
    console.warn(`[dudu] Sessions for issues are unavailable: ${error.message}`);
  }

  try {
    stops.push(await startDashboard(ctx, folder, assignment));
    console.info('[dudu] The dashboard is ready.');
  } catch (error) {
    console.warn(`[dudu] The dashboard is unavailable: ${error.message}`);
  }

  try {
    stops.push(await startAssistant(ctx, dshHome, folder, assignment));
    console.info('[dudu] The project folder, memory and connectors are ready.');
  } catch (error) {
    console.warn(`[dudu] The project folder, memory and connectors are unavailable: ${error.message}`);
  }

  try {
    stops.push(await startDispatch(ctx, folder, assignment));
    console.info('[dudu] Reading what comes in is ready.');
  } catch (error) {
    console.warn(`[dudu] Reading what comes in is unavailable: ${error.message}`);
  }

  try {
    stops.push(await startConversation(ctx, folder, assignment));
    console.info('[dudu] The assistant conversation is ready.');
  } catch (error) {
    console.warn(`[dudu] The assistant conversation is unavailable: ${error.message}`);
  }

  if (typeof ctx.connection.createPeer === 'function') {
    try { stops.push(await startPhoneControl(ctx, config, dshHome, folder)); }
    catch (error) {
      // The providers keep working; DSH shows why the phone control did not start.
      if (stops.length === 0) throw error;
      console.error(`[dudu] Phone control did not start: ${error.message}`);
    }
  } else {
    console.warn('[dudu] Phone control needs a newer DSH (this one has no connection.createPeer); providers still work.');
  }

  ctx.effect(() => async () => { for (const stop of stops.reverse()) await stop(); });
}
