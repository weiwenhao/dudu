import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { codexUsage, usageDelta } from '../usage.mjs';

/** Read only native timing and token counters; thread/read remains the authority for conversation contents. */
export async function readCodexMetrics(file) {
  const turns = new Map();
  if (!file) return turns;
  let current;
  let total;
  const turnOf = (id) => {
    if (!id) return undefined;
    if (!turns.has(id)) turns.set(id, { items: new Map() });
    return turns.get(id);
  };
  try {
    const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"event_msg"') && !line.includes('"token_usage_record"') && !line.includes('"turn_context"')) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const data = record.payload;
      if (!data) continue;
      if (record.type === 'turn_context' || data.type === 'task_started') current = data.turn_id ?? current;
      const turn = turnOf(data.turn_id ?? current);
      if (!turn) continue;
      if (record.type === 'token_usage_record') {
        const usage = codexUsage(data.turn_token_usage);
        if (usage) turn.usage = usage;
      } else if (data.type === 'token_count' && data.info) {
        const next = codexUsage(data.info.total_token_usage);
        if (next) {
          const delta = usageDelta(next, total);
          total = next;
          turn.fallbackUsage ??= {};
          for (const [key, value] of Object.entries(delta)) turn.fallbackUsage[key] = (turn.fallbackUsage[key] ?? 0) + value;
        }
      } else if (data.type === 'item_completed' && data.item?.id) {
        turn.items.set(data.item.id, { start: data.started_at_ms, end: data.completed_at_ms ?? Date.parse(record.timestamp) });
      } else if (data.type === 'task_complete' || data.type === 'turn_aborted') {
        turn.endedAt = Date.parse(record.timestamp);
        turn.interrupted = data.type === 'turn_aborted';
      }
    }
  } catch { /* old or missing rollouts still load without metrics */ }
  return turns;
}
