import { randomUUID } from 'node:crypto';

export const STATUS_CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];
export const CATEGORY_TYPE = { backlog: 'backlog', unstarted: 'todo', started: 'in_progress', completed: 'done', canceled: 'canceled' };
export const DEFAULT_STATUSES = [
  { id: 'backlog', category: 'backlog', type: 'backlog' },
  { id: 'todo', category: 'unstarted', type: 'todo' },
  { id: 'in_progress', category: 'started', type: 'in_progress' },
  { id: 'in_review', category: 'started', type: 'in_review' },
  { id: 'done', category: 'completed', type: 'done' },
  { id: 'canceled', category: 'canceled', type: 'canceled' },
];
const DEFAULT_NAMES = {
  backlog: ['Backlog', '待规划'], todo: ['Todo', '待办'], in_progress: ['In Progress', '处理中'],
  in_review: ['In Review', '待审核'], done: ['Done', '已完成'], canceled: ['Canceled', '已取消'],
};

export function migrateWorkflow(db) {
  db.exec(`
    CREATE TABLE issue_statuses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('backlog','unstarted','started','completed','canceled')),
      type TEXT NOT NULL CHECK (type IN ('backlog','todo','in_progress','in_review','done','canceled')),
      name TEXT,
      color TEXT,
      description TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX issue_status_default ON issue_statuses(is_default) WHERE is_default = 1;
    ALTER TABLE issues ADD COLUMN workflow_status TEXT REFERENCES issue_statuses(id);
  `);
  const insert = db.prepare('INSERT INTO issue_statuses(id,category,type,position,is_default) VALUES (?,?,?,?,?)');
  DEFAULT_STATUSES.forEach((status, index) => insert.run(status.id, status.category, status.type, index, Number(status.id === 'todo')));
  db.exec(`
    UPDATE issues SET workflow_status = status;
    CREATE INDEX issues_workflow_status ON issues(workflow_status);
    CREATE TABLE issue_workflow_counts (
      status TEXT NOT NULL REFERENCES issue_statuses(id),
      priority TEXT NOT NULL,
      n INTEGER NOT NULL,
      PRIMARY KEY(status, priority)
    ) WITHOUT ROWID;
    INSERT INTO issue_workflow_counts SELECT workflow_status,priority,COUNT(*) FROM issues GROUP BY workflow_status,priority;
    CREATE TRIGGER issues_workflow_insert AFTER INSERT ON issues BEGIN
      INSERT INTO issue_workflow_counts VALUES(COALESCE(new.workflow_status,new.status),new.priority,1)
        ON CONFLICT DO UPDATE SET n=n+1;
    END;
    CREATE TRIGGER issues_workflow_update AFTER UPDATE OF workflow_status,priority ON issues BEGIN
      UPDATE issue_workflow_counts SET n=n-1 WHERE status=COALESCE(old.workflow_status,old.status) AND priority=old.priority;
      INSERT INTO issue_workflow_counts VALUES(COALESCE(new.workflow_status,new.status),new.priority,1)
        ON CONFLICT DO UPDATE SET n=n+1;
    END;
    CREATE TRIGGER issues_workflow_delete AFTER DELETE ON issues BEGIN
      UPDATE issue_workflow_counts SET n=n-1 WHERE status=COALESCE(old.workflow_status,old.status) AND priority=old.priority;
    END;
  `);
}

/** Stable workflow identities keep history readable when names, colors and ordering change. */
export function createWorkflow(db, invalid) {
  const toStatus = (row) => row && ({
    id: row.id, category: row.category, type: row.type, name: row.name, color: row.color,
    description: row.description, position: row.position, isDefault: Boolean(row.is_default), archived: Boolean(row.archived),
  });
  const all = db.prepare('SELECT * FROM issue_statuses ORDER BY position,id');
  const byId = db.prepare('SELECT * FROM issue_statuses WHERE id=?');
  const rows = () => all.all().map(toStatus).sort((a, b) => STATUS_CATEGORIES.indexOf(a.category) - STATUS_CATEGORIES.indexOf(b.category) || a.position - b.position);
  const get = (id) => typeof id === 'string' ? toStatus(byId.get(id)) : undefined;
  const requireStatus = (id) => {
    const status = get(id);
    if (!status || status.archived) throw invalid('unknown_status');
    return status;
  };
  const defaultId = () => rows().find((status) => status.isDefault && !status.archived)?.id ?? 'todo';
  const forType = (type) => {
    const active = rows().filter((status) => !status.archived);
    return active.find((status) => status.id === type)?.id ?? active.find((status) => status.type === type)?.id ??
      active.find((status) => status.category === DEFAULT_STATUSES.find((entry) => entry.id === type)?.category)?.id;
  };
  const validate = (input, adding) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('invalid_status');
    const allowed = adding ? ['name', 'color', 'description', 'category'] : ['name', 'color', 'description', 'isDefault'];
    if (Object.keys(input).some((key) => !allowed.includes(key))) throw invalid('invalid_status');
    const clean = {};
    for (const key of ['name', 'description']) {
      if (!Object.hasOwn(input, key)) continue;
      if (typeof input[key] !== 'string' || input[key].trim().length > (key === 'name' ? 80 : 500) || (key === 'name' && !input[key].trim())) throw invalid('invalid_status');
      clean[key] = input[key].trim();
    }
    if (adding && (!clean.name || !STATUS_CATEGORIES.includes(input.category))) throw invalid('invalid_status');
    if (Object.hasOwn(input, 'color')) {
      if (input.color !== null && (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color))) throw invalid('invalid_status');
      clean.color = input.color;
    }
    if (Object.hasOwn(input, 'isDefault')) {
      if (input.isDefault !== true) throw invalid('invalid_status');
      clean.is_default = 1;
    }
    return clean;
  };
  const unique = (name, except) => {
    if (name && rows().some((status) => !status.archived && status.id !== except &&
        (status.name ? [status.name] : DEFAULT_NAMES[status.id] ?? []).some((value) => value.toLowerCase() === name.toLowerCase()))) throw invalid('duplicate_status');
  };
  return {
    rows, get, require: requireStatus, defaultId, forType,
    type: (id) => get(id)?.type ?? id,
    add(input) {
      const clean = validate(input, true);
      unique(clean.name);
      const id = `status-${randomUUID()}`;
      const position = Math.max(-1, ...rows().filter((status) => status.category === input.category).map((status) => status.position)) + 1;
      db.prepare('INSERT INTO issue_statuses(id,category,type,name,color,description,position) VALUES(?,?,?,?,?,?,?)')
        .run(id, input.category, CATEGORY_TYPE[input.category], clean.name, clean.color ?? null, clean.description ?? '', position);
      return get(id);
    },
    update(id, input) {
      const status = requireStatus(id);
      const clean = validate(input, false);
      unique(clean.name, id);
      if (clean.is_default) {
        if (['completed', 'canceled'].includes(status.category)) throw invalid('invalid_status');
        db.prepare('UPDATE issue_statuses SET is_default=0 WHERE is_default=1').run();
      }
      const keys = Object.keys(clean);
      if (keys.length) db.prepare(`UPDATE issue_statuses SET ${keys.map((key) => `${key}=?`).join(',')} WHERE id=?`).run(...Object.values(clean), id);
      return get(id);
    },
    archive(id, replacement) {
      const status = requireStatus(id);
      const alternatives = rows().filter((entry) => !entry.archived && entry.id !== id && entry.category === status.category);
      if (!alternatives.length) throw invalid('last_status');
      const target = requireStatus(replacement ?? alternatives[0].id);
      if (target.id === id || target.category !== status.category) throw invalid('invalid_status');
      db.prepare('UPDATE issue_statuses SET archived=1,is_default=0 WHERE id=?').run(id);
      if (status.isDefault) db.prepare('UPDATE issue_statuses SET is_default=1 WHERE id=?').run(target.id);
      return target;
    },
    reorder(category, ids) {
      const current = rows().filter((status) => status.category === category && !status.archived);
      if (!STATUS_CATEGORIES.includes(category) || !Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== current.length || ids.some((id) => !current.some((status) => status.id === id))) throw invalid('invalid_status');
      const update = db.prepare('UPDATE issue_statuses SET position=? WHERE id=?');
      ids.forEach((id, index) => update.run(index, id));
    },
  };
}
