// Real DSH, Claude, native startup hooks and tools; only the model is scripted.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startDudu } from './harness.mjs';

let folder: string;
let dudu: Awaited<ReturnType<typeof startDudu>>;

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dudu-claude-stop-'));
  const plugin = join(folder, 'probe');
  await mkdir(plugin);
  await writeFile(join(plugin, 'package.json'), JSON.stringify({
    name: 'dudu-claude-stop-probe', version: '1.0.0', type: 'module', main: 'index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }));
  await writeFile(join(plugin, 'cordis.patch.yml'), '- insert:\n    - id: dudu-claude-stop-probe\n      name: dudu-claude-stop-probe\n');
  await writeFile(join(plugin, 'index.mjs'), `
import { readSessionHistory } from ${JSON.stringify(new URL('../../host/dudu-plugin/dist/dsh-session-history.mjs', import.meta.url).href)};
export const name = 'dudu-claude-stop-probe';
export const inject = ['connection', 'sessionController', 'sessionQuery', 'workspaceRegistry'];
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dudu-claude-stop-probe', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const { action, sessionId, cwd, prompt } = await request.json();
      if (action === 'create') {
        const workspace = await ctx.workspaceRegistry.create(cwd);
        const created = await ctx.sessionController.create({ workspaceId: workspace.id });
        const catalog = await ctx.sessionController.modelCatalog();
        const model = catalog.groups.find(group => group.id === 'claude')?.models[0]?.id;
        if (!model) throw new Error('Claude is unavailable in the isolated catalog.');
        await ctx.sessionController.selectModel({ sessionId: created.sessionId, provider: 'claude', model });
        return Response.json(created);
      }
      if (action === 'prompt') {
        await ctx.sessionController.prompt({
          requestId: crypto.randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }],
        }, new AbortController().signal);
        return Response.json({ ok: true });
      }
      return Response.json(await readSessionHistory({ controller: ctx.sessionController, query: ctx.sessionQuery }, sessionId));
    },
  }));
}
`);
  dudu = await startDudu({
    plugins: [plugin], model: { nativeClaude: true },
    env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
    files: {
      '.claude/settings.json': JSON.stringify({
        permissions: { allow: ['Bash'] },
        hooks: { SessionStart: [{ hooks: [{
          type: 'command', command: 'node "$HOME/dudu-start-hook.cjs"', timeout: 40,
        }] }] },
      }),
      'dudu-start-hook.cjs': `
const fs = require('node:fs');
const path = require('node:path');
const home = require('node:os').homedir();
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const gate = path.join(home, 'dudu-block-start');
if (fs.existsSync(gate) && fs.readFileSync(gate, 'utf8') === input.session_id) {
  fs.writeFileSync(path.join(home, 'dudu-started'), JSON.stringify({
    pid: process.pid, at: Date.now(), source: input.source,
  }));
  setTimeout(() => {}, 30_000);
}
`,
    },
  });
});

after(async () => {
  await dudu?.stop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
afterEach(async context => {
  await rm(join(dudu.folder, 'user', 'dudu-block-start'), { force: true });
  await dudu.settle(context.name, context.passed === false);
});

async function probe(body: Record<string, unknown>) {
  const response = await dudu.context.request.post(`${dudu.base}/api/dudu-claude-stop-probe`, { data: body });
  assert.equal(response.ok(), true, `probe returned ${response.status()}`);
  return response.json();
}

async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (matches(value)) return value;
    await delay(50);
  }
  assert.fail('the expected Claude state did not arrive in time');
}

for (const waiting of ['startup', 'model', 'tool']) test(`Claude Stop cancels a ${waiting} wait and resumes the same session`, async context => {
  const answer = `CLAUDE_HISTORY_${waiting}`;
  dudu.model!.anthropicReplies = [{ say: answer }];
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder });
  await probe({ action: 'prompt', sessionId, prompt: `Prepare ${waiting} cancellation.` });
  const initial = await until(() => probe({ sessionId }), data => data.events.some((event: any) => event.type === 'turn/end'));
  const nativeId = initial.events.findLast((event: any) => event.type === 'assistant/message').data.message.source.replayState.nativeSessionId;
  const page = await dudu.openPanel({ selectPanel: false });
  context.after(() => page.close());
  const tree = page.getByRole('tree', { name: 'Sessions' });
  const workspace = tree.getByRole('treeitem').filter({ has: page.getByText(basename(dudu.folder), { exact: true }) });
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${sessionId}"]`).click();
  await page.getByText(answer, { exact: true }).waitFor();

  if (waiting === 'startup') await writeFile(join(dudu.folder, 'user', 'dudu-block-start'), nativeId);
  const release = Promise.withResolvers<void>();
  dudu.model!.anthropicReplies = [waiting === 'tool' ? {
    calls: [{ name: 'Bash', arguments: { command: 'echo "$$" > "$HOME/dudu-tool-started"; sleep 30', timeout: 40_000 } }],
  } : { say: 'The cancelled answer.', waitFor: release.promise }];
  const requests = dudu.model!.requests.length;
  const editor = page.locator('[contenteditable="true"][role="textbox"]');
  await editor.fill(`Cancel during ${waiting}.`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  let hook: { pid: number; at: number; source: string } | undefined;
  let toolPid: number | undefined;
  try {
    if (waiting === 'startup') {
      hook = await until(async () => {
        try { return JSON.parse(await readFile(join(dudu.folder, 'user', 'dudu-started'), 'utf8')); }
        catch { return undefined; }
      }, value => !!value);
      assert.equal(hook!.source, 'resume');
      assert.equal(dudu.model!.requests.length, requests, 'startup has not sent the cancelled prompt to the model');
    } else {
      await until(async () => dudu.model!.requests.length, count => count > requests);
      if (waiting === 'tool') {
        await until(() => probe({ sessionId }), data => data.events.some((event: any) => event.type === 'tool/call' && event.data.turn === 2));
        toolPid = await until(async () => {
          const data = await probe({ sessionId });
          const result = data.events.findLast((event: any) => event.type === 'tool/result' && event.data.turn === 2);
          assert.equal(result, undefined, `the tool should still be running: ${JSON.stringify(result?.data)}`);
          try { return Number(await readFile(join(dudu.folder, 'user', 'dudu-tool-started'), 'utf8')); }
          catch { return undefined; }
        }, value => Number.isInteger(value) && Number(value) > 0);
      }
    }
    const stopped = Date.now();
    await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
    const ended = await until(() => probe({ sessionId }), data => data.events.some((event: any) => event.type === 'turn/end' && event.data.turn === 2), 5000);
    const end = ended.events.findLast((event: any) => event.type === 'turn/end');
    assert.deepEqual(end.data.reason, { kind: 'aborted', reason: { kind: 'user' } });
    context.diagnostic(`${waiting}: Stop to durable turn/end ${end.time - stopped} ms`);
    await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Stop generating', exact: true }).count(), 0);
    if (hook) assert.throws(() => process.kill(hook!.pid, 0), { code: 'ESRCH' }, 'OAR has released the startup hook process too');
    if (toolPid) await until(async () => {
      try { process.kill(toolPid!, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    }, value => value, 5000);
    if (waiting === 'startup') assert.equal(dudu.model!.requests.length, requests);
    await rm(join(dudu.folder, 'user', 'dudu-block-start'), { force: true });
    release.resolve();
    const fresh = `CLAUDE_FRESH_${waiting}`;
    dudu.model!.anthropicReplies = [{ say: fresh }];
    await editor.fill(`Continue after ${waiting} cancellation.`);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText(fresh, { exact: true }).waitFor({ timeout: 20_000 });
    const final = await until(() => probe({ sessionId }), data => data.events.some((event: any) => event.type === 'turn/end' && event.data.turn === 3));
    const latest = final.events.findLast((event: any) => event.type === 'assistant/message');
    assert.equal(latest.data.message.source.replayState.nativeSessionId, nativeId);
    assert.equal(await page.getByText(/open in another process|HARNESS_UNAVAILABLE|UNKNOWN/).count(), 0);
  } finally {
    release.resolve();
    await rm(join(dudu.folder, 'user', 'dudu-block-start'), { force: true });
  }
});
