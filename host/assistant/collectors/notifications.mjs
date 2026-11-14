import { cleanText } from '../inbox/records.mjs';

/** Live results only: no persisted notification queue and no replay when an inbox or window opens. */
export function createCollectorNotifications() {
  const listeners = new Set();
  const subscribers = new Set();
  const encoder = new TextEncoder();
  let closed = false;

  return {
    publish(collector, records) {
      if (closed || collector.notify !== true || !records.length) return;
      // Ingestion can both add messages and update their row in one run; show only the final version of each row.
      const fresh = [...new Map(records.map((record) => [record.id, record])).values()];
      const event = {
        collector: collector.id,
        title: cleanText(collector.name, 160).text,
        body: cleanText(fresh.slice(0, 3).map((record) => (
          record.title === record.text ? record.title : [record.title, record.text].filter(Boolean).join('\n')
        )).join('\n'), 600, { multiline: true }).text,
      };
      const bytes = encoder.encode(`${JSON.stringify(event)}\n`);
      for (const listener of [...listeners]) listener.send(bytes);
      for (const subscriber of [...subscribers]) {
        try { subscriber(event); } catch { /* Notification delivery never changes collection. */ }
      }
    },
    subscribe(listener) {
      if (closed) return () => {};
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    follow(signal) {
      if (closed) return new Response(null, { status: 503 });
      signal?.throwIfAborted();
      let detach;
      const body = new ReadableStream({
        start(controller) {
          let ended = false;
          const cleanup = () => { listeners.delete(listener); signal?.removeEventListener('abort', finish); };
          const finish = () => {
            if (ended) return;
            ended = true;
            cleanup();
            controller.close();
          };
          const listener = {
            send(bytes) { if (!ended) controller.enqueue(bytes); },
            close: finish,
          };
          detach = () => { ended = true; cleanup(); };
          listeners.add(listener);
          signal?.addEventListener('abort', finish, { once: true });
          // Flush headers without sending any historical content.
          controller.enqueue(encoder.encode('\n'));
        },
        cancel() { detach?.(); },
      });
      return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
    },
    close() {
      closed = true;
      subscribers.clear();
      for (const listener of [...listeners]) listener.close();
    },
  };
}
