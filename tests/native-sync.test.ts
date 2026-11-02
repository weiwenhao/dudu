import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeUpdates, createNativeSync } from '../host/providers/native/sync.mjs';
import { buildSessionEvents } from '../host/providers/native/session-events.mjs';
import { sessionInfo } from '../host/providers/native/session-info.mjs';

const turn = (prompt: string, answer: string) => ({ prompt, steps: [{ blocks: [{ type: 'text', text: answer }], calls: [] }], results: new Map() });
const history = (turns: any[]) => ({ id: 'native-1', cwd: '/work', createdAt: 1000, title: 'test', turns });
const initial = (turns: any[], route = 'claude') => buildSessionEvents({ history: history(turns), route, sessionId: 'dsh-1', model: 'test' }).events;

test('a native answer can continue within the same turn, with only new text added, across process restarts', () => {
  let events = initial([turn('question', 'First part.')]);
  const update = history([turn('question', 'First part. Now complete.')]);
  const added = nativeUpdates({ events, history: update, route: 'claude', sessionId: 'dsh-1' });
  assert.deepEqual(added.filter((event: any) => event.type === 'assistant/message').flatMap((event: any) => event.data.message.content), [{ type: 'text', text: ' Now complete.' }]);
  assert.equal(added.some((event: any) => event.type === 'user/message'), false);
  events = [...events, ...added];
  assert.deepEqual(nativeUpdates({ events, history: update, route: 'claude', sessionId: 'dsh-1' }), []);
});

test('Codex updates after turns already continued in DSH do not repeat either side of the conversation', () => {
  const turns = [turn('first', 'one'), turn('second', 'two')];
  const events = initial(turns, 'codex');
  const update = history([...turns, turn('third', 'three')]);
  const added = nativeUpdates({ events, history: update, route: 'codex', sessionId: 'dsh-1' });
  assert.deepEqual(added.filter((event: any) => event.type === 'user/message').map((event: any) => event.data.content), [[{ type: 'text', text: 'third' }]]);
  assert.equal(added.find((event: any) => event.type === 'turn/start')?.data.turn, 3);
  assert.deepEqual(nativeUpdates({ events: [...events, ...added], history: update, route: 'codex', sessionId: 'dsh-1' }), []);
});

test('repeated polling of an unfinished native turn never produces continuation turns', () => {
  const first = turn('first', 'done');
  const events = initial([first], 'codex');
  for (const text of ['Working.', 'Working. Still going.', 'Working. Still going. Almost there.']) {
    const update = history([first, { ...turn('second', text), complete: false }]);
    const updates = nativeUpdates({ events, history: update, route: 'codex', sessionId: 'dsh-1' });
    events.push(...updates);
    assert.equal(events.filter((event: any) => event.type === 'turn/start').length, 2);
    assert.equal(events.filter((event: any) => event.type === 'turn/end').length, 1);
    assert.deepEqual(nativeUpdates({ events, history: update, route: 'codex', sessionId: 'dsh-1' }), []);
  }
  const finished = history([first, { ...turn('second', 'Working. Still going. Almost there. Complete.'), complete: true }]);
  const updates = nativeUpdates({ events, history: finished, route: 'codex', sessionId: 'dsh-1' });
  assert.equal(updates.filter((event: any) => event.type === 'turn/start').length, 0);
  assert.equal(updates.filter((event: any) => event.type === 'turn/end').length, 1);
  assert.equal(updates.find((event: any) => event.type === 'turn/end')?.data.turn, 2);
  assert.deepEqual(nativeUpdates({ events: [...events, ...updates], history: finished, route: 'codex', sessionId: 'dsh-1' }), []);
});

test('mid-turn inputs and their answers append in order and are consumed on the next poll', () => {
  const first = turn('first', 'done');
  const pending = { ...turn('second', 'Checking.'), id: 'two', complete: false };
  const events = initial([first], 'codex');
  events.push(...nativeUpdates({ events, history: history([first, pending]), route: 'codex', sessionId: 'dsh-1' }));
  const supplemented = { ...pending, steps: [...pending.steps, {
    input: { id: 'supplement', prompt: 'Also check this.' }, blocks: [{ type: 'text', text: 'Following up.' }], calls: [],
  }] };
  const added = nativeUpdates({ events, history: history([first, supplemented]), route: 'codex', sessionId: 'dsh-1' });
  assert.deepEqual(added.filter((event: any) => event.type === 'user/message').map((event: any) => event.data.content[0].text), ['Also check this.']);
  assert.equal(added.some((event: any) => event.type === 'turn/start' || event.type === 'turn/end'), false);
  events.push(...added);
  assert.deepEqual(nativeUpdates({ events, history: history([first, supplemented]), route: 'codex', sessionId: 'dsh-1' }), []);
});

test('pending tools get no fabricated result and join the open turn once the real output exists', () => {
  const first = turn('first', 'done');
  const events = initial([first]);
  const working = {
    ...turn('second', 'Reading.'), id: 'two', complete: false,
    steps: [{ blocks: [{ type: 'text', text: 'Reading.' }, { type: 'tool-call', id: 'read-2', name: 'Read', arguments: '{}' }], calls: [{ id: 'read-2' }] }],
  };
  const partial = nativeUpdates({ events, history: history([first, working]), route: 'claude', sessionId: 'dsh-1' });
  events.push(...partial);
  assert.equal(partial.some((event: any) => event.type === 'tool/result' || event.type === 'turn/end'), false);
  const finished = {
    ...working, complete: true, results: new Map([['read-2', { output: 'Actual file contents.' }]]),
    steps: [...working.steps, turn('', 'Finished.').steps[0]],
  };
  const update = nativeUpdates({ events, history: history([first, finished]), route: 'claude', sessionId: 'dsh-1' });
  assert.equal(update.filter((event: any) => event.type === 'turn/start' || event.type === 'user/message').length, 0);
  assert.equal(update.filter((event: any) => event.type === 'tool/result').length, 1);
  assert.equal(update.find((event: any) => event.type === 'tool/result')?.data.meta.output, 'Actual file contents.');
  assert.deepEqual(nativeUpdates({ events: [...events, ...update], history: history([first, finished]), route: 'claude', sessionId: 'dsh-1' }), []);
});

test('native observation holds one live reservation, releases on completion, and yields to new DSH input', async () => {
  const first = turn('first', 'done');
  const events = initial([first], 'codex');
  const abort = new AbortController();
  let inserted: (() => void) | undefined;
  let running: Promise<unknown> | undefined;
  let reservations = 0;
  const live = {
    status: 'idle', phase: { kind: 'idle', lastTurn: 1 },
    ctx: { on: (_name: string, fn: () => void) => { inserted = fn; return () => { inserted = undefined; }; } },
    session: {
      get seq() { return events.length; },
      append(type: string, data: any, options: any) { events.push({ seq: events.length, time: 2000 + events.length, type, data, ...options }); },
    },
    runMaintenance: (job: (signal: AbortSignal) => unknown) => {
      reservations++;
      const reserved = { ...live.phase, kind: 'maintenance' };
      live.phase = reserved;
      running = Promise.resolve(job(abort.signal)).finally(() => { live.phase = { kind: 'idle', lastTurn: reserved.lastTurn }; });
      return running;
    },
  };
  const sync = createNativeSync({
    persistence: () => ({ open() { throw new Error('the live writer is already owned'); }, flush: async () => {} }),
    controller: () => ({ inspect: async () => ({ events: [...events] }) }), agents: () => ({ get: () => live }),
  });
  const request = (turns: any[]) => ({ sessionId: 'dsh-1', route: 'codex', history: history(turns) });
  const pending = { ...turn('second', 'Working.'), id: 'two', complete: false };
  assert.equal((await sync(request([first, pending]))).updated, true);
  assert.equal(live.phase.kind, 'maintenance');
  assert.equal((await sync(request([first, pending]))).updated, false);
  assert.equal(reservations, 1);
  assert.equal(events.filter((event: any) => event.type === 'turn/end').length, 1);
  assert.equal((await sync(request([first, { ...turn('second', 'Working. Complete.'), id: 'two', complete: true }]))).updated, true);
  await running;
  assert.equal(live.phase.kind, 'idle');
  assert.equal(live.phase.lastTurn, 2);
  assert.equal(events.at(-1)?.data.reason.kind, 'completed');
  const third = { ...turn('third', 'Waiting.'), id: 'three', complete: false };
  await sync(request([first, { ...turn('second', 'Working. Complete.'), id: 'two', complete: true }, third]));
  assert.equal(reservations, 2);
  inserted!();
  await running;
  assert.equal(live.phase.kind, 'idle');
  assert.equal(live.phase.lastTurn, 3);
  assert.equal(events.at(-1)?.data.reason.kind, 'interrupted');
  assert.equal(events.at(-1)?.data.turn, 3);
});

test('a TUI rewind or an older native store does not overwrite or replay a newer DSH branch', () => {
  const events = initial([turn('first', 'one'), turn('DSH-only input', 'two')]);
  assert.deepEqual(nativeUpdates({ events, history: history([turn('first', 'one')]), route: 'claude', sessionId: 'dsh-1' }), []);
  assert.deepEqual(nativeUpdates({ events, history: history([turn('first', 'different'), turn('another branch', 'three')]), route: 'claude', sessionId: 'dsh-1' }), []);
});

test('live synchronization publishes through Session.append during idle maintenance and never takes a second writer', async () => {
  const events = initial([turn('question', 'answer')]);
  let maintenance = 0;
  const live = {
    status: 'idle',
    phase: { kind: 'idle', lastTurn: 1 },
    session: {
      get seq() { return events.length; },
      append(type: string, data: any, options: any) { events.push({ seq: events.length, time: 2000 + events.length, type, data, ...options }); },
    },
    runMaintenance: async (job: () => unknown) => {
      maintenance++;
      const reservation = { ...live.phase, kind: 'maintenance' };
      live.phase = reservation;
      try { return await job(); }
      finally { live.phase = { kind: 'idle', lastTurn: reservation.lastTurn }; }
    },
  };
  const sync = createNativeSync({
    persistence: () => ({ open: () => { throw new Error('writer must not be opened'); }, flush: async () => {} }),
    agents: () => ({ get: () => live }),
    controller: () => ({ inspect: async () => ({ events: [...events] }) }),
  });
  const request = { sessionId: 'dsh-1', route: 'claude', history: history([turn('question', 'answer'), turn('next', 'new answer')]) };
  live.status = 'running';
  assert.equal((await sync(request)).deferred, true);
  assert.equal(maintenance, 0);
  live.status = 'idle';
  assert.equal((await sync(request)).updated, true);
  assert.equal(maintenance, 1);
  assert.equal(live.phase.lastTurn, 2, 'the next real prompt must start turn 3, not reuse imported turn 2');
  assert.equal((await sync(request)).updated, false);
});

test('live synchronization defers for an unknown driver instead of appending turns it cannot safely resume', async () => {
  const events = initial([turn('question', 'answer')]);
  const live = {
    status: 'idle',
    session: { seq: events.length, append() { throw new Error('unsafe append'); } },
    runMaintenance: async (job: () => unknown) => job(),
  };
  const sync = createNativeSync({
    persistence: () => ({ open() { throw new Error('a live writer already exists'); } }),
    agents: () => ({ get: () => live }),
    controller: () => ({ inspect: async () => ({ events: [...events] }) }),
  });
  assert.equal((await sync({
    sessionId: 'dsh-1', route: 'claude', history: history([turn('question', 'answer'), turn('next', 'new answer')]),
  })).deferred, true);
});

test('Properties exposes the native id and its exact resume command, including shell-safe quoting', async () => {
  const links = { nativeKey: () => 'claude:abc-123' };
  assert.deepEqual(await sessionInfo({ key: 'dsh:session-1', links }), { provider: 'claude', sessionId: 'abc-123', command: 'claude --resume abc-123' });
  assert.equal((await sessionInfo({ key: "codex:bad'; echo nope", links })).command, "codex resume 'bad'\\''; echo nope'");
  assert.equal((await sessionInfo({ key: 'dsh:session-2' })).command, null);
});
