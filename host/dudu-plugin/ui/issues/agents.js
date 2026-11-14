import { useEffect, useState } from 'react';
import { useServices } from '../services.jsx';
import { agentIds } from './model.js';

/** `agentIds` for the providers as they are now: read when the menu mounts and again whenever Settings changes them. */
export function useAgentIds(keep, request) {
  const services = useServices();
  const ask = request ?? services.request;
  const [providers, setProviders] = useState(null);
  useEffect(() => {
    let alive = true;
    const read = () => ask('providers/state').then((value) => { if (alive) setProviders(Array.isArray(value?.providers) ? value.providers : null); }, () => {});
    read();
    window.addEventListener('dudu:providers-changed', read);
    return () => { alive = false; window.removeEventListener('dudu:providers-changed', read); };
  }, [ask]);
  return agentIds(providers, keep);
}
