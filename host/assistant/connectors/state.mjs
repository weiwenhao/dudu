// What is known of each connector's connection, kept in one small file so that the settings page reads it and does not go out on the network every time it opens
// (docs/assistant.md 3.1, 状态). A connection is checked when the owner connects, retries or signs in, and when a collection uses it; this is where the answer is kept.
//
//   const state = createState({ file, now })
//   state.get(id) / state.all()      -> { status, message?, command?, login?, install?, code?, tools?, at } | null   `code`: what the owner enters in the browser (device.mjs) while 'waiting'
//   state.set(id, record)            status: 'connected' | 'needs-auth' | 'waiting' | 'error' | 'needs-login' | 'missing'; the file is replaced whole, never half written
//   state.delete(id)
// 'waiting' (for the owner in the browser) belongs to the run of the plugin that wrote it: a record of another run is read as 'needs-auth', so that a restart
// does not leave a row waiting for something that is no longer there.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const STATUSES = new Set(['connected', 'needs-auth', 'waiting', 'error', 'needs-login', 'missing']);

export function createState({ file, now = Date.now } = {}) {
  const run = randomUUID();
  let data = {};
  try {
    const read = JSON.parse(readFileSync(file, 'utf8'));
    if (read && typeof read === 'object' && !Array.isArray(read)) data = read;
  } catch { /* none yet, or unreadable: nothing is known */ }

  const save = () => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  };
  const read = (id) => {
    const record = data[id];
    if (!record || !STATUSES.has(record.status)) return null;
    const { run: wrote, ...visible } = record;
    return record.status === 'waiting' && wrote !== run ? { ...visible, status: 'needs-auth' } : visible;
  };

  return {
    get: read,
    all: () => Object.fromEntries(Object.keys(data).map((id) => [id, read(id)]).filter(([, record]) => record)),
    set(id, record) {
      if (!STATUSES.has(record?.status)) throw new Error(`Unknown connection status: ${record?.status}`);
      const clean = {};
      for (const key of ['status', 'message', 'command', 'login', 'install', 'code']) if (typeof record[key] === 'string' && record[key]) clean[key] = record[key].slice(0, 500);
      if (Number.isSafeInteger(record.tools) && record.tools >= 0) clean.tools = record.tools;
      data[id] = { ...clean, at: now(), run };
      save();
    },
    delete(id) {
      if (!(id in data)) return;
      delete data[id];
      save();
    },
  };
}
