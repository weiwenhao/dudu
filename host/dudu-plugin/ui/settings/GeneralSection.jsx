import { useEffect, useState } from 'react';
import { Button } from '../components/button.jsx';
import { Checkbox } from '../components/checkbox.jsx';
import { Switch } from '../components/switch.jsx';
import { diagnostic, T } from '../strings.js';
import { formatDateTime } from '../lib/locale.mjs';
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
      if (['success', 'no_op'].includes(result.outcome)) { setEditing(false); reload(); } else setProblem(result.message ?? T.settings.failed);
    } catch { setProblem(T.settings.failed); }
  };
  return (
    <Card title={G.folder} action={!editing && <Button variant="outline" size="sm" onClick={() => { setPath(state.projectFolder ?? ''); setMove(false); setProblem(''); setEditing(true); }}>{G.change}</Button>}>
      <div className={editing ? 'py-3' : undefined}>
      {state.projectFolder ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2 text-[14px]/[22px] font-semibold">{G.folder}{state.isDefault && <span className="rounded-md border px-1.5 text-[11px]/[18px] font-normal text-muted-foreground">{G.isDefault}</span>}</div>
          <code className="truncate text-xs/5" title={state.projectFolder}>{state.projectFolder}</code>
        </div>
      ) : <p className="text-danger-foreground">{diagnostic(state.problems?.[0]) ?? T.settings.unavailable}</p>}
      {editing && (
        <div className="mt-3 flex flex-col gap-3">
          <input
            value={path} onChange={(event) => setPath(event.target.value)} aria-label={G.path} spellCheck={false}
            className="h-9 w-full rounded-md border bg-background px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={move} onCheckedChange={(value) => setMove(value === true)} aria-label={G.moveFiles} />{G.moveFiles}</label>
          {problem && <p className="text-xs text-danger-foreground" role="alert">{diagnostic(problem)}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>{G.cancel}</Button>
            <Button size="sm" disabled={!path.trim()} onClick={save}>{G.save}</Button>
          </div>
        </div>
      )}
      </div>
    </Card>
  );
}

/** What the page's Export gives: every issue, its log, sessions and changes as one file (the store's own export). */
function IssuesCard({ request, state, reload }) {
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
      <div className="flex min-h-[60px] items-center gap-3 border-b border-border/50 py-3">
        <span className="text-muted-foreground">{G.lastTidy}</span>
        <span className="min-w-0 flex-1">{state?.lastIssueTidy ? formatDateTime(state.lastIssueTidy.at) : G.noTidy}</span>
        {state?.lastIssueTidy?.groupId && <Button variant="outline" size="sm" onClick={async () => {
          try {
            const result = await request('issues/tidy-undo');
            if (!['success', 'no_op'].includes(result.outcome)) throw new Error();
            reload?.();
          } catch { setProblem(T.toast.failed); }
        }}>{G.undoTidy}</Button>}
      </div>
      <div className="flex min-h-[60px] items-center justify-between gap-3 py-3">
        <span className="text-[14px] font-semibold">{G.exportIssues}</span>
        <Button variant="outline" size="sm" aria-label={G.exportIssues} onClick={download}>{G.export}</Button>
        {problem && <span className="text-xs text-danger-foreground" role="alert">{problem}</span>}
      </div>
    </Card>
  );
}

function PetCard({ request, onChanged }) {
  const value = useLoaded(request, 'assistant/settings');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const change = async (key, checked) => {
    setSaving(true);
    setProblem('');
    try {
      const result = await request('assistant/settings', { patch: { pet: { [key]: checked } } });
      if (result.outcome !== 'success') throw new Error();
      value.reload();
      onChanged?.();
    } catch { setProblem(T.toast.failed); }
    finally { setSaving(false); }
  };
  return <Loading state={value}>{(data) => (
    <Card title={G.pet}>
      <div className="flex flex-col">
        {[['enabled', G.showPet], ['doubleSpace', G.doubleSpace], ['voice', G.holdSpace]].map(([key, title]) => (
          <label key={key} className="flex min-h-[60px] items-center justify-between gap-3.5 border-t border-border/50 py-3 first:border-t-0">
            <span className="text-[14px]/[22px] font-semibold">{title}</span>
            <Switch checked={data.settings.pet[key]} onCheckedChange={(checked) => change(key, checked)} disabled={saving} aria-label={title} />
          </label>
        ))}
        {problem && <p className="text-danger-foreground" role="alert">{problem}</p>}
      </div>
    </Card>
  )}</Loading>;
}

export function GeneralSection({ request, actions = {}, onChanged, onClose }) {
  const state = useLoaded(request, 'assistant/state');
  const reload = state.reload;
  useEffect(() => {
    let active = true;
    request('assistant/conversation').then((value) => { if (active && value.outcome === 'success') reload(); }).catch(() => {});
    return () => { active = false; };
  }, [request, reload]);
  const [problem, setProblem] = useState('');
  return (
    <div className="flex flex-col gap-[22px]">
      <Loading state={state}>{(value) => <FolderCard request={request} state={value} reload={state.reload} />}</Loading>
      <PetCard request={request} onChanged={onChanged} />
      <Card title={G.model}>
        <div className="flex min-h-[60px] items-center justify-between gap-3 py-3">
          <span className="min-w-0"><b className="block truncate text-[14px]/[22px] font-semibold">{state.value?.conversation?.model?.model ?? T.widgets.quota.unknown}</b><span className="text-[12px]/[18px] text-muted-foreground">{G.currentModel}</span></span>
          <Button variant="outline" size="sm" onClick={async () => {
            try { await actions.openAssistantModel?.(); onClose?.(); } catch { setProblem(T.pet.failed); }
          }}>{G.changeModel}</Button>
        </div>
        {problem && <p className="text-danger-foreground" role="alert">{problem}</p>}
      </Card>
      <IssuesCard request={request} state={state.value} reload={state.reload} />
    </div>
  );
}
