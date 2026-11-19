# Dudu Computer Use compatibility

This is the built-in compatibility boundary for the Computer Use request of
2026-11-19: Dudu uses the `standard` preset and native tool calling in ordinary
work, and only its `cua_run_code` capability runs a PTC program.

It does not copy a native driver, screen-capture implementation, input protocol,
permission store or approval UI. Dudu's main bundle mounts the **installed
official macOS provider**. Its native helper, settings, stored application grants,
real calling Agent, screenshot attachment handling and disposal remain owned by
that provider.

## Implementation

- `vendor/` contains three **unchanged** source files from the official
  `@deepseek-ai/dsh-tool-executor-ptc@0.2.2-rc.3` npm archive. `upstream.json`
  records the archive, its SHA512 integrity and each file's SHA256. `LICENSE`
  is that package's MIT license. Do not edit these files.
- `entry.mjs` wraps the original PTC transport as a registered capability named
  `cua_run_code`. Its fixed tool view contains only the original provider's
  private `cua` definition. It uses the host's public `ToolExecutionPipeline`,
  retaining pre/post policies, approval, guards, cancellation and image contexts.
  The ordinary executor and other tool definitions are never changed.
- `build.mjs` checks the source inventory and statically bundles the engine.
  `.generated/` is ignored. The generated factory receives its dependencies
  through **DSH's loader**, so it does not install or load a second Cordis,
  ToolsService, sandbox, scope, or LLM implementation.
- `host/computer-use/provider-context.mjs` captures only the provider's raw
  registration and prompt. It preserves its real context and resource effects.
  The original provider supplies the facade initialization, including its actual
  `file:` import; no application path is guessed. Only the released native
  provider's held-key observer sees the standalone call as `run_code`, preserving
  the original token, caller signal and enclosing lifetime.
- `host/computer-use/registration.mjs` keeps the original preset-scoped raw tool
  for existing PTC agents. Only Dudu's `dudu-assistant-*` standard conversation
  receives the compatibility program tool. Other standard conversations and
  scheduled-task and collector conversations gain no tool or prompt. Those
  internal sessions share the assistant prefix and are explicitly excluded.
  An optional program's startup failure is logged without failing ordinary
  conversation creation; it exposes no raw-tool substitute or automatic retry.
- `host/computer-use/engine.mjs` initializes the original facade before each
  program and gives retained Computer Use state an owner separate from the main
  agent's other programs. The original runtime owns evaluation, file confinement,
  timeout, cancellation and release; this adapter implements none of them.
- On a host exporting the upstream `CuaPrograms` owner, the provider wrapper
  delegates to the installed implementation instead of enabling this backport.

## Single-package installation

`host/dudu-plugin/cordis.patch.yml` includes the adapter in the main Dudu bundle.
Its declarative patch disables the old macOS `cua` row and mounts
`dsh-dudu/computer-use` on macOS, alongside Dudu's main entry. Users install only
`dsh-dudu`; there is no companion package or separate activation step.
The wrapper reads and validates the **existing** row's settings through the
host's config editor. It does not write a profile, alter stored grants, enable a
different sandbox mode, make PTC persistent, or edit the DSH installation. The
adapter row is disabled on other platforms. Removing Dudu's bundle removes its
patch and returns provider composition to the normal host configuration.

`npm run computer-use:prepare` prepares the engine. `npm run package:desktop`
prepares it again, includes the compatibility entry and MIT attribution in the
main Dudu archive and checks the packaged entry outside the repository. Ordinary
`desktop:update` installs the complete bundle through the host's supported
installation flow. The early separate companion was never installed; it has
been removed from the source and release output.

The upstream development implementation that inspired this adapter is
`packages/experimental/cua/src/tool-registration.ts` and the standalone
`@deepseek-ai/dsh-tool-executor-ptc/run-code` API in deepseek-ai/deepseek-harness.
This backport deliberately uses the released PTC engine to match the installed
host's contracts; it does not assume that the unpublished runtime APIs exist.

## Verification boundary

The focused unit contracts cover standard mode preservation, private CUA
admission, scoped registration, state separation, facade initialization,
attachment context forwarding and the native held-key observer. Packaging checks
the actual archive's imports and notices. They are not evidence of a completed
computer-control task. No app, model, native helper, GUI, owner profile or
application grant is used by these tests. Actual Computer Use requires an
explicitly requested runtime/end-to-end check and the owner's normal macOS and
application approvals.
