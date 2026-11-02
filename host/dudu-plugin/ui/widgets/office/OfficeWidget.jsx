import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn.js';
import { AgentLogo } from '../../issues/AgentLogo.jsx';
import { agentLogo } from '../../issues/agent-logos.js';
import { StatusIcon } from '../../issues/icons.jsx';
import { T } from '../../strings.js';
import { agentColor, boardCounts, DESKS, fitScene, headPoint, hex, SCENE, seatAnchor, seating, spreadTags, stateOf, STATES, summarize, toCanvas } from './layout.js';
import { O } from './strings.js';
import { useReducedMotion } from './use-environment.js';

// what the plane looks like without the scene (no WebGL), and behind it while it loads: marvis-office's page colour
const BACKGROUND = '#f7f7f7';

// A name tag begins with the agent's logo, as the Issues cards show it. Working and idle say nothing more (they are at a desk, or at rest, and
// the picture shows it); an issue that needs you or is stuck has a dot at the logo's corner, as a stuck session has in the Issues cards.
const ALERT = { needs_you: 'bg-warning', stuck: 'bg-destructive' };
const STATE_TEXT = { muted: 'text-muted-foreground', warning: 'text-warning-foreground', danger: 'text-danger-foreground' };
const STATE_DOT = { muted: 'bg-muted-foreground/60', warning: 'bg-warning', danger: 'bg-destructive' };

const refOf = (issue) => issue.ref || issue.title;
const agentName = (agent) => (agent ? O.agents[agent] ?? agent : T.noAgent);

/**
 * Where the name tags go before the scene is there, and without it: the same fit, the same heads, at their desks. Returns a Map from issue
 * id to { x, y } in canvas pixels.
 */
function staticTags(seated, width, height) {
  const fit = fitScene(SCENE, width, height);
  return new Map(seated.map(({ id, seat }) => [id, toCanvas(fit, headPoint(seatAnchor(seat)))]));
}

/**
 * The Office: marvis-office's PixiJS office with one person at a desk for each assigned Active issue. Props: `size` ({ cols, rows, width,
 * height }: the widget's cells and pixels), `issues` (what the Issues API returns, in its default order), `openIssue(id)`, and
 * `editing` (the dashboard is being laid out: nothing in it answers a click). The scene is loaded when this first shows.
 */
export function OfficeWidget({ size, issues = [], totals, openIssue, editing = false }) {
  const reduced = useReducedMotion();
  const { seated, overflow } = useMemo(() => seating(issues), [issues]);
  const counts = useMemo(() => totals?.counts ?? summarize(issues), [issues, totals]);
  const extra = Math.max(overflow.length, counts.total - DESKS);

  const stage = useRef(null);
  const host = useRef(null);
  const scene = useRef(null);
  const tags = useRef(new Map()); // id -> the tag's element
  const sizes = useRef(new Map()); // id -> { width, height } of the tag, to keep tags that stand close from covering each other
  const [box, setBox] = useState(() => ({ width: Math.max(1, size.width), height: Math.max(1, size.height) }));
  // loading: the scene is on its way; scene: it is drawing; picture: no WebGL, or its context was lost
  const [mode, setMode] = useState('loading');
  const [hover, setHover] = useState(null);
  const board = useMemo(() => totals?.board ?? boardCounts(issues), [issues, totals]);
  // where each head is at its desk, for the tags until the scene says where they are
  const resting = useMemo(() => staticTags(seated, box.width, box.height), [seated, box]);
  const latest = useRef({});
  latest.current = { issues, board, box, reduced, resting };

  // While the dashboard is laid out nothing in the widget takes a click or a Tab. (`inert` is set by hand: React 18 does not know it.)
  useEffect(() => { stage.current?.toggleAttribute('inert', editing); }, [editing]);

  // The canvas fills the widget; the same fit keeps the scene centered on both axes.
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
    const spread = spreadTags(positions, sizes.current);
    for (const [id, element] of tags.current) {
      const at = positions.get(id);
      if (!at) continue;
      // the tag follows the head; one that would cover another is lifted above it (`translate` is its own property, as Tailwind's translate classes
      // use it, so the lift eases while the walk does not; the first value is the centring the classes give)
      // a tag lifted off the top of the widget would be cut off: it is lifted only as far as there is room, and overlaps instead
      const lift = Math.min(spread.get(id)?.lift ?? 0, Math.max(0, at.y - (sizes.current.get(id)?.height ?? 17) - 2));
      // a head near the edge of the widget would have half its tag cut off: the tag stays inside, and its tip leans over to the head
      const half = (sizes.current.get(id)?.width ?? 62) / 2 + 2;
      const width = latest.current.box.width;
      const x = Math.min(Math.max(at.x, half), Math.max(half, width - half));
      element.style.transform = `translate(${x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      element.style.translate = `-50% calc(-100% - ${lift.toFixed(1)}px)`;
      element.style.setProperty('--tag-lift', `${lift.toFixed(1)}px`);
      element.style.setProperty('--tag-shift', `${(at.x - x).toFixed(1)}px`);
    }
  }, []);
  useLayoutEffect(() => {
    for (const [id, element] of tags.current) sizes.current.set(id, { width: element.offsetWidth, height: element.offsetHeight });
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
          canvas, reducedMotion: now.reduced, width: now.box.width, height: now.box.height,
          onTags: (list) => place(list),
          onFailed: () => { canvas.style.visibility = 'hidden'; setMode('picture'); },
          onContextLost: () => { canvas.style.visibility = 'hidden'; setMode('picture'); },
          onContextRestored: () => { canvas.style.visibility = ''; setMode('scene'); },
        });
        scene.current = made;
        made.setIssues(now.issues, now.board);
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

  useEffect(() => { scene.current?.setIssues(issues, board); }, [issues, board, mode]);
  useEffect(() => { scene.current?.resize(box.width, box.height); }, [box, mode]);
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
  // "+N" for the issues without a desk, at the bottom right corner of the plane (the top right is where the third column's name tags are)
  const more = useMemo(() => {
    if (!extra) return null;
    return toCanvas(fitScene(SCENE, box.width, box.height), { x: SCENE.x + SCENE.width - 8, y: SCENE.y + SCENE.height - 8 });
  }, [extra, box]);

  return (
    <section aria-label={O.title} data-office-desks={DESKS} data-office-people={seated.length} data-office-unassigned={board[0]} className="flex h-full min-h-0 w-full flex-col overflow-hidden text-card-foreground">
      <div
        ref={stage} data-office-stage="" data-mode={mode}
        className={cn('relative min-h-0 flex-1 overflow-hidden', hover != null && 'cursor-pointer', editing && 'pointer-events-none')}
        onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick}
      >
        <div role="img" aria-label={sentence} className="absolute inset-0" style={{ background: BACKGROUND }}>
          <div ref={host} className="absolute inset-0" />
        </div>
        {seated.map(({ id, issue }) => {
          const state = stateOf(issue);
          const status = T.status[issue.status] ?? issue.status;
          return (
            <button
              key={id} type="button" data-office-tag={id}
              ref={(element) => { if (element) tags.current.set(id, element); else tags.current.delete(id); }}
              aria-label={O.tag(refOf(issue), issue.title, status, T.agentState[state])}
              tabIndex={editing ? -1 : 0}
              className="absolute top-0 left-0 flex -translate-x-1/2 -translate-y-full cursor-pointer items-center gap-[3px] rounded-full bg-card/95 py-0.5 pr-[5px] pl-[3px] text-[10px] leading-[13px] whitespace-nowrap shadow-xs ring-1 ring-border/70 outline-none transition-[translate] duration-150 hover:z-10 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              onClick={(event) => { event.stopPropagation(); openIssue?.(id); }}
              onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(id)} onBlur={() => setHover(null)}
            >
              <span className="relative flex size-[11px] shrink-0 items-center justify-center" aria-hidden="true">
                {agentLogo(issue.agent)
                  ? <AgentLogo agent={issue.agent} className="size-[11px]" />
                  : <span className="flex size-full items-center justify-center rounded-full bg-muted text-[7px] font-bold text-muted-foreground">{agentName(issue.agent).slice(0, 1).toUpperCase()}</span>}
                {ALERT[state] && <i className={cn('absolute -right-px -bottom-px size-[5px] rounded-full ring-1 ring-card', ALERT[state])} />}
              </span>
              <StatusIcon status={issue.status} className="size-[9px]" />
              <span className="tracking-[-0.02em]">{refOf(issue)}</span>
              <i className="absolute top-full left-1/2 -ml-px w-px bg-muted-foreground/45 transition-[height] duration-150 motion-reduce:transition-none" style={{ height: 'var(--tag-lift, 0px)', left: 'calc(50% + var(--tag-shift, 0px))' }} aria-hidden="true" />
              <i className="absolute -bottom-[2px] left-1/2 size-1 -translate-x-1/2 rotate-45 border-r border-b border-border/70 bg-card" style={{ left: 'calc(50% + var(--tag-shift, 0px))' }} aria-hidden="true" />
            </button>
          );
        })}
        {more && (
          <span
            className="pointer-events-none absolute -translate-x-full -translate-y-full rounded-full bg-card/95 px-2 py-0.5 text-xs text-muted-foreground tabular-nums shadow-sm ring-1 ring-border"
            style={{ left: more.x, top: more.y }} aria-hidden="true" data-office-more=""
          >
            {O.more(extra)}
          </span>
        )}
        {hovered && (
          <div className="pointer-events-none absolute right-3 bottom-3 z-20 w-60 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg" aria-hidden="true" data-office-card="">
            <div className="flex gap-1.5">
              <span className="tracking-[-0.02em] text-muted-foreground">{refOf(hovered)}</span>
              <span className="truncate font-medium">{hovered.title}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <i className="size-2 rounded-full" style={{ background: hex(agentColor(hovered.agent)) }} />
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
