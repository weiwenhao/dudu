export const TASK_ACTIONS = Object.freeze(['list', 'get', 'create', 'update', 'pause', 'resume', 'duplicate', 'delete', 'run', 'history', 'options']);
export const NATIVE_TASK_METHODS = Object.freeze(TASK_ACTIONS.map((action) => `tasks.${action}`));
