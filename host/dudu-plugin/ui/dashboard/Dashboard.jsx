import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GridStack } from 'gridstack';
import { Check, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { useToast } from '../components/toast.jsx';
import { cn } from '../lib/cn.js';
import { isTyping } from '../lib/typing.js';
import { T } from '../strings.js';
import { AddWidgetDialog } from './AddWidgetDialog.jsx';
import { dashboardApi } from './api.js';
import { Lattice } from './Lattice.jsx';
import { COLUMNS, FILL_ROWS, MAX_ROWS } from '../../../assistant/dashboard/widgets.mjs';
import { extent, GAP, metrics, span } from './metrics.js';
import { WidgetPreview } from '../widgets/WidgetPreview.jsx';
import { Entry } from './Entry.jsx';

const D = T.dashboard;
const HANDLES = 'e,w,n,s,se,ne,sw';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const sizeText = (w, h) => `${w}×${h}`;
/** The rows a widget that fills its height has in a window that shows `rows`: all of them, and never fewer than its own minimum. */
const filled = (declared, rows) => Math.max(declared?.min.h ?? 1, rows);
/** Puts the animation back once what changed while it was off has been laid out: that change must not slide in when the animation returns. */
const animateAgain = (instance) => {
  void instance.el.offsetHeight;
  instance.setAnimation(true, true);
};

function changeLabel(undo, byType) {
  const change = undo.change;
  const name = byType[change?.type]?.label ?? change?.type;
  return ({
    add: () => D.actionAdded(name), remove: () => D.actionRemoved(name), move: () => D.actionMoved(name),
    resize: () => D.actionResized(name, change.w, change.h), reset: () => D.restored, many: () => D.changed,
  })[change?.kind]?.() ?? undo.label;
}


/** A widget that throws shows this instead of itself and takes nothing else down with it. */
class Guard extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn('[dudu] A widget failed:', error); }
  componentDidUpdate(previous) {
    if (previous.reset !== this.props.reset && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center text-muted-foreground">
        <span>{D.broken()}</span>
        {this.props.source && <span className="text-xs">{D.brokenFrom(this.props.source)}</span>}
        <Button variant="ghost" size="sm" onClick={this.props.remove}>{D.remove}</Button>
      </div>
    );
  }
}

// A widget of a plugin that is not installed keeps its place and says where it came from.
const sourceOf = (type) => (type.includes('.') ? type.slice(0, type.indexOf('.')) : null);

/**
 * The dashboard: widgets on a grid of square cells, laid out by gridstack (see dashboard.css for the rules of its look). The
 * page owns what gridstack cannot: which widgets there are, how big a cell is for this window, saving, undo, the edit bar and the
 * keyboard. A widget is a React component rendered into the cell gridstack made for it.
 *
 * `registry` is the list of widget declarations with their `Component`; `services` is what widgets may read (issues and so on).
 */
export function Dashboard({ request, registry, onSettings, onSessions }) {
  const api = useMemo(() => dashboardApi(request), [request]);
  const toast = useToast();
  const byType = useMemo(() => Object.fromEntries(registry.map((widget) => [widget.id, widget])), [registry]);
  const page = useRef(null);
  const board = useRef(null);
  const grid = useRef(null);
  const [area, setArea] = useState(null);
  const [items, setItems] = useState(null); // what is on the board: { id, type, x, y, w, h, fill }
  const [hosts, setHosts] = useState({}); // id -> the element a widget renders into
  const [status, setStatus] = useState('loading');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [chip, setChip] = useState(null); // { text, x, y } beside the pointer while resizing
  const [developer, setDeveloper] = useState(false);
  const pending = useRef(0);
  const revision = useRef(0);
  const shown = useRef(null); // the `at` of the newest change this page has offered Undo for (or found there at load): never offered twice
  const M = useMemo(() => (area ? metrics(area) : null), [area]);
  // What is on the board for this window: the default Issues is "all the columns" and "all the rows", so its size is the window's until it
  // is pulled.
  const placed = useMemo(() => (M && items ? items.map((item) => ({
    ...item,
    ...(item.fill ? { x: 0, w: M.cols } : {}),
    ...(item.fillH ? { y: 0, h: filled(byType[item.type], M.rows) } : {}),
  })) : null), [M, items, byType]);
  const shape = useMemo(() => (M && placed ? extent(placed, { cols: M.cols, rows: M.rows }) : null), [M, placed]);

  // What the gridstack callbacks need is read from here, so they never act on an old render.
  const live = useRef({});
  live.current = { items, M, byType, api, toast, editing, adding };
  useEffect(() => {
    let active = true;
    request('assistant/settings').then((value) => { if (active) setDeveloper(value.settings?.widgets?.developer === true); }).catch(() => {});
    return () => { active = false; };
  }, [request]);

  const nameOf = (type) => live.current.byType[type]?.label ?? type;
  // `fill` is the width (every column), `fillH` the height (every row the window shows): until the widget is pulled it follows the window.
  const fromWire = (list, cols, rows, declared) => list.map((item) => ({
    id: item.id, type: item.type, x: item.x, y: item.y, fill: item.w === 'fill', fillH: item.h === 'fill',
    w: item.w === 'fill' ? cols : item.w, h: item.h === 'fill' ? filled(declared[item.type], rows) : item.h,
  }));
  const toWire = (list) => list.map((item) => ({ id: item.id, type: item.type, x: item.x, y: item.y, w: item.fill ? 'fill' : item.w, h: item.fillH ? 'fill' : item.h }));

  // ---- the area the board may use, and the cell size for it
  useEffect(() => {
    const element = page.current;
    if (!element) return undefined;
    const measure = () => {
      setArea({ width: Math.max(0, element.clientWidth - 48), height: Math.max(0, element.clientHeight - 20) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---- gridstack: one instance for the life of the page
  const spec = useCallback((item) => {
    const declared = live.current.byType[item.type];
    return { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h, minW: declared?.min.w ?? 1, minH: declared?.min.h ?? 1, maxH: Math.max(MAX_ROWS, item.h), content: '' };
  }, []);

  // Where the board's items are now, as the page keeps them (gridstack moves them itself while a widget is dragged or resized).
  const read = useCallback(() => {
    const nodes = grid.current?.engine.nodes ?? [];
    return live.current.items.map((item) => {
      const node = nodes.find((candidate) => candidate.id === item.id);
      if (!node) return item;
      const moved = { ...item, x: node.x, y: node.y, w: node.w, h: node.h };
      // What fills stops filling when it is not where filling puts it any more (something was dropped on it and it was pushed away).
      if (item.fill && (node.x !== 0 || node.w !== COLUMNS)) moved.fill = false;
      if (item.fillH && node.y !== 0) moved.fillH = false;
      return moved;
    });
  }, []);

  // `row` is the height of a row: the grid's own cell is a column wide and a row tall (the rows share the window's height), and gridstack
  // counts the pitch of a row; its columns are a share of the board's width, which the page sets.
  const applyMetrics = useCallback((columns, row) => {
    const instance = grid.current;
    if (!instance) return;
    const pitch = row + GAP;
    if (instance.getColumn() === columns && instance.getCellHeight() === pitch) return;
    instance.setAnimation(false);
    // Narrowing makes gridstack keep the old layout to restore when it widens again, which would undo what was moved in between.
    instance.engine._layouts = undefined;
    if (instance.getCellHeight() !== pitch) instance.cellHeight(pitch);
    if (instance.getColumn() !== columns) instance.column(columns, 'none');
    instance.engine._layouts = undefined;
    animateAgain(instance);
  }, []);

  const build = useCallback((list) => {
    const instance = grid.current;
    if (!instance) return;
    instance.setAnimation(false);
    instance.removeAll(); // not inside batchUpdate: then the old widgets stay on the page
    instance.batchUpdate();
    const found = {};
    for (const item of list) found[item.id] = instance.addWidget(spec(item))?.querySelector('.grid-stack-item-content') ?? null;
    instance.batchUpdate(false);
    instance.setAnimation(true, true);
    setHosts(found);
    live.current.items = list;
    setItems(list);
  }, [spec]);

  // Showing a layout from the plugin (first load, Undo, Restore default, Add).
  const show = useCallback((wire, { flash } = {}) => {
    const list = fromWire(wire, live.current.M?.cols ?? COLUMNS, live.current.M?.rows ?? FILL_ROWS, live.current.byType);
    const columns = COLUMNS;
    if (live.current.M) applyMetrics(columns, live.current.M.row);
    build(list);
    if (flash) {
      requestAnimationFrame(() => {
        const element = grid.current?.engine.nodes.find((node) => node.id === flash)?.el;
        element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        element?.querySelector('.db-card')?.classList.add('db-flash');
        setTimeout(() => element?.querySelector('.db-card')?.classList.remove('db-flash'), 1400);
      });
    }
  }, [applyMetrics, build]); // eslint-disable-line react-hooks/exhaustive-deps -- fromWire only reads what it is given

  const load = useCallback(async () => {
    revision.current++;
    setStatus('loading');
    try {
      const result = await live.current.api.get(live.current.M?.rows);
      if (result.outcome !== 'success') throw new Error(result.message);
      setStatus('ready');
      show(result.items);
      shown.current = result.undo?.at ?? null;
    } catch { setStatus('error'); }
  }, [show]);

  // The bar offers Undo for the newest change only (the plugin keeps one), so each new bar replaces the one before it.
  const undoable = useCallback((undo) => {
    shown.current = undo.at;
    return {
      key: 'layout', message: () => changeLabel(undo, live.current.byType),
      action: {
        label: D.undo,
        run: async () => {
          pending.current++;
          revision.current++;
          try {
            const result = await live.current.api.undo(live.current.M?.rows);
            if (result.outcome === 'success') show(result.items);
          } catch { live.current.toast({ message: D.saveFailed }); }
          finally { pending.current--; }
        },
      },
    };
  }, [show]);

  // Saving what a gesture or a key changed: the plugin keeps the layout and words the change (Moved "Overview", ...); what it answers
  // (corrected, if it had to) is what is shown, and the bar offers Undo for that one change.
  const save = useCallback(async (list, type) => {
    pending.current++;
    revision.current++;
    live.current.items = list;
    setItems(list);
    try {
      const result = await live.current.api.set(toWire(list), type, live.current.M?.rows);
      if (result.outcome === 'no_op') return;
      if (result.outcome !== 'success') throw new Error(result.message);
      const key = (wire) => JSON.stringify(wire.map((item) => [item.id, item.x, item.y, item.w, item.h]));
      if (key(toWire(list)) !== key(result.items)) show(result.items);
      if (result.undo) live.current.toast(undoable(result.undo));
    } catch { live.current.toast({ message: D.saveFailed }); load(); }
    finally { pending.current--; }
  }, [load, show, undoable]);

  // Conversation tools can change the layout. Read it only between local edits, and discard answers that raced a gesture. What is on the
  // board is compared as it is (not as it was saved): a taller window makes the widget that fills it push the ones below, and that is not a
  // change to announce.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    let active = true;
    let timer;
    const idle = () => !pending.current && !gesture.current && !live.current.editing && !live.current.adding;
    const refresh = async () => {
      if (!active) return;
      if (document.visibilityState !== 'hidden' && idle()) {
        const at = revision.current;
        try {
          const result = await live.current.api.get(live.current.M?.rows);
          if (active && at === revision.current && idle() && result.outcome === 'success' &&
              JSON.stringify(result.items) !== JSON.stringify(toWire(read()))) {
            show(result.items);
            if (result.undo && result.undo.at !== shown.current) live.current.toast(undoable(result.undo));
          }
        } catch { /* Keep the current layout; the next visible poll retries. */ }
      }
      if (active) timer = setTimeout(refresh, 2000);
    };
    timer = setTimeout(refresh, 2000);
    return () => { active = false; clearTimeout(timer); };
  }, [status, read, show, undoable]);
  useEffect(() => { void request('issues/tidy', { trigger: 'dashboard' }).catch(() => {}); }, [request]);

  // The label beside the pointer while a widget is resized, with "Minimum size" or "Maximum size" when the pull went past a limit
  // (gridstack stops at the limit and sends nothing more, so the pointer is what tells).
  const gesture = useRef(null);
  const pointer = useRef({ x: 0, y: 0 });
  const chipFor = useCallback((element) => {
    const g = gesture.current;
    const node = element?.gridstackNode;
    if (!g || g.kind !== 'resize' || !node || !live.current.M) return;
    const declared = live.current.byType[live.current.items.find((item) => item.id === node.id)?.type];
    const pitchX = live.current.M.cell + GAP;
    const pitchY = live.current.M.row + GAP;
    const dx = pointer.current.x - g.from.x;
    const dy = pointer.current.y - g.from.y;
    const dir = g.dir;
    const wantW = Math.round((g.width + (dir.includes('e') ? dx : dir.includes('w') ? -dx : 0) + GAP) / pitchX);
    const wantH = Math.round((g.height + (dir.includes('s') ? dy : dir.includes('n') ? -dy : 0) + GAP) / pitchY);
    const room = dir.includes('w') ? g.start.x + g.start.w : (grid.current?.getColumn() ?? COLUMNS) - g.start.x;
    const maxW = Math.max(room, g.start.w);
    const minW = declared?.min.w ?? 1;
    const minH = declared?.min.h ?? 1;
    const note = wantW > maxW || wantH > MAX_ROWS ? ` · ${D.maximum}` : wantW < minW || wantH < minH ? ` · ${D.minimum}` : '';
    setChip({ text: `${sizeText(node.w, node.h)}${note}`, x: pointer.current.x + 16, y: pointer.current.y + 16 });
  }, []);

  useEffect(() => {
    const element = board.current;
    if (!element) return undefined;
    // `minRow` is only there to stop gridstack from sizing its container by the board's CSS min-height (it reads it when it is asked, which
    // can be before the page has rendered the rows the window shows): the container is as tall as the widgets, and the CSS holds the board
    // at the rows of the window.
    const instance = GridStack.init({
      column: COLUMNS, cellHeight: 126 + GAP, margin: GAP / 2, minRow: 1, mode: 'float', animate: true, staticGrid: true,
      resizable: { handles: HANDLES, autoHide: false },
    }, element);
    grid.current = instance;
    const begin = (kind) => (event, el) => {
      revision.current++;
      const node = el.gridstackNode;
      const surface = el.querySelector('.db-surface');
      const rect = surface?.getBoundingClientRect();
      const held = el.querySelector('.ui-resizable-handle.db-held');
      const dir = /\bui-resizable-(se|sw|ne|nw|e|w|n|s)\b/.exec(held?.className ?? '')?.[1] ?? '';
      gesture.current = { kind, id: node.id, before: read(), start: { x: node.x, y: node.y, w: node.w, h: node.h }, from: { ...pointer.current }, width: rect?.width ?? 0, height: rect?.height ?? 0, dir };
      el.querySelector('.db-card')?.classList.add(kind === 'move' ? 'db-moving' : 'db-resizing');
      setMoving(kind === 'move');
      setGesturing(true);
    };
    const end = (event, el) => {
      const g = gesture.current;
      gesture.current = null;
      setChip(null);
      setGesturing(false);
      setMoving(false);
      el.querySelector('.db-card')?.classList.remove('db-moving', 'db-resizing');
      if (!g) return;
      const now = read();
      const before = g.before;
      const changed = JSON.stringify(now.map((item) => [item.id, item.x, item.y, item.w, item.h])) !== JSON.stringify(before.map((item) => [item.id, item.x, item.y, item.w, item.h]));
      if (!changed) return;
      // A widget that was pulled stops following the window's size: from now on it has a number of cells of its own.
      const next = now.map((item) => (item.id === g.id ? { ...item, fill: false, fillH: false } : item));
      save(next, next.find((item) => item.id === g.id).type);
    };
    instance.on('dragstart', begin('move'));
    instance.on('resizestart', begin('resize'));
    instance.on('resize', (event, el) => chipFor(el));
    instance.on('dragstop', end);
    instance.on('resizestop', end);
    const track = (event) => { pointer.current = { x: event.clientX, y: event.clientY }; if (gesture.current?.kind === 'resize') chipFor(gesture.current && instance.engine.nodes.find((node) => node.id === gesture.current.id)?.el); };
    const hold = (event) => { const handle = event.target.closest?.('.ui-resizable-handle'); if (handle) handle.classList.add('db-held'); };
    const release = () => element.querySelectorAll('.db-held').forEach((handle) => handle.classList.remove('db-held'));
    document.addEventListener('pointermove', track, true);
    element.addEventListener('pointerdown', hold, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    return () => {
      document.removeEventListener('pointermove', track, true);
      element.removeEventListener('pointerdown', hold, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      instance.destroy(false);
      grid.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one grid for the life of the page; its callbacks read `live`

  // First layout, once the grid exists and the window has been measured.
  const started = useRef(false);
  useEffect(() => { if (M && grid.current && !started.current) { started.current = true; applyMetrics(M.cols, M.row); load(); } }, [M, applyMetrics, load]);
  // The window changed: the cell and the columns follow it, the widgets keep their cells.
  useEffect(() => {
    if (!M || !items || !grid.current) return;
    applyMetrics(COLUMNS, M.row);
    // The default Issues is "all the columns" and "all the rows the window shows": it follows the window until it is pulled.
    const instance = grid.current;
    const follows = [];
    for (const item of items) {
      if (!item.fill && !item.fillH) continue;
      const node = instance.engine.nodes.find((candidate) => candidate.id === item.id);
      if (!node) continue;
      const patch = {};
      if (item.fill && node.w !== M.cols) Object.assign(patch, { x: 0, w: M.cols });
      const rows = filled(byType[item.type], M.rows);
      if (item.fillH && node.h !== rows) Object.assign(patch, { h: rows, maxH: Math.max(MAX_ROWS, rows) });
      if (Object.keys(patch).length) follows.push([node.el, patch]);
    }
    if (!follows.length) return;
    instance.setAnimation(false); // following the window is not a movement to show: the widget is the window's size at every moment
    for (const [element, patch] of follows) instance.update(element, patch);
    animateAgain(instance);
  }, [M, items, placed, byType, applyMetrics]);
  useEffect(() => { grid.current?.setStatic(!editing); }, [editing]);

  // ---- remove, add, restore
  const remove = useCallback((id) => {
    const item = live.current.items.find((candidate) => candidate.id === id);
    const node = grid.current?.engine.nodes.find((candidate) => candidate.id === id);
    if (!item || !node) return;
    const before = read().filter((candidate) => candidate.id !== id);
    grid.current.removeWidget(node.el); // the place stays empty; nothing else moves
    setHosts((current) => { const { [id]: _gone, ...rest } = current; return rest; });
    save(before, item.type);
  }, [read, save]);

  const add = useCallback(async (type) => {
    pending.current++;
    revision.current++;
    setAdding(false);
    try {
      const result = await live.current.api.add(type, live.current.M?.cols, live.current.M?.rows);
      if (result.outcome !== 'success') throw new Error(result.message);
      show(result.items, { flash: result.items.find((item) => item.type === type)?.id });
      if (result.undo) live.current.toast(undoable(result.undo));
    } catch { live.current.toast({ message: D.saveFailed }); }
    finally { pending.current--; }
  }, [show, undoable]);

  const restore = useCallback(async () => {
    pending.current++;
    revision.current++;
    try {
      const result = await live.current.api.reset(live.current.M?.rows);
      if (result.outcome !== 'success') throw new Error(result.message);
      show(result.items);
      if (result.undo) live.current.toast(undoable(result.undo));
    } catch { live.current.toast({ message: D.saveFailed }); }
    finally { pending.current--; }
  }, [show, undoable]);

  const resizeTo = useCallback((item, size) => {
    const instance = grid.current;
    const node = instance?.engine.nodes.find((candidate) => candidate.id === item.id);
    if (!node) return;
    const w = size.w === 'fill' ? live.current.M.cols : size.w;
    const h = size.h === 'fill' ? filled(live.current.byType[item.type], live.current.M.rows) : size.h;
    applyMetrics(COLUMNS, live.current.M.row);
    instance.update(node.el, { w, h, maxH: Math.max(MAX_ROWS, h) });
    save(read().map((value) => value.id === item.id ? { ...value, fill: size.w === 'fill', fillH: size.h === 'fill' } : value), item.type);
  }, [applyMetrics, read, save]);

  // ---- the keyboard, for editing without a pointer: arrows move a widget by one cell, Shift + arrows resize it, Delete removes it
  const onCardKey = useCallback((event, id) => {
    if (!live.current.editing || event.target !== event.currentTarget) return; // a key typed inside the widget is not for the layout
    const node = grid.current?.engine.nodes.find((candidate) => candidate.id === id);
    const item = live.current.items.find((candidate) => candidate.id === id);
    if (!node || !item) return;
    const name = nameOf(item.type);
    const declared = live.current.byType[item.type];
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(id); return; }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step) return;
    event.preventDefault();
    const columns = grid.current.getColumn();
    if (event.shiftKey) {
      const w = clamp(node.w + step[0], declared?.min.w ?? 1, Math.max(columns - node.x, node.w));
      const h = clamp(node.h + step[1], declared?.min.h ?? 1, MAX_ROWS);
      if (w === node.w && h === node.h) return;
      grid.current.update(node.el, { w, h });
      setAnnounce(D.sized(name, w, h));
    } else {
      const x = clamp(node.x + step[0], 0, Math.max(0, columns - node.w));
      const y = Math.max(0, node.y + step[1]);
      if (x === node.x && y === node.y) return;
      grid.current.update(node.el, { x, y });
      setAnnounce(D.placed(name, x + 1, y + 1));
    }
    const next = read().map((candidate) => (candidate.id === id ? { ...candidate, fill: false, fillH: false } : candidate));
    save(next, item.type);
  }, [read, remove, save]);

  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented && !isTyping(event.target)) setEditing(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const cell = M?.cell ?? 126;
  const row = M?.row ?? cell;
  // (before the first layout arrives the board is the window's rows, so that its first paint has nothing to scroll)
  const frame = shape ?? (M ? { columns: M.cols, rows: M.rows } : null);
  const cssVars = frame ? {
    '--db-cell': `${cell}px`, '--db-row': `${row}px`, '--db-gap': `${GAP}px`, '--db-ext': frame.columns, '--db-rows': frame.rows, '--db-bw': `${span(frame.columns, cell)}px`,
  } : undefined;

  return (
    <section aria-label={D.board} className="relative flex h-full min-h-0 flex-col">
      <Entry editing={editing} onSettings={onSettings} onEdit={() => setEditing(true)} onSessions={onSessions} />
      {editing && (
          <div role="toolbar" aria-label={D.editLayout} className="absolute bottom-5 left-1/2 z-50 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-full border border-border/50 bg-popover px-3 py-2 text-popover-foreground shadow-lg">
            <Button variant="outline" size="sm" className="rounded-full px-3.5" onClick={() => setAdding(true)}><Plus />{D.addWidget}</Button>
            <Button variant="outline" size="sm" className="rounded-full px-3.5" onClick={restore}><RotateCcw />{D.restoreDefault}</Button>
            <Button variant="ghost" size="icon-sm" className="rounded-full bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent" aria-label={D.done} onClick={() => setEditing(false)}><Check /></Button>
          </div>
      )}
      <div ref={page} className="db-page">
        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
            <span>{D.loadFailed}</span>
            <Button variant="outline" size="sm" onClick={load}>{D.retry}</Button>
          </div>
        )}
        <div className={cn('db-wrap', editing && 'db-editing', gesturing && 'db-dragging')} style={cssVars} hidden={status === 'error'}>
          {shape && <Lattice cell={cell} row={row} columns={shape.columns} rows={shape.rows} />}
          <div ref={board} className={cn('grid-stack db-board', editing && 'db-editing', moving && 'db-moving')} />
        </div>
      </div>
      {placed && M && placed.map((item) => {
        const host = hosts[item.id];
        if (!host) return null;
        const declared = byType[item.type];
        const size = { cols: item.w, rows: item.h, width: span(item.w, cell), height: span(item.h, row) };
        const surface = <div className="db-surface" inert={editing ? '' : undefined}>
          <Guard source={declared?.source ?? sourceOf(item.type)} reset={declared?.Component} remove={() => remove(item.id)}>
            {declared
              ? <declared.Component size={size} editing={editing} />
              : <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">{D.missing(sourceOf(item.type) ?? item.type)}</div>}
          </Guard>
        </div>;
        return createPortal(
          <div className="db-card" tabIndex={editing ? 0 : -1} aria-label={declared?.label ?? item.type} onKeyDown={(event) => onCardKey(event, item.id)}>
            {developer && declared?.development
              ? <WidgetPreview widget={declared} editing={editing} resize={(value) => resizeTo(item, value)}>{surface}</WidgetPreview>
              : surface}
            <div className="db-frame" aria-hidden="true" />
            <button type="button" className="db-remove" aria-label={D.remove} onClick={() => remove(item.id)}><Minus className="size-3.5" aria-hidden="true" /></button>
          </div>,
          host,
          item.id,
        );
      })}
      {chip && <div className="db-chip" style={{ left: chip.x, top: chip.y }}>{chip.text}</div>}
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      <AddWidgetDialog open={adding} onOpenChange={setAdding} registry={registry} onBoard={new Set((items ?? []).map((item) => item.type))} onAdd={add} />
    </section>
  );
}
