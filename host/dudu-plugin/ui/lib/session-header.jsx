import { useEffect, useRef } from 'react';

export const ISSUE_HEADER_SLOT = 'dudu.issue.header.actions';

// A host action can own child slots (the new subagent panel owns the Team footer).
// Give each clone private child slots, preserving the host component's renderSlot calls.
function mirrorSlot(ctx, h, source, target, render = (Component, props) => h(Component, props), accept = () => true) {
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
          ...options, ...shares, name: target,
          ...(children.length ? { children: Object.fromEntries(children.map(([name, options]) => [names.get(name), options])) } : {}),
        }, (props) => render(component, {
          ...props,
          ...(children.length ? { renderSlot: (name, ...args) => props.renderSlot(names.get(name) ?? name, ...args) } : {}),
        }, options.id))];
        for (const [name] of children) disposers.push(mirrorSlot(ctx, h, name, names.get(name)));
        registered.set(entry, () => { for (const dispose of disposers.toReversed()) dispose(); });
      }
    };
    const unsubscribe = ctx.slots.subscribe(source, sync);
    sync();
    return () => { unsubscribe(); for (const dispose of registered.values()) dispose(); };
  });
}

/** Reuse the host's live team, subagent catalog and jobs controls, including their stores, locale and body portals. */
export function installIssueHeader(ctx, h) {
  const source = 'conversation.session.header.actions';
  return mirrorSlot(ctx, h, source, ISSUE_HEADER_SLOT, (NativeAction, props, id) => h(IssueHeaderAction, {
    ...props, kind: id, NativeAction,
    ...(id === 'subagent-catalog' ? {
      openChild: (address) => {
        props.openChild(address);
        props.onNavigate?.();
      },
      ...(props.openChildAside ? {
        openChildAside: (address) => {
          props.openChildAside(address);
          props.onNavigate?.();
        },
      } : {}),
    } : {}),
    // DSH's action only navigates from its main view. This retained conversation is also a visible owner.
    openTeammate: (sessionId, childSessionId) => {
      const parentSessionId = ctx.sessions.binding(sessionId)?.session.getSnapshot().subagent?.address.parentSessionId ?? sessionId;
      ctx.uiWorkspace.openSession(childSessionId === parentSessionId ? parentSessionId : {
        parentSessionId, childSessionId, mode: 'continuable',
      });
      props.onNavigate?.();
    },
  }), (entry) => ['agent-team', 'subagent-catalog', 'job-list'].includes(entry.options.id));
}

function IssueHeaderAction({ kind, NativeAction, ...props }) {
  const root = useRef(null);
  const { t } = props;
  useEffect(() => {
    const marked = new Set();
    const sync = () => {
      if (!root.current?.querySelector('[aria-expanded="true"]')) return;
      const panel = kind === 'agent-team' ? document.querySelector('[data-team-panel]')
        : kind === 'subagent-catalog'
          ? document.querySelector('[data-subagent-panel]')
            ?? [...document.querySelectorAll('[role="tree"][aria-label]')].find((node) => node.getAttribute('aria-label') === t('tree.aria'))?.parentElement
          : [...document.querySelectorAll('ul[aria-label]')].find((node) => node.getAttribute('aria-label') === t('list.aria'))?.parentElement;
      if (panel && !marked.has(panel)) {
        // These host portals normally sit at z=100. Only the instance opened by this modal sits above its shade.
        panel.setAttribute('data-dudu-session-overlay', '');
        marked.add(panel);
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
    sync();
    return () => { observer.disconnect(); for (const panel of marked) panel.removeAttribute('data-dudu-session-overlay'); };
  }, [kind, t]);
  return <div ref={root} className="shrink-0" data-dudu-session-header-action={kind}><NativeAction {...props} /></div>;
}
