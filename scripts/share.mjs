import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import qrcode from 'qrcode-terminal';
import { createRelay } from '../host/relay.mjs';

const { values } = parseArgs({ options: {
  url: { type: 'string' }, host: { type: 'string' }, port: { type: 'string', default: '3097' },
  'connection-file': { type: 'string' }, 'save-connection': { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('npm run share -- --url <complete Harness launch URL> [--host <LAN IP>] [--port 3097]');
  process.exit(0);
}
let upstreamUrl = values.url ?? process.env.HARNESS_URL;
if (values['connection-file']) {
  upstreamUrl = JSON.parse(await readFile(values['connection-file'], 'utf8')).url;
}
if (!upstreamUrl) {
  console.error('Supply --url or HARNESS_URL with the complete Harness URL, including ?token=.');
  process.exit(1);
}
const adapterScript = await readFile(new URL('../dist/mobile-adapter.js', import.meta.url), 'utf8');
const relay = await createRelay({
  upstreamUrl, adapterScript, host: values.host, port: Number(values.port),
});
console.log(`\nHarness Mobile: ${relay.pairUrl}\n`);
qrcode.generate(relay.pairUrl, { small: true });
if (values['save-connection']) {
  const path = resolve(values['save-connection']);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify({ url: relay.pairUrl }), { mode: 0o600 });
}
console.log('\nScan or paste this address in the Expo app. Keep this process running.');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await relay.close(); process.exit(0); });
}
