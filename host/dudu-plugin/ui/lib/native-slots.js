// Native entries may own child slots. Mirror those under private names so a
// wrapper keeps the host's inject, locale and renderSlot bindings intact.
export function mirrorNativeSlot(ctx, h, source, target, render = (Component, props) => h(Component, props),
  accept = () => true, optionsFor = (options) => options) {
  return ctx.slots.inject(target, () => {
    const registered = new Map();
    let serial = 0;
    const sync = () => {
      const entries = ctx.slots.entries(source).filter(accept);
      for (const [entry, dispose] of registered) {
        if (entries.includes(entry)) continue;
        dispose();
        registered.delete(entry);
      }
      for (const entry of entries) {
        if (registered.has(entry)) continue;
        const { component, options, children: childSlots, ...shares } = entry;
        const children = Object.entries(childSlots ?? {});
        const prefix = `${target}.${serial++}`;
        const names = new Map(children.map(([name]) => [name, `${prefix}.${name}`]));
        const disposers = [ctx.slots.register({
          ...options, ...shares, ...optionsFor(options), name: target,
          ...(children.length ? { children: Object.fromEntries(children.map(([name, options]) => [names.get(name), options])) } : {}),
        }, (props) => render(component, {
          ...props,
          ...(children.length ? { renderSlot: (name, ...args) => props.renderSlot(names.get(name) ?? name, ...args) } : {}),
        }, options.id))];
        for (const [name] of children) disposers.push(mirrorNativeSlot(ctx, h, name, names.get(name)));
        registered.set(entry, () => { for (const dispose of disposers.toReversed()) dispose(); });
      }
    };
    const unsubscribe = ctx.slots.subscribe(source, sync);
    sync();
    return () => { unsubscribe(); for (const dispose of registered.values()) dispose(); };
  });
}
