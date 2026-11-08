# DSH 0.2.2 compatibility audit

Audit date: 2026-11-06. Target: the Desktop-bundled `0.2.2-rc.1` CLI,
release commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`.

Sources:

- [Official release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)
- [Source at the release tag](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.1)

The release notes summarize changes since `0.2.1-rc.5`. The `0.2.2-alpha.3`
to `0.2.2-rc.1` source comparison changes package versions; the larger audit
therefore also compares the earlier `0.2.1-rc.5` baseline. This is an audit of
Dudu's integration boundaries, not a claim that every new DSH feature is a
new native iPhone feature.

## Host interfaces

| Change | Dudu adaptation |
| --- | --- |
| `sessionController.inspect()` removed | `host/dsh-session-history.mjs` prefers `sessionQuery.readSession()`, normalizes its immutable header, and retains a capability-based fallback for older hosts. Operational errors do not retry another API. |
| Read-only session queries need no active Agent or full-text index | Search, previews, native import/sync/repair, resume properties and harness turn recovery share the same reader. Aborting a caller stops waiting; it cannot cancel the new host query itself. |
| Native/PTC execution moved into Agent-scoped plugins | Dudu and collectors mount the host's official `NativeToolExecutor` in their own scopes. Older hosts retain `presentAs('native')`. No copied DSH executor or custom protocol is bundled. |
| `tools.execute` accepts a batch | Connector forwarding wraps one admitted call in a batch, preserves its Agent, signal and `toolSet`, and unwraps the matching result. Errors are not retried. |
| Conditional tool admission | Dudu preserves the host's assembled tool list and supplies the current `toolSet` to schema lookups and forwarded execution. MCP collector restrictions still limit the registry to that server's read tools. |
| Async projection registration | The Agent activity and harness timing projections finish registering before their consumers are published. |
| Per-step model route is fixed earlier | Dudu already selects through Agent options/model selection. Its request hook only carries the working directory and rejects harness routes for its own conversation; it does not replace provider/model routing. |
| PTC preset replaces `tools.mode` | The isolated PTC integration test uses `agent-preset-registry.default: ptc`; Dudu remains native in its own scope. |
| New session lifecycle/publication ordering | A fresher exact session snapshot invalidates stale native sidebar metadata. Identical observations keep the existing list cache. Issue workflow remains manual. |
| Cordis configuration and plugin recovery changes | Installation continues through Desktop's bundled CLI and the existing profile reconciliation path. Dudu does not edit the host's effective configuration manually. |

## iPhone and embedded pages

The main conversation, composer, sidebar and files are SwiftUI. The embedded
plugin/settings/trajectory/context/team pages load the installed DSH's current
web resources. Updating DSH can update those page components without replacing
native screens.

| Release area | Integration boundary |
| --- | --- |
| Narrow-screen layouts and touch interactions | Reuse the installed DSH resources. Retain suppression of the desktop shell, duplicate navigation and composer because SwiftUI owns those surfaces. |
| Static resource ETag support | The new host resource carrier requires a `Headers` object. The embedded manifest reader supplies it; authenticated page resources continue using the existing page-scoped carrier and caches. |
| Frontend startup | The known eager dynamic-expression compiler is neutralized by its exact body, independently of minified variable names. CSP is not weakened with `unsafe-eval`. Unknown compiler variants remain untouched and fail visibly. |
| Plugin page header and rich details | The new nested header must be hidden through the host's stable data attributes while keeping plugin tabs and detail navigation. The native toolbar's existing add command reaches the new toolbar hook. |
| Session view activation | New Web clients pass `activate` to `session/follow`. The page policy admits the official boolean only for its authorized session, preserving all other argument restrictions. |
| Live tool result JSON in Trajectory | Add the exact `toolResults/watch` stream for the requested session and a bounded event sequence. It cannot inspect another session or run a tool. |
| Session background-job roster | Admit the read-only `job/list` subscription for the page's session. Job control, terminal execution and unrelated session access remain unavailable. |
| Additional live subscriptions | Multiplex the authenticated page's stream handles through one bounded HTTP poll. Seven subscriptions no longer compete for the browser's six HTTP/1 connections. A result delivered between polls remains queued until consumed. Legacy single-stream callers retain their protocol. |
| Command and skill catalogs | Admit the current `commands/list` argument name and the exact session-scoped `skills/list` read. This does not admit command execution or skill bodies. |
| New trajectory result/details layout | Reuse its original controls, rendered result and JSON viewers; only embedded-shell adjustments belong in Dudu's adapter. |
| Context/team plugin layouts | Their `.lc-*` rules adapt third-party pages, not DSH's built-in UI; upstream narrow-screen work does not make them redundant. |
| Inspector | The new experimental Inspector is a right-sidebar tab. It is distinct from Trajectory; do not substitute it for the existing trace route. |
| File preview/worktrees | Native historical diffs remain historical session diffs. The upstream directory-tree/PR-worktree browser is a separate feature, not a replacement for those diffs. |
| Chat quotes, complete Markdown export, collapsed replies, image upload | DSH's own web components inherit these changes. Native SwiftUI behavior does not change merely because the web bundle changed; adding new native interactions or wording requires its own design/copy review. |
| WebSocket compression | Not used by the phone. Existing authenticated HTTP and long polling remain the transport. |

## Verification record

Verification uses the Desktop-bundled CLI in isolated `DSH_HOME` and `HOME`
directories and installed Chrome. The model's answers are scripted; DSH's
session stores, Agent loop, providers, tools and web resources are real.
No owner session or live pairing is used.

- Exact-history compatibility, legacy fallback, cancellation and errors:
  targeted shared-reader, search, native sync, repair and resume-property cases.
- Claude and Codex opening-failure recovery: unsent instructions and images
  survive repeated failures and DSH restart.
- Native full-text search after DSH restart.
- Dudu native tools and memory under a PTC host preset, including a resumed
  conversation after restart.
- Dudu reasoning effort retained across reload/restart and sent to the model.
- Mobile DeepSeek, Claude and Codex: create, send exactly once, receive the
  reply, and obtain matching current Agent/sidebar metadata.
- Embedded pages: use the actual `EmbeddedTransport.js` and page-scoped HTTP
  authentication at a phone-sized viewport. Only the native WK message handler
  is represented by the browser test. Plugin navigation, the existing add
  command, settings and initial trajectory history passed. The expanded trace
  check also passed with a live file read: the streamed reply, raw result JSON,
  rendered result and phone-sized details panel were verified.
- `npm run lint`, `npm run typecheck` and `npm run native:build` passed.
- Desktop recovery: installed through `npm run desktop:update`; the running
  package fingerprint matched the source and installed package, and the local
  probe returned HTTP 200. Direct inspection of the owner's Desktop showed
  the dashboard, Office and conversation history. The updater reported its
  readiness timeout; the running build and interface were independently
  verified afterward.

The later HTTP multiplexing and catalog additions were installed on Desktop
on 2026-11-06 through `npm run desktop:update`. The command's readiness check
timed out because it mistook an old CLI test process for the Desktop app,
which was closed. Desktop was opened normally afterward. Its running package
fingerprint matched the installed package and packaged source, and its port
3170 probe returned HTTP 200 with the expected protocol and proof fields.
The independent verification is recorded in
`.local/dsh-compat-nov06/desktop-phone-verification.json`.

The Desktop install log also reports existing
`@deepseek-ai/dsh-subagent-claude-code@0.2.1-rc.3` and
`@deepseek-ai/dsh-subagent-codex@0.2.1-rc.3` as incompatible with this runtime.
No version exemption was granted and those unrelated packages were not changed.
Dudu's OAR-backed Claude/Codex providers are separate from those packages.

The embedded browser checks do not establish physical iPhone/WKWebView behavior.
On 2026-11-06, `npm run native:install` successfully built and installed the
updated app in place on the owner's paired iPhone. The bundle identifier and
signing team were retained. The installed build's `EmbeddedTransport.js`
matched the latest source. The build and installation log is
`.local/dsh-compat-nov06/native-install.log`; interactive WKWebView behavior
on the physical device was not re-tested during installation.
No full suite or commit is part of this record.

Follow-up on 2026-11-06: physical-phone diagnostics identified two more gaps.
DSH's product icons now use document-level SVG symbols; exporting only their
`<use>` elements produced fully transparent PNGs. Icon export now includes the
referenced symbols and their nested references, and rejects empty raster output.
The official `session/attachment` request requires the complete image reference,
including its format, byte length and dimensions. The bridge now retains that
reference from the watched event instead of reducing it to an attachment ID.
The phone still supplies only its watched occurrence ID.

Ten focused logic tests, seven RPC adapter tests and two real bundled-DSH checks passed: exported sidebar
icons have visible, distinct artwork, and a durable image is read successfully
after a cold restart. Lint and typecheck passed. These changes are confined to
the Desktop plugin; no new phone build or App wording is required.
Logs are `.local/dsh-compat-nov06/icons-images-{unit,e2e,lint,typecheck}.log`.
The installation attempt was refused by the updater's inside-DSH guard; the
owner's installed and running build was left unchanged. The verified package
awaits an external-terminal update or an explicitly requested immediate forced
update. The attempted update log is
`.local/dsh-compat-nov06/icons-images-desktop-update.log`, and the compared
package identities are in `.local/dsh-compat-nov06/icons-images-deployment.json`.

A further phone report on 2026-11-06 identified an inconsistent queued-image
placeholder: it used a constant 2pt stroke at 18pt while the neighbouring queue
actions use 16pt icons with proportionally scaled strokes. The placeholder now
uses that same 16pt sizing and scaling. A signed Release build containing this
icon change was installed in place on the paired iPhone; its receipt is in
`.local/dsh-compat-nov06/queue-icon-native-install.log`.

The reported missing message is present in DSH's durable user history. The
phone's diagnostics show a failed LAN request followed by a switch to the
public address. After reconnecting, restoring the active watch waited about
14 seconds for `session.list`, leaving the cached conversation visible even
though sends were already accepted. The active watch now starts alongside the
list refresh; a slow sidebar list cannot hold back live conversation updates.
The existing watch identity and selection guards still reject stale replies.

Seven selected native store tests passed, including a deliberately held
session list, a newer live message arriving before the watch response, missing
cached sessions, and foreground restoration. One real bundled-DSH test passed:
sending immediately after cancellation reaches live history and a new watch
exactly once, before the delayed model reply. Lint and typecheck passed.
Logs are `.local/dsh-compat-nov06/message-display-{native-tests,e2e,lint,typecheck}.log`.
The combined native update was built and installed in place on the paired
iPhone, retaining `com.harnessmobile.app`, version `0.3.0 (35)` and its signing
team. Its install receipt is
`.local/dsh-compat-nov06/message-display-native-install.log`.
The queue placeholder was also inspected in a simulator screenshot alongside
its neighbouring actions (`.local/dsh-compat-nov06/queue-icon-review.png`).
The separately authorized forced Desktop update follows through the official
updater, with independent package/runtime verification recorded by the detached
runner in `.local/dsh-compat-nov06/phone-fixes-application.json`. No additional
App copy, live pairing or full suite is part of these changes.
