import { useState } from 'react';
import { ChevronLeft, Trash2 } from 'lucide-react';
import { T } from '../strings.js';
import { ActionButton, Empty, Group, IconAction, Loading, Page, Problem, Row } from './kit.jsx';
import { useLoaded } from './use-loaded.js';

const S = T.settings.skills;

/** One skill, read: its text as it is on disk, and the owner's way to delete it. */
function SkillDetail({ request, name, onBack, onDelete, problem }) {
  const one = useLoaded(request, 'skills/read', { name });
  return (
    <Page
      title={name}
      back={<IconAction label={S.back} onClick={onBack}><ChevronLeft aria-hidden="true" /></IconAction>}
      action={<ActionButton className="text-danger-foreground" onClick={() => onDelete(name)}>{S.delete}</ActionButton>}
    >
      <Problem>{problem}</Problem>
      <Loading state={one} rows={2}>
        {(value) => <Group label={name}><Row block><pre className="font-mono text-xs/5 whitespace-pre-wrap [overflow-wrap:anywhere]">{value.text ?? value.skill?.text ?? ''}</pre></Row></Group>}
      </Loading>
    </Page>
  );
}

/** 嘟嘟's own skills (text only, made by its tidy): read one, delete one. The agents' skills are theirs, not here. */
export function SkillsSection({ request }) {
  const list = useLoaded(request, 'skills/list');
  const [name, setName] = useState(null);
  const [problem, setProblem] = useState('');
  const remove = async (skill) => {
    setProblem('');
    try {
      const result = await request('skills/remove', { name: skill });
      if (!['success', 'no_op'].includes(result.outcome)) throw new Error();
      setName(null);
      list.reload();
    } catch { setProblem(T.toast.failed); }
  };
  if (name) return <SkillDetail request={request} name={name} problem={problem} onBack={() => { setName(null); setProblem(''); }} onDelete={remove} />;
  return (
    <Page title={T.settings.nav.skills}>
      <Problem>{problem}</Problem>
      <Loading state={list} rows={2}>
        {(value) => ((value.skills ?? []).length === 0 ? <Group><Empty>{S.empty}</Empty></Group> : (
          <Group label={T.settings.nav.skills}>
            <ul>
              {value.skills.map((skill) => (
                <Row as="li" key={skill.name} block className="flex items-center gap-3">
                  <button type="button" aria-label={skill.name} onClick={() => setName(skill.name)} className="-my-1 flex min-w-0 flex-1 flex-col rounded-lg py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <span className="text-sm font-medium [overflow-wrap:anywhere]">{skill.name}</span>
                    {skill.description && <span className="text-xs/[18px] text-muted-foreground [overflow-wrap:anywhere]">{skill.description}</span>}
                  </button>
                  <IconAction label={S.deleteOf(skill.name)} onClick={() => remove(skill.name)}><Trash2 aria-hidden="true" /></IconAction>
                </Row>
              ))}
            </ul>
          </Group>
        ))}
      </Loading>
    </Page>
  );
}
