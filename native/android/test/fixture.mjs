// Isolated Android E2E service: real native HTTP, board commands and SQLite stores;
// only the computer's agent/session provider is a fixture. Never loads DSH or live pairing.
import { createNativeServer } from '../../../host/native-server.mjs';
import { createNativeBoard } from '../../../host/native-board.mjs';
import { createIssues } from '../../../host/assistant/issues/index.mjs';
import { createIssuesApi } from '../../../host/assistant/issues/api.mjs';
import { createChatHome } from '../../../host/assistant/home/chat-home.mjs';
import { createTasks } from '../../../host/assistant/tasks/index.mjs';
import { createInboxApi } from '../../../host/assistant/inbox/api.mjs';
import { normalizeRecords } from '../../../host/assistant/inbox/records.mjs';
import { createNativeSettings } from '../../../host/native-settings.mjs';
import { createWebPageHttp } from '../../../host/web-page-http.mjs';
import { randomUUID, createHash, createHmac } from 'node:crypto';

export const FIXTURE_TOKEN = 'f'.repeat(43);
const COMPUTER = { id: 'android-e2e', name: 'Fixture Mac' };
const PROJECT = { name: 'dudu', path: '/fixture/dudu' };
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export async function startAndroidFixture({ port = 0, reviewResponses = {} } = {}) {
  let issues, api, home, board, tasks, inbox, settings;
  let requests = [];
  let sendAttempts = [];
  let cleanedIssues = [];
  let messages = new Map();
  let activity = new Map();
  let watches = new Map();
  let failNextSend = false;
  let loseNextSendReply = false;
  let failHome = false;
  let rejectCreate = false;
  let rich = false, conflict = false, rejectSettings = false;
  let richQuestions = true, richQueue = true;
  let rules, configurations;
  let pageReads = [], outsideReads = 0;
  async function reset() {
    await tasks?.close();
    home?.close(); issues?.close();
    requests = []; sendAttempts = []; cleanedIssues = []; messages = new Map(); watches = new Map(); activity = new Map();
    failNextSend = false; loseNextSendReply = false; failHome = false; rejectCreate = false;
    rich = false; conflict = false; rejectSettings = false; richQuestions = true; richQueue = true;
    rules = { 'ASSIGN.md': 'Keep project assignment explicit.', 'TRIAGE.md': 'Existing rule.' };
    configurations = new Map();
    pageReads = []; outsideReads = 0;
    issues = createIssues({ file: ':memory:', sessionState: key => activity.get(key.slice(4))?.sessionState ?? 'idle' });
    api = createIssuesApi({ issues,
      onAssign(issue) { issues.assign(issue.id, { agent: issue.agent, session: `dsh:fixture-${issue.id}` }); },
      // Session cleanup belongs to the fixture's computer, just like session execution.
      onDelete(issue) { cleanedIssues.push(issue.id); },
    });
    const execute = (action, body) => api.execute(action, body);
    inbox = createInboxApi({ issues,
      collectors: () => ({ resolve: () => ({ outcome: 'success', collectors: [{ id: 'fixture-mail', name: 'Fixture mail' }] }) }),
      forward: async () => ({ outcome: 'success' }),
    });
    issues.inbox.ingest('fixture-mail', normalizeRecords([{ id: 'mail-1', title: 'Fixture collected record',
      text: 'Collected source content.', from: 'Fixture source', url: 'https://example.test/mail-1' }]).records);
    tasks = createTasks({ file: ':memory:',
      deliver: async (_task, _run, checkpoint) => { await checkpoint('fixture-task'); return {}; },
      options: async () => ({ timezone: 'Asia/Shanghai', projects: [{ ...PROJECT, id: 'workspace-dudu' }],
        providers: [{ id: 'dudu', name: 'Dudu', available: true, models: [] },
          { id: 'codex', name: 'Codex', available: true, models: ['gpt-5'] }],
        sessions: [{ id: 'fixture-2', title: 'ios 开发', workspaceId: 'workspace-dudu' }] }),
    });
    settings = createNativeSettings({ call: async (action, body) => {
      let answer;
      if (action === 'rules/get') answer = { outcome: 'success', rules, projectFolder: PROJECT.path };
      else if (action === 'rules/update') {
        if (rejectSettings) { rejectSettings = false; answer = { outcome: 'error' }; }
        else if (rules[body.name] !== body.previous) answer = { outcome: 'error' };
        else { rules[body.name] = body.text; answer = { outcome: 'success' }; }
      } else answer = { outcome: 'error' };
      return { status: 200, body: answer };
    } });
    home = createChatHome({
      file: ':memory:', issues: execute, assistant: () => ({ sessionId: 'fixture-assistant' }),
      activity: id => activity.get(id), warm: async () => {},
      markUnread: async id => activity.set(id, { ...activity.get(id), unread: true }),
      acknowledge: async id => activity.set(id, { ...activity.get(id), unread: false }),
    });
    board = createNativeBoard({ issues: execute, inbox: (action, body) => inbox.execute(action, body), home, fail,
      projects: { list: async () => ({ outcome: 'success', projects: [PROJECT] }) } });
    const rows = [
      ['收集器设计', 'claude', 'in_progress', '我没动代码。说「做」我就开始。'],
      ['ios 开发', 'codex', 'in_progress', '最终外观仍以你的设计为准。'],
      ['告警处理', 'claude', 'in_review', '告警处理进展。'],
      ['UI 设计', 'claude', 'in_progress', '配对页和新建项目那一页。'],
      ['desktop 插件', 'codex', 'in_progress', '相关检查已通过。'],
      ['jobs4 Phalcon 版本检查', 'claude', 'in_progress', '等待新的指令。'],
      ['未分配事项', null, 'todo', ''],
      ['规划调研', 'codex', 'backlog', '调研记录。'],
      ['已完成事项', 'claude', 'done', '已经完成。'],
    ];
    rows.forEach(([title, agent, status, preview], index) => {
      const sessionId = agent ? `fixture-${index + 1}` : null;
      issues.add({ title, ...(agent ? { agent, project: PROJECT, session: `dsh:${sessionId}` } : {}), status });
      if (sessionId) {
        activity.set(sessionId, { sessionState: index === 0 ? 'processing' : 'idle', unread: index === 2,
          attention: { preview, messageAt: Date.now() - index * 60000, seq: index + 1 } });
        messages.set(sessionId, [{ id: `m-${index}`, role: 'assistant', text: preview }]);
      }
    });
    activity.set('fixture-assistant', { sessionState: 'idle', unread: false,
      attention: { preview: '要我现在就开始吗？', messageAt: Date.now() - 7 * 60000, seq: 1 } });
    messages.set('fixture-assistant', [{ id: 'assistant-1', role: 'assistant', text: '要我现在就开始吗？' }]);
    void home.pin({ target: 'issue:5', pinned: true }, fail);
  }
  await reset();
  const pairingStore = { id: COMPUTER.id,
    authenticate: async token => token === FIXTURE_TOKEN ? 'android-fixture-device' : null,
    proof: () => 'fixture-proof',
    routeProof: (deviceId, nonce) => deviceId === 'android-fixture-device' ? {
      computerId: COMPUTER.id, deviceId,
      deviceProof: createHmac('sha256', createHash('sha256').update(FIXTURE_TOKEN).digest())
        .update(`dudu-route:v1:${nonce}:${COMPUTER.id}:${deviceId}`).digest('base64url'),
    } : undefined,
  };
  const pageHttp = createWebPageHttp({ pairingStore, pages: {
    openHttp: async () => ({ id: randomUUID() }),
    documentHttp: async () => {
      pageReads.push('document');
      return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body><h1>Fixture embedded page</h1><p id="result">Loading</p><script src="fixture.js"></script></body></html>`;
    },
    resourceHttp: async () => { pageReads.push('resource'); return { mimeType: 'application/javascript', data: Buffer.from(`
      Promise.all([fetch('rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Dudu-Page':'1'},
        body:JSON.stringify({method:'web.invoke',params:{method:'fixture'}})}).then(r=>r.json()),
        fetch('/fixture/outside').then(r=>r.status)]).then(([r,status])=>{
          window.fixtureResult={text:r.text,status,cookie:document.cookie};
          document.getElementById('result').innerText=r.text+' '+status;
        });`) }; },
    dispatch: async method => { pageReads.push(method); return { text: 'Scoped page ready' }; },
    closeConnection: async () => {},
  } });
  function detail(id, watchId) {
    const extra = rich && id === 'fixture-2' ? {
      modelId: configurations.get(id)?.modelId ?? 'codex:gpt-5', reasoningEffort: 'medium',
      transcript: { entries: [
        { id: 'rich-10', type: 'assistant', seq: 10, turn: 1, text: 'Rich **Markdown** reply.', calls: [{ id: 'tool-1', name: 'Bash' }] },
        { id: 'rich-20', type: 'assistant', seq: 20, turn: 1, text: 'Ready for your answer.' }],
        beforeSeq: 10, throughSeq: 20, hasMore: true,
        tools: { 'tool-1': { seq: 10, resultSeq: 15, status: 'done' } }, turns: [],
      },
      queuedMessages: richQueue ? [{ id: 'queue-1', requestId: 'queued-input', text: 'Queued fixture input', editable: true }] : [],
      questions: richQuestions ? [{ id: 'question-1', questions: [{ id: 'choice', question: 'Fixture decision',
        options: [{ label: 'Proceed', description: 'Use the existing design.' }] }] }] : [],
    } : {};
    return { session: { id, state: 'idle', agent: 'codex' }, watchId, messages: messages.get(id) ?? [],
      queuedMessages: [], readPosition: { seq: 10 }, questions: [], approvals: [], ...extra };
  }
  const server = await createNativeServer({
    host: '127.0.0.1', port, computer: COMPUTER,
    pairingStore,
    async dispatch(method, params, connection) {
      requests.push({ method, params: structuredClone(params) });
      if (Object.hasOwn(reviewResponses, method)) {
        const response = reviewResponses[method];
        return typeof response === 'function' ? response(params) : structuredClone(response);
      }
      if (method === 'board.list' && failHome) fail('UPSTREAM_UNAVAILABLE');
      if (method === 'issue.create' && rejectCreate) { rejectCreate = false; fail('UPSTREAM_UNAVAILABLE'); }
      if (method === 'catalog.get') return {
        providers: [{ id: 'claude' }, { id: 'codex', modelIds: ['codex:gpt-5', 'codex:gpt-5-mini'] }, { id: 'deepseek' }],
        models: ['gpt-5', 'gpt-5-mini'].map(id => ({ id: `codex:${id}`, name: id, sourceName: 'Codex',
          efforts: [{ id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] })), presets: [], permissions: [],
      };
      if (method === 'navigation.get') return { sidebar: [], settings: [
        { id: 'dudu.rules', title: '规则', open: { native: 'dudu-settings', target: 'rules' } },
      ] };
      if (method === 'plugins.list') return [];
      if (method.startsWith('tasks.')) {
        if (method === 'tasks.update' && conflict) {
          conflict = false;
          await tasks.execute('pause', { id: params.id, revision: params.revision });
        }
        return tasks.execute(method.slice(6), params);
      }
      if (method.startsWith('settings.')) return settings.dispatch(method, params);
      if (method === 'session.list') return [...messages.keys()].map(id => ({ id, title: id,
        agent: 'codex', workspaceId: 'workspace-dudu', updatedAt: 1000 }));
      if (method === 'workspace.list') return [{ id: 'workspace-dudu', name: 'dudu', path: PROJECT.path }];
      if (method === 'session.search') return { items: [] };
      if (method === 'session.team') return { members: [{ id: 'fixture-child', name: 'Fixture researcher', state: 'completed', canOpen: true,
        session: { id: 'fixture-child', subagent: { parentSessionId: params.id, mode: 'one-shot' } } }] };
      if (method === 'assistant.todos') return { outcome: 'success', rows: (await board.dispatch('board.list', { tab: 'all', layout: 'chat' })).conversations
        .filter(row => row.issue).map(row => ({ ...row.issue, sessionId: row.sessionId })), nextCursor: null };
      if (method === 'assistant.reply.read') return detail(params.session.slice(4), 'read-only');
      if (method === 'session.page') return { transcript: { entries: [{ id: 'rich-1', type: 'user', seq: 1,
        text: 'Earlier fixture history.' }], turns: [], tools: {}, beforeSeq: 1, throughSeq: 20, hasMore: false } };
      if (method === 'session.tool') {
        if (params.callId !== 'tool-1' || params.seq !== 10) fail('BAD_REQUEST');
        return { input: { text: 'pwd', nextOffset: null }, output: { text: '/fixture/dudu', nextOffset: null }, images: [] };
      }
      if (method === 'question.answer') {
        if (params.callId !== 'question-1' || params.answers?.[0]?.selected?.[0] !== 'Proceed') fail('BAD_REQUEST');
        richQuestions = false;
        const watch = watches.get(connection.id);
        if (watch) connection.sendEvent('session.snapshot', detail(watch.id, watch.watchId));
        return true;
      }
      if (method === 'session.queue.update' || method === 'session.configure') {
        if (method === 'session.configure') configurations.set(params.id, params);
        else { if (params.itemId !== 'queue-1') fail('BAD_REQUEST'); richQueue = false; }
        const watch = watches.get(connection.id);
        if (watch) connection.sendEvent('session.snapshot', detail(watch.id, watch.watchId));
        return {};
      }
      if (method === 'quota.get') return { outcome: 'success', providers: [
        { id: 'claude', agent: 'claude', name: 'Claude', windows: [{ label: '5h', used: .39 }] },
        { id: 'codex', agent: 'codex', name: 'Codex', windows: [{ label: '5h', used: .27 }] },
      ] };
      if (method === 'session.command') return { kind: 'error' };
      if (method === 'assistant.open') return { id: 'fixture-assistant' };
      if (method === 'session.watch') {
        watches.set(connection.id, { id: params.id, watchId: params.watchId, connection });
        return detail(params.id, params.watchId);
      }
      if (method === 'session.unwatch') { watches.delete(connection.id); return {}; }
      if (method === 'session.read') {
        const watch = watches.get(connection.id);
        if (watch?.id !== params.id || watch.watchId !== params.watchId || params.position?.seq !== 10) fail('BAD_REQUEST');
        const old = activity.get(params.id);
        if (old) activity.set(params.id, { ...old, unread: false });
        return {};
      }
      if (method === 'session.send') {
        sendAttempts.push(structuredClone(params));
        if (failNextSend) { failNextSend = false; fail('UPSTREAM_UNAVAILABLE'); }
        const previous = messages.get(params.id) ?? [];
        if (!previous.some(message => message.requestId === params.requestId)) previous.push({
          id: params.requestId, requestId: params.requestId, role: 'user', text: params.text,
        });
        messages.set(params.id, previous);
        const watch = watches.get(connection.id);
        if (watch) connection.sendEvent('session.snapshot', detail(params.id, watch.watchId));
        if (loseNextSendReply) { loseNextSendReply = false; fail('UPSTREAM_UNAVAILABLE'); }
        return { requestId: params.requestId };
      }
      return board.dispatch(method, params);
    },
    async httpHandler(request, response) {
      if (await pageHttp.handle(request, response)) return true;
      if (request.url === '/fixture/outside') { outsideReads++; response.end('outside'); return true; }
      if (request.url === '/fixture/reset' && request.method === 'POST') {
        await reset(); response.end('{}'); return true;
      }
      if (request.url === '/fixture/state') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ requests, sendAttempts, cleanedIssues,
          messages: [...messages], issues: issues.list({ tab: 'all' }).items,
          tasks: (await tasks.execute('list')).tasks, rules, pageReads, outsideReads }));
        return true;
      }
      const flag = new URL(request.url, 'http://fixture.invalid').searchParams.get('flag');
      if (request.url.startsWith('/fixture/configure?') && request.method === 'POST') {
        if (flag === 'fail-send') failNextSend = true;
        if (flag === 'lose-send-reply') loseNextSendReply = true;
        if (flag === 'fail-home') failHome = true;
        if (flag === 'recover-home') failHome = false;
        if (flag === 'fail-create') rejectCreate = true;
        if (flag === 'rich') rich = true;
        if (flag === 'task-conflict') conflict = true;
        if (flag === 'fail-settings') rejectSettings = true;
        response.end('{}'); return true;
      }
      return false;
    },
  });
  return { ...server, async close() { await pageHttp.close(); await server.close(); await tasks.close(); home.close(); issues.close(); } };
}
