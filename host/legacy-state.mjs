import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

// The plugin was called dsbot before it became dudu. Paired phones live in the old folder, and losing them
// would force every phone to pair again, so the first start of the renamed plugin copies the durable files.
// Caches and receipts (navigation snapshot is kept, the running-instance receipt and diagnostics are not)
// are rebuilt by the new plugin itself.
const DURABLE_FILES = ['devices.json', 'settings.json', 'dock-tabs.json', 'navigation.json', 'pairing-key', 'connection.json'];

async function exists(path) {
  try { await stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/**
 * Copy the previous plugin's durable state into the new plugin's folder, once.
 * The old folder is never modified, so a downgrade keeps working. A failure leaves neither a partial
 * folder nor the new folder behind, and is thrown: starting without the pairings would hide the loss.
 */
export async function migrateLegacyState({ dshHome, from = 'dsbot', to = 'dudu' }) {
  const source = join(dshHome, from);
  const target = join(dshHome, to);
  if (await exists(target)) return { migrated: false, reason: 'target-exists', files: [] };
  if (!(await exists(source))) return { migrated: false, reason: 'no-source', files: [] };
  const staging = join(dshHome, `.${to}-migrating-${randomUUID()}`);
  const files = [];
  try {
    await mkdir(staging, { mode: 0o700 });
    for (const name of DURABLE_FILES) {
      const from = join(source, name);
      if (!(await exists(from))) continue;
      await copyFile(from, join(staging, name));
      await chmod(join(staging, name), 0o600);
      files.push(name);
    }
    try { await rename(staging, target); }
    catch (error) {
      // Another instance finished first: its folder wins and ours is discarded.
      if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') return { migrated: false, reason: 'target-exists', files: [] };
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { migrated: true, files };
}
