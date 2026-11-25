// The loopback listener that takes the browser's redirect at the end of a sign-in.
//
// Lifted from Cline: sdk/packages/core/src/auth/server.ts (commit d3ecc4890e8f9bcb77182b96c77fa90575e8e145, 2026-11-04).
//   Copyright 2026 Cline Bot Inc., licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
//   the license text is in Cline's repository (LICENSE). The part kept is the shape: a list of fixed ports tried in order
//   (EADDRINUSE moves on), a timeout, a cancel, and dropping the lingering connections on close (a pooled socket to a fixed
//   port would otherwise deliver the next sign-in's callback to a listener that is already done).
//   Changed: it listens on 127.0.0.1 only and then on any free port; it matches `state` exactly before it takes anything; it
//   takes one callback, once, and keeps the browser's request open until finish() so that the page the user sees is the
//   result of the whole sign-in; it answers strays with 404, 405 and 409; the page is in Chinese and carries a CSP.
// Hardened after OpenClaw: src/infra/oauth-loopback-callback.ts (commit 9d9bda2f1cee1ca5e63a889af1742514b89ea85a, MIT,
//   Copyright (c) 2026 OpenClaw Foundation): the state check, one code, the status codes, the headers.
//
//   const listener = await startCallback({ ports, state });
//   listener.redirectUrl                    http://127.0.0.1:<port>/oauth/callback
//   await listener.wait({ timeoutMs, signal })  -> { code, iss, error, errorDescription }; rejects with .code 'timeout' | 'cancelled'
//   await listener.finish({ status, html }) answers the held request, then closes
//   await listener.close()                  stops listening and drops whatever is still open
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const HOST = '127.0.0.1';
export const CALLBACK_PATH = '/oauth/callback';
const GRACE_MS = 1000;

const CSS = 'html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;'
  + 'font:16px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}p{margin:0;padding:24px;text-align:center}';
// The page has no script and no outside resource; its one style is allowed by its hash.
const CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(CSS).digest('base64')}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The two sentences were approved as written (owner's sketch, 2026-11-06). `name` is shown as text, never as markup.
export const okText = (name) => `已连接 ${name}。可以回到嘟嘟了。`;
export const failText = (name) => `没有连上 ${name}。回到嘟嘟，再点一次“授权”。`;

export function renderPage(text, status) {
  const safe = escapeHtml(text);
  return {
    status,
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<meta name="referrer" content="no-referrer"><title>${safe}</title><style>${CSS}</style></head><body><p>${safe}</p></body></html>`,
  };
}

// Fixed ports first (the redirect URL is registered with the server, so the same one is reused), then whatever is free.
async function bind(handler, ports) {
  for (const candidate of [...ports, 0]) {
    const server = createServer(handler);
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(candidate, HOST, resolve); });
      server.on('error', () => {});
      return server;
    } catch (error) {
      if (candidate === 0 || (error.code !== 'EADDRINUSE' && error.code !== 'EACCES')) throw error;
    }
  }
  throw new Error('No port to listen on.');
}

export async function startCallback({ ports = [], path = CALLBACK_PATH, state }) {
  if (!state) throw new Error('A callback listener needs a state to match.');
  let port;
  let accepted = false;
  let closed = false;
  let held; // the browser's request that carried the callback, answered by finish()
  let timer;
  let abort;
  let closing;
  let settle;
  const outcome = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  outcome.catch(() => {}); // nobody may be waiting yet when a timeout or cancel comes

  // Only the redirect that carries this sign-in's state may end it: a stray request (or a forged ?error=) must not.
  const accept = (query) => {
    if (accepted || closed) return false;
    if (query.getAll('state').length !== 1 || query.get('state') !== state) return false;
    const codes = query.getAll('code');
    const error = query.get('error') ?? undefined;
    if (!error && (codes.length !== 1 || !codes[0])) return false;
    const iss = query.getAll('iss');
    accepted = true;
    clearTimeout(timer);
    settle.resolve({
      code: error ? undefined : codes[0],
      iss: iss.length === 0 ? undefined : iss.length === 1 ? iss[0] : null, // null: sent twice, which is never right
      error,
      errorDescription: query.get('error_description') ?? undefined,
    });
    return true;
  };

  const handle = (req, res) => {
    res.setHeader('Connection', 'close');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A request that is not the callback gets a status and nothing to read: the only words this listener shows are the two on the page.
    const reply = (status) => { res.writeHead(status); res.end(); };
    try {
      if (accepted) return reply(409);
      // A page on another site can point its own name at 127.0.0.1 (DNS rebinding); the browser then names that site.
      if (req.headers.host !== `${HOST}:${port}`) return reply(404);
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return reply(405); }
      const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);
      if (url.pathname !== path) return reply(404);
      if (!accept(url.searchParams)) return reply(400);
      held = res;
      res.on('close', () => { if (held === res) held = undefined; });
    } catch {
      if (!res.headersSent) reply(400);
    }
  };

  const server = await bind(handle, ports);
  port = server.address().port;

  const close = () => {
    if (closing) return closing;
    closed = true;
    clearTimeout(timer);
    abort?.();
    if (!accepted) settle.reject(Object.assign(new Error('The sign-in was cancelled.'), { code: 'cancelled' }));
    held?.destroy();
    held = undefined;
    closing = new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    return closing;
  };

  // Before a callback is accepted the end is the listener's to call; after it, the sign-in's own steps decide.
  const stop = (code, message) => {
    if (accepted || closed) return;
    settle.reject(Object.assign(new Error(message), { code }));
    close();
  };

  return {
    redirectUrl: `http://${HOST}:${port}${path}`,
    port,
    /**
     * The redirect, brought by the phone (2026-11-23): its sign-in page ran in the phone's own browser view, which stopped at this address instead of loading it, and
     * the App hands over the whole address. The same checks as a browser's request; there is no page to answer, so finish() only closes. -> whether it was taken.
     */
    deliver(address) {
      let url;
      try { url = new URL(String(address)); } catch { return false; }
      if (`${url.protocol}//${url.host}${url.pathname}` !== `http://${HOST}:${port}${path}`) return false;
      return accept(url.searchParams);
    },
    wait({ timeoutMs, signal } = {}) {
      if (!accepted && !closed) {
        if (timeoutMs) timer = setTimeout(() => stop('timeout', 'Timed out waiting for the browser.'), timeoutMs);
        if (signal?.aborted) stop('cancelled', 'The sign-in was cancelled.');
        else if (signal) {
          const onAbort = () => stop('cancelled', 'The sign-in was cancelled.');
          signal.addEventListener('abort', onAbort, { once: true });
          abort = () => signal.removeEventListener('abort', onAbort);
        }
      }
      return outcome;
    },
    async finish({ status, html }) {
      const res = held;
      held = undefined;
      if (res && !res.destroyed && !res.writableEnded) {
        // Connection: close ends the socket after the page; closing the listener before that could cut the page off.
        await new Promise((resolve) => {
          const grace = setTimeout(resolve, GRACE_MS);
          res.once('close', () => { clearTimeout(grace); resolve(); });
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        });
      }
      await close();
    },
    close,
  };
}
