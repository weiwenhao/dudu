export type Connection = {
  name: string;
  url: string;
  computerId?: string;
};

export function parseConnection(value: string, name = ''): Connection {
  const text = value.trim();
  if (!text) throw new Error('请填写电脑上的 Harness 访问地址。');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('请输入完整的 HTTP 或 HTTPS 连接链接。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('仅支持不含用户名和密码的 HTTP 或 HTTPS 地址。');
  }
  if (url.hash) throw new Error('请使用 Harness 的完整访问链接，不要添加页面片段。');
  const computerId = url.searchParams.get('computer');
  if (computerId && (!/^[a-zA-Z0-9_-]{1,100}$/.test(computerId)
    || url.searchParams.getAll('computer').length !== 1)) {
    throw new Error('电脑标识无效，请重新扫描配对码。');
  }
  const label = name.trim() || url.searchParams.get('name')?.trim() || url.hostname;
  return { name: label.slice(0, 80), url: url.href, ...(computerId ? { computerId } : {}) };
}

export function parseAppConnection(value: string | null | undefined): Connection | null {
  if (!value) return null;
  let link: URL;
  try { link = new URL(value); } catch { return null; }
  if (link.protocol !== 'harness-mobile:' || link.hostname !== 'connect') return null;
  const targets = link.searchParams.getAll('url');
  if (targets.length !== 1) throw new Error('连接链接无效，请重新扫码。');
  return parseConnection(targets[0]);
}

export function displayAddress(value: string): string {
  try {
    const url = new URL(value);
    return url.host + (url.pathname === '/' ? '' : url.pathname);
  } catch {
    return '';
  }
}

export function isSameOrigin(target: string, source: string): boolean {
  try {
    return new URL(target).origin === new URL(source).origin;
  } catch {
    return false;
  }
}

export function isLoopback(value: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
