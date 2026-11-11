---
title: Desktop apps
description: Report crashes, sessions and JavaScript errors from a macOS, Windows or Linux app, with sourcemaps for readable stacks.
---

# Desktop apps

A desktop app built as a native shell around a webview, with a Bun or Node agent process beside it, reports to BugHQ over the same HTTP API as a phone app. There is no desktop SDK to install: the app posts JSON, and this page is the whole contract.

| Source | What to send |
| --- | --- |
| A launch | A session, so releases have a crash-free rate |
| A JavaScript error in the webview or the agent | An event with the error's `stack` string, read with your sourcemaps |
| A native crash of the shell | An event with a structured `exception`, as on iOS and Android |

## Create the project

Create one project per platform in the dashboard, choosing **macOS**, **Windows** or **Linux**, and copy its ingest key. The platform decides which uploads the project's settings page offers.

## Environment

| Name | Where it lives | Purpose |
| --- | --- | --- |
| `BUGHQ_KEY` | In the app | The project's public ingest key, sent as `X-BugHQ-Key`. It ships in the bundle, which is safe. |
| `BUGHQ_HOST` | In the app | The collector, `https://bughq.org` unless you self-host. |
| `BUGHQ_UPLOAD_TOKEN` | CI only | The secret that uploads sourcemaps and symbols. Never put it in an app. |

Every request also names a `release`, the same string in sessions, events and uploads. `<version>+<build>` (`1.0.0+41`) works well, because it changes with every build that has its own sourcemaps.

## Report a session

Send one session when the app starts. `platform` is `macos`, `windows` or `linux`.

```http
POST /sessions
Content-Type: application/json
X-BugHQ-Key: bughq_your_project_key
```

```json
{
  "id": "0b9c6e0e-7d0a-4a52-9c35-6f1b0e3a9f11",
  "platform": "macos",
  "release": "1.0.0+41",
  "environment": "production",
  "status": "ok",
  "started_at": "2026-11-11T18:00:00.000Z",
  "user_id": "usr_42"
}
```

`id` is 8 to 64 letters, digits, `-` or `_`, and a UUID is the usual choice. `user_id` is optional and stored only as a hash. Sending the same session again is safe, and a batch of up to 50 goes in `{ "sessions": [...] }`, so an app that was offline can replay its queue in one request. Sessions are not metered.

## Report a JavaScript error

Send `error.stack` as it is. Name the same `release` and the session the error happened in.

```http
POST /errors
Content-Type: application/json
X-BugHQ-Key: bughq_your_project_key
```

```json
{
  "platform": "macos",
  "type": "TypeError",
  "message": "undefined is not an object (evaluating 'cart.items')",
  "stack": "renderCheckout@https://app.localhost/assets/app.js:1:48213\n@https://app.localhost/assets/app.js:1:51002",
  "level": "error",
  "release": "1.0.0+41",
  "environment": "production",
  "session": { "id": "0b9c6e0e-7d0a-4a52-9c35-6f1b0e3a9f11" },
  "contexts": { "app": { "version": "1.0.0", "build": "41" }, "device": { "model": "MacBookPro18,3" } },
  "tags": { "process": "webview" }
}
```

Both stack shapes are read: the V8 shape that Bun, Node and WebView2 print (`at render (file:line:column)`), and the WebKit shape that WKWebView and WebKitGTK print (`render@file:line:column`). An error marks its session errored. Send `"level": "fatal"` for one that took the app down, which ends the session as crashed.

## Sourcemaps

A release build is minified, so its frames read `i (app.js:1:48213)`. Upload the `.map` file of every script you ship and BugHQ rewrites each frame to the function, file and line you wrote before it groups the event. Grouping then survives a rebuild, which renames every minified function.

Create an upload token in the project's settings, under **Symbols**, and keep it in CI. The ingest key cannot upload.

```bash
gzip -c dist/assets/app.js.map | curl -X POST \
  -H "Authorization: Bearer $BUGHQ_UPLOAD_TOKEN" --data-binary @- \
  "https://bughq.org/api/debug-files?kind=sourcemap&release=1.0.0%2B41&file=assets/app.js"
```

| Part | Value |
| --- | --- |
| Method and path | `POST /api/debug-files` |
| `Authorization` header | `Bearer <upload token>`, which starts with `bughq_up_` |
| `kind` query field | `sourcemap` |
| `release` query field | The release the app reports, URL-encoded (`+` is `%2B`) |
| `file` query field | The script the map belongs to, as it is named in a stack frame |
| Body | The `.map` file, gzipped or plain, up to 64 MiB |

A `201` response lists the stored file. `401` means the token is missing, revoked or not an upload token, `422` that the release or file is missing or the body is not a version 3 sourcemap, and `429` that the token is uploading more than 30 times a minute.

`file` does not have to be the full URL. A frame in `https://app.localhost/assets/app.js` or `/Applications/MyApp.app/Contents/Resources/assets/app.js` matches an upload named `assets/app.js` or `app.js`: the name has to be the end of the frame's path. When two uploads match, the longer name wins. Upload one map per script, for the webview bundle and the agent bundle alike, and upload again for every release. A second upload for the same release and file replaces the first.

Maps are stored with their `sourcesContent`. Bundlers that leave the map's `names` empty, Bun's among them, record original function names nowhere else, so BugHQ reads them from the embedded source.

Maps uploaded after an error arrived apply to the next events. The issue page names any script whose map was missing.

## Native crashes

A crash of the shell itself is sent the same way as a phone crash: `platform`, a structured `exception` and `"level": "fatal"`. See [native events](../reference/api.md#native-events) for the frame fields.

- **macOS** frames name a binary, its UUID and an offset, and are symbolicated with the symbol map of the build's dSYM, uploaded exactly as [for iOS](./stacks-mobile.md#symbols).
- **Windows and Linux** frames are stored with the names the app resolved on the machine. BugHQ does not read PDB or DWARF files, so resolve what you can before sending and mark your own frames `in_app`.

A crash groups by its type and its top three in-app frames, never by its message.

## Release health

Desktop sessions count toward crash-free sessions exactly as mobile ones do. The dashboard shows, for each release in the last 30 days, the share of sessions that did not end in a crash. See [releases and alerts](../use/releases-alerts.md).
