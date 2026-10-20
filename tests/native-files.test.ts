import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createNativeBridge,
  NATIVE_METHODS,
} from '../host/native-bridge.mjs';
import {
  MAX_NATIVE_FILE_ENTRIES,
  MAX_NATIVE_FILE_LIST_BYTES,
  MAX_NATIVE_FILE_TEXT_BYTES,
  NATIVE_FILES_ERROR_CODES,
} from '../host/native-files.mjs';

async function makeFixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'dsbot-native-files-'));
  const root = join(temporary, 'workspace');
  const outside = join(temporary, 'outside');
  await mkdir(join(root, 'nested'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, 'README.md'), 'hello from the session cwd\n');
  await writeFile(join(root, 'nested', 'notes.txt'), 'nested text');
  await writeFile(join(outside, 'secret.txt'), 'outside secret');
  await symlink(outside, join(root, 'escape'));
  await symlink(join(root, 'nested'), join(root, 'inside-link'));
  const calls: string[] = [];
  const rpc = {
    async call(_channel: string, endpoint: string) {
      calls.push(endpoint);
      if (endpoint === 'session/list') {
        return { items: [{ sessionId: 'session-1', cwd: root }] };
      }
      throw new Error('unexpected RPC method');
    },
    async open() {
      throw new Error('file browsing must not open a generic RPC stream');
    },
  };
  return {
    temporary,
    root,
    bridge: createNativeBridge({ rpc }),
    calls,
  };
}

test('files.list and files.read use the DSH session cwd and return relative paths', async () => {
  const fixture = await makeFixture();
  try {
    const directory = await fixture.bridge.dispatch('files.list', {
      id: 'session-1',
      path: '',
    }, {}) as {
      name: string;
      path: string;
      entries: Array<{ name: string; path: string; isDirectory: boolean; size?: number }>;
      truncated: boolean;
    };
    assert.equal(directory.name, 'workspace');
    assert.equal(directory.path, '');
    assert.equal(directory.truncated, false);
    assert.equal(directory.entries.some((entry) => entry.name === 'escape'), false);
    assert.equal(directory.entries.some((entry) => entry.name === 'inside-link' && entry.isDirectory), true);

    const file = await fixture.bridge.dispatch('files.read', {
      id: 'session-1',
      path: 'nested/notes.txt',
    }, {}) as { name: string; path: string; text: string; truncated: boolean };
    assert.deepEqual(file, {
      name: 'notes.txt',
      path: 'nested/notes.txt',
      text: 'nested text',
      truncated: false,
    });
    assert.deepEqual(fixture.calls, ['session/list']);
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
});

test('files methods reject traversal, absolute, URL, and caller-supplied root paths', async () => {
  const fixture = await makeFixture();
  try {
    for (const path of ['/etc/passwd', '../outside/secret.txt', 'nested/../../outside/secret.txt',
      'C:/Users/user/secret.txt', 'https://example.invalid/file', 'nested\\notes.txt']) {
      await assert.rejects(
        fixture.bridge.dispatch('files.read', { id: 'session-1', path }, {}),
        { code: NATIVE_FILES_ERROR_CODES.BAD_REQUEST },
      );
    }
    await assert.rejects(
      fixture.bridge.dispatch('files.list', {
        id: 'session-1',
        path: '',
        root: fixture.root,
      }, {}),
      { code: NATIVE_FILES_ERROR_CODES.BAD_REQUEST },
    );
    await assert.rejects(
      fixture.bridge.dispatch('files.list', { id: 'missing-session', path: '' }, {}),
      { code: NATIVE_FILES_ERROR_CODES.NOT_FOUND },
    );
    const cwdlessBridge = createNativeBridge({
      rpc: {
        async call() {
          return { items: [{ sessionId: 'session-without-cwd' }] };
        },
        async open() {
          throw new Error('file browsing must not open a generic RPC stream');
        },
      },
    });
    await assert.rejects(
      cwdlessBridge.dispatch('files.list', { id: 'session-without-cwd', path: '' }, {}),
      { code: NATIVE_FILES_ERROR_CODES.NOT_FOUND },
    );
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
});

test('files methods reject symlinks that resolve outside the DSH session cwd', async () => {
  const fixture = await makeFixture();
  try {
    await assert.rejects(
      fixture.bridge.dispatch('files.list', { id: 'session-1', path: 'escape' }, {}),
      { code: NATIVE_FILES_ERROR_CODES.NOT_FOUND },
    );
    await assert.rejects(
      fixture.bridge.dispatch('files.read', { id: 'session-1', path: 'escape/secret.txt' }, {}),
      { code: NATIVE_FILES_ERROR_CODES.NOT_FOUND },
    );
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
});

test('file responses stay within entry, list-byte, and UTF-8 text caps', async () => {
  const fixture = await makeFixture();
  try {
    await Promise.all(Array.from({ length: MAX_NATIVE_FILE_ENTRIES + 1 }, (_, index) =>
      writeFile(join(fixture.root, `entry-${String(index).padStart(3, '0')}.txt`), 'x')));
    await writeFile(join(fixture.root, 'large.txt'), '你'.repeat(100_000));

    const directory = await fixture.bridge.dispatch('files.list', {
      id: 'session-1',
      path: '',
    }, {}) as { entries: unknown[]; truncated: boolean };
    assert.ok(directory.entries.length <= MAX_NATIVE_FILE_ENTRIES);
    assert.equal(directory.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(directory), 'utf8') < MAX_NATIVE_FILE_LIST_BYTES);

    const file = await fixture.bridge.dispatch('files.read', {
      id: 'session-1',
      path: 'large.txt',
    }, {}) as { text: string; truncated: boolean };
    assert.ok(Buffer.byteLength(file.text, 'utf8') <= MAX_NATIVE_FILE_TEXT_BYTES);
    assert.equal(file.text.endsWith('�'), false);
    assert.equal(file.truncated, true);
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
});

test('files.read accepts only regular UTF-8 text and the bridge exposes no generic file RPC', async () => {
  const fixture = await makeFixture();
  try {
    await writeFile(join(fixture.root, 'binary.bin'), Buffer.from([0xff, 0xfe]));
    await assert.rejects(
      fixture.bridge.dispatch('files.read', { id: 'session-1', path: 'binary.bin' }, {}),
      { code: NATIVE_FILES_ERROR_CODES.BAD_REQUEST },
    );
    await assert.rejects(
      fixture.bridge.dispatch('files.read', { id: 'session-1', path: 'nested' }, {}),
      { code: NATIVE_FILES_ERROR_CODES.BAD_REQUEST },
    );
    assert.equal(NATIVE_METHODS.includes('files.list'), true);
    assert.equal(NATIVE_METHODS.includes('files.read'), true);
    assert.equal(NATIVE_METHODS.includes('files.write'), false);
    await assert.rejects(
      fixture.bridge.dispatch('files.write', { id: 'session-1', path: 'README.md' }, {}),
      { code: 'UNSUPPORTED' },
    );
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true });
  }
});
