# Android interface corrections

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
