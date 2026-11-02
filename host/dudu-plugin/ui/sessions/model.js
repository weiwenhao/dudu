// What a row of the session list says about itself, shared by the list and the detail.
import { AGENT_NAMES } from '../issues/model.js';
import { T } from '../strings.js';

/** The agent behind a session: a DSH session says which one it runs (`agent`), a harness session is its own provider. */
export const agentOf = (session) => session.agent || (session.provider === 'dsh' ? 'deepseek' : session.provider);

/** Its name as the interface already writes it (DeepSeek Harness, not just DeepSeek: the session lives in DSH). */
export const agentName = (session) => {
  const agent = agentOf(session);
  return agent === 'deepseek' ? T.widgets.sessions.agents.dsh : (AGENT_NAMES[agent] ?? T.widgets.sessions.agents[session.provider] ?? session.provider);
};

/** The project it belongs to: the folder's name. */
export const projectOf = (session) => session.project?.name || session.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || T.widgets.sessions.agents[session.provider] || session.provider;
