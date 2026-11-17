import { useState } from 'react';
import { Copy, Download, Expand, FileText, Link, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '../components/dialog.jsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip.jsx';
import { useToast } from '../components/toast.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const bytes = (size) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB` : `${(size / 1024 ** 2).toFixed(size < 10 * 1024 ** 2 ? 1 : 0)} MB`;

export function attachmentUrl(issueId, key, download = false) {
  const url = new URL('api/dudu/issues/attachment', document.baseURI);
  url.search = new URLSearchParams({ id: issueId, key, ...(download ? { download: '1' } : {}) });
  return url.href;
}

export function fileDrafts(files) {
  return [...files].map((file) => ({
    id: crypto.randomUUID(), file, type: imageTypes.has(file.type) ? 'image' : 'file',
    url: imageTypes.has(file.type) ? URL.createObjectURL(file) : undefined,
  }));
}

export async function uploadDraft(issueId, draft) {
  if (draft.uploaded) return draft.uploaded.id;
  const url = new URL('api/dudu/issues/attachment-upload', document.baseURI);
  url.search = new URLSearchParams({ id: issueId, type: draft.type, name: draft.file.name });
  const response = await fetch(url, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': draft.file.type || 'application/octet-stream' }, body: draft.file,
  });
  const result = await response.json();
  if (!response.ok || result.outcome !== 'success') throw new Error('Attachment upload failed.');
  draft.uploaded = result.item; // retry a failed submission without uploading its completed files again
  return result.item.id;
}

function Action({ label, children, ...props }) {
  return <Tooltip>
    <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={label} {...props}>{children}</Button></TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>;
}

async function pngBlob(src) {
  const response = await fetch(src, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Image unavailable.');
  const blob = await response.blob();
  if (blob.type === 'image/png') return blob;
  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Image unavailable.')), 'image/png'));
  } finally { image.close(); }
}

/** A picture that opens in a window of its own: as itself (an attachment of a note) or, with `tile`, as the small square of the chat box (a draft that is waiting to be sent). */
function Picture({ src, name, download, width, height, tile = false }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const toast = useToast();
  const copy = async (image) => {
    try {
      if (image) await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(src) })]);
      else await navigator.clipboard.writeText(src);
      toast({ key: 'attachment-copy', message: T.toast.copied(name) });
    } catch { toast({ message: T.toast.failed }); }
  };
  const tools = <>
    {download && <Action asChild label={T.attachments.download}><a href={download} download={name}><Download /></a></Action>}
    {download && <Action label={T.attachments.copyImage} onClick={() => copy(true)}><Copy /></Action>}
    {download && <Action label={T.attachments.copyLink} onClick={() => copy(false)}><Link /></Action>}
  </>;
  return <Dialog open={open} onOpenChange={setOpen}>
    <div className="group/picture relative w-fit max-w-full">
      {failed ? <Button variant="outline" className={tile ? 'size-16 rounded-2xl' : undefined} onClick={() => { setFailed(false); }}>{T.retry}</Button>
        : <DialogTrigger asChild><button type="button" className={cn('block max-w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', tile ? 'rounded-2xl' : 'rounded-md')}
          aria-label={T.expand(name)}>
          <img src={src} alt={name} width={width} height={height} onError={() => setFailed(true)}
            className={tile ? 'block size-16 rounded-2xl border object-cover' : 'block h-auto max-h-96 w-auto max-w-full rounded-md object-contain'} />
        </button></DialogTrigger>}
      {download && !failed && <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-full border bg-popover p-1 text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover/picture:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        <Action label={T.expand(name)} onClick={() => setOpen(true)}><Expand /></Action>{tools}
      </div>}
    </div>
      <DialogContent aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] w-fit min-w-[min(360px,calc(100vw-2rem))] gap-3 overflow-hidden p-3 sm:max-w-[min(1100px,calc(100vw-2rem))]">
        <div className="flex min-w-0 items-center gap-2">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">{name}</DialogTitle>
          {tools}
          <DialogClose asChild><Button variant="ghost" size="icon-xs" aria-label={T.pet.close}><X /></Button></DialogClose>
        </div>
        <img src={src} alt={name} className="min-h-0 max-h-[calc(100dvh-7rem)] max-w-full self-center object-contain" />
      </DialogContent>
  </Dialog>;
}

function FileLabel({ name, size }) {
  return <><FileText className="size-5 shrink-0 text-muted-foreground" />
    <span className="flex min-w-0 flex-col gap-1 text-left">
      <span className="truncate text-sm">{name}</span>
      <span className="text-xs text-muted-foreground">{[name.includes('.') ? name.split('.').at(-1).slice(0, 5).toUpperCase() : '', bytes(size)].filter(Boolean).join(' · ')}</span>
    </span></>;
}

/**
 * What is waiting to be sent, as the chat box shows it (pet.css `.dudu-pet-attachment`): a picture is a 64px square, cropped to fill, with a 16px corner and a hairline; a click on it opens the
 * original; the dark round × in its corner (20px, 4px in) shows on hover, and always where there is no hover. A file is the card of the chat box.
 */
export function AttachmentDrafts({ drafts, disabled, onRemove }) {
  return <div className="flex flex-wrap gap-2" data-issue-drafts="">
    {drafts.map((item) => <div key={item.id} data-issue-draft={item.id} className="group/draft relative max-w-full">
      {item.type === 'image' ? <Picture src={item.url} name={item.file.name} tile />
        : <div className="flex h-16 w-[220px] max-w-full items-center gap-3 rounded-2xl border px-3"><FileLabel name={item.file.name} size={item.file.size} /></div>}
      <button type="button" disabled={disabled} aria-label={T.settings.connectors.removeOf(item.file.name)} onClick={() => onRemove(item.id)}
        className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-[rgb(15_17_21/0.62)] text-white opacity-0 outline-none transition-opacity group-hover/draft:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(hover:none)]:opacity-100">
        <X className="size-3" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>)}
  </div>;
}

export function CommentAttachments({ issueId, items }) {
  if (!items?.length) return null;
  return <div className="flex flex-col items-start gap-3" data-issue-attachments="">
    {items.map(({ id, type, attachment }) => {
      const name = attachment.name || T.pet.file;
      const src = attachmentUrl(issueId, id);
      return type === 'image'
        ? <Picture key={id} src={src} name={name} width={attachment.width} height={attachment.height} download={attachmentUrl(issueId, id, true)} />
        : <Button key={id} asChild variant="outline" className="h-16 w-[220px] max-w-full justify-start gap-3 rounded-2xl px-3">
          <a href={attachmentUrl(issueId, id, true)} download={name}><FileLabel name={name} size={attachment.bytes} /><Download className="ml-auto size-4 shrink-0 text-muted-foreground" /></a>
        </Button>;
    })}
  </div>;
}
