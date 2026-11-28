export const TASK_ACTIONS = Object.freeze(['list', 'get', 'create', 'update', 'pause', 'resume', 'duplicate', 'delete', 'run', 'history', 'options']);
export const NATIVE_TASK_METHODS = Object.freeze(TASK_ACTIONS.map((action) => `tasks.${action}`));
/**
 * Who made a task, as the plugin itself knows it (never a field a client sends): the interface (the desktop window, the phones), 嘟嘟 with its own tools, or a conversation with the cron tools it is given
 * (providers/cron-tools.mjs). A task made before this was recorded has none.
 */
export const TASK_ORIGINS = Object.freeze(['app', 'assistant', 'session']);
