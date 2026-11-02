import { useState } from 'react';
import { Switch } from '../components/switch.jsx';
import { diagnostic, T } from '../strings.js';
import { REGISTRY } from '../widgets/index.js';
import { Card, Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';

const W = T.settings.widgets;

/** Every widget there is, where it comes from, what it reads, and whether it is on the dashboard (the switch adds or removes it). */
export function WidgetsSection({ request, onChanged, registry = REGISTRY, widgetProblems = [] }) {
  const state = useLoaded(request, 'dashboard/get');
  const settings = useLoaded(request, 'assistant/settings');
  const [problem, setProblem] = useState('');
  const on = new Set((state.value?.layout?.widgets ?? []).map((item) => item.type));
  const set = async (widget, wanted) => {
    setProblem('');
    try {
      const result = await request(wanted ? 'dashboard/add' : 'dashboard/remove', { type: widget.id });
      if (!['success', 'no_op'].includes(result.outcome)) throw new Error();
      state.reload();
      onChanged?.();
    } catch { setProblem(T.toast.failed); }
  };
  return (
    <Loading state={state}>
      {() => (
        <div className="flex flex-col gap-[22px]">
        <p className="mx-1 -mb-2.5 text-muted-foreground">{W.note}</p>
        {problem && <p className="text-danger-foreground" role="alert">{problem}</p>}
        {registry.some((widget) => widget.development) && <h3 className="-mb-3.5 ml-1 font-semibold">{W.local}</h3>}
        <ul className="rounded-[20px] border px-5">
          {[...registry].sort((a, b) => Number(Boolean(b.development)) - Number(Boolean(a.development))).map((widget) => (
            <li key={widget.id} className="flex min-h-[76px] items-center gap-3.5 border-t border-border/50 py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="text-[14px]/[22px] font-semibold">{widget.label}{widget.development && <span className="ml-2 text-xs text-muted-foreground">{W.developing}</span>}</div>
                <div className="text-xs text-muted-foreground">{widget.description}</div>
                <div className="text-xs text-muted-foreground">{widget.source ? T.dashboard.source(widget.source) : W.builtIn} · {W.reads(widget.needs.map((need) => T.widgets.needs[need] ?? need).join(', '))}</div>
                {widget.failed && <div className="text-xs text-danger-foreground">{T.dashboard.broken()}</div>}
              </div>
              <Switch checked={on.has(widget.id)} aria-label={W.switchOn(widget.label)} onCheckedChange={(wanted) => set(widget, wanted)} />
            </li>
          ))}
          {widgetProblems.map((widget) => <li key={widget.id} className="rounded-xl border p-3">
            <div className="font-medium">{widget.label}</div>
            <div className="text-xs text-muted-foreground">{T.dashboard.source(widget.source)}</div>
            <p className="text-xs text-danger-foreground">{diagnostic(widget.reason) ?? T.dashboard.broken()}</p>
          </li>)}
        </ul>
        <Card title={W.developer}>
          <label className="flex min-h-[60px] items-center justify-between gap-3.5 py-3">
            <span className="min-w-0">
              <span className="block text-[14px]/[22px] font-semibold">{W.developer}</span>
              <span className="block text-[12px]/[18px] text-muted-foreground">{W.developerDescription}</span>
            </span>
            <Switch checked={settings.value?.settings?.widgets?.developer === true} aria-label={W.developer} onCheckedChange={async (developer) => {
              try {
                const result = await request('assistant/settings', { patch: { widgets: { developer } } });
                if (result.outcome !== 'success') throw new Error();
                settings.reload();
                onChanged?.();
              } catch { setProblem(T.toast.failed); }
            }} />
          </label>
        </Card>
        </div>
      )}
    </Loading>
  );
}
