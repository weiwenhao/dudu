import { useRef, useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '../components/badge.jsx';
import { Command, CommandItem, CommandList } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { diagnostic, T } from '../strings.js';
import { describeFrequency, lastLine, PRESET_VALUES } from './frequency.js';
import { ActionButton, Choice, Empty, Field, Group, IconAction, Loading, Page, PrimaryButton, Problem, QuietButton, Row, TextField, useFocusAfterRefusal } from './kit.jsx';
import { useLoaded } from './use-loaded.js';

const C = T.settings.collectors;
const G = T.settings.general;

/** How often: a field to write 30m, 2h, 1d or cron in, and under its chevron the common ones, which fill it in. */
function FrequencyField({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const input = useRef(null);
  const list = useRef(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Field ref={input} aria-label={C.frequency} placeholder={C.frequency} maxLength={100} spellCheck={false} className="pr-9" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        <PopoverTrigger asChild>
          <button
            type="button" aria-label={C.common} disabled={disabled}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="end" className="w-[340px]" onOpenAutoFocus={(event) => { event.preventDefault(); list.current?.focus(); }}>
        <Command ref={list} label={C.common}>
          <CommandList>
            {PRESET_VALUES.map((preset) => (
              <CommandItem key={preset} value={C.preset[preset]} onSelect={() => { onChange(preset); setOpen(false); input.current?.focus(); }}>
                <span className="min-w-0 flex-1 truncate">{C.preset[preset]}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{preset}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A collector is a name, the connector it reads through, how often, and what to collect. The same form adds one and changes one.
 */
function CollectorForm({ collector, connectors, busy, problem, onSave, onCancel }) {
  const form = useRef(null);
  useFocusAfterRefusal(form, problem, busy);
  const [name, setName] = useState(collector?.name ?? '');
  const [connector, setConnector] = useState(collector?.connector ?? connectors[0]?.id ?? '');
  const [frequency, setFrequency] = useState(collector?.frequency ?? '');
  const [prompt, setPrompt] = useState(collector?.prompt ?? '');
  const options = connectors.map((entry) => ({ value: entry.id, label: entry.name, hint: T.settings.connectors.kind[entry.kind] }));
  const changed = !collector || name.trim() !== collector.name || connector !== collector.connector || prompt.trim() !== collector.prompt.trim()
    || frequency.trim() !== (collector.frequency ?? '');
  const ready = Boolean(name.trim() && connector && prompt.trim() && changed && !busy);
  const submit = () => { if (ready) onSave({ name: name.trim(), connector, frequency: frequency.trim(), prompt: prompt.trim() }); };
  return (
    <form
      ref={form} data-inline-form="" className="flex flex-col gap-3"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
        else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
      }}
    >
      <Field aria-label={C.name} placeholder={C.name} maxLength={100} autoFocus required value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
      <Choice label={C.connector} value={connector} options={options} disabled={busy} onChange={setConnector} />
      <FrequencyField value={frequency} disabled={busy} onChange={setFrequency} />
      <TextField aria-label={C.prompt} placeholder={C.prompt} rows={3} maxLength={20_000} required value={prompt} disabled={busy} spellCheck={false}
        className="min-h-[88px] resize-y" onChange={(event) => setPrompt(event.target.value)} />
      <Problem>{problem}</Problem>
      <div className="flex justify-end gap-2">
        <QuietButton disabled={busy} onClick={onCancel}>{G.cancel}</QuietButton>
        <PrimaryButton type="submit" disabled={!ready}>{G.save}</PrimaryButton>
      </div>
    </form>
  );
}

/** What 嘟嘟 collects, and when, as COLLECTORS.md keeps it: the owner adds, changes and removes the collectors here. */
export function CollectorsSection({ request }) {
  const state = useLoaded(request, 'collectors/list');
  const access = useLoaded(request, 'connectors/list'); // the connectors a collector can read through
  const collected = useLoaded(request, 'dispatch/state'); // when each collector last ran, and what it brought
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removed, setRemoved] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(null);

  const save = async (fields) => {
    setBusy('save');
    setProblem('');
    try {
      const result = editing ? await request('collectors/update', { id: editing, ...fields }) : await request('collectors/add', fields);
      if (['success', 'no_op'].includes(result.outcome)) { setAdding(false); setEditing(null); state.reload(); collected.reload(); } else setProblem(diagnostic(result.message) ?? T.toast.failed);
    } catch { setProblem(T.toast.failed); }
    finally { setBusy(null); }
  };
  const remove = async (collector) => {
    setBusy(collector.id);
    setProblem('');
    try {
      const result = await request('collectors/remove', { id: collector.id });
      if (!['success', 'no_op'].includes(result.outcome)) { setProblem(T.toast.failed); return; }
      setRemoved({ name: collector.name, token: result.undo });
      state.reload();
    } catch { setProblem(T.toast.failed); }
    finally { setBusy(null); }
  };
  const undo = async () => {
    setProblem('');
    try {
      const result = await request('collectors/undo', { token: removed.token });
      if (result.outcome !== 'success') { setProblem(T.toast.failed); return; }
      setRemoved(null);
      state.reload();
    } catch { setProblem(T.toast.failed); }
  };
  const begin = (id) => { setProblem(''); setRemoved(null); setAdding(id === null); setEditing(id); };

  const connectors = access.value?.connectors ?? [];
  // A collector needs a connector to read through: with none, there is nothing to add yet.
  const noConnector = Boolean(access.value) && connectors.length === 0;
  return (
    <Page title={T.settings.nav.collectors} action={<ActionButton disabled={adding || noConnector} onClick={() => begin(null)}><Plus aria-hidden="true" />{C.add}</ActionButton>}>
      <Loading state={state} rows={2}>{(value) => {
        const collectors = value.collectors ?? [];
        const reads = new Map((collected.value?.collectors ?? []).map((entry) => [entry.id, entry.lastRead]));
        return (
          <>
            {removed && (
              <div role="status" className="flex items-center gap-2 rounded-[14px] bg-muted py-1 pr-1.5 pl-4 text-sm">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{C.removed(removed.name)}</span>
                {removed.token && <QuietButton onClick={undo}>{C.undo}</QuietButton>}
              </div>
            )}
            {adding && (
              <Group title={C.add}><Row block><CollectorForm connectors={connectors} busy={busy === 'save'} problem={problem} onSave={save} onCancel={() => { setAdding(false); setProblem(''); }} /></Row></Group>
            )}
            {!adding && problem && <Problem>{problem}</Problem>}
            {collectors.length === 0 && !adding ? <Group><Empty>{noConnector ? C.needConnector : C.empty}</Empty></Group> : collectors.length > 0 && (
              <Group label={T.settings.nav.collectors}>
                <ul>
                  {collectors.map((collector) => editing === collector.id ? (
                    <Row as="li" key={collector.id} block>
                      <CollectorForm collector={collector} connectors={connectors} busy={busy === 'save'} problem={problem} onSave={save} onCancel={() => { setEditing(null); setProblem(''); }} />
                    </Row>
                  ) : (
                    <Row
                      as="li" key={collector.id}
                      title={<span className="flex flex-wrap items-center gap-2">{collector.name}{collector.connectorName && <Badge>{collector.connectorName}</Badge>}{collector.source === 'dudu' && <Badge>{C.addedByDudu}</Badge>}</span>}
                      meta={(
                        <>
                          <span className="line-clamp-3 whitespace-pre-wrap">{collector.prompt}</span>
                          {reads.get(collector.id) && <span className="mt-0.5 block" title={reads.get(collector.id).error}>{lastLine(reads.get(collector.id))}</span>}
                        </>
                      )}
                    >
                      <span className="max-w-[200px] truncate text-xs text-muted-foreground" title={collector.frequency ?? undefined}>{describeFrequency(collector.frequency)}</span>
                      <IconAction label={T.settings.memory.editOf(collector.name)} disabled={busy !== null} onClick={() => begin(collector.id)}><Pencil aria-hidden="true" /></IconAction>
                      <IconAction label={C.removeOf(collector.name)} disabled={busy !== null} onClick={() => remove(collector)}><Trash2 aria-hidden="true" /></IconAction>
                    </Row>
                  ))}
                </ul>
              </Group>
            )}
          </>
        );
      }}</Loading>
    </Page>
  );
}
