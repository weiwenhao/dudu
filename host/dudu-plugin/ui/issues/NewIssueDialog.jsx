import { useEffect, useRef, useState } from 'react';
import { Box, CornerDownRight, LoaderCircle, MoreHorizontal, Tag, User, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { useToast } from '../components/toast.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { AgentMenu } from './AgentMenu.jsx';
import { AttachmentDrafts, fileDrafts, uploadDraft } from './Attachments.jsx';
import { DueChoices, DueDateDialog, DueMenu } from './DueMenu.jsx';
import { dueInfo } from './due.js';
import { AgentAvatar, DueIcon, PriorityIcon, StatusIcon } from './icons.jsx';
import { LabelMenu } from './LabelMenu.jsx';
import { useLabels } from './labels.js';
import { AGENT_NAMES } from './model.js';
import { PriorityMenu } from './PriorityMenu.jsx';
import { ProjectMenu } from './ProjectMenu.jsx';
import { RichText } from './RichText.jsx';
import { StatusMenu } from './StatusMenu.jsx';
import { ParentDialog } from './SubIssues.jsx';
import { statusLabel, workflowStatuses } from './workflow.js';

// One chip of the row of quick values, as Linear's: round, outlined, the value's own icon and its name; the menu of the value opens on it.
const chip = 'inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border bg-transparent px-3 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent';

/**
 * "New issue", as Linear's: a title and a description, then a row of chips for the values that are chosen on the spot (status, priority, project, agent (once there is a project), labels, and
 * under "…" the due date and the parent issue), and Create issue. The issue starts in the default status with no
 * project and no agent, or with the value of the group it was added from (`preset`); `parent` ({ id, ref, title, status }) makes it a sub-issue. `initial` is the title and
 * the description it opens with (the Collector's "new issue" from a record); it is read when the dialog is mounted.
 */
export function NewIssueDialog({ open, onOpenChange, onCreate, request, preset = {}, initial = {}, parent: givenParent = null }) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [brief, setBrief] = useState(initial.brief ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [status, setStatus] = useState(undefined);
  const [priority, setPriority] = useState(undefined);
  const [project, setProject] = useState(undefined);
  const [agent, setAgent] = useState(undefined);
  const [labels, setLabels] = useState(preset.labels ?? []);
  const [dueAt, setDueAt] = useState(preset.dueAt ?? null);
  const [parent, setParent] = useState(undefined);
  const [more, setMore] = useState(null); // null: closed, 'menu' | 'due': the "…" menu and what it shows
  const [customDue, setCustomDue] = useState(false);
  const [choosingParent, setChoosingParent] = useState(false);
  const titleBox = useRef(null);
  // What was pasted (owner, 2026-11-06: "新建的时候需要能够粘贴图片"): kept as drafts, as in the comment box, and saved with the issue once it is made.
  const [drafts, setDrafts] = useState([]);
  const draftRef = useRef([]);
  const toast = useToast();
  useEffect(() => () => { for (const item of draftRef.current) if (item.url) URL.revokeObjectURL(item.url); }, []);
  const replaceDrafts = (items) => { draftRef.current = items; setDrafts(items); };
  const attach = (picked) => {
    if (busy) return;
    if (draftRef.current.length + picked.length > 100) { setProblem(T.toast.failed); return; }
    replaceDrafts([...draftRef.current, ...fileDrafts(picked)]);
  };
  const removeDraft = (id) => {
    const item = draftRef.current.find((draft) => draft.id === id);
    if (item?.url) URL.revokeObjectURL(item.url);
    replaceDrafts(draftRef.current.filter((draft) => draft.id !== id));
  };
  const { labels: known } = useLabels(request);
  const chosenStatus = status ?? preset.status ?? workflowStatuses().find((one) => one.isDefault && !one.archived)?.id ?? 'todo';
  const chosenPriority = priority ?? preset.priority ?? 'none';
  const chosenProject = project === undefined ? preset.project : project;
  const chosenAgent = agent === undefined ? preset.agent : agent;
  const chosenParent = parent === undefined ? givenParent : parent;
  const chosenLabels = known.filter((label) => labels.includes(label.id));
  const reset = () => {
    for (const item of draftRef.current) if (item.url) URL.revokeObjectURL(item.url);
    replaceDrafts([]);
    setTitle(''); setBrief(''); setProblem(''); setBusy(false);
    setStatus(undefined); setPriority(undefined); setProject(undefined); setAgent(undefined); setLabels([]); setDueAt(null); setParent(undefined); setMore(null);
  };
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const rest = { ...preset };
      delete rest.parent; // the window's own parent (which may have been taken off), labels and due date are sent below
      delete rest.labels;
      delete rest.dueAt;
      const result = await onCreate({
        ...rest, status: chosenStatus, ...(chosenPriority === 'none' ? {} : { priority: chosenPriority }), project: chosenProject ?? null, agent: chosenProject?.path ? chosenAgent ?? null : null,
        ...(labels.length ? { labels } : {}), ...(dueAt != null ? { dueAt } : {}), ...(chosenParent ? { parent: chosenParent.id } : {}),
        title: title.trim(), ...(brief.trim() ? { brief: brief.trim() } : {}),
      });
      if (result?.outcome !== 'success') throw new Error(result?.message || T.newIssue.failed);
      // The issue exists now: what was pasted goes to it as the first note, with nothing written in it. A failure here does not undo the issue, and it says so.
      if (draftRef.current.length && request && result.issue?.id != null) {
        try {
          const attachmentIds = [];
          for (const draft of draftRef.current) attachmentIds.push(await uploadDraft(result.issue.id, draft));
          const sent = await request('issues/message', { id: result.issue.id, text: '', attachmentIds, requestId: crypto.randomUUID() });
          if (!['success', 'no_op'].includes(sent?.outcome)) throw new Error('attachments');
        } catch { toast?.({ message: T.toast.failed }); }
      }
      reset();
      onOpenChange(false);
    } catch {
      setProblem(T.newIssue.failed);
      setBusy(false);
    }
  };
  const [now] = useState(() => Date.now());
  const due = dueAt == null ? null : dueInfo(dueAt, now);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto sm:max-w-[640px]"
        onPasteCapture={(event) => { if (event.clipboardData?.files.length) { event.preventDefault(); event.stopPropagation(); attach(event.clipboardData.files); } }}>
        <DialogTitle className="sr-only">{T.newIssue.title}</DialogTitle>
        <DialogDescription className="sr-only">{T.newIssue.description}</DialogDescription>
        {chosenParent && <div className="flex w-fit max-w-full items-center rounded-lg border text-sm" data-new-issue-parent={chosenParent.id}>
          <span className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
            <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {chosenParent.ref && <span className="shrink-0 text-muted-foreground tabular-nums">{chosenParent.ref}</span>}
            <span className="truncate">{chosenParent.title}</span>
          </span>
          <button type="button" aria-label={T.subIssues.removeParent} onClick={() => setParent(null)} className="flex h-full items-center self-stretch rounded-r-lg border-l px-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><X className="size-4" aria-hidden="true" /></button>
        </div>}
        <input
          ref={titleBox} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={T.newIssue.titlePlaceholder} aria-label={T.newIssue.titlePlaceholder} autoFocus
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); create(); } }}
          className="h-9 w-full rounded-md bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
        />
        {/* A long description (a Collector record's whole text) scrolls inside its own box: the window stays within the screen, with the title, the values and Create issue in view. */}
        <RichText className="max-h-[min(50dvh,420px)] min-h-24 overflow-y-auto [&_.dudu-rich]:min-h-24" value={brief} onChange={setBrief} onSubmit={create} label={T.newIssue.briefPlaceholder} placeholder={T.newIssue.briefPlaceholder} />
        {drafts.length > 0 && <AttachmentDrafts drafts={drafts} disabled={busy} onRemove={removeDraft} />}
        <div className="flex flex-wrap items-center gap-1.5" data-new-issue-values="">
          <StatusMenu status={chosenStatus} onSelect={setStatus}>
            <button type="button" className={chip} aria-label={statusLabel(chosenStatus)}><StatusIcon status={chosenStatus} /><span className="truncate">{statusLabel(chosenStatus)}</span></button>
          </StatusMenu>
          <PriorityMenu priority={chosenPriority} onSelect={setPriority}>
            <button type="button" className={chip} aria-label={T.priorityOf(T.priority[chosenPriority])}><PriorityIcon priority={chosenPriority} /><span className="truncate">{chosenPriority === 'none' ? T.fields.priority : T.priority[chosenPriority]}</span></button>
          </PriorityMenu>
          {request && <>
            <ProjectMenu request={request} project={chosenProject} onSelect={(value) => { setProject(value); if (!value) setAgent(null); }}>
              <button type="button" className={chip} aria-label={chosenProject?.name ?? T.projects.choose}><Box className="size-4 text-muted-foreground" aria-hidden="true" /><span className="truncate">{chosenProject?.name ?? T.fields.project}</span></button>
            </ProjectMenu>
            {/* The agent comes after the project and only once there is one (owner, 2026-11-06: "没必要一个框选两个"): its list is agents only, with no project to choose in it. */}
            {chosenProject?.path && (
              <AgentMenu project={chosenProject} agent={chosenAgent} onSelect={(value) => setAgent(value)}>
                <button type="button" className={chip} aria-label={AGENT_NAMES[chosenAgent] ?? T.noAgent}>
                  {chosenAgent ? <AgentAvatar agent={chosenAgent} state="idle" compact showTitle={false} /> : <User className="size-4 text-muted-foreground" aria-hidden="true" />}
                  <span className="truncate">{AGENT_NAMES[chosenAgent] ?? T.fields.agent}</span>
                </button>
              </AgentMenu>
            )}
            <LabelMenu request={request} value={labels} onChange={setLabels}>
              <button type="button" data-new-issue-labels="" className={chip} aria-label={T.labels.name}>
                <Tag className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{chosenLabels.length ? chosenLabels.map((label) => label.name).join(', ') : T.labels.name}</span>
              </button>
            </LabelMenu>
          </>}
          {due && <DueMenu dueAt={dueAt} onChange={setDueAt}>
            <button type="button" className={chip} aria-label={T.detail.dueDate}><DueIcon /><span className="truncate">{due.text}</span></button>
          </DueMenu>}
          {request && <Popover open={more !== null} onOpenChange={(next) => setMore(next ? 'menu' : null)}>
            <PopoverTrigger asChild><button type="button" className={cn(chip, 'px-2')} aria-label={T.newIssue2.more}><MoreHorizontal className="size-4" aria-hidden="true" /></button></PopoverTrigger>
            <PopoverContent className="w-[232px]" align="start" aria-label={T.newIssue2.more}>
              {more === 'due'
                ? <DueChoices dueAt={dueAt} onSelect={(value) => { setMore(null); setDueAt(value); }} onCustom={() => { setMore(null); setCustomDue(true); }} />
                : <div className="flex flex-col gap-0.5">
                  <button type="button" onClick={() => setMore('due')} className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><DueIcon />{T.detail.dueDate}</button>
                  <button type="button" onClick={() => { setMore(null); setChoosingParent(true); }} className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><CornerDownRight className="size-4" aria-hidden="true" />{T.subIssues.setParent}</button>
                </div>}
            </PopoverContent>
          </Popover>}
        </div>
        {problem && <p className="text-xs text-danger-foreground" role="alert">{problem}</p>}
        <div className="flex items-center justify-end gap-3">
          <DialogClose asChild><Button variant="ghost" size="sm">{T.newIssue.cancel}</Button></DialogClose>
          <Button size="sm" disabled={!title.trim() || busy} aria-busy={busy || undefined} onClick={create}>{busy && <LoaderCircle className="animate-spin" />}{T.newIssue.create}</Button>
        </div>
        {customDue && <DueDateDialog dueAt={dueAt} onClose={() => setCustomDue(false)} onSelect={setDueAt} />}
        <ParentDialog request={request} open={choosingParent} onOpenChange={setChoosingParent} onSelect={(issue) => setParent({ id: issue.id, ref: issue.ref, title: issue.title, status: issue.status })} />
      </DialogContent>
    </Dialog>
  );
}
