import { useState } from 'react';
import { Button } from '../components/button.jsx';
import { Checkbox } from '../components/checkbox.jsx';
import { T } from '../strings.js';
import { Card, Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';

const G = T.settings.general;

/** The folder 嘟嘟 keeps its Markdown files in: where it is, and a way to change it (the plugin says why a folder is refused). */
function FolderCard({ request, state, reload }) {
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState('');
  const [move, setMove] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async () => {
    setProblem('');
    try {
      const result = await request('assistant/folder', { path, move });
      if (result.outcome === 'success') { setEditing(false); reload(); } else setProblem(result.message ?? T.settings.failed);
    } catch { setProblem(T.settings.failed); }
  };
  return (
    <Card title={G.folder} action={!editing && <Button variant="outline" size="sm" onClick={() => { setPath(state.projectFolder ?? ''); setMove(false); setProblem(''); setEditing(true); }}>{G.change}</Button>}>
      {state.projectFolder ? (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate" title={state.projectFolder}>{state.projectFolder}</code>
          {state.isDefault && <span className="rounded-full border px-2 text-xs text-muted-foreground">{G.isDefault}</span>}
        </div>
      ) : <p className="text-danger-foreground">{state.problems?.[0] ?? T.settings.unavailable}</p>}
      {editing && (
        <div className="mt-3 flex flex-col gap-3">
          <input
            value={path} onChange={(event) => setPath(event.target.value)} aria-label={G.path} spellCheck={false}
            className="h-9 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={move} onCheckedChange={(value) => setMove(value === true)} aria-label={G.moveFiles} />{G.moveFiles}</label>
          {problem && <p className="text-xs text-danger-foreground" role="alert">{problem}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>{G.cancel}</Button>
            <Button size="sm" disabled={!path.trim()} onClick={save}>{G.save}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** What the page's Export gives: every issue, its log, sessions and changes as one file (the store's own export). */
function IssuesCard({ request }) {
  const [problem, setProblem] = useState('');
  const download = async () => {
    setProblem('');
    try {
      const data = await request('issues/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `dudu-issues-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setProblem(G.exportFailed); }
  };
  return (
    <Card title={G.issues}>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={download}>{G.exportIssues}</Button>
        {problem && <span className="text-xs text-danger-foreground" role="alert">{problem}</span>}
      </div>
    </Card>
  );
}

export function GeneralSection({ request }) {
  const state = useLoaded(request, 'assistant/state');
  return (
    <div className="flex flex-col gap-4">
      <Loading state={state}>{(value) => <FolderCard request={request} state={value} reload={state.reload} />}</Loading>
      <IssuesCard request={request} />
    </div>
  );
}
