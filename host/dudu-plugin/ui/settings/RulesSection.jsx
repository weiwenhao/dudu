import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';

const R = T.settings.rules;

/** TRIAGE.md and ASSIGN.md as they are: only the owner changes them (in the system editor; 嘟嘟 can only propose). */
export function RulesSection({ request }) {
  const state = useLoaded(request, 'rules/get');
  return (
    <Loading state={state}>
      {(value) => (
        <div>
          <p className="mx-1 mb-3 text-muted-foreground">{R.note}</p>
          <div className="rounded-[20px] border px-5">
            {['TRIAGE.md', 'ASSIGN.md'].map((name) => (
              <section key={name} className="border-t border-border/50 first:border-t-0">
                <div className="flex min-h-[60px] items-center gap-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="flex flex-wrap items-center gap-2 text-[14px]/[22px] font-semibold">
                      {R.files[name].title}<span className="inline-flex h-5 items-center rounded-md border px-1.5 text-[11px]/[18px] font-normal text-muted-foreground">{name}</span>
                    </h3>
                    <p className="text-[12px]/[18px] text-muted-foreground">{R.files[name].description}</p>
                  </div>
                  <Button variant="outline" size="sm" aria-label={`${R.open} ${name}`} onClick={() => request('assistant/open', { name })}>{R.open}</Button>
                </div>
                <div className="-mt-0.5 mb-4 rounded-[14px] bg-muted px-3.5 py-3">
                  {value.rules?.[name] ? <pre className="max-h-[320px] overflow-auto text-xs/5 whitespace-pre-wrap text-muted-foreground">{value.rules[name]}</pre> : <p className="text-muted-foreground">{value.rules?.[name] === null ? R.missing : R.empty}</p>}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </Loading>
  );
}
