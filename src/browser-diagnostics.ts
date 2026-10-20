export type BrowserDiagnostic = {
  time: string;
  elapsedMs: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  data?: unknown;
};

// This function is serialized into the WebView. Keep all of its dependencies inside it.
export function installBrowserDiagnostics(
  post: (message: object) => void,
): { record(event: string, data?: unknown, level?: BrowserDiagnostic['level']): void; destroy(): void } {
  const w = window as typeof window & {
    __DSBOT_ACTIVE_SOCKETS__?: Set<WebSocket>;
    __DSBOT_DIAGNOSTICS__?: {
      record(event: string, data?: unknown, level?: BrowserDiagnostic['level']): void;
      snapshot(): BrowserDiagnostic[];
      flush(): void;
    };
  };
  const cleanup: (() => void)[] = [];
  const recent: BrowserDiagnostic[] = [];
  let pending: { entry: BrowserDiagnostic; chars: number }[] = [];
  let pendingChars = 0;
  let dropped = 0;
  let sequence = 0;
  let interaction = 0;
  let active = true;
  const started = performance.now();
  const path = (value: string) => {
    try {
      const url = new URL(value, location.href);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return url.protocol;
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch { return '[invalid-url]'; }
  };
  const scrub = (value: unknown, depth = 0, budget = { seen: new WeakSet<object>(), nodes: 96, chars: 2048 }): unknown => {
    if (--budget.nodes < 0) return '[node-limit]';
    if (typeof value === 'string') {
      const text = value.slice(0, Math.max(0, Math.min(1600, budget.chars)));
      budget.chars -= text.length;
      return text.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => path(url))
        .replace(/\b((?:Bearer|Basic)\s+)[^\s,;]+/gi, '$1[redacted]')
        .replace(/((?:token|pair|cookie|password|authorization|api[_-]?key)\s*[:=]\s*)[^\s,;&"']+/gi, '$1[redacted]');
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (value instanceof Error) return { name: value.name, message: scrub(value.message, depth + 1, budget), stack: scrub(value.stack, depth + 1, budget) };
    if (!value || typeof value !== 'object') return typeof value === 'function' ? '[function]' : String(value).slice(0, 160);
    if (budget.seen.has(value)) return '[circular]';
    if (depth > 3) return '[depth-limit]';
    budget.seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 16).map((item) => scrub(item, depth + 1, budget));
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, 24)) {
      if (/token|password|cookie|authorization|secret|api.?key|transcript|draft|prompt|^body$|^content$/i.test(key)) {
        result[key] = '[redacted]';
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor) result[key] = scrub(descriptor.value, depth + 1, budget);
    }
    return result;
  };
  const flush = () => {
    if (!active || (!pending.length && !dropped)) return;
    const batch = pending;
    pending = [];
    pendingChars = 0;
    const lost = dropped;
    dropped = 0;
    try { post({ type: 'diagnostics', entries: batch.map(({ entry }) => entry), dropped: lost }); }
    catch {
      pending = [...batch, ...pending];
      pendingChars = pending.reduce((sum, item) => sum + item.chars, 0);
      dropped += lost;
      while (pending.length > 160 || pendingChars > 48 * 1024) {
        pendingChars -= pending.shift()!.chars;
        dropped++;
      }
    }
  };
  const record = (event: string, data?: unknown, level: BrowserDiagnostic['level'] = 'info') => {
    if (!active) return;
    try {
      const entry: BrowserDiagnostic = {
        time: new Date().toISOString(),
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        level, event, data: scrub({ interaction, ...(data && typeof data === 'object' ? data : { value: data }) }),
      };
      let chars = JSON.stringify(entry).length;
      if (chars > 4096) {
        entry.data = { interaction, truncated: true, preview: JSON.stringify(entry.data).slice(0, 1200) };
        chars = JSON.stringify(entry).length;
      }
      recent.push(entry);
      if (recent.length > 250) recent.shift();
      while (pending.length >= 160 || pendingChars + chars > 48 * 1024) {
        pendingChars -= pending.shift()!.chars;
        dropped++;
      }
      pending.push({ entry, chars });
      pendingChars += chars;
    } catch { /* Diagnostics must not change page behavior. */ }
  };
  const on = (target: EventTarget, type: string, listener: EventListener, capture = false) => {
    target.addEventListener(type, listener, { capture, passive: true });
    cleanup.push(() => target.removeEventListener(type, listener, capture));
  };
  const targetInfo = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    const control = element?.closest<HTMLElement>('button,a,input,textarea,[contenteditable="true"],[role="treeitem"],[role="tab"],[role="menuitem"],[role="option"]') ?? element;
    const session = control?.closest('[data-row-key^="session:"]');
    const key = session?.getAttribute('data-row-key') ?? '';
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
    const scope = session ? 'sidebar.session'
      : control?.closest('[data-hm-sidebar] [class*="_panelList"]') ? 'sidebar.panel'
      : control?.closest('[data-hm-sidebar]') ? 'sidebar'
      : control?.closest('[data-composer-card]') ? 'composer'
      : control?.closest('[data-hm-settings]') ? 'settings'
      : control?.closest('[data-hm-rightbar]') ? 'tools'
      : control?.closest('[data-conversation-content]') ? 'conversation' : 'page';
    return {
      scope, tag: control?.tagName, role: control?.getAttribute('role'),
      control: control?.id?.startsWith('hm-') ? control.id
        : control?.getAttribute('data-slot') ?? control?.classList.item(0),
      ...(key ? { session: (hash >>> 0).toString(16) } : {}),
      disabled: control?.getAttribute('aria-disabled') === 'true' || control?.hasAttribute('disabled'),
    };
  };
  let pointerAt = 0;
  let pointerUpAt = 0;
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) {
    on(document, type, ((event: PointerEvent | MouseEvent) => {
      const now = performance.now();
      if (type === 'pointerdown') { interaction = ++sequence; pointerAt = now; }
      if (type === 'pointerup') pointerUpAt = now;
      record(`ui.${type}`, {
        ...targetInfo(event.target), trusted: event.isTrusted,
        pointerType: 'pointerType' in event ? event.pointerType : undefined,
        x: Math.round(event.clientX), y: Math.round(event.clientY),
        dispatchDelayMs: Math.max(0, Math.round(event.timeStamp > performance.timeOrigin
          ? Date.now() - event.timeStamp : now - event.timeStamp)),
        ...(type === 'click' ? { sinceDownMs: Math.round(now - pointerAt), sinceUpMs: Math.round(now - pointerUpAt) } : {}),
      });
      if (type === 'click') {
        const id = interaction;
        requestAnimationFrame(() => {
          const firstFrameMs = performance.now() - now;
          requestAnimationFrame(() => record('ui.next-frame', {
            action: id, firstFrameMs: Math.round(firstFrameMs),
            nextFrameMs: Math.round(performance.now() - now),
          }));
        });
      }
    }) as EventListener, true);
  }
  on(document, 'click', (event) => record('ui.click-bubbled', targetInfo(event.target)));
  on(document, 'focusin', (event) => record('ui.focus', targetInfo(event.target)), true);
  on(document, 'focusout', (event) => record('ui.blur', targetInfo(event.target)), true);
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  on(document, 'scroll', (event) => {
    const target = event.target;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const element = target instanceof Element ? target : document.scrollingElement;
      record('ui.scroll-end', { ...targetInfo(target), top: element?.scrollTop, left: element?.scrollLeft });
    }, 160);
  }, true);
  cleanup.push(() => clearTimeout(scrollTimer));
  on(document, 'change', (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    record('ui.change', { ...targetInfo(event.target), inputType: input?.type, files: input?.files?.length });
  }, true);
  on(window, 'error', ((event: ErrorEvent) => {
    if (event.error || event.message) {
      record('runtime.error', { error: event.error ?? event.message, file: path(event.filename), line: event.lineno, column: event.colno }, 'error');
    } else {
      const node = event.target as HTMLScriptElement | HTMLImageElement | null;
      record('resource.error', { tag: node?.tagName, path: node?.src ? path(node.src) : undefined }, 'error');
    }
    flush();
  }) as EventListener, true);
  on(window, 'unhandledrejection', ((event: PromiseRejectionEvent) => {
    record('runtime.unhandled-rejection', { error: event.reason }, 'error');
    flush();
  }) as EventListener);
  for (const level of ['debug', 'log', 'info', 'warn', 'error'] as const) {
    const original = console[level];
    const wrapped = (...args: unknown[]) => {
      record(`console.${level}`, { args }, level === 'log' ? 'info' : level);
      original.apply(console, args);
    };
    console[level] = wrapped;
    cleanup.push(() => { if (console[level] === wrapped) console[level] = original; });
  }
  const originalFetch = window.fetch;
  const wrappedFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = path(request?.url ?? String(input));
    const method = init?.method ?? request?.method ?? 'GET';
    const id = ++sequence;
    const at = performance.now();
    record('network.request', { id, method, path: url });
    try {
      const response = await originalFetch.call(window, input instanceof URL ? input.href : input, init);
      record('network.response', { id, status: response.status, durationMs: Math.round(performance.now() - at) }, response.ok ? 'info' : 'warn');
      return response;
    } catch (error) {
      record('network.error', { id, durationMs: Math.round(performance.now() - at), error }, 'error');
      throw error;
    }
  };
  window.fetch = wrappedFetch;
  cleanup.push(() => { if (window.fetch === wrappedFetch) window.fetch = originalFetch; });
  const xhrRequests = new WeakMap<XMLHttpRequest, { id: number; method: string; path: string }>();
  const xhrOpen = XMLHttpRequest.prototype.open;
  const trackedOpen: typeof xhrOpen = function (
    this: XMLHttpRequest, method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null,
  ) {
    xhrRequests.set(this, { id: ++sequence, method, path: path(String(url)) });
    return xhrOpen.call(this, method, String(url), async, username, password);
  };
  const xhrSend = XMLHttpRequest.prototype.send;
  const trackedSend: typeof xhrSend = function (this: XMLHttpRequest, body) {
    const request = xhrRequests.get(this) ?? { id: ++sequence, method: 'unknown', path: 'unknown' };
    const at = performance.now();
    record('network.request', { ...request, transport: 'xhr' });
    this.addEventListener('loadend', () => record('network.response', {
      id: request.id, status: this.status, durationMs: Math.round(performance.now() - at), transport: 'xhr',
    }, this.status >= 200 && this.status < 400 ? 'info' : 'warn'), { once: true });
    return xhrSend.call(this, body);
  };
  XMLHttpRequest.prototype.open = trackedOpen;
  XMLHttpRequest.prototype.send = trackedSend;
  cleanup.push(() => {
    if (XMLHttpRequest.prototype.open === trackedOpen) XMLHttpRequest.prototype.open = xhrOpen;
    if (XMLHttpRequest.prototype.send === trackedSend) XMLHttpRequest.prototype.send = xhrSend;
  });
  const NativeWebSocket = window.WebSocket;
  // The relay may replace its page adapter during bootstrap. Keep live socket
  // references so the final native adapter can resume diagnostics on those sockets.
  const sockets = w.__DSBOT_ACTIVE_SOCKETS__ ??= new Set<WebSocket>();
  const socketIds = new WeakMap<WebSocket, number>();
  const size = (data: unknown) => typeof data === 'string' ? { characters: data.length }
    : { bytes: data instanceof Blob ? data.size : (data as ArrayBuffer | undefined)?.byteLength };
  const attachSocket = (socket: WebSocket) => {
    const id = ++sequence;
    socketIds.set(socket, id);
    const opened = () => record('websocket.open', { id });
    const failed = () => record('websocket.error', { id, state: socket.readyState }, 'error');
    const closed = (event: CloseEvent) => record('websocket.close', { id, code: event.code, clean: event.wasClean }, event.wasClean ? 'info' : 'warn');
    const received = (event: MessageEvent) => record('websocket.receive', { id, ...size(event.data) });
    socket.addEventListener('open', opened);
    socket.addEventListener('error', failed);
    socket.addEventListener('close', closed);
    socket.addEventListener('message', received);
    cleanup.push(() => {
      socket.removeEventListener('open', opened);
      socket.removeEventListener('error', failed);
      socket.removeEventListener('close', closed);
      socket.removeEventListener('message', received);
    });
    record('websocket.track', { id, path: path(socket.url), state: socket.readyState });
  };
  for (const socket of sockets) if (socket.readyState < NativeWebSocket.CLOSING) attachSocket(socket);
  const originalSend = NativeWebSocket.prototype.send;
  const socketSend: typeof originalSend = function (this: WebSocket, data) {
    record('websocket.send', { id: socketIds.get(this), ...size(data), state: this.readyState });
    return originalSend.call(this, data);
  };
  NativeWebSocket.prototype.send = socketSend;
  const DiagnosticWebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget) as WebSocket;
      sockets.add(socket);
      socket.addEventListener('close', () => sockets.delete(socket), { once: true });
      attachSocket(socket);
      record('websocket.connect', { id: socketIds.get(socket), path: path(socket.url) });
      return socket;
    },
  });
  window.WebSocket = DiagnosticWebSocket;
  cleanup.push(() => {
    if (window.WebSocket === DiagnosticWebSocket) window.WebSocket = NativeWebSocket;
    if (NativeWebSocket.prototype.send === socketSend) NativeWebSocket.prototype.send = originalSend;
  });
  const viewport = () => record('viewport.change', {
    width: innerWidth, height: innerHeight,
    visualHeight: window.visualViewport?.height, offsetTop: window.visualViewport?.offsetTop,
    keyboard: document.documentElement.hasAttribute('data-hm-keyboard'),
  });
  on(window, 'resize', viewport);
  if (window.visualViewport) {
    on(window.visualViewport, 'resize', viewport);
    on(window.visualViewport, 'scroll', viewport);
  }
  on(document, 'visibilitychange', () => {
    record('page.visibility', { state: document.visibilityState });
    flush();
  });
  on(window, 'pagehide', () => { record('page.hide'); flush(); });
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    const wrapped: History[typeof method] = function (...args) {
      const result = original.apply(history, args);
      record('page.navigate', { method, path: path(location.href) });
      return result;
    };
    history[method] = wrapped;
    cleanup.push(() => { if (history[method] === wrapped) history[method] = original; });
  }
  on(window, 'popstate', () => record('page.navigate', { method: 'popstate', path: path(location.href) }));
  if (typeof PerformanceObserver !== 'undefined') {
    for (const type of ['longtask', 'event', 'long-animation-frame']) {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) continue;
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration < 50) continue;
            const timing = entry as PerformanceEntry & {
              processingStart?: number; processingEnd?: number; interactionId?: number;
            };
            record(`performance.${type}`, {
              name: entry.name, durationMs: Math.round(entry.duration), startMs: Math.round(entry.startTime),
              ...(typeof timing.processingStart === 'number' && typeof timing.processingEnd === 'number' ? {
                processingDelayMs: Math.round(timing.processingStart - entry.startTime),
                processingMs: Math.round(timing.processingEnd - timing.processingStart),
                presentationDelayMs: Math.max(0, Math.round(entry.startTime + entry.duration - timing.processingEnd)),
                interactionId: timing.interactionId,
              } : {}),
            }, 'warn');
          }
        });
        observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 50 } : {}) });
        cleanup.push(() => observer.disconnect());
      } catch { /* WebKit supports a smaller set of performance entry types. */ }
    }
  }
  let expected = performance.now() + 500;
  const timer = setInterval(() => {
    const now = performance.now();
    if (!document.hidden && now - expected > 100) record('performance.event-loop-lag', { delayMs: Math.round(now - expected) }, 'warn');
    expected = now + 500;
    flush();
  }, 500);
  cleanup.push(() => clearInterval(timer));
  const api = { record, snapshot: () => recent.slice(), flush };
  w.__DSBOT_DIAGNOSTICS__ = api;
  record('page.start', { path: path(location.href), userAgent: navigator.userAgent,
    supportedPerformanceEntries: typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes });
  return {
    record,
    destroy: () => {
      record('page.diagnostics-stop');
      flush();
      active = false;
      cleanup.forEach((fn) => fn());
      if (w.__DSBOT_DIAGNOSTICS__ === api) delete w.__DSBOT_DIAGNOSTICS__;
    },
  };
}
