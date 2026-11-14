import { isHarness } from './providers/catalog.mjs';
const text = (value) => typeof value === 'string' && value.length > 0;

/** First observed output chunk in a DSH stream, including its compact persisted representation. */
export function firstToken(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (const item of stream) {
    if (item?.type === 'chunk') {
      const chunk = item.chunk;
      if (Number.isFinite(item.time) && (['text-delta', 'reasoning-delta'].includes(chunk?.type) && text(chunk.text)
        || chunk?.type === 'tool-call-delta' && (text(chunk.argumentsDelta) || chunk.name !== undefined))) return item.time;
    } else if (Number.isFinite(item?.time0)) {
      if (item.type === 'tool-call-chunks' && item.name !== undefined) return item.time0;
      const fragments = item.type === 'tool-call-chunks' ? item.args : item.texts;
      if (!Array.isArray(fragments)) continue;
      let time = item.time0;
      for (let index = 0; index < fragments.length; index += 1) {
        if (index > 0) time += item.dt?.[index - 1] ?? 0;
        if (text(fragments[index])) return time;
      }
    }
  }
  return undefined;
}

// Native turn totals and DSH replay timestamps cannot measure a model's per-message generation speed.
export const isHarnessMessage = (message) => isHarness(message?.source?.replayState?.harness ?? message?.source?.provider);

export function withoutHarnessTiming(stats, excluded) {
  if (!stats || !excluded || !(excluded.decodeMs > 0 || excluded.decodeTokens > 0)) return stats;
  return {
    ...stats,
    decodeMs: Math.max(0, stats.decodeMs - excluded.decodeMs),
    decodeTokens: Math.max(0, stats.decodeTokens - excluded.decodeTokens),
  };
}
