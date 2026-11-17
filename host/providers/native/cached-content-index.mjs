// Durable conversation search lives on a worker. Opening a list reads small cached metadata, never the original transcripts.
import { Worker } from 'node:worker_threads';
import { createContentIndex } from './content-index.mjs';
import { contentCacheWorker } from './content-cache-worker.mjs';

export function createCachedContentIndex({ file } = {}) {
  if (!file) {
    const metadata = new Map();
    return Object.assign(createContentIndex(), {
      ready: Promise.resolve(), snapshot: async () => null,
      saveSnapshot: async () => {}, flush: async () => {}, close: async () => {},
      metadata: async (key) => metadata.get(key) ?? null,
      saveMetadata: async (key, value) => { metadata.set(key, value); },
    });
  }
  const worker = new Worker(contentCacheWorker, { workerData: { file } });
  const stamps = new Map();
  const messageStamps = new Map();
  const pending = new Map();
  let sequence = 0;
  let failure;
  let closed = false;
  const fail = (error) => {
    failure = error;
    for (const task of pending.values()) task.reject(error);
    pending.clear();
  };
  worker.on('error', fail);
  worker.on('exit', (code) => { if (!closed) fail(new Error(`The conversation search worker exited (${code}).`)); });
  worker.on('message', ({ id, value, error }) => {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id);
    if (error) task.reject(new Error(error));
    else task.resolve(value);
  });
  const request = (action, body) => {
    if (failure || closed) return Promise.reject(failure ?? new Error('The conversation index is closed.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, action, body });
    });
  };
  const ready = request('stamps').then((entries) => {
    for (const [key, stamp, messageStamp] of entries) {
      stamps.set(key, stamp);
      if (messageStamp !== null) messageStamps.set(key, messageStamp);
    }
  });
  // Callers can construct a catalog before its first use; failure is delivered by the first read.
  void ready.catch(() => {});
  const write = (action, body) => {
    const pending = request(action, body);
    void pending.catch(fail);
    return pending;
  };
  return {
    ready,
    get size() { return stamps.size; },
    keys: () => [...stamps.keys()],
    stamp: (key) => stamps.get(key),
    messageStamp: (key) => messageStamps.get(key),
    has: (key) => stamps.has(key),
    set(key, stamp, text) {
      stamps.set(key, stamp);
      if (Array.isArray(text.messages)) messageStamps.set(key, stamp);
      return write('set', { key, stamp, ...text });
    },
    delete(key) { stamps.delete(key); messageStamps.delete(key); write('delete', { key }); },
    async page(key, { before, query } = {}) {
      await ready;
      return request('page', { key, before, query });
    },
    async find(term) {
      await ready;
      return new Map(await request('find', { term }));
    },
    async evidence(keys, query) {
      await ready;
      return new Map(await request('evidence', { keys, query }));
    },
    snippet: (_key, hit) => hit.text,
    async snapshot() { await ready; return request('snapshot'); },
    saveSnapshot: (value) => request('saveSnapshot', value),
    async metadata(key) { await ready; return request('metadata', { key }); },
    saveMetadata: (key, value) => request('saveMetadata', { key, value }),
    flush: () => request('flush'),
    async close() {
      if (closed) return;
      try { await ready; await request('close'); }
      finally { closed = true; await worker.terminate(); }
    },
  };
}
