// This is the application's OAR boundary. build.mjs prepares an unchanged official
// package plus the reviewed patches; callers never import upstream internals.
export { claudeRuntime } from './.generated/oar/dist/runtimes/claude/index.js';
export { codexRuntime } from './.generated/oar/dist/runtimes/codex/index.js';
// The other harnesses OAR drives as one process of their own (ACP: grok, kimi, opencode, antigravity, codebuddy, devin; stream-json: qwen, qoder; and factory's droid).
// DeepSeek Harness (dsh) is DSH itself, Pi Durable needs host-owned sessions and Cursor needs its SDK: none of them is exported.
export { grokRuntime } from './.generated/oar/dist/runtimes/grok/index.js';
export { kimiRuntime } from './.generated/oar/dist/runtimes/kimi/index.js';
export { opencodeRuntime } from './.generated/oar/dist/runtimes/opencode/index.js';
export { antigravityRuntime } from './.generated/oar/dist/runtimes/antigravity/index.js';
export { codebuddyRuntime } from './.generated/oar/dist/runtimes/codebuddy/index.js';
export { devinRuntime } from './.generated/oar/dist/runtimes/devin/index.js';
export { factoryRuntime } from './.generated/oar/dist/runtimes/factory/index.js';
export { qwenRuntime } from './.generated/oar/dist/runtimes/qwen/index.js';
export { qoderRuntime } from './.generated/oar/dist/runtimes/qoder/index.js';
// `classifyTool` is OAR's cross-runtime tool classifier (what a tool call is: shell, read, edit, search...).
export { classifyTool, initialTaskState, reduceTaskState } from './.generated/oar/dist/observe/index.js';
export { executableInstallation } from './.generated/oar/dist/shared/installation.js';
export { recoverOwnedProcess } from './.generated/oar/dist/shared/executable/process-recovery.js';
// Tools the host serves to a session over MCP (http on 127.0.0.1 with a bearer token): the plugin's replacements of Claude's own cron tools (providers/cron-tools.mjs).
export { serveMcpTools } from './.generated/oar/dist/mcp/serve-tools.js';
