export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticFileInfo {
  name: string;
  size: number;
  modifiedAt?: number | string | Date;
}

export interface DiagnosticStorage {
  initialize(): Promise<void>;
  list(): Promise<readonly DiagnosticFileInfo[]>;
  /** Replace the complete contents of this named file. */
  write(name: string, contents: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface DiagnosticLogInput {
  level?: DiagnosticLevel;
  source?: string;
  event: string;
  data?: unknown;
  /** Original event time, retained separately from native receipt time. */
  time?: string;
  /** Original monotonic elapsed time, retained separately from native elapsed time. */
  elapsedMs?: number;
}

export interface DiagnosticRecord {
  time: string;
  elapsedMs: number;
  sessionId: string;
  sequence: number;
  level: DiagnosticLevel;
  source: string;
  event: string;
  data: unknown;
  sourceTime?: string;
  sourceElapsedMs?: number;
}

export interface DiagnosticLoggerOptions {
  sessionId?: string;
  maxSegmentBytes?: number;
  maxTotalBytes?: number;
  retentionMs?: number;
  maxBufferedBytes?: number;
  maxBufferedRecords?: number;
  maxRecordBytes?: number;
  maxWriteAttempts?: number;
  maxStringChars?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  /**
   * Capture the original console method before installing a console bridge.
   * This callback is called directly and is never routed through this logger.
   */
  onStorageFailure?: (error: unknown) => void;
}

export interface DiagnosticPendingStats {
  records: number;
  bytes: number;
  dropped: number;
}

interface QueuedLine {
  line: string;
  bytes: number;
}

interface KnownFile {
  name: string;
  size: number;
  timestampMs: number | undefined;
}

interface PendingWrite {
  name: string;
  contents: string;
  bytes: number;
  recordCount: number;
  replacesActive: boolean;
}

interface ActiveSegment {
  name: string;
  contents: string;
  bytes: number;
}

interface NormalizeState {
  seen: WeakSet<object>;
  nodes: number;
  maxNodes: number;
  maxDepth: number;
  maxEntries: number;
  maxStringChars: number;
}

const DEFAULT_SEGMENT_BYTES = 256 * 1024;
const DEFAULT_TOTAL_BYTES = 16 * 1024 * 1024;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_BUFFER_RECORDS = 1024;
const DEFAULT_RECORD_BYTES = 16 * 1024;
const DEFAULT_STRING_CHARS = 2048;
const MIN_SEGMENT_BYTES = 512;
const FILE_NAME_PATTERN = /^diagnostics-(\d{8}T\d{9}Z)-([A-Za-z0-9_-]{1,64})-(\d{6,})\.jsonl$/;
const REDACTED = '[REDACTED]';
const TRUNCATED = '...[truncated]';

const SECRET_TEXT_PATTERN =
  /((?:"|')?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|authorization|auth|cookie|set-cookie|password|passwd|secret)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic)\s+\S+|[^\s,;}\]]+)/gi;
const COOKIE_HEADER_PATTERN = /\b(set-cookie|cookie)\s*:\s*[^\r\n]*/gi;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function trimUrlPunctuation(value: string): { url: string; suffix: string } {
  let end = value.length;
  while (end > 0 && /[.,;!?)}\]]/.test(value[end - 1])) end -= 1;
  return { url: value.slice(0, end), suffix: value.slice(end) };
}

function scrubUrl(value: string): string {
  const schemeEnd = value.indexOf('://') + 3;
  if (schemeEnd < 3) return value;

  const authorityEndCandidate = value.slice(schemeEnd).search(/[/?#]/);
  const authorityEnd = authorityEndCandidate < 0 ? value.length : schemeEnd + authorityEndCandidate;
  const authority = value.slice(schemeEnd, authorityEnd);
  const safeAuthority = authority.slice(authority.lastIndexOf('@') + 1);
  let pathEnd = value.length;
  const queryAt = value.indexOf('?', authorityEnd);
  const fragmentAt = value.indexOf('#', authorityEnd);
  if (queryAt >= 0) pathEnd = Math.min(pathEnd, queryAt);
  if (fragmentAt >= 0) pathEnd = Math.min(pathEnd, fragmentAt);
  const path = value.slice(authorityEnd, pathEnd);
  const hasQuery = queryAt >= 0 && (fragmentAt < 0 || queryAt < fragmentAt);
  const hasFragment = fragmentAt >= 0;

  return `${value.slice(0, schemeEnd)}${safeAuthority}${path}` +
    `${hasQuery ? '?[REDACTED]' : ''}${hasFragment ? '#[REDACTED]' : ''}`;
}

function scrubText(input: string, maxChars: number): string {
  const rawLimit = Math.max(maxChars, Math.min(16_384, maxChars * 4));
  let value = input.length > rawLimit ? `${input.slice(0, rawLimit)}${TRUNCATED}` : input;
  value = value.replace(URL_PATTERN, (candidate) => {
    const { url, suffix } = trimUrlPunctuation(candidate);
    return `${scrubUrl(url)}${suffix}`;
  });
  value = value
    .replace(COOKIE_HEADER_PATTERN, (_match, header: string) => `${header}: ${REDACTED}`)
    .replace(SECRET_TEXT_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(AUTH_SCHEME_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`);
  if (value.length > maxChars) return `${value.slice(0, Math.max(0, maxChars - TRUNCATED.length))}${TRUNCATED}`;
  return value;
}

function normalizedWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSecretField(key: string): boolean {
  const words = normalizedWords(key);
  return words.some((word) =>
    word === 'token' || word === 'auth' || word === 'authorization' ||
    word === 'cookie' || word === 'password' || word === 'passwd' ||
    word === 'secret' || word === 'credential' ||
    (word === 'key' && words.includes('api')),
  );
}

function isBodyField(key: string): boolean {
  const words = normalizedWords(key);
  if (words.some((word) =>
    word === 'count' || word === 'length' || word === 'bytes' ||
    word === 'duration' || word === 'durationms' || word === 'segments',
  )) return false;
  return words.some((word) =>
    word === 'chat' || word === 'chats' ||
    word === 'draft' || word === 'drafts' ||
    word === 'transcript' || word === 'transcripts' ||
    word === 'prompt' || word === 'prompts' ||
    word === 'body' || word === 'bodies' ||
    word === 'content' || word === 'contents' || word === 'messages',
  );
}

function ownDataProperty(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function bodySummary(value: unknown): Record<string, unknown> {
  const summary: Record<string, unknown> = { redacted: true };
  if (typeof value === 'string') {
    summary.characterCount = value.length;
    return summary;
  }
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    return summary;
  }
  if (isArray) {
    const length = ownDataProperty(value as object, 'length');
    if (typeof length === 'number' && Number.isFinite(length)) summary.itemCount = length;
    return summary;
  }
  if (value && typeof value === 'object') {
    const metadataKeys = [
      'count', 'itemCount', 'characterCount', 'charCount', 'byteLength',
      'durationMs', 'segmentCount', 'wordCount',
    ];
    for (const key of metadataKeys) {
      const metadata = ownDataProperty(value, key);
      if (typeof metadata === 'number' && Number.isFinite(metadata) && metadata >= 0) {
        summary[key] = metadata;
      }
    }
  }
  return summary;
}

function normalizeError(value: Error, state: NormalizeState): Record<string, unknown> {
  const rawName = ownDataProperty(value, 'name');
  const rawMessage = ownDataProperty(value, 'message');
  const rawStack = ownDataProperty(value, 'stack');
  const name = typeof rawName === 'string' ? rawName : 'Error';
  const result: Record<string, unknown> = {
    name: scrubText(name, 128),
    message: typeof rawMessage === 'string' ? scrubText(rawMessage, state.maxStringChars) : '',
  };
  if (typeof rawStack === 'string') result.stack = scrubText(rawStack, state.maxStringChars * 2);
  return result;
}

function normalizeValue(
  value: unknown,
  state: NormalizeState,
  depth = 0,
  keyHint?: string,
): unknown {
  if (keyHint && isSecretField(keyHint)) return bodySummary(value);
  if (keyHint && isBodyField(keyHint)) return bodySummary(value);

  state.nodes += 1;
  if (state.nodes > state.maxNodes) return '[Truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return scrubText(value, state.maxStringChars);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'undefined') return '[Undefined]';
  if (typeof value === 'symbol') return '[Symbol]';
  if (typeof value === 'function') return '[Function]';
  if (typeof value !== 'object') return '[Unsupported]';
  if (depth >= state.maxDepth) return '[MaxDepth]';

  let isError = false;
  try {
    isError = value instanceof Error;
  } catch {
    // Proxies may throw during prototype inspection.
  }
  if (isError) return normalizeError(value as Error, state);

  if (state.seen.has(value)) return '[Circular]';
  state.seen.add(value);
  try {
    let isArray = false;
    try {
      isArray = Array.isArray(value);
    } catch {
      return '[Uninspectable]';
    }
    if (isArray) {
      const result: unknown[] = [];
      const rawLength = ownDataProperty(value, 'length');
      const length = typeof rawLength === 'number' && Number.isFinite(rawLength)
        ? Math.max(0, Math.floor(rawLength))
        : 0;
      const count = Math.min(length, state.maxEntries);
      for (let index = 0; index < count; index += 1) {
        const item = ownDataProperty(value, String(index));
        result.push(normalizeValue(item, state, depth + 1));
      }
      if (length > count) result.push(`[${length - count} more items]`);
      return result;
    }

    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let entryCount = 0;
    let truncated = false;
    try {
      for (const originalKey in value) {
        let isOwn = false;
        try {
          isOwn = Object.prototype.hasOwnProperty.call(value, originalKey);
        } catch {
          result._uninspectable = true;
          break;
        }
        if (!isOwn) continue;
        if (entryCount >= state.maxEntries) {
          truncated = true;
          break;
        }
        const key = originalKey.slice(0, 128);
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, originalKey);
        } catch {
          result[key] = '[Uninspectable]';
          entryCount += 1;
          continue;
        }
        if (descriptor) {
          result[key] = 'value' in descriptor
            ? normalizeValue(descriptor.value, state, depth + 1, key)
            : '[Getter omitted]';
        }
        entryCount += 1;
      }
    } catch {
      result._uninspectable = true;
    }
    if (truncated) result._truncatedKeys = true;
    return result;
  } finally {
    state.seen.delete(value);
  }
}

function safeDate(now: () => Date): Date {
  try {
    const value = now();
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  } catch {
    // Fall back to the system wall clock if an injected clock fails.
  }
  return new Date();
}

function parseTimestamp(value: number | string | Date | undefined, name: string): number | undefined {
  const filename = FILE_NAME_PATTERN.exec(name);
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isFinite(time)) return time;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  } else if (typeof value === 'string') {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  if (!filename) return undefined;
  const stamp = filename[1];
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T` +
    `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : undefined;
}

function fileTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function randomSessionId(): string {
  return Math.random().toString(36).slice(2, 14) || 'session';
}

export class DiagnosticLogger {
  private readonly storage: DiagnosticStorage;
  private readonly options: Required<Omit<DiagnosticLoggerOptions,
    'sessionId' | 'now' | 'monotonicNow' | 'onStorageFailure'>> & {
      now: () => Date;
      monotonicNow: () => number;
      onStorageFailure?: (error: unknown) => void;
    };
  private readonly sessionId: string;
  private readonly startedAtMonotonic: number;
  private readonly queue: QueuedLine[] = [];
  private readonly files = new Map<string, KnownFile>();
  // A single bounded segment is cached so periodic flushes can atomically replace it.
  private activeSegment?: ActiveSegment;
  private sequence = 0;
  private segmentSequence = 0;
  private queueBytes = 0;
  private droppedCount = 0;
  private inventoryReady = false;
  private initializing?: Promise<void>;
  private flushing?: Promise<void>;
  private pendingWrite?: PendingWrite;
  private notifyingFailure = false;

  constructor(
    storage: DiagnosticStorage,
    options: DiagnosticLoggerOptions = {},
  ) {
    this.storage = storage;
    const segmentBytes = clampInteger(
      options.maxSegmentBytes,
      DEFAULT_SEGMENT_BYTES,
      MIN_SEGMENT_BYTES,
      20 * 1024 * 1024,
    );
    const totalBytes = clampInteger(
      options.maxTotalBytes,
      DEFAULT_TOTAL_BYTES,
      segmentBytes,
      20 * 1024 * 1024,
    );
    const maxRecordBytes = clampInteger(
      options.maxRecordBytes,
      Math.min(DEFAULT_RECORD_BYTES, segmentBytes),
      MIN_SEGMENT_BYTES,
      segmentBytes,
    );
    this.options = {
      maxSegmentBytes: segmentBytes,
      maxTotalBytes: totalBytes,
      retentionMs: clampInteger(options.retentionMs, DEFAULT_RETENTION_MS, 0, 365 * DEFAULT_RETENTION_MS),
      maxBufferedBytes: clampInteger(options.maxBufferedBytes, DEFAULT_BUFFER_BYTES, MIN_SEGMENT_BYTES, 64 * 1024 * 1024),
      maxBufferedRecords: clampInteger(options.maxBufferedRecords, DEFAULT_BUFFER_RECORDS, 1, 100_000),
      maxRecordBytes,
      maxWriteAttempts: clampInteger(options.maxWriteAttempts, 2, 1, 5),
      maxStringChars: clampInteger(options.maxStringChars, DEFAULT_STRING_CHARS, 64, 32_768),
      now: options.now ?? (() => new Date()),
      monotonicNow: options.monotonicNow ?? (() => globalThis.performance?.now?.() ?? Date.now()),
      onStorageFailure: options.onStorageFailure,
    };
    const requestedSessionId = (options.sessionId ?? randomSessionId())
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 64);
    this.sessionId = requestedSessionId || randomSessionId();
    this.startedAtMonotonic = this.readMonotonic();
  }

  log(input: DiagnosticLogInput): boolean {
    const inputObject = input && typeof input === 'object' ? input as object : {};
    const rawLevel = ownDataProperty(inputObject, 'level');
    const rawSource = ownDataProperty(inputObject, 'source');
    const rawEvent = ownDataProperty(inputObject, 'event');
    const rawData = ownDataProperty(inputObject, 'data');
    const rawTime = ownDataProperty(inputObject, 'time');
    const rawElapsedMs = ownDataProperty(inputObject, 'elapsedMs');

    if (this.droppedCount > 0 && !this.enqueueDropMarker()) {
      this.droppedCount += 1;
      return false;
    }

    const level = rawLevel === 'debug' || rawLevel === 'warn' || rawLevel === 'error'
      ? rawLevel
      : 'info';
    const record: DiagnosticRecord = {
      time: safeDate(this.options.now).toISOString(),
      elapsedMs: Math.max(0, this.readMonotonic() - this.startedAtMonotonic),
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      level,
      source: scrubText(typeof rawSource === 'string' ? rawSource : 'app', 128),
      event: scrubText(typeof rawEvent === 'string' ? rawEvent : 'unknown', 128),
      data: this.normalize(rawData),
    };
    if (typeof rawTime === 'string') record.sourceTime = scrubText(rawTime, 128);
    if (typeof rawElapsedMs === 'number' && Number.isFinite(rawElapsedMs) && rawElapsedMs >= 0) {
      record.sourceElapsedMs = rawElapsedMs;
    }

    const queued = this.encodeRecord(record);
    if (!this.hasCapacity(queued.bytes)) {
      this.droppedCount += 1;
      return false;
    }
    this.queue.push(queued);
    this.queueBytes += queued.bytes;
    return true;
  }

  async initialize(): Promise<void> {
    if (this.inventoryReady) return;
    if (this.initializing) return this.initializing;
    const initialization = this.scanStorage();
    this.initializing = initialization;
    try {
      await initialization;
    } finally {
      if (this.initializing === initialization) this.initializing = undefined;
    }
  }

  async flush(): Promise<void> {
    await this.initialize();
    if (!this.inventoryReady) return;
    if (this.flushing) return this.flushing;

    const flushing = this.drainQueue();
    this.flushing = flushing;
    try {
      await flushing;
    } finally {
      if (this.flushing === flushing) this.flushing = undefined;
    }
  }

  getPendingStats(): DiagnosticPendingStats {
    return { records: this.queue.length, bytes: this.queueBytes, dropped: this.droppedCount };
  }

  private normalize(value: unknown): unknown {
    const state: NormalizeState = {
      seen: new WeakSet<object>(),
      nodes: 0,
      maxNodes: 256,
      maxDepth: 6,
      maxEntries: 64,
      maxStringChars: this.options.maxStringChars,
    };
    return value === undefined ? null : normalizeValue(value, state);
  }

  private encodeRecord(record: DiagnosticRecord): QueuedLine {
    let line = JSON.stringify(record);
    let bytes = utf8ByteLength(line) + 1;
    if (bytes > this.options.maxRecordBytes) {
      line = JSON.stringify({ ...record, data: { truncated: true } });
      bytes = utf8ByteLength(line) + 1;
    }
    if (bytes > this.options.maxRecordBytes) {
      line = JSON.stringify({
        time: record.time,
        elapsedMs: record.elapsedMs,
        sessionId: record.sessionId,
        sequence: record.sequence,
        level: record.level,
        source: scrubText(record.source, 64),
        event: scrubText(record.event, 64),
        data: null,
      });
      bytes = utf8ByteLength(line) + 1;
    }
    return { line: `${line}\n`, bytes };
  }

  private hasCapacity(bytes: number): boolean {
    return this.queue.length < this.options.maxBufferedRecords &&
      this.queueBytes + bytes <= this.options.maxBufferedBytes;
  }

  private enqueueDropMarker(): boolean {
    if (this.droppedCount <= 0) return true;
    const record: DiagnosticRecord = {
      time: safeDate(this.options.now).toISOString(),
      elapsedMs: Math.max(0, this.readMonotonic() - this.startedAtMonotonic),
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      level: 'warn',
      source: 'diagnostics',
      event: 'records-dropped',
      data: { count: this.droppedCount },
    };
    const queued = this.encodeRecord(record);
    if (!this.hasCapacity(queued.bytes)) return false;
    this.queue.push(queued);
    this.queueBytes += queued.bytes;
    this.droppedCount = 0;
    return true;
  }

  private async scanStorage(): Promise<void> {
    try {
      await this.storage.initialize();
      const entries = await this.storage.list();
      this.files.clear();
      for (const entry of entries) {
        if (!FILE_NAME_PATTERN.test(entry.name)) continue;
        const size = Number.isFinite(entry.size) ? Math.max(0, Math.floor(entry.size)) : 0;
        this.files.set(entry.name, {
          name: entry.name,
          size,
          timestampMs: parseTimestamp(entry.modifiedAt, entry.name),
        });
      }
      this.inventoryReady = true;
      await this.pruneTo(this.options.maxTotalBytes, safeDate(this.options.now).getTime());
    } catch (error) {
      this.inventoryReady = false;
      this.reportStorageFailure(error);
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0 || this.droppedCount > 0) {
      if (this.droppedCount > 0) this.enqueueDropMarker();
      if (!this.pendingWrite) this.pendingWrite = this.buildPendingWrite();
      const pending = this.pendingWrite;
      if (!pending) return;

      const nowMs = safeDate(this.options.now).getTime();
      const active = this.activeSegment;
      const replacesActive = pending.replacesActive && active?.name === pending.name;
      const addedBytes = replacesActive
        ? Math.max(0, pending.bytes - active.bytes)
        : pending.bytes;
      await this.pruneTo(this.options.maxTotalBytes - addedBytes, nowMs);
      if (this.totalKnownBytes() + addedBytes > this.options.maxTotalBytes) {
        this.reportStorageFailure(new Error('Diagnostics storage limit reached'));
        return;
      }

      let writeError: unknown;
      let written = false;
      for (let attempt = 0; attempt < this.options.maxWriteAttempts; attempt += 1) {
        try {
          await this.storage.write(pending.name, pending.contents);
          written = true;
          break;
        } catch (error) {
          writeError = error;
        }
      }
      if (!written) {
        this.reportStorageFailure(writeError);
        return;
      }

      this.files.set(pending.name, {
        name: pending.name,
        size: pending.bytes,
        timestampMs: nowMs,
      });
      this.activeSegment = {
        name: pending.name,
        contents: pending.contents,
        bytes: pending.bytes,
      };
      this.queue.splice(0, pending.recordCount);
      this.queueBytes -= addedBytes;
      this.pendingWrite = undefined;
      if (this.droppedCount > 0) this.enqueueDropMarker();
      await this.pruneTo(this.options.maxTotalBytes, safeDate(this.options.now).getTime());
    }
  }

  private buildPendingWrite(): PendingWrite | undefined {
    if (this.queue.length === 0) return undefined;
    const active = this.activeSegment;
    const canAppendActive = Boolean(active) &&
      active!.bytes + this.queue[0].bytes <= this.options.maxSegmentBytes;
    const baseContents = canAppendActive ? active!.contents : '';
    const baseBytes = canAppendActive ? active!.bytes : 0;
    let recordCount = 0;
    let addedBytes = 0;
    for (const record of this.queue) {
      if (baseBytes + addedBytes + record.bytes > this.options.maxSegmentBytes) break;
      addedBytes += record.bytes;
      recordCount += 1;
    }
    if (recordCount === 0) {
      this.droppedCount += 1;
      this.queueBytes -= this.queue[0].bytes;
      this.queue.shift();
      return undefined;
    }

    const contents = baseContents + this.queue.slice(0, recordCount).map((record) => record.line).join('');
    const name = canAppendActive ? active!.name : this.nextFileName();
    return {
      name,
      contents,
      bytes: baseBytes + addedBytes,
      recordCount,
      replacesActive: canAppendActive,
    };
  }

  private nextFileName(): string {
    const stamp = fileTimestamp(safeDate(this.options.now));
    let name = '';
    do {
      name = `diagnostics-${stamp}-${this.sessionId}-${String(this.segmentSequence).padStart(6, '0')}.jsonl`;
      this.segmentSequence += 1;
    } while (this.files.has(name));
    return name;
  }

  private async pruneTo(targetBytes: number, nowMs: number): Promise<void> {
    const target = Math.max(0, targetBytes);
    const isProtected = (file: KnownFile) => file.name === this.activeSegment?.name;
    const expired = [...this.files.values()]
      .filter((file) => !isProtected(file) && file.timestampMs !== undefined &&
        nowMs - file.timestampMs > this.options.retentionMs)
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
    const attempted = new Set<string>();
    for (const file of expired) {
      attempted.add(file.name);
      await this.removeKnownFile(file);
    }

    while (this.totalKnownBytes() > target) {
      const oldest = [...this.files.values()]
        .filter((file) => !attempted.has(file.name) && !isProtected(file))
        .sort((a, b) => (a.timestampMs ?? Number.MAX_SAFE_INTEGER) -
          (b.timestampMs ?? Number.MAX_SAFE_INTEGER))[0];
      if (!oldest) break;
      attempted.add(oldest.name);
      await this.removeKnownFile(oldest);
    }
  }

  private async removeKnownFile(file: KnownFile): Promise<void> {
    if (!FILE_NAME_PATTERN.test(file.name)) return;
    try {
      await this.storage.remove(file.name);
      this.files.delete(file.name);
    } catch (error) {
      this.reportStorageFailure(error);
    }
  }

  private totalKnownBytes(): number {
    let total = 0;
    for (const file of this.files.values()) total += file.size;
    return total;
  }

  private readMonotonic(): number {
    try {
      const value = this.options.monotonicNow();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  }

  private reportStorageFailure(error: unknown): void {
    if (!this.options.onStorageFailure || this.notifyingFailure) return;
    this.notifyingFailure = true;
    try {
      const result = this.options.onStorageFailure(error) as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => undefined);
      }
    } catch {
      // Diagnostics must not make an app failure worse.
    } finally {
      this.notifyingFailure = false;
    }
  }
}
