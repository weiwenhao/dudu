// The plugin's only OAR import. The adapter owns the upstream version and compatibility patches.
// Packaging bundles every runtime graph exported here into the standalone plugin's one file (Pi's, which is large, has its own file: oar-pi.mjs).
export {
  claudeRuntime, codexRuntime, grokRuntime, kimiRuntime, opencodeRuntime, antigravityRuntime, codebuddyRuntime, devinRuntime, factoryRuntime, qwenRuntime, qoderRuntime,
  classifyTool, executableInstallation, initialTaskState, reduceTaskState, recoverOwnedProcess, serveMcpTools,
} from '@dudu/oar-adapter';
