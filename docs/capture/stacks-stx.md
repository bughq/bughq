---
title: Stacks and stx
description: Capture Stacks server errors, logs, and stx rendering failures.
---

# Stacks and stx

BugHQ provides integrations for Stacks applications and stx templates.

## Stacks integration

```bash
bun add @bughq/stacks
```

Configure the integration with the public project key and the collector URL. The package can capture application exceptions and use lower-severity logs as breadcrumbs, giving a later error the events that led to it.

Use manual capture when you catch an exception but still want it reported:

```ts
import { captureException } from '@bughq/stacks'

try {
  await processCheckout()
}
catch (error) {
  captureException(error, { job: 'checkout' })
  throw error
}
```

## stx integration

```bash
bun add @bughq/stx
```

The stx package builds on the core JavaScript SDK and provides template-aware integration. Initialize it once in the application entry point, before the first component or view can fail.

## Operational notes

- Set the environment and release explicitly in production.
- Ensure queued capture has time to flush before short-lived commands exit.
- Avoid recording passwords, access tokens, cookies, or full request bodies as context.
- Treat expected validation failures as application results, not reportable exceptions.
