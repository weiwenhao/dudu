import { execFile } from 'node:child_process';
import { fetch as undiciFetch, ProxyAgent, Socks5ProxyAgent } from 'undici';

// The proxy the quota's own calls (the ChatGPT usage endpoint, DeepSeek's balance) go through when the process was started with none (owner, 2026-11-11: "照 magpie 改吧"; magpie's
// `internal/netproxy`). An app started from the Dock has no HTTPS_PROXY in its environment, and DSH's own proxy policy reads only the environment and the Harness-home `.env`, so on a Mac whose
// only proxy is the one in System Settings → Network the plain `fetch` goes direct and the ChatGPT backend never answers.
//
// In magpie's order: a proxy the process's environment names is DSH's to apply (nothing is done here), else the macOS system proxy (`scutil --proxy`: the HTTPS entry, else HTTP, else SOCKS,
// its exception list kept), else direct. Loopback is never proxied. Only these calls use it: the process's environment and DSH's dispatcher are left alone (the agents DSH starts inherit the
// environment). macOS only: the system proxies of Windows and Linux are not read (a call there goes as it did before), nor is a proxy auto-configuration script (PAC).

const SCUTIL = '/usr/sbin/scutil';
const READ_TIMEOUT = 5_000;
const KEEP = 15_000;
const NONE = Object.freeze({ url: '', bypass: Object.freeze([]) });
const VARIABLES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

/** What `scutil --proxy` prints (System Settings → Network → Proxies): the proxy a request goes through, and the hosts it does not. The HTTPS entry wins over HTTP over SOCKS, as in magpie. */
export function parseScutil(text) {
  const values = new Map();
  const bypass = [];
  let listing = false;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    const at = line.indexOf(' : ');
    if (listing) {
      if (line === '}') listing = false;
      else if (at >= 0) bypass.push(line.slice(at + 3).trim());
      continue;
    }
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    if (key === 'ExceptionsList') listing = true;
    else values.set(key, line.slice(at + 3).trim());
  }
  const entry = (name, scheme) => {
    const host = values.get(`${name}Proxy`);
    if (values.get(`${name}Enable`) !== '1' || !host) return '';
    const port = values.get(`${name}Port`);
    return `${scheme}://${host.includes(':') ? `[${host}]` : host}${port ? `:${port}` : ''}`;
  };
  const url = entry('HTTPS', 'http') || entry('HTTP', 'http') || entry('SOCKS', 'socks5');
  return url ? { url, bypass } : NONE;
}

/** The system's exception list: exact hosts, `*.example.com` and `.example.com` suffixes, and `<local>` for a name with no dot. */
export function bypassed(host, list = []) {
  const name = host.toLowerCase();
  return list.some((item) => {
    const entry = String(item).trim().toLowerCase();
    if (!entry) return false;
    if (entry === '<local>') return !name.includes('.');
    if (entry.startsWith('*.') || entry.startsWith('.')) {
      const suffix = entry.replace(/^\*/, '');
      return name.endsWith(suffix) || name === suffix.slice(1);
    }
    return name === entry;
  });
}

const loopback = (host) => host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '::1';

/** The proxy a request to `url` goes through under the system's settings: '' for none (no proxy set, a loopback host, a host on the exception list). */
export function proxyFor(url, system) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (loopback(host) || !system?.url || bypassed(host, system.bypass)) return '';
  return system.url;
}

/** Whether the process's own environment names a proxy: then DSH's proxy policy decides, as it does for every other call. */
export const namesProxy = (environment) => VARIABLES.some((name) => String(environment?.[name] ?? '').trim() !== '');

function readScutil() {
  return new Promise((resolve) => {
    execFile(SCUTIL, ['--proxy'], { timeout: READ_TIMEOUT, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => resolve(error ? NONE : parseScutil(String(stdout))));
  });
}

/** `read`, remembered for `keep` ms: the two calls of one click share a single read, and a proxy app started after the process is seen soon. */
function remembered(read, keep = KEEP, now = Date.now) {
  let at = 0;
  let value = null;
  return () => {
    if (value && now() - at < keep) return value;
    at = now();
    value = read();
    return value;
  };
}

const agents = new Map();
function agentFor(proxy) {
  let agent = agents.get(proxy);
  if (!agent) {
    // HTTP/1.1 to the target: through a local proxy the ChatGPT backend answered HTTP/2 with PROTOCOL_ERROR (magpie, `internal/provider/codex_http1.go`)
    agent = proxy.startsWith('socks') ? new Socks5ProxyAgent(proxy) : new ProxyAgent({ uri: proxy, allowH2: false });
    agents.set(proxy, agent);
  }
  return agent;
}
const viaProxy = (proxy) => (input, init) => undiciFetch(input, { ...init, dispatcher: agentFor(proxy) });

/**
 * A `fetch` for the quota's calls. Only on macOS, and only when the environment names no proxy, a call to a host the system sends through a proxy goes through it; every other call is the
 * process's own `fetch`, as before. (`readSystem`, `direct` and `through` are for tests.)
 */
export function createQuotaFetch({
  environment = process.env,
  platform = process.platform,
  readSystem = remembered(readScutil),
  direct = (...args) => globalThis.fetch(...args),
  through = viaProxy,
} = {}) {
  return async function quotaFetch(input, init) {
    if (platform === 'darwin' && !namesProxy(environment)) {
      const proxy = proxyFor(typeof input === 'string' ? input : (input?.url ?? String(input)), await readSystem());
      if (proxy) return through(proxy)(input, init);
    }
    return direct(input, init);
  };
}

export const quotaFetch = createQuotaFetch();
