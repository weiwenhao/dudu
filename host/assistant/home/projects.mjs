import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

const view = (workspace) => ({ id: workspace.id, name: workspace.title, path: workspace.path });
const wrong = (message) => ({ outcome: 'needs_clarification', message });

/** Projects are DSH workspaces, backed by an existing directory. Creating a directory is an explicit owner action. */
export function createProjects({ registry, home = homedir() }) {
  const service = () => {
    const value = registry();
    if (!value) throw new Error('Projects are unavailable.');
    return value;
  };
  return {
    list: () => ({ outcome: 'success', projects: service().list().map(view) }),
    async create({ name, path, createDirectory = false } = {}) {
      if (typeof path !== 'string' || !path.trim()) return wrong('Choose a project folder.');
      const full = path.trim().startsWith('~/') ? join(home, path.trim().slice(2)) : path.trim();
      if (!isAbsolute(full)) return wrong('Use an absolute project folder path.');
      if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 200)) return wrong('Enter a project name.');
      try {
        if (createDirectory === true) await mkdir(full, { recursive: true });
        const canonical = await realpath(full);
        if (!(await stat(canonical)).isDirectory()) return wrong('The project folder is not a directory.');
        const workspace = await service().create(canonical, name?.trim() || basename(full));
        return { outcome: 'success', project: view(workspace) };
      } catch {
        return wrong('The project folder could not be opened.');
      }
    },
    async handle(action, request) {
      try {
        const body = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json(wrong('Expected an object.'), { status: 400 });
        const result = action === 'list' ? this.list() : action === 'create' ? await this.create(body) : null;
        return result ? Response.json(result, { headers: { 'cache-control': 'no-store' } }) : new Response('Not found', { status: 404 });
      } catch {
        return Response.json({ outcome: 'error', message: 'Projects are unavailable.' }, { status: 503 });
      }
    },
  };
}
