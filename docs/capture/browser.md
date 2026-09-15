---
title: Browser SDK
description: Install and configure the framework-agnostic BugHQ JavaScript client.
---

# Browser SDK

The `@bughq/sdk` package captures uncaught browser errors and unhandled promise rejections. It also exposes manual capture, user, context, and filtering APIs.

## Install

```bash
bun add @bughq/sdk
```

```ts
import { bughq } from '@bughq/sdk'

bughq.init({
  key: 'bughq_your_project_key',
  host: 'https://bughq.org',
  release: 'web@2026.09.10',
  environment: 'production',
})
```

You can use a DSN instead:

```ts
bughq.init({
  dsn: 'https://bughq_your_project_key@bughq.org/your-project-id',
})
```

## Manual capture

```ts
import { captureException, captureMessage, setUser } from '@bughq/sdk'

setUser({ id: 'usr_42', email: 'developer@example.com' })

captureMessage('Checkout retry limit reached', {
  orderId: 'ord_123',
})

try {
  await submitOrder()
}
catch (error) {
  captureException(error, { orderId: 'ord_123' })
}
```

## Client options

| Option | Default | Purpose |
| --- | --- | --- |
| `key` | Required | Public project ingest key |
| `host` | `https://bughq.org` | Hosted or self-hosted collector URL |
| `dsn` | None | Alternative to separate key, host, and project values |
| `release` | None | Deployed application version |
| `environment` | `production` | Deployment environment |
| `enabled` | `true` | Enables or disables capture |
| `sampleRate` | `1` | Fraction of eligible events to send, from 0 to 1 |
| `dedupeMs` | `5000` | Client-side duplicate suppression window |
| `beforeSend` | None | Mutate an event or return `null` to discard it |

## Filter before sending

```ts
bughq.init({
  key: 'bughq_your_project_key',
  beforeSend(event) {
    if (event.message.includes('ResizeObserver loop'))
      return null

    delete event.extra?.accessToken
    return event
  },
})
```

`beforeSend` is the best place to remove secrets or known noise before data leaves the browser.
