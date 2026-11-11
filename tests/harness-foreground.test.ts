import assert from 'node:assert/strict';
import test from 'node:test';
import { installHarnessForeground } from '../host/dudu-plugin/ui/lib/harness-foreground.js';

test('background observation stays inside its conversation without replacing the host message flow', async () => {
  let component;
  let state;
  let dependencies;
  let effect;
  let cleanup;
  let mounted = true;
  const registrations = [];
  const calls = [];
  const props = {
    sessionId: 'one',
    useSession: (select) => select({ running: true }),
    // The next choice may already differ from the provider that is running.
    useProjection: () => ({ lastUsed: { provider: 'codex' }, next: { provider: 'deepseek' } }),
  };
  const ctx = { slots: {
    inject(slot, start) {
      assert.equal(slot, 'conversation.composer.dock', 'observe inside the existing conversation; never shadow its message flow');
      return start();
    },
    register(options, render) {
      registrations.push(options);
      component = render;
      return () => { mounted = false; };
    },
  } };
  const dispose = installHarnessForeground(ctx, {
    createElement: (type, attributes) => ({ type, attributes }),
    useState: () => [state, (value) => { state = value; }],
    useEffect(start, next) {
      if (dependencies && next.every((value, index) => Object.is(value, dependencies[index]))) return;
      dependencies = next;
      effect = start;
    },
  }, (action, body, { signal }) => {
    const pending = Promise.withResolvers();
    calls.push({ action, body, signal, ...pending });
    return pending.promise;
  });
  const render = () => {
    const element = component(props);
    if (effect) {
      cleanup?.();
      cleanup = effect();
      effect = undefined;
    }
    return element;
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].name, 'conversation.composer.dock');
    assert.equal(registrations[0].children, undefined, 'the native flow retains ownership of its child slots');
    render();
    assert.equal(calls[0].action, 'providers/foreground');
    assert.deepEqual(calls[0].body, { sessionId: 'one' });
    calls[0].resolve({ backgroundOnly: true });
    await flush();
    assert.equal(render().attributes['data-dudu-harness-background'], '');
    assert.deepEqual(calls[1].body, { sessionId: 'one', after: true });

    // Reusing an occurrence for another session cannot hide its foreground using the old session's answer.
    props.sessionId = 'two';
    assert.equal(render().attributes['data-dudu-harness-background'], undefined);
    assert.equal(calls[1].signal.aborted, true);
    calls[1].resolve({ backgroundOnly: true });
    await flush();
    assert.equal(render().attributes['data-dudu-harness-background'], undefined);
    assert.deepEqual(calls[2].body, { sessionId: 'two' });
    calls[2].resolve({ backgroundOnly: true });
    await flush();
    assert.equal(render().attributes['data-dudu-harness-background'], '');
    calls[3].resolve({ backgroundOnly: false });
    await flush();
    assert.equal(render().attributes['data-dudu-harness-background'], undefined, 'real continuation restores foreground activity');
    props.useSession = (select) => select({ running: false });
    render();
    assert.equal(calls[4].signal.aborted, true);
    calls[4].resolve({ backgroundOnly: true });
    await flush();
    assert.equal(render().attributes['data-dudu-harness-background'], undefined);
    assert.equal(calls.length, 5);
  } finally {
    cleanup?.();
    dispose();
  }
  assert.equal(mounted, false);
});
