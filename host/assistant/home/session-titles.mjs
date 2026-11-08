// Titles are metadata shared by an issue and its current DSH session. No model, prompt or workflow change is involved.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const sessionIdOf = (issue) => /^dsh:(.+)$/s.exec(issue?.session ?? '')?.[1];
const withoutRef = (issue, title) => issue.ref && title.startsWith(`${issue.ref} `) ? title.slice(issue.ref.length + 1) : title;
const sessionTitleFor = (issue, previous) => issue.ref && previous?.startsWith(`${issue.ref} `) ? `${issue.ref} ${issue.title}` : issue.title;
const legacyTitle = (issue) => {
  const flat = `${issue.ref ? `${issue.ref} ` : ''}${issue.title}`.replace(/\s+/g, ' ').trim();
  const characters = [...flat];
  return characters.length > 100 ? `${characters.slice(0, 99).join('')}…` : flat;
};

/** A baseline records accepted, possibly host-normalized titles and survives hot reload without making old metadata win. */
export async function createSessionTitles({ issues, dsh, file, log = console }) {
  let baselines = {};
  if (file) {
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.version === 1 && saved.items && typeof saved.items === 'object' && !Array.isArray(saved.items)) baselines = saved.items;
    } catch (error) {
      if (error.code !== 'ENOENT') log.warn?.('[dudu] Session title baselines could not be read.');
    }
  }
  const tails = new Map();
  const ownEvents = new Map();
  const snapshots = new Map();
  let closed = false;
  let saving = Promise.resolve();
  const save = () => {
    if (!file) return;
    const content = JSON.stringify({ version: 1, items: baselines });
    saving = saving.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, content, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    saving.catch(() => log.warn?.('[dudu] Session title baselines could not be saved.'));
  };
  const remember = (issue, snapshot) => {
    const next = { session: issue.session, issueTitle: issue.title, sessionTitle: snapshot.title, seq: snapshot.seq };
    if (JSON.stringify(baselines[issue.id]) === JSON.stringify(next)) return;
    baselines[issue.id] = next;
    save();
  };
  const enqueue = (id, work) => {
    if (closed) return Promise.resolve();
    const run = (tails.get(id) ?? Promise.resolve()).then(work);
    const tail = run.catch((error) => log.warn?.(`[dudu] A linked title could not be synchronized: ${error.message}`));
    tails.set(id, tail);
    tail.then(() => { if (tails.get(id) === tail) tails.delete(id); });
    return tail;
  };
  const currentIssue = (id, sessionId) => {
    const issue = issues.get(id, { logLimit: 1 }).issue;
    return sessionIdOf(issue) === sessionId ? issue : null;
  };

  async function reconcile(id, { event } = {}) {
    let issue = issues.get(id, { logLimit: 1 }).issue;
    const sessionId = sessionIdOf(issue);
    if (!sessionId) return;
    if (event && (ownEvents.get(sessionId) === event.seq || event.seq < (snapshots.get(sessionId)?.seq ?? -1))) return;
    let snapshot = event ?? snapshots.get(sessionId) ?? await dsh.title(sessionId);
    issue = currentIssue(id, sessionId);
    if (!issue || !snapshot?.title) return;
    snapshots.set(sessionId, snapshot);
    const saved = baselines[id];
    const baseline = saved?.session === issue.session && typeof saved.issueTitle === 'string' && typeof saved.sessionTitle === 'string' ? saved : null;
    const title = withoutRef(issue, snapshot.title);
    if (issue.title === title || baseline?.issueTitle === issue.title && baseline?.sessionTitle === snapshot.title) {
      remember(issue, snapshot);
      return;
    }
    const revision = issues.titleRevision(id);
    const issueChanged = !baseline || baseline.issueTitle !== issue.title;
    const sessionChanged = !baseline || baseline.sessionTitle !== snapshot.title;
    // A real session event is considered even if a delayed rename of ours has already echoed. The user's later action wins.
    const generatedTruncation = !baseline && snapshot.title === legacyTitle(issue) && snapshot.title !== sessionTitleFor(issue, snapshot.title);
    const fromSession = !generatedTruncation && (event
      ? snapshot.at >= (revision?.at ?? issue.createdAt)
      : sessionChanged && (!issueChanged || snapshot.at >= (revision?.at ?? issue.createdAt)));
    if (fromSession) {
      const result = issues.update(id, { title }, { actor: 'dudu' });
      if (!['success', 'no_op'].includes(result.outcome)) throw new Error(result.message);
      // This update's observer is queued; remember it before that observer runs, avoiding a rename echo.
      remember(result.issue, snapshot);
      return;
    }
    if (!issueChanged) return;
    const accepted = await dsh.renameTitle(sessionId, sessionTitleFor(issue, snapshot.title));
    ownEvents.set(sessionId, accepted.seq);
    snapshot = { title: accepted.title, seq: accepted.seq, at: snapshot.at };
    snapshots.set(sessionId, snapshot);
    // Preserve the version actually written; an edit made while rename awaited is still pending in the queue.
    remember(issue, snapshot);
  }

  const stopIssues = issues.onChange((change) => {
    if (change.action === 'add' || change.after && ('title' in change.after || 'session' in change.after)) {
      void enqueue(change.issueId, () => reconcile(change.issueId));
    } else if (change.action === 'forget' && baselines[change.issueId]) {
      delete baselines[change.issueId];
      save();
    }
  });
  const stopTitles = dsh.watchTitles((sessionId, snapshot) => {
    if (snapshot.seq <= (snapshots.get(sessionId)?.seq ?? -1)) return;
    snapshots.set(sessionId, snapshot);
    for (const id of issues.sessionOwners(`dsh:${sessionId}`)) {
      if (currentIssue(id, sessionId)) void enqueue(id, () => reconcile(id, { event: snapshot }));
    }
  });
  return {
    async restore() {
      let cursor;
      do {
        const page = issues.list({ tab: 'all', limit: 200, ...(cursor ? { cursor } : {}) });
        if (page.outcome !== 'success') break;
        for (const issue of page.items) if (sessionIdOf(issue)) await enqueue(issue.id, () => reconcile(issue.id));
        cursor = page.nextCursor;
      } while (cursor && !closed);
    },
    async flush() { while (tails.size) await Promise.all([...tails.values()]); await saving; },
    async close() {
      closed = true;
      stopIssues();
      stopTitles();
      while (tails.size) await Promise.all([...tails.values()]);
      await saving.catch(() => {});
      snapshots.clear();
      ownEvents.clear();
    },
  };
}
