import { useState } from 'react';
import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';
import { Trash } from './icons.jsx';

const S = T.settings.skills;

/** 嘟嘟's own skills (text only, made by its tidy): read one, delete one. The agents' skills are theirs, not here. */
export function SkillsSection({ request }) {
  const list = useLoaded(request, 'skills/list');
  const [name, setName] = useState(null);
  const [problem, setProblem] = useState('');
  const one = useLoaded(request, 'skills/read', { name: name ?? '' });
  const remove = async (skill) => {
    setProblem('');
    try {
      const result = await request('skills/remove', { name: skill });
      if (!['success', 'no_op'].includes(result.outcome)) throw new Error();
      setName(null);
      list.reload();
    } catch { setProblem(T.toast.failed); }
  };
  if (name) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setName(null)}>{S.back}</Button>
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="text-danger-foreground" onClick={() => remove(name)}>{S.delete}</Button>
        </div>
        {problem && <p role="alert" className="text-danger-foreground">{problem}</p>}
        <h3 className="font-medium">{name}</h3>
        <pre className="text-xs/5 whitespace-pre-wrap">{one.value?.text ?? one.value?.skill?.text ?? ''}</pre>
      </div>
    );
  }
  return (
    <Loading state={list}>
      {(value) => <div>
        <p className="mx-1 mb-3 text-muted-foreground">{S.note}</p>
        {problem && <p role="alert" className="mb-3 text-danger-foreground">{problem}</p>}
        {(value.skills ?? []).length === 0 ? <p className="py-10 text-center text-muted-foreground">{S.empty}</p> : (
        <ul className="rounded-[20px] border px-5">
          {value.skills.map((skill) => (
            <li key={skill.name} className="flex min-h-[60px] items-center gap-3.5 border-t border-border/50 first:border-t-0">
              <button type="button" aria-label={skill.name} onClick={() => setName(skill.name)} className="flex min-w-0 flex-1 flex-col justify-center py-3 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <span className="text-[14px]/[22px] font-semibold">{skill.name}</span>
                <span className="text-[12px]/[18px] text-muted-foreground">{skill.description}</span>
              </button>
              <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label={S.deleteOf(skill.name)} onClick={() => remove(skill.name)}><Trash /></Button>
            </li>
          ))}
        </ul>
      )}</div>}
    </Loading>
  );
}
