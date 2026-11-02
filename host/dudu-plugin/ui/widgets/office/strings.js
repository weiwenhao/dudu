// The Office widget's own words. The ones everyone shares (status names, the four agent states, "No agent") are in ../../strings.js.
// Words marked NEW are not in the design doc and wait for the owner's review.
import { STATE_ORDER } from './layout.js';
import { localized } from '../../lib/locale.mjs';
import { T } from '../../strings.js';

const count = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

const en = {
  title: 'Office',
  // The legend in the title row: the clothes of the three agents.
  agents: { claude: 'Claude', codex: 'ChatGPT', deepseek: 'DeepSeek' },
  /**
   * The one sentence that stands for the whole picture, using the same In Review wording as the issue.
   * A state nobody is in is left out.
   */
  summary: (counts) => {
    const parts = STATE_ORDER.filter((state) => counts[state] > 0).map((state) => (
      `${counts[state]} ${state === 'needs_you' ? T.status.in_review : state}`
    ));
    return `Office: ${[count(counts.total, 'issue', 'issues'), ...parts].join(', ')}`;
  },
  // NEW: what a name tag says to a screen reader: the id and title, the status, what the agent is doing.
  tag: (ref, title, status, state) => `${ref} ${title}, ${status}, ${state}`,
  more: (n) => `+${n}`,
};

export const O = localized(en, {
  title: '办公室',
  summary: (counts) => `办公室：${[`${counts.total} 条事项`, ...STATE_ORDER.filter((state) => counts[state] > 0).map((state) => `${counts[state]} ${T.agentState[state]}`)].join('，')}`,
});
