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
