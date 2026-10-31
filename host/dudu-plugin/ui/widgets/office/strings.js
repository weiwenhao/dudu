// The Office widget's own words. The ones everyone shares (status names, the four agent states, "No agent") are in ../../strings.js.
// Words marked NEW are not in the design doc and wait for the owner's review.
import { STATE_ORDER } from './layout.js';

const count = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const O = {
  title: 'Office',
  // The legend in the title row: the clothes of the three agents.
  agents: { claude: 'Claude', codex: 'ChatGPT', deepseek: 'DeepSeek' },
  /**
   * The one sentence that stands for the whole picture, as the doc has it: "Office: 7 issues, 2 need you, 1 stuck, 1 working,
   * 3 idle". NEW: the forms for one ("1 issue", "1 needs you") and for none ("0 issues"); a state nobody is in is left out.
   */
  summary: (counts) => {
    const parts = STATE_ORDER.filter((state) => counts[state] > 0).map((state) => (
      state === 'needs_you' ? (counts[state] === 1 ? '1 needs you' : `${counts[state]} need you`) : `${counts[state]} ${state}`
    ));
    return `Office: ${[count(counts.total, 'issue', 'issues'), ...parts].join(', ')}`;
  },
  // NEW: what a name tag says to a screen reader: the id and title, the status, what the agent is doing.
  tag: (ref, title, status, state) => `${ref} ${title}, ${status}, ${state}`,
  more: (n) => `+${n}`,
};
