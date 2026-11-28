import { T } from '../strings.js';

/** The issue a conversation entry stands for, with the entry's own state laid over it; 嘟嘟's own conversation has no issue and is made one here. */
export const issueOf = entry => entry.issue ? {
  ...entry.issue, pinned: entry.pinned, sessionState: entry.sessionState, receivedAt: entry.receivedAt,
} : { id: 'assistant', title: T.brand, agent: 'dudu', session: 'assistant', pinned: entry.pinned };

/**
 * A sub-issue's title under its parent's, the phones' rule (`BoardConversationTitle`; owner, 2026-11-23: 「父事项这里太长了，缩短一点，我都看不到标题了」): its own
 * title comes first, and the parent gives way down to about 48px, at most 128px when there is room. `mark(text)` is how the title's own words are drawn (the search page marks the words it found).
 */
export function ConversationTitle({ issue, mark = text => text }) {
  return <span className="dudu-conversation-row-title-text">
    {issue.parent && <><span className="max-w-32 min-w-0 shrink-[1000] truncate text-[#96989d]">{issue.parent.title}</span><span className="shrink-0 text-[#96989d]">#</span></>}
    <span className={issue.parent ? 'min-w-0 max-w-[calc(100%_-_3.5rem)] truncate' : 'min-w-0 truncate'}>{mark(issue.title)}</span>
  </span>;
}
