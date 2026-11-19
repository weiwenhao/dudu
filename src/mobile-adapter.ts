import { MOBILE_CSS } from './mobile-styles.ts';
import { MOBILE_ICONS } from './generated/mobile-icons.ts';
import { installBrowserDiagnostics } from './browser-diagnostics.ts';
import type { ConversationView, SpeechOverlayPhase, SpeechUpdate } from './HarnessView.types.ts';

export const MOBILE_ADAPTER_VERSION = '1.5.0';

type AdapterOptions = { nativeToolbar?: boolean };
type AdapterConfiguration = { css: string; icons: typeof MOBILE_ICONS; version: string; nativeToolbar: boolean };

function installMobileAdapter(config: AdapterConfiguration, startDiagnostics: typeof installBrowserDiagnostics) {
  const w = window as typeof window & {
    ReactNativeWebView?: { postMessage(value: string): void };
    __HARNESS_MOBILE__?: {
      version: string;
      nativeToolbar: boolean;
      toggleSidebar(): void;
      closeSidebar(): void;
      toggleTools(): void;
      closeTools(): void;
      selectConversationView(id: string): void;
      updateSpeechInput(update: SpeechUpdate): void;
      newSession(): void;
      openSettings(): void;
      selectSettingsCategory(index: number): void;
      closeSettings(): void;
      setComputerName(name: string): void;
      back(): boolean;
      destroy(): void;
    };
  };
  const nativeToolbar = config.nativeToolbar || !!w.ReactNativeWebView || window.parent !== window;
  if (w.__HARNESS_MOBILE__?.version === config.version
    && w.__HARNESS_MOBILE__.nativeToolbar === nativeToolbar) return;
  w.__HARNESS_MOBILE__?.destroy();
  let drawer = false;
  let tools = false;
  let toolsOpenRequested = false;
  let viewsOpen = false;
  let conversationViews: ConversationView[] = [];
  let lastConversationViews = '';
  let raf = 0;
  let viewportRaf = 0;
  let highestHeight = innerHeight;
  let lastTheme = '';
  let lastReady = false;
  let lastTitle = '';
  let lastCanGoBack: boolean | null = null;
  let lastSettingsCategories = '';
  let lastToolsAvailable: boolean | null = null;
  let toolsAvailable = false;
  let mutationRecords = 0;
  let usageRow: HTMLElement | null = null;
  let settingsRequested = false;
  let viewportHeight = 0;
  let photoInput: HTMLInputElement | null = null;
  let photoAccept: string | null = null;
  let inputMode: 'voice' | 'text' = nativeToolbar ? 'voice' : 'text';
  let speechSequence = Date.now();
  let speechGesture: { id: number; y: number; pointer: number; time: number; cancelled: boolean; released: boolean } | null = null;
  let speechOverlayPhase: SpeechOverlayPhase = 'hidden';
  let speechTouchRaf = 0;
  let speechTouchX = 0;
  let speechTouchY = 0;
  let speechOverlayTop = 0;
  let speechFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let speechSendRaf = 0;
  let speechSendToken = 0;
  const sidebarDefaultsKey = 'dudu.sidebar.defaults.v1';
  let sidebarDefaults: string[] = ['单列表', '最近更新'];
  let sidebarDefaultMenuRequested = false;
  let sidebarExpansionRequested = false;
  let observedEditor: HTMLElement | null = null;
  let observedHeader: HTMLElement | null = null;
  let observedSidebarRoot: HTMLElement | null = null;
  let computerName = '电脑';
  try {
    if (localStorage.getItem(sidebarDefaultsKey)) sidebarDefaults = [];
  } catch { /* Use defaults for this visit when browser storage is unavailable. */ }
  const cleanup: (() => void)[] = [];
  const root = document.documentElement;
  const mobileViewport = window.matchMedia('(max-width: 820px)');
  let parentOrigin = window.parent !== window && document.referrer ? new URL(document.referrer).origin : '';
  const post = (value: object) => {
    w.ReactNativeWebView?.postMessage(JSON.stringify(value));
    if (parentOrigin) window.parent.postMessage({ source: 'harness-mobile-page', ...value }, parentOrigin);
  };
  const diagnostics = startDiagnostics(post);
  cleanup.push(() => diagnostics.destroy());
  const record = diagnostics.record;
  const q = (s: string) => document.querySelector<HTMLElement>(s);
  const mark = (element: HTMLElement | null, attribute: string) => {
    if (element && !element.hasAttribute(attribute)) element.setAttribute(attribute, '');
    return element;
  };
  const updateBackState = () => {
    const canGoBack = drawer || tools || viewsOpen || !!q('[data-hm-settings]');
    if (lastCanGoBack !== canGoBack) {
      lastCanGoBack = canGoBack;
      post({ type: 'back-state', canGoBack });
    }
  };
  const icon = (kind: keyof typeof MOBILE_ICONS) => config.icons[kind];
  const setSpeechOverlay = (phase: SpeechOverlayPhase) => {
    if (speechOverlayPhase === phase) return;
    speechOverlayPhase = phase;
    const overlay = q('#hm-speech-overlay');
    if (overlay) {
      overlay.dataset.hmPhase = phase;
      overlay.setAttribute('aria-hidden', String(phase === 'hidden'));
      const hint = overlay.querySelector('#hm-speech-hint');
      if (hint) hint.textContent = phase === 'cancel' ? '松手取消'
        : phase === 'processing' ? '正在识别…' : '松手发送，上移取消';
      if (phase === 'hidden') {
        overlay.style.setProperty('--hm-meter', '0');
        overlay.querySelector('#hm-speech-transcript')?.replaceChildren();
      }
    }
    post({ type: 'speech-overlay', phase });
  };
  const updateSpeechTouch = (x: number, y: number) => {
    speechTouchX = x;
    speechTouchY = y;
    if (speechTouchRaf) return;
    speechTouchRaf = requestAnimationFrame(() => {
      speechTouchRaf = 0;
      const overlay = q('#hm-speech-overlay');
      overlay?.style.setProperty('--hm-touch-x', `${speechTouchX}px`);
      overlay?.style.setProperty('--hm-touch-y', `${Math.max(0, speechTouchY - speechOverlayTop)}px`);
    });
  };
  const speechFeedback = (message: string, active = true) => {
    const feedback = q('#hm-speech-feedback');
    if (feedback) {
      feedback.textContent = message;
      feedback.hidden = !active;
    }
  };
  const cancelSpeech = () => {
    speechSendToken++;
    cancelAnimationFrame(speechSendRaf);
    cancelAnimationFrame(speechTouchRaf);
    speechTouchRaf = 0;
    if (speechGesture) post({ type: 'speech-cancel', id: speechGesture.id });
    speechGesture = null;
    clearTimeout(speechFeedbackTimer);
    root.removeAttribute('data-hm-speech');
    root.removeAttribute('data-hm-speech-cancel');
    setSpeechOverlay('hidden');
    const button = q('#hm-voice-input');
    if (button) button.textContent = '按住说话';
    speechFeedback('', false);
  };
  const setInputMode = (mode: 'voice' | 'text', focus = false) => {
    record('composer.input-mode', { mode, focus });
    inputMode = mode;
    if (root.dataset.hmInputMode !== mode) root.dataset.hmInputMode = mode;
    const editor = q('[data-composer-input]');
    editor?.setAttribute('inputmode', mode === 'voice' ? 'none' : 'text');
    const toggle = q('#hm-keyboard-toggle');
    if (toggle) {
      toggle.innerHTML = icon(mode === 'voice' ? 'keyboard' : 'voice');
      toggle.setAttribute('aria-label', mode === 'voice' ? '切换到键盘输入' : '切换到按住说话');
    }
    if (mode === 'voice') editor?.blur();
    else if (focus) editor?.focus({ preventScroll: true });
  };
  const updateDraft = () => {
    const hasDraft = !!q('[data-composer-input]')?.textContent?.trim();
    if (root.hasAttribute('data-hm-draft') !== hasDraft) root.toggleAttribute('data-hm-draft', hasDraft);
  };
  const editorObserver = new MutationObserver(updateDraft);
  const headerObserver = new MutationObserver(() => schedule());
  const sidebarObserver = new MutationObserver(() => schedule());
  const insertSpeechText = (text: string) => {
    const editor = q('[data-composer-input]');
    if (!editor || !text.trim()) return null;
    // Lexical cannot accept insertion while its voice-mode container is hidden.
    root.setAttribute('data-hm-draft', '');
    editor.setAttribute('inputmode', 'none');
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const before = editor.textContent ?? '';
    const value = `${before.trim() ? ' ' : ''}${text.trim()}`;
    try {
      document.execCommand('insertText', false, value);
    } catch {
      editor.blur();
      updateDraft();
      return null;
    }
    editor.blur();
    updateDraft();
    return { editor, before, expected: before + value };
  };
  const updateSpeechInput = (update: SpeechUpdate) => {
    if (!speechGesture || update.id !== speechGesture.id) return;
    if (typeof update.level === 'number' && Number.isFinite(update.level)) {
      if (!speechGesture.released && update.state === 'listening') {
        q('#hm-speech-overlay')?.style.setProperty('--hm-meter', String(Math.max(0, Math.min(1, update.level))));
      }
      if (update.text === undefined && !update.message) return;
    }
    if (update.state === 'cancelled') { cancelSpeech(); return; }
    if (update.state === 'error') {
      speechGesture = null;
      root.removeAttribute('data-hm-speech');
      root.removeAttribute('data-hm-speech-cancel');
      setSpeechOverlay('hidden');
      const button = q('#hm-voice-input');
      if (button) button.textContent = '按住说话';
      speechFeedback(update.message || '没听清，请重试');
      speechFeedbackTimer = setTimeout(() => speechFeedback('', false), 2800);
      return;
    }
    if (update.state === 'complete') {
      if (speechGesture.cancelled) { cancelSpeech(); return; }
      speechGesture = null;
      root.removeAttribute('data-hm-speech');
      root.removeAttribute('data-hm-speech-cancel');
      setSpeechOverlay('hidden');
      const button = q('#hm-voice-input');
      if (button) button.textContent = '按住说话';
      speechFeedback('', false);
      const insertion = insertSpeechText(update.text ?? '');
      if (!insertion) return;
      const token = ++speechSendToken;
      const { editor, before, expected } = insertion;
      let attempts = 0;
      const send = () => {
        if (token !== speechSendToken || !editor?.isConnected) return;
        const primary = q('[data-composer-card] button[class*="_primary"]') as HTMLButtonElement | null;
        const committed = editor.textContent === expected && editor.textContent !== before;
        if (committed && primary && !primary.disabled
          && /发送|send/i.test(primary.getAttribute('aria-label') ?? '')) {
          primary.click();
        } else if (++attempts < 20) speechSendRaf = requestAnimationFrame(send);
        else setInputMode('text');
      };
      speechSendRaf = requestAnimationFrame(send);
      return;
    }
    if (speechGesture.released && update.state !== 'processing') return;
    root.dataset.hmSpeech = update.state;
    setSpeechOverlay(speechGesture.cancelled ? 'cancel' : update.state === 'processing' ? 'processing' : 'recording');
    const transcript = q('#hm-speech-transcript');
    if (transcript && update.text !== undefined && transcript.textContent !== update.text) transcript.textContent = update.text;
    const button = q('#hm-voice-input');
    if (button) button.textContent = update.state === 'processing' ? '识别中…' : speechGesture.cancelled ? '松开取消' : '松开发送';
  };
  const updateScrim = () => {
    const center = q('[data-hm-center]');
    if (center) {
      const hidden = mobileViewport.matches && (drawer || tools);
      center.inert = hidden;
      center.setAttribute('aria-hidden', String(hidden));
    }
    const scrim = q('#hm-scrim');
    if (!scrim) return;
    scrim.dataset.hmOpen = String(drawer || tools);
    scrim.setAttribute('aria-label', tools ? '关闭工作面板' : '关闭会话列表');
  };
  const requestToolsContent = () => {
    if (!tools || !toolsAvailable || toolsOpenRequested) return;
    const expand = q('[data-sidebar-right-expand]');
    if (expand) {
      toolsOpenRequested = true;
      expand.click();
    }
  };
  const setTools = (open: boolean) => {
    open = open && toolsAvailable;
    if (tools === open && root.dataset.hmTools === (open ? 'open' : 'closed')) return;
    if (open && drawer) setDrawer(false);
    if (open) { setViewsOpen(false); cancelSpeech(); }
    tools = open;
    record('tools.change', { open, available: toolsAvailable });
    toolsOpenRequested = false;
    root.dataset.hmTools = open ? 'open' : 'closed';
    const rightbar = q('[data-hm-rightbar]');
    if (rightbar) {
      const hidden = mobileViewport.matches && !open;
      rightbar.inert = hidden;
      rightbar.setAttribute('aria-hidden', String(hidden));
    }
    requestToolsContent();
    updateScrim();
    q('#hm-toolbar-tools')?.setAttribute('aria-expanded', String(open));
    post({ type: 'tools', open });
    updateBackState();
  };
  const setDrawer = (open: boolean) => {
    if (drawer === open && root.dataset.hmDrawer === (open ? 'open' : 'closed')) return;
    if (!open) {
      q('[data-hm-sidebar] [data-row-key^="session:"][class*="_menuOpen"] [class*="_rowActions"] button')?.click();
    }
    if (open && tools) setTools(false);
    if (open) { setViewsOpen(false); cancelSpeech(); }
    drawer = open;
    record('sidebar.change', { open });
    root.dataset.hmDrawer = open ? 'open' : 'closed';
    const sidebar = q('[data-hm-sidebar]');
    if (sidebar) {
      const hidden = mobileViewport.matches && !open;
      sidebar.dataset.hmOpen = String(open);
      if (sidebar.inert !== hidden) sidebar.inert = hidden;
      sidebar.setAttribute('aria-hidden', String(hidden));
    }
    updateScrim();
    q('#hm-toolbar-menu')?.setAttribute('aria-expanded', String(open));
    post({ type: 'drawer', open });
    updateBackState();
    if (open) schedule();
  };
  const setViewsOpen = (open: boolean) => {
    viewsOpen = open && conversationViews.length > 1;
    if (viewsOpen) { setDrawer(false); setTools(false); cancelSpeech(); }
    const menu = q('#hm-view-menu');
    if (menu) menu.dataset.hmOpen = String(viewsOpen);
    q('#hm-toolbar-views')?.setAttribute('aria-expanded', String(viewsOpen));
    updateBackState();
  };
  const conversationTabs = () => [...document.querySelectorAll<HTMLButtonElement>(
    '[data-slot="conversation.header"] [data-conversation-tabs] [role="tab"], [data-slot="conversation.header"] [role="tablist"] [role="tab"]',
  )].map((button, index) => ({
    button,
    id: button.id || button.getAttribute('aria-controls') || `${index}:${button.textContent?.trim()}`,
    label: (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
    selected: button.getAttribute('aria-selected') === 'true',
    disabled: button.disabled || button.getAttribute('aria-disabled') === 'true',
  })).filter((view) => view.label);
  const selectConversationView = (id: string) => {
    const start = performance.now();
    cancelSpeech();
    const view = conversationTabs().find((item) => item.id === id);
    if (view && !view.disabled) view.button.click();
    setViewsOpen(false);
    schedule();
    record('conversation.view-select', { found: !!view, disabled: view?.disabled, durationMs: performance.now() - start });
  };
  const updateConversationViews = () => {
    const views = conversationTabs().map(({ button: _button, ...view }) => view);
    const signature = JSON.stringify(views);
    if (signature === lastConversationViews) return;
    lastConversationViews = signature;
    conversationViews = views;
    post({ type: 'conversation-views', views });
    const trigger = q('#hm-toolbar-views') as HTMLButtonElement | null;
    if (trigger) {
      trigger.disabled = views.length < 2;
      trigger.setAttribute('aria-label', `切换视图，当前${views.find((view) => view.selected)?.label ?? '对话'}`);
    }
    const list = q('#hm-view-options');
    if (list) {
      list.replaceChildren(...views.map((view) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.disabled = view.disabled;
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-checked', String(view.selected));
        const label = document.createElement('span');
        label.textContent = view.label;
        button.append(label);
        if (view.selected) button.insertAdjacentHTML('beforeend', icon('check'));
        button.onclick = () => selectConversationView(view.id);
        return button;
      }));
    }
    if (views.length < 2) setViewsOpen(false);
  };
  const restorePhotoAccept = () => {
    if (!photoInput) return;
    if (photoAccept === null) photoInput.removeAttribute('accept');
    else photoInput.setAttribute('accept', photoAccept);
    photoInput.removeEventListener('change', restorePhotoAccept);
    photoInput.removeEventListener('cancel', restorePhotoAccept);
    photoInput = null;
  };
  const installPhotoButton = () => {
    const add = q('[data-composer-card] button[aria-haspopup="listbox"]');
    if (!add || q('#hm-composer-photos')) return;
    const button = document.createElement('button');
    button.id = 'hm-composer-photos';
    button.type = 'button';
    button.setAttribute('aria-label', '上传照片');
    button.innerHTML = icon('photo');
    button.onclick = () => {
      cancelSpeech();
      if (add.getAttribute('aria-expanded') === 'true') add.click();
      restorePhotoAccept();
      photoInput = document.querySelector<HTMLInputElement>('[data-composer-card] input[type="file"]');
      if (!photoInput) return;
      photoAccept = photoInput.getAttribute('accept');
      photoInput.accept = 'image/*';
      photoInput.addEventListener('change', restorePhotoAccept);
      photoInput.addEventListener('cancel', restorePhotoAccept);
      photoInput.click();
    };
    add.after(button);
  };
  const installComposerControls = () => {
    installPhotoButton();
    const card = q('[data-composer-card]');
    const add = card?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
    const row = add?.closest<HTMLElement>('[class*="_row"]');
    if (!card || !row) return;
    if (!q('#hm-speech-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'hm-speech-overlay';
      overlay.dataset.hmPhase = 'hidden';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = '<div id="hm-speech-transcript"></div><div id="hm-speech-hint" role="status" aria-live="polite"></div><div id="hm-speech-wave" aria-hidden="true"></div>';
      const wave = overlay.querySelector('#hm-speech-wave')!;
      for (let index = 0; index < 61; index++) {
        const bar = document.createElement('i');
        const taper = Math.sin(Math.PI * (index + 1) / 62);
        const variation = .45 + .55 * Math.abs(Math.sin(index * 1.71));
        bar.style.setProperty('--hm-bar-weight', String(taper * variation));
        wave.append(bar);
      }
      document.body.append(overlay);
    }
    if (add && !add.querySelector('[data-hm-add-icon]')) {
      const glyph = document.createElement('span');
      glyph.dataset.hmAddIcon = '';
      glyph.innerHTML = icon('add');
      add.append(glyph);
    }
    if (!q('#hm-keyboard-toggle')) {
      const toggle = document.createElement('button');
      toggle.id = 'hm-keyboard-toggle';
      toggle.type = 'button';
      toggle.onclick = () => { cancelSpeech(); setInputMode(inputMode === 'voice' ? 'text' : 'voice', true); };
      row.append(toggle);
      if (!nativeToolbar) toggle.hidden = true;
      const voice = document.createElement('button');
      voice.id = 'hm-voice-input';
      voice.type = 'button';
      voice.textContent = '按住说话';
      voice.setAttribute('aria-label', '按住说话，松开发送，上滑取消');
      voice.oncontextmenu = (event) => event.preventDefault();
      voice.onpointerdown = (event) => {
        if (event.button !== 0 || speechGesture || !nativeToolbar) return;
        event.preventDefault();
        cancelSpeech();
        speechGesture = { id: ++speechSequence, y: event.clientY, pointer: event.pointerId,
          time: Date.now(), cancelled: false, released: false };
        voice.setPointerCapture(event.pointerId);
        root.dataset.hmSpeech = 'preparing';
        setSpeechOverlay('recording');
        speechOverlayTop = q('#hm-speech-overlay')?.getBoundingClientRect().top ?? 0;
        updateSpeechTouch(event.clientX, event.clientY);
        voice.textContent = '松开发送';
        post({ type: 'speech-start', id: speechGesture.id });
      };
      voice.onpointermove = (event) => {
        if (!speechGesture || speechGesture.released || speechGesture.pointer !== event.pointerId) return;
        updateSpeechTouch(event.clientX, event.clientY);
        const cancel = speechGesture.y - event.clientY > 60;
        if (cancel === speechGesture.cancelled) return;
        speechGesture.cancelled = cancel;
        root.toggleAttribute('data-hm-speech-cancel', cancel);
        setSpeechOverlay(cancel ? 'cancel' : 'recording');
        voice.textContent = cancel ? '松开取消' : '松开发送';
      };
      voice.onpointerup = (event) => {
        if (!speechGesture || speechGesture.pointer !== event.pointerId) return;
        if (speechGesture.cancelled || Date.now() - speechGesture.time < 250) { cancelSpeech(); return; }
        speechGesture.released = true;
        voice.textContent = '识别中…';
        root.dataset.hmSpeech = 'processing';
        setSpeechOverlay('processing');
        post({ type: 'speech-stop', id: speechGesture.id });
      };
      voice.onpointercancel = () => cancelSpeech();
      voice.onlostpointercapture = () => { if (speechGesture && !speechGesture.released) cancelSpeech(); };
      row.append(voice);
      const feedback = document.createElement('div');
      feedback.id = 'hm-speech-feedback';
      feedback.hidden = true;
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
      card.append(feedback);
      if (q('[data-composer-input]')?.textContent?.trim()) inputMode = 'text';
      setInputMode(inputMode);
      updateDraft();
    }
    for (const item of document.querySelectorAll<HTMLElement>('[data-trigger-menu] [role="option"]')) {
      const name = item.querySelector('[class*="_itemAlias"]')?.textContent?.trim() as keyof typeof MOBILE_ICONS | undefined;
      const glyph = item.querySelector<HTMLElement>('[class*="_itemIcon"]');
      if (name && config.icons[name] && glyph && !glyph.hasAttribute('data-hm-command-icon')) {
        glyph.dataset.hmCommandIcon = '';
        glyph.insertAdjacentHTML('beforeend', `<span data-hm-lucide>${icon(name)}</span>`);
      }
    }
  };
  const newSession = () => {
    record('conversation.new');
    cancelSpeech();
    const button = document.querySelector<HTMLButtonElement>(
      '[data-hm-sidebar] button[class*="_newSession"], [data-hm-sidebar] button[aria-label="New session"], [data-hm-sidebar] button[aria-label="新建会话"]',
    );
    button?.click();
    setDrawer(false);
    setTools(false);
  };
  const selectSettingsCategory = (index: number) => {
    if (!Number.isInteger(index) || index < 0) return;
    q('[data-hm-settings-nav]')?.querySelectorAll<HTMLButtonElement>('button')[index]?.click();
    record('settings.select', { index });
  };
  const closeSettings = () => {
    q('[data-hm-settings] [class*="_close"], [data-hm-settings] [aria-label="Close"], [data-hm-settings] [aria-label="关闭"]')?.click();
  };
  const setComputerName = (name: string) => {
    computerName = name.trim().slice(0, 80) || '电脑';
    const button = q('#hm-computer-picker');
    const label = button?.querySelector('span');
    if (label && label.textContent !== computerName) label.textContent = computerName;
    button?.setAttribute('aria-label', `切换电脑，当前${computerName}`);
  };
  const installComputerPicker = (sidebar: HTMLElement | null) => {
    if (!nativeToolbar || !sidebar || sidebar.querySelector('#hm-computer-picker')) return;
    const panels = sidebar.querySelector('[class*="_panelList"]');
    if (!panels?.parentElement) return;
    const button = document.createElement('button');
    button.id = 'hm-computer-picker';
    button.type = 'button';
    button.innerHTML = `${icon('computer')}<span></span>${icon('down')}`;
    button.onclick = () => {
      record('connection.picker-open');
      cancelSpeech();
      setDrawer(false);
      post({ type: 'computer-picker' });
    };
    panels.before(button);
    setComputerName(computerName);
  };
  const installUserSettingsButton = (sidebar: HTMLElement | null) => {
    const accountSlot = sidebar?.querySelector<HTMLElement>('[data-slot="settings.launcher"]');
    const accountTrigger = accountSlot?.matches('button[aria-haspopup="menu"]')
      ? accountSlot as HTMLButtonElement
      : accountSlot?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    const accountRow = accountTrigger === accountSlot ? accountTrigger?.parentElement : accountSlot;
    if (!accountSlot || !accountTrigger || !accountRow || accountRow.querySelector('#hm-user-settings')) return;
    accountRow.dataset.hmAccountSlot = 'true';
    const button = document.createElement('button');
    button.id = 'hm-user-settings';
    button.type = 'button';
    button.setAttribute('aria-label', '设置');
    button.innerHTML = icon('settings');
    button.onclick = () => {
      setDrawer(false);
      if (nativeToolbar) post({ type: 'app-settings' });
      else openSettings();
    };
    accountRow.append(button);
  };
  const installSidebarControls = (sidebar: HTMLElement | null) => {
    if (!sidebar) return;
    const toggle = sidebar.querySelector<HTMLButtonElement>('button[class*="_toggle"]');
    const collapsed = !!toggle?.closest('[class*="_collapsed"]');
    if (drawer && mobileViewport.matches && collapsed) {
      if (!sidebarExpansionRequested) {
        sidebarExpansionRequested = true;
        toggle?.click();
      }
      return;
    }
    sidebarExpansionRequested = false;
    const panelIcons = { 插件: 'plugins', 自动化任务: 'automation', 上下文洞察: 'insights' } as const;
    for (const button of sidebar.querySelectorAll<HTMLButtonElement>('[class*="_panelList"] button')) {
      const name = button.getAttribute('aria-label') as keyof typeof panelIcons;
      const glyph = button.querySelector<HTMLElement>('[class*="_panelGlyph"]');
      if (glyph && panelIcons[name] && !glyph.querySelector('[data-hm-lucide]')) {
        glyph.dataset.hmCommandIcon = '';
        glyph.insertAdjacentHTML('beforeend', `<span data-hm-lucide>${icon(panelIcons[name])}</span>`);
      }
    }
    const header = sidebar.querySelector<HTMLElement>('[class*="_sectionHeader"]');
    const label = header?.querySelector<HTMLElement>('[class*="_sectionLabel"]');
    if (label && label.textContent !== '最近') {
      if (!label.dataset.hmOriginalLabel) label.dataset.hmOriginalLabel = label.textContent ?? '工作区';
      label.textContent = '最近';
    }
    const options = header?.querySelector<HTMLButtonElement>('button[aria-label="视图选项"]');
    if (options && !options.querySelector('[data-hm-lucide]')) {
      options.dataset.hmCommandIcon = '';
      options.insertAdjacentHTML('beforeend', `<span data-hm-lucide>${icon('options')}</span>`);
    }
    const menu = q('[role="menu"][class*="_viewOptionsMenu"]');
    if (menu && mobileViewport.matches) {
      menu.dataset.hmSessionOptions = '';
      const aliases: Record<string, string> = { 按工作区: '按项目分组', 单列表: '不分组', 最近更新: '最近活跃' };
      for (const item of menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
        const itemLabel = item.querySelector<HTMLElement>('[class*="_itemLabel"]');
        if (!itemLabel) continue;
        const original = itemLabel.dataset.hmOriginalLabel || itemLabel.textContent?.trim() || '';
        if (aliases[original]) {
          itemLabel.dataset.hmOriginalLabel = original;
          if (itemLabel.textContent !== aliases[original]) itemLabel.textContent = aliases[original];
        } else {
          item.parentElement?.setAttribute('data-hm-view-extra', '');
        }
      }
      for (const caption of menu.querySelectorAll<HTMLElement>('[role="presentation"] > [role="presentation"], [role="separator"]')) {
        if (caption.getAttribute('role') === 'separator' || caption.textContent === '筛选会话') {
          caption.setAttribute('data-hm-view-extra', '');
        }
      }
    }
    // Apply the first mobile view through Harness controls so its own store,
    // ordering and virtualization remain the source of truth.
    if (!drawer || !mobileViewport.matches || !sidebarDefaults.length) return;
    root.setAttribute('data-hm-sidebar-initializing', '');
    if (!menu) {
      if (!sidebarDefaultMenuRequested && options) {
        sidebarDefaultMenuRequested = true;
        options.click();
      }
      return;
    }
    const desired = sidebarDefaults[0];
    const item = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((button) => {
        const itemLabel = button.querySelector<HTMLElement>('[class*="_itemLabel"]');
        return (itemLabel?.dataset.hmOriginalLabel || itemLabel?.textContent?.trim()) === desired;
      });
    if (!item) {
      sidebarDefaults = [];
      sidebarDefaultMenuRequested = false;
      root.removeAttribute('data-hm-sidebar-initializing');
      return;
    }
    sidebarDefaults.shift();
    sidebarDefaultMenuRequested = false;
    item.click();
    if (!sidebarDefaults.length) {
      root.removeAttribute('data-hm-sidebar-initializing');
      try { localStorage.setItem(sidebarDefaultsKey, '1'); } catch { /* Keep this visit's selection. */ }
    }
  };
  const openSettings = () => {
    record('settings.open');
    cancelSpeech();
    setViewsOpen(false);
    setDrawer(false);
    setTools(false);
    if (q('[data-shortcut-modal="settings"]')) return;
    settingsRequested = true;
    const account = q('[data-slot="settings.launcher"] button[aria-haspopup="menu"], button[aria-label="Account menu"], button[aria-label="账户菜单"]');
    if (account?.getAttribute('aria-expanded') !== 'true') account?.click();
    schedule();
  };
  const updateViewport = () => {
    viewportRaf = 0;
    const nativeViewport = !!w.ReactNativeWebView;
    const height = Math.round(nativeViewport ? innerHeight : window.visualViewport?.height ?? innerHeight);
    highestHeight = Math.max(highestHeight, innerHeight);
    if (height !== viewportHeight) {
      viewportHeight = height;
      // The native container already resizes with the keyboard. A second
      // visualViewport height would shrink the WebView's content again.
      if (nativeViewport) root.style.removeProperty('--hm-height');
      else root.style.setProperty('--hm-height', `${height}px`);
    }
    const keyboard = highestHeight - height > 140
      && !!document.activeElement?.matches('input,textarea,[contenteditable="true"]');
    if (root.hasAttribute('data-hm-keyboard') !== keyboard) root.toggleAttribute('data-hm-keyboard', keyboard);
  };
  const prepare = () => {
    const started = performance.now();
    const records = mutationRecords;
    mutationRecords = 0;
    raf = 0;
    if (!document.body) return;
    if (root.getAttribute('data-harness-mobile') !== config.version) root.setAttribute('data-harness-mobile', config.version);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.append(meta);
    }
    const viewport = 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content';
    if (meta.content !== viewport) meta.content = viewport;
    if (!q('#harness-mobile-styles')) {
      const style = document.createElement('style');
      style.id = 'harness-mobile-styles';
      style.textContent = config.css;
      document.head.append(style);
    }
    const frame = q('[data-hm-frame]') ?? mark(q('[class*="_frame"]:has(> [class*="_sidebarCol"])'), 'data-hm-frame');
    const sidebar = mark(q('[data-hm-frame] > [class*="_sidebarCol"]'), 'data-hm-sidebar');
    const sidebarRoot = sidebar?.querySelector<HTMLElement>('[data-slot="sidebar"] > [class*="_root"]');
    if (sidebarRoot) sidebarRoot.dataset.hmNativeActions = 'true';
    if (sidebarRoot !== observedSidebarRoot) {
      sidebarObserver.disconnect();
      observedSidebarRoot = sidebarRoot ?? null;
      if (observedSidebarRoot) sidebarObserver.observe(observedSidebarRoot, { attributes: true, attributeFilter: ['class'] });
    }
    installUserSettingsButton(sidebar);
    installComputerPicker(sidebar);
    installSidebarControls(sidebar);
    installComposerControls();
    const editor = q('[data-composer-input]');
    if (editor !== observedEditor) {
      editorObserver.disconnect();
      observedEditor = editor;
      if (editor) editorObserver.observe(editor, { childList: true, subtree: true, characterData: true });
      updateDraft();
    }
    const header = q('[data-slot="conversation.session.header"], [data-conversation-header-leading]');
    if (header !== observedHeader) {
      headerObserver.disconnect();
      observedHeader = header;
      if (header) headerObserver.observe(header, { characterData: true, subtree: true });
    }
    mark(q('[data-hm-frame] > [class*="_centerCol"]'), 'data-hm-center');
    const rightbar = mark(q('[data-hm-frame] > [data-rightbar-col]'), 'data-hm-rightbar');
    toolsAvailable = !!q('[data-conversation-content]') && !!rightbar
      && !!q('[data-sidebar-right-expand], [data-sidebar-right-collapse], [data-sidebar-right-panel], [data-sidebar-right-guide]');
    if (lastToolsAvailable !== toolsAvailable) {
      lastToolsAvailable = toolsAvailable;
      if (!toolsAvailable) setTools(false);
      post({ type: 'tools-available', available: toolsAvailable });
      const trigger = q('#hm-toolbar-tools');
      if (trigger) trigger.hidden = !toolsAvailable;
      record('tools.availability', { available: toolsAvailable });
    }
    if (rightbar) {
      const hidden = mobileViewport.matches && !tools;
      if (rightbar.inert !== hidden) rightbar.inert = hidden;
      if (rightbar.getAttribute('aria-hidden') !== String(hidden)) rightbar.setAttribute('aria-hidden', String(hidden));
      for (const strip of rightbar.querySelectorAll<HTMLElement>('[data-dockkit-strip]')) {
        const header = mark(strip.parentElement, 'data-hm-tools-header');
        const pane = strip.closest('[data-dockkit-pane]');
        const guideOnly = strip.querySelectorAll('[role="tab"]').length === 1
          && !!pane?.querySelector('[data-sidebar-right-guide]');
        if (header && header.dataset.hmToolsGuide !== String(guideOnly)) header.dataset.hmToolsGuide = String(guideOnly);
      }
    }
    requestToolsContent();
    if (!usageRow?.isConnected) {
      const meter = q('[data-composer-seat] .y0jqnG_root');
      usageRow = meter?.parentElement ?? null;
      if (usageRow) mark(usageRow, 'data-hm-usage-row');
    }
    const conversation = q('[data-conversation-content]');
    if (conversation && !conversation.querySelector('#hm-welcome')) {
      const fish = q('[data-slot="conversation.hero.brand.mark"] svg, [data-slot="sidebar.brand.mark"] svg');
      if (fish) {
        const welcome = document.createElement('div');
        welcome.id = 'hm-welcome';
        welcome.append(fish.cloneNode(true));
        const greeting = document.createElement('p');
        greeting.textContent = '你好，有什么我能帮你的吗？';
        welcome.append(greeting);
        conversation.append(welcome);
      }
    }
    if (sidebar && !sidebar.querySelector('#hm-drawer-search')) {
      const search = document.createElement('button');
      search.id = 'hm-drawer-search';
      search.setAttribute('aria-label', '搜索对话');
      search.innerHTML = `${icon('search')}<span>搜索对话...</span>`;
      search.onclick = () => sidebar.querySelector<HTMLButtonElement>(
        'button[class*="_searchButton"], button[aria-label="Search sessions"], button[aria-label="搜索会话"]',
      )?.click();
      sidebar.append(search);
    }
    if (sidebar) {
      const hidden = mobileViewport.matches && !drawer;
      if (sidebar.dataset.hmOpen !== String(drawer)) sidebar.dataset.hmOpen = String(drawer);
      if (sidebar.inert !== hidden) sidebar.inert = hidden;
      if (sidebar.getAttribute('aria-hidden') !== String(hidden)) sidebar.setAttribute('aria-hidden', String(hidden));
    }
    if (!q('#hm-scrim')) {
      const scrim = document.createElement('button');
      scrim.id = 'hm-scrim';
      scrim.tabIndex = -1;
      scrim.onclick = () => { setDrawer(false); setTools(false); };
      document.body.append(scrim);
      updateScrim();
    }
    if (sidebar && !sidebar.querySelector('#hm-drawer-actions')) {
      const actions = document.createElement('div');
      actions.id = 'hm-drawer-actions';
      actions.innerHTML = `<button id="hm-drawer-new" aria-label="新建会话">${icon('plus')}<span>新建会话</span></button>`;
      actions.querySelector<HTMLButtonElement>('#hm-drawer-new')!.onclick = newSession;
      sidebar.append(actions);
    }
    if (!nativeToolbar && !q('#hm-toolbar')) {
      root.setAttribute('data-hm-web-toolbar', '');
      const toolbar = document.createElement('div');
      toolbar.id = 'hm-toolbar';
      toolbar.innerHTML = `<button id="hm-toolbar-menu" aria-label="打开会话列表" aria-expanded="false">${icon('menu')}</button><button id="hm-toolbar-views" aria-label="切换视图" aria-haspopup="menu" aria-expanded="false" aria-controls="hm-view-options"><strong></strong>${icon('down')}</button><button id="hm-toolbar-tools" aria-label="打开工作面板" aria-expanded="false">${icon('panel')}</button>`;
      document.body.prepend(toolbar);
      q('#hm-toolbar-menu')!.onclick = () => setDrawer(!drawer);
      q('#hm-toolbar-tools')!.onclick = () => setTools(!tools);
      q('#hm-toolbar-views')!.onclick = () => setViewsOpen(!viewsOpen);
      const menu = document.createElement('div');
      menu.id = 'hm-view-menu';
      menu.innerHTML = '<button id="hm-view-backdrop" aria-label="关闭视图菜单"></button><div id="hm-view-options" role="menu"></div>';
      document.body.append(menu);
      q('#hm-view-backdrop')!.onclick = () => setViewsOpen(false);
    }
    updateConversationViews();
    if (settingsRequested) {
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((element) => /^(Settings|设置)/i.test(element.textContent?.trim() ?? ''));
      if (item) {
        item.removeAttribute('data-hm-account-settings');
        settingsRequested = false;
        item.click();
      }
    } else {
      const accountOpen = q('[data-slot="settings.launcher"] button[aria-haspopup="menu"][aria-expanded="true"]')
        || q('button[aria-label="Account menu"][aria-expanded="true"], button[aria-label="账户菜单"][aria-expanded="true"]');
      if (nativeToolbar && accountOpen) {
        const settingsItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find((element) => /^(Settings|设置)/i.test(element.textContent?.trim() ?? ''));
        if (settingsItem) mark(settingsItem, 'data-hm-account-settings');
      }
    }
    let settingsCategories: { index: number; label: string }[] = [];
    for (const dialog of document.querySelectorAll<HTMLElement>('[data-shortcut-modal="settings"]')) {
      const nav = dialog.querySelector<HTMLElement>('nav');
      if (nav) {
        if (drawer) setDrawer(false);
        if (tools) setTools(false);
        mark(dialog, 'data-hm-settings');
        mark(nav, 'data-hm-settings-nav');
        settingsCategories = [...nav.querySelectorAll<HTMLButtonElement>('button')]
          .map((button, index) => ({
            index,
            label: (button.getAttribute('aria-label') || button.textContent || '').replace(/\s+/g, ' ').trim(),
          }))
          .filter((category) => category.label.length > 0);
        const body = mark(dialog.querySelector<HTMLElement>('[class*="_content"]'), 'data-hm-settings-body');
        const general = mark(body?.querySelector<HTMLElement>('[class*="_section"]:has([data-slot="settings.general.item"])') ?? null, 'data-hm-general');
        const rows = general?.querySelector('[data-slot="settings.general.item"]')?.children;
        if (rows) for (const row of rows) mark(row as HTMLElement, 'data-hm-setting-row');
        if (!dialog.querySelector('#hm-settings-heading')) {
          dialog.dataset.hmSettingsView = 'home';
          const heading = document.createElement('h2');
          heading.id = 'hm-settings-heading';
          heading.textContent = '设置';
          dialog.prepend(heading);
          const back = document.createElement('button');
          back.id = 'hm-settings-back';
          back.setAttribute('aria-label', '返回设置');
          back.innerHTML = icon('back');
          back.onclick = () => {
            dialog.dataset.hmSettingsView = 'home';
            heading.textContent = '设置';
            nav.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
          };
          dialog.prepend(back);
        }
        if (dialog.dataset.hmSettingsView === 'detail') {
          const heading = dialog.querySelector('#hm-settings-heading');
          const label = nav.querySelector('[aria-current="true"]')?.textContent?.trim();
          if (heading && label && heading.textContent !== label) heading.textContent = label;
        }
      }
    }
    const settingsSignature = JSON.stringify(settingsCategories);
    if (settingsSignature !== lastSettingsCategories) {
      lastSettingsCategories = settingsSignature;
      post({ type: 'settings-categories', categories: settingsCategories });
    }
    const theme = document.body.hasAttribute('data-ds-dark-theme')
      || root.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
    if (theme !== lastTheme) {
      lastTheme = theme; root.dataset.hmTheme = theme; post({ type: 'theme', theme });
    }
    const title = q('[data-slot="conversation.session.header"] [class*="_crumbCurrent"]')?.textContent?.trim()
      || q('[data-slot="conversation.session.header"] h1, [data-slot="conversation.session.header"] [aria-level="1"]')?.textContent?.trim()
      || q('[data-conversation-header-leading] [class*="_title"]')?.textContent?.trim()
      || 'DeepSeek Harness';
    if (title !== lastTitle) {
      lastTitle = title;
      const heading = q('#hm-toolbar strong');
      if (heading) heading.textContent = title === 'DeepSeek Harness' ? 'dudu' : title;
      post({ type: 'title', title });
    }
    updateBackState();
    const ready = !!frame;
    if (ready && !lastReady) {
      lastReady = true;
      post({ type: 'ready', version: config.version });
      post({ type: 'speech-overlay', phase: speechOverlayPhase });
      post({ type: 'drawer', open: drawer });
      post({ type: 'tools', open: tools });
    }
    record('adapter.prepare', { durationMs: Math.round((performance.now() - started) * 100) / 100, mutations: records });
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(prepare); };
  const observer = new MutationObserver((records) => {
    const started = performance.now();
    mutationRecords += records.length;
    const changed = records.some((record) => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (record.type === 'attributes') {
        if (record.attributeName === 'aria-current'
          && element?.closest('[data-hm-sidebar] [role="tree"]')) return false;
        return record.attributeName !== 'aria-selected'
          || !!element?.closest('[data-slot="conversation.header"]');
      }
      if (element?.closest('[data-conversation-header-leading], [data-slot="conversation.session.header"]')) return true;
      if (record.type === 'characterData') return false;
      if (element?.closest('[data-composer-overlay]')) return true;
      // Streaming text, chat rows and typing do not change the mobile shell.
      // Keep observing their ancestors so replacing a conversation still adapts it.
      return !element?.closest('[data-conversation-scroll], [data-composer-card], [data-hm-sidebar] [role="tree"], #hm-welcome, #hm-toolbar, #hm-speech-overlay');
    });
    if (changed) schedule();
    const durationMs = performance.now() - started;
    if (durationMs > 4 || records.length > 100) {
      record('adapter.mutations', { records: records.length, durationMs, scheduled: changed }, durationMs > 16 ? 'warn' : 'debug');
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-ds-dark-theme', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen', 'data-sidebar-right-open', 'data-content-phase', 'aria-current', 'aria-selected'] });
  let sessionHold: {
    row: HTMLElement; key: string; pointerId: number; x: number; y: number;
    started: number; timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let heldSession: HTMLElement | null = null;
  let heldSessionKey: string | null = null;
  let heldPointerId: number | null = null;
  let heldActivation: 'tap' | 'menu' | null = null;
  let suppressSessionClickUntil = 0;
  const sessionIdentity = (key: string) => {
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16);
  };
  const currentSessionRow = (row: HTMLElement, key: string) => row.isConnected && row.getAttribute('data-row-key') === key ? row
    : document.querySelector<HTMLElement>(`[data-hm-sidebar] [data-row-key=${JSON.stringify(key)}]`);
  const cancelSessionHold = () => {
    if (sessionHold) clearTimeout(sessionHold.timer);
    sessionHold = null;
  };
  const cancelSessionPointer = () => {
    cancelSessionHold();
    heldSession = null;
    heldSessionKey = null;
    heldPointerId = null;
    heldActivation = null;
    suppressSessionClickUntil = 0;
  };
  const showSessionMenu = (row: HTMLElement) => {
    const button = row.querySelector<HTMLButtonElement>('[class*="_rowActions"] button');
    if (!button) return;
    record('sidebar.session-menu');
    button.click();
  };
  const sessionDown = (event: PointerEvent) => {
    cancelSessionPointer();
    if (!mobileViewport.matches || !drawer || !event.isPrimary || event.pointerType !== 'touch' || !(event.target instanceof Element)
      || event.target.closest('button,a,input')) return;
    const row = event.target.closest<HTMLElement>('[data-hm-sidebar] [data-row-key^="session:"]')
      ?? document.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-hm-sidebar] [data-row-key^="session:"]');
    if (!row) return;
    const key = row.getAttribute('data-row-key');
    if (!key) return;
    record('sidebar.touch-begin', { pointerType: event.pointerType, session: sessionIdentity(key) });
    sessionHold = {
      row, key, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now(),
      timer: setTimeout(() => {
        if (sessionHold?.row !== row) return;
        const current = currentSessionRow(row, key);
        if (!current) { cancelSessionHold(); record('sidebar.hold-cancelled', { reason: 'row-removed' }); return; }
        heldSession = current;
        heldSessionKey = key;
        heldPointerId = event.pointerId;
        heldActivation = 'menu';
        suppressSessionClickUntil = Infinity;
        cancelSessionHold();
        showSessionMenu(current);
      }, 500),
    };
  };
  const sessionMove = (event: PointerEvent) => {
    if (sessionHold && event.pointerId === sessionHold.pointerId
      && Math.hypot(event.clientX - sessionHold.x, event.clientY - sessionHold.y) > 10) cancelSessionHold();
  };
  const sessionUp = (event: PointerEvent) => {
    const tap = sessionHold;
    cancelSessionHold();
    if (heldSession) {
      if (event.pointerId === heldPointerId) suppressSessionClickUntil = performance.now() + 600;
      return;
    }
    if (!tap || event.pointerId !== tap.pointerId || !drawer || event.defaultPrevented) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-hm-sidebar] [data-row-key^="session:"]');
    const current = currentSessionRow(tap.row, tap.key);
    if (!current || target?.getAttribute('data-row-key') !== tap.key) return;
    heldSession = current;
    heldSessionKey = tap.key;
    heldPointerId = tap.pointerId;
    heldActivation = 'tap';
    suppressSessionClickUntil = performance.now() + 600;
    const started = performance.now();
    const session = sessionIdentity(tap.key);
    record('sidebar.session-select', { session, activation: 'touch', heldMs: started - tap.started });
    // WebKit can consume the compatibility click after desktop hover changes.
    // Open on touch release, then consume that gesture's later click once.
    current.click();
    setDrawer(false);
    requestAnimationFrame(() => record('sidebar.session-select-frame', {
      session, selected: currentSessionRow(current, tap.key)?.getAttribute('aria-selected') === 'true',
      delayMs: performance.now() - started,
    }));
  };
  const sessionClick = (event: MouseEvent) => {
    const pointerMatches = !('pointerType' in event)
      || (event.pointerType === 'touch' && 'pointerId' in event && event.pointerId === heldPointerId);
    if (event.isTrusted && event.detail > 0 && pointerMatches && heldSession
      && performance.now() < suppressSessionClickUntil) {
      const target = event.target instanceof Element ? event.target : null;
      const rowKey = target?.closest('[data-row-key^="session:"]')?.getAttribute('data-row-key');
      const activation = heldActivation;
      const isHeldTarget = activation === 'tap' || rowKey === heldSessionKey || !!target?.closest('[role="menu"]');
      cancelSessionPointer();
      if (!isHeldTarget) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      record(activation === 'tap' ? 'sidebar.tap-release-click-suppressed' : 'sidebar.hold-release-click-suppressed');
    }
  };
  const sessionHover = (event: PointerEvent) => {
    if (mobileViewport.matches && event.pointerType === 'touch' && event.target instanceof Element
      && event.target.closest('[data-hm-sidebar] [role="tree"]')) event.stopPropagation();
  };
  const sessionContext = (event: MouseEvent) => {
    if (!mobileViewport.matches || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[data-hm-sidebar] [data-row-key^="session:"]');
    if (!row) return;
    event.preventDefault();
    cancelSessionHold();
    if (row !== heldSession || performance.now() >= suppressSessionClickUntil) showSessionMenu(row);
  };
  document.addEventListener('pointerdown', sessionDown, { passive: true, capture: true });
  document.addEventListener('pointerover', sessionHover, { passive: true, capture: true });
  document.addEventListener('pointerout', sessionHover, { passive: true, capture: true });
  document.addEventListener('pointermove', sessionMove, { passive: true });
  document.addEventListener('pointerup', sessionUp, { passive: true });
  document.addEventListener('pointercancel', cancelSessionPointer, { passive: true });
  document.addEventListener('click', sessionClick, true);
  document.addEventListener('contextmenu', sessionContext);
  const click = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    if (target.closest('[data-composer-card] button[aria-haspopup="listbox"]')) {
      cancelSpeech();
      restorePhotoAccept();
      schedule();
    }
    const settingsButton = target.closest<HTMLButtonElement>('[data-hm-settings-nav] button');
    const settingsDialog = settingsButton?.closest<HTMLElement>('[data-hm-settings]');
    if (settingsButton && settingsDialog && mobileViewport.matches) {
      settingsDialog.dataset.hmSettingsView = 'detail';
      const heading = settingsDialog.querySelector('#hm-settings-heading');
      if (heading) heading.textContent = settingsButton.textContent?.trim() || '设置';
      settingsDialog.querySelector<HTMLButtonElement>('#hm-settings-back')?.focus();
      updateBackState();
    }
    if (drawer && target.closest('[data-hm-sidebar]')
      && target.closest('[data-row-key^="session:"], [role="treeitem"][aria-selected], a[href], button[class*="_newSession"], [class*="_panelList"] button')) {
      setTimeout(() => setDrawer(false), 0);
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (nativeToolbar && anchor?.href && /^https?:/.test(anchor.href)
      && new URL(anchor.href).origin !== location.origin) {
      event.preventDefault();
      post({ type: 'external-link', url: anchor.href });
    }
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && q('[role="menu"]')) return;
    if (event.key === 'Escape' && viewsOpen) { event.preventDefault(); setViewsOpen(false); }
    else if (event.key === 'Escape' && drawer) { event.preventDefault(); setDrawer(false); }
    else if (event.key === 'Escape' && tools) { event.preventDefault(); setTools(false); }
  };
  const message = (event: MessageEvent) => {
    if (window.parent === window || event.source !== window.parent
      || event.data?.source !== 'harness-mobile-shell' || event.origin === 'null') return;
    // The pairing redirect deliberately removes the referrer. Establish the
    // embedding origin through a handshake before accepting shell actions.
    if (event.data.action === 'connect' && (!parentOrigin || parentOrigin === event.origin)) {
      parentOrigin = event.origin;
      if (lastReady) post({ type: 'ready', version: config.version });
      if (lastTheme) post({ type: 'theme', theme: lastTheme });
      if (lastTitle) post({ type: 'title', title: lastTitle });
      post({ type: 'conversation-views', views: conversationViews });
      post({ type: 'drawer', open: drawer });
      post({ type: 'tools', open: tools });
      post({ type: 'tools-available', available: toolsAvailable });
      updateBackState();
      return;
    }
    if (event.origin !== parentOrigin) return;
    if (event.data.action === 'toggleSidebar') setDrawer(!drawer);
    else if (event.data.action === 'closeSidebar') setDrawer(false);
    else if (event.data.action === 'toggleTools') setTools(!tools);
    else if (event.data.action === 'closeTools') setTools(false);
    else if (event.data.action === 'selectConversationView' && typeof event.data.id === 'string') selectConversationView(event.data.id);
    else if (event.data.action === 'updateSpeechInput' && typeof event.data.update?.id === 'number') updateSpeechInput(event.data.update);
    else if (event.data.action === 'newSession') newSession();
    else if (event.data.action === 'openSettings') openSettings();
    else if (event.data.action === 'selectSettingsCategory' && typeof event.data.index === 'number') selectSettingsCategory(event.data.index);
    else if (event.data.action === 'closeSettings') closeSettings();
    else if (event.data.action === 'setComputerName' && typeof event.data.name === 'string') setComputerName(event.data.name);
    else if (event.data.action === 'back') w.__HARNESS_MOBILE__?.back();
  };
  document.addEventListener('click', click);
  const input = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('[data-composer-input]')) {
      updateDraft();
      record('composer.input', { chars: event.target.textContent?.length ?? 0 });
    }
  };
  const visibility = () => { if (document.hidden) cancelSpeech(); };
  document.addEventListener('input', input);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('keydown', key);
  const resize = () => { if (!viewportRaf) viewportRaf = requestAnimationFrame(updateViewport); };
  const mediaChange = () => { resize(); updateScrim(); schedule(); };
  window.addEventListener('resize', resize);
  if (!w.ReactNativeWebView) window.visualViewport?.addEventListener('resize', resize);
  mobileViewport.addEventListener('change', mediaChange);
  document.addEventListener('focusin', resize);
  document.addEventListener('focusout', resize);
  window.addEventListener('message', message);
  cleanup.push(
    () => observer.disconnect(),
    () => editorObserver.disconnect(),
    () => headerObserver.disconnect(),
    () => sidebarObserver.disconnect(),
    () => {
      cancelSessionPointer();
      document.removeEventListener('pointerdown', sessionDown, true);
      document.removeEventListener('pointerover', sessionHover, true);
      document.removeEventListener('pointerout', sessionHover, true);
      document.removeEventListener('pointermove', sessionMove);
      document.removeEventListener('pointerup', sessionUp);
      document.removeEventListener('pointercancel', cancelSessionPointer);
      document.removeEventListener('click', sessionClick, true);
      document.removeEventListener('contextmenu', sessionContext);
    },
    () => document.removeEventListener('click', click),
    () => document.removeEventListener('input', input),
    () => document.removeEventListener('visibilitychange', visibility),
    () => document.removeEventListener('keydown', key),
    () => window.removeEventListener('resize', resize),
    () => window.visualViewport?.removeEventListener('resize', resize),
    () => mobileViewport.removeEventListener('change', mediaChange),
    () => document.removeEventListener('focusin', resize),
    () => document.removeEventListener('focusout', resize),
    () => window.removeEventListener('message', message),
  );
  w.__HARNESS_MOBILE__ = {
    version: config.version, nativeToolbar, toggleSidebar: () => setDrawer(!drawer),
    closeSidebar: () => setDrawer(false), toggleTools: () => setTools(!tools), closeTools: () => setTools(false),
    selectConversationView, updateSpeechInput, newSession, openSettings, selectSettingsCategory, closeSettings, setComputerName,
    back: () => {
      if (viewsOpen) { setViewsOpen(false); return true; }
      if (drawer) { setDrawer(false); return true; }
      if (tools) { setTools(false); return true; }
      const settings = q('[data-hm-settings]');
      if (settings) {
        if (settings.dataset.hmSettingsView === 'detail') {
          settings.dataset.hmSettingsView = 'home';
          const heading = settings.querySelector('#hm-settings-heading');
          if (heading) heading.textContent = '设置';
          settings.querySelector<HTMLElement>('[data-hm-settings-nav] [aria-current="true"]')?.focus();
          return true;
        }
        const close = settings.querySelector<HTMLButtonElement>('[class*="_close"], [aria-label="Close"], [aria-label="关闭"]');
        if (close) { close.click(); return true; }
      }
      return false;
    },
    destroy: () => {
      cleanup.forEach((fn) => fn());
      cancelAnimationFrame(raf);
      cancelAnimationFrame(viewportRaf);
      cancelSpeech();
      restorePhotoAccept();
      q('#harness-mobile-styles')?.remove();
      q('#hm-toolbar')?.remove();
      q('#hm-view-menu')?.remove();
      q('#hm-composer-photos')?.remove();
      q('#hm-keyboard-toggle')?.remove();
      q('#hm-voice-input')?.remove();
      q('#hm-speech-feedback')?.remove();
      q('#hm-speech-overlay')?.remove();
      document.querySelectorAll('[data-hm-add-icon], [data-hm-lucide]').forEach((glyph) => glyph.remove());
      document.querySelectorAll('[data-hm-command-icon]').forEach((glyph) => glyph.removeAttribute('data-hm-command-icon'));
      q('[data-composer-input]')?.removeAttribute('inputmode');
      q('#hm-scrim')?.remove();
      q('#hm-drawer-close')?.remove();
      q('#hm-drawer-search')?.remove();
      q('#hm-drawer-actions')?.remove();
      q('[data-hm-native-actions]')?.removeAttribute('data-hm-native-actions');
      root.removeAttribute('data-hm-sidebar-initializing');
      document.querySelectorAll<HTMLElement>('[data-hm-original-label]').forEach((label) => {
        label.textContent = label.dataset.hmOriginalLabel ?? label.textContent;
        label.removeAttribute('data-hm-original-label');
      });
      document.querySelectorAll('[data-hm-view-extra], [data-hm-session-options]').forEach((element) => {
        element.removeAttribute('data-hm-view-extra');
        element.removeAttribute('data-hm-session-options');
      });
      q('#hm-user-settings')?.remove();
      q('#hm-computer-picker')?.remove();
      q('[data-hm-account-slot]')?.removeAttribute('data-hm-account-slot');
      document.querySelectorAll('[data-hm-account-settings]').forEach((item) => item.removeAttribute('data-hm-account-settings'));
      q('#hm-welcome')?.remove();
      q('#hm-settings-heading')?.remove();
      q('#hm-settings-back')?.remove();
      root.removeAttribute('data-harness-mobile');
      root.removeAttribute('data-hm-web-toolbar');
      root.removeAttribute('data-hm-drawer');
      root.removeAttribute('data-hm-tools');
      root.removeAttribute('data-hm-theme');
      root.removeAttribute('data-hm-input-mode');
      root.removeAttribute('data-hm-draft');
      root.style.removeProperty('--hm-height');
      q('[data-hm-sidebar]')?.removeAttribute('inert');
      q('[data-hm-sidebar]')?.removeAttribute('aria-hidden');
      q('[data-hm-sidebar]')?.removeAttribute('data-hm-open');
      q('[data-hm-center]')?.removeAttribute('inert');
      q('[data-hm-center]')?.removeAttribute('aria-hidden');
      q('[data-hm-rightbar]')?.removeAttribute('inert');
      q('[data-hm-rightbar]')?.removeAttribute('aria-hidden');
      q('[data-hm-rightbar]')?.removeAttribute('data-hm-rightbar');
      document.querySelectorAll('[data-hm-tools-header]').forEach((header) => {
        header.removeAttribute('data-hm-tools-header');
        header.removeAttribute('data-hm-tools-guide');
      });
      delete w.__HARNESS_MOBILE__;
    },
  };
  updateViewport();
  prepare();
}

export function createMobileAdapterScript(options: AdapterOptions = {}): string {
  return `;(${installMobileAdapter.toString()})(${JSON.stringify({
    css: MOBILE_CSS,
    icons: MOBILE_ICONS,
    version: MOBILE_ADAPTER_VERSION,
    nativeToolbar: options.nativeToolbar ?? true,
  })},${installBrowserDiagnostics.toString()});true;`;
}
