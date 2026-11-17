import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

/**
 * Persistence revisions are comparable only within one DSH service instance.
 * Durable caches therefore also need an independently checkable physical identity.
 * Only DSH's public, current JSONL location supports this; other backends keep
 * using their ordinary reads. No event contents or private storage layout is read.
 */
export async function sessionStorageWitness(snapshot, signal) {
  if (snapshot?.formatStatus === 'migration-required' || snapshot?.location?.kind !== 'jsonl'
    || typeof snapshot.location.path !== 'string') return null;
  signal?.throwIfAborted();
  let file;
  try { file = await stat(snapshot.location.path, { bigint: true }); }
  catch { signal?.throwIfAborted(); return null; }
  signal?.throwIfAborted();
  if (!file.isFile()) return null;
  return createHash('sha256').update(JSON.stringify([
    snapshot.location.path, snapshot.header?.version,
    ...[file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs, file.birthtimeNs].map(String),
  ])).digest('hex');
}

/** Capture while the caller owns the journal writer, after its flush. */
export async function sessionStorageCheckpoint(persistence, id) {
  const before = await persistence.stat(id);
  const witness = await sessionStorageWitness(before);
  if (!witness) return null;
  const after = await persistence.stat(id);
  if (before.revision !== after?.revision || JSON.stringify(before.header) !== JSON.stringify(after.header)
    || witness !== await sessionStorageWitness(after)) return null;
  return { witness, header: JSON.stringify(before.header) };
}
