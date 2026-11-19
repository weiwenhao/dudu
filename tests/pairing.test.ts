import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairingServer, loadPairingToken } from '../host/pairing.mjs';

test('each computer creates its own persistent pairing key with private file permissions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dudu-pairing-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = join(directory, 'first');
  const token = await loadPairingToken(first);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await loadPairingToken(first), token);
  assert.notEqual(await loadPairingToken(join(directory, 'second')), token);
  assert.equal((await stat(join(first, 'pairing-key'))).mode & 0o777, 0o600);
  await writeFile(join(directory, 'connection.json'), JSON.stringify({
    url: `http://192.168.1.2:3097/?pair=${token}`,
  }));
  assert.equal(await loadPairingToken(directory), token);
  assert.equal(await readFile(join(directory, 'pairing-key'), 'utf8'), token);
});

test('the pairing page listens only on loopback and rejects untrusted origins and hosts', async (t) => {
  const pairUrl = `http://192.168.1.2:3097/?pair=${'a'.repeat(43)}`;
  const pairing = await createPairingServer({ pairUrl, port: 0 });
  t.after(() => pairing.close());
  assert.equal(pairing.server.address().address, '127.0.0.1');
  const response = await fetch(pairing.address);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  const page = await response.text();
  assert.ok(page.includes(pairUrl));
  assert.match(page, /<svg[^>]*aria-label="手机配对二维码"/);
  const reboundStatus = await new Promise((resolve, reject) => {
    http.get(pairing.address, { headers: { host: 'attacker.test' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(reboundStatus, 403);
  assert.equal((await fetch(pairing.address, { headers: { origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await fetch(pairing.address, { method: 'POST' })).status, 405);
  assert.equal((await fetch(pairing.address + 'api/pairing')).status, 404);
});
