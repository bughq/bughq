---
title: Vue and Nuxt
description: Add BugHQ error capture to Vue applications and Nuxt projects.
---

# Vue and Nuxt

The Vue and Nuxt packages build on `@bughq/sdk`, so manual capture and common client options work the same way across integrations.

## Vue

```bash
bun add @bughq/vue
```

Install the BugHQ integration while creating the Vue application so framework errors are captured by Vue's error handling path. Pass the same key, host, release, environment, sampling, and filtering values used by the core SDK.

## Nuxt

```bash
bun add @bughq/nuxt
```

Register the module in the Nuxt configuration and keep public ingest settings in runtime configuration. Use separate environment and release values for preview and production deployments.

## Verify the integration

1. Trigger an error from a component event handler.
2. Trigger a rejected promise from client code.
3. Confirm that each event reaches the expected project.
4. Confirm that the release and environment are present.
5. Confirm that private runtime values are not present in event metadata.

For exact setup signatures, use the README shipped with the installed package version. The integrations are developing alongside BugHQ and may add framework-specific options.
