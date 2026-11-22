import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createBoardWake } from '../host/native-board-wake.mjs';

test('a phone that is away is woken at the first change and once more at the end of the gap; a phone in front, one that did not ask, or one that came back is not', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let clock = 1_000_000;
    const gapMs = 180_000;
    const woken: string[] = [];
    let front = new Set(['front']);
    const wake = createBoardWake({
      candidates: () => ['a', 'b', 'front'], // the phones that declared `board.wake`
      isAway: (id: string) => !front.has(id),
      wake: (id: string) => { woken.push(id); },
      gapMs, now: () => clock,
    });
    const advance = (ms: number) => { clock += ms; mock.timers.tick(ms); };

    wake.changed();
    assert.deepEqual(woken.splice(0), ['a', 'b'], 'the first change after a quiet time goes at once, and not to a phone in front');
    advance(10_000);
    wake.changed(); wake.changed(); wake.changed();
    assert.deepEqual(woken, [], 'a burst inside the gap sends nothing yet');
    advance(gapMs - 10_000);
    assert.deepEqual(woken.splice(0), ['a', 'b'], 'it goes as one wake when the gap is over');
    advance(gapMs);
    assert.deepEqual(woken, [], 'and nothing more was waiting');

    wake.changed();
    assert.deepEqual(woken.splice(0), ['a', 'b'], 'a change after a quiet gap goes at once again');
    advance(60_000);
    wake.changed();
    front = new Set(['a', 'front']); // `a` came back before its wake was due
    advance(gapMs - 60_000);
    assert.deepEqual(woken.splice(0), ['b'], 'a phone that is back in front by then is not woken');

    wake.changed();
    wake.close();
    advance(10 * gapMs);
    assert.deepEqual(woken, [], 'a closed wake sends nothing');
  } finally { mock.timers.reset(); }
});

test('a notice goes to the phones that are away at once, whatever the gap, and starts the gap itself', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let clock = 5_000_000;
    const gapMs = 180_000;
    const woken: string[] = [];
    const noticed: string[] = [];
    const wake = createBoardWake({
      candidates: () => ['a', 'front'],
      isAway: (id: string) => id !== 'front',
      wake: (id: string) => { woken.push(id); },
      notice: (id: string, event: any) => { noticed.push(`${id}:${event.title}`); },
      gapMs, now: () => clock,
    });
    const advance = (ms: number) => { clock += ms; mock.timers.tick(ms); };

    wake.changed();
    assert.deepEqual(woken.splice(0), ['a']);
    advance(10_000);
    wake.changed(); // would wait for the end of the gap
    wake.announce({ title: 'one' });
    assert.deepEqual(noticed.splice(0), ['a:one'], 'a notice does not wait for the gap, and does not go to a phone in front');
    advance(gapMs);
    assert.deepEqual(woken, [], 'what waited is covered by the notice: no silent wake follows it');
    wake.changed();
    assert.deepEqual(woken.splice(0), ['a'], 'the gap began at the notice, and is over');
    wake.announce({ title: 'two' });
    assert.deepEqual(noticed.splice(0), ['a:two'], 'a second notice right after is not held back');
  } finally { mock.timers.reset(); }
});

