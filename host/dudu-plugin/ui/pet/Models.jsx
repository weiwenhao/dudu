import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, LoaderCircle } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { HARNESS_AGENTS } from '../issues/model.js';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { ownPetInteraction } from './overlays.js';

const P = T.pet;
const empty = { current: null, groups: [], status: 'idle', error: null };
const noop = () => () => {};

// One row of the box: what it chooses, its value now, and a chevron: the row opens its own list beside the box (as DSH's does).
function Row({ label, value, active, onOpen }) {
  return <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={active} onClick={onOpen} onMouseEnter={onOpen}
    onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); onOpen(); } }}
    className={cn('flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm outline-none focus-visible:bg-accent', active ? 'bg-accent' : 'hover:bg-accent/60')}>
    <span className="shrink-0">{label}</span>
    <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{value}</span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
  </button>;
}

function Choice({ checked, disabled, onSelect, children }) {
  return <button type="button" role="menuitemradio" aria-checked={checked} disabled={disabled} onClick={onSelect}
    className={cn('flex h-[34px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50', checked && 'bg-accent')}>
    <span className="min-w-0 flex-1 truncate">{children}</span>{checked && <Check className="size-4 shrink-0" aria-hidden="true" />}
  </button>;
}

/**
 * The model and its reasoning effort, in DSH's place for them: right of the box, the model's name and the effort in a lighter grey. It opens one
 * small box with two rows (Model, Reasoning effort), each with its value; a row shows its list beside the box, and choosing from it closes everything.
 * The same session directory as DSH's model menu; selections survive reloads and apply to the next request.
 */
export function ConversationControls({ sessionId, model, actions, renderPermission, locked, onError }) {
  const [retained, setRetained] = useState(null);
  const session = retained && retained.id === sessionId && retained.actions === actions ? retained.value : null;
  useEffect(() => {
    if (!sessionId || !actions.conversationModels) return;
    let active = true;
    let release;
    actions.conversationModels(sessionId).then(async (value) => {
      release = value.release;
      if (!active) { release(); return; }
      setRetained({ id: sessionId, actions, value });
      await value.directory.load();
    }).catch(() => { if (active) onError(T.pet.failed); });
    return () => { active = false; release?.(); };
  }, [actions, sessionId, onError]);
  return <>
    {renderPermission && session?.reference && <div className="dudu-pet-permission" onPointerDownCapture={ownPetInteraction} onKeyDownCapture={ownPetInteraction}>
      {renderPermission(session.reference, { locked })}
    </div>}
    <span className="flex-1" />
    <Models directory={session?.directory} model={model} actions={actions} onError={onError} />
  </>;
}

function Models({ directory, model, actions, onError }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [picking, setPicking] = useState(false);
  const state = useSyncExternalStore(directory?.store.subscribe ?? noop, directory?.store.getSnapshot ?? (() => empty));
  const current = state.current ?? model;
  const groups = state.groups.filter((group) => !HARNESS_AGENTS.includes(group.id));
  const selected = groups.find((group) => group.id === current?.provider)?.models.find((item) => item.id === current?.model);
  const efforts = selected?.reasoning?.efforts ?? [];
  const effort = efforts.find((item) => item.id === (current?.reasoningEffort ?? selected?.reasoning?.defaultEffort));
  const effortLabel = effort?.name ?? current?.reasoningEffort ?? T.settings.general.isDefault;
  const name = selected?.name ?? P.model;
  const busy = picking || state.status === 'selecting';
  const close = () => { setOpen(false); setList(null); };
  const pick = async (selection) => {
    if (busy) return;
    setPicking(true);
    try {
      const result = actions.selectConversationModel ? await actions.selectConversationModel(selection) : await directory.select(selection);
      if (!(result.ok || result.outcome === 'success')) throw new Error();
      if (actions.selectConversationModel) await directory.load();
      onError('');
      close();
    } catch { onError(T.pet.failed); }
    finally { setPicking(false); }
  };
  if (!actions.conversationModels) return null;
  return <Popover open={open} onOpenChange={(value) => {
    setOpen(value);
    setList(null);
    if (value) void directory?.load().catch(() => onError(T.pet.failed));
  }}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="xs" aria-haspopup="menu" disabled={!directory || busy}
        className="h-[30px] min-w-0 gap-1.5 rounded-full pr-1.5 pl-2 text-[13px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent">
        <span className="max-w-[190px] truncate">{name}</span>
        {efforts.length > 0 && <span className="shrink-0 opacity-60">{effortLabel}</span>}
        {busy ? <LoaderCircle className="animate-spin opacity-70" /> : open ? <ChevronUp className="opacity-70" /> : <ChevronDown className="opacity-70" />}
      </Button>
    </PopoverTrigger>
    <PopoverContent data-pet-menu="" side="top" align="end" role="menu" aria-label={`${P.model}, ${P.effort}`} className="relative w-[250px] p-1">
      <Row label={P.model} value={name} active={list === 'model'} onOpen={() => setList('model')} />
      {efforts.length > 0 && <Row label={P.effort} value={effortLabel} active={list === 'effort'} onOpen={() => setList('effort')} />}
      {list && <div className="absolute right-full bottom-0 pr-1">
        <div role="menu" aria-label={list === 'model' ? P.model : P.effort} className="max-h-[260px] w-[212px] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg">
          {list === 'model' && groups.map((group) => <div key={group.id} role="group" aria-label={group.name}>
            {groups.length > 1 && <div className="px-2.5 pt-2 pb-1 text-xs text-muted-foreground">{group.name}</div>}
            {group.models.map((item) => <Choice key={item.id} checked={group.id === current?.provider && item.id === current?.model} disabled={busy}
              onSelect={() => void pick(group.id === current?.provider && item.id === current?.model
                ? current
                : { provider: group.id, model: item.id, ...(item.reasoning?.defaultEffort ? { reasoningEffort: item.reasoning.defaultEffort } : {}) })}>{item.name}</Choice>)}
          </div>)}
          {list === 'effort' && <>
            {!selected.reasoning.defaultEffort && <Choice checked={!current?.reasoningEffort} disabled={busy}
              onSelect={() => void pick({ provider: current.provider, model: current.model })}>{T.settings.general.isDefault}</Choice>}
            {efforts.map((item) => <Choice key={item.id} checked={item.id === effort?.id} disabled={busy}
              onSelect={() => void pick({ ...current, reasoningEffort: item.id })}>{item.name}</Choice>)}
          </>}
        </div>
      </div>}
    </PopoverContent>
  </Popover>;
}
