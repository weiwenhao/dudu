import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const INPUT_DELIVERY = 'dudu/harness-input';
const recoverable = new Set(['preparing', 'undelivered']);
const receiptOf = (event, provider) => event.type === INPUT_DELIVERY && event.data?.version === 1
  && event.data.provider === provider && Array.isArray(event.data.messageIds) ? event.data : undefined;

/** Private provider metadata, outside DSH's closed event vocabulary. Each attempt keeps its latest durable phase. */
export function createInputJournal(folder) {
  const cached = new Map();
  const writing = new Map();
  const keyOf = (provider, sessionId) => createHash('sha256').update(JSON.stringify([provider, sessionId])).digest('hex');
  async function load(key) {
    if (cached.has(key)) return cached.get(key);
    const reading = readFile(join(folder, `${key}.json`), 'utf8')
      .then((body) => JSON.parse(body))
      .catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
    cached.set(key, reading);
    try { return await reading; }
    catch (error) {
      if (cached.get(key) === reading) cached.delete(key);
      throw error;
    }
  }
  return {
    async read(provider, sessionId) {
      const key = keyOf(provider, sessionId);
      await writing.get(key);
      return structuredClone(await load(key));
    },
    async record(provider, sessionId, entry) {
      const key = keyOf(provider, sessionId);
      entry = structuredClone(entry);
      const work = (writing.get(key) ?? Promise.resolve()).then(async () => {
        const previous = await load(key);
        const next = previous.filter((item) => item.attemptId !== entry.attemptId);
        next.push(entry);
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const path = join(folder, `${key}.json`);
        const temporary = `${path}.${randomUUID()}.tmp`;
        let file;
        try {
          file = await open(temporary, 'wx', 0o600);
          await file.writeFile(JSON.stringify(next) + '\n');
          await file.sync();
          await file.close();
          file = undefined;
          await rename(temporary, path);
          const directory = await open(folder, 'r');
          try { await directory.sync(); } finally { await directory.close(); }
          cached.set(key, Promise.resolve(next));
        } finally {
          await file?.close();
          await rm(temporary, { force: true });
        }
      });
      writing.set(key, work.catch(() => {}));
      await work;
    },
  };
}

/** Join private receipts to their original turn for analysis only; these records are never appended to a DSH session. */
export function withInputDeliveries(events, entries) {
  if (!events || !entries.length) return events;
  const turns = new Map();
  let current;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const seq = event.seq ?? i;
    if (event.type === 'turn/start') {
      current = { start: seq, end: seq };
      turns.set(event.data.turn, current);
    }
    if (current) current.end = seq;
  }
  const records = entries.flatMap((data) => {
    const turn = turns.get(data.turn);
    return turn ? [{
      type: INPUT_DELIVERY, data, seq: Math.max(turn.start, Math.min(data.afterSeq, turn.end)) + 0.5,
    }] : [];
  });
  return [...events.map((event, i) => ({ ...event, seq: event.seq ?? i })), ...records].sort((a, b) => a.seq - b.seq);
}

/**
 * Only carry inputs whose delivery is known not to have happened. A later accepted/ambiguous turn is a boundary:
 * old instructions must not unexpectedly run after intervening work, a provider switch, or an explicit cancellation.
 */
export function undeliveredInputs(events, provider, isPrompt) {
  const pending = new Map();
  const messages = new Map();
  let turn;
  let selected;
  function settle() {
    if (!turn) return;
    const { prompts, receipts, reason, activeProvider, worked } = turn;
    if (activeProvider && activeProvider !== provider || reason?.kind === 'aborted') {
      pending.clear();
      return;
    }
    if (receipts.size) {
      if ([...receipts.values()].some((receipt) => !recoverable.has(receipt.state))) pending.clear();
      for (const [id, receipt] of receipts) {
        if (recoverable.has(receipt.state) && messages.has(id)) pending.set(id, messages.get(id));
        else pending.delete(id);
      }
      // A message can enter DSH after the last adapter step and never reach a native submission.
      for (const prompt of prompts) if (!receipts.has(prompt.id)) pending.set(prompt.id, prompt);
    } else if (activeProvider === provider && !worked && reason?.kind === 'error'
      && ['HARNESS_UNAVAILABLE', 'HARNESS_BAD_CWD'].includes(reason.error?.code)) {
      // Pre-receipt logs: these errors occur before OAR's prompt call. Other failures do not prove non-delivery.
      for (const prompt of prompts) pending.set(prompt.id, prompt);
    } else pending.clear();
  }
  for (const event of events) {
    if (event.type === 'model/selection') selected = event.data.provider;
    if (event.type === 'request/header') selected = event.data.header?.config?.provider ?? selected;
    if (event.type === 'turn/start') {
      settle();
      turn = { prompts: [], receipts: new Map(), activeProvider: selected, worked: false };
    }
    if (!turn) continue;
    if (event.type === 'request/header') turn.activeProvider = event.data.header?.config?.provider ?? turn.activeProvider;
    if (event.type === 'user/message' && isPrompt(event.data)) {
      messages.set(event.data.id, event.data);
      turn.prompts.push(event.data);
    }
    if (event.type === 'assistant/message' || event.type === 'tool/call') turn.worked = true;
    if (event.type === 'turn/end') turn.reason = event.data.reason;
    const receipt = receiptOf(event, provider);
    if (receipt) for (const id of receipt.messageIds) turn.receipts.set(id, receipt);
  }
  settle();
  return [...pending.values()];
}

/** The native identity is recorded at admission, even if the model fails before producing its first assistant message. */
export function admittedLink(events, provider, previous) {
  let link = previous;
  for (const event of events ?? []) {
    const source = event.type === 'assistant/message' ? event.data.message?.source : undefined;
    if (source?.provider === provider && typeof source.replayState?.nativeSessionId === 'string') {
      const next = source.replayState;
      // Imported native answers carry identity but no DSH observations; retain known children of that same session.
      link = {
        ...(link?.nativeSessionId === next.nativeSessionId && link.nativeSubagents ? { nativeSubagents: link.nativeSubagents } : {}),
        ...next,
      };
    }
    const receipt = receiptOf(event, provider);
    if (receipt?.state !== 'accepted' || typeof receipt.nativeSessionId !== 'string') continue;
    link = {
      ...(link?.nativeSessionId === receipt.nativeSessionId ? link : {}),
      harness: provider, nativeSessionId: receipt.nativeSessionId,
    };
  }
  return link;
}

/** Persist the write intent before crossing OAR's prompt/steer boundary; an interrupted write stays uncertain. */
export function createInputDelivery({ session, flushSession, provider, prompts, write }) {
  const attemptId = randomUUID();
  const messageIds = prompts.map((prompt) => prompt.id);
  let state;
  let nativeSessionId;
  let turn;
  async function record(next) {
    if (state === next.state && nativeSessionId === next.nativeSessionId) return;
    state = next.state;
    nativeSessionId = next.nativeSessionId;
    if (!write) return;
    // Make the owning input durable before a receipt can refer to it.
    if (state === 'preparing') {
      await flushSession?.(session);
      turn = session.snapshotEvents().findLast((event) => event.type === 'turn/start')?.data.turn;
    }
    await write({
      version: 1, provider, attemptId, messageIds, state,
      turn, afterSeq: session.seq - 1,
      ...(nativeSessionId ? { nativeSessionId } : {}),
    });
  }
  return {
    record,
    prepare: () => record({ state: 'preparing' }),
    accepted: (id) => record({ state: 'accepted', nativeSessionId: id }),
    async failed(signal) {
      if (state === 'preparing' && !signal?.aborted) await record({ state: 'undelivered' });
    },
  };
}
