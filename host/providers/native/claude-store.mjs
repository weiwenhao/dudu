import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mapLimit } from '../async.mjs';
import { oneLine } from './text.mjs';

// Claude Code keeps every session as `<projects>/<encoded folder>/<session id>.jsonl`. OAR has no call that lists them,
// so this reads the files themselves, and only as much of each as a list needs: transcripts reach hundreds of
// megabytes (the requests Claude sent are in them), while what names a session sits at the start (folder, first
// prompt) and the end (titles are appended as the conversation grows).

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 768 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Text Claude Code writes as the user on its own behalf: not something the person typed.
const SYNTHETIC = /^\s*(?:<(?:system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|user-prompt-submit-hook|task-notification|ide_[a-z_]+)\b|\[Request interrupted by user)/i;

export function claudeProjectsRoot(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

export const blocksOf = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []);

/** What the person typed in a user message, or '' for a message Claude Code wrote itself (reminders, command output). */
export function promptText(content) {
  const text = blocksOf(content).filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n').trim();
  if (!text) return '';
  const command = text.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/);
  if (command) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return args ? `${command[1]} ${args}` : command[1];
  }
  return SYNTHETIC.test(text) ? '' : text;
}

/** A record that carries what the person typed, as opposed to a tool result or something Claude Code injected. */
export function isHumanPrompt(record) {
  if (record?.type !== 'user' || record.isMeta || record.isSidechain || record.isCompactSummary || record.toolUseResult) return false;
  const blocks = blocksOf(record.message?.content);
  if (blocks.some((block) => block?.type === 'tool_result')) return false;
  return promptText(record.message?.content) !== '';
}

async function readSlice(file, start, length) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** The whole lines of a slice cut out of a file: its first and last lines may be partial. */
function wholeLines(text, { cutStart, cutEnd }) {
  const lines = text.split('\n');
  if (cutStart) lines.shift();
  if (cutEnd) lines.pop();
  return lines.filter(Boolean);
}

function parse(line) {
  try { return JSON.parse(line); } catch { return undefined; }
}

async function summarize(file, info) {
  const id = info.name.slice(0, -'.jsonl'.length);
  const head = wholeLines(await readSlice(file, 0, Math.min(info.size, HEAD_BYTES)), { cutStart: false, cutEnd: info.size > HEAD_BYTES });
  let cwd; let branch; let entrypoint; let createdAt; let firstPrompt = ''; let firstCommand = ''; let customTitle = ''; let aiTitle = '';
  const scan = (records) => {
    for (const record of records) {
      if (record.type === 'custom-title' && typeof record.customTitle === 'string') customTitle = record.customTitle;
      else if (record.type === 'ai-title' && typeof record.aiTitle === 'string') aiTitle = record.aiTitle;
    }
  };
  const headRecords = head.map(parse).filter(Boolean);
  for (const record of headRecords) {
    if (!cwd && typeof record.cwd === 'string') cwd = record.cwd;
    if (!branch && typeof record.gitBranch === 'string' && record.gitBranch !== 'HEAD') branch = record.gitBranch;
    if (!entrypoint && typeof record.entrypoint === 'string') entrypoint = record.entrypoint;
    if (!createdAt && typeof record.timestamp === 'string' && !Number.isNaN(Date.parse(record.timestamp))) createdAt = Date.parse(record.timestamp);
    if (!firstPrompt && isHumanPrompt(record)) {
      // `/clear` and `/effort` open many sessions; the first thing actually said is a better name for one.
      const text = promptText(record.message.content);
      if (!text.startsWith('/')) firstPrompt = text;
      else if (!firstCommand) firstCommand = text;
    }
  }
  firstPrompt ||= firstCommand;
  scan(headRecords);
  if (info.size > HEAD_BYTES) {
    const from = Math.max(HEAD_BYTES, info.size - TAIL_BYTES);
    scan(wholeLines(await readSlice(file, from, info.size - from), { cutStart: true, cutEnd: false }).map(parse).filter(Boolean));
  }
  if (!firstPrompt && !customTitle && !aiTitle) return undefined;
  return {
    provider: 'claude', id, cwd: cwd ?? null, branch: branch ?? null, entrypoint: entrypoint ?? null,
    title: oneLine(customTitle || aiTitle || firstPrompt), preview: oneLine(firstPrompt, 300),
    createdAt: createdAt ?? null, updatedAt: info.mtimeMs, size: info.size, file,
  };
}

/** The Claude Code sessions on this computer, newest first. `cache` keeps what an unchanged file already told. */
export async function listClaudeSessions({ root = claudeProjectsRoot(), cache = new Map() } = {}) {
  let projects;
  try { projects = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    let names;
    try { names = await readdir(join(root, project.name)); } catch { continue; }
    for (const name of names) if (name.endsWith('.jsonl') && UUID.test(name.slice(0, -'.jsonl'.length))) files.push({ file: join(root, project.name, name), name });
  }
  const sessions = await mapLimit(files, 8, async ({ file, name }) => {
    let info;
    try { info = await stat(file); } catch { return undefined; }
    const known = cache.get(file);
    if (known && known.mtimeMs === info.mtimeMs && known.size === info.size) return known.summary;
    let summary;
    try { summary = await summarize(file, { name, size: info.size, mtimeMs: info.mtimeMs }); } catch { summary = undefined; }
    cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, summary });
    return summary;
  });
  return sessions.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}
