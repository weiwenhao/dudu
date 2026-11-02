import { Component, useEffect, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { COLUMNS, FILL_ROWS } from '../../../assistant/dashboard/widgets.mjs';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { GAP, span } from './metrics.js';

// The cell edge a sample is drawn at, before it is scaled to fit. A cell and its gap are 83px (fifteen columns), which gives a widget the size
// in pixels it has on a window about 1,230px wide: the size its rows and text were drawn at.
const CELL = 71;
const MAX_SCALE = 1.5; // a small widget is not blown up to fill the room
// How the grid's lines fade out: nothing at each edge, full strength 28px in. Written out in full, because Tailwind finds a class by
// reading it in the source and cannot read one that is put together.
const FADE_ACROSS = '[mask-image:linear-gradient(to_right,transparent,#000_28px,#000_calc(100%_-_28px),transparent)]';
const FADE_DOWN = '[mask-image:linear-gradient(to_bottom,transparent,#000_28px,#000_calc(100%_-_28px),transparent)]';

class PreviewBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">{T.dashboard.broken()}</div>
      : this.props.children;
  }
}

/**
 * The dashboard's cells behind a sample, at the sample's own scale so the widget sits on its cells. Nothing closes the grid: its lines
 * fade out toward every edge (two masks, one per direction, which multiply) instead of ending in a frame.
 */
function SampleGrid({ area, left, top, scale }) {
  const pitch = (CELL + GAP) * scale;
  // The lines run in the middle of the gaps, so the first one is half a gap before the widget; from there both ways to the edges.
  const along = (origin, length) => {
    const lines = [];
    for (let at = origin - Math.floor(origin / pitch) * pitch; at <= length; at += pitch) lines.push(at);
    return lines;
  };
  return <div className={cn('absolute inset-0', FADE_ACROSS)}>
    <div className={cn('absolute inset-0', FADE_DOWN)}>
      <svg aria-hidden="true" className="size-full text-foreground opacity-20">
        {along(left - (GAP / 2) * scale, area.width).map((x) => <line key={`v${x}`} x1={x} x2={x} y1="0" y2={area.height} stroke="currentColor" strokeDasharray="7 5" />)}
        {along(top - (GAP / 2) * scale, area.height).map((y) => <line key={`h${y}`} x1="0" x2={area.width} y1={y} y2={y} stroke="currentColor" strokeDasharray="7 5" />)}
      </svg>
    </div>
  </div>;
}

/** Render at the recommended native size, then fit that whole surface into the gallery. */
export function WidgetSample({ widget, thumbnail = false }) {
  const host = useRef(null);
  const [area, setArea] = useState(null);
  useEffect(() => {
    const element = host.current;
    const measure = () => setArea({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const cols = widget.size.w === 'fill' ? COLUMNS : widget.size.w;
  // What fills its height has no height of its own: drawn as the rows of a window of the usual size.
  const rows = widget.size.h === 'fill' ? Math.max(widget.min.h, FILL_ROWS) : widget.size.h;
  const size = { cols, rows, width: span(cols, CELL), height: span(rows, CELL) };
  const pad = thumbnail ? 0 : 24;
  const fit = area ? Math.max(0, Math.min((area.width - pad * 2) / size.width, (area.height - pad * 2) / size.height)) : 0;
  const scale = thumbnail ? fit : Math.min(fit, MAX_SCALE);
  const [left, top] = area ? [(area.width - size.width * scale) / 2, (area.height - size.height * scale) / 2] : [0, 0];
  return <div ref={host} className="pointer-events-none absolute inset-0" inert="" aria-hidden="true">
    {thumbnail && widget.preview ? <img src={widget.preview} alt="" className="size-full object-contain" />
      : thumbnail && widget.source ? <LayoutGrid className="m-auto h-full w-6 text-muted-foreground" />
      : area && scale > 0 && <>
        {!thumbnail && <SampleGrid area={area} left={left} top={top} scale={scale} />}
        <div className={cn('absolute overflow-hidden bg-card', !thumbnail && 'rounded-xl border shadow-sm')}
          style={{ width: size.width, height: size.height, left, top, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <PreviewBoundary key={widget.id}><widget.Component size={size} editing /></PreviewBoundary>
        </div>
      </>}
  </div>;
}
