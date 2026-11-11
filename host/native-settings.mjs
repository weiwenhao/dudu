// 嘟嘟's own settings for the phone, drawn by the app itself (owner, 2026-11-07: "嘟嘟自己的设置不用 webview 用原生实现"). The plugin describes a page, the app draws it with its own controls, and what the
// person changes goes back here: the actions are the desktop interface's (`assistant/settings`, `issues/status-update`, `collectors/add`…), the same list the web pages were allowed
// (phone-pages.mjs), asked through `call`. The words are the desktop interface's (ui/strings.js, `settings`), copied, not new.
//
//   settings.page { section, target? }                          -> { outcome: 'success', page }
//   settings.act  { section, target?, name, args?, value?, values? } -> { outcome, message?, page?, back?, toast? }
//
// A page is { title, sections: [{ header?, footer?, rows }], save?: { title, act }, preview?: { key, act }, poll?: seconds }. A row is { id, kind: 'text' | 'switch' | 'choice' | 'field' | 'action' | 'environment', title, subtitle?, detail?, mono?, icon?, secret?,
// tone?, on?, options?: [{ id, title, subtitle?, color? }], selected?, key?, value?, placeholder?, multiline?, button?: { title, act, role?, confirm? }, to?: { section, target }, swipe?: [{ title,
// act, role?, confirm? }], act? }. An act is { name, args? }: what the app sends back as `name` and `args`, with the row's new `value` (a switch, a choice) or, for a page that is a form, every field's
// `values`. A `confirm` is { title, message?, button }: the app asks before it acts. After an act the app reads the page again, or goes back when the answer says `back`; a `toast` is said under the
// toolbar, with the Undo it carries.
import { DUDU_PAGE_SECTIONS } from './phone-pages.mjs';

export const NATIVE_SETTINGS_METHODS = Object.freeze(['settings.page', 'settings.act']);

const FAILED = '更改没能保存';
const LOAD_FAILED = '这一页没能加载';
const MAX_TEXT = 20_000;
const CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];
const CATEGORY_NAMES = { backlog: '待规划', unstarted: '未开始', started: '已开始', completed: '已完成', canceled: '已取消' };
const STATUS_NAMES = { backlog: '待规划', todo: '待办', in_progress: '处理中', in_review: '待审核', done: '已完成', canceled: '已取消' };
const STATUS_ERRORS = {
  unknown_status: '这个状态已不存在。', invalid_status: '请检查状态名称和颜色。', duplicate_status: '已有同名状态。', last_status: '每个分类至少保留一个状态。', status_in_use: '请选择现有事项要移入的状态。',
};
const COLORS = ['#95a2b3', '#61666b', '#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#26b5ce', '#5e6ad2', '#8f6bde'];
const PRESETS = ['5m', '15m', '30m', '1h', '6h', '0 9 * * *', '0 9 * * 1-5', '0 9-18 * * 1-5'];
const PRESET_WORDS = {
  '5m': '每 5 分钟', '15m': '每 15 分钟', '30m': '每 30 分钟', '1h': '每小时', '6h': '每 6 小时',
  '0 9 * * *': '每天 09:00', '0 9 * * 1-5': '周一至周五 09:00', '0 9-18 * * 1-5': '周一至周五 9 至 18 点每小时',
};
const RULE_TITLES = { 'TRIAGE.md': '影响、工作量和截止', 'ASSIGN.md': '任务分配' };
const KIND_WORDS = { prompt: 'Prompt', mcp: 'MCP' };
const GROUP_ORDER = ['here', 'work', 'projects', 'dev', 'web'];
const GROUP_NAMES = { here: '这台电脑', work: '办公', projects: '项目', dev: '开发', web: '网页' };
const VERB_WORDS = { authorize: '授权', cancel: '取消', retry: '重试' };

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, max) : '');
const ok = (answer) => ['success', 'no_op'].includes(answer?.outcome);
const firstLine = (value) => String(value ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
const joined = (parts) => parts.filter(Boolean).join(' · ');
const baseName = (command) => String(command ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';
const when = (at) => (Number.isFinite(at) ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at)) : '');

function describeFrequency(value) {
  const one = String(value ?? '').trim();
  if (!one) return '每 30 分钟';
  if (Object.hasOwn(PRESET_WORDS, one)) return PRESET_WORDS[one];
  const every = /^(\d{1,4})\s*([mhd])$/i.exec(one);
  if (!every) return one;
  const n = Number(every[1]);
  return { m: `每 ${n} 分钟`, h: n === 1 ? '每小时' : `每 ${n} 小时`, d: n === 1 ? '每天' : `每 ${n} 天` }[every[2].toLowerCase()];
}

function aboutLine(about) {
  if (!about) return '';
  const tools = typeof about.tools === 'number' ? `${about.tools} 个工具` : '';
  if (about.kind === 'remote') return joined([about.host, tools]);
  if (about.kind === 'local') return joined([about.command && `本机 · ${baseName(about.command)}`, tools]);
  if (about.kind === 'cli') return about.command ? `命令行 · ${about.command}` : '';
  if (about.kind === 'sentence') return firstLine(about.text);
  return '';
}

/** What a connector's state says in a row: the words by it, the tone, the one thing to do about it. */
function describeState(state, line) {
  if (!state) return { line };
  switch (state.status) {
    case 'needs-auth': return { line, tone: 'warn', words: '需要授权', verb: 'authorize' };
    case 'waiting': return { line: state.code || line, tone: 'muted', words: '等待浏览器…', verb: 'cancel' };
    case 'needs-login': return { line: state.login ? `在终端运行 ${state.login}，再点重试` : line, tone: 'warn', words: '需要登录', verb: 'retry' };
    case 'missing': return { line: state.command ? `没找到 ${state.command}${state.install ? `：${state.install}` : ''}` : line, tone: 'bad', words: '没装', verb: 'retry' };
    case 'error': return { line, tone: 'bad', words: state.message === 'timeout' ? '连接超时' : text(state.message, 120), verb: 'retry' };
    default: return { line };
  }
}

const row = (fields) => ({ kind: 'text', ...fields });
const link = (title, to, fields = {}) => row({ title, to, ...fields });
const statusName = (status) => status.name || STATUS_NAMES[status.id] || status.id;

export function createNativeSettings({ call }) {
  /** The plugin's own answer to an action of the desktop interface; one that did not answer is a failure the page says. */
  async function ask(action, body = {}) {
    const answer = await call(action, body);
    if (!answer || answer.status !== 200 || !isRecord(answer.body)) throw new Error(action);
    return answer.body;
  }

  // --- 通用 -------------------------------------------------------------------------------------------------------------------------------
  const conversationOf = (data) => {
    const groups = data.groups ?? [];
    const models = groups.flatMap((group) => {
      const name = group.name || group.id;
      const shown = groups.filter((other) => (other.name || other.id) === name).length > 1 ? `${name} · ${group.id}` : name;
      return (group.models ?? []).map((model) => ({ ...model, provider: group.id, group: shown }));
    });
    const current = models.find((model) => model.provider === data.model?.provider && model.id === data.model?.model);
    return { models, current };
  };

  async function general() {
    const [state, conversation, settings] = await Promise.all([ask('assistant/state'), ask('assistant/conversation-settings'), ask('assistant/settings')]);
    const { models, current } = conversationOf(conversation);
    const efforts = current?.reasoning?.efforts ?? [];
    const sections = [
      { header: '项目文件夹', rows: [row({
        id: 'folder', title: state.projectFolder ?? '项目文件夹没能打开。', mono: Boolean(state.projectFolder), ...(state.isDefault ? { detail: '默认' } : {}), ...(state.projectFolder ? {} : { tone: 'bad' }),
      })] },
      { header: '嘟嘟 · 默认', rows: [
        { id: 'model', kind: 'choice', title: '模型', selected: current ? JSON.stringify([current.provider, current.id]) : '', act: { name: 'conversation', args: { field: 'model' } },
          options: models.map((model) => ({ id: JSON.stringify([model.provider, model.id]), title: model.name, ...((conversation.groups ?? []).length > 1 ? { subtitle: model.group } : {}) })) },
        ...(efforts.length ? [{ id: 'effort', kind: 'choice', title: '推理等级', selected: conversation.model?.reasoningEffort ?? current.reasoning.defaultEffort ?? '', act: { name: 'conversation', args: { field: 'effort' } },
          options: [...(!current.reasoning.defaultEffort ? [{ id: '', title: '默认' }] : []), ...efforts.map((item) => ({ id: item.id, title: item.name }))] }] : []),
        { id: 'permission', kind: 'choice', title: '访问模式', selected: conversation.settings?.permission ?? '', act: { name: 'conversation', args: { field: 'permission' } },
          options: (conversation.permissions ?? []).map((option) => ({ id: option.value, title: option.name })) },
      ] },
      { header: '事项', rows: [
        row({ id: 'tidy', title: '最近一次整理', subtitle: state.lastIssueTidy ? when(state.lastIssueTidy.at) : '还没有整理过',
          ...(state.lastIssueTidy?.groupId ? { button: { title: '撤销整理', act: { name: 'undoTidy' } } } : {}) }),
        { id: 'deepSleep', kind: 'switch', title: '深度睡眠', on: settings.settings?.deepSleep !== false, act: { name: 'deepSleep' } },
      ] },
    ];
    return { title: '通用', sections };
  }

  async function generalAct({ name, args, value }) {
    if (name === 'deepSleep') return ok(await ask('assistant/settings', { patch: { deepSleep: value === 'true' } }));
    if (name === 'undoTidy') return ok(await ask('issues/tidy-undo'));
    if (name === 'conversation') {
      const data = await ask('assistant/conversation-settings');
      const { models } = conversationOf(data);
      let patch;
      if (args?.field === 'permission') patch = { permission: text(value, 200) };
      else if (args?.field === 'effort' && data.model) patch = { model: { provider: data.model.provider, model: data.model.model, ...(value ? { reasoningEffort: text(value, 100) } : {}) } };
      else if (args?.field === 'model') {
        let pair;
        try { pair = JSON.parse(value); } catch { return false; }
        const target = models.find((model) => model.provider === pair?.[0] && model.id === pair?.[1]);
        if (!target) return false;
        patch = { model: target.provider === data.model?.provider && target.id === data.model?.model
          ? data.model
          : { provider: target.provider, model: target.id, ...(target.reasoning?.defaultEffort ? { reasoningEffort: target.reasoning.defaultEffort } : {}) } };
      } else return false;
      return ok(await ask('assistant/conversation-settings', { patch }));
    }
    return false;
  }

  // --- 状态 -------------------------------------------------------------------------------------------------------------------------------
  async function statuses(target) {
    const data = await ask('issues/statuses');
    const all = (data.statuses ?? []).filter((status) => !status.archived);
    const [kind, ...rest] = String(target ?? '').split(':');
    const subject = rest.join(':');
    if (kind === 'edit' || kind === 'add') {
      const status = kind === 'edit' ? all.find((entry) => entry.id === subject) : null;
      const category = status?.category ?? subject;
      return { title: status ? statusName(status) : `在${CATEGORY_NAMES[category]}中添加状态`, save: { title: status ? '保存' : '创建', act: { name: 'save', args: kind === 'edit' ? { id: status?.id } : { category } } },
        sections: [{ rows: [
          { id: 'name', kind: 'field', key: 'name', title: '名称', value: status ? statusName(status) : '', placeholder: '名称' },
          { id: 'description', kind: 'field', key: 'description', title: '描述', value: status?.description ?? '', placeholder: '描述', multiline: true },
          { id: 'color', kind: 'choice', key: 'color', title: '颜色', selected: status?.color ?? '#95a2b3', options: COLORS.map((color) => ({ id: color, title: color, color })) },
        ] }] };
    }
    const sections = CATEGORIES.map((category) => {
      const entries = all.filter((status) => status.category === category);
      return { header: CATEGORY_NAMES[category], rows: [
        ...entries.map((status, index) => link(`${statusName(status)}${status.isDefault ? ' · 默认' : ''}`, { section: 'statuses', target: `edit:${status.id}` }, {
          id: status.id, color: status.color ?? undefined,
          subtitle: joined([(data.counts?.[status.id] ?? 0) > 0 ? `${data.counts[status.id]} 条事项` : '', status.description]),
          swipe: [
            ...(!['completed', 'canceled'].includes(status.category) && !status.isDefault ? [{ title: '设为默认', act: { name: 'default', args: { id: status.id } } }] : []),
            ...(index > 0 ? [{ title: '上移', act: { name: 'move', args: { id: status.id, direction: -1 } } }] : []),
            ...(index < entries.length - 1 ? [{ title: '下移', act: { name: 'move', args: { id: status.id, direction: 1 } } }] : []),
            ...(entries.length > 1 ? [{ title: '删除', role: 'destructive', act: { name: 'remove', args: { id: status.id } },
              confirm: { title: '将要删除', message: joined([statusName(status), (data.counts?.[status.id] ?? 0) > 0 ? `将事项移至：${statusName(entries.find((entry) => entry.id !== status.id))}` : '']), button: '删除' } }] : []),
          ],
        })),
        link(`在${CATEGORY_NAMES[category]}中添加状态`, { section: 'statuses', target: `add:${category}` }, { id: `add-${category}`, tone: 'muted' }),
      ] };
    });
    return { title: '状态', sections };
  }

  async function statusesAct({ name, args, values }) {
    const data = await ask('issues/statuses');
    const all = (data.statuses ?? []).filter((status) => !status.archived);
    const finish = (answer) => {
      if (answer.outcome === 'success') return { outcome: 'success' };
      return { outcome: 'error', message: STATUS_ERRORS[answer.code] ?? FAILED };
    };
    if (name === 'save') {
      const fields = { name: text(values?.name, 80).trim(), description: text(values?.description, 500).trim(), color: /^#[0-9a-f]{6}$/i.test(values?.color ?? '') ? values.color : null };
      if (!fields.name) return { outcome: 'error', message: STATUS_ERRORS.invalid_status };
      if (args?.id) return { ...finish(await ask('issues/status-update', { id: text(args.id, 120), patch: fields })), back: true };
      if (!CATEGORIES.includes(args?.category)) return false;
      return { ...finish(await ask('issues/status-add', { fields: { ...fields, category: args.category } })), back: true };
    }
    const status = all.find((entry) => entry.id === args?.id);
    if (!status) return { outcome: 'error', message: STATUS_ERRORS.unknown_status };
    if (name === 'default') return finish(await ask('issues/status-update', { id: status.id, patch: { isDefault: true } }));
    if (name === 'move') {
      const ids = all.filter((entry) => entry.category === status.category).map((entry) => entry.id);
      const index = ids.indexOf(status.id);
      const other = index + (args.direction === 1 ? 1 : -1);
      if (other < 0 || other >= ids.length) return { outcome: 'success' };
      [ids[index], ids[other]] = [ids[other], ids[index]];
      return finish(await ask('issues/status-order', { category: status.category, ids }));
    }
    if (name === 'remove') {
      const replacement = all.find((entry) => entry.category === status.category && entry.id !== status.id)?.id;
      return finish(await ask('issues/status-remove', { id: status.id, ...(replacement ? { replacement } : {}) }));
    }
    return false;
  }

  // --- 连接器 -----------------------------------------------------------------------------------------------------------------------------
  const connectorPlaceholder = '粘贴地址或命令，或者写一句话说怎么读';
  function customConnector(recognized) {
    const several = recognized?.count > 1;
    const how = recognized?.kind === 'remote'
      ? { oauth: '在浏览器里授权', none: '不用登录', token: '需要令牌' }[recognized.auth]
      : { local: '一条命令', sentence: '就是这句话' }[recognized?.kind];
    return { title: '添加自定义连接器', save: { title: '保存', act: { name: 'add' } }, preview: { key: 'text', act: { name: 'recognize' } }, sections: [{ rows: [
      { id: 'text', kind: 'field', key: 'text', title: connectorPlaceholder, value: '', placeholder: connectorPlaceholder, multiline: true, mono: true },
      ...(recognized?.kind ? [row({ id: 'recognized', title: { remote: '远程', local: '本地', sentence: '命令行' }[recognized.kind],
        detail: several ? `${recognized.count} 个连接器` : how })] : []),
      ...(!several ? [{ id: 'name', kind: 'field', key: 'name', title: '名称', value: recognized?.name ?? '', placeholder: '名称' }] : []),
      ...(recognized?.kind === 'remote' && recognized.auth === 'token' && !several
        ? [{ id: 'token', kind: 'field', key: 'token', title: '令牌', value: '', placeholder: '令牌', secret: true }] : []),
      ...(recognized?.kind === 'local' && !several ? [{ id: 'env', kind: 'environment', title: '添加环境变量' }] : []),
    ] }] };
  }

  async function connectors(target) {
    if (target === 'add') return customConnector();
    const detail = String(target ?? '').startsWith('connector:');
    const [catalog, list] = await Promise.all([detail ? {} : ask('connectors/catalog'), ask('connectors/list')]);
    const connected = list.connectors ?? [];
    const [kind, ...rest] = String(target ?? '').split(':');
    if (kind === 'connector') {
      const connector = connected.find((entry) => entry.id === rest.join(':'));
      if (!connector) return { title: '连接器', sections: [] };
      const shown = describeState(connector.state, aboutLine(connector.about));
      return { title: connector.name, ...(connector.custom ? { save: { title: '保存', act: { name: 'update', args: { id: connector.id } } } } : {}),
        poll: connector.state?.status === 'waiting' || connector.busy ? 1.5 : undefined, sections: [{ rows: [
        row({ id: 'about', title: connector.name, icon: connector.icon, ...(shown.line ? { subtitle: shown.line } : {}), ...(shown.words ? { detail: shown.words, tone: shown.tone } : {}) }),
        ...(connector.custom ? [
          { id: 'name', kind: 'field', key: 'name', title: '名称', value: connector.name, placeholder: '名称' },
          { id: 'text', kind: 'field', key: 'text', title: connectorPlaceholder, value: connector.text ?? connector.about?.text ?? '', placeholder: connectorPlaceholder, multiline: true, mono: true },
        ] : []),
        ...(shown.verb ? [row({ id: 'verb', kind: 'action', title: VERB_WORDS[shown.verb], button: { title: VERB_WORDS[shown.verb], act: { name: 'verb', args: { id: connector.id, verb: shown.verb } } } })] : []),
        row({ id: 'disconnect', kind: 'action', title: '断开', tone: 'bad', button: { title: '断开', role: 'destructive', act: { name: 'disconnect', args: { id: connector.id } } } }),
      ] }] };
    }
    const waiting = connected.some((connector) => connector.state?.status === 'waiting' || connector.busy === true);
    const sections = [{ rows: [link('添加自定义连接器', { section: 'connectors', target: 'add' }, { id: 'add', tone: 'muted' })] }];
    if (connected.length) {
      sections.push({ header: '已连接', rows: connected.map((connector) => {
        const shown = describeState(connector.state, aboutLine(connector.about));
        return link(connector.name, { section: 'connectors', target: `connector:${connector.id}` }, { id: connector.id, icon: connector.icon, ...(shown.line ? { subtitle: shown.line } : {}), ...(shown.words ? { detail: shown.words, tone: shown.tone } : {}),
          ...(shown.verb ? { swipe: [{ title: VERB_WORDS[shown.verb], act: { name: 'verb', args: { id: connector.id, verb: shown.verb } } }] } : {}) });
      }) });
    }
    const groups = new Map((catalog.groups ?? []).map((group) => [group.id, group]));
    for (const id of [...GROUP_ORDER, ...[...groups.keys()].filter((key) => !GROUP_ORDER.includes(key))]) {
      const group = groups.get(id);
      if (!group?.items?.length) continue;
      sections.push({ header: GROUP_NAMES[id] ?? id, rows: group.items.map((item) => row({
        id: item.id, title: item.name, icon: item.icon, ...(item.line ? { subtitle: item.line } : {}), button: { title: '连接', act: { name: 'connect', args: { id: item.id } } },
      })) });
    }
    return { title: '连接器', ...(waiting ? { poll: 1.5 } : {}), sections };
  }

  async function connectorsAct({ name, args, values }) {
    if (name === 'undo') return ok(await ask('connectors/undo', { token: text(args?.token, 200) }));
    if (name === 'recognize') {
      const recognized = await ask('connectors/recognize', { text: text(values?.text).trim() });
      return ok(recognized) && recognized.kind ? { outcome: 'success', page: customConnector(recognized) } : false;
    }
    if (name === 'add') {
      const env = Object.fromEntries(Object.entries(values ?? {}).filter(([key, value]) => /^envName\d{1,2}$/u.test(key) && value.trim())
        .map(([key, value]) => [text(value, 64).trim(), text(values[`envValue${key.slice(7)}`])]));
      const answer = await ask('connectors/add', {
        text: text(values?.text).trim(), ...(values?.name?.trim() ? { name: text(values.name, 100).trim() } : {}),
        ...(values?.token?.trim() ? { token: text(values.token).trim() } : {}), ...(Object.keys(env).length ? { env } : {}),
      });
      return ok(answer) ? { outcome: 'success', back: true } : false;
    }
    const id = text(args?.id, 200);
    if (!id) return false;
    if (name === 'connect') return ok(await ask('connectors/connect', { id }));
    if (name === 'verb') return VERB_WORDS[args.verb] ? ok(await ask(`connectors/${args.verb}`, { id })) : false;
    if (name === 'update') {
      const list = await ask('connectors/list');
      const connector = (list.connectors ?? []).find((entry) => entry.id === id && entry.custom);
      if (!connector) return false;
      const newName = text(values?.name, 100).trim();
      const newText = text(values?.text).trim();
      const oldText = String(connector.text ?? connector.about?.text ?? '').trim();
      if (!newName || !newText) return false;
      const answer = await ask('connectors/update', { id,
        ...(newName !== connector.name ? { name: newName } : {}), ...(newText !== oldText ? { text: newText } : {}) });
      return ok(answer) ? { outcome: 'success', back: true } : false;
    }
    if (name === 'disconnect') {
      const list = await ask('connectors/list');
      const connector = (list.connectors ?? []).find((entry) => entry.id === id);
      const answer = await ask('connectors/remove', { id });
      if (answer.code === 'in_use') return { outcome: 'error', message: `还有收集器在用它：${(answer.collectors ?? []).join('、')}` };
      if (!ok(answer)) return false;
      return { outcome: 'success', back: true, ...(connector ? { toast: { message: `已删除 ${connector.name}`, ...(answer.undo ?? answer.token ? { undo: { name: 'undo', args: { token: answer.undo ?? answer.token } } } : {}) } } : {}) };
    }
    return false;
  }

  // --- 收集器 -----------------------------------------------------------------------------------------------------------------------------
  async function collectors(target) {
    const form = /^(?:edit:|add$)/u.test(target ?? '');
    const [state, access, collected] = await Promise.all([ask('collectors/list'), ask('connectors/list'), form ? {} : ask('dispatch/state').catch(() => ({}))]);
    const list = state.collectors ?? [];
    const available = access.connectors ?? [];
    const [kind, ...rest] = String(target ?? '').split(':');
    if (kind === 'edit' || kind === 'add') {
      const collector = kind === 'edit' ? list.find((entry) => entry.id === rest.join(':')) : null;
      return { title: collector ? collector.name : '添加收集器', save: { title: '保存', act: { name: 'save', args: collector ? { id: collector.id } : {} } }, sections: [{ rows: [
        { id: 'name', kind: 'field', key: 'name', title: '名称', value: collector?.name ?? '', placeholder: '名称' },
        { id: 'connector', kind: 'choice', key: 'connector', title: '连接器', selected: collector?.connector ?? available[0]?.id ?? '',
          options: available.map((entry) => ({ id: entry.id, title: entry.name, subtitle: KIND_WORDS[entry.kind] })) },
        { id: 'frequency', kind: 'field', key: 'frequency', title: '频率，如 30m、2h、1d，或 cron', value: collector?.frequency ?? '', placeholder: '频率，如 30m、2h、1d，或 cron', mono: true },
        { id: 'common', kind: 'choice', key: 'common', title: '常用频率', selected: '', options: [{ id: '', title: '—' }, ...PRESETS.map((preset) => ({ id: preset, title: PRESET_WORDS[preset], subtitle: preset }))] },
        { id: 'prompt', kind: 'field', key: 'prompt', title: '收集什么', value: collector?.prompt ?? '', placeholder: '收集什么', multiline: true },
      ] }] };
    }
    const reads = new Map((collected.collectors ?? []).map((entry) => [entry.id, entry.lastRead]));
    const lastLine = (read) => {
      if (!read || !Number.isFinite(read.at)) return '';
      return read.ok ? (read.items > 0 ? `上次 ${when(read.at)} · 新增 ${read.items} 条` : `上次 ${when(read.at)} · 没有新的`) : `上次 ${when(read.at)} · 读取失败`;
    };
    const sections = [{ rows: [available.length
      ? link('添加收集器', { section: 'collectors', target: 'add' }, { id: 'add', tone: 'muted' })
      : row({ id: 'needConnector', title: '先添加一个连接器', tone: 'muted' })] }];
    sections.push(list.length
      ? { header: '收集器', rows: list.map((collector) => link(collector.name, { section: 'collectors', target: `edit:${collector.id}` }, {
        id: collector.id, icon: available.find((entry) => entry.id === collector.connector)?.icon,
        subtitle: joined([firstLine(collector.prompt), lastLine(reads.get(collector.id))]), detail: describeFrequency(collector.frequency),
        swipe: [{ title: '删除', role: 'destructive', act: { name: 'remove', args: { id: collector.id } }, confirm: { title: '将要删除', message: collector.name, button: '删除' } }],
      })) }
      : { rows: [row({ id: 'empty', title: '没有收集器', tone: 'muted' })] });
    return { title: '收集器', sections };
  }

  async function collectorsAct({ name, args, values }) {
    if (name === 'save') {
      const fields = { name: text(values?.name, 100).trim(), connector: text(values?.connector, 200), frequency: (text(values?.frequency, 100).trim() || text(values?.common, 100)).trim(), prompt: text(values?.prompt).trim() };
      if (!fields.name || !fields.connector || !fields.prompt) return { outcome: 'error', message: FAILED };
      const answer = args?.id ? await ask('collectors/update', { id: text(args.id, 200), ...fields }) : await ask('collectors/add', fields);
      return ok(answer) ? { outcome: 'success', back: true } : { outcome: 'error', message: text(answer.message, 300) || FAILED };
    }
    if (name === 'remove') {
      const list = await ask('collectors/list');
      const collector = (list.collectors ?? []).find((entry) => entry.id === args?.id);
      const answer = await ask('collectors/remove', { id: text(args?.id, 200) });
      if (!ok(answer)) return false;
      return { outcome: 'success', ...(collector ? { toast: { message: `已删除 ${collector.name}`, ...(answer.undo ? { undo: { name: 'undo', args: { token: answer.undo } } } : {}) } } : {}) };
    }
    if (name === 'undo') return ok(await ask('collectors/undo', { token: text(args?.token, 200) }));
    return false;
  }

  // --- 规则 -------------------------------------------------------------------------------------------------------------------------------
  async function rules(target) {
    const data = await ask('rules/get');
    const [kind, ...rest] = String(target ?? '').split(':');
    const name = rest.join(':');
    if (kind === 'edit' && Object.hasOwn(RULE_TITLES, name)) {
      const body = data.rules?.[name];
      return { title: name, save: { title: '保存', act: { name: 'save', args: { name, previous: body ?? null, projectFolder: data.projectFolder ?? null } } },
        sections: [{ header: RULE_TITLES[name], rows: [{ id: 'text', kind: 'field', key: 'text', title: name, value: body ?? '', multiline: true, mono: true }] }] };
    }
    return { title: '规则', sections: Object.keys(RULE_TITLES).map((file) => {
      const body = data.rules?.[file];
      return { header: RULE_TITLES[file], rows: [link(file, { section: 'rules', target: `edit:${file}` }, { id: file, mono: true, subtitle: body ? firstLine(body) : (body === null || body === undefined ? '未找到' : '空') })] };
    }) };
  }

  async function rulesAct({ name, args, values }) {
    if (name !== 'save' || !Object.hasOwn(RULE_TITLES, args?.name)) return false;
    const answer = await ask('rules/update', { name: args.name, text: text(values?.text), previous: args.previous ?? null, projectFolder: args.projectFolder ?? null });
    return ok(answer) ? { outcome: 'success', back: true } : false;
  }

  // --- 记忆 -------------------------------------------------------------------------------------------------------------------------------
  const summary = (counts = {}) => {
    const updated = (counts.refine ?? 0) + (counts.supersede ?? 0) + (counts.corroborate ?? 0);
    return [updated && `更新 ${updated} 条`, counts.new && `新增 ${counts.new} 条`, counts.skill && `新增 ${counts.skill} 项技能`].filter(Boolean).join('，') || '没有变更';
  };

  async function memory(target) {
    const [records, reviews] = await Promise.all([ask('memory/records'), ask('memory/reviews', { limit: 10 })]);
    const list = records.records ?? [];
    const [kind, ...rest] = String(target ?? '').split(':');
    if (kind === 'edit') {
      const record = list.find((entry) => String(entry.id) === rest.join(':'));
      return { title: '编辑', save: { title: '保存', act: { name: 'save', args: { id: record?.id } } }, sections: [{ rows: [{ id: 'text', kind: 'field', key: 'text', title: '编辑', value: record?.text ?? '', multiline: true }] }] };
    }
    return { title: '记忆', sections: [
      list.length ? { header: '记忆', rows: list.map((record) => link(record.text, { section: 'memory', target: `edit:${record.id}` }, {
        id: String(record.id), subtitle: joined([record.file, `自 ${record.since}`, record.status === 'superseded' ? '已替代' : '']),
        swipe: [{ title: '忘记', role: 'destructive', act: { name: 'forget', args: { id: record.id } },
          confirm: { title: '将要删除', message: `${record.text}\n会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。`, button: '删除' } }],
      })) } : { rows: [row({ id: 'empty', title: '还没有记住的事', tone: 'muted' })] },
      { header: '整理记录', rows: (reviews.reviews ?? []).length
        ? reviews.reviews.map((review) => row({ id: String(review.id), title: summary(review.summary), subtitle: review.at ? when(review.at) : '',
          ...(!review.undone ? { button: { title: '撤销', act: { name: 'undo', args: { id: review.id } } } } : {}) }))
        : [row({ id: 'noReviews', title: '还没有整理记录', tone: 'muted' })] },
    ] };
  }

  async function memoryAct({ name, args, values }) {
    if (name === 'save') {
      const body = text(values?.text).trim();
      if (!body) return { outcome: 'error', message: FAILED };
      return ok(await ask('memory/update', { id: args?.id, text: body })) ? { outcome: 'success', back: true } : false;
    }
    if (name === 'forget') return ok(await ask('memory/forget', { source: `record:${args?.id}`, preview: false }));
    if (name === 'undo') return ok(await ask('memory/undo', { id: args?.id }));
    return false;
  }

  // --- 技能 -------------------------------------------------------------------------------------------------------------------------------
  async function skills(target) {
    const [kind, ...rest] = String(target ?? '').split(':');
    if (kind === 'skill') {
      const name = rest.join(':');
      const one = await ask('skills/read', { name });
      return { title: name, sections: [
        { header: name, rows: [row({ id: 'text', title: one.text ?? one.skill?.text ?? '', mono: true })] },
        { rows: [row({ id: 'delete', kind: 'action', title: '删除', tone: 'bad', button: { title: '删除', role: 'destructive', act: { name: 'remove', args: { name } }, confirm: { title: '将要删除', message: name, button: '删除' } } })] },
      ] };
    }
    const list = (await ask('skills/list')).skills ?? [];
    return { title: '技能', sections: [list.length
      ? { header: '技能', rows: list.map((skill) => link(skill.name, { section: 'skills', target: `skill:${skill.name}` }, { id: skill.name, ...(skill.description ? { subtitle: skill.description } : {}),
        swipe: [{ title: '删除', role: 'destructive', act: { name: 'remove', args: { name: skill.name } }, confirm: { title: '将要删除', message: skill.name, button: '删除' } }] })) }
      : { rows: [row({ id: 'empty', title: '还没有技能', tone: 'muted' })] }] };
  }

  async function skillsAct({ name, args, target }) {
    if (name !== 'remove') return false;
    return ok(await ask('skills/remove', { name: text(args?.name, 200) })) ? { outcome: 'success', back: String(target ?? '').startsWith('skill:') } : false;
  }

  const SECTIONS = {
    general: { page: general, act: generalAct },
    statuses: { page: statuses, act: statusesAct },
    connectors: { page: connectors, act: connectorsAct },
    collectors: { page: collectors, act: collectorsAct },
    rules: { page: rules, act: rulesAct },
    memory: { page: memory, act: memoryAct },
    skills: { page: skills, act: skillsAct },
  };

  const sectionOf = (params) => (typeof params?.section === 'string' && DUDU_PAGE_SECTIONS.includes(params.section) ? SECTIONS[params.section] : null);
  const targetOf = (params) => (typeof params?.target === 'string' ? params.target.slice(0, 300) : undefined);

  return {
    async dispatch(method, params) {
      const section = sectionOf(params);
      if (!section) return { outcome: 'needs_clarification', message: LOAD_FAILED };
      const target = targetOf(params);
      try {
        if (method === 'settings.page') return { outcome: 'success', page: await section.page(target) };
        const values = isRecord(params.values) ? Object.fromEntries(Object.entries(params.values).slice(0, 100).map(([key, value]) => [text(key, 40), text(value)])) : undefined;
        const result = await section.act({ name: text(params.name, 40), args: isRecord(params.args) ? params.args : {}, value: typeof params.value === 'string' ? params.value.slice(0, MAX_TEXT) : undefined, values, target });
        const answer = result === true ? { outcome: 'success' } : result === false ? { outcome: 'error', message: FAILED } : result;
        if (answer.outcome === 'success' && !answer.back && !answer.page) return { ...answer, page: await section.page(target) };
        return answer;
      } catch {
        return { outcome: 'error', message: method === 'settings.page' ? LOAD_FAILED : FAILED };
      }
    },
  };
}
