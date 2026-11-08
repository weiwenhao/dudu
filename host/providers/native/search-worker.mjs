// Transcript parsing runs outside DSH's event loop, so searching never blocks HTTP, typing or session preview reads.
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import { readClaudeSearch } from './claude-search.mjs';

if (!isMainThread) {
  const queue = [...workerData.sessions];
  parentPort.on('message', ({ prioritize }) => {
    const at = queue.findIndex((session) => session.id === prioritize);
    if (at > 0) queue.unshift(queue.splice(at, 1)[0]);
  });
  while (queue.length) {
    const session = queue.shift();
    try { parentPort.postMessage({ session, text: await readClaudeSearch(session.file, { includeMessages: true }) }); }
    catch { parentPort.postMessage({ session }); }
  }
  parentPort.close();
}

export function indexClaudeConversations(sessions, receive) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { sessions } });
  let active = true;
  const done = new Promise((resolve, reject) => {
    worker.on('message', receive);
    worker.once('error', (error) => { active = false; reject(error); });
    worker.once('exit', (code) => {
      active = false;
      if (code === 0) resolve();
      else reject(new Error('Conversation indexing stopped.'));
    });
  });
  return { done, stop: () => worker.terminate(), prioritize: (id) => { if (active) worker.postMessage({ prioritize: id }); } };
}
