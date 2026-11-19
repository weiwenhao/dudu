import { randomUUID } from 'node:crypto';
import { LONG_POLL_MS } from '../../long-poll.mjs';
import { cleanText } from '../inbox/records.mjs';

// What was sent lately, for the page that asks again when a stream has ended (see `follow`).
const KEEP = 50;
const KEEP_MS = 60_000;

/** Live results only: no persisted notification queue and no replay when an inbox or window opens. */
export function createCollectorNotifications({ now = Date.now } = {}) {
  const listeners = new Set();
  const subscribers = new Set();
  const encoder = new TextEncoder();
  const epoch = randomUUID().slice(0, 8); // a new one for each run of the plugin: where a page stopped in an earlier run means nothing
  const recent = []; // { id, at, bytes }
  let last = 0;
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
      const id = ++last;
      const bytes = encoder.encode(`${JSON.stringify({ id, ...event })}\n`);
      recent.push({ id, at: now(), bytes });
      while (recent.length > KEEP || (recent.length > 0 && now() - recent[0].at > KEEP_MS)) recent.shift();
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
    /**
     * A stream of what is collected from now on. It ends after LONG_POLL_MS (a request that stays open keeps DSH from installing its own updates),
     * and the page asks again with where it stopped: `{ epoch, after }` from the first line of the stream and the `id` of the events it has had.
     * Only what was sent in the gap between two streams of the same run of the plugin is sent again, never what came before the first one.
     */
    follow(signal, { epoch: seen, after } = {}) {
      if (closed) return new Response(null, { status: 503 });
      signal?.throwIfAborted();
      let detach;
      const body = new ReadableStream({
        start(controller) {
          let ended = false;
          let timer;
          const cleanup = () => { clearTimeout(timer); listeners.delete(listener); signal?.removeEventListener('abort', finish); };
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
          // Flush headers, and say where the feed is, without sending any historical content.
          controller.enqueue(encoder.encode(`${JSON.stringify({ epoch, head: last })}\n`));
          if (seen === epoch && Number.isSafeInteger(after)) for (const entry of recent) if (entry.id > after) controller.enqueue(entry.bytes);
          listeners.add(listener);
          signal?.addEventListener('abort', finish, { once: true });
          timer = setTimeout(finish, LONG_POLL_MS);
          timer.unref?.();
        },
        cancel() { detach?.(); },
      });
      return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
    },
    close() {
      closed = true;
      recent.length = 0;
      subscribers.clear();
      for (const listener of [...listeners]) listener.close();
    },
  };
}
