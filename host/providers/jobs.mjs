import { deferred } from './async.mjs';

const active = (task) => ['pending', 'running', 'paused'].includes(task.status);
const monitor = (task) => /monitor/i.test(task.nativeType ?? '');
const visible = (task) => task.taskType !== 'agent' && (!task.ambient || monitor(task))
  && (task.background !== false || monitor(task));

/** Native execution remains in OAR. DSH owns the roster, bounded output, owner fence and human stop control. */
export function createHarnessJobs({ host, route, log = console }) {
  const owners = new Map();
  return {
    observe(agent) {
      const registry = host.jobs?.();
      if (!registry || !agent) return;
      let observer = owners.get(agent.id);
      if (observer?.agent === agent) return observer.record;
      const entries = new Map();
      const outputs = new Map();
      let queue = Promise.resolve();
      const append = (entry, output) => {
        const bytes = Buffer.from(output.text);
        const from = output.total - bytes.length;
        const skip = Math.max(0, entry.offset - from);
        if (output.total > entry.offset) entry.handle.append(bytes.subarray(skip).toString('utf8'), {
          ...(from > entry.offset ? { gapBefore: true } : {}),
        });
        entry.offset = Math.max(entry.offset, output.total);
      };
      const settleRead = async (entry, task, session) => {
        if (session.taskOutput) {
          try {
            const output = await session.taskOutput(task.taskId);
            append(entry, output);
          } catch { /* Native lifecycle facts still settle a task whose output is unavailable. */ }
        }
      };
      const update = async ({ record, tasks, session }) => {
        for (const event of record?.kind === 'frame' ? record.body?.events ?? [] : []) {
          if (event.kind !== 'tool_call_progress' || !event.outputDelta) continue;
          const before = outputs.get(event.callId) ?? { text: '', total: 0 };
          const bytes = Buffer.from(before.text + event.outputDelta);
          let from = Math.max(0, bytes.length - 256 * 1024);
          while (from < bytes.length && (bytes[from] & 192) === 128) from++;
          outputs.set(event.callId, { text: bytes.subarray(from).toString('utf8'), total: before.total + Buffer.byteLength(event.outputDelta) });
          if (outputs.size > 32) outputs.delete(outputs.keys().next().value);
        }
        for (const task of tasks) {
          if (!visible(task)) continue;
          let entry = entries.get(task.taskId);
          if (!entry) {
            // Do not invent a live job from restored identity or an end with no observed start.
            if (!active(task)) continue;
            entry = { done: deferred(), task, offset: 0, settled: false };
            const id = registry.start({
              owner: agent.id, kind: monitor(task) ? 'monitor' : route === 'claude' ? 'bash' : 'shell',
              label: task.description || task.taskId,
              ...(task.toolCallId ? { toolCall: { callId: task.toolCallId, rootCallId: task.toolCallId } } : {}),
              run: (handle) => {
                entry.handle = handle;
                return {
                  done: entry.done.promise,
                  cancel: () => {
                    void session.stopTask(task.taskId).then((answer) => {
                      if (answer.kind === 'rejected') entry.done.resolve({ status: 'failed', detail: answer.reason });
                    }, (error) => entry.done.resolve({ status: 'failed', detail: error.message }));
                  },
                };
              },
            });
            entry.id = id;
            entries.set(task.taskId, entry);
            // The native CLI delivers its own completion. A waiting observer prevents DSH from submitting a second model turn.
            void (async () => {
              while (['running', 'stopping'].includes(registry.get(id, agent.id).status)) await registry.wait(id, 60_000, agent.id);
            })().catch(() => {});
          }
          if (entry.settled) continue;
          entry.task = task;
          if (outputs.has(task.toolCallId)) append(entry, outputs.get(task.toolCallId));
          await settleRead(entry, task, session);
          if (!active(task)) {
            entry.settled = true;
            outputs.delete(task.toolCallId);
            entry.done.resolve({
              status: task.status === 'completed' ? 'completed' : task.status === 'stopped' ? 'killed' : 'failed',
              ...(task.summary || task.error ? { detail: task.summary || task.error } : {}),
            });
          }
        }
      };
      observer = {
        agent,
        record: (snapshot) => {
          queue = queue.then(() => update(snapshot)).catch((error) => {
            log.warn?.(`[dudu] Could not observe a native background task: ${error.message}`);
          });
          return queue;
        },
      };
      owners.set(agent.id, observer);
      return observer.record;
    },
    forget(sessionId) { owners.delete(sessionId); },
  };
}
