// Settings pages whose data a test cannot make in a real DSH without a model: the tidy runs of the memory (a tidy needs one).
// The real interface in a real browser, with the plugin's answers about the memory scripted (see fixture.mjs).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startFixture } from './fixture.mjs';

const undone: string[] = [];
const reviews = [
  { id: 'r1', at: Date.now() - 12 * 60000, undone: null, summary: { new: 0, corroborate: 1, refine: 2, supersede: 0, skill: 1 }, questions: 0 },
  { id: 'r2', at: Date.now() - 86400000, undone: null, summary: { new: 0, corroborate: 0, refine: 0, supersede: 0, skill: 0 }, questions: 1 },
];

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => {
  fixture = await startFixture({
    handlers: {
      'memory/records': () => ({ outcome: 'success', records: [], total: 0, budget: {} }),
      'memory/reviews': () => ({ outcome: 'success', reviews }),
      'memory/undo': ({ id }: { id: string }) => { undone.push(id); reviews.find((review) => review.id === id)!.undone = Date.now(); return { outcome: 'success' }; },
    },
  });
});
after(async () => { await fixture?.stop(); });

test('Memory: a tidy run reads as one line, and Undo puts it back', async () => {
  const page = await fixture.open();
  await page.getByRole('region', { name: 'Dashboard' }).getByRole('button', { name: 'Settings' }).click();
  const window = page.getByRole('dialog');
  await window.getByRole('button', { name: 'Memory', exact: true }).click();
  await window.getByText('3 entries updated, 1 skill added').waitFor();
  await window.getByText('No changes').waitFor();
  await window.getByRole('listitem').filter({ hasText: '3 entries updated' }).getByRole('button', { name: 'Undo' }).click();
  await window.getByRole('listitem').filter({ hasText: '3 entries updated' }).getByRole('button', { name: 'Undo' }).waitFor({ state: 'detached' });
  assert.deepEqual(undone, ['r1']);
  await page.context().close();
});
