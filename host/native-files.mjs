import { constants } from 'node:fs';
import { opendir, open, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, parse, relative, resolve, sep } from 'node:path';

const MAX_PATH_BYTES = 4096;
const MAX_SEGMENT_BYTES = 255;
export const MAX_NATIVE_FILE_ENTRIES = 500;
export const MAX_NATIVE_FILE_TEXT_BYTES = 256 * 1024;
export const MAX_NATIVE_FILE_LIST_BYTES = 256 * 1024;

export const NATIVE_FILES_ERROR_CODES = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
});

/** An error whose code is included in the native HTTP server's safe error allowlist. */
export class NativeFilesError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NativeFilesError';
    this.code = code;
  }
}

const fail = (code) => { throw new NativeFilesError(code); };
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function fsFailure(error) {
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'ELOOP') {
    return new NativeFilesError(NATIVE_FILES_ERROR_CODES.NOT_FOUND);
  }
  return new NativeFilesError(NATIVE_FILES_ERROR_CODES.UPSTREAM_UNAVAILABLE);
}

function paramsOf(params) {
  if (!isRecord(params)
    || Object.keys(params).some((key) => !['id', 'path'].includes(key))
    || typeof params.id !== 'string' || !params.id || params.id.length > 256
    || typeof params.path !== 'string') {
    fail(NATIVE_FILES_ERROR_CODES.BAD_REQUEST);
  }
  return { id: params.id, segments: pathSegments(params.path) };
}

function pathSegments(value) {
  if (Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES
    || value.includes('\0') || value.includes('\\')
    || /[\u0001-\u001f\u007f]/u.test(value)
    || value.startsWith('/') || isAbsolute(value)
    || /^[A-Za-z]:/u.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) {
    fail(NATIVE_FILES_ERROR_CODES.BAD_REQUEST);
  }
  if (value === '') return [];
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || Buffer.byteLength(segment, 'utf8') > MAX_SEGMENT_BYTES)) {
    fail(NATIVE_FILES_ERROR_CODES.BAD_REQUEST);
  }
  return segments;
}

function within(root, target) {
  const child = relative(root, target);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function displayPath(segments) {
  return segments.join('/');
}

async function canonicalPath(root, segments) {
  let target;
  try {
    target = await realpath(resolve(root, ...segments));
  } catch (error) {
    throw fsFailure(error);
  }
  if (!within(root, target)) fail(NATIVE_FILES_ERROR_CODES.NOT_FOUND);
  return target;
}

/** Create two read-only file methods rooted in the cwd of a DSH session row. */
export function createNativeFiles({ getSessionRow }) {
  if (typeof getSessionRow !== 'function') {
    throw new TypeError('Native files require a DSH session-row lookup.');
  }

  async function sessionRoot(id) {
    let row;
    try {
      row = await getSessionRow(id);
    } catch (error) {
      if (error instanceof NativeFilesError) throw error;
      throw fsFailure(error);
    }
    if (!isRecord(row) || (row.sessionId ?? row.id) !== id
      || typeof row.cwd !== 'string' || !isAbsolute(row.cwd)) {
      fail(NATIVE_FILES_ERROR_CODES.NOT_FOUND);
    }

    let root;
    try {
      root = await realpath(row.cwd);
      const info = await stat(root);
      if (!info.isDirectory() || root === parse(root).root) {
        fail(NATIVE_FILES_ERROR_CODES.NOT_FOUND);
      }
    } catch (error) {
      if (error instanceof NativeFilesError) throw error;
      throw fsFailure(error);
    }
    return root;
  }

  async function targetFor(id, segments) {
    const root = await sessionRoot(id);
    const target = await canonicalPath(root, segments);
    let info;
    try {
      info = await stat(target);
    } catch (error) {
      throw fsFailure(error);
    }
    return { root, target, info };
  }

  return Object.freeze({
    /** List at most 500 safe direct children from the session's current cwd. */
    async list(params) {
      const { id, segments } = paramsOf(params);
      const { root, target, info } = await targetFor(id, segments);
      if (!info.isDirectory()) fail(NATIVE_FILES_ERROR_CODES.BAD_REQUEST);

      let directory;
      try {
        directory = await opendir(target);
      } catch (error) {
        throw fsFailure(error);
      }

      const entries = [];
      const name = segments.at(-1) ?? basename(root);
      const path = displayPath(segments);
      let listedBytes = Buffer.byteLength(JSON.stringify({
        name, path, entries: [], truncated: false,
      }), 'utf8');
      let scanned = 0;
      let truncated = false;
      try {
        for await (const child of directory) {
          scanned += 1;
          if (scanned > MAX_NATIVE_FILE_ENTRIES) {
            truncated = true;
            break;
          }
          const childSegments = [...segments, child.name];
          let childPath;
          try {
            pathSegments(displayPath(childSegments));
            childPath = await canonicalPath(root, childSegments);
          } catch (error) {
            if (error instanceof NativeFilesError && error.code === NATIVE_FILES_ERROR_CODES.BAD_REQUEST) {
              continue;
            }
            if (error instanceof NativeFilesError && error.code === NATIVE_FILES_ERROR_CODES.NOT_FOUND) {
              continue;
            }
            throw error;
          }

          let childInfo;
          try {
            childInfo = await stat(childPath);
          } catch (_error) {
            // A child can disappear between realpath and stat.
            continue;
          }
          if (!childInfo.isDirectory() && !childInfo.isFile()) continue;
          const entry = {
            name: child.name,
            path: displayPath(childSegments),
            isDirectory: childInfo.isDirectory(),
            ...(childInfo.isFile() && Number.isSafeInteger(childInfo.size) && childInfo.size >= 0
              ? { size: childInfo.size } : {}),
          };
          const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
          const separatorBytes = entries.length === 0 ? 0 : 1;
          if (listedBytes + separatorBytes + bytes > MAX_NATIVE_FILE_LIST_BYTES) {
            truncated = true;
            break;
          }
          entries.push(entry);
          listedBytes += separatorBytes + bytes;
        }
      } catch (error) {
        if (error instanceof NativeFilesError) throw error;
        throw fsFailure(error);
      }

      entries.sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory)
        || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));
      return {
        name,
        path,
        entries,
        truncated,
      };
    },

    /** Read at most 256 KiB of UTF-8 text from a regular file in the session cwd. */
    async read(params) {
      const { id, segments } = paramsOf(params);
      if (segments.length === 0) fail(NATIVE_FILES_ERROR_CODES.BAD_REQUEST);
      const { root, target, info } = await targetFor(id, segments);
      if (!info.isFile()) fail(NATIVE_FILES_ERROR_CODES.BAD_REQUEST);

      let handle;
      try {
        handle = await open(target,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        const openedInfo = await handle.stat();
        const openedPath = await realpath(target);
        if (!openedInfo.isFile() || !within(root, openedPath) || openedPath !== target) {
          fail(NATIVE_FILES_ERROR_CODES.NOT_FOUND);
        }

        const buffer = Buffer.alloc(MAX_NATIVE_FILE_TEXT_BYTES + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const result = await handle.read(
            buffer,
            bytesRead,
            buffer.length - bytesRead,
            bytesRead,
          );
          if (result.bytesRead === 0) break;
          bytesRead += result.bytesRead;
        }
        const truncated = bytesRead > MAX_NATIVE_FILE_TEXT_BYTES
          || openedInfo.size > MAX_NATIVE_FILE_TEXT_BYTES;
        const content = buffer.subarray(0, Math.min(bytesRead, MAX_NATIVE_FILE_TEXT_BYTES));
        let text;
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          text = decoder.decode(content, { stream: truncated });
          if (!truncated) text += decoder.decode();
        } catch {
          fail(NATIVE_FILES_ERROR_CODES.BAD_REQUEST);
        }
        if (text.includes('\0')) fail(NATIVE_FILES_ERROR_CODES.BAD_REQUEST);
        return {
          name: segments.at(-1),
          path: displayPath(segments),
          text,
          truncated,
        };
      } catch (error) {
        if (error instanceof NativeFilesError) throw error;
        throw fsFailure(error);
      } finally {
        await handle?.close();
      }
    },
  });
}
