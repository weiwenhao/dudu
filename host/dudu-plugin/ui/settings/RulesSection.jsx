import { useState } from 'react';
import { Badge } from '../components/badge.jsx';
import { T } from '../strings.js';
import { ActionButton, Group, Loading, Page, PrimaryButton, Problem, QuietButton, Row, TextField } from './kit.jsx';
import { useLoaded } from './use-loaded.js';

const R = T.settings.rules;
const M = T.settings.memory;

/** One rule file: what it says, and the owner's way to change it. */
function RuleFile({ request, name, text, projectFolder, reload }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const edit = () => { setProblem(''); setDraft({ text: text ?? '', previous: text ?? null, projectFolder }); };
  const save = async () => {
    if (busy || !draft) return;
    setBusy(true);
    setProblem('');
    try {
      const result = await request('rules/update', { name, ...draft });
      if (!['success', 'no_op'].includes(result.outcome)) throw new Error();
      setDraft(null);
      reload();
    } catch { setProblem(T.toast.failed); }
    finally { setBusy(false); }
  };
  return (
    <Group
      label={name}
      title={<>{R.files[name].title}<Badge>{name}</Badge></>}
      action={draft ? (
        <>
          <QuietButton disabled={busy} onClick={() => { setDraft(null); setProblem(''); reload(); }}>{M.cancel}</QuietButton>
          <PrimaryButton disabled={busy || draft.text === draft.previous} onClick={save}>{M.save}</PrimaryButton>
        </>
      ) : <ActionButton aria-label={M.editOf(name)} onClick={edit}>{M.edit}</ActionButton>}
    >
      <Row block>
        {draft ? (
          <TextField
            autoFocus value={draft.text} onChange={(event) => setDraft((value) => ({ ...value, text: event.target.value }))}
            aria-label={name} disabled={busy} spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); }
            }}
            className="h-[320px] resize-y px-3.5 py-3 font-mono text-xs/5"
          />
        ) : text ? <pre className="max-h-[320px] overflow-auto font-mono text-xs/5 whitespace-pre-wrap text-muted-foreground">{text}</pre>
          : <p className="py-1 text-muted-foreground">{text === null ? R.missing : R.empty}</p>}
        <Problem className="mt-2">{problem}</Problem>
      </Row>
    </Group>
  );
}

/** The owner edits TRIAGE.md and ASSIGN.md here; Dudu can only read them. */
export function RulesSection({ request }) {
  const state = useLoaded(request, 'rules/get');
  return (
    <Page title={T.settings.nav.rules}>
      <Loading state={state} rows={2}>
        {(value) => ['TRIAGE.md', 'ASSIGN.md'].map((name) => (
          <RuleFile key={name} request={request} name={name} text={value.rules?.[name]} projectFolder={value.projectFolder} reload={state.reload} />
        ))}
      </Loading>
    </Page>
  );
}
