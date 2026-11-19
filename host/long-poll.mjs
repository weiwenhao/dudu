// DSH installs an update of itself only after every /api request in flight has finished, and gives up after 10 s ("desktop update: task inspection timed out",
// found 2026-11-19: this plugin's notification stream, open for as long as the page, and its 25 s foreground wait made every attempt fail).
// A request of this plugin that waits for something (a long poll, a stream) therefore ends after this long, and the page asks again.
export const LONG_POLL_MS = 3000;
