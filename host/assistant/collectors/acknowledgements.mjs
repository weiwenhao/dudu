// Owner, 2026-11-19: a collected Lark message gets the built-in GET reaction, after it is stored. Owner, 2026-11-20 ("我希望能够在提示词里边控制"): only when the collector's prompt asks for it: the session marks the record
// `acknowledge: true`, the reaction itself is still made here. This is not an agent tool or a source-write permission.
import { baseEnv, runProcess, which as findOnPath } from '../connectors/cli.mjs';
import { normalizeRecords, RECORD_LIMITS } from '../inbox/records.mjs';

const MESSAGE_ID = /^om_[A-Za-z0-9_-]{1,128}$/;
const EMOJI = 'Get';

/** Only primary messages the prompt asked to answer (`acknowledge: true`) whose text is in a committed row, never context, update requests, thread ids, or another collector's rows. */
export function acknowledgementTargets(collector, raw, stored) {
  const via = collector.via;
  if (via?.kind !== 'prompt' || !(via.via === 'lark' || /\blark-cli\b/.test(via.prompt ?? ''))) return [];
  const kept = new Map(stored.filter((row) => row.connector === collector.id).map((row) => [row.sourceId, row]));
  const ids = new Set();
  for (const record of raw.slice(0, RECORD_LIMITS.records)) {
    if (record.acknowledge !== true || record.update || !['message', 'comment'].includes(record.kind) || typeof record.id !== 'string' || !MESSAGE_ID.test(record.id)) continue;
    const primary = normalizeRecords([{ ...record, context: [] }]).records[0];
    const row = primary && kept.get(primary.sourceId);
    if (row && primary.text && row.text.includes(primary.text)) ids.add(record.id);
  }
  return [...ids];
}

export function createCollectorAcknowledgements({ run = runProcess, which = findOnPath, env = process.env, warn = console.warn } = {}) {
  return async (collector, raw, stored, { signal } = {}) => {
    const targets = acknowledgementTargets(collector, raw, stored);
    if (!targets.length) return null;
    const environment = baseEnv(env);
    const command = which('lark-cli', environment);
    const added = [];
    const failed = [];
    const bounded = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    let next = 0;
    async function worker() {
      while (next < targets.length) {
        const messageId = targets[next++];
        let code = !command ? 'command_not_found' : bounded.aborted ? 'collection_stopped' : null;
        if (!code) {
          try {
            // No shell, model-selected command, token access or sign-in. The CLI uses the owner's existing user login.
            const result = await run(command, [
              'im', 'reactions', 'create', '--as', 'user', '--format', 'json',
              '--params', JSON.stringify({ message_id: messageId }),
              '--data', JSON.stringify({ reaction_type: { emoji_type: EMOJI } }),
            ], { env: environment, signal: bounded, timeoutMs: 10_000, maxBytes: 32_768 });
            let body;
            try { body = JSON.parse(result.code === 0 ? result.stdout : result.stderr); } catch { /* no trusted response */ }
            if (result.code === 0 && body?.ok === true && body.identity === 'user' &&
                typeof body.data?.reaction_id === 'string' && body.data.reaction_id &&
                body.data.reaction_type?.emoji_type === EMOJI) {
              added.push({ messageId, reactionId: body.data.reaction_id });
              continue;
            }
            code = typeof body?.error?.subtype === 'string' && /^[a-z_]{1,60}$/.test(body.error.subtype) ? body.error.subtype : 'reaction_failed';
          } catch { code = 'reaction_failed'; }
        }
        failed.push({ messageId, code });
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
    if (failed.length) warn(`[dudu] Collector ${collector.id}: ${failed.length} GET acknowledgements failed (${[...new Set(failed.map((item) => item.code))].join(', ')}). Records remain stored.`);
    return { ok: failed.length === 0, emoji: EMOJI, added, failed };
  };
}
