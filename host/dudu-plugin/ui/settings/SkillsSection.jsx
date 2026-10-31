import { useState } from 'react';
import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';

const S = T.settings.skills;

/** 嘟嘟's own skills (text only, made by its tidy): read one, delete one. The agents' skills are theirs, not here. */
export function SkillsSection({ request }) {
  const list = useLoaded(request, 'skills/list');
  const [name, setName] = useState(null);
  const one = useLoaded(request, 'skills/read', { name: name ?? '' });
  if (name) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setName(null)}>{S.back}</Button>
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="text-danger-foreground" onClick={async () => { await request('skills/remove', { name }); setName(null); list.reload(); }}>{S.delete}</Button>
        </div>
        <h3 className="font-medium">{name}</h3>
        <pre className="text-xs/5 whitespace-pre-wrap">{one.value?.text ?? one.value?.skill?.text ?? ''}</pre>
      </div>
    );
  }
  return (
    <Loading state={list}>
      {(value) => ((value.skills ?? []).length === 0 ? <p className="py-10 text-center text-muted-foreground">{S.empty}</p> : (
        <ul className="flex flex-col gap-2">
          {value.skills.map((skill) => (
            <li key={skill.name}>
              <button type="button" onClick={() => setName(skill.name)} className="flex w-full flex-col gap-0.5 rounded-xl border p-3 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <span className="font-medium">{skill.name}</span>
                <span className="text-xs text-muted-foreground">{skill.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </Loading>
  );
}
