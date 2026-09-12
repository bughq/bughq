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
