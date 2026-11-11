import assert from 'node:assert/strict';
import test from 'node:test';
import { bypassed, createQuotaFetch, parseScutil, proxyFor } from '../host/providers/quota/system-proxy.mjs';

// The quota's calls and the system proxy: when the process has none of its own (a Desktop started from the Dock), the proxy in System Settings → Network is used, in magpie's order, and only for these calls.

// The shape of what `scutil --proxy` printed on the owner's Mac on 2026-11-11 (Clash for HTTP, HTTPS and SOCKS), each entry given its own address so the three can be told apart.
const SYSTEM = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : 192.168.0.0/16
    2 : localhost
    3 : *.local
    4 : .internal.example
    5 : <local>
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7891
  HTTPSProxy : 127.0.0.2
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 7892
  SOCKSProxy : 127.0.0.3
}`;

test('the system proxy is the HTTPS entry, else HTTP, else SOCKS, only when enabled, with its exception list', () => {
  const read = parseScutil(SYSTEM);
  assert.equal(read.url, 'http://127.0.0.2:7891', 'HTTPS wins over HTTP over SOCKS');
  assert.deepEqual(read.bypass, ['127.0.0.1', '192.168.0.0/16', 'localhost', '*.local', '.internal.example', '<local>']);
  assert.equal(parseScutil(SYSTEM.replace('HTTPSEnable : 1', 'HTTPSEnable : 0')).url, 'http://127.0.0.1:7890');
  assert.equal(parseScutil(SYSTEM.replace('HTTPSEnable : 1', 'HTTPSEnable : 0').replace('HTTPEnable : 1', 'HTTPEnable : 0')).url, 'socks5://127.0.0.3:7892');
  assert.equal(parseScutil('<dictionary> {\n  HTTPEnable : 0\n}').url, '', 'nothing enabled: no proxy');
  assert.equal(parseScutil('').url, '');

  assert.equal(proxyFor('https://chatgpt.com/backend-api/wham/usage', read), 'http://127.0.0.2:7891');
  assert.equal(proxyFor('http://127.0.0.1:3170/x', read), '', 'loopback is never proxied');
  assert.equal(proxyFor('https://[::1]:3170/x', read), '');
  assert.equal(proxyFor('https://printer.local/x', read), '', 'a host on the exception list is not proxied');
  assert.equal(proxyFor('https://chatgpt.com', { url: '', bypass: [] }), '');
  assert.equal(bypassed('a.internal.example', ['.internal.example']), true);
  assert.equal(bypassed('internal.example', ['*.internal.example']), true);
  assert.equal(bypassed('intranet', ['<local>']), true);
  assert.equal(bypassed('chatgpt.com', ['<local>', '*.local']), false);
});

test('a call goes through the system proxy only on macOS, when the environment names none, to a host the system proxies; every other call is the process\'s own fetch', async () => {
  const sent: string[] = [];
  const make = (options: { environment?: Record<string, string>; platform?: string; system?: unknown } = {}) => {
    let reads = 0;
    const fetch = createQuotaFetch({
      environment: options.environment ?? {}, platform: options.platform ?? 'darwin',
      readSystem: async () => { reads++; return (options.system ?? parseScutil(SYSTEM)) as never; },
      direct: (async (input: string) => { sent.push(`direct ${input}`); return 'direct'; }) as never,
      through: ((proxy: string) => async (input: string) => { sent.push(`${proxy} ${input}`); return 'proxied'; }) as never,
    });
    return { fetch: fetch as (url: string) => Promise<unknown>, reads: () => reads };
  };
  const url = 'https://chatgpt.com/backend-api/wham/usage';

  const mac = make();
  assert.equal(await mac.fetch(url), 'proxied');
  assert.deepEqual(sent.splice(0), [`http://127.0.0.2:7891 ${url}`]);

  const named = make({ environment: { HTTPS_PROXY: 'http://127.0.0.1:9' } });
  assert.equal(await named.fetch(url), 'direct', 'a proxy the environment names is DSH\'s to apply');
  assert.equal(named.reads(), 0, 'and the system is not even asked');
  assert.equal(await make({ environment: { all_proxy: ' ' } }).fetch(url), 'proxied', 'an empty variable names nothing');
  sent.length = 0;

  const linux = make({ platform: 'linux' });
  assert.equal(await linux.fetch(url), 'direct');
  assert.equal(linux.reads(), 0, 'only macOS has a system proxy that is read');
  assert.equal(await make({ system: { url: '', bypass: [] } }).fetch(url), 'direct', 'no system proxy: as before');
  assert.equal(await make().fetch('http://localhost:3170/x'), 'direct', 'loopback');
  assert.equal(await mac.fetch('https://printer.local/x'), 'direct', 'a host on the exception list');
});
