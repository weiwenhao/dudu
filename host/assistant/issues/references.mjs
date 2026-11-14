import { basename, normalize, parse, sep } from 'node:path';

const keyword = (name) => String(name ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase();
const identityOf = (project) => {
  if (!project.path) return `name:${project.name.normalize('NFKC').toLowerCase()}`;
  const path = normalize(project.path);
  return `path:${path.length > parse(path).root.length && path.endsWith(sep) ? path.slice(0, -1) : path}`;
};

function availableKey(root, used) {
  if (!used.has(root)) return root;
  for (let length = 1; length <= 3; length++) {
    for (let n = 0; n < 26 ** length; n++) {
      let suffix = '';
      for (let value = n, at = 0; at < length; at++, value = Math.floor(value / 26)) suffix = String.fromCharCode(65 + value % 26) + suffix;
      const candidate = root.slice(0, 3 - length) + suffix;
      if (!used.has(candidate)) return candidate;
    }
  }
  throw new Error('All three-letter project keys are in use.');
}

/** Schema v4 shortens legacy keys without changing identities, sequences, reservations or audit history. */
export function shortenProjectKeys(db) {
  const projects = db.prepare('SELECT rowid, identity, key FROM issue_projects ORDER BY rowid').all();
  const used = new Set(projects.filter(({ key }) => /^[A-Z]{1,3}$/.test(key)).map(({ key }) => key));
  const changed = projects.filter(({ key }) => !used.has(key)).map((project) => {
    const path = project.identity.startsWith('path:') ? project.identity.slice(5) : '';
    const key = availableKey(keyword(project.key) || keyword(basename(path)) || 'PRJ', used);
    used.add(key);
    return { ...project, next: key, temporary: `@prefix-${project.rowid}` };
  });
  const projectKey = db.prepare('UPDATE issue_projects SET key = ? WHERE identity = ?');
  const issueKey = db.prepare('UPDATE issues SET project_key = ? WHERE project_key = ? COLLATE NOCASE');
  // Stage every rename first: an existing long key may shorten to another project's old key.
  for (const project of changed) {
    projectKey.run(project.temporary, project.identity);
    issueKey.run(project.temporary, project.key);
  }
  for (const project of changed) {
    projectKey.run(project.next, project.identity);
    issueKey.run(project.next, project.temporary);
  }
}

/** Called within the same transaction as its issue change, including migration. */
export function createReferences(db) {
  function assign(id, project) {
    if (!project) {
      db.prepare('UPDATE issues SET project_key = NULL, project_number = NULL WHERE id = ?').run(id);
      return;
    }
    const identity = identityOf(project);
    let entry = db.prepare('SELECT key FROM issue_projects WHERE identity = ?').get(identity);
    if (!entry) {
      const root = keyword(project.name) || keyword(basename(project.path || '')) || 'PRJ';
      const key = availableKey(root, new Set(db.prepare('SELECT key FROM issue_projects').all().map((row) => row.key)));
      db.prepare('INSERT INTO issue_projects (identity, key) VALUES (?, ?)').run(identity, key);
      entry = { key };
    }
    let reservation = db.prepare('SELECT number FROM issue_project_numbers WHERE identity = ? AND issue_id = ?').get(identity, id);
    if (!reservation) {
      const { next_number: number } = db.prepare('SELECT next_number FROM issue_projects WHERE identity = ?').get(identity);
      db.prepare('INSERT INTO issue_project_numbers (identity, issue_id, number) VALUES (?, ?, ?)').run(identity, id, number);
      db.prepare('UPDATE issue_projects SET next_number = next_number + 1 WHERE identity = ?').run(identity);
      reservation = { number };
    }
    db.prepare('UPDATE issues SET project_key = ?, project_number = ? WHERE id = ?').run(entry.key, reservation.number, id);
  }
  return {
    assign,
    backfill() {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of db.prepare('SELECT id, project_name, project_path FROM issues WHERE project_name IS NOT NULL AND project_key IS NULL ORDER BY id').all()) {
          assign(row.id, { name: row.project_name, path: row.project_path });
        }
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
