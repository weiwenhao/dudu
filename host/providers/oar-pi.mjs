// Pi's runtime, bundled apart from Claude's and Codex's (oar-runtimes.mjs): its SDK is large, and only a computer that has Pi needs it.
// The Pi driver imports this file when it first has to open a session or list models.
export { createPiRuntime } from '@dudu/oar-adapter/pi';
