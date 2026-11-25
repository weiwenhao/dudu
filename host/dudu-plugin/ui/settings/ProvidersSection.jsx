import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { Switch } from '../components/switch.jsx';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { cn } from '../lib/cn.js';
import { diagnostic, T } from '../strings.js';
import { ActionButton, Failed, Field, Group, IconAction, Page, PrimaryButton, Problem, QuietButton, Reading, Row, TextField } from './kit.jsx';

const S = T.shell;
const DOT = { ready: 'bg-success', missing: 'bg-muted-foreground/50', unsupported: 'bg-warning', broken: 'bg-destructive' };
/** A harness's own variables as its text box shows them: one `NAME=value` a line (the plugin reads the box back: providers/index.mjs `parseEnvText`). */
const envText = (env) => Object.entries(env ?? {}).map(([name, value]) => `${name}=${value}`).join('\n');

/** A harness's state and version, after its dot (green: ready). */
function StateLine({ provider }) {
  return (
    <span className="flex items-center gap-1.5">
      <i aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT[provider.state] ?? 'bg-muted-foreground/50')} />
      {[S.providerStates[provider.state] ?? provider.state, provider.version].filter(Boolean).join(' ')}
    </span>
  );
}

/**
 * One harness in the list (owner, 2026-11-24, .local/designs/providers-redesign-2026-11-24): its logo, its name, its state, its switch; the row opens its page. Its path and its
 * environment variables are on that page, not here.
 */
export function ProviderRow({ provider, busy, onEnabled, onOpen }) {
  return (
    <li className="flex min-h-[40px] items-center gap-3 border-t border-border/60 py-3 first:border-t-0 cursor-pointer hover:-mx-2 hover:rounded-xl hover:border-transparent hover:bg-accent/60 hover:px-2 [&:hover+li]:border-transparent"
      onClick={onOpen}>
      <button type="button" aria-label={provider.name} className="flex min-w-[120px] flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <AgentLogo agent={provider.id} className="size-5" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{provider.name}</div>
          <div className="text-xs/[18px] text-muted-foreground"><StateLine provider={provider} /></div>
        </div>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <Switch checked={provider.enabled} disabled={busy} aria-label={`${S.enable}: ${provider.name}`} onCheckedChange={onEnabled} />
        <ChevronRight className="size-4 text-muted-foreground/70" aria-hidden="true" />
      </div>
    </li>
  );
}

/**
 * One harness's page: who it is and its state, its switch, where it is run from (blank: found by itself; the place it was found under the field), and its own environment
 * variables, one `NAME=value` a line. 取消 / 保存 appear in the header only once something differs; 保存 spins while the plugin saves and looks at this harness again.
 */
function ProviderPage({ provider, busy, onBack, onEnabled, onSave }) {
  const [path, setPath] = useState(provider.configuredPath ?? '');
  const [env, setEnv] = useState(() => envText(provider.env));
  const [saving, setSaving] = useState(false);
  const changed = { ...(path !== (provider.configuredPath ?? '') ? { path } : {}), ...(env !== envText(provider.env) ? { env } : {}) };
  const dirty = Object.keys(changed).length > 0;
  const revert = () => { setPath(provider.configuredPath ?? ''); setEnv(envText(provider.env)); };
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try { await onSave(changed); } finally { setSaving(false); }
  };
  const reason = (provider.state === 'unsupported' || provider.state === 'broken') && provider.reason;
  return (
    <Page
      title={provider.name}
      back={<IconAction label={T.settings.connectorsPage.back} onClick={onBack}><ChevronLeft aria-hidden="true" /></IconAction>}
      action={dirty && (
        <>
          <QuietButton disabled={saving} onClick={revert}>{S.cancel}</QuietButton>
          <PrimaryButton disabled={saving} aria-busy={saving || undefined} onClick={() => { void save(); }}>
            {saving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : S.save}
          </PrimaryButton>
        </>
      )}
    >
      <Group label={provider.name}>
        <Row block>
          <div className="flex items-center gap-3">
            <AgentLogo agent={provider.id} className="size-8" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{provider.name}</div>
              <div className="text-xs/[18px] text-muted-foreground"><StateLine provider={provider} /></div>
              {reason && <div className="text-xs/[18px] text-muted-foreground [overflow-wrap:anywhere]">{reason}</div>}
            </div>
          </div>
        </Row>
        <Row title={S.enable}><Switch checked={provider.enabled} disabled={busy || saving} aria-label={`${S.enable}: ${provider.name}`} onCheckedChange={onEnabled} /></Row>
      </Group>
      <Group title={S.executable}>
        <Row block>
          <Field aria-label={`${S.executable}: ${provider.name}`} value={path} placeholder={S.autoFind} disabled={saving} spellCheck={false} autoCapitalize="none" autoCorrect="off"
            className="font-mono text-xs placeholder:font-sans" onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} />
          {provider.path && <div className="mt-2 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{provider.path}</div>}
        </Row>
      </Group>
      <Group title={S.env}>
        <Row block>
          <TextField aria-label={`${S.env}: ${provider.name}`} value={env} rows={5} disabled={saving} spellCheck={false} autoCapitalize="none" autoCorrect="off"
            placeholder={'HTTPS_PROXY=http://127.0.0.1:7890\nHTTP_PROXY=http://127.0.0.1:7890'} className="min-h-[112px] resize-y font-mono text-xs"
            onChange={(event) => setEnv(event.target.value)} />
        </Row>
      </Group>
    </Page>
  );
}

/** The harnesses 嘟嘟 can hand an issue to, as found on this computer: 已启用 and 未启用, and the ones few people have that are not here, folded under one line. */
export function ProvidersSection({ request }) {
  const [providers, setProviders] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showMissing, setShowMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    request('providers/state').then((value) => { if (alive) setProviders(value.providers); }, (failure) => { if (alive) { setFailed(true); setError(diagnostic(failure.message)); } });
    return () => { alive = false; };
  }, [request, attempt]);
  const run = async (action, body) => {
    setBusy(true); setError('');
    try {
      setProviders((await request(`providers/${action}`, body)).providers);
      window.dispatchEvent(new Event('dudu:providers-changed'));
      return true;
    } catch (failure) { setError(diagnostic(failure.message)); return false; }
    finally { setBusy(false); }
  };
  if (!providers) {
    return (
      <Page title={S.providers}>
        {failed ? <Failed onRetry={() => { setFailed(false); setError(''); setAttempt((value) => value + 1); }} /> : <Reading rows={2} />}
      </Page>
    );
  }
  const opened = openId && providers.find((provider) => provider.id === openId);
  if (opened) {
    return (
      <>
        <Problem>{error}</Problem>
        <ProviderPage
          key={`${opened.id}:${opened.configuredPath ?? ''}:${envText(opened.env)}`} provider={opened} busy={busy}
          onBack={() => { setOpenId(null); setError(''); }}
          onEnabled={(enabled) => { void run('save', { id: opened.id, enabled }); }}
          onSave={(changes) => run('save', { id: opened.id, ...changes })}
        />
      </>
    );
  }
  // A harness few people have (the plugin says so: `folds`, or, from a plugin before 2026-11-24, `defaultEnabled: false`) that is not on this computer
  // is one of many a person does not have. Such rows are folded under one line after the cards (owner's pick, 2026-11-19: C of
  // .local/designs/providers-fold-2026-11-19): the word for their state, how many, and their marks, so that what else there is shows
  // without opening it. Claude, ChatGPT and Pi keep their row whatever their state, and so does a folded one once it is found.
  const folded = (provider) => (provider.folds || provider.defaultEnabled === false) && provider.state === 'missing';
  const missing = providers.filter(folded);
  const rows = (list) => (
    <ul>
      {list.map((provider) => (
        <ProviderRow key={provider.id} provider={provider} busy={busy} onOpen={() => { setError(''); setOpenId(provider.id); }}
          onEnabled={(enabled) => { void run('save', { id: provider.id, enabled }); }} />
      ))}
    </ul>
  );
  const shown = providers.filter((provider) => !folded(provider));
  const on = shown.filter((provider) => provider.enabled);
  const off = shown.filter((provider) => !provider.enabled);
  return (
    <Page title={S.providers} action={<ActionButton disabled={busy} onClick={() => run('refresh', {})}><RefreshCw aria-hidden="true" />{busy ? S.busy : S.detect}</ActionButton>}>
      <Problem>{error}</Problem>
      {on.length > 0 && <Group title={S.groupOn}>{rows(on)}</Group>}
      {off.length > 0 && <Group title={S.groupOff}>{rows(off)}</Group>}
      {missing.length > 0 && (
        <Group
          label={S.providerStates.missing}
          title={(
            <button
              type="button" aria-expanded={showMissing} onClick={() => setShowMissing((open) => !open)}
              className="-mx-1 flex h-6 items-center gap-1 rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {S.providerStates.missing}<span className="tabular-nums">{missing.length}</span>
              <span className="mx-1 flex items-center gap-1.5">{missing.map((provider) => <AgentLogo key={provider.id} agent={provider.id} className="size-3.5 opacity-60" />)}</span>
              <ChevronDown className={cn('size-3.5 transition-transform', showMissing && 'rotate-180')} aria-hidden="true" />
            </button>
          )}
        >
          {showMissing && rows(missing)}
        </Group>
      )}
    </Page>
  );
}
