const count = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** OAR and Codex count cached input inside input; DSH keeps the three input counters disjoint. */
export function inclusiveUsage({ input, output, cacheRead, cacheWrite, reasoning } = {}) {
  if (count(input) === undefined || count(output) === undefined) return undefined;
  const read = count(cacheRead); const write = count(cacheWrite); const thinking = count(reasoning);
  return {
    inputTokens: Math.max(0, input - (read ?? 0) - (write ?? 0)), outputTokens: output,
    totalTokens: input + output,
    ...(read === undefined ? {} : { cacheReadTokens: read }),
    ...(write === undefined ? {} : { cacheWriteTokens: write }),
    ...(thinking === undefined ? {} : { reasoningTokens: thinking }),
  };
}

export function codexUsage(usage) {
  return usage ? inclusiveUsage({
    input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cached_input_tokens,
    cacheWrite: usage.cache_write_input_tokens, reasoning: usage.reasoning_output_tokens,
  }) : undefined;
}

export function claudeUsage(usage) {
  if (count(usage?.input_tokens) === undefined || count(usage?.output_tokens) === undefined) return undefined;
  return inclusiveUsage({
    input: usage.input_tokens + (count(usage.cache_read_input_tokens) ?? 0) + (count(usage.cache_creation_input_tokens) ?? 0),
    output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens,
  });
}

/** A native cumulative counter reported again must never charge those tokens twice. */
export function usageDelta(current, previous = {}) {
  return Object.fromEntries(Object.entries(current).map(([key, value]) => [key, Math.max(0, value - (previous[key] ?? 0))]));
}
