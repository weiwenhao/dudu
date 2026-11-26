import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, Clock3, Copy, Ellipsis, LoaderCircle, MessageCircle, PencilLine, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Command, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Dialog, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { AGENT_NAMES, USUAL_AGENTS } from '../issues/model.js';
import { cn } from '../lib/cn.js';
import { useServices } from '../services.jsx';
import { T } from '../strings.js';
import { SessionPicker } from './SessionPicker.jsx';
import { inTasksWindow } from './session-tasks.js';
import { TaskSelect } from './TaskSelect.jsx';
import { DUDU, chooseProvider, followSession, providerDefaults, scheduleLabel, stamp, targetModes, taskAgentName, timezoneLabel, weekday } from './format.js';

const keys = ['title', 'prompt', 'agent', 'model', 'project', 'target', 'schedule'];
// A task of 嘟嘟 has no workspace: its `project` is null, whether the plugin sends that or leaves the key out.
const fields = (task) => ({ ...Object.fromEntries(keys.map((key) => [key, task[key]])), project: task.project ?? null });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readRequest = (request, action, body = {}, signal) => request(action, body, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
// A new task is by the first provider that can be used (嘟嘟, when the plugin lists it), with that provider's own workspace and place.
function newTask(options = {}) {
  const agent = options.providers?.find((provider) => provider.available)?.id ?? 'deepseek';
  return { title: '', prompt: '', agent, model: null, ...providerDefaults(agent, options),
    schedule: { kind: 'daily', time: '09:00', timezone: options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone } };
}
function Status({ value }) {
  return <span className={cn('shrink-0 rounded px-2 py-1 text-[11px] leading-none', value === 'active' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>{T.tasks.statuses[value]}</span>;
}
function Field({ label, children, className }) {
  return <div className={cn('dudu-task-field', className)}><div className="dudu-task-field-label">{label}</div>{children}</div>;
}
function Menu({ trigger, children, label }) {
  const [open, setOpen] = useState(false);
  const list = useRef(null);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent align="end" sideOffset={4} className="dudu-task-menu dudu-task-actions" onOpenAutoFocus={(event) => { event.preventDefault(); list.current?.focus(); }}>
      <Command ref={list} label={label}><CommandList>{children(() => setOpen(false))}</CommandList></Command>
    </PopoverContent></Popover>;
}

function TaskForm({ value, onChange, options, disabled }) {
  const S = T.tasks;
  const set = (key, next) => onChange({ ...value, [key]: next });
  const timing = (patch) => set('schedule', { ...value.schedule, ...patch });
  const schedule = value.schedule;
  const provider = options.providers?.find((item) => item.id === value.agent);
  // Until the plugin has sent its providers (or when it cannot), the usual agents of the issues are listed (and the task's own, whichever it is), and 嘟嘟 when the task is its own, so that its face is never a bare id.
  const listed = options.providers ?? [...(value.agent === DUDU ? [{ id: DUDU }] : []), ...Object.entries(AGENT_NAMES).filter(([id]) => USUAL_AGENTS.includes(id) || id === value.agent).map(([id, name]) => ({ id, name }))];
  const providers = listed.map((item) => ({ value: item.id, label: item.id === DUDU ? T.brand : item.name, disabled: item.available === false, icon: <AgentLogo agent={item.id} /> }));
  const byDudu = value.agent === DUDU;
  // A task that goes into a conversation DSH already has runs on that conversation's own provider and model, in its workspace (owner, 2026-11-17): the three rows follow the conversation chosen below and say nothing until one is.
  const existing = value.target.mode === 'existing';
  const bare = existing && !value.target.sessionId;
  const targets = targetModes(value.agent).map((mode) => ({ value: mode, label: S.targets[mode] }));
  const modelIds = [...new Set([...(value.model ? [value.model] : []), ...(provider?.models ?? [])])];
  const models = [{ value: '', label: S.defaultModel }, ...modelIds.map((id) => ({ value: id, label: id }))];
  const projects = options.projects ?? [];
  const timezones = useMemo(() => [...new Set([schedule.timezone, options.timezone, ...(Intl.supportedValuesOf?.('timeZone') ?? [])].filter(Boolean))].sort().map((zone) => ({ value: zone, label: timezoneLabel(zone) })), [schedule.timezone, options.timezone]);
  const times = useMemo(() => [...new Set([schedule.time, ...Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, '0')}:${String(index % 4 * 15).padStart(2, '0')}`)].filter(Boolean))].sort().map((time) => ({ value: time, label: time })), [schedule.time]);
  return <fieldset disabled={disabled} className="dudu-task-form">
    <Field label={S.name}><input className="dudu-task-text" aria-label={S.name} value={value.title} maxLength={200} onChange={(event) => set('title', event.target.value)} required /></Field>
    <Field label={S.prompt}><textarea aria-label={S.prompt} className="dudu-task-text dudu-task-textarea" rows={3} value={value.prompt} maxLength={100000} onChange={(event) => set('prompt', event.target.value)} required /></Field>
    <div className="dudu-task-rule-rows">
      <TaskSelect row label={S.provider} value={value.agent} options={providers} onChange={(agent) => onChange(chooseProvider(value, agent, options))} disabled={disabled || existing} blank={bare} />
      <TaskSelect row label={S.model} value={value.model ?? ''} options={models} onChange={(model) => set('model', model || null)} searchable disabled={disabled || existing} blank={bare} />
      {/* 嘟嘟 works in its own folder: no workspace to choose, and no existing conversation to take over. */}
      {!byDudu && <TaskSelect row label={S.workspace} value={value.project?.path ?? ''} options={projects.map((project) => ({ value: project.path, label: project.name }))} searchable disabled={disabled || existing} blank={bare}
        onChange={(path) => onChange({ ...value, project: projects.find((project) => project.path === path) })} />}
      <TaskSelect row label={S.target} value={value.target.mode} options={targets} disabled={disabled}
        onChange={(mode) => set('target', { mode, ...(mode === 'existing' ? { sessionId: '' } : {}) })} />
      {existing && <SessionPicker label={S.linked} value={value.target.sessionId} options={options} disabled={disabled} onPick={(session) => onChange(followSession(value, session, options))} />}
    </div>
    <Field label={S.timing}><div className="dudu-task-rule-rows">
        <TaskSelect row label={S.rules} value={schedule.kind} disabled={disabled} options={Object.entries(S.kinds).map(([value, label]) => ({ value, label }))} onChange={(kind) => set('schedule', {
          kind, timezone: schedule.timezone, ...(kind === 'cron' ? { expression: '0 9 * * *' } : kind === 'interval' ? { minutes: 60 } : { time: schedule.time ?? '09:00',
            ...(kind === 'once' ? { date: new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) } : {}),
            ...(kind === 'weekly' ? { weekdays: [1] } : {}), ...(kind === 'monthly' ? { day: 1 } : {}), }),
        })} />
        {schedule.kind === 'interval' ? <div className="dudu-task-rule-row"><span>{S.kinds.interval}</span><span className="flex min-w-0 items-center justify-end gap-1"><input className="dudu-task-rule-input" type="number" aria-label={`${S.timing} (${T.pet.duration.minute})`} value={schedule.minutes} min={1} max={525600} onChange={(event) => timing({ minutes: Number(event.target.value) })} /><span className="text-muted-foreground">{T.pet.duration.minute}</span></span></div>
          : schedule.kind === 'cron' ? <div className="dudu-task-rule-row"><span>{S.kinds.cron}</span><input className="dudu-task-rule-input font-mono" aria-label={S.kinds.cron} value={schedule.expression} onChange={(event) => timing({ expression: event.target.value })} /></div>
            : <TaskSelect row label={S.timing} value={schedule.time} options={times} searchable customValue={(text) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text.trim()) ? text.trim() : null} onChange={(time) => timing({ time })} disabled={disabled} />}
      {schedule.kind === 'once' && <div className="dudu-task-rule-row"><span>{S.kinds.once}</span><input className="dudu-task-rule-input" type="date" aria-label={S.kinds.once} value={schedule.date} onChange={(event) => timing({ date: event.target.value })} required /></div>}
      {schedule.kind === 'monthly' && <div className="dudu-task-rule-row"><span>{S.kinds.monthly}</span><input className="dudu-task-rule-input" type="number" aria-label={S.kinds.monthly} value={schedule.day} min={1} max={31} onChange={(event) => timing({ day: Number(event.target.value) })} /></div>}
      {schedule.kind === 'weekly' && <div className="dudu-task-rule-row"><span>{S.kinds.weekly}</span><div className="flex flex-wrap justify-end gap-1">{[1, 2, 3, 4, 5, 6, 0].map((day) => <Button key={day} variant={schedule.weekdays?.includes(day) ? 'secondary' : 'ghost'} size="xs" aria-pressed={schedule.weekdays?.includes(day)}
        onClick={() => timing({ weekdays: schedule.weekdays?.includes(day) ? schedule.weekdays.filter((item) => item !== day) : [...(schedule.weekdays ?? []), day].sort() })}>{weekday(day)}</Button>)}</div>
      </div>}
      <TaskSelect row label={S.timezone} value={schedule.timezone} options={timezones} searchable disabled={disabled} onChange={(timezone) => timing({ timezone })} />
    </div></Field>
  </fieldset>;
}

function History({ task, request, onOpen }) {
  const [value, setValue] = useState(null);
  const [problem, setProblem] = useState(false);
  const [paging, setPaging] = useState(false);
  useEffect(() => {
    let active = true;
    let reading = false;
    const abort = new AbortController();
    const load = async () => {
      if (reading) return;
      reading = true;
      try {
        const result = await readRequest(request, 'tasks/history', { id: task.id }, abort.signal);
        if (result.outcome !== 'success') throw new Error();
        if (active) { setValue((previous) => previous?.runs?.length > 30 ? { ...previous, runs: [...result.runs, ...previous.runs.filter((run) => run.seq < (result.runs.at(-1)?.seq ?? Infinity))] } : result); setProblem(false); }
      } catch { if (active) setProblem(true); }
      finally { reading = false; }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000);
    return () => { active = false; abort.abort(); clearInterval(timer); };
  }, [task.id, request]);
  const more = async () => {
    if (paging || !value?.nextCursor) return;
    setPaging(true);
    try {
      const result = await readRequest(request, 'tasks/history', { id: task.id, before: value.nextCursor });
      if (result.outcome !== 'success') throw new Error();
      setValue((previous) => ({ ...result, runs: [...previous.runs, ...result.runs.filter((run) => !previous.runs.some((item) => item.id === run.id))] }));
    } catch { setProblem(true); } finally { setPaging(false); }
  };
  return <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
    {problem && <p role="alert" className="py-3 text-sm text-destructive">{T.collector.loadFailed}</p>}
    {!value && !problem && <p role="status" className="py-3 text-sm text-muted-foreground">{T.shell.loading}</p>}
    {value?.runs.length === 0 && <p className="py-6 text-sm text-muted-foreground">{T.collector.empty}</p>}
    {value?.runs.map((run) => <article key={run.id} className="border-b py-4 last:border-b-0">
      <div className="flex items-center gap-2.5">{run.status === 'delivered' ? <Check className="size-4 text-success" /> : <Clock3 className="size-4 text-muted-foreground" />}
        <time className="text-sm font-medium" dateTime={new Date(run.at).toISOString()}>{stamp(run.at, run.task.schedule.timezone)}</time>
        <span className="ml-auto text-xs text-muted-foreground">{T.tasks.delivery[run.status]}</span>
      </div>
      <p className="mt-2 ml-[26px] whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{run.task.prompt}</p>
      <div className="mt-2 ml-[26px] flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><AgentLogo agent={run.task.agent} /><span>{taskAgentName(run.task.agent)}</span><span className="truncate">{run.model ?? run.task.model ?? T.tasks.defaultModel}</span>
        {run.sessionId && <Button variant="ghost" size="xs" className="ml-auto" onClick={() => onOpen(run.sessionId, run.workspaceId)}>{T.detail.openSession}<ArrowUpRight /></Button>}
      </div>
    </article>)}
    {value?.nextCursor && <div className="py-3 text-center"><Button variant="ghost" size="sm" disabled={paging} onClick={more}>{T.tasks.more}</Button></div>}
  </div>;
}

/** The approved modal/entry placement, with DSH's status filters and preset rule controls (owner, 2026-11-10). */
export function TasksDialog({ open, initialTaskId, onOpenChange, onConversation }) {
  const { request, openNativeSession } = useServices();
  const [tasks, setTasks] = useState([]);
  const [options, setOptions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('rules');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [optionsProblem, setOptionsProblem] = useState(false);
  const [problem, setProblem] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const trigger = useRef(null);
  const mutation = useRef(false);
  const reading = useRef(0);
  const refreshing = useRef(false);
  const lifetime = useRef(null);
  const state = useRef({ selected, draft });
  state.current = { selected, draft };
  const dirty = Boolean(draft && (!selected || !same(draft, fields(selected))));
  const S = T.tasks;
  const loadOptions = useCallback(async (signal) => {
    setLoading(true); setOptionsProblem(false);
    try {
      const result = await readRequest(request, 'tasks/options', { includeSessions: false }, signal);
      if (result.outcome !== 'success') throw new Error();
      if (signal?.aborted) return;
      setOptions(result);
      // A draft made before the options came has no workspace yet; one of 嘟嘟 never has one.
      setDraft((previous) => previous && previous.agent !== DUDU && !previous.project ? { ...previous, project: result.projects[0] ?? null } : previous);
    } catch { if (!signal?.aborted) setOptionsProblem(true); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [request]);
  const refresh = useCallback(async (signal) => {
    const generation = ++reading.current;
    refreshing.current = true;
    try {
      const result = await readRequest(request, 'tasks/list', {}, signal);
      if (result.outcome !== 'success') throw Object.assign(new Error(), { code: result.code });
      if (signal?.aborted || generation !== reading.current) return;
      const listed = result.tasks.filter(inTasksWindow);
      setTasks(listed);
      const { selected: previous, draft: edited } = state.current;
      if (previous && same(edited, fields(previous))) {
        const next = listed.find((item) => item.id === previous.id);
        setSelected(next ?? null); setDraft(next ? fields(next) : null);
      }
      return listed;
    } finally {
      if (generation === reading.current) refreshing.current = false;
    }
  }, [request]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    lifetime.current = abort;
    state.current = { selected: null, draft: null };
    setTasks([]);
    setProblem(''); setOptions(null); setSelected(null); setDraft(null); setConfirm(null); setDeleting(false); setTab('rules');
    void loadOptions(abort.signal);
    const load = async () => {
      try {
        const list = await refresh(abort.signal);
        if (abort.signal.aborted) return;
        if (state.current.draft) return;
        if (list?.length) {
          const first = initialTaskId ? list.find((task) => task.id === initialTaskId) : list[0];
          if (first) { setSelected(first); setDraft(fields(first)); }
          else setProblem('not_found');
        } else if (initialTaskId) setProblem('not_found');
      } catch (error) { if (!abort.signal.aborted) setProblem(error.code || 'unavailable'); }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !mutation.current && !refreshing.current) void refresh(abort.signal).catch(() => {}); }, 5000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [open, initialTaskId, loadOptions, refresh]);
  const retryLoad = () => {
    const signal = lifetime.current?.signal;
    setProblem('');
    void loadOptions(signal);
    void refresh(signal).catch((error) => { if (!signal?.aborted) setProblem(error.code || 'unavailable'); });
  };
  const choose = (task) => { const value = task ? fields(task) : newTask(options ?? {}); setSelected(task); setDraft(value); state.current = { selected: task, draft: value }; setTab('rules'); setProblem(''); };
  const guard = (action) => { if (dirty) setConfirm(() => action); else action(); };
  const close = () => { if (!mutation.current) guard(() => onOpenChange(false)); };
  const change = async (action, body = {}, next) => {
    if (mutation.current) return false;
    mutation.current = true; reading.current++; setBusy(true); setProblem('');
    try {
      const value = await request(`tasks/${action}`, { ...(selected ? { id: selected.id, revision: selected.revision } : {}), ...body });
      if (value.outcome !== 'success') throw Object.assign(new Error(), { code: value.code });
      if (value.task) { setSelected(value.task); setDraft(fields(value.task)); state.current = { selected: value.task, draft: fields(value.task) }; }
      if (action === 'delete') { setSelected(null); setDraft(null); state.current = { selected: null, draft: null }; setDeleting(false); }
      await refresh().catch(() => {}); // The acknowledged write stays successful if its subsequent list refresh fails.
      next?.();
      return true;
    } catch (error) { setProblem(error.code || 'unavailable'); return false; }
    finally { mutation.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!draft) return false;
    const base = selected ? fields(selected) : null;
    const patch = base ? Object.fromEntries(keys.filter((key) => !same(draft[key], base[key])).map((key) => [key, draft[key]])) : null;
    return change(selected ? 'update' : 'create', selected ? { patch } : { fields: draft });
  };
  const openSession = async (sessionId, workspaceId) => {
    try { await openNativeSession({ provider: 'dsh', id: sessionId, workspaceId }); onOpenChange(false); } catch { setProblem('invalid_session'); }
  };
  const beginConversation = async () => {
    try { await onConversation(); onOpenChange(false); } catch { setProblem('unavailable'); }
  };
  const filtered = tasks.filter((task) => (!status || task.status === status) && (!query || `${task.title}\n${task.prompt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  // How many tasks each tab holds, in the tab itself (owner, 2026-11-11: "选 A", `.local/designs/tasks-list-2026-11-11/`): whatever is typed in the search box does not change them.
  const counts = Object.fromEntries([...Object.keys(S.statuses), ''].map((value) => [value, value ? tasks.filter((task) => task.status === value).length : tasks.length]));
  return <>
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent aria-modal="true" aria-describedby={undefined} className="h-[min(680px,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:h-[min(640px,calc(100dvh-2rem))] sm:max-w-[960px]"
        onOpenAutoFocus={() => { trigger.current = document.activeElement; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus?.(); }}>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b pr-3.5 pl-5">
          <DialogTitle className="text-[16px] font-semibold">{S.title}</DialogTitle>
          {/* Where the window says that it is reading the options (providers, models, workspaces) and that it could not: a spinner here, a retry button when it failed, and nothing otherwise (owner, 2026-11-18, on the
              strip that stood above the form: "这里放一个 loading 吧"). The place is kept, so the button beside it never moves. */}
          <span className="ml-auto flex size-8 shrink-0 items-center justify-center">
            {loading ? <LoaderCircle role="status" aria-label={T.shell.loading} className="size-4 animate-spin text-muted-foreground" />
              : optionsProblem && <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`${S.optionsFailed} · ${T.retry}`} title={`${S.optionsFailed} · ${T.retry}`} onClick={retryLoad}><RefreshCw /></Button>}
          </span>
          <div className="dudu-task-new">
            <Button size="sm" className="dudu-task-primary rounded-r-none" disabled={busy} onClick={() => guard(() => choose(null))}><Plus />{S.create}</Button>
            <Menu label={S.create} trigger={<Button size="icon-sm" className="dudu-task-primary w-7 rounded-l-none border-l border-white/20" aria-label={T.detail.more} disabled={busy}><ChevronDown className="size-3.5" /></Button>}>
            {(hide) => <><CommandItem onSelect={() => { hide(); guard(() => choose(null)); }}><PencilLine />{S.manual}</CommandItem>
              <CommandItem onSelect={() => { hide(); guard(() => void beginConversation()); }}><MessageCircle />{S.inConversation}</CommandItem></>}
          </Menu></div>
          <Button variant="ghost" size="icon-sm" className="size-7 rounded-md text-muted-foreground" aria-label={T.pet.close} disabled={busy} onClick={close}><X /></Button>
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className={cn('flex w-[340px] shrink-0 flex-col border-r', draft && 'max-sm:hidden', !draft && 'max-sm:w-full')}>
            <div className="dudu-task-filters">
              <div className="dudu-task-statuses" role="group" aria-label={S.all}>
                {[...Object.entries(S.statuses), ['', T.display.completed.all]].map(([value, label]) => <button key={value} type="button" className="dudu-task-status-tab outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={status === value} aria-label={`${label} ${counts[value]}`} onClick={() => setStatus(value)}>{label}<span className="dudu-task-status-count" aria-hidden="true">{counts[value]}</span></button>)}
              </div>
              <div className="dudu-task-search"><Search className="size-3.5 shrink-0 text-muted-foreground" /><input type="search" aria-label={S.search} placeholder={S.search} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
              {/* A row is the one the chat's task card and the phone's list have (`QuickCards.jsx` TaskRow): the provider's mark, the title with the status, one line of when. Its name is the mark's tooltip and for a screen reader. */}
              {filtered.map((task) => {
                const quiet = task.status !== 'active';
                const when = [scheduleLabel(task.schedule), task.status === 'active' ? `${S.next} ${stamp(task.nextRunAt, task.schedule.timezone)}` : ''].filter(Boolean).join(' · ');
                return <button key={task.id} type="button" aria-pressed={selected?.id === task.id} onClick={() => guard(() => choose(task))}
                  className={cn('flex w-full shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', selected?.id === task.id && 'bg-accent')}>
                  <span className={cn('shrink-0', quiet && 'opacity-55')} title={taskAgentName(task.agent)}><AgentLogo agent={task.agent} className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className={cn('min-w-0 flex-1 truncate text-[13px] leading-5 font-medium', quiet && 'text-muted-foreground')}>{task.title}</span><Status value={task.status} /></span>
                    <span className="block truncate text-xs leading-4 text-muted-foreground" title={when}>{when}</span>
                  </span>
                  <span className="sr-only">{taskAgentName(task.agent)}</span>
                </button>;
              })}
              {!filtered.length && options && <p className="px-3 py-6 text-sm text-muted-foreground">{T.collector.empty}</p>}
            </div>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            {problem && !optionsProblem && <div role="alert" className="flex shrink-0 items-center gap-2 border-b px-6 py-2 text-xs text-destructive"><span>{T.toast.failed} · {problem}</span>
              {problem === 'conflict' && selected && <Button variant="ghost" size="xs" disabled={busy} onClick={() => guard(() => void change('get'))}>{T.descriptionHistory.current}</Button>}
              {problem === 'unavailable' && <Button variant="ghost" size="xs" disabled={loading} onClick={retryLoad}>{T.retry}</Button>}
              {!options && <Button variant="ghost" size="xs" onClick={() => { onOpenChange(false); }}>{T.pet.close}</Button>}
            </div>}
            {draft ? <>
              <div className="shrink-0 px-6 pt-3">
                <div className="flex min-h-8 flex-wrap items-center gap-2"><h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{selected?.title ?? S.create}</h3>
                  <Button variant="ghost" size="icon-xs" className="order-first sm:hidden" aria-label={S.title} disabled={busy} onClick={() => guard(() => { setSelected(null); setDraft(null); })}><ChevronLeft /></Button>
                  {selected && <><div className="ml-auto flex items-center gap-2">
                    {selected.status !== 'ended' && <Button variant="outline" size="sm" disabled={busy || dirty} onClick={() => change(selected.status === 'active' ? 'pause' : 'resume')}>{selected.status === 'active' ? S.pause : S.resume}</Button>}
                    <Button variant="outline" size="sm" disabled={busy || dirty} onClick={() => change('run', {}, () => setTab('history'))}>{S.run}</Button>
                    <Menu label={T.detail.more} trigger={<Button variant="ghost" size="icon-sm" aria-label={T.detail.more} disabled={busy || dirty}><Ellipsis /></Button>}>
                      {(hide) => <><CommandItem onSelect={() => { hide(); void change('duplicate'); }}><Copy />{S.duplicate}</CommandItem><CommandSeparator />
                        <CommandItem className="text-destructive" onSelect={() => { hide(); setDeleting(true); }}><Trash2 />{S.delete}</CommandItem></>}
                    </Menu>
                  </div></>}
                </div>
                {selected && <p className="mt-1 text-[11px] text-muted-foreground">{S.next} {selected.status === 'active' ? stamp(selected.nextRunAt, selected.schedule.timezone) : '—'}</p>}
              </div>
              <div role="tablist" aria-label={S.title} className="mt-3 flex shrink-0 gap-7 border-b px-6">
                {['rules', 'history'].map((name) => <button key={name} type="button" role="tab" id={`dudu-task-tab-${name}`} aria-selected={tab === name} aria-controls={`dudu-task-panel-${name}`} disabled={!selected && name === 'history'} tabIndex={tab === name ? 0 : -1}
                  onClick={() => setTab(name)} onKeyDown={(event) => { if (selected && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'rules' : event.key === 'End' ? 'history' : name === 'rules' ? 'history' : 'rules'; setTab(next); event.currentTarget.parentElement.querySelector(`#dudu-task-tab-${next}`)?.focus(); } }}
                  className={cn('dudu-task-detail-tab border-b-2 py-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50', tab === name ? 'border-ring font-medium text-ring' : 'border-transparent text-muted-foreground')}>{S[name]}</button>)}
              </div>
              <div role="tabpanel" id={`dudu-task-panel-${tab}`} aria-labelledby={`dudu-task-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
                {tab === 'rules' ? <form id="dudu-task-form" className="min-h-0 flex-1 overflow-y-auto px-6 py-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
                  <TaskForm value={draft} onChange={setDraft} options={options ?? {}} disabled={busy} />
                </form> : selected && <History key={selected.id} task={selected} request={request} onOpen={(id, workspaceId) => guard(() => void openSession(id, workspaceId))} />}
              </div>
              <footer className="flex min-h-12 shrink-0 items-center gap-2 border-t px-6 py-2 text-[11px] text-muted-foreground">
                {dirty ? <><span className="mr-auto">{S.unsaved}</span><Button variant="ghost" className="dudu-task-footer-action text-foreground" size="sm" disabled={busy} onClick={() => selected ? void change('get') : setDraft(null)}>{S.discard}</Button><Button className="dudu-task-footer-action dudu-task-primary" size="sm" type={tab === 'rules' ? 'submit' : 'button'} form={tab === 'rules' ? 'dudu-task-form' : undefined} onClick={tab === 'history' ? () => void save() : undefined} disabled={busy || !options || !draft.title.trim() || !draft.prompt.trim() || (draft.agent !== DUDU && !draft.project?.path) || (draft.target.mode === 'existing' && !draft.target.sessionId)}>{busy && <LoaderCircle className="animate-spin" />}{selected ? S.save : S.create}</Button></>
                  : <><MessageCircle className="size-3.5" /><span>{S.linked}</span>{(selected?.sessionId || selected?.target.sessionId) && <Button variant="ghost" size="xs" className="min-w-0" onClick={() => void openSession(selected.sessionId || selected.target.sessionId)}><span className="truncate">{selected.title}</span><ArrowUpRight /></Button>}</>}
              </footer>
            </> : <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-muted-foreground">{loading ? <span role="status">{T.shell.loading}</span> : <><Clock3 className="size-7 opacity-40" aria-hidden="true" /><Button variant="outline" size="sm" disabled={busy} onClick={() => choose(null)}><Plus />{S.manual}</Button></>}</div>}
          </section>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(confirm)} onOpenChange={(value) => { if (!value && !mutation.current) setConfirm(null); }}><DialogContent aria-modal="true" aria-describedby={undefined} className="sm:max-w-[400px]">
      <DialogTitle className="text-base font-semibold">{S.unsaved}</DialogTitle>
      <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(null)}>{T.newIssue.cancel}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { const action = confirm; setConfirm(null); action?.(); }}>{S.discard}</Button>
        <Button size="sm" disabled={busy} onClick={async () => { if (await save()) { const action = confirm; setConfirm(null); action?.(); } }}>{S.save}</Button></div>
    </DialogContent></Dialog>
    <Dialog open={deleting} onOpenChange={(value) => { if (!mutation.current) setDeleting(value); }}><DialogContent aria-modal="true" aria-describedby={undefined} className="sm:max-w-[400px]">
      <DialogTitle className="text-base font-semibold">{S.delete}</DialogTitle><p className="text-sm">{selected?.title}</p>
      <div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleting(false)}>{T.newIssue.cancel}</Button><Button variant="destructive" size="sm" disabled={busy} onClick={() => change('delete')}>{S.delete}</Button></div>
    </DialogContent></Dialog>
  </>;
}
