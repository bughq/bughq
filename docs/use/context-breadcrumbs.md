---
title: Context and breadcrumbs
description: Add useful debugging data without collecting secrets.
---

# Context and breadcrumbs

The issue detail view is most useful when an event explains who was affected, what the application was doing, and which deployment produced the failure.

## Structured event data

BugHQ accepts these categories of context:

| Field | Best use |
| --- | --- |
| `user` | Stable user id and optional non-sensitive contact fields |
| `tags` | Low-cardinality values used for filtering and grouping decisions |
| `contexts` | Structured device, runtime, order, or application state |
| `extra` | Additional debugging values that do not fit a standard field |
| `breadcrumbs` | Recent actions leading to the error |
| `session` | Session-level identifiers and state |
| `release` | Deployed version that produced the event |
| `environment` | Production, staging, development, or another deployment stage |

The collector keeps at most the 100 most recent breadcrumbs and enforces payload, message, stack, and metadata limits.

## Data minimization

Do not send passwords, authentication headers, cookies, payment data, private keys, or entire request bodies. Prefer opaque ids over complete records. Remove sensitive fields in `beforeSend` and repeat redaction on server integrations where possible.

## Good breadcrumbs

Useful breadcrumbs describe state changes and user intent:

- Route changed to `/checkout/payment`.
- Payment method selection changed to `card`.
- API request to `/orders` returned status 503.
- Retry 2 started after 500 milliseconds.

Avoid high-volume, low-signal entries that hide the actions immediately before a failure.
