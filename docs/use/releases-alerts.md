---
title: Releases and alerts
description: Track deployed versions and notify the team about new issues and regressions.
---

# Releases and alerts

## Releases and environments

Set a stable release for every deployment, such as a semantic version, image tag, or commit SHA. Use the same release across browser and server processes that belong to one deployment.

```ts
bughq.init({
  key: 'bughq_your_project_key',
  release: process.env.APP_RELEASE,
  environment: process.env.APP_ENV,
})
```

Separate production, staging, and development with `environment`. This keeps pre-production failures visible without confusing them with customer impact.

## Alert events

BugHQ evaluates alerts when a new issue is created and when a resolved issue regresses. Alert delivery happens outside the critical ingest path so a slow provider does not delay error collection.

## Notification channels

Project owners can configure Slack and Discord webhook channels. Stored webhook URLs are masked when returned to the browser.

After adding a channel:

1. Use the channel test action.
2. Confirm the message reaches the intended channel.
3. Trigger one controlled new issue.
4. Resolve it, then send another matching event to verify regression delivery.

Email alerts use the configured mail transport. In local development, delivery may be written to the application log or captured by a local mail service.
