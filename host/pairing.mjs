import http from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export async function loadPairingToken(folder) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, 'pairing-key');
  try {
    const token = (await readFile(path, 'utf8')).trim();
    if (!validToken(token)) throw new Error('Invalid dsbot pairing key.');
    return token;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let token;
  // Keep an explicitly saved prototype pairing working during this upgrade.
  try {
    const previous = JSON.parse(await readFile(join(folder, 'connection.json'), 'utf8'));
    const candidate = new URL(previous.url).searchParams.get('pair');
    if (validToken(candidate)) token = candidate;
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') throw error;
  }
  token ??= randomBytes(32).toString('base64url');
  try {
    await writeFile(path, token, { mode: 0o600, flag: 'wx' });
    return token;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return loadPairingToken(folder);
  }
}

export function renderPairingSvg(pairUrl) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(pairUrl);
  qr.make();
  const size = qr.getModuleCount();
  const cells = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) cells.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${size + 8} ${size + 8}" role="img" aria-label="手机配对二维码" shape-rendering="crispEdges">
<rect x="-4" y="-4" width="${size + 8}" height="${size + 8}" fill="white"/><path d="${cells.join('')}" fill="black"/></svg>`;
}

export function renderPairingPage(pairUrl) {
  const svg = renderPairingSvg(pairUrl);
  const url = escapeHtml(pairUrl);
  const address = escapeHtml(new URL(pairUrl).host);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dudu - 连接手机</title><style>
:root{color-scheme:light;--ink:#17181b;--muted:#777b84;--blue:#4d6bfe}
*{box-sizing:border-box}body{margin:0;background:#f7f7f8;color:var(--ink);font-family:"Helvetica Neue","PingFang SC",sans-serif}
main{width:min(440px,calc(100% - 40px));margin:8vh auto;padding:32px;background:#fff;border-radius:28px;text-align:center}
h1{margin:0;color:var(--blue);font-size:24px;letter-spacing:-1px}h2{font-size:20px;font-weight:500;margin:24px 0 16px}
svg{display:block;width:100%;max-width:304px;margin:auto}
p{color:var(--muted);font-size:14px;margin:16px 0 24px}
label{display:block;text-align:left;font-size:13px;margin-bottom:8px}
input{width:100%;padding:14px;border:1px solid #eeeff1;border-radius:12px;background:#f8f8fa;font-size:13px;color:var(--ink)}
</style></head><body><main><h1>Dudu</h1><h2>打开 Dudu 扫码</h2>
${svg}
<p>${address}</p><label for="pairing-link">配对链接</label><input id="pairing-link" readonly value="${url}">
</main></body></html>`;
}

export async function createPairingServer({ pairUrl, port = 3098 }) {
  const page = renderPairingPage(pairUrl);
  const server = http.createServer((req, res) => {
    const allowedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    const origin = req.headers.origin;
    const allowedOrigins = allowedHosts.map((host) => `http://${host}`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    // A loopback bind plus Host/Origin checks keeps the code off the LAN and
    // prevents a different website from reading it through DNS rebinding.
    if (!allowedHosts.includes(req.headers.host) || (origin && !allowedOrigins.includes(origin))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return;
    }
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : page);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    address: `http://127.0.0.1:${server.address().port}/`,
    server,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
