import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { Badge } from '../components/badge.jsx';
import { diagnostic, T } from '../strings.js';
import { Field, Group, IconAction, Page, PrimaryButton, Problem, QuietButton, Row, TextField, useFocusAfterRefusal } from '../settings/kit.jsx';

const P = T.settings.connectorsPage;
const U = P.custom;
const C = T.settings.connectors;
const G = T.settings.general;
const ASK_AFTER_MS = 400;

/** How the host says a thing signs in, as the words under the box: a remote one by its `auth`, a local one is a command, a sentence is its own words. */
const howOf = (kind, auth) => (kind === 'remote' ? auth : kind === 'local' ? 'command' : 'sentence');

/**
 * What the host takes the box for, asked 400 ms after the last key (an address may take seconds to answer). `asking` holds from the first key until
 * the host has answered for the text that is in the box; `result` is that answer, or null.
 */
function useRecognized(request, text) {
  const value = text.trim();
  const [answer, setAnswer] = useState({ text: '', result: null }); // the host's last answer, and the text it was for
  useEffect(() => {
    if (!value) return undefined;
    let current = true;
    const timer = setTimeout(async () => {
      let result = null;
      try { result = await request('connectors/recognize', { text: value }); } catch { /* not recognised: nothing can be saved */ }
      if (current) setAnswer({ text: value, result });
    }, ASK_AFTER_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [request, value]);
  const answered = value !== '' && answer.text === value;
  return { asking: value !== '' && !answered, result: answered ? answer.result : null };
}

/**
 * The page of one box: whatever the owner puts in it (an address, a command, a file of servers, or a sentence on how to read), Dudu takes it for something
 * and says what under the box, so that no kind is asked. Only what the box turns out to need is asked after it: a name, a token, an environment variable.
 */
export function CustomConnector({ request, onBack, onAdded }) {
  const form = useRef(null);
  const left = useRef(false); // the owner went back while the host was still saving: its answer no longer moves them
  const named = useRef(false); // the owner wrote the name themselves: what the host calls it no longer replaces it
  const rowId = useRef(0);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [env, setEnv] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const { asking, result } = useRecognized(request, text);
  useEffect(() => () => { left.current = true; }, []);
  useEffect(() => { if (!asking && !named.current) setName(result?.name ?? ''); }, [asking, result]);
  useFocusAfterRefusal(form, problem, busy);

  const kind = result?.kind ?? null;
  const several = kind !== null && result.count > 1; // a file with several servers: they are all added, each under its own name
  const askToken = kind === 'remote' && result.auth === 'token' && !several;
  const askEnv = kind === 'local' && !several;
  const ready = kind !== null && !asking && !busy && (several || name.trim() !== '');
  const why = !asking && typeof result?.message === 'string' ? diagnostic(result.message) : ''; // what the host found wrong with it (an address that did not answer)

  const setVariable = (id, patch) => setEnv((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setProblem('');
    try {
      const variables = askEnv ? env.filter((row) => row.name.trim()) : [];
      const answer = await request('connectors/add', {
        text: text.trim(),
        ...(several ? {} : { name: name.trim() }),
        ...(askToken && token.trim() ? { token: token.trim() } : {}),
        ...(variables.length ? { env: Object.fromEntries(variables.map((row) => [row.name.trim(), row.value])) } : {}),
      });
      if (['success', 'no_op'].includes(answer.outcome)) onAdded(!left.current);
      else if (!left.current) setProblem(diagnostic(answer.message) ?? T.toast.failed);
    } catch { if (!left.current) setProblem(T.toast.failed); }
    finally { if (!left.current) setBusy(false); }
  };

  return (
    <Page title={P.addCustom} back={<IconAction label={P.back} onClick={onBack}><ChevronLeft aria-hidden="true" /></IconAction>}>
      <Group label={P.addCustom}>
        <Row block>
          <form
            ref={form} data-inline-form="" className="flex flex-col gap-3"
            onSubmit={(event) => { event.preventDefault(); void submit(); }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack(); }
              else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
            }}
          >
            <TextField
              aria-label={U.placeholder} placeholder={U.placeholder} rows={3} autoFocus value={text} disabled={busy} spellCheck={false}
              className="min-h-[88px]" onChange={(event) => setText(event.target.value)}
            />
            {asking ? <p className="text-xs/[18px] text-muted-foreground">{U.checking}</p> : kind !== null && (
              <p className="flex items-center gap-2 text-xs/[18px] text-muted-foreground">
                <Badge>{U.kind[kind]}</Badge>{several ? U.several(result.count) : U.how[howOf(kind, result.auth)]}
              </p>
            )}
            {!several && (
              <Field
                aria-label={C.name} placeholder={C.name} maxLength={100} value={name} disabled={busy}
                onChange={(event) => { named.current = event.target.value.trim() !== ''; setName(event.target.value); }}
              />
            )}
            {askToken && <Field type="password" aria-label={U.token} placeholder={U.token} autoComplete="off" value={token} disabled={busy} onChange={(event) => setToken(event.target.value)} />}
            {askEnv && (
              <div className="flex flex-col gap-3">
                {env.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <Field aria-label={U.envName} placeholder={U.envName} spellCheck={false} autoComplete="off" value={row.name} disabled={busy} className="w-[38%] shrink-0" onChange={(event) => setVariable(row.id, { name: event.target.value })} />
                    <Field type="password" aria-label={U.envValue} placeholder={U.envValue} autoComplete="off" value={row.value} disabled={busy} className="min-w-0 flex-1" onChange={(event) => setVariable(row.id, { value: event.target.value })} />
                    <IconAction label={C.remove} disabled={busy} onClick={() => setEnv((rows) => rows.filter((item) => item.id !== row.id))}><X aria-hidden="true" /></IconAction>
                  </div>
                ))}
                <div><QuietButton className="-ml-3" disabled={busy} onClick={() => setEnv((rows) => [...rows, { id: ++rowId.current, name: '', value: '' }])}>{U.addEnv}</QuietButton></div>
              </div>
            )}
            <Problem>{problem || why}</Problem>
            <div className="flex justify-end gap-2">
              <QuietButton onClick={onBack}>{G.cancel}</QuietButton>
              <PrimaryButton type="submit" disabled={!ready}>{G.save}</PrimaryButton>
            </div>
          </form>
        </Row>
      </Group>
    </Page>
  );
}
