import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeHistory } from '../host/providers/native/claude-history.mjs';
import { codexHistory } from '../host/providers/native/codex-history.mjs';
import { imageFromBase64, imageFromUrl, keepImages, sniffImageType, userContent } from '../host/providers/native/images.mjs';
import { createLinkStore, createNativeSessions } from '../host/providers/native/index.mjs';
import { buildSessionEvents } from '../host/providers/native/session-events.mjs';

// A 1×1 PNG, and a few bytes that are not a picture.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const NOT_A_PICTURE = Buffer.from('this is plain text, not a picture at all');

/** DSH's attachment store as far as a load meets it: it remembers what it was given and answers with references. */
function fakeAttachments({ limits = {}, refuse = (_input: any) => false, refuseBatch = false } = {}) {
  const calls: any[][] = [];
  let next = 0;
  const reference = (input: any) => ({ attachmentId: `att-${next++}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1 });
  return {
    calls,
    imageLimits: { maxImageBytes: 1_000_000, maxImagesPerMessage: 4, maxMessageImageBytes: 3_000_000, maxImagePixels: 1e9, maxImageDimension: 10_000, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], ...limits },
    async saveImages(inputs: any[]) {
      calls.push(inputs);
      if (refuseBatch || inputs.some(refuse)) throw new Error('refused');
      return inputs.map(reference);
    },
    async saveImage(input: any) {
      calls.push([input]);
      if (refuse(input)) throw new Error('refused');
      return reference(input);
    },
  };
}

const turnWith = (parts: any[], prompt = 'words') => ({ at: 1, prompt, parts, steps: [], results: new Map() });
const history = (...turns: any[]) => ({ provider: 'claude', id: 'x', cwd: '/work', turns });
const attachmentOf = (part: any) => part.attachment?.attachmentId;

test('a picture is known by its bytes, not by what it is called', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)])), 'image/gif');
  assert.equal(sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)])), 'image/webp');
  assert.equal(sniffImageType(NOT_A_PICTURE), undefined);
  assert.equal(sniffImageType(Buffer.alloc(3)), undefined);

  const budget = { left: 100 };
  assert.deepEqual(imageFromBase64(PNG_BASE64, 'image/jpeg', budget), { type: 'image', mediaType: 'image/png', data: PNG }, 'the bytes win over the declared type');
  assert.equal(budget.left, 100 - PNG.length);
  assert.deepEqual(imageFromBase64(PNG_BASE64, 'image/png', { left: 10 }), { type: 'image', skipped: true }, 'one that does not fit what may be kept is a marker');
  assert.deepEqual(imageFromBase64(Buffer.from(NOT_A_PICTURE).toString('base64'), 'text/plain'), { type: 'image', skipped: true });
  assert.deepEqual(imageFromUrl(`data:image/png;base64,${PNG_BASE64}`), { type: 'image', mediaType: 'image/png', data: PNG });
  assert.deepEqual(imageFromUrl('https://example.test/a.png'), { type: 'image', skipped: true }, 'a link is never fetched');
});

test('the message holds the words and the stored pictures in the order they were sent, and a marker for what could not be stored', () => {
  const stored = { attachmentId: 'a-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 };
  assert.deepEqual(userContent({ prompt: 'only words' }), [{ type: 'text', text: 'only words' }]);
  assert.deepEqual(userContent(turnWith([{ type: 'image', attachment: stored }, { type: 'text', text: 'what is this?' }, { type: 'image', attachment: { ...stored, attachmentId: 'a-2' } }])), [
    { type: 'image', attachment: stored },
    { type: 'text', text: 'what is this?' },
    { type: 'image', attachment: { ...stored, attachmentId: 'a-2' } },
  ]);
  // Words and markers that sit together are one text, as the one-string prompt was.
  assert.deepEqual(userContent(turnWith([{ type: 'image', skipped: true }, { type: 'image', skipped: true }, { type: 'text', text: 'look' }])), [{ type: 'text', text: '[image]\n[image]\nlook' }]);
  assert.deepEqual(userContent(turnWith([{ type: 'text', text: 'look' }, { type: 'image', skipped: true }])), [{ type: 'text', text: 'look\n[image]' }]);
  assert.deepEqual(userContent(turnWith([{ type: 'image' }], 'fallback')), [{ type: 'text', text: '[image]' }], 'a picture that was never stored is a marker');
});

test('keeping pictures stores each message as one ordered batch, lets the bytes go, and leaves the conversation it was given alone', async () => {
  const attachments = fakeAttachments();
  const original = history(
    turnWith([{ type: 'text', text: 'one' }, { type: 'image', mediaType: 'image/png', data: PNG }, { type: 'image', mediaType: 'image/jpeg', data: JPEG }]),
    { at: 2, prompt: 'no pictures here', steps: [], results: new Map() },
  );
  const kept = await keepImages(original, { attachments });
  assert.equal(attachments.calls.length, 1, 'one call for the message');
  assert.deepEqual(attachments.calls[0].map((input: any) => [input.mediaType, input.data.byteLength]), [['image/png', PNG.length], ['image/jpeg', JPEG.length]]);
  assert.deepEqual(kept.turns[0].parts.map((part: any) => part.type === 'image' ? attachmentOf(part) : part.text), ['one', 'att-0', 'att-1']);
  assert.ok(kept.turns[0].parts.every((part: any) => !part.data && !part.path), 'the bytes are let go');
  assert.equal(kept.turns[1], original.turns[1], 'a turn without pictures is the same turn');
  assert.ok(original.turns[0].parts[1].data, 'what was given is not changed');
});

test('what cannot be stored stays a marker: no service, refused, too big, too many, not a picture, a file that is gone', async () => {
  const picture = (bytes = PNG, mediaType = 'image/png') => ({ type: 'image', mediaType, data: bytes });
  const markers = (kept: any) => kept.turns[0].parts.map((part: any) => (part.attachment ? 'stored' : part.skipped ? 'marker' : part.type));

  // DSH without an attachment store.
  assert.deepEqual(markers(await keepImages(history(turnWith([picture(), picture()])), {})), ['marker', 'marker']);
  assert.deepEqual(markers(await keepImages(history(turnWith([picture()])), { attachments: {} })), ['marker'], 'a store that cannot save pictures');

  // One picture the store does not take: the batch is refused, so they are tried one by one and only that one is lost.
  const picky = fakeAttachments({ refuse: (input: any) => input.mediaType === 'image/jpeg' });
  assert.deepEqual(markers(await keepImages(history(turnWith([picture(), picture(JPEG, 'image/jpeg'), picture()])), { attachments: picky })), ['stored', 'marker', 'stored']);
  assert.equal(picky.calls.length, 1 + 3, 'the batch, then each alone');

  // Limits of the store: the count, the size of one, the types.
  const limited = fakeAttachments({ limits: { maxImagesPerMessage: 2, maxImageBytes: PNG.length + 1, mediaTypes: ['image/png'] } });
  assert.deepEqual(markers(await keepImages(history(turnWith([picture(), picture(JPEG, 'image/jpeg'), picture(Buffer.concat([PNG, Buffer.alloc(8)])), picture(), picture()])), { attachments: limited })),
    ['stored', 'marker', 'marker', 'stored', 'marker']);

  // Everything refused: every picture is a marker, and the load does not fail.
  assert.deepEqual(markers(await keepImages(history(turnWith([picture(), picture()])), { attachments: fakeAttachments({ refuse: () => true }) })), ['marker', 'marker']);
  // A store that throws in a way nobody planned for.
  const broken = { imageLimits: undefined, saveImages: () => { throw new TypeError('boom'); }, saveImage: () => { throw new TypeError('boom'); } };
  assert.deepEqual(markers(await keepImages(history(turnWith([picture()])), { attachments: broken })), ['marker']);

  // Pictures Codex wrote to files: read at load; a file that is gone, or is not a picture, is a marker.
  const folder = await mkdtemp(join(tmpdir(), 'dudu-images-'));
  try {
    await writeFile(join(folder, 'a.png'), PNG);
    await writeFile(join(folder, 'b.png'), NOT_A_PICTURE);
    await mkdir(join(folder, 'dir.png'));
    const attachments = fakeAttachments();
    const kept = await keepImages(history(turnWith([
      { type: 'image', path: join(folder, 'a.png') }, { type: 'image', path: join(folder, 'gone.png') },
      { type: 'image', path: join(folder, 'b.png') }, { type: 'image', path: join(folder, 'dir.png') }, { type: 'image', path: 42 },
    ])), { attachments });
    assert.deepEqual(markers(kept), ['stored', 'marker', 'marker', 'marker', 'marker']);
    assert.deepEqual(attachments.calls[0].map((input: any) => [input.mediaType, input.data.byteLength]), [['image/png', PNG.length]]);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('a Claude transcript keeps the pictures next to the words only when they are asked for, and always says how many', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-images-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'session.jsonl');
  const picture = (data: string, type = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type: type, data } });
  const records = [
    { parentUuid: null, isSidechain: false, type: 'user', uuid: 'u1', timestamp: '2026-10-01T10:00:01.000Z', cwd: '/work/app', message: { role: 'user', content: [
      { type: 'text', text: '[Image #1] [Image #2] what are these?' }, picture(PNG_BASE64), picture(PNG_BASE64, 'image/jpeg'), { type: 'image', source: { type: 'url', url: 'https://example.test/x.png' } },
    ] } },
    { parentUuid: 'u1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-10-01T10:00:02.000Z', message: { role: 'assistant', id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Two screenshots.' }] } },
    { parentUuid: 'a1', isSidechain: false, type: 'user', uuid: 'u2', timestamp: '2026-10-01T10:00:03.000Z', cwd: '/work/app', message: { role: 'user', content: 'and no picture here' } },
    { parentUuid: 'u2', isSidechain: false, type: 'assistant', uuid: 'a2', timestamp: '2026-10-01T10:00:04.000Z', message: { role: 'assistant', id: 'm2', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Fine.' }] } },
  ];
  await writeFile(file, records.map((record) => `${JSON.stringify(record)}\n`).join(''));

  const light = await readClaudeHistory({ file, id: 'x' });
  assert.equal(light.turns[0].pictures, 3);
  assert.equal(light.turns[0].parts, undefined, 'the bytes are not kept unless asked for');
  assert.equal(light.turns[0].prompt, '[Image #1] [Image #2] what are these?', 'the words are the person\'s own, markers included');
  assert.equal(light.turns[1].pictures, undefined);

  const full = await readClaudeHistory({ file, id: 'x', images: true });
  assert.deepEqual(full.turns[0].parts.map((part: any) => part.type === 'text' ? part.text : part.skipped ? 'marker' : `${part.mediaType}:${part.data.length}`), [
    '[Image #1] [Image #2] what are these?', `image/png:${PNG.length}`, `image/png:${PNG.length}`, 'marker',
  ]);
  assert.equal(full.turns[1].parts, undefined);
});

test('a Codex message keeps its pictures where it had them, and a preview shows one marker for a run of them', () => {
  const thread = {
    id: 't1', cwd: '/work/app', model: 'gpt-x', turns: [{
      startedAt: 1_790_000_000, items: [
        { type: 'userMessage', id: 'i0', content: [{ type: 'localImage', path: '/tmp/a.png' }, { type: 'localImage', path: '/tmp/b.png' }, { type: 'text', text: '1. [Image #1] what is this?', text_elements: [] }] },
        { type: 'agentMessage', id: 'i1', text: 'A button.' },
      ],
    }, {
      startedAt: 1_790_000_100, items: [
        { type: 'userMessage', id: 'j0', content: [{ type: 'image', url: `data:image/png;base64,${PNG_BASE64}` }, { type: 'image', url: 'https://example.test/x.png' }] },
        { type: 'agentMessage', id: 'j1', text: 'Seen.' },
      ],
    }],
  };
  const light = codexHistory(thread);
  assert.equal(light.turns[0].prompt, '[image]\n1. [Image #1] what is this?', 'a run of pictures is one marker in a preview');
  assert.deepEqual(light.turns[0].parts, [{ type: 'image', path: '/tmp/a.png' }, { type: 'image', path: '/tmp/b.png' }, { type: 'text', text: '1. [Image #1] what is this?' }]);
  assert.equal(light.turns[1].prompt, '[image]', 'a message of pictures alone is still a turn');
  assert.deepEqual(light.turns[1].parts, [{ type: 'image', skipped: true }, { type: 'image', skipped: true }], 'a link is only decoded when the bytes are asked for');
  const full = codexHistory(thread, { images: true });
  assert.deepEqual(full.turns[1].parts, [{ type: 'image', mediaType: 'image/png', data: PNG }, { type: 'image', skipped: true }]);
});

test('the log of a loaded session carries the pictures the way DSH writes them, and a session without parts is written as before', () => {
  const stored = { attachmentId: 'a-1', mediaType: 'image/png', bytes: 70, width: 1, height: 1 };
  const withPictures = history(turnWith([{ type: 'image', attachment: stored }, { type: 'text', text: 'look' }], 'look'));
  (withPictures.turns[0] as any).steps = [{ at: 2, blocks: [{ type: 'text', text: 'ok' }], calls: [] }];
  const { events } = buildSessionEvents({ history: withPictures, route: 'codex', model: 'm', sessionId: 's' });
  const message = events.find((event: any) => event.type === 'user/message');
  assert.deepEqual(message.data.content, [{ type: 'image', attachment: stored }, { type: 'text', text: 'look' }]);
  assert.deepEqual([message.data.role, message.data.source], ['user', { kind: 'user' }]);

  const plain = history({ at: 1, prompt: 'just words', steps: [{ at: 2, blocks: [{ type: 'text', text: 'ok' }], calls: [] }], results: new Map() });
  assert.deepEqual(buildSessionEvents({ history: plain, route: 'claude', model: 'm', sessionId: 's' }).events.find((event: any) => event.type === 'user/message').data.content, [{ type: 'text', text: 'just words' }]);
});

// --- a whole load -------------------------------------------------------------------------------------------------------

const id = '11111111-1111-4111-8111-111111111111';
async function loading(t: { after: (cleanup: () => Promise<void>) => void }, { attachments, claude = true }: { attachments?: any; claude?: boolean } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'dudu-load-images-'));
  const stored = new Map<string, { header: any; events: any[] }>();
  const store = {
    stat: async (sessionId: string) => (stored.has(sessionId) ? { header: stored.get(sessionId)!.header } : undefined),
    create: async (header: any) => {
      const entry = { header, events: [] as any[] };
      stored.set(header.id, entry);
      return { append: async (events: any[]) => { entry.events.push(...events); }, flush: async () => {}, close: async () => {} };
    },
  };
  const registry = { create: async (path: string) => ({ id: 'ws-1', path, attachSession: async () => {} }) };
  const links = await createLinkStore(join(base, 'state'));
  t.after(async () => { await links.flush(); await rm(base, { recursive: true, force: true }); });
  const driver = { listModels: async () => [{ provider: 'x', id: 'default', name: 'Default' }], resolveModel: async () => ({}) };
  const userContentOf = (sessionId: string) => stored.get(sessionId)!.events.filter((event) => event.type === 'user/message').map((event) => event.data.content);
  return { base, stored, store, registry, links, driver, userContentOf, attachments, claude };
}

test('loading a Claude session with pasted pictures stores them in DSH and writes them into the message', async (t) => {
  const world = await loading(t, { attachments: fakeAttachments() });
  const root = join(world.base, 'projects');
  await mkdir(join(root, 'app'), { recursive: true });
  await writeFile(join(root, 'app', `${id}.jsonl`), [
    { parentUuid: null, isSidechain: false, type: 'user', uuid: 'u1', timestamp: '2026-10-01T10:00:01.000Z', cwd: '/work/app', message: { role: 'user', content: [
      { type: 'text', text: '[Image #1] what is this?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } },
    ] } },
    { parentUuid: 'u1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-10-01T10:00:02.000Z', message: { role: 'assistant', id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'A dot.' }] } },
  ].map((record) => `${JSON.stringify(record)}\n`).join(''));
  const service = createNativeSessions({
    sources: () => [{ id: 'claude', name: 'Claude', route: 'claude', driver: world.driver }], links: world.links, claude: { root },
    persistence: () => world.store, workspaces: () => world.registry, attachments: () => world.attachments,
  });
  const { sessionId } = await service.load({ provider: 'claude', id });
  const [content] = world.userContentOf(sessionId);
  assert.equal(content.length, 2);
  assert.deepEqual(content[0], { type: 'text', text: '[Image #1] what is this?' });
  assert.equal(content[1].type, 'image');
  assert.equal(content[1].attachment.mediaType, 'image/png');
  assert.equal(world.attachments.calls.length, 1);
  assert.deepEqual(Buffer.from(world.attachments.calls[0][0].data), PNG, 'DSH was given the bytes of the picture');

  // The preview of the same session stays text.
  const preview = await service.read({ provider: 'claude', id });
  assert.ok(preview.messages.every((message: any) => typeof message.text === 'string'));
});

test('a session loads when DSH has no attachment store: the words load, the pictures are only a marker or nothing', async (t) => {
  const world = await loading(t, {});
  const root = join(world.base, 'projects');
  await mkdir(join(root, 'app'), { recursive: true });
  await writeFile(join(root, 'app', `${id}.jsonl`), [
    { parentUuid: null, isSidechain: false, type: 'user', uuid: 'u1', timestamp: '2026-10-01T10:00:01.000Z', cwd: '/work/app', message: { role: 'user', content: [
      { type: 'text', text: 'what is this?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } },
    ] } },
    { parentUuid: 'u1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-10-01T10:00:02.000Z', message: { role: 'assistant', id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'A dot.' }] } },
  ].map((record) => `${JSON.stringify(record)}\n`).join(''));
  const service = createNativeSessions({
    sources: () => [{ id: 'claude', name: 'Claude', route: 'claude', driver: world.driver }], links: world.links, claude: { root },
    persistence: () => world.store, workspaces: () => world.registry,
  });
  const { sessionId } = await service.load({ provider: 'claude', id });
  assert.deepEqual(world.userContentOf(sessionId), [[{ type: 'text', text: 'what is this?\n[image]' }]]);
});

test('loading a Codex thread reads the picture files the app-server wrote and stores them, pictures first as they were sent', async (t) => {
  const world = await loading(t, { attachments: fakeAttachments() });
  const picturePath = join(world.base, 'shot.png');
  await writeFile(picturePath, PNG);
  // A stand-in for `codex app-server`: it answers the three calls a load makes.
  const command = join(world.base, 'codex');
  await writeFile(command, `#!/usr/bin/env node
const readline = require('node:readline');
const thread = { id: 't1', cwd: '/work/app', model: 'gpt-x', preview: 'look at this', name: 'Pictures', createdAt: 1790000000, updatedAt: 1790000100, path: null,
  turns: [{ startedAt: 1790000010, items: [
    { type: 'userMessage', id: 'i0', content: [{ type: 'localImage', path: ${JSON.stringify(picturePath)} }, { type: 'text', text: 'look at this', text_elements: [] }] },
    { type: 'agentMessage', id: 'i1', text: 'I see it.' } ] }] };
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const result = message.method === 'thread/list' ? { data: [thread], nextCursor: null } : message.method === 'thread/read' ? { thread } : {};
  process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n');
});
`);
  await chmod(command, 0o755);
  const service = createNativeSessions({
    sources: () => [{ id: 'codex', name: 'ChatGPT', route: 'codex', command, driver: world.driver }], links: world.links,
    persistence: () => world.store, workspaces: () => world.registry, attachments: () => world.attachments,
  });
  const { sessionId } = await service.load({ provider: 'codex', id: 't1' });
  const [content] = world.userContentOf(sessionId);
  assert.deepEqual(content.map((part: any) => part.type), ['image', 'text']);
  assert.equal(content[1].text, 'look at this');
  assert.deepEqual(Buffer.from(world.attachments.calls[0][0].data), PNG);
  const preview = await service.read({ provider: 'codex', id: 't1' });
  assert.deepEqual(preview.messages.map((message: any) => message.text), ['[image]\nlook at this', 'I see it.'], 'a preview names a picture in one marker, and nothing more');
});
