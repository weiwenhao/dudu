import { readSessionHistory } from '../../dsh-session-history.mjs';
import { isHarness } from '../catalog.mjs';

const quote = (value) => /^[a-z0-9_-]+$/i.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;

/** Only a harness's own persisted assistant source establishes its native continuation identity. */
export function nativeIdentity(events = []) {
  const source = events.findLast((event) => {
    const source = event.type === 'assistant/message' && event.data?.message?.source;
    const replay = source?.replayState;
    return isHarness(replay?.harness) && source.provider === replay.harness &&
      typeof replay.nativeSessionId === 'string' && replay.nativeSessionId.length > 0;
  })?.data.message.source;
  return source ? { provider: source.replayState.harness, id: source.replayState.nativeSessionId } : null;
}

/** The native continuation identity is separate from DSH's own session id. */
export async function sessionInfo({ key, links, controller, query }) {
  if (!key) return {};
  let [provider, ...parts] = key.split(':');
  let id = parts.join(':');
  if (provider === 'dsh') {
    let native = links?.nativeKey(id);
    if (!native) {
      const { events } = await readSessionHistory({ controller, query }, id);
      const identity = nativeIdentity(events);
      if (identity) native = `${identity.provider}:${identity.id}`;
    }
    if (native) { [provider, ...parts] = native.split(':'); id = parts.join(':'); }
  }
  const command = provider === 'claude' ? `claude --resume ${quote(id)}` : provider === 'codex' ? `codex resume ${quote(id)}` : provider === 'pi' ? `pi --session ${quote(id)}` : null;
  return { sessionId: id, provider, command };
}
