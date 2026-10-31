import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { Card, Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';

const R = T.settings.rules;

/** TRIAGE.md and ASSIGN.md as they are: only the owner changes them (in the system editor; 嘟嘟 can only propose). */
export function RulesSection({ request }) {
  const state = useLoaded(request, 'rules/get');
  return (
    <Loading state={state}>
      {(value) => (
        <div className="flex flex-col gap-4">
          {['TRIAGE.md', 'ASSIGN.md'].map((name) => (
            <Card key={name} title={name} action={<Button variant="outline" size="sm" aria-label={`${R.open} ${name}`} onClick={() => request('assistant/open', { name })}>{R.open}</Button>}>
              {value.rules?.[name] ? <pre className="max-h-[320px] overflow-auto text-xs/5 whitespace-pre-wrap">{value.rules[name]}</pre> : <p className="text-muted-foreground">{value.rules?.[name] === null ? R.missing : R.empty}</p>}
            </Card>
          ))}
        </div>
      )}
    </Loading>
  );
}
