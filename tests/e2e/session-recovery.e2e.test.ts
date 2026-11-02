import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { buildSessionEvents } from '../../host/providers/native/session-events.mjs';
import { encodeArtifact, recoverArtifact, restoreImportedHead, validateArtifactEncoding } from '../../scripts/repair-imported-session.mjs';
import { startDudu } from './harness.mjs';

test('DSH lists, fully reads and reopens recovered compressed imports after a restart', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-recovery-e2e-'));
  let dudu: Awaited<ReturnType<typeof startDudu>> | undefined;
  try {
    const probe = join(folder, 'probe');
    await mkdir(probe);
    await writeFile(join(probe, 'package.json'), JSON.stringify({
      name: 'dudu-recovery-probe', version: '1.0.0', type: 'module', main: 'index.mjs',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }));
    await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - id: dudu-recovery-probe\n      name: dudu-recovery-probe\n');
    await writeFile(join(probe, 'index.mjs'), `
export const name = 'dudu-recovery-probe';
export const inject = ['connection', 'sessionController', 'workspaceRegistry'];
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dudu-recovery-probe', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const { sessionId } = await request.json();
      const inspected = await ctx.sessionController.inspect(sessionId);
      const workspace = await ctx.workspaceRegistry.create(inspected.meta.cwd);
      await workspace.attachSession(sessionId);
      const listing = await ctx.sessionController.list();
      return Response.json({ events: inspected.events, listed: listing.items.some(item => item.sessionId === sessionId) });
    },
  }));
}
`);
    const files: Record<string, Buffer> = {};
    const cases = [];
    for (const kind of ['missing-head', 'combined-frame']) {
      const sessionId = `session-recovery-${kind}`;
      const nativeId = `native-${kind}`;
      const title = `Recovered ${kind}`;
      const history = {
        id: nativeId, cwd: folder, title, createdAt: 1000,
        turns: [{ prompt: `Original ${kind} question`, at: 1000,
          steps: [{ blocks: [{ type: 'text', text: `Original ${kind} answer` }] }], results: new Map() }],
      };
      const { header, events } = buildSessionEvents({ history, route: 'codex', model: 'default', sessionId });
      const rows = [{ type: 'session', ...header }, ...events.filter((event: any) => event.type !== 'system/message')
        .map((event: any, seq: number) => ({ ...event, seq }))];
      const source = kind === 'missing-head' ? rows : restoreImportedHead(rows)!;
      const original = kind === 'missing-head' ? encodeArtifact(source, true)
        : zstdCompressSync(source.map(row => JSON.stringify(row)).join('\n') + '\n');
      const file = join(folder, `${kind}.jsonl.zstd`);
      await writeFile(file, original);
      // Only these file-publication seams are injected. The real DSH below validates encoding, schemas and restoration.
      const result = await recoverArtifact({
        file, apply: true, backupRoot: join(folder, 'backups'),
        catalog: { createRestore: () => ({ decodeRow() {}, finish() {} }) },
        acquireLock: async () => ({ close: async () => {} }), assertStopped: async () => {},
      });
      assert.deepEqual(await readFile(result.backup!), original);
      const bytes = await readFile(file);
      const restored = validateArtifactEncoding(bytes, true);
      if (kind === 'combined-frame') assert.deepEqual(restored, source);
      const project = `--${folder.replaceAll('/', '-').replace(/^-+/, '')}--`;
      files[`../dsh/sessions/${project}/${sessionId}/session.v4.jsonl.zstd`] = bytes;
      cases.push({ sessionId, nativeId, title, kind, restored });
    }
    dudu = await startDudu({ plugins: [probe], files });
    for (const item of cases) {
      const { issue } = await dudu.api('issues/add', { fields: {
        title: item.title, project: { name: 'Recovery', path: folder }, agent: 'codex', session: `dsh:${item.sessionId}`,
      } });
      item.issueId = issue.id;
    }
    for (const restarted of [false, true]) {
      if (restarted) await dudu.restart();
      for (const item of cases) {
        const response = await dudu.context.request.post(`${dudu.base}/api/dudu-recovery-probe`, { data: { sessionId: item.sessionId } });
        assert.equal(response.ok(), true, `HTTP ${response.status()}: ${await response.text()}\n${dudu.diagnostics()}`);
        const inspected = await response.json();
        assert.equal(inspected.listed, true);
        assert.deepEqual(inspected.events.slice(0, item.restored.length - 1), item.restored.slice(1));
        assert.ok(inspected.events.slice(item.restored.length - 1).every((event: any) => event.type === 'session/end-seed'));
        const reply = inspected.events.find((event: any) => event.type === 'assistant/message');
        assert.equal(reply.data.message.source.replayState.nativeSessionId, item.nativeId);
        const page = await dudu.openPanel();
        await page.locator(`[data-issue-row="${item.issueId}"]`).getByText(item.title, { exact: true }).click();
        await page.getByRole('button', { name: 'Open session', exact: true }).click();
        await page.getByText(`Original ${item.kind} question`, { exact: true }).waitFor();
        await page.getByText(`Original ${item.kind} answer`, { exact: true }).waitFor();
        assert.equal(await page.getByText(/stored session .* is corrupt/).count(), 0);
        await page.close();
      }
    }
  } finally {
    await dudu?.stop();
    await rm(folder, { recursive: true, force: true });
  }
});
