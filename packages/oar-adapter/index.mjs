// This is the application's OAR boundary. build.mjs prepares an unchanged official
// package plus the reviewed patches; callers never import upstream internals.
export { claudeRuntime } from './.generated/oar/dist/runtimes/claude/index.js';
export { codexRuntime } from './.generated/oar/dist/runtimes/codex/index.js';
export { initialTaskState, reduceTaskState } from './.generated/oar/dist/observe/index.js';
