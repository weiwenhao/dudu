import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CircleDot, GripVertical, MoreHorizontal, Plus } from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import { Button } from '../components/button.jsx';
import { Input } from '../components/input.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { SelectField } from '../components/select-field.jsx';
import { StatusIcon } from '../issues/icons.jsx';
import { receiveStatuses, statusLabel } from '../issues/workflow.js';
import { T } from '../strings.js';
import { DangerButton, Field, Loading, Page, PrimaryButton, Problem, QuietButton } from './kit.jsx';
import { useLoaded } from './use-loaded.js';

const CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];
const TYPES = { backlog: 'backlog', unstarted: 'todo', started: 'in_progress', completed: 'done', canceled: 'canceled' };
const TOKENS = { backlog: '--status-backlog', todo: '--status-todo', in_progress: '--status-progress', in_review: '--status-review', done: '--status-done', canceled: '--status-canceled' };
const COLORS = ['#95a2b3', '#61666b', '#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#26b5ce', '#5e6ad2', '#8f6bde'];
const PROGRESS = [0, 0.25, 0.5, 0.75, 1];
const FRACTIONS = ['0', '1/4', '1/2', '3/4', '1'];
const W = T.settings.statuses;
const rowButton = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-40';

function StatusForm({ status, category, busy, onSave, onCancel }) {
  const [name, setName] = useState(status ? statusLabel(status.id) : '');
  const [description, setDescription] = useState(status?.description ?? '');
  const [color, setColor] = useState(status ? status.color : '#95a2b3');
  const [iconProgress, setIconProgress] = useState(status?.iconProgress ?? (status?.type === 'in_review' ? 0.75 : 0.5));
  const [palette, setPalette] = useState(false);
  const hasProgress = category === 'started';
  return <form data-status-form className="flex flex-wrap items-center gap-2 border-t border-border/60 py-3"
    onSubmit={(event) => { event.preventDefault(); if (name.trim() && !busy) onSave({ name: name.trim(), description: description.trim(), color, ...(hasProgress ? { iconProgress } : {}) }); }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <Popover open={palette} onOpenChange={setPalette}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={hasProgress ? W.icon : W.color} disabled={busy} className="flex size-8 shrink-0 items-center justify-center rounded-lg border outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <StatusIcon status={status?.type ?? TYPES[category]} color={color} iconProgress={iconProgress} />
        </button>
      </PopoverTrigger>
      <PopoverContent className={hasProgress ? 'w-[268px] p-3' : 'w-[208px] p-3'} onEscapeKeyDown={(event) => event.stopPropagation()}>
        {hasProgress && <>
          <div className="mb-2 text-xs text-muted-foreground">{W.progress}</div>
          <ToggleGroup.Root type="single" value={String(iconProgress)} disabled={busy} aria-label={W.progress}
            className="grid grid-cols-5 gap-1.5" onValueChange={(value) => { if (value) setIconProgress(Number(value)); }}>
            {PROGRESS.map((value, index) => <ToggleGroup.Item key={value} value={String(value)} asChild>
              <Button variant="ghost" size="sm" aria-label={`${W.progress} ${FRACTIONS[index]}`}
                className="h-8 w-full rounded-md border border-transparent p-0 data-[state=on]:border-muted-foreground/40 data-[state=on]:bg-accent">
                <StatusIcon status={status?.type ?? TYPES[category]} color={color} iconProgress={value} />
              </Button>
            </ToggleGroup.Item>)}
          </ToggleGroup.Root>
          <div className="my-3 border-t" />
          <div className="mb-2 text-xs text-muted-foreground">{W.color}</div>
        </>}
        <div className="grid grid-cols-5 gap-2">
          {COLORS.map((value) => <button key={value} type="button" aria-label={value} aria-pressed={color === value} disabled={busy}
            className={`size-6 rounded-full border-2 border-transparent outline-none aria-pressed:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50${hasProgress ? ' justify-self-center' : ''}`}
            style={{ backgroundColor: value }} onClick={() => { setColor(value); if (!hasProgress) setPalette(false); }} />)}
        </div>
        <Input aria-label={W.color} value={color ?? ''} disabled={busy} maxLength={7} onChange={(event) => setColor(event.target.value || null)}
          className="mt-3 h-8 font-mono text-xs" pattern="#[0-9a-fA-F]{6}" />
      </PopoverContent>
    </Popover>
    <Field autoFocus aria-label={W.name} placeholder={W.name} maxLength={80} required value={name} disabled={busy}
      onChange={(event) => setName(event.target.value)} className="w-[132px] flex-1" />
    <Field aria-label={W.description} placeholder={W.description} maxLength={500} value={description} disabled={busy}
      onChange={(event) => setDescription(event.target.value)} className="w-[160px] flex-[1.4]" />
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <QuietButton type="button" disabled={busy} onClick={onCancel}>{T.settings.general.cancel}</QuietButton>
      <PrimaryButton type="submit" disabled={busy || !name.trim() || (color !== null && !/^#[0-9a-f]{6}$/i.test(color))}>
        {status ? T.settings.general.save : W.create}
      </PrimaryButton>
    </div>
  </form>;
}

function StatusRow({ status, count, index, countInCategory, busy, onEdit, onRemove, onDefault, onMove, dragRef, onDrop }) {
  const [open, setOpen] = useState(false);
  const name = statusLabel(status.id);
  const action = (run) => { setOpen(false); run(); };
  return <div data-workflow-status={status.id} className="group/status flex min-h-[52px] items-center gap-2 border-t border-border/60 py-2 first:border-t-0"
    onDragOver={(event) => { if (dragRef.current?.category === status.category && !busy) event.preventDefault(); }}
    onDrop={(event) => { event.preventDefault(); onDrop(status); }}>
    <button type="button" draggable={!busy} aria-label={`${W.reorder}: ${name}`} disabled={busy}
      className="-ml-2 flex w-4 shrink-0 cursor-grab items-center justify-center self-stretch text-muted-foreground/60 opacity-0 outline-none group-hover/status:opacity-100 focus-visible:opacity-100"
      onDragStart={(event) => { dragRef.current = status; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/dudu-status', status.id); }}
      onDragEnd={() => { dragRef.current = null; }}>
      <GripVertical className="size-3.5" aria-hidden="true" />
    </button>
    <button type="button" aria-label={T.settings.memory.editOf(name)} disabled={busy} onClick={onEdit}
      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-0.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
        style={{ backgroundColor: `color-mix(in srgb, ${status.color ?? `var(${TOKENS[status.type]})`} 10%, transparent)` }}>
        <StatusIcon status={status.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-[13px]/5">
          {name}{status.isDefault && <span className="font-normal text-muted-foreground">· {T.settings.general.isDefault}</span>}
        </span>
        {(count > 0 || status.description) && <span className="block text-xs/4 text-muted-foreground [overflow-wrap:anywhere]">
          {count > 0 ? T.total(count) : ''}{count > 0 && status.description ? ' · ' : ''}{status.description}
        </span>}
      </span>
    </button>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" disabled={busy} aria-label={`${W.options}: ${name}`}
          className="shrink-0 text-muted-foreground"><MoreHorizontal /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[180px]">
        <button type="button" className={rowButton} onClick={() => action(onEdit)}>{T.settings.memory.edit}</button>
        {!['completed', 'canceled'].includes(status.category) && !status.isDefault &&
          <button type="button" className={rowButton} onClick={() => action(onDefault)}>{W.makeDefault}</button>}
        <button type="button" className={rowButton} disabled={index === 0} onClick={() => action(() => onMove(-1))}><ArrowUp className="size-3.5" />{W.moveUp}</button>
        <button type="button" className={rowButton} disabled={index === countInCategory - 1} onClick={() => action(() => onMove(1))}><ArrowDown className="size-3.5" />{W.moveDown}</button>
        <div className="my-1 border-t" />
        <button type="button" className={`${rowButton} text-danger-foreground`} disabled={countInCategory < 2} onClick={() => action(onRemove)}>{T.settings.skills.delete}</button>
      </PopoverContent>
    </Popover>
  </div>;
}

/** Linear's category bars and inline editing inside Dudu's approved settings shell. */
export function StatusesSection({ request, onChanged }) {
  const state = useLoaded(request, 'issues/statuses');
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [replacement, setReplacement] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const dragRef = useRef(null);
  const mutate = async (action, body) => {
    if (busy) return;
    setBusy(true); setProblem('');
    try {
      const result = await request(`issues/${action}`, body);
      if (result.outcome !== 'success') { setProblem(W.errors[result.code] ?? T.toast.failed); return; }
      receiveStatuses(result.statuses);
      setEditing(null); setRemoving(null); setReplacement(null);
      state.reload(); onChanged?.();
    } catch { setProblem(T.toast.failed); }
    finally { setBusy(false); }
  };
  return <Loading state={state}>{(value) => {
    const statuses = (value.statuses ?? []).filter((status) => !status.archived);
    const order = (category, ids) => mutate('status-order', { category, ids });
    const move = (status, direction) => {
      const ids = statuses.filter((entry) => entry.category === status.category).map((entry) => entry.id);
      const index = ids.indexOf(status.id);
      [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
      void order(status.category, ids);
    };
    const drop = (target) => {
      const source = dragRef.current;
      dragRef.current = null;
      if (!source || source.id === target.id || source.category !== target.category || busy) return;
      const ids = statuses.filter((entry) => entry.category === target.category).map((entry) => entry.id);
      ids.splice(ids.indexOf(source.id), 1);
      ids.splice(ids.indexOf(target.id), 0, source.id);
      void order(target.category, ids);
    };
    return <Page title={T.settings.nav.statuses}>
      <div className="rounded-[20px] border bg-card p-3">
        {CATEGORIES.map((category) => {
          const entries = statuses.filter((status) => status.category === category);
          return <section key={category} aria-label={W.categories[category]} className="mb-2 last:mb-0">
            <header className="flex h-8 items-center justify-between rounded-lg bg-muted px-2.5 text-[13px] text-muted-foreground">
              <h3>{W.categories[category]}</h3>
              <Button variant="ghost" size="icon-xs" disabled={busy} aria-label={W.add(W.categories[category])}
                className="-mr-1 size-6" onClick={() => { setProblem(''); setRemoving(null); setEditing({ category }); }}><Plus /></Button>
            </header>
            <div className="px-0.5">
              {entries.map((status, index) => editing?.id === status.id
                ? <StatusForm key={status.id} status={status} category={category} busy={busy} onCancel={() => setEditing(null)}
                    onSave={(patch) => mutate('status-update', { id: status.id, patch })} />
                : <StatusRow key={status.id} status={status} count={value.counts?.[status.id] ?? 0} index={index} countInCategory={entries.length} busy={busy}
                    onEdit={() => { setProblem(''); setRemoving(null); setEditing({ id: status.id, category }); }}
                    onDefault={() => mutate('status-update', { id: status.id, patch: { isDefault: true } })}
                    onRemove={() => { setEditing(null); setRemoving(status.id); setReplacement(entries.find((entry) => entry.id !== status.id)?.id ?? null); }}
                    onMove={(direction) => move(status, direction)} dragRef={dragRef} onDrop={drop} />)}
              {editing?.category === category && !editing.id && <StatusForm key={`add-${category}`} category={category} busy={busy}
                onCancel={() => setEditing(null)} onSave={(fields) => mutate('status-add', { fields: { ...fields, category } })} />}
              {entries.some((status) => status.id === removing) && <div className="flex flex-wrap items-center gap-2 border-t py-3 text-sm">
                <span className="mr-auto">{T.settings.memory.willDelete}: {statusLabel(removing)}</span>
                <SelectField label={W.moveIssues} value={replacement} options={entries.filter((status) => status.id !== removing).map((status) => ({ value: status.id, label: statusLabel(status.id) }))}
                  onChange={setReplacement} disabled={busy} />
                <QuietButton disabled={busy} onClick={() => setRemoving(null)}>{T.settings.general.cancel}</QuietButton>
                <DangerButton disabled={busy || !replacement} onClick={() => mutate('status-remove', { id: removing, replacement })}>{T.settings.skills.delete}</DangerButton>
              </div>}
            </div>
          </section>;
        })}
      </div>
      <Problem>{problem}</Problem>
    </Page>;
  }}</Loading>;
}

export const StatusesIcon = CircleDot;
