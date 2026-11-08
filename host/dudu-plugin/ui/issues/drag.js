import { MANUAL_AGENT_STATES } from './AgentStateMenu.jsx';

// Dropping a card or a row on a group gives it that group's value of the field the groups are made of. Not every field can be given
// by hand: an agent and a project are chosen once, when the issue is assigned; and the agent state, which the session decides, can be
// said by the boss (blocked, idle: never "working", which only a running session is) of an issue that has an agent.
const DROP_FIELDS = ['status', 'priority', 'agentState'];

export const canDrop = (field, key) => DROP_FIELDS.includes(field) && key != null && (field !== 'agentState' || MANUAL_AGENT_STATES.includes(key));
export const canDrag = (field, issue) => DROP_FIELDS.includes(field) && (field !== 'agentState' || (Boolean(issue.agent) && issue.agentState !== 'working'));
/** Whether dropping the issue on that group would change anything. */
export const wouldMove = (field, issue, key) => issue[field] !== key;
