---
title: Stacks and Craft mobile apps
description: Capture iOS and Android crashes, hangs, ANRs and JavaScript errors from a Stacks app built with Craft, with readable stacks.
---

# Stacks and Craft mobile apps

A Stacks app that ships to phones through Craft reports to BugHQ from the native shell itself. Nothing in your screens has to change to catch a crash.

| Source | iOS | Android |
| --- | --- | --- |
| Crash at the moment it happens | Signal handlers (a Swift trap is `SIGTRAP`, a bad pointer `SIGSEGV`) and the uncaught `NSException` handler | The uncaught exception handler on every thread |
| Delivered by the OS on a later launch | MetricKit crash and hang diagnostics | `ApplicationExitInfo`: ANRs and crashes in native code (Android 11 and later) |
| JavaScript | Uncaught errors in native screens and the app script, and web view errors through `@bughq/sdk` | The same |

Every event carries the app version and build (`1.0.0+41`), the OS version, the device model, the environment, the session and the trail of screens and failed requests that led to it. Events wait in an outbox on the device and are sent when it is online, so a crash on the underground arrives once the phone is back above ground.

## Create the projects

Create one project per platform in the dashboard, choosing **iOS** or **Android** as the platform, and copy each ingest key.

## Configure the app

Add the keys to `.env` the same way as `BUGHQ_KEY`:

```bash
BUGHQ_IOS_KEY=bughq_your_ios_project_key
BUGHQ_ANDROID_KEY=bughq_your_android_project_key
```

Then turn reporting on in `config/mobile.ts`. A top-level `crashReporting` applies to both platforms, and each platform can override it:

```ts
export default {
  crashReporting: {
    host: 'https://bughq.org',
    environment: env.APP_ENV,
  },
  ios: {
    // ...
    crashReporting: { key: env.BUGHQ_IOS_KEY },
  },
  android: {
    // ...
    crashReporting: { key: env.BUGHQ_ANDROID_KEY },
  },
} satisfies MobileConfig
```

Without a key the reporter installs nothing. `buddy build:ios` and `buddy build:android` write the settings into the app's `craft.config.json`.

| Option | Default | Notes |
| --- | --- | --- |
| `key` | none | The project's public ingest key. It ships in the app, which is safe. |
| `host` | `https://bughq.org` | A self-hosted BugHQ. |
| `environment` | `production` | Tags every event. |
| `release` | `<version>+<build>` | Every event and session names it. |
| `sessions` | `true` | One session per launch, for crash-free sessions per release. |
| `uploadSymbols` | `true` | Upload symbols from release builds when `BUGHQ_UPLOAD_TOKEN` is set. |

## Name the signed-in user

Only an id you choose identifies a person. Never send an email address, a name or health data.

```ts
import { crashReporting } from '@stacksjs/mobile'

crashReporting.setUser(user.id) // null on sign-out
```

From a native screen or the app script, `craft.crashReporter.setUser(id)` does the same.

## JavaScript in web views

`crashReporting.start()` initialises `@bughq/sdk` with a transport that hands every event to the native reporter, so web view errors share its outbox, session and device context. Call it once in the layout of the pages the app shows. Outside the app it does nothing unless you pass a `key`.

```ts
import { crashReporting } from '@stacksjs/mobile'

crashReporting.start()
```

Screen changes and failed requests become breadcrumbs. Successful requests are left out.

## Symbols

Release builds do not carry readable names. An iOS frame is an address in a binary, and an Android release build is renamed by R8. Upload each build's symbols and BugHQ restores functions, files and lines, and groups a crash by the functions it happened in rather than by addresses that change with every build.

Create an upload token in the project's settings, under **Symbols**. It is a secret: keep it in CI and never put it in an app. The ingest key cannot upload symbols.

### iOS: dSYMs from Xcode Cloud

`buddy build:ios` writes `ci_scripts/ci_post_xcodebuild.sh` into the iOS project when crash reporting is on. After an archive it runs `symbols` on every dSYM and uploads the result. In App Store Connect, open the Xcode Cloud workflow, then Environment, and add a secret variable named `BUGHQ_UPLOAD_TOKEN`. Without it, the script skips the upload and says so in the build log.

BugHQ runs on Linux, which can neither read a dSYM's DWARF in Apple's layout nor demangle Swift. The Mac that built the app can do both, so the build reduces each dSYM to a symbol map of function and line ranges and uploads that. To upload from a local archive instead:

```bash
symbols -arch arm64 MyApp.app.dSYM | gzip -c | curl -X POST \
  -H "Authorization: Bearer $BUGHQ_UPLOAD_TOKEN" --data-binary @- \
  "https://bughq.org/api/debug-files?kind=apple"
```

### Android: the R8 mapping

`buddy build:android --bundle` uploads `app/build/outputs/mapping/release/mapping.txt` after the build when `BUGHQ_UPLOAD_TOKEN` is set. The mapping is stored for the release the app reports, so a crash in `1.0.0+41` is retraced with the mapping of build 41. To upload by hand:

```bash
gzip -c app/build/outputs/mapping/release/mapping.txt | curl -X POST \
  -H "Authorization: Bearer $BUGHQ_UPLOAD_TOKEN" --data-binary @- \
  "https://bughq.org/api/debug-files?kind=proguard&release=1.0.0%2B41"
```

Symbols uploaded after a crash arrived apply to the next events. The issue page names any binary or release whose symbols were missing.

## Grouping

A native crash groups by its type and its top three in-app frames, never by its message, which for a native crash is usually an address. A wrapping JVM exception groups by the cause that holds your code. See [issues and triage](../use/issues-triage.md).

## Release health

Each launch reports a session. A crash ends its session as crashed, an ANR the person had to close ends it as abnormal, and any other error marks it errored. The dashboard shows crash-free sessions for the last 30 days, per release. See [releases and alerts](../use/releases-alerts.md).

## Test the pipeline

Debug builds accept a test crash, which Release builds do not contain:

```bash
# iOS simulator: swift, signal, exception or js
xcrun simctl launch booted your.bundle.id -CraftCrashTest swift

# Android emulator or device: native or js
adb shell am start -n your.package/.MainActivity --es craftCrashTest native
```

The crash is sent on the next launch.
