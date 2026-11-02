import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { AgentLogo } from './AgentLogo.jsx';
import { MentionText } from './MentionText.jsx';
import { AGENT_NAMES } from './model.js';

export function MessageComposer({ agent, logo, onSend, outcome, onSkip }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [mention, setMention] = useState(null);
  const [selected, setSelected] = useState(0);
  const field = useRef(null);
  const mirror = useRef(null);
  const caret = useRef(null);
  const sending = useRef(false);
  const listId = useId();
  const mentionName = (name) => name === 'dudu' ? T.detail.duduMention : AGENT_NAMES[name] ?? name;
  const recipient = mentionName(agent || 'dudu');
  const choices = mention ? ['dudu', ...(agent ? [agent] : [])].filter((name) =>
    [name, mentionName(name)].some((label) => label.toLowerCase().startsWith(mention.query.toLowerCase()))) : [];
  // Place the caret during the commit so a fast next keystroke cannot race a deferred selection.
  useLayoutEffect(() => {
    if (caret.current === null) return;
    field.current?.focus();
    field.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);
  const inspect = (element) => {
    const end = element.selectionStart;
    const match = /(?:^|\s)@([a-z]*)$/i.exec(element.value.slice(0, end));
    setMention(!outcome && match ? { query: match[1], start: end - match[1].length - 1, end } : null);
    setSelected(0);
  };
  const choose = (name) => {
    const label = mentionName(name);
    const next = text.slice(0, mention.start) + `@${label} ` + text.slice(mention.end);
    const position = mention.start + label.length + 2;
    caret.current = position;
    setText(next);
    setMention(null);
  };
  const submit = async () => {
    if (sending.current || !text.trim()) return;
    sending.current = true;
    setBusy(true);
    setProblem('');
    setMention(null);
    try {
      const result = await onSend(text.trim());
      if (['success', 'no_op'].includes(result?.outcome)) setText('');
      else {
        if (result?.saved) setText('');
        setProblem(T.detail.messageErrors[result?.code] ?? T.toast.failed);
      }
    } catch { setProblem(T.toast.failed); }
    finally { sending.current = false; setBusy(false); }
  };
  return <div className="relative">
    <div className="flex min-h-24 flex-col gap-2 rounded-xl border p-3 shadow-xs focus-within:ring-2 focus-within:ring-ring/30">
      <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={mirror} className="min-h-12 w-full break-words whitespace-pre-wrap"><MentionText text={text} />{text.endsWith('\n') ? '\n' : ''}</div>
      </div>
      <textarea
        ref={field} value={text} disabled={busy} rows={2} placeholder={outcome ? T.detail.result : T.detail.leaveComment}
        aria-label={outcome ? T.detail.result : T.detail.leaveComment}
        aria-autocomplete="list" aria-controls={choices.length ? listId : undefined} aria-expanded={choices.length > 0}
        aria-activedescendant={choices.length ? `${listId}-${selected}` : undefined}
        onChange={(event) => { setText(event.target.value); inspect(event.target); }}
        onScroll={(event) => { if (mirror.current) mirror.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`; }}
        onClick={(event) => inspect(event.currentTarget)} onBlur={() => setMention(null)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (choices.length && ['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'Escape') { event.stopPropagation(); setMention(null); }
            else setSelected((value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
          else if ((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) && choices.length) { event.preventDefault(); choose(choices[selected]); }
        }}
        className="relative block min-h-12 w-full resize-y bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground"
      />
      </div>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">{outcome ? '' : T.detail.messageHint(recipient)}</p>
        {outcome && <Button variant="ghost" size="sm" onClick={onSkip}>{T.detail.skipResult}</Button>}
        <Button variant="ghost" size="icon-xs" aria-label={outcome ? T.detail.saveResult : T.detail.send} disabled={busy || !text.trim()} onClick={submit}><ArrowUp /></Button>
      </div>
    </div>
    {choices.length > 0 && <div id={listId} role="listbox" aria-label={T.detail.mention}
      className="absolute bottom-full left-0 z-20 mb-2 w-52 rounded-xl border bg-popover p-1.5 shadow-lg">
      {choices.map((name, index) => <button key={name} id={`${listId}-${index}`} role="option" aria-label={`@${mentionName(name)}`} aria-selected={index === selected} type="button"
        className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm ${index === selected ? 'bg-accent' : ''}`}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSelected(index)} onClick={() => choose(name)}>
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">{name === 'dudu' ? <img src={logo} alt="" className="size-5" /> : <AgentLogo agent={name} className="size-5" />}</span>@{mentionName(name)}
      </button>)}
    </div>}
    {problem && <p role="alert" className="mt-2 text-xs text-danger-foreground">{problem}</p>}
  </div>;
}
