// Pi's runtime. Kept out of index.mjs on purpose: a bundle of this entry carries Pi's SDK (about 15 MB), which the Claude and Codex
// runtimes must not load or ship in the same file. The host drives the `pi` installed on the computer through
// createPiRuntime({ execution: 'subprocess', command }); OAR still reads the SDK's model catalog and session files in the host process,
// so the SDK has to be bundled with it.
export { createPiRuntime } from './.generated/oar/dist/runtimes/pi/index.js';
