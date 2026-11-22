# Mobile home navigation

Approved on 2026-11-20; implementation completed on 2026-11-21. The reference is
`.local/designs/mobile-bottom-navigation-compact-2026-11-20/`, refining the
owner's WhatsApp reference and Lark filter comparison. Those images are
code-rendered proposals, not screenshots of a running App.

## Native iPhone tab bar and Android dimensions

The four destinations remain 看板 / 收件箱 / 任务 / 设置. On 2026-11-21 the
owner explicitly requested the complete system tab bar after inspecting a
WhatsApp recording (“当然要改成完整的系统标签栏呢”). iPhone `HomeTabs` now
hosts the actual four page roots inside SwiftUI `TabView` / `Tab`, with the
existing template Lucide glyphs and native badges. The native control owns
its dimensions, glass, selected shape, press, drag and selection. The custom
HStack, 62pt frame, separately drawn selection pill and matched-geometry
animation have been removed. Tab selection uses the existing blue (`#4176E6`);
the pages themselves retain their neutral control tint. Android no longer has the capsule (owner, 2026-11-21: it does not suit Android): its roots sit in a full-width flat bar, 56dp with a hairline above and the navigation inset below, 24dp glyphs and 11sp labels, the chosen root with the iPhone's filled black glyph (the board's coloured) and no indicator.

On 2026-11-21 the owner removed the homepage dock's bottom scroll-edge blur.
Native iPhone tab pages disable the bottom scroll-edge effect. They have no
second dock footer or manually reserved bar height. The inbox enables its
separate bottom edge only while its selection action bar is actually present.

The owner's WhatsApp recording shows a lifted, refracting selection that
follows a horizontal press-and-drag. The system now supplies that interaction;
it has not yet been exercised or visually compared on a running device.

The board scope uses 13pt/sp regular text and `#737982` foreground, including
the inactive filter glyph. It keeps the approved `#EFF0F2` track, white
selected pill and edge shadow, 32pt/dp track and 28pt/dp pill. Existing
44pt-or-larger touch areas remain; segment text has 13pt/dp side padding.
The inbox and task filters retain their existing style.

## Navigation and lifecycle

Both native targets reuse their current board, inbox, task and settings
content and business handlers. Pairing and permissions are unchanged.

- Tab selection updates the root immediately, preserving its filters and
  scroll position. Existing model reads refresh its content afterward.
- The conversation and pushed details hide the dock. Their existing back
  controls lead to the originating root or detail, rather than always
  returning to the board.
- The sidebar's primary destinations select the same roots. Additional
  plugins and pages retain their current routes.
- Hidden roots cannot take touches or Back actions. Inbox/task reads pause
  while covered. The retained iOS task root cannot compete with the visible
  quick sheet to present the shared model's new-task editor.
- iOS settings retain their native NavigationStack; pushed children hide the
  dock. Their settings reads and previews cancel when covered without
  discarding the form. The inbox selection bar retains its existing actions.
- Android retains root composition but does not measure or place inactive
  content, and consumes the dock's bottom inset before laying out nested
  page scaffolds.

The iPhone's existing five-second foreground board refresh now belongs to
the root, outside appearance-scoped tab content, and refreshes the inbox count
alongside it. An inactive native tab cannot own refresh of the other tabs'
badges. No second board timer was added. Native TabView retention and
conversation/settings return gestures still need runtime review.

## Read counts (owner correction, 2026-11-21)

- Keep the scope tabs 进行中 / 全部; 待规划 was replaced by 未读 on 2026-11-21 and 全部事项 was shortened.
- Previously the board badge used `board.list.unreadCount`, which counts all
  workflows, including completed/cancelled and backlog rows outside the active
  list. The phone badge now derives from the current filtered list plus the
  independent pinned shelf, once per non-null session ID. Pinned duplicates
  cannot add a second count. Restoring an old cache, marking unread and actual
  visible read receipts use those same local row facts. iPhone's foreground
  App badge shares that count. The API's all-workflow count stays available
  for its other consumers.
- Previously the inbox tab used the pending total as an unread count. The
  computer now stores independent `revision` / `read_revision` per record in
  issues.db. `inbox.list` supplies `unreadCount`, `revision` and `unread`;
  `inbox.read { id, revision }` acknowledges only the displayed version.
  A genuinely appended conversation message or source title/text update
  advances the revision.
- A handled message carries no unread state (owner, 2026-11-21: “已处理的消息
  直接清除未读状态”). Marking it handled or making an issue of it brings its
  receipt up to date on the computer; a handled message has no red mark and is
  not in `unreadCount`, however it came to be handled, and a later change to
  its content does not bring the mark back. Restoring it keeps it read. This
  replaces the earlier rule that handling and reading were independent, which
  left an unread message hidden in the handled tab while the badge counted it.
- Otherwise only a loaded, visible foreground detail acknowledges content,
  through the shared service on iPhone, Android and Desktop. Listing, an
  agent's get, forwarding and completing context do not substitute for
  reading. Row marks reuse the existing red avatar dot without additional
  read/unread text, on the phones and on the Desktop widget.
- Earlier versions kept no reading history. The one-time migration establishes
  a baseline for all existing content, handled or not, and preserves
  records/marks without backfilling historical unread badges. A read-only count
  of the owner's current database found 7 pending and 213 handled records,
  with no receipt columns: there is no evidence to reconstruct which were read.
  New records after the migration start unread, and later intake of new content
  on an existing thread advances past that baseline. The baseline is not
  reapplied on restart. A stale read cannot acknowledge a newer revision.
- `inbox/read` is available through `dudu_capabilities` / `dudu_execute`, using
  the same validation and handler as the interface, only at the owner's ask.

## Checks and limits

Receipts are in `.local/qa/mobile-home-tabs-2026-11-20/`.

- `npm run native:build`: passed, including the retained-view and inbox
  navigation corrections.
- Android `:app:assembleDebug`, `:app:lintDebug` and the three existing
  `SidebarNavigationTest` cases: passed.
- `npm run lint`, `npm run typecheck` and `git diff --check`: passed.
- Four existing `MainNavigationTests` case bodies passed as standalone Swift
  assertions against the actual navigation source, with only dependent
  localization/embedded-page types supplied. This was not an iOS XCTest or
  UI run.

No browser, simulator, real DSH or end-to-end run was authorized or performed
for this implementation. At the owner's request, `npm run native:install`
installed iOS 0.1.0 build 143 in place on the paired physical iPhone on
2026-11-21, retaining the bundle identifier and signing team. Its receipt is
`ios-install.log` in the same QA directory. Android was not installed.
The later bottom-edge correction passed `native:build`, lint and typecheck
but has not been installed; its video-inspection and build receipt is in
`.local/qa/whatsapp-tabbar-2026-11-21/verification.json`.
Native glass rendering, safe-area spacing, glyph rasterization, physical
taps, swipe behavior and visual alignment with the proposal still require
runtime review.

The subsequent system-tab/read-count correction is recorded separately in
`.local/qa/system-home-tabs-2026-11-21/`:

- iPhone Release `npm run native:build` passed. Two pre-existing warnings
  remain in DuduStore and EmbeddedPageSession; no new warning remains from
  the native-tab selection binding.
- Android assembleDebug/lintDebug and the two focused BoardFiltersTest cases
  passed, including scope, pins and session deduplication.
- 34 related native-board/inbox API unit cases and two capability coverage/read
  cases passed. These cover schema migration, handled messages carrying no unread state,
  stale version receipts, deleted records and agent access to the shared action.
- The actual Swift board types and BoardUnreadTests body passed as standalone
  assertions with only dependent localization/agent types supplied. This is
  not an iOS XCTest or UI run.
- `npm run lint`, `npm run typecheck` and `git diff --check` passed.

At the owner's request this correction was installed in place on chuchu的iPhone
(iPhone Air), iOS 0.1.0 build 143, on 2026-11-21. The installation and installed
app metadata were checked; bundle `com.harnessmobile.app` and signing team
`S3549488QR` were retained. The first attempt encountered a concurrent Xcode
build-database lock; installation succeeded after that build released it.
Receipts are `ios-install.log` and `ios-installed-app.json` in the correction's
QA directory.

The same authorized update hot-reloaded the Desktop plugin through the official
detached `npm run desktop:update -- --force` command. Its result is
`.local/desktop-updates/run-8Kl51I/result.json`: mode `hot`, exact fingerprint
`2d11fe24d2b75be19ecf5f58815c30c5783ca1afc31db0d1db9bd160c57c3039`,
ready on port 3170 with the Desktop process retained. No restart was requested.
No browser, simulator or E2E run was requested or performed; the next acceptance
check would be a native four-tab round trip, press-and-drag, conversation return,
and inbox detail/read badge check.
