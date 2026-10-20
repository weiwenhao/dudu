import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DiagnosticLogger,
  type DiagnosticFileInfo,
  type DiagnosticStorage,
} from '../src/diagnostics-core.ts';

class MemoryStorage implements DiagnosticStorage {
  readonly files = new Map<string, string>();
  readonly modifiedAt = new Map<string, number | string | Date>();
  readonly writes: Array<{ name: string; contents: string }> = [];
  readonly removals: string[] = [];
  beforeWrite?: (name: string, contents: string) => Promise<void>;
  initializeCalls = 0;

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }

  async list(): Promise<readonly DiagnosticFileInfo[]> {
    return [...this.files.entries()].map(([name, contents]) => ({
      name,
      size: new TextEncoder().encode(contents).byteLength,
      modifiedAt: this.modifiedAt.get(name),
    }));
  }

  async write(name: string, contents: string): Promise<void> {
    this.writes.push({ name, contents });
    if (this.beforeWrite) await this.beforeWrite(name, contents);
    this.files.set(name, contents);
    this.modifiedAt.set(name, Date.now());
  }

  async remove(name: string): Promise<void> {
    this.removals.push(name);
    this.files.delete(name);
    this.modifiedAt.delete(name);
  }

  seed(name: string, contents: string, modifiedAt: number | string | Date): void {
    this.files.set(name, contents);
    this.modifiedAt.set(name, modifiedAt);
  }
}

function fixedClocks(start = '2026-10-18T12:00:00.000Z') {
  const base = new Date(start).getTime();
  let elapsed = 100;
  return {
    now: () => new Date(base),
    monotonicNow: () => {
      elapsed += 5;
      return elapsed;
    },
  };
}

function recordsIn(storage: MemoryStorage): Array<Record<string, unknown>> {
  return [...storage.files.values()]
    .flatMap((contents) => contents.split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test('normalizes safely, preserves ordinary error text, and redacts credentials and body fields', async () => {
  const storage = new MemoryStorage();
  const clocks = fixedClocks();
  const logger = new DiagnosticLogger(storage, {
    sessionId: 'format-test',
    ...clocks,
  });

  let getterCalls = 0;
  let toJsonCalls = 0;
  const data: Record<string, unknown> = {
    error: new Error('Request failed at https://user:password@api.example.test/path?token=topsecret#private'),
    message: 'Network timeout for https://api.example.test/status?trace=private',
    apiToken: 'named-secret',
    password: 'secret-password',
    cookie: 'session=private-cookie',
    chat: { body: 'private chat body', characterCount: 41 },
    draftBody: 'private draft',
    transcript: ['private transcript'],
    prompt: 'private prompt',
    plainText: 'Bearer long-lived-token Basic dXNlcjpwYXNzd29yZA== authorization: Basic c2VjcmV0dXNlcjpwYXNz token=plain-text-token password="raw-password"',
    large: 'x'.repeat(20_000),
  };
  Object.defineProperty(data, 'lazyValue', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'must not be read';
    },
  });
  Object.defineProperty(data, 'toJSON', {
    enumerable: true,
    value() {
      toJsonCalls += 1;
      return { leaked: true };
    },
  });
  data.self = data;
  data.deep = { a: { b: { c: { d: { e: { beyondLimit: 'deep value' } } } } } };

  assert.equal(logger.log({
    event: 'network.error',
    source: 'console',
    level: 'error',
    time: '2026-10-18T11:59:59.500Z',
    elapsedMs: 900.25,
    data,
  }), true);
  await logger.flush();

  assert.equal(getterCalls, 0);
  assert.equal(toJsonCalls, 0);
  const [record] = recordsIn(storage);
  assert.equal(record.time, '2026-10-18T12:00:00.000Z');
  assert.equal(record.sourceTime, '2026-10-18T11:59:59.500Z');
  assert.equal(record.sourceElapsedMs, 900.25);

  const normalized = record.data as Record<string, unknown>;
  const error = normalized.error as Record<string, unknown>;
  assert.match(String(error.message), /Request failed at https:\/\/api\.example\.test\/path\?\[REDACTED\]#\[REDACTED\]/);
  assert.match(String(normalized.message), /Network timeout/);
  assert.deepEqual(normalized.chat, { redacted: true, characterCount: 41 });
  assert.deepEqual(normalized.draftBody, { redacted: true, characterCount: 13 });
  assert.deepEqual(normalized.transcript, { redacted: true, itemCount: 1 });
  assert.deepEqual(normalized.prompt, { redacted: true, characterCount: 14 });
  assert.equal(normalized.lazyValue, '[Getter omitted]');
  assert.equal(normalized.toJSON, '[Function]');
  assert.equal(normalized.self, '[Circular]');
  assert.match(JSON.stringify(normalized.deep), /\[MaxDepth\]/);
  assert.match(String(normalized.large), /\.\.\.\[truncated\]$/);

  const serialized = JSON.stringify(record);
  for (const secret of [
    'password@', 'topsecret', 'private-cookie', 'named-secret',
    'secret-password', 'private chat body', 'private draft',
    'private transcript', 'private prompt', 'long-lived-token',
    'dXNlcjpwYXNzd29yZA==', 'c2VjcmV0dXNlcjpwYXNz', 'plain-text-token', 'raw-password',
  ]) assert.ok(!serialized.includes(secret), `unexpected secret: ${secret}`);
});

test('bounds memory, serializes concurrent flushes, and preserves a failed batch with a drop marker', async () => {
  const storage = new MemoryStorage();
  let beginWrite!: () => void;
  let releaseWrite!: () => void;
  const started = new Promise<void>((resolve) => { beginWrite = resolve; });
  const gate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  let failFirst = true;
  storage.beforeWrite = async () => {
    if (!failFirst) return;
    failFirst = false;
    beginWrite();
    await gate;
    throw new Error('simulated partial storage failure');
  };

  const logger = new DiagnosticLogger(storage, {
    sessionId: 'bounded-test',
    maxBufferedRecords: 2,
    maxBufferedBytes: 4096,
    maxWriteAttempts: 1,
    ...fixedClocks(),
  });
  assert.equal(logger.log({ event: 'one', data: 1 }), true);
  assert.equal(logger.log({ event: 'two', data: 2 }), true);
  assert.equal(logger.log({ event: 'three', data: 3 }), false);
  assert.equal(logger.getPendingStats().records, 2);

  const firstFlush = logger.flush();
  const secondFlush = logger.flush();
  await started;
  assert.equal(storage.writes.length, 1);
  assert.equal(logger.log({ event: 'four', data: 4 }), false);
  releaseWrite();
  await Promise.all([firstFlush, secondFlush]);

  const failedStats = logger.getPendingStats();
  assert.equal(failedStats.records, 2);
  assert.equal(failedStats.dropped, 2);
  assert.ok(failedStats.bytes <= 4096);

  storage.beforeWrite = undefined;
  await logger.flush();
  assert.equal(logger.getPendingStats().records, 0);
  assert.equal(logger.getPendingStats().dropped, 0);
  assert.equal(storage.writes[1].name, storage.writes[0].name);
  assert.equal(storage.writes[1].contents, storage.writes[0].contents);
  const saved = recordsIn(storage);
  assert.deepEqual(saved.map((record) => record.event), ['one', 'two', 'records-dropped']);
  assert.equal((saved[2].data as { count: number }).count, 2);
});

test('rewrites one active segment across flushes and rotates when the next line will not fit', async () => {
  const storage = new MemoryStorage();
  const logger = new DiagnosticLogger(storage, {
    sessionId: 'active-segment-test',
    maxSegmentBytes: 700,
    maxRecordBytes: 700,
    maxTotalBytes: 2800,
    ...fixedClocks(),
  });

  logger.log({ event: 'first', data: 'a' });
  await logger.flush();
  const activeName = storage.writes[0].name;
  const firstContents = storage.writes[0].contents;

  logger.log({ event: 'second', data: 'b' });
  await logger.flush();
  assert.equal(logger.getPendingStats().bytes, 0, 'flushed bytes must exclude the already-persisted active segment');
  assert.equal(storage.writes[1].name, activeName);
  assert.notEqual(storage.writes[1].contents, firstContents);
  assert.deepEqual(recordsIn(storage).map((record) => record.event), ['first', 'second']);
  assert.equal(storage.files.size, 1);

  logger.log({ event: 'large-enough-to-rotate', data: 'x'.repeat(350) });
  await logger.flush();
  assert.notEqual(storage.writes[2].name, activeName);
  assert.ok(storage.files.has(activeName));
  assert.equal(storage.files.size, 2);
  assert.ok([...storage.files.values()].every((contents) =>
    new TextEncoder().encode(contents).byteLength <= 700));
  assert.deepEqual(recordsIn(storage).map((record) => record.event), [
    'first', 'second', 'large-enough-to-rotate',
  ]);
});

test('failed active-segment overwrite retains the old file and retries without duplicating lines', async () => {
  const storage = new MemoryStorage();
  const logger = new DiagnosticLogger(storage, {
    sessionId: 'active-retry-test',
    maxWriteAttempts: 1,
    ...fixedClocks(),
  });

  logger.log({ event: 'already-durable', data: { value: 1 } });
  await logger.flush();
  const activeName = storage.writes[0].name;
  const durableContents = storage.files.get(activeName);
  let failOverwrite = true;
  storage.beforeWrite = async (name) => {
    if (failOverwrite && name === activeName) {
      failOverwrite = false;
      throw new Error('atomic replacement rejected');
    }
  };

  logger.log({ event: 'retry-me', data: { value: 2 } });
  await logger.flush();
  assert.equal(storage.files.get(activeName), durableContents);
  assert.equal(logger.getPendingStats().records, 1);

  storage.beforeWrite = undefined;
  await logger.flush();
  assert.equal(storage.writes[1].name, activeName);
  assert.equal(storage.writes[1].contents, storage.writes[2].contents);
  assert.equal(storage.writes[2].name, activeName);
  assert.equal(storage.files.get(activeName), storage.writes[2].contents);
  assert.deepEqual(recordsIn(storage).map((record) => record.event), ['already-durable', 'retry-me']);
});

test('retries an incomplete segment in place and preserves completed segments after restart', async () => {
  const storage = new MemoryStorage();
  const writeErrors: unknown[] = [];
  let partialWrite = true;
  storage.beforeWrite = async (name, contents) => {
    if (!partialWrite) return;
    partialWrite = false;
    storage.files.set(name, contents.slice(0, 24));
    throw new Error('disk became full during write');
  };
  const first = new DiagnosticLogger(storage, {
    sessionId: 'first-session',
    maxWriteAttempts: 1,
    onStorageFailure: (error) => writeErrors.push(error),
    ...fixedClocks(),
  });
  first.log({ event: 'saved-before-restart', data: { count: 1 } });
  await first.flush();
  assert.equal(writeErrors.length, 1);
  assert.equal(first.getPendingStats().records, 1);
  const partialName = storage.writes[0].name;
  assert.equal(storage.files.get(partialName)?.length, 24);

  storage.beforeWrite = undefined;
  await first.flush();
  assert.equal(storage.writes[1].name, partialName);
  assert.equal(storage.writes[1].contents, storage.files.get(partialName));

  const originalContent = storage.files.get(partialName);
  const restarted = new DiagnosticLogger(storage, {
    sessionId: 'second-session',
    ...fixedClocks('2026-10-18T12:01:00.000Z'),
  });
  await restarted.initialize();
  restarted.log({ event: 'saved-after-restart', data: { count: 2 } });
  await restarted.flush();
  assert.equal(storage.files.get(partialName), originalContent);
  assert.equal(storage.initializeCalls, 2);
  assert.deepEqual(recordsIn(storage).map((record) => record.event), [
    'saved-before-restart',
    'saved-after-restart',
  ]);
});

test('scans existing files, prunes by age and total size, and removes only known diagnostics files', async () => {
  const storage = new MemoryStorage();
  const now = new Date('2026-10-18T12:00:00.000Z');
  const expiredName = 'diagnostics-20260901T000000000Z-old-session-000000.jsonl';
  const existingName = 'diagnostics-20261017T120000000Z-old-session-000000.jsonl';
  const unrelatedName = 'keep-this-file.txt';
  storage.seed(expiredName, 'expired diagnostics', new Date('2026-09-01T00:00:00.000Z'));
  storage.seed(existingName, 'x'.repeat(500), new Date('2026-10-17T12:00:00.000Z'));
  storage.seed(unrelatedName, 'unrelated'.repeat(1000), new Date('2020-01-01T00:00:00.000Z'));

  const logger = new DiagnosticLogger(storage, {
    sessionId: 'rotation-test',
    maxSegmentBytes: 700,
    maxRecordBytes: 700,
    maxTotalBytes: 1400,
    maxStringChars: 1024,
    now: () => now,
    monotonicNow: () => 42,
  });
  await logger.initialize();
  assert.ok(!storage.files.has(expiredName));
  assert.ok(storage.files.has(unrelatedName));

  for (let index = 0; index < 8; index += 1) {
    logger.log({ event: `rotation-${index}`, data: 'x'.repeat(300) });
  }
  await logger.flush();

  const diagnostics = [...storage.files.entries()].filter(([name]) => name.startsWith('diagnostics-'));
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every(([, contents]) => new TextEncoder().encode(contents).byteLength <= 700));
  const total = diagnostics.reduce((sum, [, contents]) =>
    sum + new TextEncoder().encode(contents).byteLength, 0);
  assert.ok(total <= 1400, `diagnostics total was ${total} bytes`);
  assert.ok(storage.files.has(unrelatedName));
  assert.ok(!storage.removals.includes(unrelatedName));
  assert.ok(diagnostics.every(([name]) =>
    /^diagnostics-\d{8}T\d{9}Z-[A-Za-z0-9_-]+-\d{6,}\.jsonl$/.test(name)));
});
