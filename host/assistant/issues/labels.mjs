// Labels (owner, 2026-11-05: "reference Linear's issue labels"): a name and a colour, shared by all issues, any number on an issue. An issue keeps the ids
// of its labels (`issues.label_ids`, a JSON list, null for none), so a label that is renamed or recoloured changes everywhere at once and an issue's labels
// are written, undone and compared like any other field. Parents are here too: `issues.parent_id` (a sub-issue's parent).

/** Linear's nine label colours, by name; the page draws them (ui/issues/labels.js). */
export const LABEL_COLORS = ['grey', 'darkGrey', 'purple', 'teal', 'green', 'yellow', 'orange', 'pink', 'red'];
export const DEFAULT_LABEL_COLOR = 'darkGrey';
const MAX_NAME = 50;

// Written so that running it twice (a copy of a database whose version number was put back) changes nothing.
export function migrateLabels(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  const have = new Set(db.prepare('PRAGMA table_info(issues)').all().map((column) => column.name));
  if (!have.has('label_ids')) db.exec('ALTER TABLE issues ADD COLUMN label_ids TEXT');
  if (!have.has('parent_id')) db.exec('ALTER TABLE issues ADD COLUMN parent_id INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS issues_parent ON issues(parent_id) WHERE parent_id IS NOT NULL');
}

const cleanName = (value, bad) => {
  if (typeof value !== 'string') throw bad('name must be text');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw bad('name must not be empty');
  if (name.length > MAX_NAME) throw bad(`name must be at most ${MAX_NAME} characters`);
  return name;
};
const cleanColor = (value, bad) => {
  if (!LABEL_COLORS.includes(value)) throw bad(`color must be one of: ${LABEL_COLORS.join(', ')}`);
  return value;
};

/** The labels table. `write(work)` runs a change inside the store's transaction; `bad(message, next)` makes the store's own error for a wrong value. */
export function createLabels({ db, now = Date.now, write, bad }) {
  const row = (record) => ({ id: record.id, name: record.name, color: record.color });
  let cache = null;
  const all = () => (cache ??= db.prepare('SELECT id, name, color FROM labels ORDER BY name COLLATE NOCASE').all().map(row));
  const byId = () => new Map(all().map((label) => [label.id, label]));
  const sameName = (name, except = null) => db.prepare('SELECT id FROM labels WHERE name = ? COLLATE NOCASE AND id IS NOT ?').get(name, except);

  return {
    list: () => all().map((label) => ({ ...label })),
    /** The labels with these ids, in the order of the ids; an id that is gone is left out. */
    resolve(ids) {
      const known = byId();
      return (ids ?? []).map((id) => known.get(id)).filter(Boolean).map((label) => ({ ...label }));
    },
    exists: (id) => byId().has(id),
    add({ name, color = DEFAULT_LABEL_COLOR } = {}) {
      const clean = { name: cleanName(name, bad), color: cleanColor(color, bad) };
      if (sameName(clean.name)) throw bad(`There is a label called "${clean.name}" already.`, 'Use that label, or choose another name.');
      return write(() => {
        const { lastInsertRowid } = db.prepare('INSERT INTO labels (name, color, created_at) VALUES (?, ?, ?)').run(clean.name, clean.color, now());
        cache = null;
        return { id: Number(lastInsertRowid), ...clean };
      });
    },
    update(id, patch = {}) {
      const current = byId().get(id);
      if (!current) throw bad(`There is no label ${id}.`);
      const next = { name: 'name' in patch ? cleanName(patch.name, bad) : current.name, color: 'color' in patch ? cleanColor(patch.color, bad) : current.color };
      if (next.name !== current.name && sameName(next.name, id)) throw bad(`There is a label called "${next.name}" already.`);
      return write(() => {
        db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(next.name, next.color, id);
        cache = null;
        return { id, ...next };
      });
    },
    /** Takes the label off every issue and forgets it. */
    remove(id) {
      if (!byId().has(id)) throw bad(`There is no label ${id}.`);
      return write(() => {
        const issues = db.prepare('SELECT id, label_ids FROM issues WHERE label_ids IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(label_ids) WHERE value = ?)').all(id);
        for (const issue of issues) {
          const rest = JSON.parse(issue.label_ids).filter((one) => one !== id);
          db.prepare('UPDATE issues SET label_ids = ? WHERE id = ?').run(rest.length ? JSON.stringify(rest) : null, issue.id);
        }
        db.prepare('DELETE FROM labels WHERE id = ?').run(id);
        cache = null;
        return { id, removed: true, issues: issues.length };
      });
    },
  };
}
