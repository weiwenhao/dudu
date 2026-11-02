import { agentLogo } from './agent-logos.js';
import { cn } from '../lib/cn.js';

export function AgentMark({ agent, badge = false }) {
  const mark = agentLogo(agent, badge);
  if (!mark) return null;
  return <>
    {mark.background && <rect width="24" height="24" rx="5.5" fill={mark.background} />}
    <path d={mark.path} fill={badge ? mark.color : 'currentColor'} stroke={mark.outline ?? undefined} strokeWidth={mark.outline ? 0.35 : undefined}
      transform={[mark.inset ? `translate(${mark.inset} ${mark.inset}) scale(${(24 - mark.inset * 2) / 24})` : '', mark.transform].filter(Boolean).join(' ') || undefined} />
  </>;
}

export function AgentLogo({ agent, className }) {
  const mark = agentLogo(agent);
  if (!mark) return null;
  const color = ['codex', 'chatgpt'].includes(agent) ? 'var(--dudu-chatgpt-color, #030303)' : mark.color;
  return <svg viewBox="0 0 24 24" style={{ color }} className={cn('size-4 shrink-0', className)} aria-hidden="true" data-agent-logo={agent}>
    <AgentMark agent={agent} />
  </svg>;
}
