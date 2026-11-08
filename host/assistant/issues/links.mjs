// Links on an issue (owner, 2026-11-05, after Linear's Links): a web address with a title and a kind, any number on an issue. A pull request and a document are
// links the owner said so of, or that their address says so of (a GitHub or GitLab pull request, a Feishu, Google or Notion document). The page the address leads
// to is never fetched: the title is the one the owner wrote, or one made from the address.

export const LINK_KINDS = ['link', 'pull_request', 'document'];
const MAX_URL = 2000;
const MAX_TITLE = 200;

export function migrateLinks(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS issue_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK (kind IN ('link', 'pull_request', 'document')),
      created_at INTEGER NOT NULL,
      UNIQUE (issue_id, url)
    );
    CREATE INDEX IF NOT EXISTS issue_links_issue ON issue_links(issue_id, id);
  `);
}

const PULL_REQUEST = /^\/([^/]+)\/([^/]+)\/(?:pull|pulls)\/(\d+)(?:\/|$)/;
const MERGE_REQUEST = /^\/(.+?)\/-\/merge_requests\/(\d+)(?:\/|$)/;
const DOCUMENT_HOSTS = [/(^|\.)feishu\.cn$/, /(^|\.)larksuite\.com$/, /(^|\.)larkoffice\.com$/, /^docs\.google\.com$/, /^drive\.google\.com$/, /(^|\.)notion\.so$/, /(^|\.)notion\.site$/, /(^|\.)atlassian\.net$/];

/** `{ url, kind, title }` of an address: what it says of itself, over what the owner asked for. */
export function readUrl(value, asked = 'link') {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
  const host = url.hostname.toLowerCase();
  const github = host === 'github.com' || host === 'www.github.com' ? PULL_REQUEST.exec(url.pathname) : null;
  const gitlab = /(^|\.)gitlab\.[a-z.]+$/.test(host) || host === 'gitlab.com' ? MERGE_REQUEST.exec(url.pathname) : null;
  if (github) return { url: url.href, kind: 'pull_request', title: `${github[1]}/${github[2]} #${github[3]}` };
  if (gitlab) return { url: url.href, kind: 'pull_request', title: `${gitlab[1]} !${gitlab[2]}` };
  const kind = asked !== 'link' ? asked : DOCUMENT_HOSTS.some((pattern) => pattern.test(host)) ? 'document' : 'link';
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  const short = `${host.replace(/^www\./, '')}${path}`;
  return { url: url.href, kind, title: short.length > 60 ? `${short.slice(0, 59)}…` : short };
}

/** The links table. Writing is the caller's to wrap in the store's transaction; `bad(message, next)` makes the store's own error for a wrong value. */
export function createLinks({ db, now = Date.now, bad }) {
  const row = (record) => ({ id: record.id, url: record.url, title: record.title, kind: record.kind });
  const find = (issueId, linkId) => db.prepare('SELECT * FROM issue_links WHERE issue_id = ? AND id = ?').get(issueId, linkId);
  return {
    list: (issueId) => db.prepare('SELECT * FROM issue_links WHERE issue_id = ? ORDER BY id').all(issueId).map(row),
    find: (issueId, linkId) => { const found = find(issueId, linkId); return found ? row(found) : null; },
    /** Adds a link to the issue (which must exist: the caller has loaded it). `kind` is what the owner asked for: link, pull_request or document. */
    add(issueId, { url, title, kind = 'link' } = {}) {
      if (!LINK_KINDS.includes(kind)) throw bad(`kind must be one of: ${LINK_KINDS.join(', ')}`);
      if (typeof url !== 'string' || !url.trim() || url.length > MAX_URL) throw bad(`url must be a web address of at most ${MAX_URL} characters`, 'Give an address that starts with http:// or https://.');
      const read = readUrl(url, kind);
      if (!read) throw bad('url must be a web address', 'Give an address that starts with http:// or https://.');
      if (title != null && (typeof title !== 'string' || title.length > MAX_TITLE)) throw bad(`title must be text of at most ${MAX_TITLE} characters`);
      const own = String(title ?? '').trim().replace(/\s+/g, ' ');
      const clean = { url: read.url, kind: read.kind, title: own || read.title };
      if (db.prepare('SELECT 1 FROM issue_links WHERE issue_id = ? AND url = ?').get(issueId, clean.url)) throw bad('This link is on the issue already.');
      const { lastInsertRowid } = db.prepare('INSERT INTO issue_links (issue_id, url, title, kind, created_at) VALUES (?, ?, ?, ?, ?)').run(issueId, clean.url, clean.title, clean.kind, now());
      return { id: Number(lastInsertRowid), ...clean };
    },
    remove(issueId, linkId) {
      const found = find(issueId, linkId);
      if (!found) throw bad(`There is no link ${linkId} on this issue.`);
      db.prepare('DELETE FROM issue_links WHERE id = ?').run(linkId);
      return row(found);
    },
  };
}
