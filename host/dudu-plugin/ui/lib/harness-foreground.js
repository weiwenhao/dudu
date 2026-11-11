/** Observe inside the host conversation; the native flow keeps ownership of its message slots. */
export function installHarnessForeground(ctx, { createElement: h, useEffect, useState }, request) {
  const slot = 'conversation.composer.dock';
  function Foreground(props) {
    const running = props.useSession((state) => state.running);
    const selection = props.useProjection('modelSelection');
    const provider = (selection?.lastUsed ?? selection?.next)?.provider;
    const observe = running && ['claude', 'codex'].includes(provider);
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
    // The marker and the running indicator share this occurrence's data-conversation-session ancestor.
    return h('span', { hidden: true, 'data-dudu-harness-background': backgroundOnly ? '' : undefined });
  }
  return ctx.slots.inject(slot, () => ctx.slots.register({
    name: slot, id: 'dudu:harness-foreground', order: -1,
  }, Foreground));
}
