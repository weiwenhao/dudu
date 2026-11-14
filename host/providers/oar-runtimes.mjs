// The plugin's only OAR import. The adapter owns the upstream version and compatibility patches.
// Packaging bundles just these two runtime graphs into the standalone plugin (Pi's, which is large, has its own file: oar-pi.mjs).
export { claudeRuntime, codexRuntime, executableInstallation, initialTaskState, reduceTaskState } from '@dudu/oar-adapter';
