import { nativeLabels, nativeLocale, nativeText } from './native-locale.mjs';
// 嘟嘟's own settings for the phone, drawn by the app itself (owner, 2026-11-07: "嘟嘟自己的设置不用 webview 用原生实现"). The plugin describes a page, the app draws it with its own controls, and what the
// person changes goes back here: the actions are the desktop interface's (`assistant/settings`, `issues/status-update`, `collectors/add`…), the same list the web pages were allowed
// (phone-pages.mjs), asked through `call`. The words are the desktop interface's (ui/strings.js, `settings`), copied, not new.
//
//   settings.page { section, target? }                          -> { outcome: 'success', page }
//   settings.act  { section, target?, name, args?, value?, values? } -> { outcome, message?, page?, back?, toast?, recognized? }
//   settings.data { section, target? }                          -> { outcome: 'success', data: { '<action>': values } }
//
// An app that draws the pages itself (owner, 2026-11-21: 「整个嘟嘟设置，包括打开里面的都可以写死，包括里面的条目，从 api 获取的是值，而不是布局」) asks `settings.data` instead of `settings.page`: the layout is the app's,
// what comes from here is the values, the answers of the actions the page below is built from (`READS`), cut down to the fields a page reads (`FIELDS`). `settings.act` is the same for both; the
// `recognized` that `recognize` answers with is the values of the add-connector preview. A plugin without `settings.data` is an older one: the app falls back to `settings.page` then.
//
// A page is { title, sections: [{ header?, footer?, rows }], save?: { title, act }, preview?: { key, act }, poll?: seconds }. A row is { id, kind: 'text' | 'switch' | 'choice' | 'field' | 'action' | 'environment', title, subtitle?, detail?, mono?, icon?, secret?,
// tone?, on?, options?: [{ id, title, subtitle?, color? }], selected?, key?, value?, placeholder?, multiline?, button?: { title, act, role?, confirm? }, to?: { section, target }, swipe?: [{ title,
// act, role?, confirm? }], act? }. An act is { name, args? }: what the app sends back as `name` and `args`, with the row's new `value` (a switch, a choice) or, for a page that is a form, every field's
// `values`. A `confirm` is { title, message?, button }: the app asks before it acts. After an act the app reads the page again, or goes back when the answer says `back`; a `toast` is said under the
// toolbar.
//
// A phone that declared `settings.rich` (native-client.mjs; both apps do since 2026-11-21) is given more, every other phone the shapes above, unchanged (the released apps know no more).
// A row's `menu`: [{ title, glyph, act?, to?, role?, confirm?, enabled? }] is what a long press offers; it replaces `swipe` (`to` opens that page, `glyph` is a Lucide name, `enabled: false` is shown
// grey). A row of kind 'group' is a strip in its card with an `add: { title, to }` at its right end. A row's `status: { type, color?, progress? }` is a status icon in a tile, its `tag` a muted word
// after the title. A field with `inline` has its title beside it. A choice with `style: 'swatches'` or `'icons'` is drawn as a row of colour dots (an option's `color`) or of status icons (its
// `status`). A row of kind 'statusPreview' is the big tile of a form, which follows the form's colour and progress (`colorKey`, `progressKey`).
import { understands } from './native-client.mjs';
import { DUDU_PAGE_SECTIONS } from './phone-pages.mjs';

export const NATIVE_SETTINGS_METHODS = Object.freeze(['settings.page', 'settings.act', 'settings.data']);

const FAILED = '更改没能保存';
const LOAD_FAILED = '这一页没能加载';
const MAX_TEXT = 20_000;
const CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];
const CATEGORY_NAMES = nativeLabels({ backlog: '待规划', unstarted: '未开始', started: '已开始', completed: '已完成', canceled: '已取消' });
const STATUS_NAMES = nativeLabels({ backlog: '待规划', todo: '待办', in_progress: '处理中', in_review: '待审核', done: '已完成', canceled: '已取消' });
const STATUS_ERRORS = nativeLabels({
  unknown_status: '这个状态已不存在。', invalid_status: '请检查状态名称和颜色。', duplicate_status: '已有同名状态。', last_status: '每个分类至少保留一个状态。', status_in_use: '请选择现有事项要移入的状态。',
});
const COLORS = ['#95a2b3', '#61666b', '#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#26b5ce', '#5e6ad2', '#8f6bde'];
const PRESETS = ['5m', '15m', '30m', '1h', '6h', '0 9 * * *', '0 9 * * 1-5', '0 9-18 * * 1-5'];
const PRESET_WORDS = nativeLabels({
  '5m': '每 5 分钟', '15m': '每 15 分钟', '30m': '每 30 分钟', '1h': '每小时', '6h': '每 6 小时',
  '0 9 * * *': '每天 09:00', '0 9 * * 1-5': '周一至周五 09:00', '0 9-18 * * 1-5': '周一至周五 9 至 18 点每小时',
});
const RULE_TITLES = nativeLabels({ 'TRIAGE.md': '影响、工作量和截止', 'ASSIGN.md': '任务分配' });
const KIND_WORDS = { prompt: 'Prompt', mcp: 'MCP' };
const GROUP_ORDER = ['here', 'work', 'projects', 'dev', 'web'];
const GROUP_NAMES = nativeLabels({ here: '这台电脑', work: '办公', projects: '项目', dev: '开发', web: '网页' });
const VERB_WORDS = nativeLabels({ authorize: '授权', cancel: '取消', retry: '重试' });
const VERB_GLYPHS = { authorize: 'key-round', cancel: 'x', retry: 'rotate-cw' };
const NOT_CONNECTED = new Set(['needs-auth', 'waiting', 'needs-login', 'missing', 'error']);
/** Connected means it works: the connector is not busy and its state is not one of the unfinished ones. */
const isConnected = (connector) => connector.busy !== true && !NOT_CONNECTED.has(connector.state?.status);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, max) : '');
const ok = (answer) => ['success', 'no_op'].includes(answer?.outcome);
const firstLine = (value) => String(value ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
const joined = (parts) => parts.filter(Boolean).join(' · ');
const baseName = (command) => String(command ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';
const when = (at) => (Number.isFinite(at) ? new Intl.DateTimeFormat(nativeLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at)) : '');

function describeFrequency(value) {
  const one = String(value ?? '').trim();
  if (!one) return nativeText('每 30 分钟');
  if (Object.hasOwn(PRESET_WORDS, one)) return PRESET_WORDS[one];
  const every = /^(\d{1,4})\s*([mhd])$/i.exec(one);
  if (!every) return one;
  const n = Number(every[1]);
  return { m: nativeText`每 ${n} 分钟`, h: n === 1 ? nativeText('每小时') : nativeText`每 ${n} 小时`, d: n === 1 ? nativeText('每天') : nativeText`每 ${n} 天` }[every[2].toLowerCase()];
}

function aboutLine(about) {
  if (!about) return '';
  const tools = typeof about.tools === 'number' ? nativeText`${about.tools} 个工具` : '';
  if (about.kind === 'remote') return joined([about.host, tools]);
  if (about.kind === 'local') return joined([about.command && nativeText`本机 · ${baseName(about.command)}`, tools]);
  if (about.kind === 'cli') return about.command ? nativeText`命令行 · ${about.command}` : '';
  if (about.kind === 'sentence') return firstLine(about.text);
  return '';
}

/** What a connector's state says in a row: the words by it, the tone, the one thing to do about it. */
function describeState(state, line) {
  if (!state) return { line };
  switch (state.status) {
    case 'needs-auth': return { line, tone: 'warn', words: nativeText('需要授权'), verb: 'authorize' };
    // The browser is the computer's, not the phone's (owner, 2026-11-21: "等待浏览器…" read as if the phone should open one): the words say where to go, in the warning colour.
    case 'waiting': return { line: state.code || line, tone: 'warn', words: nativeText('请在电脑上授权'), verb: 'cancel' };
    case 'needs-login': return { line: state.login ? nativeText`在终端运行 ${state.login}，再点重试` : line, tone: 'warn', words: nativeText('需要登录'), verb: 'retry' };
    case 'missing': return { line: state.command ? nativeText`没找到 ${state.command}${state.install ? nativeText`：${state.install}` : ''}` : line, tone: 'bad', words: nativeText('没装'), verb: 'retry' };
    case 'error': return { line, tone: 'bad', words: state.message === 'timeout' ? nativeText('连接超时') : text(state.message, 120), verb: 'retry' };
    default: return { line };
  }
}

const row = (fields) => ({ kind: 'text', ...fields });
const link = (title, to, fields = {}) => row({ title, to, ...fields });
const statusName = (status) => status.name || STATUS_NAMES[status.id] || status.id;

const RICH = 'settings.rich';
const isRich = (context) => understands(context?.client, RICH);
const STATUS_TYPES = { backlog: 'backlog', unstarted: 'todo', started: 'in_progress', completed: 'done', canceled: 'canceled' };
const PROGRESS = [0, 0.25, 0.5, 0.75, 1];

/**
 * What a row offers to do. A phone that declared `settings.rich` gets a long-press `menu` (every item, the disabled ones grey); any other gets the `swipe` the released apps know: only the items
 * that act and can be done now, and none of the menu-only ones (`menuOnly`: to open the row's own page, which a tap does). `glyph` and `menuOnly` are the menu's and never reach a swipe.
 */
function actionsOf(context, items) {
  const shown = items.filter(Boolean);
  if (isRich(context)) return shown.length ? { menu: shown.map(({ menuOnly, ...item }) => item) } : {};
  const swipe = shown.filter((item) => item.act && item.enabled !== false && !item.menuOnly)
    .map(({ title, act, role, confirm }) => ({ title, act, ...(role ? { role } : {}), ...(confirm ? { confirm } : {}) }));
  return swipe.length ? { swipe } : {};
}

/**
 * The 状态 form as the owner drew it (`.local/designs/phone-status-settings-2026-11-21/`): a tile that follows the colour and progress, the name and description beside their titles, the progress of a
 * started status as five icons, the colour as dots instead of a list of hex words.
 */
function statusForm(status, category) {
  const type = status?.type ?? STATUS_TYPES[category];
  const color = status?.color ?? '#95a2b3';
  const progress = category === 'started' ? (PROGRESS.includes(status?.iconProgress) ? status.iconProgress : type === 'in_review' ? 0.75 : 0.5) : undefined;
  const shown = (value) => ({ type, color, ...(value === undefined ? {} : { progress: value }) });
  return [
    { rows: [{ id: 'preview', kind: 'statusPreview', title: status ? statusName(status) : '', status: shown(progress), colorKey: 'color', ...(progress === undefined ? {} : { progressKey: 'progress' }) }] },
    { rows: [
      { id: 'name', kind: 'field', inline: true, key: 'name', title: nativeText('名称'), value: status ? statusName(status) : '', placeholder: nativeText('名称') },
      { id: 'description', kind: 'field', inline: true, key: 'description', title: nativeText('描述'), value: status?.description ?? '', placeholder: nativeText('描述'), multiline: true },
    ] },
    ...(progress === undefined ? [] : [{ header: nativeText('完成度'), rows: [{ id: 'progress', kind: 'choice', style: 'icons', key: 'progress', colorKey: 'color', title: nativeText('完成度'), selected: String(progress),
      options: PROGRESS.map((value) => ({ id: String(value), title: `${value * 100}%`, status: shown(value) })) }] }]),
    { header: nativeText('颜色'), rows: [{ id: 'color', kind: 'choice', style: 'swatches', key: 'color', title: nativeText('颜色'), selected: color, options: COLORS.map((one) => ({ id: one, title: one, color: one })) }] },
  ];
}

/**
 * What the pages read of each action's answer, and no more: an app that draws a page itself is given the values its layout is made of, not the whole answer (no folder paths of the plugin's own state,
 * nothing a page never shows). `true` keeps a value whole; an object keeps those keys of a record, or of every record of a list.
 */
const FIELDS = {
  'assistant/state': { projectFolder: true, isDefault: true, lastIssueTidy: { at: true } },
  'assistant/settings': { settings: { deepSleep: true } },
  'assistant/conversation-settings': {
    model: { provider: true, model: true, reasoningEffort: true }, settings: { permission: true }, permissions: { value: true, name: true },
    groups: { id: true, name: true, models: { id: true, name: true, reasoning: { efforts: { id: true, name: true }, defaultEffort: true } } },
  },
  'issues/statuses': { counts: true, statuses: { id: true, name: true, description: true, color: true, category: true, type: true, isDefault: true, archived: true, iconProgress: true } },
  // `how`, `trying`, `from`, `fresh`, `state.url` and `attempts` (2026-11-23) are for the connectors page of the apps after 0.1.1; an older app reads none of them.
  'connectors/catalog': { groups: { id: true, items: { id: true, name: true, icon: true, line: true, how: true } }, trying: { id: true, name: true, icon: true, line: true, how: true, group: true, connector: true } },
  'connectors/list': { connectors: { id: true, name: true, icon: true, kind: true, custom: true, text: true, busy: true, from: true, fresh: true, usedBy: { id: true, name: true },
    state: { status: true, code: true, url: true, command: true, install: true, login: true, message: true }, about: { kind: true, host: true, tools: true, command: true, text: true } },
  attempts: { id: true, from: true, status: true, message: true, at: true } },
  'connectors/recognize': { kind: true, count: true, auth: true, name: true },
  'collectors/list': { collectors: { id: true, name: true, connector: true, frequency: true, prompt: true, notify: true } },
  'dispatch/state': { collectors: { id: true, lastRead: { at: true, ok: true, items: true } } },
  'rules/get': { projectFolder: true, rules: Object.fromEntries(Object.keys(RULE_TITLES).map((name) => [name, true])) },
  'memory/records': { records: { id: true, text: true, file: true, since: true, status: true } },
  'memory/reviews': { reviews: { id: true, at: true, summary: { refine: true, supersede: true, corroborate: true, new: true, skill: true } } },
  'skills/list': { skills: { name: true, description: true } },
  'providers/state': { providers: { id: true, name: true, enabled: true, state: true, version: true, path: true, configuredPath: true, env: true, reason: true, folds: true, defaultEnabled: true } },
  'skills/read': { text: true, skill: { text: true } },
};

function shape(value, spec) {
  if (spec === true || !isRecord(spec)) return value;
  if (Array.isArray(value)) return value.map((one) => shape(one, spec));
  if (!isRecord(value)) return value;
  const kept = {};
  for (const [key, inner] of Object.entries(spec)) if (value[key] !== undefined) kept[key] = shape(value[key], inner);
  return kept;
}

/**
 * The actions each section reads for a page, by the page's target: `[action, body?, optional?]`. They are the actions the builders below ask (the page of a section is made of nothing else), so the
 * app's own layout has what the descriptor has. An optional one that fails is `{}`, as the page shows it without.
 */
const READS = {
  general: () => [['assistant/state'], ['assistant/conversation-settings'], ['assistant/settings']],
  statuses: () => [['issues/statuses']],
  connectors: (target) => (target === 'add' ? [] : String(target ?? '').startsWith('connector:') ? [['connectors/list']] : [['connectors/catalog'], ['connectors/list']]),
  providers: () => [['providers/state']],
  collectors: (target) => [['collectors/list'], ['connectors/list'], ...(/^(?:edit:|add$)/u.test(target ?? '') ? [] : [['dispatch/state', {}, true]])],
  rules: () => [['rules/get']],
  memory: () => [['memory/records'], ['memory/reviews', { limit: 10 }]],
  skills: (target) => {
    const [kind, ...rest] = String(target ?? '').split(':');
    return kind === 'skill' ? [['skills/read', { name: rest.join(':') }]] : [['skills/list']];
  },
};

export function createNativeSettings({ call }) {
  /** The plugin's own answer to an action of the desktop interface; one that did not answer is a failure the page says. */
  async function ask(action, body = {}) {
    const answer = await call(action, body);
    if (!answer || answer.status !== 200 || !isRecord(answer.body)) throw new Error(action);
    return answer.body;
  }

  // --- 常规 -------------------------------------------------------------------------------------------------------------------------------
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
      { header: nativeText('项目文件夹'), rows: [row({
        id: 'folder', title: state.projectFolder ?? nativeText('项目文件夹没能打开。'), mono: Boolean(state.projectFolder), ...(state.isDefault ? { detail: nativeText('默认') } : {}), ...(state.projectFolder ? {} : { tone: 'bad' }),
      })] },
      { header: nativeText('嘟嘟 · 默认'), rows: [
        { id: 'model', kind: 'choice', title: nativeText('模型'), selected: current ? JSON.stringify([current.provider, current.id]) : '', act: { name: 'conversation', args: { field: 'model' } },
          options: models.map((model) => ({ id: JSON.stringify([model.provider, model.id]), title: model.name, ...((conversation.groups ?? []).length > 1 ? { subtitle: model.group } : {}) })) },
        ...(efforts.length ? [{ id: 'effort', kind: 'choice', title: nativeText('推理等级'), selected: conversation.model?.reasoningEffort ?? current.reasoning.defaultEffort ?? '', act: { name: 'conversation', args: { field: 'effort' } },
          options: [...(!current.reasoning.defaultEffort ? [{ id: '', title: nativeText('默认') }] : []), ...efforts.map((item) => ({ id: item.id, title: item.name }))] }] : []),
        { id: 'permission', kind: 'choice', title: nativeText('访问模式'), selected: conversation.settings?.permission ?? '', act: { name: 'conversation', args: { field: 'permission' } },
          options: (conversation.permissions ?? []).map((option) => ({ id: option.value, title: option.name })) },
      ] },
      { header: nativeText('事项'), rows: [
        row({ id: 'tidy', title: nativeText('最近一次整理'), subtitle: state.lastIssueTidy ? when(state.lastIssueTidy.at) : nativeText('还没有整理过') }),
        { id: 'deepSleep', kind: 'switch', title: nativeText('深度睡眠'), on: settings.settings?.deepSleep !== false, act: { name: 'deepSleep' } },
      ] },
    ];
    return { title: nativeText('常规'), sections };
  }

  async function generalAct({ name, args, value }) {
    if (name === 'deepSleep') return ok(await ask('assistant/settings', { patch: { deepSleep: value === 'true' } }));
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
  async function statuses(target, context = {}) {
    const data = await ask('issues/statuses');
    const all = (data.statuses ?? []).filter((status) => !status.archived);
    const rich = isRich(context);
    const [kind, ...rest] = String(target ?? '').split(':');
    const subject = rest.join(':');
    if (kind === 'edit' || kind === 'add') {
      const status = kind === 'edit' ? all.find((entry) => entry.id === subject) : null;
      const category = status?.category ?? subject;
      const head = { title: status ? statusName(status) : nativeText`在${CATEGORY_NAMES[category]}中添加状态`, save: { title: status ? nativeText('保存') : nativeText('创建'), act: { name: 'save', args: kind === 'edit' ? { id: status?.id } : { category } } } };
      if (rich) return { ...head, sections: statusForm(status, category) };
      return { ...head,
        sections: [{ rows: [
          { id: 'name', kind: 'field', key: 'name', title: nativeText('名称'), value: status ? statusName(status) : '', placeholder: nativeText('名称') },
          { id: 'description', kind: 'field', key: 'description', title: nativeText('描述'), value: status?.description ?? '', placeholder: nativeText('描述'), multiline: true },
          { id: 'color', kind: 'choice', key: 'color', title: nativeText('颜色'), selected: status?.color ?? '#95a2b3', options: COLORS.map((color) => ({ id: color, title: color, color })) },
        ] }] };
    }
    const edit = (status) => ({ section: 'statuses', target: `edit:${status.id}` });
    const count = (status) => data.counts?.[status.id] ?? 0;
    /** What a status row offers: the released apps swipe the first four; a long press has all of them (the owner's menu: 编辑 / 设为默认 / 上移 / 下移 / 删除). */
    const actions = (status, index, entries) => actionsOf(context, [
      { title: nativeText('编辑'), glyph: 'pencil', to: edit(status), menuOnly: true },
      ...(!['completed', 'canceled'].includes(status.category) ? [{ title: nativeText('设为默认'), glyph: 'check', enabled: !status.isDefault, act: { name: 'default', args: { id: status.id } } }] : []),
      { title: nativeText('上移'), glyph: 'arrow-up', enabled: index > 0, act: { name: 'move', args: { id: status.id, direction: -1 } } },
      { title: nativeText('下移'), glyph: 'arrow-down', enabled: index < entries.length - 1, act: { name: 'move', args: { id: status.id, direction: 1 } } },
      ...(entries.length > 1 ? [{ title: nativeText('删除'), glyph: 'trash', role: 'destructive', act: { name: 'remove', args: { id: status.id } },
        confirm: { title: nativeText('将要删除'), message: joined([statusName(status), count(status) > 0 ? nativeText`将事项移至：${statusName(entries.find((entry) => entry.id !== status.id))}` : '']), button: nativeText('删除') } }] : []),
    ]);
    if (rich) {
      // One card, a strip for each category with its "+", a tile and the name for each status (the owner's drawing, 2026-11-21: the "···" became a long press).
      const rows = CATEGORIES.flatMap((category) => {
        const entries = all.filter((status) => status.category === category);
        return [
          { id: `group-${category}`, kind: 'group', title: CATEGORY_NAMES[category], add: { title: nativeText`在${CATEGORY_NAMES[category]}中添加状态`, to: { section: 'statuses', target: `add:${category}` } } },
          ...entries.map((status, index) => link(statusName(status), edit(status), {
            id: status.id, ...(status.isDefault ? { tag: nativeText(' · 默认').trim() } : {}), ...(count(status) > 0 ? { subtitle: nativeText`${count(status)} 条事项` } : {}),
            status: { type: status.type ?? STATUS_TYPES[category], ...(status.color ? { color: status.color } : {}), ...(PROGRESS.includes(status.iconProgress) ? { progress: status.iconProgress } : {}) },
            ...actions(status, index, entries),
          })),
        ];
      });
      return { title: nativeText('状态'), sections: [{ rows }] };
    }
    const sections = CATEGORIES.map((category) => {
      const entries = all.filter((status) => status.category === category);
      return { header: CATEGORY_NAMES[category], rows: [
        ...entries.map((status, index) => link(`${statusName(status)}${status.isDefault ? nativeText(' · 默认') : ''}`, edit(status), {
          id: status.id, color: status.color ?? undefined,
          subtitle: joined([count(status) > 0 ? nativeText`${count(status)} 条事项` : '', status.description]),
          ...actions(status, index, entries),
        })),
        link(nativeText`在${CATEGORY_NAMES[category]}中添加状态`, { section: 'statuses', target: `add:${category}` }, { id: `add-${category}`, tone: 'muted' }),
      ] };
    });
    return { title: nativeText('状态'), sections };
  }

  async function statusesAct({ name, args, values }) {
    const data = await ask('issues/statuses');
    const all = (data.statuses ?? []).filter((status) => !status.archived);
    const finish = (answer) => {
      if (answer.outcome === 'success') return { outcome: 'success' };
      return { outcome: 'error', message: STATUS_ERRORS[answer.code] ?? nativeText(FAILED) };
    };
    if (name === 'save') {
      const fields = { name: text(values?.name, 80).trim(), description: text(values?.description, 500).trim(), color: /^#[0-9a-f]{6}$/i.test(values?.color ?? '') ? values.color : null };
      if (!fields.name) return { outcome: 'error', message: STATUS_ERRORS.invalid_status };
      // The progress is only sent by a phone that drew the form with it, and only a started status has one.
      const category = args?.id ? all.find((entry) => entry.id === args.id)?.category : args?.category;
      const progress = values?.progress === undefined || values.progress === '' ? NaN : Number(values.progress);
      if (category === 'started' && PROGRESS.includes(progress)) fields.iconProgress = progress;
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
      ? { oauth: nativeText('在浏览器里授权'), none: nativeText('不用登录'), token: nativeText('需要令牌') }[recognized.auth]
      : { local: nativeText('一条命令'), sentence: nativeText('就是这句话') }[recognized?.kind];
    return { title: nativeText('添加自定义连接器'), save: { title: nativeText('保存'), act: { name: 'add' } }, preview: { key: 'text', act: { name: 'recognize' } }, sections: [{ rows: [
      { id: 'text', kind: 'field', key: 'text', title: nativeText(connectorPlaceholder), value: '', placeholder: nativeText(connectorPlaceholder), multiline: true, mono: true },
      ...(recognized?.kind ? [row({ id: 'recognized', title: { remote: nativeText('远程'), local: nativeText('本地'), sentence: nativeText('命令行') }[recognized.kind],
        detail: several ? nativeText`${recognized.count} 个连接器` : how })] : []),
      ...(!several ? [{ id: 'name', kind: 'field', key: 'name', title: nativeText('名称'), value: recognized?.name ?? '', placeholder: nativeText('名称') }] : []),
      ...(recognized?.kind === 'remote' && recognized.auth === 'token' && !several
        ? [{ id: 'token', kind: 'field', key: 'token', title: nativeText('令牌'), value: '', placeholder: nativeText('令牌'), secret: true }] : []),
      ...(recognized?.kind === 'local' && !several ? [{ id: 'env', kind: 'environment', title: nativeText('添加环境变量') }] : []),
    ] }] };
  }

  async function connectors(target, context = {}) {
    if (target === 'add') return customConnector();
    const detail = String(target ?? '').startsWith('connector:');
    const [catalog, list] = await Promise.all([detail ? {} : ask('connectors/catalog'), ask('connectors/list')]);
    const connected = list.connectors ?? [];
    const [kind, ...rest] = String(target ?? '').split(':');
    if (kind === 'connector') {
      const connector = connected.find((entry) => entry.id === rest.join(':'));
      if (!connector) return { title: nativeText('连接器'), sections: [] };
      const shown = describeState(connector.state, aboutLine(connector.about));
      return { title: connector.name, ...(connector.custom ? { save: { title: nativeText('保存'), act: { name: 'update', args: { id: connector.id } } } } : {}),
        poll: connector.state?.status === 'waiting' || connector.busy ? 1.5 : undefined,
        // What the person can do is one card each (the owner's drawing, 2026-11-21): the connector, then 取消 / 授权 / 重试 when there is one, then 断开. A waiting one says where the page is.
        sections: [{ ...(connector.state?.status === 'waiting' ? { footer: nativeText('授权页面已在电脑的浏览器里打开。在电脑上完成后，这里会自动更新。') } : {}), rows: [
          row({ id: 'about', title: connector.name, icon: connector.icon, ...(shown.line ? { subtitle: shown.line } : {}), ...(shown.words ? { detail: shown.words, tone: shown.tone } : {}) }),
          ...(connector.custom ? [
            { id: 'name', kind: 'field', key: 'name', title: nativeText('名称'), value: connector.name, placeholder: nativeText('名称') },
            { id: 'text', kind: 'field', key: 'text', title: nativeText(connectorPlaceholder), value: connector.text ?? connector.about?.text ?? '', placeholder: nativeText(connectorPlaceholder), multiline: true, mono: true },
          ] : []),
        ] },
        ...(shown.verb ? [{ rows: [row({ id: 'verb', kind: 'action', title: VERB_WORDS[shown.verb], button: { title: VERB_WORDS[shown.verb], act: { name: 'verb', args: { id: connector.id, verb: shown.verb } } } })] }] : []),
        { rows: [row({ id: 'disconnect', kind: 'action', title: nativeText('断开'), tone: 'bad', button: { title: nativeText('断开'), role: 'destructive', act: { name: 'disconnect', args: { id: connector.id } }, confirm: { title: nativeText('将要删除'), message: connector.name, button: nativeText('删除') } } })] }] };
    }
    const waiting = connected.some((connector) => connector.state?.status === 'waiting' || connector.busy === true);
    const sections = [{ rows: [link(nativeText('添加自定义连接器'), { section: 'connectors', target: 'add' }, { id: 'add', tone: 'muted' })] }];
    const connectorRow = (connector) => {
      const shown = describeState(connector.state, aboutLine(connector.about));
      return link(connector.name, { section: 'connectors', target: `connector:${connector.id}` }, { id: connector.id, icon: connector.icon, ...(shown.line ? { subtitle: shown.line } : {}), ...(shown.words ? { detail: shown.words, tone: shown.tone } : {}),
        ...actionsOf(context, [
          ...(shown.verb ? [{ title: VERB_WORDS[shown.verb], glyph: VERB_GLYPHS[shown.verb], act: { name: 'verb', args: { id: connector.id, verb: shown.verb } } }] : []),
          { title: nativeText('断开'), glyph: 'unplug', role: 'destructive', menuOnly: true, act: { name: 'disconnect', args: { id: connector.id } },
            confirm: { title: nativeText('将要删除'), message: connector.name, button: nativeText('删除') } },
        ]) });
    };
    // 已连接 is what works. One that waits for an authorization, needs a login or a command, or failed has never got there (owner, 2026-11-21: 「都没连接好，从来都没连接过，放在已连接里面干什么」):
    // it is listed among the available ones, with what its connection says and the one thing to do about it.
    const working = connected.filter(isConnected);
    const unconnected = connected.filter((connector) => !isConnected(connector));
    if (working.length) sections.push({ header: nativeText('已连接'), rows: working.map(connectorRow) });
    if (unconnected.length) sections.push({ header: nativeText('可用'), rows: unconnected.map(connectorRow) });
    const groups = new Map((catalog.groups ?? []).map((group) => [group.id, group]));
    for (const id of [...GROUP_ORDER, ...[...groups.keys()].filter((key) => !GROUP_ORDER.includes(key))]) {
      const group = groups.get(id);
      if (!group?.items?.length) continue;
      sections.push({ header: GROUP_NAMES[id] ?? id, rows: group.items.map((item) => row({
        id: item.id, title: item.name, icon: item.icon, ...(item.line ? { subtitle: item.line } : {}), button: { title: nativeText('连接'), act: { name: 'connect', args: { id: item.id } } },
      })) });
    }
    return { title: nativeText('连接器'), ...(waiting ? { poll: 1.5 } : {}), sections };
  }

  async function connectorsAct({ name, args, values }) {
    if (name === 'recognize') {
      const recognized = await ask('connectors/recognize', { text: text(values?.text).trim() });
      // `recognized` is the preview's values: an app that draws the add page itself builds it from them (`page` is the same page, for the one that does not).
      return ok(recognized) && recognized.kind ? { outcome: 'success', page: customConnector(recognized), recognized: shape(recognized, FIELDS['connectors/recognize']) } : false;
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
    // The phone's sign-in (apps after 0.1.1): the page to open, then the address the App's browser view stopped at; the answer says where the connection stands.
    if (name === 'signin' || name === 'signin-finish') {
      const answer = await ask(`connectors/${name}`, { id, ...(name === 'signin-finish' ? { url: text(args.url, 8192) } : {}) });
      const signin = shape(answer ?? {}, { id: true, url: true, code: true, status: true, message: true, tools: true });
      return ok(answer) ? { outcome: 'success', signin, back: true } : { outcome: 'error', message: nativeText(FAILED), signin };
    }
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
      if (answer.code === 'in_use') return { outcome: 'error', message: nativeText`还有收集器在用它：${new Intl.ListFormat(nativeLocale()).format(answer.collectors ?? [])}` };
      if (!ok(answer)) return false;
      return { outcome: 'success', back: true, ...(connector ? { toast: { message: nativeText`已删除 ${connector.name}` } } : {}) };
    }
    return false;
  }

  // --- 收集器 -----------------------------------------------------------------------------------------------------------------------------
  async function collectors(target, context = {}) {
    const form = /^(?:edit:|add$)/u.test(target ?? '');
    const [state, access, collected] = await Promise.all([ask('collectors/list'), ask('connectors/list'), form ? {} : ask('dispatch/state').catch(() => ({}))]);
    const list = state.collectors ?? [];
    const available = access.connectors ?? [];
    const [kind, ...rest] = String(target ?? '').split(':');
    if (kind === 'edit' || kind === 'add') {
      const collector = kind === 'edit' ? list.find((entry) => entry.id === rest.join(':')) : null;
      return { title: collector ? collector.name : nativeText('添加收集器'), save: { title: nativeText('保存'), act: { name: 'save', args: collector ? { id: collector.id } : {} } }, sections: [{ rows: [
        { id: 'name', kind: 'field', key: 'name', title: nativeText('名称'), value: collector?.name ?? '', placeholder: nativeText('名称') },
        { id: 'connector', kind: 'choice', key: 'connector', title: nativeText('连接器'), selected: collector?.connector ?? available[0]?.id ?? '',
          options: available.map((entry) => ({ id: entry.id, title: entry.name, subtitle: KIND_WORDS[entry.kind] })) },
        { id: 'frequency', kind: 'field', key: 'frequency', title: nativeText('频率，如 30m、2h、1d，或 cron'), value: collector?.frequency ?? '', placeholder: nativeText('频率，如 30m、2h、1d，或 cron'), mono: true },
        { id: 'common', kind: 'choice', key: 'common', title: nativeText('常用频率'), selected: '', options: [{ id: '', title: '—' }, ...PRESETS.map((preset) => ({ id: preset, title: PRESET_WORDS[preset], subtitle: preset }))] },
        { id: 'prompt', kind: 'field', key: 'prompt', title: nativeText('收集什么'), value: collector?.prompt ?? '', placeholder: nativeText('收集什么'), multiline: true },
      ] },
      // The delete is on the page of the collector too, not only a swipe or a long press away (owner, 2026-11-21).
      ...(collector ? [{ rows: [row({ id: 'remove', kind: 'action', title: nativeText('删除'), tone: 'bad', button: { title: nativeText('删除'), role: 'destructive',
        act: { name: 'remove', args: { id: collector.id } }, confirm: { title: nativeText('将要删除'), message: collector.name, button: nativeText('删除') } } })] }] : [])] };
    }
    const reads = new Map((collected.collectors ?? []).map((entry) => [entry.id, entry.lastRead]));
    const lastLine = (read) => {
      if (!read || !Number.isFinite(read.at)) return '';
      return read.ok ? (read.items > 0 ? nativeText`上次 ${when(read.at)} · 新增 ${read.items} 条` : nativeText`上次 ${when(read.at)} · 没有新的`) : nativeText`上次 ${when(read.at)} · 读取失败`;
    };
    const sections = [{ rows: [available.length
      ? link(nativeText('添加收集器'), { section: 'collectors', target: 'add' }, { id: 'add', tone: 'muted' })
      : row({ id: 'needConnector', title: nativeText('先添加一个连接器'), tone: 'muted' })] }];
    sections.push(list.length
      ? { header: nativeText('收集器'), rows: list.map((collector) => link(collector.name, { section: 'collectors', target: `edit:${collector.id}` }, {
        id: collector.id, icon: available.find((entry) => entry.id === collector.connector)?.icon,
        subtitle: joined([firstLine(collector.prompt), lastLine(reads.get(collector.id))]), detail: describeFrequency(collector.frequency),
        notification: { title: nativeText('通知'), on: collector.notify === true, act: { name: 'notify', args: { id: collector.id } } },
        ...actionsOf(context, [
          { title: nativeText('编辑'), glyph: 'pencil', to: { section: 'collectors', target: `edit:${collector.id}` }, menuOnly: true },
          { title: nativeText('删除'), glyph: 'trash', role: 'destructive', act: { name: 'remove', args: { id: collector.id } }, confirm: { title: nativeText('将要删除'), message: collector.name, button: nativeText('删除') } },
        ]),
      })) }
      : { rows: [row({ id: 'empty', title: nativeText('没有收集器'), tone: 'muted' })] });
    return { title: nativeText('收集器'), sections };
  }

  async function collectorsAct({ name, args, value, values, target }) {
    if (name === 'notify') {
      if (!['true', 'false'].includes(value)) return false;
      return ok(await ask('collectors/update', { id: text(args?.id, 200), notify: value === 'true' }));
    }
    if (name === 'save') {
      const fields = { name: text(values?.name, 100).trim(), connector: text(values?.connector, 200), frequency: (text(values?.frequency, 100).trim() || text(values?.common, 100)).trim(), prompt: text(values?.prompt).trim() };
      if (!fields.name || !fields.connector || !fields.prompt) return { outcome: 'error', message: nativeText(FAILED) };
      const answer = args?.id ? await ask('collectors/update', { id: text(args.id, 200), ...fields }) : await ask('collectors/add', fields);
      return ok(answer) ? { outcome: 'success', back: true } : { outcome: 'error', message: text(answer.message, 300) || nativeText(FAILED) };
    }
    if (name === 'remove') {
      const list = await ask('collectors/list');
      const collector = (list.collectors ?? []).find((entry) => entry.id === args?.id);
      const answer = await ask('collectors/remove', { id: text(args?.id, 200) });
      if (!ok(answer)) return false;
      // From the collector's own page the page is gone with it: back to the list.
      return { outcome: 'success', ...(String(target ?? '').startsWith('edit:') ? { back: true } : {}), ...(collector ? { toast: { message: nativeText`已删除 ${collector.name}` } } : {}) };
    }
    return false;
  }

  // --- 规则 -------------------------------------------------------------------------------------------------------------------------------
  async function rules(target) {
    const data = await ask('rules/get');
    const [kind, ...rest] = String(target ?? '').split(':');
    const name = rest.join(':');
    if (kind === 'edit' && Object.hasOwn(RULE_TITLES, name)) {
      const body = data.rules?.[name];
      return { title: name, save: { title: nativeText('保存'), act: { name: 'save', args: { name, previous: body ?? null, projectFolder: data.projectFolder ?? null } } },
        sections: [{ header: RULE_TITLES[name], rows: [{ id: 'text', kind: 'field', key: 'text', title: name, value: body ?? '', multiline: true, mono: true }] }] };
    }
    return { title: nativeText('规则'), sections: Object.keys(RULE_TITLES).map((file) => {
      const body = data.rules?.[file];
      return { header: RULE_TITLES[file], rows: [link(file, { section: 'rules', target: `edit:${file}` }, { id: file, mono: true, subtitle: body ? firstLine(body) : (body === null || body === undefined ? nativeText('未找到') : nativeText('空')) })] };
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
    return [updated && nativeText`更新 ${updated} 条`, counts.new && nativeText`新增 ${counts.new} 条`, counts.skill && nativeText`新增 ${counts.skill} 项技能`].filter(Boolean).join(nativeLocale() === 'en' ? ', ' : '，') || nativeText('没有变更');
  };

  async function memory(target, context = {}) {
    const [records, reviews] = await Promise.all([ask('memory/records'), ask('memory/reviews', { limit: 10 })]);
    const list = records.records ?? [];
    const [kind, ...rest] = String(target ?? '').split(':');
    const forgetting = (record) => ({ title: nativeText('忘记'), glyph: 'trash', role: 'destructive', act: { name: 'forget', args: { id: record.id } },
      confirm: { title: nativeText('将要删除'), message: nativeText`${record.text}\n会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。`, button: nativeText('删除') } });
    if (kind === 'edit') {
      const record = list.find((entry) => String(entry.id) === rest.join(':'));
      // 忘记 is on the page of the memory too, in red with what it deletes under it (owner, 2026-11-21).
      return { title: nativeText('编辑'), save: { title: nativeText('保存'), act: { name: 'save', args: { id: record?.id } } }, sections: [{ rows: [{ id: 'text', kind: 'field', key: 'text', title: nativeText('编辑'), value: record?.text ?? '', multiline: true }] },
        ...(record ? [{ footer: nativeText('会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。'), rows: [row({ id: 'forget', kind: 'action', title: nativeText('忘记'), tone: 'bad',
          button: { title: nativeText('忘记'), role: 'destructive', act: forgetting(record).act, confirm: forgetting(record).confirm } })] }] : [])] };
    }
    return { title: nativeText('记忆'), sections: [
      list.length ? { header: nativeText('记忆'), rows: list.map((record) => link(record.text, { section: 'memory', target: `edit:${record.id}` }, {
        id: String(record.id), subtitle: joined([record.file, nativeText`自 ${record.since}`, record.status === 'superseded' ? nativeText('已替代') : '']),
        ...actionsOf(context, [{ title: nativeText('编辑'), glyph: 'pencil', to: { section: 'memory', target: `edit:${record.id}` }, menuOnly: true }, forgetting(record)]),
      })) } : { rows: [row({ id: 'empty', title: nativeText('还没有记住的事'), tone: 'muted' })] },
      { header: nativeText('整理记录'), rows: (reviews.reviews ?? []).length
        ? reviews.reviews.map((review) => row({ id: String(review.id), title: summary(review.summary), subtitle: review.at ? when(review.at) : '' }))
        : [row({ id: 'noReviews', title: nativeText('还没有整理记录'), tone: 'muted' })] },
    ] };
  }

  async function memoryAct({ name, args, values, target }) {
    if (name === 'save') {
      const body = text(values?.text).trim();
      if (!body) return { outcome: 'error', message: nativeText(FAILED) };
      return ok(await ask('memory/update', { id: args?.id, text: body })) ? { outcome: 'success', back: true } : false;
    }
    // From the memory's own page the page is gone with it: back to the list.
    if (name === 'forget') return ok(await ask('memory/forget', { source: `record:${args?.id}`, preview: false })) ? { outcome: 'success', ...(String(target ?? '').startsWith('edit:') ? { back: true } : {}) } : false;
    return false;
  }

  // --- 技能 -------------------------------------------------------------------------------------------------------------------------------
  async function skills(target, context = {}) {
    const [kind, ...rest] = String(target ?? '').split(':');
    if (kind === 'skill') {
      const name = rest.join(':');
      const one = await ask('skills/read', { name });
      return { title: name, sections: [
        { header: name, rows: [row({ id: 'text', title: one.text ?? one.skill?.text ?? '', mono: true })] },
        { rows: [row({ id: 'delete', kind: 'action', title: nativeText('删除'), tone: 'bad', button: { title: nativeText('删除'), role: 'destructive', act: { name: 'remove', args: { name } }, confirm: { title: nativeText('将要删除'), message: name, button: nativeText('删除') } } })] },
      ] };
    }
    const list = (await ask('skills/list')).skills ?? [];
    return { title: nativeText('技能'), sections: [list.length
      ? { header: nativeText('技能'), rows: list.map((skill) => link(skill.name, { section: 'skills', target: `skill:${skill.name}` }, { id: skill.name, ...(skill.description ? { subtitle: skill.description } : {}),
        ...actionsOf(context, [{ title: nativeText('删除'), glyph: 'trash', role: 'destructive', act: { name: 'remove', args: { name: skill.name } }, confirm: { title: nativeText('将要删除'), message: skill.name, button: nativeText('删除') } }]) })) }
      : { rows: [row({ id: 'empty', title: nativeText('还没有技能'), tone: 'muted' })] }] };
  }

  async function skillsAct({ name, args, target }) {
    if (name !== 'remove') return false;
    return ok(await ask('skills/remove', { name: text(args?.name, 200) })) ? { outcome: 'success', back: String(target ?? '').startsWith('skill:') } : false;
  }

  // --- 供应商 (the apps after 0.1.1; owner, 2026-11-24, .local/designs/providers-redesign-2026-11-24): the harnesses found on this computer in two groups, each opening its page
  // (its switch, its path, its own environment variables, saved together). An app lays the page out itself from `settings.data`; this is the same page, as the plugin describes it.
  const PROVIDER_STATES = { ready: '可用', missing: '未找到', unsupported: '版本不受支持', broken: '无法运行' };
  const stateLine = (provider) => [nativeText(PROVIDER_STATES[provider.state] ?? '无法运行'), provider.version].filter(Boolean).join(' ');
  const envText = (env) => Object.entries(env ?? {}).map(([name, value]) => `${name}=${value}`).join('\n');
  async function providers(target) {
    const list = (await ask('providers/state')).providers ?? [];
    const [kind, ...rest] = String(target ?? '').split(':');
    if (kind === 'provider') {
      const provider = list.find((entry) => entry.id === rest.join(':'));
      if (!provider) return { title: nativeText('供应商'), sections: [] };
      return { title: provider.name, save: { title: nativeText('保存'), act: { name: 'save', args: { id: provider.id } } }, sections: [
        { rows: [row({ id: 'about', title: provider.name, subtitle: stateLine(provider), ...(provider.reason && provider.state !== 'ready' && provider.state !== 'missing' ? { detail: provider.reason } : {}) }),
          { id: 'enabled', kind: 'switch', title: nativeText('启用'), on: provider.enabled === true, act: { name: 'enable', args: { id: provider.id } } }] },
        { header: nativeText('可执行文件路径'), footer: provider.path || undefined, rows: [{ id: 'path', kind: 'field', title: nativeText('可执行文件路径'), key: 'path', value: provider.configuredPath ?? '', placeholder: nativeText('留空则自动查找'), mono: true }] },
        { header: nativeText('环境变量'), rows: [{ id: 'env', kind: 'field', title: nativeText('环境变量'), key: 'env', value: envText(provider.env), placeholder: 'HTTPS_PROXY=http://127.0.0.1:7890', multiline: true, mono: true }] },
      ] };
    }
    const folded = (provider) => (provider.folds || provider.defaultEnabled === false) && provider.state === 'missing';
    const rowOf = (provider) => link(provider.name, { section: 'providers', target: `provider:${provider.id}` }, { id: provider.id, subtitle: stateLine(provider) });
    const on = list.filter((provider) => !folded(provider) && provider.enabled);
    const off = list.filter((provider) => !folded(provider) && !provider.enabled);
    const missing = list.filter(folded);
    return { title: nativeText('供应商'), sections: [
      ...(on.length ? [{ header: nativeText('已启用'), rows: on.map(rowOf) }] : []),
      ...(off.length ? [{ header: nativeText('未启用'), rows: off.map(rowOf) }] : []),
      ...(missing.length ? [{ header: nativeText('未找到'), rows: missing.map(rowOf) }] : []),
    ] };
  }

  async function providersAct({ name, args, value, values }) {
    const done = (answer) => Array.isArray(answer?.providers);
    if (name === 'refresh') return done(await ask('providers/refresh')) ? { outcome: 'success' } : false;
    const id = text(args?.id, 80);
    if (!id) return false;
    if (name === 'enable') return done(await ask('providers/save', { id, enabled: value === 'true' })) ? { outcome: 'success' } : false;
    if (name === 'save') {
      const patch = { id, ...(typeof values?.path === 'string' ? { path: values.path } : {}), ...(typeof values?.env === 'string' ? { env: values.env } : {}) };
      return done(await ask('providers/save', patch)) ? { outcome: 'success' } : false;
    }
    return false;
  }

  const SECTIONS = {
    general: { page: general, act: generalAct },
    statuses: { page: statuses, act: statusesAct },
    connectors: { page: connectors, act: connectorsAct },
    collectors: { page: collectors, act: collectorsAct },
    rules: { page: rules, act: rulesAct },
    memory: { page: memory, act: memoryAct },
    skills: { page: skills, act: skillsAct },
    providers: { page: providers, act: providersAct },
  };

  // The phone's web pages are the seven of DUDU_PAGE_SECTIONS; the apps that draw their own pages also have 供应商 (2026-11-24).
  const sectionOf = (params) => (typeof params?.section === 'string' && (DUDU_PAGE_SECTIONS.includes(params.section) || params.section === 'providers') ? SECTIONS[params.section] : null);
  const targetOf = (params) => (typeof params?.target === 'string' ? params.target.slice(0, 300) : undefined);

  /** The values a page is made of (`settings.data`): the answers of the actions it reads, each cut down to what a page reads of it (`FIELDS`). */
  async function dataOf(sectionName, target) {
    const entries = await Promise.all(READS[sectionName](target).map(async ([action, body = {}, optional = false]) => {
      const answer = optional ? await ask(action, body).catch(() => ({})) : await ask(action, body);
      return [action, shape(answer, FIELDS[action])];
    }));
    return Object.fromEntries(entries);
  }

  return {
    // `context.client` is what the phone declared (native-client.mjs): a page takes a new shape only for a phone that understands it (`settings.rich`, above); the others are answered as before.
    async dispatch(method, params, context = {}) {
      const section = sectionOf(params);
      if (!section) return { outcome: 'needs_clarification', message: nativeText(LOAD_FAILED) };
      const target = targetOf(params);
      try {
        if (method === 'settings.data') return { outcome: 'success', data: await dataOf(params.section, target) };
        if (method === 'settings.page') return { outcome: 'success', page: await section.page(target, context) };
        const values = isRecord(params.values) ? Object.fromEntries(Object.entries(params.values).slice(0, 100).map(([key, value]) => [text(key, 40), text(value)])) : undefined;
        const result = await section.act({ name: text(params.name, 40), args: isRecord(params.args) ? params.args : {}, value: typeof params.value === 'string' ? params.value.slice(0, MAX_TEXT) : undefined, values, target });
        const answer = result === true ? { outcome: 'success' } : result === false ? { outcome: 'error', message: nativeText(FAILED) } : result;
        // The page that comes back with an action is drawn for the same phone as the one it was asked by: a phone that understands more must not be handed the old shape after its first tap.
        if (answer.outcome === 'success' && !answer.back && !answer.page) return { ...answer, page: await section.page(target, context) };
        return answer;
      } catch {
        return { outcome: 'error', message: method === 'settings.act' ? nativeText(FAILED) : nativeText(LOAD_FAILED) };
      }
    },
  };
}
