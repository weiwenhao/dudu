import { mirrorNativeSlot } from './native-slots.js';

/** Keep native sending/queuing intact while an empty composer reflects the idle native foreground. */
export function installHarnessForeground(ctx, { createElement: h, useEffect, useState }, request) {
  const slot = 'conversation.composer.bar';
  const registrant = 'dudu:harness-foreground';
  function Foreground({ NativeComposer, ...props }) {
    const running = props.useSession((state) => state.running);
    const selection = props.useProjection('modelSelection');
    const provider = (selection?.lastUsed ?? selection?.next)?.provider;
    const observe = running && ['claude', 'codex'].includes(provider);
    const empty = props.useInput((input) => input === undefined || (
      input.phase === 'plain' && input.draft.trim() === '' && input.attachmentIds.length === 0 && input.queue.length === 0
    ));
    const submitting = props.useSession((state) => state.pendingSubmissions.length > 0);
    const [background, setBackground] = useState(null);
    useEffect(() => {
      setBackground(null);
      if (!observe) return;
      const controller = new AbortController();
      void (async () => {
        let after;
        try {
          while (!controller.signal.aborted) {
            const value = await request('providers/foreground', { sessionId: props.sessionId, ...(after === undefined ? {} : { after }) },
              { signal: controller.signal });
            if (controller.signal.aborted) return;
            after = value.backgroundOnly;
            setBackground({ sessionId: props.sessionId, value: after });
          }
        } catch {
          if (!controller.signal.aborted) setBackground(null);
        }
      })();
      return () => controller.abort();
    }, [observe, props.sessionId]);
    const backgroundOnly = observe && background?.sessionId === props.sessionId && background.value === true;
    // Only the empty, unclaimed input gets an idle presentation. With a draft,
    // attachment, queue or pending submission the host sees its real running
    // state, retaining its delivery mode, keyboard behavior and upload gates.
    // The Session store and the native child controls always keep that state.
    const idleComposer = backgroundOnly && empty && !submitting && props.blocked === undefined;
    const useSession = (select, ...options) => props.useSession(
      (state) => select(idleComposer ? { ...state, running: false } : state), ...options,
    );
    return h('div', { style: { display: 'contents' }, 'data-dudu-harness-background': backgroundOnly ? '' : undefined },
      h(NativeComposer, { ...props, useSession }));
  }
  return mirrorNativeSlot(ctx, h, slot, slot,
    (NativeComposer, props) => h(Foreground, { ...props, NativeComposer }),
    (entry) => entry.registrant !== registrant,
    (options) => ({ priority: (options.priority ?? 0) - 1, registrant }));
}
