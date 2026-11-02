import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { balanceView, createAccountBalance, dshVersion, formatMoney } from '../host/providers/native/balance.mjs';

test('an amount is written the way DSH\'s account page writes it: rounded down to the cent, grouped, "<¥0.01" below a cent', () => {
  assert.equal(formatMoney('12.340000', 'CNY'), '¥12.34');
  assert.equal(formatMoney('12.349', 'CNY'), '¥12.34', 'a cent is never rounded up');
  assert.equal(formatMoney('0.29', 'USD'), '$0.29', 'not a floating point 0.28');
  assert.equal(formatMoney('1234567.8', 'CNY'), '¥1,234,567.80');
  assert.equal(formatMoney('7', 'USD'), '$7.00');
  assert.equal(formatMoney('.5', 'CNY'), '¥0.50');
  assert.equal(formatMoney('0', 'CNY'), '¥0.00');
  assert.equal(formatMoney('0.000', 'CNY'), '¥0.00');
  assert.equal(formatMoney('0.005', 'CNY'), '<¥0.01');
  assert.equal(formatMoney('1.5e-3', 'CNY'), '<¥0.01');
  assert.equal(formatMoney('1e2', 'CNY'), '¥100.00');
  assert.equal(formatMoney('-0.001', 'CNY'), '-¥0.01');
  assert.equal(formatMoney('-3.456', 'CNY'), '-¥3.45');
  assert.equal(formatMoney('twelve', 'CNY'), null);
  assert.equal(formatMoney('', 'CNY'), null);
  assert.equal(formatMoney('1e999', 'CNY'), null, 'an exponent that would make a huge string is refused');
});

test('the DeepSeek row: the wallets of an account, "—" when they cannot be read, nothing without an account', () => {
  const wallets = { status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }, { currency: 'USD', balance: '3' }], bonusWallets: [{ currency: 'CNY', balance: '5' }] };
  assert.deepEqual(balanceView({ signedIn: true, balance: wallets }), {
    id: 'deepseek', name: 'DeepSeek', kind: 'balance', plan: '', limited: false, windows: [], state: 'ok',
    balance: [{ currency: 'CNY', text: '¥12.34' }, { currency: 'USD', text: '$3.00' }],
  });
  for (const balance of [{ status: 'failed' }, { status: 'ready', value: [], bonusWallets: [] }, null, undefined, { status: 'ready', value: [{ currency: 'CNY', balance: 'x' }] }]) {
    assert.equal(balanceView({ signedIn: true, balance } as any).state, 'unavailable');
    assert.equal(balanceView({ signedIn: true, balance } as any).balance, undefined);
  }
  assert.equal(balanceView({ signedIn: false, balance: wallets }).state, 'hidden');
  assert.equal(balanceView().state, 'hidden');
});

test('the balance is read through DSH\'s account service, with DSH\'s own version as the client\'s, and only for a stored sign-in', async () => {
  const calls: any[] = [];
  const account = (state: any, balance: any) => ({
    getState: async () => state,
    getBalance: async (client: any) => { calls.push(client); if (balance instanceof Error) throw balance; return balance; },
  });
  const ready = { status: 'ready', value: [{ currency: 'CNY', balance: '88.8' }], bonusWallets: [] };
  const read = (service: any) => createAccountBalance({ account: () => service, version: async () => '0.2.0-rc.2', locale: 'zh-CN' })();

  const ok = await read(account({ status: 'credential-stored' }, ready));
  assert.deepEqual([ok.state, ok.balance], ['ok', [{ currency: 'CNY', text: '¥88.80' }]]);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['locale', 'timezoneOffsetSeconds', 'version']);
  assert.deepEqual([calls[0].version, calls[0].locale], ['0.2.0-rc.2', 'zh-CN']);
  assert.equal(calls[0].timezoneOffsetSeconds, -new Date().getTimezoneOffset() * 60);

  calls.length = 0;
  assert.equal((await read(account({ status: 'signed-out' }, ready))).state, 'hidden');
  assert.equal(calls.length, 0, 'no sign-in, no request');
  assert.equal((await read(undefined)).state, 'hidden', 'a DSH without the service');
  assert.equal((await read({ getState: async () => { throw new Error('no'); } })).state, 'hidden');
  assert.equal((await read(account({ status: 'credential-stored' }, null))).state, 'unavailable', 'the grant changed while it was read');
  assert.equal((await read(account({ status: 'credential-stored' }, { status: 'failed' }))).state, 'unavailable');
  assert.equal((await read(account({ status: 'credential-stored' }, new Error('network')))).state, 'unavailable', 'a failed request is "—", not an error');
});

test('DSH\'s version is the one of the package that started this process', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dudu-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'lib'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.8.7' }));
  assert.equal(await dshVersion(join(root, 'lib', 'bin.js')), '9.8.7');
  const other = await mkdtemp(join(tmpdir(), 'dudu-version-'));
  t.after(() => rm(other, { recursive: true, force: true }));
  await writeFile(join(other, 'package.json'), JSON.stringify({ name: 'something-else', version: '1.0.0' }));
  assert.equal(await dshVersion(join(other, 'index.js')), undefined, 'a package that is not DSH\'s is not its version');
  assert.equal(await dshVersion(undefined), undefined);
});
