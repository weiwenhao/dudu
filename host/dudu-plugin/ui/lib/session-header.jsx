import { useEffect, useRef } from 'react';

export const ISSUE_HEADER_SLOT = 'dudu.issue.header.actions';

/** Reuse the host's live Team and Jobs controls, including their stores, locale and body portals. */
export function installIssueHeader(ctx, h) {
  const source = 'conversation.session.header.actions';
  return ctx.slots.inject(ISSUE_HEADER_SLOT, () => {
    const registered = new Map();
    const sync = () => {
      const entries = ctx.slots.entries(source).filter((entry) => ['agent-team', 'job-list'].includes(entry.options.id));
      for (const [id, current] of registered) {
        if (entries.includes(current.entry)) continue;
        current.dispose();
        registered.delete(id);
      }
      for (const entry of entries) {
        const id = entry.options.id;
        if (registered.has(id)) continue;
        const NativeAction = entry.component;
        const dispose = ctx.slots.register({
          ...entry.options, name: ISSUE_HEADER_SLOT,
          ...(entry.inject ? { inject: entry.inject } : {}),
          ...(entry.locale ? { locale: entry.locale } : {}),
        }, (props) => h(IssueHeaderAction, {
          ...props, kind: id, NativeAction,
          // DSH's action only navigates from its main view. This retained conversation is also a visible owner.
          openTeammate: (sessionId, childSessionId) => {
            const parentSessionId = ctx.sessions.binding(sessionId)?.session.getSnapshot().subagent?.address.parentSessionId ?? sessionId;
            ctx.uiWorkspace.openSession(childSessionId === parentSessionId ? parentSessionId : {
              parentSessionId, childSessionId, mode: 'continuable',
            });
            props.onNavigate?.();
          },
        }));
        registered.set(id, { entry, dispose });
      }
    };
    const unsubscribe = ctx.slots.subscribe(source, sync);
    sync();
    return () => { unsubscribe(); for (const entry of registered.values()) entry.dispose(); };
  });
}

function IssueHeaderAction({ kind, NativeAction, ...props }) {
  const root = useRef(null);
  useEffect(() => {
    const marked = new Set();
    const sync = () => {
      if (!root.current?.querySelector('[aria-expanded="true"]')) return;
      const panel = kind === 'agent-team' ? document.querySelector('[data-team-panel]')
        : [...document.querySelectorAll('ul[aria-label]')].find((node) => node.getAttribute('aria-label') === props.t('list.aria'))?.parentElement;
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
  }, [kind, props.t]);
  return <div ref={root} className="shrink-0" data-dudu-session-header-action={kind}><NativeAction {...props} /></div>;
}
