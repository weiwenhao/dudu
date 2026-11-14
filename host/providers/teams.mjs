import { createHash, randomUUID } from 'node:crypto';
import { AsyncQueue } from './async.mjs';
import { createHarnessAdapter, HarnessBridge, harnessError } from './harness-bridge.mjs';
import { createMirrorTool, createMirrorTools } from './mirror-tools.mjs';
import { inclusiveUsage, usageDelta } from './usage.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const text = (value) => typeof value === 'string' ? value : '';
const ownEvents = (session) => session.snapshotEvents(session.inheritedEventCount ?? 0);
const keyOf = (record, id) => JSON.stringify([record.sessionId, record.agentPath ?? [], id]);
async function* drain(queue) {
  for (;;) {
    const next = await queue.next();
    if (next.done) return;
    yield next.value;
  }
}

/** Read-only DSH children observe the native CLI's agents; no second orchestrator or native prompt is started. */
export function createHarnessTeams({ host, driver, log = console }) {
  if (!host.agents.create || !host.agents.resume || !host.flushSession || !driver.normalizer) return undefined;
  const route = `dudu-${driver.id}-child`;
  const children = new Map();
  const bridge = new HarnessBridge({
    driver: {
      ...driver, route, compact: undefined, listModels: async () => [],
      async start({ sessionId, agent }) {
        const child = children.get(sessionId);
        if (!child?.channel) throw harnessError('The harness is no longer running this turn. Send the message again.', 'HARNESS_LOST');
        if (!ownEvents(agent.session).some((event) => event.type === 'subagent/descriptor')) {
          agent.session.append('subagent/descriptor', { version: 3, mode: 'one-shot', provider: route, label: child.label });
        }
        return {
          nativeSessionId: child.nativeId,
          events: drain(child.channel),
          // A one-shot DSH view cannot independently control a native child.
          close() {},
          interrupt() { child.channel.close(); },
        };
      },
    },
    agentOf: (id) => host.agents.get(id), eventsOf: host.eventsOf,
  });
  bridge.isPrompt = (message) => message.role === 'user' && message.source?.kind === 'dudu-native-subagent';
  bridge.onUnknownTool = (id, name) => {
    const child = children.get(id);
    const spec = driver.fallbackTool?.(name);
    if (child?.handle && spec && !child.tools.has(name)) {
      child.disposers.push(child.handle.agent.ctx.tools.register(createMirrorTool({ bridge, spec })));
      child.tools.add(name);
    }
  };
  const unregister = host.llm.registerAdapter([route], createHarnessAdapter(bridge));
  const observers = new Set();

  function observe(parent, previous = []) {
    if (!parent?.session) return undefined;
    const tasks = new Map();
    const calls = new Map();
    const inputs = new Map();
    const unmatched = [];
    const usageReader = driver.childUsage?.();
    let tail = Promise.resolve();
    let ending;
    let root;
    const enqueue = (work) => {
      tail = tail.then(work).catch((error) => { log.warn?.(`[dudu] Native subagent projection failed: ${error.message}`); });
      return tail;
    };
    const memberFor = (id) => ownEvents(parent.session).findLast((event) => event.type === 'team/member'
      && event.data.teamId === parent.id && event.data.member.id === id)?.data.member;
    const catalogFor = (id) => ownEvents(parent.session).findLast((event) => event.type === 'subagent/catalog'
      && event.data.childId === id)?.data;
    const matches = (child, record) => child.nativeSession
      ? record.sessionId === child.nativeSession
      : record.sessionId === child.origin && JSON.stringify(record.agentPath ?? []) === JSON.stringify(child.path);
    const facts = () => [...tasks.values()].map((child) => child.facts);

    function remember(record, event, call = {}) {
      const key = keyOf(record, event.taskId);
      const id = `dudu-native-child-${hash(JSON.stringify([parent.id, driver.id, event.childSessionId || key]))}`;
      const label = text(call.description) || text(event.description) || event.taskId;
      const child = {
        id, nativeId: event.childSessionId || event.taskId, nativeSession: event.childSessionId,
        origin: record.sessionId, path: [...(record.agentPath ?? []), event.toolCallId || event.taskId],
        name: text(call.name) || label.split('/').at(-1) || event.taskId, label, prompt: text(call.prompt),
        model: parent.session.requestHeader?.()?.config?.model || parent.options?.model || 'default',
        status: 'stopped', settled: true, disposers: [], tools: new Set(),
        facts: {
          sessionId: record.sessionId, agentPath: record.agentPath ?? [], taskId: event.taskId,
          ...(event.childSessionId ? { childSessionId: event.childSessionId } : {}),
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          ...(event.nativeType ? { nativeType: event.nativeType } : {}), description: label,
        },
      };
      const member = memberFor(id);
      if (member) { child.name = member.name; child.label = member.description || label; }
      tasks.set(key, child);
      children.set(id, child);
      return child;
    }
    for (const fact of Array.isArray(previous) ? previous : []) {
      if (typeof fact?.sessionId !== 'string' || typeof fact.taskId !== 'string'
        || !Array.isArray(fact.agentPath) || !fact.agentPath.every((part) => typeof part === 'string')) continue;
      const child = remember(fact, fact);
      // Restore only a published child. Facts alone cannot create a session or start work.
      if (!catalogFor(child.id) && memberFor(child.id)?.phase !== 'active') {
        tasks.delete(keyOf(fact, fact.taskId));
        children.delete(child.id);
      }
    }

    async function publishTask(child) {
      if (!catalogFor(child.id)) return;
      const history = ownEvents(parent.session).filter((event) => event.type === 'team/task' && event.data.teamId === parent.id);
      const previous = history.findLast((event) => event.data.task.ownerId === child.id)?.data.task;
      const nextNumber = Math.max(0, ...history.map((event) => Number(/^task-(\d+)$/.exec(event.data.task.id)?.[1] ?? 0))) + 1;
      const status = child.status === 'completed' ? 'completed'
        : ['failed', 'stopped', 'paused', 'pending'].includes(child.status) ? 'pending' : 'in_progress';
      const task = {
        id: previous?.id ?? `task-${nextNumber}`, revision: (previous?.revision ?? 0) + 1, subject: child.label,
        description: child.summary || child.error || '', status, ownerId: child.id, blockedBy: [], writeScopes: [],
      };
      if (previous && ['subject', 'description', 'status'].every((key) => previous[key] === task[key])) return;
      parent.session.append('team/task', { version: 2, teamId: parent.id, task });
    }

    async function activate(child) {
      if (child.channel && !child.settled) return;
      await child.handle?.agent.whenIdle();
      await bridge.close(child.id);
      child.channel = new AsyncQueue();
      child.normalizer = driver.normalizer();
      child.settled = false;
      child.hasText = false;
      child.summary = undefined;
      child.error = undefined;
      if (!child.handle) {
        try {
          const published = catalogFor(child.id) || memberFor(child.id)?.phase === 'active';
          const stored = published ? await host.eventsOf(child.id) : undefined;
          // Never replace a published child's missing history with a fresh session.
          if (published && !stored) throw harnessError('The harness is no longer running this turn. Send the message again.', 'HARNESS_LOST');
          const options = {
            // The old registry owned children through this option. New DSH owns its subagent tree separately.
            ...(typeof host.agents.isOwnedBy === 'function' ? { parentAgent: parent } : {}),
            agentOptions: { provider: route, model: child.model },
          };
          child.handle = stored
            ? await host.agents.resume({ ...options, resumeSessionId: child.id })
            : await host.agents.create({
              ...options, sessionId: child.id,
              meta: { cwd: parent.session.header.cwd, parentSession: parent.id, origin: 'subagent',
                delegationDepth: (parent.session.header.delegationDepth ?? 0) + 1 },
            });
          child.disposers = createMirrorTools({ bridge }).map((definition) => {
            const dispose = child.handle.agent.ctx.tools.register(definition);
            child.tools.add(definition.name);
            return dispose;
          });
          if (!catalogFor(child.id)) {
            // Catalog v0 remains the host's valid local one-shot shape; v3 names only continuable/external children.
            parent.session.append('subagent/catalog', {
              version: 0, childId: child.id, childCreatedAt: child.handle.agent.session.header.createdAt,
              mode: 'one-shot', label: child.label,
            });
          }
        } catch (error) {
          child.status = 'failed';
          child.error = error.message;
          child.settled = true;
          child.channel.close();
          throw error;
        }
      }
      const saved = host.tokenUsageOf?.(child.handle.agent.session);
      if (saved) {
        child.accounted = inclusiveUsage({
          input: saved.uncachedInputTokens + saved.cacheReadTokens + saved.cacheWriteTokens,
          output: saved.outputTokens, cacheRead: saved.cacheReadTokens, cacheWrite: saved.cacheWriteTokens,
        });
      } else child.accounted ??= {};
      child.handle.agent.followup({
        id: randomUUID(), role: 'user', content: [{ type: 'text', text: child.prompt || child.label }],
        source: { kind: 'dudu-native-subagent', provider: driver.id, nativeSessionId: child.nativeId },
      });
    }

    function accountUsage(child, usage) {
      if (!usage || child.settled) return;
      const delta = usageDelta(usage, child.accounted);
      // A delayed or repeated snapshot must not lower the baseline and recharge the same tokens later.
      for (const [key, value] of Object.entries(usage)) child.accounted[key] = Math.max(child.accounted[key] ?? 0, value);
      if (Object.values(delta).some((value) => value > 0)) child.channel.push({ type: 'usage', usage: delta });
    }

    async function sampleUsage(child, record, readTranscript) {
      // Codex reports a child's lifetime counters on that child's thread, never on its parent's task notification.
      if (!usageReader && record && matches(child, record)) {
        for (const event of record.body?.events ?? []) {
          if (event.kind === 'usage') accountUsage(child, inclusiveUsage(event.usage?.total ?? event.usage?.tokens));
        }
      }
      if (usageReader && readTranscript) {
        try { accountUsage(child, await usageReader.read({ sessionId: child.origin, taskId: child.nativeId })); }
        catch (error) { log.warn?.(`[dudu] Could not read native subagent usage: ${error.message}`); }
      }
    }

    async function feed(child, record) {
      if (child.settled) return;
      const before = record.body?.events ?? [];
      // Child counters outlive mirror turns. Account against the saved DSH total, independently of the root's own total.
      const normalized = child.normalizer.feed({
        ...record, agentPath: [], body: { ...record.body, events: before.filter((event) => event.kind !== 'usage') },
      });
      await sampleUsage(child, record, child.normalizer.isMessageEnd?.(record)
        || normalized.some((event) => ['step-end', 'turn-end', 'tool-result'].includes(event.type)));
      for (const event of normalized) {
        if (event.type === 'text-delta') child.hasText = true;
        if (event.type === 'turn-end' && event.error?.code === 'ABORTED') child.handle?.agent.cancel({ kind: 'parent' });
        child.channel.push(event);
        if (event.type === 'turn-end') { child.settled = true; child.channel.close(); }
      }
    }

    async function settle(child, { status, summary, error }, record) {
      child.status = status;
      child.summary = summary;
      child.error = error;
      if (!child.settled) {
        await sampleUsage(child, record, true);
        if (summary && !child.hasText) await feed(child, { kind: 'frame', body: { events: [{ kind: 'text_delta', text: summary }] } });
        await feed(child, { kind: 'frame', body: { events: [{
          kind: 'turn_ended', outcome: status === 'completed' ? { kind: 'completed' }
            : ['stopped', 'paused', 'pending'].includes(status) ? { kind: 'aborted' } : { kind: 'failed', failure: 'unknown', reason: error || summary || status },
        }] } });
      }
      await publishTask(child);
    }

    async function recordOne(record) {
      if (record.kind !== 'frame') return;
      const native = record.body.native?.item;
      if (native?.type === 'collabAgentToolCall' && native.status === 'inProgress'
        && ['sendInput', 'followupTask'].includes(native.tool) && typeof native.prompt === 'string') {
        for (const id of native.receiverThreadIds ?? []) {
          if ([...tasks.values()].some((child) => child.nativeSession === id && child.origin === record.sessionId)) inputs.set(id, native.prompt);
        }
      }
      for (const event of record.body?.events ?? []) {
        if (event.kind === 'tool_call_started' || event.kind === 'tool_call_input') {
          const key = keyOf(record, event.callId);
          let input = event.input;
          if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = undefined; } }
          const call = { ...calls.get(key), ...(event.tool ? { tool: event.tool } : {}), ...input };
          calls.set(key, call);
          if (call.tool === 'SendMessage' && typeof call.to === 'string' && typeof call.message === 'string'
            && [...tasks.values()].some((child) => child.nativeId === call.to && child.origin === record.sessionId)) {
            inputs.set(call.to, call.message);
          }
        }
        const key = keyOf(record, event.taskId);
        let child = typeof event.taskId === 'string'
          ? tasks.get(key) ?? [...tasks.values()].find((candidate) => candidate.nativeSession === event.taskId) : undefined;
        if (event.kind === 'task_started' && event.taskType === 'agent' && !event.ambient) {
          const call = calls.get(keyOf(record, event.toolCallId)) ?? {};
          if (!child) {
            child = remember(record, event, call);
          }
          // Claude's SendMessage resume names a new dispatch call, but child frames keep the original Agent path.
          child.prompt = text(call.prompt) || text(call.message) || inputs.get(child.nativeId) || text(native?.prompt);
          inputs.delete(child.nativeId);
          child.status = 'running';
          await activate(child);
          for (let i = 0; i < unmatched.length;) {
            if (matches(child, unmatched[i])) await feed(child, unmatched.splice(i, 1)[0]);
            else i++;
          }
          await publishTask(child);
        } else if (child && event.kind === 'task_updated') {
          if (event.status) {
            child.status = event.status;
            if (event.status === 'running') {
              if (!child.channel || child.settled) {
                child.prompt = inputs.get(child.nativeSession || child.nativeId) || text(native?.prompt);
                inputs.delete(child.nativeSession || child.nativeId);
              }
              await activate(child);
            }
            else if (['completed', 'failed', 'stopped'].includes(event.status)) await settle(child, event, record);
          }
          if (event.error) child.error = event.error;
          await publishTask(child);
        } else if (child && event.kind === 'task_ended') await settle(child, event, record);
      }
      if (record.sessionId !== root || (record.agentPath?.length ?? 0) > 0) {
        const child = [...tasks.values()].find((candidate) => matches(candidate, record));
        if (child) await feed(child, record);
        else if (unmatched.length < 1024) unmatched.push(record);
      }
    }
    const observer = {
      seed: facts,
      async checkpoint() { await tail; return facts(); },
      record(record, rootId) { root = rootId; if (!ending) void enqueue(() => recordOne(record)); },
      end(outcome) {
        if (ending) return ending;
        ending = enqueue(async () => {
          const results = await Promise.allSettled([...tasks.values()].map(async (child) => {
            try {
              if (!['completed', 'failed', 'stopped'].includes(child.status)) {
                await settle(child, { status: outcome?.ok || outcome?.error?.code === 'ABORTED' ? 'stopped' : 'failed', error: outcome?.error?.message });
              }
              await child.handle?.agent.whenIdle();
              if (child.handle) await host.flushSession(child.handle.agent.session);
            } finally {
              for (const dispose of child.disposers) {
                try { dispose(); } catch (error) { log.warn?.(`[dudu] Could not release a native mirror tool: ${error.message}`); }
              }
              try { await child.handle?.dispose(); }
              finally {
                try { await bridge.close(child.id); }
                finally { children.delete(child.id); }
              }
            }
          }));
          observers.delete(observer);
          usageReader?.close();
          for (const result of results) if (result.status === 'rejected') log.warn?.(`[dudu] Could not release a native subagent view: ${result.reason.message}`);
          await host.flushSession(parent.session);
        });
        return ending;
      },
    };
    observers.add(observer);
    return observer;
  }
  return {
    observe,
    async close() {
      await Promise.all([...observers].map((observer) => observer.end()));
      await bridge.dispose();
      unregister();
    },
  };
}
