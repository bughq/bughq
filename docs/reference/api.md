---
title: HTTP API
description: BugHQ ingestion, issue, project, team, channel, and Autofix endpoints.
---

# HTTP API

The public collector uses a project ingest key. Dashboard APIs use the authenticated user's bearer token or, for specific browser forms, the BugHQ session cookie.

## Ingest an error

```http
POST /errors
Content-Type: application/json
X-BugHQ-Key: bughq_your_project_key
```

```json
{
  "message": "Checkout failed",
  "type": "PaymentError",
  "stack": "PaymentError: Checkout failed\n    at submitOrder (checkout.ts:42:9)",
  "environment": "production",
  "release": "checkout@2.14.0",
  "url": "https://example.com/checkout",
  "user": { "id": "usr_42" },
  "tags": { "region": "us-west" },
  "extra": { "orderId": "ord_123" },
  "breadcrumbs": []
}
```

The message is required. The key can also be sent in the body. The collector rejects payloads above 256 KiB, applies rate limits, and returns `401`, `413`, or `429` when authorization or limits fail.

### Native events

Native apps add `platform` and a structured `exception`. `platform` is `ios`, `android`, `macos`, `windows` or `linux`; any other value is treated as a web or server event. Frames are top of the stack first. An Apple frame (`ios`, `macos`) names its binary, the binary's UUID and the offset into it, which the ingest symbolicates with uploaded symbols. A JVM frame names its class, method, file and line, which the ingest retraces with an uploaded R8 mapping. Windows and Linux frames are stored with the names the app resolved.

```json
{
  "platform": "ios",
  "type": "SIGTRAP",
  "message": "Fatal error: Unexpectedly found nil while unwrapping an Optional value",
  "level": "fatal",
  "release": "1.0.0+41",
  "session": { "id": "5c2f…", "startedAt": "2026-10-14T18:00:00.000Z" },
  "contexts": { "app": { "version": "1.0.0", "build": "41" }, "device": { "model": "iPhone17,1" } },
  "exception": {
    "mechanism": "signal",
    "handled": false,
    "frames": [
      { "image": "MyApp", "image_uuid": "F47C8145-F263-379D-9AD1-F3485CB38B7F", "image_offset": 2752, "in_app": true }
    ]
  }
}
```

A native event that names a `session` updates it: `"level": "fatal"` or an unhandled `exception` ends the session as crashed, anything else marks it errored.

### JavaScript stacks and sourcemaps

When an event has a `stack` string and a `release`, and sourcemaps were uploaded for that release, every frame with a matching map is rewritten to its original function, file and line before the event is grouped. V8 frames (`at fn (file:line:column)`, as Bun, Node and WebView2 print them) and WebKit frames (`fn@file:line:column`) are both read. This applies to any platform, including a minified browser bundle. See [desktop apps](../capture/desktop.md#sourcemaps).

## Sessions

```http
POST /sessions
Content-Type: application/json
X-BugHQ-Key: bughq_your_project_key
```

```json
{ "sessions": [{ "id": "5c2f…", "release": "1.0.0+41", "status": "ok", "started_at": "2026-10-14T18:00:00.000Z" }] }
```

One session per app launch, for crash-free sessions. Mobile and desktop apps both report them; `platform`, `environment` and `user_id` are optional, on each session or once beside `sessions`. A batch of up to 50 is accepted, so a device can replay its offline queue in one request. `status` is `ok`, `errored`, `abnormal` or `crashed` and only escalates. Sessions are not metered.

## Debug files

```http
POST /api/debug-files?kind=apple
POST /api/debug-files?kind=proguard&release=1.0.0%2B41
POST /api/debug-files?kind=sourcemap&release=1.0.0%2B41&file=assets/app.js
Authorization: Bearer bughq_up_your_upload_token
```

The body is the output of `symbols -arch arm64 <dSYM>`, an R8 `mapping.txt` or a JavaScript sourcemap (the `.map` file, version 3), gzipped or plain, up to 64 MiB. The upload token is a secret created in project settings; the ingest key is refused. A re-upload for the same binary UUID, release, or release and file replaces the earlier one.

| Query field | Kinds | Meaning |
| --- | --- | --- |
| `kind` | all | `apple`, `proguard` or `sourcemap`. Guessed from the body when left out. |
| `release` | `proguard`, `sourcemap` | The release the app reports. Required. |
| `file` | `sourcemap` | The script the map belongs to, as a stack frame names it. A frame matches when its path ends with this name. Falls back to the map's own `file` field. |

Responses are `201` with the stored files, `401` for a missing or revoked token, `413` above the size limit, `422` when a required field is missing or the body cannot be read as its kind, and `429` above 30 uploads a minute per token.

## Service and SDK endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health |
| `GET` | `/api/health` | API-prefixed health alias |
| `GET` | `/sdk.js` | Built-in browser loader |
| `POST` | `/sdk/hello` | SDK connectivity check |

## Issue APIs

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/{projectId}/issues` | List accessible project issues |
| `GET` | `/api/issues/{issueId}` | Read issue and recent event details |
| `POST` | `/api/issues/{issueId}/resolve` | Change issue status |
| `GET` | `/api/issues/{issueId}/autofix` | Read the latest Autofix run |
| `POST` | `/api/issues/{issueId}/autofix` | Queue an owner-only Autofix run |

## Project APIs

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects` | List owned and joined projects |
| `POST` | `/api/projects` | Create a project |
| `POST` | `/api/projects/{projectId}/rotate-key` | Rotate the ingest key |
| `POST` | `/api/projects/{projectId}/archive` | Archive or reactivate a project |
| `DELETE` | `/api/projects/{projectId}` | Permanently delete a project |
| `PUT` | `/api/projects/{projectId}/repository` | Connect or disconnect GitHub |
| `GET` | `/api/projects/{projectId}/releases` | Crash-free sessions per release |
| `GET` | `/api/projects/{projectId}/debug-files` | List uploaded symbols |
| `DELETE` | `/api/projects/{projectId}/debug-files/{fileId}` | Remove uploaded symbols |
| `GET` | `/api/projects/{projectId}/upload-tokens` | List upload tokens (owner) |
| `POST` | `/api/projects/{projectId}/upload-tokens` | Create an upload token, shown once (owner) |
| `DELETE` | `/api/projects/{projectId}/upload-tokens/{tokenId}` | Revoke an upload token (owner) |

## Members and channels

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/{projectId}/members` | List members and invitations |
| `POST` | `/api/projects/{projectId}/members` | Invite a member |
| `DELETE` | `/api/projects/{projectId}/members/{memberId}` | Remove a member |
| `POST` | `/api/invites/accept` | Accept an invitation |
| `GET` | `/api/projects/{projectId}/channels` | List masked alert channels |
| `POST` | `/api/projects/{projectId}/channels` | Add a channel |
| `PATCH` | `/api/projects/{projectId}/channels/{channelId}` | Update a channel |
| `DELETE` | `/api/projects/{projectId}/channels/{channelId}` | Delete a channel |
| `POST` | `/api/projects/{projectId}/channels/{channelId}/test` | Send a test alert |

The dashboard API is an application interface and may evolve before the first stable release. Custom integrations should pin a compatible BugHQ version and test response shapes during upgrades.
