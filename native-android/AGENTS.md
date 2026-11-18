# Native Android

This is the Kotlin and Jetpack Compose target. The ignored root `android/`
directory belongs to the legacy Expo prototype; do not generate this target
with Expo or copy iOS-specific layout workarounds into it.

Read the root `AGENTS.md` first. Its design, wording, data safety and testing
rules apply here. The owner approved Android emulator E2E for the initial
implementation on 2026-11-17; that is not standing permission for future tasks.

- Build from the repository root with `npm run android:build`. This assembles
  the debug APK, runs Android core unit tests and Android lint.
- `npm run android:install` installs that build into a running emulator only.
  It rejects physical device IDs. With multiple emulators, set `ANDROID_SERIAL`
  explicitly.
- `npm run android:test` runs only the Android core unit tests.
- `npm run android:e2e` runs the critical Compose instrumentation flows against
  the isolated Node fixture. Run it only when the owner authorizes E2E for
  the current task. Do not launch the owner's DSH or use live pairing.
- Keep platform and build versions pinned in Gradle. The build script uses
  Android Studio's bundled JDK and the installed Android SDK by default.

The approved homepage reference is
`.local/designs/android-home-2026-11-17/`. Reuse the existing Dudu and Agent
assets and the established title avatars. Use the approved Material 3 popup
components. Check rendered results separately from functional assertions.

The inbox, forward and task pages were redesigned on 2026-11-18 (owner: "就这样吧，开始实现";
drawings `.local/designs/inbox-forward-android-2026-11-18/`, with `android.mjs` holding the dp/sp
numbers; the iPhone build is the behavioural reference; what was and was not checked is in
`docs/android-ui-parity.md`). Every sheet has a 24 dp grabber band and a 52 dp bar with its title in
the middle and a list's count beside it (`DuduSheet`, `Page`, `SheetHeader`; there is no left heading and
no `centersSheetTitle` any more; the composer's sheets keep their grey left title, as the iPhone's do). The actions of a page are a labelled bar (`ActionBar` / `BarItem`: an
icon over an 11 sp word, destructive items in the error colour, an item may open a menu). The inbox
sheet has 选择 before its ✕; choosing shows 取消 / 已选 {0} 条 / 全选 and no ✕. A record is one white
card (`RecordCard`: `record.messages` as a talk, the text as it is for a host that sends none, 打开来源
as its last row); its bar is 转发 / 新建事项 / 已处理 / 更多 (a handled record has 恢复 / 更多), and a
record an issue holds has 打开事项 and 补全上下文 only. The tab of a record comes from its own `done`
and `issue` (`recordTab`; the record in full has no `status`). The inbox has two tabs, 待处理 and
已处理: the ignore feature was removed on 2026-11-18 (owner), with no code for old data. **转发** replaces 分享到事项 and 分享到会话: it
goes to a conversation, one at a time (`ForwardPicker`, a confirmation card in `DuduConfirmation`
style, a system toast 已转发到 {ref}, a failure stays in the card). The 任务 sheet has no "+": a
新建任务 pill sits under its list, and its rows are the roomy ones. The task in full has ‹ / 任务 / ✕
only, 状态 is the first row of its rules, and 复制任务 is gone from the app.

UI wording lives in Android string resources and `ui/Wording.kt`, copied from
the existing iOS and Desktop dictionaries by `scripts/sync-android-strings.mjs`
and `scripts/sync-android-words.mjs`. Sources and pending English translations
are recorded in `wording-sources.json` and `wording-pending.json`.
Do not silently approve pending copy or write hard-coded App explanations.
`scripts/sync-android-assets.mjs` regenerates the checked-in PNG assets from
the repository's brand assets and Lucide SVGs; `rsvg-convert` is required only
for this regeneration.

Use the authenticated native HTTP API under `/dsbot/api/v1/` and long polling.
No WebSockets, anonymous pages, generic RPC proxies, generated pairing links
or credentials in logs. Credentials, caches and drafts stay encrypted in
`noBackupFilesDir`. Disk and network work belong off the main thread.

Preserve input IDs across retries and reconcile pending, queued and admitted
inputs. A failed or late reply must not erase a draft, duplicate a message or
change a different conversation. Only acknowledge content actually visible in
the foreground, under its current watch. Issue workflow remains manual and
independent of Agent activity.

Alternative addresses must pass the existing nonce-bound device HMAC probe
before receiving a pairing token. Preserve manually edited address lists.
Never retry a mutation as part of address selection or reconnection.

See `docs/android.md` for the implemented scope and acceptance limits.
- The board page's top bar has no title (owner, 2026-11-18: "app 顶部的看板两个字不需要了"; `Home.kt`, `title = {}`). The board's scope tabs (`BoardFilterBar`) are Lark's message filter row, as on the phone: grey track (`surfaceContainerHighest`), the chosen tab a white pill with a thin grey edge (`outline`) and the same grey words as the other tabs (`filterSecondary()`, medium; grey, not Lark's blue, by the owner's choice), the pill one box that slides to the tab that is chosen (`animateIntAsState` on its place); the filter button is a light grey circle. `FilterTabs` (inbox, tasks) is unchanged. The sidebar's 看板 icon is Lucide `circle-dot` (`ic_circle_dot`; the plugin's own icon when it sends one).
- The owner's subsequent six-point correction on 2026-11-18 uses current iOS as the reference for conversation process/reply grouping, compact tool rows, sidebar `primary`/additional disclosure, board-only connection feedback and quota cards (remaining percentages, blue/amber/red thresholds, right-aligned balances). `data/Transcript.kt` prepares display rows with the snapshot off the UI thread; do not return to one large outlined button and a separate detail paragraph per call. The root composer sheet has no “添加” heading or blank title block, only 8dp top content padding; model/permission subpages keep their headings. Scope tabs use their moving pill as feedback without a rectangular per-tab ripple. See `docs/android-ui-parity.md` for checks and remaining visual acceptance; this correction does not authorize automatic UI/E2E runs.
- The owner's voice-input correction on 2026-11-18 removes the host-plugin gate and external recognizer window. Keep the iPhone's voice/keyboard glyphs, hold-to-talk, release-to-send and 160dp upward cancellation. `media/AndroidSpeechCapture` uses Android's recognition service and requests microphone permission only on a press; unsupported recognition uses the existing iPhone wording without hiding the entry. A final result waits for release and enters the existing durable input journal without replacing text/attachments; incomplete results stay drafts. Computer/session changes, covering routes and backgrounding cancel the capture. Do not add automatic recognizer restarts, a host speech API or raw audio/transcript logs.
