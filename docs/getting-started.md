---
title: Quick start
description: Create a BugHQ project and capture your first error.
---

# Quick start

## 1. Create a project

Sign in to BugHQ, select **New project**, choose a name and platform, then copy the generated ingest key. The key begins with `bughq_`.

## 2. Install capture

For a browser application, add the hosted loader before the closing `</body>` tag:

```html
<script
  src="https://bughq.org/sdk.js"
  data-key="bughq_your_project_key"
  data-release="checkout@2.14.0"
  data-environment="production"
></script>
```

For an npm-compatible project:

```bash
bun add @bughq/sdk
```

```ts
import { bughq } from '@bughq/sdk'

bughq.init({
  key: 'bughq_your_project_key',
  release: 'checkout@2.14.0',
  environment: 'production',
})
```

The key alone identifies a current BugHQ project. Older or custom clients may also send the project id.

## 3. Send a test error

```ts
import { captureException } from '@bughq/sdk'

try {
  throw new Error('BugHQ quick start test')
}
catch (error) {
  captureException(error)
}
```

Open the project dashboard and select the new issue. Confirm that the environment, release, stack, and event time match your test.

## 4. Prepare production

- Set a stable release value on every deploy.
- Identify signed-in users with `setUser` without sending secrets.
- Filter expected or sensitive failures in `beforeSend`.
- Add Slack or Discord channels and send a test notification.
- Keep the ingest key in ordinary client configuration. It is public and revocable, not a private credential.
