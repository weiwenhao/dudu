const ENABLED = 'dudu:collector-notifications-enabled';

/** Ask for system permission only in response to the owner's explicit enable action. */
export async function allowCollectorNotifications({ target = window, NotificationClass = globalThis.Notification } = {}) {
  if (!NotificationClass) return false;
  const permission = NotificationClass.permission === 'default' ? await NotificationClass.requestPermission() : NotificationClass.permission;
  if (permission !== 'granted') return false;
  target.dispatchEvent(new Event(ENABLED));
  return true;
}

/** One live subscription for the plugin's lifetime, independent of its settings and dashboard. */
export function installCollectorNotifications({
  target = window, NotificationClass = globalThis.Notification, fetchFn = globalThis.fetch, baseURI = document.baseURI, onOpen,
  warn = console.warn,
} = {}) {
  if (!NotificationClass) return () => {};
  let closed = false;
  let connection = null;
  const shown = new Map();

  const show = (event) => {
    if (closed || NotificationClass.permission !== 'granted'
      || typeof event?.collector !== 'string' || typeof event.title !== 'string' || typeof event.body !== 'string') return;
    try {
      const notice = new NotificationClass(event.title, {
        body: event.body,
        tag: `dudu:collector:${event.collector}`,
      });
      shown.get(event.collector)?.close();
      shown.set(event.collector, notice);
      const forget = () => { if (shown.get(event.collector) === notice) shown.delete(event.collector); };
      notice.onclose = forget;
      notice.onerror = () => { forget(); warn('[dudu] A collector notification could not be delivered.'); };
      notice.onclick = () => { if (!closed) { target.focus?.(); onOpen?.(); } notice.close(); };
    } catch (error) { warn(`[dudu] A collector notification could not be delivered: ${error?.message ?? error}`); }
  };

  const connect = () => {
    if (closed || connection || NotificationClass.permission !== 'granted') return;
    const controller = new AbortController();
    connection = controller;
    void (async () => {
      let reader;
      try {
        const response = await fetchFn(new URL('api/dudu/inbox/notifications', baseURI).pathname, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin', signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            if (line) show(JSON.parse(line));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) warn(`[dudu] Collector notifications disconnected: ${error?.message ?? error}`);
      } finally {
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
        if (connection === controller) connection = null;
      }
    })();
  };
  target.addEventListener(ENABLED, connect);
  target.addEventListener('online', connect);
  target.addEventListener('focus', connect);
  connect();
  return () => {
    closed = true;
    connection?.abort();
    target.removeEventListener(ENABLED, connect);
    target.removeEventListener('online', connect);
    target.removeEventListener('focus', connect);
    for (const notice of shown.values()) notice.close();
    shown.clear();
  };
}
