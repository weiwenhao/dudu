# Dudu for Android

Native Kotlin app with Jetpack Compose and Material 3, in its own Gradle
project. It connects to the same desktop plugin API as the iPhone app, with
native home, rich conversations, issue/session management, Inbox, Tasks and
settings, plus scoped embedded pages for complex host interfaces.

From the repository root:

```sh
npm run android:build
npm run android:install
```

The install command selects a running Android emulator, builds and checks the
APK, then opens the app. It never selects a physical phone. Set
`ANDROID_SERIAL=emulator-5554` if more than one emulator is running.

The APK is `native/android/app/build/outputs/apk/debug/app-debug.apk`.
Build receipts, APK copies and test screenshots are under `.local/qa/android/`.
The first run accepts or scans an existing manually generated pairing link;
test pairing stays confined to the isolated fixture. Saved computers support
verified LAN/public-address switching and address editing.

Android Studio's bundled JDK and `~/Library/Android/sdk` are the defaults.
`JAVA_HOME` and `ANDROID_HOME` can override them. The project targets API 36
and supports API 26 or newer. Open this directory in Android Studio rather
than the legacy Expo `android/` directory.

See [implementation and validation](../docs/android.md) and
[target instructions](AGENTS.md).

This is a debug build. Production signing, Android push delivery, physical-device
acceptance and the English wording listed in `wording-pending.json` remain
release prerequisites; the emulator checks do not claim real-provider coverage.
