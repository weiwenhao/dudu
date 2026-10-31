import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { T } from '../strings.js';
import { useServices } from '../services.jsx';
import { when } from '../issues/activity.js';
import { Empty, Frame } from './Frame.jsx';
import { usePolled } from './use-polled.js';

const W = T.widgets.sessions;

/**
 * The sessions Claude Code and Codex already have on this computer, searchable (titles, folders and what was said); a click loads
 * one into DSH and opens it. While the conversations are still being read for the search it looks again until they are.
 */
export function Sessions() {
  const { request, openNativeSession } = useServices();
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState({});
  const [reading, setReading] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setAsked(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const { status, value } = usePolled(request, 'sessions/list', { query: asked, limit: 50 }, { every: reading ? 2000 : 15_000 });
  useEffect(() => { setReading(Boolean(value?.indexing?.running)); }, [value]);
  const sessions = value?.sessions ?? [];
  const now = Date.now();
  const open = async (session) => {
    setBusy(session.key);
    setFailure((previous) => ({ ...previous, [session.key]: '' }));
    try { await openNativeSession(session); } catch (problem) { setFailure((previous) => ({ ...previous, [session.key]: problem instanceof Error ? problem.message : W.failed })); } finally { setBusy(''); }
  };
  return (
    <Frame title="Sessions" className="flex flex-col gap-1">
      <div className="relative mx-2 shrink-0">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={W.search} aria-label={W.search}
          className="h-8 w-full rounded-lg border bg-background pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
      {status === 'error' ? <Empty>{W.failed}</Empty> : status === 'ready' && sessions.length === 0 ? <Empty>{W.empty}</Empty> : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {sessions.map((session) => (
            <li key={session.key}>
              <button
                type="button" disabled={busy === session.key} onClick={() => open(session)}
                className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{session.title || session.id}</span>
                  <span className="shrink-0 text-xs text-muted-foreground @max-[260px]:hidden">{W.agents[session.provider] ?? session.provider}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{busy === session.key ? W.opening : when(session.updatedAt, now)}</span>
                </span>
                {session.evidence && <span className="truncate text-xs text-muted-foreground">{session.evidence.text}</span>}
                {failure[session.key] && <span className="truncate text-xs text-danger-foreground">{failure[session.key]}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
