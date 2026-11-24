import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { Minimize2 } from 'lucide-react';

const ReturnContext = createContext(null);

/** Keep the page's UI state in memory: an expansion's return and Dudu's own icon both come back to the page as it was left (`createSessionExpansion.takePage`). */
export function SessionReturnProvider({ expansion, children }) {
  const [values] = useState(() => expansion?.takePage() ?? new Map());
  useLayoutEffect(() => { expansion?.capturePage(values); }, [expansion, values]);
  const state = useMemo(() => ({ values, prefix: 'page' }), [values]);
  return <ReturnContext.Provider value={state}>{children}</ReturnContext.Provider>;
}

export function SessionReturnScope({ id, children }) {
  const parent = useContext(ReturnContext);
  const state = useMemo(() => parent ? { ...parent, prefix: `${parent.prefix}/${id}` } : null, [parent, id]);
  return <ReturnContext.Provider value={state}>{children}</ReturnContext.Provider>;
}

export function useSessionReturnState(key, initial) {
  const context = useContext(ReturnContext);
  const address = `${context?.prefix}/${key}`;
  const [value, setValue] = useState(() => context?.values.has(address)
    ? context.values.get(address) : typeof initial === 'function' ? initial() : initial);
  useLayoutEffect(() => { context?.values.set(address, value); }, [context, address, value]);
  return [value, setValue];
}

/** Two inward arrows in the host's compact Button, as approved for returning from an expansion. */
export function SessionReturnIcon() { return <Minimize2 aria-hidden="true" />; }
