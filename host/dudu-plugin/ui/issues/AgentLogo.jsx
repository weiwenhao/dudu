import { agentLogo } from './agent-logos.js';
import { cn } from '../lib/cn.js';
// 嘟嘟's own mark: the picture the shell draws in DSH's sidebar and the Activity of an issue (`LOGO` in client.js, the same 96 px file; the iOS app's `DuduLogo` and the plugin's icon.png are the same shape).
import duduMark from './logos/dudu.png';

export function AgentMark({ agent, badge = false }) {
  const mark = agentLogo(agent, badge);
  if (!mark) return null;
  const transform = [mark.inset ? `translate(${mark.inset} ${mark.inset}) scale(${(24 - mark.inset * 2) / 24})` : '', mark.transform].filter(Boolean).join(' ') || undefined;
  return <>
    {mark.background && <rect width="24" height="24" rx="5.5" fill={mark.background} />}
    {mark.parts
      ? <g transform={transform}>{mark.parts.map((part) => <path key={part.fill} d={part.d} fill={part.fill} />)}</g>
      : <path d={mark.path} fill={badge ? mark.color : 'currentColor'} stroke={mark.outline ?? undefined} strokeWidth={mark.outline ? 0.35 : undefined} transform={transform} />}
  </>;
}

/**
 * An agent's logo. `dudu` is the one that is not an agent of an issue (an issue cannot be given to 嘟嘟): it is the provider of a scheduled task done by 嘟嘟 itself, so it is drawn here from its picture,
 * not from `AGENT_LOGOS`, which is what `agentLogo`, the avatars and the Office read.
 */
export function AgentLogo({ agent, className }) {
  // `block`: the other logos are svgs, which the page's reset makes blocks (no gap under them from the line's descender); an image is inline unless it is made one.
  if (agent === 'dudu') return <img src={duduMark} alt="" aria-hidden="true" draggable={false} className={cn('block size-4 shrink-0', className)} data-agent-logo="dudu" />;
  const mark = agentLogo(agent);
  if (!mark) return null;
  const color = ['codex', 'chatgpt'].includes(agent) ? 'var(--dudu-chatgpt-color, #030303)' : mark.color;
  return <svg viewBox="0 0 24 24" style={{ color }} className={cn('size-4 shrink-0', className)} aria-hidden="true" data-agent-logo={agent}>
    <AgentMark agent={agent} />
  </svg>;
}
