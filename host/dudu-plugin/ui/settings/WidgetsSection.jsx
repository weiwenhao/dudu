import { Switch } from '../components/switch.jsx';
import { T } from '../strings.js';
import { REGISTRY } from '../widgets/index.js';
import { Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';

const W = T.settings.widgets;

/** Every widget there is, where it comes from, what it reads, and whether it is on the dashboard (the switch adds or removes it). */
export function WidgetsSection({ request, onChanged }) {
  const state = useLoaded(request, 'dashboard/get');
  const on = new Set((state.value?.layout?.widgets ?? []).map((item) => item.type));
  const set = async (widget, wanted) => {
    await request(wanted ? 'dashboard/add' : 'dashboard/remove', { type: widget.id });
    state.reload();
    onChanged?.();
  };
  return (
    <Loading state={state}>
      {() => (
        <ul className="flex flex-col gap-3">
          {REGISTRY.map((widget) => (
            <li key={widget.id} className="flex items-center gap-3 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{widget.label}</div>
                <div className="text-xs text-muted-foreground">{widget.description}</div>
                <div className="text-xs text-muted-foreground">{W.builtIn} · {W.reads(widget.needs.join(', '))}</div>
              </div>
              <Switch checked={on.has(widget.id)} aria-label={W.switchOn(widget.label)} onCheckedChange={(wanted) => set(widget, wanted)} />
            </li>
          ))}
        </ul>
      )}
    </Loading>
  );
}
