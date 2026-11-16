import { Buffer } from 'node:buffer';
import { isAbsolute } from 'node:path';
import { ConversationError } from './native-conversation.mjs';
import { openVideoFile, readVideoFile } from './native-videos.mjs';

const ROUTES = Object.freeze({ summary: '/api/changes.summary', diff: '/api/changes.diff', file: '/api/file' });
const MAX_BYTES = 16 * 1024 * 1024;
const fail = (code) => { throw new ConversationError(code); };

export function createConversationReads({ connection, peer, workspaceChanges, attachments, timeoutMs = 20_000 }) {
  if (peer?.principal?.kind !== 'owner') throw new TypeError('Conversation reads require an owner peer.');
  const handler = connection?.createSharedFetchHandler?.('/api');
  return Object.freeze({
    openVideo(coordinates, signal) {
      return openVideoFile(coordinates, attachments?.(), signal);
    },
    changeCounts(sessionId, seq) {
      // DSH retains this summary alongside its comparison. Reading it does not
      // regenerate a diff or open the full historical file response.
      const summary = workspaceChanges?.()?.summary?.(sessionId, seq);
      if (!summary || !['total', 'added', 'deleted'].every((key) =>
        Number.isSafeInteger(summary[key]) && summary[key] >= 0)) return undefined;
      return { total: summary.total, added: summary.added, deleted: summary.deleted };
    },
    async read(kind, coordinates, signal) {
      if (kind === 'video') {
        const timeout = AbortSignal.timeout(timeoutMs);
        const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
        return readVideoFile(coordinates, attachments?.(), bounded);
      }
      if (!Object.hasOwn(ROUTES, kind) || typeof handler?.fetch !== 'function') fail('UNSUPPORTED');
      const allowed = kind === 'file' ? ['path'] : kind === 'diff' ? ['sessionId', 'seq', 'index'] : ['sessionId', 'seq'];
      if (!coordinates || Object.keys(coordinates).some((key) => !allowed.includes(key))
        || allowed.some((key) => !Object.hasOwn(coordinates, key))) fail('BAD_REQUEST');
      if (kind === 'file' ? typeof coordinates.path !== 'string' || !isAbsolute(coordinates.path) || coordinates.path.includes('\0')
        : typeof coordinates.sessionId !== 'string' || !coordinates.sessionId
          || !Number.isSafeInteger(coordinates.seq) || coordinates.seq < 0
          || kind === 'diff' && (!Number.isSafeInteger(coordinates.index) || coordinates.index < 0)) fail('BAD_REQUEST');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      let stop;
      const stopped = new Promise((_, reject) => {
        stop = () => reject(new ConversationError('UPSTREAM_UNAVAILABLE'));
        controller.signal.addEventListener('abort', stop, { once: true });
        if (controller.signal.aborted) stop();
      });
      const url = new URL(`http://dsbot.invalid${ROUTES[kind]}`);
      for (const [key, value] of Object.entries(coordinates)) url.searchParams.set(key, String(value));
      const read = async () => {
        controller.signal.throwIfAborted();
        let response = await handler.fetch(new Request(url, { signal: controller.signal }), peer);
        // DSH redirects unversioned file reads to their immutable version. Follow only
        // that same file through the owner-scoped handler, never an arbitrary URL.
        for (let redirects = 0; kind === 'file' && [301, 302, 303, 307, 308].includes(response.status); redirects++) {
          void response.body?.cancel().catch(() => {});
          if (redirects >= 2 || controller.signal.aborted) fail('UPSTREAM_UNAVAILABLE');
          const location = response.headers.get('location');
          let next;
          try { next = location ? new URL(location, url) : undefined; } catch { /* rejected below */ }
          if (!next || next.origin !== url.origin || next.pathname !== url.pathname
            || next.username || next.password || next.hash
            || next.searchParams.get('path') !== coordinates.path || !next.searchParams.get('v')
            || [...next.searchParams.keys()].some((key) => !['path', 'v'].includes(key))) fail('UPSTREAM_UNAVAILABLE');
          response = await handler.fetch(new Request(next, { signal: controller.signal }), peer);
        }
        if (controller.signal.aborted || !response.ok || !response.body) {
          void response.body?.cancel().catch(() => {});
          controller.signal.throwIfAborted();
          fail(response.status === 413 ? 'LIMIT_EXCEEDED'
            : response.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_UNAVAILABLE');
        }
        const reader = response.body.getReader();
        const cancel = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        try {
          const chunks = [];
          let size = 0;
          while (true) {
            const { value, done } = await reader.read();
            controller.signal.throwIfAborted();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) fail('LIMIT_EXCEEDED');
            chunks.push(value);
          }
          const bytes = Buffer.concat(chunks, size);
          if (kind === 'file') return {
            mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
            dataBase64: bytes.toString('base64'),
          };
          return JSON.parse(bytes.toString('utf8'));
        } finally {
          controller.signal.removeEventListener('abort', cancel);
          cancel();
        }
      };
      try { return await Promise.race([read(), stopped]); }
      finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', stop);
        controller.abort();
      }
    },
  });
}
