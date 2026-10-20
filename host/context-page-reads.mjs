const ROUTES = Object.freeze({
  'dshContext/detail': '/api/dsh-context/detail',
  'dshContext/fleet': '/api/dsh-context/fleet',
  'dshContext/skills': '/api/dsh-context/skills',
});

export const CONTEXT_PAGE_READ_METHODS = Object.freeze(Object.keys(ROUTES));
const MAX_REPLY_BYTES = 6 * 1024 * 1024;

const failure = (code = 'gateway/unavailable') => ({
  ok: false,
  error: { code, message: '电脑暂时无法完成请求。', details: {} },
});

function validArguments(endpoint, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const keys = endpoint === 'dshContext/fleet' ? ['sessionId', 'full'] : ['sessionId'];
  return Object.keys(args).every((key) => keys.includes(key))
    && typeof args.sessionId === 'string' && args.sessionId.length > 0
    && args.sessionId.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(args.sessionId)
    && (args.full === undefined || typeof args.full === 'boolean');
}

async function readJSON(response, signal) {
  if (!response.ok || !response.body) throw new Error('Unavailable context data.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REPLY_BYTES) throw new Error('Context data exceeds the page budget.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

export function createContextPageReads({ connection, peer, timeoutMs = 15_000 }) {
  if (peer?.principal?.kind !== 'owner') {
    throw new TypeError('Context pages require an owner-scoped peer.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive safe integer.');
  }
  const handler = connection?.createSharedFetchHandler?.('/api');

  return Object.freeze({
    async invoke(endpoint, args, signal) {
      if (!Object.hasOwn(ROUTES, endpoint) || !validArguments(endpoint, args)) {
        throw new Error('Unsupported context page read.');
      }
      if (typeof handler?.fetch !== 'function') return failure('gateway/not-found');
      if (signal?.aborted) return failure();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      let stop;
      const stopped = new Promise((_, reject) => {
        stop = () => reject(new Error('Context page read stopped.'));
        controller.signal.addEventListener('abort', stop, { once: true });
        if (controller.signal.aborted) stop();
      });

      try {
        controller.signal.throwIfAborted();
        // Invoke one fixed in-process plugin reader; no URL or HTTP carrier comes from the page.
        const request = new Request(`http://dsbot.invalid${ROUTES[endpoint]}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args),
          signal: controller.signal,
        });
        const read = Promise.resolve().then(async () => {
          controller.signal.throwIfAborted();
          const response = await handler.fetch(request, peer);
          if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            controller.signal.throwIfAborted();
          }
          return readJSON(response, controller.signal);
        });
        const result = await Promise.race([read, stopped]);
        if (result?.ok !== true || !Object.hasOwn(result, 'value')) return failure();
        return { ok: true, value: result.value };
      } catch {
        return failure();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', stop);
        controller.abort();
      }
    },
  });
}
