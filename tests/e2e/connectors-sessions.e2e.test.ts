// A connected MCP connector is in the owner's DSH sessions, not only in a collection of 嘟嘟 (connectors/publish.mjs), in a real DSH: the plugin mounts DSH's own MCP client for
// the server (as the DSH plugin that mounted one server did), DSH runs it with the token, a new token mounts it again with that token, an ordinary session (an issue given to
// DeepSeek) and the conversation with 嘟嘟 (which began before the server was connected) can call its tools, a collection sees the connector's read-only tools and nothing else
// even though the server is in DSH for every session, it is there again after a restart, and letting go takes it away.
// The server is a stand-in on 127.0.0.1 that wants a bearer token (the MCP SDK's own), so nothing leaves the machine and no browser is opened: the sign-in that renews a token
// is tested with the SDK's servers in tests/assistant-connections-oauth.test.ts and its timing in tests/assistant-connector-publish.test.ts.
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { after, afterEach, before, test } from 'node:test';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
let server: ReturnType<typeof createServer>;
let url: string;
let project: { name: string; path: string };
let collectorId = '';
const accepted = { token: 'tok-one' };
const seen: { auth: string; client: string; method: string }[] = [];
const saved: string[] = [];
const COLLECTION = 'You collect information for dudu';
const BOTH = ['mcp__stand-in__look-up', 'mcp__stand-in__save'];

before(async () => {
  server = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    const body = data ? JSON.parse(data) : undefined;
    seen.push({ auth: String(req.headers.authorization ?? ''), client: String(body?.params?.clientInfo?.name ?? ''), method: String(body?.method ?? req.method) });
    if (req.headers.authorization !== `Bearer ${accepted.token}`) { res.writeHead(401, { 'www-authenticate': 'Bearer' }).end(); return; }
    const mcp = new McpServer({ name: 'stand-in', version: '1.0.0' });
    mcp.registerTool('look-up', { description: 'looks a mail up', inputSchema: { q: z.string() }, annotations: { readOnlyHint: true } }, async ({ q }) => ({ content: [{ type: 'text', text: `found ${q}` }] }));
    mcp.registerTool('save', { description: 'saves a draft', inputSchema: { q: z.string() }, annotations: { readOnlyHint: false } }, async ({ q }) => { saved.push(q); return { content: [{ type: 'text', text: `saved ${q}` }] }; });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
  dudu = await startDudu({
    model: { replies: [
      // a collection that reads through the connector: it first tries the tool that saves (it is in DSH for every session, but not for this one), then reads
      { when: (context: any) => context.system.includes(COLLECTION) && context.prompt.includes('Connector: Stand-in'),
        calls: [{ name: 'mcp__stand-in__save', arguments: { q: 'from the collection' }, force: true }, { name: 'mcp__stand-in__look-up', arguments: { q: 'mail' } }],
        then: (results: string[]) => JSON.stringify({ ok: true, records: [{ id: 'stand-in-1', title: 'from the stand-in', text: results.at(-1) ?? '' }] }) },
      // an ordinary session (an issue given to DeepSeek) and the conversation with 嘟嘟
      { when: 'LOOK-ONE', calls: [{ name: 'mcp__stand-in__look-up', arguments: { q: 'one' } }], then: (results: string[]) => `读到了：${results.at(-1)}` },
      { when: 'LOOK-TWO', calls: [{ name: 'mcp__stand-in__look-up', arguments: { q: 'two' } }], then: (results: string[]) => `又读到了：${results.at(-1)}` },
      { when: 'LOOK-NONE', say: '没有工具。' },
      { when: 'CHAT-LOOK', calls: [{ name: 'mcp__stand-in__look-up', arguments: { q: 'one' } }], then: (results: string[]) => `聊天读到了：${results.at(-1)}` },
      { when: 'CHAT-AGAIN', calls: [{ name: 'mcp__stand-in__look-up', arguments: { q: 'two' } }], then: (results: string[]) => `聊天又读到了：${results.at(-1)}` },
      { when: 'CHAT-NONE', say: '聊天里没有。' },
      { when: (context: any) => context.tools.length === 0, say: '{"changes":[]}' },
      { say: 'ok' },
    ] },
  });
  project = { name: 'Mail', path: await realpath(dudu.folder) };
  assert.equal((await dudu.api('projects/create', project)).outcome, 'success');
});
after(async () => {
  await dudu?.stop();
  server?.closeAllConnections();
  server?.close();
});
afterEach(async (context) => {
  if (context.passed === false && process.env.DUDU_E2E_DIAG) console.log(dudu.diagnostics().slice(-4000));
  await dudu.settle(context.name, context.passed === false);
});

async function until<T>(read: () => Promise<T> | T, check: (value: T) => boolean, timeout = 30_000) {
  const end = Date.now() + timeout;
  let value = await read();
  while (!check(value)) {
    if (Date.now() > end) assert.fail(`Did not reach the expected state: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

const toolsOf = (request: any) => (request?.tools ?? []).filter((name: string) => name.startsWith('mcp__stand-in__')).sort();
const requestsOf = (tag: string) => dudu.model.requests.filter((request: any) => request.prompt.includes(tag));
/** DSH's own client is mounted and has asked for the tools: the stand-in has seen this many `tools/list` with this token (the check 嘟嘟 makes is one of them). */
const listed = (token: string) => seen.filter((entry) => entry.method === 'tools/list' && entry.auth === `Bearer ${token}`).length;

/** The conversation with 嘟嘟 (DSH's loop, on the scripted model): says `text`, waits for `reply`, and hands back the first request the model got for it. */
async function say(text: string, reply: string) {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByText(reply, { exact: true }).last().waitFor({ timeout: 90_000 });
  await page.close();
  return requestsOf(text.split(' ')[0]).find((request: any) => request.tools.length > 0);
}

/** An ordinary session of the owner: an issue given to DeepSeek, which is a session DSH makes and nothing of 嘟嘟 limits. Hands back the first request the model got for it. */
async function session(tag: string, answered: string) {
  const issue = (await dudu.api('issues/add', { fields: { project, title: `Session ${tag}`, brief: `${tag} 用 stand-in 读一下` } })).issue;
  assert.equal((await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' })).outcome, 'success');
  const first = await until(() => requestsOf(tag).find((request: any) => request.tools.length > 0), (request: any) => Boolean(request), 60_000);
  if (answered) await until(() => requestsOf(tag).some((request: any) => request.toolResults.join(' ').includes(answered)), Boolean, 60_000);
  return first;
}

test('before the connector is there neither an ordinary session nor the conversation has its tools', { timeout: 150_000 }, async () => {
  assert.deepEqual(toolsOf(await session('LOOK-NONE', '')), []);
  assert.deepEqual(toolsOf(await say('CHAT-NONE 先说一句', '聊天里没有。')), []);
});

test('a connector that works is in the sessions: DSH\'s MCP client is mounted with the token, an ordinary session and the conversation (which began before) call the tools, the write one too', { timeout: 180_000 }, async () => {
  const added = await dudu.api('connectors/add', { text: url, token: 'tok-one', name: 'Stand-in' });
  assert.equal(added.outcome, 'success', JSON.stringify(added));
  await until(() => dudu.api('connectors/list'), (value: any) => value.connectors.find((item: any) => item.id === 'stand-in')?.inSessions === true);
  await until(() => listed('tok-one'), (count: number) => count >= 2); // 嘟嘟's own check, and DSH's client
  const item = (await dudu.api('connectors/list')).connectors.find((entry: any) => entry.id === 'stand-in');
  assert.deepEqual([item.state, item.about.tools], [null, 2]);

  const ordinary = await session('LOOK-ONE', 'found one');
  assert.deepEqual(toolsOf(ordinary), BOTH, `both tools of the server are offered to a session of the owner: ${(ordinary?.tools ?? []).join(', ')}`);
  assert.ok(seen.some((entry) => entry.method === 'tools/call' && entry.auth === 'Bearer tok-one'), 'the server was called with the token');
  assert.equal(saved.length, 0);

  const chat = await say('CHAT-LOOK 读一下', '聊天读到了：found one');
  assert.deepEqual(toolsOf(chat), BOTH, `the conversation sees a server that was connected after it began: ${(chat?.tools ?? []).join(', ')}`);
});

test('a new token mounts the server again with it, and the sessions go on calling', { timeout: 150_000 }, async () => {
  accepted.token = 'tok-two'; // the server takes only the new one from now on
  const updated = await dudu.api('connectors/update', { id: 'stand-in', token: 'tok-two' });
  assert.ok(['success', 'no_op'].includes(updated.outcome), JSON.stringify(updated));
  await until(() => listed('tok-two'), (count: number) => count >= 2); // 嘟嘟's check, and DSH's client mounted again
  assert.deepEqual(toolsOf(await session('LOOK-TWO', 'found two')), BOTH);
  assert.deepEqual(toolsOf(await say('CHAT-AGAIN 再读一下', '聊天又读到了：found two')), BOTH);
});

test('a collection through the connector sees its read-only tools and nothing else, although the server is in DSH for every session; what it brought is kept', { timeout: 150_000 }, async () => {
  assert.equal((await dudu.api('collectors/add', { name: 'Stand-in mail', connector: 'stand-in', prompt: 'Read the mail of the stand-in.', frequency: '15m' })).outcome, 'success');
  collectorId = (await dudu.api('collectors/list')).collectors.find((item: any) => item.name === 'Stand-in mail').id;
  dudu.model.replies.unshift({ when: 'CHAT-COLLECT', calls: [{ name: 'collector_read', arguments: { id: collectorId } }], then: () => '已采集 stand-in。' });
  await say('CHAT-COLLECT 采集一次', '已采集 stand-in。');
  const collections = dudu.model.requests.filter((request: any) => request.system.includes(COLLECTION) && request.prompt.includes('Connector: Stand-in'));
  assert.ok(collections.length >= 1, 'the collection ran on the model');
  const first = collections[0];
  // DSH offers `subagent` to every session whatever is hidden (it is added after a plugin limits the list); a call of it is refused by the guard (unit test)
  assert.deepEqual(first.tools.filter((name: string) => name !== 'subagent'), ['mcp__stand-in__look-up'], `only the tool that reads: ${first.tools.join(', ')}`);
  const tried = collections.find((request: any) => request.toolResults.length > 0);
  assert.ok(tried, 'it tried the tool that saves anyway');
  assert.ok(!tried.toolResults[0].includes('saved'), `and that was refused, not run: ${tried.toolResults[0]}`);
  assert.equal(saved.length, 0, 'the server never saw it');
  const rows = (await dudu.api('inbox/list', { tab: 'todo' })).items.filter((item: any) => item.connector === collectorId);
  assert.ok(rows.length >= 1, 'what it read was kept under its own collector');
  assert.equal(rows[0].title, 'from the stand-in');
});

test('after a restart what was connected is in the sessions again', { timeout: 180_000 }, async () => {
  const before = listed('tok-two');
  await dudu.restart();
  await until(() => dudu.api('connectors/list'), (value: any) => value.connectors.find((item: any) => item.id === 'stand-in')?.inSessions === true, 60_000);
  await until(() => listed('tok-two'), (count: number) => count > before, 60_000);
  assert.deepEqual(toolsOf(await say('CHAT-AGAIN 重启后再读一下', '聊天又读到了：found two')), BOTH);
});

test('disconnecting takes the tools out of the sessions', { timeout: 180_000 }, async () => {
  assert.equal((await dudu.api('connectors/remove', { id: 'stand-in' })).code, 'in_use', 'a connector a collector reads through stays');
  assert.equal((await dudu.api('collectors/remove', { id: collectorId })).outcome, 'success');
  assert.equal((await dudu.api('connectors/remove', { id: 'stand-in' })).outcome, 'success');
  await until(async () => toolsOf(await session(`LOOK-NONE ${Date.now()}`, '')), (tools: string[]) => tools.length === 0, 60_000);
  assert.deepEqual(toolsOf(await say('CHAT-NONE 现在呢', '聊天里没有。')), []);
});
