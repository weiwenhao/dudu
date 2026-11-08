// Test-only access to the same prepared kernel and private helpers as production.
// Keep deep imports here so an upstream upgrade has one compatibility boundary.
export { scriptedRuntime } from './.generated/oar/dist/testing/index.js';
export { foldCodexNotification, initialCodexProjection } from './.generated/oar/dist/runtimes/codex/projection.js';
export { codexLegacyTaskViews } from './.generated/oar/dist/runtimes/codex/tasks.js';
export { spawnLineProcess } from './.generated/oar/dist/shared/executable/process.js';
export { trackPendingCleanup } from './.generated/oar/dist/shared/executable/ownership.js';
export { killEntries, readProcessTable } from './.generated/oar/dist/shared/executable/process-tree.js';
