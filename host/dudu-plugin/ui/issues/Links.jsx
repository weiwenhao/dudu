import { useState } from 'react';
import { FileText, GitPullRequest, Link2, LoaderCircle, Plus, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';

const ICONS = { pull_request: GitPullRequest, document: FileText, link: Link2 };
export const LINK_KINDS = ['link', 'pull_request', 'document'];
const MENU = { link: 'add', pull_request: 'addPullRequest', document: 'addDocument' };

/** The three ways to add a link, as Linear's menu has them: a link, a pull request, a document. */
export function AddLinkChoices({ onChoose }) {
  return <div className="flex flex-col gap-0.5">
    {LINK_KINDS.map((kind) => {
      const Icon = ICONS[kind];
      return <button key={kind} type="button" onClick={() => onChoose(kind)}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <Icon className="size-4" aria-hidden="true" />{T.links[MENU[kind]]}
      </button>;
    })}
  </div>;
}

/** The links of an issue, under its description, as Linear lists them: an icon for what it is, its title and where it is; the cross takes it off. Nothing shows while there are none. */
export function LinksSection({ request, issue, reload, onAdd }) {
  const links = issue.links ?? [];
  const [menu, setMenu] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!links.length) return null;
  const remove = async (link) => {
    setFailed(false);
    try {
      const result = await request('issues/link-remove', { id: issue.id, linkId: link.id });
      if (result?.outcome !== 'success') throw new Error();
      reload();
    } catch { setFailed(true); }
  };
  return <section className="mt-6" data-issue-links-section="" aria-label={T.links.title}>
    <div className="mb-1 flex items-center gap-1 text-sm">
      <h2 className="font-medium">{T.links.title}</h2>
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={T.links.add}><Plus /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-[232px]" aria-label={T.links.add}><AddLinkChoices onChoose={(kind) => { setMenu(false); onAdd(kind); }} /></PopoverContent>
      </Popover>
    </div>
    <ul className="flex flex-col">
      {links.map((link) => {
        const Icon = ICONS[link.kind] ?? Link2;
        return <li key={link.id} className="group flex h-9 items-center gap-1 rounded-md hover:bg-accent">
          <a href={link.url} target="_blank" rel="noopener noreferrer" data-issue-link={link.id} data-link-kind={link.kind} title={link.url}
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate">{link.title || link.url}</span>
          </a>
          <Button variant="ghost" size="icon-xs" className="mr-1 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={T.links.remove(link.title || link.url)} onClick={() => { void remove(link); }}><X /></Button>
        </li>;
      })}
    </ul>
    {failed && <p role="alert" className="mt-1 text-xs text-danger-foreground">{T.toast.failed}</p>}
  </section>;
}

/** The window that takes an address (and, if the person likes, a title): one window for a link, a pull request and a document. */
export function AddLinkDialog({ request, issue, kind, onClose, onAdded }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const result = await request('issues/link-add', { id: issue.id, fields: { url: url.trim(), kind, ...(title.trim() ? { title: title.trim() } : {}) } });
      if (result?.outcome === 'success') { onAdded(result); onClose(); return; }
      setProblem(/already/i.test(result?.message ?? '') ? T.links.duplicate : T.links.invalid);
    } catch { setProblem(T.toast.failed); }
    setBusy(false);
  };
  const Icon = ICONS[kind];
  const field = 'h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';
  const enter = (event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } };
  return <Dialog open={Boolean(kind)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="gap-3 sm:max-w-[480px]" onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById('dudu-link-url')?.focus(); }}>
      <DialogTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{Icon && <Icon className="size-4" aria-hidden="true" />}{T.links.dialog[kind]}</DialogTitle>
      <DialogDescription className="sr-only">{T.links.dialog[kind]}</DialogDescription>
      <input id="dudu-link-url" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={enter} placeholder={T.links.url} aria-label={T.links.url} spellCheck={false} className={field} />
      <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={enter} placeholder={T.links.titleOptional} aria-label={T.links.titleOptional} className={field} />
      {problem && <p role="alert" className="text-xs text-danger-foreground">{problem}</p>}
      <div className="flex justify-end gap-2">
        <DialogClose asChild><Button variant="ghost" size="sm">{T.newIssue.cancel}</Button></DialogClose>
        <Button size="sm" disabled={!url.trim() || busy} aria-busy={busy || undefined} onClick={() => { void submit(); }}>{busy && <LoaderCircle className="animate-spin" />}{T.links.addButton}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
