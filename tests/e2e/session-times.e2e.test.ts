import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { panelAction, startDudu } from './harness.mjs';

const ids = {
  old: '44444444-dddd-4444-8444-000000000001',
  recent: '44444444-dddd-4444-8444-000000000002',
};
const times = { old: '2026-10-23T02:00:00Z', recent: '2026-10-31T02:00:00Z' };
const pathOf = (id: string) => `.claude/projects/-session-times/${id}.jsonl`;
const lines = (records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';
const history = (id: string, timestamp: string, title: string, folder: string) => lines([
  { type: 'user', uuid: 'u1', parentUuid: null, timestamp, cwd: folder, message: { role: 'user', content: title } },
  { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp, message: {
    role: 'assistant', id: 'm1', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: `Answer for ${title}` }],
  } },
  { type: 'ai-title', sessionId: id, aiTitle: title, timestamp: new Date().toISOString() },
]);

let folder: string;
let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dudu-session-times-'));
  dudu = await startDudu({ files: {
    [pathOf(ids.old)]: history(ids.old, times.old, 'Old archived conversation', folder),
    [pathOf(ids.recent)]: history(ids.recent, times.recent, 'More recent conversation', folder),
  } });
  // Reverse the file dates: neither filesystem time nor metadata time is conversation activity.
  const oldFile = join(dudu.folder, 'user', pathOf(ids.old));
  const recentFile = join(dudu.folder, 'user', pathOf(ids.recent));
  await utimes(oldFile, new Date(), new Date());
  await utimes(recentFile, new Date('2026-10-01'), new Date('2026-10-01'));
});
after(async () => { await dudu?.stop(); if (folder) await rm(folder, { recursive: true, force: true }); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

test('old session dates and sorting survive preview, import, refresh and DSH restart without writing native files', async () => {
  const file = join(dudu.folder, 'user', pathOf(ids.old));
  const original = await readFile(file);
  const originalStat = await stat(file);
  let listing = await dudu.api('sessions/list', { refresh: true });
  const row = (id: string) => listing.sessions.find((session: any) => session.provider === 'claude' && session.id === id);
  assert.equal(row(ids.old).updatedAt, Date.parse(times.old));
  assert.equal(row(ids.recent).updatedAt, Date.parse(times.recent));
  assert.deepEqual(listing.sessions.filter((session: any) => session.provider === 'claude').map((session: any) => session.id), [ids.recent, ids.old]);

  const page = await dudu.openPanel();
  await panelAction(page, 'Sessions');
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  const oldOption = dialog.getByRole('option', { name: /Old archived conversation/ });
  await oldOption.getByText(/Oct 23/).waitFor();
  await oldOption.click();
  await dialog.getByRole('region', { name: 'Conversation history', exact: true }).getByText('Answer for Old archived conversation', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('Answer for Old archived conversation', { exact: true }).waitFor();
  listing = await dudu.api('sessions/list', { refresh: true });
  const sessionId = row(ids.old).dshSessionId;
  assert.ok(sessionId);
  for (let check = 0; check < 3; check++) {
    await dudu.api('sessions/read', { provider: 'claude', id: ids.old });
    assert.deepEqual((await dudu.api('sessions/sync', { sessionIds: [sessionId], fresh: true })).updated, []);
    listing = await dudu.api('sessions/list', { refresh: true });
    assert.equal(row(ids.old).updatedAt, Date.parse(times.old));
  }
  await dudu.restart();
  await page.reload();
  await panelAction(page, 'Sessions');
  await oldOption.getByText(/Oct 23/).waitFor();
  assert.match(await dialog.getByRole('option').first().innerText(), /More recent conversation/);
  assert.deepEqual(await readFile(file), original);
  assert.equal((await stat(file)).mtimeMs, originalStat.mtimeMs);

  // A real new conversation record still advances the date and rises above the other session.
  const timestamp = '2026-11-01T02:00:00Z';
  await appendFile(file, lines([
    { type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp, cwd: folder, message: { role: 'user', content: 'A new turn' } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp, message: {
      role: 'assistant', id: 'm2', stop_reason: 'end_turn', content: [{ type: 'text', text: 'A new answer' }],
    } },
  ]));
  listing = await dudu.api('sessions/list', { refresh: true });
  assert.equal(row(ids.old).updatedAt, Date.parse(timestamp));
  assert.equal(listing.sessions[0].id, ids.old);
  await dudu.api('sessions/sync', { sessionIds: [sessionId], fresh: true });
  await oldOption.click();
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('A new answer', { exact: true }).waitFor();
});
