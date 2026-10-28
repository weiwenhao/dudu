The current iPhone app is native SwiftUI under `native/`. Read `native/AGENTS.md` for that target. Build it with `npm run native:build`; `npm run native:install` performs an in-place update on a paired physical iPhone. Keep the existing bundle identifier and signing team so Keychain and app data survive.

All new or changed user-facing App text requires the owner's review of the exact wording before it ships, including native screens, embedded pages, labels, titles, hints, alerts, permission descriptions, accessibility labels, and copied DSH UI text. Wording explicitly supplied or already approved by the owner does not need repeated approval. Repository documentation is not App copy; do not surface it in the App without review.

For local desktop plugin updates on macOS, use `npm run desktop:update`. It packages the source, installs through Desktop's bundled CLI, requests profile hot reload and checks the exact running build and service readiness. It normally restarts Desktop when hot reload is unavailable, respecting Desktop's own quit confirmation. Do not replace this with manual profile edits or forced process termination. Logs and profile backups are under `.local/desktop-updates/`.

The desktop plugin is named `dudu` (it was `dsbot` before 0.4.0) and listens on port 3170. Native app interactions use authenticated HTTP/HTTPS APIs under `/dsbot/api/v1/`, with HTTP long polling for live events. Complex DSH pages load directly in WKWebView over the user's chosen HTTP or HTTPS address, under `/dsbot/ui/`, with page-scoped authentication. `/dsbot/web/open` exchanges existing pairing authentication for a page session. Page documents, resources, RPC and streams all require that session; do not add anonymous pages, arbitrary HTTP forwarding, or a generic DSH RPC proxy. Do not add WebSocket transport. Pairing codes are generated manually by the user in DSH; never generate or inject a live pairing link during testing.

Harness providers (Claude Code and Codex inside DSH) live in `host/providers/` and run on `@botiverse/oar`, pinned and bundled by `scripts/package-desktop.mjs`. Do not hand-write harness drivers or protocol code: extend the use of OAR, and read `docs/providers.md` for the design, the limits OAR imposes (no approval channel) and how it was verified. Its list of new interface wording is awaiting the owner's review.

The remaining Expo/React Native files are a legacy prototype. The Expo-specific rules below apply only when editing that prototype, not to the SwiftUI target. Prioritize mobile interaction and keep decoding, image processing, Keychain access, and diagnostics writes off the UI thread.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
