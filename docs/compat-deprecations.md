# Kept only for older apps

The plugin keeps answering every phone app that is out there (AGENTS.md, "Compatibility with released apps"). What it keeps only for older builds is listed here, with the day it
started to be kept for them, so that it can be removed once nobody runs those builds. The owner cleans this up about every six months (2026-11-23: 「你知道你的字段废弃开始时间就行了，
过半年我会清理一次」); removing an entry still needs the owner's word and the `client` of the paired devices (`pairing`) showing no device on those builds. When something is
removed, delete its line here and the fixture of the build that needed it (`tests/fixtures/app-contract-*`).

| Since | What is kept | Only for | Where |
| --- | --- | --- | --- |
| 2026-11-21 | `settings.page`: settings pages laid out by the plugin (newer apps lay them out themselves from `settings.data`) | iPhone 143 | `host/native-settings.mjs` (`page` builders) |
| 2026-11-22 | Chat rows that show only the agent's last finished answer and its time (an app with `board.latest` gets the newest message of either side) | iPhone 143 | `home/chat-home.mjs` (`ownMessages` off) |
| 2026-11-23 | A sign-in started from the phone (`settings.act` `connect` / `verb authorize` of a connector that signs in) opens its page in this computer's browser; newer apps sign in on the phone (`signin`, `signin-finish`). Also the 可用 group and the `settings.page` connectors layout those builds draw | iPhone 143, 152 | `host/assistant/connectors/connections.mjs` (`connect` without a handoff), `host/native-settings.mjs` (`connectors` page builder) |
| 2026-11-25 | `activityReaderOf`: the activity projection is read by key through the registry, because `register()` returns only the function that unregisters (DSH 0.2.2 returns a handle with `stateOf`, and keeps the by-key read as a deprecated call) | DSH 0.2.1-alpha.3 to 0.2.1-rc.5 (a DSH build, not an app) | `host/assistant/sessions/activity-projection.mjs` |
