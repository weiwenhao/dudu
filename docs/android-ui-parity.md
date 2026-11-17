# Android interface correction, 2026-11-17

## Acceptance baseline

The owner rejected both the first physical-device delivery and the subsequent
screenshot review. The latest feedback singled out issue actions and deletion:
Android had a different hierarchy and an unnecessary large icon above the
confirmation. The instruction to check other pages extends to similar product
and interaction differences; a library default does not justify them.

The current SwiftUI source and the owner's supplied images are the acceptance
reference, alongside the approved Android homepage proposal in
`.local/designs/android-home-2026-11-17/`. Keep existing App wording, logos,
operation order, grouping, disabled rules and navigation. Platform system
controls do not authorize different custom App controls.

## Latest source correction

This continuation changes only the Android target, its asset/wording sync
scripts and Android documentation. Existing collaborative iOS, Desktop and
provider changes are retained.

- Issue actions open beside the pressed row with a title preview and the same
  groups as iOS. Details are read-only. Editing individual properties opens the
  corresponding picker, rather than turning details into an unrelated form.
  Assigned Agent and project remain locked; a project folder is required before
  assignment. Child rows use a status mark, title/reference and disclosure.
- Delete confirmation has no large icon above its title. Cancel and Delete use
  equal rounded buttons. Failure feedback stays in the dialog; the existing
  deletion preview and commit contract is retained.
- Issue creation and editing share property pickers, including searchable
  projects and labels, named label colors, due presets/calendar and parent
  search. Existing due dates and label IDs survive an edit.
- Settings rows keep normal navigation; secondary operations use swipes.
  Computers open their details through the information button and expose delete
  on swipe. Settings reuse the host-provided navigation icons.
- Task provider, model, workspace, target, session and timezone choices open
  dedicated pages in the editor. Task rows share iOS's compact title/status and
  schedule line. Only one row's swipe is revealed. Unchanged edits cannot save;
  cancelling a dirty edit offers the existing Save/Discard actions, and saving
  or a dirty edit prevents accidental sheet dismissal. Failures retain input.
- Team cards use the main Agent first, then working, blocked, failed and idle
  groups. Finished members have a separate count card that can open and close
  even when everyone has finished. Finished member rows do not repeat the mark.
  Working and blocked marks use the existing LoaderCircle and OctagonPause
  artwork. Job output is plain monospaced content in a card.
- Collector rows share the existing connector logos, source metadata and time.
  Selection stays before the logo. Swipe and detail actions depend on record
  state and whether an issue holds the record. Bulk actions use a bottom icon
  bar. Record details retain the approved source, context and action hierarchy.
- Quick Todo rows keep the latest reply visible, expand within the list and read
  replies without replacing the conversation watch. Quick Inbox/Task detail
  retains its list and offers Back and Close in the same sheet. The
  conversation-scoped task list also retains its list while detail is open.
  Older transcript cards reuse the corresponding row controls.
- Sidebar search has its own focused page with local and remote content hits,
  rather than opening the unrelated management list. Model, effort, permission
  and attachment pages follow the current composer structure. Model selection
  remains available when a saved model ID no longer resolves in the catalog;
  configuration cannot be dismissed midway through its request.
- Project directories remain full pages; file previews are sheets above the
  current directory, and dismissal returns there. Changes and tool details use
  the existing content hierarchy. Diffs have independent old/new line numbers
  and retain the original file index after a search.
- Lucide assets use the same source stroke as iOS. Brand and connector assets
  come from the repository. Wording sync validates existing phrases and reuses
  iOS's plural forms; this correction does not approve pending translations.

Authentication, address probes, page scopes, watch fencing, durable input
identity, manual issue workflow and the host's API action names are retained.
Dudu receives no automatic issue participation or collector triage.

## Verification of this continuation

The latest receipt is
`.local/qa/android/ui-parity-2026-11-17/source-correction-verification.json`.
It identifies the exact APK, selected unit cases and build/check logs. The
commands compile the debug APK and instrumentation APK, run Android lint, the
root lint and TypeScript checks, and only these directly related JVM checks:

- Existing issue due date/label retention and project-before-Agent assignment.
- Independent old/new diff positions and no-newline markers.
- Conversation-scoped task membership.
- Provider model catalog separation.
- Delivered-file reference deduplication.

Instrumentation is compiled only. No emulator, browser scene, real DSH,
end-to-end test, physical-device installation or Desktop update is run for this
continuation. No new appearance tests are added.

**The current rendering and interactions have not been visually reverified.**
Source comparison and a successful build cannot establish visual acceptance.
The focused runtime check, when the owner requests it, is the isolated
issue-menu/property/deletion flow, followed by inspection of task editor
cancellation, quick-detail return, team folding and file-preview return using
the existing simulators sequentially. The full E2E suite is unnecessary.

## Historical evidence

The 79 paired states and six additional Android screenshots in
[the comparison](android-ui-parity-comparison.md) show the version the owner
rejected. They are retained to identify the mismatches, not as evidence of the
latest source correction. The comparison inventory and its renderer carry this
same warning so regeneration cannot label them as current.

`verification.json` records the historical APK digest and selected flows from
that earlier review. The `fe08dfed…` digest is superseded. Earlier test passes
remain evidence of their own build only, including the selected sidebar/cache,
task conflict/history and inbox/rule flows. One earlier run hit a Compose
lazy-list index exception; the sidebar inventory correction and its selected
regression checks remain documented in that receipt. No stress acceptance was
established.

The old screenshots used disposable fixture data, one existing iOS simulator
(`dudu-iPhone-Air-iOS27`) and the existing Android AVD, sequentially. No simulator
was created for this continuation. Those old captures include an iOS system
photo picker that remained at its loading screen; they do not prove selection
completion. Raw captures and historical failure logs are preserved.

## Remaining acceptance limits

Physical-device insets, OEM keyboard behavior, system photo/document providers,
real speech services, dark mode, large fonts, accessibility and real-provider
output remain unverified for this correction. Third-party embedded DSH pages
continue to use the authenticated page service; they are not redrawn as native
screens. Android push, production signing and pending English wording remain
release limits in [android.md](android.md). No commit or push is made by this
continuation.
