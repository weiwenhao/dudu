import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDsbotControl } from './dist/dsbot-control.mjs';
import { createTypertRpcAdapter } from './dist/native-bridge.mjs';
import { createTypertPageRpc } from './dist/native-page-rpc.mjs';
import { createDshMobileFrontend } from './dist/dsh-mobile-frontend.mjs';
import { createNativePages } from './dist/native-pages.mjs';
import { createConversationReads } from './dist/native-conversation-reads.mjs';
import { createNativeQuestions } from './dist/native-questions.mjs';
import { desktopPackageIdentity, writeDesktopRuntime } from './dist/desktop-runtime.mjs';
import { createNativeDiagnostics } from './dist/native-diagnostics.mjs';
import { migrateLegacyState } from './dist/legacy-state.mjs';
import { createProviders } from './dist/providers/index.mjs';
import { claudeProvider } from './dist/providers/drivers/claude.mjs';
import { codexProvider } from './dist/providers/drivers/codex.mjs';
import { permissionOf } from './dist/providers/permission.mjs';

// Capture the loaded package once, so an old runtime cannot report newly installed files as its own.
const runtimeIdentity = await desktopPackageIdentity(dirname(fileURLToPath(import.meta.url)));

export const name = 'dudu';
// Services every DSH has are required. The access mode a session is in is only read to scope what a harness may do,
// so a DSH without it still runs the plugin.
export const inject = {
  connection: true, typertGateway: true, clientModules: true, webServer: true, llm: true, agents: true,
  sessionProjections: false,
};

// The two halves do not depend on each other. The phone control needs a DSH new enough to hand out peers (the
// Desktop's); the providers work wherever DSH can route models, such as `dsh web`.
async function startProviders(ctx, folder) {
  const providers = await createProviders({
    folder,
    providers: [claudeProvider, codexProvider],
    host: {
      llm: ctx.llm,
      agents: ctx.agents,
      on: (event, handler) => ctx.on(event, handler),
      permissionOf: (agent) => permissionOf(ctx.sessionProjections, agent),
    },
  });
  const disposers = ['state', 'refresh', 'save'].map((action) => ctx.connection.fetch.register({
    path: `/api/dudu/providers/${action}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => providers.handle(action, request),
  }));
  return async () => {
    for (const dispose of disposers) dispose();
    await providers.close();
  };
}

async function startPhoneControl(ctx, config, dshHome, folder) {
  const diagnostics = createNativeDiagnostics(folder);
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } });
  let control;
  let questionBridge;
  const disposers = [];
  try {
    const rpc = createTypertRpcAdapter({ gateway: ctx.typertGateway, peer, diagnostics });
    const frontend = createDshMobileFrontend({ clientModules: ctx.clientModules });
    const pageRpc = createTypertPageRpc({
      gateway: ctx.typertGateway,
      peer,
      events: ctx,
      connection: ctx.connection,
      webServer: ctx.webServer,
    });
    const pages = createNativePages({ frontend, pageRpc });
    questionBridge = createNativeQuestions({
      events: ctx,
      attachWait: (request, signal) => {
        const questions = ctx.get('userQuestions');
        if (typeof questions?.attachWait !== 'function') throw new Error('User question wait service is unavailable.');
        return questions.attachWait(request.agent, request.wait.callId, signal);
      },
    });
    control = await createDsbotControl({
      folder,
      rpc,
      pages,
      conversationReads: createConversationReads({ connection: ctx.connection, peer }),
      questionBridge,
      legacyKeyPath: join(dshHome, 'harness-mobile', 'pairing-key'),
      port: config.port ?? 3170,
      host: config.host ?? '0.0.0.0',
    });
    for (const action of ['state', 'save', 'generate', 'revoke', 'nav']) {
      disposers.push(ctx.connection.fetch.register({
        path: `/api/dudu/${action}`, methods: ['POST'], requestBody: 'buffered',
        fetch: (request) => control.handle(action, request),
      }));
    }
  } catch (error) {
    questionBridge?.close();
    for (const dispose of disposers) dispose();
    try { await control?.close(); }
    finally { await peer.dispose(); await diagnostics.flush(); }
    throw error;
  }
  try { await writeDesktopRuntime(folder, runtimeIdentity, control.state().port); }
  catch { console.warn('[dudu] Could not save the local runtime receipt.'); }
  console.info(`[dudu] Ready on port ${control.state().port}. Open Settings > 手机控制 to pair.`);
  return async () => {
    questionBridge.close();
    for (const dispose of disposers) dispose();
    try { await control.close(); }
    finally { await peer.dispose(); await diagnostics.flush(); }
  };
}

export async function apply(ctx, config = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const folder = join(dshHome, 'dudu');
  // Paired phones were stored by the plugin's former name; carry them over before anything reads the folder.
  await migrateLegacyState({ dshHome });

  const stops = [];
  try {
    stops.push(await startProviders(ctx, folder));
    console.info('[dudu] Providers are ready.');
  } catch (error) {
    console.warn(`[dudu] Providers are unavailable: ${error.message}`);
  }

  if (typeof ctx.connection.createPeer === 'function') {
    try { stops.push(await startPhoneControl(ctx, config, dshHome, folder)); }
    catch (error) {
      // The providers keep working; DSH shows why the phone control did not start.
      if (stops.length === 0) throw error;
      console.error(`[dudu] Phone control did not start: ${error.message}`);
    }
  } else {
    console.warn('[dudu] Phone control needs a newer DSH (this one has no connection.createPeer); providers still work.');
  }

  ctx.effect(() => async () => { for (const stop of stops.reverse()) await stop(); });
}
