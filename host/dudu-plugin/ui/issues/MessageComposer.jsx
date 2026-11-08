import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, Paperclip } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip.jsx';
import { T } from '../strings.js';
import { AgentLogo } from './AgentLogo.jsx';
import { MentionText } from './MentionText.jsx';
import { AGENT_NAMES } from './model.js';
import { AttachmentDrafts, fileDrafts, uploadDraft } from './Attachments.jsx';

export function MessageComposer({ issueId, agent, logo, onSend, outcome, onSkip }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [mention, setMention] = useState(null);
  const [selected, setSelected] = useState(0);
  const [drafts, setDrafts] = useState([]);
  const draftRef = useRef([]);
  const files = useRef(null);
  const submission = useRef(null);
  const field = useRef(null);
  const mirror = useRef(null);
  const caret = useRef(null);
  const sending = useRef(false);
  const listId = useId();
  useEffect(() => () => { for (const item of draftRef.current) if (item.url) URL.revokeObjectURL(item.url); }, []);
  const replaceDrafts = (items) => { draftRef.current = items; setDrafts(items); };
  const attach = (picked) => {
    if (sending.current || outcome) return;
    if (draftRef.current.length + picked.length > 100) { setProblem(T.toast.failed); return; }
    replaceDrafts([...draftRef.current, ...fileDrafts(picked)]);
  };
  const remove = (id) => {
    const item = draftRef.current.find((draft) => draft.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    replaceDrafts(draftRef.current.filter((draft) => draft.id !== id));
  };
  const clear = () => {
    setText('');
    if (!outcome) { for (const item of draftRef.current) if (item.url) URL.revokeObjectURL(item.url); replaceDrafts([]); }
    submission.current = null;
  };
  const mentionName = (name) => name === 'dudu' ? T.detail.duduMention : AGENT_NAMES[name] ?? name;
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
    if (sending.current || !text.trim() && (outcome || !drafts.length)) return;
    sending.current = true;
    setBusy(true);
    setProblem('');
    setMention(null);
    try {
      const signature = JSON.stringify([text.trim(), ...(!outcome ? drafts.map((item) => item.id) : [])]);
      if (submission.current?.signature !== signature) submission.current = { signature, requestId: crypto.randomUUID() };
      const attachmentIds = [];
      if (!outcome) for (const draft of drafts) attachmentIds.push(await uploadDraft(issueId, draft));
      const result = await onSend(text.trim(), { attachmentIds, requestId: submission.current.requestId });
      if (['success', 'no_op'].includes(result?.outcome)) clear();
      else {
        if (result?.saved) clear();
        setProblem(T.detail.messageErrors[result?.code] ?? T.toast.failed);
      }
    } catch { setProblem(T.toast.failed); }
    finally { sending.current = false; setBusy(false); }
  };
  return <div className="relative" aria-busy={busy}>
    <div className="flex min-h-24 flex-col gap-3 rounded-xl border p-3 shadow-xs focus-within:ring-2 focus-within:ring-ring/30"
      onDragOver={(event) => { if (!outcome && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={(event) => {
        if (outcome) return;
        event.preventDefault();
        const entries = [...event.dataTransfer.items];
        attach([...event.dataTransfer.files].filter((_file, index) => !entries[index]?.webkitGetAsEntry?.()?.isDirectory));
      }}>
      {!outcome && drafts.length > 0 && <AttachmentDrafts drafts={drafts} disabled={busy} onRemove={remove} />}
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
        onPaste={(event) => { if (event.clipboardData.files.length && !outcome) { event.preventDefault(); attach(event.clipboardData.files); } }}
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
      <div className="flex items-center justify-end gap-2">
        {!outcome && <><input ref={files} type="file" multiple hidden data-issue-file-input=""
          onChange={(event) => { attach(event.target.files); event.target.value = ''; }} />
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={busy} className="size-7 rounded-full text-muted-foreground" aria-label={T.pet.file} onClick={() => files.current?.click()}><Paperclip className="size-3.5" /></Button>
          </TooltipTrigger><TooltipContent>{T.pet.file}</TooltipContent></Tooltip>
        </>}
        {outcome && <Button variant="ghost" size="sm" onClick={onSkip}>{T.detail.skipResult}</Button>}
        <Button variant="secondary" size="icon-sm" className="size-7 rounded-full disabled:opacity-100 disabled:text-muted-foreground"
          aria-label={outcome ? T.detail.saveResult : T.detail.send} disabled={busy || !text.trim() && (outcome || !drafts.length)} onClick={submit}>
          {busy ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-3.5" />}
        </Button>
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
