import assert from 'node:assert/strict';
import test from 'node:test';
import { createContextPageReads } from '../host/context-page-reads.mjs';

const peer = { principal: { kind: 'owner' } };

test('context reads call only exact in-process plugin routes with the owner peer', async () => {
  const calls = [];
  const reader = createContextPageReads({
    peer,
    connection: {
      createSharedFetchHandler(channel) {
        assert.equal(channel, '/api');
        return {
          async fetch(request, receivedPeer) {
            calls.push({
              url: request.url, method: request.method, body: await request.json(),
              headers: Object.fromEntries(request.headers), peer: receivedPeer,
            });
            return Response.json({ ok: true, value: { rev: 3, requests: [{ seq: 20 }] } });
          },
        };
      },
    },
  });
  for (const [endpoint, path, args] of [
    ['dshContext/detail', 'detail', { sessionId: 'selected-session' }],
    ['dshContext/fleet', 'fleet', { sessionId: 'selected-teammate', full: true }],
    ['dshContext/skills', 'skills', { sessionId: 'selected-session' }],
  ]) {
    assert.deepEqual(await reader.invoke(endpoint, args), {
      ok: true, value: { rev: 3, requests: [{ seq: 20 }] },
    });
    assert.deepEqual(calls.at(-1), {
      url: `http://dsbot.invalid/api/dsh-context/${path}`,
      method: 'POST', body: args,
      headers: { 'content-type': 'application/json' }, peer,
    });
  }
});

test('context readers reject arbitrary routes, paths, bodies and non-owner peers', async () => {
  assert.throws(() => createContextPageReads({
    peer: { principal: { kind: 'device' } },
  }), TypeError);
  let calls = 0;
  const reader = createContextPageReads({
    peer,
    connection: {
      createSharedFetchHandler: () => ({
        fetch: async () => { calls += 1; return Response.json({ ok: true, value: null }); },
      }),
    },
  });
  for (const [endpoint, args] of [
    ['dshContext/attachment', { sessionId: 's', attachmentId: 'file' }],
    ['dshContext/backfill', { sessionId: 's' }],
    ['dshContext/detail', { sessionId: 's', url: 'https://example.com' }],
    ['dshContext/skills', { sessionId: 's', cwd: '/private' }],
    ['dshContext/fleet', { sessionId: 's', full: 'true' }],
    ['dshContext/detail', { sessionId: '' }],
    ['dshContext/detail', { sessionId: 's\n' }],
  ]) {
    await assert.rejects(reader.invoke(endpoint, args), /Unsupported context page read/);
  }
  assert.equal(calls, 0);
});
