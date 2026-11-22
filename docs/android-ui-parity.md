# Android interface corrections

## Desktop context-menu icons and task switches, 2026-11-21

The owner's later Desktop screenshot replaces the system-symbol counterparts
listed in the 2026-11-20 section. iOS and Android now use the Desktop issue menu's
pin/unpin arrows, Pencil, CircleDot, Signal, User, Tag, Box, details and trash
marks, plus the exact solid-top DueIcon. Android uses the generated `DuduGlyphs`
mapping instead of a separate set of board-menu choices. Both context menus put
状态 above 重命名 and 详情 after 智能体, with existing business handlers and locks.
Active/paused task rows use the settings' native switch across the full, quick
and session-scoped lists. The detailed change and verification limits are in
`docs/native-mobile-fixes.md`; no new runtime UI check was authorized.

## Follow-up icon and control alignment to iOS, 2026-11-20

The owner explicitly chose the current iPhone implementation as the Android
reference after the source audit in
`.local/qa/native-icon-audit-2026-11-20/`. The shared 92-entry glyph mapping
already matched; this correction addresses the page-specific choices and
drawing differences that the audit found.

- Board context actions distinguish pin/unpin and use the iPhone's menu choices
  for detail, rename, priority, status, project and due date. These OS menu
  symbols use matching Android/Lucide counterparts, not copied SF Symbols.
  The no-host-icon sidebar fallback, project pickers, unassigned Agent and
  due-date removal also follow the iPhone's respective controls.
- Filter choices use the existing blue 18dp rounded-square mark. New-issue
  overflow icons normalize their visible ink to 16dp. Task workspace and run
  history now carry the corresponding workspace and result marks.
- Avatar working marks have the fixed 28-percent arc and one-second linear
  rotation; connection and pending-message marks have the thin fading tail.
  Subissue progress uses the iPhone's indigo, light-grey track and butt caps.
  Status marks share its upper-right anchor and white halo. Pi's optical size
  and single-ink Agent logo colour also follow the iPhone sources.
- The goal banner uses the Goal asset and three icon-labelled menu actions.
  Goal and multi-message queue expansion keep the same 44dp layout reservation
  and overlay upward, correcting the queue difference recorded below. Their
  existing command handlers and input identities are retained; goal editing
  still stages the existing edit command in the composer.
- Staged and received pictures share a full-screen preview with Close on the
  left and Download on the right, including saving/saved/failed feedback.
  Controls hide during zoom or downward dismissal, and tapping a zoomed image
  restores its original fit. Android retains its native document picker for
  saving. Image decoding and file writes remain off the UI thread.

All phrases reuse the approved current iPhone catalog; no new product wording
was composed. `scripts/sync-android-assets.mjs` generates the separate menu
mapping alongside the shared glyphs; a regeneration after the final generator
fix left all 308 Android main-source/resource files unchanged.

Android Debug assembly and Android lint, repository lint, the generator's
targeted ESLint check, TypeScript check and whitespace check passed. Logs,
source hashes and the checked APK hash are recorded under
`.local/qa/android-icon-parity-fix-2026-11-20/`. This follow-up did not install
an App, update Desktop, run a full unit suite, launch a simulator/browser or
execute an E2E flow. The preceding screenshots show the earlier build.
Rendered alignment, popup hit regions, animation and photo gestures remain
unverified; the next runtime check is those controls in an isolated Android
fixture, compared with the current iPhone interface.

## Owner-requested runtime screenshots, 2026-11-20

After the owner's explicit screenshot request, the current native apps were built
and installed only in an iOS simulator and an Android emulator. Local example
conversations supplied the file summaries, long diffs, pictures and queued inputs;
no production DSH, live pairing, physical-phone installation or Desktop update was
involved. Screenshots and capture-driver logs are under
`.local/qa/mobile-review-2026-11-20/`.

The Android captures show single-file type icons without a reserved column on
multiple-file cards, wrapped diff lines with both line-number columns, a white
file-sheet surface, separate picture/text messages, queue thumbnails and inline
actions, muted sidebar More, workspace checklist/options, and icons on every
visible inbox context action. The owner's visual review remains outstanding;
screenshots do not establish animation or gesture acceptance. Navigation fixture
rows omit host icon metadata, so their fallback glyphs are not evidence of the
production host's icon appearance.

The multiple-queue expansion remains a known difference: Android increases the
bottom panel's measured height, whereas iOS overlays the expanded list upward.
Both expanded states were captured; this behaviour was not changed. Initial
Compose capture attempts timed out waiting for UI idleness. A passive native
capture then succeeded, including an actual tap to expand the queue; the initial
capture-driver failures are retained in the logs and are not treated as proof of
an App freeze.

## File cards, picture messages and icon alignment, 2026-11-20

The owner's current iPhone interface is the reference. Android inbox press-and-hold
actions now all have the corresponding iPhone glyphs: Select, Open issue, Forward,
New issue, Complete context, Handled, Restore and Delete. Sidebar More uses the
existing muted colour (`#96989D` in the light theme); its workspace view-options
button uses the iPhone's two-ring checklist geometry, rather than sliders.

The icon audit also corrected conversation pin/unpin, rename and archive actions,
unassigned-Agent marks, task targets, model modes, tool activity, reconnect, and
composer Stop. `scripts/sync-android-assets.mjs` now derives `DuduGlyphs.kt` from
the iPhone's semantic mapping, copies its special glyph assets and traces its
custom tilted pin from `DuduPinGlyph.swift`. Normal action symbols therefore use
the same Lucide designs and proportional strokes; native menu framing and OS
symbols still belong to their respective platform controls. Plugin-supplied
navigation pictures retain their aspect ratio instead of being stretched.

Both phones wrap diff lines within their available width while retaining old/new
line numbers and additions/deletions. The Android file sheet's grabber and content
share the surface colour. The iPhone edited-files sheet opens at its large detent,
as the owner now requested; the delivered-files sheet keeps its previous sizing.

The owner's follow-up explicitly limits the leading file icon to **one edited
file**. A multiple-file card has no icon or reserved icon column. For one file,
the transcript can carry an optional basename, never a host directory or cwd.
It comes from the retained comparison summary and needs no file read. The card
then shows that filename with its corresponding file-type mark. The checked-in
48 code/language marks and name rules come from DSH; `native/shared/file-type-icons.json`
and `scripts/sync-native-file-icons.mjs` generate both phones' mapping. Other types
use the existing ChangedFiles mark. Receiving this extra transcript metadata
requires the next Desktop plugin update; no Desktop update was performed here.

Android queued images now have the iPhone's 30dp thumbnails in a bounded strip,
with text and non-image names beside the existing inline actions. The two text
lines have explicit line heights so they fit the 44dp row. Android sent pictures
stand above the separate text bubble, with one pending mark on the final visible
part. Attachment caching, sending, input identity and queue commands are unchanged.
The existing Android multiple-queue expansion still increases the panel height;
this change does not port the iPhone's upward overlay.

Verification and final build receipts are under
`.local/qa/mobile-files-and-icons-2026-11-20/`. No appearance tests, full unit
suite, browser, DSH, emulator or native UI flow was run. Source comparison and
compilation do not establish rendered icon, menu, wrapping, sheet-inset or
gesture acceptance. At the device check the physical Android phone was absent
from adb; the attached emulator was not used for installation or inspection.

## Homepage connection recovery, 2026-11-20

The owner reported the isolated 电脑连接 text in the centre of an empty board.
The phone diagnostics showed `app.restore.fail` at `Endpoint.kt:85`, followed
by `INVALID_LINK` when the saved computer was selected. Before the rename
commit `49d3a54`, Android saved pairing URLs with the removed path prefix;
the current protocol deliberately rejects that format and requires manual
pairing again. No credentials were decrypted or printed for this diagnosis.

Android now uses the existing iOS connection states with its current Material
controls. An invalid saved configuration opens the existing 连接嘟嘟 guide,
retaining the saved computer chooser and offering 重新扫码配对 / 粘贴配对链接.
Closing a sheet does not clear the connection-recovery requirement. A failed
new pairing attempt retains that guide until a successful connection.
Ordinary disconnections retain the cached board and its existing top notice;
saved-computer connection retries run only in the foreground and stop for
pairing/authentication failures. New pairing and user mutations are not
automatically retried.

The cache restores by computer identity before endpoint parsing, so an old
link no longer prevents reading the stored snapshot. With no snapshot yet,
the board's grey loading mark is below the scope row, as on iOS. A board-load
failure uses the existing 事项没能加载 and 重试 controls at that position.
The centred computer-list fallback is removed. No new product wording,
legacy endpoint acceptance, pairing generation or data reset was added.

All five focused JVM recovery/endpoint/cache-contract checks passed, as did
Android Debug assembly and lint and repository lint/typecheck. The checked
APK was installed in place on the same physical Android phone; its installed
hash matches the build and the system launch succeeded. The new launch logs
confirm that 59 cached rows restored before `INVALID_LINK` and that the
connection guide became active. The old pairing is still rejected; pairing
again remains the owner's action.

Receipts and diagnostics are in
`.local/qa/android-connection-recovery-2026-11-20/`. No emulator, browser,
real-DSH or end-to-end flow was run. Rendered spacing and scan/reconnection
gestures need the owner's on-device review; a build, state log or installation
alone does not verify them. The next runtime check is manual re-pairing with
the new protocol, followed by an ordinary network disconnect while cached
board content is present.

## Approved question entry A and native sheet, 2026-11-20

The owner approved the Android A drawings after choosing the iOS text entry.
`ConversationQuestions.kt` replaces the old inline all-question card with the
unboxed 回答问题 entry and a content-fitted `DuduSheet`. It retains native
Material choice controls, the shared sheet header, one question per page,
direct text input and loading inside the main button. Closing keeps the
current page and draft without sending an answer or stopping the agent.
`QuestionDraft` owns the pure paging and answer-assembly rules; the operation
is still `question.answer`. See [mobile-questions.md](mobile-questions.md)
for the exact references, checks and outstanding native visual acceptance.
No emulator, E2E, installation or production Desktop update was run.
The owner's subsequent installation request was completed on the connected
physical Android phone on 2026-11-20: an in-place APK update, exact installed
hash match and successful system launch. The receipt is
`.local/qa/mobile-questions-2026-11-20/android-install/result.json`;
this does not establish native UI or question-flow acceptance.

## Approved Lark scope styling, 2026-11-20

The owner approved `.local/designs/lark-scope-2026-11-20/` for Desktop,
iOS and Android. In light mode the homepage scope track and inactive filter
circle now share `DuduStyle.scopeTrack` (`#EFF0F2`). The selected white pill
uses Compose's `dropShadow` (10% black, 20dp radius, 3dp right offset) instead
of the old hard outline. Only the decorative track is clipped; the existing
48dp selectable tabs, 14sp grey labels, pill movement and active-filter
feedback remain. The dark theme retains its existing surfaces and outline;
the inbox and task tabs do not change. No App copy was added.

Android Debug assembly and lint, the iOS Release build, Desktop client build,
repository lint/typecheck and diff checks passed, recorded in
`.local/qa/lark-scope-native-2026-11-20/`. No full unit
suite, UI test, emulator, physical-device installation or Desktop update was
run. Native rendered blur, clipping and touch acceptance remain unverified;
the approved Desktop component preview is not an Android App screenshot.

## Native voice input, 2026-11-18

After the screenshot review the owner asked to fix the missing voice entry.
The old Android code required a matching enabled desktop speech plugin before
showing an external system recognizer activity. That gate and its plugin-list
request are removed. The composer's bare voice/keyboard glyphs reuse the
iPhone's drawing proportions; its toggle stays available during Agent work.
Voice mode has the existing 44dp input height and “按住说话”.

`media/AndroidSpeechCapture` uses Android's recognition service with runtime
microphone permission. Press immediately enters capture feedback, release
ends recording, and a 160dp upward drag cancels; recognition may finish before
release but cannot send early. It retains the iPhone's 60-second capture bound
and five-second completion bound. Final text uses the existing durable outbox
and request identity without replacing the current draft or attachments.
Unfinished text, including an empty final after nonempty partial results,
remains a draft. Cancelling, backgrounding, computer/session changes or a
covering route invalidates callbacks and releases the recognizer.

All labels, hints and error text reuse the current iPhone catalog. No new App
copy, desktop speech endpoint, transcription retry loop or audio storage was
added. Logs contain capture lifecycle/error codes, not spoken text or audio.

The checks and their final results are recorded under
`.local/qa/android-voice-2026-11-18/`. Four focused JVM cases cover release
ordering, single delivery, partial/empty results, cancellation and draft
preservation; all four pass. The final debug build, Android lint, repository
lint and TypeScript check pass. No phone installation was performed. This
change has not been opened in a simulator or tested with a physical
microphone. The preceding screenshots show the build before this
voice correction; they do not verify its layout, gestures or speech quality.
The next runtime check is the composer on a device with a recognition service:
permission denial/grant, hold/release, upward cancellation, switching while
the Agent works, and leaving/backgrounding before a late result.

## Conversation, navigation, filters and quota, 2026-11-18

The owner's five Android screenshots identify the acceptance failures for this
correction. The current SwiftUI implementations are the reference:
`Transcript.swift` / `TranscriptView.swift`, `ComposerAttachmentSheet`,
`BoardConnectionNotice`, `Navigation` / `SidebarView`, and `QuotaSheet`.

- Conversation snapshots now prepare turn/process/reply rows off the UI thread.
  Completed process is folded, final replies remain visible, and running tool
  groups have compact disclosure rows. Tool names and single-line details share
  a 24dp row, using the existing icons instead of outlined Material buttons.
  An intervening user input retains its position; only the last chronological
  fragment owns files and notices. Tool detail keeps its call/event references.
- Both native attachment sheets remove the root “添加” heading and its reserved
  title height. The first tiles move up with only 8pt/dp content padding below
  the grabber; model/permission subpage headings remain.
- Connection failures no longer print a red paragraph over the conversation
  composer. Confirmed current-foreground connection failure appears only in
  the board's 40dp pale-red strip, 16dp under its toolbar, using the iPhone's
  existing “电脑未连接”. Cached conversation history remains visible; unavailable
  empty history shows a ring. The notice clears on success or backgrounding.
- Sidebar destinations use the navigation registry's primary/group contract.
  Additional registered destinations, including plugins, DSH automation and
  context insight, are folded by default under “查看更多”. Dudu's task screen
  remains distinct from the registered DSH automation page.
- Scope tabs keep their approved moving selection pill and touch region. Their
  rectangular default ripple is removed; the visual track is clipped. Inbox
  and task filter tabs are unchanged.
- Quota uses the iPhone's grouped provider cards, typography and blue/amber/red
  remaining-usage rules. Material's default progress gaps and endpoint dot are
  disabled. Balances are labelled on the left and aligned on the right, with
  multiple currencies on one line. Plan/expiry/reset/read times retain the
  iPhone's existing wording. Opening asks once; read-only follow-up checks stop
  when the sheet closes and are fenced against computer changes.

No new wording was composed. “电脑未连接” has no approved English in the iPhone
catalog; Android reuses its Chinese source phrase rather than inventing one.

Verification logs for this correction live in
`.local/qa/android-parity-2026-11-18/`. The directly related JVM regressions
cover transcript ordering/live content/footer ownership, quota calculations
and balances, and registry sidebar grouping. No visual assertions were added.
The final Android debug build and lint, all seven focused JVM cases, the iOS
Release build, repository lint and TypeScript check passed. Android's APK is
ready, but `adb devices -l` reported no connected device at completion, so this
correction has not been installed on either phone.
The current message does not authorize simulator/browser/real-DSH E2E, so
rendered spacing, disclosure touch behavior and the absence of the OEM ripple
still require the owner's visual acceptance on the installed Android build.

### Screenshot review requested by the owner, 2026-11-18

On the subsequent request to show screenshots, the current debug App was opened
in the `OnePlus_13R` Android 16 emulator with the isolated native HTTP fixture.
Ten original screenshots and the temporary capture driver are saved under
`.local/qa/android-parity-2026-11-18/screenshots/`. The driver completed and its
temporary instrumentation source was removed from the App tree.

Viewed the root attachment sheet (tiles directly below the grabber, without
the former title block), expanded conversation process and single-line tools,
quota cards and right-aligned balance, collapsed and expanded sidebar,
selected backlog scope, and the homepage connection notice with retained
conversation content. The conversation still has no connection paragraph
over its composer in the simulated upstream-failure state. All data came
from the local fixture; no live DSH, pairing or phone was used.

This review does not establish OEM-specific behavior, the filter's pressed
animation frames, live streaming or physical-device gesture acceptance.

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

# Inbox, forward and task redesign, 2026-11-18

The owner approved the Android drawings (`.local/designs/inbox-forward-android-2026-11-18/`, SVG
drawings and `android.mjs` with the dp/sp numbers, not screenshots of this app) after the iPhone
versions were built, and the Android code follows the iPhone's operations, order, words and
states. The changes are listed in [android.md](android.md) (section of this date). In short:
24 dp grabber band and 52 dp centred bars on every sheet, a labelled action bar, the inbox's
选择 / 取消 / 已选 {0} 条 / 全选, the 66 dp record rows, the record as one white card, 转发 in
place of the two shares, the 任务 sheet without "+" and with 新建任务 under its list, the task in
full with 状态 as its first rule and a labelled bar, and no 复制任务. The only new words are the
six listed in `native/android/wording-pending.json`.

## Where the code is not what the drawings show

- **Right-hand text buttons** of a bar (选择, 全选) are Material `TextButton`s, which are at least
  58 dp wide, so their words sit 6 to 8 dp further in than drawn; 取消 on the left is where drawn.
- **Sheet height**: the lists are as high as their rows, up to the 660 dp the quick sheets had (the
  owner left the cap to the implementer); the inbox frame draws a taller sheet. The rows' heights
  are measured; rows not yet drawn count 76 dp.
- **The record menu** is a Material `DropdownMenu` above the 更多 item, at least 232 dp wide, its
  right edge moved to the bar's; its own item padding and shape are Material's.
- **Chosen rows** are filled with the ink colour at 9% (drawn `#EAEAED`); the bar's shadow is a
  3 dp elevation (the composer's), not the drawn blur.
- **Success message**: Android has no in-app message component, so 已转发到 {ref} is the system
  toast (a decision for the owner; iOS has its own toast).
- A search in the forward picker that finds nothing leaves the list empty: the iPhone's
  没有找到事项 is not on Android's list of words, and the brief allowed no further new word.
- The record's tab comes from its own `done` / `issue` (`recordTab`); the old code
  read a `status` that the record in full does not have.

## Verification of this change

- `npm run android:build` (assemble the debug APK, the Android core unit tests, Android lint)
  passed on 2026-11-18 13:49 (receipt `.local/qa/android/2026-11-18T05-49-11-082Z/`, APK
  `native/android/app/build/outputs/apk/debug/app-debug.apk`). The shared tree held another
  agent's unfinished Android work at the same time (board filters: `DuduViewModel.kt`,
  `data/DuduApi.kt`, `data/Models.kt`, `data/BoardFilters.kt`, `Home.kt`); an earlier run of the
  gate stopped on their half-written `BoardFilters` reference, so this change was also built
  alone in a scratch copy with those files at HEAD (assemble, unit tests, lint: passed).
- 19 JVM unit tests pass: the 17 existing ones and 2 new ones (`RecordTalkTest`: where a talk
  names its sender and starts a day, and the tab a record is in). No appearance tests were added.
- The instrumentation sources compile (`compileDebugAndroidTestKotlin`, in the scratch copy):
  `HomeFlowTest` presses the bar's run item by its tag (`task-run`); `edit-task`,
  `record-create`, `new-task` and `page-back` stay on the controls that took them over.
  Instrumentation was not run.

**The rendering of these pages has not been looked at.** No emulator, phone, browser scene or
real host was used: the dp/sp numbers were compared with `android.mjs` in the code only. Not
checked: how any of the five pages draws (spacing, the grabber trick, the 52 dp bar with its
count and ✕, the labelled bar and its menu, the confirmation card, the toast), the heights of the
fitted sheets, the swipe rows with the new row, a real host's `record.messages` and `issue.pick`
(an older host sends no `messages`; that path is the plain text), dark theme, large fonts, TalkBack
(the library's grabber keeps its actions; the bar's items read their words), and a physical device.
The next check is one emulator pass over the pages with the fixture host (`npm run android:e2e`
or a screenshot run) against `.local/designs/inbox-forward-android-2026-11-18/boards/`.

## Follow-up, 2026-11-18 (the same day): decisions and numeric corrections, still unrendered

The coordinator relayed that the owner had given the implementer all permissions, and that the
choices below were the implementer's. An emulator pass was asked for and **was not run**: the
relayed message is not the owner's own authorization, which `native/android/AGENTS.md` asks for
before `npm run android:e2e`, so no emulator was started, nothing was installed and no screenshot
was taken. Everything below was done from the drawings' numbers and compiled, not looked at.

- **Success message**: stays the system toast. The app has no in-app message component to reuse
  (the conversation's `notice` is a text line above its composer, the settings' `notice` a row in
  its list; neither exists in the inbox or in a sheet).
- **Left titles**: `SheetHeader` is now the page's centred 52 dp bar (see android.md). The
  composer's sheets keep their grey left title, as on the iPhone. The pickers of an issue's
  properties and the pairing sheet already had a centred title.
- **English words**: the six new words stay pending (`wording-pending.json`).
- **Cap**: the list sheets stay at 660 dp.
- **A review run is ready, not run**: `.local/designs/inbox-forward-android-2026-11-18/review/` holds
  `fixtures.mjs` (the iPhone design fixtures as the fixture's `reviewResponses`: inbox with a
  conversation and a plain record, the conversations to forward to, a share that fails, seven
  tasks), `ReviewShots.kt` (a capture-only driver, copied into `androidTest` for the run and removed
  after; it compiles) and `run.mjs` (needs an emulator that is already running, never starts one;
  pulls the pictures into `built/`; `--dark` for the dark theme). It uses the isolated fixture only.
- **Numbers corrected from `android.mjs`** (each was a difference found by comparing the code with
  the drawing, none by looking at the app): tab chips 34 dp and 4 dp under the bar (`FilterTabs`);
  the task in full: 30 dp logo, 8 dp under the bar, its first label 24 dp under that
  (`Section(top = 12)`), rule rows 50 dp; the record: title 6 dp, meta 8 dp and card 10 dp
  under it; the 更多 menu at least 232 dp wide and flush with the bar.

## 2026-11-19：收集器通知开关不再触发顶部进度条

主人追问安卓是否也有 iPhone 的通知开关 loading 问题。源码确认安卓也有：
铃铛调用 `perform`，后者走整页 `Actions.run`，设置 `busy`，使 `Page` 在顶栏下显示
2dp 线性进度条，同时禁用设置按钮。请求本身已经是异步，问题在于开关共用了
页面保存状态；铃铛图标也要等请求返回整页后才更新。

现在沿用现有 Material `IconButton`、铃铛图标、颜色和尺寸，点击立即更新图标，
通过 `DuduViewModel` 的 `CollectorNotifications` 在后台保存，不设置页面 `busy`，
不插入任何开关 loading。保存任务随 ViewModel 存活，离开设置页面不会取消；
每个收集器一次一个请求，连续切换保留最后选择，不同收集器独立。失败恢复最后
确认的值，沿用已有错误提示，不自动重试。通知响应不应用整页快照；已确认的本地
选择要等保存完成后发起的新读取才可替换，旧连接的结果不能覆盖新连接的操作。
普通表单保存、删除及初次加载仍使用原来的页面状态。没有新增 App 文案。

验证日志位于 `.local/qa/android-collector-notification-save-2026-11-19/`；
`CollectorNotificationsTest` 的四项定向核心用例通过，覆盖独立保存与旧读取、
连续切换、失败回退及响应丢失后的新选择、新旧连接交错。直接运行
`:app:testDebugUnitTest --tests app.dudu.android.CollectorNotificationsTest`，
没有执行全量单元测试。APK 构建、Android lint、仓库 lint/typecheck 均通过；
Android lint 为 0 错误、39 警告，与修改前的报告数量相同，Gradle 共约六分钟。
所改 Kotlin 源码在检查期间未变化。没有安装 App，没有运行模拟器、真机界面、
浏览器、DSH 或端到端场景；实际渲染与触控未验证。

## 2026-11-19：附件弹窗恢复原来的头部

主人在恢复 iPhone 的旧版附件头部后追问安卓是否也改了。安卓此前仍为无标题版；
现在恢复移除前 `189017a` 的 `ComposerSheetHeader(w("添加"))`，去掉无标题版
额外的 8dp 顶部间距，原来的 59dp 标题行、左对齐灰色 17sp 半粗体、40dp 左边距
和子页返回样式保持原样。整个 `ConversationControls.kt` 与该版本逐字一致，
没有新增关闭按钮、界面文案或新的交互。

同时核对收件箱列表的单条/批量操作及记录详情：它们的 `inbox.mark` 成功后原本
就只刷新或返回，不发成功 toast，因此无需改动；失败仍由现有 `Actions` 显示。

检查：`:app:assembleDebug :app:lintDebug`、仓库 lint 和 typecheck 通过；
Android lint 为 0 错误、41 警告。此次只恢复显示，不添加外观测试，
没有运行全量单元测试、模拟器、真机界面或端到端场景，也没有安装安卓设备。
检查回执和日志在 `.local/qa/android-composer-header-2026-11-19/`；
实际渲染、弹窗高度及触控未复核。

主人随后明确要求安装到安卓手机：已通过 USB 向连接的 22127RK46C
（`dba693ea`）原位更新 Dudu 0.1.0。`android:install` 的脚本仅用于模拟器，
此次依照主人对真机的明确请求使用 `adb -s dba693ea install -r`。
安装前后核对签名证书一致，设备上的 APK SHA-256 与本次构建完全相同，
原始安装时间未变；没有卸载、清除数据或启动 App。安装前重新执行
`:app:assembleDebug` 通过，没有运行单元测试或界面场景。
安装日志、设备版本及校验回执在上述目录的 `physical-install/`。

## 2026-11-19：文件变更摘要与侧边栏视图选项

主人反馈安卓“已编辑文件”没有变动记录，以及工作区旁设置按钮和 iOS 行为不同。
读取真机诊断，没有操作手机界面：19:58:56 的 `session.changes` 用时 45ms、
返回 216 字节，随后 `session.diff` 用时 170ms、返回 1144 字节，均为 HTTP 200，
没有对应的接口拒绝或解析错误。日志只证明请求返回成功，不证明逐行差异已经画出来；
原始诊断位于 `.local/device-logs/android-changes-sidebar-2026-11-19/`。

源码确认安卓的 turn footer 只画“已编辑文件”文字按钮，未使用插件随 transcript
发送的 `changesSummary`。现按 iPhone `TurnChangesCard` 显示文件数和新增/删除行数，
复用其 `ChangedFiles.svg`、24dp 图标、16dp 圆角、14dp 内边距、两行摘要和右侧箭头，
面板底色与边线沿用安卓现有排队消息面板。摘要从会话及缓存读取，不在滚入视口时
请求比较；未知统计仍保留摘要行高度，失效比较不删除卡片，也不对照当前文件系统。
同一 `changesSeq` 缺少统计时保留已知值，序号变化时清除旧摘要。打开变更列表和文件
差异保留来源会话 ID，并增加文件数/差异行数诊断，不记录路径或内容。

工作区旁按钮此前调用 `route("sessions")`，关闭侧边栏并进入另一个页面。现使用
现有 Material `DropdownMenu` 就地展开 iOS 同样的分组方式（按工作区、单列表）和
归档筛选（隐藏、全部、仅已归档），选择立即作用于侧边栏并保存到现有本地偏好。
列表遵守 iOS 的空会话隐藏、pinRank 排序、未登记工作区归入未分组及折叠规则；
点击归档会话先显示 iOS 已有的确认文字，确认后调用原有 `session.unarchive`，
保留先取消归档才能打开的规则。
所有引入的文字都来自已有 iOS 词典，没有新文案待审核。

7 项定向 JVM 检查已通过（`SidebarListTest` 两项和 `TranscriptTest` 五项），
覆盖归档筛选、分组/折叠、置顶顺序，以及变更统计的保留、缓存和序号隔离；
仓库 lint、typecheck、脚本语法及 `git diff --check` 已通过。最终 APK 构建和
Android lint 均通过（0 错误、41 警告，与此前报告数量相同）；最后一轮检查期间
11 份所改源码/资源的 SHA-256 均未变化。构建、定向检查、诊断依据及最终 APK 的
校验回执在 `.local/qa/android-changes-sidebar-2026-11-19/verification.json`。
没有运行全量单元测试、模拟器、真机界面、浏览器、真实 DSH 或端到端场景，
没有安装手机或更新 Desktop。卡片、菜单和逐行差异的实际渲染仍未复核；
适合主人授权后执行的检查是同一会话中的文件变更入口→文件列表→逐行差异，以及
侧边栏就地切换两种分组和三种归档筛选。

## 2026-11-19：收件箱筛选图标与侧边栏选中状态

主人提供的安卓截图中，收件箱右上角的滑杆按钮实际上按收集器筛选记录，
不是设置。已改用看板现有的 `ic_list_filter`，辅助标签沿用已审核的“筛选”，
保留原按钮尺寸和下拉菜单行为。iOS 当前收件箱头部没有这个筛选入口，
因此这里复用的是 App 已有筛选图标，不声称两端头部完全一致。

侧边栏此前的导航行没有读取当前页面，也没有选中底色。现从页面和返回栈
确定所显示的目的地，导航打开与选中匹配共用注册表的路由转换；
弹窗覆盖页面时保留下面页面的选中状态，会话本身不被误判为看板。
主入口、查看更多里的入口和无注册表时的原有入口均接入该状态，
未增加持久化导航偏好或请求。选中样式对照 iOS `SidebarView.libraryButton`：
两侧 16dp 外边距、12dp 圆角、浅色 `#EAEAED` 灰底，深色沿用已有 surface token；
内容左边距仍为 26dp，最小行高仍为 44dp，文字和图标尺寸未变。

检查期间主分支合入目录迁移 `49d3a54`，Android 改为 `native/android/`。
旧目录上的 APK 和 3 项导航检查已通过，但 lint 生成报告时因旧路径被移走失败。
随后改用新目录检查；迁移遗漏的 `SidebarList.kt`、`SidebarListTest.kt` 和
`changed_files.png` 已从 Git 对象恢复，三份文件均与迁移前 SHA-256 完全相同，
资源脚本保留新 iOS 路径和此前的变更卡片文件名。

最终 `:app:assembleDebug :app:lintDebug`、仓库 lint、typecheck 和资源脚本语法
检查通过；Android lint 为 0 错误、41 警告。10 项定向单元测试通过
（导航 3 项、恢复的侧边栏列表 2 项、此前的 transcript 5 项），没有运行全量
测试或端到端场景。最终检查期间 17 份改动的源码/资源校验值均未变化，
回执在 `.local/qa/android-filter-sidebar-2026-11-19/verification.json`。
没有安装手机或打开 App/模拟器，选中底色、筛选图标和触摸效果的实际渲染未复核；
主人授权后的界面检查应覆盖看板/收件箱/任务切换、弹窗下保留原页选中、
打开独立会话时不选中看板，以及收件箱筛选菜单。
