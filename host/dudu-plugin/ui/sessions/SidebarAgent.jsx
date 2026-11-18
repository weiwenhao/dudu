import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AgentAvatar } from '../issues/icons.jsx';
import { AGENT_NAMES } from '../issues/model.js';
import { getLocale, subscribeLocale } from '../lib/locale.mjs';
import { sidebarSessionState } from './sidebar-state.js';

// The agents that have an avatar in the sidebar: every one of the issues' (Claude, ChatGPT, the other harnesses, DeepSeek).
const known = (agent) => Object.hasOwn(AGENT_NAMES, agent);

export function SidebarAgent({ sessionId, sessions, activity, useSessionStatus }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const list = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot);
  const live = useSessionStatus?.((statuses) => statuses.get(sessionId));
  const source = useMemo(() => activity.forSession(sessionId), [activity, sessionId]);
  const indexed = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const values = list.byId[sessionId]?.projectionValues ?? list.projectionsBySession?.[sessionId]?.values;
  const selection = values?.modelSelection?.next ?? values?.modelSelection?.lastUsed;
  const provider = selection?.provider;
  const mapped = ['deepseek-account', 'deepseek-official'].includes(provider) ? 'deepseek' : provider;
  const agent = known(mapped) ? mapped : indexed?.agent;
  const mark = sidebarSessionState(live, indexed);
  const anchor = useRef(null);
  const [cell, setCell] = useState(null);
  useEffect(() => { void sessions.refreshProjections?.(sessionId).catch(() => {}); }, [sessions, sessionId]);
  useLayoutEffect(() => {
    // DSH's leading slot disappears while working. Its always-mounted action slot anchors
    // a portal into the existing status cell without replacing any host-owned DOM nodes.
    const row = anchor.current?.closest('[data-row-key]');
    const leading = row?.firstElementChild;
    if (row?.dataset.rowKey === `session:${sessionId}` && leading?.tagName === 'SPAN') setCell(leading);
  }, [sessionId]);
  return <>
    <span ref={anchor} hidden />
    {cell && known(agent) && createPortal(
      <span className="dudu" data-dudu-sidebar-agent="" style={{ display: 'inline-flex', width: 16, height: 16, '--background': 'transparent' }}>
        <AgentAvatar agent={agent} state={mark} compact logoClassName="size-3.5" />
      </span>, cell)}
  </>;
}
