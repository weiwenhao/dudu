// 嘟嘟's own state, opened together (docs/assistant.md 2, 3.5, 3.6, 5): the project folder, the settings, the memory and the
// connectors, and the calls the settings page makes on them. Nothing here imports DSH; the plugin passes in what it must (the
// folders, a model function, how to open a file).
//
//   const assistant = openAssistant({ dshHome, stateFolder, env, llm?, openPath? });
//   assistant.handle('connectors/list', request)      one POST of the page, answered with JSON
//   assistant.memory, assistant.connectors            null when the project folder could not be opened (see `problems`)
//   assistant.setLlm(fn)                              the model function of the memory (once the plugin has one)
//   assistant.close()
//
// The page is the owner. Every answer is { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', ... }.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { createConnectors } from './connectors/index.mjs';
import { createMemory } from './memory/index.mjs';
import { checkFolder, defaultFolder, ensureFolder, migrate } from './project.mjs';
import { createSettings } from './settings.mjs';

const NO_STORE = { 'cache-control': 'no-store' };
const RULE_FILES = ['TRIAGE.md', 'ASSIGN.md'];

/** Opens a file or a folder with what the system uses for it (execFile with an argument list: no shell). */
export function openWithSystem(path, { platform = process.platform, run = execFile } = {}) {
  const [command, args] = platform === 'darwin' ? ['open', [path]] : platform === 'win32' ? ['explorer', [path]] : ['xdg-open', [path]];
  return new Promise((resolve) => { run(command, args, (error) => resolve(error ? { ok: false, message: error.message } : { ok: true })); });
}

export function openAssistant({ dshHome, stateFolder, env = process.env, llm = null, now = Date.now, openPath = openWithSystem, dsh = null, state = () => ({}), beforeFolderChange = () => null }) {
  const settings = createSettings({ file: join(stateFolder, 'settings.json'), now });
  const problems = [];
  let model = llm;
  let folder = null;
  let memory = null;
  let connectors = null;

  const standard = defaultFolder(dshHome, { env });

  /** Opens the project folder at `path`: creates it with its template files when it is new, then the memory and connectors in it. */
  function start(path) {
    const ensured = ensureFolder(path, { env });
    if (!ensured.ok) return ensured;
    memory?.close();
    memory = null;
    connectors = null;
    folder = ensured.path;
    memory = createMemory({ dir: folder, indexDir: join(stateFolder, 'index'), llm: (messages, options) => {
      if (!model) return Promise.reject(new Error('There is no model yet.'));
      return model(messages, options);
    }, now });
    // Secrets are looked up by the name the registry gives them; the environment is the one place this knows of.
    connectors = createConnectors({ file: join(folder, 'CONNECTORS.md'), secrets: (ref) => env[ref], env, now, dsh });
    return ensured;
  }

  const wanted = settings.get().settings.projectFolder ?? standard;
  const first = start(wanted);
  if (!first.ok) problems.push(first.reason);

  const unavailable = () => ({
    outcome: 'error', message: `The project folder could not be opened${problems.length ? `: ${problems[0]}` : '.'}`,
    next: 'Choose a project folder in the settings.',
  });
  const need = (part) => (part ? null : unavailable());

  async function changeFolder({ path, move = false }) {
    const check = checkFolder(path, { env });
    if (!check.ok) return { outcome: 'needs_clarification', message: check.reason, code: check.code, next: 'Choose another folder.' };
    if (folder && check.path === folder) return { outcome: 'no_op', message: 'This is already the folder in use.' };
    const held = await beforeFolderChange();
    if (held) return held;
    const previous = connectors;
    await previous?.close();
    if (move && folder) {
      const moved = migrate(folder, path, { env });
      if (!moved.ok) {
        connectors = createConnectors({ file: join(folder, 'CONNECTORS.md'), secrets: (ref) => env[ref], env, now, dsh });
        return { outcome: 'needs_clarification', message: moved.reason, code: moved.code, next: 'Choose another folder.' };
      }
    }
    const started = start(path);
    if (!started.ok) {
      if (folder) connectors = createConnectors({ file: join(folder, 'CONNECTORS.md'), secrets: (ref) => env[ref], env, now, dsh });
      return { outcome: 'needs_clarification', message: started.reason, code: started.code, next: 'Choose another folder.' };
    }
    problems.length = 0;
    const saved = settings.set({ projectFolder: path === standard ? null : path });
    return saved.outcome === 'success' ? { outcome: 'success', projectFolder: folder, isDefault: path === standard } : saved;
  }

  async function open({ name }) {
    if (name === 'folder') return folder ? { outcome: 'success', ...(await openPath(folder)) } : unavailable();
    if (!RULE_FILES.includes(name)) return { outcome: 'needs_clarification', message: `Only ${RULE_FILES.join(' and ')} or the folder can be opened.` };
    const missing = need(folder);
    if (missing) return missing;
    const opened = await openPath(join(folder, name));
    return opened.ok ? { outcome: 'success' } : { outcome: 'error', message: `The file could not be opened: ${opened.message}` };
  }

  // The owner-facing calls, by the path the page posts to. Each takes the parsed body.
  const CALLS = {
    'assistant/state': async () => ({ outcome: 'success', projectFolder: folder, isDefault: folder === standard, defaultFolder: standard, stateFolder, problems: [...problems], ...await state() }),
    'assistant/settings': ({ patch } = {}) => (patch === undefined ? settings.get() : settings.set(patch)),
    'assistant/folder': changeFolder,
    'assistant/open': open,
    'rules/get': () => need(memory) ?? { outcome: 'success', ...memory.rules() },
    'memory/records': (body) => need(memory) ?? memory.records(body),
    'memory/update': ({ id, ...patch }) => need(memory) ?? memory.update(id, patch),
    'memory/forget': (body) => need(memory) ?? memory.forget(body),
    'memory/reviews': (body) => need(memory) ?? memory.reviews(body),
    'memory/undo': ({ id }) => need(memory) ?? memory.undoReview(id),
    'skills/list': () => need(memory) ?? memory.skills.list(),
    'skills/read': ({ name }) => need(memory) ?? memory.skills.read(name),
    'skills/remove': ({ name }) => need(memory) ?? memory.skills.remove(name),
    'connectors/list': () => need(connectors) ?? connectors.owner.list(),
    'connectors/remove': ({ id }) => need(connectors) ?? connectors.owner.remove(id),
    'connectors/undo': ({ token }) => need(connectors) ?? connectors.owner.undo(token),
  };

  return {
    paths: Object.keys(CALLS),
    get memory() { return memory; },
    get connectors() { return connectors; },
    get folder() { return folder; },
    settings,
    problems,
    setLlm(fn) { model = fn; },
    /** One POST of the page: `path` is one of `paths`; the body is a JSON object. */
    async handle(path, request) {
      const call = Object.hasOwn(CALLS, path) ? CALLS[path] : null;
      if (!call) return new Response('Not found', { status: 404 });
      try {
        const body = await request.json().catch(() => { throw new SyntaxError('The request body is not JSON.'); });
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('The request body must be a JSON object.');
        return Response.json(await call(body), { headers: NO_STORE });
      } catch (error) {
        const bad = error instanceof SyntaxError;
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: bad ? 400 : 500, headers: NO_STORE });
      }
    },
    async close() {
      memory?.close();
      await connectors?.close();
      memory = null;
      connectors = null;
    },
  };
}
