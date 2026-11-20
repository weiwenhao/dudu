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

The owner's 2026-11-19 follow-up restores the composer's original “添加” header on
Android too, superseding the headerless-root instruction below. Reuse the exact
pre-removal `ComposerSheetHeader(w("添加"))` and content padding from `189017a`:
the existing 59dp row, grey left-aligned 17sp semibold title and 40dp leading
inset. Do not replace it with the other sheets' centred toolbar or add a close
control. Successful inbox 已处理 already finishes silently in both the list and
record detail; preserve that behavior and the existing failure feedback.

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

Use the authenticated native HTTP API under `/api/v1/` and long polling.
No WebSockets, anonymous pages, generic RPC proxies, generated pairing links
or credentials in logs. Credentials, caches and drafts stay encrypted in
`noBackupFilesDir`. Disk and network work belong off the main thread.

Collector notification bells update immediately and save without page-wide
`Actions.busy` or progress indicators (owner, 2026-11-19). Use the model's
`CollectorNotifications`, whose scope survives settings navigation; retain
the latest selection per collector, existing failure feedback and connection
fences. Old settings-page responses must not overwrite newer choices. Keep
the existing Material icon button, glyphs, colors and dimensions.

Preserve input IDs across retries and reconcile pending, queued and admitted
inputs. A failed or late reply must not erase a draft, duplicate a message or
change a different conversation. Only acknowledge content actually visible in
the foreground, under its current watch. Issue workflow remains manual and
independent of Agent activity.

Alternative addresses must pass the existing nonce-bound device HMAC probe
before receiving a pairing token. Preserve manually edited address lists.
Never retry a mutation as part of address selection or reconnection.

See `docs/android.md` for the implemented scope and acceptance limits.
- The board page's top bar has no title (owner, 2026-11-18: "app 顶部的看板两个字不需要了"; `Home.kt`, `title = {}`). The board's scope tabs (`BoardFilterBar`) are Lark's message filter row. The owner approved the updated Desktop component preview for all three targets on 2026-11-20: the light track and inactive filter circle share `#EFF0F2` (`DuduStyle.scopeTrack`), with a white pill and a broad faint black `dropShadow` instead of the old outline. Clip that backing to the track separately from the 48dp selectable tabs; keep the 14sp grey labels, 32dp track, 28dp pill, active filter feedback, and existing `animateIntAsState` movement. Dark mode retains theme surfaces and the pill's outline. `FilterTabs` (inbox, tasks) is unchanged. The sidebar's 看板 icon is Lucide `circle-dot` (`ic_circle_dot`; the plugin's own icon when it sends one). The approved preview is `.local/designs/lark-scope-2026-11-20/`, not native runtime verification.
- The owner's subsequent six-point correction on 2026-11-18 uses current iOS as the reference for conversation process/reply grouping, compact tool rows, sidebar `primary`/additional disclosure, board-only connection feedback and quota cards (remaining percentages, blue/amber/red thresholds, right-aligned balances). `data/Transcript.kt` prepares display rows with the snapshot off the UI thread; do not return to one large outlined button and a separate detail paragraph per call. The root composer sheet has no “添加” heading or blank title block, only 8dp top content padding; model/permission subpages keep their headings. Scope tabs use their moving pill as feedback without a rectangular per-tab ripple. See `docs/android-ui-parity.md` for checks and remaining visual acceptance; this correction does not authorize automatic UI/E2E runs.
- The board list and the inbox list swipe as the iPhone's do (owner, 2026-11-19: "安卓和 iOS 保持一致，现在看起来颜色都不一样了，动画也要保持一样，看板列表那里也进行调整保持一样"; drawings `.local/designs/inbox-swipe-2026-11-19/`). `SwipeRevealRow` is the one row for both (the iPhone's `BoardConversationSwipeRow` / `RevealSwipeRow`): the row keeps its width and slides over 84 dp blocks (a 22 dp glyph, 4 dp, a 14 sp white word); the colours are the iPhone's (`SwipeColors`: 完成 / 已处理 `#27B3A0`, unread `#27AFE7`, 置顶 / 转发 / 恢复 `#336DF4`, 删除 `#E0333D`), the board's glyphs are the iPhone's own (`home_swipe_*`, copied by `scripts/sync-android-assets.mjs`), and `swipeDestination` is its `BoardSwipe.destination`. A swipe to the right past two thirds of the row (or a tap on its block) lets the row slide away (180 ms), fades the word (60 ms) and closes the band towards its middle (220 ms), then does it; a row the page still has when it is free again comes back as it was. Board: right 完成, left unread + 置顶 (the unread block is shown and disabled without a session). Inbox: on 待处理 right 已处理, left 转发 + 删除; on 已处理 left 恢复 + 删除; none while choosing or on a record an issue holds. `SwipeMenuRow` (tasks, settings, computers) is unchanged. Change the numbers together with the iPhone's. `android:build` passes; not seen on an emulator.
- The owner's voice-input correction on 2026-11-18 removes the host-plugin gate and external recognizer window. Keep the iPhone's voice/keyboard glyphs, hold-to-talk, release-to-send and 160dp upward cancellation. `media/AndroidSpeechCapture` uses Android's recognition service and requests microphone permission only on a press; unsupported recognition uses the existing iPhone wording without hiding the entry. A final result waits for release and enters the existing durable input journal without replacing text/attachments; incomplete results stay drafts. Computer/session changes, covering routes and backgrounding cancel the capture. Do not add automatic recognizer restarts, a host speech API or raw audio/transcript logs.
- The app keeps diagnostics as the iPhone does (owner, 2026-11-19, on a 电脑未连接 notice nobody could explain: "各种日志都需要加上，不然我都没法排查问题"). `data/DuduLog.kt` writes one JSON line for a thing that happened; `Diagnostics.kt` puts it in `no_backup/diagnostics/events.jsonl` (1 MB a file, five kept), in logcat under the tag `Dudu`, and leaves `crash-<time>.txt` for a crash. `npm run logs:pull -- --android [--device <adb serial>]` copies them from a phone that runs a debug build into `.local/device-logs/` (`timeline.jsonl`, `summary.json`, `logcat.txt`). These logs found a real bug (2026-11-19): `Attachment()`'s read effect re-ran on every session snapshot, since a snapshot rebuilds the whole message tree from fresh `JSONObject`s even for an unchanged picture, so the same image was re-fetched and re-decoded repeatedly during an open conversation. Fixed with `DuduViewModel.attachment(method, params)`, a small cache keyed by the exact request (already a stable identity); `Attachments.kt`'s two read sites use it instead of `model.request`. Keep new attachment-reading code going through it rather than `model.request` directly. What is logged: every request (`http.request.complete` / `.fail`: its method, time, status, bytes, and in `state` its route, whether the connection was made for it or taken from the pool, and the kind of address, e.g. `request.pooled.lan`; `idleMs` is how long a pooled connection had lain idle), a read that was sent again (`http.request.retry`), a request the plugin refused (`request.refused`), the connection (`connection.begin` / `.route` / `.ready` / `.fail`, `connection.state`), the long poll (`events.start` / `.batch` / `.idle` every ten empty polls / `.fail` / `.reconnect.*` / `.stop`), the board (`board.load.complete` / `.fail`), the notice and the problem code as they change (`notice.unavailable.on` / `.off`, `problem.set` / `.clear`; the line before says what raised it), foreground and background, opening and leaving a conversation, sending (`message.send.begin` / `.accepted` / `.fail` with the input's own id), pages and panels. A failure carries the plugin's code, or the class of what was thrown with a word from a fixed list (`IOException.end_of_stream`, `JSONException.missing.<key>`) and the app's own line (`at`): a list the app could not read is told apart from a computer it could not reach. **Never a message, a title, an address, a link, a token, a session or computer id**: fields are words set by the code and checked against a pattern, counts come from a list (`DuduLogTest`). A new feature logs its failures and its state changes the same way; a new count key is added to the list in `DuduLog`.
