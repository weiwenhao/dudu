// Where a conversation became read, and how: one line for every read that moved something, every unread mark, and every answer that came in, in `<folder>/diagnostics/reads.jsonl`
// (owner, 2026-11-22: "需要知道是怎么变成已读的，从哪块屏变成已读的都要有日志"; the receipts keep only the last read and nobody to say who made it, which is why "两条都完成了却没有红点"
// could not be explained after the fact).
//
// A line says WHEN, WHICH conversation, WHICH screen (`desktop` with its pane, `iphone`, `android`, Dudu's own tool, or the plugin itself) and HOW (a press, a scroll, a key, opening the
// conversation, the phone showing it at its end, a row's own action, a tool), and what it did: the position it read up to and where it stood, whether the conversation was unread before
// and is after. Local to this computer, bounded, and only these words and numbers ever reach the file: never a prompt, a title, a path or an address.

import { Buffer } from 'node:buffer';
import { appendFile, chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BYTES = 512 * 1024;
const MAX_PENDING = 256;
const EVENTS = new Set(['read', 'unread-mark', 'content']);
const SCREENS = new Set(['desktop', 'iphone', 'android', 'dudu', 'plugin']);
const HOWS = new Set(['press', 'wheel', 'key', 'touch', 'opened', 'visible', 'row', 'tool', 'rebind', 'unknown']);
const KINDS = new Set(['message', 'question', 'error', 'none']);
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const DEVICE = /^[A-Za-z0-9_-]{1,16}$/;

const count = (value, max = 1_000_000_000) => (Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : undefined);

/**
 * What a caller says about itself, cleaned: `{ screen, how, device?, panes?, pane?, embedded?, sinceTouchMs?, unreadForMs? }`, each from a short list of words or a bounded number, in this
 * flat shape both going in and coming out (so cleaning it twice changes nothing). `fallback` is what the caller is known to be (the route knows it is the desktop, a phone's connection
 * knows its platform and device), and it wins over what a body claims. `panes` and `pane` (how many conversations the desktop shows and which of them) are the desktop's only.
 */
export function cleanReadSource(raw, fallback = {}) {
  const said = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const screen = SCREENS.has(fallback.screen) ? fallback.screen : SCREENS.has(said.screen) ? said.screen : 'plugin';
  const how = HOWS.has(fallback.how) ? fallback.how : HOWS.has(said.how) ? said.how : 'unknown';
  const phone = screen === 'iphone' || screen === 'android';
  const deviceSaid = fallback.device ?? said.device;
  const device = phone && typeof deviceSaid === 'string' && DEVICE.test(deviceSaid) ? deviceSaid : undefined;
  const desktop = screen === 'desktop';
  const panes = count(said.panes, 64);
  const pane = count(said.pane, 64);
  const touch = count(said.sinceTouchMs, 86_400_000);
  const unread = count(said.unreadForMs, 86_400_000);
  return {
    screen, how,
    ...(device ? { device } : {}),
    ...(desktop && panes !== undefined ? { panes } : {}),
    ...(desktop && pane !== undefined ? { pane } : {}),
    ...(desktop && typeof said.embedded === 'boolean' ? { embedded: said.embedded } : {}),
    ...(touch !== undefined ? { sinceTouchMs: touch } : {}),
    ...(unread !== undefined ? { unreadForMs: unread } : {}),
  };
}

/** The line for one event: every field checked, anything else dropped. */
export function readLine({ event, session, source, seq, previousSeq, stream, wasUnread, nowUnread, changed, ageMs, kind }, now = Date.now()) {
  if (!EVENTS.has(event) || typeof session !== 'string' || !ID.test(session)) return null;
  const from = cleanReadSource(source);
  return {
    timestamp: now, event, session, ...from,
    ...(Number.isSafeInteger(seq) ? { seq } : {}),
    ...(Number.isSafeInteger(previousSeq) ? { previousSeq } : {}),
    ...(typeof stream === 'boolean' ? { stream } : {}),
    ...(typeof wasUnread === 'boolean' ? { wasUnread } : {}),
    ...(typeof nowUnread === 'boolean' ? { nowUnread } : {}),
    ...(typeof changed === 'boolean' ? { changed } : {}),
    ...(count(ageMs, 31_536_000_000) !== undefined ? { ageMs: count(ageMs, 31_536_000_000) } : {}),
    ...(KINDS.has(kind) ? { kind } : {}),
  };
}

export function createReadLog(folder) {
  const directory = join(folder, 'diagnostics');
  const file = join(directory, 'reads.jsonl');
  let tail = Promise.resolve();
  let pending = 0;
  return {
    record(entry) {
      const line = pending >= MAX_PENDING ? null : readLine(entry);
      if (!line) return;
      const text = JSON.stringify(line) + '\n';
      pending++;
      tail = tail.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await chmod(directory, 0o700);
        const size = await stat(file).then((value) => value.size, (error) => {
          if (error.code !== 'ENOENT') throw error;
          return 0;
        });
        if (size + Buffer.byteLength(text) > MAX_BYTES) {
          await unlink(file + '.1').catch((error) => { if (error.code !== 'ENOENT') throw error; });
          await rename(file, file + '.1');
        }
        await appendFile(file, text, { mode: 0o600 });
        await chmod(file, 0o600);
      }).catch(() => {}).finally(() => { pending--; });
    },
    flush: () => tail,
  };
}
