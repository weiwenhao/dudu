import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, LoaderCircle, Search, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { initialFindIndex, nextFindIndex, sameFindHit } from '../lib/conversation-find.js';
import { conversationFindAnchor, conversationHighlights, ownsConversationFind, revealFindHit } from '../lib/conversation-find-dom.js';

// ⌘F on a Mac and Ctrl+F elsewhere, not both (owner, 2026-11-17: "我明明是 macos 电脑，按 cmd+f 才是搜索，现在 ctrl+f 也能搜索，这个不对").
const mac = /Mac|iPhone|iPad/.test(navigator.platform);

// An input method (a Chinese one, say) can report Esc as its "Process" key (keyCode 229) while the physical key's `code` stays "Escape"; only a composition in progress, which Esc then cancels, keeps it.
const isEscape = event => !(event.isComposing ?? event.nativeEvent?.isComposing) && (event.key === 'Escape' || event.code === 'Escape');

/** Shared by the board conversation and its issue dialog; the DSH composer stays mounted. */
export function useConversationFind({ root, reference, actions }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ hits: [], index: -1, query: '', reference: null });
  const [pending, setPending] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [navigation, setNavigation] = useState(0);
  const input = useRef(null), trigger = useRef(null), lastJump = useRef(null);
  const currentResult = result.query === query && result.reference === reference;
  const hits = currentResult ? result.hits : [];
  const active = hits[result.index];
  const busy = pending || jumping;
  const show = () => {
    if (!reference) return;
    setOpen(true);
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  };
  const close = () => {
    setOpen(false);
    setJumping(false);
    lastJump.current = null;
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (open) { input.current?.focus({ preventScroll: true }); input.current?.select(); }
  }, [open]);
  useEffect(() => {
    setOpen(false);
    setQuery('');
    setResult({ hits: [], index: -1, query: '', reference: null });
    setJumping(false);
    setFailed(false);
    lastJump.current = null;
  }, [reference]);
  useEffect(() => {
    const keyboard = event => {
      if (event.isComposing || !ownsConversationFind(root.current, event.target)) return;
      const chord = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (chord && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f' && reference) {
        event.preventDefault();
        event.stopPropagation();
        show();
      } else if (open && isEscape(event)) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    // On the window, in the capture phase: the first place the key reaches, so that nothing of the host's gets it before the bar does.
    const view = root.current?.ownerDocument?.defaultView;
    view?.addEventListener('keydown', keyboard, true);
    return () => view?.removeEventListener('keydown', keyboard, true);
  });
  useEffect(() => {
    if (!open || !reference) return undefined;
    return reference.binding.eventSource.subscribe(() => {
      const change = reference.binding.eventSource.getSnapshot().change;
      const entries = change.kind === 'settle-assistant' ? [change.entry]
        : change.kind === 'append' || change.kind === 'replace' ? change.entries : [];
      if (entries.some(entry => ['assistant/message', 'user/message'].includes(entry?.event?.type))) setRevision(value => value + 1);
    });
  }, [open, reference]);
  useEffect(() => {
    if (!open || !reference || !query.trim()) { setPending(false); return undefined; }
    const controller = new AbortController();
    setPending(true);
    setFailed(false);
    const timer = setTimeout(() => {
      void actions.findConversation(reference, query, controller.signal).then(hits => {
        if (controller.signal.aborted) return;
        const anchor = hits.length && root.current ? conversationFindAnchor(root.current, actions.conversationFindNodes(reference)) : undefined;
        setResult(previous => {
          const index = previous.query === query && previous.reference === reference
            ? hits.findIndex(hit => sameFindHit(hit, previous.hits[previous.index])) : -1;
          return { hits, index: index === -1 ? initialFindIndex(hits, anchor) : index, query, reference };
        });
      }).catch(() => {
        if (!controller.signal.aborted) { setResult({ hits: [], index: -1, query, reference }); setFailed(true); }
      }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, reference, actions, query, revision, root]);
  useEffect(() => {
    if (!open || pending || !active || !root.current) { setJumping(false); return undefined; }
    const key = `${query}:${active.seq}:${active.part}:${active.ordinal}`;
    if (lastJump.current === key) { setJumping(false); return undefined; }
    const controller = new AbortController();
    setJumping(true);
    void revealFindHit(root.current, reference, () => actions.conversationFindNodes(reference), query, active, controller.signal)
      .then(() => { if (!controller.signal.aborted) lastJump.current = key; })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setJumping(false); });
    return () => { controller.abort(); setJumping(false); };
  }, [open, reference, actions, query, active, pending, root, navigation]);
  useEffect(() => {
    if (!open || !reference || !query.trim() || !root.current) return undefined;
    const surface = root.current, view = surface.ownerDocument.defaultView;
    let markers;
    try { markers = conversationHighlights(surface); }
    catch { setFailed(true); return undefined; }
    let frame;
    const paint = () => {
      frame = undefined;
      try { markers.paint(actions.conversationFindNodes(reference), query, active); }
      catch { markers.clear(); setFailed(true); }
    };
    const observer = new view.MutationObserver(records => {
      // Streaming text has no durable text-interaction source yet. Do not rescan all old rows on every token.
      const changed = records.some(record => {
        const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        return record.type === 'attributes' || element?.closest('[data-text-interaction-source]')
          || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
            && (node.matches('[data-text-interaction-source]') || node.querySelector('[data-text-interaction-source]')));
      });
      if (!changed) return;
      if (frame === undefined) frame = view.requestAnimationFrame(paint);
    });
    observer.observe(surface.querySelector('[data-dudu-find-content]') ?? surface, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'data-expanded', 'data-text-interaction-source'],
    });
    frame = view.requestAnimationFrame(paint);
    return () => { observer.disconnect(); if (frame !== undefined) view.cancelAnimationFrame(frame); markers.clear(); };
  }, [open, reference, actions, query, active, root]);
  const navigate = direction => {
    setFailed(false);
    lastJump.current = null;
    setNavigation(value => value + 1);
    setResult(previous => ({ ...previous, index: nextFindIndex(previous.index, previous.hits.length, direction) }));
  };
  const words = T.conversationFind;
  const shortcut = mac ? '⌘F' : 'Ctrl+F';
  return {
    open, close,
    button: <Button ref={trigger} variant="ghost" size="icon-sm" className={`text-muted-foreground${open ? ' bg-accent' : ''}`}
      aria-label={`${words.label} (${shortcut})`} title={`${words.label} (${shortcut})`} aria-expanded={open} disabled={!reference} onClick={show}>
      <Search strokeWidth={1.8} />
    </Button>,
    bar: open && <div role="search" aria-label={words.label} className="dudu-conversation-find">
      <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
      <input ref={input} type="search" value={query} placeholder={words.label} aria-label={words.label}
        onChange={event => {
          setQuery(event.target.value);
          setPending(Boolean(event.target.value.trim()));
          setJumping(false);
          setFailed(false);
          lastJump.current = null;
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (isEscape(event)) { event.preventDefault(); event.stopPropagation(); close(); }
          else if (event.key === 'Enter' && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); if (!busy && hits.length) navigate(event.shiftKey ? -1 : 1); }
        }} />
      <span className="dudu-conversation-find-count" role="status" aria-live="polite">
        {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-label={T.shell.loading} />
          : failed ? <span title={T.pet.failed}>{T.pet.failed}</span>
            : query.trim() ? hits.length ? `${result.index + 1} / ${hits.length}` : words.empty : null}
      </span>
      <div className="flex shrink-0 items-center border-l pl-1">
        <Button variant="ghost" size="icon-xs" className="size-7 text-muted-foreground" aria-label={words.previous} title={`${words.previous} (Shift+Enter)`}
          disabled={busy || !hits.length} onClick={() => navigate(-1)}><ChevronUp className="size-4" strokeWidth={1.8} /></Button>
        <Button variant="ghost" size="icon-xs" className="size-7 text-muted-foreground" aria-label={words.next} title={`${words.next} (Enter)`}
          disabled={busy || !hits.length} onClick={() => navigate(1)}><ChevronDown className="size-4" strokeWidth={1.8} /></Button>
        <Button variant="ghost" size="icon-xs" className="size-7 text-muted-foreground" aria-label={T.pet.close} title={`${T.pet.close} (Esc)`} onClick={close}>
          <X className="size-4" strokeWidth={1.8} />
        </Button>
      </div>
    </div>,
  };
}
