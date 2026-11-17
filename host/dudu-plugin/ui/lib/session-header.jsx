import { useEffect, useRef } from 'react';
import { mirrorNativeSlot } from './native-slots.js';

export const ISSUE_HEADER_SLOT = 'dudu.issue.header.actions';
/** The id of the control of a conversation's scheduled tasks in the host's header slot (`client.js`), which this dialog shows too. */
export const TASKS_ENTRY = 'dudu:session-tasks';

/** Reuse the host's live team, subagent catalog and jobs controls, including their stores, locale and body portals. */
export function installIssueHeader(ctx, h) {
  const source = 'conversation.session.header.actions';
  return mirrorNativeSlot(ctx, h, source, ISSUE_HEADER_SLOT, (NativeAction, props, id) => id === TASKS_ENTRY
    // Dudu's own control opens a list of its own, above this dialog's shade (`session-tasks.css`); it only has to be seen as an open header action, so that Escape closes it before the dialog.
    ? h('div', { className: 'shrink-0', 'data-dudu-session-header-action': id }, h(NativeAction, props))
    : h(IssueHeaderAction, {
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
  }), (entry) => ['agent-team', 'subagent-catalog', 'job-list', TASKS_ENTRY].includes(entry.options.id));
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
