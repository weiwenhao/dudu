import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Badge } from '../components/badge.jsx';
import { Checkbox } from '../components/checkbox.jsx';
import { Switch } from '../components/switch.jsx';
import { formatDateTime } from '../lib/locale.mjs';
import { diagnostic, T } from '../strings.js';
import { ActionButton, Choice, Field, Group, Loading, Page, PrimaryButton, Problem, QuietButton, Row } from './kit.jsx';
import { useLoaded } from './use-loaded.js';

const G = T.settings.general;

/** The folder 嘟嘟 keeps its Markdown files in: where it is, and a way to change it (the plugin says why a folder is refused). */
function FolderRows({ request, state, reload, readOnly = false }) {
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
    <>
      <Row
        title={G.folder}
        meta={state.projectFolder ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="min-w-0 font-mono [overflow-wrap:anywhere]">{state.projectFolder}</code>
            {state.isDefault && <Badge>{G.isDefault}</Badge>}
          </span>
        ) : <span className="text-danger-foreground">{diagnostic(state.problems?.[0]) ?? T.settings.unavailable}</span>}
      >
        {!editing && !readOnly && <ActionButton onClick={() => { setPath(state.projectFolder ?? ''); setMove(false); setProblem(''); setEditing(true); }}>{G.change}</ActionButton>}
      </Row>
      {editing && (
        <Row block>
          <div className="flex flex-col gap-3">
            <Field value={path} onChange={(event) => setPath(event.target.value)} aria-label={G.path} spellCheck={false} autoFocus className="font-mono text-xs" />
            <label className="flex w-fit items-center gap-2"><Checkbox checked={move} onCheckedChange={(value) => setMove(value === true)} aria-label={G.moveFiles} />{G.moveFiles}</label>
            <Problem>{diagnostic(problem)}</Problem>
            <div className="flex justify-end gap-2">
              <QuietButton onClick={() => setEditing(false)}>{G.cancel}</QuietButton>
              <PrimaryButton disabled={!path.trim()} onClick={save}>{G.save}</PrimaryButton>
            </div>
          </div>
        </Row>
      )}
    </>
  );
}

/** `assistant/settings` and one way to change it: saves a patch, reads the settings again, and says so when it could not (the pet's switches, deep sleep). */
function useSettings(request, onChanged) {
  const value = useLoaded(request, 'assistant/settings');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const change = async (patch) => {
    setSaving(true);
    setProblem('');
    try {
      const result = await request('assistant/settings', { patch });
      if (result.outcome !== 'success') throw new Error();
      value.reload();
      onChanged?.();
    } catch { setProblem(T.toast.failed); }
    finally { setSaving(false); }
  };
  return { value, problem, saving, change };
}

/** The pet: whether it is there, and the two keys that talk to it. */
function PetGroup({ request, onChanged }) {
  const { value, problem, saving, change } = useSettings(request, onChanged);
  return (
    <Loading state={value} rows={3}>{(data) => (
      <Group title={G.pet}>
        {[['enabled', G.showPet], ['doubleSpace', G.doubleSpace], ['voice', G.holdSpace]].map(([key, title]) => (
          <Row key={key} as="label" title={title} className="cursor-pointer">
            <Switch checked={data.settings.pet[key]} onCheckedChange={(checked) => change({ pet: { [key]: checked } })} disabled={saving} aria-label={title} />
          </Row>
        ))}
        {problem && <Row block><Problem>{problem}</Problem></Row>}
      </Group>
    )}</Loading>
  );
}

/** Deep sleep: whether an idle agent that nobody has handled for half an hour is put to sleep. It is on until the owner turns it off. */
function DeepSleepRow({ request }) {
  const { value, problem, saving, change } = useSettings(request);
  if (!value.value) return null;
  return (
    <>
      <Row as="label" title={G.deepSleep} className="cursor-pointer">
        <Switch checked={value.value.settings.deepSleep !== false} onCheckedChange={(checked) => change({ deepSleep: checked })} disabled={saving} aria-label={G.deepSleep} />
      </Row>
      {problem && <Row block><Problem>{problem}</Problem></Row>}
    </>
  );
}

/** Dudu's durable defaults use the live model and permission catalogs, in the same fields as the other settings. */
function ConversationGroup({ request, actions, onChanged }) {
  const value = useLoaded(request, 'assistant/conversation-settings');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const change = async (patch) => {
    setSaving(true);
    setProblem('');
    try {
      const result = await request('assistant/conversation-settings', { patch });
      if (result.outcome !== 'success') throw new Error();
      value.reload();
      onChanged?.();
    } catch { setProblem(T.toast.failed); }
    finally { setSaving(false); }
  };
  return (
    <Loading state={value} rows={3}>{(data) => {
      const selected = data.model;
      const models = data.groups.flatMap((group) => group.models.map((model) => ({ ...model, provider: group.id, group: group.name })));
      const current = models.find((model) => model.provider === selected?.provider && model.id === selected?.model);
      const efforts = current?.reasoning?.efforts ?? [];
      const field = (label, choice, options, select) => <Row title={label} aria-busy={saving}>
        {saving && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
        <div className="w-[240px] max-w-[calc(100vw-144px)]">
          <Choice label={label} showLabel={false} value={choice} options={options} onChange={select} disabled={saving || !options.length} />
        </div>
      </Row>;
      return <Group title={`${T.brand} · ${G.isDefault}`}>
        {field(G.model, current ? JSON.stringify([current.provider, current.id]) : '', models.map((model) => ({
          value: JSON.stringify([model.provider, model.id]), label: model.name, ...(data.groups.length > 1 ? { hint: model.group } : {}),
        })), (key) => {
          const [provider, model] = JSON.parse(key);
          const target = models.find((item) => item.provider === provider && item.id === model);
          void change({ model: { provider, model, ...(target.reasoning?.defaultEffort ? { reasoningEffort: target.reasoning.defaultEffort } : {}) } });
        })}
        {efforts.length > 0 && field(T.pet.effort, selected.reasoningEffort ?? current.reasoning.defaultEffort ?? '', [
          ...(!current.reasoning.defaultEffort ? [{ value: '', label: G.isDefault }] : []),
          ...efforts.map((item) => ({ value: item.id, label: item.name })),
        ], (reasoningEffort) => void change({ model: { provider: selected.provider, model: selected.model, ...(reasoningEffort ? { reasoningEffort } : {}) } }))}
        {field(actions.conversationPermissionTitle?.() ?? T.activity.access, data.settings.permission, data.permissions.map((option) => ({
          value: option.value, label: actions.conversationPermissionLabel?.(option) ?? option.name,
        })), (permission) => void change({ permission }))}
        {problem && <Row block><Problem>{problem}</Problem></Row>}
      </Group>;
    }}</Loading>
  );
}

/** What the page's Export gives: every issue, its log, sessions and changes as one file (the store's own export); and the last tidy. */
function IssuesGroup({ request, state, reload, phone = false }) {
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
  const tidy = state?.lastIssueTidy;
  return (
    <Group title={G.issues}>
      <Row title={G.lastTidy} meta={tidy ? formatDateTime(tidy.at) : G.noTidy}>
        {tidy?.groupId && <ActionButton onClick={async () => {
          setProblem('');
          try {
            const result = await request('issues/tidy-undo');
            if (!['success', 'no_op'].includes(result.outcome)) throw new Error();
            reload?.();
          } catch { setProblem(T.toast.failed); }
        }}>{G.undoTidy}</ActionButton>}
      </Row>
      {!phone && (
        <Row title={G.exportIssues}>
          <ActionButton aria-label={G.exportIssues} onClick={download}>{G.export}</ActionButton>
        </Row>
      )}
      {problem && <Row block><Problem>{problem}</Problem></Row>}
      <DeepSleepRow request={request} />
    </Group>
  );
}

// `actions.phone` is the phone's page (ui/phone): the project folder is shown and not changed there ("手机上只显示路径，不选文件夹"), and what belongs to the
// desktop (the pet, the file an export saves) is not offered.
export function GeneralSection({ request, actions = {}, onChanged }) {
  const state = useLoaded(request, 'assistant/state');
  const phone = actions.phone === true;
  return (
    <Page title={T.settings.nav.general}>
      <Loading state={state} rows={2}>{(value) => (
        <Group label={G.folder}>
          <FolderRows request={request} state={value} reload={state.reload} readOnly={phone} />
        </Group>
      )}</Loading>
      <ConversationGroup request={request} actions={actions} onChanged={onChanged} />
      {!phone && <PetGroup request={request} onChanged={onChanged} />}
      <IssuesGroup request={request} state={state.value} reload={state.reload} phone={phone} />
    </Page>
  );
}
