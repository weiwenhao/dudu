import assert from 'node:assert/strict';
import test from 'node:test';
import { installHarnessForeground } from '../host/dudu-plugin/ui/lib/harness-foreground.js';

test('background waiting changes only the empty native composer, preserving delivery and owned child slots', async () => {
  const slot = 'conversation.composer.bar';
  const dock = 'conversation.composer.dock';
  const calls: any[] = [];
  const deliveries: any[] = [];
  const renderedSlots: any[] = [];
  const snapshots = new Map<string, any[]>();
  const listeners = new Map<string, Set<() => void>>();
  const mutated = (name: string) => {
    for (const listener of listeners.get(name) ?? []) {
      queueMicrotask(() => { if (listeners.get(name)?.has(listener)) listener(); });
    }
  };
  const original = {
    options: { priority: 10 }, registrant: 'host:conversation',
    locale: 'conversation', inject: () => ({ stop: () => {} }),
    children: { [dock]: { kind: 'list', scope: 'session' } },
    component: (props: any) => ({
      session: props.useSession((state: any) => state),
      keyboard: props.keyboard, stop: props.stop, inputActions: props.inputActions,
      input: props.useInput((input: any) => input),
      dock: props.renderSlot(dock, { occurrence: 'embedded' }),
    }),
  };
  snapshots.set(slot, [original]);
  snapshots.set(dock, [{ options: { id: 'usage' }, component: () => null }]);
  const ctx = { slots: {
    entries: (name: string) => snapshots.get(name) ?? [],
    inject: (_name: string, start: Function) => start(),
    subscribe(name: string, listener: () => void) {
      const entries = listeners.get(name) ?? new Set();
      entries.add(listener);
      listeners.set(name, entries);
      return () => { entries.delete(listener); };
    },
    register({ name, children, locale, inject, registrant, ...options }: any, component: Function) {
      const entry = { options, children, locale, inject, registrant, component };
      snapshots.set(name, [...snapshots.get(name) ?? [], entry]);
      mutated(name);
      return () => {
        snapshots.set(name, snapshots.get(name)!.filter(item => item !== entry));
        mutated(name);
      };
    },
  } };
  let background: any;
  let dependencies: any[] | undefined;
  let effect: Function | undefined;
  let cleanup: Function | undefined;
  const input = { phase: 'plain', draft: '', attachmentIds: [] as string[], queue: [] as string[] };
  const session = { running: true, pendingSubmissions: [] as string[], removed: false };
  let selection = { lastUsed: { provider: 'claude' }, next: { provider: 'deepseek' } };
  const props = {
    sessionId: 'one', blocked: undefined as string | undefined,
    useSession: (select: Function) => select(session),
    useProjection: () => selection,
    useInput: (select: Function) => select(input),
    keyboard: { submit: (...args: any[]) => { deliveries.push(args); } },
    stop: () => { throw new Error('Observation must never stop native work.'); },
    inputActions: { submit: () => {} },
    renderSlot: (...args: any[]) => { renderedSlots.push(args); },
  };
  const dispose = installHarnessForeground(ctx, {
    createElement: (type: any, attributes: any, ...children: any[]) => ({ type, attributes, children }),
    useState: () => [background, (value: any) => { background = value; }],
    useEffect(start: Function, next: any[]) {
      if (dependencies && next.every((value, index) => Object.is(value, dependencies![index]))) return;
      dependencies = next;
      effect = start;
    },
  }, (action: string, body: any, { signal }: any) => {
    const pending = Promise.withResolvers();
    calls.push({ action, body, signal, ...pending });
    return pending.promise;
  });
  const wrapper = () => snapshots.get(slot)!.find(entry => entry.registrant === 'dudu:harness-foreground');
  const render = () => {
    const outer = wrapper().component(props);
    const node = outer.type(outer.attributes);
    if (effect) {
      cleanup?.();
      cleanup = effect();
      effect = undefined;
    }
    const native = node.children[0];
    assert.equal(native.type, original.component, 'reuse the host composer');
    return { attributes: node.attributes, native: native.type(native.attributes) };
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    await flush();
    assert.equal(snapshots.get(slot)!.length, 2, 'the wrapper must not wrap itself');
    assert.equal(wrapper().inject, original.inject);
    assert.equal(wrapper().locale, original.locale);
    assert.equal(wrapper().options.priority, 9);
    const privateDock = Object.keys(wrapper().children)[0];
    assert.equal(snapshots.get(privateDock)![0].options.id, 'usage');
    render();
    assert.deepEqual(renderedSlots.at(-1), [privateDock, { occurrence: 'embedded' }]);
    assert.equal(calls[0].action, 'providers/foreground');
    assert.deepEqual(calls[0].body, { sessionId: 'one' });
    calls[0].resolve({ backgroundOnly: true });
    await flush();
    const idle = render();
    assert.equal(idle.attributes['data-dudu-harness-background'], '');
    assert.equal(idle.native.session.running, false);
    assert.equal(session.running, true, 'never alter the real Session or native run');
    assert.equal(idle.native.session.removed, false);
    assert.equal(idle.native.keyboard, props.keyboard);
    assert.equal(idle.native.stop, props.stop);
    assert.equal(idle.native.inputActions, props.inputActions);
    assert.deepEqual(calls[1].body, { sessionId: 'one', after: true });

    input.draft = 'Another message';
    const draft = render();
    assert.equal(draft.native.session, session);
    assert.equal(draft.native.input, input);
    draft.native.keyboard.submit('steer', 'click');
    draft.native.keyboard.submit('queue', 'enter');
    assert.deepEqual(deliveries, [['steer', 'click'], ['queue', 'enter']], 'native modes pass through unchanged');
    input.draft = '';
    for (const phase of ['claimed', 'adjudicating', 'submitting', 'sending']) {
      input.phase = phase;
      assert.equal(render().native.session, session, phase);
    }
    input.phase = 'plain';
    input.attachmentIds.push('file');
    assert.equal(render().native.session, session);
    input.attachmentIds.length = 0;
    input.queue.push('queued');
    assert.equal(render().native.session, session, 'keep native queue gestures');
    input.queue.length = 0;
    session.pendingSubmissions.push('pending');
    assert.equal(render().native.session, session, 'keep in-flight submission controls');
    session.pendingSubmissions.length = 0;
    props.blocked = 'model';
    assert.equal(render().native.session, session);
    props.blocked = undefined;
    assert.equal(render().native.session.running, false);

    props.sessionId = 'two';
    assert.equal(render().attributes['data-dudu-harness-background'], undefined);
    assert.equal(calls[1].signal.aborted, true);
    calls[1].resolve({ backgroundOnly: true });
    await flush();
    assert.equal(render().native.session, session, 'ignore a previous session’s late reply');
    assert.deepEqual(calls[2].body, { sessionId: 'two' });
    calls[2].resolve({ backgroundOnly: true });
    await flush();
    assert.equal(render().native.session.running, false);
    calls[3].resolve({ backgroundOnly: false });
    await flush();
    assert.equal(render().native.session, session, 'native continuation restores foreground presentation');
    selection = { lastUsed: { provider: 'deepseek' }, next: { provider: 'claude' } };
    render();
    assert.equal(calls[4].signal.aborted, true, 'next-turn selection cannot override the current provider');
    calls[4].resolve({ backgroundOnly: true });
    await flush();
    assert.equal(render().native.session, session);
    assert.equal(calls.length, 5);
  } finally {
    cleanup?.();
    dispose();
    await flush();
  }
  assert.deepEqual(snapshots.get(slot), [original]);
  assert.equal(snapshots.get(dock)!.length, 1);
  assert.ok([...snapshots.entries()].every(([name, entries]) => !name.startsWith(`${slot}.`) || entries.length === 0),
    'unload releases the private controls, preserving native ownership');
});
