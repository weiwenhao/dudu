import { useMemo, useSyncExternalStore } from 'react';
import { BUILT_IN_WIDGETS, validateDeclaration, validatePluginWidget } from '../../../assistant/dashboard/widgets.mjs';
import { T } from '../strings.js';
import { useWidgetData } from './data.jsx';
import { localizedWidget } from './localized.js';

const builtIn = new Set(BUILT_IN_WIDGETS.map((widget) => widget.id));
/** The plugin's layout knows the built-in widgets by itself; every other widget (a plugin's, or one 嘟嘟 wrote) is announced to it with its declaration. */
export const isBuiltInWidget = (id) => builtIn.has(id);

export function createWidgetSource(slots) {
  let previous;
  let snapshot;
  let revision = 0;
  let observedRevision = -1;
  const errors = new Map();
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  const changed = () => {
    const current = slots.entries('dudu.widget');
    for (const [id, entry] of errors) if (!current.includes(entry)) errors.delete(id);
    revision++;
    emit();
  };
  const stop = slots.subscribe('dudu.widget', changed);
  const stopErrors = slots.onEntryError?.((name, entry) => {
    if (name !== 'dudu.widget') return;
    errors.set(entry.options.id, entry);
    revision++;
    emit();
  });
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() {
      const entries = slots.entries('dudu.widget');
      if (previous !== entries || observedRevision !== revision) {
        previous = entries;
        observedRevision = revision;
        snapshot = { entries, errors: new Map(errors) };
      }
      return snapshot;
    },
    close() { stop(); stopErrors?.(); listeners.clear(); },
  };
}

function WidgetBinding({ renderSlot, id, size, editing }) {
  const api = useWidgetData();
  return renderSlot('dudu.widget', { size, editing, ...api }, { only: id });
}

export function useWidgetCatalog(source, renderSlot) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  return useMemo(() => {
    const widgets = [];
    const problems = [];
    const seen = new Set();
    for (const entry of snapshot.entries) {
      const declaration = entry.component?.duduWidget;
      const id = entry.options.id;
      if (seen.has(id)) continue; // DSH's priority order chooses one occupant for each list id.
      seen.add(id);
      const checked = builtIn.has(id) ? validateDeclaration(declaration) : validatePluginWidget(declaration);
      const origin = entry.registrant ?? id?.split('.')[0] ?? '';
      const label = declaration?.label ?? id;
      if (!checked.ok || declaration?.id !== id) {
        problems.push({ id, label, source: origin, reason: checked.reason ?? T.settings.widgets.idMismatch });
        continue;
      }
      const failed = snapshot.errors.has(id);
      widgets.push(localizedWidget({
        // The widgets 嘟嘟 writes (local.js) are 嘟嘟's own, as the built-in ones are: no "from" line under them.
        ...declaration, needs: declaration.needs ?? [], source: builtIn.has(id) || id.startsWith('local.') ? null : origin, failed,
        Component: function Widget(props) {
          if (failed) throw new Error(`Widget ${id} failed.`);
          return <WidgetBinding {...props} id={id} renderSlot={renderSlot} />;
        },
      }));
    }
    return { widgets, problems };
  }, [snapshot, renderSlot]);
}
