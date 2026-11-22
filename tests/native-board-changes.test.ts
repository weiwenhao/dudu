import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { createBoardChanges } from '../host/native-board-changes.mjs';
import { createNativeServer } from '../host/native-server.mjs';
import { createPairingStore } from '../host/pairing-devices.mjs';
import { understands } from '../host/native-client.mjs';

const API = '/api/v1';

test('a burst of changes is one event, two events are never closer than the gap, and a session that moved nothing says nothing', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let clock = 0;
    const sent: number[] = [];
    const changes = createBoardChanges({ send: (revision) => sent.push(revision), now: () => clock });
    changes.changed(); changes.changed(); changes.changed();
    mock.timers.tick(119);
    assert.deepEqual(sent, [], 'the first change waits a moment so that the ones after it are the same event');
    clock = 120; mock.timers.tick(1);
    assert.deepEqual(sent, [1]);
    clock = 130; changes.changed();
    mock.timers.tick(389);
    assert.deepEqual(sent, [1], 'the next event keeps the minimum gap after the last');
    clock = 520; mock.timers.tick(1);
    assert.deepEqual(sent, [1, 2]);

    const attention = (seq: number, pending?: number) => ({ seq, through: seq, ...(pending === undefined ? {} : { pending: { seq: pending } }) });
    changes.sessionChanged('a', attention(5));
    mock.timers.tick(1000);
    assert.equal(sent.length, 3, 'a session seen for the first time is a change');
    changes.sessionChanged('a', attention(5));
    mock.timers.tick(1000);
    assert.equal(sent.length, 3, 'the same published state again changes nothing a phone shows');
    changes.sessionChanged('a', attention(5, 6));
    mock.timers.tick(1000);
    assert.equal(sent.length, 4, 'an answer waiting for its turn to end is a change');
    changes.close();
    changes.changed(); mock.timers.tick(1000);
    assert.equal(sent.length, 4, 'nothing is sent once it is closed');
  } finally { mock.timers.reset(); }
});

test('"the board changed" goes only to a phone that declared it understands that, and a phone that has not read the last one is not given two', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-board-push-'));
  const pairingStore = await createPairingStore({ folder });
  const server = await createNativeServer({ host: '127.0.0.1', port: 0, computer: { id: 'private-id', name: 'Private Host' }, pairingStore, dispatch: async () => ({}) });
  t.after(async () => { await server.close(); await pairingStore.close(); await rm(folder, { recursive: true, force: true }); });
  const tokenOf = async () => new URL((await pairingStore.issue({ address: server.address })).url).searchParams.get('pair');
  const post = (token: string, path: string, body?: unknown) => fetch(`${server.address}${API}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const modern = await tokenOf();
  const baseline = await tokenOf();
  assert.equal((await post(modern, '/connect', { app: { platform: 'ios', build: 150 }, capabilities: ['board.push'] })).status, 200);
  assert.equal((await post(baseline, '/connect')).status, 200); // build 143 says nothing
  const events = async (token: string) => (await (await post(token, '/events', { cursor: 0, waitMs: 0 })).json()).events;

  const accepts = (connection: any) => understands(connection.client, 'board.push');
  server.broadcast('board.changed', { revision: 1 }, accepts);
  server.broadcast('board.changed', { revision: 2 }, accepts);
  server.broadcast('board.changed', { revision: 3 }, accepts);
  assert.deepEqual((await events(modern)).map((event: any) => [event.topic, event.params.revision]), [['board.changed', 3]]);
  assert.deepEqual(await events(baseline), [], 'an app that said nothing is answered as before: no new topic');
});
