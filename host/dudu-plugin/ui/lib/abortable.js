/** Also settle callers whose transport ignores cancellation (embedded / older hosts). */
export function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
