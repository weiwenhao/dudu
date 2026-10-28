export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  // A rejection nobody awaits yet (the tool that would wait for it has not started) is not an unhandled one.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : Object.assign(new Error('The request was aborted.'), { name: 'AbortError' });
}

/** Unbounded FIFO with one awaiting consumer at a time; `close()` ends it after the queued items drain. */
export class AsyncQueue {
  #items = [];
  #waiters = [];
  #closed = false;

  push(item) {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve({ value: item, done: false });
    else this.#items.push(item);
  }

  close() {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  get closed() { return this.#closed && this.#items.length === 0; }

  next(signal) {
    if (this.#items.length) return Promise.resolve({ value: this.#items.shift(), done: false });
    if (this.#closed) return Promise.resolve({ value: undefined, done: true });
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(abortReason(signal));
      };
      waiter.resolve = (value) => { signal?.removeEventListener('abort', onAbort); resolve(value); };
      this.#waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
