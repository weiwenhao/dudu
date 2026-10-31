import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn.js';
import { StatusIcon } from '../../issues/icons.jsx';
import { T } from '../../strings.js';
import { fitCamera, project, roomBox } from './camera.js';
import { OfficeFallback } from './fallback.jsx';
import { boardAnchor, deskGrid, headAnchor, hex, roomSize, seating, shirtOf, stateOf, STATES, summarize } from './layout.js';
import { O } from './strings.js';
import { useDarkTheme, useReducedMotion } from './use-environment.js';

const TITLE_ROW = 36;
const LEGEND = [['claude', 0xd97757], ['codex', 0x19a58a], ['deepseek', 0x4d6bfe]]; // the clothes of the three agents

// The symbol on a name tag, and how it is coloured: grey for working and idle, amber for Needs you, red for Stuck.
const TONE = { muted: 'bg-muted text-muted-foreground', warning: 'bg-warning text-white', danger: 'bg-destructive text-white' };
const STATE_TEXT = { muted: 'text-muted-foreground', warning: 'text-warning-foreground', danger: 'text-danger-foreground' };
const STATE_DOT = { muted: 'bg-muted-foreground/60', warning: 'bg-warning', danger: 'bg-destructive' };

const refOf = (issue) => issue.ref ?? `DUDU-${issue.id}`;
const agentName = (agent) => (agent ? O.agents[agent] ?? agent : T.noAgent);

/**
 * Where the name tags go before the scene is there, and without it: the same camera, the same heads.
 * Returns a Map from issue id to { x, y } in canvas pixels.
 */
function staticTags(seated, grid, width, height) {
  const view = fitCamera(roomBox(roomSize(grid)), width, height);
  return new Map(seated.map(({ id, seat, issue }) => [id, project(view, headAnchor(seat, stateOf(issue), grid))]));
}

/**
 * The Office: a small three.js office with one person at a desk for each Active issue. Props: `size` ({ cols, rows, width,
 * height }: the widget's cells and pixels), `issues` (what the Issues API returns, in its default order), `openIssue(id)`, and
 * `editing` (the dashboard is being laid out: nothing in it answers a click). The scene is loaded when this first shows.
 */
export function OfficeWidget({ size, issues = [], openIssue, editing = false }) {
  const dark = useDarkTheme();
  const reduced = useReducedMotion();
  const grid = useMemo(() => deskGrid(size.cols, size.rows), [size.cols, size.rows]);
  const { seated, overflow } = useMemo(() => seating(issues, grid), [issues, grid]);
  const counts = useMemo(() => summarize(issues), [issues]);

  const stage = useRef(null);
  const host = useRef(null);
  const scene = useRef(null);
  const tags = useRef(new Map()); // id -> the tag's element
  const [box, setBox] = useState(() => ({ width: Math.max(1, size.width), height: Math.max(1, size.height - TITLE_ROW) }));
  // loading: the scene is on its way; scene: it is drawing; picture: no WebGL, or its context was lost
  const [mode, setMode] = useState('loading');
  const [hover, setHover] = useState(null);
  // where a head is at a desk, for the tags that are not on the move
  const resting = useMemo(() => staticTags(seated, grid, box.width, box.height), [seated, grid, box]);
  const latest = useRef({});
  latest.current = { issues, grid, box, dark, reduced, resting };

  // While the dashboard is laid out nothing in the widget takes a click or a Tab. (`inert` is set by hand: React 18 does not know it.)
  useEffect(() => { stage.current?.toggleAttribute('inert', editing); }, [editing]);

  // the area under the title row, as it really is
  useEffect(() => {
    const element = stage.current;
    if (!element || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setBox((old) => (Math.abs(old.width - width) < 0.5 && Math.abs(old.height - height) < 0.5 ? old : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Put the name tags where their people are: the heads in the scene while it draws (they walk), and for anyone it does not
  // have yet, and without it, where the same camera sees a head at a desk.
  const place = useCallback((list) => {
    const positions = new Map(latest.current.resting);
    for (const { id, x, y } of list ?? []) positions.set(id, { x, y });
    for (const [id, element] of tags.current) {
      const at = positions.get(id);
      if (at) element.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
    }
  }, []);
  useLayoutEffect(() => {
    place(scene.current ? scene.current.tagPositions() : null);
  });

  // the scene: made once, on a canvas of its own (a lost WebGL context cannot be reused), and told about everything after
  useEffect(() => {
    let cancelled = false;
    let made = null;
    let canvas = null;
    import('./scene.js').then(({ createOfficeScene }) => {
      if (cancelled) return;
      try {
        canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%';
        host.current.appendChild(canvas);
        const now = latest.current;
        made = createOfficeScene({
          canvas, theme: now.dark ? 'dark' : 'light', reducedMotion: now.reduced, width: now.box.width, height: now.box.height, cols: now.grid.columns + 2, rows: now.grid.rows + 1,
          onTags: (list) => place(list),
          onContextLost: () => { canvas.style.visibility = 'hidden'; setMode('picture'); },
          onContextRestored: () => { canvas.style.visibility = ''; setMode('scene'); },
        });
        scene.current = made;
        made.setIssues(now.issues);
        setMode('scene');
      } catch {
        // No WebGL: the picture stands in, and nothing says why.
        canvas?.remove();
        scene.current = null;
        setMode('picture');
      }
    }).catch(() => { if (!cancelled) setMode('picture'); });
    return () => {
      cancelled = true;
      scene.current = null;
      made?.dispose();
      canvas?.remove();
    };
  }, [place]);

  useEffect(() => { scene.current?.setIssues(issues); }, [issues, mode]);
  useEffect(() => { scene.current?.resize(box.width, box.height, size.cols, size.rows); }, [box, size.cols, size.rows, mode]);
  useEffect(() => { scene.current?.setTheme(dark ? 'dark' : 'light'); }, [dark, mode]);
  useEffect(() => { scene.current?.setReducedMotion(reduced); }, [reduced, mode]);
  useEffect(() => { scene.current?.setHover(hover); }, [hover, mode]);

  // an issue that is no longer in the office is no longer under the pointer
  useEffect(() => { if (hover != null && !seated.some((entry) => entry.id === hover)) setHover(null); }, [seated, hover]);

  // the pointer over the picture: the person under it is highlighted, a click opens their issue
  const pick = (event) => {
    if (!scene.current) return null;
    const rect = host.current.getBoundingClientRect();
    return scene.current.pick(event.clientX - rect.left, event.clientY - rect.top);
  };
  const onMove = (event) => {
    if (event.target.closest?.('[data-office-tag]')) return; // a tag says whose it is itself
    const id = pick(event);
    setHover((old) => (old === id ? old : id));
  };
  const onLeave = () => setHover(null);
  const onClick = (event) => { const id = pick(event); if (id != null) openIssue?.(id); };

  const sentence = O.summary(counts);
  const hovered = hover == null ? null : seated.find((entry) => entry.id === hover)?.issue ?? null;
  const theme = dark ? 'dark' : 'light';
  const fallbackView = useMemo(() => fitCamera(roomBox(roomSize(grid)), box.width, box.height), [grid, box]);
  const crowd = mode === 'picture' ? seated.map(({ id, seat, issue }) => ({ id, seat, state: stateOf(issue), agent: issue.agent })) : [];
  const more = overflow.length ? project(fallbackView, boardAnchor(grid)) : null;

  return (
    <section aria-label={O.title} className="flex h-full min-h-0 w-full flex-col overflow-hidden text-card-foreground">
      <header className="flex shrink-0 items-center gap-2 px-4" style={{ height: TITLE_ROW }}>
        <h2 className="font-semibold">{O.title}</h2>
        <span className="text-muted-foreground">{counts.total}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {LEGEND.map(([agent, color]) => (
            <span key={agent} className="flex items-center gap-1"><i className="size-2 rounded-full" style={{ background: hex(color) }} />{O.agents[agent]}</span>
          ))}
        </span>
      </header>
      <div
        ref={stage} data-office-stage="" data-mode={mode}
        className={cn('relative min-h-0 flex-1 overflow-hidden', hover != null && 'cursor-pointer', editing && 'pointer-events-none')}
        onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick}
      >
        <div role="img" aria-label={sentence} className="absolute inset-0">
          <div ref={host} className="absolute inset-0" />
          {mode !== 'scene' && <OfficeFallback grid={grid} view={fallbackView} theme={theme} people={crowd} />}
        </div>
        {seated.map(({ id, issue }) => {
          const state = stateOf(issue);
          const tone = STATES[state].tone;
          const status = T.status[issue.status] ?? issue.status;
          return (
            <button
              key={id} type="button" data-office-tag={id}
              ref={(element) => { if (element) tags.current.set(id, element); else tags.current.delete(id); }}
              aria-label={O.tag(refOf(issue), issue.title, status, T.agentState[state])}
              tabIndex={editing ? -1 : 0}
              className="absolute top-0 left-0 flex -translate-x-1/2 -translate-y-full cursor-pointer items-center gap-1 rounded-full bg-card/95 py-0.5 pr-2 pl-0.5 text-xs whitespace-nowrap shadow-sm ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => { event.stopPropagation(); openIssue?.(id); }}
              onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(id)} onBlur={() => setHover(null)}
            >
              <span className={cn('flex size-5 items-center justify-center rounded-full text-xs font-bold', TONE[tone])} aria-hidden="true">{STATES[state].symbol}</span>
              <StatusIcon status={issue.status} className="size-3" />
              <span className="tracking-[-0.02em]">{refOf(issue)}</span>
              <i className="absolute -bottom-[3px] left-1/2 size-1.5 -translate-x-1/2 rotate-45 border-r border-b border-border bg-card" aria-hidden="true" />
            </button>
          );
        })}
        {more && (
          <span
            className="pointer-events-none absolute -translate-x-full -translate-y-full rounded-full bg-card/95 px-2 py-0.5 text-xs text-muted-foreground tabular-nums shadow-sm ring-1 ring-border"
            style={{ left: more.x, top: more.y }} aria-hidden="true" data-office-more=""
          >
            {O.more(overflow.length)}
          </span>
        )}
        {hovered && (
          <div className="pointer-events-none absolute right-3 bottom-3 z-20 w-60 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg" aria-hidden="true" data-office-card="">
            <div className="flex gap-1.5">
              <span className="tracking-[-0.02em] text-muted-foreground">{refOf(hovered)}</span>
              <span className="truncate font-medium">{hovered.title}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <i className="size-2 rounded-full" style={{ background: hex(shirtOf(hovered.agent)) }} />
              <span>{agentName(hovered.agent)}</span>
              <span className={cn('ml-auto flex items-center gap-1', STATE_TEXT[STATES[stateOf(hovered)].tone])}>
                <i className={cn('size-1.5 rounded-full', STATE_DOT[STATES[stateOf(hovered)].tone])} />
                {T.agentState[stateOf(hovered)]}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
