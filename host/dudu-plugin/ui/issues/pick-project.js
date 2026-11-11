/** Use DSH's directory picker, then register the selected existing folder without opening a session or creating directories. */
export async function pickProject({ pickDirectory, request, signal }) {
  signal?.throwIfAborted();
  const path = await pickDirectory();
  signal?.throwIfAborted();
  if (path === null) return null;
  if (typeof path !== 'string' || !path.trim()) throw new Error('The directory picker returned no folder.');
  const result = await request('projects/create', { path }, { signal });
  signal?.throwIfAborted();
  if (result?.outcome !== 'success' || !result.project?.name || !result.project?.path) throw new Error('The project could not be added.');
  return { name: result.project.name, path: result.project.path };
}
