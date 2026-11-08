import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Check, ChevronDown, ChevronUp, Expand, EyeOff, FileText, LoaderCircle, Mic, RotateCcw, Settings, Square, X } from 'lucide-react';
import { T } from '../strings.js';
import { Button } from '../components/button.jsx';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/context-menu.jsx';
import { readySpeech, recordSpeech } from './voice.mjs';
import { ConversationControls } from './Models.jsx';
import { PlusMenu } from './PlusMenu.jsx';
import { Suggestions, useSuggestions } from './Suggestions.jsx';
import { addressedMessage, highlightParts, issueAddress } from './completion.mjs';
import { getWhere, useWhere } from '../lib/where.js';
import { Reminder } from './Reminder.jsx';
import { RunningStatus } from './RunningStatus.jsx';
import { turnStart } from './running.mjs';
import { useReminders } from './use-reminders.js';
import { isPetInteraction } from './overlays.js';
import pet from './pet.png';

const P = T.pet;
// What the owner sees after the word "Context": the page they are on, by name.
const whereLabel = (where) => where?.page === 'issue' ? [where.ref ?? `#${where.id}`, where.title].filter(Boolean).join(' · ') : where?.page === 'dashboard' ? T.brand : '';
const textOf = (content) => typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
const editable = (target) => target instanceof Element && Boolean(target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="menu"],[role="listbox"]'));

export function conversationMessages(records, calls = new Map()) {
  return records.flatMap(({ event }) => {
    if (!event) return [];
    const data = event.data ?? {};
    if (event.type === 'tool/call') { calls.set(data.callId, data); return []; }
    if (event.type === 'tool/result') {
      const message = data.message ?? data;
      const call = calls.get(message.toolCallId ?? data.callId);
      if (!call || !P.actions[call.name] || message.isError) return [];
      try {
        const result = JSON.parse(textOf(message.content ?? data.result));
        if (result.outcome !== 'success' || (call.name === 'memory_forget' && result.preview !== false)) return [];
        const args = JSON.parse(call.arguments || '{}');
        return [{
          id: event.seq, at: event.time, role: 'action', action: call.name,
          widget: call.name.startsWith('dashboard_') ? args.type : null,
          text: result.issue?.title ?? result.record?.text ?? result.connector?.name ?? '',
        }];
      } catch { return []; }
    }
    if (event.type !== 'assistant/message' && !(event.type === 'user/message' && (data.source ?? data.message?.source)?.kind === 'user')) return [];
    const content = data.message?.content ?? data.content;
    const text = textOf(content);
    const parts = Array.isArray(content) ? content : [];
    const images = parts.filter((part) => part.type === 'image' && part.attachment).map((part) => part.attachment);
    const files = parts.filter((part) => part.type === 'file' && part.attachment).map((part) => part.attachment);
    return text.trim() || images.length || files.length ? [{ id: event.seq, at: event.time, role: event.type === 'user/message' ? 'owner' : 'dudu', text, images, files }] : [];
  });
}

function ConversationImage({ attachment, sessionId, actions, onLoad }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!sessionId || !actions.conversationImage) return;
    let active = true;
    actions.conversationImage(sessionId, attachment).then((value) => { if (active) setSrc(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [actions, sessionId, attachment]);
  return src ? <img className="dudu-pet-message-image" src={src} alt={attachment.name ?? ''} onLoad={onLoad} /> : <span className="text-xs text-muted-foreground">{failed ? T.pet.failed : T.shell.loading}</span>;
}

const encodeImage = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve({ mediaType: file.type, data: String(reader.result).split(',')[1], name: file.name });
  reader.readAsDataURL(file);
});
const encodeDrafts = (items) => Promise.all(items.map(async (item) => item.kind === 'image'
  ? { kind: 'image', ...await encodeImage(item.file) } : { kind: 'file', file: item.file, name: item.file.name }));
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const formatBytes = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB` : `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
const extensionOf = (name) => { const dot = name.lastIndexOf('.'); return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 6).toUpperCase() : ''; };
// What was dropped, without the folders among it (a folder arrives as a file that cannot be read).
const droppedFiles = (transfer) => { const entries = [...transfer.items]; return [...transfer.files].filter((_file, index) => !entries[index]?.webkitGetAsEntry?.()?.isDirectory); };

export function Pet({ request, actions = {}, renderPermission, version = 0, suppressed = false, onSettings }) {
  // Load the saved visibility before showing the pet, including after a reload.
  const [settings, setSettings] = useState({ enabled: false, doubleSpace: true, voice: true });
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [draft, setDraft] = useState('');
  const [drafts, setDrafts] = useState([]); // what waits to be sent with the words, in the order it was picked: { id, kind: 'image' | 'file', file, url? }
  const [problem, setProblem] = useState('');
  const [sendProblem, setSendProblem] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [sending, setSending] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [context, setContext] = useState(false); // "Context" is on: the page the owner is on goes with each message, until it is taken off
  const [notice, setNotice] = useState(''); // what Compact answered, for a few seconds
  const [compacting, setCompacting] = useState(false);
  const box = useRef(null); // the composer, which the "+" menu opens above
  const token = useRef(null); // the blue "Context" at the start of the first line, and the line that gives its width to the text
  const line = useRef(null);
  const contextOn = useRef(false);
  const where = useWhere();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [bubble, setBubble] = useState('');
  const [speechCatalog, setSpeechCatalog] = useState(null);
  const input = useRef(null);
  const mirror = useRef(null); // the draft again, behind the transparent text of the field, with the /skill and the @address in blue
  const files = useRef(null);
  const draftItems = useRef([]);
  const button = useRef(null);
  const dock = useRef(null);
  const dialog = useRef(null);
  const list = useRef(null);
  const speech = useRef(null);
  const knownCursor = useRef(-2);
  const alive = useRef(true);
  const started = useRef(null);
  const state = useRef(null);
  const operation = useRef(0);
  const openRef = useRef(false);
  const newestReply = useRef(-1);
  const oldest = useRef(null);
  const paging = useRef(false);
  const prepend = useRef(null);
  const notify = useRef(false);
  const calls = useRef(new Map());
  const sendingNow = useRef(false);
  const failedRelay = useRef(null);
  const hostVoice = readySpeech(speechCatalog) && Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.AudioContext && window.OfflineAudioContext);
  const available = hostVoice;
  // What the pet says by itself, when nothing else is speaking: the conversation closed, nobody dictating, no reply or problem bubble.
  const reminders = useReminders({ request, actions, active: settings.enabled && !suppressed, quiet: !open && !menuOpen && !listening && !bubble });

  useEffect(() => { alive.current = true; return () => {
    alive.current = false; speech.current?.stop(true);
    for (const item of draftItems.current) if (item.url) URL.revokeObjectURL(item.url);
  }; }, []);
  useEffect(() => {
    const element = input.current;
    if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 120)}px`; }
    // The copy behind the field is the field's size and wraps where it does: the same width (less a scroll bar, if the field has one), the same scroll.
    if (element && mirror.current) {
      mirror.current.style.height = `${element.offsetHeight}px`;
      mirror.current.style.paddingRight = `${6 + element.offsetWidth - element.clientWidth}px`;
      mirror.current.scrollTop = element.scrollTop;
    }
  }, [draft, open]);
  useEffect(() => {
    if (!settings.enabled || !settings.voice || !actions.voiceCatalog) return;
    let active = true;
    const publish = (value) => {
      if (!active) return;
      setSpeechCatalog((previous) => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
      if (!readySpeech(value)) setProblem((previous) => previous === P.voiceFailed ? '' : previous);
    };
    const check = () => actions.voiceCatalog().then(publish).catch(() => publish(null));
    void check();
    const stop = actions.watchVoiceCatalog?.(publish);
    const timer = stop ? null : setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 2000);
    return () => { active = false; stop?.(); clearInterval(timer); };
  }, [actions, settings.enabled, settings.voice]);
  useEffect(() => {
    if (available && settings.voice) return;
    if (speech.current) { speech.current.cancel = true; speech.current.stop(true); }
    // The capture's completion callback owns listening/heard state after the native stop settles.
  }, [available, settings.voice]);
  useEffect(() => {
    let active = true;
    let timer;
    let attempt = 0;
    // The pet is not drawn until the settings have said it is on, so one read that failed (the plugin was still starting after a reload, or the computer was busy) left it gone for good:
    // the owner found it missing from the corner (2026-11-07). The read is tried again, a little later each time, until it answers.
    const load = () => {
      request('assistant/settings').then((value) => {
        if (!active) return;
        if (!value.settings?.pet) throw new Error('no pet settings');
        setSettings(value.settings.pet);
        if (!value.settings.pet.enabled) { setMenuOpen(false); setOpen(false); setBubble(''); }
        if (!value.settings.pet.voice) setProblem((previous) => previous === P.voiceFailed ? '' : previous);
      }).catch(() => {
        if (active) timer = setTimeout(load, Math.min(30_000, 1000 * 2 ** attempt++));
      });
    };
    load();
    return () => { active = false; clearTimeout(timer); };
  }, [request, version]);
  useEffect(() => { openRef.current = open; if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    if (prepend.current) {
      element.scrollTop = prepend.current.top + element.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (open && !earlier) element.scrollTop = element.scrollHeight;
  }, [messages, open, earlier]);

  const read = useCallback(async (snapshot, { before } = {}) => {
    if (!snapshot?.sessionId || !actions.readConversation) return;
    const page = await actions.readConversation(snapshot, before);
    if (!alive.current) return;
    const found = conversationMessages(page.records ?? [], calls.current);
    if (before !== undefined && list.current) prepend.current = { top: list.current.scrollTop, height: list.current.scrollHeight };
    setMessages((current) => {
      const combined = [...current, ...found];
      return [...new Map(combined.map((message) => [message.id, message])).values()].sort((a, b) => a.id - b.id);
    });
    if (before !== undefined || oldest.current === null) {
      oldest.current = page.records?.[0]?.event?.seq ?? found[0]?.id ?? oldest.current;
      setHasMore(page.hasMore === true);
    }
    if (before === undefined) knownCursor.current = snapshot.cursor;
    const last = found.filter((message) => message.role === 'dudu').at(-1);
    if (last && notify.current && last.id > newestReply.current && !openRef.current) {
      if (last.text.length <= 180) setBubble(last.text);
      else setOpen(true);
    }
    if (last && last.id > newestReply.current) notify.current = false;
    if (last) newestReply.current = Math.max(newestReply.current, last.id);
  }, [actions]);

  const ensure = useCallback(async () => {
    if (!started.current) {
      started.current = request('assistant/conversation').then((value) => {
        if (value.outcome !== 'success') throw new Error(value.message || P.failed);
        state.current = value;
        if (alive.current) setConversation(value);
        return value;
      }).catch((error) => { started.current = null; throw error; });
    }
    return started.current;
  }, [request]);
  const suggestions = useSuggestions({ actions, request, ensure, input, text: draft, setText: setDraft, open });
  const { close: closeSuggestions, recipient: relayRecipient } = suggestions;
  const marked = useMemo(() => highlightParts(draft, suggestions.skillNames), [draft, suggestions.skillNames]);

  const openFull = async () => {
    if (expanding || !actions.openSession) return;
    setExpanding(true);
    try {
      const target = await ensure();
      const from = dialog.current?.getBoundingClientRect().toJSON();
      await actions.openSession(target, { from });
      if (alive.current) { setOpen(false); setBubble(''); }
    } catch { if (alive.current) setProblem(P.failed); }
    finally { if (alive.current) setExpanding(false); }
  };

  useEffect(() => {
    if ((!open && !conversation?.sessionId) || suppressed || !settings.enabled) return;
    let active = true;
    let timer;
    const poll = async () => {
      if (!active) return;
      try {
        if (document.visibilityState !== 'hidden') {
          const ready = await ensure();
          const value = await request('assistant/state');
          const snapshot = value.conversation?.sessionId ? value.conversation : ready;
          if (!active) return;
          state.current = snapshot;
          setConversation(snapshot);
          if (snapshot.cursor !== knownCursor.current) await read(snapshot);
          if (snapshot.error) setProblem(P.failed);
        }
      } catch { if (active) setProblem(P.failed); }
      if (active) timer = setTimeout(poll, open ? 1000 : 5000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [open, conversation?.sessionId, ensure, read, request, settings.enabled, suppressed]);

  const send = useCallback(async (text) => {
    const attached = draftItems.current;
    if ((!text.trim() && !attached.length) || !actions.sendConversation || sendingNow.current) return;
    sendingNow.current = true;
    setProblem('');
    setSendProblem('');
    setNotice('');
    setSending(true);
    closeSuggestions();
    const addressed = addressedMessage(text);
    try {
      if (addressed) {
        if (addressed.error) { setSendProblem(T.detail.messageErrors[addressed.error]); return; }
        const recipient = relayRecipient;
        const message = {
          id: addressed.id, text: addressed.body,
          ...(recipient && issueAddress(recipient).toLowerCase() === addressed.id.toLowerCase() ? { session: recipient.session } : {}),
        };
        if (failedRelay.current?.id === addressed.id && failedRelay.current.text === addressed.body && failedRelay.current.attachments === attached) {
          message.retryEntry = failedRelay.current.entryId;
        }
        const result = attached.length
          ? await actions.forwardIssue(message, await encodeDrafts(attached))
          : await request('issues/forward', message);
        if (!['success', 'no_op'].includes(result.outcome)) {
          if (result.saved && result.entry?.id) failedRelay.current = { id: addressed.id, text: addressed.body, attachments: attached, entryId: result.entry.id };
          setSendProblem(result.saved ? T.detail.messageErrors.delivery_failed
            : result.code !== 'delivery_failed' && T.detail.messageErrors[result.code] || T.activity.notDelivered(result.message || T.shell.unavailable));
          return;
        }
        if (alive.current) {
          failedRelay.current = null;
          setDraft(''); setBubble(''); setNotice(`✓ @${issueAddress(result.issue)} · ${result.issue.title}`);
          for (const item of attached) if (item.url) URL.revokeObjectURL(item.url);
          draftItems.current = []; setDrafts([]);
        }
        return;
      }
      const target = await ensure();
      // Each message is read with what the owner chose for it: the page they are on, or nothing.
      const now = getWhere();
      const attachedPage = contextOn.current && now ? (now.page === 'issue' ? { page: 'issue', id: now.id } : { page: 'dashboard' }) : null;
      const set = await request('assistant/context', { where: attachedPage });
      if (set.outcome !== 'success') throw new Error(set.message);
      notify.current = true;
      const items = await encodeDrafts(attached);
      await actions.sendConversation(target.sessionId, text.trim(), items);
      if (alive.current) {
        setDraft(''); setBubble('');
        for (const item of attached) if (item.url) URL.revokeObjectURL(item.url);
        draftItems.current = []; setDrafts([]);
      }
    } catch (error) {
      notify.current = false;
      if (alive.current) setSendProblem(T.activity.notDelivered(error.message || T.shell.unavailable));
    }
    finally { sendingNow.current = false; if (alive.current) setSending(false); }
  }, [actions, ensure, request, closeSuggestions, relayRecipient]);

  useEffect(() => { contextOn.current = context; }, [context]);
  useLayoutEffect(() => { line.current?.style.setProperty('--token', context && token.current ? `${token.current.offsetWidth + 6}px` : '0px'); }, [context, open]);
  useEffect(() => {
    if (!notice) return undefined;
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  // DSH's own /compact on this conversation: the older history becomes one summary. The answer is a line in the thread for a few seconds.
  const compact = async () => {
    if (compacting) return;
    setCompacting(true);
    setProblem('');
    setNotice('');
    try {
      await ensure();
      const result = await request('assistant/compact');
      if (alive.current) setNotice(result.outcome !== 'success' ? P.compactFailed : result.compacted ? P.compacted : P.nothingToCompact);
    } catch { if (alive.current) setNotice(P.compactFailed); }
    finally { if (alive.current) setCompacting(false); }
  };

  const attach = (selected) => {
    if (sending) return;
    const picked = [...selected];
    if (!picked.length) return;
    const next = [...draftItems.current, ...picked.map((file) => (imageTypes.has(file.type)
      ? { id: crypto.randomUUID(), kind: 'image', file, url: URL.createObjectURL(file) } : { id: crypto.randomUUID(), kind: 'file', file }))];
    draftItems.current = next; setDrafts(next); setProblem(''); setSendProblem('');
    input.current?.focus();
  };
  const removeDraft = (id) => {
    const removed = draftItems.current.find((item) => item.id === id);
    if (removed?.url) URL.revokeObjectURL(removed.url);
    draftItems.current = draftItems.current.filter((item) => item.id !== id);
    setDrafts(draftItems.current);
  };

  const stopVoice = useCallback((cancel = false) => {
    const current = speech.current;
    if (!current) return;
    current.cancel = cancel;
    current.released = true;
    if (current.ended) current.finish();
    else current.stop(cancel);
    setListening(false);
    if (cancel) setHeard('');
  }, []);

  const hide = async () => {
    if (hiding) return;
    setHiding(true);
    setProblem('');
    try {
      const result = await request('assistant/settings', { patch: { pet: { enabled: false } } });
      if (result.outcome !== 'success') throw new Error();
      if (!alive.current) return;
      setMenuOpen(false); setOpen(false); setBubble('');
      setSettings(result.settings.pet);
      window.dispatchEvent(new Event('dudu:settings-changed'));
    } catch { if (alive.current) setProblem(T.toast.failed); }
    finally { if (alive.current) setHiding(false); }
  };

  const startVoice = useCallback((autoSend = false) => {
    if (!available || speech.current || suppressed || !settings.enabled || !settings.voice) return;
    const current = { text: '', cancel: false, autoSend, released: !autoSend, ended: false, id: ++operation.current };
    speech.current = current;
    current.finish = () => {
      if (speech.current?.id !== current.id) return;
      if (current.autoSend && !current.released && !current.cancel) return;
      speech.current = null;
      if (!alive.current) return;
      setListening(false);
      setHeard('');
      if (!current.cancel && current.text.trim()) {
        if (current.autoSend) void send(current.text);
        else { setDraft(current.text); setOpen(true); }
      }
    };
    setProblem('');
    setHeard('');
    const failed = () => {
      if (!current.cancel && alive.current) setProblem(P.voiceFailed);
      current.cancel = true;
      current.ended = true;
      current.finish();
    };
    try {
        const capture = recordSpeech(speechCatalog, actions.transcribeVoice);
        let stopping = false;
        current.stop = (cancel) => {
          const result = capture.stop(cancel);
          if (stopping) return;
          stopping = true;
          void result.then((text) => { current.text = text; current.ended = true; current.finish(); }).catch(failed);
        };
        void capture.started.catch(failed);
      setListening(true);
    }
    catch { speech.current = null; setProblem(P.voiceFailed); }
  }, [available, speechCatalog, actions, suppressed, settings.enabled, settings.voice, send]);

  useEffect(() => {
    if (!settings.enabled || suppressed) {
      if (speech.current) { speech.current.cancel = true; speech.current.stop(true); }
      return;
    }
    let holding = false;
    let timer;
    let tapped = 0;
    let longPress = false;
    const cancel = () => { holding = false; tapped = 0; clearTimeout(timer); stopVoice(true); };
    const keydown = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.code === 'Escape') {
        if (speech.current) { event.preventDefault(); cancel(); }
        else if (openRef.current && !document.querySelector('[data-radix-popper-content-wrapper], [role="menu"], [aria-modal="true"]')) { event.preventDefault(); setOpen(false); button.current?.focus(); }
        setBubble('');
        return;
      }
      if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || editable(event.target) || document.querySelector('[aria-modal="true"],[role="menu"],[role="listbox"]')) return;
      if (!settings.doubleSpace && !(settings.voice && available)) return;
      event.preventDefault();
      holding = true;
      longPress = false;
      if (settings.voice && available) timer = setTimeout(() => { if (holding) { longPress = true; tapped = 0; startVoice(true); } }, 500);
    };
    const keyup = (event) => {
      if (event.code !== 'Space' || !holding) return;
      event.preventDefault();
      holding = false;
      clearTimeout(timer);
      if (longPress) { stopVoice(false); return; }
      const at = Date.now();
      if (settings.doubleSpace && tapped && at - tapped <= 350) { tapped = 0; setOpen(true); setBubble(''); }
      else tapped = at;
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('keyup', keyup);
    window.addEventListener('blur', cancel);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); window.removeEventListener('blur', cancel); stopVoice(true); };
  }, [settings, suppressed, available, startVoice, stopVoice]);

  useEffect(() => {
    if ((!open && !bubble) || suppressed || !settings.enabled) return;
    const dismiss = (event) => {
      if (event.composedPath().includes(dock.current)) return;
      // Let React identify portaled descendants before handling an outside press.
      queueMicrotask(() => {
        if (isPetInteraction(event) || event.target instanceof Element && event.target.closest('[data-pet-menu]')) return;
        setOpen(false);
        setBubble('');
        stopVoice(true);
      });
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open, bubble, suppressed, settings.enabled, stopVoice]);

  if (!settings.enabled || suppressed) return null;
  const today = new Date().toDateString();
  const began = turnStart(messages); // when the work now going on began, for the running line
  const older = messages.filter((message) => new Date(message.at).toDateString() !== today);
  const current = messages.filter((message) => new Date(message.at).toDateString() === today);
  const loadEarlier = async () => {
    if (paging.current || !hasMore) return;
    paging.current = true;
    try { await read(state.current, { before: oldest.current ?? messages[0]?.id }); }
    catch { setProblem(P.failed); }
    finally { paging.current = false; }
  };
  const showEarlier = async () => {
    setEarlier(!earlier);
    if (!earlier) await loadEarlier();
  };
  const renderMessage = (message) => <div key={message.id} className={`dudu-pet-message dudu-pet-message--${message.role}`}>
    {message.role === 'action' ? <><Check className="size-3.5 shrink-0" aria-hidden="true" /><span className="text-muted-foreground">{P.actions[message.action]}</span><span>{message.widget ? T.widgets.titles[message.widget] ?? message.widget : message.text}</span></> : <>
      {message.files?.map((file, index) => <span key={`${file.attachmentId}:${index}`} className="dudu-pet-message-file" title={file.name}>
        <FileText className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{file.name}</span><span className="shrink-0 text-muted-foreground">{formatBytes(file.bytes)}</span>
      </span>)}
      {message.images?.map((attachment, index) => <ConversationImage key={`${attachment.attachmentId}:${index}`} attachment={attachment} sessionId={conversation?.sessionId} actions={actions} onLoad={() => {
        if (!earlier && list.current) list.current.scrollTop = list.current.scrollHeight;
      }} />)}
      {message.text}
    </>}
  </div>;
  return (
    <div className="dudu-pet-dock" ref={dock}>
      {open && (
        <section ref={dialog} className="dudu-pet-conversation" role="dialog" aria-label={P.conversation}>
          <header>
            <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-xs font-normal disabled:opacity-100 [&_svg]:size-3.5" onClick={showEarlier} disabled={!older.length && !hasMore}>{earlier ? <ChevronDown /> : <ChevronUp />}{P.earlier}</Button>
            <div className="flex items-center">
              <Button variant="ghost" size="icon-sm" aria-label={T.detail.openSession} title={T.detail.openSession} disabled={expanding || !actions.openSession} onClick={openFull}><Expand /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={P.close} onClick={() => { setOpen(false); button.current?.focus(); }}><X /></Button>
            </div>
          </header>
          <div className="dudu-pet-messages" ref={list} role="log" aria-live="polite" aria-relevant="additions text">
            <div className="dudu-pet-thread">
            {earlier && hasMore && <Button variant="ghost" size="sm" onClick={loadEarlier}>{T.detail.loadEarlier}</Button>}
            {earlier && older.map(renderMessage)}
            <div className="dudu-pet-day">{T.today}</div>
            {current.map(renderMessage)}
            {(conversation?.running || compacting) && <RunningStatus since={compacting ? undefined : began} />}
            {notice && <div className="dudu-pet-day" role="status">{notice}</div>}
            </div>
          </div>
          {(sendProblem || problem) && <div role="alert" className="dudu-pet-error">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words">{sendProblem || problem}</span>
              <Button variant="ghost" size="icon-xs" aria-label={T.retry} title={T.retry} onClick={async () => {
                if (retrying) return;
                if (sendProblem) { await send(draft); return; }
                setRetrying(true);
                try {
                  const ready = await ensure();
                  await read(ready);
                  setProblem('');
                } catch { setProblem(P.failed); }
                finally { setRetrying(false); }
              }} disabled={sending || retrying}>{sending || retrying ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}</Button>
              <Button variant="ghost" size="icon-xs" aria-label={P.close} title={P.close} onClick={() => { setSendProblem(''); setProblem(''); }}><X /></Button>
          </div>}
          <form className="dudu-pet-input" ref={box} aria-busy={sending} onSubmit={(event) => { event.preventDefault(); void send(draft); }}
            onDragOver={(event) => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); }}
            onDrop={(event) => { event.preventDefault(); attach(droppedFiles(event.dataTransfer)); }}>
            {drafts.length > 0 && <div className="dudu-pet-attachments">
              {drafts.map((item) => item.kind === 'image'
                ? <div key={item.id} className="dudu-pet-attachment">
                  <img src={item.url} alt={item.file.name} />
                  <button type="button" aria-label={`${T.settings.connectors.remove}: ${item.file.name}`} disabled={sending} onClick={() => removeDraft(item.id)}><X aria-hidden="true" /></button>
                </div>
                // A file is a card, as in DSH's own box: a document mark, its name, and its kind and size.
                : <div key={item.id} className="dudu-pet-attachment dudu-pet-file">
                  <span className="dudu-pet-file-mark"><FileText aria-hidden="true" /></span>
                  <span className="dudu-pet-file-text"><span>{item.file.name}</span><small>{[extensionOf(item.file.name), formatBytes(item.file.size)].filter(Boolean).join(' · ')}</small></span>
                  <button type="button" aria-label={`${T.settings.connectors.remove}: ${item.file.name}`} disabled={sending} onClick={() => removeDraft(item.id)}><X aria-hidden="true" /></button>
                </div>)}
            </div>}
            {/* Like /goal in DSH: the blue word first, then grey words about it (here, the page), which give way to what is typed. */}
            <div className="dudu-pet-line" ref={line}>
              {context && <span className="dudu-pet-token" ref={token}>{P.context}</span>}
              {context && !draft && whereLabel(where) && <span className="dudu-pet-where" aria-hidden="true">{whereLabel(where)}</span>}
              <div className="dudu-pet-mirror" ref={mirror} aria-hidden="true">
                {marked.map((part, index) => (part.mark ? <span key={index} className="dudu-pet-mark">{part.text}</span> : part.text))}{draft.endsWith('\n') ? '\n' : ''}
              </div>
              <textarea ref={input} rows={1} value={draft} onChange={(event) => { setDraft(event.target.value); suggestions.inspect(event.target); }}
                onScroll={(event) => { if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop; }}
                onClick={(event) => suggestions.inspect(event.currentTarget, true)} onSelect={(event) => suggestions.inspect(event.currentTarget)}
                {...suggestions.controls} onPaste={(event) => {
                const pasted = [...(event.clipboardData?.files ?? [])];
                if (pasted.length) { event.preventDefault(); attach(pasted); }
              }} onKeyDown={(event) => {
                if (suggestions.keyDown(event)) return;
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); }
                // The word is taken off the way a typed one is: Backspace at the start of the line.
                else if (event.key === 'Backspace' && context && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) { event.preventDefault(); setContext(false); }
              }} placeholder={context ? '' : P.message} aria-label={context ? `${P.context}: ${whereLabel(where)}` : P.message} disabled={sending} />
            </div>
            <div className="dudu-pet-input-tools">
              <input ref={files} type="file" multiple hidden tabIndex={-1} onChange={(event) => { attach(event.target.files); event.target.value = ''; }} />
              <PlusMenu anchor={box} disabled={sending} contextOn={context} contextAvailable={Boolean(where)} compactDisabled={compacting || Boolean(conversation?.running)}
                onFile={() => files.current?.click()} onContext={() => { setContext(!context); input.current?.focus(); }} onCompact={() => void compact()} />
              <ConversationControls sessionId={conversation?.sessionId} model={conversation?.model} actions={actions}
                renderPermission={renderPermission} locked={sending || Boolean(conversation?.running)} onError={setProblem} />
              {available && settings.voice && <Button type="button" variant="ghost" size="icon-sm" aria-label={P.voice} aria-pressed={listening} onClick={() => listening ? stopVoice(false) : startVoice(false)}><Mic /></Button>}
              {conversation?.running
                ? <Button type="button" variant="ghost" size="icon-sm" className="dudu-pet-stop" aria-label={P.stop} onClick={() => actions.stopConversation?.(conversation.sessionId).catch(() => setProblem(P.failed))}><Square /></Button>
                : <Button type="submit" size="icon-sm" className="dudu-pet-send" aria-label={P.send} disabled={(!draft.trim() && !drafts.length) || sending}>{sending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}</Button>}
            </div>
            <Suggestions suggestions={suggestions} anchor={box} input={input} />
          </form>
        </section>
      )}
      {(listening || (!open && bubble)) && (
        <div className="dudu-pet-bubble" role="status">
          {listening ? <><div>{heard}</div><small>{P.release}</small></> : <>
            <div className="-mr-1.5 flex items-start gap-2">
              <div className="min-w-0 flex-1">{bubble}</div>
              <button type="button" className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted" aria-label={P.close} onClick={() => setBubble('')}><X className="size-3.5" /></button>
            </div>
            <button type="button" className="dudu-pet-bubble-open" onClick={() => { setOpen(true); setBubble(''); }}>{P.open}</button>
          </>}
        </div>
      )}
      {reminders.reminder && <Reminder reminder={reminders.reminder} more={reminders.more} onClose={reminders.close} onOpen={reminders.open} />}
      {listening && <><i className="dudu-pet-ring" aria-hidden="true" /><i className="dudu-pet-ring dudu-pet-ring--second" aria-hidden="true" /></>}
      <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <ContextMenuTrigger asChild>
          <button ref={button} type="button" className={`dudu-pet${listening ? ' dudu-pet--listening' : ''}${open ? ' dudu-pet--open' : bubble ? ' dudu-pet--reply' : ''}`} aria-label={P.open} aria-expanded={open} onClick={() => { setOpen(!open); setBubble(''); }}>
            <span className="dudu-pet-body">
              <img src={pet} width="64" height="64" alt="" />
              <i className="dudu-pet-eye dudu-pet-eye--left" aria-hidden="true"><i /></i>
              <i className="dudu-pet-eye dudu-pet-eye--right" aria-hidden="true"><i /></i>
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent data-pet-menu="" data-pet-context-menu=""
          className="dudu-pet-menu w-[128px] rounded-xl border-input p-1"
          onCloseAutoFocus={(event) => { event.preventDefault(); button.current?.focus({ preventScroll: true }); }}>
          <ContextMenuItem className="h-[26px] gap-2 rounded-lg px-2 text-xs [&_svg]:size-3.5" onSelect={onSettings}>
            <Settings strokeWidth={1.7} aria-hidden="true" />{T.dashboard.settings}
          </ContextMenuItem>
          <ContextMenuItem className="h-[26px] gap-2 rounded-lg px-2 text-xs [&_svg]:size-3.5" disabled={hiding} onSelect={() => void hide()}>
            <EyeOff strokeWidth={1.7} aria-hidden="true" />{P.hide}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
