# Native Android implementation

## Status (2026-11-17)

**Product acceptance is open.** The owner rejected the first Android delivery
and the later screenshot review, including the issue menu and the unnecessary
icon atop deletion confirmation. The latest source correction uses current iOS
controls and operations as its reference. Its rendering has not been reverified;
the existing screenshots show the rejected version. See
[Android interface correction](android-ui-parity.md) for the changes and checks.
On 2026-11-18 the inbox, forward and task pages were redone from the owner's approved
drawings (see the section of that date below); their rendering has not been looked at yet.

The Android app is a separate Kotlin / Jetpack Compose Material 3 target in
`native-android/`. This pass implements the current phone service's main
workflows, using the iPhone app as the functional reference and the approved
Android homepage and Material popup examples as the visual reference. It is
no longer a homepage with a text-only conversation. The root `android/`
directory remains the legacy Expo prototype.

This is a local debug build, not a signed production release. Background push
is not implemented: the existing service offers APNs registration only, and
Android never sends an APNs token. Physical-device and real-provider
acceptance remain separate from the isolated emulator checks below.

## Implemented functionality

| Area | Android implementation |
| --- | --- |
| Connections | Manual pairing-link entry and QR scanner; encrypted multi-computer registry; computer/device identity checks; LAN-first signed route probes and public-address fallback; address viewing/editing with verification before save; reconnection without replaying mutations. |
| Home | Active, Backlog and All scopes with local filters below the pinned shelf; title avatars and Agent logos; unread/running indicators; child progress; swipe actions; explicit pin/read/status/assignment/delete controls. |
| Issues | Creation and editing, description, project, Agent, labels, priority, due date, children, project/label creation, linked session and copyable resume command; confirmed deletion with a fresh preview token. |
| Conversation | Dudu and issue/session conversations; streamed rich transcript; history paging; sanitized encrypted caches; reasoning, code, tables, tool details, changes, project and delivered-file browsers, team and background jobs. |
| Input | Durable multiple-input outbox, stable retry identity, explicit retry/remove, nine prepared photos, dedicated video and document selection, attachment previews, binary file upload, queue editing/removal/steering, stop, model/effort/permission controls, DeepSeek-only mode, commands, questions and approvals. |
| Dudu | Issue-recipient and skill completion; explicit forwarding; native Todo, Inbox and Task quick sheets; latest reply reading without replacing the current watch; expand/open issue/open session actions. No automatic Dudu issue participation is added. |
| Sessions | Workspace grouping, content search, session creation/rename/pin/archive/restore and workspace rename/deletion through existing APIs. Project creation uses the issue project API. |
| Inbox | Filters, paging, detail (a conversation record as a talk), selection (选择 / 取消 / 全选), handled/restore/delete and 转发 to a conversation, one at a time; creation of an issue from a record. Collection does not trigger automated triage. See the 2026-11-18 section. |
| Tasks | Create, read, edit, pause/resume, delete, manual run and paged history; daily/workday/weekly/monthly/interval/once/cron schedules; timezone, provider, model, project and new/reused/existing session targets; conversation-scoped list with ended tasks folded. |
| Settings | Existing native schema pages and actions, rules editor, connector recognition, account/plugin controls, environment fields and top-right additions; app/system language selection; dynamic host sidebar/settings/session-view navigation. |
| Embedded pages | Authenticated page-session exchange, scoped documents/resources/RPC/streams, secure cookie handling, navigation restrictions, refresh/back and renderer-failure recovery. Complex host pages use the existing page service rather than reimplementing them. |
| Files and speech | Image viewing, system document export, streamed video save/open and file details; native speech/keyboard switching and hold-to-talk through Android's recognition service, independent of host plugins. Release sends confirmed text; upward cancellation discards it; unfinished text stays a draft. |

Some actions depend on the connected provider's catalog and capabilities.
The client does not invent model names, an approval channel, or provider
features that the host does not offer. Subagent conversations are read-only
and return to their parent conversation/team view.

Assignment requires a project folder before an Agent. Existing assignment
is locked. An unassigned issue's project can also be saved or cleared on its
own before choosing an Agent. Workflow status changes only through explicit owner actions;
session activity, failures and reconnects do not advance it. Session takeover
and issue execution remain the host's responsibility.

## Architecture and safety

`native-android/app/src/main/java/app/dudu/android/` contains:

- `data/Endpoint.kt`: pairing normalization, validated routes and saved-link
  serialization. Credentials never enter request origins or diagnostic strings.
- `data/DuduLog.kt` and `Diagnostics.kt`: the app's diagnostics (2026-11-19). One JSON
  line per thing that happened (requests, connection, long poll, board loads, the
  电脑未连接 notice, foreground, conversations, sends), kept in
  `no_backup/diagnostics/` (1 MB a file, five files) and in logcat under `Dudu`; a
  crash leaves `crash-<time>.txt`. Words and counts only: no message, title, address,
  link, token or id of a session or computer. Pull them from a debug build with
  `npm run logs:pull -- --android [--device <adb serial>]`.
- `data/DuduApi.kt`: authenticated allowlisted requests, JSON scalar/object/array
  contracts, bounded response bodies, cancellable long polling, binary transfer,
  page opening, and signed connection probes. Redirects and automatic mutation
  retries are disabled.
- `data/Vault.kt`: Keystore AES-GCM and atomic files in `noBackupFilesDir`.
  Credentials, caches, preferences and drafts are excluded from backups.
- `data/Models.kt`, `data/ConversationData.kt`: contracts, pending-input
  reconciliation, safe caches and transcript page/tail merging.
- `DuduViewModel.kt`: computer/watch fencing, connection lifecycle, scoped
  drafts/outboxes/caches, explicit mutations and return navigation.
- `ui/`: Compose screens using shared controls, existing assets and App wording.

The transport remains authenticated HTTP/HTTPS under `/dsbot/api/v1/`, with
HTTP long polling. There are no WebSockets, anonymous pages or generic DSH RPC
proxies. Complex pages use `/dsbot/web/open` and `/dsbot/ui/<page-session>/`.

Address switching follows the existing iPhone protocol. A probe contains a
fresh nonce and device ID, without a pairing token. The app verifies computer
and device identity and HMAC-SHA256 using a key derived locally from the
credential. Only then can the selected route receive an authenticated request.
Legacy single-origin pairings upgrade identity at that origin first.
User-edited routes survive host route discovery. TLS uses Android system trust;
explicitly paired HTTP addresses are also supported, as on iPhone.

Network, encrypted storage, image decoding, JSON cache serialization and history
merges run off the UI thread. Each computer has one complete home snapshot for
local scope switches, filters, and pins. The previous per-scope caches remain
readable on upgrade. Transcript caches, drafts and outboxes are scoped by
computer and session. The memory
transcript cache holds at most six sessions. Cached conversations omit actionable
questions, approvals and read positions until a fresh watch arrives.

An outgoing input is durable before transmission. Retry keeps its request ID.
Watch admission takes precedence over a lost HTTP reply, including admission
while the failure is being saved. Cold-restored unaccepted items require an
explicit retry; no create, send or delete is automatically replayed. Retrying
an older failed input preserves a different current draft. Paging keeps loaded
history and does not let a late response replace a newer authoritative tail.
Failed slash commands retain their composer input too. Computer retirement
fences further business requests while permitting a bounded disconnect cleanup.

Opening/refreshing home sends no read receipt. A conversation acknowledges only
the delivered position visible in the foreground under its current watch.
Quick sheets and read-only cached content cannot cause incidental reads.

## Design and wording

Approved references:

- `.local/designs/android-home-2026-11-17/`
- `.local/designs/android-board-filters-2026-11-18/06-top-bar-comparison.png` (right-hand design)
- `.local/designs/material3-popups-2026-11-17/`

Rendered results must be reviewed separately from functional checks. Existing
emulator captures are historical and were rejected by the owner. They do not
verify the latest menu, picker, sheet, task, collector, team and navigation
corrections. Current SwiftUI controls and the owner's images remain the
reference; Material defaults do not approve different information hierarchy or
custom App controls. No new runtime inspection is run in this continuation.

`scripts/sync-android-strings.mjs` generates string resources from
`wording-sources.json`; `scripts/sync-android-words.mjs` generates the additional
screen dictionary from existing native/Desktop dictionaries. App language also
controls API language, weekday/date formatting and speech-recognition language.

The following exact English translations still await owner review before
release. Their existing Chinese actions are reused unchanged:

| Chinese | English pending review |
| --- | --- |
| 标为未读 | Mark as unread |
| 清除未读 | Clear unread |
| 回到底部 | Scroll to bottom |
| 刷新 | Refresh |
| 语言 | Language |
| 跟随系统 | System default |
| 添加图片 | Add pictures |
| 发送视频 | Send video |
| 连接嘟嘟 | Connect to Dudu |
| 打开 DSH 并安装嘟嘟插件，在嘟嘟设置中打开配对二维码 | Open DSH and install the Dudu plugin, then open the pairing QR code in Dudu settings. |
| 转发 | Forward |
| 转发给 | Forward to |
| 最近会话 | Recent conversations |
| 已转发到 {0} | Forwarded to {0} |
| 已转发到 (with the trailing space, the record's line) | Forwarded to |
| 搜索 | Search |

They are recorded in `native-android/wording-sources.json` and
`native-android/wording-pending.json`. This document does not approve App copy.

## Inbox, forward and tasks redesign (2026-11-18)

The owner approved the Android drawings (`.local/designs/inbox-forward-android-2026-11-18/`: five boards, the SVG frames and `android.mjs` with every dp/sp number; "就这样吧，开始实现")
after the iPhone versions were built (build 132). They are SVG drawings, not screenshots of this app. This supersedes the older share, duplicate, icon-bar and header-pencil descriptions
in the Inbox and Tasks rows above and in the paragraphs below. The Android code follows the iPhone's operations, order, words and states; what changed:

- **Sheets** (`DuduSheet`, `Page`, `SheetHeader`): a 32 x 4 dp grabber in a 24 dp band (Material's is 48 dp), a 52 dp bar, the title in the middle on every sheet (16 sp semibold title, a list's
  13 sp muted count beside it). The 21 sp left heading and `centersSheetTitle` are gone, and `SheetHeader` (the computers, the quota, the pickers of a new session, a property sheet that has not
  loaded) is the same centred bar with its action before the ✕ (a choice the coordinator relayed as delegated to the implementer, 2026-11-18). The composer's sheets (添加, 权限, 模型, 推理等级) keep their grey left title: the iPhone's
  `ComposerAttachmentSheet` is modelled on the system resource sheet and has it too. The estimates of how high a fitted sheet is lost the 12 dp the bar lost.
- **Labelled bar** (`ActionBar`, `BarItem`): a white pill 58 dp high, 16 dp from the sides, an icon of 22 dp over a word of 11 sp, destructive items in the error colour, an item may open a menu.
  It replaces the three bars of icons (inbox selection, record, task).
- **Tabs** (`FilterTabs`, used by the inbox and the tasks only): chips 34 dp high, 8 dp apart, 4 dp under the bar (they were 40 dp, each in a 48 dp touch box).
- **Inbox**: 选择 before the ✕; choosing shows 取消 / 已选 {0} 条 / 全选 and no ✕ (selection is its own state, so 选择 with nothing chosen shows "已选 0 条" and the bar disabled). A row is a 44 dp
  picture, a 16 sp title of two lines, "who · source" in 13 sp, the time in 12 sp and the record number in 11 sp at the right, 66 dp at least. The bar: 转发 / 已处理 / 删除.
  The sheet is as high as its rows as drawn (measured), up to 660 dp. A row's swipe and long-press menu offer 已处理 (恢复 on the 已处理 tab) and 删除. There are two tabs, 待处理 and 已处理: the
  ignore feature (the 已忽略 tab and the 忽略 mark on a row, in the bar and on a record) was removed on 2026-11-18 at the owner's word, with no code for old data, hosts or app versions
  (`inbox.list` takes `todo` or `done`; `inbox.mark` takes `done`, `delete` or `restore`).
- **Record**: ‹ (when pushed) / 收件箱 / ✕, no ↗ and no ⋯. One white card: `record.messages` of the host's `inbox.get` as a talk (a date between days, the sender where it changes, the time at
  the right), the text as it is when the host sends none, 打开来源 as its last row. Bar: 转发 / 新建事项 / 已处理 / 更多 (补全上下文, 删除); a handled record has 恢复 / 更多; a record an
  issue holds has 打开事项 / 补全上下文 and no 更多. The old code read `status`, which the record in full does not have (the bar always said 恢复); the tab is now taken from the record's own
  `done` and `issue` (`recordTab`).
- **转发** replaces 分享到事项 and 分享到会话 (both gone, with the issue picker): `ForwardPicker` lists the conversations of the open issues that have a session (`issue.pick` with
  `withSession`), a 48 dp tile in the colour of the title, "REF title", the Agent's logo; a search box finds one by number or words; one conversation at a time. A tap opens the app's own
  confirmation card (转发给, the conversation, what goes, 取消 / 转发); 转发 sends `inbox.share` with `to: "session"`, shows 已转发到 {ref} and closes; a failure stays in the card.
  Android has no in-app message component, so the success message is the system toast.
- **Tasks**: the 任务 sheet has no "+" in its bar; its rows are 64 dp (30 dp logo, 16 sp title, 13 sp status, the line under it across the row) and a 新建任务 pill sits under the list (the sheet is as
  high as its rows and the pill). The full page keeps its chrome and "+". The task in full: ‹ / 任务 / ✕, no pencil and no status chip, 状态 is the first row of 规则, and the bar is
  暂停任务 or 恢复任务 (none when ended) / 立即执行 / 编辑 / 删除任务 (red, asks first). 复制任务 is gone from the bar, the row menu and the conversation's list (the host keeps `tasks.duplicate`).
- Words: new 转发, 转发给, 最近会话, 已转发到 {0}, 已转发到  and 搜索 (English awaiting review, in `wording-pending.json`); removed 分享到事项, 分享到会话, 已分享到 , 复制任务, 事项, 已忽略 and 忽略, which nothing
  uses now. Everything else is an existing word.

Checks: see [android-ui-parity.md](android-ui-parity.md). The rendering of these pages has not been looked at on an emulator or a phone.

## Build and checks

From the repository root:

```sh
npm run android:build
npm run android:test
npm run android:install
```

- `android:build` assembles the debug APK, runs Android core unit tests and
  Android lint. The APK is
  `native-android/app/build/outputs/apk/debug/app-debug.apk`.
- `android:test` runs only the Android core unit tests.
- `android:install` performs the build/checks, updates a running emulator and
  opens the app. Physical IDs are rejected. Set `ANDROID_SERIAL` when multiple
  emulators are running.
- The root `npm run android` remains the legacy Expo command.

Android Studio's bundled JDK and `~/Library/Android/sdk` are the defaults;
`JAVA_HOME` and `ANDROID_HOME` override them. Versions are pinned in Gradle.
The app targets API 36 and supports API 26+.

With E2E authorization for the current task:

```sh
npm run android:e2e
```

To rerun only an affected flow, still with current-task E2E authorization:

```sh
DUDU_ANDROID_TEST_CASES=failedSendKeepsDraftAndRetryUsesSameInputId npm run android:e2e
```

Comma-separated method names select several flows in one emulator run. Each
run clears only the generated screenshot export directory, so a receipt never
inherits screenshots from an earlier test selection.

The eight critical emulator flows cover:

1. Local scope switches and independent pins; signed computer-address save and invalid draft
   retention; cached home after refresh failure; no incidental reads.
2. Project-before-Agent creation, failed creation draft retention, manual
   workflow, locked assignment and deletion preview/cancel/commit.
3. Failed send and same-ID retry; admission through a watch with a lost HTTP
   receipt, including the failure-persistence race; failed slash-command draft retention.
4. Rich history/page/tool details, model configuration, queue steering and
   scalar question-answer results.
5. Task CRUD, revision-conflict draft retention, manual run and history.
6. Inbox record to linked issue and failed native rule-edit retention.
7. Dudu quick Todo reading without changing the watch, and subagent return.
8. Scoped embedded documents/resources/RPC, HttpOnly cookie, out-of-scope denial
   and page close.

The initial ten JVM unit tests guard pairing/route security, strict contracts, assignment,
pending-input reconciliation, cache/page merge, page scope and binary transfer
integrity. A signed-route contract check proves that invalid routes receive no
Authorization header and verifies successful fallback and reconnection.
Two targeted Node tests guard Android's device/connection naming while retaining
iPhone behavior. Root lint and typecheck are also required. The full repository
test suite is not part of this task.

The subsequent UI correction added focused checks for conversation-scoped task
membership, read-only transport retry boundaries and delivered-file reference
deduplication. Dudu now uses only the DeepSeek model catalog, permissions have
their own composer entry, ordinary goals stay inline, and inbox records use a
fixed icon action bar with the same state-dependent actions as iOS. No App copy
was invented for these controls. The latest source correction's APK digest and
build/check receipt are in
`.local/qa/android/ui-parity-2026-11-17/source-correction-verification.json`.
The earlier `verification.json` and
[the per-page comparison](android-ui-parity-comparison.md) describe the rejected
historical build. No latest-build screenshot or E2E pass is claimed.

`native-android/test/fixture.mjs` uses the real native HTTP server, SQLite issue
and task stores, inbox/settings APIs and scoped page transport. Agent execution,
host session content and a small embedded host document are controlled fixtures.
It binds localhost and is reached through `10.0.2.2`; it never starts the owner's
DSH, generates a production pairing link or invokes a model.

Receipts, APK copies, Gradle logs and actual emulator captures are under
`.local/qa/android/<run>/`. No tests assert sizes, colors or screenshots.

Historical implementation receipts (before the final UI correction):

- Initial completed APK build, ten unit tests and Android lint:
  `.local/qa/android/2026-11-17T06-19-24-334Z/result.json`.
- Eight-flow baseline acceptance:
  `.local/qa/android/2026-11-17T05-34-02-930Z/result.json`.
- Four affected flows after the connection, command and embedded-page fixes:
  `.local/qa/android/2026-11-17T06-07-39-006Z/result.json`.
- Connection cleanup regression after retiring a client:
  `.local/qa/android/2026-11-17T06-15-46-821Z/result.json`.
- Root lint/typecheck and the two targeted backend compatibility tests:
  `.local/android-complete-lint.log`, `.local/android-complete-typecheck.log`,
  `.local/android-complete-native-platform.log` and
  `.local/android-complete-page-platform.log`.

The expanded eight-flow run at `2026-11-17T05-52-12-705Z` passed seven cases
and exposed the embedded-page close timeout. Its report is retained under
that run's `test-results/`; the four-case rerun above verifies the correction.
Later localized changes were checked with the related flows rather than
repeating the whole repository suite. The final build includes the independent
project-field save on an unassigned issue; that thin existing-API binding has
no separate emulator case.

The historical UI comparison contains 79 paired screenshot states and six additional
Android states. It reuses one existing iOS simulator with parallel testing
disabled and the existing Android AVD, one platform at a time. It includes the
actual simulator photo-picker loading limit and documents fixture differences.
One selected task-flow attempt also hit an intermittent Compose lazy-list index
exception. The sidebar now publishes its sessions and workspaces together and
captures the interval structure before lazy measurement. The two affected
side-menu/cache and task flows pass after the correction; this is scoped
regression evidence for that older build, not a claim of exhaustive Compose
stability. See `android-ui-parity.md` for the latest source correction and
checks. Its selected JVM tests, build and lint do not replace visual or
interaction acceptance.

## Release and acceptance limits

- No Android background push until an Android-capable server registration and
  delivery path is configured; APNs-only service cannot supply this.
- Production signing/distribution is not configured by this local task.
- The current acceptance device is `OnePlus_13R`, Android 16/API 36 ARM64.
  Physical Android devices and older supported versions are unverified.
- Camera QR capture, real speech-recognition services, system document providers
  and actual Claude/Codex/DeepSeek execution need device/host acceptance. Tests
  verify the corresponding native/API contracts, not third-party service health.
- Complete dark-theme, large-font, tablet and TalkBack acceptance remains
  unverified. The Material theme supports system light/dark appearance.
- Pending English in `wording-pending.json` and `wording-sources.json` requires
  the owner's exact wording review before release.
