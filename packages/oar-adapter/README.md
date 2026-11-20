# Dudu OAR adapter

`@dudu/oar-adapter` is the compatibility boundary between Dudu and the official
`@botiverse/oar` package. Its main entry exposes the Claude and Codex runtimes, the nine other runtimes OAR drives as a process of
their own (`grokRuntime`, `kimiRuntime`, `opencodeRuntime`, `antigravityRuntime`, `codebuddyRuntime`, `devinRuntime`, `factoryRuntime`,
`qwenRuntime`, `qoderRuntime`), the executable probe and the observation helpers the host uses (`classifyTool`, `initialTaskState`,
`reduceTaskState`); the Pi runtime comes from `@dudu/oar-adapter/pi`
(a separate entry on purpose: a bundle of it carries Pi's SDK, about 15 MB, which the other runtimes must not ship in the same file).
DeepSeek Harness (`dsh`, which is DSH itself), Pi Durable (host-owned sessions) and Cursor (needs `@cursor/sdk`) are not exported. DSH event mapping, caching, native-store
reading and process retention remain in `host/providers/`; protocol and native
process ownership remain in OAR.

## Source of truth and build

- `package.json` depends on the exact official **0.120.0** release and
  `signal-exit@4.1.0`. The root lockfile pins their npm archives and transitive
  dependencies. npm installs this OAR under `packages/oar-adapter/node_modules/` (its `js-yaml@3.15.2` differs from the
  repository's own), which is where `build.mjs` resolves it from.
- `upstream.json` records the original archive, integrity, source-tree checksum,
  and each patch's input/output file checksums. `patches/` contains the complete
  local changes; no full upstream source tree is maintained in this repository.
- `build.mjs` checks the installed official package, copies it into a staging
  directory, applies patches with `git apply --no-index --check` then `git apply`,
  verifies every resulting file and publishes `.generated/oar/`. Source maps are
  omitted. It never modifies the official dependency in `node_modules`.
- A different upstream version, a modified official file, an inapplicable patch,
  or an undeclared patch change fails the build. Validation finishes before the
  previous good output is replaced. An unchanged output is reused only after
  checking its complete contents and the current build inputs.
- `.generated/` is ignored. It contains the prepared runtime, original license
  and attribution, our modification notice, and `build.json` with deterministic
  input/output checksums. Do not edit generated files.

Node 24+ and Git are build prerequisites. In the repository, `npm install`
prepares this package through the root postinstall. After changing patches, run:

```sh
npm run oar:prepare
npm run package:desktop
```

Desktop packaging always prepares and checks OAR again. Both development and the
standalone desktop bundle consume `index.mjs`; the tests use the same entry or
`@dudu/oar-adapter/testing`. Only that test entry exposes selected private
projection/process helpers. Application and test files must not deep-import the
upstream package or generated output. The desktop archive bundles the dependency
graphs of the runtimes the main entry exports in one file (`providers/oar-runtimes.mjs`) and Pi's in another, and carries OAR's Apache-2.0 license, its modification
notice identifying the adapter version, OAR's notice for the brand marks inside its runtimes, and licenses of dependencies actually bundled.

The previous `0.75.0-dudu.2` full vendor copy has been replaced by the official
0.92.0 release plus six compatibility patches (2026-11-07), moved to 0.105.0 on 2026-11-14 and to 0.120.0 on 2026-11-19 (see the two "Upgrade to" sections below). Native compaction and native
single-task stopping now use upstream implementations. The remaining patches
are grouped by implementation area because several features share session modules:

| Patch | Purpose |
| --- | --- |
| `session-controls.patch` | Optional control contracts, sealing and shared stream-json hooks |
| `claude-defaults.patch` | Native model, effort and permission configuration |
| `claude-session.patch` | Opening cancellation, private background controls and compact-specific command provenance |
| `codex-subagents.patch` | Native v1/v2 child ownership and resume attribution |
| `codex-session.patch` | Native background terminals alongside official child stopping |
| `process-ownership.patch` | Exit/signal cleanup and idle hook removal |
| `crash-recovery.patch` | Private Claude process identities and verified orphan recovery before resume |

## Upstream provenance

The baseline is the published `@botiverse/oar@0.120.0` npm package from
https://registry.npmjs.org/@botiverse/oar/-/oar-0.120.0.tgz.
The upstream project is https://github.com/botiverse/oar, package directory
`packages/oar`, licensed under Apache-2.0. Its original `LICENSE`, README,
runtime modules, declarations and brand notices are preserved in the generated
copy. The official installed package remains unchanged, including its manifest.

The original npm archive's integrity is:

```
sha512-QcYXeNh6EJWJ48aR8hZLnrrANinodI5h1I6HNSbXaEfOiEzitsTC4XWQr6sRYGUWATtzhDKItferbYeeifGVOA==
```

The installed source-tree checksum excludes source maps and `node_modules`;
`upstream.json` pins the SHA256 of sorted `path + NUL + file SHA256 + LF` entries.
The builder computes the expected patched inventory from that official tree and
all declared before/after hashes, so a patch cannot silently change another file.

## Retained compatibility changes

## Official compaction and task stopping (2026-11-07)

The old optional-compaction contract, sealing override and custom native
dispatch patches are retired. OAR 0.92.0 owns `compact(options)` and its native
completion evidence, including Claude's check that `/compact` is the built-in
command. The host accepts only `completed`; `rejected`, `failed`, `aborted`
and `unconfirmed` remain distinct failures/cancellation. Stopping observation
through the caller's signal alone does not cancel native work, so Dudu also
uses the existing native abort and always waits for process disposal before
releasing its writer. DSH retains its full visible history.

Since 2026-11-20, `claude-session.patch` also narrows Claude's compaction provenance
invalidation to changes that affect `/compact` itself. Claude pushes its entire
command catalog when any skill is discovered or reloaded; a push that still
confirms built-in `compact` with no project/user override no longer invalidates
an otherwise successful compaction. Missing/unknown provenance and an override
still invalidate it, even if a later push restores the built-in command. Initial
provenance, native command start, the manual compact boundary and a successful
matching result remain required. Native failure, cancellation, process ownership
and release continue through upstream's implementation.

The old generic `stopTask` contract and normalization patches are also retired.
Claude uses the upstream native task control. Codex uses upstream's observed
descendant-turn control for child agents, and the background-terminal extension
only for an observed terminal of the root session. Parent/peer/unknown task IDs
continue through upstream ownership validation rather than reaching arbitrary
terminal termination.

## Opening cancellation (2026-11-03)

Claude's local `SessionOptions.openSignal` cancels initialization before a
Session exists, including SessionStart hooks, resume and settings/usage
readbacks. `dist/runtimes/claude/session.js` uses OAR's existing child teardown
and awaits process exit before rejecting. The listener is removed when
opening settles; an open session continues to use the existing abort/dispose
controls. No native prompt is sent for a cancelled opening. Other runtimes
do not implement this optional control, and Dudu supplies it only to Claude.

## Native Claude defaults and permissions (2026-11-03–04)

`dist/runtimes/claude/list-models.js` now exposes a token-free
`claudeConfiguration()` readback through the existing line-process control
path. It runs in the requested directory with listing hooks and MCP servers
disabled. Only model IDs, resolved model, effort values and the saved native
permission mode are projected; raw settings, sources, environment and account
information stay inside OAR. The model catalog marks the configured native
model as default and uses its reported effort, including aliases resolving to
the same model and saved per-model effort. The runtime and declarations expose
this optional capability.

`SessionOptions.permissionMode` is a local optional extension. Leaving it
absent retains upstream behavior. `inherit` omits the mode override; explicit
native modes use `--permission-mode`. Both use `--permission-prompts none`,
which denies a tool that would require a human prompt instead of hanging or
silently approving it. Dudu supplies this option for Claude and no longer uses
upstream's implicit `--dangerously-skip-permissions` for normal workspace
sessions. Explicit read-only still removes writing tools; explicit full access
uses `bypassPermissions`.

Focused verification uses the real installed Claude CLI and OAR in isolated
homes with a scripted model. The native init frame reports `permissionMode:
auto`, the model request reports Sonnet 5.5 and xhigh, and the default alias
retains xhigh. Separate real DSH cases exercise native Bash/lark-cli,
explicit read-only rules, effort-menu reopening and cancellation. See
`docs/providers.md` for final results and limits.

## Native Codex subagents (2026-11-04)

`dist/runtimes/codex/tasks.js` and `projection.js` also normalize native v1
`collabAgentToolCall` snapshots. A successful `spawnAgent` establishes the
child task and ownership; completing that tool does not complete its child.
Native child `turn/started` and `turn/completed` update that task; v1
collaboration snapshots preserve actual completed, errored and interrupted
outcomes. Messages sent to an ancestor or sibling do not establish ownership.
The original v2 `subAgentActivity` projection remains supported. The companion
declaration is updated.

The optional `SessionOptions.observedSubagents` carries earlier observed child
identities into a resumed Codex projection. It only seeds attribution; it does
not send a protocol command, start a worker or assert that an old task is still
running. Dudu persists these facts with the parent's existing replay state and
waits for new native activity before reopening its DSH observation.

The implementation reference is the installed Codex 0.162.1 app-server's own
generated `ServerNotification` schema and isolated native runtime records.
No new process transport, prompt driver or host-created native subagent is
introduced. Focused verification and DSH view integration are recorded in
`docs/providers.md`.

## Native background tasks (2026-11-05)

The optional `SessionOptions.backgroundTasks` enables host observation and
per-task stop controls on the existing native process. Session declarations
expose `backgroundTasks()`, `taskOutput()` and `configure()` only where
implemented. `seal-session.js` normalizes the local `configure()` extension;
upstream handles the public `stopTask()` control.

Claude's `task-controls.js` uses the existing stream-json channel and declares
`perTaskStopAffordance` at the first initialization, including resume
initialization. Native `get_task_output` reads bounded output without a model
turn, and native `stop_task` stops one task. Read-only output/settings snapshots
stay private instead of appending every poll to the raw record stream.
Model/effort updates use `apply_flag_settings` and verify requested effort.
Changes to the launch directory, permission mode or launch-time excluded tools
are refused while reusing this process; they are not silently applied on top of
old command-line restrictions. Additional native monitor task names normalize
to shell, while the installed Claude also reports Monitor as `local_bash`.

Codex's `background-tasks.js` reads `thread/backgroundTerminals/list`, joins
native command item completion and output notifications, and stops one
terminal with `thread/backgroundTerminals/terminate`. A user stop is recorded
as stopped only after its accepted native termination and observed terminal
exit, including when `item/completed` arrives before the termination reply.
Natural completion and failure retain their real native outcomes. Retained
session settings use `thread/settings/update` with the existing native busy
gate and sandbox/approval restrictions.

The references are the installed Claude Agent SDK's native control contracts,
native stream records, and the installed Codex app-server's generated schemas.
No separate shell execution, wire driver, task-output file reader or synthetic
model prompt was added. Dudu owns process retention and projects these facts
into the host job registry; see `docs/providers.md` for verification and limits.

## Process ownership on host exit (2026-11-07)

`dist/shared/executable/ownership.js` uses `signal-exit@4.1.0` for the existing
synchronous native process-tree cleanup. An unhandled SIGTERM, SIGINT or SIGHUP
now follows the same cleanup as `process.exit()`. The host's own signal handlers
and original exit code/signal are preserved. This does not install a competing
asynchronous shutdown policy or capture SIGKILL.

The hook is removed only after both the owned-child set and upstream's pending
captured-descendant cleanup set are empty, and installed again when either gains
an owner. A root closing its pipes does not drop a still-pending cleanup. A
disposed plugin leaves no empty ownership hook across hot updates. Cleanup
targets only the children OAR started and their captured descendants.

Focused tests use real OS processes, including a descendant in another process
group and an unrelated process. They cover ordinary exit, the three signals,
an intentionally handled signal, captured ownership after the root closes,
and hook removal after both normal disposal and final captured cleanup.
The original isolated reproduction also runs the installed Claude CLI with a
scripted model: SIGTERM no longer leaves the native CLI parented by PID 1.

## Recovery after a host crash (2026-11-17)

An abort or forced kill may bypass every in-process exit hook. Claude launches
now write a private session-keyed ownership record before OAR resolves the
process's spawn boundary. The record contains the host and direct child PID,
parent PID, group and start identity; it contains no prompt, path, environment
or credential. Process-table reads use OAR's asynchronous observation.
A record failure rejects admission only after ordinary OAR tree disposal has
finished, so it cannot leave an untracked writer.

`recoverOwnedProcess(key)` verifies a record before the host's existing Claude
busy check. A still-live recorded owner, a different session, a reused child PID
or an unverified process grants no permission to terminate. On POSIX the matching
child must also be orphaned to PID 1 and retain its original detached group.
Recovery uses the existing OAR tree helpers and waits for observed root exit
before returning; the host then keeps its normal native-registry busy guard.
Release removes only the matching record, so a late close cannot erase a later
owner's identity.

This applies to processes recorded by this version. It does not discover or
adopt pre-upgrade leftovers, take over another live host/TUI, resume a background
command after a crash, or resend a user message. Recovery runs when that exact
Claude session is resumed; there is no startup scan of unrelated sessions.
The host logs recovery diagnostics internally and keeps its existing busy
response if verification or disposal fails.

The host also supplies upstream `SessionOptions.retainedBytes` at 8 MiB to all
OAR sessions. Upstream elides older retained native/tool payloads only after live
observers receive the complete records, preserving event order, text, usage and
cursors. DSH remains the durable history. This is a raw-payload retention budget,
not an 8 MiB total-memory ceiling: text/events remain, and the latest frame may
exceed the budget. No upstream retention implementation was rewritten.

## Upgrade to 0.105.0 (2026-11-14)

The archive integrity above is the registry's and the lockfile's. Of the 23 files the patches touch, 12 are byte-identical in 0.105.0 and 9 changed upstream by
2 to 32 lines each (a `failure` class on refused controls, version-gated errors of the Codex open, new limit-reset members of the Claude runtime,
`collabAgentToolCall` reported as a tool item); two more are files the patches add. `claude-session`, `codex-session` and `process-ownership` apply as they
were. `session-controls`, `claude-defaults` and `codex-subagents` each had one or two hunks whose context an upstream edit had moved; they were redone by
hand against the new files, one patch at a time in the order of `upstream.json`, and the manifest was recorded again from the resulting trees.
Patches stay plain unified diffs without `diff --git` or `index` lines: with those lines `git apply --no-index` inside a repository skips every path
under the generated folder without a message, and the build then fails on the output checksum of the first file.

Upstream's own `compaction.js` and the Pi runtime are the same as in 0.92.0.

## Upgrade to 0.120.0 (2026-11-19)

The archive integrity above is the registry's and the lockfile's. 0.120.0 has 15 runtimes (Devin and Factory Droid are new since 0.105.0). The lockfile changed
only in OAR's own dependency tree: OAR itself (now nested under this package's `node_modules`), Pi's SDK packages 1.5.0 → 1.5.2 (the Pi bundle carries 1.5.2),
the new `gray-matter` and `js-yaml@3.15.2`, and `lovely-mermaid` in place of `grok-mermaid` under Pi's coding agent.

Of the 23 upstream files the patches touch, 16 are byte-identical in 0.120.0 and 7 changed; four more are files the patches add. Nothing was retired: upstream
still has no configuration readback, `permissionMode`, `openSignal`, background-task observation or output, `observedSubagents`, signal cleanup or process
recovery (searched in the official `dist`). `claude-session`, `codex-subagents`, `process-ownership` and `crash-recovery` apply as they were
(`crash-recovery` over a `shared/executable/process.js` that gained `windowsHide`). Three patches were redone against the new files, in the order of
`upstream.json`, and the manifest was recorded again from the resulting trees:

- `session-controls`: its text still applied, but upstream's `shared/stream-json/profile.d.ts` now imports `SessionKernel` itself (for its new
  `beforeRootResult`), so the patch's own import of it would have been a second one; that line is dropped and the section regenerated. Its other sections are
  unchanged: `session-options.d.ts` differs upstream in comments only, and `shared/stream-json/session.js` was restructured upstream (a root result is held
  while native facts are read; `queue()` always holds the input in OAR and sends it when the session is idle), but the two lines the patch adds there
  (`controls` and its spread into the sealed session) are unaffected, and a runtime's `consume` still sees every line first, so the replies to Claude's private
  task controls are not held behind a settling turn.
- `claude-defaults`: upstream removed the three trailing re-exports from `runtimes/claude/index.js` and `index.d.ts` (and added `sessionCapabilities`), which
  was the context of the patch's last hunk in each file. That hunk only added a newline at the end of the file and is dropped; the `configuration` hunks are the
  same at new offsets. The other five files of the patch are byte-identical upstream and their sections are unchanged.
- `codex-session`: upstream's `runtimes/codex/session.js` now throws a typed refusal (`readback.refusal` may be an error object), keeps
  `queuePausedAfterInterrupt` and moved the queue gate into `codexQueueRefusal`. The patch's same five changes (the import, `backgroundTasks`, the seeded
  projection, `note`, and `backgroundTasks`/`configure`/`stopTask` on the session) were placed again in that file; `background-tasks.js` is unchanged, and
  `rpc-control.js` and `task-control.js`, which it relies on, are byte-identical upstream.

The main entry also exports the nine other process runtimes and `classifyTool` from this version on (see the top of this file).

## Maintaining patches and upgrading

Keep host-specific behavior in the host adapter. Use OAR public methods whenever
they suffice. The native private controls documented above still require these
small upstream patches; do not introduce a second protocol driver in this package.

For an intentional upstream upgrade, change the exact dependency and lockfile,
verify the official archive's integrity, and compare each compatibility feature
against that release. Retire patches superseded by upstream only after verifying
the same completion, failure, cancellation, resume, background-task and process
ownership behavior. Recreate the remaining diffs against the new official files,
and update `upstream.json` with the new tree checksum and exact before/after file
hashes. Never make the builder ignore mismatches or apply fuzzy patches to get an
upgrade through.

The focused adapter tests verify reproducibility, cache repair, dependency
immutability, version/checksum refusal and patch drift. Run the directly affected
OAR and isolated real DSH regressions described in `docs/providers.md`, plus lint
and typecheck. Full test suites still require the owner's explicit approval.
