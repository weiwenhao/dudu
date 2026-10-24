import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const capture = path.join(root, '.local', 'full-page-review');
const resourceDirectory = path.join(capture, 'resources');
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;
const MAX_REPLY_BYTES = 6 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 512 * 1024 * 1024;
const PAGE_KINDS = new Set(['plugins', 'trace', 'context', 'team', 'tools', 'settings']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => { throw new Error(message); };

async function regularFile(file, description, maxBytes = Infinity) {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) fail(`${description} is missing or invalid.`);
  if (info.size > maxBytes) fail(`${description} is too large.`);
  return info;
}

function validResourcePath(value) {
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('/')
    || value.startsWith('//') || /[\u0000-\u0020\u007f\\#]/u.test(value)) return false;
  return value.split('?')[0].split('/').every((part) => {
    try {
      const decoded = decodeURIComponent(part);
      return decoded !== '.' && decoded !== '..' && !/[\\/\u0000-\u001f\u007f]/u.test(decoded);
    } catch {
      return false;
    }
  });
}

async function validateResources(resources) {
  if (!isRecord(resources) || Object.keys(resources).length > 256) {
    fail('Manifest resources must be a bounded object.');
  }
  const entries = Object.entries(resources);
  if (entries.length) {
    const directory = await lstat(resourceDirectory).catch(() => null);
    if (!directory?.isDirectory() || directory.isSymbolicLink()) {
      fail('Capture resources are missing or invalid.');
    }
  }

  const directoryPath = entries.length ? await realpath(resourceDirectory) : null;
  let totalBytes = 0;
  const filenames = new Set();
  for (const [requestPath, resource] of entries) {
    if (!validResourcePath(requestPath) || !isRecord(resource)
      || typeof resource.file !== 'string' || !/^[a-f0-9]{64}\.bin$/u.test(resource.file)
      || typeof resource.mimeType !== 'string' || resource.mimeType.length > 256
      || /[\r\n]/u.test(resource.mimeType)
      || !Number.isSafeInteger(resource.bytes) || resource.bytes < 0) {
      fail('Capture contains invalid resource metadata.');
    }
    const file = path.join(resourceDirectory, resource.file);
    const info = await regularFile(file, 'A captured resource');
    if (path.dirname(await realpath(file)) !== directoryPath || info.size !== resource.bytes
      || info.size > MAX_RESOURCE_BYTES) {
      fail('A captured resource does not match its manifest metadata.');
    }
    totalBytes += info.size;
    if (totalBytes > MAX_TOTAL_RESOURCE_BYTES) fail('Captured resources exceed the validation limit.');
    filenames.add(resource.file);
  }

  if (entries.length) {
    const onDisk = (await readdir(resourceDirectory)).sort();
    if (onDisk.join('\n') !== [...filenames].sort().join('\n')) {
      fail('Capture resource files do not match the manifest.');
    }
  }
  return { count: entries.length, bytes: totalBytes };
}

function validateSnapshots(manifest) {
  const calls = manifest.calls;
  const streams = manifest.streams;
  if (!Array.isArray(calls) || !calls.every((item) => isRecord(item)
    && typeof item.endpoint === 'string' && isRecord(item.args) && Object.hasOwn(item, 'result'))) {
    fail('Manifest RPC snapshots are invalid.');
  }
  if (!Array.isArray(streams) || !streams.every((item) => isRecord(item)
    && typeof item.endpoint === 'string' && isRecord(item.args) && Array.isArray(item.items))) {
    fail('Manifest stream snapshots are invalid.');
  }
  return { calls: calls.length, streams: streams.length };
}

async function main() {
  const captureInfo = await lstat(capture).catch(() => null);
  if (!captureInfo?.isDirectory() || captureInfo.isSymbolicLink()) {
    fail('Missing .local/full-page-review. Obtain the actual read-only DSH capture; no mock pages are generated.');
  }
  const manifestPath = path.join(capture, 'manifest.json');
  const completePath = path.join(capture, 'complete.json');
  const manifestInfo = await lstat(manifestPath).catch(() => null);
  const completeInfo = await lstat(completePath).catch(() => null);
  if (!manifestInfo?.isFile() || !completeInfo?.isFile()) {
    fail('Incomplete .local/full-page-review capture. Obtain the actual read-only DSH resources; no mock pages are generated.');
  }
  await regularFile(manifestPath, 'Capture manifest', MAX_MANIFEST_BYTES);
  await regularFile(completePath, 'Capture completion record', 64 * 1024);

  let manifest;
  let complete;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    complete = JSON.parse(await readFile(completePath, 'utf8'));
  } catch {
    fail('Capture manifest or completion record is not valid JSON.');
  }
  if (!isRecord(manifest) || manifest.version !== 1 || !isRecord(manifest.documents)
    || !Object.hasOwn(manifest.documents, 'plugins')) {
    fail('Capture manifest must be version 1 and include the plugins page.');
  }
  const pages = Object.entries(manifest.documents).filter(([kind]) => kind !== 'dock');
  for (const [kind, html] of pages) {
    if (!PAGE_KINDS.has(kind) || typeof html !== 'string' || !html
      || Buffer.byteLength(html, 'utf8') > 768 * 1024) {
      fail('Capture manifest contains an invalid page document.');
    }
  }

  const resources = await validateResources(manifest.resources);
  const snapshots = validateSnapshots(manifest);
  if (!isRecord(complete) || complete.resourceCount !== resources.count
    || complete.resourceBytes !== resources.bytes || complete.callCount !== snapshots.calls
    || complete.streamCount !== snapshots.streams || !Number.isSafeInteger(complete.maxReplyBytes)
    || complete.maxReplyBytes < 0 || complete.maxReplyBytes > MAX_REPLY_BYTES
    || !Array.isArray(manifest.failures)
    || !Array.isArray(complete.failures) || complete.failures.length !== manifest.failures.length) {
    fail('complete.json does not match the manifest or native review limits.');
  }

  console.log(`Verified DSH capture: .local/full-page-review/manifest.json`);
  console.log(`Pages: ${pages.map(([kind]) => kind).sort().join(', ')}; resources: ${resources.count} (${resources.bytes} bytes); RPC: ${snapshots.calls}; streams: ${snapshots.streams}; recorded capture failures: ${manifest.failures.length}.`);
  console.log('Validation only: the capture remains in .local and was not copied or printed.');
}

if (process.argv.length > 2 && process.argv[2] !== '--check-capture') {
  console.error('Usage: npm run native:review-pages [-- --check-capture]');
  process.exitCode = 2;
} else {
  main().catch((error) => {
    console.error(`Review-page validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
