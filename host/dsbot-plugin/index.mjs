import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDsbotControl } from './dist/dsbot-control.mjs';
import { createTypertRpcAdapter } from './dist/native-bridge.mjs';
import { createTypertPageRpc } from './dist/native-page-rpc.mjs';
import { createDshMobileFrontend } from './dist/dsh-mobile-frontend.mjs';
import { createNativePages } from './dist/native-pages.mjs';

export const name = 'dsbot';
export const inject = ['connection', 'typertGateway', 'clientModules', 'webServer'];

export async function apply(ctx, config = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const folder = join(dshHome, 'dsbot');
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } });
  let control;
  const disposers = [];
  try {
    const rpc = createTypertRpcAdapter({ gateway: ctx.typertGateway, peer });
    const frontend = createDshMobileFrontend({ clientModules: ctx.clientModules });
    const pageRpc = createTypertPageRpc({
      gateway: ctx.typertGateway,
      peer,
      events: ctx,
      connection: ctx.connection,
      webServer: ctx.webServer,
    });
    const pages = createNativePages({ frontend, pageRpc });
    control = await createDsbotControl({
      folder,
      rpc,
      pages,
      legacyKeyPath: join(dshHome, 'harness-mobile', 'pairing-key'),
      port: config.port ?? 3170,
      host: config.host ?? '0.0.0.0',
    });
    for (const action of ['state', 'save', 'generate', 'revoke', 'nav']) {
      disposers.push(ctx.connection.fetch.register({
        path: `/api/dsbot/${action}`, methods: ['POST'], requestBody: 'buffered',
        fetch: (request) => control.handle(action, request),
      }));
    }
  } catch (error) {
    for (const dispose of disposers) dispose();
    try { await control?.close(); }
    finally { await peer.dispose(); }
    throw error;
  }
  ctx.effect(() => async () => {
    for (const dispose of disposers) dispose();
    try { await control.close(); }
    finally { await peer.dispose(); }
  });
  console.info(`[dsbot] Ready on port ${control.state().port}. Open Settings > 手机控制 to pair.`);
}
