import { readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from './dist/relay.mjs';
import { createPairingServer, loadPairingToken } from './dist/pairing.mjs';

export const name = 'harness-mobile-share';
export const inject = ['webServer', 'connection'];

export async function apply(ctx, config = {}) {
  const folder = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'harness-mobile');
  const path = join(folder, 'connection.json');
  const pairToken = await loadPairingToken(folder);
  const upstreamUrl = ctx.connection.authenticatedUrl(
    `${ctx.webServer.protocol}//127.0.0.1:${ctx.webServer.port}/`,
  );
  const relay = await createRelay({
    upstreamUrl,
    adapterScript: await readFile(new URL('./dist/mobile-adapter.js', import.meta.url), 'utf8'),
    port: config.port ?? 3097,
    host: config.host,
    pairToken,
  });
  let pairing;
  try {
    pairing = await createPairingServer({ pairUrl: relay.pairUrl, port: config.pairingPort ?? 3098 });
    await writeFile(path, JSON.stringify({
      url: relay.pairUrl, pairingUrl: pairing.address, pid: process.pid,
    }), { mode: 0o600 });
  } catch (error) {
    await pairing?.close();
    await relay.close();
    throw error;
  }
  ctx.effect(() => async () => {
    await pairing.close();
    await relay.close();
    try {
      const saved = JSON.parse(await readFile(path, 'utf8'));
      if (saved.url === relay.pairUrl) await unlink(path);
    } catch { /* Another plugin activation may already own the pairing file. */ }
  });
  console.info(`[dsbot] Ready on ${relay.address}. Connect phone: ${pairing.address}`);
}
