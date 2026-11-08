// The plugin's only OAR import. The adapter owns the upstream version and compatibility patches.
// Packaging bundles just these two runtime graphs into the standalone plugin.
export { claudeRuntime, codexRuntime, initialTaskState, reduceTaskState } from '@dudu/oar-adapter';
