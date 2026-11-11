// The device sign-in (host/assistant/connectors/device.mjs, RFC 8628 as GitHub answers it): the fake is the service's two endpoints; the wait is a fake clock, never real time.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestCode, waitForToken } from '../host/assistant/connectors/device.mjs';

const json = (body: any, status = 200) => ({ status, text: async () => JSON.stringify(body) });
const clock = () => {
  let at = 0;
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => { waits.push(ms); at += ms; }, now: () => at };
};

test('the code is asked for with the client id and scope and read from the answer; a page that is not the service\'s own, an error and a non-JSON answer are failures', async () => {
  const sent: any[] = [];
  const good = { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 };
  const ask = (answer: any) => requestCode({ clientId: 'cid', scope: 'repo read:org', deviceUrl: 'https://github.com/login/device/code', fetch: async (url: string, init: any) => { sent.push([url, init.method, init.body]); return answer; } });
  assert.deepEqual(await ask(json(good)), { ok: true, userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', deviceCode: 'dc', expiresIn: 900, interval: 5 });
  assert.deepEqual(sent[0], ['https://github.com/login/device/code', 'POST', 'client_id=cid&scope=repo+read%3Aorg']);
  assert.match((await ask(json({ ...good, verification_uri: 'https://evil.example/device' }))).message, /not the service/);
  assert.match((await ask(json({ ...good, verification_uri: 'http://github.com/login/device' }))).message, /not the service/);
  assert.match((await ask(json({ error: 'device_flow_disabled', error_description: 'Device Flow must be explicitly enabled for this App' }, 200))).message, /^device_flow_disabled: Device Flow/);
  assert.match((await ask(json({ error: 'Not Found' }, 404))).message, /^Not Found/);
  assert.match((await ask({ status: 502, text: async () => '<html>' })).message, /not JSON/);
});

test('waiting for the token: pending is asked again after the interval, slow_down makes it longer, and the token is taken only from a bearer answer', async () => {
  const c = clock();
  const answers = [{ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { error: 'authorization_pending' }, { access_token: 'gho_x', token_type: 'bearer', scope: 'repo' }];
  const bodies: string[] = [];
  const got = await waitForToken({ clientId: 'cid', tokenUrl: 'https://github.com/login/oauth/access_token', deviceCode: 'dc', interval: 5, expiresIn: 900, sleep: c.sleep, now: c.now,
    fetch: async (_url: string, init: any) => { bodies.push(init.body); return json(answers.shift()); } });
  assert.deepEqual(got, { ok: true, token: 'gho_x', scope: 'repo' });
  assert.deepEqual(c.waits, [5000, 5000, 10000, 10000]);
  assert.equal(bodies[0], 'client_id=cid&device_code=dc&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code');
  const other = await waitForToken({ clientId: 'c', tokenUrl: 'https://x.test/t', deviceCode: 'd', sleep: clock().sleep, fetch: async () => json({ access_token: 'x', token_type: 'mac' }) });
  assert.equal(other.ok, false);
});

test('not approving, a code that ran out, a run of failed requests and a cancel each end the wait with their own reason', async () => {
  const wait = (answer: () => any, extra: any = {}) => { const c = clock(); return waitForToken({ clientId: 'c', tokenUrl: 'https://x.test/t', deviceCode: 'd', interval: 5, expiresIn: 20, sleep: c.sleep, now: c.now, fetch: async () => answer(), ...extra }); };
  assert.equal((await wait(() => json({ error: 'access_denied' }))).reason, 'denied');
  assert.equal((await wait(() => json({ error: 'expired_token' }))).reason, 'expired');
  assert.equal((await wait(() => json({ error: 'authorization_pending' }))).reason, 'expired', 'pending until the time given is over');
  assert.match((await wait(() => json({ error: 'incorrect_client_credentials', error_description: 'The client_id is not valid' }))).message, /^incorrect_client_credentials: The client_id/);
  let tries = 0;
  const flaky = await wait(() => { tries++; throw new Error('network down'); }, { expiresIn: 900 });
  assert.deepEqual([flaky.reason, tries], ['failed', 5]);
  let once = 0;
  assert.equal((await wait(() => { if (once++ === 0) throw new Error('blink'); return json({ access_token: 't', token_type: 'bearer' }); }, { expiresIn: 900 })).ok, true, 'one failed request is asked again');
  const controller = new AbortController();
  const stopped = await wait(() => json({ error: 'authorization_pending' }), { expiresIn: 900, signal: controller.signal, sleep: async () => { controller.abort(); } });
  assert.equal(stopped.reason, 'cancelled');
});
