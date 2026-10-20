import { type Connection, parseConnection } from './connection.ts';

export type SavedComputer = Connection & { id: string; lastUsedAt: number };
export type ConnectionLibrary = { computers: SavedComputer[]; activeId: string | null };
type SecretStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

const INDEX_KEY = 'dsbot.computers.v2';
const LEGACY_KEY = 'dsbot.connection.v1';
const computerKey = (id: string) => `dsbot.computer.${id}`;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const credentialAddress = (url: string) => {
  const value = new URL(url);
  value.searchParams.delete('computer');
  value.searchParams.delete('name');
  value.searchParams.sort();
  return value.href;
};

export function activeComputer(library: ConnectionLibrary): SavedComputer | null {
  return library.computers.find((computer) => computer.id === library.activeId) ?? null;
}

export function createConnectionStore(storage: SecretStorage, {
  now = Date.now,
  newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
} = {}) {
  let library: ConnectionLibrary | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let pendingDeletes: string[] = [];
  let legacyCleanup = false;
  const snapshot = (): ConnectionLibrary => ({
    activeId: library!.activeId,
    computers: library!.computers.map((computer) => ({ ...computer })),
  });
  const writeIndex = (next: ConnectionLibrary, deleted = pendingDeletes) => storage.set(INDEX_KEY, JSON.stringify({
    version: 2, activeId: next.activeId, ids: next.computers.map((computer) => computer.id),
    ...(deleted.length ? { pendingDeletes: deleted } : {}),
  }));
  const cleanUp = async () => {
    if (legacyCleanup) {
      try { await storage.remove(LEGACY_KEY); legacyCleanup = false; } catch { /* Retry on the next operation. */ }
    }
    if (!pendingDeletes.length) return;
    const remaining: string[] = [];
    for (const id of pendingDeletes) {
      try { await storage.remove(computerKey(id)); } catch { remaining.push(id); }
    }
    if (remaining.length !== pendingDeletes.length) {
      try { await writeIndex(library!, remaining); pendingDeletes = remaining; } catch { /* The saved cleanup list remains retryable. */ }
    }
  };
  const commitRecord = async (computer: SavedComputer, next: ConnectionLibrary, previous?: SavedComputer) => {
    const key = computerKey(computer.id);
    await storage.set(key, JSON.stringify(computer));
    try { await writeIndex(next); }
    catch (error) {
      if (previous) await storage.set(key, JSON.stringify(previous)).catch(() => {});
      else await storage.remove(key).catch(() => {});
      throw error;
    }
  };
  const read = async () => {
    if (library) return;
    const indexText = await storage.get(INDEX_KEY);
    if (!indexText) {
      const previous = await storage.get(LEGACY_KEY);
      const next: ConnectionLibrary = { computers: [], activeId: null };
      if (previous) {
        const value = JSON.parse(previous);
        const computer = { ...parseConnection(value.url, value.name), id: newId(), lastUsedAt: now() };
        next.computers = [computer];
        next.activeId = computer.id;
        await commitRecord(computer, next);
      } else {
        await writeIndex(next);
      }
      library = next;
      // The v1 credential remains available until the new index is committed.
      legacyCleanup = !!previous;
      return;
    }
    const index = JSON.parse(indexText);
    if (index.version !== 2 || !Array.isArray(index.ids) || !index.ids.every(validId)
      || (index.activeId !== null && !validId(index.activeId))
      || (index.pendingDeletes !== undefined && (!Array.isArray(index.pendingDeletes)
        || !index.pendingDeletes.every(validId)))) throw new Error('保存的电脑列表无法读取。');
    pendingDeletes = [...new Set<string>(index.pendingDeletes ?? [])].filter((id) => !index.ids.includes(id));
    legacyCleanup = true;
    const records = await Promise.all([...new Set<string>(index.ids)].map(async (id) => {
      const text = await storage.get(computerKey(id));
      if (!text) return null;
      try {
        const value = JSON.parse(text);
        if (value.id !== id) return null;
        return {
          ...parseConnection(value.url, value.name), id,
          lastUsedAt: Number.isFinite(value.lastUsedAt) ? value.lastUsedAt : 0,
        };
      } catch { return null; }
    }));
    const computers = records.filter((record): record is SavedComputer => record !== null);
    library = {
      computers,
      activeId: computers.some((computer) => computer.id === index.activeId) ? index.activeId
        : [...computers].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]?.id ?? null,
    };
  };
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(async () => { await read(); await cleanUp(); return operation(); });
    queue = result.catch(() => {});
    return result;
  };
  return {
    load: () => serial(async () => snapshot()),
    pair: (connection: Connection) => serial(async () => {
      const value = parseConnection(connection.url, connection.name);
      const existing = library!.computers.find((computer) =>
        (value.computerId && computer.computerId === value.computerId)
        || (!computer.computerId && credentialAddress(computer.url) === credentialAddress(value.url)));
      const computer: SavedComputer = { ...value, id: existing?.id ?? newId(), lastUsedAt: now() };
      const next = {
        computers: existing ? library!.computers.map((item) => item.id === existing.id ? computer : item)
          : [...library!.computers, computer],
        activeId: computer.id,
      };
      await commitRecord(computer, next, existing);
      library = next;
      return snapshot();
    }),
    select: (id: string) => serial(async () => {
      const computer = library!.computers.find((item) => item.id === id);
      if (!computer) throw new Error('这台电脑已被移除。');
      if (library!.activeId === id) return snapshot();
      const updated = { ...computer, lastUsedAt: now() };
      const next = {
        computers: library!.computers.map((item) => item.id === id ? updated : item), activeId: id,
      };
      await commitRecord(updated, next, computer);
      library = next;
      return snapshot();
    }),
    remove: (id: string) => serial(async () => {
      const computers = library!.computers.filter((computer) => computer.id !== id);
      const next = {
        computers,
        activeId: library!.activeId === id
          ? [...computers].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]?.id ?? null : library!.activeId,
      };
      const deleted = library!.computers.some((computer) => computer.id === id)
        ? [...new Set([...pendingDeletes, id])] : pendingDeletes;
      await writeIndex(next, deleted);
      library = next;
      pendingDeletes = deleted;
      await cleanUp();
      return snapshot();
    }),
  };
}
