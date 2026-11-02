import { Button } from '../components/button.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip.jsx';
import { T } from '../strings.js';
import { AgentAvatar } from './icons.jsx';
import { AGENT_NAMES } from './model.js';

export function IssueAgent({ issue, onPreview }) {
  if (!issue.agent || !issue.session) return <AgentAvatar agent={issue.agent} state={issue.agentState} />;
  const label = `${AGENT_NAMES[issue.agent] ?? issue.agent} · ${T.detail.openSession}`;
  return <TooltipProvider><Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-xs"
        aria-label={label} onClick={(event) => { event.stopPropagation(); onPreview(issue); }}>
        <AgentAvatar agent={issue.agent} state={issue.agentState} compact />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip></TooltipProvider>;
}
