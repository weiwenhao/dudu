// Sign-in by device code (RFC 8628), for a service whose hosted server cannot register a client by itself (GitHub: its authorization server has no registration, so
// dudu has an OAuth App of its own, a client id that is public by design and no secret). The service gives a short code, the owner enters it on the service's own page
// in the browser and approves there, and dudu, which asks in the meantime, is given a token. Nothing here opens a browser, keeps a token or writes a word the owner reads.
//
//   const asked = await requestCode({ clientId, scope, deviceUrl, fetch?, signal? })
//        -> { ok: true, userCode, verificationUri, deviceCode, expiresIn, interval } | { ok: false, reason: 'failed', message }
//   const got = await waitForToken({ clientId, tokenUrl, deviceCode, interval, expiresIn, fetch?, signal?, sleep?, now? })
//        -> { ok: true, token, scope } | { ok: false, reason: 'denied' | 'expired' | 'cancelled' | 'failed', message }   never throws
// GitHub answers these requests with 200 and the error in the body (`authorization_pending` until the owner has approved, `slow_down` when asked too fast), and with
// `device_flow_disabled` when the OAuth App was registered without "Enable Device Flow". Every answer is read as JSON, the token only from a `bearer` answer.

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const MAX_BODY = 64 * 1024;
const FAILURES_IN_A_ROW = 5;

const sleepFor = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) { resolve(); return; }
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', done, { once: true });
});

async function post(url, fields, { fetch: send = globalThis.fetch, signal } = {}) {
  const response = await send(url, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), signal,
    redirect: 'error',
  });
  const text = (await response.text()).slice(0, MAX_BODY);
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON: said below */ }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`The answer of ${new URL(url).host} was not JSON (HTTP ${response.status}).`);
  return { status: response.status, body };
}

const said = (body) => String(body.error_description ?? body.error ?? '').slice(0, 200);

export async function requestCode({ clientId, scope, deviceUrl, fetch, signal }) {
  try {
    const { status, body } = await post(deviceUrl, { client_id: clientId, ...(scope ? { scope } : {}) }, { fetch, signal });
    if (body.error || status >= 400) return { ok: false, reason: 'failed', message: `${body.error ?? `HTTP ${status}`}${body.error_description ? `: ${said(body)}` : ''}`.slice(0, 200) };
    const { device_code: deviceCode, user_code: userCode, verification_uri: verificationUri } = body;
    if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') return { ok: false, reason: 'failed', message: 'The answer had no device code.' };
    // The page the owner is sent to is the service's own; a code that points anywhere else is not followed.
    if (new URL(verificationUri).protocol !== 'https:' || new URL(verificationUri).host !== new URL(deviceUrl).host) return { ok: false, reason: 'failed', message: 'The page for the code is not the service\'s own.' };
    return {
      ok: true, userCode, verificationUri, deviceCode,
      expiresIn: Number.isFinite(body.expires_in) && body.expires_in > 0 ? Math.min(body.expires_in, 1800) : 900,
      interval: Number.isFinite(body.interval) && body.interval > 0 ? Math.min(body.interval, 60) : 5,
    };
  } catch (error) {
    return { ok: false, reason: 'failed', message: String(error?.message ?? error).split('\n')[0].slice(0, 200) };
  }
}

export async function waitForToken({ clientId, tokenUrl, deviceCode, interval = 5, expiresIn = 900, fetch, signal, sleep = sleepFor, now = Date.now }) {
  const until = now() + expiresIn * 1000;
  let wait = interval;
  let failures = 0;
  while (true) {
    await sleep(wait * 1000, signal);
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled.' };
    if (now() >= until) return { ok: false, reason: 'expired', message: 'The code ran out.' };
    let answer;
    try {
      answer = await post(tokenUrl, { client_id: clientId, device_code: deviceCode, grant_type: GRANT }, { fetch, signal });
      failures = 0;
    } catch (error) {
      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled.' };
      // One failed request (a network that blinked) is asked again; a run of them is the end.
      if (++failures >= FAILURES_IN_A_ROW) return { ok: false, reason: 'failed', message: String(error?.message ?? error).split('\n')[0].slice(0, 200) };
      continue;
    }
    const { body } = answer;
    if (typeof body.access_token === 'string' && body.access_token) {
      if (String(body.token_type ?? '').toLowerCase() !== 'bearer') return { ok: false, reason: 'failed', message: 'The token was not a bearer token.' };
      return { ok: true, token: body.access_token, scope: typeof body.scope === 'string' ? body.scope : '' };
    }
    switch (body.error) {
      case 'authorization_pending': break;
      case 'slow_down': wait = Number.isFinite(body.interval) && body.interval > wait ? Math.min(body.interval, 60) : wait + 5; break;
      case 'access_denied': return { ok: false, reason: 'denied', message: 'The owner did not approve.' };
      case 'expired_token': return { ok: false, reason: 'expired', message: 'The code ran out.' };
      default: return { ok: false, reason: 'failed', message: `${body.error ?? `HTTP ${answer.status}`}${body.error_description ? `: ${said(body)}` : ''}`.slice(0, 200) };
    }
  }
}
