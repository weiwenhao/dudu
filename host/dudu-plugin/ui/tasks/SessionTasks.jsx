import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Clock3, Trash2, Zap } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { getLocale, subscribeLocale } from '../lib/locale.mjs';
import { Scope } from '../lib/scope.jsx';
import { T } from '../strings.js';
import { scheduleLabel, stamp } from './format.js';
import { headerCount } from './session-tasks.js';

// The scheduled tasks of a conversation, in the conversation's header beside DSH's own team and background-jobs controls (owner, 2026-11-17; `.local/designs/session-schedules-2026-11-17/`). It is that jobs
// control's twin (`session-tasks.css`): "{N} 个定时任务" in the same 12 px text, the same popover with sections, rows with a chevron box and a small action box, and DSH's terminal block under an expanded row,
// holding the task's prompt and the runs. The words are the tasks window's (T.tasks). `tasks` is `createSessionTasks(request)` (`session-tasks-store.js`).
// Not Radix: the popover has to leave the header's own box (DSH's header is a size container, which would hold a `position: fixed` child), so it is a portal on <body> in a `.dudu` of its own, like DSH's list.

const PAUSE = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1.2" /><rect x="13.5" y="5.5" width="4" height="13" rx="1.2" /></svg>;
const PLAY = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4L9.2 5.1A.8.8 0 0 0 8 5.8z" /></svg>;
const DISARM = 4000;

export function SessionTasksAction({ sessionId, tasks }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const source = useMemo(() => tasks.forSession(sessionId), [tasks, sessionId]);
  const groups = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const count = headerCount(groups);
  if (count === 0 && open) setOpen(false); // the last task went: the list goes with it
  if (count === 0) return null;
  const label = T.sessionTasks.count(count);
  return <Scope floating>
    <button ref={trigger} type="button" className="dudu-st-trigger" aria-haspopup="true" aria-expanded={open} aria-label={label} data-dudu-session-tasks="" onClick={() => setOpen((value) => !value)}>
      <span className="dudu-st-slot"><Clock3 size={14} strokeWidth={1.6} aria-hidden="true" /></span>
      <span className="dudu-st-count">{label}</span>
    </button>
    {open && createPortal(<Scope floating><Surface anchor={trigger} groups={groups} tasks={tasks} onClose={close} /></Scope>, document.body)}
  </Scope>;
}

function Surface({ anchor, groups, tasks, onClose }) {
  const surface = useRef(null);
  const [expanded, setExpanded] = useState(null);
  const [endedOpen, setEndedOpen] = useState(false);
  const [armed, setArmed] = useState(null); // the task whose delete waits for a second press
  const [busy, setBusy] = useState(null);
  const [failed, setFailed] = useState(null);

  // 5 px under the trigger, at its left edge, 500 px wide at most, clear of the window's edges: DSH's own list.
  useLayoutEffect(() => {
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      const element = surface.current;
      if (!box || !element) return;
      const width = Math.min(500, window.innerWidth - 32);
      const top = Math.max(12, box.bottom + 5);
      element.style.width = `${width}px`;
      element.style.left = `${Math.max(12, Math.min(box.left, window.innerWidth - width - 12))}px`;
      element.style.top = `${top}px`;
      element.style.maxHeight = `${Math.max(160, Math.min(480, window.innerHeight - top - 12))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);
  useEffect(() => {
    surface.current?.querySelector('button')?.focus({ preventScroll: true });
    const away = (event) => { if (!surface.current?.contains(event.target) && !anchor.current?.contains(event.target)) onClose(); };
    const key = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); // the page behind must not take this Escape for its own
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(null), DISARM);
    return () => clearTimeout(timer);
  }, [armed]);

  const act = async (action, task) => {
    if (busy) return;
    setBusy(task.id); setFailed(null); setArmed(null);
    const done = await tasks.act(action, task);
    setBusy(null);
    if (!done) setFailed(task.id);
    else if (action === 'delete') setExpanded((current) => (current === task.id ? null : current));
  };
  const row = (task) => <Row key={task.id} task={task} tasks={tasks} expanded={expanded === task.id} armed={armed === task.id} busy={busy === task.id} failed={failed === task.id}
    onToggle={() => { setExpanded((current) => (current === task.id ? null : task.id)); setFailed(null); setArmed(null); }}
    onSwitch={() => act(task.status === 'active' ? 'pause' : 'resume', task)} onRun={() => act('run', task)}
    onDelete={() => (armed === task.id ? act('delete', task) : setArmed(task.id))} />;

  return <div ref={surface} className="dudu-st-surface" role="dialog" aria-label={T.sessionTasks.list} data-menu-material="translucent" data-window-drag-exclude="">
    <div className="dudu-st-material" />
    <ul className="dudu-st-list" aria-label={T.sessionTasks.list}>
      {groups.active.length > 0 && <li className="dudu-st-section" aria-hidden="true">{T.tasks.statuses.active}</li>}
      {groups.active.map(row)}
      {groups.paused.length > 0 && <li className="dudu-st-section" aria-hidden="true">{T.tasks.statuses.paused}</li>}
      {groups.paused.map(row)}
      {groups.ended.length > 0 && <li className="dudu-st-section">
        <button type="button" className="dudu-st-toggle" aria-expanded={endedOpen} onClick={() => setEndedOpen((value) => !value)}>
          <span className={cn('dudu-st-section-chevron', endedOpen && 'dudu-st-section-chevron-open')}><ChevronDown size={12} strokeWidth={1.6} aria-hidden="true" /></span>
          {T.tasks.statuses.ended} {groups.ended.length}
        </button>
      </li>}
      {endedOpen && groups.ended.map(row)}
    </ul>
  </div>;
}

function Row({ task, tasks, expanded, armed, busy, failed, onToggle, onSwitch, onRun, onDelete }) {
  const live = task.status === 'active';
  const rule = scheduleLabel(task.schedule);
  const next = live ? `${T.tasks.next} ${stamp(task.nextRunAt, task.schedule.timezone)}` : '';
  const lastFailed = task.status !== 'ended' && task.lastRun?.status === 'failed';
  const word = live ? T.tasks.pause : T.tasks.resume;
  return <li className="dudu-st-item">
    <div className={cn('dudu-st-line', live && 'dudu-st-line-live')}>
      <button type="button" className={cn('dudu-st-row', !live && 'dudu-st-row-settled')} aria-expanded={expanded} aria-label={expanded ? T.collapse(task.title) : T.expand(task.title)} onClick={onToggle}>
        <span className="dudu-st-dot"><Clock3 size={14} strokeWidth={1.6} aria-hidden="true" /></span>
        <span className="dudu-st-main">
          <span className="dudu-st-primary"><span className="dudu-st-label" title={task.title}>{task.title}</span></span>
          <span className="dudu-st-secondary" title={[rule, next].filter(Boolean).join(' · ')}>
            <span className="dudu-st-kind">{rule}</span>
            {next && <span className="dudu-st-duration">{next}</span>}
            {lastFailed && <span className="dudu-st-status dudu-st-status-failed">{T.tasks.delivery.failed}</span>}
          </span>
        </span>
        <span className="dudu-st-chevron-box"><ChevronDown className={cn('dudu-st-chevron', expanded && 'dudu-st-chevron-open')} size={12} strokeWidth={1.6} aria-hidden="true" /></span>
      </button>
      {task.status !== 'ended' && <button type="button" className="dudu-st-box" aria-label={word} title={word} disabled={busy} onClick={onSwitch}>{live ? PAUSE : PLAY}</button>}
    </div>
    {expanded && <>
      <Panel task={task} tasks={tasks} />
      <div className="dudu-st-acts">
        <button type="button" className="dudu-st-act" disabled={busy} onClick={onRun}><Zap size={12} strokeWidth={1.6} aria-hidden="true" />{T.tasks.run}</button>
        {armed
          ? <button type="button" className="dudu-st-box dudu-st-box-armed" disabled={busy} onClick={onDelete}><Trash2 size={12} strokeWidth={1.6} aria-hidden="true" /><span className="dudu-st-box-label">{T.sessionTasks.confirmDelete}</span></button>
          : <button type="button" className="dudu-st-act dudu-st-act-end" disabled={busy} onClick={onDelete}><Trash2 size={12} strokeWidth={1.6} aria-hidden="true" />{T.tasks.delete}</button>}
      </div>
    </>}
    {failed && <div className="dudu-st-notice dudu-st-notice-error" role="alert">{T.toast.failed}</div>}
  </li>;
}

/** DSH's terminal block: the prompt as the command (with its copy), the runs, latest first, as the output. */
function Panel({ task, tasks }) {
  const [runs, setRuns] = useState(null);
  const [copied, setCopied] = useState(false);
  const latest = task.lastRun?.id ?? '';
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    const load = () => tasks.history(task.id, abort.signal).then((value) => { if (live) setRuns(value); }).catch(() => { if (live) setRuns((previous) => previous ?? []); });
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000);
    return () => { live = false; abort.abort(); clearInterval(timer); };
  }, [task.id, tasks, latest]);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(task.prompt); setCopied(true); } catch { /* the page may not be allowed to write the clipboard */ }
  };
  return <div className="dudu-st-panel">
    <div className="dudu-st-term">
      <div className="dudu-st-term-head">
        <div className="dudu-st-term-prompt"><div className="dudu-st-term-line"><span className="dudu-st-term-command">{task.prompt}</span></div></div>
        <button type="button" className="dudu-st-term-copy" onClick={copy}>{copied ? T.sessionTasks.copied : T.sessionTasks.copy}</button>
      </div>
      {runs && <div className="dudu-st-term-output">
        {runs.length === 0 && <div className="dudu-st-term-row dudu-st-term-empty">{T.sessionTasks.noOutput}</div>}
        {runs.map((run) => <div key={run.id} className={cn('dudu-st-term-row', run.status === 'failed' && 'dudu-st-term-row-failed')}>
          <span>{stamp(run.at, task.schedule.timezone)}</span><span className="dudu-st-term-state">{T.tasks.delivery[run.status] ?? run.status}</span>
        </div>)}
      </div>}
    </div>
  </div>;
}
