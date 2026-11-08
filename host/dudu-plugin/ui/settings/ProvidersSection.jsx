import { useEffect, useState } from 'react';
import { Pencil, RefreshCw } from 'lucide-react';
import { Switch } from '../components/switch.jsx';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { cn } from '../lib/cn.js';
import { diagnostic, T } from '../strings.js';
import { ActionButton, Failed, Field, Group, IconAction, Page, PrimaryButton, Problem, QuietButton, Reading, Row } from './kit.jsx';

const S = T.shell;
const DOT = { ready: 'bg-success', missing: 'bg-muted-foreground/50', unsupported: 'bg-warning', broken: 'bg-destructive' };

/**
 * One harness, one line: which it is, whether it can be used here and its version, where it was found, and the switch that lets 嘟嘟
 * use it. Where to look for it when it does not turn up by itself is a thing one rarely needs: it opens from the pencil, under the line.
 */
function ProviderRow({ provider, busy, editing, onEdit, onEnabled, onPath }) {
  const [path, setPath] = useState(provider.configuredPath ?? '');
  const reason = (provider.state === 'unsupported' || provider.state === 'broken') && provider.reason;
  const name = `${S.executable}: ${provider.name}`;
  const close = () => { setPath(provider.configuredPath ?? ''); onEdit(false); };
  return (
    <Row as="li" block aria-label={provider.name}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[160px] flex-1">
          <div className="flex items-center gap-2 text-sm font-medium"><AgentLogo agent={provider.id} className="size-4" />{provider.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs/[18px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <i aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT[provider.state] ?? 'bg-muted-foreground/50')} />
              {[S.providerStates[provider.state] ?? provider.state, provider.version].filter(Boolean).join(' ')}
            </span>
            {provider.path && <span className="font-mono [overflow-wrap:anywhere]">{provider.path}</span>}
          </div>
          {reason && <div className="text-xs/[18px] text-muted-foreground [overflow-wrap:anywhere]">{reason}</div>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <IconAction label={name} aria-expanded={editing} disabled={busy} onClick={() => (editing ? close() : onEdit(true))}><Pencil aria-hidden="true" /></IconAction>
          <Switch checked={provider.enabled} disabled={busy} aria-label={`${S.enable}: ${provider.name}`} onCheckedChange={onEnabled} />
        </div>
      </div>
      {editing && (
        <form
          data-inline-form="" className="mt-3 flex items-center gap-2"
          onSubmit={(event) => { event.preventDefault(); if (path !== provider.configuredPath) onPath(path); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
        >
          <Field
            aria-label={name} value={path} placeholder={S.autoFind} disabled={busy} autoFocus spellCheck={false} autoCapitalize="none" autoCorrect="off"
            className="min-w-0 flex-1 font-mono text-xs placeholder:font-sans" onChange={(event) => setPath(event.target.value)}
          />
          <QuietButton disabled={busy} onClick={close}>{S.cancel}</QuietButton>
          <PrimaryButton type="submit" disabled={busy || path === provider.configuredPath} aria-label={`${S.save}: ${provider.name}`}>{S.save}</PrimaryButton>
        </form>
      )}
    </Row>
  );
}

/** The harnesses 嘟嘟 can hand an issue to (Claude Code, Codex), as found on this computer. */
export function ProvidersSection({ request }) {
  const [providers, setProviders] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
  return (
    <Page title={S.providers} action={<ActionButton disabled={busy} onClick={() => run('refresh', {})}><RefreshCw aria-hidden="true" />{busy ? S.busy : S.detect}</ActionButton>}>
      <Problem>{error}</Problem>
      <Group label={S.providers}>
        <ul>
          {providers.map((provider) => (
            <ProviderRow
              key={`${provider.id}:${provider.configuredPath ?? ''}`} provider={provider} busy={busy} editing={editing === provider.id}
              onEdit={(open) => setEditing(open ? provider.id : null)}
              onEnabled={(enabled) => run('save', { id: provider.id, enabled })}
              onPath={async (path) => { if (await run('save', { id: provider.id, path })) setEditing(null); }}
            />
          ))}
        </ul>
      </Group>
    </Page>
  );
}
