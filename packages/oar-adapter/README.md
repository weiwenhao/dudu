# Dudu OAR adapter

`@dudu/oar-adapter` is the compatibility boundary between Dudu and the official
`@botiverse/oar` package. It exposes only the Claude and Codex runtimes and the
observation helpers the host uses. DSH event mapping, caching, native-store
reading and process retention remain in `host/providers/`; protocol and native
process ownership remain in OAR.

## Source of truth and build

- `package.json` depends on the exact official **0.92.0** release and
  `signal-exit@4.1.0`. The root lockfile pins their npm archives and transitive
  dependencies.
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
upstream package or generated output. The desktop archive bundles only the two
runtime dependency graphs, and carries OAR's Apache-2.0 license, its modification
notice identifying the adapter version, and licenses of dependencies actually bundled.

The previous `0.75.0-dudu.2` full vendor copy has been replaced by the official
0.92.0 release plus six compatibility patches. Native compaction and native
single-task stopping now use upstream implementations. The remaining patches
are grouped by implementation area because several features share session modules:

| Patch | Purpose |
| --- | --- |
| `session-controls.patch` | Optional control contracts, sealing and shared stream-json hooks |
| `claude-defaults.patch` | Native model, effort and permission configuration |
| `claude-session.patch` | Opening cancellation and private background controls |
| `codex-subagents.patch` | Native v1/v2 child ownership and resume attribution |
| `codex-session.patch` | Native background terminals alongside official child stopping |
| `process-ownership.patch` | Exit/signal cleanup and idle hook removal |

## Upstream provenance

The baseline is the published `@botiverse/oar@0.92.0` npm package from
https://registry.npmjs.org/@botiverse/oar/-/oar-0.92.0.tgz.
The upstream project is https://github.com/botiverse/oar, package directory
`packages/oar`, licensed under Apache-2.0. Its original `LICENSE`, README,
runtime modules, declarations and brand notices are preserved in the generated
copy. The official installed package remains unchanged, including its manifest.

The original npm archive's integrity is:

```
sha512-wnuL3EniE2q01RvdJQkgM7adlOMLSeYxoWVLhm/fXOGTdS+AZaq3TU93dzGv7DMuU4D8IA/TdHTISWTfiPspmQ==
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
