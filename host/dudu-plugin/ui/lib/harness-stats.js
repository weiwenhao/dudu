import { withoutHarnessTiming } from '../../../conversation-timing.mjs';

/** Keep DSH's native statistics controls; its harness samples have usage but no matching generation timing. */
export function installHarnessStats(ctx, { createElement: h, useMemo }) {
  const slot = 'conversation.composer.dock';
  let original;
  let dispose = () => {};
  const sync = () => {
    // DSH split the original `stats` cell into `activity` and `usage`; only the former reads model timing.
    const next = ctx.slots.entries(slot).find((entry) =>
      ['activity', 'stats'].includes(entry.options.id) && entry.registrant !== 'dudu:harness-stats');
    if (next === original) return;
    dispose();
    dispose = () => {};
    original = next;
    if (!original) return;
    const NativeStats = original.component;
    function Stats(props) {
      const excluded = props.useProjection('duduHarnessTiming');
      const native = props.useProjection('sessionStats');
      const corrected = useMemo(() => withoutHarnessTiming(native, excluded), [native, excluded]);
      const useProjection = (key, selector = (value) => value, equal) =>
        props.useProjection(key, (value) => selector(key === 'sessionStats' ? corrected : value), equal);
      return h(NativeStats, { ...props, useProjection });
    }
    dispose = ctx.slots.register({
      name: slot, id: original.options.id, order: original.options.order,
      priority: (original.options.priority ?? 0) - 1, registrant: 'dudu:harness-stats',
      ...(original.inject ? { inject: original.inject } : {}),
      ...(original.locale ? { locale: original.locale } : {}),
    }, Stats);
  };
  return ctx.slots.inject(slot, () => {
    const unsubscribe = ctx.slots.subscribe(slot, sync);
    sync();
    return () => { unsubscribe(); dispose(); original = undefined; };
  });
}

