import { randomUUID } from 'node:crypto';
import { buildSessionEvents } from './session-events.mjs';
import { canReadSessionHistory, readSessionHistory } from '../../dsh-session-history.mjs';

const importedTypes = new Set([
  'permission/preset', 'sandbox/mode', 'approval/policy', 'model/selection', 'session/title',
  'session/end-seed', // DSH's adoption boundary contains no new conversation or work.
  'turn/start', 'turn/end', 'step/start', 'step/end', 'system/message', 'user/message', 'assistant/message', 'tool/call', 'tool/result',
]);

function importedLog(events, route, nativeSessionId) {
  let starts = 0;
  let prompts = 0;
  let replies = 0;
  let surface = false;
  let head = false;
  let nativeTurns = false;
  for (const event of events) {
    if (!importedTypes.has(event.type)) return null;
    if (event.type === 'system/message') {
      const message = event.data.message;
      if (surface || event.surfaceOp !== 'append' || message?.source?.kind !== 'system-prompt' ||
          message.content?.length !== 0) return null;
      head = true;
    }
    if (event.surfaceOp) surface = true;
    if (event.type === 'turn/start') starts++;
    if (event.type === 'user/message') {
      if (event.surfaceOp !== 'append' || event.data.source?.kind !== 'user') return null;
      prompts++;
    }
    if (event.type === 'assistant/message') {
      const source = event.data.message?.source;
      if (source?.kind !== 'model' || source.provider !== route ||
          source.replayState?.harness !== route || source.replayState?.nativeSessionId !== nativeSessionId) return null;
      replies++;
      nativeTurns ||= Boolean(source.replayState.nativeTurnId);
    }
  }
  return prompts > 0 && replies > 0 ? { starts, prompts, head, nativeTurns } : null;
}

/** Old importers closed each partial poll as a separate turn. Only a pure imported copy is eligible for rebuilding. */
export function hasImportedContinuations(events, route, nativeSessionId) {
  const log = importedLog(events, route, nativeSessionId);
  return Boolean(log && !log.nativeTurns && log.starts > log.prompts);
}

export function hasMissingImportedHead(events, route, nativeSessionId) {
  const log = importedLog(events, route, nativeSessionId);
  return Boolean(log && !log.head);
}

/**
 * Append-only DSH logs cannot be truncated. Rebuild an idle, import-only copy from completed native turns and retain the old
 * copy in DSH's archive. Real DSH requests, inbox work, unknown events and running sessions are never replaced.
 */
export function createImportRepair({ persistence, controller = () => undefined, query = () => undefined, agents, workspaces, links, rebind = async () => undefined }) {
  const services = () => ({ controller: controller(), query: query() });
  return async ({ sessionId: previousId, history, route }) => {
    const registry = workspaces();
    if (!canReadSessionHistory(services()) || !registry?.archiveSession || !registry?.unarchiveSession || !history.turns.length) return null;
    if ((agents()?.get(previousId)?.status ?? 'idle') !== 'idle') return null;
    const original = await readSessionHistory(services(), previousId);
    if (!original || !(hasImportedContinuations(original.events, route, history.id) ||
        hasMissingImportedHead(original.events, route, history.id))) return null;
    const selection = original.events.findLast((event) => event.type === 'model/selection')?.data;
    if (selection?.provider !== route) return null;
    const title = original.events.findLast((event) => event.type === 'session/title')?.data?.title ?? history.title;
    const workspace = await registry.create(history.cwd);
    const sessionId = `session-${randomUUID()}`;
    const { header, events } = buildSessionEvents({
      history: { ...history, turns: history.turns.filter((turn) => turn.complete !== false) },
      route, sessionId, model: selection.model, effort: selection.reasoningEffort, title,
      preset: original.header?.agentPreset,
    });
    for (const event of events.slice(0, 3)) {
      const selected = original.events.findLast((candidate) => candidate.type === event.type);
      if (selected) event.data = { ...selected.data };
    }
    const handle = await persistence().create(header);
    let archived = false;
    let undo;
    try {
      try { await handle.append(events); await handle.flush(); }
      finally { await handle.close(); }
      await workspace.attachSession(sessionId);
      // Refuse if work began or any event changed while the replacement was being stored.
      const current = await readSessionHistory(services(), previousId);
      if (current.events.length !== original.events.length || (agents()?.get(previousId)?.status ?? 'idle') !== 'idle') {
        await registry.archiveSession(sessionId);
        return null;
      }
      await registry.archiveSession(previousId);
      archived = true;
      undo = await rebind(previousId, sessionId);
      await links.replace({ route, nativeSessionId: history.id, previousId, sessionId });
      return { sessionId, previousId, workspaceId: workspace.id, updated: true, repaired: true, title };
    } catch (error) {
      await undo?.();
      if (archived) await registry.unarchiveSession(previousId);
      await registry.archiveSession(sessionId).catch(() => {});
      throw error;
    }
  };
}
