import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DUDU_ICONS } from './native-navigation-icons.mjs';
import { nativeLocale, nativeText } from './native-locale.mjs';

/**
 * Navigation for the phone: the sidebar panels, conversation views and settings
 * sections DSH shows, as DSH itself registered them.
 *
 * Those registries live in DSH's browser runtime. The dsbot client module reads them there (so a
 * plugin that adds a panel or a conversation tab shows up here by itself) and posts a snapshot to
 * `ingest`. The phone only ever sees the validated snapshot from `get`, with an `open` descriptor per
 * item that says how to show it. The routing below is the single place that knows DSH's ids, so a DSH
 * change is fixed by updating this plugin and the app needs no release.
 */
export const NAVIGATION_SCHEMA_VERSION = 1;

const MAX_ITEMS = 64;
const MAX_ICON_NODES = 48;
const MAX_ICON_BYTES = 16 * 1024;
// An icon the browser had to draw itself (a mask, a clip, a gradient): a small PNG whose shape the phone tints.
const MAX_PNG_BASE64 = 16 * 1024;
const MAX_PNG_SIDE = 128;
const PNG_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_FILE_BYTES = 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,127}$/u;
const PAINT = /^(?:none|currentColor|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/u;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/u;
const POINTS = /^[0-9eE.,\s+-]*$/u;

/** Geometry attributes an icon node may carry, per tag. `d` and `points` are strings, the rest numbers. */
const ICON_TAGS = Object.freeze({
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
});

const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value, limit = 10_000) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function cleanId(value) {
  return typeof value === 'string' && ID.test(value) ? value : '';
}

/** A PNG the browser drew: a real, small PNG and nothing else, re-checked here before the phone sees it. */
function sanitizeRaster(value, box) {
  const png = value.png;
  if (typeof png !== 'string' || png.length < 32 || png.length > MAX_PNG_BASE64 || !PNG_BASE64.test(png)) return undefined;
  const bytes = Buffer.from(png, 'base64');
  // Signature, then the IHDR chunk (length, name, width, height).
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
    || bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 8 || height < 8 || width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) return undefined;
  return { viewBox: box, nodes: [], png, width, height };
}

/** One icon as plain data: no markup is ever parsed on the way to the phone. */
export function sanitizeIcon(value) {
  if (!record(value)) return undefined;
  const box = value.viewBox;
  if (!Array.isArray(box) || box.length !== 4 || !box.every((item) => finite(item, 4096))
    || !(box[2] > 0) || !(box[3] > 0) || box[2] > 1024 || box[3] > 1024) return undefined;
  if (value.png !== undefined) return sanitizeRaster(value, box);
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > MAX_ICON_NODES) return undefined;

  const nodes = [];
  for (const node of value.nodes) {
    if (!record(node) || !Object.hasOwn(ICON_TAGS, node.tag)) return undefined;
    const clean = { tag: node.tag };
    for (const name of ICON_TAGS[node.tag]) {
      const item = node[name];
      if (item === undefined) continue;
      if (name === 'd') {
        if (typeof item !== 'string' || item.length > 4096 || !PATH_DATA.test(item)) return undefined;
      } else if (name === 'points') {
        if (typeof item !== 'string' || item.length > 2048 || !POINTS.test(item)) return undefined;
      } else if (!finite(item)) {
        return undefined;
      }
      clean[name] = item;
    }
    if (node.tag === 'path' && typeof clean.d !== 'string') return undefined;
    for (const name of ['fill', 'stroke']) {
      if (node[name] === undefined) continue;
      if (typeof node[name] !== 'string' || !PAINT.test(node[name])) return undefined;
      clean[name] = node[name];
    }
    if (node.strokeWidth !== undefined) {
      if (!finite(node.strokeWidth, 16) || node.strokeWidth < 0) return undefined;
      clean.strokeWidth = node.strokeWidth;
    }
    if (node.opacity !== undefined) {
      if (!finite(node.opacity, 1) || node.opacity < 0) return undefined;
      clean.opacity = node.opacity;
    }
    if (node.strokeLinecap !== undefined) {
      if (!['butt', 'round', 'square'].includes(node.strokeLinecap)) return undefined;
      clean.strokeLinecap = node.strokeLinecap;
    }
    if (node.strokeLinejoin !== undefined) {
      if (!['miter', 'round', 'bevel'].includes(node.strokeLinejoin)) return undefined;
      clean.strokeLinejoin = node.strokeLinejoin;
    }
    if (node.fillRule !== undefined) {
      if (!['nonzero', 'evenodd'].includes(node.fillRule)) return undefined;
      clean.fillRule = node.fillRule;
    }
    if (node.matrix !== undefined) {
      if (!Array.isArray(node.matrix) || node.matrix.length !== 6 || !node.matrix.every((item) => finite(item))) return undefined;
      clean.matrix = node.matrix;
    }
    nodes.push(clean);
  }
  const icon = { viewBox: box, nodes };
  return Buffer.byteLength(JSON.stringify(icon), 'utf8') <= MAX_ICON_BYTES ? icon : undefined;
}

// ---- Routing: how the phone opens each DSH entry ---------------------------------------------

const web = (page, target) => ({ web: { page, ...(target ? { target } : {}) } });

const CONTEXT_VIEW = /^(?:context|dsh-?context|dshContext)$/iu;
const TEAM_VIEW = /^(?:team|fleet|agent-?team|dsh-?team|dsh-?fleet)$/iu;
const CONTEXT_TITLE = /^(?:上下文|context)$/iu;
const TEAM_TITLE = /^(?:编队|团队|team|fleet)$/iu;

function sidebarRoute(item) {
  switch (item.id) {
    case 'plugins': return web('plugins');
    default: return web('panel', item.id);
  }
}

function viewRoute(item) {
  if (item.id === 'chat') return { native: 'chat' };
  if (item.id === 'trajectory') return web('trace', item.id);
  if (CONTEXT_VIEW.test(item.id) || CONTEXT_TITLE.test(item.title)) return web('context', item.id);
  if (TEAM_VIEW.test(item.id) || TEAM_TITLE.test(item.title)) return web('team', item.id);
  return web('view', item.id);
}

const settingsRoute = (item) => web('settings', item.id);

// ---- Sanitizing --------------------------------------------------------------------------------

function listOf(value, build) {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set();
  const items = [];
  for (const raw of value.slice(0, MAX_ITEMS * 2)) {
    if (!record(raw)) continue;
    const item = build(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.order - b.item.order || a.index - b.index)
    .map(({ item }) => item);
}

function common(raw, id = cleanId(raw.id)) {
  const title = cleanText(raw.title, 80);
  if (!id || !title) return undefined;
  const source = cleanText(raw.source, 128);
  const titles = {};
  if (record(raw.titles)) {
    for (const language of ['zh', 'en']) {
      const value = cleanText(raw.titles[language], 80);
      if (value) titles[language] = value;
    }
  }
  return { id, title, order: finite(raw.order, 1e6) ? raw.order : 0, ...(source ? { source } : {}),
    ...(Object.keys(titles).length ? { titles } : {}) };
}

/** Panels the phone cannot open: the 嘟嘟 page browses the sessions of the harnesses on the desktop, and only DSH's own window has it. */
const HIDDEN_PANELS = new Set(['dudu']);

function buildSidebar(raw) {
  const base = common(raw);
  if (!base || HIDDEN_PANELS.has(base.id)) return undefined;
  const icon = sanitizeIcon(raw.icon);
  return { ...base, ...(icon ? { icon } : {}), open: sidebarRoute(base) };
}

function buildView(raw) {
  const base = common(raw);
  if (!base) return undefined;
  return { ...base, open: viewRoute(base) };
}

/** Sections the phone has no use for: pairing configures the desktop, and general settings are the
 * desktop's appearance, language and shortcuts. */
// The plugin's own section is hidden under both of its names: a DSH window may still run the client module of the plugin's former name.
const HIDDEN_SETTINGS = new Set(['dudu-mobile-control', 'dudu-providers', 'dsbot-mobile-control', 'general']);

function buildSettings(raw) {
  const base = common(raw);
  if (!base || HIDDEN_SETTINGS.has(base.id)) return undefined;
  const icon = sanitizeIcon(raw.icon);
  return { ...base, ...(icon ? { icon } : {}), open: settingsRoute(base) };
}

const LISTS = Object.freeze({
  sidebar: buildSidebar,
  views: buildView,
  settings: buildSettings,
});

/** Validate a posted snapshot. A list that is absent is left as it was; an empty one clears it. */
export function sanitizeSnapshot(raw) {
  if (!record(raw) || raw.schemaVersion !== NAVIGATION_SCHEMA_VERSION) return undefined;
  const lists = {};
  for (const [name, build] of Object.entries(LISTS)) {
    const list = listOf(raw[name], build);
    if (list) lists[name] = list;
  }
  return lists;
}

/**
 * An entry that arrives without the icon it had keeps that icon. An icon DSH's window draws itself
 * (a mask, say) can fail to draw on one report and succeed on the next; without this the entry's picture
 * would come and go on the phone with each report.
 */
function keepKnownIcons(previous, lists) {
  for (const name of ['sidebar', 'settings']) {
    if (!lists[name]) continue;
    const known = new Map((previous[name] ?? []).filter((item) => item.icon).map((item) => [item.id, item.icon]));
    lists[name] = lists[name].map((item) => {
      if (item.icon || !known.has(item.id)) return item;
      // Same field order as an item built with its icon, so an unchanged report compares equal.
      const { open, ...base } = item;
      return { ...base, icon: known.get(item.id), open };
    });
  }
}

// ---- What 嘟嘟 adds itself ----------------------------------------------------------------------
//
// Besides what DSH reports, the phone's lists carry what the plugin itself has to offer. The owner
// approved the aligned disclosure on 2026-11-08, with 嘟嘟, 看板, 信息 as the primary entries, and on 2026-11-10 the tasks (定时任务, 任务 since 2026-11-11) as the fourth.
// Other sidebar entries remain the registry's, folded under 查看更多 by the app. "信息" is the owner's phone page name;
// the settings pages keep the desktop's names, and "其他设置" is the owner's: one entry that leads to
// DSH's own settings pages, so that those are no longer listed beside 嘟嘟's. A settings entry of 嘟嘟's has `group: 'dudu'`; DSH's have none.
const DUDU_SIDEBAR = Object.freeze([
  Object.freeze({ id: 'dudu.conversation', title: '嘟嘟', order: -1000, group: 'primary', open: { native: 'assistant' }, source: 'dudu' }),
  // The board remains the start page; it is not the parent of the other sidebar entries.
  Object.freeze({ id: 'dudu.board', title: '看板', order: -999, group: 'primary', icon: DUDU_ICONS.board, open: { native: 'board' }, source: 'dudu' }),
  Object.freeze({ id: 'dudu.collector', title: '信息', order: -998, group: 'primary', icon: DUDU_ICONS.information, open: { native: 'collector' }, source: 'dudu' }),
  // Only Dudu's own task entry uses this native screen; DSH panels retain their registered web route.
  Object.freeze({ id: 'dudu.tasks', title: '任务', order: -997, group: 'primary', icon: DUDU_ICONS.tasks, open: { native: 'schedule', target: 'dudu-tasks' }, source: 'dudu' }),
]);

/** The app draws 嘟嘟's settings itself. The web fallback is only for phones predating the native route. */
const DUDU_SECTIONS = Object.freeze([
  ['general', '通用'], ['statuses', '状态'], ['connectors', '连接器'], ['collectors', '收集器'], ['rules', '规则'], ['memory', '记忆'], ['skills', '技能'],
]);
const DUDU_SETTINGS = Object.freeze([
  ...DUDU_SECTIONS.map(([section, title], index) => Object.freeze({
    id: `dudu.${section}`, title, order: -1000 + index, group: 'dudu', icon: DUDU_ICONS[section],
    open: { native: 'dudu-settings', target: section, ...web('dudu', section) }, source: 'dudu',
  })),
  Object.freeze({ id: 'dudu.dsh', title: '其他设置', order: -1000 + DUDU_SECTIONS.length, group: 'dudu', icon: DUDU_ICONS.dsh, open: { native: 'dsh-settings' }, source: 'dudu' }),
]);

// ---- Store ---------------------------------------------------------------------------------------

export async function createNavigationStore({ folder, now = Date.now } = {}) {
  const path = folder ? join(folder, 'navigation.json') : undefined;
  let current = { sidebar: [], views: [], settings: [] };
  let updatedAt = 0;
  let saving = Promise.resolve();

  if (path) {
    try {
      const stored = JSON.parse(await readFile(path, 'utf8'));
      // Routes are recomputed from the stored fields, so a plugin update re-routes an old snapshot.
      const lists = sanitizeSnapshot({ ...stored, schemaVersion: NAVIGATION_SCHEMA_VERSION });
      if (lists && Number.isFinite(stored?.updatedAt)) {
        current = { ...current, ...lists };
        updatedAt = stored.updatedAt;
      }
    } catch { /* No snapshot yet, or an unreadable one: wait for DSH to report. */ }
  }

  const persist = (value, time) => {
    if (!path) return saving;
    saving = saving.then(async () => {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      const body = JSON.stringify({ schemaVersion: NAVIGATION_SCHEMA_VERSION, updatedAt: time, ...value });
      if (Buffer.byteLength(body, 'utf8') > MAX_FILE_BYTES) return;
      await writeFile(temporary, body, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    }).catch(() => {});
    return saving;
  };

  return {
    /** What the phone receives: what DSH reported, with what 嘟嘟 adds in front. */
    get() {
      const owned = (entry) => ({ ...entry, title: nativeText(entry.title) });
      const registered = (entry) => {
        const { titles, ...item } = entry;
        return { ...item, title: titles?.[nativeLocale() === 'en' ? 'en' : 'zh'] ?? item.title };
      };
      return {
        schemaVersion: NAVIGATION_SCHEMA_VERSION,
        available: updatedAt > 0,
        updatedAt,
        ...current,
        sidebar: [...DUDU_SIDEBAR.map(owned), ...current.sidebar.map(registered)],
        views: current.views.map(registered),
        settings: [...DUDU_SETTINGS.map(owned), ...current.settings.map(registered)],
      };
    },
    /** A snapshot read from DSH's registries; returns whether anything changed. */
    async ingest(raw) {
      const lists = sanitizeSnapshot(raw);
      if (!lists) throw new TypeError('Unsupported navigation snapshot.');
      keepKnownIcons(current, lists);
      const next = { ...current, ...lists };
      if (updatedAt > 0 && JSON.stringify(next) === JSON.stringify(current)) return false;
      current = next;
      updatedAt = now();
      await persist(current, updatedAt);
      return true;
    },
    async close() {
      await saving;
    },
  };
}
